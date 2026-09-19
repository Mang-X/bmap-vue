# ADR 2026-09-18：覆盖物事件矩阵、字段 watch 源与集中弃用层

- 状态：已接受（Accepted）
- 日期：2026-09-18
- 计划键：`M5-VECTORS`（issue #31，追踪 #12，前置 #30）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-17 声明式 OverlaySpec 与 Marker](./2026-09-17-overlay-spec-and-marker.md)「已知限制 2」里
    关于「其余覆盖物仍走命令式 watcher」的那一半：本 ADR 把 Label / Polyline / Polygon / Rectangle /
    Circle / BezierCurve / Prism / GroundOverlay 迁到同一内核（Marker 已由 #30 迁完）。
    该条限制对 **`BMapMask` / `BMarker3d` / `BInfoWindow` / `BContextMenu` 仍然成立**（见已知限制 1）。
  - 同 ADR「决策 1」里「`OverlaySpec` 只有 `type` / `fields` / `descriptorKeys` / `create` / `events`」这条
    表面描述：#31 增补了 `kind` / `watchSources` / `fieldValues` / `afterMount`（理由见决策 2、3、5）。
- 相关：
  - `packages/baidu-map-gl-vue/src/core/overlays/overlayEventCatalog.ts`（事件矩阵，新）
  - `packages/baidu-map-gl-vue/src/core/deprecations/**`（集中弃用层，新）
  - `packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec.ts`、`core/composables/useOverlaySpec.ts`
  - `packages/baidu-map-gl-vue/src/components/overlays/*Spec.ts`（八个声明）
  - `packages/baidu-map-gl-vue/src/types/components.ts`（八个 props 接口）
  - `driver/types/events.ts`（覆盖物事件载荷）、`driver/types/overlays.ts`（描述符补全）、
    `driver/jsapi-v4/events.ts` + `driver/normalize/events.ts`（按 kind 的指针兜底）
- 对照物：官方 React 组件库 `huiyan-fe/react-bmap@2.0.2`（`src/components/Overlay/index.tsx`、
  `src/utils/createComponent.tsx`）
- 官方依据：`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/OverlayEvent.d.ts`（逐类事件映射表）、
  `overlay/{Polyline,Polygon,Rectangle,Circle,BezierCurve,Prism,Label,GroundOverlay}Options.d.ts`、
  JSAPI 4.0 API 参考

## 背景

#30 把「声明式覆盖物生命周期」立起来之后，`OverlaySpec` 只有 Marker 一个消费者，缺口集中在三处：

1. **更新层还被复制了 7 份**：Label / Polyline / Polygon / Circle / BezierCurve / Prism / GroundOverlay
   各自手写 5~11 个 `watch`（这七个文件共 **56 处**，口径：`git show HEAD:<file> | grep -c 'watch('` 相加），而且写法互不一致
   （有的 `if (v !== undefined)`、有的不看；`path` 有的按根引用、有的按引用 + 版本 prop）。
2. **事件面各写各的**：Polyline / Polygon / Circle 三个组件的上游事件表**完全相同**（`GraphEventMap`，17 个），
   但组件只 `emit` 了 `click` / `dblclick` 两个；BezierCurve / Prism 的上游表少了 6 个编辑事件
   （`Omit` 掉了），组件里也看不出来。Rectangle 干脆没有组件。
3. **没有 Rectangle，也没有「谁有哪些事件」的清单**：`OVERLAY_DESCRIPTORS` 里有 `rectangle`
   （能力目录 `overlay.rectangle` 也在），但组件侧缺失；事件既没有 typed payload，也没有
   「Prism 不能编辑」这样的能力边界表达。

## 决策

### 1. 事件面由**按 kind 的事件矩阵**派生，组件只声明 `kind`

新增 `core/overlays/overlayEventCatalog.ts`：

- 键 = `OverlayKind`（与 `OVERLAY_DESCRIPTORS` 同一套名字），值 = `{ upstream, events }`，
  `events` 的键是**规范 Vue 名**、值含 `sdk` / `payload` / `requiresEditing` / `description`；
- **Vue 命名规范只有一条**：`vue = toVueEventName(sdk)`（`_` → `-`），与 map 事件**共用同一个函数**。
  覆盖物的上游事件名当前都没有下划线，因此两者逐字相同——但仍然派生，规范只有一处；
