---
title: useMapStatus
lang: zh-CN
---

# useMapStatus

把地图的**外部状态**读成一组只读 refs：`center` / `zoom` / `bounds` / `size` / `heading` / `tilt` /
`moving` / `zooming`。

```vue
<script setup lang="ts">
import { useMapStatus } from 'bmap-vue'

const { center, zoom, moving } = useMapStatus()
</script>

<template>
  <p>{{ center }} · zoom {{ zoom }} · {{ moving ? '移动中' : '静止' }}</p>
</template>
```

## 返回

| 字段      | 类型                                | 说明                                              |
| --------- | ----------------------------------- | ------------------------------------------------- |
| `center`  | `Readonly<ShallowRef<Point \| null>>` | 地图中心点；未就绪 / 读不到时 `null`              |
| `zoom`    | `Readonly<ShallowRef<number \| null>>` | 缩放级别                                        |
| `bounds`  | `Readonly<ShallowRef<Bounds \| null>>` | 可视范围（`{ southwest, northeast }`）          |
| `size`    | `Readonly<ShallowRef<Size \| null>>` | 容器尺寸                                          |
| `heading` | `Readonly<ShallowRef<number \| null>>` | 旋转角（度；v4 读回可能为负，`-90 ≡ 270`）      |
| `tilt`    | `Readonly<ShallowRef<number \| null>>` | 倾斜角（度，0..90）                             |
| `moving`  | `Readonly<ShallowRef<boolean>>`     | 是否正在移动（`movestart` 起、`moveend` 止）      |
| `zooming` | `Readonly<ShallowRef<boolean>>`     | 是否正在缩放（`zoomstart` 起、`zoomend` 止）      |
| `dispose` | `() => void`                        | 释放订阅（幂等）；组件 / `effectScope` 内自动释放 |

```ts
// 不传 = 取最近的 <BMap> 子树里那张地图；显式订阅源用于「别处的地图」
const status = useMapStatus({ source: { map, client } })
```

## 三条语义

**① 值没变就不更新。** 每次事件后重新读取，逐字段做容差判等（经纬度 `1e-7`、`zoom` `1e-6`、
角度 `0.01`，与受控视野同一套口径）。相等时**保持原对象**，所以：

```ts
watch(status.center, (p) => console.log('中心点变了', p)) // 同一视野的重复事件不会唤醒它
```

**② 订阅即给值。** map 就绪时立即读一次当前状态，不必等第一个事件（地图创建后一直没动过也有值）。
句柄变成 `null`（销毁）时字段回到 `null`、标志回到 `false` —— 是「未知」，不是「保持上一次的值」。

**③ `moving` / `zooming` 不倒置。** 这两个标志由 start / 中 / end 事件驱动，且**不走合帧**：
同一帧里 `moving` 若被推迟到下一帧、而 `moveend` 同步处理，标志会被后到的 `moving` 重新置为 `true`，
出现「已结束却仍在移动」。

## 与 `useBMap()` 的分工

- `useBMap()` 给的是**运行时**状态（`status` / `map` / `client` / `whenReady`），回答「地图准备好了吗」；
- `useMapStatus()` 给的是**地图外部状态**（视野与尺寸），回答「地图现在看的是哪里」。

需要命令式操作地图（`setCenter` / `fitBounds` / 截图…）时，用 `useBMap()` 拿到 `client` + `map`
再走 `client.driver.map.*`。

## 释放

订阅会在组件卸载 / `effectScope.stop()` 时自动释放；也可以手动：

```ts
const status = useMapStatus()
status.dispose()
```
