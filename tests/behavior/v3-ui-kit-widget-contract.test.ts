/**
 * `src/integrations/ui-kit/types.ts` 的结构化接口 vs 官方发布声明的**逐成员契约**
 * （R25-D / issue #73）
 *
 * 为什么需要单独一条：本仓库构建期**刻意不消费**官方 UI Kit 的类型入口
 * （它带的 `/// <reference types="bmapgl-browser" />` 在 `skipLibCheck: false` 下直接报
 * TS2688 / TS2833，处置理由与取舍见 `packages/baidu-map-gl-vue/types/ui-kit/upstream.d.ts`）。
 * 于是 `UiKitAutocompleteWidget` / `UiKitSearchWidget` 这两个「我们自以为上游长这样」的接口
 * 失去了编译器背书 —— 一旦成员名写错、签名放宽，只有真机上才会发现。
 *
 * 这里用 TypeScript 编译器 API 把这个背书补回来，但**只在测试进程内**：
 * 拿官方声明当真值，断言「真实实例可赋值给我们的接口」。
 * 三个用例构成一对正证守卫：
 * - 真值检查必须 0 诊断；
 * - 反证一：接口签名放宽（`setTypes(types: string)`）必须被抓到；
 * - 反证二：接口多声明了上游没有的成员必须被抓到。
 * 没有后两条，「0 诊断」可能只是因为整个检查没跑起来。
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const virtualFile = join(repoRoot, "tests/__ui-kit-widget-contract__.ts");
/** 相对虚拟文件的类型模块路径（平台无关，不写绝对路径）。 */
const typesModule = "../packages/baidu-map-gl-vue/src/integrations/ui-kit/types";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  // 官方声明文件自身的类型引用缺陷不参与判定：这里只关心「成员形状」。
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
  baseUrl: repoRoot,
  types: [],
};

interface DiagnosticLine {
  file: string;
  code: number;
  message: string;
}

/** 用一次性 Program 编译一段虚拟源码，返回结构化诊断。 */
function diagnose(source: string): DiagnosticLine[] {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => (resolve(file) === virtualFile ? source : readFile(file));
  host.fileExists = (file) => (resolve(file) === virtualFile ? true : fileExists(file));
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram([virtualFile], COMPILER_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    file: diagnostic.file ? relative(repoRoot, diagnostic.file.fileName) : "<global>",
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  }));
}

function format(diagnostics: DiagnosticLine[]): string {
  return diagnostics.map((item) => `${item.file} TS${item.code}: ${item.message}`).join("\n");
}

const REAL_IMPORTS = `
import type { PlaceAutocomplete as RealAutocomplete, PlaceSearch as RealSearch } from "@baidumap/jsapi-ui-kit";
import type { UiKitAutocompleteWidget, UiKitSearchWidget } from ${JSON.stringify(typesModule)};
declare const realAutocomplete: RealAutocomplete;
declare const realSearch: RealSearch;
`;

describe("结构化 widget 契约 vs 官方 .d.ts", () => {
  it("官方 PlaceAutocomplete / PlaceSearch 实例满足我们的结构化接口", () => {
    const diagnostics = diagnose(
      `${REAL_IMPORTS}
export const autocomplete: UiKitAutocompleteWidget = realAutocomplete;
export const search: UiKitSearchWidget = realSearch;
`,
    );
    expect(
      diagnostics,
      `结构化接口与官方声明不一致（改 types.ts 或上游升级后先更新契约）：\n${format(diagnostics)}`,
    ).toEqual([]);
  });

  it("反证：接口把 setTypes 放宽成 string 时必须被抓到", () => {
    const diagnostics = diagnose(
      `${REAL_IMPORTS}
type Relaxed = { setTypes(types: string): void };
export const relaxed: Relaxed = realAutocomplete;
`,
    );
    expect(diagnostics.length, "检查器没有生效：放宽签名竟然通过了").toBeGreaterThan(0);
    expect(format(diagnostics)).toContain("setTypes");
  });

  it("反证：接口声明了上游没有的成员时必须被抓到", () => {
    const diagnostics = diagnose(
      `${REAL_IMPORTS}
type Invented = UiKitSearchWidget & { searchByKeyword(keyword: string): Promise<void> };
export const invented: Invented = realSearch;
`,
    );
    expect(diagnostics.length, "检查器没有生效：凭空多出的成员竟然通过了").toBeGreaterThan(0);
    expect(format(diagnostics)).toContain("searchByKeyword");
  });
});

