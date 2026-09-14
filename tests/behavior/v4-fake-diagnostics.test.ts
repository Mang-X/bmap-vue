/**
 * Fake BMap v4 诊断计数器（M3A3-FAKE-DUAL / issue #24）
 *
 * 这一层验证的是「诊断本身」：计数器是否真的跟着 Fake 的生命周期变化、`assertNoLeaks()`
 * 会不会空转、`reset()` 是否可清零。**行为语义**的断言（迟到回调、失败重试、target 切换
 * 之后的结算）放在 `v4-fake-async-lifecycle.test.ts`。
 *
 * 为什么值得单独一层：诊断计数一旦失真，后面所有「无泄漏」断言都会变成空转——
 * 它自己也需要被反向验证（「忘记摘除时必须报泄漏」）。
 */
import { describe, it, expect } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import type { FakeV4LeakCounters } from "../../packages/test-utils/fake-bmap-v4";

function container(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

function zeroLeaks(): FakeV4LeakCounters {
  return {
    maps: 0,
    overlays: 0,
    infoWindows: 0,
    contextMenus: 0,
    controls: 0,
    layers: 0,
    panoramas: 0,
    autocompletes: 0,
    localSearchResults: 0,
    listeners: 0,
  };
}

let fake: FakeBMapV4;

describe("Fake v4 diagnostics：资源计数", () => {
  fake = createFakeBMapV4();

  it("创建即计数：Map / Overlay / Control / Layer 各自进自己的桶", () => {
    const d = fake.diagnostics;
    d.reset();

    const map = new fake.namespace.Map(container());
    expect(d.snapshot().leaks.maps).toBe(1);

    const marker = new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9));
    const zoom = new fake.namespace.ZoomControl();
    const tile = new fake.namespace.TileLayer();

    // 构造 ≠ 挂载：未挂载的实例不进 leaks（它们没有可断言的「释放路径」）
    expect(d.snapshot().leaks.overlays).toBe(0);
    expect(d.snapshot().leaks.controls).toBe(0);
    expect(d.snapshot().leaks.layers).toBe(0);

    map.addOverlay(marker);
    map.addControl(zoom);
    map.addLayer(tile);
    expect(d.snapshot().leaks).toMatchObject({ overlays: 1, controls: 1, layers: 1 });
    expect(d.snapshot().activity).toMatchObject({
      overlaysAttached: 1,
      controlsAttached: 1,
      layersAttached: 1,
    });

    map.removeOverlay(marker);
    map.removeControl(zoom);
    map.removeLayer(tile);
    expect(d.snapshot().leaks).toMatchObject({ overlays: 0, controls: 0, layers: 0 });
    expect(d.snapshot().activity).toMatchObject({
      overlaysDetached: 1,
      controlsDetached: 1,
      layersDetached: 1,
    });

    map.destroy();
    expect(d.assertNoLeaks()).toEqual(zeroLeaks());
  });

  it("重复挂载按 SDK 事实计数（不去重）：一次摘除之后仍剩 1 —— 记账错误不会被掩盖", () => {
    const d = fake.diagnostics;
    d.reset();
    const map = new fake.namespace.Map(container());
    const control = new fake.namespace.ZoomControl();

    // SDK 本身不去重（「同一实例只添加一次」是调用方的责任，见 FakeV4Map.addControl 注释）
    map.addControl(control);
    map.addControl(control);
    expect(d.snapshot().leaks.controls).toBe(2);

    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(1);

    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(0);
    // 多摘一次不该把计数打成负数
    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(0);
  });

  it("destroy 不代为摘除子资源：漏摘会被 assertNoLeaks 抓住（反证门禁不空转）", () => {
    const d = fake.diagnostics;
    d.reset();
    const map = new fake.namespace.Map(container());
    map.addOverlay(new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9)));
    map.destroy();

    expect(d.snapshot().leaks.maps, "map 已销毁").toBe(0);
    expect(d.snapshot().leaks.overlays, "覆盖物没有随 map 一起消失").toBe(1);
    expect(() => d.assertNoLeaks()).toThrow(/overlays=1/);
  });

  it("InfoWindow / ContextMenu 按「当前是否挂在地图上」计数", () => {
    const d = fake.diagnostics;
    d.reset();
    const map = new fake.namespace.Map(container());
    const iw = new fake.namespace.InfoWindow("content");
    const menu = new fake.namespace.ContextMenu();

    map.openInfoWindow(iw, new fake.namespace.Point(116.4, 39.9));
    map.addContextMenu(menu);
    expect(d.snapshot().leaks).toMatchObject({ infoWindows: 1, contextMenus: 1 });

    map.closeInfoWindow();
    map.removeContextMenu(menu);
    expect(d.snapshot().leaks).toMatchObject({ infoWindows: 0, contextMenus: 0 });
    expect(d.snapshot().activity).toMatchObject({
      infoWindowsOpened: 1,
      infoWindowsReleased: 1,
      contextMenusAttached: 1,
      contextMenusDetached: 1,
    });
  });

  it("监听器存活数沿用事件统计口径，reset() 之后全部清零", () => {
    const d = fake.diagnostics;
    d.reset();
    const map = new fake.namespace.Map(container());
    const listener = () => {};
    map.addEventListener("click", listener);

    expect(d.snapshot().leaks.listeners).toBe(1);
    expect(d.snapshot().activity).toMatchObject({ listenCalls: 1, unlistenCalls: 0 });

    map.removeEventListener("click", listener);
    expect(d.snapshot().leaks.listeners).toBe(0);

    map.addEventListener("click", () => {});
    map.destroy();
    expect(d.assertNoLeaks()).toEqual(zeroLeaks());

    // reset 之后累计口径也归零（「可清零的 diagnostics」）
    d.reset();
    expect(d.snapshot().activity).toMatchObject({ listenCalls: 0, unlistenCalls: 0 });
    expect(d.snapshot().leaks).toEqual(zeroLeaks());
  });
});

