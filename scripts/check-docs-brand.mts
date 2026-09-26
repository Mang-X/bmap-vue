/**
 * 文档面静态门禁：已退役的发布身份不得回到**已发布**的文档面（issue #141）
 *
 * 判据见 `scripts/docs-brand-boundary.mts` 的文件头（为什么某些串刻意**不**收，
 * 以及每条规则的区分力来源）。
 *
 * 四个扫描相位各自报读数——逐相位是刻意的：合并成一个总数后，「某相位扫到 0 个」
 * 会被另一相位的读数掩盖。
 *
 * **fail-closed**：任一相位扫到 0 个文件即判失败。目录配错 / 被整体跳过时放行等于门禁空转，
 * 且「扫到 0 个」与「真的干净」在日志上必须长得不一样。
 *
 * **没有 `--check` / 写出模式**：这道门禁没有单一事实源要渲染，「期望输出」就是「零命中」，
 * 写模式无事可写。需要看规则表用 `--print-boundary`，需要看放行项用 `--list-escapes`。
 */
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  DOCS_BRAND_RULES,
  DOCS_EXTRA_READMES,
  DOCS_SCAN_PHASES,
  MAX_ESCAPES,
  docsBrandSummary,
  escapeReasonOf,
  isExcludedDocPath,
  ruleAppliesToFile,
  type DocsBrandRule,
  type DocsScanPhase,
} from "./docs-brand-boundary.mts";

const ROOT = resolve(import.meta.dirname, "..");

export interface BrandHit {
  file: string;
  line: number;
  column: number;
  text: string;
  rule: string;
}

export interface BrandEscape {
  file: string;
  line: number;
  reason: string;
}

function describe(phase: DocsScanPhase): string {
  return `${phase.label}=${phase.dir === "" ? "." : phase.dir}`;
}

/** 递归收目录下匹配扩展名的文件（跳过符号链接与排除区）。 */
function collectFiles(dir: string, phase: DocsScanPhase): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      // **按链接本身判，不按名字判**：`docs/node_modules` 是 pnpm 的符号链接，`statSync`
      // 会跟随它，于是扫描会走出 docs/ 把整个依赖树收进来。写成 `entry === "node_modules"`
      // 的特判只挡住这一个名字；任何别的越界链接都照样穿透。用 `lstatSync`（不跟随链接）
      // 判链接本身才是根因修法。
      if (lstatSync(full).isSymbolicLink()) continue;
      const rel = relative(ROOT, full).replace(/\\/g, "/");
      if (isExcludedDocPath(rel)) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (phase.extensions.some((ext) => rel.endsWith(ext))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * 报告 / 规则分派用的路径。
 *
 * 真实扫描用仓库相对路径（scoped 规则据此判断「这是不是 nav/sidebar 配置文件」）；
 * `--dir` 夹具在仓库外，改用**扫描根相对**路径，于是夹具里造一个
 * `docs/.vitepress/configs/sidebar.config.zh.ts` 同样能命中 scoped 规则——
 * 否则门禁自测永远测不到 scoped 规则，测出来的是「恒不命中」的空绿。
 */
function reportPath(file: string, reportRoot: string): string {
  const rel = relative(reportRoot, file).replace(/\\/g, "/");
  return rel.startsWith("..") ? relative(ROOT, file).replace(/\\/g, "/") : rel;
}

/**
 * 扫一个文件，把违规追加进 `hits`、放行项追加进 `escapes`。
 *
 * 逐行处理是刻意的：豁免是**行级**的（只豁免它出现的那一行），逐文件判断做不到这件事。
 */
export function scanText(file: string, text: string, hits: BrandHit[], escapes: BrandEscape[]): void {
  const rules = DOCS_BRAND_RULES.filter((rule) => ruleAppliesToFile(rule, file));
  text.split(/\r?\n/).forEach((line, index) => {
    const reason = escapeReasonOf(line);
    if (reason) {
      escapes.push({ file, line: index + 1, reason });
    }
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (!match) continue;
      if (rule.isCompliant?.(line, match[0])) continue;
      if (reason) continue;
      hits.push({ file, line: index + 1, column: match.index + 1, text: match[0], rule: rule.id });
    }
  });
}

interface PhaseScan {
  phase: DocsScanPhase;
  scanned: number;
}

