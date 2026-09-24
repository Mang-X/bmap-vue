/**
 * 日志与 AK 脱敏
 *
 * 日志中不得输出完整 AK。最多输出 hash、后四位或 provider ID。
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

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

type LoggerLevel = "debug" | "warn" | "error";

function makeLogger(knowsAk?: () => string | null | undefined): Logger {
  const emit = (level: LoggerLevel, message: string, context?: Record<string, unknown>) => {
    const redacted = redactAk(message, knowsAk?.());
    const line = `[bmap-vue] ${redacted}`;
    if (level === "error") console.error(line, context ?? "");
    else if (level === "warn") console.warn(line, context ?? "");
    else console.debug(line, context ?? "");
  };
  return {
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    debug: (m, c) => emit("debug", m, c),
  };
}

let akProvider: (() => string | null | undefined) | null = null;

export function setAkForLogger(getter: () => string | null | undefined): void {
  akProvider = getter;
}

export const logger: Logger = {
  warn: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).warn(m, c),
  error: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).error(m, c),
  debug: (m, c) => makeLogger(akProvider ? () => akProvider!() : undefined).debug(m, c),
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
  if (process.env?.NODE_ENV === "production") return;
  logger.warn(message, context);
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

