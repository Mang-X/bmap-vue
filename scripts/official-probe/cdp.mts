/**
 * 探针用 CDP 会话（R25-A / issue #70）
 *
 * 为什么单独成文件：`--timeout` 必须能保证「无论如何都在截止时间内结束」，否则探针会挂死、
 * `finally` 里的清理（关 Chromium / Vite）永远不执行。这段时间语义需要能被注入式地单测，
 * 所以从 `scripts/probe-official-packages.mts` 里抽出来，通过 `SocketLike` 注入假 socket。
 *
 * 约束（`node --experimental-strip-types`）：本文件不得使用 TS 参数属性；本地导入带扩展名。
 */

/** 只用到 WebSocket 的一小部分能力，便于注入假实现。 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: unknown) => void, options?: { once?: boolean }): void;
}

export interface CdpMessage {
  id?: number;
  result?: { result?: { value?: unknown } };
  error?: { message?: string };
}

export interface CdpSessionOptions {
  /** 单条命令的最大等待时间（毫秒）。缺省取「距 deadline 的剩余时间」。 */
  commandTimeoutMs?: number;
  /** 全局截止时间（epoch ms）。到点后任何未完成命令都必须拒绝。 */
  deadline?: number;
  now?: () => number;
}

export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<CdpMessage>;
  close(): void;
}

export class CdpClosedError extends Error {}
export class CdpTimeoutError extends Error {}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingEntry {
  resolve: (message: CdpMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 在一条已连接的 socket 上建立 CDP 会话。
 *
 * 契约：`send()` 一定会在「命令超时 / 全局截止 / socket 断开」三者之一先到时被拒绝，
 * **永不无限挂起**；断开时所有未完成命令一起拒绝。
 */
export function createCdpSession(socket: SocketLike, options: CdpSessionOptions = {}): CdpSession {
  const now = options.now ?? (() => Date.now());
  const pending = new Map<number, PendingEntry>();
  let messageId = 0;
  let closed = false;

  const rejectAll = (error: Error): void => {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let message: CdpMessage;
    try {
      message = JSON.parse(String((event as { data: unknown }).data)) as CdpMessage;
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(message.id);
    entry.resolve(message);
  });

  socket.addEventListener("close", () => {
    closed = true;
    rejectAll(new CdpClosedError("CDP socket closed before the command completed"));
  });
  socket.addEventListener("error", () => {
    closed = true;
    rejectAll(new CdpClosedError("CDP socket errored before the command completed"));
  });

  return {
    send(method, params = {}) {
      if (closed) {
        return Promise.reject(new CdpClosedError("CDP socket is already closed"));
      }
      const id = ++messageId;
      const budget = (): number => {
        const remaining = options.deadline === undefined ? undefined : options.deadline - now();
        const configured = options.commandTimeoutMs;
        if (remaining === undefined) return configured ?? 0;
        if (configured === undefined) return Math.max(0, remaining);
        return Math.max(0, Math.min(configured, remaining));
      };
      return new Promise<CdpMessage>((resolve, reject) => {
        const budgetMs = budget();
        const timer =
          budgetMs > 0
            ? setTimeout(() => {
                pending.delete(id);
                reject(
                  new CdpTimeoutError(
                    `CDP command ${method} did not answer within ${budgetMs}ms`,
                  ),
                );
              }, budgetMs)
            : null;
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          if (timer) clearTimeout(timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close() {
      closed = true;
      rejectAll(new CdpClosedError("CDP session closed by the caller"));
      socket.close();
    },
  };
}

export interface ConnectOptions extends CdpSessionOptions {
  /** 注入点：默认用全局 `WebSocket`。 */
  createSocket?: (url: string) => SocketLike;
  /** 等待 open 的事件名（默认 `open`）。 */
  openEvent?: string;
  pollIntervalMs?: number;
}

/** 连上 CDP page target；连接建立同样受截止时间约束。 */
export async function connectCdpSession(url: string, options: ConnectOptions = {}): Promise<CdpSession> {
  const now = options.now ?? (() => Date.now());
  const deadline = options.deadline ?? now() + 30_000;
  const createSocket =
    options.createSocket ?? ((target: string) => new WebSocket(target) as unknown as SocketLike);
  const socket = createSocket(url);
  const openEvent = options.openEvent ?? "open";

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const remaining = deadline - now();
    const timer =
      remaining > 0
        ? setTimeout(
            () => settle(new CdpTimeoutError(`CDP socket did not open within ${remaining}ms`)),
            remaining,
          )
        : setTimeout(() => settle(new CdpTimeoutError("CDP deadline already passed")), 0);
    socket.addEventListener(openEvent, () => settle(), { once: true });
    socket.addEventListener("close", () =>
      settle(new CdpClosedError("CDP socket closed before it opened")),
    );
    socket.addEventListener("error", () =>
      settle(new CdpClosedError("CDP socket errored before it opened")),
    );
  });

  return createCdpSession(socket, { ...options, deadline });
}

export interface ReadReportOptions {
  deadline: number;
  pollIntervalMs?: number;
  expression?: string;
}

/**
 * 轮询页面上的 `window.__PROBE__`。
 *
 * 返回 `null` 表示「截止时间到了但页面没写报告」；命令被拒绝则向上抛（由调用方按脚手架失败处理）。
 */
export async function readProbeReport<T>(session: CdpSession, options: ReadReportOptions): Promise<T | null> {
  const expression = options.expression ?? "JSON.stringify(window.__PROBE__ ?? null)";
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  while (Date.now() < options.deadline) {
    const message = await session.send("Runtime.evaluate", { expression, returnByValue: true });
    const value = message.result?.result?.value;
    if (typeof value === "string" && value !== "null") return JSON.parse(value) as T;
    await sleep(pollIntervalMs);
  }
  return null;
}
