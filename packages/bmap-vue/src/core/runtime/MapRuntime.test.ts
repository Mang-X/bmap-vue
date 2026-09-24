import { describe, it, expect, vi } from "vitest";
import { MapRuntime } from "./MapRuntime";
import { MAP_SUSPEND_REASONS } from "./suspension";
import { BMapError } from "../errors/BMapError";
import type { BMapClient } from "../../client/types";
import type { BMapDriver } from "../../driver/types/bmap";
import type { MapHandle } from "../../driver/types/handles";

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeClient(driverMap: unknown): BMapClient {
  const driver = {
    map: driverMap,
    capabilities: { supports: () => true, require: () => {}, list: () => [], explain: () => ({}) },
  } as unknown as BMapDriver;
  return {
    id: Symbol("fake-client"),
    // M3A3-REMOVE-LEGACY（#26）：engine 只剩 jsapi-v4；本文件的用例只关心 runtime 的
    // 生命周期编排，因此这里的 Client 是一个最小替身（metadata 三个维度都补齐）。
    engine: "jsapi-v4",
    libraryVersion: "test",
    sdkVersion: "test",
    version: "test",
    driver,
    capabilities: driver.capabilities,
    rawSdk: {},
  };
}

function createRuntime(overrides: Partial<MapRuntime["options"]> = {}) {
  const deferred = createDeferred<unknown>();
  const createMap = vi.fn((container: HTMLElement) => ({ id: "map-1", container }));
  const destroyMap = vi.fn((map: MapHandle) => map);
  const initializeView = vi.fn();
  const checkResize = vi.fn();
  const mapDriver = { create: createMap, destroy: destroyMap, initializeView, checkResize };
  const clientFactory = vi.fn(() => deferred.promise.then((loaded) => createFakeClient(mapDriver)));
  const rt = new MapRuntime({
    clientFactory: clientFactory as never,
    container: document.createElement("div"),
    ...overrides,
  });
  return { rt, deferred, clientFactory, mapDriver, createMap, destroyMap, checkResize };
}

/** 建到 ready 的公共前置（暂停相关用例都要一张真存在的地图）。 */
async function mountReady() {
  const ctx = createRuntime();
  const p = ctx.rt.mount();
  ctx.deferred.resolve({ ok: 1 });
  await p;
  return ctx;
}

describe("MapRuntime", () => {
  it("starts in idle and transitions waiting-client -> ready", async () => {
    const { rt, deferred, createMap } = createRuntime();
    expect(rt.status.value).toBe("idle");
    const p = rt.mount();
    expect(["waiting-client", "loading"]).toContain(rt.status.value);
    deferred.resolve({ Map: {} });
    const ctx = await p;
    expect(rt.status.value).toBe("ready");
    expect(ctx.client.engine).toBe("jsapi-v4");
    expect(ctx.map).toEqual(createMap.mock.results[0].value);
    expect(rt.map.value).toBeTruthy();
    expect(rt.handle.value).toBe(rt.map.value);
  });

  it("whenReady returns cached context when already ready", async () => {
    const { rt, deferred, createMap } = createRuntime();
    const p = rt.mount();
    deferred.resolve({ api: "x" });
    await p;
    const ctx = await rt.whenReady();
    expect(ctx.map).toEqual(createMap.mock.results[0].value);
  });

  it("whenReady before mount resolves after ready (回放 + 等待)", async () => {
    const { rt, deferred, createMap } = createRuntime();
    const before = rt.whenReady();
    const mount = rt.mount();
    deferred.resolve({ api: "x" });
    const ctx = await before;
    await mount;
    expect(ctx.map).toEqual(createMap.mock.results[0].value);
  });

  it("error status rejects waiters", async () => {
    const { rt, deferred } = createRuntime();
    const p = rt.mount();
    const waiter = rt.whenReady();
    deferred.reject(new Error("boom"));
    await expect(p).rejects.toThrow();
    await expect(waiter).rejects.toThrow();
    expect(rt.status.value).toBe("error");
  });

  it("dispose stops loading and rejects waiters with BMAP_RUNTIME_DISPOSED", async () => {
    const { rt, deferred } = createRuntime();
    const p = rt.mount();
    const waiter = rt.whenReady();
    rt.dispose();
    expect(rt.status.value).toBe("disposed");
    await expect(waiter).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
    deferred.resolve({}); // 晚到的 SDK 结果应被忽略(scope disposed)
    await expect(p).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
  });

  it("cannot re-mount after dispose", async () => {
    const { rt } = createRuntime();
    rt.dispose();
    await expect(rt.mount()).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
  });

  it("cannot mount twice concurrently without error (returns same pending)", async () => {
    const { rt, deferred } = createRuntime();
    const p1 = rt.mount();
    const p2 = rt.mount();
    expect(["waiting-client", "loading", "creating", "initializing"]).toContain(rt.status.value);
    deferred.resolve({ ok: 1 });
    await Promise.all([p1, p2]);
    expect(rt.status.value).toBe("ready");
  });

  it("destroys the map via driver on dispose", async () => {
    const { rt, deferred, destroyMap, createMap } = createRuntime();
    const p = rt.mount();
    deferred.resolve({ ok: 1 });
    await p;
    rt.dispose();
    expect(destroyMap).toHaveBeenCalledWith(createMap.mock.results[0].value);
  });

  // M3A2-MAP（#20）：initializeView 抛错时 map 还没写入 this.map.value，外层 catch 的
  // 「部分创建资源」分支取不到它；必须在抛错前销毁，否则泄漏一个已创建的 Map。
  it("destroys the map when initializeView throws", async () => {
    const { rt, deferred, destroyMap, createMap, mapDriver } = createRuntime({
      initialView: { center: { lng: 116.4, lat: 39.9 }, zoom: 12 },
    });
    mapDriver.initializeView.mockImplementation(() => {
      throw new Error("view boom");
    });

    const p = rt.mount();
    deferred.resolve({ ok: 1 });

    await expect(p).rejects.toMatchObject({ code: "BMAP_RESOURCE_CREATE_FAILED" });
    expect(destroyMap).toHaveBeenCalledWith(createMap.mock.results[0].value);
    expect(rt.map.value).toBeNull();
    expect(rt.status.value).toBe("error");
  });
});

