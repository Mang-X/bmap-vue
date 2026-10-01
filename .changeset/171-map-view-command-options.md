---
"@mangax/bmap-vue": minor
---

补齐五条视野命令的官方 `options`（#171 / #165 裁决 F）：`setCenter` / `setZoom` / `setHeading` /
`setTilt` / `panTo` 现在都能收到官方的第二个参数，**`callback` 让「这条命令完成了」第一次成为
可观察的事实**。

```ts
map.value.setZoom(14, {
  zoomCenter: { lng: 121.5, lat: 31.2 },
  noAnimation: true,
  callback: () => console.log('已经缩放到 14 级'),
})
```

## 为什么是 minor

官方 4.0 的这五条**本来就是** `(value, options?)`，本库此前一律收成 `(value)`——缺口在**类型面
与接线**，不在运行时。2026-09-26 live 实测（真实 AK）确认「传下去就真的会来」：`noAnimation: true`
下五条 `callback` **各交付恰好一次**（`setCenter` 0ms · `setZoom` 1ms · `setHeading` 0ms ·
`setTilt` 0ms · `panTo` 0ms），动画档等 3s 也各一次（`setZoom` 526ms / `panTo` 32ms）。此前调用方
无法知道一条视野命令什么时候真正落定；现在可以了。既有调用（只传第一个参数）完全不受影响。

## 三个新导出的类型

| 类型 | 用于 | 官方声明 | 成员 |
| --- | --- | --- | --- |
| `ViewCommandOptions` | `setCenter` / `setHeading` / `setTilt` | `core/Map.d.ts:660` / `:129` / `:163` | `noAnimation?`、`callback?` |
| `SetZoomOptions` | `setZoom` | `:698` | 上面两个 + `zoomCenter?: { lng, lat }` |
| `PanToOptions` | `panTo` | `:591` | `noAnimation?`、`duration?`（毫秒）、`callback?` |

四条共用 `ViewCommandOptions` 是因为官方在**那四处**声明的是逐字相同的形状；两个有独有成员的
命令各自继承（`setZoom` 的 `zoomCenter`、`panTo` 的 `duration` 是官方逐条声明的差别）。
三个类型从根入口与 `./advanced` / `./composables` / `./plugins` / `./driver` 均可取到。

## 几条边界

- **`options` 是逐调用的，不是 `<Map>` 的 prop。** 官方**没有** `MapOptions.noAnimation`（#165
  Class 5 据此删掉了 `MapProps.noAnimation`），它只作为逐调用选项存在。
- **默认值逐条不同，库不统一。** 官方在 `setCenter` 上标 `@default true`、在 `panTo` 上标
  `@default false`，另两条没标。不传 `options` 时整个参数是 `undefined`，由上游按各自的默认处理。
- **`callback` 按引用透传**，不包装、不加 `try`——它抛出的异常如实上抛。真实 SDK 在动画档是
  **异步**调它，那时的异常会变成 `unhandled`（官方没有回调错误通道）。
- **空对象不下发。** 空 `options` 与「没传」在上游看到的是同一种形状（`undefined`）；
  `callback: undefined` 也不会变成「有一个 undefined 的回调」。
- **`zoomCenter` 是领域 `{ lng, lat }`**（经几何投影成 `BMap.Point`），不是城市名字符串。
  官方 `@default 地图中心点` 由上游自己取，库不会去读一次当前中心再填进去。

## ⚠️ `panTo` 的动画默认：声明与实测不一致，本库**不改**

官方声明 `noAnimation` 默认 `false`（=有动画），但 live 实测（`requestAnimationFrame` 逐帧采
1.5s）读数是 `distinctSampleCount = 1`、`midFlightSamples = 0` —— 无头 SwiftShader 下**直接跳变
到位**。本库不传 `options` 即沿用上游默认，**没有**额外的 prop / 命令不一致要修
（`docs/zh-CN/contributing/165-audit-B-C-D-F.md` 裁决 G）。要确定的时长请显式传 `duration`。
