# ADR 2026-09-10：进程级 SDK 冲突域与迁移期分阶段域划分

- 状态：已接受（Accepted）
- 日期：2026-09-10
- 计划键：`M3A1-PROVIDERS`（issue #17，追踪 #12）
- 取代：无
- 相关：`packages/baidu-map-gl-vue/src/core/loader/SdkRegistry.ts`、`packages/baidu-map-gl-vue/src/core/loader/providers/**`

## 背景

`BMap`（JSAPI 4.0）与 `BMapGL`（迁移期 webgl-v1）都是**进程级全局对象**：同一个 realm 里只能存在一份配置，AK / 版本 / 入口 URL 一旦加载就无法并存。

在 #17 之前，registry 是按「namespace」各自持有一份缓存 + 一个 loader：

- 同一个全局对象被多个 namespace 共享，但冲突判定只在 namespace 内部生效，跨 Provider 的不同配置不会互相报冲突；
- registry 自己读 `window`、并持有具体加载实现，因此它既是缓存层又是加载层，难以单测、也把 DOM 依赖带进了本来与 DOM 无关的逻辑。

#16 已经把底层加载能力（显式 `load` / `jsonp`、共享 `<script>`、可取消、可重试）收敛进 `ScriptLoader` / `SharedLoadTask`，registry 有条件只负责「复用与冲突」。

## 决策

1. **冲突管理的单位是「冲突域（domain）」，不是 Provider 实例缓存。** 同一域内：同 fingerprint 的并发 / 后续调用复用同一任务；域内已就绪配置与请求配置不一致时进入冲突策略。
2. **冲突域的「占用」同时覆盖已就绪与正在加载的配置。** 请求启动 loader 之前就同步登记占用，因此**首次并发**请求两个不同配置（例如页面尚未加载 SDK 时两个 Provider 各用不同 AK）也会被拒绝，而不是各自插入一个 script。占用在任务成功（转为「已就绪」）、失败，或**最后一个消费者取消（同步释放）**时更新。
3. **同一 fingerprint 只启动一次底层任务，但每个消费者独立订阅。** `signal` 与消费者一一对应：取消某个消费者不影响其它消费者；底层任务由**聚合信号**驱动，只有最后一个消费者离开时才取消。这是多地图实例并发初始化、其中一个实例提前卸载的场景能正确工作的前提。
4. **最后一个消费者取消时同步释放条目与占用**，不等底层 Promise 异步收尾：否则「abort 之后同一同步回合内重试」会命中已取消的 entry，或被尚未释放的占用挡住。旧任务的异步收尾通过「是否仍是该指纹当前任务」的所有权检查决定能否写入域状态，避免清掉新任务的结果或占用。
5. **registry 只做两件事**：任务复用 + 冲突判定。加载实现由请求级 `loader` 提供（`SdkRegistry.load({ fingerprint, loader })`），registry 不再持有 loader、不读 `window` / `document`，因此 SSR 导入安全、可脱离 DOM 单测。
6. **默认冲突策略为 `throw`**（`BMAP_SDK_CONFIG_CONFLICT`）。`warn` / `ignore` 只能通过显式配置开启（`getProcessSdkRegistry(domain, { conflictPolicy })`），不能成为默认——全局 SDK 无法真正并存，静默忽略会把「加载了两份配置」变成运行时不可解释的行为。

