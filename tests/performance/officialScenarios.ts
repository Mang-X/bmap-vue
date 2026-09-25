/**
 * 官方对照基准的**场景目录**（issue #140）
 *
 * ## 为什么要有这一层
 *
 * 票面列了 10 个场景，但它们**不是同质的**：有些两边都有等价物，有些只有本库有。把这件事
 * 藏在用例里（遇到就跑、遇到就跳过）会让「这张表到底覆盖了什么」变成读代码才知道的事，
 * 而票面要的恰恰是**可核对**的清单。因此场景是**数据**，用例只是它的一个执行者。
 *
 * ## 判据：官方有没有**公开的等价契约**（而不是「看起来像不像」）
 *
 * `official: null` 的场景**不是**「我们没做」，而是「官方没有可核对的等价物」。三个真实例子：
 *
 * | 场景 | 官方 1.0.1 的事实 | 依据 |
 * | --- | --- | --- |
 * | 6 PointCollection | `BMap.PointCollection` 在 4.0 **整体移除**（`@removed 4.0，仅 v3`） | 官方 React 参考的类表；`@baidumap/jsapi-v4-types@4.0.4` 无此声明 |
 * | 7 Native Point 50k | 官方 v4 的批量点是**扩展 API**（`PointShapeLayer` / `PointIconLayer`），官方 binding 没有组件封装 | 官方 `dist/index.d.ts` 的组件清单 |
 * | 10 KeepAlive | 官方库**没有**任何 KeepAlive 语义（无 `onActivated` / `onDeactivated`） | `dist/index.js` 全文无这两个钩子 |
 *
 * 票面「不伪造官方等价物」与「官方无等价契约时只记录本库行为，不硬比较」在这里落成
 * **类型层面的一件事**：`official: null` 的场景在报告里单列一节，永不与任何数字并排比较。
 *
 * ## 它不是「断言」层
 *
 * 本模块只描述「测什么、两边各用什么、数据多大」；**怎么测**在
 * `official-contrast.perf.test.ts`，**怎么报**在 `official-contrast/report.mts`。
 * 任何一处想加场景，都必须先在这里登记，报告才会认它。
 */
import { PERF_ITEM_KEY, perfItemPosition } from "./dataset.ts";

/** 两个被对照的库（版本在报告里自述，场景表不重复）。 */
export const CONTRAST_LIBRARIES = ["bmap-vue", "@baidumap/vue-bmap"] as const;
export type ContrastLibrary = (typeof CONTRAST_LIBRARIES)[number];

/** 票面场景的稳定 id（同时是报告里的一行 key，不要改）。 */
export const CONTRAST_SCENARIO_IDS = [
  "map-cold-mount",
  "marker-100-mount",
  "marker-1k-update",
  "polyline-10k-parent-update",
  "polyline-10k-path-replace",
  "pointcollection-50k",
  "native-point-50k",
  "infowindow-lifecycle",
  "router-remount",
  "keepalive-toggle",
] as const;

export type ContrastScenarioId = (typeof CONTRAST_SCENARIO_IDS)[number];

/** 官方 1.0.1 对本场景的等价物；`null` = **本库扩展档，不硬比较**（理由见文件头）。 */
export type OfficialEquivalent = string | null;

export interface ContrastScenario {
  readonly id: ContrastScenarioId;
  /** 票面场景的中文名（原样保留，便于报告与票面对齐）。 */
  readonly title: string;
  /** 本库这一侧用到的组件（报告里逐条点名，避免「本库优势」来源不明）。 */
  readonly ours: readonly string[];
  /**
   * 官方这一侧的等价物。
   *
   * 非 `null` 时它同时是「这个读数**可以**并排比较」的许可证；`null` 时报告单列。
   * 写成一个可读的说明（如 `"BMap.PointCollection 在 4.0 已移除"）而不是空串，
   * 是为了让「为什么没有对照」出现在报告里，而不是消失在代码里。
   */
  readonly official: OfficialEquivalent;
  /** 数据规模（`null` = 与数据量无关的场景，如 Map 冷挂载）。 */
  readonly size: number | null;
  /**
   * 这个场景**测量什么**：一句话的人读口径。
   *
   * 它是「读数能证明什么」的边界声明——写不下的结论不许从这张表推导。
   */
  readonly measures: string;
  /**
   * 票面要人读报告**解释**的两档（#140 验收第二条）。
   *
   * ⚠️ 它住在场景表里、而不是渲染器里，是有代价换来的：分档只存在于渲染器的两个数组
   * 字面量里时，**删掉一个高级场景只会让它那一行悄悄消失**，所有门禁照样绿——那正是
   * decision 15 为 `report.mts` 修掉的「静默少报」类。分档落在数据里，门禁才能查。
   */
  readonly tier: ContrastTier;
}

