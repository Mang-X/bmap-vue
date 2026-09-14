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
    const line = `[baidu-map-gl-vue] ${redacted}`;
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
 * 开发期告警：只有开发构建才输出。
 *
 * 与 `logger.warn` 的分工：`logger.warn` 是**运行时故障**（能力不支持、参数被丢弃、服务失败…），
 * 无论什么环境都该被运维/使用者看到；这里是**面向库使用者的用法提示**（受控 / 非受控模式切换、
 * `default*` 被覆盖…），出现在最终用户的 console 里没有意义。
 *
 * 门禁是构建期常量 `__DEV__`（包构建与 global 构建都 `define` 为 `'false'`，vitest 为 `'true'`，
 * docs / playground / browser smoke 这几份**直接编 src** 的配置也各自注入）：生产产物里这个分支
 * 会被静态消除——不是「运行时判断后静默」，而是**代码不存在**。
 *
 * 为什么不用 `import.meta.env.DEV`：它需要 `vite/client` 的环境类型，于是**任何**编译本包源码的
 * program 都被迫带上这份环境声明——仓库里 `tests/behavior/v3-ui-kit-widget-contract.test.ts`
 * 用 `types: []` 模拟「不带任何环境声明的消费方」，会直接报 `TS2339: ImportMeta.env`。
 * `__DEV__` 只在本文件里 `declare`，是纯模块内的构建期常量，不带任何环境类型依赖。
 */
declare const __DEV__: boolean;

export function devWarn(message: string, context?: Record<string, unknown>): void {
  if (!__DEV__) return;
  logger.warn(message, context);
}
