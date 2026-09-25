/**
 * 由**入库快照**派生的人读视图（issue #140）
 *
 * ## 为什么 B 必须由 A 生成，而不是手抄第二份数字
 *
 * A+B 最大的坑是两份事实源漂移：JSON 一套数字、Markdown 又手抄一套，下次更新 A 忘了更新 B，
 * 两边慢慢对不上——而且**没有门禁会响**。本模块因此只认一个输入
 * （`recorded-result.json`），把 #140 第二条验收要的「人读报告解释**简单路径成本**与
 * **高级路径收益**」渲染成 markdown 片段，由生成器写进性能文档，`--check` 挡漂移。
 *
 * ## 措辞是这张票的硬要求，不是文风偏好
 *
 * 票面标题是「**证明优势、暴露简单路径成本**」，验收第二条要求报告**解释**这两件事。
 * 因此渲染刻意分成两节：
 *
 * - **简单路径**——如实列 Map / 100 Marker 的同轮原始读数，**不给百分比、不给「X 倍」**
 *   （票面「结果使用规则」明禁），也**不预设谁更贵**。毫秒紧跟一句「该 Fake v4 / happy-dom /
 *   指定机器的同轮读数，非跨机阈值」；
 * - **高级路径的收益是**结构指标**——`recreate=0`、`setPath=0`、`retained=0`、
 *   `render 2 vs 1001` 这类**可复现的架构差**，而不是「快了多少倍」。
 *
 * 后者才是 #138 Vue-native 收口真正要防回归的东西；前者要如实承认，不能藏。
 */
import { CONTRAST_SCENARIOS } from "../officialScenarios.ts";
import type { ContrastTier } from "../officialScenarios.ts";
import type { ReferenceResult, ReferenceScenario } from "./reference.mts";

/** 人读视图的定界标记：生成器按它定位替换，文档里手改的正文不受影响。 */
export const REFERENCE_TABLE_BEGIN = "<!-- bmap-vue-1.0:official-contrast -->";
export const REFERENCE_TABLE_END = "<!-- /bmap-vue-1.0:official-contrast -->";

