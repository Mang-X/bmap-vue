/**
 * raw SDK AST 检测引擎（M3A0-03 / issue #15）
 *
 * 单一实现，被源码门禁（`check-raw-sdk.mts`）与公共声明门禁
 * （`check-public-dts.mts`）共用，避免两套规则漂移。
 *
 * 只识别真正的 AST 结构（标识符 / 成员访问 / 类型位置 / 命名空间声明 /
 * 导入声明），注释、正则字面量、普通字符串天然不参与匹配。
 */
import * as ts from "typescript";
import {
  GLOBAL_OBJECT_NAMES,
  LEGACY_ENGINE_IDS,
  LEGACY_RULE_LABELS,
  OFFICIAL_TYPES_PACKAGE,
  type LegacyRule,
} from "./raw-sdk-boundary.mts";

export type Rule =
  | "legacy-namespace"
  | "global-member"
  | "namespace-root"
  | "type-position"
  | "namespace-declaration"
  | "official-types-import"
  | "official-types-reference";

export const RULE_LABELS: Record<Rule, string> = {
  "legacy-namespace": "旧引擎全局命名空间 BMapGL 越界（该引擎已删除）",
  "global-member": "全局对象成员访问 window/globalThis.BMap",
  "namespace-root": "BMap.* 成员访问 / new BMap.*",
  "type-position": "BMap.* 类型位置引用",
  "namespace-declaration": "namespace BMap / declare global 声明",
  "official-types-import": "具名导入官方类型包",
  "official-types-reference": "三斜线 types 引用官方类型包",
};

export { LEGACY_RULE_LABELS };
export type { LegacyRule };

export interface Violation {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: Rule;
}

/** 旧引擎残留的违规记录：形状与 `Violation` 相同，`rule` 收窄成 `LegacyRule`。 */
export interface LegacyViolation {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: LegacyRule;
}

const V4_NAMESPACE = "BMap";
const LEGACY_NAMESPACE = "BMapGL";
const GLOBALS = new Set<string>(GLOBAL_OBJECT_NAMES);

