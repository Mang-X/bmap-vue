/**
 * `./advanced` 扩展契约的冻结门禁（M8-ADAPTERS-ADVANCED / issue #43）
 *
 * #43 实施步骤 5 的口径：**`./advanced` 只导出 Provider / Driver / Handle / 必要 Spec / Plugin
 * 这类扩展契约**；内部的 `MapRuntime`、缓存、EventBus、hash 等**不成为稳定公共 API**。
 *
 * 三条边界，各自都有「改一下就会红」的判别力：
 *
 * 1. **导出面是精确集合**：多一个 / 少一个都要显式改这张表。不是「包含关系」——包含关系挡不住
 *    悄悄新增一个内部实现（那正是这条契约最容易破的方式）。
 * 2. **内部面不在 `./advanced`**：负向断言 + **正证守卫**（同一批名字必须能在 `./core` 里找到）
 *    —— 没有正证的话，「列表拼错 / 名字早就改名了」会让这条断言永远为真。
 * 3. **产物层**：`dist/advanced.mjs` 的静态 import 闭包里不得出现组件或官方 UI Kit。
 *    `sideEffects: false` + 闭包不含组件，才是「只用 `./advanced` 的消费者不会把整个组件库拉进包里」
 *    这条 tree-shaking 承诺；正证是根入口的闭包**必须**含组件标记。
 *
 * 需要先 `pnpm build:package`（读 `dist` 的用例都在 `test:unit` 里，CI 的构建顺序在测试之前）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  collectImportClosure,
  componentMarkersIn,
  UI_KIT_SPECIFIER,
  type ImportClosure,
} from "../../scripts/advanced-bundle-shake.mts";
import * as advanced from "../../packages/bmap-vue/src/advanced";
import * as core from "../../packages/bmap-vue/src/core";
import * as root from "../../packages/bmap-vue/src";

const PKG_DIR = resolve(import.meta.dirname, "../../packages/bmap-vue");
const DIST = resolve(PKG_DIR, "dist");

/**
 * 冻结的运行时导出面（21 个值导出）。
 *
 * 类型导出不在这里：`Object.keys` 只看得到值导出，类型面由 `v3-public-dts-gate` 与
 * 消费方 fixture（`fixtures/consumer`）覆盖。
 */
const FROZEN_ADVANCED_EXPORTS = [
  "CAPABILITY_CATALOG",
  "CAPABILITY_FAMILIES",
  "CAPABILITY_IDS",
  "CAPABILITY_STATUSES",
  "HANDLE_BRAND",
  "UnsupportedCapabilityError",
  "assertLoadedSdk",
  "createBMapClient",
  "createBMapClientDefinition",
  "createCapabilityRegistry",
  "createHandle",
  "createJsapiV4Driver",
  "isLoadedSdk",
  "isPointLike",
  "jsapiV4DriverFactory",
  "normalizeMapMouseEvent",
  "normalizeProvider",
  "toPlainPoint",
  "toPlainPoints",
  "toPoint",
  "unwrapRaw",
].sort();

/**
 * **只属于内部实现**、不得成为扩展契约的名字。
 *
 * 每一条都同时断言两件事：`./advanced` 里没有它，`./core` 里有它。后者是**正证守卫** ——
 * 只写负向断言时，把某个名字拼错（或上游哪天改了名）会让断言静默变绿；有了正证，
 * 「这批名字确实存在、只是不在 `./advanced`」才是被证明的。
 */
const INTERNAL_ONLY_EXPORTS = [
  "MapRuntime",
  "SdkRegistry",
  "getProcessSdkRegistry",
  "ScriptLoader",
  "SharedLoadTask",
  "createMapEventBus",
  "createFrameScheduler",
  "hash",
  "fingerprintConfig",
  "normalizeApiUrl",
  "ResourceScope",
  "createPluginRegistry",
  "useSdkResource",
  "createLayerRegistry",
  "createOverlayRegistry",
  "DataLayerManager",
  "BMapError",
  // `resetProcessSdkRegistryForTests` 曾在这张表里（当时它从 `./core` 出口可达）。
  // `#104` 第三批把它从 `./core` 摘掉之后，「它必须能在 `./core` 找到」这条正证不再成立，
  // 因此改为由 `v3-core-surface.test.ts` 的负向清单守着 —— 那里断言它**不在**任何公共出口上。
];

/** 组件名：它们属于根入口 / `./components`，不许出现在扩展契约里。 */
const COMPONENT_EXPORTS = ["BMap", "BMapProvider", "BMarker", "BInfoWindow", "BTrackLineLayer"];