function ms(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

/**
 * 某一档里**可比较**（有官方等价物）的场景 id——**从场景表取**，不在这里写硬编码 id。
 *
 * ⚠️ 上一版把 id 直接写成两个数组字面量，代价有两处：分档这个**票面叙事**没有数据来源，
 * 而且 `if (!entry) continue` 会让「场景表里的某个高级场景没测到 / 被删掉」**只少一行、
 * 不报错**——静默少报，正是 decision 15 为 `report.mts` 修掉的那一类。
 * 现在缺行走 `missingRows()`，渲染直接把它说出来。
 *
 * 过滤掉 `official === null` 是必须的：那些是**本库扩展档**，官方侧本就无读数，
 * 列进对照表再报「缺读数」是自己造的假警报。它们由「本库扩展档」一节单独交代。
 */
function comparableIdsOfTier(tier: ContrastTier): readonly string[] {
  return CONTRAST_SCENARIOS.filter(
    (scenario) => scenario.tier === tier && scenario.official !== null,
  ).map((scenario) => scenario.id);
}

/** 场景表要的行里，快照**没读到**的那些。空 = 读齐了。 */
function missingRows(
  rows: readonly ReferenceScenario[],
  ids: readonly string[],
): readonly string[] {
  const present = new Set(rows.map((entry) => entry.id));
  return ids.filter((id) => !present.has(id));
}

/** 可比场景（两侧都拿到读数）的结构摘要，**不排名**。 */
function structureRow(scenario: ReferenceScenario): string {
  const ours = scenario.ours;
  const off = scenario.officialSide;
  if (!ours || !off) return "-";
  return (
    `recreate ${ours.recreates} / ${off.recreates} · ` +
    `${ours.callKind} ${ours.sdkCalls} / ${off.callKind} ${off.sdkCalls} · ` +
    `render ${ours.renderCallbacks} / ${off.renderCallbacks} · ` +
    `残留 ${ours.retainedResources} / ${off.retainedResources}`
  );
}

/**
 * 渲染人读视图。
 *
 * 两列表都标「本库 / 官方」，顺序固定（本库在前）——**不排序、不按大小挑顺序**：
 * 按谁快排就等于把读数变成绩单，正是票面禁止的。
 */
export function formatReferenceReport(result: ReferenceResult): string {
  const lines: string[] = [];
  const env = result.environment;
  const comparable = result.scenarios.filter(
    (entry) => entry.official !== null && entry.ours !== null && entry.officialSide !== null,
  );
  const oursOnly = result.scenarios.filter((entry) => entry.official === null);

  lines.push(REFERENCE_TABLE_BEGIN);
  lines.push("### 本次记录（由 `recorded-result.json` 生成，勿手改）");
  lines.push("");
  lines.push(
    `录于 \`${result.recordedAt}\`，来源 commit \`${result.sourceCommit}\`；` +
      `本库 ${result.oursVersion} vs 官方 ${result.officialVersion}，数据集 v${result.datasetVersion}。`,
  );
  lines.push("");
  lines.push(
    `机器：${env.cpuModel} · ${env.platform}/${env.arch} · node ${env.node}` +
      `${env.vitest ? ` · vitest ${env.vitest}` : ""}${env.dom ? ` · ${env.dom}` : ""}。`,
  );
  lines.push("");
  // ⚠️ 这一段是**读表的人最该先看到**的东西，也是上一版缺的那句。快照里本库侧记的是
  // `oursVersion`（读自 package.json），看起来像发布物版本；实际被测的是 `src/**`，引擎是
  // Fake 替身。票面对照版本写的是「最终 1.0 RC tarball」、环境写的是「同 JSAPI 4.0」，
  // 本档两条都达不到——不写出来，读者会把下面那张表默认读成「发布物 × 真实 JSAPI 4.0」。
  const engine = result.engine;
  const underTest =
    engine.oursUnderTest === "dist"
      ? "本库发布产物（dist / tarball）"
      : "本库**源码**（`packages/bmap-vue/src/**`）——**不是**打包产物";
  lines.push(
    `被测对象：${underTest}；引擎：` +
      (engine.kind === "fake"
        ? `**Fake v4 替身**（\`${engine.version}\`）——**不是**真实 JSAPI，本轮无 AK、无网络，` +
          "官方库经 `jsapi-loader` 复用已存在的 `window.BMap` 跑通"
        : `真实 JSAPI \`${engine.version}\``) +
      "。",
  );
  lines.push("");
  lines.push(
    "> 毫秒为**该引擎 / 上述机器的同轮读数**，仅用于解释此次实验，**不是跨机器阈值**，" +
      "也**不代表**真实 JSAPI + 浏览器下的耗时。本节不按快慢排序，也不给百分比或倍数——" +
      "票面禁止营销式排名。",
  );
  lines.push("");

  // ① 简单路径成本：如实承认
  lines.push("#### 简单路径（Map / 100 Marker）：同轮读数");
  lines.push("");
  lines.push("| 场景 | 本库 act ms | 官方 act ms | 结构读数（本库 / 官方） |");
  lines.push("| --- | ---: | ---: | --- |");
  const simpleIds = comparableIdsOfTier("simple");
  for (const id of simpleIds) {
    const entry = comparable.find((scenario) => scenario.id === id);
    if (!entry) continue;
    lines.push(
      `| ${entry.id} | ${ms(entry.ours?.actMs ?? null)} | ${ms(entry.officialSide?.actMs ?? null)} | ` +
        `${structureRow(entry)} |`,
    );
  }
  const absentSimple = missingRows(comparable, simpleIds);
  if (absentSimple.length > 0) {
    // 不 `continue` 悄悄跳过：少报的那一行必须**说出来**，否则「解释简单路径成本」缺一块也没人知道。
    lines.push(
      `| ⚠️ 缺读数 | — | — | ${absentSimple.join(" / ")} —— 场景表里有，快照里没读到；` +
        "该档解释不完整，请重录快照 |",
    );
  }
  lines.push("");
  // ⚠️ 刻意**不写**「简单路径上本库更贵 / 更快」这类结论句。上一版把
  // 「本库的组件与生命周期抽象是有成本的」写死在渲染里，而**同一份快照的表就在它上面**，
  // 读数是本库更快（见上表）——一句硬编码的结论被自己生成的数据当场否掉。方向是**数据决定**的：
  // 换机器、换 Node、换官方补丁版本都可能反过来。表格给数，结论留给读表的人。
  //
  // 票面「结果使用规则」说的是「简单 Marker/Map 若官方更轻，如实记录」——**谁更轻由读数说话**，
  // 写死任何一边都是把一次实验的结论冒充成这张票的结论。
  lines.push(
    "简单路径的**同轮毫秒**与**结构读数**见上表。方向由数据决定，本文不预设结论：换机器、换 Node、" +
      "换官方补丁版本都可能反过来。票面要求「若官方更轻，如实记录」——**如实**指的是不挑选、不排序、" +
      "不给倍数，不是预先假定哪边更贵。",
  );
  lines.push("");
  // ⚠️ 这句里的**每个数字都从快照取**，场景也是**选出来**的，不是写死 `marker-100-mount`：
  // 简单档里「残留差」最大的那一行。写死场景 id 等于渲染器自己持一份事实源（票面叙事分成
  // 数据在场景表，数字在快照——这里两样都该从上游来）；而且场景改名会让这句话悄悄失去对象。
  //
  // 选「残留差最大」而不是「第一个有残留的」：残留是本库与官方**架构分水岭**的那个读数
  // （#138 Vue-native 收口要防的就是它），最刺眼的那一行最该被点出来。
  // ⚠️ 只在**简单档**里选：这句活在「简单路径」一节里，挑中高级档的行会让它解释错档。
  const worstRetain = comparable
    .filter((entry) => simpleIds.includes(entry.id) && entry.ours && entry.officialSide)
    .map((entry) => ({ entry, gap: entry.officialSide!.retainedResources - entry.ours!.retainedResources }))
    .filter((row) => row.gap !== 0)
    .sort((a, b) => b.gap - a.gap)[0];
  if (worstRetain) {
    const oursSide = worstRetain.entry.ours!;
    const offSide = worstRetain.entry.officialSide!;
    lines.push(
      `可复现的**结构差**（与快慢无关，跨机成立）：\`${worstRetain.entry.id}\` 的 \`${oursSide.callKind}\` ` +
        `调用面本库 ${oursSide.sdkCalls} / 官方 ${offSide.sdkCalls}；卸载后**残留**本库 ` +
        `${oursSide.retainedResources} / 官方 ${offSide.retainedResources} —— ` +
        (offSide.retainedResources > 0
          ? "官方那侧覆盖物没有被摘掉。"
          : "本库那侧尚有残留，值得复查。"),
    );
    lines.push("");
  }

  // ② 高级路径收益：讲结构差，不讲倍数
  lines.push("#### 高级路径的收益在结构指标上");
  lines.push("");
  lines.push("| 场景 | 本库 | 官方 | 结构读数（本库 / 官方） |");
  lines.push("| --- | --- | --- | --- |");
  const advancedIds = comparableIdsOfTier("advanced");
  for (const id of advancedIds) {
    const entry = comparable.find((scenario) => scenario.id === id);
    if (!entry) continue;
    lines.push(
      `| ${entry.id} | ${ms(entry.ours?.actMs ?? null)} ms | ${ms(entry.officialSide?.actMs ?? null)} ms | ` +
        `${structureRow(entry)} |`,
    );
  }
  const absentAdvanced = missingRows(comparable, advancedIds);
  if (absentAdvanced.length > 0) {
    lines.push(
      `| ⚠️ 缺读数 | — | — | ${absentAdvanced.join(" / ")} —— 场景表里有，快照里没读到；` +
        "该档解释不完整，请重录快照 |",
    );
  }
  lines.push("");
  lines.push(
    "收益在这里是**可复现的架构差**，不是快慢：更新走 `setPosition` 复用实例而不重建覆盖物、" +
      "父级无关更新不重发 `setPath`、卸载后本库无残留而官方有——这些是 #138 Vue-native 收口真正" +
      "要防回归的东西，也是 CI 里不变式门禁盯的读数。",
  );
  lines.push("");

  if (oursOnly.length > 0) {
    lines.push("#### 本库扩展档（官方无等价契约，**不硬比较**）");
    lines.push("");
    for (const entry of oursOnly) {
      // ⚠️ 原因文本本身常以「官方无等价物（…）」开头，这里再套一层会渲染成
      // 「官方无等价物（官方无等价物（…））」。直接用原因原文，不加前缀。
      lines.push(
        `- **${entry.id}**：本库 act ${ms(entry.ours?.actMs ?? null)} ms —— ` +
          `${entry.officialSkippedReason ?? "官方无等价物（未提供说明）"}。`,
      );
    }
    lines.push("");
  }

  lines.push("本档**测不到**（不要外推）：");
  for (const text of result.notMeasured) lines.push(`- ${text}`);
  lines.push(REFERENCE_TABLE_END);
  return lines.join("\n");
}
