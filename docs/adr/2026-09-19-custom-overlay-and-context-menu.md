# ADR 2026-09-19：自定义 DOM 覆盖物、声明式右键菜单与「运行时扩展成员」的处置

- 状态：已接受（Accepted）
- 日期：2026-09-19
- 计划键：`M5-CUSTOM-MENU`（issue #33，追踪 #12，前置 #30 / #32）
- 取代（**只取代下列具体条目，不整份取代**）：
  - [ADR 2026-09-18 覆盖物事件矩阵](./2026-09-18-overlay-event-matrix.md)「已知限制 1」里关于
    `BContextMenu` / `BCustomOverlay` 的那一行（「#33 负责迁移」——本 ADR 落地迁移，并把
    「菜单不走 `OverlaySpec` 内核」从**欠账**升格为**有依据的决策**，见决策 3）；
  - 同 ADR「已知限制 9」的**前半**（`BContextMenu` 仍有 `{ deep: true }` 的 watcher）：本 ADR 之后
    它不再有 watcher，改成「按指纹重建 + 声明式 children 合帧解析」。
  - 「已知限制 9」的**后半**（`BInfoWindow` / `BMapMask` / `BMarker3d`）继续有效，不属本 ADR。
- 相关：
  - `packages/baidu-map-gl-vue/src/components/overlays/BCustomOverlay.vue`、`customOverlaySpec.ts`
  - `packages/baidu-map-gl-vue/src/components/overlays/BContextMenu.vue`、`BMenuItem.vue`、`BMenuSeparator.vue`
  - `packages/baidu-map-gl-vue/src/core/overlays/ContextMenuSpec.ts`、`core/context/menu.ts`
  - `packages/baidu-map-gl-vue/src/core/composables/useCustomOverlay.ts`、`useContextMenu.ts`
  - `packages/baidu-map-gl-vue/src/core/deprecations/resolve.ts`（读取规则抽出，两个消费者共用）
- 对照物：官方 React 组件库 `huiyan-fe/react-bmap@2.0.3`
  （`src/components/Overlay/CustomOverlay.tsx`、`src/components/Menu/index.tsx`、`src/drivers/v4Driver.ts`）
- 官方依据：`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/CustomOverlay.d.ts`、`overlay/CustomOverlayOptions.d.ts`、
  `context-menu/{ContextMenu,MenuItem,MenuItemOptions}.d.ts`、`core/Map.d.ts`；
  以及**真实 AK 探针**（见决策 0 的读数表）

## 背景

`BCustomOverlay` 在仓库里**不存在**（v2 有、v3 迁移期丢了），`BContextMenu` 存在但只支持数据数组、
且「挂到父标注」这条路径在 v4 上被 Driver 拒绝。M5 的这张票要补齐这两块，同时收掉 #31 留下的两条欠账。

更关键的是：#31 的事件矩阵把 `custom-overlay` 与 `context-menu` 登记成「**上游没有事件表**」，理由是
「上游 `CustomOverlay` 只声明了 domCreate 与容器 API」「上游没有 `ContextMenuEventMap`」。
这两句话在 `@baidumap/jsapi-v4-types@4.0.4` 里**都是错的**——两张表都在，只是不在
`overlay/OverlayEvent.d.ts` 里：

| kind | 上游事件表 | 声明所在文件 |
| --- | --- | --- |
| `custom-overlay` | `CustomOverlayEventMap`（3 个：click / mouseover / mouseout） | `overlay/CustomOverlay.d.ts` |
| `context-menu` | `ContextMenuEventMap`（2 个：open / close） | `context-menu/ContextMenu.d.ts` |

那条错误结论的成因很具体：矩阵门禁**只解析了一个文件**。这是「证据-before-抽象」的一个反面样例——
结论不是来自「查过、确实没有」，而是来自「只查了一处」。

## 决策 0：`Marker#addContextMenu` 是**运行时扩展成员**，本库据此支持 marker 目标的菜单

#33 开工前，仓库里的口径（写在 `v3-bcontextmenu.test.ts` 的模块注释里）是：