describe("./advanced 的导出面是冻结的精确集合", () => {
  it("运行时导出与冻结清单逐名相等（多一个 / 少一个都要显式改清单）", () => {
    const actual = Object.keys(advanced).sort();
    expect(actual).toEqual(FROZEN_ADVANCED_EXPORTS);
    // 空转守卫：清单本身非空。它挡的是「清单被误删空」这类改错（两侧都空时上面那条会恒真），
    // 不是在验实现 —— 真正的判据是上面那条逐名相等。
    expect(FROZEN_ADVANCED_EXPORTS.length).toBeGreaterThan(10);
  });

  it("`./advanced` 是入口，不是唯一入口：根入口不导出 raw 逃生口（正反成对）", () => {
    for (const name of ["unwrapRaw", "createHandle", "HANDLE_BRAND", "createJsapiV4Driver"]) {
      expect(advanced, `./advanced 必须导出 ${name}`).toHaveProperty(name);
      expect(root, `根入口不得导出 ${name}`).not.toHaveProperty(name);
    }
  });
});

describe("内部实现不得进入扩展契约（含正证守卫）", () => {
  it("内部面既不在 ./advanced，又确实存在于 ./core", () => {
    const advancedNames = new Set(Object.keys(advanced));
    const coreNames = new Set(Object.keys(core));

    // 正证守卫：这批名字必须真的存在（拼错 / 改名会让下面的负向断言静默变绿）
    const missingInCore = INTERNAL_ONLY_EXPORTS.filter((name) => !coreNames.has(name));
    expect(missingInCore, `内部面清单里有名字在 ./core 找不到（清单过期了）：${missingInCore.join(", ")}`)
      .toEqual([]);

    // 负向：一个都不许出现在扩展契约里
    const leaked = INTERNAL_ONLY_EXPORTS.filter((name) => advancedNames.has(name));
    expect(leaked, `内部实现泄漏进 ./advanced：${leaked.join(", ")}`).toEqual([]);
  });

  it("组件名既不在 ./advanced，又在根入口可用（两侧都验）", () => {
    const advancedNames = new Set(Object.keys(advanced));
    const rootNames = new Set(Object.keys(root));

    const missingInRoot = COMPONENT_EXPORTS.filter((name) => !rootNames.has(name));
    expect(missingInRoot, `根入口缺少组件：${missingInRoot.join(", ")}`).toEqual([]);
    expect(
      COMPONENT_EXPORTS.filter((name) => advancedNames.has(name)),
      "组件不该出现在扩展契约里",
    ).toEqual([]);
  });
});

describe("闭包解析器自身的能力（含副作用导入）", () => {
  /**
   * 评审 2026-09-21 P1：`importsOf` 曾经只认带 `from` 的 import 与 `import()`，
   * 于是 `import "./x.mjs";` 这种**副作用导入**会被整条跳过 ——
   * 而「某个 chunk 为了副作用把组件 chunk 拉进来」恰恰是本门禁最该防的一类情况
   * （`advanced` 仍会显示「0 个组件标记」，假绿）。这里用最小夹具把三类说明符一起钉住。
   */
  const withFixture = (
    files: Record<string, string>,
    run: (dir: string) => void,
  ): void => {
    const dir = mkdtempSync(join(tmpdir(), "advanced-shake-"));
    try {
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(dir, name), content);
      }
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const closureOf = (dir: string): ImportClosure =>
    collectImportClosure({
      root: dir,
      entry: join(dir, "entry.mjs"),
      resolve: (from, specifier) => resolve(dirname(from), specifier),
      relative: (from, to) => relative(from, to),
      exists: existsSync,
      readFile: (file) => readFileSync(file, "utf8"),
    });

  it("副作用导入（`import \"./x.mjs\"`）必须被纳入闭包，并在其中命中组件标记", () => {
    withFixture(
      {
        "entry.mjs": 'import "./side-effect.mjs";\n',
        "side-effect.mjs": 'export const marker = "BInfoWindow";\n',
      },
      (dir) => {
        const closure = closureOf(dir);
        // 反证的一半：只识别 `from` / `import()` 的实现会缺这一项
        expect(closure.files).toContain("side-effect.mjs");
        expect(closure.external, "相对路径的副作用导入不该落进 external").toEqual([]);
        // 另一半：认出来了之后，标记真的会被命中（否则「纳入闭包」是空的）
        expect(
          componentMarkersIn(closure, (file) => resolve(dir, file), (file) => readFileSync(file, "utf8")),
        ).toContain("BInfoWindow");
      },
    );
  });

  it("三类说明符都要认：带绑定 / 副作用 / 动态（同一个夹具里各一条，三条路径都必须在闭包里）", () => {
    withFixture(
      {
        "entry.mjs": [
          'import { bound } from "./bound.mjs";',
          'import "./side-effect.mjs";',
          'export const lazy = () => import("./lazy.mjs");',
          "export const all = [bound, lazy];",
          "",
        ].join("\n"),
        "bound.mjs": "export const bound = 1;\n",
        "side-effect.mjs": "export const side = 2;\n",
        "lazy.mjs": "export const lazy = 3;\n",
      },
      (dir) => {
        const closure = closureOf(dir);
        expect(closure.files).toContain("bound.mjs");
        expect(closure.files).toContain("side-effect.mjs");
        expect(closure.files).toContain("lazy.mjs");
        expect(closure.files).toContain("entry.mjs");
        // 空转守卫：闭包确实读到了多个文件（否则上面的「包含」可能是在单个文件上恒真）
        expect(closure.files.length).toBeGreaterThan(1);
      },
    );
  });
});