> **注（2026-09-22 起，`#104` 第三批；取代上面第 6 条的后半句）**
>
> `conflictPolicy` 与配套的 `onConflict` 观测出口已**删除**，冲突处置收成单一行为：
> 恒 reject `BMAP_SDK_CONFIG_CONFLICT`。依据是审计（`#104`，见
> [存量审计表](../zh-CN/contributing/architecture-ownership-audit.md) 第 3 节）：三个 Provider
> （官方 / 自研 script / 复用既有全局）**一律不传**这两个选项，仓库内只有 `SdkRegistry` 自己的
> 单测可达 `warn` / `ignore` ⇒ 它是「零消费者的公共开关」，而它会随 `./core` 一起被冻结进
> 3.0 的公共声明面。#104 的实施步骤 6（「#44 冻结前完成 API / public-dts 复核，确保内部恢复
> 机制不被误冻结成公共 API」）要求先把这类面收掉，再由 #44 冻结。
>
> 第 6 条的**前半句**（默认 `throw`、不允许静默忽略成为隐式行为）仍然成立，且现在是唯一行为。
> 参考实现 `huiyan-fe/react-bmap` 的 `onLoadConflict` 走的是「报告 + 复用已加载那份」，
> 与本库的 `warn` / `ignore` 不是同一语义，因此不能拿它当保留这两个取值的理由。
> 与第 1 条里「进入冲突策略」的措辞差异也以此注为准（决策本身不变，只是没有第二、三种策略）。
7. **失败与取消后条目与占用一并释放**，允许重试；成功条目复用其结果。
8. **「就绪」的判定是必经的成功前校验（`assertReady`），不是取值兜底。** Provider 通过 Loader 的 `assertReady` 承担命名空间完整性（与自托管入口的版本来源）校验，校验失败走底层失败路径：不写成功缓存、移除 script。
   - 刻意**不**复用 `exportGetter` 当校验点：它只在「回调没带实参」时执行，回调带实参时会整段跳过，留下绕过路径。
   - 失败残留的登记发生在**加载尝试层**（`loadJsapiV4Script`）并**按对象身份归属**：只有「进入本次尝试前不存在、退出时已存在」的全局才可能由这次加载产生。这样覆盖**超时、取消、校验失败**全部退出路径（未到就绪回调的失败同样会留下残缺全局），又不会误伤宿主预先提供的全局；只登记，从不删除或改写任何对象。宿主预先提供的残缺全局仍然明确失败。
   - 该登记的存储放在 **realm 共享的 `globalThis[Symbol.for(...)]`** 上，与 `SdkRegistry` 同一模式：它描述的是**进程级**全局命名空间，同页可能存在多份独立打包的库副本；若把标记放在模块作用域，副本 A 的残留对副本 B 不可见，B 会把残缺全局当成宿主全局拒绝，一次失败后再也无法重试。共享范围必须与所描述的对象一致。
   - 成功缓存的作废是**条件式**的：只有「成功已提交、但命名空间不可用」这一条路径才调用 `ScriptLoader.invalidateCompleted(key)`（只删 `completed`）。普通失败 / 取消不动 Loader 的登记——它自己按任务身份收尾（`onFailure` / `onCancelled`），越权 `clear(key)` 会删掉新任务或其它消费者的 `inFlight`，使去重失效、重复插入 script。
9. **所有 JSAPI 4.0 Provider 共享同一个进程级 `BMap` 域。** 迁移期 legacy Provider 使用独立的 `BMapGL` 域，因为两者对应两个不同的全局对象；M3A.3（#26）删除 legacy 实现后，`BMapGL` 域随之消失。
10. **v4 Provider 返回结构化 `LoadedJsapiV4`**（engine / version / namespace / load metadata），不再返回裸 `unknown`；复用的结果形状由此统一，跨 Provider 复用同一任务才成立。
11. **指纹只剔除「由 Loader 管理」的回调参数。** JSONP 模式下该参数会被本次回调名覆盖，属实现细节；`load` 模式下 `callback` 只是入口 URL 的普通 query，必须参与身份判定，否则两个租户入口会被错误合并。

