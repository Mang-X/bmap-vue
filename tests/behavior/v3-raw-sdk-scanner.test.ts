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
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { boundarySummary, isRawSdkAllowedPath } from "../../scripts/raw-sdk-boundary.mts";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/check-raw-sdk.mts");

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

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "raw-sdk-scan-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
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
      "core/loader/providers/official.ts": "export const get = () => (window as any).BMapGL;\n",
      "components/Leak.vue": [
        '<script setup lang="ts">',
        "const sdk = window.BMap;",
        "</script>",
        "<template><div/></template>",
      ].join("\n"),
    });
    const r = runScanner(["--src", dir]);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/components\/Leak\.vue:2/);
    // 白名单目录不产生行号级违规（提示文案里的路径不算）
    expect(r.output).not.toMatch(/driver\/jsapi-v4\/map\.ts:\d/);
    expect(r.output).not.toMatch(/core\/loader\/providers\/official\.ts:\d/);
    rmSync(dir, { recursive: true, force: true });
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
    expect(isRawSdkAllowedPath("components/map/BMap.vue")).toBe(false);
    expect(isRawSdkAllowedPath("composables/useBMap.ts")).toBe(false);
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
