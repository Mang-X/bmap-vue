#!/usr/bin/env node
/**
 * 由**入库快照**生成 / 校验人读视图（issue #140）
 *
 * ```bash
 * pnpm generate:official-contrast:reference          # 写回性能文档
 * pnpm generate:official-contrast:reference:check    # CI 门禁：漂移即红
 * ```
 *
 * ## 这一层存在的理由
 *
 * 票面验收第二条要求「至少一份人读报告**解释**『简单路径成本』和『高级路径收益』」——
 * **解释**，不是把表格打印出来。风险有两类，都靠这道工序挡住：
 *
 * 1. **两份事实源漂移**：快照 JSON 一套数字、markdown 又手抄一套，下次更新快照忘了更新文档，
 *    两边慢慢对不上，而且**没有任何门禁会响**。所以文档里那段是**生成物**，唯一输入是
 *    `recorded-result.json`，`--check` 按字节比对。
 * 2. **措辞漂移成成绩单**：手写文档很容易在迭代里变成「本库快 X 倍」。渲染措辞因此写死在
 *    `referenceReport.mts` 里（不排序、不给百分比/倍数、毫秒必须带「非跨机阈值」那句），
 *    改文案等于改代码，会过评审。
 *
 * ## 与 `perf:contrast` 的分工（刻意不合并）
 *
 * `perf:contrast` 跑基准、出**当轮**报告、判 CI；本脚本**不跑基准**，只把**已入库的快照**
 * 渲染成人读视图。两者刻意不合成一条命令——否则「跑一次基准」会顺手改文档与快照，
 * 而快照应该只在**人工确认读数**之后显式更新。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATASET_VERSION } from "../tests/performance/dataset.ts";
import {
  checkReferenceResult,
  REFERENCE_RESULT_VERSION,
  type ReferenceResult,
} from "../tests/performance/official-contrast/reference.mts";
import {
  formatReferenceReport,
  REFERENCE_TABLE_BEGIN,
  REFERENCE_TABLE_END,
} from "../tests/performance/official-contrast/referenceReport.mts";
import { CONTRAST_SCENARIO_IDS } from "../tests/performance/officialScenarios.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const REFERENCE_PATH = resolve(
  repoRoot,
  "tests/performance/official-contrast/recorded-result.json",
);
const DOC_PATH = resolve(repoRoot, "docs/zh-CN/contributing/performance-baseline.md");

/** 快照读不出来时以脚手架失败 2 退出（1 留给别处的「不变式被破坏」语义）。 */
function fail(message: string): never {
  console.error(`[generate:official-contrast] ${message}`);
  process.exit(2);
}

function readReference(): ReferenceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(REFERENCE_PATH, "utf8"));
  } catch (error) {
    fail(
      `读不出快照（${REFERENCE_PATH}）：${error instanceof Error ? error.message : String(error)}\n` +
        `  快照没有入库就没有人读视图可生成——先跑一次 perf:contrast 并用 --record-reference 录它。`,
    );
  }
  // ⚠️ 「没读进快照」是脚手架问题（2），不是性能问题。**不**拿它去判 0/1/3 那套
  // ——快照本来就不参与性能判定（见 reference.mts 文件头）。
  const issues = checkReferenceResult(parsed, {
    scenarioIds: CONTRAST_SCENARIO_IDS,
    datasetVersion: DATASET_VERSION,
  });
  if (issues.length > 0) {
    fail(
      `快照未通过「有没有腐烂」校验（${issues.length} 条）：\n` +
        issues.map((issue) => `  - ${issue}`).join("\n") +
        `\n  场景表 / 数据集 / schema 变了 ⇒ 重录快照（perf:contrast --record-reference）。`,
    );
  }
  return parsed as ReferenceResult;
}

/**
 * 替换文档里定界标记之间的内容。
 *
 * 找不到定界标记**不**当成「文档还没这段」而默默追加——那会让一份被手删的生成段落
 * 在下次生成时悄悄回到文档末尾，位置错乱还难发现。这里明确要求先放标记。
 */
function spliceIntoDoc(current: string, generated: string): string {
  const begin = current.indexOf(REFERENCE_TABLE_BEGIN);
  const end = current.indexOf(REFERENCE_TABLE_END);
  if (begin < 0 || end < 0 || end < begin) {
    fail(
      `性能文档里找不到定界标记（${REFERENCE_TABLE_BEGIN} … ${REFERENCE_TABLE_END}）。\n` +
        `  人读视图是**生成段落**，需要那对标记才能定位；请先在 ${DOC_PATH} 里放上。`,
    );
  }
  return (
    current.slice(0, begin) + generated + current.slice(end + REFERENCE_TABLE_END.length)
  );
}

const check = process.argv.includes("--check");
const reference = readReference();
const expectedDoc = spliceIntoDoc(readFileSync(DOC_PATH, "utf8"), formatReferenceReport(reference));
const currentDoc = readFileSync(DOC_PATH, "utf8");

if (check) {
  if (currentDoc !== expectedDoc) {
    console.error(
      `[generate:official-contrast] 人读视图与 ${REFERENCE_PATH} 不一致——生成物漂移。\n` +
        `  修法：pnpm generate:official-contrast:reference\n` +
        `  ⚠️ 不要手改文档里 ${REFERENCE_TABLE_BEGIN} … ${REFERENCE_TABLE_END} 之间的内容。`,
    );
    process.exit(1);
  }
  console.log(
    `official-contrast 人读视图与快照一致（schema v${REFERENCE_RESULT_VERSION}，` +
      `来源 commit ${reference.sourceCommit}）。`,
  );
} else {
  writeFileSync(DOC_PATH, expectedDoc);
  console.log(
    `已由 ${REFERENCE_PATH} 重新生成人读视图 → ${DOC_PATH}\n` +
      `  （来源 commit ${reference.sourceCommit}，录于 ${reference.recordedAt}）`,
  );
}
