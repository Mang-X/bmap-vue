/**
 * no-bmapgl 门禁自测（M3A3-REMOVE-LEGACY / issue #26）
 *
 * 门禁的失效方式有两种，**两种都会静默放行**，因此各配正反例：
 *
 * 1. **判定式写歪 / 扫错对象** → 负向断言恒真。这里用「历史上真含旧引擎痕迹」的形状喂进
 *    fixture（`window.BMapGL`、`new BMapGL.Map()`、`namespace BMapGL`、`"webgl-v1"`），
 *    要求逐条命中并给出规则名。
 * 2. **判定对象错位（误伤）** → 把注释、长文本里的提及、以及**官方 4.0 时代仍在用的插件
 *    命名空间 `BMapGLLib`** 判成「回退旧引擎」。这类误伤会逼出「为了过门禁而改注释」的
 *    本末倒置，所以也要逐条钉住。
 *
 * 最后两节把门禁接回仓库：运行时源码树真的干净（且真的扫到了文件，不是空转），以及它真的
 * 被某个 workflow 的 `run:` 跑起来、没有被 `if:` / `continue-on-error:` 架空。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-no-bmapgl.mts");
const RUNTIME_SRC = resolve(ROOT, "packages/baidu-map-gl-vue/src");
const WORKFLOW_DIR = resolve(ROOT, ".github/workflows");

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

function makeFixture(files: Record<string, string>, prefix = "no-bmapgl-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const scanSource = (dir: string): ScanResult => runGate(["--dir", dir]);
const scanDeclarations = (dir: string): ScanResult => runGate(["--declarations", dir]);

/** 扫描范围里的文件数（成功输出里必须写出来，否则「干净」与「没扫」无法区分）。 */
function scannedCount(output: string): number {
  const match = /共扫 (\d+) 个文件/.exec(output);
  return match ? Number(match[1]) : -1;
}