> v4 的 `OverlayDriver.attachContextMenu` 只接受 `target.kind === "map"`（4.0 的 ContextMenu 一律经
> `map.addContextMenu` 挂在 Map 上，**没有 Marker 级入口**）。

这条口径**只依据了类型包**。真实 4.0（AK + headless Chromium）的实测读数：

| 问题 | 读数（2026-09-19，跑三轮探针） |
| --- | --- |
| `Marker.prototype` 上有 `addContextMenu` / `removeContextMenu` 吗 | **有**（两个都是 `function`）；`@baidumap/jsapi-v4-types@4.0.4` 只在 `Map` 上声明它们 |
| `marker.addContextMenu(menu)` 之后右键该标注 | 菜单的 `open` **派发**、`menu._isOpen === true`、`getDom()` 有内容 |
| `marker.removeContextMenu(menu)` 之后同样的右键 | **不再** `open`（detach 真的生效） |
| 同一个菜单挂三次、右键一次 | 仍然只有 **1** 条 `open`（SDK 按身份去重）；摘一次即彻底失效 |
| 菜单项回调收到什么 | 菜单弹出位置的**地理坐标点**（`{lng, lat}`，与官方文档一致），随后菜单关闭并派发 `close` |
| `ContextMenu#show()` / `hide()` 是否派发事件 | 是（`open` / `close`），且**未右键过**也能 `show()` 而不抛错 |
| `map.destroy()` 之后 `marker.removeContextMenu` / `menu.hide()` | 都**不抛错** |

`CustomOverlay` 侧的读数：

| 问题 | 读数 |
| --- | --- |
| 在业务 DOM 上派发 `click` / `mouseover` / `mouseout` | 实例派发**同名事件**（三个都收到）⇒ `CustomOverlayEventMap` 在运行时成立 |
| `setPoint(point, true)` | 只位移，**不**重新调用业务 DOM 工厂 |
| `setPoint(point)`（省略第二参数） | 重新调用业务 DOM 工厂（`domCreateCalls` +1） |
| `show()` / `hide()` / `isVisible()` | 都有；`hide()` 之后 `isVisible() === false`，业务 DOM 仍 `isConnected`（父级被 `display:none`） |
| 业务 DOM 落点 | 在 `bmap-container` **内部的嵌套 div** 里（不是容器顶层），说明 SDK 会搬运它 |

**处置**：按仓库对这类成员的既有口径（`Marker3D` / `MapMask` / `BMap.Icons` 同一族）走
**结构性查找 + 缺失即显式失败**，**不做就地类型 augmentation**（`augmentations/README.md` 的
「先确认能否用项目领域类型绕开」）。`overlays.ts` 里的 `requireContextMenuTarget` 与
`callContextMenuTargetMethod` 就是这条口径的落点，依据写在那两处 JSDoc 与
`driver/types/overlays.ts` 的 `attachContextMenu` 文档里。

**这条决策的可复现证据**进了 live smoke（`context-menu-marker-target`），不只是 ADR 里的一段话。

## 决策 1：矩阵门禁改成多文件解析，并把「文件」也纳入双向核对

单文件解析既是这次错误结论的成因，也可能再次发生。因此：

- 解析清单 `UPSTREAM_EVENT_FILES` **显式列出三份** `.d.ts`：少列一个文件 ⇒ 对应 kind 的表解析不到 ⇒ 直接红；
- 新增一条「没有任何一张上游事件表同时出现在两个文件里」——上游挪了声明位置时**先红**，
  而不是让「合并成一张全局表」把变化吃掉；
- 新增一条「每个 kind 的事件表名与**声明文件**都对得上」（`UPSTREAM_MAP_BY_KIND` +
  `UPSTREAM_FILE_BY_KIND`，后者是唯一一张手写的文件映射，由前者 + 解析结果守住）。

## 决策 2：`BCustomOverlay` 走 `OverlaySpec` 内核 + **组件侧持有的 detached 宿主**

