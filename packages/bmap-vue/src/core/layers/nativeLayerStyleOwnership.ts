/**
 * 样式袋与顶层受控字段的**归属**（#174 评审 P1-1）
 *
 * ## 缺陷本身
 *
 * `useNativeLayerResource.fieldWrites()` 的写入顺序是 `visible → opacity(setOpacity) →
 * zIndex → zoomRange → style(setStyle)`。`visualization/` 家族里 `setStyle` 落到 `setOptions`，
 * 而官方声明把「转发」写进了注释本身（`TextLayer.d.ts:265-268` / `PolylineLayer.d.ts:209-212`
 * / `PointLayer.d.ts:297-300`，三处逐字相同）：
 *
 * > 批量更新样式。仅更新已声明的样式键；`opacity` / `visible` / `zIndex` / `renderStage` /
 * > `referCenter` / `enablePicked` **转发到对应 setter**，其余未知键忽略并告警一次
 *
 * ⇒ 袋里的 `opacity` 与顶层 `opacity` prop（走 `setOpacity`）**写的是同一份状态**，
 * 于是「最后改的那个赢」。设置了两者的使用者会看到「先改 style 再改 opacity」与反过来
 * 得到**不同**的最终值。
 *
 * ## ⚠️ 更正：`setOptions` 是 **merge**，不是「整袋替换」
 *
 * 评审与仓库原注释（`types/components.ts` 的 `TextLayerStyle` 文件头）都把这一族记成
 * 「整袋替换 … 没写的键回到官方默认值」。那是**误读**官方那句「仅更新已声明的样式键」——
 * 后者的意思是「只写你给的那几个键，没给的**保持原值**」，与 `layer/` 家族的
 * `setStyleOptions`（「合并到现有样式」，`layer/LineLayer.d.ts:336`）是**同一种**语义。
 *
 * live 读数（`scripts/probe-style-opacity.mts`，2026-09-28，真实 AK 跑通）逐 kind 证实：
 * `setOpacity(0.25)` → 做一次**不含** `opacity` 的样式写 → `getOpacity()` 仍是 `0.25`：
 *
 * | kind | 样式成员 | A：`getOpacity()` 保持 `0.25`？ | B：袋里的 `opacity` 到达 setter？ |
 * | --- | --- | --- | --- |
 * | `text` | `setOptions` | **是**（merge） | **是**（`0.75`） |
 * | `polyline` | `setOptions` | **是**（merge） | **是**（`0.75`） |
 * | `line` | `setStyleOptions` | **是**（merge） | **否**（仍 `0.25`） |
 * | `point-shape` | `setStyleOptions` | **是**（merge） | **否**（仍 `0.25`） |
 *
 * ⇒ 两个家族**都是 merge**（缺陷面比评审记的窄），但**只有 `visualization/` 家族转发**
 * `opacity`（这才是争用的真正来源）。`layer/` 家族的 `PointIconStyle.opacity` /
 * `PointShapeStyle.opacity`（`layer/PointIconLayer.d.ts:127` / `PointShapeLayer.d.ts:137`）是
 * **逐要素**字段，官方文档明写与图层级 `opacity` **相乘**——两份不同的状态，不是争用。
 * 同一份读数里 `setOpacity(0.25)` 后 `setStyleOptions({opacity: 0.9})` 读回仍是 `0.25`，
 * 独立确认了这一点。
 *
 * ## 为什么是「排除 + 告警」而不是「定一个优先级」
 *
 * 优先级方案（谁后写谁赢 / 谁先写谁赢）把「最终值取决于编辑顺序」这条缺陷**保留在契约里**，
 * 只是一个顺序恒定而已：一个受控 prop 的最终值不该由用户的编辑先后决定。排除方案让
 * `opacity` **只有一个入口**，最终值只由那一个 prop 决定，与顺序无关。
 *
 * 排除掉的东西**必须告警一次**（稳定 key）：静默接收后丢弃是 AGENTS.md 点名的假支持，
 * 使用者会以为 `style.opacity` 生效了。
 *
 * ## 为什么是**逐 kind** 表，不是「按字段名一律拦」
 *
 * 拦住 `polyline` / `cluster` / `heatmap` / `track-line` 的袋内 `opacity` 会让使用者
 * **根本设不成图层级透明度**：这几个组件刻意没有 `opacity` prop（逐条理由见
 * `types/components.ts` 的 `VisualizationPolygonPolylineDisplayProps`），袋是它们**唯一**的
 * 入口。按字段名一律拦会把「一个入口」变成「零个入口」——那是更严重的缺陷。
 *
 * 而 `text` 之所以进表，是因为它在**声明面**上同时存在两个入口：官方声明了 `setOpacity`
 * （`TextLayer.d.ts:296`）⇒ 本库开了 `opacity` prop；官方又声明 `setOptions` 会把袋里的
 * `opacity` 转发到那个 setter ⇒ 同一个 prop 既是入口、袋里那份也是入口。
 */
