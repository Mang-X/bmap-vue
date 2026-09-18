# BInfoWindow 信息窗口

使用 slot 模式渲染子节点向地图添加信息窗口，以及与地图相关的一些交互。

```ts
import { BInfoWindow } from 'baidu-map-gl-vue'
```

::: tip 提示
地图上只能同时显示一个 `infoWindow`：同一张地图上多个 `<BInfoWindow>` 同时 `v-model:open` 为
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
| `show`               | `open` 的兼容别名（v2 沿用）。使用时会经集中弃用层提示一次（code `BMAP_DEPRECATED_PROP_ALIAS`），请迁移到 `open` | `boolean`                 | -               |
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
（`update:position` 那类「就地移动」对它不适用）。重建对外是原子的：只发 `rebuild` / `destroy`
事件，不会产生多余的 `close` / `open`。
:::

## 组件事件

| 事件名         | 说明                                                       | 载荷                     |
| -------------- | ---------------------------------------------------------- | ------------------------ |
| `open`         | 气泡被打开（**任何**来源：prop 驱动或 SDK 侧的有效变化）   | -                        |
| `close`        | 气泡被关闭                                                 | -                        |
| `clickclose`   | 用户点了气泡上的关闭按钮（官方 `clickclose`）              | 事件对象                 |
| `maximize`     | 气泡被最大化（需 `enableMaximize`）                        | 事件对象                 |
| `restore`      | 气泡从最大化还原                                           | 事件对象                 |
| `update:open`  | 受控状态回写：**只有 SDK 侧的关闭 / 打开**才会回写         | `boolean`                |
| `update:show`  | 兼容状态回写（与 `update:open` 同源）                      | `boolean`                |
| `rebuild`      | 实例被重建（构造期属性变化）。**首次创建不发**，载荷是新的实例代次 | `number`                 |
| `destroy`      | 实例被释放，载荷是旧的实例代次                             | `number`                 |

`update:open` **不回声**父级驱动的变化：给 `open` 赋值 `false` 时组件不会回写一次 `false`
（受控组件的常规语义）。想知道「气泡真的开了 / 关了」，用 `open` / `close` 事件。

**命令失败（同步抛错）会被收敛，并且不回留在过渡状态**：打开 / 关闭的 SDK 调用如果同步抛错，
组件把它交给 `resource:error` 诊断通道，同时把模型与相位收敛到「关」（**位置移动失败除外** ——
那时气泡仍然开着，只撤销那次请求的记账）。

**迟到的内/外部事件按「谁下发的请求」归属**：如果一条 `open` / `close` 回包属于**本组件自己**已下发的
请求（例如位置移动时重发的打开、或刚下发的关闭），它会先被用来结账、再决定要不要重新收敛到父级的期望
状态 —— 这类**瞬时**的中间状态不会回写 `update:open`，也不会发 `open` / `close` 事件；只有**外部**
（不是本组件发起的）打开 / 关闭才会如实回写。

**被顶掉之后又迟到接管的气泡会被真正关掉**：同一张地图上被后打开的气泡顶掉的实例，如果它那条更早的
打开请求在**之后**才由 SDK 接管（真机上打开是异步的，这个窗口存在），本库会识别出「这是我自己请求的、
但我不想它开着」，并主动把它关掉 —— 地图上不会留下一个已经被顶掉的气泡。

### 兼容别名 `show`（v2）

`show` / `v-model:show` 会经仓库的**集中弃用层**（`core/deprecations`）处理：稳定 code
`BMAP_DEPRECATED_PROP_ALIAS`、统一文案、**同实例只提示一次**、production 默认不输出。

::: warning 两个都传时以 `show` 为准
这与其它覆盖物的「正典优先」不同：`open` 有运行期默认值（为了 `open` 这种裸布尔属性仍按 Vue
惯例生效），因此「父级有没有传 `open`」在 props 上不可观测。与其让默认值把旧名彻底压死
（`v-model:show` 会静默失效），这里取可观测的规则：**显式给出的旧名生效**，并在集中层提示你迁移。
:::


## 状态同步与清理

`open` 是唯一的主状态，支持 `v-model:open`：

```vue
<BInfoWindow
  v-model:open="open"
  :position="position"
  title="北京"
  :width="320"
>
  内容
</BInfoWindow>
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

气泡内容依赖客户端的宿主节点，因此**服务端渲染的 HTML 里不含气泡内容**（`<BInfoWindow>` 在
SSR 期不渲染 slot、不创建宿主）。这与地图本身只在客户端可用是一致的。
