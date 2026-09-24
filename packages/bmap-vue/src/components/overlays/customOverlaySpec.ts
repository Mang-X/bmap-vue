/**
 * BCustomOverlay 的 `OverlaySpec` 声明（M5-CUSTOM-MENU / issue #33）
 *
 * 与其余九个覆盖物同构：组件只声明「我是哪个 kind、每个 prop 怎么落地」，创建 / 挂载 / 就地更新 /
 * 重建 / 卸载 / 事件绑定全部由 `useOverlaySpec` 驱动。`tests/behavior/v3-overlay-suite.test.ts`
 * 拿这张表与 `BCustomOverlayProps` 的键集、以及 `OVERLAY_DESCRIPTORS["custom-overlay"]` 逐条交叉核对。
 *
 * ## 每个公开属性的更新策略（`CUSTOM_OVERLAY_FIELDS` 是唯一声明点）
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["custom-overlay"]`） |
 * | --- | --- | --- | --- |
 * | `position` | `position` | `setPoint(point, true)`（`valueArgs: [true]`） | `mutateBy("setPoint", { value: "point", valueArgs: [true] })` |
 * | `rotation` | `options` | `setOptions` → `setRotation` | `mutable`（构造键是 `rotationInit`） |
 * | `properties` | `options` | `setOptions` → `setProperties` | `mutable` |
 * | `offset` | `recreate` | 重建实例（构造键 `offsetX` / `offsetY`） | 实例上没有 `setOffset` |
 * | `anchor` | `recreate` | 重建实例（构造键 `anchors: [x, y]`） | 实例上没有 `setAnchor` |
 * | `zIndex` | `recreate` | 重建实例 | 4.0 有 `zIndex` 构造项、没有 `setZIndex` |
 * | `minZoom` / `maxZoom` | `recreate` | 重建实例 | 构造期选项，没有字段级 setter |
 * | `enableMassClear` | `recreate` | 重建实例 | 官方说明该开关当前不生效，因此不做就地开关 |
 * | `visible` | `visibility` | `show` / `hide`（继承自 `Overlay`） | **不是**描述符键 |
 *
 * ## 两处值得单独说明
 *
 * 1. **`position` 的第二参数是 `true`**：官方 `setPoint(point, noReCreate = false)` —— 省略第二参数
 *    会**重新调用业务 DOM 工厂**（真实 4.0 实测：工厂调用计数 1→2）。只位移才是「移动」的语义，
 *    重建 DOM 会让调用方在 slot 里写的节点被换掉。描述符的 `valueArgs: [true]` 是这条的唯一声明点，
 *    专用入口（`setPosition`）与通用入口（`setOptions({ position })`）共用它。
 * 2. **`offset` / `anchor` 走 `recreate` 而不是 `options`**：它们是**构造选项**
 *    （`offsetX` / `offsetY` / `anchors`），实例上没有对应 setter。认成 `options` 会让更新落到
 *    `set<Key>` 逃生口上，静默变成「改了没反应」。
 *
 * ## 为什么没有「尺寸 / 位置纳入 FrameScheduler」
 *
 * InfoWindow 需要在内容尺寸变化后调 `redraw()`（官方有该入口），因此 #32 给它接了
 * `useResizeObserver` + `FrameScheduler`。`CustomOverlay` **没有** `redraw()` 之类的重绘入口
 * （真实 4.0 的原型成员表里没有它），位置刷新由 SDK 自己的渲染循环负责
 * （官方为此提供了构造选项 `synUpdate`）。没有可下发的命令就没有要合帧的对象，因此这里
 * **有意不做**——凭空加一个「我们自己的重绘循环」属于自研官方没有的能力。理由记在 ADR
 * `2026-09-19-custom-overlay-and-context-menu` 的实施步骤对照表里。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { BCustomOverlayProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const CUSTOM_OVERLAY_FIELDS: OverlayFieldMap<BCustomOverlayProps> = {
  position: "position",
  rotation: "options",
  properties: "options",
  offset: "recreate",
  anchor: "recreate",
  zIndex: "recreate",
  minZoom: "recreate",
  maxZoom: "recreate",
  enableMassClear: "recreate",
  ...VISIBILITY_FIELD,
};

/**
 * prop → Driver 描述符键。
 *
 * 只写一项：`visible` 不是 SDK 属性（`show` / `hide` 是继承来的方法）。其余字段与描述符键同名，
 * 走缺省（缺省语义是「同名」，不是「按命名规律推断」）。
 */
export const CUSTOM_OVERLAY_DESCRIPTOR_KEYS: Partial<
  Record<keyof BCustomOverlayProps & string, string | null>
> = {
  ...VISIBILITY_DESCRIPTOR_KEY,
};

export interface CustomOverlaySpecDeps {
  /**
   * 业务 DOM 宿主的**读取器**（惰性创建）。
   *
   * 用读取器而不是元素：宿主由 `useCustomOverlay` 在组件作用域内持有，spec 只负责「每次创建实例时
   * 把同一个宿主交给 SDK」。同一个宿主跨重建复用，因此 `<Teleport>` 的目标不会跟着换，
   * slot 里已经渲染的 Vue 子树不会因为一次 `recreate` 被重建（真实 SDK 会调用 `domCreate()`
   * 取 DOM，返回同一个节点即可）。
   */
  readonly ensureHost: () => HTMLElement;
}

export function createCustomOverlaySpec(
  deps: CustomOverlaySpecDeps,
): OverlaySpec<BCustomOverlayProps, OverlayHandle> {
  return {
    type: "custom-overlay",
    // 事件面由事件矩阵给出（`CustomOverlayEventMap` 的 click / mouseover / mouseout）；
    // 这里没有覆盖项——三个事件都是纯转发。
    kind: "custom-overlay",
    targetKind: "overlay",
    fields: CUSTOM_OVERLAY_FIELDS,
    descriptorKeys: CUSTOM_OVERLAY_DESCRIPTOR_KEYS,
    create: (context, p) =>
      context.client.driver.overlays.createCustomOverlay(p.position, deps.ensureHost, {
        anchor: p.anchor,
        offset: p.offset,
        rotation: p.rotation,
        minZoom: p.minZoom,
        maxZoom: p.maxZoom,
        properties: p.properties,
        zIndex: p.zIndex,
        enableMassClear: p.enableMassClear,
      }),
  };
}
