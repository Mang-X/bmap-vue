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

### 评审修正（#212）

- **P1 · 同步 setter 会静默失效**：新检索取代在飞检索时实例会被重建，重建参数原本只读声明式选项
  ⇒ `setLocation` / `setPageCapacity` / `setPageNum` 设完紧接着 `search()` 会悄悄用回旧值。
  现在同步 setter 同时记进**运行期覆盖**，重建时优先于声明式选项；声明式选项变化则整份作废
  （避免「改了 ref 却不生效」）。补 `search A（未结算）→ setter → search B` 用例。
- **P2 · `peek()` 不校验 Client**：Client 变化后、下一次 `execute()` 之前，同步路径会作用到旧
  Client 的句柄上。`withHandle` 现在比较缓存实例所属 Client 与当前 Client，失配即拒绝；补
  Client 切换 / 清空的用例。
- **P2 · 假 SDK 与官方边界语义不一致**：`getPageNum()` 初值改为读构造参数 `options.pageNum`
  （原来恒 0）；`setPageCapacity` 按官方「超范围重置为 10」、`setPageNum` 按「无效值重置为 0」
  夹取（原来宽松放行，会让公共 API 只在假实现里"验证通过"）。补三条边界用例。

### 第二轮评审修正（#212）

- **P1 · 跨 Client 的 `MapHandle` 覆盖**：运行期 `location` 覆盖现在按**所属 Client** 校验；
  `MapHandle` 属于别的 Client 时回退到声明式 `location`，不再把旧句柄带进新 Client（那会让检索
  一直 `failed` 且无法自救）。判据抽成纯 boundary（`localSearchRuntimeOverrides.ts`），带行为反例。
- **P2 · 重放 setter 原始入参**：`pageCapacity` / `pageNum` 记的是**SDK 生效值**（官方会把越界
  容量归一到 10、无效页码归一到 0），重建前后 getter 一致。Fake 构造期也按同一规则归一化。
- **P2 · Fake `gotoPage` 未同步页码**：成功翻页后 `getPageNum()` 与 `data[0].pageIndex` 一致；
  失败翻页不更新。
