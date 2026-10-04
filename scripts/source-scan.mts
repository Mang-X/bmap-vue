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
