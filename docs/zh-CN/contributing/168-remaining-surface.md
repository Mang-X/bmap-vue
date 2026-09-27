# #168 剩余面：控件命令、Panorama 事件、覆盖物选项的逐条裁决

> 本文是 issue #168 剩余三项的**裁决记录**：每一条「官方有、本库没有」的成员，
> 都记着**加 / 不加**与理由。#165 的存量审计表在
> [165-audit-inventory.md](./165-audit-inventory.md)，本文是它的续篇（三族，不重叠）。

## 取证方式

| 依据 | 用途 |
| --- | --- |
| `@baidumap/jsapi-v4-types@4.0.4` 的 d.ts | **存在与否与真实签名**（本库的口径是「d.ts 定存在与否」） |
| `scripts/probe-runtime-members.mts` probe 14 | 控制类成员在**实例**上的真实在位情况（控制类的成员常挂实例而非原型，见下） |
| 实例成员表逐条核对 | 「有没有 setter / 有没有读回」——决定 `mutable` / `recreate` 与「能否就地撤回」 |

### probe 14 的 live 读数（AK 取自 `docs/.vitepress/theme/index.ts`）

```
geolocation: location ✓ / startLocation ✓ / startLocationTrace ✗ /
             stopLocationTrace ✓ / getAddressComponent ✓ / setOptions ✓
cityList:    open ✓ / close ✓ / toggle ✓ / getTriggerDom ✓ / getCityName ✓
（✓ = callable）
```

**两个必须点名的偏差**：

1. **`startLocationTrace()` 不存在**。issue 文本把命令写成 `startLocationTrace()`，
   那是把兄弟成员 `stopLocationTrace()` 的名字带过来了——官方只声明
   `startLocation()`（开始定位）与 `stopLocationTrace()`（停止跟踪），**不对称但就是上游的形状**。
   live 读数确认：`startLocation` `callable: true`、`startLocationTrace` `callable: false`。
   因此暴露的是 **`startLocation`**。
2. **控制类成员在实例上，不在原型**。`own: false` / `onProto: false` 而 `callable: true`
   ——`BMap.GeolocationControl.prototype` 上一个都没有。这与 #165 probe 11 在 `Panorama` 上
   踩到的是同一个坑：**按原型读会得出「成员不存在」的错误结论**。探针因此逐个按
   「own / 原型链 / 可调用」三档读。

## 一、控件命令面（item 1）

### 加了什么

| 组件 | 命令 | 官方 d.ts 声明 |
| --- | --- | --- |
| `<LocationControl>` | `location()` | `location(): void` |
| | `startLocation()` | `startLocation(): void` |
| | `stopLocationTrace()` | `stopLocationTrace(): void` |
| | `getAddressComponent()` | `getAddressComponent(): AddressComponent \| null` |
| `<CityListControl>` | `toggle()` | `toggle(): void` |
| | `getCityName()` | `getCityName(): string` |

判据与 `OverlaySpec.expose` 同一条：只服务**无对应 prop 的动作**与**读回**两类；
受控写入仍由 `setOptions` / `setVisible` 承担，不重复暴露。

**`getAddressComponent()` 的投影**：官方 `AddressComponent` 的五个成员
（`streetNumber` / `street` / `district` / `city` / `province`）**全部可选**，
因此逐字段按类型收窄、取不到就留在 `undefined`——**不补默认值**（`city ?? ""` 会把
「上游没给」与「空」混起来）。非字符串成员**不投影**（照抄进 `string` 字段是断言，不是投影）。
尚未定位时是 `null` 而不是 `{}`。

形状自持在 `driver/types/controls.ts` 的 `LocationAddressComponents`；
`LocationControl.vue` 里那个 `AddressComponents` 是它的**别名**——
SFC 的 `<script setup>` 不能被 `.ts` 引用它的类型，而命令面必须引用领域类型，
因此**一份形状、两处引用**，不允许各自手抄。

### 不加什么：`getTriggerDom()`

官方**确实**声明了 `CityListControl#getTriggerDom(): HTMLElement | undefined`，但**不加**：

