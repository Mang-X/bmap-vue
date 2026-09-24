# usePoint

:::warning 已移除
本库移除了 `usePoint`。`Point` 是纯数据（`{ lng, lat }`），不再需要 SDK 实例，直接使用即可：

```ts
import type { Point } from 'bmap-vue'

const point: Point = { lng: 116.297611, lat: 40.047363 }
```

需要把 `Point` 转为 SDK 实例时（如传入第三方插件），使用 `client.driver.geometry.toRawPoint(point)`，`client` 可在 `ready` 事件或 `useMap().client` 获取。
:::