/** 简单路径（诚实承认成本）/ 高级路径（本库的结构收益所在）。 */
export type ContrastTier = "simple" | "advanced";

/** 票面的 10 个场景，逐条登记。顺序即报告里的顺序（与票面一致）。 */
export const CONTRAST_SCENARIOS: readonly ContrastScenario[] = [
  {
    id: "map-cold-mount",
    title: "Map cold mount / destroy",
    ours: ["Map"],
    official: "Map",
    size: null,
    measures: "一张地图的建立与释放（挂载→ready→卸载），含资源销账。",
    tier: "simple",
  },
  {
    id: "marker-100-mount",
    title: "100 Marker mount/unmount",
    ours: ["MarkerList"],
    official: "100 × Marker",
    size: 100,
    measures: "100 个点的挂载与卸载；两边都是**逐点 Marker**（本库不偷偷换批量路径）。",
    tier: "simple",
  },
  {
    id: "marker-1k-update",
    title: "1k Marker position update",
    ours: ["MarkerList"],
    official: "1 000 × Marker",
    size: 1_000,
    measures: "1000 个点换一份新位置数据：SDK 写入次数与实例重建次数。",
    tier: "advanced",
  },
  {
    id: "polyline-10k-parent-update",
    title: "Polyline 10k 点：父级无关状态更新",
    ours: ["Polyline"],
    official: "Polyline",
    size: 10_000,
    measures:
      "父级改一个**与 path 无关**的状态。理想是「不重发 path」；本场景钉的是这条**不变式**，不是速度。",
    tier: "advanced",
  },
  {
    id: "polyline-10k-path-replace",
    title: "Polyline 10k 点：真实 path replacement",
    ours: ["Polyline"],
    official: "Polyline",
    size: 10_000,
    measures: "真的换一份 10k path：SDK 写入次数、是否重建实例、墙钟。",
    tier: "advanced",
  },
  {
    id: "pointcollection-50k",
    title: "PointCollection / equivalent 50k",
    ours: ["PointCollection"],
    official: null,
    size: 50_000,
    measures:
      "5 万个点走**单个** SDK 批量资源（v4 `PointShapeLayer`）。官方 `BMap.PointCollection` 在 4.0 已整体移除。",
    tier: "advanced",
  },
  {
    id: "native-point-50k",
    title: "本库 Native Point 50k",
    ours: ["PointLayer"],
    official: null,
    size: 50_000,
    measures:
      "5 万个点走扩展 API 的原生点图层（`BMap.PointLayer`）。官方 binding 没有对应组件封装。",
    tier: "advanced",
  },
  {
    id: "infowindow-lifecycle",
    title: "InfoWindow mount/update/destroy",
    ours: ["InfoWindow"],
    official: "InfoWindow",
    size: null,
    measures: "信息窗的建立、内容/位置更新、关闭与释放。",
    tier: "advanced",
  },
  {
    id: "router-remount",
    title: "Router 重复 mount/unmount",
    ours: ["Map"],
    official: "Map",
    size: null,
    measures:
      "真实路由反复进出同一路由。**两边都接 `vue-router`**（官方 README 的示例写法），否则不是同一个问题。",
    tier: "advanced",
  },
  {
    id: "keepalive-toggle",
    title: "KeepAlive activate/deactivate",
    ours: ["Map (keepAliveBehavior=suspend)"],
    official: null,
    size: null,
    measures:
      "KeepAlive 下 deactivate/activate：地图应挂起而非重建。官方库无 KeepAlive 语义，只记本库行为。",
    tier: "advanced",
  },
];