- **返回值是原生 DOM 元素**。交出去就把 SDK 内部渲染结构（那个按钮的 class、子节点、
  事件绑定）变成公共契约——调用方一 `appendChild` / `addEventListener` 就会与 SDK 的
  事件系统打架，而本库既无法约束这种用法，也无法在控件重建时替它善后。
  AGENTS.md 的 raw SDK 边界只覆盖 `driver/**` / `client/**` / `core/loader/**` /
  `plugins/**`，**控件组件在禁区**。
- **「收窄成领域投影」在这里不成立**。其它地方能投影是因为官方返回的是**数据**
  （`Point` / `Size` / `AddressComponent`……），而一个 `HTMLElement` 没有任何可投影的
  领域值——它的全部意义就是那个节点本身。
- 需要该节点的用户走 `./advanced` 的 `unwrapRaw()`：那是**明确的 raw 逃生口**，
  不是组件面。

### 判据留痕

`tests/behavior/control-commands.test.ts` 的「`getTriggerDom`：刻意不暴露」把 no-expose
断言成「**它没有出现在命令面上**」——把取舍变成会红的一条，而不是只在注释里说一句。

### React 参考实现的对照（它**不**是裁决依据）

`/tmp/ref2/src` 的 `CityListControl` 只有 `optionProps` / `ctorOnlyProps` / 两个事件，
**没有** `toggle` / `getCityName` / `getTriggerDom`；`LocationControl` 是个纯别名。
也就是说**参考实现同样没暴露这些**。但它没暴露不等于「不该暴露」——它整个控件层
**就没有 `ref` 命令面**这一层机制，因此这不是一个可比的裁决点。本库以
「d.ts 声明 + 有可消费的值 + 不交出 raw 对象」三条判据为准。

## 二、Panorama 事件（item 3）

官方 `PanoramaEventMap` 共 **23** 个事件，#168 之前本库派发 **8** 个。

| 官方事件 | 裁决 | 理由 |
| --- | --- | --- |
| `click` `dblclick` `touchstart` `touchend` | **加** | 全景是画布，**没有别的点击入口**——地图上想点一个覆盖物可以用别的组件表达，全景上不行 |
| `link_click` | **加** | 带 `id: string`（**可消费**），且它是「导航到相邻全景」的唯一可编程入口 |
| `clickonroad` | **加** | 同场景（点道路）；官方只给底座字段 ⇒ 投影出事件类型字符串 |
| `pov_changed_end` | **加** | 官方 `*_changed` 不带值，但**回读 `getPov()` 有值** ⇒ 沿用现有「回读补载荷」手法 |
| `scene_change_end` | **加** | 同上，回读 `getSceneType()` |
| `size_changed` | **加** | **无载荷**（见下） |
| `overlay_add` `overlay_remove` `overlays_clear` | **加** | `<PanoramaLabel>` 由子组件管理，父级**没有别的观察面**知道标注何时真的挂上 |
| `visible_poi_type_changed` | **加** | 载荷可消费，且 `setPanoramaPoiType()` 是本库已暴露的写入口 ⇒ 写完能确认落没落 |
| `links_visible_changed` | **不加** | 由**官方自带**的道路指示控件（`linksControl`）的显隐驱动，而本库不镜像那个控件的内部 UI 状态（官方**没有给读回入口**）⇒ 加了就是「声明了却几乎永不触发」 |
| `destroy` | **不加** | 见下（与释放顺序冲突） |
| `touchmove` | **不存在** | issue 点名了它，但**官方 `PanoramaEventMap` 里没有**（只有 `touchstart` / `touchend`） |

### 载荷投影的逐条依据

- **指针五兄弟**（`click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`）：
  官方声明是 `MouseEvent | TouchEvent`——**原生 DOM 事件对象**，原样转发会把 SDK 内部的
  `target`（raw `Panorama`）与 DOM 结构变成公共契约。因此**只保留 `type`**。
  刻意**不**投影 `clientX` / `clientY`：那是**屏幕像素偏移**，与本库的 `{lng, lat}` 领域坐标
  不是一回事，也没有官方读回入口能换算——编一个「看起来像坐标」的数比不给更糟
  （调用方会拿它去 `setPov` 或算方位）。
