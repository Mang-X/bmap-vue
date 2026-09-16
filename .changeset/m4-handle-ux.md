---
"baidu-map-gl-vue": minor
---

`<BMap>` 的**命令面定型**、**容器门禁**与**可见性暂停策略**（`M4-HANDLE-UX` / #29）。

## 冻结的命令面：`BMapExpose`

`<BMap ref>` 拿到的是一份**小而稳定**的命令面（类型 `BMapExpose`），不是 `BMap.Map` 方法表的镜像：

```ts
const api = mapRef.value!
api.getCenter(); api.setZoom(15); api.panTo(spot); api.fitBounds(bounds)
api.supports('map.bounds'); api.whenReady(); api.retry()
```

- **常用命令 14 条**：`getCenter` / `setCenter` / `getZoom` / `setZoom` / `getHeading` /
  `setHeading` / `getTilt` / `setTilt` / `getBounds` / `getSize` / `panTo` / `panBy` / `fitBounds` /
  `supports(capability)`；
- **未就绪时的契约**：读命令给 `null`、写命令是**空操作**（不排队、不会在就绪后重放）。
  要确定性请先 `await whenReady()`；SDK 调用失败照常抛出；
- **raw 逃生口只在 `./advanced`**：`getMapInstance()` 给的是 driver 层句柄（`MapHandle`），
  raw SDK 对象经 `unwrapRaw()` 获取；根入口不导出 `unwrapRaw` / `createHandle` / `HANDLE_BRAND`；
- **`resetCenter()` 已移除**（破坏性）：它是「名字说重置中心、实现重置整个视野」的废弃别名，
  请用 `resetView()`。

## 容器门禁：零尺寸不建图

容器拿到**非零尺寸**之前不创建地图（Tab / Drawer / 折叠面板展开前正是 0×0，零尺寸建图在真实
浏览器上会得到一张 0×0 的 WebGL 画布）：

- 零尺寸期间 `status` 停在 `idle`、`#loading` 插槽的 `containerReady` 为 `false`、
  `isContainerReady()` 为 `false`、`getMapInstance()` 为 `null`；
- 建好之后容器再变成 0 **不销毁地图**（与 issue 的非目标一致）；
- `enableAutoResize`（默认 `true`，此前是「接收后忽略」的假支持）控制容器尺寸变化是否自动
  `checkResize()`：变化经内部 `FrameScheduler` **合帧**，一帧最多一次；传 `false` 时回到手动。

## 暂停策略：按原因记账（不再是一个布尔位）

`suspend()` / `resume()` 变成一组原因：`user`（调用方，默认）/ `keep-alive`（KeepAlive 停用）/
`document`（页面前后台）/ `offscreen`（离开视口）。**只有原因集合变空才真正恢复**，
并补偿一次 `checkResize()` —— 因此「页面恢复可见」不会顺手解除用户的手动暂停。

- 暂停期间：容器尺寸变化不触发 `checkResize`、合帧任务不提交（保留每个 key 的最后一次）；
- 新公开 `suspendReasons()` / `isSuspended()` / `prefersReducedMotion()`（后者是只读信号，
  刻意**不**参与暂停、也不阻断必要的数据更新）；
- 卸载后（`disposed` 是终态原因）不再调用任何 SDK。

## 状态插槽

`#loading` 与 `#error` 收到**同一份**结构化载荷 `{ status, error, containerReady, retry }`：
业务不需要监听内部 Runtime 就能区分「容器还没展开」与「SDK 在加载 / 失败」，并直接拿到重试入口。
默认错误文案自带一个「重试」按钮；`retry()` 在「门禁未放行 / 已就绪 / 失败态」三种情形下都是幂等的。
默认插槽的载荷**不变**（`status` / `map` / `error` / `client`）。

## 依赖

环境采集（尺寸 / 视口 / 页面前后台 / 减少动画偏好）委托 `@vueuse/core`，作为**精确锁定的运行时
依赖**（`14.4.0`）声明；ESM 产物保持 external，`verify-package` 有断言。决策留在本库（暂停原因集合），
采集与决策的边界见 ADR `2026-09-14-map-handle-container-and-visibility`。

## 评审轮补正（5 条，均已补回归用例 + 单点反证）

- **`supports()` 在真实 JSAPI 4.0 上不再假阴性**：能力探测的来源从两项扩成三项，第三项是
  Map Facet 建图成功后登记的**实例自有成员**（真实 4.0 的 `setZoom` / `setCenter` 不在
  `Map.prototype` 上）。Fake 同步补上 `setBounds`（`map.bounds` 的 `rawMembers` 之一），
  浏览器档的两档读数从「相反」变成「都为 `true`」。
- **观察器随地图实例的资源作用域释放**：`keepAliveBehavior="dispose"` 的
  `onDeactivated → runtime.dispose()` 现在会一并释放 Resize / Intersection 观察器与
  可见性订阅（组件还在 `<KeepAlive>` cache 里时不残留）。
- **KeepAlive 激活只补偿一次 `checkResize()`**：组件层不再额外调用（补偿语义只有 Runtime 一处）。
- **公开的 `suspend('disposed')` 被拒绝并告警**：`disposed` 是终态原因，只能由 `dispose()` 添加，
  否则调用方能把一张正常运行的地图永久锁死。
- **容器门禁覆盖 `retry()`**：建图与重试收敛到同一个判据（容器**当前**是否有非零尺寸）。
  「初始化失败 → Tab 收起 → 点重试」不会在 0×0 容器上建出第二张图；那次重试会挂起，
  等容器重新展开时由门禁接着放行。
- **判据也落在异步边界之后**：`await` SDK 加载期间容器被收起时同样不建图（加载完成后先等容器
  恢复可用，再 `create()`）；挂起的 retry 会随**任何** Runtime 销毁（KeepAlive 停用 /
  `MapContext.dispose()` / 组件卸载）终止，`disposed` 之后再 `retry()` 立即以
  `BMAP_RUNTIME_DISPOSED` 拒绝。
- **失败期间同步 retry 会真的排下一次**：在 `@error` 回调里调用 `retry()`（自动重试）不再复用
  那条即将失败的任务。
- **最终建图判据读 fresh DOM**：`beforeCreateMap` 用同步 fresh 读数（不是尺寸观察器的缓存），
  因此「DOM 已变、观察器尚未交付」的窗口也不会在 0×0 上建图。
- **读数语义 = 布局盒**：与内部 `ResizeObserver(border-box)` 的触发语义一致；**纯 transform 变化
  不属于尺寸门禁**（否则会出现「rect 非零但观察器不通知 ⇒ 永远不建图」）。
