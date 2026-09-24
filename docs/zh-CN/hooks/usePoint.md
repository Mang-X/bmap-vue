# usePoint

:::warning 已移除（v3）
v3 移除了 `usePoint`。`Point` 在 v3 是纯数据（`{ lng, lat }`），不再需要 SDK 实例，直接使用即可：

```ts
import type { Point } from 'bmap-vue'

const point: Point = { lng: 116.297611, lat: 40.047363 }
```

需要把 `Point` 转为 SDK 实例时（如传入第三方插件），使用 `client.driver.geometry.toRawPoint(point)`，`client` 可在 `ready` 事件或 `useBMap().client` 获取。
:::

以下为 v2 文档，仅供迁移对照参考。

通过该 hooks 可获取一个地图实例点 (BMapGL.Point)。

```ts
import { usePoint } from 'bmap-vue'
```

## 用法（v2）

```ts
const { point, set } = usePoint()
```
