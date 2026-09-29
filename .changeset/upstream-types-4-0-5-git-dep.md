---
"bmap-vue": patch
---

#165：上游类型包升到 4.0.5（git 钉 commit），并随之修正三处依赖「类是否被声明」的判断

## 依赖

`@baidumap/jsapi-v4-types` 从 npm 的 `4.0.4` 换成**钉住 commit** 的 git 依赖
`github:baidu-maps/jsapi-v4-types#5ba67f4dda11b0a4b54fc631278d3e39e11667c3`（版本 4.0.5）。
**4.0.5 至今未发布到 npm**（`npm view` 的 `latest` 仍是 4.0.4），因此只能从 git 取。
改用 git 之后不再需要 `patches/` 目录：`@baidumap__jsapi-v4-types@4.0.4.patch` 已按它自己
写明的 deletionCondition **删除**（4.0.5 自己修好了大小写引用）。

大小写回归**没有被跟着删掉**，而是反转成长期门禁 `upstream-types-reference-case.test.ts`：
缺陷的本体是「上游声明内部的自引用大小写不一致」，与用不用补丁无关。

## 随 4.0.5 而来的行为修正（无破坏性变更）

4.0.5 给 `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 补上了**类声明**（4.0.4 没有）。
这三类的存在性判定此前**全都挂在 `declared` 这一个开关上**，升级后那个开关会同时改掉三处
与「声明」无关的行为——现已拆成三个各判各的：

| 判断 | 之前 | 现在 | 不拆会怎样 |
| --- | --- | --- | --- |
| `setStyle` 落到哪个成员 | `declared` 为真就 `setStyleOptions` | 按 `styleMember` 逐 kind 记录 | 4.0.5 声明的入口是 `setOptions`（`setStyleOptions` / `doOnceDraw` **均不存在**），会打到上游没承诺的成员上 |
| `setEnablePicked` 落到哪个成员 | `declared` 为真就 `setBaseOptions` | 同上 | 4.0.5 的 `PointLayer` 直接声明了 `setEnablePicked`，跟着 `declared` 走会打到 `setBaseOptions` |
| 构造器缺失时的错误码 | `declared` 为真就普通构造器路径 | 按 `RUNTIME_INJECTED_LAYER_CTORS` 判 | 运行时**尚未注入**会被误报成 `BMAP_SDK_CALL_FAILED`，而正确结论是 `BMAP_CAPABILITY_UNSUPPORTED`（注入后可创建）——两者对调用方处置不同 |

关键区分：**「类型包里有类声明」≠「运行时已加载」**。这四个类在真实浏览器里仍要等可视化
扩展异步注入，所以 `runtimeOnly` 依然成立——它说的是**注入时机**，不是类型包版本。

## 另外解除的一项裁决

路线服务 `setPolylineStyle(style: RoutePolylineStyle)` —— `RoutePolylineStyle` 在 4.0.4 里
**只被引用、从未声明**，此前按「上游自相矛盾、不猜公开形态」登记为不实现。4.0.5 把参数改成了
真实存在的 `PolylineOptions`，这条裁决的前提消失，可以按官方类型落地了（实现另票，
本轮只解除裁决、记录依据）。

## 不在本票范围

4.0.5 新增的 `visualization/` 命名空间（13 个类）属于**新增产品功能**，不是「给已有封装补成员」，
已拆为 **#166**。同一版里 `FillLayer` / `LineLayer` / `PointIconLayer` / `PointShapeLayer`
四个类被官方标记 `@deprecated`（建议改用 `visualization/` 的对应类）——本轮**保留**这四个
既有组件且不改名（弃用是上游的事，本轮引入 deprecated alias 反而违反 #165 §3.6），
但已在对齐清单里如实登记，去留作为 #166 的收尾决策。
