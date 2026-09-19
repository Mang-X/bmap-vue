# Breaking Changes

## v1 to v2

所有组件名字增加 `B` 前缀，避免与其他组件库冲突 [#24](https://github.com/Mang-X/bmap-vue/issues/24)

## v2 / v3-beta to v3（JSAPI 4.0 默认切换）

默认 SDK 从「自研 JSONP 加载 CDN 脚本」改为**委托官方 `@baidumap/jsapi-loader` 加载 JSAPI 4.0**
（决策见 [ADR 2026-09-13 默认在线路径委托官方 Loader](/adr/2026-09-13-default-online-loader-cutover)）。
对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| `version` | 任意字符串（例如 `'1.0'`） | 只接受 `'4.0'`，其它值在加载前抛 `BMAP_INVALID_ARGUMENT` | 删除 `version`（默认就是 `4.0`）或显式写 `'4.0'` |
| `apiUrl` / `<BMap api-url>` | 静默用于自建入口 | 默认路径**没有**这个入口，传入即报 `BMAP_INVALID_ARGUMENT` | 改用 `customScriptV4Provider(scriptSrc)` 或 `existingGlobalV4Provider()` |
| `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` / `language` | 静默忽略 | 显式报 `BMAP_INVALID_ARGUMENT` | 外部预加载 SDK 后走 `existingGlobalV4Provider()`（上游 Loader 不接收这些参数） |
| `timeout` | 语义模糊 | 官方支持：`0` = **不超时** | 需要截止时间就显式配一个毫秒数 |
| 显式自定义加载器 | `baiduCdnProvider()` 等 legacy 工厂 | 默认已是 v4；legacy 工厂与旧引擎**已删除** | 新代码用 `./core` 的 v4 Provider 家族（`baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider`） |
| 插件失败 | `TrackAnimation` 标成必需，失败即抛 | 内置插件一律 optional，失败只发 `plugin-error` | 依赖「抛错发现插件没加载」的代码改为监听 `plugin-error` |
| 未知插件名（M8-PLUGIN-CORE / #42） | 静默降级成一个「永远成功」的空实现（`plugin-ready`、状态 `ready`） | Catalog 层抛 `BMAP_PLUGIN_UNKNOWN`；组件层该名字发 `plugin-error`，地图与其它插件不受影响 | 改正名字；不要把 `<BMap :plugins>` 的拼写错误当成「插件已就绪」。注意未知名字**不进注册表**，`getStatus(name)` 是 `undefined` 而不是 `'error'` |
| 插件的作用域（同上） | `scope` 字段存在但不生效：每张地图各插一份脚本，地图卸载可能取消别的地图的加载 | `'global'` 走进程级宿主，**一份文档一份**、地图卸载不释放；未标 `scope` 按 `'map'` 处理 | 需要跨地图共享的插件显式标 `scope: 'global'` |
| `whenPlugin` 的失败值（同上） | optional 失败 resolve `undefined` | resolve `null`（`undefined` 保留给「void 插件」这一合法成功） | 用 `=== null` 判失败，别再判 `undefined` |
| 插件的取消（同上） | `whenPlugin(name, signal)` 的 signal **被忽略** | signal 会让**本次等待**以 `BMAP_PROVIDER_ABORTED` 结束，共享加载继续 | 依赖「取消就一起取消加载」的代码要知道：取消是消费者自己的事 |
| 卸载地图时的在飞插件（同上） | `dispose()` 后底层 promise 结算仍会把记录改回 `ready`/`error` 并广播事件；`map` 插件晚到的实例成孤儿 | 过期结算被丢弃（不写状态、不广播），`map` 插件晚到的实例**就地释放** | 卸载后 `getStatus()` 稳定是 `'disposed'`；监听事件不会再收到已销毁地图的插件事件 |

同一批变更的完整依据见 [官方包契约](../contributing/official-packages) 与
[插件兼容 inventory](../contributing/plugin-compat-inventory)。

## 3.0.0-beta → 3.0（删除旧引擎：`webgl-v1` / `BMapGL`）

M3A.3 把旧引擎整份删除（决策见 [ADR 2026-09-14 删除旧引擎](/adr/2026-09-14-remove-legacy-engine)），
完整的迁移动作见 [WebGL v1 → JSAPI 4.0 迁移指南](./migration-v1-to-v4)。对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| 根入口 Provider factory | `baiduCdnProvider()` / `customScriptProvider()` / `existingGlobalProvider()` | 根入口不再导出任何 Provider | 改用 `baidu-map-gl-vue/core` 的 v4 家族 |
| 迁移期归一 | `withMigrationDriver()` / `createLegacyBMapClient()` | 已删除；definition 原样交给 `createBMapClient` | 删掉那层包装 |
| Provider 形状 | `AnyBMapProviderLike`（结构化 + 裸全局对象） | 只有结构化 `BMapProviderLike` | `load()` 返回 `{ engine: "jsapi-v4", version, namespace, … }` |
| `<BMap allowExistingGlobal>` / 插件同名选项 | 显式 opt-in 复用已有全局（`BMap ?? BMapGL`） | prop 与选项都删除 | 传 `provider: existingGlobalV4Provider()` |
| 「页面已有全局」自动回退 | 有全局就回退并 warn | 已删除 | 同上 |
| `./advanced` 的 `detectEngine()` / `createDriver({ engine })` | 运行时 engine 猜测 + 多 engine 分派 | 只看 `createJsapiV4Driver({ rawSdk, version, unsupported })` | 显式给版本，不要再猜 engine |
| `LoadedSdk` | `LoadedJsapiV4 \| LoadedLegacySdk` 判别联合 | `LoadedJsapiV4` 的别名（`assertLoadedSdk` 唯一收口） | 删掉 legacy 分支处理 |
| Playground | `VITE_BMAP_MODE=legacy-fake` 对照档 | 该档与开关删除 | 无需配置 |
| 包文件清单 | `files: ["dist", "types", "volar.d.ts"]` | `files: ["dist", "volar.d.ts"]` | 无（`types/` 只剩构建期占位文件 `shared/` 与 `ui-kit/upstream.d.ts`，不再发布；`volar.d.ts` 是 Volar 提示产物，必须保留——`tsconfig` 里的 `"types": ["baidu-map-gl-vue/volar"]` 靠它） |

## 3.0.0-beta → 3.0（覆盖物统一内核、事件矩阵与 Rectangle）

M5-VECTORS 把 Label / Polyline / Polygon / Circle / BezierCurve / Prism / GroundOverlay 迁到与
`BMarker` 相同的声明式内核，新增 `BRectangle`，并把覆盖物事件面收进一张矩阵
（决策见 [ADR 2026-09-18 覆盖物事件矩阵](/adr/2026-09-18-overlay-event-matrix)）。对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| 图形族的事件面 | `<BPolyline>` / `<BPolygon>` / `<BCircle>` 只发 `click` / `dblclick` 两个 | 17 个（含 `mousemove` / `rightdblclick` / `lineupdate` / 6 个编辑事件）；`<BLabel>` 8 个；`<BPrism>` / `<BBezierCurve>` / `<BGroundOverlay>` 11 个 | 新增，无破坏性；不监听的父级不受影响。完整清单见[覆盖物事件矩阵](/zh-CN/components/overlay/events) |
| 图形族 `mouseout` 的载荷 | 直接订阅 Driver 时 raw 缺坐标会被补成 `(0,0)`（组件此前根本不发 `mouseout`） | **保持缺失**（上游 `GraphMouseOutEvent` 声明坐标可缺） | 判空即可（`e.point?.lng`）；`<BMarker @mouseout>` 不受影响（Marker 的 `point` 上游声明必填） |
| `BGroundOverlay` 的显示区域 | `startPoint` + `endPoint` 两个 prop | `bounds`（`{ southwest, northeast }`），与上游 `createGroundOverlay(bounds, options)` 同形 | 旧名**仍可用**（控制台提示一次、`bounds` 优先）；新代码用 `bounds` |
| `BGroundOverlay.type` 变化 | 组件自己 `watch` + `rebuild()` | 由描述符的 `recreate` 分类触发重建（**行为不变**） | 无需改动 |
| `<BBezierCurve>` / `<BPrism>` 的 `enableEditing` | props 上不存在，但编辑事件也从不派发 | 明确「上游没有编辑能力」：不暴露 prop、事件矩阵里也没有编辑事件 | 需要编辑请改用 `<BPolyline>` / `<BPolygon>` / `<BRectangle>` / `<BCircle>` |
| `path` / `controlPoints` 的更新判据 | 各组件手写（有的根引用、有的附带版本 prop） | 统一为「根引用 + 版本 prop」：原地改数组不会触发，换引用或递增 `pathVersion` / `controlPointsVersion` 才触发 | 原地修改数组的代码请在修改后递增版本 prop |
| `<BMarker @drag-end>` | 组件内硬编码补发 | 由集中弃用层补发（同载荷、同实例提示一次） | 迁移到 `dragend` |
| `BRectangle` | 不存在 | 新增覆盖物组件 | 见 [BRectangle 文档](/zh-CN/components/overlay/rectangle) |
| `BInfoWindow` / `BContextMenu` / `BMapMask` / `BMarker3d` | 命令式 watcher | **本次不变**（仍走 `useOverlayResource`） | 归属见 ADR 已知限制（分别是 #32 / #33 / 待运行时取证）；#33 已在**独立一票**里把 `BContextMenu` 迁到统一内核，见下面那节 |
| `visible=false` 的实现 | `removeOverlay`：实例离开地图（`map.getOverlays()` 少一个，SDK 会派发 `remove`） | `show()` / `hide()`：实例**留在图上**、只是不可见（与 #30 对 Marker、#41 对控件的统一口径一致） | 需要真正摘除请用 `v-if`；`visible` 只表达「显示与否」 |
| `remove` 事件的到达时机 | `<BBezierCurve>` 与 `<BMarker>` 在**组件自身**的摘除路径上也会收到 `remove`：切隐藏（那时走 `removeOverlay`）、卸载 / 重建（那时监听还没解绑） | `remove` 只在**外部**摘除（`map.removeOverlay()` / `map.clearOverlays()`）时到达组件；组件自身的卸载 / 重建 / 隐藏不再回放它。其余六个组件此前根本不订阅 `remove`，现在按事件矩阵统一订阅（纯新增） | 用 `remove` 做「外部把我摘掉了」这类清理的代码要注意卸载时不会再有这条通知；感知显隐用 `visible`，感知卸载用组件生命周期 |

**props 与 emits 层面无破坏性变更**（八个组件的 props 名与默认值未变，只新增 `bounds`；emits 只增不减），
但上表最后两行是**行为语义**的变化：`visible` 的实现方式、以及 `remove` 的到达时机。

两处**类型 / 元数据层**的附带变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| `LabelStyle`（`<BLabel style>`） | `Record<string, any>` | `Record<string, unknown>` | 读样式值的代码可能要自己收窄（有意的收紧） |
| 覆盖物组件的 devtools 名字 | 五个组件没有 `defineOptions({ name })` | 九个组件统一声明 | 无行为变化 |

## 3.0.0-beta → 3.0（控件统一 spec 与全景基线）

M7 把控件收进统一的 `ControlSpec`，并补上全景基线（决策见
[ADR 2026-09-17 控件统一 spec 与全景基线](/adr/2026-09-17-control-spec-and-panorama)）。
对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| 控件的 `visible` | `false` 会把控件从地图上**摘掉**（`removeControl`），`true` 再挂回来 | SDK 基类的 `show()` / `hide()`：控件始终挂载，只切换可见性 | 行为通常更符合预期（内部状态不再重置、`BLocation` 不再顺带停掉定位跟踪）。若确实需要「不挂载」，请用 `v-if` 卸载组件 |
| 控件的 `anchor` / `offset` | 只在构造期生效，运行期改 props 不产生任何效果 | 变化即下发 `setAnchor()` / `setOffset()`（按 `anchor → offset` 的顺序成对写，避免 SDK 重置偏移） | 无需改动；依赖「改了不生效」的代码要显式避免改这两个 prop |
| `BCopyright` 的 `anchor` | 同上（改了不生效） | **构造期项**：实例按停靠位置共享，就地 `setAnchor()` 会让实例与它服务的 anchor 脱钩（同一位置出现两个控件），因此改变它走**重建 + 共享组迁移** | 无需改动；注意这会重建控件（内部状态重置） |
| 选项从有值改回 `undefined` | 「没变化」以外什么都不做（旧值留在控件上） | 等价于「回到 SDK 默认值」⇒ **重建控件**，由构造期重新采用默认值 | 无需改动；若不想重建，请显式传入目标值而不是 `undefined` |
| `BCopyright` 的 `visible` | 只摘掉本组件那一条版权项 | **不变**（共享控件按 anchor 复用，隐藏整个控件会连带隐藏兄弟组件的内容） | 无需改动 |
| 新增控件组件 | `<BNavigation>` / `<BMapType>` / `<BOverview>` 不存在（只有 Driver 侧的 kind） | 三个 Stable 组件可用，选项按官方能力分「就地更新 / 重建」两档 | 见各组件文档的「选项的更新方式」 |
| 控件组件的卸载 | 各自手写 `onMounted` / `onUnmounted` | 全部经 `useSdkResource` 派生的统一 adapter | 无需改动；`scope` 的释放顺序（先解绑业务事件、再 `removeControl`）不变 |
| `useControlResource`（`./core` 子入口） | `(props, adapter)`，adapter 是 `{ create, addToMap, remove, createWatchers }` | `(props, spec)`，spec 是声明式的 `ControlSpec` | 自建控件的调用方按 `ControlSpec` 重写；`buildControlOptions` / `bindControlEvents` 两个无消费者的帮手已删除 |
| 全景 | 只有 Driver 侧的 `PanoramaViewerDriver`（skeleton） | `<BPanorama>` / `<BPanoramaLabel>` / `usePanoramaService`（**post-stable**，见[发布范围](/zh-CN/components/panorama/)） | 需要全景点位/标注/检索时使用；Stable 上不依赖它 |

## 3.0.0-beta → 3.0（自定义 DOM 覆盖物、声明式右键菜单）

M5-CUSTOM-MENU / #33 新增 `<BCustomOverlay>`、给 `<BContextMenu>` 补上数据与声明式两套菜单项 API，
并让「菜单挂到标注上」这条路径**真的可用**（决策与实测读数见
[ADR 2026-09-19](/adr/2026-09-19-custom-overlay-and-context-menu)）。对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| `<BCustomOverlay>` | 不存在 | 新增：detached 宿主 + `<Teleport>` 的 DOM 覆盖物，支持 `position` / `offset` / `anchor` / `rotation` / `zIndex` / `minZoom` / `maxZoom` / `properties` / `visible` 与三个事件 | 见 [BCustomOverlay 文档](/zh-CN/components/overlay/custom-overlay) |
| `<BContextMenu :menuItems>` | 唯一的数据入口 | `items` 是正典；`menuItems` **仍可用**，但会在控制台提示一次（同实例一次），且 `items` 有值时旧名完全不参与 | 新代码用 `items`；旧写法无需立即改 |
| 声明式菜单项 | 不存在（只能传数组） | 新增 `<BMenuItem>` / `<BMenuSeparator>`；与数据 API 归一化成同一份条目，可混用（`items` 在前、children 在后） | 见 [BContextMenu 文档](/zh-CN/components/control/context-menu) |
| 菜单挂到 `<BMarker>` 里 | **不生效**（Driver 拒绝 `overlay` 目标，只是不会报错：组件吞掉了异常） | 挂到**该标注**上（`Marker#addContextMenu`，4.0 的运行时扩展成员）；写在 `<BMap>` 下则挂到地图 | 原先「以为挂上了其实没有」的用法现在真的生效；若你想让菜单作用于整张地图，请把它移出 `<BMarker>` |
| 菜单挂在**其它**目标下（普通覆盖物 / 旧层组件） | 静默不生效 | 显式报错（`resource:error` 收到 `BMAP_CAPABILITY_UNSUPPORTED`），**不回退**到地图 | 检查菜单的层级位置；需要地图级菜单就移到 `<BMap>` 直接子节点 |
| `<BContextMenu>` 的 `open` / `close` | 已转发 SDK 事件 | **不变**（仍然只是观测）；新增 `select` 事件（本库派发，载荷含被选中项与坐标） | 监听 `select` 走「菜单被选中」这条逻辑 |
| `ContextMenuItem` 的 `callback` 参数 | `(...args: any[]) => void`（载荷形状没有类型） | `(payload: ContextMenuSelectPayload) => void`（`{ item, index, point, pixel, map, target }`） | 解构用法（`({ map }) => …`）不受影响；`ContextMenuItem` / `ContextMenuSeparator` 改从 `baidu-map-gl-vue` 的类型入口导出（此前从 `BContextMenu.vue`），具名导入路径不变 |
