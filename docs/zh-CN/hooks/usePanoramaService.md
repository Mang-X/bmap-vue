# usePanoramaService 全景检索

按 id 或坐标检索全景数据（官方 `BMap.PanoramaService`）。

```ts
import { usePanoramaService } from 'bmap-vue'
```

## 基本用法

```vue
<script setup lang="ts">
import { usePanoramaService } from 'bmap-vue'

const { data, status, isLoading, findById, findByLocation } = usePanoramaService()

// 按 id 检索
findById('09002200122109011551464100z')

// 按坐标检索（半径省略时由 SDK 用默认的 50 米）
findByLocation({ lng: 116.404, lat: 39.915 }, 200)
</script>
```

只需要 **Client**：本服务不需要地图实例，也不需要 `<BPanorama>`，放在 `<BMapProvider>` 子树里即可。
检索回来的 `id` 可以交给任意查看器使用。

## 返回值

| 成员           | 类型                                   | 说明                                                |
| -------------- | -------------------------------------- | --------------------------------------------------- |
| `data`         | `Readonly<ShallowRef<PanoramaDataInfo \| null>>` | 检索结果                                 |
| `result`       | 同 `data`                              | 别名（模板里 `result?.description` 的习惯）          |
| `status`       | `BMapServiceStatus`                    | `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported` |
| `sdkStatus`    | `number \| null`                       | 官方该服务没有状态码入口，恒为 `null`（不伪装成 0）  |
| `isLoading`    | `boolean`                              | 是否在飞                                             |
| `isError`      | `boolean`                              | `status === 'failed'` 的别名                        |
| `isEmpty`      | `boolean`                              | `data === null` 的别名                              |
| `supported`    | `boolean`                              | 当前引擎是否支持 `panorama.service`                 |
| `findById`     | `(id: string) => Promise<...>`         | 按全景 id 检索                                      |
| `findByLocation` | `(position: Point, radius?: number) => Promise<...>` | 按坐标检索                    |
| `cancel`       | `() => void`                           | 逻辑取消在飞调用（SDK 侧请求收不回）                |
| `reset`        | `() => void`                           | 取消 + 清空 `data` / `error` / `status`             |

## PanoramaDataInfo

| 字段          | 说明                     |
| ------------- | ------------------------ |
| `id`          | 全景 id                  |
| `description` | 全景的描述信息           |
| `position`    | 全景的地理坐标，无则 `null` |

::: tip 「查不到」是 `empty` 而不是 `failed`
官方在查不到数据时回调参数是 `null`（不是错误），因此本库把它结算成 `empty`。
`empty` 与 `failed` 的区别正是调用方能不能重试 —— 合并它们会让 UI 误导用户去重试一次注定查不到的检索。
:::

## 与官方成员的对齐

官方 4.0.4 只声明了两个检索入口：`getPanoramaById` 与 `getPanoramaByLocation`（含带半径重载）。
参考实现 `huiyan-fe/react-bmap` 额外暴露了 `getPanoramaByPOIId`，但上游类型包里**没有**这个成员，
因此本库不暴露它（不为上游没有的成员建模）。
