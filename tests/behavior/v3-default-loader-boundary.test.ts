/**
 * 默认加载路径的静态门禁（R25-B / issue #71）
 *
 * 这一份锁的是**结构**而不是行为，防止默认路径悄悄退回自研实现：
 *
 * 1. 默认在线 Provider 不得再出现自建 JSONP transport 的任何痕迹（拼入口 URL、生成回调名、
 *    自研 `ScriptLoader` / `SharedLoadTask`、自己 `document.createElement`）；
 * 2. 默认入口（`createBMapPlugin` / `<BMap>` 的隐式 Provider）必须解析到 `baiduJsapiV4Provider()`；
 * 3. 根入口与 `./core` 入口的**静态**模块图不得触达 UI Kit 或任何 CSS
 *    （UI Kit 无 DOM 即 import 失败，且 CSS 必须由消费方显式引入——#73 的边界）。
 *
 * 为什么 3 要按「可达性」而不是全仓文本扫描：UI Kit 的桥接目录本身就该存在（#73），
 * 只要它不在根入口的静态图里即可；全局禁词会把这个正当实现误判成违规。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// 剥注释的判定式是共享实现（`#104` 第三批收口：此前本仓有 5 份逐字副本）。
import { stripComments } from "../../packages/test-utils";

const PKG_SRC = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue/src");
const PKG_ROOT = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue");

function read(relativePath: string): string {
  return readFileSync(join(PKG_SRC, relativePath), "utf8");
}

/** 提取**静态**导入/再导出的模块说明符；动态 `import()` 刻意不算（UI Kit 只能动态 import）。 */
function staticSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|[\s;])(?:import|export)\s+(?:[^'"()]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

/** 解析相对说明符到真实文件（`x.ts` / `x/index.ts` / `x.vue` / `x.mts`）。 */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.vue`,
    join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** 遍历静态模块图，返回「可达文件」与「可达外部包」两类结果。 */
function walkStaticGraph(entries: readonly string[]): {
  files: string[];
  packages: Set<string>;
} {
  const files: string[] = [];
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(PKG_SRC, entry));

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    files.push(file);

    for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const resolvedFile = resolveRelative(file, specifier);
        if (resolvedFile) queue.push(resolvedFile);
        continue;
      }
      // 子路径导入（`pkg/sub`）也要保留整串，便于精确断言 UI Kit 的两个形态。
      packages.add(specifier);
    }
  }

  return { files, packages };
}

/**
 * 自建 transport 的痕迹符号：默认 Provider 里出现任何一个都说明它又开始自己加载了。
 * 抽成常量是为了让「门禁自身不是空转」的正证用例与断言共用同一份清单。
 */
const SELF_BUILT_TRANSPORT_MARKERS = [
  "ScriptLoader",
  "SharedLoadTask",
  "createCallbackName",
  "appendCallback",
  "loadJsapiV4Script",
  "createElement",
] as const;

/**
 * 默认入口（根 + `./core`）的**静态**模块图。
 *
 * 提到模块作用域是因为两批断言共用它：一条查「不得触达 UI Kit / CSS」，
 * 一条查「legacy 入口 URL 构造器不在图里」。
 */
const DEFAULT_GRAPH = walkStaticGraph(["index.ts", "core/index.ts"]);

/**
 * legacy 工厂的**调用**与**具名导入**。
 *
 * 这两条判定式必须带正证用例（见下）：负向断言一旦写歪（第一个版本把函数名拼成了
 * `baidiCdnProvider`），它会永远为真，门禁等于不存在。
 */
const LEGACY_FACTORY_CALL = /\bbaiduCdnProvider\s*\(/;
const LEGACY_FACTORY_IMPORT = /\bimport\s*\{[^}]*\bbaiduCdnProvider\b[^}]*\}\s*from/;
const LEGACY_PROVIDER_MODULE_IMPORT = /^\s*import[^;]*from\s*"[^"]*loader\/Provider"/m;

describe("默认在线路径不得再自建 JSONP transport", () => {
  const source = stripComments(read("core/loader/providers/BaiduJsapiV4Provider.ts"));

  it("门禁自身不是空转：自建 transport 的痕迹会被抓到，注释里的提及不算", () => {
    // 正证：把「重新引入自建加载」的代码形状喂给判定式，必须命中。
    const reintroduced =
      "const loader = new ScriptLoader();\nconst url = appendCallback(apiUrl, createCallbackName('cb'));";
    expect(SELF_BUILT_TRANSPORT_MARKERS.filter((marker) => reintroduced.includes(marker))).toEqual([
      "ScriptLoader",
      "createCallbackName",
      "appendCallback",
    ]);
    // 反向：注释里的说明不得触发（否则门禁逼着人改文案而不是改实现）。
    const commented = stripComments("// 旧实现用 new ScriptLoader() 加载\n/* appendCallback(...) */");
    expect(SELF_BUILT_TRANSPORT_MARKERS.filter((marker) => commented.includes(marker))).toEqual([]);
  });

  it("不出现自建入口 URL / 回调名 / 自研 script 加载器的痕迹", () => {
    for (const forbidden of SELF_BUILT_TRANSPORT_MARKERS) {
      expect(source, `BaiduJsapiV4Provider 仍引用 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("legacy 的自拼入口 URL 构造器已整份删除（缺席即门禁）", () => {
    // #104 R9：默认路径改走官方 `@baidumap/jsapi-loader` 之后，`createBaiduSdkUrl` 没有任何
    // 生产调用方，连同 `./core` 的导出一起删除。这里断言的是**不存在**：它重新出现在默认模块图
    // （含 `./core` 导出面）的任何一处，就等于把「自拼入口 URL」重新接回默认路径。
    //
    // 正证（门禁不是空转）：`core/loader/url.ts` 确实在这张图里，所以这条循环扫得到东西。
    expect(DEFAULT_GRAPH.files.some((file) => file.endsWith("core/loader/url.ts"))).toBe(true);
    for (const file of DEFAULT_GRAPH.files) {
      expect(
        stripComments(readFileSync(file, "utf8")),
        `${file} 仍包含 legacy 入口 URL 构造器`,
      ).not.toContain("createBaiduSdkUrl");
    }
  });

  it("确实经官方 Loader 适配层加载", () => {
    expect(source).toContain("officialJsapiLoader");
    expect(source).toContain("toOfficialLoadOptions");
    expect(source).toContain("from \"./official\"");
  });
});

