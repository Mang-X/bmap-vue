/**
 * `./ui-kit` 子路径的入口形状、产物隔离与消费方验证（R25-D / issue #73）
 *
 * 覆盖 issue 的两条硬验收：
 * - 「basic consumer 不含 UI Kit 运行代码或 CSS；UI consumer 的样式/类型/事件可用」；
 * - 「根入口不运行时重导出 UI」（ADR 2026-09-13 决策 3、4）。
 *
 * 证据分三层，缺一层都可能是假绿：
 * 1. **包清单形状**：`exports["./ui-kit"]` 与 optional peer 的精确锁定；
 * 2. **产物图**：从 `dist/index.mjs` 出发走一遍相对导入闭包，断言闭包里根本没有 UI Kit
 *    ——「不含」必须是遍历出来的结论，而不是 grep 了一个文件；
 * 3. **真实打包**：用 Vite 各打一次 basic / UI 消费方（生产模式），basic 产物必须没有
 *    UI Kit 代码与样式，UI 产物必须**有**样式与运行代码（正向对照，否则第 2 层可能是空转）。
 *
 * 类型可用性由 `verify:package`（`fixtures/consumer` 里 import `bmap-vue/ui-kit`
 * 后 `vue-tsc --noEmit`）在 CI 里验证；本文件只断言声明产物自身不引用上游类型包。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "vite";

const repoRoot = resolve(import.meta.dirname, "../..");
const pkgRoot = join(repoRoot, "packages/bmap-vue");
const distDir = join(pkgRoot, "dist");
const distIndex = join(distDir, "index.mjs");
const distUiKit = join(distDir, "ui-kit.mjs");

/** UI Kit 运行时的可辨识标记（出现在官方 ESM 产物里，用于确认「真的打进去了」）。 */
const UI_KIT_CODE_MARKERS = ["BMAP_AUTHENTIC_KEY", "getSeckeyAndSign"];
/** UI Kit 样式表的可辨识标记。 */
const UI_KIT_CSS_MARKER = "bmap-ui-";

function readPackageJson(): {
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
} {
  return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as never;
}

