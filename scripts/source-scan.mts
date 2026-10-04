/**
 * 源码文件收集与解析层（AST 门禁共用）
 *
 * `check-raw-sdk.mts` 的两套规则集（raw SDK 边界 / 旧引擎残留）扫的是**同一类输入**：
 * `src` 树里的 `.ts` / `.mts` / `.vue`（`.vue` 要先用官方 SFC 解析器抽出脚本区块，再把
 * 区块内容交给同一套 AST 规则并按 `block.loc.start.offset` 映射回源文件行列）。
 *
 * 差异只在「扫哪些文件」与「判哪些规则」，因此这里抽出来共用——第二份 SFC 提取实现迟早会
 * 与第一份漂移（`generic` 属性里的 `>`、结束标签带空白这类边界都踩过）。#136 起两条规则集
 * 由**同一个**门禁进程在**同一个**文件收集层上跑（此前是两个脚本各跑一遍）。
 *
 * 规则引擎本身仍在 `raw-sdk-detector.mts`（纯 AST，不认识文件系统）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { parse as parseSfc, type SFCBlock } from "vue/compiler-sfc";
import { collectViolations } from "./raw-sdk-detector.mts";

/** 测试文件：与门禁的扫描对象（运行时源码）分开，**默认**跳过。 */
export const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts)$/;

/** 需要解析的源文件扩展名（`.vue` 走 SFC 分支）。 */
export const SOURCE_FILE = /\.(ts|vue|mts)$/;

/** 所有违规记录共有的形状（规则名由各门禁自己定义）。 */
export interface ScannableViolation {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: string;
}

/**
 * 单个脚本区块的规则收集器。参数与 `raw-sdk-detector.collectViolations` 对齐：
 * `astText` 是要解析的文本，`locationText` / `offset` 用于把 `.vue` 区块偏移映射回源文件。
 */
export type SourceVisitor<V extends ScannableViolation> = (
  file: string,
  astText: string,
  locationText: string,
  offset: number,
  violations: V[],
  kind: ts.ScriptKind,
) => void;

export interface CollectFilesOptions {
  /** 返回 true 表示跳过该文件（例如白名单目录）。参数是**绝对路径**。 */
  skip?: (file: string) => boolean;
  /** 是否一并收测试文件，默认 false。 */
  includeTests?: boolean;
}

/** 递归收集目录下的源文件（跳过 `node_modules`；测试文件按 `includeTests` 决定）。 */
export function collectSourceFiles(dir: string, options: CollectFilesOptions = {}): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...collectSourceFiles(full, options));
    } else if (SOURCE_FILE.test(entry)) {
      if (!options.includeTests && TEST_FILE.test(entry)) continue;
      if (options.skip?.(full)) continue;
      out.push(full);
    }
  }
  return out;
}

function scanVue<V extends ScannableViolation>(
  file: string,
  text: string,
  violations: V[],
  failures: string[],
  visitor: SourceVisitor<V>,
): void {
  let descriptor;
  let errors;
  try {
    ({ descriptor, errors } = parseSfc(text, { filename: file }));
  } catch (error) {
    failures.push(`${file}: SFC parse threw: ${(error as Error)?.message ?? String(error)}`);
    return;
  }
  if (errors.length > 0 || !descriptor) {
    const message = errors
      .map((e) => ("message" in e ? e.message : String(e)))
      .filter(Boolean)
      .join("; ");
    failures.push(`${file}: SFC parse failed${message ? `: ${message}` : ""}`);
    return;
  }
  const blocks: SFCBlock[] = [descriptor.script, descriptor.scriptSetup].filter(
    (b): b is SFCBlock => Boolean(b),
  );
  for (const block of blocks) {
    const kind =
      block.lang === "tsx"
        ? ts.ScriptKind.TSX
        : block.lang === "jsx"
          ? ts.ScriptKind.JSX
          : ts.ScriptKind.TS;
    // block.loc.start.offset 指向脚本内容起点,直接映射回源文件行列
    visitor(file, block.content, text, block.loc.start.offset, violations, kind);
  }
}

/**
 * 扫描单个源文件并把违规追加进 `violations`。
 *
 * SFC 解析失败会记进 `failures`（调用方必须把它当成失败，**不得**静默放行）。
 */
export function scanSourceFile<V extends ScannableViolation>(
  file: string,
  text: string,
  violations: V[],
  failures: string[],
  visitor: SourceVisitor<V>,
): void {
  if (file.endsWith(".vue")) {
    scanVue(file, text, violations, failures, visitor);
    return;
  }
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  visitor(file, text, text, 0, violations, kind);
}

export interface ScanSourceDirsOptions<V extends ScannableViolation> {
  /** 报告用路径基准（相对化），省略时用文件绝对路径。 */
  root?: string;
  /** 规则收集器，缺省为 raw SDK 边界门禁用的 `collectViolations`。 */
  visitor?: SourceVisitor<V>;
  includeTests?: boolean;
}