describe("默认入口解析到 v4 官方 Provider", () => {
  it("门禁自身不是空转：legacy 调用 / 导入会被这两条判定式抓到", () => {
    expect(LEGACY_FACTORY_CALL.test("const p = baiduCdnProvider();")).toBe(true);
    expect(LEGACY_FACTORY_CALL.test("const p = baiduJsapiV4Provider();")).toBe(false);
    // 注释里的提及不算实现。
    expect(
      LEGACY_FACTORY_CALL.test(stripComments("// 旧默认值是 baiduCdnProvider()，现在不是了")),
    ).toBe(false);
    expect(
      LEGACY_FACTORY_IMPORT.test('import { baiduCdnProvider } from "../core/loader/Provider";'),
    ).toBe(true);
    expect(
      LEGACY_PROVIDER_MODULE_IMPORT.test(
        'import { baiduCdnProvider } from "../core/loader/Provider";',
      ),
    ).toBe(true);
    expect(
      LEGACY_PROVIDER_MODULE_IMPORT.test(
        'import { baiduJsapiV4Provider } from "../core/loader/providers/index";',
      ),
    ).toBe(false);
  });

  it("createBMapPlugin 的默认 Provider 是 baiduJsapiV4Provider()", () => {
    const source = stripComments(read("plugins/createBMapPlugin.ts"));
    expect(source).toMatch(/options\.provider\s*\?\?\s*baiduJsapiV4Provider\(\)/);
    // legacy Provider 模块不再被这个入口导入。
    expect(source).not.toMatch(LEGACY_PROVIDER_MODULE_IMPORT);
    expect(source).not.toMatch(LEGACY_FACTORY_CALL);
  });

  it("legacy Provider 模块已整份删除（这两条负向断言的前提）", () => {
    // M3A3-REMOVE-LEGACY（#26）：`core/loader/Provider.ts`（`baiduCdnProvider` 家族与
    // 「页面已有全局」回退）整份删除。先把这件事钉住——否则「默认入口不导入它 / 不调用它」
    // 这两条负向断言会因为**模块根本不存在**而恒真，门禁看起来在守，其实什么都没守。
    expect(existsSync(join(PKG_SRC, "core/loader/Provider.ts"))).toBe(false);
    expect(existsSync(join(PKG_SRC, "core/loader/providers/index.ts"))).toBe(true);
  });

  it("<BMap> 隐式 Provider 的兜底也是 baiduJsapiV4Provider()", () => {
    const source = stripComments(read("components/map/BMap.vue"));
    expect(source).toMatch(/appConfig\?\.provider\s*\?\?\s*baiduJsapiV4Provider\(\)/);
    // 兜底里不再出现 legacy 工厂调用，也不再从 legacy 模块导入任何东西。
    // #26 之后组件的两条全局兜底（`allowExistingGlobal` 与「页面已有全局就自动回退」）也删掉了，
    // 因此这里追加模块级导入断言（模块已不存在，见上一条用例）。
    expect(source).not.toMatch(LEGACY_PROVIDER_MODULE_IMPORT);
    expect(source).not.toMatch(LEGACY_FACTORY_CALL);
    expect(source).not.toMatch(LEGACY_FACTORY_IMPORT);
  });
});

describe("根入口静态模块图不得触达 UI Kit 或 CSS", () => {
  const graph = DEFAULT_GRAPH;

  it("模块图覆盖了组件与 core 两侧（守卫本身不是空转）", () => {
    // 可达文件数量与「确实走到了 .vue 组件」是这条门禁的**正证**：如果解析器坏了，
    // files 会退化成只有入口本身，下面的断言就会静默通过。
    expect(graph.files.length).toBeGreaterThan(30);
    expect(graph.files.some((file) => file.endsWith("components/map/BMap.vue"))).toBe(true);
  });

  it("没有任何可达模块导入官方 UI Kit", () => {
    const uiKit = [...graph.packages].filter((specifier) =>
      specifier.startsWith("@baidumap/jsapi-ui-kit"),
    );
    expect(uiKit).toEqual([]);
    for (const file of graph.files) {
      expect(readFileSync(file, "utf8")).not.toContain("@baidumap/jsapi-ui-kit");
    }
  });

  it("没有任何可达模块静态导入 CSS", () => {
    for (const file of graph.files) {
      for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
        expect(specifier, `${file} 静态导入了样式`).not.toMatch(/\.css('|")?$/);
      }
    }
  });

  it("发布包的 exports/style 里也没有样式入口（CSS 由消费方显式引入）", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      style?: string;
      exports: Record<string, unknown>;
    };
    expect(pkg.style).toBeUndefined();
    expect(Object.keys(pkg.exports)).not.toContain("./style.css");
  });
});