`CustomOverlay` 是普通覆盖物（`map.addOverlay`），因此完整复用 #30/#31 的内核：声明 `fields`、
构造期属性走 `recreate`、其余走字段级 setter、事件面由矩阵派生。没有新增任何内核扩展面。

宿主分工与 `#32` 的 `BInfoWindow` **同构**：

```
useCustomOverlay ── 创建 host（一个 detached <div>）
       ├─ createCustomOverlay(position, () => host)  ← SDK 只是「拿到并搬运」它
       └─ <Teleport :to="host">                      ← Vue 拥有 host 内部的渲染子树
```

两条与 `InfoWindow` **有意的差异**：

1. **宿主一个组件一份、跨重建复用**（InfoWindow 是每代实例新建一个）。理由是「移动」这条路径：
   `InfoWindow` 的移动是「关掉再打开」（没有 `setPosition`），而 `CustomOverlay` 有 `setPoint`。
   复用同一个宿主 ⇒ `<Teleport :to>` 的目标元素身份稳定 ⇒ **任何一条重建路径都不会让 slot 子树
   被卸载重建**（有专门用例钉住：`anchor` 变化重建实例后，宿主元素与 `.keep` 子树都还在）。
2. **不做尺寸观察 / 合帧**。`InfoWindow` 有官方 `redraw()` 入口，所以 #32 需要 `useResizeObserver`
   + `FrameScheduler`；`CustomOverlay` **没有**重绘入口（真实原型的成员表里没有），位置刷新由 SDK
   自己的渲染循环负责（官方为此提供构造选项 `synUpdate`）。没有可下发的命令就没有可合帧的对象 ——
   凭空加一个「我们自己的重绘循环」属于自研官方没有的能力。

`$attrs` 落在宿主内部的包装节点上（根是 `<Teleport>`，不是元素，绑不上去也不会被自动继承）。

## 决策 3：`BContextMenu` 复用 `useSdkResource` 而**不**走 `OverlaySpec` 内核

引擎对菜单的动词是**「挂到目标上」**（`Map#addContextMenu` / `Marker#addContextMenu`），不是
「加进地图」（`map.addOverlay`）：菜单从不出现在 `map.getOverlays()` 里，也不参与 `clearOverlays()`。

内核的 `mount` 固定走 `add/remove`（`useOverlaySpec` 的 `addToMap`），为菜单加一个 `mount` 覆盖钩子
会让「登记在前 + 失败回滚」那段（PR #103 评审 1 的收敛点）出现第二份实现。因此菜单复用的是内核
**下面那层**：

| 复用 | 来自 |
| --- | --- |
| 实例 child scope / 代次守卫 / 重建即释放 | `useSdkResource` |
| 登记 + 回滚（`registration.remove`） | `OverlayRegistry.registerResource` |
| SDK 事件面 | `core/overlays/overlayEventCatalog.ts` 的 `context-menu` 矩阵 |
| 旧 prop 名的读取规则 | `core/deprecations/resolve.ts`（与 `useOverlaySpec` 共用一份实现） |

这条从 #31 的「欠账」变成「有依据的决策」：内核的 `mount` 语义与菜单的资源语义不同，
硬套会让两处记账逻辑分叉。

## 决策 4：`open` / `close` 只是观测，**不**升级成受控状态

issue 的 ownership-first 补充点名了这条，本 ADR 记下依据：

- 官方**没有**可靠的「菜单当前是否打开」读回（`_isOpen` 是私有字段，本库不读私有面）；
- 官方**没有**「在指定位置打开」的公开入口：`ContextMenu#show()` 是「在上一次右键的位置把弹层显示出来」
  （实测未右键过也不抛错，但位置由 `curPoint` / `curPixel` 决定）；
- 菜单的打开由**用户右键**驱动，属性上没有任何对应的「期望状态」。

因此本层**不建** pending / outstanding / 配对表，也没有 `MenuManager`；`open` / `close` 原样转发，
`visible` 的语义是**资源所有权**（挂 / 不挂）。

