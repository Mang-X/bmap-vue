/**
 * Fake v4 的异步时序与生命周期门禁（M3A3-FAKE-DUAL / issue #24）
 *
 * issue #24 要求 Fake「支持测试主动触发 SDK 回调、事件、失败和延迟」，并要求诊断计数能当
 * 生命周期门禁用。三件事在这里固定：
 *
 * 1. **迟到回包**：取消 / 超时之后 SDK 仍会回包（真实 JSONP 的真语义），Fake 必须能造出这个顺序，
 *    否则「不复活已取消的调用」这条断言根本无从下手；
 * 2. **失败重试**：服务失败与 SDK 销毁失败都要保留记账户头，重试成功才销账；
 * 3. **target 切换**：同一份资源在两个 Map 之间移动时，诊断计数不能跟着翻倍或漏减。
 *
 * 最后一组是 driver 层的 100 次「建图 → 挂载 → 摘除 → 销毁」循环：它是组件层同名门禁
 * （`v3-dual-driver-components.test.ts`）的底座——组件层跑不通时，先看这里。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createFakeBMapV4,
  createFakeV4Client,
  FAKE_V4_RUNTIME_INJECTED_MEMBERS,
  type FakeBMapV4,
} from "../../packages/test-utils";
import type { JsapiV4Driver } from "../../packages/baidu-map-gl-vue/src/driver/types/bmap";
import type { OverlayTarget } from "../../packages/baidu-map-gl-vue/src/driver/types/overlays";
import type { FakeV4Map } from "../../packages/test-utils";

const POINT = { lng: 116.404, lat: 39.915 };

let fake: FakeBMapV4;
let driver: JsapiV4Driver;

function container(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  return el;
}

function input(): HTMLInputElement {
  const el = document.createElement("input");
  el.readOnly = true;
  document.body.appendChild(el);
  return el;
}

beforeEach(async () => {
  const created = await createFakeV4Client();
  fake = created.fake;
  // Client 的 `driver` 静态类型是共享的 `BMapDriver`；`createFakeV4Client` 走的是默认 v4 工厂，
  // 因此这里收窄成 `JsapiV4Driver` 才能用 v4 独有的 service / panorama 面
  driver = created.client.driver as JsapiV4Driver;
  fake.diagnostics.reset();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/* -------------------------------------------------------------- 迟到回调 */

describe("Fake v4 异步窗口：迟到回调", () => {
  it("取消之后的迟到回包不复活调用，且异步窗口在诊断里结算", async () => {
    const geocoder = driver.services.createGeocoder();
    const raw = fake.createdGeocoders[0]!;
    // 手动时序：回包进入队列，由用例决定何时到达（真实 JSONP 的「请求已发、回包未到」）
    raw.queue.auto = false;

    const call = driver.services.geocode(geocoder, { address: "北京市海淀区中关村" });
    expect(fake.diagnostics.pendingAsync().callbacks, "回包已派出、尚未到达").toBe(1);

    call.cancel();
    const settled = await call.result;
    expect(settled.status).toBe("canceled");

    // 迟到回包：此刻已经取消，结果必须保持 canceled、data 保持 null
    raw.queue.flush();
    expect((await call.result).status).toBe("canceled");
    expect((await call.result).data).toBeNull();
    // 回包结算之后「在飞」归零（`pendingAsync` 不进泄漏门禁，但这里必须能被断言）
    expect(fake.diagnostics.pendingAsync().callbacks).toBe(0);
    expect(fake.diagnostics.snapshot().activity).toMatchObject({
      callbacksQueued: 1,
      callbacksSettled: 1,
    });
  });

  it("延迟回包用定时器建模：延迟窗口计入 timer 口径，落地后归零", async () => {
    const geocoder = driver.services.createGeocoder();
    fake.createdGeocoders[0]!.queue.delay = 20;

    vi.useFakeTimers();
    const call = driver.services.geocode(geocoder, { address: "北京市海淀区中关村" });
    expect(fake.diagnostics.pendingAsync().timers, "延迟回包窗口").toBe(1);

    vi.advanceTimersByTime(20);
    const settled = await call.result;
    expect(settled.status).toBe("success");
    expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
    expect(fake.diagnostics.snapshot().activity).toMatchObject({
      timersScheduled: 1,
      timersFired: 1,
    });
  });

  it("同一张地图重复打开气泡时，被顶掉的实例不再记成泄漏", () => {
    const map = driver.map.create(container());
    const first = driver.overlays.createInfoWindow(document.createElement("div"), {});
    const second = driver.overlays.createInfoWindow(document.createElement("div"), {});

    driver.overlays.openInfoWindow(map, first, POINT);
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1);
    driver.overlays.openInfoWindow(map, second, POINT);
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1);

    driver.overlays.closeInfoWindow(second);
    driver.map.destroy(map);
    fake.diagnostics.assertNoLeaks("InfoWindow 顶替");
  });
});

/* -------------------------------------------------------------- 失败重试 */

