/**
 * 日志与 AK 脱敏
 *
 * 日志中不得输出完整 AK。最多输出 hash、后四位或 provider ID。
 *
 * #163 之后这里有**两层**防护，职责不同，不要合并：
 *
 * 1. `redactAk` —— **纯函数**，供 loader / ui-kit 等**已知具体 AK 值**的调用边界使用
 *    （`redactAk(input, ak)`）。它的公开契约被 loader 三处与既有单测钉住，本票不动。
 * 2. 通用输出路径（本文件其余部分）—— 把 `message` 与 `context` **投影成有限普通数据**。
 *    它不认识「本次操作的 AK 是多少」，因此走**形状**脱敏：`ak=` 参数、userinfo，以及
 *    凭据类**键名**。这是**全部** context 字符串无条件过的，不是按键名挑着过。
 *
 * 为什么没有任何「本次操作已知 AK」的通道：#163 逐个核过全库 `logger.*` 调用点，
 * **没有一个**传 `ak`（`setAkForLogger` 同样零消费者，一并删除）。留一条没人走的通道
 * 就是 AGENTS.md 点名的「没有消费者…一律删除」。需要**精确**脱敏的边界（loader 三处、
 * `ui-kit/routePlan`）本就知道自己的 AK 值，直接调 `redactAk(input, ak)`。
 */

/** 将字符串中的疑似 AK 脱敏为后四位 */
export function redactAk(input: string, ak?: string | null): string {
  if (!input) return input;
  if (!ak) {
    // 没有已知 ak 时,尝试匹配形如 ak=<36位或长串> 的模式
    return input.replace(/ak=([A-Za-z0-9]{6,})/gi, (_m, v: string) => `ak=***${v.slice(-4)}`);
  }
  // 用已知 ak 替换
  return input.split(ak).join(`***${ak.slice(-4)}`);
}

/**
 * 「这个 stack 值不值得整体省略」的判据：只看**确定会带凭据**的形状（#163）。
 *
 * 真实百度 AK 是 32 位字母数字，所以这里要求「`ak=` 后面至少 16 位」——比 `redactAk` 的
 * 判据（6 位）保守，是为了不把 `ak=1800` 之类的普通值也判成凭据、进而误删正常的 stack。
 *
 * ⚠️ **不要**把这个正则读成「能识别任意位置的未知密钥」——它只认 `ak=` 这**一种**键名
 * 后面、且长度像 AK 的值。真实凭据若换了键名或被拆开，这里判不出来；那种防护属于调用
 * 边界**已知具体值**时的 `redactAk(input, ak)` 路径，不是这里的职责。
 *
 * （`redactAk` 自己的 6 位阈值刻意**不动**：loader 侧 `loaded.ts` / `official.ts` /
 * `SharedLoadTask` 都依赖它，那是出口 URL 与官方错误的既有脱敏口径，不在本票范围内。）
 */
const AK_PARAM_PATTERN = /ak=[A-Za-z0-9]{16,}/i;

/**
 * URL userinfo 的**遮盖**形状（`https://<userinfo>@host`）——与 AK 同类的凭据。
 *
 * ⚠️ 必须要求 `//` 前缀。曾经写成 `(\w+):([^@/]*)@` 这样的裸形状，结果把消息里的普通文本
 * 也当成凭据盖掉了——例如 `LayerDriver:…@baidumap/jsapi-v4-types@4.0.4` 变成
 * `LayerDriver:***@baidumap/…`，诊断信息（包名、版本）被日志自己毁掉。userinfo 的定义
 * 就是「`//` 之后的 authority 段里、`@` 之前的整段」，带上 `//` 才是它的形状。
 *
 * ⚠️ 遮盖**整段**而不是只遮 password 位（#163 复审 P1）。凭据放在 username 位是常见形状
 * ——`https://<token>:x@host` 与 `https://<token>@host` 都会把完整 token 带出去，只遮
 * `user:***@` 盖不住前者、后者因缺冒号压根不匹配。
 *
 * ⚠️ authority 在 `/` **以及 `?` / `#`** 处结束（#163 复审 P2）。只把 `/` 当终止符时，
 * `https://api.example.com?email=user@example.org` 会被**从 host 一直吞到 `@`**——变成
 * `https://***@example.org`，把正常的 query 判成凭据；同样的 URL 出现在 `Error.stack`
 * 里还会被 `isSensitiveText` 判成「含凭据」而把**整个 stack** 省略掉。
 */