/**
 * 暂停原因集合（M4-HANDLE-UX / issue #29）
 *
 * 三条口径各有用例钉住：
 * 1. **重叠原因不误恢复**：移除一个原因不能把别的原因一起抹掉；
 * 2. **暂停期间不下发 SDK 命令、不排帧**；
 * 3. **`disposed` 是终态原因**：卸载之后任何 `resume()` 都不能复活调用。
 */
describe("MapRuntime suspension reasons", () => {
  it("同一原因重复 suspend 只记一次（幂等）", async () => {
    const { rt } = await mountReady();
    rt.suspend("user");
    rt.suspend("user");
    expect(rt.suspendReasons()).toEqual(["user"]);
    rt.resume("user");
    expect(rt.isSuspended).toBe(false);
  });

  it("重叠原因：移除一个不会误恢复，清空后补偿一次 checkResize", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();

    rt.suspend("user");
    rt.suspend("document");
    expect(rt.suspendReasons().sort()).toEqual(["document", "user"]);

    // 页面恢复可见：只能移除 document —— 用户的手动暂停必须活着
    rt.resume("document");
    expect(rt.isSuspended).toBe(true);
    expect(checkResize).not.toHaveBeenCalled();

    rt.resume("user");
    expect(rt.isSuspended).toBe(false);
    expect(checkResize).toHaveBeenCalledTimes(1);
  });

  it("暂停期间 checkResize 是 no-op；requestResize 也不排帧", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();

    rt.suspend("offscreen");
    rt.checkResize();
    rt.requestResize();
    expect(checkResize).not.toHaveBeenCalled();

    rt.resume("offscreen");
    // 补偿一次（requestResize 那次没排帧，因此不是两次）
    expect(checkResize).toHaveBeenCalledTimes(1);
  });

  it("resume 一个未生效的原因不会恢复（防止误恢复）", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();
    rt.suspend("user");
    rt.resume("document");
    expect(rt.isSuspended).toBe(true);
    expect(checkResize).not.toHaveBeenCalled();
  });

  it("地图还没 ready 时 suspend 也记账（环境事实先于建图成立）", () => {
    const { rt } = createRuntime();
    rt.suspend("document");
    expect(rt.isSuspended).toBe(true);
    expect(rt.suspendReasons()).toEqual(["document"]);
  });

  it("dispose 之后不再调用 SDK：resume 不补偿、requestResize 不排帧、状态终态", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();

    rt.suspend("document");
    rt.dispose();
    expect(rt.suspendReasons()).toContain("disposed");
    expect(rt.status.value).toBe("disposed");

    rt.resume("document");
    rt.requestResize();
    rt.suspend("user");
    expect(rt.isSuspended).toBe(true);
    expect(checkResize).not.toHaveBeenCalled();
  });

  it('suspend("disposed") 被拒绝：公开 API 不该能把正常运行的地图永久锁死', async () => {
    const { rt } = await mountReady();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      rt.suspend(MAP_SUSPEND_REASONS.disposed);
      expect(rt.isSuspended, "disposed 只能由 dispose() 添加").toBe(false);
      expect(rt.suspendReasons()).toEqual([]);
      expect(
        warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes("disposed")),
        "拒绝要有可观察的告警（不静默）",
      ).toBe(true);

      // 一刀切拒绝不能把正常原因也砍掉
      rt.suspend(MAP_SUSPEND_REASONS.user);
      expect(rt.isSuspended).toBe(true);
      rt.resume(MAP_SUSPEND_REASONS.user);
      expect(rt.isSuspended).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("disposed 是终态原因：resume 不能把它摘掉", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();

    rt.dispose();
    rt.resume("disposed");
    expect(rt.suspendReasons(), "disposed 必须留在集合里（否则「卸载后不再调 SDK」退化成人肉约定）").toContain(
      "disposed",
    );
    expect(rt.isSuspended, "集合非空 ⇒ 仍处于暂停").toBe(true);

    rt.checkResize();
    expect(checkResize).not.toHaveBeenCalled();
  });

  it("resume 恰好补偿一次：先撤掉队列里残留的尺寸任务（不会「残留 + 补偿」两条命令）", async () => {
    const { rt, checkResize } = await mountReady();
    checkResize.mockClear();

    // 排进合帧队列（还没到帧边界）→ 暂停 → 恢复
    rt.requestResize();
    rt.suspend("document");
    rt.resume("document");

    expect(
      checkResize,
      "恢复时如果只 resume 调度器，队列里那份尺寸任务会先提交一次、补偿再提交一次（评审实测 2 次）",
    ).toHaveBeenCalledTimes(1);
  });
});
