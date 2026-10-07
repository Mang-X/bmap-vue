#!/usr/bin/env node
/**
 * pnpm 配置卫生检查（issue #187 / #192）
 *
 * 只判三件**在真实世界被违反过**的事，见 `toolchain-boundary.mts` 文件头的表格。
 * 版本基线（vue-tsc / language-core / …）记在 ADR，不做成门禁。
 *
 * ```bash
 * pnpm check:toolchain
 * ```
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkLockfileOverrides,
  checkManifestPnpmField,
  checkPackageManagerDrift,
  parseRunningPnpmVersion,
  type HygieneIssue,
} from "./toolchain-boundary.mts";

const root = resolve(import.meta.dirname, "..");

function fail(issues: readonly HygieneIssue[]): never {
  console.error(`\n[check-toolchain] FAIL：${issues.length} 条`);
  for (const i of issues) console.error(`  - [${i.kind}] ${i.detail}`);
  process.exit(1);
}

function bail(kind: HygieneIssue["kind"], detail: string): never {
  fail([{ kind, detail }]);
}

const issues: HygieneIssue[] = [];

/* --------------------------------------------------------- 1) manifest 无 pnpm 字段 */

const manifestPath = resolve(root, "package.json");
if (!existsSync(manifestPath)) bail("manifest-has-pnpm-field", "找不到根 package.json（fail-closed）");

let manifest: Record<string, unknown>;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
} catch {
  bail("manifest-has-pnpm-field", "根 package.json 解析失败（fail-closed）");
}
issues.push(...checkManifestPnpmField(manifest));

/* -------------------------------------------------- 2) lockfile 里无生效的 override */

const lockPath = resolve(root, "pnpm-lock.yaml");
if (!existsSync(lockPath)) bail("lockfile-has-overrides", "找不到 pnpm-lock.yaml（fail-closed）");
try {
  issues.push(...checkLockfileOverrides(readFileSync(lockPath, "utf8")));
} catch {
  bail("lockfile-has-overrides", "pnpm-lock.yaml 读取失败（fail-closed）");
}

/* -------------------------------------- 3) packageManager 声明 == 当前真正运行的 pnpm */

/**
 * 问当前真正执行的 pnpm 它自己是哪个版本。
 *
 * 只能这么问：`packageManager` 与 lockfile 都只记录「应该用哪个」，真正跑的那个由
 * corepack / CI 的 pnpm/action-setup 决定，不写进任何文件。
 *
 * ⚠️ 解析走 `parseRunningPnpmVersion()` 的**完整匹配**（#196 评审 P1）：从输出里
 * 「找一段 `x.y.z`」会把 `12.0.0-rc.1` 截成 `12.0.0`，让 prerelease runner 假绿。
 */
function probeRunningPnpm(): string | undefined {
  try {
    const out = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseRunningPnpmVersion(out);
  } catch {
    return undefined;
  }
}

const declaredPm = typeof manifest.packageManager === "string" ? manifest.packageManager : undefined;
const runningPm = probeRunningPnpm();
issues.push(...checkPackageManagerDrift(declaredPm, runningPm));

if (issues.length > 0) fail(issues);

console.log("[check-toolchain] OK：pnpm 配置卫生");
console.log(`  声明 ${declaredPm ?? "—"} / 运行 ${runningPm ?? "—"}`);
console.log("  版本基线（vue-tsc / language-core / typescript / …）见 ADR 2026-10-02，不在本门禁范围。");