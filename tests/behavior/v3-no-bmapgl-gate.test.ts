/**
 * no-bmapgl 门禁自测（M3A3-REMOVE-LEGACY / issue #26）
 *
 * 门禁的失效方式有三种，**每种都会静默放行**，因此各配正反例：
 *
 * 1. **判定式写歪 / 扫错对象** → 负向断言恒真。这里用「历史上真含旧引擎痕迹」的形状喂进
 *    fixture（`window.BMapGL`、`new BMapGL.Map()`、`namespace BMapGL`、`"webgl-v1"`），
 *    要求逐条命中并给出规则名。
 * 2. **判定对象错位（误伤）** → 把注释、长文本里的提及、以及**官方 4.0 时代仍在用的插件
 *    命名空间 `BMapGLLib`** 判成「回退旧引擎」。这类误伤会逼出「为了过门禁而改注释」的
 *    本末倒置，所以也要逐条钉住。
 * 3. **夹具/范围写错导致空转** → 一个文件都没扫到时也会「通过」。因此每个「放行」用例都用
 *    `expectCleanAndScanned()` 顺带断言**真的扫到了文件**（成功输出里带扫描数）。
 *
 * 最后两节把门禁接回仓库：运行时源码树真的干净，以及它真的被某个 workflow 的 `run:` 跑起来、
 * 没有被 `if:` / `continue-on-error:` 架空。
 */