describe("Fake v4 异步窗口：失败与重试", () => {
  it("服务失败只回 null（没有公开错误码入口）：调用以 empty 结算，重试可成功", async () => {
    const geocoder = driver.services.createGeocoder();
    const raw = fake.createdGeocoders[0]!;
    // 真实服务失败的形态是「回调参数就是 `null`」——错误码只在私有回调注册表里，
    // 而本库不嗅探私有面（R25-C / #72）。这里断言的是 Fake 侧异步窗口的收支。
    raw.pointResult = null;

    const unavailable = await driver.services.geocode(geocoder, { address: "北京市" }).result;
    expect(unavailable.status).toBe("empty");
    expect(unavailable.error).toBeNull();
    // 失败与成功都要把在飞窗口收干净，否则诊断会在重试前就一直挂着
    expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });

    raw.pointResult = POINT;
    const retried = await driver.services.geocode(geocoder, { address: "北京市" }).result;
    expect(retried.status).toBe("success");
    expect(retried.data).toEqual(POINT);
    expect(fake.diagnostics.snapshot().activity).toMatchObject({
      callbacksQueued: 2,
      callbacksSettled: 2,
    });
  });

  it("SDK dispose 失败时保留记账户头，重试成功才销账", () => {
    const handle = driver.services.createAutocomplete({ input: input() });
    const raw = fake.createdAutocompletes[0]!;
    expect(fake.diagnostics.snapshot().leaks.autocompletes).toBe(1);

    raw.failNextDispose = new Error("dispose failed");
    expect(() => driver.services.disposeAutocomplete(handle)).toThrow(/dispose failed/);
    expect(fake.diagnostics.snapshot().leaks.autocompletes, "失败不销账").toBe(1);
    expect(fake.diagnostics.snapshot().activity.autocompletesDisposed).toBe(0);

    driver.services.disposeAutocomplete(handle);
    expect(fake.diagnostics.snapshot().leaks.autocompletes).toBe(0);
    // 重试真的再次打到 SDK，而不是靠本地记账短路
    expect(raw.callLog.filter((entry) => entry === "dispose")).toHaveLength(2);
  });

  it("全景销毁失败重试：Panorama 的资源账与 SDK 调用次数一致", () => {
    const viewer = driver.panorama.create(container());
    const raw = fake.createdPanoramas[0]!;

    raw.failNextDestroy = new TypeError("Cannot read properties of undefined (reading 'START')");
    // 驱动侧把 SDK 异常包成 BMapError（保留 cause），这里只断言「失败了、且账没销」
    expect(() => driver.panorama.destroy(viewer)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(fake.diagnostics.snapshot().leaks.panoramas).toBe(1);

    driver.panorama.destroy(viewer);
    expect(raw.destroyCalls, "真正打到 SDK 的 destroy 只有成功那次").toBe(1);
    // Driver 自己记账，重复销毁是短路（不再打到 SDK）——诊断不因此重复销账
    driver.panorama.destroy(viewer);
    expect(raw.destroyCalls).toBe(1);
    fake.diagnostics.assertNoLeaks("全景重试");
  });
});

/* ------------------------------------------------------------ target 切换 */

describe("Fake v4 target 切换", () => {
  it("同一覆盖物在两张地图之间移动：计数不翻倍、也不漏减", () => {
    const mapA = driver.map.create(container());
    const mapB = driver.map.create(container());
    const targetA: OverlayTarget = { kind: "map", handle: mapA };
    const targetB: OverlayTarget = { kind: "map", handle: mapB };
    const marker = driver.overlays.createMarker(POINT);

    driver.overlays.add(targetA, marker);
    expect((mapA.raw as FakeV4Map).overlays).toHaveLength(1);
    expect(fake.diagnostics.snapshot().leaks.overlays).toBe(1);

    driver.overlays.remove(targetA, marker);
    driver.overlays.add(targetB, marker);
    expect((mapA.raw as FakeV4Map).overlays).toHaveLength(0);
    expect((mapB.raw as FakeV4Map).overlays).toHaveLength(1);
    expect(fake.diagnostics.snapshot().leaks.overlays, "移动不是复制").toBe(1);
    expect(fake.diagnostics.snapshot().activity).toMatchObject({
      overlaysAttached: 2,
      overlaysDetached: 1,
    });

    driver.overlays.remove(targetB, marker);
    expect(fake.diagnostics.snapshot().leaks.overlays).toBe(0);
    driver.map.destroy(mapA);
    driver.map.destroy(mapB);
    fake.diagnostics.assertNoLeaks("target 切换");
  });

  it("控件与图层在目标之间移动时同样只挂一次", () => {
    const mapA = driver.map.create(container());
    const mapB = driver.map.create(container());
    const targetA: OverlayTarget = { kind: "map", handle: mapA };
    const targetB: OverlayTarget = { kind: "map", handle: mapB };

    const control = driver.controls.create("scale");
    driver.controls.add(targetA, control);
    driver.controls.add(targetA, control); // 重复 add 不重复挂载（Driver 记账）
    expect((mapA.raw as FakeV4Map).controls).toHaveLength(1);

    driver.controls.remove(targetA, control);
    driver.controls.add(targetB, control);
    expect((mapB.raw as FakeV4Map).controls).toHaveLength(1);
    expect(fake.diagnostics.snapshot().leaks.controls).toBe(1);

    const layer = driver.layers.create("tile");
    driver.layers.add(targetA, layer);
    driver.layers.remove(targetA, layer);
    driver.layers.add(targetB, layer);
    expect((mapB.raw as FakeV4Map).layers).toHaveLength(1);

    driver.controls.remove(targetB, control);
    driver.layers.remove(targetB, layer);
    driver.map.destroy(mapA);
    driver.map.destroy(mapB);
    fake.diagnostics.assertNoLeaks("控件/图层 target 切换");
  });
});

