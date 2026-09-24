/**
 * 插件等待的取消口径（M8-PLUGIN-CORE / issue #42）
 *
 * `PluginHost` 与 `PluginRegistry` 都要做同一件事：**等一个共享任务，但在自己的 signal abort 时
 * 只结算自己这一次等待**。两处各写一遍会让「取消到底影响谁」这件事有两个实现、两套边界，
 * 因此抽到这里。
 *
 * 口径（与 AGENTS.md 一致）：
 *
 * - 取消的是**等待**，不是底层任务。底层任务继续跑，结果照旧进缓存给后来的消费者；
 * - 「已 abort 的 signal」立刻拒绝，连底层任务都不启动 —— 不该产生一个没有任何人等待的请求；
 * - 取消用 `BMAP_PROVIDER_ABORTED`（本库既有的「等待被 AbortSignal 中止」码，`retryable: true`），
 *   而不是 `BMAP_PLUGIN_LOAD_FAILED`：后者意味着「插件真的坏了」，会污染 `getStatus()`。
 */
import { BMapError } from "../errors/BMapError";

/** 插件等待被取消时用的错误（被取消 ≠ 插件失败）。 */
export function pluginAbortError(name: string, reason?: unknown): BMapError {
  return new BMapError(
    "BMAP_PROVIDER_ABORTED",
    `plugin "${name}" wait aborted`,
    reason !== undefined ? { plugin: name, cause: reason } : { plugin: name },
  );
}

/**
 * 等待 `task`，但**任一** signal abort 时立刻拒绝。
 *
 * `name` 只用于错误消息。若某个 signal 已经处于 aborted，则同步拒绝且不订阅任何监听器。
 */
export function abortRace<T>(
  task: Promise<T>,
  signals: readonly (AbortSignal | undefined)[],
  name: string,
): Promise<T> {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  const already = active.find((signal) => signal.aborted);
  if (already) return Promise.reject(pluginAbortError(name, already.reason));
  if (active.length === 0) return task;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      for (const signal of active) signal.removeEventListener("abort", onAbort);
    };
    function onAbort(event: Event) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(pluginAbortError(name, (event.target as AbortSignal | null)?.reason));
    }
    for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}
