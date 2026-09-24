# InfoWindow 信息窗口

使用 slot 模式渲染子节点向地图添加信息窗口，以及与地图相关的一些交互。

```ts
import { InfoWindow } from 'bmap-vue'
```

::: tip 提示
地图上只能同时显示一个 `infoWindow`：同一张地图上多个 `<InfoWindow>` 同时 `v-model:open` 为
`true` 时，**最后一个打开**的会显示出来，被顶掉的那个会收到 `update:open=false`（不需要手动处理
两个气泡的竞争）。
:::

## 组件示例

:::demo 通过 slot 插槽渲染不同内容 infoWindow class="p-top"
overlay/infowindow
:::

:::demo 动态位置
overlay/dynmicInfoWindow
:::

<style scoped>
  :deep(img) {
    max-width: none;
  }
  :deep(h2) {
    margin: 0;
    border-top: none;
    padding-top: 0;
    letter-spacing: initial;
    line-height: initial;
  }
</style>
<br>

## 组件 Props

| 属性                 | 说明                                                                     | 类型                      | 默认值          |
| -------------------- | ------------------------------------------------------------------------ | ------------------------- | --------------- |
| `open`               | **唯一主状态**：是否打开，支持 `v-model:open`                            | `boolean`                 | `false`         |
| `position`           | 信息窗体所在坐标。**打开与移动都由它驱动**                               | `{ lng, lat }`            | -               |
| `title`              | 信息窗标题文字（官方支持 HTML）                                          | `string`                  | `''`            |
| `width`              | 信息窗宽度，单位像素。取值范围：0, 220 - 730。0 表示按内容自适应          | `number`                  | `0`             |
| `height`             | 信息窗高度，单位像素。取值范围：0, 60 - 650。0 表示按内容自适应           | `number`                  | `0`             |
| `offset`             | 底端尖角相对地理坐标的像素偏移。**构造期属性**（官方没有 `setOffset`）    | `{ x, y }`                | `{ x: 0, y: 0 }` |
| `enableMaximize`     | 是否开启最大化功能（需配合 `setMaxContent`，官方默认关闭）                | `boolean`                 | `false`         |
| `enableAutoPan`      | 是否开启打开时地图自动平移                                               | `boolean`                 | `true`          |
| `enableCloseOnClick` | 是否开启点击地图关闭                                                     | `boolean`                 | `false`         |

::: warning `offset` 是构造期属性
官方 4.0 的 `InfoWindow` 只有 `getOffset()`，**没有** `setOffset`，因此 `offset` 变化会**重建实例**
（`update:position` 那类「就地移动」对它不适用）。重建会释放旧实例、创建新实例，随后按当前期望
**重新打开** —— 那次重新打开是一次真实的 SDK 事件，因此会**如实转发**一次 `open`；
旧实例的关闭发生在解绑事件之后，所以不会有配对的 `close`。
:::

## 组件事件

| 事件名         | 说明                                                       | 载荷                     |
| -------------- | ---------------------------------------------------------- | ------------------------ |
| `open`         | 气泡被打开（**SDK 事件原样转发**；prop 驱动的打开不回声）  | -                        |
| `close`        | 气泡被关闭（**SDK 事件原样转发**）                        | -                        |
| `clickclose`   | 用户点了气泡上的关闭按钮（官方 `clickclose`）。**原样转发**：实测同一次点击可能派发多条（见下） | 事件对象                 |
| `maximize`     | 气泡被最大化（需 `enableMaximize`）                        | 事件对象                 |
| `restore`      | 气泡从最大化还原                                           | 事件对象                 |
| `update:open`  | 受控状态回写：**只表达状态变化**（用户点关闭按钮 / 被同图另一个气泡顶掉各回写一次） | `boolean`                |
| `rebuild`      | 实例被重建（构造期属性变化）。**首次创建不发**，载荷是新的实例代次 | `number`                 |
| `destroy`      | 实例被释放，载荷是旧的实例代次                             | `number`                 |

`update:open` **不回声**父级驱动的变化：给 `open` 赋值 `false` 时组件不会回写一次 `false`
（受控组件的常规语义）。想知道「气泡真的开了 / 关了」，用 `open` / `close` 事件。

::: warning `clickclose` 可能一次点击来多条（上游行为，原样转发）
真实 4.0 实测：点一次关闭按钮会派发 `close` **恰好一条**，而 `clickclose` 的条数**随同一个气泡
被打开过几次累积**（打开 1/2/3 次 ⇒ 1/2/3 条）—— SDK 每次打开/重绘都会重新绑定关闭按钮的处理器。
本库**原样转发**这些事件（不在转发层去重），所以把 `clickclose` 当「一次点击一次」用的代码
应当自己按需去抖。组件自身的状态收敛不受影响（第 2 条起不改变任何状态）。
:::

**本组件拥有它创建的那个 InfoWindow**（ownership 契约）：