`select` 是**本库事件**而不是 SDK 事件：官方把「选中」经 `MenuItem` 的构造回调给出（回调参数是菜单
弹出位置的地理点）。数据 API 的 `callback` 与声明式的 `@select` 归一化到同一个 `onSelect`，
两者都会触发组件级的 `select` —— 「两种写法行为一致」因此在结构上成立。

## 决策 5：target 只支持 `map` 与 `marker`，其余**显式失败**

`requireContextMenuTarget` 对 `overlay` / `clusterer` 抛 `BMAP_CAPABILITY_UNSUPPORTED`
（**不**回退到地图：那会变成「菜单在整张地图上冒出来」的另一种语义），也没有任何「静默 no-op」。

「旧层覆盖物」是单独一条路径：`BMapMask` / `BMarker3d` 经 `overlayContextKey` 暴露句柄、**不提供
`TargetContext`**（#30 起的挂载目标契约）。因此「有旧 key 但没有 `TargetContext`」被判成 unsupported
并显式报错，而不是猜一个目标。这条在正文已知限制里点名。

## 决策 6：声明式 children 的顺序 = **渲染顺序**

`<BMenuItem>` / `<BMenuSeparator>` 渲染一个占位元素（带登记键）进父级提供的 detached 宿主，
父级在 `nextTick` 后按**占位元素在宿主里的先后**还原顺序。

为什么不是「注册顺序」：`v-if` 之下被隐藏又再次显示的项会**重新挂载**，注册顺序会把它排到末尾，
而渲染顺序仍然把它放回模板里写的位置（唯一合理的期望）。有用例专门钉住这条
（`a / v-if b / c`：`b` 出现时顺序是 `a,b,c`）。

为什么不是「遍历 vnode 树」：那要求父级在子组件 `setup` **之前**拿到本轮渲染的 vnode，而
`<script setup>` 的模板渲染不在父级的控制流里；占位元素方案只依赖「DOM 顺序 = 渲染顺序」这一条
Vue 的稳定事实（patch 按 vnode 顺序插入）。

注册表存的是**读取器**而不是值快照（`declare(() => ({...}))`）：子组件的 props 会变，
存快照就必须再配一条「同步快照」路径，那条路径迟早漏字段。父级用**指纹**（条目种类 / 文字 / disabled /
width / id，**不含回调**）决定要不要真的重建菜单 —— 于是「父级每次渲染传新的内联回调」不会让菜单
在用户看着的时候闪一下。

## 决策 7：集中弃用层的读取规则抽成共享函数

「新 API 优先 / 旧名要齐备 / 不猜」原本只写在 `useOverlaySpec` 里。菜单的 `menuItems` → `items`
需要**同一条**规则，因此抽到 `core/deprecations/resolve.ts` 的 `resolvePropAliasValue()`，
两个消费者共用。两份同源实现会在「正典为 `undefined` 算不算缺失」这类细节上分叉，
而分叉的表现是「旧名有时生效有时不生效」——本仓库反复吃过这个亏。

## 实施步骤逐条对照

| issue 的步骤 | 本 PR 的落点 |
| --- | --- |
| 1. CustomOverlay host 创建、Target 挂载与 Teleport | `useCustomOverlay` + `BCustomOverlay.vue`（detached 宿主 + `<Teleport>`） |
| 2. 将 DOM 尺寸 / 位置更新纳入 `FrameScheduler` | **有意不做**，见决策 2 第 2 条（`CustomOverlay` 没有重绘入口，位置由 SDK 渲染循环负责） |
| 3. 为菜单建立 item registry 和 reactive children | `core/context/menu.ts`（声明式注册表）+ `ContextMenuSpec.ts`（归一化与指纹） |
| 4. target 变化时先 remove old 再 add new | `useContextMenu.attach()` 的身份记账 + 先摘后挂；用例断言任何时刻只有一个 |
| 5. 绑定 SDK 的真实 open / close / select 事件 | `open` / `close` 来自事件矩阵；**`select` 不存在于 SDK 事件表**，由 `MenuItem` 回调派生（决策 4） |
| 6. 汇总 deprecated API 映射和文档 | `menuItems` → `items` 进集中弃用表；`migration-from-v2` 的弃用表、`breaking-changes`、组件页与 `events.md` 同步更新 |

