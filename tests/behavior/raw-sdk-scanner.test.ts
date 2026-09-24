/**
 * raw SDK 扫描门禁自测
 *
 * 覆盖词法歧义回归（AST 解析应从根因上消除）:
 * - 正向:正则字面量/控制语句后的真实 SDK 访问必须被拦截,含 `.vue` SFC 与 `window["BMapGL"]`
 * - 负向:注释、正则、普通字符串中的 BMapGL 不得误报,干净目录必须放行
 *
 * 另覆盖 v4 边界（issue #15 / M3A0-03）：
 * - `window.BMap` / `globalThis.BMap` / `new BMap.*` / `BMap.*` 类型位置 / 官方类型包导入
 * - 组件导出名 `BMap` 不得误报
 * - `--src` 模式的目录白名单（driver/client/core-loader/plugins 放行）
 *
 * 第三块覆盖「旧引擎残留」规则集（issue #26；#136 起从独立的 `check-no-bmapgl.mts` 并入本门禁）。
 * 这块的失效方式有三种，**每种都会静默放行**，因此各配正反例：
 *
 * 1. **判定式写歪 / 扫错对象** → 负向断言恒真。用「历史上真含旧引擎痕迹」的形状喂进 fixture
 *    （`window.BMapGL`、`new BMapGL.Map()`、`namespace BMapGL`、`"webgl-v1"`），要求逐条命中。
 *    其中**最有判别力**的一条是 `namespace BMapGL` 出现在 `--src` 的**白名单路径**里——合并前
 *    `--src` 对白名单目录是 `skip` 的，只有独立的 `check:no-bmapgl` 抓得到；合并后如果分派写错，
 *    这条会立刻假绿。
 * 2. **判定对象错位（误伤）** → 把注释、长文本里的提及、以及**官方 4.0 时代仍在用的插件
 *    命名空间 `BMapGLLib`** 判成「回退旧引擎」。这类误伤会逼出「为了过门禁而改注释」的
 *    本末倒置，所以也要逐条钉住。
 * 3. **夹具/范围写错导致空转** → 一个文件都没扫到时也会「通过」。脚本自身对每个相位做
 *    fail-closed（`扫描范围为空` 直接判失败），用例侧再用 `expectCleanAndScanned()` 断言该相位
 *    **真的扫到了文件**——后者保证「这条用例测的相位确实被测到了」，不能替代前者。
 *
 * 最后一节把门禁接回仓库：真实仓库不变量，以及两个模式真的被 workflow 的 `run:` 跑起来、
 * 没有被 `if:` / `continue-on-error:` 架空。
 */
import { afterEach, describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { boundarySummary, isRawSdkAllowedPath } from "../../scripts/raw-sdk-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-raw-sdk.mts");
const RUNTIME_SRC = resolve(ROOT, "packages/bmap-vue/src");
/** `--declarations` 相位的 label（与脚本的 Phase.label 一致；**不含空白**）。 */
const DECLARATIONS_LABEL = "public-declarations";
/** 显式 `--src` 树模式的相位 label。 */
const SRC_TREE_LABEL = "src-tree";

interface ScanResult {
  code: number;
  output: string;
}

function runScanner(args: string[]): ScanResult {
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

function scanDir(dir: string): ScanResult {
  return runScanner(["--dir", dir]);
}

const scanSrcTree = (dir: string): ScanResult => runScanner(["--src", dir]);
const scanDeclarations = (dir: string): ScanResult => runScanner(["--declarations", dir]);

const fixtureDirs: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "raw-sdk-scan-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  fixtureDirs.push(dir);
  return dir;
}

// 临时目录统一在每条用例之后清理：用例中途失败也不会留下 /tmp 垃圾。
afterEach(() => {
  while (fixtureDirs.length > 0) rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
});

/**
 * 解析输出里的**逐相位**扫描数（`<label>=<dir>:<N> 个文件`）。
 *
 * 逐相位是刻意的：合并成一个总数后，「某一相位扫到 0 个」会被另一相位的读数掩盖。
 */
