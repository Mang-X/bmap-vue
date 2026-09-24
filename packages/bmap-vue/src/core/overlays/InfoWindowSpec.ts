/**
 * InfoWindow 的公开属性面与「每个属性怎么落地」的声明（M5-INFOWINDOW / issue #32）
 *
 * 与 `markerSpec.ts` 同构：把「声明」从 SFC 里抽出来，让**用例能拿它跟 Driver 的属性描述符
 * 逐条交叉核对**（`tests/behavior/infowindow.test.ts` 的「声明面」一组）。放在 `.vue` 里
 * 就只能靠人眼。
 *
 * ## 三种落地方式
 *
 * | 策略 | 含义 | 预期与描述符的关系 |
 * | --- | --- | --- |
 * | `state` | 由组件的**收敛**驱动（打开 / 关闭 / 移动），**不进** `setOptions` | 描述符里该键**不存在**或为 `unsupported` |
 * | `options` | 就地更新：进更新队列 → `driver.overlays.setOptions` | 描述符里该键必须是 `mutable` |
 * | `recreate` | 构造期属性：变化即**重建实例**（旧实例连同 child scope 一起释放） | 描述符里该键必须是 `recreate` |
 *
 * `position` 落进 `state` 而不是 `options`：描述符把它标成 `unsupported`（气泡位置由
 * `map.openInfoWindow(infoWnd, point)` 提供，实例上没有 `setPosition`），先 `setOptions()`
 * 会打印一条「position 在当前引擎不支持，本次更新被忽略」的误导日志。位置不进实例状态——
 * 重走一次 `openInfoWindow` 即可（它同时负责「打开」与「移动」）。
 *
 * ## 唯一主模型
 *
 * `open` 是**唯一**主状态（`v-model:open`），读法收在 `resolveInfoWindowOpenIntent()` 一处。
 * v2 沿用的 `show` 已随集中弃用层在 #136 删除——clean-slate 1.0 不兼容旧 API。
 */
import type { Point, Pixel } from "../../driver/types/geometry";

/**
 * 组件公开属性（`InfoWindowProps` 从它派生，见 `types/components.ts`）。
 *
 * 每个字段一句「它会怎么落地」，与 `INFO_WINDOW_FIELDS` 一一对应。
 */
export interface InfoWindowProps {
  /** 气泡所在坐标。**不是** SDK 属性：打开与移动都经 `openInfoWindow(map, iw, position)`。 */
  position?: Point;
  /** 信息窗标题文字，官方支持 HTML。 */
  title?: string;
  /** 信息窗宽度（像素）。官方取值范围 `0`（自适应）、`220`–`730`。 */
  width?: number;
  /** 信息窗高度（像素）。官方取值范围 `0`（自适应）、`60`–`650`。 */
  height?: number;
  /** 底端尖角相对地理坐标的像素偏移。**构造期属性**：官方没有 `setOffset`。 */
  offset?: Pixel;
  /** 唯一主状态：是否打开（`v-model:open`）。 */
  open?: boolean;
  /** 是否开启信息窗最大化功能（官方默认关闭）。 */
  enableMaximize?: boolean;
  /** 是否开启打开时地图自动平移。 */
  enableAutoPan?: boolean;
  /** 是否开启点击地图关闭信息窗。 */
  enableCloseOnClick?: boolean;
}

/**
 * 字段的落地方式。前两个与 Driver 描述符的分类一一对应，`state` 是气泡独有的
 * 「由打开意图驱动、不进属性描述符」这一类。
 */
export type InfoWindowFieldUpdate = "state" | "options" | "recreate";

/**
 * prop → 落地方式的**完整**映射。
 *
 * `-?` 是刻意的：可选 prop 也必须有落地方式，否则「没给方式（或声明得自相矛盾）的字段」会静默
 * 落进默认分支。键集由类型层强制覆盖，漏一个就编译失败。
 */
export type InfoWindowFieldMap<Props> = {
  readonly [K in keyof Props]-?: InfoWindowFieldUpdate;
};

/** 落地方式 → Driver 描述符键。缺省同名；`null` = 该字段不经描述符。 */
export type InfoWindowDescriptorKeys<Props> = Partial<
  Record<keyof Props & string, string | null>
>;

/**
 * 每个公开属性的落地方式（唯一声明点）。
 *
 * | prop | 策略 | 依据（`OVERLAY_DESCRIPTORS["info-window"]`） |
 * | --- | --- | --- |
 * | `position` | `state` | 描述符里是 `unsupported(...)`：位置由 `openInfoWindow(map, iw, position)` 提供 |
 * | `open` | `state` | 不是 SDK 属性，只在打开意图里消费 |
 * | `title` / `width` / `height` | `options` | `mutateBy("setTitle"/"setWidth"/"setHeight")` ⇒ `mutable` |
 * | `enableMaximize` / `enableAutoPan` / `enableCloseOnClick` | `options` | `toggleBy([...])` ⇒ `mutable` |
 * | `offset` | `recreate` | 官方只有 `getOffset()`，**没有** `setOffset` ⇒ 构造期属性 |
 */
export const INFO_WINDOW_FIELDS: InfoWindowFieldMap<InfoWindowProps> = {
  position: "state",
  title: "options",
  width: "options",
  height: "options",
  offset: "recreate",
  open: "state",
  enableMaximize: "options",
  enableAutoPan: "options",
  enableCloseOnClick: "options",
};

/**
 * prop → Driver 描述符键的**显式**映射。
 *
 * 只写「不经描述符」的两项：`position` 在描述符里没有可写入口，`open` 根本不是 SDK 属性。
 * 其余字段与描述符键同名，走缺省（缺省语义是「同名」，不是「按命名规律推断」）。
 */
export const INFO_WINDOW_DESCRIPTOR_KEYS: InfoWindowDescriptorKeys<InfoWindowProps> = {
  position: null,
  open: null,
};

/**
 * 解析 `open` 的**唯一**收口。
 *
 * `?? false` 的兜底是**承重**的，不是防御性冗余：组件的 `withDefaults` 写了 `open: false`，
 * 为的是让模板里的裸布尔属性 `<InfoWindow open />` 仍按 Vue 惯例视为 `true`；而 `defineProps`
 * 侧的类型面允许 `open` 缺省。收在一处的意义是让「主状态只有一个」在结构上成立——组件里任何
 * 地方想读打开意图都必须走这里。
 */
export function resolveInfoWindowOpenIntent(
  props: Readonly<Pick<InfoWindowProps, "open">>,
): boolean {
  return props.open ?? false;
}

/** 位置指纹：没有可用位置时返回 `null`（按值判等，父级传内联字面量也认）。 */
export function positionKeyOf(point: Point | undefined | null): string | null {
  if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return null;
  return `${point.lng},${point.lat}`;
}
