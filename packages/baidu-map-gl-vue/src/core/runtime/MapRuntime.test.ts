import { describe, it, expect, vi } from "vitest";
import { MapRuntime } from "./MapRuntime";
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
  const mapDriver = { create: createMap, destroy: destroyMap, initializeView };
  const clientFactory = vi.fn(() => deferred.promise.then((loaded) => createFakeClient(mapDriver)));
  const rt = new MapRuntime({
    clientFactory: clientFactory as never,
    container: document.createElement("div"),
    ...overrides,
  });
  return { rt, deferred, clientFactory, mapDriver, createMap, destroyMap };
}

describe("MapRuntime", () => {
  it("starts in idle and transitions waiting-client -> ready", async () => {
    const { rt, deferred, createMap } = createRuntime();
    expect(rt.status.value).toBe("idle");
    const p = rt.mount();
    expect(["waiting-client", "loading"]).toContain(rt.status.value);
    deferred.resolve({ BMap: {} });
    const ctx = await p;
    expect(rt.status.value).toBe("ready");
    expect(ctx.client.engine).toBe("jsapi-v4");
    expect(ctx.map).toEqual(createMap.mock.results[0].value);
    expect(rt.map.value).toBeTruthy();
    expect(rt.handle.value).toBe(rt.map.value);
    expect(rt.scope).toBe(rt.resources);
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