- `useOverlaySpec` 按 `spec.kind` 取出事件并**全部绑定**（不再由组件逐个 `emit`），
  `spec.events` 退化为**覆盖项**（例如 Marker 的 `dragend` 要回写位置模型）。覆盖项的 `sdk`
  必须在矩阵内，否则**构造期抛错**（拼错的事件名不会静默落进 attrs）。

举证方式：`tests/behavior/v3-overlay-event-matrix.test.ts` 直接用 TypeScript 的 AST 解析上游
`overlay/OverlayEvent.d.ts`（含 `type XEventMap = GraphEventMap<T>` 与 `Omit<…>` 两种派生形态），
与矩阵**双向取差集**；`v3-overlay-suite.test.ts` 再核对每个 SFC 的 `defineEmits` 键集与
矩阵相等、每个键的载荷注解与载荷档一致。文档侧由 `docs/zh-CN/components/overlay/events.md`
（从矩阵生成的镜像）与 `v3-overlay-events-doc.test.ts` 锁定。

### 1b. 载荷分三档，指针兜底**按 kind 与事件**决定

`driver/types/events.ts` 新增 `OverlayEventPayload` / `OverlayPointerEvent` / `OverlayPartialPointerEvent`，
档位**全部来自上游声明**，不是本库的偏好：

| 档 | 上游依据 | 归一化 |
| --- | --- | --- |
| `pointer`（`point` 必填） | `OverlayMouseEvent.point` 必填 | raw 缺坐标时补 `{lng:0,lat:0}`（与 map 事件同一兜底） |
| `partial-pointer`（可缺） | `GraphMouseOutEvent` = `OverlayBaseEvent & Partial<OverlayMouseEvent>`；`GroundOverlayMouseEvent` 全字段可缺 | **不补**，保留「没有坐标」这个事实 |
| `base` | `OverlayBaseEvent` / `GraphLineUpdateEvent` / `GraphEditEvent` | 只给底座字段，未归一化字段走 `raw` |

因此 `driver/jsapi-v4/events.ts` 在**订阅时**按目标句柄的种类算出兜底策略
（`overlayPointerFallback(kind, sdk)`），`normalizeDriverEvent` 多一个 `pointerFallback` 选项。
map / layer 目标与未被矩阵覆盖的 kind 一律 `default`——**既有口径不变**（`mouseout` 仍在
`POINTER_EVENT_NAMES` 里，`<BMap @mouseout>` 的行为与本 ADR 之前逐字相同）。

为什么值得改：图形族的 `mouseout` 可能由内部命中切换**合成**，此时上游明确允许没有坐标。
补 `(0,0)` 会让调用方无法区分「真的在原点」与「这次没有坐标」，而这两件事对 UI 的含义完全相反。

### 2. 字段的 watch 源可声明：`fingerprint` / `reference` / `versioned`

`OverlaySpec.watchSources`（缺省 `fingerprint`）：

| 源 | 判据 | 用户 |
| --- | --- | --- |
| `fingerprint` | `stableKeyOf(value)`（内容指纹） | 标量与小对象（`offset` / `icon` / `style` / `bounds` / `radius`…） |
| `reference` | 只比根引用 | 内容不可序列化的值：`BGroundOverlay.url` 的惰性工厂（`stableKeyOf` 会把函数折叠成 `"fn"`） |
| `versioned` | 根引用 **或** 版本 prop 变化 | 大数组：`path` / `controlPoints`（`pathVersion` / `controlPointsVersion`） |

**为什么大数组不做内容指纹**：`path` 动辄上万点，指纹是 O(n) 序列化，父级每次渲染都要算一遍；
而「路径变了没有」在 v3 里本来就有更便宜的答案——换根引用，或原地改数组后递增版本 prop。
`v3-overlay-suite.test.ts` 把这条差异做成可断言的读数：**原地改数组（不换引用、不动版本）时必须
一条 `setPath` 都不发**——那条用例正是「内容指纹」与「根引用」两种实现的分水岭。

### 3. 两个**组件侧**字段策略：`version` 与 `alias`

