---
"@mangax/bmap-vue": patch
---

`pnpm verify:package` 新增**无本地 import 的真实 `.vue` 模板** Volar 验证（#158 工作包 C）。

按安装文档（`docs/zh-CN/guide/quick-start.md`「Volar 支持」）只配置
`compilerOptions.types: ["<pkg>/volar"]`，用 `vue-tsc` 编译两份**只有 template 的 SFC**
（结构上不可能有本地 import，因此「无本地 import」是结构保证）：

- `positive.vue` 必须**零诊断** —— 合法 props / slots 可推导；
- `negative.vue` 必须命中 `TS2322`（`:zoom="'12'"`，已有 prop 值类型写错）与 `TS2339`
  （`#default="{ totallyNotARealMember }"`，slot 成员不存在）。

判据刻意落在**反证必须报错**上：`GlobalComponents` 没生效时 `<Map>` 会被当成未知元素，
只测正证会恒绿。反证也不用「未知 HTML attribute」——那可能合法落进 `attrs` 而不报错。

这取代了原先只放空 `volar-probe.ts`、跑一次 `tsc` 的路径解析探针：那只证明 `./volar`
出口可解析，证明不了模板里的组件真的拿到了类型。缺 `./volar` 出口时反证同样会红
（实测：`types` 去掉后 `negative.vue` 零诊断）。
