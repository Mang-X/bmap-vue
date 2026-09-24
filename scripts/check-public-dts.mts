/**
 * 公共声明门禁：主包公开 `dist/**` 下的 `*.d.ts` 不得泄漏官方 SDK 命名空间
 * （M3A0-04 / issue #15）
 *
 * 消费者应能只安装 `bmap-vue` + `vue` 就获得完整类型，无需安装
 * `@baidumap/jsapi-v4-types`，也不会看到 `BMap.*` 全局命名空间。
 *
 * 检查项：
 *   1. `namespace BMap` / `namespace BMapGL` / `declare global` 声明；
 *   2. `BMap.*` 成员访问、类型位置引用与 `BMapGL` 标识符（复用源码门禁的检测引擎，
 *      因此 `export { BMap }` 这类组件同名导出不会被误判）；
 *   3. 三斜线 `/// <reference types="@baidumap/jsapi-v4-types" />` 与具名导入
 *      （由共享检测引擎按**包名**判定，不依赖属性排列与空格）；
 *   4. 类型边界文件（`driver/jsapi-v4/**`）不得进入发布产物。
 *
 * 用法：
 *   node --experimental-strip-types scripts/check-public-dts.mts
 *   node --experimental-strip-types scripts/check-public-dts.mts --dir <dist>
 *
 * 前置：需先执行 `pnpm build:package` 生成声明产物。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { boundarySummary } from "./raw-sdk-boundary.mts";
import { RULE_LABELS, findViolations } from "./raw-sdk-detector.mts";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_DIST = join(ROOT, "packages/bmap-vue/dist");

/** 发布产物中禁止出现的边界目录（源码侧类型边界，见 augmentations 治理规则）。 */
const BOUNDARY_PATH_MARKERS = ["driver/jsapi-v4"] as const;

interface DtsIssue {
  file: string;
  line?: number;
  column?: number;
  rule: string;
  text: string;
}

function collectDtsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      collectDtsFiles(full, out);
    } else if (entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function sortIssues(issues: DtsIssue[]): DtsIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--print-boundary")) {
    console.log(JSON.stringify({ ...boundarySummary(), rules: RULE_LABELS }, null, 2));
    return;
  }

  const dirFlag = argv.indexOf("--dir");
  const distDir = dirFlag !== -1 ? resolve(argv[dirFlag + 1] ?? "") : DEFAULT_DIST;

  if (!existsSync(distDir)) {
    console.error(
      `public d.ts gate FAILED: declarations not found at ${relative(ROOT, distDir) || distDir}. Run \`pnpm build:package\` first.`,
    );
    process.exit(1);
  }

  const files = collectDtsFiles(distDir);
  if (files.length === 0) {
    console.error(
      `public d.ts gate FAILED: no *.d.ts found under ${distDir}. Run \`pnpm build:package\` first.`,
    );
    process.exit(1);
  }

  const issues: DtsIssue[] = [];

  for (const file of files) {
    const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
    const text = readFileSync(file, "utf8");

    const relFromDist = relative(distDir, file).replace(/\\/g, "/");
    for (const marker of BOUNDARY_PATH_MARKERS) {
      if (relFromDist.includes(marker)) {
        issues.push({
          file: rel,
          rule: "boundary-file-published",
          text: `类型边界文件不得进入发布产物: ${relFromDist}`,
        });
      }
    }

    // 三斜线 `/ <reference types=...>` 与具名导入统一由共享检测引擎给出
    // （按包名判定，兼容 `preserve` 等属性与 `types = "..."` 空格写法）。
    for (const v of findViolations(rel, text)) {
      issues.push({ file: v.file, line: v.line, column: v.column, rule: v.rule, text: v.text });
    }
  }

  if (issues.length > 0) {
    console.error(
      `public d.ts gate FAILED: ${issues.length} issue(s) across ${files.length} declaration file(s).`,
    );
    for (const issue of sortIssues(issues)) {
      const position = issue.line ? `:${issue.line}:${issue.column ?? 1}` : "";
      console.error(`  ${issue.file}${position} -> ${issue.text}  [${issue.rule}]`);
    }
    console.error(
      "Public declarations must stay free of BMap.* / BMapGL; fix the source boundary or the augmentation filtering in vite.config.build.ts.",
    );
    process.exit(1);
  }

  console.log(
    `public d.ts gate OK: ${files.length} declaration file(s) clean (no ${boundarySummary().namespaces.join(" / ")} leakage).`,
  );
}

main();
