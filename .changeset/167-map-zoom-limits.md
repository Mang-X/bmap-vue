---
"@mangax/bmap-vue": patch
---

`<Map>` 补上官方 `BMap.Map` 的**缩放级别上下限**命令（#167 工作包 B，第一批的第一组）。

## 补了什么

`getMinZoom()` / `getMaxZoom()` / `setMinZoom(zoom)` / `setMaxZoom(zoom)` —— 官方 `BMap.Map`
的四个实例方法（`core/Map.d.ts`：`getMinZoom` / `getMaxZoom` / `setMinZoom` / `setMaxZoom`）。

**与 `<Map>` 的 `minZoom` / `maxZoom` prop 不是同一件事**，因此两个都要有：prop 是**构造期**
`MapOptions` 的初值；这四个作用于**已建好的地图**（用户交互与 `setZoom` 都受它约束）。
此前只有 prop、没有命令——运行期改不了、也读不回生效值。

## 落点（四层）

| 层 | 改动 |
| --- | --- |
| Driver 类型 + v4 实现 | `MapDriver` 新增四个成员；实现按名调用官方成员，**缺成员抛错**（`callRequired`），不静默降级 |
| 命令面 | `MapCommands` 新增四个成员；**读**命令无句柄时返回 `null`、**写**命令空操作，与本面其余成员同口径 |
| `<Map>` expose | `MapExpose extends MapCommands`，随 `createMapCommands` 的展开**自动**暴露，无需改组件 |
| Fake SDK | `FakeV4Map` 补四个成员（含 `minZoom` / `maxZoom` 状态），供行为测试 |

## 验证

- `mapCommands.test.ts` 新增 2 条：有句柄时读回生效限制 + 写命令原样透传 Driver；无句柄时
  读回 `null`、写为空操作。
- API 基线（9 份）随 `MapDriver` / `MapExpose` 重生成。
