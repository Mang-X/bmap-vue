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
import type { ReferenceResult, ReferenceScenario } from "./reference.mts";

/** 人读视图的定界标记：生成器按它定位替换，文档里手改的正文不受影响。 */
export const REFERENCE_TABLE_BEGIN = "<!-- bmap-vue-1.0:official-contrast -->";
export const REFERENCE_TABLE_END = "<!-- /bmap-vue-1.0:official-contrast -->";

function ms(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(2);
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
  lines.push(
    "> 毫秒为**该 Fake v4 / happy-dom / 上述机器的同轮读数**，仅用于解释此次实验，**不是跨机器阈值**。" +
      "本节不按快慢排序，也不给百分比或倍数——票面禁止营销式排名。",
  );
  lines.push("");

  // ① 简单路径成本：如实承认
  lines.push("#### 简单路径（Map / 100 Marker）：同轮读数");
  lines.push("");
  lines.push("| 场景 | 本库 act ms | 官方 act ms | 结构读数（本库 / 官方） |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const id of ["map-cold-mount", "marker-100-mount"] as const) {
    const entry = comparable.find((scenario) => scenario.id === id);
    if (!entry) continue;
    lines.push(
      `| ${entry.id} | ${ms(entry.ours?.actMs ?? null)} | ${ms(entry.officialSide?.actMs ?? null)} | ` +
        `${structureRow(entry)} |`,
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
  // ⚠️ 数字**从快照里取**，不写死：写死的数字下一次重录就与上表不一致——而这正是
  // 「两份事实源漂移」那个坑，只是从 markdown 搬进了渲染器。
  const mountEntry = comparable.find((scenario) => scenario.id === "marker-100-mount");
  if (mountEntry?.ours && mountEntry.officialSide) {
    const oursMount = mountEntry.ours;
    const offMount = mountEntry.officialSide;
    lines.push(
      `可复现的**结构差**（与快慢无关，跨机成立）：\`marker-100-mount\` 的 \`${oursMount.callKind}\` ` +
        `调用面本库 ${oursMount.sdkCalls} / 官方 ${offMount.sdkCalls}；卸载后**残留**本库 ` +
        `${oursMount.retainedResources} / 官方 ${offMount.retainedResources} —— ` +
        (offMount.retainedResources > 0 ? "官方那侧覆盖物没有被摘掉。" : "两侧都摘干净。"),
    );
    lines.push("");
  }

  // ② 高级路径收益：讲结构差，不讲倍数
  lines.push("#### 高级路径的收益在结构指标上");
  lines.push("");
  lines.push("| 场景 | 本库 | 官方 | 结构读数（本库 / 官方） |");
  lines.push("| --- | --- | --- | --- |");
  for (const id of [
    "marker-1k-update",
    "polyline-10k-parent-update",
    "polyline-10k-path-replace",
    "infowindow-lifecycle",
  ] as const) {
    const entry = comparable.find((scenario) => scenario.id === id);
    if (!entry) continue;
    lines.push(
      `| ${entry.id} | ${ms(entry.ours?.actMs ?? null)} ms | ${ms(entry.officialSide?.actMs ?? null)} ms | ` +
        `${structureRow(entry)} |`,
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
