---
"bmap-vue": minor
---

`./core` 冻结前的公共面复核（#104 第三批）：把「零消费者却会随 `./core` 冻结进 3.0」的面收掉，
并把复核结论落成一条会真变红的门禁。

**为什么做这件事**：#104 的实施步骤 6 是「**#44 冻结前完成 API / public-dts 复核，确保内部恢复机制
不被误冻结成公共 API**」。前两批把「恢复上游没有公开的因果身份」的抽象清掉了（见
[第一批 changeset](./architecture-ownership-evidence-first.md) 与
[第二批 changeset](./ownership-audit-view-animation-window.md)），这一批做的是**复核本身**：
逐项核对 `./core` 上还有哪些名字是「没有人用、但会被 #44 顺手冻结」的。逐条结论见
[Ownership-first 存量审计表](../docs/zh-CN/contributing/architecture-ownership-audit.md)。

**破坏性变更**（当前 `1.0.0-rc.0`，beta 阶段按 `minor` 发布；下面这些名字都从 **`./core` 子入口**取，根入口本来就没有它们）

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `useMapResource()` / `SdkResourceAdapter` / `UseMapResourceResult` | 从 `./core` 导出，管理 SDK 资源的 `create` / `connect` / `update` / `destroy`，带 create-token 竞态防护 | **已删除**（含它自己的单测）。零生产消费者，且它自己的继任者 `useSdkResource` 的文件头就写着「替代行为各异的 useMapResource / useOverlayResource / useControlResource / useLayerResource」——留在出口上等于把一个已被取代的旧底座冻结进 3.0 |
| `SdkRegistry` 的 `conflictPolicy: "throw" \| "warn" \| "ignore"` 与 `onConflict` | 域内配置冲突时可选降级成 warn / ignore，并可挂一个观测回调 | **已删除**，冲突处置收成单一行为：恒 reject `BMAP_SDK_CONFIG_CONFLICT`。三个 Provider（官方 / 自研 script / 复用既有全局）**一律不传**这两个选项 ⇒ 仓库内只有 `SdkRegistry` 自己的单测可达 warn / ignore。`SdkConflictPolicy` / `SdkConflictInfo` / `SdkRegistry.policy` getter 一并删除；`SdkRegistryOptions` 现在只有 `domain`。ADR `2026-09-10` 决策 6 的后半句已加取代注记（前半句「默认 throw、不允许静默忽略成为隐式行为」仍然成立，且现在是唯一行为） |
| `resetProcessSdkRegistryForTests` | 从 `./core` 导出 | **已内部化**（不是删除）：仓库内测试一直按相对路径直接 import 源文件，所以出口上那份只是把「for tests」的名字暴露给外部。实现与行为不变 |

**刻意不做**（登记在 #44 与独立票里，不在本批混做）：

- `MapRuntimeOptions.clientFactory`、`MapRuntimeStatus` 的 `"loading"` 别名、单成员别名
  `LoadedSdk`、`client.version`、`optionKey()` 的一行转发、`useServiceTask` 经
  `export * from "./composables"` 外泄、`UseSdkResourceOptions` —— 这些要连带改夹具或改公共命名约定，
  属于 #44 的出口收窄；本批只**登记**（评论留在 #44）。
- 能力目录的 `engines` 维度与 `engine-unsupported` 原因（**#126**，本登记发出时已另行落地：
  删列 + reason 改名 `unlisted-capability`，见 `single-engine-capability-catalog` changeset）、两处无判别力的内部判据
  （`BMap.mountMap` 的防御性前置、`driver-contract` 的 `expectation` 档，**#127**）、探针债务
  F-2 / F-3 / F-4（**#128**）—— 都有独立票，逐条对照见审计表的「剩余欠账与归宿」。
- 不冻结 `./core` 的全量导出面（那是 #44 的交付物）；本批只守「已被判定为 REMOVE / 内部化」的名字。

**顺手的收口**：`stripComments`（「先剥注释再断言标识符不存在」这类文本门禁的第一步）此前在本仓有
**5 份逐字相同的副本**（4 份散在 `tests/behavior/*.test.ts`，第 5 份是本批复核门禁的自审发现）。
已抽到 `packages/test-utils/source-text.ts` 并让 5 个调用点共用 —— 同一件事写 5 份的代价不是体积，
而是「修一处漏洞只改一份」（那份实现里 `]//` 形态的已知限制就是 5 份都没覆盖）。

**同时**：`driver-contract.ts` 里两处「dispose 幂等」的注释（与两条用例标题）不再声称「SDK 侧的移除对
未挂载资源是 no-op」——那两条断言的判据是 `harness.attachedCount()`，即**夹具那一侧的假账本**
（销账不变成负数）。它既不是官方幂等性的证据，也不是生产库记账的证据：审计表 F-3 至今只有一条**反例**
读数（ADR 2026-09-12 记的「真实 4.0 在未加载场景的实例上 `destroy()` 会抛 `TypeError`」），没有正向证据。