import type { NativeLayerKind } from "../../driver/types/native-layers";

/**
 * 「样式袋里的 `opacity` 与顶层 `opacity` prop 写同一份状态」的 kind。
 *
 * 逐条依据见文件头的 live 读数表。**判据是两个条件同时成立**，不是「叫 opacity 就拦」：
 *
 * 1. 官方声明的样式入口会把袋里的 `opacity` **转发到 `setOpacity`**（`visualization/` 家族）；
 * 2. 本库在该 kind 的组件上**真的开出了** `opacity` prop。
 *
 * 第 2 条今天只有 `text` 满足。将来某个组件给 `polyline` / `heatmap` / … 开了 `opacity`
 * prop 时，**必须**把对应 kind 加进这张表——否则那条 prop 一落地就是第二个入口。
 */
const STYLE_BAG_CONTENDS_OPACITY: ReadonlySet<NativeLayerKind> = new Set<NativeLayerKind>(["text"]);

/**
 * 与顶层 `opacity` prop 争同一个 SDK 状态的样式袋键。
 *
 * ⚠️ 该键**已从 `TextLayerStyle` 的公开类型里删除**（#174 复审 P1-1）：保留一个
 * 「类型允许、运行时被 strip + 告警」的字段就是**「接收后忽略」**，正是本票判定为
 * 假支持并要求删除的那一档。类型层现在是**唯一入口**：顶层 `opacity` prop。
 *
 * 本函数**仍保留**，因为它守的是**另一条通路**：JS 调用方（无类型检查）、
 * `as never` 断言、以及任何 `Record<string, unknown>` 形状的 props 都能塞进这个键。
 * 摘掉它 + 告警一次，比让它沉到 SDK 再被别的入口覆盖要诚实。
 */
export const CONTENDED_OPACITY_STYLE_KEY = "opacity";

/**
 * 该 kind 的样式袋里，`opacity` 是不是与顶层 `opacity` prop 争同一份状态。
 *
 * 判据与入表条件是**同一条**（表即判据），不在这里另写一份 kind 表——两处分头维护时
 * 迟早会漂，而漂掉的方向恰好是「拦错了 kind」或「漏拦了 kind」。
 */
export function styleBagContendsLayerOpacity(kind: NativeLayerKind): boolean {
  return STYLE_BAG_CONTENDS_OPACITY.has(kind);
}

/**
 * 把样式袋里「归顶层受控 prop 所有」的键摘掉，并**回调一次**说明摘了什么。
 *
 * 返回 `undefined` 表示「摘完之后没有任何表态」——调用方据此**不**产生 SDK 调用
 * （与 `projectLayerStyle` 的「空袋 = 不表态」同一口径）。
 *
 * `onConflict` 只在**真的有键被摘掉**时调用，且由调用方负责「告警一次」的去重
 * （warnOnce 在 `useNativeLayerResource` 里，与那处的其它告警共用一个稳定的 key 空间）。
 *
 * @param kind 该 kind（决定有没有争用）
 * @param style 投影后的样式袋（`projectLayerStyle` 的结果）
 * @param onConflict 被摘掉的键名（逐个回调，便于把键名写进告警文案）
 */
export function stripContendedStyleKeys(
  kind: NativeLayerKind,
  style: Record<string, unknown> | undefined,
  onConflict: (key: string) => void,
): Record<string, unknown> | undefined {
  if (style === undefined) return undefined;
  if (!styleBagContendsLayerOpacity(kind)) return style;
  // ⚠️ 用 `in` 而不是「值 !== undefined」：`projectLayerStyle` 已经把 `undefined` 的值剔掉了，
  // 所以这里剩下的 `opacity: undefined` 不可能来自那里；用 `in` 是为了让「显式写了
  // `opacity: undefined`」与「没写 opacity」在告警上**不是**两回事（前者同样没生效）。
  if (!Object.prototype.hasOwnProperty.call(style, CONTENDED_OPACITY_STYLE_KEY)) return style;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (key === CONTENDED_OPACITY_STYLE_KEY) continue;
    next[key] = value;
  }
  onConflict(CONTENDED_OPACITY_STYLE_KEY);
  return Object.keys(next).length > 0 ? next : undefined;
}
