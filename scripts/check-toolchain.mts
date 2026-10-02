#!/usr/bin/env node
/**
 * 声明工具链门禁：核对**实际生效**的版本，而不是声明面上的声称（issue #187）
 *
 * ## 为什么要有这道门禁
 *
 * 本票的起因是一句**失效的版本声称**：根 `package.json` 曾把 `pnpm.overrides` 写在
 * `package.json#pnpm` 字段里，而 pnpm 12 早就不读该字段——每次干净安装都打印
 * `[WARN] The "pnpm" field in package.json is no longer read by pnpm`。于是那份 override
 * 从写下起就没生效过，却看起来像一道版本锁：
 *
 * 1. `pnpm-lock.yaml` 里没有 `overrides:` 块（pnpm 会记录生效的 override，缺失即未应用）；
 * 2. 实际解析与它相反：包构建走 `vue-tsc@2.2.12`，只有 `docs` 走 `3.3.11`；
 * 3. 它写的 `@vue/language-core: "2.2.0"` 这个版本**根本不存在**。
 *
 * 删除那句声称之后，必须补上真实的钉子，否则「工具链版本是什么」仍然只存在于记忆里。
 *
 * ## 判据：三方对照
 *
 * `package.json`（声明面）不是事实——`^2.2.0` 今天解析到 `2.2.12`，下次 install 可能就变了。
 * 事实是 `pnpm-lock.yaml` 里 importer 下的 `version:`，而它又要与 `node_modules` 里真实
 * 安装的版本一致。三方任一漂移都红。判据内核（可被用例 import 的纯函数）在
 * `toolchain-boundary.mts`。
 *
 * ## 为什么不用 YAML 库
 *
 * 仓库此前**没有任何脚本读 lockfile**，也没有直接依赖 YAML 解析器（`yaml` 只是传递依赖）。
 * 为一次定向读取引入生产依赖不划算：lockfile 的 `importers` 段缩进固定、字段有限，
 * `parseImporterBlock` 的定向解析足够，且解析不出东西时 fail-closed（判失败而非放行）。
 * 判据逻辑本身全在可单测的内核里，解析只是搬运。
 *
 * ## 用法
 *
 * ```bash
 * pnpm check:toolchain
 * ```
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  KNOWN_PEER_MISMATCHES,
  TOOLCHAIN_PINS,
  auditPins,
  checkInstalled,
  checkPeerMismatches,
  checkPin,
  checkDeclaredSpecifier,
  declaredVersion,
  parseImporterBlock,
  type DeclaredManifest,
  type ToolchainIssue,
} from "./toolchain-boundary.mts";

const root = resolve(import.meta.dirname, "..");

function fail(lines: readonly string[]): never {
  console.error(`\n[check-toolchain] FAIL：${lines.length} 条`);
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

/** 从某个 importer 目录的 `node_modules/<pkg>/package.json` 读真实安装版本。 */
function readInstalledVersion(importer: string, name: string): string | undefined {
  const pkgJson = resolve(root, importer, "node_modules", name, "package.json");
  if (!existsSync(pkgJson)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/** 从某个 importer 的 `package.json` 取声明面。 */
function readManifest(importer: string): DeclaredManifest {
  const pkgJson = resolve(root, importer === "." ? "" : importer, "package.json");
  if (!existsSync(pkgJson)) return {};
  try {
    return JSON.parse(readFileSync(pkgJson, "utf8")) as DeclaredManifest;
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------- 1) 基线表自洽性 */

const pinIssues = auditPins();
if (pinIssues.length > 0) {
  fail(pinIssues.map((i) => `[${i.kind}] ${i.detail}`));
}

/* ------------------------------------ 2) 声明 → lockfile → 磁盘 三方对照 */

const lockPath = resolve(root, "pnpm-lock.yaml");
if (!existsSync(lockPath)) {
  fail(["找不到 pnpm-lock.yaml：判定没有真的发生（fail-closed）"]);
}
const lockText = readFileSync(lockPath, "utf8");

const issues: ToolchainIssue[] = [];
const rows: string[] = [];

for (const pin of TOOLCHAIN_PINS) {
  const lockEntry = parseImporterBlock(lockText, pin.importer, pin.name, pin.which ?? "workspace");
  issues.push(...checkPin(pin, lockEntry));

  // `pnpm` 自身不在 node_modules（由 corepack / CI 的 pnpm/action-setup 提供），
  // 因此磁盘列对它显示 n/a 而不是「—」（那看起来像「找不到」）。
  const installed = pin.which === "packageManager" ? "n/a" : readInstalledVersion(pin.importer, pin.name);
  issues.push(...checkInstalled(pin, pin.which === "packageManager" ? pin.version : installed));

  const manifest = readManifest(pin.importer);
  const declared = declaredVersion(manifest, pin.name) ?? "—";
  // 声明面**也要判**，不能只打印：登记的基线必须与 package.json 真的声明的 specifier
  // 同源，否则「声明面改了、基线没改」这种漂移没有任何东西会发现。
  // 判据是「package.json 的 specifier 必须与 lockfile 里记录的 specifier 一致」——
  // 后者是 pnpm 实际解析所依据的那个，两者不一致就说明 lockfile 与 manifest 已经脱节。
  issues.push(...checkDeclaredSpecifier(pin, declared, lockEntry?.specifier));

  rows.push(
    `  ${pin.importer.padEnd(18)} ${pin.name.padEnd(28)} 声明 ${declared.padEnd(10)} 解析 ${(lockEntry?.version ?? "—").padEnd(28)} 磁盘 ${installed ?? "—"}`,
  );
}

console.log("[check-toolchain] 实际生效的声明工具链：");
for (const row of rows) console.log(row);

/* ---------------------------------------------- 3) 已审阅的 peer 不匹配 */

/**
 * 刻意接受的那一处 peer 不匹配，在这里**逐条打印**，并核对它「登记的事实」与磁盘一致。
 *
 * ## 为什么这里**没有**「扫全树找未登记的不匹配」的判据（实测三次才认出来）
 *
 * 试过，判断它做不到——不是调参问题，是**够不到**：
 *
 * - pnpm 的 isolated 布局下，`unplugin-dts`（`@vue/language-core ^3.1.5` 的来源）位于
 *   `node_modules/.pnpm/` 虚拟 store 的深层目录里，**不在**任何工作区包的
 *   `node_modules/<pkg>` 直系下。扫根 / `packages/bmap-vue` / `docs` 三处 `node_modules`
 *   实测只覆盖 **53 个包**，其中没有 `unplugin-dts`——判据恒为「没有不匹配」，
 *   与常量无异（而 `satisfiesRange` 那次假阳性恰恰说明它一旦「有输出」也不可靠）。
 * - 要真正覆盖就得遍历整个 `.pnpm/`（本仓约 829 个条目），代价与误报面都远超本票收益。
 *
 * 因此按 AGENTS.md「判据退化成常量、没有消费者的一律删除」**删掉那个判据**，
 * 保留本模块能**真正核对**的部分：`KNOWN_PEER_MISMATCHES` 里每一条的实装版本，
 * 必须与 `TOOLCHAIN_PINS` 登记的基线一致（否则登记已过期），并且磁盘上必须真的装了这个版本。
 *
 * 也就是说：登记本身会被核对，但**发现新错配的能力本票不具备**——这一点写进 ADR 的非目标，
 * 不假装它有。
 */
for (const known of KNOWN_PEER_MISMATCHES) {
  const pin = TOOLCHAIN_PINS.find((p) => p.name === known.name);
  if (pin === undefined) {
    issues.push({
      kind: "unexpected-peer-mismatch",
      detail: `${known.name} 登记为已知 peer 不匹配，但不在 TOOLCHAIN_PINS 里：无法核对它实际装了什么（fail-closed）`,
    });
    continue;
  }
  const installed = readInstalledVersion(pin.importer, pin.name);
  if (installed === undefined) {
    issues.push({
      kind: "disk-mismatch",
      detail: `${known.name} 读不到磁盘版本：先跑 \`pnpm install\`（fail-closed）`,
    });
    continue;
  }
  // 例外是**基于某个具体实装版本**成立的：版本一变（多半意味着升级到了满足上游 peer 范围的
  // 版本），这条例外就该被重审甚至删除。用**比较**而不是散文里 `includes` ——
  // 后者实测会漏（why 里出现两次该版本号，改一处仍为真）。
  if (installed !== known.observedVersion) {
    issues.push({
      kind: "unexpected-peer-mismatch",
      detail:
        `${known.name} 实装 ${installed}，但这条例外登记的是 ${known.observedVersion}：` +
        `升级后请重审——新版本可能正好满足上游 peer 范围，届时应删掉这条例外而不是留着`,
    });
  }
}

if (issues.length > 0) {
  fail(issues.map((i) => `[${i.kind}] ${i.detail}`));
}

console.log("\n[check-toolchain] OK：声明 / lockfile / 磁盘三方一致");
console.log("  已知且刻意接受的 peer 不匹配：");
for (const m of KNOWN_PEER_MISMATCHES) {
  console.log(`  - ${m.name}：${m.why}（追踪 ${m.tracking}）`);
}
console.log("  依据见 scripts/toolchain-boundary.mts#TOOLCHAIN_PINS 与 #KNOWN_PEER_MISMATCHES");
console.log("  工作区故意跑两个 vue-tsc major：包构建 2.x（产出声明）/ 文档站 3.x（校验声明）。");