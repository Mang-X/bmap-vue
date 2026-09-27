---
"bmap-vue": major
---

# #168 剩余面：控件命令面、Panorama 事件裁决、覆盖物选项补齐

#165 Class 3 之后的剩余三项。逐条裁决与取证见
`docs/zh-CN/contributing/168-remaining-surface.md`。

## 一、控件命令面（`defineExpose`）

`grep defineExpose components/controls/**` 在本票之前返回 **0 命中**——控件层的官方命令
成员一个都没有用户可见的调用路径。按 #165 §5-C，「能改 prop」不算实现同名方法。

| 组件 | 新增 |
| --- | --- |
| `<LocationControl>` | `location()` / `startLocation()` / `stopLocationTrace()` / `getAddressComponent()` |
| `<CityListControl>` | `toggle()` / `getCityName()` |

两者都额外暴露 `status`（命令面在未就绪 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，
因此必须有一个能先看状态的出口）。

### ⚠️ `startLocationTrace()` 不存在——暴露的是 `startLocation()`

issue 文本把命令写成 `startLocationTrace()`，那是把兄弟成员 `stopLocationTrace()` 的名字
带过来了。官方 `control/GeolocationControl.d.ts` 只声明 `startLocation()`（开始定位）与
`stopLocationTrace()`（停止跟踪）——**不对称，但就是上游的形状**。

live AK 读数（`scripts/probe-runtime-members.mts` probe 14）确认：
`startLocation` `callable: true`、`startLocationTrace` `callable: false`。
两者**不能**互相顶替。

> 同一探针还发现：**控制类成员挂实例、不挂原型**（`own: false` / `onProto: false` 而
> `callable: true`）。按原型读会得出「成员不存在」的错误结论——这与 #165 probe 11 在
> `Panorama` 上踩到的是同一个坑。

### ⚠️ 刻意不暴露 `getTriggerDom()`

官方**确实**声明了 `CityListControl#getTriggerDom(): HTMLElement | undefined`，但**不加**：
返回值是**原生 DOM 元素**，交出去就把 SDK 内部渲染结构变成公共契约（调用方一
`appendChild` / `addEventListener` 就会与 SDK 的事件系统打架）。控件组件是 AGENTS.md 的
raw SDK **禁区**。「收窄成领域投影」在这里**不成立**——一个 `HTMLElement` 没有任何可投影的
领域值，它的全部意义就是那个节点本身。需要该节点的用户走 `./advanced` 的 `unwrapRaw()`。

`tests/behavior/control-commands.test.ts` 把这条 no-expose 断言成「它没有出现在命令面上」。

### 三条实现口径（与覆盖物命令面逐条一致）

1. **释放后显式失败**：未就绪 / 重建窗口 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，
   **绝不**静默 no-op。每条命令现取会话，重建后旧闭包不会打进已死的实例。
2. **不交出 raw SDK 对象**：`getAddressComponent()` 逐字段投影成领域类型
   （官方 `AddressComponent` 五个成员**全部可选**，取不到就留在 `undefined`，**不补默认值**）。
3. **不镜像成组件状态**。

## 二、`Panorama` 事件：官方 23 个，本票前 8 个

**这是裁决，不是补齐清单。** 加 13 条：

- 画面交互五兄弟 `click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`
  （全景是画布，**没有别的点击入口**）；
- `linkClick`（带 `id`，是「导航到相邻全景」的唯一可编程入口）；
- `povChangedEnd` / `sceneChangeEnd`（沿用本组件既有的「回读 getter 补载荷」手法）；
- `sizeChanged`（**无载荷**——官方没有尺寸字段、SDK 也没有读回入口，编一个
  `{width:0,height:0}` 会把「尺寸未知」变成「尺寸为零」）；
- `overlayAdd` / `overlayRemove` / `overlaysClear`（`<PanoramaLabel>` 由子组件管理，
  父级**没有别的观察面**）；
- `visiblePoiTypeChanged`（闭合 `setPanoramaPoiType()` 的写-确认回路）。

**不加 2 条**：

- **`destroy`**：官方有，但本库 `dispose()` 的顺序是「先解绑业务监听、再 `driver.destroy()`」
  （ADR 2026-09-11 §6：SDK 在 destroy 期间**同步**派发时，回调不得打到已拆解状态上）。
  要听见它就得倒顺序 ⇒ 拿一个**真实存在的正确性风险**换一句收尾信号。清理用 `onUnmounted`。
- **`linksVisibleChanged`**：由官方自带控件的显隐驱动，本库**没有该控件内部状态的读回入口**
  ⇒ 加了就是「声明了却几乎永不触发」。

