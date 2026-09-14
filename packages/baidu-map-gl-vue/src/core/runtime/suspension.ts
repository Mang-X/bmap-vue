/**
 * 暂停原因的取值表（M4-HANDLE-UX / issue #29）
 *
 * 「暂停原因」是 `MapRuntime` 与 `<BMap>` / `useMapSuspension` 之间的共同词汇，因此和
 * `drivingPolicy` 一类策略常量同形：**值 + 同名类型**，写不出魔法字符串，也不会在两处漂移。
 *
 * 五个内建原因的语义（最后一个 `disposed` 是终态，不是「可以恢复的暂停」）：
 *
 * | 原因 | 谁加的 | 谁移除 | 说明 |
 * | --- | --- | --- | --- |
 * | `user` | `BMapExpose.suspend()`（默认原因） | 调用方 `resume()` | 业务主动暂停；**优先级最高**（页面可见性变化不得解除它） |
 * | `keep-alive` | `<BMap>` 的 `onDeactivated` | `onActivated` | KeepAlive 停用（不销毁 WebGL 地图） |
 * | `document` | 页面 `visibilitychange → hidden` | 页面重新可见 | 后台标签页 |
 * | `offscreen` | 容器离开视口（IntersectionObserver） | 容器回到视口附近 | **不销毁地图**，与 issue 的非目标一致 |
 * | `disposed` | `MapRuntime.dispose()` | **不解除** | 终态：集合永不为空 ⇒ 卸载之后不再调用 SDK |
 *
 * 允许调用方传自己的字符串：与 `useMapEvent` 的「表外事件名原样订阅」同一口径
 * —— 多一个原因只会让它自己那一份暂停生效，不影响既有语义。
 */
export const MAP_SUSPEND_REASONS = {
  user: "user",
  keepAlive: "keep-alive",
  document: "document",
  offscreen: "offscreen",
  disposed: "disposed",
} as const;

/** 内建原因 + 调用方自定义字符串。 */
export type MapSuspendReason =
  | (typeof MAP_SUSPEND_REASONS)[keyof typeof MAP_SUSPEND_REASONS]
  | (string & {});
