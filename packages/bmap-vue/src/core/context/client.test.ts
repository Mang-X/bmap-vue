import { describe, it, expect, vi } from "vitest";
import { createClientContext } from "./client";
import type { BMapClient, BMapDriverFactory, CreateBMapClientOptions } from "../../client/types";
import type { BMapDriver } from "../../driver/types/bmap";
import { createLoadedJsapiV4 } from "../loader/providers";
import type { LoadedJsapiV4 } from "../loader/loaded";

/**
 * M3A3-REMOVE-LEGACY（#26）：`withMigrationDriver` 归一已删除，definition 直接交给
 * `createBMapClient`。本文件测的是 **Context 的生命周期**（loading/ready/error/retry/dispose），
 * 与具体 Driver 实现无关，因此这里注入一个 stub Driver 工厂，避免每条用例都要造一个完整
 * 的 v4 命名空间——加载结果仍必须是**完整**的结构化结果（`assertLoadedSdk` 是运行时边界，
 * 少 `version` / `load` 会被拒；用公开构造成型而不是手写字面量）。
 */
const stubDriver: BMapDriverFactory = () => ({ engine: "jsapi-v4" }) as unknown as BMapDriver;

function loaded(): LoadedJsapiV4 {
  return createLoadedJsapiV4({
    providerId: "existing-global-v4",
    mode: "existing-global",
    version: "4.0",
    versionSource: "global",
    options: {},
    fingerprint: "bmap-client-context-test",
    namespace: {},
  });
}

function definition(load: CreateBMapClientOptions["provider"]["load"]): CreateBMapClientOptions {
  return { provider: { load }, loadOptions: {}, driver: stubDriver };
}

function fakeClient(): BMapClient {
  return {
    id: Symbol("c"),
    engine: "jsapi-v4",
    libraryVersion: "test",
    sdkVersion: "test",
    version: "test",
    driver: {} as never,
    capabilities: {} as never,
    rawSdk: {},
  };
}

describe("BMapClientContext", () => {
  it("starts idle and transitions loading -> ready", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: definition(async () => {
        calls++;
        return loaded();
      }),
    });
    expect(ctx.status.value).toBe("idle");
    const p = ctx.load();
    expect(ctx.status.value).toBe("loading");
    const client = await p;
    expect(ctx.status.value).toBe("ready");
    expect(ctx.client.value).toEqual(client);
    expect(calls).toBe(1);
  });

  it("dedups concurrent load", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: definition(async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return loaded();
      }),
    });
    const [a, b] = await Promise.all([ctx.load(), ctx.load()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("records error and recovers via retry", async () => {
    // 拒绝的是**原错误**（#186）：Provider 的错误已带 `code` / `cause`，再包一层会把
    // `code` 藏进 `unsupported` 字段。归一化后的 `BMapError` 照旧写在 `ctx.error` 上。
    let fail = true;
    const ctx = createClientContext({
      definition: definition(async () => {
        if (fail) throw new Error("sdk down");
        return loaded();
      }),
    });
    await expect(ctx.load()).rejects.toThrow("sdk down");
    expect(ctx.status.value).toBe("error");
    expect(ctx.error.value).toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    fail = false;
    const client = await ctx.retry();
    expect(ctx.status.value).toBe("ready");
    expect(client).toBeTruthy();
  });

  it("resolves immediately when constructed with a client", async () => {
    const c = fakeClient();
    const ctx = createClientContext({ client: c });
    expect(ctx.status.value).toBe("ready");
    await expect(ctx.load()).resolves.toBe(c);
  });

  it("throws a clear error without definition", async () => {
    const ctx = createClientContext({});
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_PARENT_CONTEXT_MISSING" });
  });

  it("dispose clears and rejects further loads", async () => {
    const ctx = createClientContext({ definition: definition(async () => loaded()) });
    await ctx.load();
    ctx.dispose();
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.client.value).toBeNull();
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });

  it("aborted signal rejects without error status", async () => {
    const controller = new AbortController();
    const ctx = createClientContext({
      definition: definition(async (_o, signal) => {
        await new Promise((_, rej) =>
          signal?.addEventListener("abort", () => rej(new Error("aborted"))),
        );
        return loaded();
      }),
    });
    const p = ctx.load(controller.signal);
    controller.abort(new Error("cancel"));
    await expect(p).rejects.toThrow();
    vi.useRealTimers();
  });
});

/**
 * #186：共享生产任务归 context，每次 `load()` 只是 caller-owned 的等待。
 *
 * 这一组用**可控延迟 Provider**（`gatedDefinition` 的 gate）把「共享任务仍在飞」那个窗口
 * 钉住，逐条覆盖 issue 里的三个复现：先加入者取消连坐后来者、`dispose()` 后迟到回写、
 * 等待监听器残留。
 */
