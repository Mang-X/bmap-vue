---
"@mangax/bmap-vue": patch
---

`<Map>` 补上官方 `BMap.Map` 的**视图命令与几何读**（#167 工作包 B，第一批的第二组）。

补三个官方实例方法（`core/Map.d.ts`）：

| 成员 | 官方语义 |
| --- | --- |
| `centerAndZoom(center \| city, zoom?, options?)` | 同时设中心点与级别（原子）。**官方两个重载**，见下 |
| `resetHeading(options?)` | 重置为**正北方向**；与 `setHeading(0)` 的区别是官方声明的「重置动画**不可被打断**」 |
| `getDistance(start, end)` | 两点间距离（**米**，纯计算，与地图状态无关） |

## 一处更正：我上一版把 `centerAndZoom` 说反了

上一版我核对 `core/Map.d.ts:532` 后断言「官方签名是 `Point`、**不收字符串**」——**这是错的**。
`:555` 是**第二个重载**：

```ts
centerAndZoom(center: Point,  zoom: number,  options?): void;   // :532
centerAndZoom(city: string,  zoom?: number, options?): void;   // :555 —— 不传 zoom 时自动适配该城市的最佳缩放级别
```

字符串分支有官方**独有**的「不传 zoom 自动适配最佳级别」语义，用 `setCenter(city) + setZoom()`
替代会**丢掉它**、也不是原子操作。现在按官方**两个重载**实现：`MapDriver` 与 `MapCommands`
各有两条签名，字符串分支的 `zoom` 可省且**不替官方补一个数字**。类型注释、文档与 Changeset 里的
错误表述已一并更正。

## 落点（四层）

- **Driver 类型 + v4 实现**：`centerAndZoom` 两个重载共用一条实现，`center` 走 `toRawCenter`
  （`Point | string` 与 `setCenter` 同入口）；`resetHeading` 走 **`callRequired`**
  （不是 `capabilities.require("map.heading") + callOptional` —— 那条路的能力探测只覆盖 `setHeading`，
  会让「有 setHeading 没有 resetHeading」的实例**静默 no-op**）；`getDistance` 走 `callRequired` + `numberOf`。
- **命令面**：读命令无句柄返回 `null`、写命令空操作。
- **`<Map>` expose**：随 `MapExpose extends MapCommands` 自动暴露。
- **Fake SDK**：补 `resetHeading`（归零 heading）、`getDistance`（haversine，量级与真实 SDK 一致）；
  `centerAndZoom` 改用 `recordCommandOptions`（原先只赋 `lastViewOptions`，**不交付 `options.callback`**，
  与其它视野命令的 Fake 契约不一致）。

## 仍留在票上的（本 PR **不**夹带决策）

- `getMapType` —— 需要 SDK 常量 → 领域 `MapType` 的**反向映射**（`setMapType` 只有正向表）；
- `getContainerSize` —— 与已有 `getSize` 是否同义需先判定（若同义，加它就是 §3.6 禁止的**别名**）；
- `isLoaded` —— 官方语义是「是否经过 **centerAndZoom** 初始化」（**不是**「瓦片加载完」），
  窄且与本库 `whenReady` / `isContainerReady` 不同。
