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
const STRICT_TSCONFIG = resolve(ROOT, "fixtures/consumer/strict/tsconfig.json");

const require_ = createRequire(resolve(PKG, "package.json"));
const ts = require_("typescript") as typeof import("typescript");

/**
 * 出口 specifier → 它在 `dist/` 里的声明文件。**单一名单**：`paths` 映射、
 * 「探针是否覆盖」与「dist 是否已构建」三处都从这里派生 ——
 * 三份平行名单里少改一处，那一处就成了没人验的出口。
 *
 * 刻意列出而不是「import 什么算什么」：探针少 import 一个出口，那道出口的声明
 * 就没人验了，而门禁仍然全绿。名单与 `package.json#exports` 的键一一对应
 * （`tests/behavior/dts-strict-gate.test.ts` 从 manifest 派生并逐个核对）。
 */
const SUBPATH_TO_DTS: ReadonlyMap<string, string> = new Map([
  ["@mangax/bmap-vue", "index"],
  ["@mangax/bmap-vue/components", "components"],
  ["@mangax/bmap-vue/composables", "composables"],
  ["@mangax/bmap-vue/plugins", "plugins"],
  ["@mangax/bmap-vue/resolver", "resolver"],
  ["@mangax/bmap-vue/advanced", "advanced"],
  ["@mangax/bmap-vue/ui-kit", "ui-kit"],
]);

const REQUIRED_SUBPATHS = [...SUBPATH_TO_DTS.keys()];

/** `ts.CompilerOptions.paths` 形态：裸包名 → 工作区内刚构建出的 dist 声明。 */
const PATHS: Record<string, string[]> = Object.fromEntries(
  [...SUBPATH_TO_DTS].map(([specifier, entry]) => [
    specifier,
    [resolve(PKG, `dist/${entry}.d.ts`)],
  ]),
);

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
  const missing = REQUIRED_SUBPATHS.map((subpath) =>
    resolve(PKG, "dist", `${SUBPATH_TO_DTS.get(subpath)!}.d.ts`),
  ).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `[check-dts-strict] dist 缺少声明产物：${missing.map((f) => f.replace(ROOT + "/", "")).join(", ")}\n` +
        `  先跑 pnpm build:package（门禁按 CI 顺序：typecheck 在 build 之前）。`,
    );
  }
}

/**
 * 严格消费的 compilerOptions，**从 `fixtures/consumer/strict/tsconfig.json` 读**。
 *
 * 刻意不在脚本里内联一份：那份 tsconfig 才是「严格消费」这件事的可读定义
 * （`skipLibCheck: false` + `strict`），脚本内联第二份就成了两处判据 ——
 * 改了 tsconfig 而忘了改脚本（或反过来）时，两份会静默漂移，而其中一份
 * 没有任何东西读它。单一事实源在这里。
 *
 * 读不���、或关键判据被改掉，都判失败（fail-closed）：
 * 「判据读不出来」与「判据通过」必须可区分。
 */
function readStrictCompilerOptions(): ts.CompilerOptions {
  if (!existsSync(STRICT_TSCONFIG)) {
    throw new Error(
      `[check-dts-strict] 严格消费配置不存在：${STRICT_TSCONFIG} —— 没有它就没有判据。`,
    );
  }
  const raw = JSON.parse(readFileSync(STRICT_TSCONFIG, "utf8")) as {
    compilerOptions?: Record<string, unknown>;
  };
  const options = raw.compilerOptions;
  if (options === undefined) {
    throw new Error(`[check-dts-strict] ${STRICT_TSCONFIG} 没有 compilerOptions 段。`);
  }
  // 判据的两个支点。改动它们等于改动这道门禁的意义，所以必须显式确认。
  if (options.skipLibCheck !== false) {
    throw new Error(
      `[check-dts-strict] ${STRICT_TSCONFIG} 的 skipLibCheck 必须是 false，当前是 ` +
        `${JSON.stringify(options.skipLibCheck)} —— 改成 true 的话 .d.ts 内部从不被检查，` +
        `声明里的悬空标识符可以完全无感地发布（那正是 #188 的原始缺陷）。`,
    );
  }
  if (options.strict !== true) {
    throw new Error(
      `[check-dts-strict] ${STRICT_TSCONFIG} 的 strict 必须是 true，当前是 ` +
        `${JSON.stringify(options.strict)}。`,
    );
  }

  // 其余选项逐个映射到 Compiler API 的枚举值。只映射用得到的这几个 ——
  // 引入完整转换器就得为「多一个字段」维护一份映射表，而这份配置是本门禁自己写的。
  const parsed = ts.parseJsonConfigFileContent(
    { compilerOptions: options, include: [] },
    ts.sys,
    dirname(STRICT_TSCONFIG),
  );
  return { ...parsed.options, noEmit: true, baseUrl: ROOT, paths: PATHS };
}

function main(): void {
  if (!existsSync(PROBE)) {
    throw new Error(`[check-dts-strict] 探针不存在：${PROBE}`);
  }
  const source = readFileSync(PROBE, "utf8");
  assertProbeCoversEverySubpath(source);
  assertDistBuilt();

  const program = ts.createProgram([PROBE], readStrictCompilerOptions());

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