function runPhases(phases: readonly DocsScanPhase[], reportRoot: string = ROOT, listEscapes = false): number {
  const hits: BrandHit[] = [];
  const escapes: BrandEscape[] = [];

  const scans: PhaseScan[] = phases.map((phase) => {
    const absDir = resolve(reportRoot, phase.dir);
    const files =
      phase.extensions.includes("file")
        ? [absDir, ...DOCS_EXTRA_READMES.map((f) => resolve(ROOT, f))].filter((f) =>
            statSync(f, { throwIfNoEntry: false })?.isFile(),
          )
        : statSync(absDir, { throwIfNoEntry: false })?.isDirectory()
          ? collectFiles(absDir, phase)
          : [];
    for (const file of files) {
      scanText(reportPath(file, reportRoot), readFileSync(file, "utf8"), hits, escapes);
    }
    return { phase, scanned: files.length };
  });

  const scanLabel = scans.map(({ phase, scanned }) => `${describe(phase)}:${scanned} 个文件`).join(", ");

  if (hits.length > 0) {
    console.error(
      `docs brand scan FAILED [${phases.map(describe).join(", ")}]: ${hits.length} 处退役品牌串（${scanLabel}）。`,
    );
    for (const h of hits) {
      console.error(`  ${h.file}:${h.line}:${h.column} -> ${h.text}  [${h.rule}]`);
    }
    console.error(
      "Retired release identity must not reappear on the published surface. 1.0 is a clean-slate release:" +
        "\n  - package name is `bmap-vue`; components dropped the `B` prefix (#135); the old engine and all migration baggage are gone (#136)." +
        "\nLegal upstream references stay allowed: the official jsapi-loader `version: '3.0'` option, `BMap.*` as the JSAPI 4.0 namespace," +
        "\nthe official plugin namespace `BMapGLLib`, the live CDN global `BMapVue`, and the yue1123/vue3-baidu-map-gl MIT attribution." +
        `\n${docsBrandSummary().escapeHint}` +
        `\nBudget: ${escapes.length}/${MAX_ESCAPES} escapes used.` +
        "\nRule table: scripts/docs-brand-boundary.mts.",
    );
    return 1;
  }

  // 空转守卫（fail-closed）：某个相位一个文件都没扫到时，它**什么都没检查**。
  const empty = scans.filter((scan) => scan.scanned === 0);
  if (empty.length > 0) {
    console.error(
      `docs brand scan FAILED: 扫描范围为空（${empty.map(({ phase }) => describe(phase)).join(", ")}）` +
        `——${scanLabel}。一个文件都没扫到说明目录配错或被整体跳过，此时放行等于门禁空转。`,
    );
    return 1;
  }

  if (escapes.length > MAX_ESCAPES) {
    console.error(
      `docs brand scan FAILED: 逐行豁免 ${escapes.length} 处，超过预算 ${MAX_ESCAPES}——豁免变多说明规则判据本身该改，不是豁免该加。`,
    );
    for (const e of escapes) {
      console.error(`  ${e.file}:${e.line} -> ${e.reason}`);
    }
    return 1;
  }

  console.log(
    `docs brand scan OK: ${phases.map(describe).join(", ")} are clean. (${scanLabel}; ${escapes.length} 处放行)`,
  );
  // 放行项在**通过**时也要可见：逐行豁免的价值全在「理由跟着文本走、review 看得见」，
  // 只在超标失败路径上打印等于没人看。`--list-escapes` 把它们逐条 dump 出来。
  if (listEscapes) {
    console.log("逐行豁免：");
    for (const e of escapes) {
      console.log(`  ${e.file}:${e.line} -> ${e.reason}`);
    }
  }
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);

  if (argv.includes("--print-boundary")) {
    console.log(JSON.stringify(docsBrandSummary(), null, 2));
    return 0;
  }

  // `--dir`：调用方（门禁自测）指定的那棵树整体按 docs 相位扫一遍。
  // 夹具在仓库外，于是 `relative(ROOT, file)` 形如 `../../tmp/x.md`，与 scoped 规则的仓库相对路径
  // 对不上。这里把**扫描根**也传下去，报告里优先用它算仓库相对路径——它在夹具里就是那棵树本身。
  const dirFlag = argv.indexOf("--dir");
  if (dirFlag !== -1) {
    const root = resolve(argv[dirFlag + 1] ?? "");
    return runPhases(
      [{ label: "explicit-dir", dir: root, extensions: [".md", ".vue", ".ts", ".mts"] }],
      root,
    );
  }

  return runPhases(DOCS_SCAN_PHASES, ROOT, argv.includes("--list-escapes"));
}

process.exitCode = main();
