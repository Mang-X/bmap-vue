import { describe, it, expect, vi } from "vitest";
import { createClientContext } from "./client";
import type { BMapClient, BMapDriverFactory, CreateBMapClientOptions } from "../../client/types";
import type { BMapDriver } from "../../driver/types/bmap";
import { createLoadedJsapiV4 } from "../loader/providers";
import { CustomScriptV4Provider } from "../loader/providers/CustomScriptV4Provider";
import { SdkRegistry } from "../loader/SdkRegistry";
import type { ScriptLoader } from "../loader/ScriptLoader";
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

  /**
   * #186 评审 P1：缺 definition 是**启动前**的失败，但它必须走同一处状态写入。
   * 直接 `Promise.reject` 会让 context 停在 `idle`，而 `<BMapProvider>` 的 `#error` 插槽
   * 判的是 `status === "error"`——「缺配置」于是变成静默的空插槽。旧实现由 `load()` 的
   * catch 写这两处，本用例把该读数钉回来。
   */
  it("缺 definition 的失败写入 error 状态与 error 读数（不静默停在 idle）", async () => {
    const ctx = createClientContext({});
    expect(ctx.status.value).toBe("idle");
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_PARENT_CONTEXT_MISSING" });
    expect(ctx.status.value).toBe("error");
    expect(ctx.error.value).toMatchObject({ code: "BMAP_PARENT_CONTEXT_MISSING" });
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
    // 等待在 `dispose()` 那一刻就以终态口径结算（评审 P1），因此这里拿到的**不是**
    // 迟到的 `late boom`；底层稍后失败时也不得把终态改写成 `error`。
    await expect(pending).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    fail();
    await Promise.resolve();
    await Promise.resolve();
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

/**
 * #186 评审 P1：`dispose()` 必须结算**已经发出**的等待。
 *
 * 「底层任务是否继续跑」与「调用者的等待要不要结算」是两件事：前者由 Provider / Registry
 * 的 `cancellable` 裁决（见下一个 describe），后者是验收项里写明的「销毁后没有未结算的
 * 本库等待 Promise」——两者都不允许调用者被永久悬住。真实路径上 `<BMapProvider>` 的
 * `onMounted` → `ensureLoad()` → `context.load()` 正是**无 signal** 的那一条，因此
 * 「Provider 卸载后那条 async 调用还挂着」在底层 Provider 不结算时就是永久 pending。
 *
 * 下面用「永不放行的 Provider」把这个窗口钉死：**不 release 底层 gate**，只断言
 * `dispose()` 之后等待当场结算。
 */
describe("BMapClientContext.dispose 结算已发出的等待（#186 评审 P1）", () => {
  /** 永不结算的 Provider：等待是否被结算只能由 context 自己决定。 */
  function neverSettlingDefinition() {
    let calls = 0;
    const def = definition(() => {
      calls++;
      return new Promise<never>(() => {});
    });
    return { def, calls: () => calls };
  }

  it("无 signal 的等待在 dispose 后立即以 BMAP_RESOURCE_DISPOSED 结算", async () => {
    const { def, calls } = neverSettlingDefinition();
    const ctx = createClientContext({ definition: def });
    const pending = ctx.load();
    expect(calls()).toBe(1);
    ctx.dispose();
    // 关键：**没有**放行底层——等待仍然必须结算。
    await expect(pending).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    expect(ctx.status.value).toBe("disposed");
  });

  it("带 signal 的等待同样由 dispose 结算（调用方 signal 未 abort）", async () => {
    const { def } = neverSettlingDefinition();
    const ctx = createClientContext({ definition: def });
    const controller = new AbortController();
    const pending = ctx.load(controller.signal);
    ctx.dispose();
    await expect(pending).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    expect(controller.signal.aborted, "不是调用方取消，而是 context 终态").toBe(false);
  });

  it("多个等待者一起结算，且之后放行底层不产生新的状态写入", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = createClientContext({
      definition: definition(async () => {
        await gate;
        throw new Error("late provider failure");
      }),
    });
    const first = ctx.load();
    const second = ctx.load();
    ctx.dispose();
    await expect(first).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    await expect(second).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.error.value).toBeNull();
  });

  it("dispose 之后的等待不再登记 abort 监听器", async () => {
    const { def } = neverSettlingDefinition();
    const ctx = createClientContext({ definition: def });
    const controller = new AbortController();
    const removed: string[] = [];
    const original = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return (original as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof controller.signal.removeEventListener;

    const pending = ctx.load(controller.signal);
    ctx.dispose();
    await expect(pending).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
    const baselines = removed.length;
    expect(baselines, "结算时解绑了自己登记的监听器").toBeGreaterThan(0);
    // owner abort 已经把等待结算掉了：调用方之后再 abort 不应再有任何解绑动作。
    controller.abort();
    expect(removed.length).toBe(baselines);
  });
});

/**
 * #186 评审 P1：传给底层的是 **context-owned 的 owner signal**，不是调用者的 signal，
 * 也不是「什么都不传」。
 *
 * 仓库本来就把加载分成两类（`SdkRegistryLoadRequest.cancellable`）：
 * `BaiduJsapiV4Provider` 声明 `cancellable: false`（官方 Loader 无取消接口），而
 * `CustomScriptV4Provider` 走默认 `cancellable: true`，其 signal 会一路传到
 * `SdkRegistry` → `ScriptLoader`，最后一个消费者离开时同步释放 script / timer / callback。
 *
 * 早先版本「彻底不传 signal」把后者的取消能力一起拿掉了：`dispose()` 只结算调用者等待，
 * 自托管入口留下的 script 仍要跑完或超时。下面两条用例把这两类分开钉住。
 */
describe("BMapClientContext：dispose 对底层可取消资源的作用（#186 评审 P1）", () => {
  /** 假 script loader：记录收到的 signal，并在 abort 时拒绝（与真实 ScriptLoader 同形）。 */
  function recordingLoader() {
    const signals: AbortSignal[] = [];
    const loader = {
      load: (_options: unknown, signal?: AbortSignal) => {
        if (signal) signals.push(signal);
        return new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      invalidateCompleted: () => {},
    };
    return { loader: loader as unknown as ScriptLoader, signals };
  }

  it("可取消 Provider（customScriptV4Provider）：dispose 会 abort 底层订阅", async () => {
    const { loader, signals } = recordingLoader();
    // 每个用例一个独立域：进程级 registry 会让用例互相串状态。
    const provider = new CustomScriptV4Provider("https://example.com/api?v=4.0", {
      mode: "load",
      loader,
      registry: new SdkRegistry({ domain: "bmap-client-context-cancellable" }),
    });
    const ctx = createClientContext({ definition: { provider, loadOptions: { ak: "test" } } });
    const pending = ctx.load().then(
      () => "ok",
      (e: { code?: string }) => e?.code ?? "rejected",
    );
    await Promise.resolve();
    expect(signals, "底层真的收到聚合 signal（否则下面只是「没发生过」）").toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    ctx.dispose();
    // 调用者等待按终态口径结算，**同时**底层订阅被释放。
    await expect(pending).resolves.toBe("BMAP_RESOURCE_DISPOSED");
    expect(signals[0]!.aborted, "自托管入口的 script/timer 必须被释放").toBe(true);
  });

  it("不可取消 Provider（cancellable:false，官方 Loader 口径）：dispose 不终止底层任务", async () => {
    const { loader, signals } = recordingLoader();
    const registry = new SdkRegistry({ domain: "bmap-client-context-uncancellable" });
    // 与 `BaiduJsapiV4Provider` 同一形状：注册时声明 cancellable:false。
    const provider = {
      id: "official-like",
      load: (_options: unknown, signal?: AbortSignal) =>
        registry.load(
          {
            fingerprint: "official-like",
            cancellable: false,
            loader: (requestSignal: AbortSignal) =>
              (loader.load as (o: unknown, s?: AbortSignal) => Promise<never>)(_options, requestSignal),
          },
          signal,
        ),
    };
    const ctx = createClientContext({
      definition: { provider: provider as never, loadOptions: {} },
    });
    const pending = ctx.load().then(
      () => "ok",
      (e: { code?: string }) => e?.code ?? "rejected",
    );
    await Promise.resolve();
    expect(signals).toHaveLength(1);

    ctx.dispose();
    await expect(pending).resolves.toBe("BMAP_RESOURCE_DISPOSED");
    // 关键：不可取消的底层任务保留（真实网络请求不会被本库宣称终止，全局 SDK 不被重置）。
    expect(signals[0]!.aborted).toBe(false);
  });
});
