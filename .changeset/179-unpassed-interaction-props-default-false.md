---
"@mangax/bmap-vue": patch
---

`<Map>`：**未传**的交互开关 prop 不再被静默 `disable*()`（双指 / 双击缩放恢复官方默认）

> ⚠️ **这是一个行为变更。** 修复前，用户什么都不写时，下面六项**一律是关的**；
> 修复后它们回到**官方自己声明的默认值**——其中 `enableDblclickZoom` 与
> `enablePinchZoom` 会**由关变开**。

## 缺陷

`syncEnableProps` 用 `!== undefined` 表达「**不表态**，交给 SDK 用它自己声明的默认值」：

```ts
for (const [prop, interaction] of INTERACTION_PROPS) {
  const value = props[prop];
  if (value === undefined) continue;          // ← 对缺省 Boolean prop 永不成立
  ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
}
```

但 Vue 会把**缺省 `Boolean` prop** 的「没传」强转成 `false`（`resolvePropValue` 里
`shouldCast && isAbsent && !hasDefault ⇒ false`）。于是这六项
（`enableInertialDragging` / `enableContinuousZoom` / `fixCenterWhenResize` /
`enableDblclickZoom` / `enableKeyboard` / `enablePinchZoom`）——**它们此前都没有出现在
`withDefaults` 里**——在**每一次建图**时都被逐个 `disable*()`。

而官方 `core/MapOptions.d.ts` 声明 `@default true` 的正是
`enableDblclickZoom` 与 `enablePinchZoom`。后果：**用户什么都不写，双指缩放与双击缩放
就被静默关掉了**，而那正是官方默认打开的行为。

## 修法

给这六项在 `withDefaults` 里**显式钉 `undefined`**，让「没传」真的等于「没传」
（口径与 `preserveDrawingBuffer` / `PolygonLayer.mouseStyleChange` 相同）。
`hasDefault` 为真之后，Vue 的「缺失即 `false`」转换不再触发，`syncEnableProps` 的守卫
得以短路，组件**不下发任何调用**，生效的是官方 `MapOptions.d.ts` 自己声明的 `@default`。

## 影响面

| prop | 官方 `@default` | 修复前（不传） | 修复后（不传） |
| --- | --- | --- | --- |
| `enableDblclickZoom` | `true` | `false`（被关） | **`true`**（开） |
| `enablePinchZoom` | `true` | `false`（被关） | **`true`**（开） |
| `enableKeyboard` | `false` | `false` | `false`（不变） |
| `fixCenterWhenResize` | `false` | `false` | `false`（不变） |
| `enableInertialDragging` | 未标注 | `false` | 按 SDK 默认 |
| `enableContinuousZoom` | 官方无构造键 | `false` | 按 SDK 默认 |

**依赖旧行为**（要明确关掉双指 / 双击缩放）的代码请显式写
`:enable-dblclick-zoom="false"` / `:enable-pinch-zoom="false"`。

`enableDragging`（`true`）与 `enableWheelZoom`（`false`）是**显式的库默认决策**，不受影响。

## 新增门禁

`scripts/check-interaction-props.mts`（`pnpm check:interaction-props`，已进 CI）：
**`INTERACTION_PROPS` 覆盖的每一个 prop，都必须在 `withDefaults` 里显式出现**。少了任何一个，
它的「未传」就又会被 Vue 转成 `false`，与 `!== undefined` 守卫冲突。

判据刻意落在**存在性**上而非「值必须等于 `undefined`」——三个值都合法（都关掉了 Vue 的转换），
而选哪个是决策不是门禁该管的事；要求值相等会让 `enableDragging: true` /
`enableWheelZoom: false` 这两项有意决策立刻顶红，判据就退化成常量。门禁**fail-closed**：
解析不到表 / 解析不到 defaults / 解析出 0 项都判失败，绝不静默放行。
