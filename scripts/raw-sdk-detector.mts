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
import { GLOBAL_OBJECT_NAMES, OFFICIAL_TYPES_PACKAGE } from "./raw-sdk-boundary.mts";

export type Rule =
  | "legacy-namespace"
  | "global-member"
  | "namespace-root"
  | "type-position"
  | "namespace-declaration"
  | "official-types-import"
  | "official-types-reference";

export const RULE_LABELS: Record<Rule, string> = {
  "legacy-namespace": "迁移期全局命名空间 BMapGL 越界",
  "global-member": "全局对象成员访问 window/globalThis.BMap",
  "namespace-root": "BMap.* 成员访问 / new BMap.*",
  "type-position": "BMap.* 类型位置引用",
  "namespace-declaration": "namespace BMap / declare global 声明",
  "official-types-import": "具名导入官方类型包",
  "official-types-reference": "三斜线 types 引用官方类型包",
};

export interface Violation {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: Rule;
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

/** 稳定排序：文件 → 行 → 列。泛型以便其它门禁（如 no-bmapgl）复用自己的违规类型。 */
export function sortViolations<T extends { file: string; line: number; column: number }>(
  violations: T[],
): T[] {
  return [...violations].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}
