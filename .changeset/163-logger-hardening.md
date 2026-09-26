---
"bmap-vue": patch
---

Logger 安全与轻量化（#163）：上下文脱敏、故障隔离、无效全局状态清理——**无公开 API 变更**

修的是一处**已确认的处理缺口**（不是已确认的 AK 泄漏）：`logger` 原先只对 `message` 调
`redactAk`，第二个 console 参数 `context` **原样输出**——`context.error`、URL、options
都可能绕过清洗。本票把它收成「message 与 context 两侧都过输出投影」。

## 实际清洗了什么

`context` 投影成**有限普通数据**（新对象；不修改入参、不把原始引用交给 console）：

| 类别 | 处理 |
| --- | --- |
| 凭据类**键名**（记号判定：`ak` / `auth` / `apiKey` / `token` / `secret` / `password` / `sign` / `credential(s)`） | 整体输出 `[redacted]`，**键名保留**（「哪个字段被清掉」本身是定位信息） |
| **所有** context 字符串值（**无论键名**） | 无条件过 `logSafeText`：`ak=` 参数与 userinfo 一律打码。这条是**主防线**——`detail` / `note` / `serviceHost` 这类不带凭据字样的键，装的完全可能就是整条带 AK 的入口 URL |
| `Error` / `BMapError` | 只取 `name` / `message` / `code` 与 `mapId`（含 `symbol`）/ `component` / `plugin` / `capability` / `engine` / `version`；**每个字符串都过脱敏**（含 `name` 与 `code`） |
| 数组 | 只留 `[N items]`，**不逐项**（不为日志深遍历） |
| 其它未知对象 | 只留 `[object]`，**不展开**（不调用 `toJSON()`，不递归深拷贝） |
| 有限普通值（`number` / `boolean` / `kind` / `code` / `component` / `error` / `field` …） | 原样保留；文本统一截断到 300 字符（`message` 与 context 共用同一上限） |

**为什么没有「URL / 加载配置键名」拒识清单**：逐个核过全库 `logger.*` 调用点，**没有一个**传
`url` / `options` / `params` / `serviceHost` / `src`——凭空列 9 个键就是 AGENTS.md 点名的
「没有消费者…一律删除」。凭据防护交给上表第二行那道**与键名无关**的形状脱敏，它真的作用在
**值**上：靠猜键名防凭据本就是错方向（既猜不全，又会误伤 `params` / `query` 这类正常诊断键）。

**userinfo 遮盖「整段」而非只遮 password 位**：`https://<token>:x@host` 与 `https://<token>@host`
都是常见形状，只遮 `user:***@` 盖不住前者、后者因缺冒号压根不匹配。

**userinfo 只在 authority 内匹配**：authority 在 `/` **以及 `?` / `#`** 处结束。少了这两个
终止符，`https://api.example.com?email=user@example.org` 会被**从 host 一路吞到 `@`**，
整条 URL 变成 `https://***@example.org`（host 一起丢掉）；同样的 URL 出现在 `Error.stack`
里还会被判成「含凭据」，把**整个 stack** 省略掉。`core/loader/url.ts` 的 `maskUserinfo`
（4 个生产消费者：`SharedLoadTask` / `loaded` / `official` ×2）有同一个边界问题，**一并修复**
——本票不另立一套口径，也不在已知有缺口的地方宣称「同口径」。

**凭据键名按「先分隔符、再驼峰边界」切分**，且驼峰边界吞掉连续大写：`API_KEY` / `TOKEN` /
`PASSWORD` / `CREDENTIALS` 这类全大写字段必须整段保留（否则被逐字母拆散而匹配不上），
同时 `xApiKey` 仍切成 `x` / `ApiKey`、`make` / `break` / `design` / `itemKey` 等普通词不被误伤。

## 刻意丢弃了什么