- **`size_changed`**：**无载荷**。官方 `PanoramaBaseEvent` 里没有尺寸字段，SDK 也没有
  `getSize()` / `getContainerSize()`。编一个 `{width: 0, height: 0}` 会把「上游没给尺寸」
  变成「尺寸是零」——调用方会按零尺寸重排布局。
- **覆盖物三兄弟**：官方载荷是 raw `PanoramaLabel` / `PanoramaBaseEvent`，**一律不投影**。

### `destroy` 为什么不加（取舍记录）

官方**有**这条事件。要让业务听见它，本库的释放顺序就得倒过来——现在
`core/panorama/index.ts` 的 `dispose()` 是：

```
先 resources.dispose()（解绑业务监听） → 再 driver.destroy()（SDK 销毁）
```

这个顺序来自 ADR 2026-09-11 §6 的「先解绑、后摘除」：SDK 在 `destroy` 期间**同步**派发事件时，
业务回调**不得**打到已经拆解的状态上。

倒过来能听见 `destroy`，代价是让业务回调在组件已进入卸载流程时执行——
那是一个**真实存在的正确性风险**，用来换一句「实例收尾了」的信号。
「组件要结束时清理自己的东西」用 `onUnmounted` 就够，且那本来就是 Vue 的正确出口。

> 实现过程中确实按「先 destroy 再解绑」改过一版，测试随后红了；**已回退**。
> 这里留痕是因为「官方有、本库没有」很容易被下一次审计当成漏项再捡回来。

### 命名偏差（**已存在**，非本次引入）

全库规则 `toVueEventName` 把 `_` 换成 `-`（地图事件与覆盖物事件都走它），
但 `<Panorama>` **早已发布的 8 条**是 camelCase（`positionChange` / `linksChange` / …），
它们**不是**由 `toVueEventName` 派生的，是手写的。

新增事件**沿用 camelCase**，理由：

- 在同一个组件里混两套命名（8 条 camelCase + 13 条 kebab-case）是最坏的一种分叉，
  用户在模板里写 `@linkClick` 还是 `@link-click` 没有可推断的规则；
- 改那 8 条的名字是**破坏性变更**（`1.0.0-rc.0` 已发布），而「统一命名」该不该配一次改名
  是**父决策**，不是本 ticket 能单方面做的。

因此本库**如实记录偏差**，并用一条断言钉住「本组件内部不得含下划线」。

> ⚠️ **本节的措辞已被后续核实推翻（#165）**：这里把它写成「既有的库内命名偏差、建议在 1.0
> 前决定是否统一」。核实结果是——**官方 React 参考实现本身就是 camelCase**
> （`src/components/Panorama/index.tsx` 的 `onLinkClick` / `onLinksChange` / `onPovChange` …），
> 而官方 **JSAPI 声明**（`PanoramaEventMap` 的键）才是 snake_case。
> 按 #165「同一能力优先同名、**参照官方封装**」的判据，**camelCase 才是对齐的那个**，
> snake_case 是 SDK 事件键。因此**不统一、不改名**；正确处置是
> **保留 camelCase 作为对外事件名，并把 SDK 的 snake_case 键加成一一对应的别名**
> （复用 `MAP_EVENT_EMIT_ALIASES` 机制）——照 SDK 文档抄事件名的使用者同样能命中。
> 详见 `165-runtime-verification.md` 的「更正三·重定」。

### Panorama 为什么**不进**覆盖物事件矩阵

`OVERLAY_EVENT_MATRIX` 的 kind 是 `OverlayKind`（SDK 内建**覆盖物**的封闭联合），
`Panorama` **不在其中**（它不是覆盖物，是独立的查看器），且 `<Panorama>` **不走**
`useOverlaySpec`——它有自己的 `createPanoramaContext` 生命周期。因此把 `Panorama` 塞进
矩阵会同时破坏两处前提：矩阵的 kind 封闭性，以及「矩阵驱动的绑定」这一前提
（`resolveOverlayEvents()` 只在 `useOverlaySpec` 里被调用）。