## 验证

| 检查 | 命令 / 落点 |
| --- | --- |
| 矩阵 ↔ 上游三份 `.d.ts`（双向差集 + 文件归属 + 表不重复） | `tests/behavior/v3-overlay-event-matrix.test.ts` |
| 矩阵 ↔ 文档镜像 | `tests/behavior/v3-overlay-events-doc.test.ts` + `docs/zh-CN/components/overlay/events.md` |
| `CustomOverlay` create / mutable / recreate / visible / 事件面 | `tests/behavior/v3-overlay-suite.test.ts`（表驱动，`CASES` / `DECLARATIONS` / `EMITS_CASES`） |
| 宿主所有权、slot 不重建、`setPoint` 不重建 DOM、`$attrs` | `tests/behavior/v3-bcustomoverlay.test.ts` |
| 菜单：数据 / 声明式一致、动态显隐顺序、target 切换与不重复、显式失败、`select` 载荷、旧名告警去重、SSR | `tests/behavior/v3-bcontextmenu.test.ts` |
| Driver：marker 目标结构性调用、去重、缺失即失败、其它目标拒绝 | `packages/baidu-map-gl-vue/src/driver/jsapi-v4/overlays.test.ts` |
| 真实 v4（live）：菜单挂在 marker 上、右键派发 `open` | smoke 的 `context-menu-marker-target` |
| 真实 v4（fixture）：`<BCustomOverlay>` 挂载 / 宿主被搬运 / 卸载无残留；`<BContextMenu>` 挂载与菜单项 | smoke 的 `custom-overlay-visible` / `context-menu-attached` |
| 边界与发布产物 | `check:raw-sdk`（两条）/ `check:public-dts` / `check:no-bmapgl` / `typecheck:v3` / `build:v3` / `test:unit` / `generate:manifest:check` |

## 已知限制（显式接受）

1. **`<BContextMenu>` 的 target 解析只认 `TargetContext`**：`map` / `marker` 之外的 kind 一律
   显式失败；**不提供 `TargetContext` 的组件**（`BMapMask` / `BMarker3d` 这类）不会成为目标，
   其下的菜单落到 `<BMap>` 自己的地图 target 上（与「直接写在 `<BMap>` 下」同义）。
   这条口径在合并 #105 时**改过一次**：初版判据依赖 `overlayContextKey`（「最近的 target 是地图、
   而父链上还有旧 key」⇒ 报错），而 #104 的存量审计把那个 key 整条删除了（连 `BMarker` 的 provide
   一起）。按 #104 的方向，本层**不**为「区分旧层覆盖物」把 key 加回来——没有公开契约可依据时就不猜。
   （代价如实记下：一个挂在 `BMapMask` 里的菜单会变成地图级菜单，而不再报错。）
2. **`visible` 与描述符的 `show`/`hide` 不是同一件事**。`OVERLAY_DESCRIPTORS["context-menu"].visible`
   登记的是 SDK 的实例方法（弹层显隐），而组件的 `visible` 是「挂 / 不挂」。两者的名字撞车，
   因此在描述符条目里写了警示注释；本 ADR 是这条偏离的正本。
3. **`CustomOverlay` 没有 `nextTick` / `synUpdate` / `rotationFlip` 等构造选项的 props**。
   它们是官方声明的选项，但不在 issue 的范围内，也没有当前消费者；需要时按「新增公开面」单独一票补。
4. **菜单重建是「整份替换」**：官方没有整袋替换入口，`MenuItem#disable()` 之后也无法再 `enable()`
   （而且没有读回），因此 `items` / `width` / `id` 变化一律重建（`width` 与 `id` 是官方
   `MenuItemOptions` 的**全部**两个键，都只在构造期生效）。代价是「改一个字的菜单项也会换一个实例」，
   已用「指纹不含回调」把「父级传内联回调」这条最常见的抖动排除掉。
