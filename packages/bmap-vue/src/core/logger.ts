/**
 * 日志与 AK 脱敏
 *
 * 日志中不得输出完整 AK。最多输出 hash、后四位或 provider ID。
 *
 * #163 之后这里有**两层**防护，职责不同，不要合并：
 *
 * 1. `redactAk` —— **纯函数**，供 loader / ui-kit 等**已知具体 AK 值**的调用边界使用
 *    （`redactAk(input, ak)`）。它的公开契约被 loader 三处与既有单测钉住，本票不动。
 * 2. 通用输出路径（本文件其余部分）—— 把 `context` **投影成有限普通数据**。它不认识
 *    「本次操作的 AK 是多少」，因此走**形状**脱敏（`ak=` 参数、userinfo、AK 类字段名）。
 *
 * 为什么不再有进程级 AK 集合：多个 Client / 多个并发加载任务各持不同 AK 时，「最后一次
 * 写入的全局 AK」给不出正确答案（#163 已核实 `setAkForLogger` 零生产消费者并删除）。
 * 需要精确脱敏的边界本就知道自己的 AK，直接传 `redactAk(input, ak)`。
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
 * URL userinfo 的**遮盖**形状（`https://user:pass@host`）——与 AK 同类的凭据。
 *
 * ⚠️ 必须要求 `//` 前缀。曾经写成 `(\w+):([^@/]*)@` 这样的裸形状，结果把消息里的普通文本
 * 也当成凭据盖掉了——例如 `LayerDriver:…@baidumap/jsapi-v4-types@4.0.4` 变成
 * `LayerDriver:***@baidumap/…`，诊断信息（包名、版本）被日志自己毁掉。userinfo 的定义
 * 就是「`//` 之后的 authority 段里的 `user:pass@`」，带上 `//` 才是它的形状。
 */
const USERINFO_MASK_PATTERN = /(https?:\/\/)([^/\s:@]+):([^/\s@]*)@/g;

/** userinfo 的**探测**形状（判定用，不带 `g` 以免 `test()` 的 `lastIndex` 有状态）。 */
const USERINFO_PATTERN = /https?:\/\/[^/\s:@]+:[^/\s@]*@/;

/** 单条字符串的输出上限：日志是给人定位问题的，不是倾倒现场。 */
const MAX_TEXT = 200;

/** 未知对象在日志里的占位：只说明「有个对象」，不展开它的字段。 */
const OMITTED = "[object]";

/** 脱敏 + 截断：所有**进入**日志的文本都走这一个出口。 */
function logSafeText(input: string, ak?: string | null): string {
  const masked = redactAk(input, ak).replace(USERINFO_MASK_PATTERN, `$1$2:***@`);
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
function projectError(error: Error, ak: string | null | undefined): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    name: error.name,
    message: logSafeText(error.message, ak),
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
  if (typeof located.code === "string") projected.code = located.code;
  for (const key of ["mapId", "component", "plugin", "capability", "engine", "version"] as const) {
    const value = located[key];
    if (typeof value === "string" && value) projected[key] = logSafeText(value, ak);
  }
  // stack **有条件**保留：只在确认不带凭据时给，且过一遍脱敏 + 截断。
  // 带凭据的 stack 整体省略——日志是要发出去的文本，截断成 200 字符仍可能留下半截 AK。
  if (error.stack) {
    projected.stack = isSensitiveText(error.stack) ? "[omitted]" : logSafeText(error.stack, ak);
  }
  // `cause` 刻意不投影：它默认装上游 / 业务原始对象（可能含用户数据、加载 options、
  // 整条轨迹）。调用方若要带 cause 的信息，在**自己的边界**上投影成文本再传进来。
  return projected;
}

/** 有限普通数据原样保留；超过这个长度的文本不值得原样带出去。 */
const MAX_PLAIN_TEXT = 120;

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