> **注（2026-09-13 起，`cancellable` 模型；取代上面第 2 / 4 / 7 条里的「取消 ⇒ 释放」表述）**
>
> 「最后一个消费者取消 ⇒ 同步释放条目与占用」只对**可取消**的底层任务成立。官方
> `@baidumap/jsapi-loader` 没有公开取消接口，因此 `SdkRegistryLoadRequest.cancellable: false`
> 的任务在最后一个消费者离开时**只结算消费者**，保留 entry、占用与在飞任务：同指纹后来者复用原
> 任务，另一份指纹在**启动前**就被冲突拒绝，直到任务真正成功 / 失败。**失败**仍然一律释放条目与
> 占用（第 7 条的后半句不变）。取值、理由与配套取舍见
> [ADR 2026-09-13 默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md) 决策 5。
12. **AK 脱敏覆盖 URL 参数路径**：入口 URL 自带的 `ak` 以 URL 参数为准脱敏（而不是只替换 `options.ak` 这个已知串），`akRef` 反映真正生效的那个 AK。
13. **`./core` 子路径的 Loader 契约在 3.0.0-beta 内直接变更，不保留兼容层**：`SdkLoader` 由 `(options, signal)` 变为请求级 `(signal)`、`SdkRegistry` 构造签名改为 options 对象、`getProcessSdkRegistry(domain, options)` 取代 `(namespace, loader, fingerprintFn)`、移除 `SdkRegistry.global` getter 与未被读取的 entry 字段。
14. **engine 标识的可见范围沿用既有分层**：`./advanced` 已导出 `BMapEngine` / `BMapClient`，因此 `./core` 的 Loader 边界可以导出 `JsapiV4Engine`；**根入口 `src/index.ts` 仍然不导出任何 engine 枚举**，与 ADR 2026-09-10-jsapi-v4-only-baseline 的「面向使用者的公共 API 不得泄漏 engine 枚举」一致。

## 已知限制（显式接受）

- **legacy 与 v4 之间不跨域报冲突**：legacy `readGlobalSdk()` 优先读 `BMap`，会与 v4 Provider 落在同一个物理全局上，但分属两个域，因此过渡期「同一页面同时用 legacy Provider 和 v4 Provider」不会被判定为冲突。默认切换（#25）之后不存在该组合，故不在迁移期兑现。
- **复用已存在的全局无法反查其真实配置**：`globalThis.BMap` 不自述 AK 与版本，`ExistingGlobalV4Provider` / 复用分支只能按本次请求的指纹登记，因此这条路径不产生配置冲突（它仍然校验结构与版本来源）。
- **「本次加载残留」的登记按对象身份、realm 级共享（`globalThis` + `Symbol.for`）**：`WeakSet` 只记录本库加载失败时见过的全局对象，因此能挡住「一次失败后永久无法重试」，但若宿主在同一对象上后续补齐命名空间，本库会先按残留处理（多插入一次 script）而不是直接复用。选择这一侧是因为重复插入可恢复，误判「已就绪」不可恢复。
- **不清理宿主的全局对象**：任何情况下本库都不会删除或改写 `globalThis.BMap`（只校验、只登记身份）。

## 后果

- 正面：全局配置冲突有唯一、可解释的判定点（含首次并发）；消费者取消语义与 `SharedLoadTask` 一致；registry 无 DOM 依赖、可单测；Provider 返回结构化结果，下游不再靠猜 engine；校验失败可真正重试；AK 与 apiUrl 内嵌的 `ak` 都以脱敏形式出现。
- 负面 / 成本：registry 承担消费者登记与聚合取消，比「缓存一个 Promise」复杂；进程级单例状态要求测试显式注入独立域（`new SdkRegistry({ domain })`）或重置；指纹参与冲突判定，任何影响全局语义的新配置都必须同时进入 fingerprint。
- 回滚：恢复「按 namespace 各持一份 registry + registry 内读 `window`、缓存 Promise」的旧实现即可回滚本决策，回滚不触及 raw SDK 边界与 Capability Catalog。保留旧实现为短期回滚提交。

## 非目标

- 不在本决策中实现 v4 Driver / Facet（M3A.2）与默认 Client 切换（#18）。
- 不承诺一个页面同时加载多个不同 AK / 版本的 `BMap` 全局。
- 不为 `./core` 子路径提供 beta 期兼容层。

## 参考

- issue #17 `[M3A.1] 实现进程级 SDK Registry 与 JSAPI 4.0 Providers`
- issue #16 `[M3A.1] 重构 ScriptLoader：显式 load/jsonp、SharedLoadTask 与 v4 URL`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- ADR [2026-09-10 BMap / raw SDK / 公共声明边界与 Capability Catalog](./2026-09-10-bmap-raw-sdk-boundary.md)