describe("产物层：只用 ./advanced 的消费者不会拉进组件与官方 UI Kit", () => {
  const closureOf = (entry: string): ImportClosure => {
    if (!existsSync(entry)) {
      throw new Error(
        `缺少构建产物 ${entry}：先跑 \`pnpm build:package\`（读 dist 的用例都在 test:unit 里）`,
      );
    }
    return collectImportClosure({
      root: DIST,
      entry,
      resolve: (from, specifier) => resolve(dirname(from), specifier),
      relative: (from, to) => relative(from, to),
      exists: existsSync,
      readFile: (file) => readFileSync(file, "utf8"),
    });
  };

  const markersIn = (closure: ImportClosure): string[] =>
    componentMarkersIn(closure, (file) => resolve(DIST, file), (file) => readFileSync(file, "utf8"));

  it("dist/advanced.mjs 的 import 闭包不含组件标记，也不引用官方 UI Kit", () => {
    const closure = closureOf(resolve(DIST, "advanced.mjs"));

    // 空转守卫：闭包确实读到了文件。它只能挡「entry 路径写错 / 目录不存在」，
    // 挡不住「root 判定失效导致所有 import 都落进 external」——后者由下面那条正证挡住
    // （根入口闭包必须命中组件标记，否则整条判据无区分力，用例会红）。
    expect(closure.files.length).toBeGreaterThan(0);
    expect(closure.files).toContain("advanced.mjs");

    expect(markersIn(closure), "advanced 的闭包里出现了组件标记").toEqual([]);
    expect(
      closure.external.filter((specifier) => specifier === UI_KIT_SPECIFIER),
      "advanced 不得引用官方 UI Kit",
    ).toEqual([]);
  });

  it("正证：同样的判据在根入口闭包上必须命中组件标记（证明它不是恒真）", () => {
    const rootClosure = closureOf(resolve(DIST, "index.mjs"));
    expect(rootClosure.files.length).toBeGreaterThan(1);
    expect(markersIn(rootClosure).length, "根入口闭包里应当有组件标记").toBeGreaterThan(0);
  });

  it("包级前提：sideEffects 为 false、且 ./advanced 子路径确实指向 ESM 产物", () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, "package.json"), "utf8")) as {
      sideEffects?: boolean;
      exports?: Record<string, { import?: string; types?: string }>;
    };
    expect(pkg.sideEffects, "sideEffects 不是 false：tree-shaking 承诺不成立").toBe(false);
    expect(pkg.exports?.["./advanced"]?.import).toBe("./dist/advanced.mjs");
    expect(pkg.exports?.["./advanced"]?.types).toBe("./dist/advanced.d.ts");
    // 正证：dist 里确实有这两个产物（防止上面两条只是在对着一份被改坏的 exports 断言）
    expect(existsSync(resolve(DIST, "advanced.mjs"))).toBe(true);
    expect(existsSync(resolve(DIST, "advanced.d.ts"))).toBe(true);
  });

  it("dist 里的每个入口都真的有对应产物（清单驱动，避免只验了 advanced）", () => {
    const entries = readdirSync(DIST).filter((name) => name.endsWith(".mjs") && !name.includes("-"));
    expect(entries.length, "dist 顶层应当有多个 ESM 入口").toBeGreaterThan(3);
    for (const entry of entries) {
      expect(entry).toMatch(/^[a-z-]+\.mjs$/);
    }
  });
});
