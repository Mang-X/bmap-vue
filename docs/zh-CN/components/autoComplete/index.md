# BAutoComplete 自动填充 <Badge type="tip" text="^2.1.3" />

地址检索关键词提示

```ts
import { BAutoComplete } from 'baidu-map-gl-vue'
```

:::tip
目前这个组件所使用的百度地图 api 还不稳定 (在写这个组件时候深有体会)
:::

## 组件示例

:::demo
autoComplete/index
:::

## 动态组件 Props

| 属性     | 说明                                 | 类型                            | 可选值 | 默认值       |
| -------- | ------------------------------------ | ------------------------------- | ------ | ------------ |
| location | 设定返回结果的所属范围。例如“北京市” | `string \| Point \| BMapGL.Map` | -      | `BMapGL.Map` |
| types    | 返回数据类型                         | `string[]`                      | -      |

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| searchComplete | 输入字符发起列表检索完成后触发 | `(e: unknown) => void` |
| highlight | 键盘或鼠标移动使某条记录高亮后触发 | `(e: unknown) => void` |
| confirm | 鼠标点击或回车选中某条记录后触发 | `(e: unknown) => void` |

## v3 状态同步与清理

- `location` / `types` 变化会经 **Driver 的公开更新入口**（`setAutocompleteOptions`）落到 SDK 的 `setLocation` / `setTypes`；`location` 可以直接传 `string`、坐标点或 `<BMap>` 的实例（内部句柄由 Driver 归一化，不会原样透传给 SDK）。
- **`location` / `types` 变回 `undefined` = 恢复默认**（与构造期一致）：`location` 回到当前 `<BMap>`，`types` 回到官方默认的 `[]`（全国范围）。Vue 的 props 无法区分「这次没传」与「显式传 `undefined`」，因此这里把两者都当成「恢复默认」。
- 组件卸载时调用 Driver 的公开释放入口，落到 SDK 自己的 `dispose()`。**释放之后到达的检索回包不会再转给 `searchComplete`**（含 SDK 在 `dispose()` 内同步回调的重入路径）。
- 本库**不**在你的输入框上挂任何事件监听（#104）：`Autocomplete` 只有一条不带请求身份的 `onSearchComplete`，「这条结果属于哪次输入」由持有输入框的一方判断，组件不去猜。
- props 变化的 watcher 与 SDK 事件订阅都注册在组件的 `ResourceScope` 里，卸载后不再回写。
- 没有程序化检索入口：官方对 JSONP 风格回包只承诺「单次调用内部的顺序」，多次请求之间没有顺序与身份承诺，所以不做 keyword / FIFO 归属推断（能力矩阵里 `service.autocomplete` 标 `native`，指构造、绑定与转发都是原生的）。需要「输入即检索并拿到结构化结果」时改用 [`useBMapLocalSearch`](/zh-CN/hooks/useBMapLocalSearch) 或官方 UI Kit 的 [`BPlaceAutocomplete`](/zh-CN/guide/ui-kit)。