/** 从入口出发，沿**相对**导入收集 ESM 闭包。 */
function esmClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    const specifiers = [
      ...[...code.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]!),
      ...[...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]!),
      ...[...code.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((match) => match[1]!),
    ];
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolve(dirname(file), specifier);
      if (existsSync(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("包清单与产物形状", () => {
  it("exports 暴露 ./ui-kit → dist/ui-kit.mjs + dist/ui-kit.d.ts", () => {
    const pkg = readPackageJson();
    expect(pkg.exports?.["./ui-kit"]).toEqual({
      types: "./dist/ui-kit.d.ts",
      import: "./dist/ui-kit.mjs",
    });
    expect(existsSync(distUiKit)).toBe(true);
    expect(existsSync(join(distDir, "ui-kit.d.ts"))).toBe(true);
  });

  it("官方 UI Kit 是 exact 锁定的 optional peer（不装也能用根入口）", () => {
    const pkg = readPackageJson();
    // 「optional」只表示不使用 UI 的消费者可以不装，不表示可以在它缺失时改走自研实现。
    expect(pkg.peerDependencies?.["@baidumap/jsapi-ui-kit"]).toBe("1.1.2");
    expect(pkg.peerDependenciesMeta?.["@baidumap/jsapi-ui-kit"]?.optional).toBe(true);
  });

  it("ui-kit 入口只在运行时按需 import 上游包，且不内联它的运行代码", () => {
    const code = readFileSync(distUiKit, "utf8");
    // 字面量 specifier：变量形式会让消费方的打包器无法把它当可选依赖处理。
    expect(code).toContain('import("@baidumap/jsapi-ui-kit")');
    for (const marker of UI_KIT_CODE_MARKERS) {
      expect(code, `UI Kit 运行代码不该被内联进 dist（命中 ${marker}）`).not.toContain(marker);
    }
  });

  it("声明产物不引用上游类型包（消费者无需安装它也能拿到类型）", () => {
    const dts = readFileSync(join(distDir, "ui-kit.d.ts"), "utf8");
    expect(dts).toContain("PlaceSuggestionDTO");
    // 只在**代码位置**禁止引用：文档注释里提到包名/样式路径是允许的（也是必要的）。
    expect(dts).not.toMatch(/from\s*["']@baidumap\/jsapi-ui-kit/);
    expect(dts).not.toMatch(/import\s*\(\s*["']@baidumap\/jsapi-ui-kit/);
    expect(dts).not.toMatch(/declare\s+module\s+["']@baidumap\/jsapi-ui-kit/);
    expect(dts).not.toMatch(/from\s*["']@baidumap\/jsapi-v4-types/);
    expect(dts).not.toContain('/// <reference types="@baidumap');
    // 权威判定是 `pnpm check:public-dts`（AST 级、覆盖整个 dist），这里只做入口侧的粗筛。
    expect(dts).not.toMatch(/:\s*BMapGL\./);
  });

  it("四个组件在声明里都是 Vue 组件（不是把上游的类透出去）", () => {
    const dts = readFileSync(join(distDir, "ui-kit.d.ts"), "utf8");
    for (const name of ["BPlaceAutocomplete", "BPlaceSearch", "BPlaceDetail", "BRoutePlan"]) {
      // 上游的 widget 是普通 class（`export declare class PlaceDetail extends BaseWidget`），
      // 若被原样重新导出，`destroy()` 的所有权就落到用户手上，`app.use` 之类的遍历也会
      // 把它当组件；因此这里逐名断言「声明成 DefineComponent」。
      expect(dts, `${name} 的声明应当是 Vue 组件`).toContain(`export declare const ${name}: DefineComponent<`);
    }
    // 上游类名不得出现在声明里（连类型引用也不该有）。
    expect(dts).not.toMatch(/\bdeclare class (PlaceDetail|RoutePlan)\b/);
  });

  it("被 expose 的 status 在声明里就是取值类型（runtime 经 proxyRefs 后不是 Ref）", () => {
    const dts = readFileSync(join(distDir, "ui-kit.d.ts"), "utf8");
    // `defineExpose({ status })` 会经 Vue 的 proxyRefs 解包：runtime 读到的是字符串，
    // 声明里若写 `Ref<UiKitWidgetStatus>`，声明与 runtime 就不一致。
    // 注意区分：composable 返回值上的 `readonly status: Ref<…>` 是它本来的语义，不算。
    // 因此按「整行以 `status:` 开头」筛（`readonly status:` 天然被排除）。
    const declared = dts
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^status:\s*\S.*;$/.test(line));
    expect(declared, "四个组件的 exposed status 各应有一处声明").toHaveLength(4);
    for (const line of declared) {
      expect(line, `status 的声明必须与 runtime 一致：${line}`).not.toContain("Ref<");
      expect(line).toContain("UiKitWidgetStatus");
    }
  });
});

describe("根入口与 UI 子路径的产物隔离", () => {
  it("dist/index.mjs 的整条 ESM 闭包里没有 UI Kit（运行代码与样式都没有）", () => {
    const closure = esmClosure(distIndex);
    // 正证守卫：闭包确实被遍历到了（否则「没有 UI Kit」是一句空话）。
    expect(closure.length).toBeGreaterThan(3);
    expect(closure.some((file) => file.endsWith("index.mjs"))).toBe(true);

    for (const file of closure) {
      const code = readFileSync(file, "utf8");
      expect(code, `${relative(repoRoot, file)} 引用了 UI Kit`).not.toContain("@baidumap/jsapi-ui-kit");
      for (const marker of UI_KIT_CODE_MARKERS) {
        expect(code, `${relative(repoRoot, file)} 含 UI Kit 运行代码（${marker}）`).not.toContain(marker);
      }
      expect(code, `${relative(repoRoot, file)} 含 UI Kit 样式`).not.toContain(UI_KIT_CSS_MARKER);
    }
  });

  it("本库自己产出的 CSS 里没有 UI Kit 样式（样式不进根入口）", () => {
    const ownCss = listFiles(distDir).filter((file) => file.endsWith(".css"));
    // 至少要有一份自己的样式产物，否则这条断言没有意义。
    expect(ownCss.length).toBeGreaterThan(0);
    for (const file of ownCss) {
      expect(readFileSync(file, "utf8")).not.toContain(UI_KIT_CSS_MARKER);
    }
  });

  it("导出的样式路径就是官方样式表本身（文档与代码不会漂移）", async () => {
    const { UI_KIT_STYLE_PATH, UI_KIT_PACKAGE } = (await import(distUiKit)) as {
      UI_KIT_STYLE_PATH: string;
      UI_KIT_PACKAGE: string;
    };
    expect(UI_KIT_PACKAGE).toBe("@baidumap/jsapi-ui-kit");
    expect(UI_KIT_STYLE_PATH).toBe(`${UI_KIT_PACKAGE}/dist/css/jsapi-ui-kit.css`);
    const styleFile = join(repoRoot, "node_modules", UI_KIT_STYLE_PATH);
    expect(existsSync(styleFile)).toBe(true);
    expect(readFileSync(styleFile, "utf8")).toContain(UI_KIT_CSS_MARKER);
  });

  it("两个入口共用同一份 `BMapError` 实现（消费者 `instanceof` 跨入口可用）", () => {
    const uiKitClosure = esmClosure(distUiKit);
    const errorChunk = uiKitClosure.find((file) =>
      readFileSync(file, "utf8").includes("src/core/errors/BMapError.ts"),
    );
    // 正证守卫：ui-kit 侧的闭包里确实带着错误类的实现（否则下面那条断言没有对象）。
    expect(errorChunk, "ui-kit 入口的闭包里找不到 BMapError 的实现").toBeTruthy();
    // 根入口的闭包必须含**同一个文件**：`BRoutePlan` 的 `error` 事件载荷与 `search()` 的拒绝
    // 都是这个类的实例，消费者从 `./core` 拿到的 `BMapError` 要能 `instanceof` 通过。
    // 两份实现会让它静默失效（类型上还长得一样，运行时判不出）。
    expect(esmClosure(distIndex), "两个入口各带一份 BMapError，`instanceof` 会失效").toContain(
      errorChunk,
    );
  });

  it("入口导出面：四个组件 + 桥 + 加载器；上游新增成员不会顺手变成组件", async () => {
    const exported = (await import(distUiKit)) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(
      [
        "BPlaceAutocomplete",
        "BPlaceDetail",
        "BPlaceSearch",
        "BRoutePlan",
        "RoutePlanDrivingPolicy",
        "UI_KIT_PACKAGE",
        "UI_KIT_STYLE_PATH",
        "isUiKitLoaded",
        "loadUiKit",
        "useUiKitWidget",
      ].sort(),
    );
    // 四个标准 UI 都有薄封装（#73 两个 + #75 两个）。「它们确实是组件、而不是把上游的类
    // 原样透出去」由下一条断言读声明产物锁定（上游类被透出去会把 `destroy()` 的所有权
    // 落到用户手上，也会被 `app.use` 之类的遍历当成组件）。
  });
});

describe("真实生产构建下的消费方行为", () => {
  const workDir = join(repoRoot, ".artifacts", "ui-kit-consumer");
  const aliases = [
    { find: /^bmap-vue$/, replacement: distIndex },
    { find: /^bmap-vue\/ui-kit$/, replacement: distUiKit },
  ];

  async function buildConsumer(name: string, entrySource: string): Promise<string> {
    const projectDir = join(workDir, name);
    const outDir = join(projectDir, "out");
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(projectDir, { recursive: true });
    const entry = join(projectDir, "entry.ts");
    writeFileSync(entry, entrySource);
    await build({
      root: projectDir,
      configFile: false,
      logLevel: "error",
      resolve: { alias: aliases },
      build: {
        outDir,
        emptyOutDir: true,
        cssCodeSplit: false,
        minify: false,
        lib: { entry, formats: ["es"], fileName: () => "consumer.mjs" },
        rollupOptions: { external: ["vue"] },
      },
    });
    return projectDir;
  }

  function outputsOf(projectDir: string): { code: string; css: string } {
    const files = listFiles(projectDir).filter((file) => /\.(mjs|js|css)$/.test(file));
    const code = files
      .filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const css = files
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    return { code, css };
  }

  it("basic consumer：不含 UI Kit 运行代码，也不含 UI Kit 样式", async () => {
    const projectDir = await buildConsumer(
      "basic",
      [
        'import { BMap, createBMapPlugin } from "bmap-vue";',
        "export const ok = typeof BMap !== 'undefined' && typeof createBMapPlugin === 'function';",
        "",
      ].join("\n"),
    );
    const { code, css } = outputsOf(projectDir);

    // 正证守卫：确实打进了本库的代码（否则「没有 UI Kit」可能只是打空了）。
    expect(code).toContain("BMAP_");
    // 标记的有效性在**本用例内**自证：这些字符串必须真的存在于官方产物里。
    // 否则「产物里没有这些标记」只能说明标记写错了，而不是 UI Kit 没被打进来。
    const upstreamCode = readFileSync(
      join(repoRoot, "node_modules", "@baidumap/jsapi-ui-kit", "dist", "jsapi-ui-kit.esm.js"),
      "utf8",
    );
    for (const marker of UI_KIT_CODE_MARKERS) {
      expect(upstreamCode, `标记 ${marker} 在官方产物里不存在，说明挑选的标记失效了`).toContain(marker);
    }
    const upstreamCss = readFileSync(
      join(repoRoot, "node_modules", "@baidumap/jsapi-ui-kit", "dist", "css", "jsapi-ui-kit.css"),
      "utf8",
    );
    expect(upstreamCss).toContain(UI_KIT_CSS_MARKER);

    for (const marker of [...UI_KIT_CODE_MARKERS, UI_KIT_CSS_MARKER]) {
      expect(code, `basic consumer 产物含 UI Kit 标记 ${marker}`).not.toContain(marker);
    }
    expect(css).toBe("");
  });

  it("UI consumer：样式与运行代码都可用（四个组件都进了产物）", async () => {
    const projectDir = await buildConsumer(
      "ui",
      [
        'import { BPlaceAutocomplete, BPlaceDetail, BPlaceSearch, BRoutePlan, loadUiKit } from "bmap-vue/ui-kit";',
        'import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";',
        "export const ok = [BPlaceAutocomplete, BPlaceSearch, BPlaceDetail, BRoutePlan, loadUiKit].every(Boolean);",
        "",
      ].join("\n"),
    );
    const { code, css } = outputsOf(projectDir);

    // 样式：消费方显式引用的官方样式表必须在生产产物里活着。
    expect(css).toContain(UI_KIT_CSS_MARKER);
    // 运行代码：动态 import 被解析并单独成块（说明它确实只在需要时才加载）。
    const bundleHasUiKit = UI_KIT_CODE_MARKERS.some((marker) => code.includes(marker));
    expect(bundleHasUiKit, "UI consumer 产物里没有 UI Kit 运行代码").toBe(true);
    // 组件自身也在产物里（四个 host class 名逐一点到：只查一个会让「某组件被 tree-shaking
    // 丢掉」这件事查不出来）。
    for (const hostClass of [
      "b-place-autocomplete",
      "b-place-search",
      "b-place-detail",
      "b-route-plan",
    ]) {
      expect(code, `UI consumer 产物里没有 ${hostClass}`).toContain(hostClass);
    }
  });
});