/**
 * 这个源文件里**真正调用**了哪个 `<script setup>` 宏。
 *
 * ## 为什么必须是 AST 而不是文本查找
 *
 * `<script setup>` 宏（`defineSlots` / `defineProps` / `defineEmits` …）在源码里的
 * 出现位置有两类：**调用**与**注释**。而本仓库的组件普遍带一段解释「为什么需要写
 * `defineSlots`」的注释，注释里**必然**出现 `defineSlots` 这个词（#188 评审 P1）。
 * 于是 `source.includes("defineSlots")` 在宏调用**被删掉**时依然为 true ——
 * 这条判据声称守住的回归（删掉 `defineSlots` 让声明退回悬空形态）它自己拦不住。
 *
 * 判据落在**真实的 CallExpression** 上：`ts.isCallExpression` 且被调用表达式是
 * 该标识符。注释在 AST 里根本不存在，因此注释里写多少遍都不影响判定。
 *
 * 刻意只认**直接标识符调用**（`defineSlots<…>()`），不认 `foo.defineSlots()` 或
 * 解构后别名 —— SFC 编译器同样只认前者，后者出现时那条判据本就无意义。
 *
 * 返回**名字集合**（`Set`，天然去重、保持首次出现顺序）而不是布尔：调用点不止一个时
 * （比如同时有 `defineProps` 与 `defineEmits`），「哪些宏被调用了」比「有没有调用过」
 * 信息更多，且便于门禁指出**缺哪一个**而不是只答「有没有」。
 *
 * SFC 解析失败**抛错**，与本文件既有的 `scanVue` / `scanSourceFile` 一致（它们把失败
 * 记进调用方给的 `failures` 并要求调用方当失败处理）。这里选择直接抛：调用方是
 * 「要求 `defineSlots` 必须存在」的判据，解析失败时返回空集会让它报成「这个组件缺
 * `defineSlots`」—— 一个与真实原因无关的结论，而门禁最忌讳的就是这种假红。
 */
export function calledSetupMacros(file: string, text: string): Set<string> {
  const macros = new Set<string>();
  const collect = (astText: string, kind: ts.ScriptKind): void => {
    const source = ts.createSourceFile(file, astText, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.startsWith("define") &&
        node.expression.text.length > "define".length
      ) {
        macros.add(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  if (!file.endsWith(".vue")) {
    collect(text, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return macros;
  }
  let descriptor: ReturnType<typeof parseSfc>["descriptor"];
  let errors: ReturnType<typeof parseSfc>["errors"];
  try {
    ({ descriptor, errors } = parseSfc(text, { filename: file }));
  } catch (error) {
    throw new Error(`${file}: SFC parse threw: ${(error as Error)?.message ?? String(error)}`);
  }
  if (errors.length > 0 || !descriptor) {
    const message = errors
      .map((e) => ("message" in e ? e.message : String(e)))
      .filter(Boolean)
      .join("; ");
    throw new Error(`${file}: SFC parse failed${message ? `: ${message}` : ""}`);
  }
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    collect(
      block.content,
      block.lang === "tsx" ? ts.ScriptKind.TSX : block.lang === "jsx" ? ts.ScriptKind.JSX : ts.ScriptKind.TS,
    );
  }
  return macros;
}

/**
 * 这个源文件里**真正 import** 的模块 specifier 集合。
 *
 * 刻意走 AST 的 `ImportDeclaration.moduleSpecifier` 而不是正则（#188 评审 P2）：
 * 正则会把**注释掉的** import 也算成命中 —— `// import { X } from "pkg/ui-kit"`
 * 同样匹配 `from "…"`。而那个模块此时根本不在 TypeScript program 里，
 * 要验的编译**实际没跑过它**，覆盖判据却报「已覆盖」。
 *
 * 收 `import type` 与不收没区别：判据是「这个模块进了 program」，两种导入都做到这一点。
 * 刻意**不**收 `export … from` 与动态 `import()`：前者不引入新的依赖边，
 * 后者的 specifier 只有字面量形式才可静态判定 —— 两者都不是「import 了它」的同一件事。
 *
 * 放在这个文件里而不是门禁脚本，是为了让门禁与它的自测**读同一处实现**
 * （`scripts/api-forgotten-boundary.mts` 是同一个理由的先例：门禁脚本顶层就跑 `main()`，
 * 用例 import 它会连带触发整轮分析）。两份实现各改一处、两层一起漂移，正是评审抓到的失效方式。
 */
export function probeImportSpecifiers(file: string, text: string): Set<string> {
  const specifiers = new Set<string>();
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.moduleSpecifier === undefined) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    specifiers.add(statement.moduleSpecifier.text);
  }
  return specifiers;
}

export interface ScanSourceDirResult {
  /** 实际参与解析的文件数（门禁用它做「非空守卫」，避免扫到空目录也算通过）。 */
  readonly scanned: number;
  /** 报告用路径（相对化后）→ 源文件绝对路径。 */
  readonly files: readonly string[];
}

/**
 * 扫描一组目录；违规追加进 `violations`，无法解析的输入记进 `failures`。
 *
 * 返回值里的 `scanned` 是「真的解析了几个文件」——门禁必须把它写进成功输出，
 * 否则扫描范围配错的空转与「真的干净」在日志上长得一模一样。
 */
export function scanSourceDirs<V extends ScannableViolation>(
  dirs: readonly { dir: string; skip?: (file: string) => boolean }[],
  violations: V[],
  failures: string[],
  options: ScanSourceDirsOptions<V> = {},
): ScanSourceDirResult {
  const visitor = options.visitor ?? (collectViolations as unknown as SourceVisitor<V>);
  const files: string[] = [];
  for (const { dir, skip } of dirs) {
    for (const file of collectSourceFiles(dir, { skip, includeTests: options.includeTests })) {
      const rel =
        options.root && file.startsWith(options.root)
          ? file.slice(options.root.length + 1)
          : file;
      files.push(rel);
      scanSourceFile(rel, readFileSync(file, "utf8"), violations, failures, visitor);
    }
  }
  return { scanned: files.length, files };
}