describe("Fake v4 diagnostics：服务与全景的资源口径", () => {
  fake = createFakeBMapV4();

  it("无销毁入口的基础服务只进 created 口径，不进泄漏门禁", () => {
    const d = fake.diagnostics;
    d.reset();
    new fake.namespace.Geocoder();
    new fake.namespace.Convertor();

    const { leaks, activity } = d.snapshot();
    expect(activity.servicesCreated).toBe(2);
    // 官方 4.0 里 Geocoder / Convertor 没有 destroy/dispose —— 它们随 Client 由 GC 回收，
    // 把「没有释放入口的对象」算进泄漏门禁会让门禁永远无法归零
    expect(leaks).toEqual(zeroLeaks());
  });

  it("Autocomplete / Panorama 有销毁入口、LocalSearch 的结果集有清理入口，成功才销账", () => {
    const d = fake.diagnostics;
    d.reset();
    document.body.innerHTML = "";
    const input = document.createElement("input");
    document.body.appendChild(input);

    const autocomplete = new fake.namespace.Autocomplete({ input });
    const panorama = new fake.namespace.Panorama(container());
    const localSearch = new fake.namespace.LocalSearch("北京市");
    // **实例本身不进泄漏门禁**：官方 LocalSearch 没有 dispose()（只有 clearResults()），
    // 所以构造不记账 —— 真正的资源是它交付出去的结果集，见下面的 `search()`
    expect(d.snapshot().leaks).toMatchObject({
      autocompletes: 1,
      panoramas: 1,
      localSearchResults: 0,
    });
    expect(d.snapshot().activity.servicesCreated).toBe(1);

    // 检索交付一份结果集 ⇒ 未清理前算一份未释放资源
    localSearch.search("餐厅");
    expect(d.snapshot().leaks.localSearchResults).toBe(1);

    // 销毁失败必须保留记账户头，否则「失败不记账、可以重试」那条契约无法被诊断观测
    panorama.failNextDestroy = new TypeError("destroy failed");
    expect(() => panorama.destroy()).toThrow();
    expect(d.snapshot().leaks.panoramas).toBe(1);

    localSearch.failNextClearResults = new Error("clearResults failed");
    expect(() => localSearch.clearResults()).toThrow();
    expect(d.snapshot().leaks.localSearchResults, "失败不销账").toBe(1);

    panorama.destroy();
    autocomplete.dispose();
    localSearch.clearResults();
    expect(d.assertNoLeaks()).toEqual(zeroLeaks());
    expect(d.snapshot().activity).toMatchObject({
      panoramasCreated: 1,
      panoramasDestroyed: 1,
      autocompletesCreated: 1,
      autocompletesDisposed: 1,
      localSearchResultsDrawn: 1,
      localSearchResultsCleared: 1,
    });
  });
});