function isAkFieldName(key: string): boolean {
  const tokens = key.split(/[_\-.\s]+|(?=[A-Z])/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (CREDENTIAL_TOKENS.has(tokens[i].toLowerCase())) return true;
    // 相邻两段拼起来也要认：驼峰切分把 `xApiKey` 拆成 `x` / `Api` / `Key`，凭据词
    // `apikey` 横跨后两段；`AK` 更极端——切分成 `A` / `K`，只有拼起来才是 `ak`。
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
 *   - 未知嵌套对象 ⇒ `OMITTED`，不展开（展开了就得遍历，而遍历大数组 / 带 getter 的对象
 *     既慢又可能触发调用方副作用）；
 *   - 数组 ⇒ 只留 `长度`，不逐项；
 *   - 不调用 `toJSON()`（那是**数据序列化**的钩子，日志主动调它等于替调用方做决定，
 *     而且它的返回值会绕过这里所有脱敏）。
 */
function projectValue(key: string, value: unknown, ak: string | null | undefined): unknown {
  // AK 类字段先判：它可能不是字符串（URL 对象、Buffer…），形状上就不该输出。
  if (isAkFieldName(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_PLAIN_TEXT ? `${value.slice(0, MAX_PLAIN_TEXT)}…` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return `[${value.length} items]`;
  // Error 在 Object 判定**之前**：它也是对象，但有可投影的定位字段。
  if (value instanceof Error) return projectError(value, ak);
  return OMITTED;
}

/**
 * 明确**不输出**的 context 键 —— 「已知带凭据 / 是加载配置」的字段名。
 *
 * ⚠️ 这是一份**拒识**清单，不是放行清单（放行清单会随调用点增长而慢慢把诊断信息删光，
 * 而每一处删掉都要有人拍板）。凭据类键名由 `isAkFieldName` 的**记号**判定覆盖，这里
 * 补的是它按设计**不**认的那一类：**承载 URL / 加载配置整体**的键。
 *
 * 为什么 `url` / `options` 这类键要整体丢、而不是交给形状脱敏：它们的内容是**调用方自己
 * 拼的字符串**，里面出现凭据的形式不受本库控制（`ak=` 参数、userinfo、回调名…）。逐个
 * 猜形状等于承认「可能漏」，而漏的那一条没人会发现。宁可整段丢——反正定位靠的是
 * `kind` / `component` / `code`，不是 URL。
 *
 * 清单之外的键走 `projectValue` 的**形状**投影：普通值留、未知对象留占位、数组只留长度。
 * 也就是说「原样透传」这条路根本不存在——`projectValue` 没有任何分支会返回入参本身。
 */
const OMITTED_KEYS = new Set([
  // 加载配置 / 出口地址：`BMapLoadOptions` 与各种 `*Url` / `*Src` 字段
  "apiUrl",
  "baseUrl",
  "options",
  "params",
  "query",
  "script",
  "serviceHost",
  "src",
  "url",
]);

/**
 * context 投影成**新对象**（不修改入参、不把原始引用交给 console）。
 *
 * 投影失败时返回 `undefined` —— 宁可这次没有 context 参数，**也不能退回原样输出**。
 */
function projectContext(
  context: Record<string, unknown> | undefined,
  ak: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    // 先读原值、再决定去留：拒识清单里的键**连值都不碰**（它的 getter 可能有副作用）。
    if (OMITTED_KEYS.has(key) || isAkFieldName(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = projectValue(key, context[key], ak);
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
  // 「已知 AK」由**调用边界**在调用时给出（那条边界本来就持有它），不再走全局 setter——
  // 多个 Client / 多个并发的加载任务各持不同 AK 时，进程级「最后一次写入」无法给出正确答案。
  const ak = (context?.ak as string | undefined) ?? null;
  try {
    const line = `[bmap-vue] ${logSafeText(message, ak)}`;
    const projected = projectContext(context, ak);
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