/** 去掉括号 / `as` / 非空断言 / `satisfies` 包装，得到真正的表达式节点。 */
export function unwrapExpression(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current)) {
      current = current.expression;
    } else if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (
      typeof ts.isSatisfiesExpression === "function" &&
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** `<global>.BMap` 中的 `<global>` 是否为 window/globalThis/self/global。 */
export function isGlobalObjectExpression(node: ts.Node): boolean {
  const inner = unwrapExpression(node);
  return ts.isIdentifier(inner) && GLOBALS.has(inner.text);
}

/**
 * 解包后是否为 v4 命名空间标识符本身（`BMap`）。
 *
 * 成员/方括号访问、构造与调用都要基于**接收者的根标识符**判断，否则
 * `new (BMap as any).Point()` 这类等价写法会漏报。注意只接受标识符本身，
 * 因此 `BMapProvider`、`BMapProps` 等复合名不会被误判。
 */
function unwrapsToNamespace(node: ts.Node): boolean {
  const inner = unwrapExpression(node);
  return ts.isIdentifier(inner) && inner.text === V4_NAMESPACE;
}

function isNamespaceName(node: ts.Node): boolean {
  return ts.isIdentifier(node) && (node.text === V4_NAMESPACE || node.text === LEGACY_NAMESPACE);
}

/** 判断单个节点是否命中某条规则；命中返回规则名。 */
export function matchRule(node: ts.Node): Rule | undefined {
  // 1) 迁移期命名空间 `BMapGL`：一律越界（全局、别名、字符串键、类型位置）
  if (isNamespaceName(node) && node.text === LEGACY_NAMESPACE) return "legacy-namespace";
  if (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === LEGACY_NAMESPACE
  ) {
    return "legacy-namespace";
  }

  // 2) 全局对象成员：window.BMap / globalThis.BMap / (window as any).BMap / window["BMap"]
  if (ts.isPropertyAccessExpression(node)) {
    if (isNamespaceName(node.name) && isGlobalObjectExpression(node.expression)) {
      return "global-member";
    }
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    if (
      key &&
      (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
      (key.text === V4_NAMESPACE || key.text === LEGACY_NAMESPACE) &&
      isGlobalObjectExpression(node.expression)
    ) {
      return "global-member";
    }
  }

  // 3) `BMap.*` 值位置：成员访问 / 方括号访问 / 构造 / 调用
  //    接收者先解包 `( )` 与 `as` / 非空 / `satisfies` 断言，否则
  //    `new (BMap as any).Point()`、`new (BMap).Point()`、`BMap["Point"]()`
  //    这类等价写法会绕过；`h(BMap)` / `{ BMap }` 等把 BMap 当值的用法不受影响。
  if (ts.isPropertyAccessExpression(node) && unwrapsToNamespace(node.expression)) {
    return "namespace-root";
  }
  if (ts.isElementAccessExpression(node) && unwrapsToNamespace(node.expression)) {
    return "namespace-root";
  }
  if (ts.isNewExpression(node) && node.expression && unwrapsToNamespace(node.expression)) {
    return "namespace-root";
  }
  if (ts.isCallExpression(node) && unwrapsToNamespace(node.expression)) {
    return "namespace-root";
  }

  // 3b) `BMap.*` 类型位置
  if (ts.isIdentifier(node) && node.text === V4_NAMESPACE) {
    const parent = node.parent;
    if (ts.isQualifiedName(parent) && parent.left === node) return "type-position";
    if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return "type-position";
    if (ts.isTypeQueryNode(parent) && parent.exprName === node) return "type-position";
    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) {
      return "type-position";
    }
  }

  // 4) 命名空间声明：namespace BMap(BMapGL) / declare global {}
  if (ts.isModuleDeclaration(node)) {
    if (isNamespaceName(node.name)) return "namespace-declaration";
    if (ts.isIdentifier(node.name) && node.name.text === "global") return "namespace-declaration";
  }

  // 5) 官方类型包具名导入 / import type
  if (ts.isImportDeclaration(node)) {
    const spec = node.moduleSpecifier;
    if (ts.isStringLiteral(spec) && spec.text === OFFICIAL_TYPES_PACKAGE) {
      return "official-types-import";
    }
  }
  if (ts.isImportTypeNode(node)) {
    const arg = node.argument;
    if (
      ts.isLiteralTypeNode(arg) &&
      ts.isStringLiteral(arg.literal) &&
      arg.literal.text === OFFICIAL_TYPES_PACKAGE
    ) {
      return "official-types-import";
    }
  }

  return undefined;
}

export interface LineIndex {
  starts: number[];
}

export function buildLineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return { starts };
}

export function locate(index: LineIndex, abs: number): { line: number; column: number } {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid] <= abs) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: abs - index.starts[lo] + 1 };
}

/**
 * 解析 `astText` 并收集越界访问。
 * `locationText` / `offset` 用于把 `.vue` SFC 脚本区块的偏移映射回源文件行列；
 * 对普通 `.ts` 文件两者分别为 `astText` 与 `0`。
 */
export function collectViolations(
  file: string,
  astText: string,
  locationText: string,
  offset: number,
  violations: Violation[],
  kind: ts.ScriptKind = ts.ScriptKind.TS,
): void {
  const ast = ts.createSourceFile(file, astText, ts.ScriptTarget.Latest, true, kind);
  const lines = locationText.split("\n");
  const index = buildLineIndex(locationText);

  const report = (node: ts.Node, rule: Rule): void => {
    const { line, column } = locate(index, offset + node.getStart(ast));
    violations.push({ file, line, column, text: (lines[line - 1] ?? "").trim(), rule });
  };

  const visit = (node: ts.Node): void => {
    const rule = matchRule(node);
    if (rule) report(node, rule);
    ts.forEachChild(node, visit);
  };
  visit(ast);

  // 三斜线 `/// <reference types="..." />` 是注释，AST 里不可见，必须用
  // `preProcessFile` 按包名判定（官方支持 `preserve` 等属性与 `types = "..."`
  // 这类带空格的写法，正则匹配属性排列会漏报）。SFC 区块同样会被处理。
  for (const directive of ts.preProcessFile(astText, false, false).typeReferenceDirectives) {
    if (directive.fileName !== OFFICIAL_TYPES_PACKAGE) continue;
    const { line, column } = locate(index, offset + directive.pos);
    violations.push({
      file,
      line,
      column,
      text: (lines[line - 1] ?? "").trim(),
      rule: "official-types-reference",
    });
  }
}

