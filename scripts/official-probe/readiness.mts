/**
 * 「dev server 就绪」的判定（R25-A / issue #70）
 *
 * 这里回答的是一个**可信度**问题，而不是连不连得上：如果端口被上一次探针或另一个 worktree
 * 的服务占着，新 Vite 启动失败（`strictPort: true` 会直接退出）而旧服务仍然返回 `200`，
 * 那么浏览器访问的是旧服务提供的页面，而报告里的 `packages` 却读的是当前工作目录的安装版本
 * —— 于是「旧结果被归到当前候选版本」，可能误判通过。
 *
 * 因此判定有**三条**，缺一不可：
 * 1. 子进程没有在本轮退出（`exited` 先到就立刻按脚手架失败，不等超时）；
 * 2. HTTP 能连上；
 * 3. 响应头 `x-probe-run` 等于本轮的 run id（`vite.config.ts` 在启动时从 `PROBE_RUN_ID`
 *    读入并回显）。旧进程的响应头里必然是它自己那一轮的 id —— 这就是「是否本轮实例」的判别依据。
 *
 * 约束（`node --experimental-strip-types`）：不使用 TS 参数属性；本地导入带扩展名。
 */
import { sleep } from "./cdp.mts";

export interface ChildExit {
  code: number | null;
  signal: string | null;
  error?: string;
}

export interface ViteReadyOptions {
  /** 轮询地址（本轮 dev server 的 origin）。 */
  url: string;
  /** 本轮运行标识：dev server 必须通过 `x-probe-run` 响应头回显它。 */
  runId: string;
  timeoutMs: number;
  /** 子进程退出（或 spawn 失败）的 promise；用来「启动失败立刻按脚手架失败退出」。 */
  exited?: Promise<ChildExit> | null;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** dev server 没有在本轮启动成功（进程退出 / 端口被占 / 响应来自别的实例）。 */
export class ViteNotReadyError extends Error {}

export const PROBE_RUN_HEADER = "x-probe-run";

export async function waitForViteReady(options: ViteReadyOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const started = now();

  // 子进程退出与超时赛跑：谁先到谁负责结束等待，避免「Vite 已经死了还在等 30s」。
  let exitedWith: ChildExit | null = null;
  if (options.exited) {
    void options.exited.then((exit) => {
      exitedWith = exit;
    });
  }
  const describeExit = (exit: ChildExit): string =>
    exit.error
      ? `spawn 失败：${exit.error}`
      : `子进程已退出（code=${exit.code ?? "null"}，signal=${exit.signal ?? "null"}）`;

  let lastSeenHeader: string | null = null;
  for (;;) {
    if (exitedWith) {
      throw new ViteNotReadyError(
        `${options.url} 的 dev server 未能在本轮启动：${describeExit(exitedWith)}（端口可能被占用）`,
      );
    }
    try {
      const response = await fetchImpl(options.url);
      lastSeenHeader = response.headers.get(PROBE_RUN_HEADER);
      if (response.ok && lastSeenHeader === options.runId) return;
    } catch {
      /* 还没起来 */
    }
    if (now() - started > options.timeoutMs) {
      const observed =
        lastSeenHeader === null
          ? "响应里没有 x-probe-run 头"
          : `响应里的 x-probe-run 是 ${lastSeenHeader}（本轮应为 ${options.runId}）`;
      throw new ViteNotReadyError(
        `等待 ${options.url} 超时：${observed} —— 该地址上可能是别的实例（不要在旧服务上读探针结果）`,
      );
    }
    await sleep(pollIntervalMs);
  }
}