- `version`：版本令牌（只作为配对字段的 watch 源之一），既不是 SDK 属性、也不产生命令。
  `assertOverlayFieldDeclarations` 要求每个 `version` 字段**被某条 `versioned` 引用**——
  否则它就是一个「看起来能刷新、其实什么都不做」的 prop。
- `alias`：旧 prop 名，由集中弃用层在**读取层**解析成正典 prop 的值，自身不下发；
  必须在别名表里登记过（否则是「收下但没人读」的假支持）。

读取层是**一个别名感知 + 值投影的 props 视图**（`useOverlaySpec` 内的 `Proxy`）：`create` / watch /
更新队列读到的都是同一份值。因此不存在「初始用旧名、更新用新名」这类分叉——这条在 #30 的评审里
是 P1 级别的缺陷形态（模型与 SDK 分叉），值得在设计上根除。

### 4. 集中弃用层：稳定 code + 同实例一次 + 新 API 优先

`core/deprecations/**` 两张表 + 一个告警器：

- `OVERLAY_PROP_ALIASES`：`{ code, kind, canonical, deprecated[], note, derive }`。
  当前唯一一项是 GroundOverlay 的 `startPoint` + `endPoint` → `bounds`；
- `OVERLAY_EVENT_ALIASES`：`{ code, kind, canonical, alias, note }`。当前唯一一项是 Marker 的
  `drag-end` → `dragend`（**此前硬编码在 `markerSpec.ts` 里**，属 #28 明令禁止的「组件各自兼容」）；
- `createDeprecationWarner()`：**每个组件实例一份**，按 `code` 去重，输出走 `devWarn`
  （消费方构建期折叠 `process.env.NODE_ENV`，因此 production 不输出）——与迁移文档的
  「每条弃用都有稳定 code、同实例只警告一次、production 默认不输出」逐字对应。

**新 API 优先**不是「合并」：正典 prop 有值时旧名**完全不参与**（连告警都不发）。

### 5. `BGroundOverlay`：`bounds` 成为正典，`startPoint` + `endPoint` 变成弃用别名

上游是 `createGroundOverlay(bounds, options)`，驱动、官方参考实现都是 `bounds`；组件此前用
两个角点 prop 拼 bounds（v2 遗留）。现在：

- `bounds` 是唯一几何模型（描述符键 `bounds` → `setBounds`，内容指纹判等）；
- 旧名只在读取层解析，**不是**「两套几何模型」；
- `autoCenter` 是**组件侧行为**（`Map#setViewport`），因此走新的 `afterMount` 钩子
  （位置与迁移前的 `addToMap` 一致），并在描述符里显式分类为 `recreate`（`ctorKey: null`）。

### 6. 编辑事件按 kind 的能力注册

`editstart` / `editend` / `linevertexdrag*` / `linevertexdel` 只在上游事件表**包含**它们时才订阅
（Prism / BezierCurve 的表被上游 `Omit` 掉了），并由 `requiresEditing` 标记它们的启用前置
（`enableEditing`）。组件的 props 面同步：`PathEditableProps`（`enableEditing`）只被
Polyline / Polygon / Rectangle / Circle 四个 props 接口继承——**收了再忽略**这种假支持在类型层就不成立。
运行期**不**按 `props.enableEditing` 做动态订阅开关：SDK 不会在未开启编辑时派发这些事件，
动态增删订阅只会引入新的释放路径（收益为零）。

### 7. 卸载路径上的 SDK 事件不再回放

`useSdkResource.disposeInstance()` 的顺序是「先摘 registration（⇒ `removeOverlay`）→ 再释放实例
scope（⇒ 解绑监听）」，因此 SDK 会在**监听仍然活着**的窗口里派发 `remove`。`useOverlaySpec` 为
**每个实例**记一个「已进入摘除流程」标记（`WeakSet`，不是组件级布尔量——竞态分支里过期的那一代
也会走一遍 mount → dispose，布尔量会把已经由新一代接管的组件的事件面整个关掉），派发前查一次。

### 8. 与官方参考实现 `huiyan-fe/react-bmap@2.0.2` 的对照