describe("Fake v4 diagnostics：重复销毁不能抵消别的实例的泄漏（PR #66 复审 P2-1）", () => {
  fake = createFakeBMapV4();

  it("两个 Panorama：重复销毁 A 一次，B 的泄漏必须还在", () => {
    const d = fake.diagnostics;
    d.reset();
    const a = new fake.namespace.Panorama(container());
    const b = new fake.namespace.Panorama(container());
    expect(d.snapshot().leaks.panoramas).toBe(2);

    // 调用方错误：同一个实例销毁两次。Fake 刻意保留「每次都真的打到 SDK」的语义
    // （`destroyCalls` 记 2、`callLog` 记两条），因此诊断必须自己按**实例**去重。
    a.destroy();
    a.destroy();
    expect(a.destroyCalls).toBe(2);
    expect(b.destroyCalls).toBe(0);

    expect(d.snapshot().leaks.panoramas, "B 从未销毁，泄漏不能被 A 的重复销毁抵消").toBe(1);
    expect(d.snapshot().activity.panoramasDestroyed, "实例只销一次账").toBe(1);
    expect(() => d.assertNoLeaks()).toThrow(/panoramas=1/);

    b.destroy();
    d.assertNoLeaks();
  });

  it("两个 Autocomplete：重复 dispose A 一次，B 的泄漏必须还在", () => {
    const d = fake.diagnostics;
    d.reset();
    document.body.innerHTML = "";
    const input = () => {
      const el = document.createElement("input");
      el.readOnly = true;
      document.body.appendChild(el);
      return el;
    };
    const a = new fake.namespace.Autocomplete({ input: input() });
    const b = new fake.namespace.Autocomplete({ input: input() });
    expect(d.snapshot().leaks.autocompletes).toBe(2);

    a.dispose();
    a.dispose();
    expect(a.callLog.filter((entry) => entry === "dispose"), "SDK 侧确实被调了两次").toHaveLength(2);

    expect(d.snapshot().leaks.autocompletes, "B 从未 dispose，泄漏不能被 A 的重复 dispose 抵消").toBe(1);
    expect(d.snapshot().activity.autocompletesDisposed).toBe(1);

    b.dispose();
    d.assertNoLeaks();
  });

  it("反证：同一实例的重复销毁不会让总数变成负数（attachment 类仍按次数销账）", () => {
    const d = fake.diagnostics;
    d.reset();
    const map = new fake.namespace.Map(container());
    const control = new fake.namespace.ZoomControl();

    map.addControl(control);
    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(0);
    // 未挂载实例的重复 remove 是 no-op（SDK 侧同样是 no-op），不会把计数打成负数
    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(0);

    // 而「同一实例挂两次」按 SDK 事实记账：两次 remove 才归零（这项语义不能被上面的实例去重改掉）
    map.addControl(control);
    map.addControl(control);
    expect(d.snapshot().leaks.controls).toBe(2);
    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(1);
    map.removeControl(control);
    expect(d.snapshot().leaks.controls).toBe(0);

    map.destroy();
    d.assertNoLeaks();
  });
});
