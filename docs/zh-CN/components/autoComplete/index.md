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
- 组件卸载时调用 Driver 的公开释放入口释放实例：解绑输入框上的输入活动监听、让在飞请求显式失败、再调用 SDK 自己的 `dispose()`。**输入框通常比实例活得久**，因此不要指望 SDK 回收时顺手清掉挂在它上面的监听。
- props 变化的 watcher 与 SDK 事件订阅都注册在组件的 `ResourceScope` 里，卸载后不再回写。
- 程序化检索（`suggest()`）的请求归属依赖官方未承诺的 `keyword` 假设，能力矩阵把 `service.autocomplete` 标为 `experimental`；逐请求隔离由后续里程碑收口。