/**
 * 事件载荷形状锁（R25-D 评审后补，issue #73）
 *
 * 起因：上一版把 `highlight` 的载荷按 `{ index, value }` 投影，而上游真实载荷是
 * `{ from: HighlightItem | null, to: HighlightItem }`；夹具照抄了同一个错误假设，
 * 于是「事件在真实运行时被静默丢弃」也能全绿。
 *
 * 这里把**我们依赖的载荷形状**钉在发布产物的实现上（版本精确锁定、integrity 已记录在
 * 契约页）。上游换版本或改形状时它会先红，逼我们回来重新核对，而不是让夹具继续自证。
 * 字段断言尽量从产物里**动态发现**（例如 POI 投影函数是被压缩过的名字），只把语义写死。
 */
const UI_KIT_ESM = join(
  repoRoot,
  "node_modules",
  "@baidumap",
  "jsapi-ui-kit",
  "dist",
  "jsapi-ui-kit.esm.js",
);

describe("事件载荷形状锁定在上游实现", () => {
  const code = readFileSync(UI_KIT_ESM, "utf8");

  it("PlaceAutocomplete.highlight 是 `{ from, to }` 变更对", () => {
    // 只有一个 emit 点，锚点才无歧义。
    expect(code.split('emit("highlight"').length - 1, "highlight 有多个 emit 点，需要重新核对").toBe(1);
    const anchor = code.indexOf('emit("highlight", { from:');
    expect(anchor, "highlight 载荷不再是 from/to 变更对？").toBeGreaterThan(-1);

    // 只在 emit 附近的窗口里断言端点形状：全文件搜索会在上游把该表达式挪到别处时静默通过。
    const around = code.slice(Math.max(0, anchor - 400), anchor + 200);
    expect(around, "highlight 端点不再是 { index, value }").toMatch(/\{\s*index:\s*/);
    expect(around, "highlight 端点的 value 不再由 toEventSuggestion 投影").toContain(
      "value: this.toEventSuggestion(",
    );
  });

  it("PlaceAutocomplete.suggest 是数组载荷，条目字段含 deprecated 的 street 别名", () => {
    expect(code).toContain('this.emit("suggest",');
    const projection = code.match(/toEventSuggestion\(t\)\s*\{[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(projection, "找不到 toEventSuggestion 的投影体，上游实现变了").toBeTruthy();
    for (const field of ["province", "city", "district", "name", "business", "address", "point", "uid"]) {
      expect(projection, `toEventSuggestion() 缺字段 ${field}`).toContain(`${field}:`);
    }
    // 上游为兼容旧版把 `street` 设成与 `name` 相同 —— 我们的 DTO 刻意不转发它。
    expect(projection).toContain("street:");
  });

  it("PlaceSearch.load 是 POI 数组、select 是单条 POI（可能为 undefined）", () => {
    expect(code).toMatch(/emit\("load",\s*[\w.$]+\.map\(/);
    expect(code).toMatch(/emit\("select",\s*[\w.$]+\s*\?\s*[\w.$]+\([\w.$]+\)\s*:\s*void 0\)/);
  });

  it("POI 投影函数的字段集合与我们的 PlacePoiDTO 一致", () => {
    // 投影函数名在产物里是被压缩过的，因此从 select 的调用点动态取名字，不写死。
    const name = code.match(/emit\("select",\s*[\w.$]+\s*\?\s*([\w$]+)\(/)?.[1];
    expect(name, "取不到 POI 投影函数名，上游实现变了").toBeTruthy();
    const body = new RegExp(`function ${name}\\(([^)]*)\\)\\s*\\{[\\s\\S]*?\\n\\}`).exec(code)?.[0] ?? "";
    expect(body, `找不到 ${name}() 的实现`).toBeTruthy();
    for (const field of ["title", "address", "uid", "point", "tel"]) {
      expect(body, `${name}() 缺字段 ${field}`).toContain(`${field}:`);
    }
  });
});