describe("no-bmapgl gate：旧引擎痕迹必须被抓到", () => {
  it("`window.BMapGL` / `globalThis.BMapGL` 全局访问被拦截", () => {
    const dir = makeFixture({
      "global.ts": "const sdk = window.BMapGL;\nconst other = globalThis.BMapGL;\n",
    });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("global.ts:1");
    expect(r.output).toContain("global.ts:2");
    expect(r.output).toContain("[legacy-namespace]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("`new BMapGL.*` / 类型位置 / 动态键都被拦截", () => {
    const dir = makeFixture({
      "usage.ts": [
        'const map = new BMapGL.Map("c");',
        "let point: BMapGL.Point;",
        'const dyn = window["BMapGL"];',
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("usage.ts:1");
    expect(r.output).toContain("usage.ts:2");
    expect(r.output).toContain("usage.ts:3");
    rmSync(dir, { recursive: true, force: true });
  });

  it("`namespace BMapGL` 声明被拦截", () => {
    const dir = makeFixture({
      "ambient.d.ts": "declare namespace BMapGL {\n  interface Map {}\n}\nexport {};\n",
    });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("[legacy-namespace]");
    rmSync(dir, { recursive: true, force: true });
  });

  it(".vue 的 <script setup> 里的旧引擎访问被拦截，行号映射回源文件", () => {
    const dir = makeFixture({
      "Comp.vue": [
        '<script setup lang="ts">',
        "const ok = 1;",
        "const sdk = window.BMapGL;",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Comp\.vue:3/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("已删除的 engine 取值 `webgl-v1` / `jsapi-v3` 被拦截", () => {
    const dir = makeFixture({
      "engine.ts": [
        'export const engine = "webgl-v1";',
        'export type Old = "jsapi-v3";',
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("engine.ts:1");
    expect(r.output).toContain("engine.ts:2");
    expect(r.output).toContain("[removed-engine-id]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("公共声明相位扫到 `BMapGL` 标识符即失败", () => {
    const dir = makeFixture({
      "index.d.ts": "export declare function read(): BMapGL.Point;\n",
    });
    const r = scanDeclarations(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.d.ts:1");
    expect(r.output).toContain("[legacy-namespace]");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("no-bmapgl gate：不得误伤官方 4.0 的别名与文档提及", () => {
  it("官方插件命名空间 `BMapGLLib` 与它的 CDN URL 不误报", () => {
    const dir = makeFixture({
      "builtins.ts": [
        'export const urls = {',
        '  trackAnimation: "https://mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js",',
        '  geoUtils: "https://mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js",',
        '};',
        "export const load = () => (window as any).BMapGLLib?.TrackAnimation;",
        "export const geo = () => (window as any).BMapGLLib?.GeoUtils;",
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code, r.output).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("注释与长文本里的 BMapGL 提及不误报（迁移说明必须能写出旧名字）", () => {
    const dir = makeFixture({
      "compat.ts": [
        "// 旧实现读的是 `BMap ?? BMapGL`，4.0 起只认 BMap",
        "/* 块注释里的 BMapGL 与 window.BMapGL */",
        'export const note = "脚本另外读 window.BMapGL || window.BMap 并尝试继承 Overlay。";',
        'export const legacyTypePath = "types/BMapGL/lib.d.ts";',
        "export const half = 4 / 2;",
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code, r.output).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("官方 4.0 的 `BMap` 用法不受本门禁限制（那是 raw SDK 门禁的职责）", () => {
    const dir = makeFixture({
      "driver.ts": [
        'export const create = () => new BMap.Map("c");',
        "export const read = () => (globalThis as { BMap?: unknown }).BMap;",
      ].join("\n"),
    });
    const r = scanSource(dir);
    expect(r.code, r.output).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("公共声明相位只认 .d.ts：产物里的 .mjs 不参与判定", () => {
    const dir = makeFixture({
      "index.mjs": 'export const sdk = window.BMapGL;\nexport const engine = "webgl-v1";\n',
    });
    const r = scanDeclarations(dir);
    expect(r.code, r.output).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("无法解析的 .vue 明确报错退出，不按无违规静默放行", () => {
    const dir = makeFixture({ "Unclosed.vue": '<script setup lang="ts">\nconst x = 1\n' });
    const r = scanSource(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("unparsable input");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("no-bmapgl gate：真实仓库上的不变量", () => {
  it("本库运行时源码树无旧引擎痕迹（且真的扫到了文件）", () => {
    const r = scanSource(RUNTIME_SRC);
    expect(r.code, r.output).toBe(0);
    // 空转守卫：目录配错时 `scanned=0` 也会「通过」
    expect(scannedCount(r.output)).toBeGreaterThan(100);
  });

  it("运行时源码树里已不存在 webgl-v1 / types/BMapGL / fake-bmapgl 目录", () => {
    const r = scanSource(resolve(ROOT, "packages/baidu-map-gl-vue/src/driver"));
    expect(r.code, r.output).toBe(0);
    expect(() => readFileSync(resolve(RUNTIME_SRC, "driver/webgl-v1/createDriver.ts"))).toThrow();
  });
});

describe("no-bmapgl gate：真的接进了 CI 与 npm scripts", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  /** 取出包含某个字符串的 step 区块（从该 step 的 `- ` 行起到下一个同级 step 前）。 */
  function stepBlockContaining(text: string, needle: string): string[] {
    const lines = text.split(/\r?\n/);
    const hit = lines.findIndex((line) => line.includes(needle));
    if (hit === -1) return [];
    let start = -1;
    for (let i = hit; i >= 0; i -= 1) {
      if (/^\s*-\s/.test(lines[i]!)) {
        start = i;
        break;
      }
    }
    if (start === -1) return [];
    const itemIndent = /^(\s*)-\s/.exec(lines[start]!)![1]!.length;
    const block: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
      if (i > start) {
        const match = /^(\s*)-\s/.exec(lines[i]!);
        if (match && match[1]!.length === itemIndent) break;
      }
      block.push(lines[i]!);
    }
    return block;
  }

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
    const text = readFileSync(resolve(WORKFLOW_DIR, "quality.yml"), "utf8");
    const block = stepBlockContaining(text, "pnpm check:no-bmapgl");
    expect(block.length, "quality.yml 里找不到跑 check-no-bmapgl 的 step").toBeGreaterThan(0);
    const body = block.join("\n");
    expect(body).toMatch(/^\s*run:/m);
    expect(body).not.toContain("continue-on-error");
    expect(body).not.toMatch(/^\s*if:/m);
  });
});
