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
`default?(props: Record<never, never>): any`；`Map.vue` 与 `BMapProvider.vue` 按各自实际
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

### 空载荷用 `Record<never, never>`，不是 `Record<string, never>`

首轮 50 处无参数插槽写成 `default?(props: Record<string, never>): any`。两者都是合法的
`defineSlots` 载荷（都能通过模板校验与 emit），语义却相反：`Record<string, never>` 带**字符串索引签名**，于是消费方写错
插槽 prop 时 `const { typo } = props` **不报错** —— `typo` 只得到 `never`，而 `never` 可赋给
任何目标类型。实测：`Record<string, never>` 下拼错的 prop 静默通过，换成
`Record<never, never>`（或 `{}`）后真的报 `TS2339`。首轮那种写法等于**静默弱化**了消费方的
错误诊断，与本票要恢复的东西正好相反。已全部改为 `Record<never, never>`，并在严格探针里
加了对应判据（`string extends keyof P` → `false`）。

### forgotten-export：按**名字**过滤，而不是按**出口**豁免

`index` / `components` 的 `ae-forgotten-export` 共 192 / 160 条，各分两类：146 条是 Volar
机器名（`__VLS_*`，名字由编译器决定、我们无权裁决），46 / 14 条是本库**真实**类型
（`BMapError` / `PanoramaHandle` / `MarkerListProps` …）。

首轮把这两个出口整体登记为「身份集合不适用」。那等于在这两个主出口上**关掉了整层判据**：
真实欠账本该被冻结、且新增必须先处置，却因为「整个出口不适用」而不再被拒绝 ——
`generate:api` 又能照常更新 report 与签名基线，于是 #165 想堵住的「跑一次生成器就把新欠账
洗成基线」在最重要的两个出口上重新打开。

改为**精确到名字**的过滤（`VOLAR_MACHINE_NAME` + `publicForgottenExports`）：机器名滤掉，
真实类型**照旧进基线、照旧拒绝新增**。`FORGOTTEN_EXEMPT_ENTRIES` 整个删除，替换为
`FORGOTTEN_ZERO_TOLERANCE_ENTRIES`（存量已清零、必须恒为 `[]` 的五个出口）。未清零的 46 /
14 个真实类型各自的公共面裁决仍属 #165，不在本票范围 —— 但它们**在基线里**，看得见、
也拒绝新增。

这两个出口此前**从没有过**基线文件（正因如此才需要「不适用」这个类别）。它们的**首份
基线已随本票提交**（46 / 14 个名字）。

首轮为此加过一个 `generate:api:seed-forgotten`，把「一次性」定义成「基线文件当前不存在」。
那**证明不了**这是历史上的首次播种：删掉基线文件后重跑，会把「旧 46 个 + 本次新增的欠账」
无条件写回去 —— 与 #165 要堵的那条路只差一步删除。评审抓到的正是这个。
首份基线既已提交，**没有任何理由重建它**，所以该入口整个删除，基线缺失改为**判失败**
（原先缺文件读成空集，于是「删掉基线」与「基线确实为空」在判定上完全一样 ——
这才是能洗掉欠账的根因）。

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

### 断言必须真的**有牙**（评审二轮）

首轮的探针有三条断言是**惰性**或**可绕过**的，逐条补强后都注入缺陷验证过会转红：

| 缺陷 | 转红 |
| --- | --- |
| `defineSlots` 调用被删（注释里仍有该词） | 覆盖判据转红（改走 AST CallExpression） |
| 一个出口的 import 被注释掉 | `探针没有覆盖这些出口` |
| **50 处**插槽载荷任一处写成 `Record<string, never>` | `TS2322`（`HasStringIndex` 判据逐组件覆盖） |
| 插槽载荷整体写成 `any` | `TS2322`（条数随被变异的插槽而变） |
| 载荷**成员**逐个写成 `any`（名字不变） | 4 处 `TS2322`（`NoAnyMembers` 判据） |
| 插槽成员改名 | `TS2322` + `TS2353` |
| 探针里漏掉某个组件的断言 | manifest 交叉核对转红 |

**逐组件覆盖**是补上的一处欠账：首轮只探了 `Marker` / `BMapProvider` / `Map` 三个采样点，
实测把 `ZoomControl` 的载荷换回 `Record<string, never>` 门禁照样全绿 —— 采样点之外
等于没盖。现在探针对组件 manifest 的**全部 56 个**出口名逐个断言，并由一条用例把那份
名单钉在 manifest 上（新增组件忘了加断言会立刻变红）。

其中 5 个 `generic="Item"` 组件需要**第二条取值路径**：vue-tsc 无法把它们的插槽类型提升成
顶层别名，产物是函数组件、`$slots` 藏在返回值的 `__ctx.slots` 里，只走构造签名会取不到
（实测那样它们会落进 `unknown` 回退分支、断言恒真）。实测把 45 个顶层 `__VLS_Slots_N`
别名与 5 个内联 `slots:` 块**全部**换成 `Record<string, never>` ⇒ 47 处 `TS2322`，无一漏网。

还有一处**判据本身没有牙**的实例值得记下：逐组件断言先写成
`Record<keyof M, false> = {…}` 那样一张表，实测它**抓不到任何东西** ——
`Record<K, V>` 只用 `V`，`M` 每个键的类型被整个丢掉，于是「某个键变成 `true`」在表里
看不出差别。逐条 `const x: T = false` 才是真的把每个组件的结果接上。同源于本票的
「断言必须实例化」纪律。

`HasSlotMembers` 原先只判「成员名还在」：`P = any` 时 `P extends M` 求值为 `boolean`，
而 `const x: boolean = true` 合法，于是 `(props: any) => any` 能通过。补 `IsAny` 层后转红。
成员**类型**逐个退化那一类原先仍绿（成员名在、类型没了），由 `NoAnyMembers` 逐成员过一遍
`NotAny` 拦住。

两处**文本查找**被换成 AST：`defineSlots` 覆盖（`source.includes("defineSlots")` 会被注释
满足 —— 本仓库每个组件都带一段解释为什么要写它的注释，注释里必然出现这个单词）与探针
import 覆盖（`// import { X } from "…"` 同样匹配 `from "…"`）。判据本体落在
`scripts/source-scan.mts` 的 `calledSetupMacros` / `probeImportSpecifiers`，门禁与自测读
**同一处**实现 —— 原先两层各写一份正则，改一处两层一起漂移。

## 验收

- `dist/{index,components}.d.ts` 的 `typeof __VLS_[0-9]` 归零（51 → 0）。
- 七个出口在 `skipLibCheck: false` 下零错误；合法 prop / `$slots` 有推导，
  不存在的成员与写错的类型各有 `@ts-expect-error` 钉住（`TS2578` 同样判红）。
- **七个出口全部有** forgotten-export 身份集合基线，且 `index` / `components` 上新增
  真实欠账会被 `generate:api` 拒绝（洗基线路径关闭）。
- 门禁**双向**验证过：注入悬空引用 → `TS2304` 转红；把 `MapProps` 放宽成索引签名 →
  `TS2578` 转红；六条评审发现的惰性 / 可绕过断言逐条注入缺陷确认会转红。
- `pnpm test:unit` 213 文件 / 3916 用例全绿；`check:api`、`check:dts-strict`、
  `verify:package`（真实 tarball 全链路）均通过。