- `open` 是**唯一的控制意图**（desired）；SDK 的 `open` / `close` 只是**观测**，用来触发一次收敛，
  **不是**第二套业务意图 —— 所以本库**不再推断**「这条 `close` 属于哪一次命令的回包」；
- 收敛只做三件事：期望开而地图上没开 ⇒ 打开；期望开、地图上开着但 `position` 变了 ⇒ **再打开一次**
  （官方没有 `setPosition`，重开是唯一的移动手段）；期望关而地图上开着 ⇒ 关闭；
- 因此**外部**（别处调 SDK）去开 / 关**这个组件拥有的实例**时，本库**不再把它翻译成新的 `v-model`
  意图**，而是按上面的规则把地图收敛回你的期望；
- **想让用户也能关掉**：用 `v-model:open`（或监听 `close` 事件把 `open` 置 `false`）。用户关掉之后
  你的意图也跟着变成「关」，本库就不会再把气泡拉回来。若始终写死 `open: true`，本库会按受控语义
  **重新把气泡打开** —— 这是受控组件的常规行为；
- 用户点气泡上的关闭按钮（`clickclose`）带**明确来源** ⇒ 除了转发事件，还会**回写一次**
  `update:open(false)`（回写表达状态变化，同一状态只回写一次）；
- 打开 / 关闭的 SDK 调用**同步抛错**时交给 `resource:error` 诊断通道，**不假装成功**；
  父级下一次改变意图时会自然重试；
- 同一张地图上被**另一个气泡顶掉**时，回写一次 `update:open(false)` 并**不再抢回来**，
  直到你把 `open` 置回 `false` 再置 `true`（否则两个都写 `open: true` 的气泡会互相顶替）。


## 状态同步与清理

`open` 是唯一的主状态，支持 `v-model:open`：

```vue
<InfoWindow
  v-model:open="open"
  :position="position"
  title="北京"
  :width="320"
>
  内容
</InfoWindow>
```

::: warning 打开气泡必须给出 `position`
官方 4.0 的打开入口是 `Map#openInfoWindow(infoWnd, point)`，`point` **没有默认值**，`InfoWindow`
实例也没有公开的 `openInfoWindow()` —— 所以「没有位置就打开」没有可解释的语义。气泡挂到 Marker 上的
「目标级打开」属后续里程碑。
:::

**状态同步是一条声明式规则**（没有隐藏状态）：

| `open` | `position` | 结果                                                                              |
| ------ | ---------- | --------------------------------------------------------------------------------- |
| `true` | 有效坐标   | 打开；已打开时按新坐标移动                                                        |
| `true` | 缺失       | 不打开（已经开着就关掉），并把一次 `BMAP_INVALID_ARGUMENT` 交给内部诊断总线        |
| `false`| 任意       | 关闭                                                                              |

两个推论值得注意：

- **`position` 晚到会自动补开**：`open=true` 先到、`position` 由异步数据后到是常见形态，组件按
  「期望状态」判断，不需要手动把 `open` 切成 `false → true` 来恢复；
- **`position` 变回 `undefined` 会关闭气泡并报错**（而不是悄悄停在旧位置）；
- `position` **不是**实例 option：动态移动走的是重新 `openInfoWindow`，不会出现「position 在当前
  引擎不支持」这类告警。

## 内容宿主（detached host）

气泡的内容节点由 **SDK 持有**，Vue 只负责渲染它的子树：

- 组件创建一块独立的内容宿主节点交给 `new BMap.InfoWindow(host)`，SDK 会在打开时把它搬进自己的容器；
- **Vue 的渲染子树由 `<Teleport>` 挂到这块宿主上**，因此 SDK 搬动宿主时不会动到 Vue 管理的节点树；
- 宿主带 `data-bmap-infowindow-content` 属性（唯一的 DOM 契约），需要从外部定位气泡内容时用它；
- `class` / `style` / 其它 `$attrs` 落在宿主内部的包装节点上；
- **卸载与实例重建时由本库摘掉宿主**（`remove()`，不留下游离节点）。**关闭**气泡时宿主本身不摘
  —— 实例要留着复用，是否连带撤掉容器由 SDK 决定（官方没有对「关闭后内容节点归谁」作出承诺）；
- 打开之前宿主根本不在文档里（因此不需要旧实现那种 `display:none` 的兜底），**组件根是
  `<Teleport>`**，所以实例的 `$el` 不指向内容节点。

slot 内容尺寸变化（文本更新、图片异步加载、字体变化…）经 `ResizeObserver`（`border-box`，与尺寸
读数同语义）观察**这块宿主**，并用合帧的方式每帧最多重绘一次；由重绘自身引起的尺寸变化会被吞掉，
不会形成反馈循环。

## SSR

气泡内容依赖客户端的宿主节点，因此**服务端渲染的 HTML 里不含气泡内容**（`<InfoWindow>` 在
SSR 期不渲染 slot、不创建宿主）。这与地图本身只在客户端可用是一致的。