事件面因此仍是组件内 `driver.on` 的**显式订阅**（与既有 8 条同一手法），
`tests/behavior/panorama-events.test.ts` 的「不回归」一组钉住既有 8 条不丢。

## 三、覆盖物选项（item 2）

### 加了什么

| 族 | 官方键 | 策略 | 依据 |
| --- | --- | --- | --- |
| `MarkerOptions` | `raiseOnDrag` | `recreate` | 官方实例上**无** `setRaiseOnDrag`、**无**读回 |
| | `draggingCursor` | `recreate` | 无 `setDraggingCursor`、无读回 |
| | `isTop` | `recreate` | 无 `setIsTop`、无读回 |
| | `restrictDraggingArea` | `recreate` | 无 `setRestrictDraggingArea`、无读回 |
| `GroundOverlayOptions` | `enableMassClear` | `options` | 官方有 `enableMassClear` / `disableMassClear` **一对开关** |
| | `enableClicking` | `recreate` | 官方 4.0 的 `GroundOverlay` **没有**成对开关 |
| | `top` | `recreate` | 官方**没有 `setTop`** |

⚠️ **`top` 与 `zIndex` 的区别**必须点明：两者都在描述符里，但落地方式不同。
`zIndex` 有 `setZIndex`（`options`），`top` 没有（`recreate`）。**不要**因为语义相近
就把 `top` 改成 `mutateBy("setZIndex")`——那会让一个布尔开关被写到层叠顺序值上。

### `draggingCursor` 的真实形状：**普通 `string`**

官方 `overlay/MarkerOptions.d.ts` 原文：

```ts
/** 拖拽标注时的鼠标指针样式，需遵循 CSS cursor 属性规范 */
draggingCursor?: string;
```

**没有任何 `@default`、没有任何候选值清单**。因此本库收**普通 `string`**，
**不**自造 `"grab" | "pointer" | …` 联合：CSS cursor 的合法值是**开放集合**
（关键词 + 任何 `url(…)`），联合一定会漏掉合法值。那正是 AGENTS.md 说的「不取证就建抽象」。

### 不加什么：`CustomOverlayOptions` 的 8 个缺口

官方 17 个键，本库收 9 个。**逐条裁决**（缺口 ≠ 待补）：

| 官方键 | 裁决 | 理由 |
| --- | --- | --- |
| `rotationFlip` | 不加 | 无 setter 的构造期**渲染细节**（翻转与否），本库既不测也不暴露 |
| `fixBottom` | 不加 | 同上 |
| `useTranslate` | 不加 | 官方原文「是否使用 translate3d 进行**性能优化**」——**性能开关**，不是能力开关；它的效果依浏览器/图层而定，本库侧无法断言 |
| `autoFollowHeadingChanged` | 不加 | 与 `rotation` 强耦合且**无 setter**；加进来会让「改了 `rotation` 却没跟着转」变成一个**无法验证**的 prop |
| `enableDraggingMap` | 不加 | 是真实能力，但**无 setter**，且与 `position` 的受控主模型**互相覆盖**（拖图会移动覆盖物，而 `position` 受控）⇒ 在没有「用户拖了图」事件可对齐之前两者不能共存 |
| `nextTick` | 不加 | 官方原文「是否**延迟一帧**再显示」——**时序 hack**，暴露它等于承诺一个本库无法保证的渲染时序 |
| `synUpdate` | 不加 | 官方原文「开启后覆盖物位置更新将**不再走默认的坐标转换逻辑**」——它会**改变 `position` 的语义**，同一个 prop 在两种模式下行为不同且无法检测 |
| `drawHook` / `isReDraw`（GroundOverlay） | 不加 | 只在 `type: 'canvas'` 下有意义，而官方 **`setImage(url: string)` 不接受 canvas**（见下）——加进来就是「构造期能用、运行期不能用」的半截能力 |