5. **声明式 children 的顺序依赖占位元素在宿主里的先后**。若将来 Vue 改变 slot 的 patch 顺序
   （或我们改用其它渲染容器），这条判据需要重新核对；`v3-bcontextmenu.test.ts` 的 `v-if` 用例是它的守卫。
6. **`select` 的坐标归一化沿用迁移前的口径**：SDK 给了空点时不阻断菜单动作，`point` / `pixel` 为 `undefined`。
7. **`useParentOverlayHandle` 仍是公开导出但没有生产消费者**（本 PR 之后菜单改走 `TargetContext`）。
   它属于已发布的公共 API，删除是破坏性变更，因此**保留**并在本 ADR 记录；建议在 #44（公共出口冻结前）
   按「无消费者的公共面」统一处置。

## 非目标

- 不把 `open` / `close` 做成受控（决策 4）；
- 不为菜单引入 `MenuManager` 之类只为「猜 callback 来源」的协议层；
- 不迁移 `BMapMask` / `BMarker3d` / `BInfoWindow`（各自的归属票）；
- 不为 `BCustomOverlay` 加「尺寸自适应」的自研重绘循环（决策 2）；
- 不改 `OverlaySpec` / `useOverlaySpec` 的公开契约（只把别名读取规则抽成共享函数，行为不变）。

## 参考

- issue #33（`M5-CUSTOM-MENU`）、追踪 issue #12；前置 #30（`M5-SPEC-MARKER`）、#32（`M5-INFOWINDOW`）
- [ADR 2026-09-17 声明式 OverlaySpec 与 Marker](./2026-09-17-overlay-spec-and-marker.md)
- [ADR 2026-09-18 覆盖物事件矩阵、字段 watch 源与集中弃用层](./2026-09-18-overlay-event-matrix.md)
- [ADR 2026-09-18 信息窗口的宿主持有与归属](./2026-09-18-infowindow-host-and-ownership.md)
- 官方：`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/CustomOverlay.d.ts` / `context-menu/ContextMenu.d.ts` /
  `core/Map.d.ts`；JSAPI 4.0 API 参考
- 对照：`huiyan-fe/react-bmap@2.0.3`（它的 `CustomOverlay` 用 portal、`ContextMenu` 允许 overlay target ——
  后者的方向与本库本次实测结论一致，但它的实现依赖「目标上有 `addContextMenu`」这条当时未取证的假设）

## 评审修正（PR #107 第一轮，2026-09-19）

外部复审给出 4 条阻塞项，**逐条先写会红的复现再修**（全部 `confirmed`，读数与评审描述一致）：

| # | 发现 | 复现读数（修复前） | 修法 |
| --- | --- | --- | --- |
| 1 | 「不再回放事件」的标记写在 `detach()` 里，而 `detach()` 同时服务**临时摘挂**（`visible=false`、target 迁移）⇒ 标记无法撤销，同一个菜单实例在被重新挂上之后 `open`/`close` 被**永久吞掉** | `expected [] to deeply equal [ 'open', 'close' ]`（`visible true→false→true` 后派发）与 `expected [] to deeply equal [ 'open' ]`（marker 重建换 target 后派发） | 把释放拆成两条语义：`detach()`（临时摘挂，**不**改事件判定）与 `release()`（最终释放：先立标记再摘除）；`registration.remove` 走 `release()`。补两条回归（临时摘挂 / target 迁移） |
| 2 | `latestEntries` 只在 `create()` 里赋值，而**回调不进指纹** ⇒ 只换 `callback` 时不重建、也不更新，最终调用旧函数 | `expected [ 'cbA' ] to deeply equal [ 'cbB' ]` | 抽出 `syncEntries()`：**无条件**同步 `latestEntries` 并返回指纹；watch 源与 `create()` 都走它。「指纹没变 ⇒ 不重建」**不等于**「什么都不做」 |
| 3 | `id` 是公开 API + 进指纹，但 Driver 只下发 `width` ⇒ `id` 被静默丢弃（改 id 会重建，重建后仍没有 id） | `expected {} to match object { id: 'item-from-data' }` | 按官方 `MenuItemOptions` 把 `id` 一起下发；组件侧按项组装 options（两个键都不给时不下发空对象）；补 facet 与组件两层断言 |
| 4 | M5 重写时丢掉了 v3 的 `width: 100` 默认值，而文档仍写 100 ⇒ 不传宽度时行为与 v3 分叉 | `expected {} to match object { width: 100 }` | 恢复 `width: 100`（文档本来就是对的，错的是代码） |

