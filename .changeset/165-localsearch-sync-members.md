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

### 第三轮评审修正（#212）

- **P2 · 同 Client 但地图已销毁**：`registry.resolve()` 只验证句柄归属、**不验证 raw Map 是否
  已销毁**，所以「地图卸载 → 换新地图」时旧 `MapHandle` 覆盖仍会被判为可用，把已销毁的地图对象
  交给新 LocalSearch。现在句柄型覆盖还必须等于**当前上下文的地图句柄**；判定不可用时同步清理，
  不再持有旧句柄 + Client 强引用。
- **P2 · Fake 新结果集页码与 getter 不一致**：`dispatchResult` 现在把新结果集的 `pageIndex` 设为
  当前页码，`{ pageNum: 1 }` 与「`gotoPage` 后再 `search`」两种路径下 getter 与
  `data[0].pageIndex` 都不再矛盾。
- **P3 · Fake 构造期与 setter 容量判据不同**：抽出 `normalizePageCapacity` 供两处共用，
  非整数（如 1.5）一律归一为 10。

### 第四轮评审修正（#212）

- **P2 · 等值守卫会丢掉合法外部句柄**：用「等于 `ctx.map`」当存活判据是错的 ——
  `<BMapProvider>` 子树里 `ctx.map` 恒为 `null`，而兄弟 `<Map>`（同一 Client）的句柄**合法且存活**。
- 改为**真实存活判据**：`JsapiV4HandleRegistry` 新增 `release()` / `isLive()`，引擎在 `Map#destroy()`
  真正完成时标记句柄已销毁；`BMapDriver` 暴露 `isHandleLive(handle)`（`owns` 只答归属，答不了
  「是不是还活着」）。registry 是 per-Client 的，因此 `isLive` **一个判据同时覆盖**「跨 Client」与
  「已销毁」两个维度，既保留合法外部句柄、又不会把已销毁的地图交给新实例。
- 端到端用例两条（均经突变验证）：`<BMapProvider>` + 兄弟 `<Map>` 的外部句柄**活过重建**；
  地图卸载销毁后覆盖**被丢弃并回退声明式**。

### 第五轮评审修正（#212）

- **P1 · 可用性失效晚于清理完成**：此前只在 `destroy()` **全部清理成功**时标记句柄失效，
  而 `state.disposed` 一置位所有地图命令就已经抛 `BMAP_RESOURCE_DISPOSED`（清理在飞 / 部分失败
  时也一样）。现在**进入销毁即失效**，与「清理完成可幂等短路」彻底分开。
- **P2 · 公开 Driver 面新增必选成员是破坏性变更**：`CreateBMapClientOptions.driver` 是公开注入点，
  给 `BMapDriver` 加必选方法会让既有自定义实现仅升级一个 patch 就编译失败（运行期还会 TypeError）。
  改为**可选成员**。
- **P2 · 公开语义比实际跟踪范围更广**：只有 Map 销毁推进活跃度，泛化的 `isHandleLive(unknown)`
  会把已 `disposeLocalSearch` 的句柄误报为存活。签名收窄为 `isMapHandleLive?(handle: MapHandle)`，
  只认 `map` 品牌。
- `useLocalSearch#setLocation(MapHandle)` 现在**当场**校验：Driver 未实现 `isMapHandleLive`（无法
  验证）或句柄已失效时**显式拒绝**（`BMAP_CAPABILITY_UNSUPPORTED` / `BMAP_RESOURCE_DISPOSED`），
  不再「先接受、到重建时才静默丢弃」。

### 第六轮评审修正（#212）

- **P2 · 存活判定只在重建时执行**：`create()` 只在**重建**时被调用，而「上一次检索已结算 → 再
  `search`」走的是 `instanceChannel.acquire()` 的**缓存复用**路径，既不会重建也不会查存活 ——
  地图在两次检索之间被销毁时，新检索会打到 `setLocation` 已指向死地图的旧实例上。
  现在 `search` / `searchNearby` / `searchInBounds` 在发起前复核运行期 `MapHandle` 覆盖：失效即
  丢弃覆盖并让缓存实例过期（下一次 `acquire` 重建、退回声明式 location）。补行为用例
  （`search A → setLocation(mapA) → destroy(mapA) → search B`，不 `clear`），突变实测转红。
