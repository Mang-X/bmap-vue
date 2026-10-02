---
"@mangax/bmap-vue": patch
---

# #188：修复根入口与组件发布声明的 `__VLS_*` 悬空引用

`dist/index.d.ts` 与 `dist/components.d.ts` 此前各带 **51 处** `TS2304: Cannot find
name '__VLS_1'`。消费方开 `skipLibCheck: false` 直接编译不过，而 `check:api` /
`verify:package` 全绿。

## 根因不是「多声明 var」，是类型位置的 `typeof`

原先记为「`vue-tsc` 把插槽载荷 emit 成多声明 `declare var __VLS_1: …, __VLS_3: …`，
打包器没带进去」。用真实 API Extractor 7.59.0 逐个验证后，这个描述**不准确**：

| 输入形态 | AE | rollup 后产物 |
| --- | --- | --- |
| `declare var __VLS_1: {...}, __VLS_3: {...}`（现状） | ❌ | 悬空 |
| 拆成两条单声明 `declare var` | ❌ | **仍悬空** |
| 改 `declare var` → `type` 声明，仍写 `typeof` | ❌ | **仍悬空** |
| 换成**已声明的唯一名** type alias，仍写 `typeof` | ❌ | **仍悬空** |
| 内联 payload（无 `typeof`） | ✅ | 合法 |

AE 的 rollup 只保留**导出面可达**的符号，模块局部变量不在其中。`typeof` 指向它，
于是引用它的 `__VLS_Slots` 留在产物里而声明没了 —— 与它是不是多声明符无关。

## 修法：52 个组件补 `defineSlots`

`defineSlots` 走另一条 emit 路径：Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间
`var`。47 个非泛型组件里 45 个是裸 `<slot />`，用
`default?(props: Record<string, never>): any`；`Map.vue` 与 `BMapProvider.vue` 按各自实际
绑定写载荷。实测裸插槽与 `<Teleport>` 内插槽都通过模板校验。

另 5 个是 `components/data/*` 的 `generic="Item"` 泛型组件（`MarkerList` /
`PointCollection` / `MarkerCluster` / `PointIconLayer` / `PointLayer`）。它们**本来**就
emit 出合法形态（vue-tsc 无法把泛型组件的插槽类型提升成顶层别名，于是内联展开），
首轮据此没改。但「当时恰好合法」不是判据：换个 Volar 版本或改一下模板就可能退回悬空
形态，而没有任何门禁会红。补齐后另立一条判据（见下）。

**附带收益**：声明从此**受模板校验**（写错载荷会报 `TS2353`），插槽类型有单一事实源，
不再由 Volar 从模板反推。

`<Map>` 的载荷按**当前实际推导**写（`error` 源自 `MapRuntime.error`，其声明是
`ShallowRef<unknown>`，故推导为 `{} | null`）—— 写成更「好看」的 `BMapError | null`
会被模板校验挡下。收窄 `MapRuntime.error` 属运行时类型面的独立决策，不在本票范围。

## 撤销「预期失败即通过」的豁免

`check:api` 原先把 `.` / `./components` 列为 `KNOWN_BLOCKED`，靠一条**断言失败模式仍是
`Symbol not found for identifier: __VLS_`** 的探针当作通过 —— 即要求缺陷必须持续存在。
豁免已撤销：七个出口现在都跑 AE、都比对 report 与签名基线。

`index` / `components` 登记为**forgotten-export 身份集合不适用**，理由逐出口写在
`scripts/api-forgotten-boundary.mts#FORGOTTEN_EXEMPT_ENTRIES`：它们的 192 个
`ae-forgotten-export` 里 146 个是 Volar 机器名（`__VLS_Slots_*` / `__VLS_WithSlots_*` /
`__VLS_component_*` 各 47，`__VLS_PrettifyLocal_*` 5），登记进「公共 API 冻结」等于给编译器
内部临时名发通行证；另 46 个是本库真实类型，每个该「升为导出」还是「收窄签名」是一次
独立的公共面裁决（属 #165），不由本票顺手带出。

## 新增 `check:dts-strict`

全仓库原本**没有任何一处**用 `skipLibCheck: false` 检查发布声明：`fixtures/consumer`
那份是有意的 `true`，`tsconfig.build.json` 虽是 `false` 但编的是 `src/` 不是 `dist/`。
这正是 51 处 `TS2304` 能一路发布而全绿的原因。

新门禁把 `fixtures/consumer/strict/probe.ts` 当消费方源码，用 TS Compiler API 以
`skipLibCheck: false` 编译全部 7 个出口。**AE 通过 ≠ 声明合法** —— AE 分析不出模块局部
标识符上的 `typeof`，这正是本票的缺陷本身。

用 Compiler API 而非 `execFileSync('tsc')`：后者要在临时目录拼出能解析 `vue` 的
`node_modules`，而 pnpm 的符号链接布局让拼装极易变成「红，但红的原因与门禁无关」
（实测首次尝试报了 10 条 `has no exported member 'ComputedRef'`，全是环境噪音）。
判据本身从 `fixtures/consumer/strict/tsconfig.json` 读（`skipLibCheck: false` 与
`strict` 是它的两个支点），不在脚本里内联第二份。

### 探针的断言必须实例化

首版把反 `any` 防御写成 `export type _Root = [NotAny<...>, ...]` —— **未实例化的类型别名
是惰性的**，TypeScript 只在别名被真正求值时才检查其内部，实测 `NotAny<any>` 单独编译
零错误。那样声明面整体退化成 `any` 时门禁照样全绿，「防御」根本没有牙。

改成 `const _rootIsTyped: [...] = [true, ...]` 后，转红可复现。同理，插槽载荷断言不能走
`InstanceType<typeof Map>["$slots"]`：Volar 的 `__VLS_WithSlots<T, S>` 是交叉类型，
`T`（`DefineComponent`）自带构造签名，`InstanceType` 取到的是它而不是带 `$slots` 的分支
（实测得到 `never`，断言随即恒假）。改从构造签名直接取 `$slots`，并用**单向**成员判断
（`P extends M`）—— 成员类型写 `unknown` 时双向判断恒假。

四条断言逐条验证过会转红：注入悬空引用 → `TS2304`；`MapProps` 放宽成索引签名 →
`TS2578`；把插槽 `status` 成员改名 → `TS2322`；把导出替换成 `any` → `TS2322`。

## 验收

- `dist/{index,components}.d.ts` 的 `typeof __VLS_[0-9]` 归零（51 → 0）。
- 七个出口在 `skipLibCheck: false` 下零错误；合法 prop / `$slots` 有推导，
  不存在的成员与写错的类型各有 `@ts-expect-error` 钉住（`TS2578` 同样判红）。
- 门禁**双向**验证过：注入悬空引用 → `TS2304` 转红；把 `MapProps` 放宽成索引签名 →
  `TS2578` 转红。
- `pnpm test:unit` 213 文件 / 3846 用例全绿；`verify:package` 对真实 tarball 全链路通过。