合计：17 - 9 = 8 个缺口，其中 6 个是「无 setter 的渲染细节 / 性能开关 / 时序 hack」，
2 个（`enableDraggingMap` / `synUpdate`）**与本库的受控主模型冲突**。补它们不增加任何
**可断言的能力**，只增加「声明了却几乎观察不到」的面。

### `CustomOverlay` 的 `zIndex` 保持 `recreate`（反向守卫）

官方 `CustomOverlay` **没有** `setZIndex`（成员表逐条核对过：`setPoint` / `setRotation` /
`setRotationOrigin` / `getRotation` / `getPoint` / `setProperties` / `getProperties` /
`addEventListener`）。仓库里已有反向守卫测试
（`tests/behavior/overlay-update-policy.test.ts`），本文与
`tests/behavior/remaining-overlay-options.test.ts` 各再点名一次。

## 四、既有窄化（如实记录，本次**未**改）

### `GroundOverlay.url` 对 canvas 的支持是**上游自身**的不对称

- 官方 `GroundOverlayOptions.url?: string | HTMLCanvasElement`（**声明支持 canvas**）；
- 官方 `GroundOverlay#setImage(url: string)` —— **运行期只接受字符串**。

也就是说官方**声明**支持 canvas，**运行期更新路径**却不支持。本库因此：

- 构造期照收 `string | HTMLCanvasElement | (() => …)`（`type: "canvas"` 的用法）；
- 运行期把 `url` 声明为 `options`（`setImage`）——**这是一处已知窄化**：
  构造后换 canvas 会被 `setImage` 拒掉。

**本次不改这条策略**：改它要动 Fake 的 `setImage` 签名（让它接受 canvas），
那是**替上游补一个它没有的能力**，与本库「不补上游没有的东西」相悖。
只把「官方声明的宽度 > 本库能给的宽度」记成一条断言，避免它悄悄变宽/变窄。

### `imageURL`（`@deprecated` 别名）刻意不收

官方 `GroundOverlayOptions.imageURL` 带 `@deprecated 4.0 请使用 url`。
本库 1.0 不提供旧版迁移路径（集中弃用层已随 #136 整层删除）⇒ 只收 `url` 一份。

## 五、Vue Boolean-absent 陷阱（本次踩到并已钉死）

Vue 的 `Boolean` 类型 prop 在**未给**时，编译产物里的运行时值是 **`false`**，不是 `undefined`。
这对**官方默认是 `true`** 的选项是**语义反转**（用户没给 ⇒ 被当成显式关闭，而 SDK 默认是开）。

本次新增的选项里，三项的官方默认是 `false`（`raiseOnDrag` / `isTop` /
`restrictDraggingArea` / `top`）、两项是 `true`（`enableMassClear` / `enableClicking`）。
**五项全部在 `withDefaults` 里写了显式 `undefined`**——不只是 `true` 默认那两项：

`false` 默认的三项写 `undefined` 同样有理由：它们是 `recreate` 类，「变化即重建」。
若「未给」有两个表示（`false` 与 `undefined`），父级一次 `:is-top="undefined"`
就会触发一次**内容完全没变**的重建。钉成 `undefined` 让「没给」只有一个表示。

`draggingCursor` 是 `string`（不是 `Boolean`）⇒ 没有这个陷阱，不声明。

## 六、验证

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck:package` / `:tests` / `:type-contracts` | 通过 |
| `pnpm build:package` + `pnpm test:unit` | 183 文件 / 3317 用例全通过 |
| `pnpm check:raw-sdk` / `:tree` / `check:public-dts` | 通过 |
| `pnpm generate:overlay-emits:check` | 无漂移（12 kinds） |
| `pnpm generate:capability-matrix:check` | 无漂移（65 capabilities） |
| `pnpm generate:api-diff:check` | 无漂移 |
| `pnpm docs:typecheck` | 通过 |
| `pnpm check:api` | **有漂移**（父重新生成 `etc/**`） |