**`touchmove` 不存在**：issue 点名了它，但官方 `PanoramaEventMap` 里**没有**（只有
`touchstart` / `touchend`）。

### ⚠️ 命名偏差（**已存在**，非本次引入）

全库规则 `toVueEventName` 产出 kebab-case，而 `<Panorama>` **早已发布的 8 条**是 camelCase。
新增事件**沿用 camelCase**——在同一个组件里混两套命名是最坏的一种分叉，而改那 8 条是
**破坏性变更**（`1.0.0-rc.0` 已发布）。偏差已如实记录并用断言钉住「组件内部不得含下划线」。
**建议在 1.0 定版前决定是否统一。**

### `Panorama` 不进覆盖物事件矩阵

`OVERLAY_EVENT_MATRIX` 的 kind 是 `OverlayKind`（SDK 内建**覆盖物**的封闭联合），
`Panorama` 是独立的**查看器**、且**不走** `useOverlaySpec`。塞进去会同时破坏矩阵的 kind
封闭性与「矩阵驱动的绑定」这一前提。事件面仍是组件内 `driver.on` 的显式订阅。

## 三、覆盖物选项

| 族 | 新增 | 策略 |
| --- | --- | --- |
| `MarkerOptions` | `raiseOnDrag` / `draggingCursor` / `isTop` / `restrictDraggingArea` | 全部 `recreate`（官方实例上**无** setter、**无**读回） |
| `GroundOverlayOptions` | `enableMassClear` / `enableClicking` / `top` | `options` / `recreate` / `recreate` |

⚠️ **`top` 与 `zIndex` 的区别**：语义相近但落地方式不同——`zIndex` 有 `setZIndex`
（`options`），`top` **没有 `setTop`**（`recreate`）。不要顺手改成 `mutateBy("setZIndex")`。

### `draggingCursor` 的真实形状是**普通 `string`**

官方是 `draggingCursor?: string`（原文「需遵循 CSS cursor 属性规范」），
**没有任何候选值清单**。因此不自造枚举联合——CSS cursor 的合法值是**开放集合**
（关键词 + 任何 `url(…)`），联合一定会漏。

### `CustomOverlay` 的 8 个官方缺口：**全部不加**（逐条有依据）

6 个是「无 setter 的渲染细节 / 性能开关 / 时序 hack」（`rotationFlip` / `fixBottom` /
`useTranslate` / `autoFollowHeadingChanged` / `nextTick` / `drawHook`），
2 个（`enableDraggingMap` / `synUpdate`）**与本库的受控主模型冲突**。补它们不增加任何
**可断言的能力**。`<CustomOverlay>` 的 `zIndex` **保持 `recreate`**（官方无 `setZIndex`），
反向守卫测试继续生效。

### 已知窄化（如实记录，本次**未**改）

官方 `GroundOverlayOptions.url` **声明**接受 canvas，但官方 `setImage(url: string)`
**只接受字符串**——这是**上游自身**的不对称。构造期照收 canvas，运行期换 canvas 会被
`setImage` 拒掉。本次**不**改（改它要替上游补一个它没有的能力），只记成断言防漂移。

## 四、Vue Boolean-absent 陷阱

本次新增的五个 `Boolean` 选项在 `withDefaults` 里**全部**写了显式 `undefined`：

- 官方默认 **`true`** 的两项（`enableMassClear` / `enableClicking`）：Vue 的 `Boolean` prop
  未给时是 `false`，与 SDK 默认**语义相反**；
- 官方默认 `false` 的三项（`raiseOnDrag` / `isTop` / `restrictDraggingArea` / `top`）：
  值上一致，但它们是 `recreate` 类——「未给」若有两个表示，父级一次 `:x="undefined"`
  就会触发一次**内容没变的重建**。

## 门禁

- `tests/behavior/control-commands.test.ts`（新，9 例）
- `tests/behavior/panorama-events.test.ts`（新，17 例）
- `tests/behavior/remaining-overlay-options.test.ts`（新，16 例）
- `tests/type-contracts/remaining-surface.type-test.ts`（新）
- `scripts/probe-runtime-members.mts` 新增 probe 14（控制类命令成员的实例读数）
- `OVERLAY_REVERT_RATIONALE` 补五条（撤回落点的逐字段依据）

**公共类型面变化**：`ControlCommandTypes` / `LocationCommandApi` / `CityListCommandApi` /
`LocationAddressComponents` 已从 `index` / `advanced` / `composables` / `plugins` 四个出口
显式导出（否则是 `ae-forgotten-export`），`etc/**` 基线由父重新生成。