| 维度 | 参考实现 | 本库 | 结论 |
| --- | --- | --- | --- |
| 事件面 | 每个覆盖物手抄 `events: { sdk, prop }[]`（Polyline / Polygon / Circle 抄了三份同样的 17 条） | 按 kind 的矩阵派生，SFC 只有 `defineEmits` 与门禁 | **本库更严**：手抄三份必然分叉 |
| 载荷类型 | `handler: (e) => void`（回调参数不类型化） | 三档载荷类型（必填坐标 / 可缺 / 底座） | 本库更严 |
| 大数组更新 | `pathProp` + `stableStringify` 进 effect deps | `watchSources` 的 `versioned`（根引用 + 版本 prop） | 本库更省（O(1) vs O(n) 每次渲染） |
| 旧 prop 兼容 | 无（直接删） | 集中别名表 + 同实例一次告警 + 文档表格 | 本库更平滑（迁移期保留可用性） |
| `bounds` 类几何 | `optionProps: ['bounds']`（单个 prop） | 同（并把旧的两个角点保留为别名） | 同源 + 向后兼容 |
| 编辑事件 | 只对支持编辑的组件登记 | 同上，但由上游 `Omit` 派生而不是手写 | 同源 |

参考实现里 `createOverlayComponent` 的 `optionProps` / `ctorOnlyProps` 两张手抄数组仍是**不该照抄**的东西：
#30 已经用 Driver 描述符取代它们，本 ADR 只是把「事件」这一维也交给单一事实源。

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 八个覆盖物的事件面**变宽** | Polyline / Polygon / Circle 从 2 个事件变成 17 个（新增 `mousemove` / `rightdblclick` / `lineupdate` / 编辑六件套…）；Label 8 个；Prism / BezierCurve / GroundOverlay 11 个 | 新增，无破坏性；不监听的父级不受影响 |
| 图形族 `mouseout` 的 `point` 变成**可选** | 直接订阅 Driver 的调用方此前会收到补出来的 `(0,0)`（组件层的 `mouseout` 是本次新增事件，此前根本不发） | 现在保持缺失：判空即可（`e.point?.lng`）。**Marker 的 `mouseout` 不受影响**（上游声明必填，仍补 `(0,0)`） |
| `BGroundOverlay` 的 `bounds` | 新增正典 prop（`{ southwest, northeast }`） | 推荐改用；`startPoint` + `endPoint` 仍可用（一次告警） |
| `BGroundOverlay.type` 变化 | 组件自己在 watcher 里 `rebuild()` | 由描述符的 `recreate` 分类触发重建（**行为不变**） |
| `BBezierCurve` / `BPrism` 不暴露 `enableEditing` | 上游没有该能力（事件表也被 `Omit`） | 无需改动；不要期望编辑事件 |
| `visible=false` 的实现 | `removeOverlay`（实例离开地图，SDK 会派发 `remove`） | `hide()`：实例留在图上、只是不可见（与 #30 对 Marker、#41 对控件的统一口径一致） | 需要真正摘除请用 `v-if`（PR #103 评审 4 补记） |
| `remove` 事件的**到达时机** | `<BBezierCurve>` / `<BMarker>` 在组件**自身**的摘除路径上也会收到（切隐藏走 `removeOverlay`、卸载/重建时监听还没解绑） | 只在**外部**摘除（`map.removeOverlay()` / `clearOverlays()`）时到达；组件自身的卸载 / 重建 / 隐藏不再回放（决策 7 的闸门）。其余六个组件此前根本不订阅 `remove`，现在按矩阵统一订阅 = 纯新增 | 用 `remove` 做「外部把我摘掉了」的清理代码要注意卸载时不再有这条通知（PR #103 评审 4 补记） |
| `BLabel` / `BPrism` / `BBezierCurve` 的 props 类型来源 | 从 SFC 内的本地接口移到 `types/components.ts` | 名字不变；`LabelStyle` 仍从组件与根入口导出 |
| `BMarker` 的 `drag-end` | 仍在（同载荷），但现在由内核按弃用表补发 | 迁移到 `dragend`；告警同实例一次 |
| `Rectangle` | 新组件（v4 覆盖物） | 新增，见 [文档](/zh-CN/components/overlay/rectangle) |

**无运行时破坏性变更**：八个组件的 props 名与默认值未变（只新增 `bounds`，两个版本 prop 早已存在）；
emits 只增不减；`startPoint` / `endPoint` / `drag-end` 继续可用。