/** 便捷入口：扫描单个 TypeScript 源文本。 */
export function findViolations(
  file: string,
  text: string,
  kind: ts.ScriptKind = ts.ScriptKind.TS,
): Violation[] {
  const violations: Violation[] = [];
  collectViolations(file, text, text, 0, violations, kind);
  return violations;
}

/** 稳定排序：文件 → 行 → 列。泛型以便各门禁复用自己的违规类型。 */
export function sortViolations<T extends { file: string; line: number; column: number }>(
  violations: T[],
): T[] {
  return [...violations].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

/** 已删除的 engine 取值集合（精确匹配字符串字面量）。 */
const LEGACY_ENGINE_ID_SET: ReadonlySet<string> = new Set(LEGACY_ENGINE_IDS);

/**
 * 收集「已删除的旧引擎残留」：`BMapGL` 标识符 / 精确字符串键 / `namespace BMapGL` 声明，
 * 以及 `"webgl-v1"` / `"jsapi-v3"` 这两个已删除的 engine 取值。
 *
 * ## 为什么是独立 visitor，而不是给 `matchRule` 加个 flag
 *
 * `check-public-dts.mts` 也调 `findViolations` / `collectViolations`。把 `removed-engine-id`
 * 塞进共享的 `Rule` 联合与 `RULE_LABELS`，会让公共声明门禁**免费**多出一条它并不需要的规则，
 * 还会让 `--print-boundary` 的输出漂移。规则集不同，就该用不同的 visitor。
 *
 * ## 为什么必须自带一遍 AST walk（而不是复用 `matchRule`）
 *
 * `matchRule` 的 `namespace-declaration` 是**双用途**规则（`raw-sdk-detector.mts` 的
 * `isNamespaceName` 同时接受 `BMap` 与 `BMapGL`），按规则**名字**过滤会**静默**漏掉
 * `namespace BMapGL`——而那正是最该抓的那条。所以这里从 AST 节点**重新判定**。
 *
 * ## 覆盖范围
 *
 * 白名单目录（`driver/**`、`client/**`、`core/loader/**`、`plugins/**`）**允许** `BMap.*`
 * ——那是它们存在的理由；但它们同样**不允许**旧引擎残留。因此 `check-raw-sdk.mts` 的
 * `--src` 树模式在白名单内也跑本 visitor。
 *
 * ## 刻意不误伤的两类文本
 *
 * - **官方插件命名空间 `BMapGLLib`**（`TrackAnimation` / `DrawingManager` / `GeoUtils` 的
 *   CDN URL 与全局）：`BMapGLLib` 是**单个标识符**，`node.text` 为 `"BMapGLLib"`，与
 *   `"BMapGL"` 精确不等；CDN URL 是整串字面量，也不等。全程无 prefix/contains 判定。
 * - **注释与长文本里对 `BMapGL` 的提及**（迁移说明、历史注释）：AST 看不见注释；
 *   长文本的 `StringLiteral.text` 整串不等于 `"BMapGL"`。
 */
export function collectLegacyViolations(
  file: string,
  astText: string,
  locationText: string,
  offset: number,
  violations: LegacyViolation[],
  kind: ts.ScriptKind = ts.ScriptKind.TS,
): void {
  const ast = ts.createSourceFile(file, astText, ts.ScriptTarget.Latest, true, kind);
  const lines = locationText.split("\n");
  const index = buildLineIndex(locationText);

  const report = (node: ts.Node, rule: LegacyRule): void => {
    const { line, column } = locate(index, offset + node.getStart(ast));
    violations.push({ file, line, column, text: (lines[line - 1] ?? "").trim(), rule });
  };

  const visit = (node: ts.Node): void => {
    const rule = matchRule(node);
    // `matchRule` 把 `namespace BMapGL` 与 `namespace BMap` / `declare global` 归到同一条
    // 双用途规则上，这里按节点**重新判定**，否则白名单目录里的 `namespace BMapGL` 会漏报。
    if (rule === "legacy-namespace") {
      report(node, "legacy-namespace");
    } else if (
      rule === "namespace-declaration" &&
      ts.isModuleDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === LEGACY_NAMESPACE
    ) {
      report(node, "legacy-namespace");
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      LEGACY_ENGINE_ID_SET.has(node.text)
    ) {
      report(node, "removed-engine-id");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
