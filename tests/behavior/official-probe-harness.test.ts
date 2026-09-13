/**
 * 探针脚手架的自测（R25-A / issue #70，评审第 2 轮）
 *
 * 这组用例保护的是**探针本身的可信度**：探针给出「31 项全 pass」这种结论时，
 * 前提是「就绪判定确实指向本轮服务」「CDP 一定会在截止时间内结束」。评审给了两个可复现的
 * 缺陷（旧服务 200 被当成就绪、CDP 断连后永不退出），这里把它们**注入式**地固定下来：
 *
 * - 不真的起 Vite / Chromium：用假 `fetch` 与假 socket，因此用例是确定性的、可进 CI；
 * - 每个「必须失败」的场景都配一条**健康对照组**（正确 run id / 正常应答），
 *   否则判定逻辑恒真或恒假都能骗过测试；
 * - 超时用短真实时间（20~200ms），保证红灯信息可读。
 */
import { describe, expect, it } from "vitest";
import {
  CdpClosedError,
  CdpTimeoutError,
  connectCdpSession,
  createCdpSession,
  readProbeReport,
  type CdpMessage,
  type SocketLike,
} from "../../scripts/official-probe/cdp.mts";
import {
  ViteNotReadyError,
  waitForViteReady,
  type ChildExit,
} from "../../scripts/official-probe/readiness.mts";

const RUN_ID = "run-under-test";
const STALE_RUN_ID = "run-from-a-previous-probe";

/* ------------------------------------------------------------------ */
/* 假 socket：可编排「应答复 / 静默 / 断连」                            */
/* ------------------------------------------------------------------ */

interface FakeSocket extends SocketLike {
  /** 测试侧手动触发事件。 */
  emit(type: string, event?: unknown): void;
  /** 已发出的报文（解析后的对象）。 */
  sent(): { id: number; method: string }[];
  closed: boolean;
}

function createFakeSocket(): FakeSocket {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const sent: { id: number; method: string }[] = [];
  const socket: FakeSocket = {
    closed: false,
    send(data: string) {
      sent.push(JSON.parse(data) as { id: number; method: string });
    },
    close() {
      socket.closed = true;
      socket.emit("close", {});
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    sent() {
      return sent;
    },
  };
  return socket;
}

/** 按 `id` 回一条成功的 CDP 响应。 */
function answer(socket: FakeSocket, id: number, value?: unknown): void {
  socket.emit("message", {
    data: JSON.stringify({
      id,
      result: value === undefined ? {} : { result: { value } },
    } satisfies CdpMessage),
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/* ------------------------------------------------------------------ */
/* 发现 1：就绪判定必须指向「本轮」服务                                 */
/* ------------------------------------------------------------------ */

function okResponse(headerRunId: string | null): Response {
  const headers = new Headers();
  if (headerRunId !== null) headers.set("x-probe-run", headerRunId);
  return new Response("ok", { status: 200, headers });
}

describe("dev server 就绪判定", () => {
  it("对照组：x-probe-run 与本轮一致时才判定就绪", async () => {
    await expect(
      waitForViteReady({
        url: "http://localhost:5211/",
        runId: RUN_ID,
        timeoutMs: 1_000,
        fetchImpl: async () => okResponse(RUN_ID),
      }),
    ).resolves.toBeUndefined();
  });

  it("端口被旧服务占用（200 但 x-probe-run 是别的 run）不算就绪", async () => {
    // 评审场景：新 Vite 因 strictPort 启动失败，旧服务仍返回 200。
    const error = await waitForViteReady({
      url: "http://localhost:5211/",
      runId: RUN_ID,
      timeoutMs: 60,
      pollIntervalMs: 10,
      fetchImpl: async () => okResponse(STALE_RUN_ID),
    }).then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error, "任意 200 都被当成本轮就绪 → 会把旧服务的结果记到当前候选版本上").toBeInstanceOf(
      ViteNotReadyError,
    );
    expect(String(error?.message)).toContain(STALE_RUN_ID);
  });

  it("没有 x-probe-run 响应头（非本轮 Vite）不算就绪", async () => {
    const error = await waitForViteReady({
      url: "http://localhost:5211/",
      runId: RUN_ID,
      timeoutMs: 60,
      pollIntervalMs: 10,
      fetchImpl: async () => okResponse(null),
    }).then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toBeInstanceOf(ViteNotReadyError);
  });

  it("Vite 子进程已退出时立刻按脚手架失败，不等到超时", async () => {
    const exited = deferred<ChildExit>();
    const started = Date.now();
    const pending = waitForViteReady({
      url: "http://localhost:5211/",
      runId: RUN_ID,
      timeoutMs: 10_000,
      pollIntervalMs: 10,
      exited: exited.promise,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    setTimeout(() => exited.resolve({ code: 1, signal: null }), 20);

    const error = await pending.then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toBeInstanceOf(ViteNotReadyError);
    expect(String(error?.message)).toContain("1");
    expect(Date.now() - started, "子进程已退出却还在等 10s 超时").toBeLessThan(3_000);
  });
});

/* ------------------------------------------------------------------ */
/* 发现 2：CDP 断连 / 不回响应时必须在截止时间内结束                     */
/* ------------------------------------------------------------------ */

describe("CDP 会话的时间语义", () => {
  it("对照组：正常应答的命令按序完成", async () => {
    const socket = createFakeSocket();
    const session = createCdpSession(socket, { commandTimeoutMs: 200 });
    const pending = session.send("Runtime.enable");
    expect(socket.sent()[0]?.method).toBe("Runtime.enable");
    answer(socket, socket.sent()[0]!.id);
    await expect(pending).resolves.toMatchObject({ id: socket.sent()[0]!.id });
  });

  it("socket 断开时未完成命令被拒绝，而不是永远挂起", async () => {
    const socket = createFakeSocket();
    const session = createCdpSession(socket, { commandTimeoutMs: 5_000 });
    const pending = session.send("Runtime.enable");
    socket.emit("close", {});

    const error = await pending.then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toBeInstanceOf(CdpClosedError);
  });

  it("命令不回响应时按命令超时拒绝", async () => {
    const socket = createFakeSocket();
    const session = createCdpSession(socket, { commandTimeoutMs: 30 });
    const error = await session.send("Runtime.evaluate").then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toBeInstanceOf(CdpTimeoutError);
  });

  it("连接建立本身受截止时间约束", async () => {
    const socket = createFakeSocket();
    const error = await connectCdpSession("ws://127.0.0.1:0/devtools/page/x", {
      deadline: Date.now() + 40,
      createSocket: () => socket,
    }).then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error).toBeInstanceOf(CdpTimeoutError);
  });

  it("连接建立后立刻断连：readProbeReport 在截止时间内结束（评审的复现场景）", async () => {
    const socket = createFakeSocket();
    const report = readProbeReport(createCdpSession(socket, { commandTimeoutMs: 60 }), {
      deadline: Date.now() + 120,
      pollIntervalMs: 10,
    });
    // Runtime.enable 应答一次，随后 socket 断连（渲染进程异常 / 调试通道消失）
    const enable = createCdpSession(socket, { commandTimeoutMs: 60 });
    void enable.send("Runtime.enable");
    answer(socket, socket.sent()[0]!.id);
    socket.emit("close", {});

    const settled = await Promise.race([
      report.then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: Error) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "hung" }>((resolve) => setTimeout(() => resolve({ kind: "hung" }), 400)),
    ]);
    expect(settled.kind, "CDP 断连后 readProbeReport 仍然挂起，finally 清理不会执行").not.toBe(
      "hung",
    );
  });
});
