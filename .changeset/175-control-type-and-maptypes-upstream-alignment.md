---
"@mangax/bmap-vue": patch
---

把控件 `type` 与 `<MapTypeControl>.mapTypes` 对齐上游声明（含一处**破坏性**类型修正）

**1 · 控件 `type`：字符串原样透传 ⇒ 经换算表落到官方数值**

上游 `const/NavigationControlType.d.ts` 与 `const/MapTypeControlType.d.ts` 把
`BMAP_NAVIGATION_CONTROL_*` / `BMAP_MAPTYPE_CONTROL_*` 声明为**数字**（`0|1|2|3` / `0|1|2`），
`NavigationControlOptions.type` / `MapTypeControlOptions.type` 收的也是这些数字。此前 Driver
走 `projectOptions` 的**原样透传**分支，把 `"BMAP_NAVIGATION_CONTROL_LARGE"` 这个**字符串**
塞进只认数字的位置——`anchor` 一直有名字→数值映射，`type` 没有，而类型面把这条行为
固化成了一桩「测试恒绿」。

- 新增 `NAVIGATION_TYPE_VALUES` / `MAPTYPE_TYPE_VALUES` **两张按族分开的**换算表
  （`driver/jsapi-v4/controls.ts`），公共 prop 仍是 `string`——**不改调用方**。
  选补表而不是把 prop 收窄成字面量联合：文档与示例一直用常量名，收窄是纯破坏面。
- **分表而不是一张平表**：两族的数值**撞**（`BMAP_NAVIGATION_CONTROL_PAN` 与
  `BMAP_MAPTYPE_CONTROL_MAP` 都是 `2`）。合成一张表时 `<NavigationControl
  type="BMAP_MAPTYPE_CONTROL_MAP">` 会静默拿到一个**合法**数字，官方照着它渲染**另一种
  控件的样式**，控制台里什么都没有。现在跨族名字**告警并忽略**。
- 构造期（`projectOptions`）与 `setType` 就地更新**共用**一处换算，两条路径语义一致。
- `type` 撞上表外的名字时**告警一次并忽略**（构造期不写该键、`setType` 不被调用，控件保持
  上一个已知样式），与 `resolveAnchor` 既有口径一致——不静默塞一个官方不认的值。
  非字符串（已经传了数字）原样放行，不做二次判断。

**2 · `<MapTypeControl>.mapTypes`：`readonly number[]` ⇒ `readonly string[]`（破坏性）**

上游 `const/MapType.d.ts` 是 `declare const BMAP_NORMAL_MAP: string`——4.0 的地图类型标识
**本身就是这些字符串**，官方声明与运行时一致，没有任何数字形态。本库 prop 声明成
`readonly number[]`，是在**主动告诉使用者传数字**，而数字不生效。

这一项**没有**换算（与 `type` 相反）：字符串原样透传就是正确行为。

- **破坏性**：照文档传 `string[]` 的使用者此前本来就在**类型报错**（文档一直写 `string[]`，
  类型却要 `number[]`），现在才编译通过。反过来，按错误类型写了 `number[]` 的调用方会
  在升级时收到编译错误——这是修正而非回归，但属破坏性变更。
- `type` 的公共形状**未变**（仍是 `string`），其余控件与 composable 一律未动。

**护栏**

- 类型层：逐名等值断言（挡「值改错」，含仍在 `0|1|2|3` 范围内的调换）+ 值域穷尽断言
  （挡「上游新增枚举成员」）**成对**存在——单留任一条都会漏（早期版本只写并集 `extends`，
  那是恒真重言式，值全错也不红）。实测四类变异全部转红：删表项 / 值改成越界数 /
  本表值调换 / 上游加成员。
- 运行时：表驱动单测逐条锁住七个数值的换算结果，并锁住跨族名被拒、未知名被忽略、
  `setType` 撞名不写且修好后仍能继续写。

**文档**：`navigation.md` / `map-type.md` 改准 `type` 的换算说明（含两族数值撞这一
静默失效形态），`mapTypes` 标注上游 `declare const BMAP_NORMAL_MAP: string`。
