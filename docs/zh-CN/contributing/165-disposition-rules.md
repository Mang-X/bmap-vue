# #165 五类处置口径（维护者裁决，2026-09-26）

> 本页是**唯一**的处置判定依据。走查发现的问题按下面五条归类；
> 归错类比漏报更严重——它会让「已处置」变成「已归档」。

| 类别 | 判据 | 处置 | 落点 |
| --- | --- | --- | --- |
| **Class 1** | 已有该能力，**命名**与官方不同 | **直接修**（破坏性改名，**不留别名**，§3.6） | #165 本体 |
| **Class 2** | 命名相同，**行为**不同 | **先核查再定**去留；每条要有证据 | [#171](https://github.com/Mang-X/bmap-vue/issues/171) |
| **Class 3** | 本库**缺失**官方能力 | **按模块开票**补齐 | Map [#167](https://github.com/Mang-X/bmap-vue/issues/167) / 覆盖物 [#168](https://github.com/Mang-X/bmap-vue/issues/168) / 图层 [#169](https://github.com/Mang-X/bmap-vue/issues/169) |
| **Class 4** | **特意设计**的 Vue 适配（v-model / slot / `expose` / Teleport / `defaultXxx` 三态 / `dataVersion` / 作用域清理） | **保留**，不画蛇添足 | — |
| **Class 5** | **明显超出 SDK 语义意图**、画蛇添足（接受后无效果、转发官方未声明成员、兑现不了的承诺） | **整理后删除**（**不留兼容层**） | [#170](https://github.com/Mang-X/bmap-vue/issues/170) |

## 两条容易归错类的界线

**Class 1 vs Class 2** —— 看差异在**名字**还是在**形态**。
`panBy(x, y)` vs `panBy(pixel: Pixel)`：名字同、参数形态不同 ⇒ **Class 2**（形态差异需核查），
不是 Class 1。Class 1 是「概念在、名字不对」。

**Class 4 vs Class 5** —— 看「**为什么**这样」。
`defaultCenter`（官方无此选项，本库为「非受控初值」）是 **Class 4**——
它是让受控 prop 在 Vue 里可用的必要适配。`noAnimation`（官方**没有** `MapOptions.noAnimation`，
本库声明了却无人读）是 **Class 5** —— 它不是解决任何 Vue 问题的适配，是凭空加的。

## 通用约束

- **删除即破坏性变更**：§3.6 禁止 deprecated 别名、迁移 shim、第二套兼容入口。
  每一项都直接删干净，changeset 写清**替代写法**。
- **文档必须同步**：本票已发现「文档把无效成员记成可用」的情况
  （`map.md:145-146` 记了 4 个被丢弃的 prop）。删/改时文档要一起改。
- **分类错比漏报更糟**：把 Class 3（缺失）误判成 Class 4（保留）会让缺口永远消失；
  把 Class 4 误判成 Class 5 会删掉必要的 Vue 适配。归类存疑时先问，别默认。

## 走查结论索引

- 工作包 E（composables）：`165-audit-inventory.md`（**已实施并通过门禁**）
- 工作包 B/C/D/F：`165-audit-B-C-D-F.md`
- 官方 `visualization/` 命名空间（13 个新类）：[#166](https://github.com/Mang-X/bmap-vue/issues/166)
  （新增产品功能，**不属于** Class 3——那是「已有封装的缺失成员」）