/* -------------------------------------------------- 可控注入时机（运行时扩展） */

describe("Fake v4 可控注入时机：运行时扩展成员", () => {
  it("卸下扩展成员后同一 Driver 的结论随之变化，装回即恢复", async () => {
    // 这条用的是一份独立 Fake：运行时注入是**命名空间级**的突变，不该借给别的用例共享
    const local = createFakeBMapV4();
    const { client } = await createFakeV4Client(local);
    const nativeLayers = (client.driver as JsapiV4Driver).nativeLayers;
    const namespace = local.namespace as unknown as Record<string, unknown>;

    // 注入前：扩展 API 的构造器不在命名空间里 → 按「不支持」失败（不是 SDK 调用失败）
    expect(local.runtimeExtensions.uninstall("PointLayer")).toBe(true);
    expect(namespace.PointLayer).toBeUndefined();
    expect(() => nativeLayers.create("point")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );

    // 装回：**同一个** Driver（没有重建）必须立刻能创建——能力结论不在构造期冻结
    expect(local.runtimeExtensions.install("PointLayer")).toBe(true);
    expect(nativeLayers.create("point").raw).toBeTruthy();

    // 名单只覆盖「运行时注入」的成员：声明的四类（`LineLayer` 等）是普通构造器，
    // 「缺成员时抛 BMAP_SDK_CALL_FAILED」那条分支由 `jsapi-v4/native-layers.test.ts` 的引擎单测负责
    expect(FAKE_V4_RUNTIME_INJECTED_MEMBERS).toContain("PointLayer");
    expect(FAKE_V4_RUNTIME_INJECTED_MEMBERS).not.toContain("LineLayer");

    // 幂等 + 可枚举 + 可整体恢复（忘记恢复会污染后续用例，因此引擎 reset 会调用 restoreAll）
    expect(local.runtimeExtensions.install("PointLayer")).toBe(false);
    expect(local.runtimeExtensions.uninstall("Heatmap")).toBe(true);
    expect(local.runtimeExtensions.uninstalled()).toEqual(["Heatmap"]);
    local.runtimeExtensions.restoreAll();
    expect(local.runtimeExtensions.uninstalled()).toEqual([]);
    expect(() => nativeLayers.create("heatmap")).not.toThrow();
  });
});

/* -------------------------------------------------- 生命周期门禁（driver 层） */

describe("Fake v4 生命周期门禁：100 次挂载 / 卸载", () => {
  it("100 次「建图 → 挂载三件套 → 摘除 → 销毁」之后 leaks 全归零", () => {
    for (let i = 0; i < 100; i++) {
      const map = driver.map.create(container());
      const target: OverlayTarget = { kind: "map", handle: map };

      const marker = driver.overlays.createMarker(POINT);
      const control = driver.controls.create("zoom");
      const layer = driver.layers.create("tile");
      driver.overlays.add(target, marker);
      driver.controls.add(target, control);
      driver.layers.add(target, layer);
      // 业务事件订阅也必须走释放路径（否则诊断里 listeners 会逐轮累积）
      const dispose = driver.events.on(map, "click", () => {});
      dispose();

      driver.overlays.remove(target, marker);
      driver.controls.remove(target, control);
      driver.layers.remove(target, layer);
      driver.map.destroy(map);
    }

    fake.diagnostics.assertNoLeaks("100 次挂载/卸载");
    const { activity, leaks } = fake.diagnostics.snapshot();
    expect(leaks.maps).toBe(0);
    expect(activity).toMatchObject({
      mapsCreated: 100,
      overlaysAttached: 100,
      overlaysDetached: 100,
      controlsAttached: 100,
      controlsDetached: 100,
      layersAttached: 100,
      layersDetached: 100,
    });
    // 监听器：100 次绑定、100 次解绑 → 存活 0，且没有多余重绑
    expect(activity.listenCalls).toBe(activity.unlistenCalls);
    expect(activity.listenCalls).toBeGreaterThanOrEqual(100);
    expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
  });

  it("map.destroy() 会释放 Driver 侧订阅（遗漏解绑也不会残留）", () => {
    for (let i = 0; i < 20; i++) {
      const map = driver.map.create(container());
      driver.events.on(map, "moveend", () => {});
      driver.events.on(map, "zoomend", () => {});
      expect(fake.diagnostics.snapshot().leaks.listeners).toBe(2);
      driver.map.destroy(map);
    }
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0);
    fake.diagnostics.assertNoLeaks("destroy 释放订阅");
  });
});