import { afterEach, describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-no-bmapgl.mts");
const RUNTIME_SRC = resolve(ROOT, "packages/baidu-map-gl-vue/src");

interface ScanResult {
  code: number;
  output: string;
}

function runGate(args: string[]): ScanResult {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const fixtures: string[] = [];

/** 建夹具并登记清理（用例中途失败也不会留下 /tmp 垃圾）。 */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "no-bmapgl-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  fixtures.push(dir);
  return dir;
}

afterEach(() => {
  while (fixtures.length > 0) rmSync(fixtures.pop()!, { recursive: true, force: true });
});

const scanSource = (dir: string): ScanResult => runGate(["--dir", dir]);
const scanDeclarations = (dir: string): ScanResult => runGate(["--declarations", dir]);

/**
 * 扫描范围里的文件数（成功输出里必须写出来，否则「干净」与「没扫到」无法区分）。
 *
 * 每个「期望放行」的用例都要顺带断言它 > 0——否则夹具写错路径时，门禁会因为**一个文件都没扫**
 * 而通过，这类空转比失败更难发现。
 */
function scannedCount(output: string): number {
  const match = /共扫 (\d+) 个文件/.exec(output);
  return match ? Number(match[1]) : -1;
}

/** 断言「放行」且确实扫到了内容。 */
function expectCleanAndScanned(result: ScanResult, atLeast = 1, label = ""): void {
  expect(result.code, `${label}\n${result.output}`).toBe(0);
  expect(scannedCount(result.output), `${label} 没有扫到文件（门禁空转）`).toBeGreaterThanOrEqual(
    atLeast,
  );
}

describe("no-bmapgl gate：旧引擎痕迹必须被抓到", () => {
  it("`window.BMapGL` / `globalThis.BMapGL` 全局访问被拦截", () => {
    const r = scanSource(
      fixture({
        "global.ts": "const sdk = window.BMapGL;\nconst other = globalThis.BMapGL;\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("global.ts:1");
    expect(r.output).toContain("global.ts:2");
    expect(r.output).toContain("[legacy-namespace]");
  });

  it("`new BMapGL.*` / 类型位置 / 动态键都被拦截", () => {
    const r = scanSource(
      fixture({
        "usage.ts": [
          'const map = new BMapGL.Map("c");',
          "let point: BMapGL.Point;",
          'const dyn = window["BMapGL"];',
        ].join("\n"),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("usage.ts:1");
    expect(r.output).toContain("usage.ts:2");
    expect(r.output).toContain("usage.ts:3");
  });

  it("`namespace BMapGL` 声明被拦截", () => {
    const r = scanSource(
      fixture({
        "ambient.d.ts": "declare namespace BMapGL {\n  interface Map {}\n}\nexport {};\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("[legacy-namespace]");
  });

  it(".vue 的 <script setup> 里的旧引擎访问被拦截，行号映射回源文件", () => {
    const r = scanSource(
      fixture({
        "Comp.vue": [
          '<script setup lang="ts">',
          "const ok = 1;",
          "const sdk = window.BMapGL;",
          "</script>",
          "<template><div/></template>",
        ].join("\n"),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Comp\.vue:3/);
  });

  it("已删除的 engine 取值 `webgl-v1` / `jsapi-v3` 被拦截", () => {
    const r = scanSource(
      fixture({
        "engine.ts": [
          'export const engine = "webgl-v1";',
          'export type Old = "jsapi-v3";',
        ].join("\n"),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("engine.ts:1");
    expect(r.output).toContain("engine.ts:2");
    expect(r.output).toContain("[removed-engine-id]");
  });

  it("公共声明相位扫到 `BMapGL` 标识符即失败", () => {
    const r = scanDeclarations(
      fixture({ "index.d.ts": "export declare function read(): BMapGL.Point;\n" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.d.ts:1");
    expect(r.output).toContain("[legacy-namespace]");
  });

  it("无法解析的 .vue 明确报错退出，不按无违规静默放行", () => {
    const r = scanSource(fixture({ "Unclosed.vue": '<script setup lang="ts">\nconst x = 1\n' }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("unparsable input");
  });
});

describe("no-bmapgl gate：不得误伤官方 4.0 的别名与文档提及", () => {
  it("官方插件命名空间 `BMapGLLib` 与它的 CDN URL 不误报", () => {
    const r = scanSource(
      fixture({
        "builtins.ts": [
          "export const urls = {",
          '  trackAnimation: "https://mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js",',
          '  geoUtils: "https://mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js",',
          "};",
          "export const load = () => (window as any).BMapGLLib?.TrackAnimation;",
          "export const geo = () => (window as any).BMapGLLib?.GeoUtils;",
        ].join("\n"),
      }),
    );
    expectCleanAndScanned(r, 1, "BMapGLLib 官方插件命名空间");
  });

  it("注释与长文本里的 BMapGL 提及不误报（迁移说明必须能写出旧名字）", () => {
    const r = scanSource(
      fixture({
        "compat.ts": [
          "// 旧实现读的是 `BMap ?? BMapGL`，4.0 起只认 BMap",
          "/* 块注释里的 BMapGL 与 window.BMapGL */",
          'export const note = "脚本另外读 window.BMapGL || window.BMap 并尝试继承 Overlay。";',
          'export const legacyTypePath = "types/BMapGL/lib.d.ts";',
          "export const half = 4 / 2;",
        ].join("\n"),
      }),
    );
    expectCleanAndScanned(r, 1, "注释与长文本里的提及");
  });

  it("官方 4.0 的 `BMap` 用法不受本门禁限制（那是 raw SDK 门禁的职责）", () => {
    const r = scanSource(
      fixture({
        "driver.ts": [
          'export const create = () => new BMap.Map("c");',
          "export const read = () => (globalThis as { BMap?: unknown }).BMap;",
        ].join("\n"),
      }),
    );
    expectCleanAndScanned(r, 1, "官方 BMap 用法");
  });

  it("公共声明相位只认 .d.ts：同目录里含违规的 .mjs 不参与判定", () => {
    const r = scanDeclarations(
      fixture({
        // 这个文件**确实**含旧引擎痕迹；如果相位范围写错（把 .mjs 也收进来）就会失败
        "index.mjs": 'export const sdk = window.BMapGL;\nexport const engine = "webgl-v1";\n',
        // 这个文件必须被扫到（作为非空守卫）
        "index.d.ts": "export declare const version: string;\n",
      }),
    );
    expectCleanAndScanned(r, 1, "公共声明相位只收 .d.ts");
    expect(scannedCount(r.output), "只应扫到 index.d.ts 一个文件").toBe(1);
  });
});

describe("no-bmapgl gate：真实仓库上的不变量", () => {
  it("本库运行时源码树无旧引擎痕迹（且真的扫到了文件）", () => {
    const r = scanSource(RUNTIME_SRC);
    expectCleanAndScanned(r, 100, "运行时源码树");
  });

  it("旧引擎的三处产物都不在仓库里：webgl-v1 / types/BMapGL / fake-bmapgl", () => {
    // 先证明路径拼法确实能命中真实存在的文件——否则三个 not-exist 断言也可能只是路径写错
    expect(existsSync(resolve(RUNTIME_SRC, "plugins/compat-inventory.ts"))).toBe(true);
    expect(existsSync(resolve(RUNTIME_SRC, "driver/webgl-v1"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/baidu-map-gl-vue/types/BMapGL"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/test-utils/fake-bmapgl"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/test-utils/lifecycle-inspector"))).toBe(false);
  });
});

describe("no-bmapgl gate：真的接进了 CI 与 npm scripts", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("package.json 暴露 check:no-bmapgl 且指向本脚本", () => {
    expect(pkg.scripts["check:no-bmapgl"]).toBeDefined();
    expect(pkg.scripts["check:no-bmapgl"]).toContain("scripts/check-no-bmapgl.mts");
  });

  it("step 区块切分只取目标 step（切空即判定失败，防止恒真）", () => {
    const text = [
      "      - name: A",
      "        run: echo a",
      "      - name: B",
      "        run: echo b",
    ].join("\n");
    const block = stepBlockContaining(text, "echo b");
    expect(block.length).toBeGreaterThan(0);
    expect(block.join("\n")).not.toContain("echo a");
  });

  it("quality.yml 真的跑了这条门禁，且没有被 continue-on-error / if 架空", () => {
    const text = readWorkflow("quality.yml");
    const block = stepBlockContaining(text, "pnpm check:no-bmapgl");
    expect(block.length, "quality.yml 里找不到跑 check:no-bmapgl 的 step").toBeGreaterThan(0);
    const body = block.join("\n");
    expect(body).toMatch(/^\s*run:/m);
    expect(body).not.toContain("continue-on-error");
    expect(body).not.toMatch(/^\s*if:/m);
  });
});