/** 按 id 取场景（未知 id 直接抛错：报告里出现一个没登记的场景，比它缺失更危险）。 */
export function contrastScenario(id: ContrastScenarioId): ContrastScenario {
  const found = CONTRAST_SCENARIOS.find((entry) => entry.id === id);
  if (!found) throw new Error(`未登记的对照场景：${id}`);
  return found;
}

/** 有官方等价物、可并排比较的场景（报告的「可比」节）。 */
export function comparableScenarios(): readonly ContrastScenario[] {
  return CONTRAST_SCENARIOS.filter((entry) => entry.official !== null);
}

/** 本库扩展档（报告的「单列」节；**永不**与官方数字并排）。 */
export function oursOnlyScenarios(): readonly ContrastScenario[] {
  return CONTRAST_SCENARIOS.filter((entry) => entry.official === null);
}

/* --------------------------------------------------------- 测量名 ↔ 场景 id */

/**
 * 基准内部的**测量名**（`recorder` 里的 metric 名 / 增量读数前缀）→ 场景 id。
 *
 * 为什么需要这一层映射：报告必须以**票面场景 id** 为准（`official-contrast.perf.test.ts`
 * 的读数键用的是更适合断言的驼峰短名，如 `marker100.mount`）。映射集中在这里而不是散在
 * 报告代码里，是为了让「这个测量对应票面哪一条」可核对——**双向**齐全，报告里出现未登记的
 * 测量名会直接抛错。
 */
const MEASURE_TO_SCENARIO: ReadonlyMap<string, ContrastScenarioId> = new Map<
  string,
  ContrastScenarioId
>([
  ["map.lifecycle", "map-cold-mount"],
  ["marker100.mount", "marker-100-mount"],
  ["marker1k.update", "marker-1k-update"],
  ["polyline10k.parentUpdate", "polyline-10k-parent-update"],
  ["polyline10k.pathReplace", "polyline-10k-path-replace"],
  ["pointcollection50k", "pointcollection-50k"],
  ["nativepoint50k", "native-point-50k"],
  ["infowindow.lifecycle", "infowindow-lifecycle"],
  ["router.remount", "router-remount"],
  ["keepalive.toggle", "keepalive-toggle"],
]);

/**
 * 测量名 → 票面场景 id 的**只读视图**（本表本身，不包一层新 Map）。
 *
 * 供需要「双向核对」的一方使用（例如门禁要断言每个场景都有测量名）。导出只读视图而不是
 * 让调用方**另抄一份**：`official-contrast-gate.test.ts` 若自己维护一张平行的映射表，
 * 两张表迟早会漂，而漂了之后报告会把一个场景算到另一个场景名下——门禁全绿、数据是错的。
 */
export function measureToScenarioTable(): ReadonlyMap<string, ContrastScenarioId> {
  return MEASURE_TO_SCENARIO;
}

/** 测量名 → 票面场景 id；未登记的测量名直接抛错（见上）。 */
export function scenarioIdOfMeasure(measure: string): ContrastScenarioId {
  const found = MEASURE_TO_SCENARIO.get(measure);
  if (!found) throw new Error(`测量名未登记到票面场景：${measure}`);
  return found;
}

/* ------------------------------------------------------------ 共享的夹具取值 */

/**
 * 两边共用的逐点位置取值。
 *
 * 官方 `Marker` 的 `position` 吃 `{lng,lat}`、本库 `MarkerList` 的 `getPosition` 也吃同一形状，
 * 所以一个函数同时喂两侧——**数据与取数面同形**是可比的前提，否则量的不是同一件事。
 */
export const CONTRAST_ITEM_KEY = PERF_ITEM_KEY;

/** 数据集自述（进报告；与既有 `datasetDescription()` 合并，不重复声明种子/规模）。 */
export function contrastDatasetDescription(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    scenarios: CONTRAST_SCENARIOS.map((entry) => entry.id),
    comparable: comparableScenarios().length,
    oursOnly: oursOnlyScenarios().length,
  };
}