function phaseScans(output: string): Record<string, number> {
  const found: Record<string, number> = {};
  // 排除 `(`：成功行把逐相位读数放在圆括号里（`… are clean. (label=dir:N 个文件)`），
  // 不排除的话 label 会被连同前导括号一起捕获成 `(label`，用例会因 label 对不上而假红。
  for (const match of output.matchAll(/([^\s,，()（）=]+)=([^\s,:（）]+):(\d+) 个文件/g)) {
    found[match[1]!] = Number(match[3]!);
  }
  return found;
}

/**
 * 断言「该相位放行」**且确实扫到了内容**。
 *
 * 这不替代脚本自身的 fail-closed（它已经会失败），而是保证这条用例真的测到了它声称要测的
 * 相位——夹具写错路径时，用例会因 `phaseScans` 里没有这个 label 而立刻红，而不是静默通过。
 */
function expectCleanAndScanned(result: ScanResult, label: string, atLeast = 1): void {
  expect(result.code, result.output).toBe(0);
  const scanned = phaseScans(result.output)[label];
  expect(scanned, `${label} 没有扫到文件（夹具写错路径？）\n${result.output}`).toBeGreaterThanOrEqual(
    atLeast,
  );
}

describe("check-raw-sdk scanner", () => {
  it("正则字面量后的真实 SDK 访问被拦截(PR #47 首轮审查样例)", () => {
    const dir = makeFixture({
      "repro.ts": "const punctuation = /[/*]/;\nconst sdk = window.BMapGL;\n",
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("window.BMapGL");
  });

  it("`/[//]/` 同行之后的 SDK 访问被拦截", () => {
    const dir = makeFixture({
      "inline.ts": "const re = /[//]+/; const sdk = window.BMapGL;\n",
    });
    expect(scanDir(dir).code).toBe(1);
  });

  it("if/while/for 条件后的正则不再吞掉后续 SDK 访问(PR #47 复审样例)", () => {
    const dir = makeFixture({
      "ifcase.ts": 'if (true) /[/*]/.test("x");\nconst sdk = window.BMapGL;\n',
      "ifinline.ts": 'if (true) /[//]+/.test("x"); const sdk = window.BMapGL;\n',
      "whilecase.ts": 'while (false) /[/*]/.test("x");\nconst sdk = globalThis.BMapGL;\n',
      "forcase.ts": "for (let i = 0; i < 1; i++) /[/*]/.test(\"x\");\nconst sdk = new BMapGL.Map();\n",
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("ifcase.ts:2");
    expect(r.output).toContain("ifinline.ts:1");
    expect(r.output).toContain("whilecase.ts:2");
    expect(r.output).toContain("forcase.ts:2");
  });

  it(".vue 的 <script setup> 中控制语句后的 SDK 访问被拦截(行号映射回源文件)", () => {
    const dir = makeFixture({
      "Comp.vue": [
        '<script setup lang="ts">',
        'if (true) /[/*]/.test("x");',
        "const sdk = window.BMapGL;",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Comp\.vue:3/);
  });

  it("结束标签带空白(`</script >` / 标签名后换行)仍能提取脚本并拦截(PR #47 三审样例)", () => {
    const dir = makeFixture({
      "EndSpace.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMapGL;",
        "</script >",
        "<template><div/></template>",
      ].join("\n"),
      "EndNewline.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMapGL;",
        "</script",
        ">",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/EndSpace\.vue:2/);
    expect(r.output).toMatch(/EndNewline\.vue:2/);
  });

  it("起始标签 generic 属性值内的 `>` 不再截断脚本内容(同行脚本仍被拦截)", () => {
    const dir = makeFixture({
      "Generic.vue": [
        '<script setup lang="ts" generic="T extends Record<string, unknown>">const sdk = window.BMapGL;',
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Generic\.vue:1/);
  });

  it("HTML 注释中的脚本示例不误报(官方 SFC 解析忽略注释)", () => {
    const dir = makeFixture({
      "Comment.vue": [
        '<script setup lang="ts">',
        "const ok = 1;",
        "</script>",
        "<template>",
        "  <!-- <script>const sdk = window.BMapGL;</script> -->",
        "  <div/>",
        "</template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("无法解析的 SFC 明确报错退出,不按无违规静默放行", () => {
    const dir = makeFixture({
      "Unclosed.vue": '<script setup lang="ts">\nconst sdk = 1\n',
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("unparsable input");
    expect(r.output).toContain("Unclosed.vue");
  });

  it("window['BMapGL'] 动态访问按越界拦截", () => {
    const dir = makeFixture({ "dynamic.ts": 'const sdk = window["BMapGL"];\n' });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('window["BMapGL"]');
  });

  it("注释、正则与普通字符串中的 BMapGL 不误报,干净代码放行", () => {
    const dir = makeFixture({
      "clean.ts": [
        "// 文档注释提及 window.BMapGL",
        "/* 块注释里的 BMapGL */",
        'const msg = "resolving global BMapGL fallback";',
        "const re = /[/*]+/;",
        'if (true) /[//]+/.test("x");',
        "const half = total / 2;",
        "const word = a / b;",
        "export const x = 1;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("报错行号与源文件行号一致(不因解析偏移漂移)", () => {
    const dir = makeFixture({
      "lines.ts": [
        "/*",
        " * 跨行块注释",
        " */",
        "const ok = /[/*]/;",
        "",
        "const leak = window.BMapGL;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/lines\.ts:6/);
  });
});

describe("check-raw-sdk: JSAPI 4.0 `BMap` 边界（issue #15）", () => {
  it("拦截 window.BMap / globalThis.BMap / window[\"BMap\"]", () => {
    const dir = makeFixture({
      "globals.ts": [
        "const a = window.BMap;",
        "const b = globalThis.BMap;",
        "const c = self.BMap;",
        'const d = window["BMap"];',
        "const e = (window as unknown as { BMap: unknown }).BMap;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("globals.ts:1");
    expect(r.output).toContain("globals.ts:2");
    expect(r.output).toContain("globals.ts:3");
    expect(r.output).toContain("globals.ts:4");
    expect(r.output).toContain("globals.ts:5");
    expect(r.output).toContain("[global-member]");
  });

  it("拦截 new BMap.*、BMap.* 成员访问与 BMap 类型位置", () => {
    const dir = makeFixture({
      "map.ts": [
        'const map = new BMap.Map("container");',
        "const M = BMap.Marker;",
        "const p: BMap.Point = { lng: 1, lat: 2 };",
        "type Opts = BMap.MapOptions;",
        "let probe: typeof BMap;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("map.ts:1");
    expect(r.output).toContain("map.ts:2");
    expect(r.output).toContain("map.ts:3");
    expect(r.output).toContain("map.ts:4");
    expect(r.output).toContain("map.ts:5");
    expect(r.output).toMatch(/\[(namespace-root|type-position)\]/);
  });

  it("拦截 authority 声明与官方类型包具名导入", () => {
    const dir = makeFixture({
      "decl.ts": "declare global { namespace BMap { interface X {} } }\nexport {};\n",
      "import.ts": 'import type { Map } from "@baidumap/jsapi-v4-types";\n',
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("[namespace-declaration]");
    expect(r.output).toContain("[official-types-import]");
  });

  it("组件导出名 / 字符串 / 对象键为 `BMap` 时不误报", () => {
    const dir = makeFixture({
      "index.ts": [
        'export { default as BMap } from "./map/BMap.vue";',
        'export const componentName = "BMap";',
        "const registry = { BMap: 1 };",
        "export type Props = { BMapProps: undefined };",
      ].join("\n"),
      "Comp.vue": [
        '<script setup lang="ts">',
        'defineOptions({ name: "BMap" });',
        "const label = \"<BMap> root required\";",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
  });

  it("--src 模式按目录白名单放行 driver/client/core-loader/plugins", () => {
    const dir = makeFixture({
      "driver/jsapi-v4/map.ts": 'export const create = () => new BMap.Map("c");\n',
      "core/loader/providers/official.ts":
        "export const get = () => (globalThis as { BMap?: unknown }).BMap;\n",
      "components/Leak.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMap;",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = scanSrcTree(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/components\/Leak\.vue:2/);
    // 白名单目录**不产生 BMap.* 越界**（提示文案里的路径不算）；旧引擎残留是另一套规则，
    // 单独在下面的 describe 里钉死。
    expect(r.output).not.toMatch(/driver\/jsapi-v4\/map\.ts:\d/);
    expect(r.output).not.toMatch(/core\/loader\/providers\/official\.ts:\d/);
  });

  it("--print-boundary 输出结构化边界配置", () => {
    const r = runScanner(["--print-boundary"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.output) as ReturnType<typeof boundarySummary>;
    expect(parsed.namespaces).toEqual(["BMap", "BMapGL"]);
    expect(parsed.allowedPatterns).toContain("driver/**");
    expect(parsed.officialTypesPackage).toBe("@baidumap/jsapi-v4-types");
    // 新增的官方包薄封装目录（issue #73）与组件同属禁区：默认扫描必须覆盖它，
    // 否则「本地只跑 check:raw-sdk」会漏掉整棵 integrations。
    expect(parsed.forbiddenSrcDirs).toContain("integrations");
  });

  it("白名单匹配器只放行既定边界", () => {
    expect(isRawSdkAllowedPath("driver/jsapi-v4/map.ts")).toBe(true);
    expect(isRawSdkAllowedPath("core/loader/Provider.ts")).toBe(true);
    expect(isRawSdkAllowedPath("client/createBMapClient.ts")).toBe(true);
    expect(isRawSdkAllowedPath("plugins/builtins.ts")).toBe(true);
    expect(isRawSdkAllowedPath("components/map/Map.vue")).toBe(false);
    expect(isRawSdkAllowedPath("composables/useMap.ts")).toBe(false);
    expect(isRawSdkAllowedPath("core/runtime/MapRuntime.ts")).toBe(false);
    expect(isRawSdkAllowedPath("integrations/ui-kit/loadUiKit.ts")).toBe(false);
  });
});

/**
 * 评审 F1 回归：接收者只做「直接父节点」判断时，加括号 / 类型断言 / 方括号访问
 * 这类等价写法可以完整绕过门禁。此处按等价写法逐条钉死。
 */
describe("check-raw-sdk: `BMap` 等价写法不得绕过（评审 F1）", () => {
  it("加括号 / as 断言 / 方括号访问的值位置全部拦截", () => {
    const dir = makeFixture({
      "bypass.ts": [
        "new BMap.Point(116, 39);",
        "new (BMap).Point(116, 39);",
        "new (BMap as any).Point(116, 39);",
        "new BMap[\"Point\"](116, 39);",
        "const M = (BMap as unknown as { Map: unknown }).Map;",
        "const N = ((BMap))[\"Marker\"];",
        "BMap[\"Map\"](\"container\");",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    for (const line of [1, 2, 3, 4, 5, 6, 7]) {
      expect(r.output, `第 ${line} 行应被拦截`).toContain(`bypass.ts:${line}`);
    }
    expect(r.output).toContain("[namespace-root]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("括号 / 断言的类型位置（方括号索引类型）同样拦截", () => {
    const dir = makeFixture({
      "bypass-type.ts": [
        "type A = BMap[\"Point\"];",
        "type B = (BMap)['MapOptions'];",
        "let probe: typeof BMap;",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("bypass-type.ts:1");
    expect(r.output).toContain("bypass-type.ts:2");
    expect(r.output).toContain("bypass-type.ts:3");
    rmSync(dir, { recursive: true, force: true });
  });

  it("SFC 脚本中的括号写法被拦截，行号映射回源文件", () => {
    const dir = makeFixture({
      "Comp.vue": [
        '<script setup lang="ts">',
        "const a = 1;",
        "const map = new (BMap as any).Point(116, 39);",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
      "Other.vue": [
        '<script lang="ts">',
        'export default { setup() { return new (BMap)["Map"]("c"); } };',
        "</script>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/Comp\.vue:3/);
    expect(r.output).toMatch(/Other\.vue:2/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("把 `BMap` 当组件值使用时仍然放行（与 SDK 命名空间区分）", () => {
    const dir = makeFixture({
      "comp.ts": [
        'import { h } from "vue";',
        'import BMap from "./map/BMap.vue";',
        "export const el = () => h(BMap);",
        "export { BMap };",
        "export const components = { BMap };",
        "export const registry = { BMap: BMap };",
        "export const comps = { key: 'BMap', BMap };",
      ].join("\n"),
      "Comp.vue": [
        '<script setup lang="ts">',
        'import BMap from "./BMap.vue";',
        "const props = {};",
        "</script>",
        "<template><BMap v-bind=\"props\"/></template>",
      ].join("\n"),
    });
    const r = scanDir(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("scan OK");
    rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * 「旧引擎残留」规则集（issue #26；#136 起从独立的 `check-no-bmapgl.mts` 并入本门禁）。
 *
 * 这套规则的适用范围与边界规则**不同**：白名单目录允许 `BMap.*`（那是它们存在的理由），
 * 但整棵源码树（含白名单）**与**公共声明都不允许 `BMapGL`。
 */
describe("check-raw-sdk: 旧引擎残留必须被抓到（#26 / #136）", () => {
  it("`window.BMapGL` / `globalThis.BMapGL` 全局访问被拦截", () => {
    const r = scanDir(
      makeFixture({
        "global.ts": "const sdk = window.BMapGL;\nconst other = globalThis.BMapGL;\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("global.ts:1");
    expect(r.output).toContain("global.ts:2");
    expect(r.output).toContain("[legacy-namespace]");
  });

  it("`new BMapGL.*` / 类型位置 / 动态键都被拦截", () => {
    const r = scanDir(
      makeFixture({
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
    const r = scanDir(
      makeFixture({
        "ambient.d.ts": "declare namespace BMapGL {\n  interface Map {}\n}\nexport {};\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("[legacy-namespace]");
  });

  it("已删除的 engine 取值 `webgl-v1` / `jsapi-v3` 在 --src 的**禁区路径**里被拦截", () => {
    // engine 取值字面量只归「旧引擎残留」规则集管，而 `--dir` 跑的是边界规则集（快档，不含它）。
    // 覆盖运行时源码整树的唯一口径是 `--src`：禁区内跑全套、白名单内跑旧引擎残留。
    const r = scanSrcTree(
      makeFixture({
        "components/engine.ts": [
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
      makeFixture({ "index.d.ts": "export declare function read(): BMapGL.Point;\n" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.d.ts:1");
    expect(r.output).toContain("[legacy-namespace]");
  });

  it("公共声明相位扫到已删除的 engine 取值即失败（`check-public-dts` 不管这条）", () => {
    // `check-public-dts.mts` 只禁 `BMap.*` / `BMapGL` / 官方类型包引用，**不**禁 engine 取值
    // 字面量——发布产物上的这条覆盖是本相位存在的唯一理由。
    const r = scanDeclarations(
      makeFixture({ "index.d.ts": 'export declare const engine: "webgl-v1";\n' }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.d.ts:1");
    expect(r.output).toContain("[removed-engine-id]");
  });

  /**
   * 合并前这条覆盖是 `check-no-bmapgl.mts` **独家**的：`--src` 树模式对白名单目录是 `skip` 的。
   * 合并后若分派写错（例如把白名单目录也塞给边界规则、或干脆漏扫），这条会立刻假绿。
   */
  it("`namespace BMapGL` 出现在 --src 的**白名单路径**里仍被拦截（Trap 1 的直接反证）", () => {
    const r = scanSrcTree(
      makeFixture({
        "driver/jsapi-v4/legacy.ts":
          "export namespace BMapGL { interface Map {} }\nexport const e: 'jsapi-v3' = 'jsapi-v3';\n",
        "core/loader/legacy.ts": 'export const sdk = window["BMapGL"];\n',
        "plugins/legacy.ts": 'export const id = "webgl-v1";\n',
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/driver\/jsapi-v4\/legacy\.ts:1/);
    expect(r.output).toMatch(/core\/loader\/legacy\.ts:1/);
    expect(r.output).toMatch(/plugins\/legacy\.ts:1/);
    expect(r.output).toContain("[legacy-namespace]");
    expect(r.output).toContain("[removed-engine-id]");
  });
});

describe("check-raw-sdk: 旧引擎残留不得误伤（#26 / #136）", () => {
  it("官方插件命名空间 `BMapGLLib` 与它的 CDN URL 不误报", () => {
    // `BMapGLLib` 是**单个标识符**（`node.text === "BMapGLLib"`），与 `"BMapGL"` 精确不等；
    // CDN URL 是整串字面量，也不等。规则全程无 prefix/contains 判定，所以天然不命中。
    const r = scanDir(
      makeFixture({
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
    expect(r.code, r.output).toBe(0);
  });

  it("注释与长文本里的 BMapGL 提及不误报（ADR 必须能写出旧名字）", () => {
    const r = scanDir(
      makeFixture({
        "compat.ts": [
          "// 旧实现读的是 `BMap ?? BMapGL`，4.0 起只认 BMap",
          "/* 块注释里的 BMapGL 与 window.BMapGL */",
          'export const note = "脚本另外读 window.BMapGL || window.BMap 并尝试继承 Overlay。";',
          'export const legacyTypePath = "types/BMapGL/lib.d.ts";',
          "export const half = 4 / 2;",
        ].join("\n"),
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("官方 4.0 的 `BMap` 用法在 --src 白名单里不受旧引擎残留规则限制", () => {
    const r = scanSrcTree(
      makeFixture({
        "driver/jsapi-v4/map.ts": 'export const create = () => new BMap.Map("c");\n',
        "client/create.ts": "export const read = () => (globalThis as { BMap?: unknown }).BMap;\n",
        "plugins/builtins.ts": "export const lib = () => (globalThis as any).BMapGLLib;\n",
      }),
    );
    expectCleanAndScanned(r, SRC_TREE_LABEL, 3);
  });

  it("公共声明相位只认 .d.ts：同目录里含违规的 .mjs 不参与判定", () => {
    const r = scanDeclarations(
      makeFixture({
        // 这个文件**确实**含旧引擎痕迹；如果相位范围写错（把 .mjs 也收进来）就会失败
        "index.mjs": 'export const sdk = window.BMapGL;\nexport const engine = "webgl-v1";\n',
        // 这个文件必须被扫到（作为非空守卫）
        "index.d.ts": "export declare const version: string;\n",
      }),
    );
    expectCleanAndScanned(r, DECLARATIONS_LABEL, 1);
    expect(phaseScans(r.output)[DECLARATIONS_LABEL], "只应扫到 index.d.ts 一个文件").toBe(1);
  });
});

describe("check-raw-sdk: 扫描范围为空必须失败（fail-closed）", () => {
  it("`--dir` 指向空目录时判失败，而不是输出 OK", () => {
    const r = scanDir(makeFixture({}));
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("扫描范围为空");
    expect(r.output).not.toContain("scan OK");
  });

  it("`--dir` 下只有测试文件（被整体跳过）时同样判失败", () => {
    // 真实场景：目录配成了「只剩 co-located 单测」的那种树，门禁会一个文件都扫不到
    const r = scanDir(makeFixture({ "only.test.ts": "const sdk = window.BMapGL;\n" }));
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("扫描范围为空");
  });

  it("公共声明相位一个 `.d.ts` 都没有时判失败（不是「干净」）", () => {
    const r = scanDeclarations(makeFixture({ "index.mjs": 'export const engine = "webgl-v1";\n' }));
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("扫描范围为空");
    expect(r.output).toContain(DECLARATIONS_LABEL);
  });

  it("同目录补上一个 `.d.ts` 后放行，且报告里逐相位给出扫描数（对照）", () => {
    const r = scanDeclarations(
      makeFixture({
        "index.mjs": 'export const engine = "webgl-v1";\n',
        "index.d.ts": "export declare const version: string;\n",
      }),
    );
    expectCleanAndScanned(r, DECLARATIONS_LABEL, 1);
    expect(phaseScans(r.output)[DECLARATIONS_LABEL], "只应扫到 index.d.ts 一个文件").toBe(1);
  });
});

describe("check-raw-sdk: 真实仓库上的不变量（#26 / #136）", () => {
  it("本库运行时源码树无旧引擎痕迹（--src 树模式，整棵树都被扫到）", () => {
    // `--src` 是唯一能同时覆盖「禁区内跑全套 + 白名单内跑旧引擎残留」的口径：
    // 显式 `--dir` 会把整棵树当禁区、只跑边界规则，抓不到白名单目录里的旧引擎残留。
    const r = scanSrcTree(RUNTIME_SRC);
    expectCleanAndScanned(r, SRC_TREE_LABEL, 100);
  });

  it("旧引擎的三处产物都不在仓库里：webgl-v1 / types/BMapGL / fake-bmapgl", () => {
    // 先证明路径拼法确实能命中真实存在的文件——否则三个 not-exist 断言也可能只是路径写错
    expect(existsSync(resolve(RUNTIME_SRC, "plugins/compat-inventory.ts"))).toBe(true);
    expect(existsSync(resolve(RUNTIME_SRC, "driver/webgl-v1"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/bmap-vue/types/BMapGL"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/test-utils/fake-bmapgl"))).toBe(false);
    expect(existsSync(resolve(ROOT, "packages/test-utils/lifecycle-inspector"))).toBe(false);
  });
});

describe("check-raw-sdk: 旧引擎残留真的接进了 CI 与 npm scripts（#136）", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("独立的 check:no-bmapgl 门禁已并入 check-raw-sdk，package.json 不再暴露它", () => {
    // #136：`check-no-bmapgl.mts` 整份删除。旧引擎残留由 `check:raw-sdk:tree`（白名单目录也跑）
    // 与 `check:raw-sdk:declarations`（发布产物）承担。
    expect(pkg.scripts["check:no-bmapgl"]).toBeUndefined();
    expect(pkg.scripts["check:raw-sdk:tree"]).toContain("scripts/check-raw-sdk.mts --src");
    expect(pkg.scripts["check:raw-sdk:declarations"]).toContain(
      "scripts/check-raw-sdk.mts --declarations",
    );
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

  it("quality.yml 真的跑了旧引擎残留的两个模式，且没有被 continue-on-error / if 架空", () => {
    const text = readWorkflow("quality.yml");
    for (const command of ["check-raw-sdk.mts --src", "check:raw-sdk:declarations"]) {
      const block = stepBlockContaining(text, command);
      expect(block.length, `quality.yml 里找不到跑 ${command} 的 step`).toBeGreaterThan(0);
      const body = block.join("\n");
      expect(body).toMatch(/^\s*run:/m);
      expect(body).not.toContain("continue-on-error");
      expect(body).not.toMatch(/^\s*if:/m);
    }
  });

  it("旧的 no-bmapgl step 与脚本本体都已从仓库里消失", () => {
    expect(existsSync(resolve(ROOT, "scripts/check-no-bmapgl.mts"))).toBe(false);
    expect(readWorkflow("quality.yml")).not.toContain("check:no-bmapgl");
  });
});
