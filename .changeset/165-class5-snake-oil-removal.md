---
"bmap-vue": major
---

#165 Class 5：明显超出 sdk 语义意图的成员，整理后删除

本票只做**删除**。按 #165 §3.6，**没有**弃用别名、没有迁移垫片、没有第二个兼容入口 ——
被删的键**直接不再被接受**（类型面会在编译期报错，这是刻意的：让「以为它还在」的人立刻看见）。

## A. 四个「接收后不做任何事」的 prop

`grep` 逐个核对过：声明了、有默认值、**没有任何读者**，或读了又被下游丢弃。

| 删除项 | 事实依据 |
| --- | --- |
| `<Map noAnimation>` | `grep "props.noAnimation"` = 0 命中。官方**没有** `MapOptions.noAnimation` —— `noAnimation` 只是 `setCenter` / `setZoom` / `centerAndZoom` 等**单次调用**的选项。 |
| `<Map restrictCenter>` | 读进 `mapOptions` 后被 `UNSUPPORTED_OPTION_KEYS` 丢弃。官方的能力是 `restrictBounds(bounds)`，收 **`Bounds`** 而不是布尔。 |
| `<Map backgroundColor>` | 同一个丢弃表。4.0 的 `MapOptions` 没有这个键（背景由容器样式 / `displayOptions` 表达）。 |
| `<BMapProvider suspense>` | `grep "props.suspense"` = 0 命中。有声明、有默认值、从不被读。 |

替代路径：

- **地图背景** → 容器样式 `background-color`，或官方 `displayOptions`；
- **限制中心 / 范围** → `restrictBounds(bounds)`。⚠️ 它**没有撤销入口**（上游没有
  `unrestrictBounds` 一类的方法），设了就只能销毁重建地图；
- **动画** → 本库首次视野**恒为** `noAnimation: true`，与该 prop 无关；
- **Provider 加载中 / 出错** → `loading` / `error` 插槽。

## B. `createBMapPlugin({ plugins })` —— 删掉一个「看着像功能」的空转选项

`CreateBMapPluginOptions.plugins` 声明了却**没有任何读者**：app 级配置 `BMapPluginConfig` 只有
`{ provider, defaults }`，插件注册读的是 **`<Map plugins>` 组件 prop**（两者不是同一件事）。
所以 `createBMapPlugin({ plugins: ['GeoUtils'] })` 一直**静默无效**。

本票按维护者口径**删除**。⚠️ 这是本次唯一一处**可能确有功能意图**的删除 —— 若要让「app 级声明
插件」复活，应当作为**独立功能票**按插件 Catalog 的作用域重做（它需要回答：多张地图共享插件
注册表的生命周期如何结算），而不是把一个空转声明留着。

要注册插件请用 `<Map :plugins="[...]">`。

## C. `<PointLayer>` 上转发上游没有的成员（**kind 特定**）

`pickWidth` / `pickHeight` 在官方**只**声明于 `layer/LineLayer.d.ts`、`layer/PointIconLayer.d.ts`、
`layer/FillLayer.d.ts`、`layer/PointShapeLayer.d.ts`。`PointLayer` 上没有 —— 它的拾取面是
**`pickTolerance`（默认 4）/ `pickThrough` / `mouseStyleChange`**。

原先无条件透传的结果是「构造器静默忽略两个不认识的键」，即收下用不了的 prop。本票只删
**`PointLayerProps`** 上的这两个；**同名成员在 layer 家族上完全合法**，
`BPointShapeLayer` / `PointIconLayer` / `LineLayer` / `FillLayer` 一律**未动**（类型面有正控断言）。
正确的拾取成员由 #169 接入。

## D. 能力目录里三条兑现不了的承诺

`supports()` 是 `<Map ref>` 公开命令面的一部分，返回 `true` 就是一个承诺。

| 条目 | 处置 |
| --- | --- |
| `map.screenshot` | **整条删除**。官方 `core/Map.d.ts:1024` 确有 `getScreenshot`，但 `MapDriver` **没有**该命令面，`supports("map.screenshot")` 却返回 `true`。至今没有组件消费方；实现属 #167，由那张票按「先有消费者再进目录」加回。 |
| `map.fly-to` | **整条删除**。官方有 `flyTo`，本库**没有** flyTo 命令；原先探测的 `panTo` 是**另一个成员**（瞬移，不是平滑飞行），拿它当「飞行定位已支持」是张冠李戴。 |
| `map.viewport` | **保留条目，`rawMembers` 收窄为 `["setViewport"]`**，`status` 仍是 `native`。本库只调用 `setViewport`；把从未调用的 `getViewport` 也列进探测表，会在**没有**该成员的 SDK 上假阴性，把一个可用的写命令连坐成「不支持」。 |

`rawMembers` 的口径因此收紧成「**本库真的调用过的成员**」，而不是「官方在该能力域里有的成员」。

## E. 一个说谎的内部类型

`BMapProvider.vue` 的 `ProviderErrorSlotProps` 声明 `error: BMapError`，而模板传给插槽的是
`ComputedRef`（消费方必须 `.value`）。该接口**不被模板使用、也不从任何入口导出**（`index.ts`
只导出 `BMapProviderProps`）—— 直接删除，而不是留一个不导出但继续说谎的类型。

## F. `minZoom` 默认值落在官方声明的合法范围之外

官方 `MapOptions.minZoom` / `maxZoom` 都声明「取值范围 [3, 21]」，而本库默认 `minZoom: 0` 并
**原样**送进 SDK 构造器。改为：

- 默认值 `minZoom: 0` → **`3`**（合法下界）；
- 越界值**显式报错** `BMAP_INVALID_ARGUMENT`（校验收在 `driver/jsapi-v4/map.ts` 的选项映射
  收口点，因此 `<Map>` 与 `driver.map.create()` 两条路径都被覆盖）。上游没有公开的归一化契约，
  把「文档说无效」的值原样递进去、指望它被 clamp 属于静默劣化。

顺带订正两处把 `tilt` 写成 `0..90` 的注释 —— 官方 `MapOptions.tilt` 声明「取值范围 **[0, 73]**」。