两处**类型 / 元数据层**的附带变化（记在这里，也写进 changeset）：

- `LabelStyle` 从 `Record<string, any>` 收紧为 `Record<string, unknown>`（`BLabel` 的 `style` prop）：
  取值从 `any` 变成 `unknown`，读样式值的代码可能要自己收窄——这是有意的收紧，不是回归；
- 九个覆盖物 SFC 统一补上 `defineOptions({ name })`（其中四个此前没有）：只影响 devtools / 递归
  自引用的显示名，无行为变化。

### 回滚

1. 把八个 SFC 切回 `useOverlayResource`（各自 `*Spec.ts` 是纯声明，删掉即可）；
2. `core/overlays/overlayEventCatalog.ts`、`core/deprecations/**`、`useOverlaySpec` 的增量与
   `driver` 侧的载荷/兜底改动一并回滚；
3. `BRectangle.vue` 与 manifest 条目删除。

## 已知限制（显式接受，带归属）

1. **`BMapMask` / `BMarker3d` / `BInfoWindow` / `BContextMenu` 仍走 `useOverlayResource`**。
   理由逐条：
   - `BMapMask`：`OVERLAY_DESCRIPTORS["map-mask"]` 按 #21 的决策**故意留空**（「若将来要从 Facet 侧
     更新掩膜，应先核对 `setPoints` / `setOptions` 的语义再补」）——迁移它必须先做那次运行时核对；
   - `BMarker3d`：构造器不在 `@baidumap/jsapi-v4-types@4.0.4` 的类声明里（运行时存在），
     事件面与构造选项都要走**运行时取证**路径（与 `TrafficLayer` 同类）；
   - `BInfoWindow`：#32；`BContextMenu` + `BCustomOverlay`：#33。
   因此「所有基础覆盖物使用同一生命周期内核」在本次是 **9/13**（13 个覆盖物组件里：Marker（#30）+ 本 PR
   的 7 个迁移 + 新增的 Rectangle）；四个剩余组件的归属写在上面，不是遗漏。
2. **v2 才有的 props 没有恢复**：`BPolyline` 在 v2 有 `geodesic` / `clip` / `linkRight`
   （`PolylineOptions` 里确实存在），v3 起静默消失。本 ADR 的语义是「旧名 → 新名」的别名，
   而这几个**没有新名字**，属于「prop 面缺口」而不是别名问题；集中弃用层已经能承载它们
   （`alias` + `derive` 同形），但补它们属于新增公开面，留给单独一票。当前行为与 #31 之前一致。
3. **`BPrism` 的 `isBoundary` / `autoCenter` 是「未取证」的构造期透传**：`PrismOptions`（4.0.4）里
   没有这两个键，本库没有运行时证据说 SDK 会读（也没有证据说不读）。处置见 `prismSpec.ts` 的注释：
   保留 v2 的构造期透传、分类为 `recreate`、描述符的 `reason` 里写明「未取证」。
4. **覆盖物位置仍没有读回入口**（继承 #30 的已知限制 1）：`"position"` 策略的回环抑制基于
   「最后一次同步值」。补 `getPosition` 读回需要同时动描述符、Driver、Fake 与能力目录，仍留给后续票。
5. **`lineupdate.action` / 编辑事件的 `overlay` / `from` 仍只在 `raw` 里**：本库不猜这些字段的
   归一化形状（与 map 事件对 `mousewheel.trend` 的口径一致）。需要时读 `event.raw`。
6. **`BMapMask` 之类的「构造期不可变」语义没有统一的表达**：本 PR 用 `recreate` 表达
   「变了就重建」，但「重建代价」没有分级（矩形重建很便宜，掩膜重建要重算几何）。若将来出现
   真正的性能问题，再引入「重建代价 / 是否可延迟」的声明。
