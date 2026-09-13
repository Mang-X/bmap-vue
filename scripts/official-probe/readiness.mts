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

type AttemptOutcome =
  | { kind: "response"; response: Response }
  | { kind: "network-error"; error: unknown }
  | { kind: "exit"; exit: ChildExit }
  | { kind: "deadline" };

export async function waitForViteReady(options: ViteReadyOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const deadline = now() + options.timeoutMs;
  /** 没提供退出信号时给一个永不结算的 Promise，让下面的 race 结构保持统一。 */
  const exitSignal: Promise<ChildExit> = options.exited ?? new Promise<ChildExit>(() => {});
  let lastSeenHeader: string | null = null;

  const describeExit = (exit: ChildExit): string =>
    exit.error
      ? `spawn 失败：${exit.error}`
      : `子进程已退出（code=${exit.code ?? "null"}，signal=${exit.signal ?? "null"}）`;

  const timeoutMessage = (): string => {
    const observed =
      lastSeenHeader === null
        ? "响应里没有 x-probe-run 头"
        : `响应里的 x-probe-run 是 ${lastSeenHeader}（本轮应为 ${options.runId}）`;
    return `等待 ${options.url} 超时：${observed} —— 该地址上可能是别的实例（不要在旧服务上读探针结果）`;
  };

  /**
   * 单次尝试：**在飞请求必须与「退出信号」「截止时间」赛跑**。
   *
   * 直接 `await fetch(...)` 是不够的（复审第 3 轮）：服务接受 TCP 连接但不返回响应头时，
   * `fetch` 会一直挂着（undici 没有默认超时），退出判断与超时判断都等不到执行 ——
   * 于是「子进程早就退出了」或「就绪等待早就超时了」都不能结束等待。
   *
   * 决定等待结束的永远是 race 的赢家（退出 / 截止 / 响应），**不是** fetch 的失败；
   * 取消在飞请求只是收尾动作，所以这里的 abort 错误不会掩盖真正的结束原因。
   */
  const attempt = async (remainingMs: number): Promise<AttemptOutcome> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadlineHit = new Promise<AttemptOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "deadline" }), remainingMs);
    });
    const exitHit = exitSignal.then((exit): AttemptOutcome => ({ kind: "exit", exit }));
    const responseOrError = fetchImpl(options.url, { signal: controller.signal }).then(
      (response): AttemptOutcome => ({ kind: "response", response }),
      (error): AttemptOutcome => ({ kind: "network-error", error }),
    );

    const outcome = await Promise.race([responseOrError, exitHit, deadlineHit]);
    if (timer) clearTimeout(timer);
    if (outcome.kind !== "response") controller.abort();
    return outcome;
  };

  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new ViteNotReadyError(timeoutMessage());

    const outcome = await attempt(remaining);
    if (outcome.kind === "exit") {
      throw new ViteNotReadyError(
        `${options.url} 的 dev server 未能在本轮启动：${describeExit(outcome.exit)}（端口可能被占用）`,
      );
    }
    if (outcome.kind === "deadline") throw new ViteNotReadyError(timeoutMessage());
    if (outcome.kind === "response") {
      lastSeenHeader = outcome.response.headers.get(PROBE_RUN_HEADER);
      if (outcome.response.ok && lastSeenHeader === options.runId) return;
    }
    // `network-error` 只说明「这一轮没连上」，继续轮询；退出的情况由下一轮 race 立刻结束。
    await Promise.race([sleep(pollIntervalMs), exitSignal.then(() => undefined)]);
  }
}