const USERINFO_MASK_PATTERN = /(https?:\/\/)[^/@?#\s]+@/g;

/** userinfo 的**探测**形状（判定用，不带 `g` 以免 `test()` 的 `lastIndex` 有状态）。 */
const USERINFO_PATTERN = /https?:\/\/[^/@?#\s]+@/;

/**
 * 单条字符串的输出上限：日志是给人定位问题的，不是倾倒现场。
 *
 * `message` 与 `context` 的字符串值**共用**这一个上限（#163 评审：两个阈值没有依据，
 * 且两处 `length > N ? slice : x` 是同一个形状）。定 300 而不是 200/120 的理由：一条
 * 脱敏后的入口 URL（含 `ak=***1234`）约 60–80 字符、一条 stack 前两行约 200——300 足够
 * 放行常见的定位信息，同时仍把「整条轨迹倾倒进 console」挡住。
 */
const MAX_TEXT = 300;

/** 未知对象在日志里的占位：只说明「有个对象」，不展开它的字段。 */
const OMITTED_OBJECT = "[object]";

/** 带凭据的 stack 的占位：说清「这里本该有 stack」以及它为什么没了。 */
const OMITTED_STACK = "[omitted: 形状含凭据]";

/** 脱敏 + 截断：所有**进入**日志的文本都走这一个出口。 */
function logSafeText(input: string): string {
  const masked = redactAk(input).replace(USERINFO_MASK_PATTERN, `$1***@`);
  return masked.length > MAX_TEXT ? `${masked.slice(0, MAX_TEXT)}…` : masked;
}

/**
 * 「这条文本确定带凭据吗」——决定要不要**丢整个 stack**。
 *
 * 判定刻意保守：只对两种确定会带凭据的形状降级——
 *   1. 文本里出现了 `ak=` 且后面是 AK 量级的值（入口 URL / 上游错误最常见的泄漏形态）；
 *   2. 文本里出现了 userinfo（`https://user:pass@host`）。
 * 其余一律按正常 stack 处理（含**不含** AK 的那些）。
 *
 * 「无法安全投影时省略/占位」是票面要求，但**默认不降级正常 stack** —— 那会把绝大多数
 * 释放失败的定位信息删光，反而违背「保留必要错误码与组件定位信息」。
 */
function isSensitiveText(text: string): boolean {
  return AK_PARAM_PATTERN.test(text) || USERINFO_PATTERN.test(text);
}

/** 从 `BMapError` / `Error` 身上只取定位必需的字段；`cause` / stack 默认不输出。 */
function projectError(error: Error): Record<string, unknown> {
  // ⚠️ `name` 也要过 `logSafeText`（#163 复审 P1）。`name` 看着是「一个类名」，但自定义 /
  // SDK 的 Error 完全可能把凭据塞进去；同一个函数里 `message` 清洗而 `name` 不清洗，
  // 恰好是最容易被漏掉、也最容易被自查误认为「已经清过了」的那种不一致。
  const projected: Record<string, unknown> = {
    name: logSafeText(error.name),
    message: logSafeText(error.message),
  };
  // `BMapError` 在 `Error` 之上挂的定位字段。逐个具名读，**不用**索引签名去遍历未知属性
  // （`cause` 就在那儿，`for...in` 会把它连同用户数据一起带出来）。
  const located = error as {
    code?: unknown;
    mapId?: unknown;
    component?: unknown;
    plugin?: unknown;
    capability?: unknown;
    engine?: unknown;
    version?: unknown;
  };
  // `code` 是**定位信息的主要来源**（BMapError 的稳定契约），必须留下。
  if (typeof located.code === "string") projected.code = logSafeText(located.code);
  for (const key of ["component", "plugin", "capability", "engine", "version"] as const) {
    const value = located[key];
    if (typeof value === "string" && value) projected[key] = logSafeText(value);
  }
  // `BMapErrorOptions.mapId` 是 `symbol | string`（#163 复审 P2）：只留 `string` 分支会让
  // symbol mapId 在投影后**整个消失**，而它正是「哪张图」的定位信息——按票面「保留必要
  // 定位信息」不该丢。symbol 一律走 `String(sym)`（读 `description` 即可，不触发别的副作用）。
  if (typeof located.mapId === "string" && located.mapId) {
    projected.mapId = logSafeText(located.mapId);
  } else if (typeof located.mapId === "symbol") {
    projected.mapId = logSafeText(located.mapId.toString());
  }
  // stack **有条件**保留：只在确认不带凭据时给，且过一遍脱敏 + 截断。
  // 带凭据的 stack 整体省略——日志是要发出去的文本，截断仍可能留下半截 AK。
  if (error.stack) {
    projected.stack = isSensitiveText(error.stack) ? OMITTED_STACK : logSafeText(error.stack);
  }
  // `cause` 刻意不投影：它默认装上游 / 业务原始对象（可能含用户数据、加载 options、
  // 整条轨迹）。调用方若要带 cause 的信息，在**自己的边界**上投影成文本再传进来。
  return projected;
}

/**
 * AK / 凭据类字段名：值**整体**不输出。
 *
 * 字段名按**记号**切分（`_` / `-` / `.` / 驼峰）后整段比对，**不是**子串匹配。
 * 子串匹配会误伤一票普通词——`/ak/i` 命中 `make` / `break` / `brake`，`/sign/i` 命中
 * `design` / `assign` / `signature`。误伤的后果比漏网更隐蔽：诊断字段被静默打成
 * `[redacted]`，而没人会去怀疑一条日志的清洗规则。
 *
 * 覆盖的记号：`ak` / `auth` / `authKey` / `apiKey` / `token` / `secret` / `password` /
 * `passwd` / `sign` / `credential(s)`。
 *
 * ⚠️ 只收**复合**词（`apikey`）不收裸 `key`：驼峰切分把 `xApiKey` 拆成 `x` / `Api` /
 * `Key`，而 `key` 单独出现得太频繁（`itemKey` 是本库的数据契约字段名），收它会误伤一大片
 * 正常诊断信息。复合词靠**相邻两段拼接**来认（见 `isAkFieldName` 的注释）——也因此
 * `AK` 这种全大写键名能被正确识别（切分成 `A` / `K`）。凭据字段名的其余不确定性应当由
 * **调用边界**投影解决，不在这里无限扩张。
 */
const CREDENTIAL_TOKENS = new Set([
  "ak",
  "apikey",
  "auth",
  "authkey",
  "credential",
  "credentials",
  "passwd",
  "password",
  "secret",
  "sign",
  "signature",
  "token",
]);

/**
 * 字段名 → 记号序列。
 *
 * ⚠️ **不能**用 `split(/[_\-.\s]+|(?=[A-Z])/)`（#163 复审 P1）：`(?=[A-Z])` 这个前瞻会把
 * **全大写词逐字母拆开**——`API_KEY` → `A`/`P`/`I`/`K`/`E`/`Y`、`TOKEN` → `T`/`O`/`K`/`E`/`N`、
 * `PASSWORD` → 8 个单字母。常见凭据字段于是全部匹配不上，裸 AK（不带 `ak=` 前缀，
 * `logSafeText` 也不命中）就原样进了 console。
 *
 * 正确顺序是「**先按分隔符切，再做驼峰边界**」，且驼峰边界必须**吞掉连续大写**：
 * ① `API_KEY` / `api.key` / `api-key` ⇒ 整段（不拆）；
 * ② `xApiKey` ⇒ `x` / `ApiKey`（`Api` 与 `Key` 同属驼峰簇，不能拆）；
 * ③ 全小写 `apikey` ⇒ 整段。
 */
function keyTokens(key: string): string[] {
  return key
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .flatMap((segment) => segment.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[A-Z]+|./g) ?? []);
}

function isAkFieldName(key: string): boolean {
  const tokens = keyTokens(key);
  for (let i = 0; i < tokens.length; i += 1) {
    if (CREDENTIAL_TOKENS.has(tokens[i].toLowerCase())) return true;
    // 相邻两段拼起来也要认：`xApiKey` 切成 `x` / `ApiKey`，凭据词 `apikey` 只在拼起来时命中。
    if (i + 1 < tokens.length && CREDENTIAL_TOKENS.has(`${tokens[i]}${tokens[i + 1]}`.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 单个 context 值的投影。
 *
 * 刻意**不**写通用深拷贝 / 递归脱敏器（#163 目标 1.5）：
 *   - 未知嵌套对象 ⇒ `OMITTED_OBJECT`，不展开（展开了就得遍历，而遍历大数组 / 带 getter
 *     的对象既慢又可能触发调用方副作用）；
 *   - 数组 ⇒ 只留 `长度`，不逐项；
 *   - 不调用 `toJSON()`（那是**数据序列化**的钩子，日志主动调它等于替调用方做决定，
 *     而且它的返回值会绕过这里所有脱敏）。
 *
 * 注意这里**没有**「凭据类字段名」分支——`projectContext` 在读值**之前**就按键名拒识了，
 * 因此 `projectValue` 拿到的永远是「非凭据键的值」。
 */
function projectValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // ⚠️ 字符串**必须**过 `logSafeText`，不能只截断（#163 评审抓到的漏网）：
    // `detail` / `note` / `href` 这类键名不带凭据字样，但值完全可能就是一整条带 `ak=` 的
    // 入口 URL。`emit` 只对 `message` 调 `redactAk`，context 的字符串曾只被截断就原样
    // 输出——而一条典型入口 URL 只有 77 字符，截断根本不会触发，AK 原样泄漏。
    return logSafeText(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return `[${value.length} items]`;
  // Error 在 Object 判定**之前**：它也是对象，但有可投影的定位字段。
  if (value instanceof Error) return projectError(value);
  return OMITTED_OBJECT;
}

/**
 * context 投影成**新对象**（不修改入参、不把原始引用交给 console）。
 *
 * 投影失败时返回 `undefined` —— 宁可这次没有 context 参数，**也不能退回原样输出**。
 *
 * ⚠️ 这里**没有**「URL / 加载配置键名」拒识清单（`url` / `options` / `params` …）：#163 评审
 * 逐个核过，全库 `logger.*` 调用点**没有一个**传这些键，凭空列出就是 AGENTS.md 点名的
 * 「没有消费者…一律删除，不留以后可能有用的扩展面」。凭据防护由两道**与键名无关**的机制
 * 承担，且两道都真的作用在**值**上：① 凭据类**键名**（`isAkFieldName`，有调用点会命中）；
 * ② **所有** context 字符串无条件过 `logSafeText`——`ak=` 参数与 userinfo 无论装在
 * `detail` 还是 `url` 里都盖得住。靠猜键名来防凭据本来就是错的方向（猜不全且误伤：
 * `params` / `query` 本就是常见的正常诊断键）。
 */
function projectContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    // 先判键名再读值：凭据类键**连值都不碰**（它的 getter 可能有副作用，且本来就不输出）。
    if (isAkFieldName(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = projectValue(context[key]);
  }
  return out;
}

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

type LoggerLevel = "debug" | "warn" | "error";

/**
 * 唯一输出路径。
 *
 * #163 目标 2：原先 `logger.warn/error/debug` **每条**都 `makeLogger()` 重建 emit 闭包与方法
 * 对象；这里改成三个方法直接调同一个 `emit`，`logger` 的方法身份在多次调用之间稳定。
 */
function emit(level: LoggerLevel, message: string, context?: Record<string, unknown>): void {
  // 整个函数体在 `try` 内：读 `context` 的属性、`projectContext` 投影、以及 console 输出
  // 三段都可能抛（调用方传带抛错 getter 的 context、宿主 console 被 patch、投影逻辑自身
  // 的疏漏）。任何一段抛出来都**不得**顺着业务路径逸出。
  try {
    const line = `[bmap-vue] ${logSafeText(message)}`;
    const projected = projectContext(context);
    if (level === "error") console.error(line, projected ?? "");
    else if (level === "warn") console.warn(line, projected ?? "");
    else console.debug(line, projected ?? "");
  } catch {
    /**
     * 日志是**旁路**：投影失败或 console 不可用时，静默丢弃这一次输出。
     *
     * ⚠️ 这里**不能**用 logger 报告 logger 自身的失败——那会无限递归；也不能把异常抛回
     * 业务路径：调用点多在 catch 块里（释放失败、SDK 调用失败），日志异常会**覆盖**原始的
     * 业务错误，让真正的原因不可见。丢一条日志永远好过吞掉一次故障。
     */
  }
}

export const logger: Logger = {
  warn: (m, c) => emit("warn", m, c),
  error: (m, c) => emit("error", m, c),
  debug: (m, c) => emit("debug", m, c),
};

/**
 * 是否「非生产」环境。
 *
 * **判定必须留在消费方的构建 / 运行阶段，不能在库的发布构建里定死**（#27 评审第二轮 P2）：
 * 库发布的就是 `dist/*.mjs` / `dist/*.global.js`，如果在 publish build 阶段把开发标记替换成
 * `false`，npm 消费方即使在自己的 dev server 里 import 这个包，拿到的也是已经 DCE 掉的产物，
 * 告警永远不会出现。因此这里保留 `process.env.NODE_ENV` 这个**可被折叠的标记**：
 *
 * - 打包器会把它折叠成字面量（本仓实测：Vite app 构建与 dev server 都折叠，直接写法与
 *   `globalThis.process?.env?.NODE_ENV` 写法都会——dev 得到 `"development"`、build 得到 `"production"`）；
 * - Node / SSR 下它是真实的环境变量；
 * - IIFE 档（`<script>` 直引）没有 `process`，由该档构建配置自己 `define` 成 `"production"`
 *   （见 `vite.config.global.ts`）——发布产物里不允许留下裸 `process`。
 *
 * 本地声明而不是依赖 `@types/node`：`NodeJS.Process` 属于环境类型，本包源码不得要求编译它的
 * program 具备该环境（仓库门禁用 `types: []` 模拟「不带环境声明的消费方」）。
 */
declare const process: { env?: Record<string, string | undefined> };

/**
 * 开发期告警：只有非生产环境才输出。
 *
 * 与 `logger.warn` 的分工：`logger.warn` 是**运行时故障**（能力不支持、参数被丢弃、服务失败…），
 * 无论什么环境都该被运维/使用者看到；这里是**面向库使用者的用法提示**（受控 / 非受控模式切换、
 * `default*` 被覆盖…），出现在最终用户的 console 里没有意义。
 */
export function devWarn(message: string, context?: Record<string, unknown>): void {
  if (!isDev()) return;
  logger.warn(message, context);
}

/**
 * 是否「非生产」环境 —— `devWarn` 的**同一个**判定，供调用方决定**要不要为开发期提示付出
 * runtime**（#137 复审十轮 P1）。
 *
 * 存在的理由：`devWarn` 自己在 production 早退，但这只省掉了**输出**。若某个 watcher 的**唯一**
 * 用途就是驱动 `devWarn`，它在 production 仍然会注册并常驻（`useControllableState` 的
 * `defaultValue` 告警 watcher 就是这样：`<Map>` 四个视野字段各一个，共 4 个 `ReactiveEffect`，
 * production 下永远静音）。**只判「会不会打印」不够，还要判「值不值得为它注册监听」。**
 *
 * ⚠️ 必须与 `devWarn` 用**同一份**判定，否则两边会对「现在是不是开发环境」产生分歧（例如
 * `devWarn` 认为不是、watcher 却注册了）。同理**不要**在发布构建里把它定死——见上面
 * `declare const process` 的注释：判定留给消费方折叠，ESM 档保留可折叠标记，IIFE 档由
 * `vite.config.global.ts` define。
 *
 * ⚠️ **`typeof process` 这层保护不能省**（#137 复审十轮 P0）。`process.env?.NODE_ENV` 的
 * optional chaining 只保护 `env`，**不保护裸标识符 `process`**：浏览器里没有 `process` 时，
 * 读 `process.env` 之前就已经抛 `ReferenceError`。`devWarn` 里那个同类写法之所以一直没炸，
 * 是因为它只在**真的告警时**才被调用；而 `isDev()` 是 `useControllableState` **构造期**就调用
 * 的 —— 四个视野字段 ⇒ 每个 `<Map>` 实例化必现崩溃（`smoke-v4-fixture` 抓到）。
 *
 * 写成 `typeof process === "undefined" || …` 之后：
 * - 裸 browser ESM：没有 `process` ⇒ 第一段为真 ⇒ 返回 dev（**不崩**，与告警是否真会出现无关）；
 * - Node / SSR：`process` 存在 ⇒ 读真实环境变量；
 * - 消费方 bundler：`typeof process` 通常被折叠掉，`process.env.NODE_ENV` 仍是可折叠标记；
 * - IIFE 档：仍由 `vite.config.global.ts` define。
 */
export function isDev(): boolean {
  return typeof process === "undefined" || process.env?.NODE_ENV !== "production";
}

/**
 * 「同一个 key 只报一次」的开发期告警。
 *
 * 数据驱动组件里的告警常常出现在**每次 props 变化**的路径上（拾取认不出身份、某个 kind 没有
 * 某个入口…），逐个刷日志会把真正的问题淹掉；而同一条告警只出现一次，又足以让人知道要改什么。
 *
 * 去重键由调用方给（通常是「组件:场景」），因此同一场景下不同原因各自报一条 —— 用一句消息当
 * 键会让「改了文案就重新开始刷」变成静默行为。
 *
 * 与 Driver 侧的 `createWarnOnce`（`driver/jsapi-v4/internal.ts`）是**两份**实现，刻意不合并：
 * core 不能反向依赖 Driver 内部模块，而且两者的输出通道不同——这里是 `devWarn`（生产静音，面向
 * 库使用者的用法提示），Driver 那份是 `logger.warn`（运行时故障，任何环境都要可见）。
 */
export function createDevWarnOnce(): (key: string, message: string) => void {
  const seen = new Set<string>();
  return (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    devWarn(message);
  };
}

