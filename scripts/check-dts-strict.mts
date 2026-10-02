/**
 * 发布声明的**严格消费**门禁（issue #188）
 *
 * ## 为什么这道门禁存在
 *
 * 既有配置里**没有任何一处**用 `skipLibCheck: false` 检查发布声明：
 *
 * - `fixtures/consumer/tsconfig.json` 是 `skipLibCheck: true`（有意：它要验的是
 *   「文档示例能对着 tarball 编译」，不是「声明本身合法」）；
 * - `packages/bmap-vue/tsconfig.build.json` 虽然是 `false`，但它编译的是 `src/`，
 *   不是打包后的 `dist/*.d.ts`。
 *
 * 后果实测过：`dist/index.d.ts` 带着 **51 处**「找不到名字 `__VLS_1`」发布出去，
 * `check:api` 全绿（它挂在一个「预期失败即通过」的探针上），`verify:package` 全绿，
 * 消费方却在 `skipLibCheck: false` 下直接编译失败。**没有任何一道门禁会红。**
 *
 * ## 判据
 *
 * 把 `fixtures/consumer/strict/probe.ts` 当作一个真实消费方的源码，用 TypeScript
 * Compiler API 以 `skipLibCheck: false` 编译，**零错误**才算通过。
 *
 * 刻意用 Compiler API 而不是 `execFileSync('tsc')`：后者要求在临时目录里拼出一套
 * 能解析 `vue` 的 `node_modules`，而 pnpm 的符号链接布局（`vue` 的类型实际依赖
 * `.pnpm/vue@…/node_modules/@vue/*`）让这套拼装极易变成「红，但红的原因与本门禁无关」——
 * 实测第一次尝试就报了 10 条 `has no exported member 'ComputedRef'`，全是环境噪音。
 * 用 Compiler API 直接复用**工作区**的模块解析，判据落在声明面上，而不是落在
 * 「临时目录的 node_modules 拼对了没有」上。
 *
 * 探针本身有正反两侧（见 `probe.ts` 文件头）：合法 prop 必须通过、不存在的 prop 与
 * 类型写错的 prop 必须报 `@ts-expect-error`。**反侧是关键**——只测正向的话，
 * 声明面整体退化成 `any` 会让「能编译」变成恒真。
 *
 * ## 作用域
 *
 * 只覆盖 `.d.ts` 的**合法性**（能不能被严格模式消费方编译）。
 * 覆盖面分工见 `fixtures/consumer/strict/probe.ts` 与 `verify-package.mts`：
 * tarball 内容、ESM 可加载、SSR、样式与 UI 生命周期由 #158 的统一入口负责。
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = resolve(ROOT, "packages/bmap-vue");
const PROBE = resolve(ROOT, "fixtures/consumer/strict/probe.ts");

const require_ = createRequire(resolve(PKG, "package.json"));
const ts = require_("typescript") as typeof import("typescript");

/**
 * 探针里出现的每个出口都必须真的解析得到。
 *
 * 刻意列出而不是「import 什么算什么」：探针少 import 一个出口，那道出口的声明
 * 就没人验了，而门禁仍然全绿。名单与 `package.json#exports` 的键一一对应。
 */
const REQUIRED_SUBPATHS = [
  "@mangax/bmap-vue",
  "@mangax/bmap-vue/components",
  "@mangax/bmap-vue/composables",
  "@mangax/bmap-vue/plugins",
  "@mangax/bmap-vue/resolver",
  "@mangax/bmap-vue/advanced",
  "@mangax/bmap-vue/ui-kit",
] as const;

/** 探针源码里是否真的 import 了这个 specifier（判「名单与探针没有脱节」）。 */
function probeImports(specifier: string, source: string): boolean {
  return new RegExp(`from\\s*["']${specifier.replace("/", "\\/")}["']`).test(source);
}

function assertProbeCoversEverySubpath(source: string): void {
  const missing = REQUIRED_SUBPATHS.filter((s) => !probeImports(s, source));
  if (missing.length > 0) {
    throw new Error(
      `[check-dts-strict] 探针没有覆盖这些出口：${missing.join(", ")}\n` +
        `  它们在 package.json#exports 里存在，但探针没 import ⇒ 它们的声明没人验。`,
    );
  }
}

function assertDistBuilt(): void {
  const missing = REQUIRED_SUBPATHS.map((subpath) => {
    const name = subpath === "@mangax/bmap-vue" ? "index" : subpath.split("/").pop()!;
    return resolve(PKG, "dist", `${name}.d.ts`);
  }).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `[check-dts-strict] dist 缺少声明产物：${missing.map((f) => f.replace(ROOT + "/", "")).join(", ")}\n` +
        `  先跑 pnpm build:package（门禁按 CI 顺序：typecheck 在 build 之前）。`,
    );
  }
}

function main(): void {
  if (!existsSync(PROBE)) {
    throw new Error(`[check-dts-strict] 探针不存在：${PROBE}`);
  }
  const source = readFileSync(PROBE, "utf8");
  assertProbeCoversEverySubpath(source);
  assertDistBuilt();

  // `paths` 把裸包名映到**工作区内**刚构建出的 dist —— 与真实消费方解析到的东西
  // 是同一批文件，但不需要在临时目录里重建 node_modules。
  const paths: Record<string, string[]> = {
    "@mangax/bmap-vue": [resolve(PKG, "dist/index.d.ts")],
    "@mangax/bmap-vue/components": [resolve(PKG, "dist/components.d.ts")],
    "@mangax/bmap-vue/composables": [resolve(PKG, "dist/composables.d.ts")],
    "@mangax/bmap-vue/plugins": [resolve(PKG, "dist/plugins.d.ts")],
    "@mangax/bmap-vue/resolver": [resolve(PKG, "dist/resolver.d.ts")],
    "@mangax/bmap-vue/advanced": [resolve(PKG, "dist/advanced.d.ts")],
    "@mangax/bmap-vue/ui-kit": [resolve(PKG, "dist/ui-kit.d.ts")],
  };

  const program = ts.createProgram([PROBE], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    // **这道门禁的全部意义就在这一行**。`fixtures/consumer` 那份是 true，
    // 于是 .d.ts 内部从不被检查，悬空引用可以完全无感地发布出去。
    skipLibCheck: false,
    noEmit: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    baseUrl: ROOT,
    paths,
  });

  const diagnostics = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
  if (diagnostics.length === 0) {
    console.log(
      `[check-dts-strict] OK: ${REQUIRED_SUBPATHS.length} 个出口的声明在 skipLibCheck: false 下零错误。`,
    );
    return;
  }

  const lines = diagnostics.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (d.file === undefined || d.start === undefined) return `<global> TS${d.code}: ${message}`;
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    const where = d.file.fileName.replace(ROOT + "/", "");
    return `${where}:${line + 1}:${character + 1} TS${d.code}: ${message}`;
  });
  throw new Error(
    `[check-dts-strict] 发布声明在严格消费下有 ${diagnostics.length} 个错误：\n  - ${lines.join("\n  - ")}\n` +
      `  这意味着消费方开 skipLibCheck: false 时编译不过。TS2578（Unused '@ts-expect-error'）\n` +
      `  同样是缺陷：它说明探针里那条负向断言不再成立，声明面被放宽了。`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}