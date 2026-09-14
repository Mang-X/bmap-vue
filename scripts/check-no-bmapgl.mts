/**
 * `no-bmapgl` 门禁：本库运行时源码与公共声明不得再出现旧引擎痕迹（issue #26 / M3A3-REMOVE-LEGACY）
 *
 * M3A.3 删除了 `src/driver/webgl-v1`、`types/BMapGL` 与 `fake-bmapgl`，默认执行链只剩
 * `jsapi-v4` + 官方 Loader。这条门禁把「删除」变成**可持续的不变量**：两者都是「有人不小心
 * 把它加回来」才会失效的东西，只靠一次性的 diff 检查不住。
 *
 * ## 扫描范围（限定）
 *
 * | 相位 | 默认目录 | 内容 |
 * | --- | --- | --- |
 * | 源码 | `packages/baidu-map-gl-vue/src` | 本库运行时源码（跳过 `*.test.ts`） |
 * | 公共声明 | `packages/baidu-map-gl-vue/dist` | `*.d.ts`（前置：`pnpm build:v3`） |
 *
 * **明确不在扫描范围内**（否则就是误伤，也会逼出「为了过门禁而改注释」这种本末倒置）：
 *
 * - `node_modules` 与供应商包：官方 SDK / 插件脚本自己就是用 `BMapGL` 的（官方 4.0 入口把
 *   `BMapGL` 作为同一命名空间的别名挂上，UI Kit 也从它取配置）；
 * - 历史迁移文档（`docs/**`）：迁移指南必须能写出「旧版叫什么」；
 * - 明确的测试样例（`tests/**` 与 `packages/**` 里位于扫描边界之外的 Fake）：
 *   `packages/test-utils` 的 Fake v4 **刻意**按真实运行时的形状同时挂 `BMap` 与 `BMapGL`，
 *   它是「真实 SDK 的形状镜像」而不是本库回退旧引擎；
 * - **官方插件命名空间 `BMapGLLib`**（`TrackAnimation` / `DrawingManager` / `GeoUtils`）与
 *   它们的 CDN URL：那是官方 4.0 时代仍在用的插件库，字符前缀相同但**不是**旧引擎。
 *   规则按 AST 标识符判定，因此 `BMapGLLib` 天然不会命中。
 *
 * ## 规则
 *
 * 1. `legacy-namespace`：`BMapGL` 标识符 / 精确字符串键 / 类型位置 / `namespace BMapGL`
 *    （复用 `raw-sdk-detector.mts` 的 AST 规则，注释与长文本里的提及不参与匹配）；
 * 2. `removed-engine-id`：`"webgl-v1"` / `"jsapi-v3"` 这两个已删除的 engine 取值。
 *    「本库默认执行链只用 v4 与官方 Loader」这句验收标准必须有可执行的落点。
 *
 * 用法：
 *   node --experimental-strip-types scripts/check-no-bmapgl.mts
 *   node --experimental-strip-types scripts/check-no-bmapgl.mts --dir <srcTree>
 *   node --experimental-strip-types scripts/check-no-bmapgl.mts --declarations <distDir>
 */
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import {
  buildLineIndex,
  locate,
  matchRule,
  sortViolations,
  type Rule,
} from "./raw-sdk-detector.mts";
import { scanSourceDirs, type ScannableViolation } from "./source-scan.mts";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_SRC = join(ROOT, "packages/baidu-map-gl-vue/src");
const DEFAULT_DIST = join(ROOT, "packages/baidu-map-gl-vue/dist");

/** 本门禁只有两类规则；其余判定留在 `raw-sdk-detector.mts`（规则名不在这里重复定义）。 */
type NoLegacyRule = Rule | "removed-engine-id";

/** 已删除的 engine 取值（源码里再出现就是回退旧引擎的信号）。 */
const REMOVED_ENGINE_IDS = new Set(["webgl-v1", "jsapi-v3"]);

interface NoLegacyViolation extends ScannableViolation {
  rule: NoLegacyRule;
}

/**
 * 收集 `BMapGL` 与已删除 engine id 的违规。
 *
 * 只保留「旧引擎痕迹」这一类规则：raw SDK 门禁里的 `BMap.*` / 全局成员访问在
 * `driver/**`、`client/**`、`core/loader/**`、`plugins/**` 是**合法**的，本门禁扫的是整棵树，
 * 不能把它们一起拦下来。
 *
 * 这里自带一遍 AST walk（而不是复用 `collectViolations`）只是因为它要**过滤规则**并追加一条
 * 自己的规则；规则语义、行列定位与排序都来自 `raw-sdk-detector.mts`
 * （`matchRule` / `buildLineIndex` / `locate` / `sortViolations`），不另立一套判定。
 */
