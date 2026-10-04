/**
 * SdkRegistry —— 进程级冲突域
 *
 * 覆盖 M3A1-PROVIDERS（issue #17）的 registry 语义：
 * - 同域同指纹复用同一任务，不同域互不影响；
 * - 域内已就绪配置与请求配置不一致时**恒** reject `BMAP_SDK_CONFIG_CONFLICT`（唯一处置）；
 * - 失败 / 取消后条目移除，可重试；
 * - 不依赖 window / document（SSR 导入安全）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SdkRegistry,
  getProcessSdkRegistry,
  resetProcessSdkRegistryForTests,
} from "./SdkRegistry";
import { fingerprintConfig } from "./url";
import { BMapError } from "../errors/BMapError";

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CONFIG_A = fingerprintConfig({ ak: "ak-aaaaaaaa", version: "4.0" });
const CONFIG_B = fingerprintConfig({ ak: "ak-bbbbbbbb", version: "4.0" });

describe("SdkRegistry", () => {
  beforeEach(() => {
    resetProcessSdkRegistryForTests();
  });

  afterEach(() => {
    resetProcessSdkRegistryForTests();
  });

  it("concurrent same-fingerprint loads share one task", async () => {
    const deferred = createDeferred<unknown>();
    const loader = vi.fn(() => deferred.promise);
    const registry = new SdkRegistry({ domain: "BMap" });

    const p1 = registry.load({ fingerprint: CONFIG_A, loader });
    const p2 = registry.load({ fingerprint: CONFIG_A, loader });
    // 条目先登记、任务按微任务启动：并发调用只会启动一次 loader。
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    const value = { Map: 1 };
    deferred.resolve(value);
    await expect(p1).resolves.toBe(value);
    await expect(p2).resolves.toBe(value);
  });

  it("serves the ready result without re-running the loader", async () => {
    const loader = vi.fn(async () => "sdk");
    const registry = new SdkRegistry();

    await registry.load({ fingerprint: CONFIG_A, loader });
    await expect(registry.load({ fingerprint: CONFIG_A, loader })).resolves.toBe("sdk");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(registry.activeFingerprint).toBe(CONFIG_A);
  });

  it("removes failed entry and allows retry", async () => {
    let attempt = 0;
    const loader = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("first fail");
      return { ok: true };
    });
    const registry = new SdkRegistry();

    await expect(registry.load({ fingerprint: CONFIG_A, loader })).rejects.toThrow("first fail");
    expect(registry.size).toBe(0);
    expect(registry.activeFingerprint).toBeUndefined();

    await expect(registry.load({ fingerprint: CONFIG_A, loader })).resolves.toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("throws structured config conflict across providers in the same domain", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const loader = vi.fn(async () => "sdk");

    await registry.load({ fingerprint: CONFIG_A, loader });
    // 同域内另一个 Provider 用不同配置请求：必须冲突，而不是重新加载。
    const conflict = await registry
      .load({ fingerprint: CONFIG_B, loader })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(BMapError);
    expect((conflict as BMapError).code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect((conflict as BMapError).retryable).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not leak AK in conflict diagnostics", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    await registry.load({
      fingerprint: fingerprintConfig({ ak: "SECRET_AK_123456" }),
      loader: async () => "sdk",
    });

    const conflict = await registry
      .load({
        fingerprint: fingerprintConfig({ ak: "SECRET_AK_999999" }),
        loader: async () => "sdk",
      })
      .catch((error: unknown) => error as BMapError);

    expect((conflict as BMapError).message).not.toContain("SECRET_AK_999999");
    expect((conflict as BMapError).message).toContain("SDK config conflict");
  });

  // `#104` 第三批删掉了这里的三条策略用例（`conflictPolicy: "ignore"` / `"warn"` 与
  // 「默认必须是 throw」）：那个开关没有任何生产消费者（三个 Provider 一律不传），
  // 于是它随 `./core` 一起进公共声明面却没有被验证过。冲突处置现在只有一条路径，
  // 由上面「throws structured config conflict across providers in the same domain」覆盖。

  it("rejects a second consumer that aborts, without touching the others", async () => {
    const deferred = createDeferred<unknown>();
    const loader = vi.fn(() => deferred.promise);
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const c2 = new AbortController();

    const p1 = registry.load({ fingerprint: CONFIG_A, loader }, c1.signal);
    const p2 = registry.load({ fingerprint: CONFIG_A, loader }, c2.signal);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    const value = { Map: 1 };
    deferred.resolve(value);
    // 未取消的消费者不受影响：取消必须与消费者一一对应，而不是由第一个调用者控制所有人。
    await expect(p2).resolves.toBe(value);
  });

  it("cancels the underlying task only after the last consumer leaves", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const c2 = new AbortController();
    let underlyingAborted = false;
    const loader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              underlyingAborted = true;
              reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted"));
            },
            { once: true },
          );
        }),
    );

    const p1 = registry.load({ fingerprint: CONFIG_A, loader }, c1.signal);
    const p2 = registry.load({ fingerprint: CONFIG_A, loader }, c2.signal);
    // 条目先登记、任务按微任务启动：并发调用只会启动一次 loader。
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(underlyingAborted).toBe(false);

    c2.abort();
    await expect(p2).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(underlyingAborted).toBe(true);
    // 最后一个消费者离开后条目释放，允许下次重试。
    expect(registry.size).toBe(0);
    await expect(registry.load({ fingerprint: CONFIG_A, loader: vi.fn(async () => "sdk") })).resolves.toBe(
      "sdk",
    );
  });

  it("rejects a concurrent request with a different config before starting its loader", async () => {
    const deferred = createDeferred<unknown>();
    const loaderA = vi.fn(() => deferred.promise);
    const loaderB = vi.fn(async () => "sdk-b");
    const registry = new SdkRegistry({ domain: "BMap" });

    const p1 = registry.load({ fingerprint: CONFIG_A, loader: loaderA });
    const p2 = registry.load({ fingerprint: CONFIG_B, loader: loaderB });

    // 域内已有正在加载的配置：不兼容的请求必须在启动 loader 之前被拒绝。
    await expect(p2).rejects.toMatchObject({ code: "BMAP_SDK_CONFIG_CONFLICT" });
    expect(loaderB).not.toHaveBeenCalled();

    deferred.resolve("sdk-a");
    await expect(p1).resolves.toBe("sdk-a");
  });

  it("frees the in-flight config after a failure so a retry can start", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const failing = vi.fn(async () => {
      throw new Error("first fail");
    });

    await expect(registry.load({ fingerprint: CONFIG_A, loader: failing })).rejects.toThrow(
      "first fail",
    );
    // 占用已释放：另一份配置现在可以正常加载。
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe("b");
  });

  it("releases the entry synchronously so an immediate retry starts a new task", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const hangingLoader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted")),
            { once: true },
          );
        }),
    );

    const first = registry.load({ fingerprint: CONFIG_A, loader: hangingLoader }, c1.signal);
    await Promise.resolve();

    c1.abort();
    // 不等待任何异步收尾：立即用同一配置重试，必须启动新任务而不是订阅已取消的任务。
    const retry = vi.fn(async () => "sdk-retry");
    const same = registry.load({ fingerprint: CONFIG_A, loader: retry });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await expect(same).resolves.toBe("sdk-retry");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("releases the occupancy synchronously so another config can load right away", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const hangingLoader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted")),
            { once: true },
          );
        }),
    );

    const first = registry.load({ fingerprint: CONFIG_A, loader: hangingLoader }, c1.signal);
    await Promise.resolve();

    c1.abort();
    const other = vi.fn(async () => "sdk-other");
    const second = registry.load({ fingerprint: CONFIG_B, loader: other });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await expect(second).resolves.toBe("sdk-other");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("records the loaded config even when the entry was released by a cancel (uncancellable task)", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    let settleUnderlying!: (value: string) => void;
    // 底层任务**不可取消**：signal 被 abort 也不结算，稍后才成功。
    // 这正是默认在线路径的形态——官方 Loader 没有公开取消接口（ADR 2026-09-13 决策 5）。
    const uncancellable = vi.fn(() => new Promise<string>((resolve) => (settleUnderlying = resolve)));

    const first = registry.load({ fingerprint: CONFIG_A, loader: uncancellable }, c1.signal);
    await Promise.resolve();
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    // 消费者全走了 ⇒ 条目与占用都已释放，但底层任务还在飞。
    expect(registry.size).toBe(0);

    settleUnderlying("sdk-a");
    await Promise.resolve();
    await Promise.resolve();

    // 全局 SDK 事实上已按 CONFIG_A 就绪：域记账必须跟上，否则另一份配置会被误判成无冲突。
    expect(registry.activeFingerprint).toBe(CONFIG_A);
    await expect(
      registry.load({ fingerprint: CONFIG_B, loader: async () => "sdk-b" }),
    ).rejects.toMatchObject({ code: "BMAP_SDK_CONFIG_CONFLICT" });
  });

  it("a late success from a released entry never overwrites the config already recorded", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    let settleA!: (value: string) => void;
    const uncancellable = vi.fn(() => new Promise<string>((resolve) => (settleA = resolve)));

    const first = registry.load({ fingerprint: CONFIG_A, loader: uncancellable }, c1.signal);
    await Promise.resolve();
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 另一份配置先成功并登记：域内此后只承认它。
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "sdk-b" })).resolves.toBe(
      "sdk-b",
    );
    expect(registry.activeFingerprint).toBe(CONFIG_B);

    // A 的任务晚到：不得把已登记的 B 改写成 A（域只能声称一份配置已就绪）。
    settleA("sdk-a");
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.activeFingerprint).toBe(CONFIG_B);
  });

  it("an uncancellable task keeps its entry and occupancy after the last consumer leaves", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    let settleA!: (value: string) => void;
    // 不可取消：signal 被 abort 也不结算（官方 Loader 就没有公开取消接口）。
    const uncancellable = vi.fn(() => new Promise<string>((resolve) => (settleA = resolve)));

    const a = registry.load(
      { fingerprint: CONFIG_A, loader: uncancellable, cancellable: false },
      c1.signal,
    );
    await Promise.resolve();
    c1.abort();
    await expect(a).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 任务不可取消 ⇒ 不能同步释放条目与占用：否则「已取消但仍在飞」的任务会与另一份配置
    // 同时进入同一全局冲突域。
    expect(registry.size).toBe(1);

    // 另一份配置在任务结算前必须被冲突拒绝，**不是**自己起一个加载。
    const b = vi.fn(async () => "sdk-b");
    await expect(registry.load({ fingerprint: CONFIG_B, loader: b })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });
    expect(b).not.toHaveBeenCalled();

    // 同指纹重新订阅复用原任务，不会重复发起。
    const again = registry.load({ fingerprint: CONFIG_A, loader: uncancellable });
    await Promise.resolve();
    expect(uncancellable).toHaveBeenCalledTimes(1);

    // 任务真正成功：保留的条目仍是当前条目 ⇒ 记账落在这份配置上。
    settleA("sdk-a");
    await expect(again).resolves.toBe("sdk-a");
    expect(registry.activeFingerprint).toBe(CONFIG_A);

    // 之后的同配置请求复用结果，其它配置继续冲突。
    await expect(registry.load({ fingerprint: CONFIG_A, loader: uncancellable })).resolves.toBe(
      "sdk-a",
    );
    await expect(registry.load({ fingerprint: CONFIG_B, loader: b })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });
  });

  it("an uncancellable task that fails frees the domain for the next config", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    let rejectA!: (error: Error) => void;
    const uncancellable = vi.fn(
      () => new Promise<string>((_resolve, reject) => (rejectA = reject)),
    );

    const a = registry.load(
      { fingerprint: CONFIG_A, loader: uncancellable, cancellable: false },
      c1.signal,
    );
    await Promise.resolve();
    c1.abort();
    await expect(a).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    rejectA(new Error("official load failed"));
    await Promise.resolve();
    await Promise.resolve();

    // 失败后条目与占用都要释放：否则域会被一个永远不会成功的任务永久占住。
    expect(registry.size).toBe(0);
    const b = vi.fn(async () => "sdk-b");
    await expect(registry.load({ fingerprint: CONFIG_B, loader: b })).resolves.toBe("sdk-b");
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("a stale success may fill the record when the in-flight config is the same one", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    let settleOld!: (value: string) => void;
    const oldTask = vi.fn(() => new Promise<string>((resolve) => (settleOld = resolve)));

    const first = registry.load({ fingerprint: CONFIG_A, loader: oldTask }, c1.signal);
    await Promise.resolve();
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 同一份配置的新任务在飞（占用仍是 A）：此时 stale 成功与当前占用**同指纹**，
    // 记录它是事实，不该被守卫挡住。
    let settleNew!: (value: string) => void;
    const newTask = vi.fn(() => new Promise<string>((resolve) => (settleNew = resolve)));
    const retried = registry.load({ fingerprint: CONFIG_A, loader: newTask });
    await Promise.resolve();

    settleOld("sdk-old");
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.activeFingerprint).toBe(CONFIG_A);

    settleNew("sdk-new");
    await expect(retried).resolves.toBe("sdk-new");
    expect(registry.activeFingerprint).toBe(CONFIG_A);
  });

  it("keeps enforcement after clear() and isolates domains", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    await registry.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    registry.clear();
    expect(registry.size).toBe(0);
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).rejects.toThrow(
      /config conflict/,
    );

    // 不同域各自持有一份「已就绪配置」，互不冲突。
    const other = new SdkRegistry({ domain: "BMapGL" });
    await expect(other.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe("b");
  });

  it("shares one registry per process domain and resets for tests", async () => {
    const first = getProcessSdkRegistry("BMap");
    const second = getProcessSdkRegistry("BMap");
    expect(second).toBe(first);

    const otherDomain = getProcessSdkRegistry("BMapGL");
    expect(otherDomain).not.toBe(first);

    await first.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    expect(first.activeFingerprint).toBe(CONFIG_A);
    expect(otherDomain.activeFingerprint).toBeUndefined();

    resetProcessSdkRegistryForTests();
    expect(getProcessSdkRegistry("BMap")).not.toBe(first);
  });
});
