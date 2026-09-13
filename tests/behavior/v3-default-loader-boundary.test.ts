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

const PKG_SRC = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue/src");
const PKG_ROOT = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue");

function read(relativePath: string): string {
  return readFileSync(join(PKG_SRC, relativePath), "utf8");
}

/**
 * 去掉注释，只留下**实现**。
 *
 * 这几条判定式的对象是「代码怎么加载」，而文件里完全可以正当地在注释里提到 legacy 工厂
 * （例如解释「以前的默认值是 `baiduCdnProvider()`，现在不是了」）。不剥注释就会得到
 * **误报**，而为了消误报去改注释则是本末倒置——那会让门禁的判定对象变成文案。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;(){}])\/\/[^\n]*/g, "$1");
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
  "createBaiduSdkUrl",
  "createCallbackName",
  "appendCallback",
  "loadJsapiV4Script",
  "createElement",
] as const;

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
      "const loader = new ScriptLoader();\nconst url = createBaiduSdkUrl(options, createCallbackName('cb'));";
    expect(SELF_BUILT_TRANSPORT_MARKERS.filter((marker) => reintroduced.includes(marker))).toEqual([
      "ScriptLoader",
      "createBaiduSdkUrl",
      "createCallbackName",
    ]);
    // 反向：注释里的说明不得触发（否则门禁逼着人改文案而不是改实现）。
    const commented = stripComments("// 旧实现用 new ScriptLoader() 加载\n/* createBaiduSdkUrl(...) */");
    expect(SELF_BUILT_TRANSPORT_MARKERS.filter((marker) => commented.includes(marker))).toEqual([]);
  });

  it("不出现自建入口 URL / 回调名 / 自研 script 加载器的痕迹", () => {
    for (const forbidden of SELF_BUILT_TRANSPORT_MARKERS) {
      expect(source, `BaiduJsapiV4Provider 仍引用 ${forbidden}`).not.toContain(forbidden);
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

  it("<BMap> 隐式 Provider 的兜底也是 baiduJsapiV4Provider()", () => {
    const source = stripComments(read("components/map/BMap.vue"));
    expect(source).toMatch(/appConfig\?\.provider\s*\?\?\s*baiduJsapiV4Provider\(\)/);
    // 兜底里不再出现 legacy 工厂调用。它仍从 legacy 模块导入 `existingGlobalProvider`
    // （「页面已有全局」的显式回退分支，属迁移期），但不得导入 `baiduCdnProvider`。
    expect(source).not.toMatch(LEGACY_FACTORY_CALL);
    expect(source).not.toMatch(LEGACY_FACTORY_IMPORT);
  });
});

describe("根入口静态模块图不得触达 UI Kit 或 CSS", () => {
  const graph = walkStaticGraph(["index.ts", "core/index.ts"]);

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