- **`cause`**：默认装上游 / 业务原始对象（可能含用户数据、加载 options、整条轨迹）。
  调用方要带 cause 的信息，在**自己的边界**上投影成文本再传进来。
- **带凭据形状的 `stack`**：文本里出现 `ak=<AK 量级的值>` 或 `https://<userinfo>@` 时，
  整个 `stack` 换成 `[omitted: 形状含凭据]`（截断仍可能留下半截 AK）。**不带**这两种
  形状的 stack 正常保留并脱敏——否则会把绝大多数释放失败的定位信息删光。
- **不写通用深拷贝 / 递归脱敏器**：判据是 Ownership-first——`projectValue` 没有任何分支
  会返回入参本身，「原样透传」这条路根本不存在，因此不需要递归兜底。

## 两处正则的判据（**不是**「能识别任意位置的未知密钥」）

- 形状脱敏只认 `ak=` 这**一种**键名后面、且长度像 AK 的值。真实凭据若换键名或被拆开，
  这里盖不住。
- 精确脱敏仍由 `redactAk(input, ak)` 这条**纯函数**路径负责——loader 三处
  （`official.ts` / `loaded.ts` / `SharedLoadTask`）与 `ui-kit/routePlan.ts` 本来就持有
  具体 AK 值，它们的既有口径与阈值**一字未改**。

## 全局 setter 的消费者结论

`setAkForLogger` / 模块级 `akProvider` **已删除**。全仓检索（含 `packages/` / `tests/` /
`scripts/` / `docs/` / `etc/` 基线）只命中它自己的定义与 `core/index.ts` 的转导出，
**零生产消费者**；`core/index.ts` 这个 barrel 自 #44 取消 `./core` 后**不被任何出口引用**，
因此删这条转导出**不改任何公共面**（`pnpm check:api` 三类基线无漂移、`check:public-dts`
通过可证）。

不补调用点来让死抽象继续存在，也不为假想的多 Client 用途建注册表：它的语义是「进程级记住
最后一个 AK」，而多个 Client / 多个并发加载任务各持不同 AK 时，这个「最后一次写入」给不
出正确答案。需要精确脱敏的边界本就知道自己的 AK，直接传 `redactAk(input, ak)`。

## 输出路径简化

`logger.warn/error/debug` 原先**每条**都 `makeLogger()` 重建 emit 闭包与方法对象；现改为三个
方法直接调同一个 `emit`。`[bmap-vue]` 前缀、`warn`/`error`/`debug` 通道分流、`devWarn` 的
生产静音、`isDev()` 的 `typeof process` 保护与可折叠标记、IIFE 档构建语义**全部不变**
（静音路径仍在投影 / 格式化**之前**返回，不处理 `context`）。

## 故障隔离

`emit` 的**整个函数体**在 `try` 内——读 `context` 属性、投影、console 输出三段都可能抛
（调用方传带抛错 getter 的 context、宿主 console 被 patch、投影逻辑自身的疏漏）。任何一段
抛出来都**不得**顺着业务路径逸出，也**不**用 logger 报告 logger 自身的失败（那会无限递归）。
调用点多在 `catch` 块里（释放失败、SDK 调用失败），日志异常会**覆盖**原始业务错误——丢一条
日志远好过吞掉一次故障。

`ResourceScope` 随之**删掉**告警外层那圈 `try/catch`：隔离边界已内聚在 logger 内，继续在
调用点重复同一防护只会让「谁负责吞日志异常」有两个答案。释放顺序、单个 disposer 抛错不
连坐、幂等三条契约不变（各有回归用例钉住，其中一条**真的打 `console.warn` 抛错**验证
dispose 不被日志异常中断）。

## 现状边界（不夸大）

本票**没有**核实出真实生产调用能复现完整 AK 泄漏——修的是「context 未过清洗」这个处理缺口。
`BMapError` 的公共契约、`Client`/`Driver` 结构、`ResourceScope` 生命周期协议均未改动。