function gatedDefinition() {
  const gates: Array<() => void> = [];
  let calls = 0;
  const def = definition(async (_o, signal) => {
    calls++;
    await new Promise<void>((resolve, reject) => {
      gates.push(resolve);
      signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
        once: true,
      });
    });
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    return loaded();
  });
  return { def, release: () => gates.splice(0).forEach((go) => go()), calls: () => calls };
}

describe("BMapClientContext 共享任务的取消隔离（#186）", () => {
  it("首个调用者带 signal 且取消：未取消的后来者仍拿到同一成功结果", async () => {
    const { def, release, calls } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const controller = new AbortController();
    const first = ctx.load(controller.signal);
    const second = ctx.load();
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    release();
    const shared = await second;
    expect(shared).toBeTruthy();
    // 共享契约：Provider 只被调用一次，取消者没有把共享任务一起带走。
    expect(calls()).toBe(1);
    expect(ctx.status.value).toBe("ready");
  });

  it("后来者带 signal 且取消：先到的等待者不受影响，且复用同一 Client", async () => {
    const { def, release, calls } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const first = ctx.load();
    const controller = new AbortController();
    const second = ctx.load(controller.signal);
    controller.abort();
    await expect(second).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    release();
    const [a, b] = await Promise.all([first, ctx.load()]);
    expect(a).toBe(b);
    expect(calls()).toBe(1);
  });

  it("取消者只影响自己：无 signal 与带 signal 的等待者混用", async () => {
    const { def, release } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const cancelled = new AbortController();
    const p1 = ctx.load();
    const p2 = ctx.load(cancelled.signal);
    const p3 = ctx.load();
    cancelled.abort();
    release();
    await expect(p2).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    const [a, c] = await Promise.all([p1, p3]);
    expect(a).toBe(c);
    expect(ctx.status.value).toBe("ready");
  });

  it("已取消的 signal 不启动共享任务", async () => {
    const { def, calls } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const controller = new AbortController();
    controller.abort();
    await expect(ctx.load(controller.signal)).rejects.toMatchObject({
      code: "BMAP_PROVIDER_ABORTED",
    });
    expect(calls()).toBe(0);
    expect(ctx.status.value).toBe("idle");
  });

  it("等待结束后解绑自己的 abort 监听器", async () => {
    const { def, release } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const controller = new AbortController();
    const signal = controller.signal;
    const removed: string[] = [];
    const original = signal.removeEventListener.bind(signal);
    signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (original as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof signal.removeEventListener;

    const shared = ctx.load();
    const waiting = ctx.load(signal);
    release();
    await Promise.all([shared, waiting]);
    const baselines = removed.length;
    expect(removed.filter((type) => type === "abort").length).toBeGreaterThan(0);

    // 首次 abort 的监听器是 `{ once: true }`，它自己会摘掉；完成后不应再有解绑动作。
    controller.abort();
    expect(removed.length).toBe(baselines);
  });

  it("失败后共享任务被替换：retry 重新发起，Provider 调用次数如实累加", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: definition(async () => {
        calls++;
        throw new Error("sdk down");
      }),
    });
    await expect(ctx.load()).rejects.toThrow("sdk down");
    expect(ctx.status.value).toBe("error");
    expect(calls).toBe(1);
    await expect(ctx.retry()).rejects.toThrow("sdk down");
    expect(calls).toBe(2);
  });
});

describe("BMapClientContext.dispose 是终态（#186）", () => {
  it("无 signal 加载未完成时 dispose，迟到成功不写回 ready", async () => {
    const { def, release } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    const pending = ctx.load();
    ctx.dispose();
    release();
    await expect(pending).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.client.value).toBeNull();
  });

  it("无 signal 加载未完成时 dispose，迟到失败不写回 error", async () => {
    let fail: () => void = () => {};
    const ctx = createClientContext({
      definition: definition(
        () =>
          new Promise((_resolve, reject) => {
            fail = () => reject(new Error("late boom"));
          }),
      ),
    });
    const pending = ctx.load();
    ctx.dispose();
    fail();
    await expect(pending).rejects.toThrow("late boom");
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.error.value).toBeNull();
  });

  it("dispose 之后 load/retry 一律 BMAP_RESOURCE_DISPOSED，且不重启任务", async () => {
    const { def, calls } = gatedDefinition();
    const ctx = createClientContext({ definition: def });
    ctx.dispose();
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    await expect(ctx.retry()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    expect(calls()).toBe(0);
    expect(ctx.status.value).toBe("disposed");
  });
});
