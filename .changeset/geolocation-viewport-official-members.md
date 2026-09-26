---
"bmap-vue": patch
---

#165 Slice 1/3/4：定位 hook 对齐官方 `BMap.Geolocation`，`viewportOptions` 对齐官方 `ViewportOptions`

同批次的三处成员级修正，均按 #165「同一能力 ⇒ 同名 / 同参数 / 同返回语义」的口径。
与 `geocoder-official-member-names.md` 是同一票的**不同切片**，评审时分开看。

## Slice 1：`viewportOptions` 声明了官方**不存在**的成员

官方 `BMap.ViewportOptions` 只有四个成员：`enableAnimation` / `margins` / `zoomFactor` / `callback`。
本库此前声明的是 `noAnimation` / `margins` / `zoomFactor`，并且**把 `noAnimation` 原样转发给了 SDK**——
而 SDK 侧根本没有这个键，等于「制造支持外观的假支持」（#165 §3.8），同时官方真实的
`enableAnimation` 与 `callback` 两个成员**没有任何路径可达**。

**破坏性变更**（不保留 deprecated 别名，#165 §3.6）

| 位置 | 变更 |
| --- | --- |
| `viewportOptions.noAnimation` | **删除**（官方无此成员，此前是被原样转发的无效键） |
| `viewportOptions.enableAnimation` | **新增**（官方成员，此前丢失） |
| `viewportOptions.callback` | **新增**（官方成员，此前丢失；按引用原样透传，Driver 不包装） |

影响面：`LocalSearchRenderOptions` 与 `RouteRenderOptions`（两者共用
`normalizeRenderOptions`），即 `useLocalSearch` 与四个路线 composable 的构造选项。
注意 `noAnimation` 在别处**仍然是**官方成员（`Map#centerAndZoom`、`<Map noAnimation>`、
`PanoramaDriver.setZoom`），那些位置不受影响。

`callback` 是**构造期**成员，官方没有对应的实例 setter，因此和 `map` 句柄一样按**身份**比较：
换了函数引用就重建实例（否则仍在用旧回调）。**代价要说清楚**——调用方若在模板里写内联箭头函数
（`() => {...}`），每次重建都会得到新函数身份，从而触发实例重建。解法是把它提成稳定的
引用（`const cb = () => {...}` 再传入），而不是包一层。#165 §5-E「不因回调函数变化重建资源」
针对的是**有 setter 可原地更新**的情形；`viewportOptions.callback` 没有 setter，两害相权取其轻。

## Slice 3：定位 hook 的动作名与结果读取口

官方 `Geolocation#getCurrentPosition` 是唯一的定位入口，`PositionOptions` 的四个成员
（含 `SDKLocation`）逐个原样透传。

**破坏性变更**

| 位置 | 变更 | 说明 |
| --- | --- | --- |
| `useGeolocation().locate` | → `useGeolocation().getCurrentPosition` | 与官方 `Geolocation#getCurrentPosition` 同名；新增可选的逐次 `PositionOptions` 覆盖。 |
| `useGeolocation().get` | **删除** | v2 习惯别名，与 `locate` 同一个函数。 |
| `useGeolocation().location` | **删除** | 与 `data` 同一个 ref，没有可区分的行为。 |
| `BMapGeolocationOptions` | 由 `interface` 改为 `= GeolocationOptions` | 成员名改为与官方**完全一致**。 |
| `useGeolocation({ enableSDKLocation })` | → `useGeolocation({ SDKLocation })` | 此前构造期传的是 `enableSDKLocation`，而官方键名是 `SDKLocation` ⇒ **该选项一直被 SDK 静默丢弃**。逐次调用那侧键名本就正确，两条路径此前不一致。 |

**未暴露（有意）**：`enableSDKLocation()` / `disableSDKLocation()`。语义已由构造选项
`SDKLocation` 覆盖；而它们作用于**具体实例**，`useSimpleServiceTask` 走无状态实例通道、
句柄不向 composable 暴露，要在禁区里实现只能读 `handle.raw`（硬禁止）或调用尚不存在的
Driver 成员。加空实现或静默忽略都属于 §3.8 禁止的假支持。需要改这个开关时新建 hook 实例。

## Slice 4：定位结果的字段保真

| 位置 | 变更 | 说明 |
| --- | --- | --- |
| `address.cityCode` / `address.streetNumber` | **修复：此前恒为 `undefined`** | 官方 `GeolocationAddress` 发的是 snake_case 的 `city_code` / `street_number`，而本库类型承诺 camelCase，Driver 又原样透传 ⇒ **类型在运行时说谎**。现由 `projectGeolocationAddress` 显式映射。 |
| `timestamp` | `number` → `number \| null` | 此前在 composable 投影里写 `Date.now()`，即「结果到达时刻」冒充「设备定位时刻」（缓存命中时可差很远）。现读官方 `GeolocationResult.timestamp`，缺失时为 `null`。 |
| `altitude` / `altitudeAccuracy` / `heading` / `speed` | **新增**（`number \| null`） | 官方 `GeolocationResult` 的成员，此前被丢弃。 |
| `latitude` / `longitude` | **不投影** | 与 `point` 是同一份经纬度，保留两份就成了「同一个值有两个真源」。 |
| `GeolocationOptions` | **新增导出** | 它是 `BMapGeolocationOptions` 指向的同一类型，消费方要给自己的选项**命名**就得能 import。 |

## 未变更

- `useIpLocation` 的 `location` / `data` / `result` 三个同义别名：见 `165-audit-inventory.md`
  的待办，本批未动。
- 路线服务的 `setPolicy` / `setLocation` / `setPolylineStyle` / `enable|disableAutoViewport`
  等官方实例 mutator：需要在 `ServiceInvocationDriver` 上开 mutator 并决定
  「活实例原地改 vs 丢弃实例重建」这一 ADR 级取舍，见 `docs/zh-CN/contributing/165-audit-inventory.md`。
- `TransitRouteResult.intercityPolicy` / `transitTypePolicy`：官方可选字段，投影层尚未读取，
  同样记在清单里。
