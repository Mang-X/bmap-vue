/**
 * `src/integrations/ui-kit/types.ts` 的结构化接口 vs 官方发布声明的**逐成员契约**
 * （R25-D / issue #73）
 *
 * 为什么需要单独一条：本仓库构建期**刻意不消费**官方 UI Kit 的类型入口
 * （它带的 `/// <reference types="bmapgl-browser" />` 在 `skipLibCheck: false` 下直接报
 * TS2688 / TS2833，处置理由与取舍见 `packages/bmap-vue/types/ui-kit/upstream.d.ts`）。
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
const pkgRoot = join(repoRoot, "packages/bmap-vue");
const virtualFile = join(repoRoot, "tests/__ui-kit-widget-contract__.ts");
/** 相对虚拟文件的类型模块路径（平台无关，不写绝对路径）。 */
const typesModule = "../packages/bmap-vue/src/integrations/ui-kit/types";
/** 桥模块路径（同样相对虚拟文件）。 */
const bridgeModule = "../packages/bmap-vue/src/integrations/ui-kit/useUiKitWidget";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  // 官方声明文件自身的类型引用缺陷不参与判定：这里只关心「成员形状」。
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2020.d.ts", "lib.es2022.error.d.ts", "lib.dom.d.ts"],
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
import type {
  PlaceAutocomplete as RealAutocomplete,
  PlaceSearch as RealSearch,
  PlaceDetail as RealDetail,
  RoutePlan as RealRoutePlan,
} from "@baidumap/jsapi-ui-kit";
import type {
  UiKitAutocompleteWidget,
  UiKitPlaceDetailWidget,
  UiKitRoutePlanWidget,
  UiKitSearchWidget,
} from ${JSON.stringify(typesModule)};
declare const realAutocomplete: RealAutocomplete;
declare const realSearch: RealSearch;
declare const realDetail: RealDetail;
declare const realRoutePlan: RealRoutePlan;
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

  it("官方 PlaceDetail / RoutePlan 实例满足我们的结构化接口", () => {
    const diagnostics = diagnose(
      `${REAL_IMPORTS}
export const detail: UiKitPlaceDetailWidget = realDetail;
export const routePlan: UiKitRoutePlanWidget = realRoutePlan;
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

  it("反证：PlaceDetail / RoutePlan 上凭空多出的成员同样必须被抓到", () => {
    const detailDiagnostics = diagnose(
      `${REAL_IMPORTS}
type InventedDetail = UiKitPlaceDetailWidget & { setData(uid: string): void };
export const invented: InventedDetail = realDetail;
`,
    );
    expect(detailDiagnostics.length, "检查器没有生效：PlaceDetail 上多出的成员通过了").toBeGreaterThan(0);
    expect(format(detailDiagnostics)).toContain("setData");

    const routeDiagnostics = diagnose(
      `${REAL_IMPORTS}
type InventedRoute = UiKitRoutePlanWidget & { setEnabledTypes(types: string[]): void };
export const invented: InventedRoute = realRoutePlan;
`,
    );
    expect(routeDiagnostics.length, "检查器没有生效：RoutePlan 上多出的成员通过了").toBeGreaterThan(0);
    expect(format(routeDiagnostics)).toContain("setEnabledTypes");
  });
});

/**
 * 自持类型的**取值集合 / 键集合**必须与上游逐成员对齐（UIKIT-02 / issue #75）
 *
 * 本仓库的公共类型刻意自持（不 import 上游类型包），代价是编译器不再自动盯着它们。
 * 这里用**双向 `Exclude`** 把差集显式取出来并要求它是 `never`：
 * - 少一个成员（上游新增了我们没跟）→ 我们这边的差集非空 → 报错；
 * - 多一个成员（我们凭命名规律猜的）→ 上游那边的差集非空 → 报错。
 *
 * 不用「联合整体可赋值」那种写法：上游只补齐一半声明时它会静默通过。
 * 也不用「数字枚举 ↔ 数字字面量」的可赋值性：TS 允许任意 `number` 赋给数字枚举类型，
 * 那个方向查不出我们多出来的成员，所以两个方向都用 `Exclude`。
 */
describe("自持类型的取值与键 vs 上游声明", () => {
  it("RoutePlanMode / RouteSegmentType / RouteTransitSubType 与上游取值完全相同", () => {
    const diagnostics = diagnose(`
import type {
  RoutePlanType as RealMode,
  Segment as RealSegment,
  TransitSegment as RealTransitSegment,
  DrivingPolicy as RealPolicy,
} from "@baidumap/jsapi-ui-kit";
import type {
  RoutePlanDrivingPolicy,
  RoutePlanMode,
  RouteSegmentType,
  RouteTransitSubType,
} from ${JSON.stringify(typesModule)};

type RealSegmentType = RealSegment["type"];
type RealTransitSubType = RealTransitSegment["subType"];

// 少成员 / 多成员各查两个方向，四个差集都必须是 never。
type ModeUpstreamOnly = Exclude<RealMode, RoutePlanMode>;
type ModeInvented = Exclude<RoutePlanMode, RealMode>;
type SegmentUpstreamOnly = Exclude<RealSegmentType, RouteSegmentType>;
type SegmentInvented = Exclude<RouteSegmentType, RealSegmentType>;
type TransitUpstreamOnly = Exclude<RealTransitSubType, RouteTransitSubType>;
type TransitInvented = Exclude<RouteTransitSubType, RealTransitSubType>;
type PolicyUpstreamOnly = Exclude<RealPolicy, RoutePlanDrivingPolicy>;
type PolicyInvented = Exclude<RoutePlanDrivingPolicy, RealPolicy>;

declare const modeUpstreamOnly: ModeUpstreamOnly;
declare const modeInvented: ModeInvented;
declare const segmentUpstreamOnly: SegmentUpstreamOnly;
declare const segmentInvented: SegmentInvented;
declare const transitUpstreamOnly: TransitUpstreamOnly;
declare const transitInvented: TransitInvented;
declare const policyUpstreamOnly: PolicyUpstreamOnly;
declare const policyInvented: PolicyInvented;

export const noMissingMode: never = modeUpstreamOnly;
export const noInventedMode: never = modeInvented;
export const noMissingSegment: never = segmentUpstreamOnly;
export const noInventedSegment: never = segmentInvented;
export const noMissingTransit: never = transitUpstreamOnly;
export const noInventedTransit: never = transitInvented;
export const noMissingPolicy: never = policyUpstreamOnly;
export const noInventedPolicy: never = policyInvented;
`);
    expect(diagnostics, `取值集合与上游不一致：\n${format(diagnostics)}`).toEqual([]);
  });

  it("构造期选项 DTO 的键与上游选项完全相同（含 `PlaceDetail` 的展示配置）", () => {
    const diagnostics = diagnose(`
import type {
  PlaceDetailDisplayOptions as RealDetailDisplay,
  DrivingOptions as RealDrivingOptions,
} from "@baidumap/jsapi-ui-kit";
import type {
  PlaceDetailDisplayDTO,
  RoutePlanDrivingOptionsDTO,
} from ${JSON.stringify(typesModule)};

type DetailDisplayUpstreamOnly = Exclude<keyof RealDetailDisplay, keyof PlaceDetailDisplayDTO>;
type DetailDisplayInvented = Exclude<keyof PlaceDetailDisplayDTO, keyof RealDetailDisplay>;
type DrivingUpstreamOnly = Exclude<keyof RealDrivingOptions, keyof RoutePlanDrivingOptionsDTO>;
type DrivingInvented = Exclude<keyof RoutePlanDrivingOptionsDTO, keyof RealDrivingOptions>;

declare const detailUpstreamOnly: DetailDisplayUpstreamOnly;
declare const detailInvented: DetailDisplayInvented;
declare const drivingUpstreamOnly: DrivingUpstreamOnly;
declare const drivingInvented: DrivingInvented;

export const noMissingDetailKey: never = detailUpstreamOnly;
export const noInventedDetailKey: never = detailInvented;
export const noMissingDrivingKey: never = drivingUpstreamOnly;
export const noInventedDrivingKey: never = drivingInvented;
`);
    expect(diagnostics, `构造期选项的键与上游不一致：\n${format(diagnostics)}`).toEqual([]);
  });

  /**
   * 常量表的**值**也要逐成员对齐：`RoutePlanDrivingPolicy` 是本库自持的枚举等价物，
   * 类型层（上面的双向 `Exclude`）只管取值集合，管不到「哪个名字对应哪个数字」——
   * 把 `AVOID_CONGESTION` 写成 4 是类型合法的，但运行时会把用户的策略悄悄换成另一个。
   */
  it("RoutePlanDrivingPolicy 常量表与上游 DrivingPolicy 枚举逐成员同值同名", async () => {
    const { RoutePlanDrivingPolicy } = (await import(
      "../../packages/bmap-vue/src/integrations/ui-kit/types"
    )) as typeof import("../../packages/bmap-vue/src/integrations/ui-kit/types");

    const upstream = readFileSync(
      join(UI_KIT_DTS, "components/route-plan/types.d.ts"),
      "utf8",
    );
    const body = upstream.match(/export declare enum DrivingPolicy \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const members = [...body.matchAll(/^\s{4}(\w+) = (\d+)/gm)].map(
      (match) => [match[1]!, Number(match[2]!)] as const,
    );
    // 正证守卫：解析不出成员说明锚点失效（上游改了声明格式），别让下面那条断言变成 空 == 空。
    expect(members.length, "没解析到 DrivingPolicy 的成员，检查器失效").toBeGreaterThan(8);
    expect({ ...RoutePlanDrivingPolicy }).toEqual(Object.fromEntries(members));
  });

  it("反证：取值集合少一个成员 / 多一个成员都必须被抓到", () => {
    const missing = diagnose(`
import type { RoutePlanType as RealMode } from "@baidumap/jsapi-ui-kit";
type Narrowed = Exclude<RealMode, "driving">;
declare const narrowed: Narrowed;
export const mustFail: never = narrowed;
`);
    expect(missing.length, "检查器没有生效：少成员竟然通过了").toBeGreaterThan(0);

    const invented = diagnose(`
type Ours = "driving" | "teleport";
type Upstream = "driving";
type Invented = Exclude<Ours, Upstream>;
declare const invented: Invented;
export const mustFail: never = invented;
`);
    expect(invented.length, "检查器没有生效：凭空多出的取值竟然通过了").toBeGreaterThan(0);
  });

  it("反证：键集合少一个 / 多一个都必须被抓到", () => {
    const upstreamOnlyKey = diagnose(`
type Ours = { alpha: boolean };
type Upstream = { alpha: boolean; beta: boolean };
type UpstreamOnly = Exclude<keyof Upstream, keyof Ours>;
declare const upstreamOnly: UpstreamOnly;
export const mustFail: never = upstreamOnly;
`);
    expect(upstreamOnlyKey.length, "检查器没有生效：少一个键竟然通过了").toBeGreaterThan(0);

    const inventedKey = diagnose(`
type Ours = { alpha: boolean; gamma: boolean };
type Upstream = { alpha: boolean };
type Invented = Exclude<keyof Ours, keyof Upstream>;
declare const invented: Invented;
export const mustFail: never = invented;
`);
    expect(inventedKey.length, "检查器没有生效：多一个键竟然通过了").toBeGreaterThan(0);
  });
});

/**
 * `./ui-kit` 的**公共 API 兼容性**（PR #82 评审 P1）
 *
 * `useUiKitWidget` / `UseUiKitWidgetOptions` / `UiKitModule` 从 #73 起就是公开导出，
 * 所以它们的新增字段必须保持向后兼容。#82 的首版踩了两处：把 `constructorOptions` 加成必填、
 * 又把 `UiKitModule` 的索引签名删掉 —— 两者都会让已有消费方升级后直接类型报错，
 * 而 PR 正文当时还写着「无破坏性变更」。
 *
 * 这两条从**消费方视角**写：用「老写法必须仍能编译」钉住，而不是断言我们内部实现长什么样。
 */
describe("公共 API 兼容性（已公开的导出不得被破坏）", () => {
  it("useUiKitWidget 的老调用（不传 constructorOptions）仍然可编译", () => {
    const diagnostics = diagnose(`
import type { Ref } from "vue";
import { useUiKitWidget } from ${JSON.stringify(bridgeModule)};
declare const host: Ref<HTMLElement | null>;
export const api = useUiKitWidget({
  component: "LegacyConsumer",
  host,
  buildOptions: () => ({}),
  create: () => ({ on() {}, off() {}, destroy() {} }),
});
`);
    expect(
      diagnostics,
      `useUiKitWidget 的公开签名被收紧成破坏性变更（constructorOptions 必须是可选的）：\n${format(diagnostics)}`,
    ).toEqual([]);
  });

  it("loadUiKit() 的返回值仍可按名字索引（索引签名是公开逃生口）", () => {
    const diagnostics = diagnose(`
import type { UiKitModule } from ${JSON.stringify(typesModule)};
declare const uiKit: UiKitModule;
declare const widgetName: string;
export const widget: unknown = uiKit[widgetName];
`);
    expect(
      diagnostics,
      `UiKitModule 的索引签名被删掉了（loadUiKit() 的逃生口被破坏）：\n${format(diagnostics)}`,
    ).toEqual([]);
  });

  it("反证：把 constructorOptions 变回必填必须被抓到", () => {
    const diagnostics = diagnose(`
import type { Ref } from "vue";
declare const host: Ref<HTMLElement | null>;
type Options = {
  component: string;
  host: Ref<HTMLElement | null>;
  buildOptions: () => Record<string, unknown>;
  constructorOptions: () => Record<string, unknown>;
};
declare function useStrict(options: Options): unknown;
export const api = useStrict({
  component: "LegacyConsumer",
  host,
  buildOptions: () => ({}),
});
`);
    expect(diagnostics.length, "检查器没有生效：必填字段缺失竟然通过了").toBeGreaterThan(0);
    expect(format(diagnostics)).toContain("constructorOptions");
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
const UI_KIT_IIFE = join(
  repoRoot,
  "node_modules",
  "@baidumap",
  "jsapi-ui-kit",
  "dist",
  "jsapi-ui-kit.iife.js",
);
const UI_KIT_DTS = join(repoRoot, "node_modules", "@baidumap", "jsapi-ui-kit", "dist");

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

/**
 * #75 依赖的上游行为锁定在发布产物（UIKIT-02）
 *
 * 这几条是写 `PlaceDetail` / `RoutePlan` 时**必须相信**的上游行为。一旦它们变了，
 * 本库的封装语义就错了，而脚手架（会记账的假 widget）不会替我们发现 ——
 * 假 widget 永远按我们想象的形状应答。
 */
describe("#75 依赖的上游行为锁定在发布产物", () => {
  const code = readFileSync(UI_KIT_ESM, "utf8");
  const iife = readFileSync(UI_KIT_IIFE, "utf8");
  const detailDts = readFileSync(join(UI_KIT_DTS, "components/place-detail/PlaceDetail.d.ts"), "utf8");
  const optionsDts = readFileSync(join(UI_KIT_DTS, "types/options.d.ts"), "utf8");

  it("`PlaceDetailOptions.layout` 只有声明、没有实现（所以本库不暴露它）", () => {
    // 正证守卫：上游**确实**声明了这个选项 —— 否则「产物里没有读取点」是一句废话，
    // 更糟的是：上游哪天删掉它，我们这边的断言会继续绿着，而文档还在讲一个不存在的东西。
    expect(optionsDts, "上游不再声明 layout 了，本库文档与 ADR 需要同步").toContain(
      "layout?: 'default' | 'compact'",
    );
    // 两个产物里都不许有读取点：一个选项连读都没被读过，就不可能生效。
    for (const [name, bundle] of [
      ["esm", code],
      ["iife", iife],
    ] as const) {
      expect(bundle, `${name} 产物里出现了 layout，上游可能已经实现它`).not.toContain("layout");
      expect(bundle, `${name} 产物里出现了 compact，上游可能已经实现紧凑模式`).not.toContain("compact");
    }
    expect(detailDts).toContain("setPlace"); // 这条只是确认读的是正确的声明文件
  });

  it("`setPlace(uid)` 找不到 uid 时不抛错也不发事件（本库据此不合成假 load）", () => {
    const at = code.indexOf("async fetchDetailByUid");
    expect(at, "找不到 fetchDetailByUid 的实现，上游实现变了").toBeGreaterThan(-1);
    const body = code.slice(at, at + 600);
    const emptyBranch = body.indexOf("!n");
    const emitLoad = body.indexOf('emit("load"');
    expect(emptyBranch, "详情接口的回包判空分支不见了").toBeGreaterThan(-1);
    expect(emitLoad, "fetchDetailByUid 里没有 load 事件").toBeGreaterThan(-1);
    // 判空分支必须排在 emit 之前：`!n` 成立时直接 return，请求不到详情就不发事件。
    expect(emptyBranch, "`!n` 判空不再先于 load 事件：uid 找不到时可能会发事件").toBeLessThan(emitLoad);
  });

  it('`RoutePlan` 只启用驾车：enabledTypes 硬编码 ["driving"]、showTabs 为 false', () => {
    const enabled = code.match(/enabledTypes:\s*([\w$]+)/)?.[1];
    expect(enabled, "找不到 enabledTypes 的归一化点，上游实现变了").toBeTruthy();
    expect(
      new RegExp(`const ${enabled} = \\["driving"\\]`).test(code),
      `${enabled} 不再是 ["driving"]：本库「只开放驾车、不暴露 switchType」的结论要重新核对`,
    ).toBe(true);
    expect(code, "showTabs 不再是关闭状态").toMatch(/showTabs:\s*!1|showTabs:\s*false/);
    // 对未启用的类型只 warn 后 return（这正是本库不暴露 switchType 的理由）。
    expect(code).toContain("未启用");
  });

  it("RoutePlan 六个事件的载荷形状与我们的投影一致", () => {
    expect(code).toContain('emit("typechange", { type:');
    expect(code).toContain('emit("clear")');
    expect(code).toContain('emit("planselect", {');
    expect(code).toContain('emit("navclick", {');
    // `result` 事件载荷**没有** `routeType`（它用 `type`），而归一化返回值用的是 `routeType`
    // —— 这正是本库把那两个名字归一成 `type` 的原因。
    const resultAt = code.indexOf('emit("result"');
    expect(resultAt, "找不到 result 的 emit 点").toBeGreaterThan(-1);
    const resultScope = code.slice(Math.max(0, resultAt - 260), resultAt);
    expect(resultScope, "result 事件载荷不再由 { type, start, end, plans } 组成").toMatch(
      /const \w+ = \{\s*type:/,
    );
    expect(resultScope).toContain("plans:");
    expect(resultScope, "result 事件载荷里出现了 routeType，本库的归一化说明要改").not.toContain(
      "routeType",
    );
    // `error` 事件的载荷是上游自己造的 Error 实例（本库把它包成 BMapError）。
    expect(code).toContain('emit("error", i)');
  });
});

/**
 * 上游声明的字段必须**真的被读进投影**（UIKIT-02 / issue #75）
 *
 * 起因：写 `toRouteSegmentDTO()` 时漏掉了 `DriveSegment.roadName` —— DTO 里有这个字段、
 * 类型检查也过、单测如果只断言「没抛错」也是绿的，但真实回包里的道路名会被静默丢弃。
 * 类型层查不出这种「投影漏字段」，所以这里把上游 `.d.ts` 的字段清单拉出来，
 * 逐个要求本库的投影函数里出现对应的读取点。
 *
 * 反向（我们读了一个上游没有的字段）由「自持类型的取值与键 vs 上游声明」那条覆盖。
 */
describe("上游声明的字段必须真的被读进投影", () => {
  const srcDir = join(pkgRoot, "src/integrations/ui-kit");
  const routeTypes = readFileSync(join(UI_KIT_DTS, "components/route-plan/types.d.ts"), "utf8");
  const placeDetailTypes = readFileSync(
    join(UI_KIT_DTS, "components/place-detail/PlaceDetail.d.ts"),
    "utf8",
  );

  /** 从 `.d.ts` 里取一个 interface 的成员名（上游声明用 4 空格缩进）。 */
  function interfaceFields(source: string, name: string): string[] {
    const body = source.match(new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    expect(body, `上游声明里找不到 interface ${name}`).toBeTruthy();
    return [...body.matchAll(/^ {4}(\w+)\??:/gm)].map((match) => match[1]!);
  }

  /** 取本库某个函数自己的函数体（源码没被压缩，按 `function <name>(` 锚定）。 */
  function ownBody(source: string, fn: string): string {
    const at = source.indexOf(`function ${fn}(`);
    expect(at, `找不到 ${fn}()`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", at);
    return source.slice(at, end === -1 ? source.length : end);
  }

  /**
   * 取投影函数的函数体**以及它在同一文件里调用到的 helper**。
   *
   * 只看入口函数的字面量会把 `path` / `duration` 这类「抽成 helper 的读法」误判成漏读
   * —— 而 helper 正是这个仓库常用的形状（`readSegmentPathAndDuration()`）。
   * 递归只走**同文件内**定义的函数：`readers.ts` 里的读原语不会被算进来。
   */
  function projectionBodies(file: string, entry: string): string {
    const source = readFileSync(join(srcDir, file), "utf8");
    const bodies: string[] = [];
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const fn = queue.pop()!;
      if (seen.has(fn)) continue;
      seen.add(fn);
      const body = ownBody(source, fn);
      bodies.push(body);
      for (const call of body.matchAll(/([\w$]+)(?=\()/g)) {
        const name = call[1]!;
        if (!seen.has(name) && source.includes(`function ${name}(`)) queue.push(name);
      }
    }
    return bodies.join("\n");
  }

  /**
   * 判断投影体里是否真的读了某个字段。
   *
   * 点号那一支必须带**词边界**：`.roadName` 会被 `.roadNameX` 满足，
   * 于是「把读取点改名」这种反证会静默失效。
   */
  function readsField(body: string, field: string): boolean {
    return body.includes(`"${field}"`) || new RegExp(`\\.${field}\\b`).test(body);
  }

  const CASES: readonly { type: string; dts: string; file: string; fn: string }[] = [
    { type: "PlaceDetailEventData", dts: placeDetailTypes, file: "points.ts", fn: "toPlaceDetailDTO" },
    { type: "NormalizedPoint", dts: routeTypes, file: "routePlan.ts", fn: "toRoutePointDTO" },
    { type: "BaseSegment", dts: routeTypes, file: "routePlan.ts", fn: "toRouteSegmentDTO" },
    { type: "DriveSegment", dts: routeTypes, file: "routePlan.ts", fn: "toRouteSegmentDTO" },
    { type: "WalkSegment", dts: routeTypes, file: "routePlan.ts", fn: "toRouteSegmentDTO" },
    { type: "RidingSegment", dts: routeTypes, file: "routePlan.ts", fn: "toRouteSegmentDTO" },
    { type: "TransitSegment", dts: routeTypes, file: "routePlan.ts", fn: "toRouteSegmentDTO" },
    { type: "NormalizedPlan", dts: routeTypes, file: "routePlan.ts", fn: "toRoutePlanDTO" },
    { type: "RoutePlanEventData", dts: routeTypes, file: "routePlan.ts", fn: "toRoutePlanResultDTO" },
    {
      type: "RoutePlanSearchOptions",
      dts: routeTypes,
      file: "routePlan.ts",
      fn: "toUpstreamRouteSearchOptions",
    },
  ];

  it("每个上游字段都能在本库的投影里找到读取点", () => {
    for (const { type, dts, file, fn } of CASES) {
      const fields = interfaceFields(dts, type);
      // 正证守卫：字段清单本身不能是空的（正则失配时这里会立刻响）。
      expect(fields.length, `${type} 没解析出字段，检查器失效`).toBeGreaterThan(0);
      const body = projectionBodies(file, fn);
      for (const field of fields) {
        expect(
          readsField(body, field),
          `${fn}() 没有读 ${type}.${field}：该字段会被静默丢弃`,
        ).toBe(true);
      }
    }
  });

  it("反证：把投影里的读取点改名必须被抓到", () => {
    // 直接对着真实的 `toRouteSegmentDTO` 改掉 `roadName` 那一处（本次就漏过它）。
    const body = projectionBodies("routePlan.ts", "toRouteSegmentDTO");
    expect(readsField(body, "roadName"), "前置：投影里本来就没读 roadName").toBe(true);
    const renamed = body.replaceAll("roadName", "renamedField");
    const fields = interfaceFields(routeTypes, "DriveSegment");
    expect(fields).toContain("roadName");
    const missing = fields.filter((field) => !readsField(renamed, field));
    expect(missing, "检查器没有生效：漏掉 roadName 竟然没被算成缺字段").toEqual(["roadName"]);
  });
});
