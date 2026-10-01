---
"@mangax/bmap-vue": patch
---

#165 图形类覆盖物补齐官方 4.0.5 的 21 个构造选项（`Polyline` / `Polygon` / `Rectangle` / `Circle` / `BezierCurve`）

按 `@baidumap/jsapi-v4-types@4.0.5` 的 `overlay/{Polyline,Polygon,Rectangle,Circle,BezierCurve}Options.d.ts`
逐条核对后补齐此前没有出口的选项。**21 项全部是 `recreate`（构造期）**——逐个核对实例成员表后
确认**没有**对应 setter，因此「改 prop 即重建实例」是唯一能让新值生效的路径。

| 组件 | 补的选项 |
| --- | --- |
| `<Polyline>` | `strokeLineCap` `strokeLineJoin` `enableClicking` `geodesic` `linkRight` `clip` `coordType` `icons` `strokeTexture` `dashArray` |
| `<Polygon>` | `strokeLineCap` `strokeLineJoin` `enableClicking` `linkRight` `coordType` `dashArray` |
| `<Rectangle>` | `coordType` `linkRight` `dashArray` |
| `<Circle>` | `coordType` `dashArray` |
| `<BezierCurve>` | `enableClicking` `dashArray` |

要点：

- **⚠️ `strokeLineCap` / `strokeLineJoin`：live 读数给出一条反直觉的结论。**
  官方 4.0.5 的**类型声明里没有**这两个 setter，但**运行时原型链上确实有**——挂在图形族
  共享的那一层（与 `setStrokeColor` / `setStrokeWeight` / `setStrokeStyle` 同一层），且
  **真调一次不抛**。之所以仍然判成 `recreate`：live 实测调完之后 `getStrokeStyle()` 读回
  **没有变化**——**没有任何可观察的效果**，且官方**没有**任何 getter 能证明它生效了。
  认成 `mutable` 会变成「调用成功但画面不变」的**静默假支持**，比 `recreate` 糟糕得多。
  （这与 `Marker#setAnchor` 是同一类问题的镜像：那次是「声明里有、运行时没有」，
  这次是「运行时在、但调了不生效」。两者都指向同一条纪律——**判据是「可观察地生效」，
  不是「成员在不在」。**）
- **`dashArray` / `coordType` / `enableClicking` / `geodesic` / `linkRight` / `clip` /
  `icons` / `strokeTexture`**：官方既没有类型声明，**整条原型链上也确实没有**
  （live 读数 layer = -1），判据干净。
- **⚠️ 别只读 `getOwnPropertyNames(Polyline.prototype)`**：`Polyline` 的原型链是 **7 层**
  （自有成员数 8 / 9 / 38 / 27 / 11 / 12 / 12），样式 setter 全在 **layer 2**。只看 layer 0
  会把「38 个成员的那层」整个漏掉，从而误判成一堆 setter 不存在。
- **跨类的策略必须逐类取**：`zIndex` 在六个图形类上都有 `setZIndex`（`options`），而
  `dashArray` 在五个类上**一个 setter 都没有**（`recreate`）。两者在同一个共享底座上共存，
  「都在共享接口里」不推出「策略相同」。`tests/behavior/vector-overlay-options.test.ts`
  有一组反向守卫钉这一条，另有一组对照守卫证明「同在 layer 2 的 `setStrokeColor`
  仍然走 `options`」——避免把 `recreate` 变成一刀切。
- **`enableClicking` 在 `<BezierCurve>` 上此前连描述符都没有**（`<Rectangle>` / `<Circle>` /
  `<GroundOverlay>` / `<Marker>` / `<Label>` / `<Prism>` 早就有），且官方 `@default` 是 `true`
  ⇒ `withDefaults` 写 `undefined` 而非 `true`。
- **Vue Boolean-absent 陷阱**：官方默认 `true` 的 `enableClicking` / `clip` / `linkRight`
  在 `withDefaults` 里一律写 `undefined`（**不是** `true`），配合 spec 里的条件展开
  （`...(p.x === undefined ? {} : { x: p.x })`）⇒「未给」时**键不进入构造选项**，
  由 SDK 沿用自己的默认。测试逐个断言键**不存在**而不是值为 `undefined`。
- **`icons` 官方已 `@deprecated`**（`IconSequence` 类标了「4.0 已废弃，请使用
  `strokeTexture` 配置项代替」）。仍然如实透传，但**不推荐**新代码使用。
- **`coordType` 刻意只收三个值**（`BMAP_COORD_BD09` / `BMAP_COORD_GCJ02` / `BMAP_COORD_WGS84`）：
  官方在图形类的 `coordType` 上**只声明了这三个**，另三个墨卡托变体是给**地图全局**
  `BMap.coordType` 用的。收下就是「本库声称支持、官方没承诺」。
- **反向的键刻意收不下**：`<Circle>` 没有 `linkRight` / `strokeLineCap`（圆形的几何是
  「圆心 + 半径」），`<BezierCurve>` 没有 `coordType` / `linkRight`，`<Rectangle>` 没有
  `strokeLineCap`。`tests/type-contracts/vector-ctor-options.type-test.ts` 对每一条都写了
  `@ts-expect-error`——**补过头比缺一个选项更糟**：缺了会得到编译错误，补过了会得到
  「传了但 SDK 忽略」的假支持。
- 同步更正了 `docs/zh-CN/components/overlay/` 下五篇文档里若干**与 4.0.5 声明不符**的
  v2 遗留条目（例如 `<Circle>` 文档里的 `geodesic` / `clip`、`<Polygon>` 里的
  `geodesic` / `clip` / `autoCenter`），并把「静态 / 动态」两节改成按**更新策略**分组的
  「构造期（`recreate`）/ 就地更新（`options`）」两节。
