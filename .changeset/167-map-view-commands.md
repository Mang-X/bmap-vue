---
"@mangax/bmap-vue": patch
---

`<Map>` 补上官方 `BMap.Map` 的**视图命令与几何读**（#167 工作包 B，第一批的第二组）。

补三个官方实例方法（`core/Map.d.ts`）：

| 成员 | 官方语义 |
| --- | --- |
| `centerAndZoom(center, zoom, options?)` | 同时设中心点与级别（原子；`options` 复用 `ViewCommandOptions`） |
| `resetHeading(options?)` | 重置为**正北方向**；与 `setHeading(0)` 的区别是官方声明的「重置动画**不可被打断**」 |
| `getDistance(start, end)` | 两点间距离（**米**，纯计算，与地图状态无关） |

**一处票面自查更正**：#167 票面写 `centerAndZoom` 含官方的 `(city: string, zoom?)` **重载** ——
核对 `core/Map.d.ts:532` 后不成立：官方签名是 `centerAndZoom(center: Point, ...)`，**不收字符串**
（字符串分支是官方单独给 `setCenter` 声明的）。实现按官方声明走，不收字符串，并在类型注释里写明。

## 落点（四层，与上一组一致）

- Driver 类型 + v4 实现：`centerAndZoom` 走 `callRequired`（与 `initializeView` 内部同一入口）、
  `resetHeading` 走 `capabilities.require("map.heading")` + `callOptional`（与 `setHeading` 同口径）、
  `getDistance` 走 `callRequired` + `numberOf`。
- 命令面：读命令无句柄返回 `null`、写命令空操作。
- `<Map>` expose：随 `MapExpose extends MapCommands` 自动暴露。
- Fake SDK：补 `resetHeading`（归零 heading）与 `getDistance`（haversine，量级与真实 SDK 一致）；
  `centerAndZoom` 原本就在（`initializeView` 用它），直接复用。

## 仍留在票上的（本 PR **不**夹带决策）

- `getMapType` —— 需要 SDK 常量 → 领域 `MapType` 的**反向映射**（`setMapType` 只有正向表），先定口径；
- `getContainerSize` —— 与已有 `getSize`（官方 docstring 分别是「容器尺寸」与「地图当前尺寸」）
  **是否同义**需先判定；若同义，加它就是 §3.6 禁止的**别名**；
- `isLoaded` —— 官方语义是「是否经过 **centerAndZoom** 初始化」（不是「瓦片加载完」），
  与本库 `whenReady` / `isContainerReady` 不同，需要先裁决要不要收这个窄语义。
