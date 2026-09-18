/**
 * BInfoWindow 的公开属性面与「每个属性怎么落地」的声明（M5-INFOWINDOW / issue #32）
 *
 * 与 `markerSpec.ts` 同构：把「声明」从 SFC 里抽出来，让**用例能拿它跟 Driver 的属性描述符
 * 逐条交叉核对**（`tests/behavior/v3-binfowindow.test.ts` 的「声明面」一组）。放在 `.vue` 里
 * 就只能靠人眼。
 *
 * ## 三种落地方式
 *
 * | 策略 | 含义 | 预期与描述符的关系 |
 * | --- | --- | --- |
 * | `state` | 由 `infoWindowMachine` 驱动（打开 / 关闭 / 移动），**不进** `setOptions` | 描述符里该键**不存在**或为 `unsupported` |
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
 * `open` 是**唯一**主状态（`v-model:open`）。`show` 是 v2 迁移期的兼容别名：它**只被读取**
 * （`resolveInfoWindowOpenIntent()` 一处收口），并带一条集中告警，绝不构成第二份主状态。
 * 这也是 issue 的非目标「不保留 show/open 两套主状态」的落点。
 */
import type { Point, Pixel } from "../../driver/types/geometry";

/**
 * 组件公开属性（`BInfoWindowProps` 从它派生，见 `types/components.ts`）。
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
  /**
   * @deprecated `open` 的兼容别名（v2 沿用 `v-model:show`）。
   *
   * 只被读取、不构成第二份主状态；使用时会打印一次集中告警。请迁移到 `open`。
   */
  show?: boolean;
  /** 是否开启信息窗最大化功能（官方默认关闭）。 */
  enableMaximize?: boolean;
  /** 是否开启打开时地图自动平移。 */
  enableAutoPan?: boolean;
  /** 是否开启点击地图关闭信息窗。 */
  enableCloseOnClick?: boolean;
}

/**
 * 字段的落地方式。前两个与 Driver 描述符的分类一一对应，`state` 是气泡独有的
 * 「由状态机驱动、不进属性描述符」这一类。
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
 * | `open` / `show` | `state` | 不是 SDK 属性，由状态机消费 |
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
  show: "state",
  enableMaximize: "options",
  enableAutoPan: "options",
  enableCloseOnClick: "options",
};

/**
 * prop → Driver 描述符键的**显式**映射。
 *
 * 只写「不经描述符」的三项：`position` 在描述符里没有可写入口，`open` / `show` 根本不是 SDK 属性。
 * 其余字段与描述符键同名，走缺省（缺省语义是「同名」，不是「按命名规律推断」）。
 */
export const INFO_WINDOW_DESCRIPTOR_KEYS: InfoWindowDescriptorKeys<InfoWindowProps> = {
  position: null,
  open: null,
  show: null,
};

/**
 * 解析 `open` / `show` 两个 prop 的**唯一**收口。
 *
 * 规则：**旧名 `show` 只在显式给出时覆盖 `open`**（`undefined` = 没表态）。
 * 收在一处的意义是让「主状态只有一个」在结构上成立——组件里任何地方想读打开意图都必须走这里。
 *
 * ## 与集中弃用层的 `resolveAliasValue()` 有一处**刻意差异**，原因在默认值
 *
 * `useOverlaySpec` 的 prop 别名读法是「**正典有值 ⇒ 旧名完全不参与**」，因为那里的正典
 * （`bounds`）是必填 prop —— 「正典缺失」是可观测的（`undefined`）。
 * 本组件的正典 `open` 带**运行期默认值**（`withDefaults` 里写了 `open: false`，为的是让
 * 模板里的裸布尔属性 `<BInfoWindow open />` 仍按 Vue 惯例视为 `true`），于是「父级没传 `open`」
 * 与「父级传了 `open: false`」在 props 上**不可区分**。
 *
 * 若照搬「正典优先」，默认值会让 `open` 永远算「有值」，`v-model:show`（v2 的唯一写法）
 * 就完全失效 —— 那不是兼容，是静默破坏。因此这里取**可观测**的那条规则：显式给出的旧名生效。
 * 代价写在明面上：两个都传时以 `show` 为准（调用方自己给了两个来源）。
 * 要严格对齐集中层，就得去掉 `open` 的默认值，代价是裸布尔属性失效 —— 取舍记在 ADR
 * `2026-09-18-infowindow-host-and-ownership` 的已知限制里。
 */
export function resolveInfoWindowOpenIntent(
  props: Readonly<Pick<InfoWindowProps, "open" | "show">>,
): boolean {
  return props.show ?? props.open ?? false;
}

/**
 * 这次读取是不是用到了弃用的旧名（`show` 被显式给出）。
 *
 * 单独一个纯函数是为了让「什么时候该告警」与「读哪个值」分开：告警由调用方经
 * `core/deprecations` 的 warner 发（同实例一次、稳定 code），本函数只回答事实。
 */
export function infoWindowOpenIntentUsesAlias(
  props: Readonly<Pick<InfoWindowProps, "open" | "show">>,
): boolean {
  return props.show !== undefined;
}