function collectNoLegacy(
  file: string,
  astText: string,
  locationText: string,
  offset: number,
  violations: NoLegacyViolation[],
  kind: ts.ScriptKind,
): void {
  const ast = ts.createSourceFile(file, astText, ts.ScriptTarget.Latest, true, kind);
  const lines = locationText.split("\n");
  const index = buildLineIndex(locationText);

  const report = (node: ts.Node, rule: NoLegacyRule): void => {
    const { line, column } = locate(index, offset + node.getStart(ast));
    violations.push({ file, line, column, text: (lines[line - 1] ?? "").trim(), rule });
  };

  const visit = (node: ts.Node): void => {
    const rule = matchRule(node);
    // `namespace BMapGL {}` 在 detector 里归 namespace-declaration；这里也按旧引擎痕迹处理
    if (rule === "legacy-namespace") {
      report(node, "legacy-namespace");
    } else if (
      rule === "namespace-declaration" &&
      ts.isModuleDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "BMapGL"
    ) {
      report(node, "legacy-namespace");
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      REMOVED_ENGINE_IDS.has(node.text)
    ) {
      report(node, "removed-engine-id");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

interface Phase {
  readonly label: string;
  readonly dir: string;
  /** 只收这些扩展名的产物（公共声明相位只认 `.d.ts`）。 */
  readonly skip?: (file: string) => boolean;
}

function runPhases(phases: readonly Phase[]): number {
  const violations: NoLegacyViolation[] = [];
  const failures: string[] = [];

  const result = scanSourceDirs(
    phases.map((phase) => ({ dir: phase.dir, skip: phase.skip })),
    violations,
    failures,
    { root: ROOT, visitor: collectNoLegacy },
  );

  if (violations.length > 0) {
    console.error(
      `no-bmapgl gate FAILED: 本库仍有 ${violations.length} 处旧引擎痕迹（${phases
        .map((phase) => phase.label)
        .join(" + ")}，共扫 ${result.scanned} 个文件）。`,
    );
    for (const v of sortViolations(violations)) {
      console.error(`  ${v.file}:${v.line}:${v.column} -> ${v.text}  [${v.rule}]`);
    }
    console.error(
      "旧引擎（webgl-v1 / BMapGL）已在 3.0 删除，只允许保留官方 4.0 的 BMap 命名空间与官方插件命名空间 BMapGLLib；" +
        "迁移说明写在 docs/zh-CN/guide/ 的迁移指南里，不要在运行时源码里回退。",
    );
    return 1;
  }

  if (failures.length > 0) {
    console.error("no-bmapgl gate FAILED (unparsable input; refusing to pass silently):");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    return 1;
  }

  console.log(
    `no-bmapgl gate OK: ${phases
      .map((phase) => `${phase.label}=${relative(ROOT, phase.dir) || phase.dir}`)
      .join(", ")} 无旧引擎痕迹（共扫 ${result.scanned} 个文件）。`,
  );
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);
  const dirFlag = argv.indexOf("--dir");
  const declarationsFlag = argv.indexOf("--declarations");

  if (dirFlag !== -1 || declarationsFlag !== -1) {
    const phases: Phase[] = [];
    if (dirFlag !== -1) {
      phases.push({
        label: "运行时源码",
        dir: resolve(argv[dirFlag + 1] ?? ""),
      });
    }
    if (declarationsFlag !== -1) {
      phases.push({
        label: "公共声明",
        dir: resolve(argv[declarationsFlag + 1] ?? ""),
        skip: (file) => !file.endsWith(".d.ts"),
      });
    }
    return runPhases(phases);
  }

  if (!existsSync(DEFAULT_SRC)) {
    console.error(`no-bmapgl gate FAILED: runtime source not found at ${DEFAULT_SRC}`);
    return 1;
  }
  if (!existsSync(DEFAULT_DIST)) {
    console.error(
      `no-bmapgl gate FAILED: declarations not found at ${relative(ROOT, DEFAULT_DIST)}. Run \`pnpm build:v3\` first.`,
    );
    return 1;
  }

  return runPhases([
    { label: "运行时源码", dir: DEFAULT_SRC },
    { label: "公共声明", dir: DEFAULT_DIST, skip: (file) => !file.endsWith(".d.ts") },
  ]);
}

process.exitCode = main();
