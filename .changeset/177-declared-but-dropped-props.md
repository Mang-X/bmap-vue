---
"bmap-vue": patch
---

`<LocationControl>.onLocationStart` 真正接上线；删除无实现路径的 `printImageUrl`

## 1. `onLocationStart` 此前被静默丢弃

它被正常声明、Vue 正常接收，然后**什么也不做**。原因是它压根没进交给 SDK 的
`options()`，而代码注释写着「走 `create` 覆盖（见下）」——**那个 `create` 钩子不存在**
（grep 零命中）。注释反过来暗示这是刻意设计的「闭包总是最新」行为，读代码的人会以为它能用。

交给 SDK 的现在是一个**稳定转发器**（`onLocationStartProxy`），它在被调用时现读
`props.onLocationStart`。这同时满足两件本来冲突的事：

- `ControlSpec.options` 的变化键对函数值按**存在性**比较（`core/controls/optionKey.ts`
  的刻意取舍），所以直接交出用户闭包的话，换引用不算变化——控件不会重建，
  但**新闭包永远到不了 SDK**；
- 转发器现读 props，于是「换闭包拿到最新那个」成立，且**不引入任何重建**。

转发器定义在 `<script setup>` 里，因此**每个组件实例各有一个**（不是模块级单例）；
要的是**同一实例的整个生命周期内引用不变**。稳定性契约两种情况都成立——变化键只关心
「同一个 props 视图算出来的引用有没有变」，跨实例本来就是两组不同的 props——所以不必
把它提到模块级：那样会把一个组件的 props 捕获进模块作用域，组件卸载后闭包仍持有它。

键的**存在性**仍跟着用户走（`p.onLocationStart ? proxy : undefined`）：没传时该键为
`undefined`，Driver 的 `projectOptions` 跳过它，SDK 侧不会凭空注册一个官方声明里
不存在的回调。代价是「补上 / 删掉」各触发一次控件重建——存在性确实变了，
这与该回调的构造期语义一致。

## 2. 删除 `printImageUrl`（破坏性）

`<Marker>` 的 `printImageUrl` 被删掉了。此前它**类型检查通过、Vue 接收、然后被丢弃**：
上游 `IconOptions`（4.0.5）只有 `anchor` / `imageOffset` / `imageSize`，实例 `BMap.Icon`
上也没有对应成员——它**没有实现路径**。

类型面不得承诺一个上游不认的键。三处一起删（`Marker3dCustomIcon` /
`MarkerCustomIcon` / `MarkerIconInput`，同一键曾各写一份），并用一条逐点名的用例锁住。

**如果你此前传过 `printImageUrl`**：它从来没有生效过，删掉不改变运行时行为；
要设置打印用的 `printImage` 请改用官方支持的方式。

Driver 侧的 warn-once **保留**：类型面之外的真实运行（JS / `any`）仍可能带着这个键，
诊断丢掉它就退化成静默丢弃。

## 新增反向门禁

`scripts/check-props-projected.mts`（`pnpm check:props-projected`，已进 CI）：
**`*Props` 里声明了却没有读者的 prop 必须为空**。已有的声明面门禁全部只覆盖
「声明的键都有落地方式」这一个方向——所以 `<LocationControl>.onLocationStart`
长期是「有描述符、Vue 正常接收、然后被静默丢弃」，没有任何一道门禁会红。

判据按架构分三档：控件查 `ControlSpec.options()` 的投影；走 `useOverlaySpec` 的覆盖物
不查（`OverlayFieldMap<Props>` 是 mapped type，漏一个键 `vue-tsc` 就红，重复查等于
假装能查出一个编译期已拦住的缺陷）；走 `useOverlayResource` 的（`Marker3D` / `MapMask`）
手写 `create(ctx, p)`，那里没有任何类型层约束，是这条门禁的主要增量。

它与 `check:interaction-props` 方向相反、两条都要有：那条管「描述符有、出口无」，
这条管「出口有、没人读」。
