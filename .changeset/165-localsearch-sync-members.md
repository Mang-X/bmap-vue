---
"@mangax/bmap-vue": patch
---

`useLocalSearch` 补上官方六个**同步**成员，并新增 `withHandle` 活实例通道（#165）。

官方 `LocalSearch` 的 `getPageCapacity` / `setPageCapacity` / `getPageNum` / `setPageNum` /
`clearSelected` / `setLocation` 都是**同步**成员。此前本库只有异步的 `gotoPage`，这些成员
**没有表达位置**——把同步 setter 塞进异步 `execute` 会改掉官方语义，`get*` 更是表达不出来。

- 新增 `ExclusiveServiceTask#withHandle(fn)` / `#currentInstanceExists()`：在**当前活实例**上
  跑同步操作。三条约束都是刻意的 —— ① **不创建实例**（没有活实例就抛 `BMAP_RESOURCE_DISPOSED`，
  不为「设一个分页容量」顺手产生一个 SDK 对象）；② **不参与请求序列**（不改 `status` / `data` /
  在飞调用——一次同步 setter 把状态打成 `loading` 会是明显的谎言）；③ 复用通道持有的
  「当初那个 Client」，跨 Client 句柄照旧被拒。
- `withHandle` **只在独占档**暴露（= 官方有释放入口的那一类）。简单档的服务连实例都不该被
  外部指着改，多一个入口只会诱使调用方去改共享实例。
- Driver 新增对应同步入口；`disposeLocalSearch()` 之后读写显式拒绝（与 `clearLocalSearch`
  既有口径一致），不静默成功。
- `setLocation` 与构造期 `location` 共用同一套归一（城市名 / `Point` / `MapHandle`）。

`getPageCapacity` 等此前只能用异步 `gotoPage` 近似的场景，现在有与官方同为同步的入口。