**评审修正里最有价值的一条（自查新增）**：第 1 条的反向守卫（「最终释放窗口里的事件不回放」）
第一版是**假绿**——它对着传进来的**句柄** `emit`，而句柄上没有 `emit`，注入恒为 no-op，
因此在「彻底去掉标记」的实现下也通过。反证（`release ≡ detach`）把它抓出来后，改成对 **raw 实例**
派发，并加了两条自检（注入真的发生 / 注入那一刻监听仍活着）。**教训**：注入时序的用例，
必须自检「注入有没有落到真实对象上」，否则「没有回放」是空断言。

反证记录（改坏机制 ⇒ 目标用例红，全部用退出码判定、跑完恢复并自查无残留）：
`M1a 标记写回 detach()`、`M1b 去掉最终释放标记`、`M2 latestEntries 只在 create 同步`、
`M3 丢掉 width 默认值`、`M4 不下发 id` —— 五条全部如预期变红（`OK=5 BAD=0 SKIP=0`）。

## 合并 #105（#104 存量审计）时的集成处置

本分支开工时 main 停在 `2af11b6`；合入前 main 前进到 `b127dad`，两侧有 5 个文件重叠，
`git merge` 报出 **2 处真冲突**（其余 3 个自动合并）。逐条处置：

| 文件 | 冲突性质 | 处置 |
| --- | --- | --- |
| `components/overlays/BContextMenu.vue` | #105 改了**旧实现**里的一行注释，而本分支把整个文件重写了 | 取本分支的重写（改动面统计：`2af11b6..b127dad` 对该文件只有 1 行注释，取其无信息损失） |
| `docs/zh-CN/guide/migration-v1-to-v4.md` | #105 把「已知限制」那段按「`useBMapTrackAnimation` 已删除」重排并**保留**了「`BContextMenu` 只能挂在地图上」的旧结论 | 合并两侧事实：`useBMapTrackAnimation` 的删除说明（#105）+ `BContextMenu` 的实测结论（本 ADR），旧结论删除 |

**三处自动合并但语义相关**（文本无冲突 ≠ 语义正确）：

1. **`useOptionalTargetContext()` 被 #104 删除**（「只有一个消费者的公共 helper」），而本分支的
   `useContextMenu` 正是它的消费者。处置：改为直接 `inject(targetContextKey)`——**不**把这个 helper
   加回来（那会与 #104 的结论相反：一个只为包一层 `inject` 存在的 helper，消费者永远只有一个）。
2. **`overlayContextKey` 被 #104 整条删除**（连 `BMarker` 的 provide 一起），本分支的「旧层覆盖物」
   判据因此失去基座。处置：删掉那条分支，改为「没有 `TargetContext` ⇒ 落到 `BMap` 的地图目标」，
   并把测试从「显式报错」改成「等价于地图级菜单」。理由同上：没有公开契约可依据时**不猜**。
3. `index.ts` / `FakeMap.ts` 的自动合并结果正确（前者取 #105 削减后的导出面，后者两侧改的是不同类）。

合并后在**合并结果**上重跑了全部门禁（不是在原分支上）：`typecheck:v3` / `build:v3` /
四条 `check:*` / 两条 `generate:*:check` / `test:unit` / `smoke:v4:fixture` / docs 三件套。
**这类交互是 CI 抓不到的**——CI 只跑在 PR 分支上，不跑 GitHub 算出来的合并结果。