8. **覆盖物组件不提供 `defineExpose` 命令面**（issue #31 的「Rectangle props/events/**expose**」按此口径交付）。
   #30 已把覆盖物这一层的返回面定型为**只读观察面**（`resource` / `status` / `error` / `position` /
   `events`），理由是声明式组件没有命令式消费者；命令面目前只有 `<BMap ref>`（`BMapExpose`）。
   为 `BRectangle` 单独开一个 `expose` 会造出「九个同族组件里一个例外」的形态，因此本 PR **不**做，
   并在验收对照表里标 ⚠️。若确实需要（例如「运行时读回矩形几何」），应作为**跨覆盖物**的一次决策单开一票：
   那时同时给九个组件加，并补 consumer 类型用例。
9. **`BContextMenu` 仍有 `{ deep: true }` 的 watcher**。验收标准里的「不存在组件级 deep watcher」
   在本次只对**已迁移的九个组件**成立；`BContextMenu` / `BInfoWindow` / `BMapMask` / `BMarker3d` 的
   18 处 watcher 属于它们的归属票（#33 / #32 / 运行时取证），不在本 PR 的改动面内。
10. **真实 AK smoke 的结论限于本机环境**：`overlay-rectangle` 在 live 档 pass（几何回读一致），
   同一轮 `ui-kit-placesearch-load` / `ui-kit-placedetail-load` 失败——那是 UI Kit 检索路径的
   外网波动，与本次改动无关（基线对照见 PR）。live 档**不以「全绿」为验收**。

## 验证

| 检查 | 命令 / 落点 |
| --- | --- |
| 矩阵 ↔ 上游 `OverlayEvent.d.ts` 双向比对 | `tests/behavior/v3-overlay-event-matrix.test.ts`（含 `Omit` 形态解析守卫） |
| 载荷档 ↔ Driver 兜底（含 map 口径不变） | 同上 + 真实 `EventDriver` 上的订阅派发 |
| 八个组件 create / mutable / recreate / visible / 事件面 / 卸载 | `tests/behavior/v3-overlay-suite.test.ts`（表驱动，9 个 kind） |
| `fields` ↔ props ↔ 描述符交叉锁定 | 同上（`types/components.ts` 的接口按 `extends` 链解析） |
| SFC `defineEmits` ↔ 矩阵（键集 + 载荷注解） | 同上 |
| `path` 根引用 / 版本令牌（原地改数组不发命令） | 同上 |
| 集中弃用层（prop / 事件，只警告一次、新 API 优先） | 同上 |
| 卸载路径不回放 SDK 事件 | 同上 |
| 文档镜像 | `docs/zh-CN/components/overlay/events.md` + `tests/behavior/v3-overlay-events-doc.test.ts` |
| 消费方类型面（typed emits / 别名仍可编译 / `@ts-expect-error`） | `fixtures/v3-consumer/src/index.ts`（`verify:package` 的 vue-tsc 跑） |
| 真实 v4 smoke（fixture + live） | `pnpm smoke:v4:fixture` / `BAIDU_MAP_AK=… pnpm smoke:v4` 的 `overlay-rectangle` |
| 边界与发布产物 | `check:raw-sdk`（两条）/ `check:public-dts` / `check:no-bmapgl` / `typecheck:v3` / `build:v3` / `test:unit` / `verify:package` |

## 非目标

- 不重构 `BInfoWindow`（#32）与 `BContextMenu` / `BCustomOverlay`（#33）。
- 不为「批量线面数据」优化（M6 的图层与批量点资源）。
- 不用工厂动态生成 SFC：八个组件仍是**独立 SFC**，共享的是声明（`*Spec.ts`）而不是组件代码。
- 不在 Driver 不支持时伪造能力（`isBoundary` / `autoCenter` 如实标「未取证」）。

## 参考

- issue #31（`M5-VECTORS`）、追踪 issue #12「M5 / Overlay」泳道
- [ADR 2026-09-17 声明式 OverlaySpec 与 Marker](./2026-09-17-overlay-spec-and-marker.md)
- [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)（描述符与属性分类）
- [ADR 2026-09-14 Map Events 与状态](./2026-09-14-map-events-and-status.md)（map 事件 Catalog 的先例）
- 官方：JSAPI 4.0 API 参考（`Rectangle` / `Polyline` / `GroundOverlay`）；
  `@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/OverlayEvent.d.ts` 与各类 `*Options.d.ts`
- 对照：`huiyan-fe/react-bmap@2.0.2`（`src/components/Overlay/index.tsx`、`src/utils/createComponent.tsx`）
