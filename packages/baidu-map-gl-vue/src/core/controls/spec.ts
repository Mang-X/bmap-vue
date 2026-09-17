/**
 * ControlSpec —— 控件的**声明式**描述（M7-CONTROL-PANORAMA / issue #41）
 *
 * 控件的八件事（create / mount / unmount / anchor / offset / visible / options / events）此前
 * 由每个组件各写一份：`BZoom` / `BScale` / `BCityList` / `BLocation` / `BNavigation3d` /
 * `BPanoramaControl` / `BControl` 里 `addToMap` / `createWatchers` / `remove` 近乎逐字重复，
 * 而且**都没有**接 anchor / offset 的动态更新。本模块把「怎么做」抽成一份 spec，
 * 由 `useControlResource` 执行；组件只声明「这个控件是什么」。
 *
 * 三条口径值得写在类型上：
 *
 * 1. **选项只有一份**：`options(props)` 同时服务构造与运行期更新。组件不再手写
 *    「构造时传什么、更新时传什么」两套（那两套迟早分叉）。
 * 2. **哪些选项能就地改由 Driver 说了算**：`ControlDriver.planOptions()` 逐键给出
 *    `live` / `recreate` / `unsupported`；adapter 据此在「`setOptions`」与「重建控件」
 *    之间选择，组件侧**不维护第二张表**（ADR 2026-09-11 §5 的分类是单一事实源）。
 * 3. **钩子都是「覆盖默认」，不是「必须实现」**：`create` / `mount` / `unmount` /
 *    `setVisible` 都有可用默认；只有语义真的不同的控件才覆盖（见各钩子注释里的实例）。
 */
import type { ControlHandle } from "../../driver/types/handles";
import type { ControlKind, ControlOptions } from "../../driver/types/controls";
import type { Pixel } from "../../driver/types/geometry";
import type { MapReadyContext } from "../context/types";
import type { ResourceScope } from "../lifecycle/ResourceScope";

/**
 * 全部控件组件共有的 props 形状。
 *
 * `anchor` 传**官方常量名**（`"BMAP_ANCHOR_BOTTOM_RIGHT"`）而不是数值：换算归 Driver，
 * 非四角落点由 Driver 告警（ADR 2026-09-11 §4）。
 */
export interface ControlBaseProps {
  anchor?: string;
  offset?: Pick<Pixel, "x" | "y">;
  visible?: boolean;
}

/** `spec.create` 的输入。 */
export interface ControlCreateInput<Props> {
  readonly context: MapReadyContext;
  readonly props: Readonly<Props>;
  readonly scope: ResourceScope;
}

/** `spec.mount` / `spec.unmount` 的输入。 */
export interface ControlMountInput<Props> {
  readonly context: MapReadyContext;
  readonly resource: ControlHandle;
  readonly props: Readonly<Props>;
  readonly scope: ResourceScope;
}

/** `spec.setVisible` 的输入。 */
export interface ControlVisibleInput<Props> {
  readonly context: MapReadyContext;
  readonly resource: ControlHandle;
  readonly props: Readonly<Props>;
  readonly visible: boolean;
}

export interface ControlSpec<Props extends ControlBaseProps> {
  /** 领域种类（`ControlKind`）。`custom` 需要同时提供 `render`。 */
  readonly kind: ControlKind;

  /**
   * props → 一份**完整**的控件选项（含 `anchor` / `offset`）。
   *
   * 必须满足两条：
   * - 纯函数式：同 props 得到同结果（`optionKey` 会拿它做 diff，带随机值会导致无限重建）；
   * - 值域是「4.0 构造选项」的超集：项目 option 接口的索引签名就是官方构造选项的逃生口。
   */
  options(props: Readonly<Props>): ControlOptions;

  /**
   * 自定义控件（`kind === "custom"`）的 DOM 工厂。
   *
   * 只在 `custom` 下使用：`BMap.Control` 要的是「`initialize(map)` 里返回 DOM」，
   * 走通用构造器只会拿到一个不会挂任何 DOM 的空控件（Driver 对 `create("custom")` 显式失败）。
   */
  render?(props: Readonly<Props>): (mapContainer: HTMLElement) => HTMLElement | null;

  /**
   * 覆盖默认的实例创建。默认是 `driver.controls.create(kind, options(props))`。
   *
   * 覆盖的正当理由只有一类：**实例不由本组件独占**。`BCopyright` 就是这种——文档承诺
   * 「多个相同位置版权控件会自动排列，避免重叠」，因此同一 anchor 的多个组件共用**一个**
   * `CopyrightControl` 实例、各自往里加一条版权项（`copyrightControlPosCache`）。
   */
  create?(input: ControlCreateInput<Props>): ControlHandle;

  /**
   * 覆盖默认的挂载动作。默认是 `driver.controls.add({kind: "map", handle: ctx.map}, res)`。
   *
   * `BCopyright` 覆盖它：共享实例只在「当前没有任何版权项」时才需要 `addControl`，
   * 同时要登记本组件的那一条版权项。
   */
  mount?(input: ControlMountInput<Props>): void;

  /**
   * 覆盖默认的卸载动作。默认是 `driver.controls.remove({kind: "map", handle: ctx.map}, res)`。
   *
   * 执行时机是**业务事件解绑之后**（ADR 2026-09-11 §6）。覆盖它就等于接管摘除动作——
   * adapter 不再补一次默认 `remove`，因此钩子必须自己把实例摘干净（或有意保留）。
   *
   * `BCopyright` 覆盖它：先 `removeCopyright` 摘掉自己那一条，再在「已经没有任何版权项」时
   * 把共享控件一并摘掉（`removeCopyrightControlIfEmpty`）——有兄弟组件仍在用时就保留挂载。
   */
  unmount?(input: ControlMountInput<Props>): void;

  /**
   * SDK 事件 → 业务回调。每次（重）创建后绑定一次，随实例 scope 释放。
   *
   * 返回的是 `[SDK 事件名, 处理函数]` 对；事件名用**官方拼写**（`locationSuccess`、
   * `viewchanged`），与 `<BMap>` 的领域事件名是两套（后者见 `core/events/eventCatalog`）。
   */
  events?(props: Readonly<Props>): ReadonlyArray<readonly [string, (event: unknown) => void]>;

  /**
   * 覆盖默认的显隐动作。默认是 SDK 基类的 `show()` / `hide()`。
   *
   * 为什么默认不是 `addControl` / `removeControl`：`Control#show/hide/isVisible` 就是官方
   * 为「控件可见性」提供的入口；用挂载来表达显隐会带来两个副作用——内置控件的
   * `initialize()` 会重跑一遍（DOM 重新创建、内部交互状态丢失），而 `location` 控件的
   * `remove` 会**顺带停掉持续定位跟踪**（`stopLocationTrace`，见 ADR 2026-09-11 §5 的评审记录），
   * 于是「把它藏起来」会变成「把它关掉」。
   *
   * `BCopyright` 覆盖它：同 anchor 的控件是**共享**的，隐藏整个控件会连带隐藏兄弟组件的内容，
   * 所以「不可见」落到「本组件那一条版权项不登记」。
   */
  setVisible?(input: ControlVisibleInput<Props>): void;
}
