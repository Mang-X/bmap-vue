/**
 * v4 MapDriver（M3A2-MAP / issue #20）
 *
 * 验收点（对应 issue #20 的「测试要求」）：
 * - 创建 / 销毁与**零尺寸容器**行为；
 * - center / zoom / heading / tilt round-trip；
 * - 投影转换与 bounds / size；
 * - 交互开关对全部语义项生效且幂等；
 * - destroy 释放业务资源，destroy 之后的命令按 `BMAP_RESOURCE_DISPOSED` 拒绝；
 * - 项目 MapOptions → v4 构造 options 的显式映射（不依赖 SDK 隐式默认）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeV4Map, createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { MAP_INTERACTIONS } from "../../../../test-utils/driver-contract";
import { createCapabilityRegistry } from "../capability/registry";
import type { MapDriver, MapInteraction } from "../types/map";
import { createJsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4MapDriver } from "./map";
import { createJsapiV4HandleRegistry } from "./registry";

/**
 * 交互名 → Fake 侧（官方方法名派生的）状态键。
 *
 * 刻意**独立于实现**手写一份：这是「语义名 → 官方方法名」的期望值，不能从被测实现里导出，
 * 否则测试只是在复述实现。
 */
const INTERACTION_STATE_KEYS: Record<MapInteraction, string> = {
  dragging: "dragging",
  "scroll-zoom": "scrollWheelZoom",
  "inertial-dragging": "inertialDragging",
  "pinch-zoom": "pinchToZoom",
  keyboard: "keyboard",
  "double-click-zoom": "doubleClickZoom",
  "continuous-zoom": "continuousZoom",
  "resize-on-center": "resizeOnCenter",
  rotate: "rotate",
  "rotate-gestures": "rotateGestures",
  tilt: "tilt",
  "tilt-gestures": "tiltGestures",
};

/**
 * v4 的成对方法里，`tilt-gestures` 的存在性在官方来源之间有分歧：
 * 官方 4.0 API 参考与 4.0.4 类型包未声明 `enableTiltGestures()`，
 * 而公开的 React 参考实现（`huiyan-fe/react-bmap`）直接调用它。
 * 因此实现不预判，改为「有就调、没有就告警一次」——两条来源都不会让它静默失效。
 */

/** 等 SDK 侧异步步骤（动画的内部 setTimeout 启动、animationstart 之后的微任务）落地。 */
const sleep = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(overrides: { width?: string; height?: string; unsupported?: "throw" | "warn" | "silent" } = {}) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const events = createJsapiV4EventDriver({ registry, geometry });
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: overrides.unsupported ?? "throw",
  });
  const map: MapDriver = createJsapiV4MapDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
    events,
  });
  const container = document.createElement("div");
  container.style.width = overrides.width ?? "640px";
  container.style.height = overrides.height ?? "480px";
  document.body.appendChild(container);
  return { fake, registry, geometry, events, capabilities, map, container };
}

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

describe("创建与销毁", () => {
  it("用 HTMLElement 容器创建，映射项目 MapOptions 为 v4 构造 options", () => {
    const { map, container, fake } = setup({
      width: "320px",
      height: "200px",
    });
    const handle = map.create(container, {
      minZoom: 5,
      maxZoom: 18,
      displayOptions: { poi: false },
    });

    expect(handle.raw).toBe(fake.createdMaps[0]);
    // 同名的项目键直接映射
    expect(fake.createdMaps[0].options).toMatchObject({
      minZoom: 5,
      maxZoom: 18,
      displayOptions: { poi: false },
    });
    // 库固定默认写进构造 options，不依赖 v4 的隐式默认
    expect(fake.createdMaps[0].options.enableDragging).toBe(true);
    expect(fake.createdMaps[0].options.enableWheelZoom).toBe(false);
  });

  it("v4 无对应项的项目键被丢弃（不透传，靠 warn 可观测）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, container, fake } = setup();
    map.create(container, { restrictCenter: true, backgroundColor: [0, 0, 0, 0] });

    expect(fake.createdMaps[0].options).not.toHaveProperty("restrictCenter");
    expect(fake.createdMaps[0].options).not.toHaveProperty("backgroundColor");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("零尺寸容器可以创建、读取尺寸，容器变大后 checkResize 得到新尺寸", () => {
    const { map, container, fake } = setup({ width: "0px", height: "0px" });
    const handle = map.create(container);
    expect(map.getSize(handle)).toEqual({ width: 0, height: 0 });

    container.style.width = "400px";
    container.style.height = "300px";
    map.checkResize(handle);
    expect(map.getSize(handle)).toEqual({ width: 400, height: 300 });
    expect(fake.createdMaps[0].resizeCalls).toBe(1);

    map.destroy(handle);
    expect(fake.createdMaps[0].destroyed).toBe(true);
  });

  it("destroy 幂等，并释放 EventDriver 在该地图上的订阅分组", () => {
    const { map, container, events, fake } = setup();
    const handle = map.create(container);
    events.on(handle, "click", () => {});
    expect(fake.stats.liveListeners).toBe(1);

    map.destroy(handle);
    map.destroy(handle);

    expect(fake.createdMaps[0].destroyed).toBe(true);
    expect(fake.stats.liveListeners).toBe(0);
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("destroy 之后的**每一个**命令都按 BMAP_RESOURCE_DISPOSED 拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    map.destroy(handle);

    // 覆盖 MapDriver 的全部成员：任何漏加守卫的成员都会在这里暴露
    const commands: Array<[string, () => unknown]> = [
      ["initializeView", () => map.initializeView(handle, { center: { lng: 1, lat: 1 }, zoom: 1 })],
      ["setCenter", () => map.setCenter(handle, { lng: 116.5, lat: 39.9 })],
      ["getCenter", () => map.getCenter(handle)],
      ["setZoom", () => map.setZoom(handle, 12)],
      ["getZoom", () => map.getZoom(handle)],
      ["setHeading", () => map.setHeading(handle, 30)],
      ["getHeading", () => map.getHeading(handle)],
      ["setTilt", () => map.setTilt(handle, 30)],
      ["getTilt", () => map.getTilt(handle)],
      ["getBounds", () => map.getBounds(handle)],
      ["getSize", () => map.getSize(handle)],
      ["pointToPixel", () => map.pointToPixel(handle, { lng: 116.4, lat: 39.9 })],
      ["pixelToPoint", () => map.pixelToPoint(handle, { x: 10, y: 20 })],
      ["panTo", () => map.panTo(handle, { lng: 116.4, lat: 39.9 })],
      ["panBy", () => map.panBy(handle, { x: 10, y: 20 })],
      ["fitBounds", () =>
        map.fitBounds(handle, {
          southwest: { lng: 116.2, lat: 39.7 },
          northeast: { lng: 116.6, lat: 40.1 },
        })],
      ["setViewport", () => map.setViewport(handle, [{ lng: 116.4, lat: 39.9 }])],
      ["checkResize", () => map.checkResize(handle)],
      ["setMapType", () => map.setMapType(handle, "normal")],
      ["setMapStyle", () => map.setMapStyle(handle, { styleId: "s" })],
      ["setInteraction", () => map.setInteraction(handle, "dragging", true)],
      ["setTraffic", () => map.setTraffic(handle, true)],
      ["startViewAnimation", () => map.startViewAnimation(handle, { frames: [] })],
      ["cancelViewAnimation", () => map.cancelViewAnimation(handle, { frames: [] })],
      ["destroy（幂等，不抛）", () => map.destroy(handle)],
    ];

    for (const [name, command] of commands) {
      if (name.startsWith("destroy")) {
        expect(command, name).not.toThrow();
        continue;
      }
      expect(command, name).toThrowError(
        expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
      );
    }
  });

  it("跨 Client 的句柄被拒绝（所有权在 Map facet 同样生效）", () => {
    const { map } = setup();
    const other = setup();
    const foreign = other.map.create(other.container);
    expect(() => map.getZoom(foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("视野 round-trip", () => {
  it("initializeView 用 centerAndZoom 一次设定中心与级别（显式 noAnimation）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

    expect(fake.createdMaps[0].callLog).toContain("centerAndZoom");
    expect(map.getZoom(handle)).toBe(14);
    expect(map.getCenter(handle)).toEqual({ lng: 116.404, lat: 39.915 });
    // 初次视野不依赖 SDK 隐式默认（v4 的 centerAndZoom 默认 noAnimation: true）
    expect(fake.createdMaps[0].lastViewOptions).toEqual({ noAnimation: true });
  });

  it("initializeView 支持城市名（v4 的 string 重载）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: "北京", zoom: 11 });
    expect(fake.createdMaps[0].callLog).toContain("centerAndZoom");
    expect(map.getZoom(handle)).toBe(11);
  });

  it("后续更新只用 setCenter / setZoom，不重置另一维", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 14 });

    fake.createdMaps[0].callLog.length = 0;
    map.setCenter(handle, { lng: 121.5, lat: 31.2 });
    expect(fake.createdMaps[0].callLog).toEqual(["setCenter"]);
    expect(map.getZoom(handle)).toBe(14);

    fake.createdMaps[0].callLog.length = 0;
    map.setZoom(handle, 9);
    expect(fake.createdMaps[0].callLog).toEqual(["setZoom"]);
    expect(map.getCenter(handle)).toEqual({ lng: 121.5, lat: 31.2 });
  });

  it("heading / tilt round-trip", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

    map.setHeading(handle, 45);
    expect(map.getHeading(handle)).toBe(45);
    map.setTilt(handle, 30);
    expect(map.getTilt(handle)).toBe(30);
  });

  it("initializeView 的 heading / tilt 走同一条 setHeading / setTilt 路径", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, {
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
      heading: 90,
      tilt: 45,
    });
    expect(fake.createdMaps[0].callLog).toContain("setHeading");
    expect(fake.createdMaps[0].callLog).toContain("setTilt");
    expect(map.getHeading(handle)).toBe(90);
    expect(map.getTilt(handle)).toBe(45);
  });

  it("panTo / panBy / setViewport / fitBounds 抵达 SDK", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    fake.createdMaps[0].callLog.length = 0;

    map.panTo(handle, { lng: 116.5, lat: 39.9 });
    // v4 的 panBy 接收 (x, y) 两个数字，不是 Pixel 对象
    map.panBy(handle, { x: 100, y: -50 });
    map.setViewport(handle, [
      { lng: 116.3, lat: 39.8 },
      { lng: 116.5, lat: 40.0 },
    ]);
    map.fitBounds(handle, {
      southwest: { lng: 116.2, lat: 39.7 },
      northeast: { lng: 116.6, lat: 40.1 },
    });

    expect(fake.createdMaps[0].callLog).toContain("panTo");
    expect(fake.createdMaps[0].callLog).toContain("panBy:100,-50");
    expect(fake.createdMaps[0].callLog.filter((call) => call === "setViewport")).toHaveLength(2);
  });

  it("getBounds / getSize 返回归一化后的纯数据", () => {
    const { map, container } = setup({ width: "320px", height: "240px" });
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

    const bounds = map.getBounds(handle);
    expect(bounds.southwest.lng).toBeLessThan(bounds.northeast.lng);
    expect(bounds.southwest.lat).toBeLessThan(bounds.northeast.lat);
    expect(map.getSize(handle)).toEqual({ width: 320, height: 240 });
  });

  it("未初始化视野时 getBounds 报结构化错误而不是 0/0", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.getBounds(handle)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("投影转换 round-trip，且视口中心落在容器中心", () => {
    const { map, container } = setup({ width: "640px", height: "480px" });
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

    const point = { lng: 116.414, lat: 39.905 };
    const pixel = map.pointToPixel(handle, point);
    const roundTrip = map.pixelToPoint(handle, pixel);
    expect(roundTrip.lng).toBeCloseTo(point.lng, 10);
    expect(roundTrip.lat).toBeCloseTo(point.lat, 10);
    expect(map.pointToPixel(handle, { lng: 116.404, lat: 39.915 })).toEqual({
      x: 320,
      y: 240,
    });
  });
});

describe("交互开关", () => {
  it("全部语义交互项都映射到官方成对方法并生效", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);

    for (const interaction of MAP_INTERACTIONS) {
      map.setInteraction(handle, interaction, false);
      expect(fake.createdMaps[0].interactions[INTERACTION_STATE_KEYS[interaction]]).toBe(false);
      map.setInteraction(handle, interaction, true);
      expect(fake.createdMaps[0].interactions[INTERACTION_STATE_KEYS[interaction]]).toBe(true);
    }
  });

  it("SDK 缺某个成对方法时告警一次并跳过，不影响其它交互项", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prototype = FakeV4Map.prototype as unknown as Record<string, unknown>;
    const originalEnable = prototype.enableTiltGestures;
    delete prototype.enableTiltGestures;

    try {
      const { map, container, fake } = setup();
      const handle = map.create(container);

      expect(() => {
        map.setInteraction(handle, "tilt-gestures", true); // 缺成员 → 告警
        map.setInteraction(handle, "tilt-gestures", true); // 同一方法去重 → 不再告警
        map.setInteraction(handle, "tilt-gestures", false); // 另一侧仍在 → 正常生效
      }).not.toThrow();

      expect(fake.createdMaps[0].interactions.tiltGestures).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);

      // 其它交互项不受影响
      map.setInteraction(handle, "dragging", false);
      expect(fake.createdMaps[0].interactions.dragging).toBe(false);
    } finally {
      prototype.enableTiltGestures = originalEnable;
    }
    warn.mockRestore();
  });

  it("交互开关幂等：重复设置同一状态不产生额外副作用", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);

    map.setInteraction(handle, "scroll-zoom", false);
    map.setInteraction(handle, "scroll-zoom", false);

    expect(fake.createdMaps[0].interactions.scrollWheelZoom).toBe(false);
    // 每次调用都落在官方方法上，但状态稳定（幂等 = 结果不随重复调用漂移）
    expect(
      fake.createdMaps[0].callLog.filter((call) => call === "disableScrollWheelZoom"),
    ).toHaveLength(2);
  });

  it("未知交互项按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.setInteraction(handle, "unknown" as MapInteraction, true)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});

describe("底图类型与样式", () => {
  it("语义地图类型映射到运行时那组 MapTypeId 成员（NORMAL / SATELLITE / EARTH）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setMapType(handle, "normal");
    map.setMapType(handle, "satellite");
    map.setMapType(handle, "earth");

    expect(fake.createdMaps[0].mapType).toBe("earth");
    expect(fake.createdMaps[0].callLog).toContain("setMapType:normal");
    expect(fake.createdMaps[0].callLog).toContain("setMapType:satellite");
  });

  /**
   * 反证守卫：夹具的形状必须与**真实运行时**一致。
   *
   * 真实 `v=4.0` 的 `BMap.MapTypeId` 没有 `BMAP_*_MAP`（那组常量挂在全局）。如果夹具同时提供
   * 两套名字，「只读声明名」的实现会在这里一路绿、直到真实 smoke 才炸（#71 的教训）。
   */
  it("夹具的 MapTypeId 只有运行时那三个成员，没有上游声明里的 BMAP_*_MAP", () => {
    const { fake } = setup();
    const keys = Object.keys(fake.namespace.MapTypeId);
    expect(keys.sort()).toEqual(["EARTH", "NORMAL", "SATELLITE"]);
  });

  it("命名空间只提供上游声明名（BMAP_*_MAP）时仍能解析（候选后备）", () => {
    const fake = createFakeBMapV4();
    const namespace = {
      ...fake.namespace,
      MapTypeId: {
        BMAP_NORMAL_MAP: "BMAP_NORMAL_MAP",
        BMAP_SATELLITE_MAP: "BMAP_SATELLITE_MAP",
        BMAP_EARTH_MAP: "BMAP_EARTH_MAP",
      },
    };
    const registry = createJsapiV4HandleRegistry();
    const geometry = createJsapiV4GeometryDriver(namespace);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: namespace,
      unsupported: "silent",
    });
    const map = createJsapiV4MapDriver({ rawSdk: namespace, geometry, capabilities, registry, events });
    const handle = map.create(ctx.container);
    expect(() => map.setMapType(handle, "normal")).not.toThrow();
  });

  it("运行时名优先于上游声明名（两者同时存在时取运行时名）", () => {
    const fake = createFakeBMapV4();
    const namespace = {
      ...fake.namespace,
      MapTypeId: { NORMAL: "runtime-normal", BMAP_NORMAL_MAP: "declared-normal" },
    };
    const registry = createJsapiV4HandleRegistry();
    const geometry = createJsapiV4GeometryDriver(namespace);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: namespace,
      unsupported: "silent",
    });
    const map = createJsapiV4MapDriver({ rawSdk: namespace, geometry, capabilities, registry, events });
    const handle = map.create(ctx.container);
    map.setMapType(handle, "normal");
    expect(fake.createdMaps[0].mapType).toBe("runtime-normal");
  });

  it("未知地图类型按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.setMapType(handle, "planet" as never)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("mapTypeId 缺失时报 SDK 边界错误，并把试过的候选名带进 detail", () => {
    const fake = createFakeBMapV4();
    const { MapTypeId, ...withoutMapTypeId } = fake.namespace;
    void MapTypeId;
    const registry = createJsapiV4HandleRegistry();
    const geometry = createJsapiV4GeometryDriver(withoutMapTypeId);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: withoutMapTypeId,
      unsupported: "silent",
    });
    const map = createJsapiV4MapDriver({
      rawSdk: withoutMapTypeId,
      geometry,
      capabilities,
      registry,
      events,
    });
    const handle = map.create(ctx.container);
    expect(() => map.setMapType(handle, "normal")).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_CALL_FAILED",
        // 错误文案要把「试过哪些候选名」写出来，否则下次再踩只能靠猜。
        message: expect.stringContaining("NORMAL / BMAP_NORMAL_MAP"),
      }),
    );
  });

  it("setMapStyle 透传给 v4 setMapStyle", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setMapStyle(handle, { styleId: "style-1" });
    expect(fake.createdMaps[0].mapStyle).toEqual({ styleId: "style-1" });
  });

  it("setTraffic 在 v4 显式告警并忽略（路况属 Layer Facet #22）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setTraffic(handle, true);
    expect(warn).toHaveBeenCalled();
    expect(fake.createdMaps[0].callLog.some((call) => call.startsWith("setTraffic"))).toBe(false);
    warn.mockRestore();
  });
});

describe("能力守卫", () => {
  it("heading / tilt / animate / viewport 由能力注册表把关", () => {
    const { capabilities } = setup();
    for (const capability of [
      "map.heading",
      "map.tilt",
      "map.animate",
      "map.viewport",
      "map.pixel-conversion",
      "map.style",
    ] as const) {
      expect(capabilities.supports(capability)).toBe(true);
    }
  });

  it("能力缺失且策略为 throw 时 setHeading 抛 BMAP_CAPABILITY_UNSUPPORTED", () => {
    const fake = createFakeBMapV4();
    // 抹掉 Map 原型上的旋转能力，模拟「加载成功但该能力不可用」的 SDK 边界。
    // 方法定义在 FakeV4Map 上（`namespace.Map` 只是子类），因此必须动基类原型。
    const prototype = FakeV4Map.prototype as unknown as Record<string, unknown>;
    const originalSetHeading = prototype.setHeading;
    const originalGetHeading = prototype.getHeading;
    delete prototype.setHeading;
    delete prototype.getHeading;

    try {
      const registry = createJsapiV4HandleRegistry();
      const geometry = createJsapiV4GeometryDriver(fake.namespace);
      const events = createJsapiV4EventDriver({ registry, geometry });
      const capabilities = createCapabilityRegistry({
        engine: "jsapi-v4",
        version: "4.0",
        rawSdk: fake.namespace,
        unsupported: "throw",
      });
      const map = createJsapiV4MapDriver({
        rawSdk: fake.namespace,
        geometry,
        capabilities,
        registry,
        events,
      });
      const handle = map.create(ctx.container);
      expect(map.initializeView(handle, { center: { lng: 0, lat: 0 }, zoom: 10 })).toBeUndefined();
      expect(capabilities.supports("map.heading")).toBe(false);
      expect(() => map.setHeading(handle, 30)).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    } finally {
      prototype.setHeading = originalSetHeading;
      prototype.getHeading = originalGetHeading;
    }
  });
});

describe("视角动画", () => {
  it("startViewAnimation 记住实例，cancelViewAnimation 用同一实例 cancel", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = { frames: [] };

    map.startViewAnimation(handle, animation);
    expect(fake.createdMaps[0].lastAnimation).toBe(animation);

    expect(map.cancelViewAnimation(handle, animation)).toBe("canceled");
    expect(fake.createdMaps[0].canceledAnimation).toBe(animation);
  });

  it("cancelViewAnimation 只碰传入的那个实例，已结算的实例不补发", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    const canceled: string[] = [];
    const a = { frames: [], cancel: () => void canceled.push("a") };
    const b = { frames: [], cancel: () => void canceled.push("b") };

    map.startViewAnimation(handle, a);
    // 这两个是**没有生命周期事件**的动画对象 ⇒ 记录按「已启动」处理，起播前的清场是**即时交付**的
    // （真正的待启动窗口那条路径见下面「#122 评审 P1」的 describe）
    map.startViewAnimation(handle, b);
    expect(canceled).toEqual(["a"]);

    // 传入 b：只取消 b 这一条记录
    expect(map.cancelViewAnimation(handle, b)).toBe("canceled");
    expect(canceled).toEqual(["a", "b"]);

    // a 早已结算 ⇒ 没有可取消的东西，也不补发一次 SDK 取消（那要假设 cancelViewAnimation 幂等，
    // 不在 #128 F-3 的 destroy/dispose 取证范围，仍未证）
    expect(map.cancelViewAnimation(handle, a)).toBe("already-settled");
    expect(canceled).toEqual(["a", "b"]);
  });

  it("cancelViewAnimation 对本 Driver 没有记录的实例是 no-op（不触达 SDK），地图仍可用", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    // 「没有活动动画时停止是 no-op」这条旧语义现在只能按**实例**表达：本 Driver 没有该实例的
    // 记录 ⇒ 报 `already-settled`，且一个 SDK 取消都不发（补发要假设 cancelViewAnimation 幂等，
    // 不在 #128 F-3 的 destroy/dispose 取证范围，仍未证）。
    expect(map.cancelViewAnimation(handle, { frames: [] })).toBe("already-settled");
    expect(fake.createdMaps[0].callLog).not.toContain("cancelViewAnimation");
    expect(map.getZoom(handle)).toBe(12);
  });

  it("非对象动画入参按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.startViewAnimation(handle, 42)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});

describe("视角动画生命周期（首轮评审 P1/P2）", () => {
  /** 造一个真正建模「异步启动 + animationstart 之后才可取消」的假动画。 */
  function createAnimation(fake: FakeBMapV4, options: Record<string, unknown> = {}) {
    return new fake.namespace.ViewAnimation([{ percentage: 0 }, { percentage: 1 }], options);
  }

  it("destroy 会在 SDK 销毁之前取消**运行中**的动画（不是只丢引用）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = createAnimation(fake, { duration: 100 });
    map.startViewAnimation(handle, animation);
    await sleep(); // 等内部定时器启动（animationstart 已派发）

    map.destroy(handle);

    const log = fake.createdMaps[0].callLog;
    expect(animation.cancelCalls).toBe(1);
    expect(animation.settled).toBe(true);
    expect(log.indexOf("cancelViewAnimation")).toBeGreaterThanOrEqual(0);
    // 官方要求「先结束动画、再销毁地图」
    expect(log.indexOf("destroy")).toBeGreaterThan(log.indexOf("cancelViewAnimation"));
  });

  it("启动窗口内取消不抛 TypeError（请求登记下来），启动后落地", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = createAnimation(fake, { duration: 100 });
    map.startViewAnimation(handle, animation);

    // 评审场景：这个窗口内直连 SDK 取消一定抛 TypeError（F-1 已在真实 4.0 上实测）
    expect(map.cancelViewAnimation(handle, animation)).toBe("deferred");
    await sleep();
    await sleep();

    expect(animation.cancelCalls).toBe(1);
    expect(animation.settled).toBe(true);
  });

  it("在 animationstart 回调里同步取消也能成功（请求被推迟到微任务）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = createAnimation(fake, {});
    let duringDispatch: string | null = null;
    animation.addEventListener("animationstart", () => {
      duringDispatch = map.cancelViewAnimation(handle, animation);
    });

    map.startViewAnimation(handle, animation);
    await sleep();
    await sleep();

    // 派发期间内部控制器还不存在 ⇒ 这次取消只能是「登记请求」
    expect(duringDispatch).toBe("deferred");
    expect(animation.cancelCalls).toBe(1);
    expect(animation.settled).toBe(true);
  });

  it("取消失败不丢记录：下一次取消仍能重试", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = createAnimation(fake, {});
    map.startViewAnimation(handle, animation);
    await sleep();
    animation.failNextCancel = true;

    expect(() => map.cancelViewAnimation(handle, animation)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(animation.cancelCalls).toBe(1);
    expect(animation.settled).toBe(false);

    expect(map.cancelViewAnimation(handle, animation)).toBe("canceled");
    expect(animation.cancelCalls).toBe(2);
    expect(animation.settled).toBe(true);
  });

  it("正常结束的动画不再被取消", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = createAnimation(fake, {});
    map.startViewAnimation(handle, animation);
    await sleep();
    animation.finish();
    expect(animation.settled).toBe(true);

    expect(map.cancelViewAnimation(handle, animation)).toBe("already-settled");
    map.destroy(handle);
    expect(animation.cancelCalls).toBe(0);
  });

  it("启动新动画时先取消上一个（不留无人跟踪的孤儿动画）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const first = createAnimation(fake, {});
    const second = createAnimation(fake, {});
    map.startViewAnimation(handle, first);
    await sleep();

    map.startViewAnimation(handle, second);
    expect(first.settled).toBe(true);
    expect(first.cancelCalls).toBe(1);

    await sleep();
    expect(map.cancelViewAnimation(handle, second)).toBe("canceled");
    expect(second.cancelCalls).toBe(1);
  });

  it("本 Client 的动画 Handle 正确解包；外来 Handle 抛 BMAP_HANDLE_FOREIGN 且不触达 SDK", () => {
    const { map, container, fake, registry } = setup();
    const handle = map.create(container);
    const raw = { frames: [], tag: "own" };
    map.startViewAnimation(handle, registry.adopt("service:view-animation", raw));
    expect(fake.createdMaps[0].lastAnimation).toBe(raw);

    fake.createdMaps[0].callLog.length = 0;
    const foreignRegistry = createJsapiV4HandleRegistry();
    const foreign = foreignRegistry.adopt("service:view-animation", { frames: [] });
    expect(() => map.startViewAnimation(handle, foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
    expect(fake.createdMaps[0].callLog).not.toContain("startViewAnimation");
  });
});

// 复审（基线 95c2a1f）四项：都被本轮复现确认，修复见对应用例。
describe("视角动画生命周期（复审 P1/P2）", () => {
  function createAnimation(fake: FakeBMapV4, options: Record<string, unknown> = {}) {
    return new fake.namespace.ViewAnimation([{ percentage: 0 }, { percentage: 1 }], options);
  }

  it("[P1] 待启动路径：取消必须早于 SDK destroy，且销毁被推迟到安全窗口", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const anim = createAnimation(fake, {});
    map.startViewAnimation(handle, anim);

    map.destroy(handle);
    // 待启动的动画此刻无法取消：按官方参考把「取消 + 销毁 Map」一起推迟
    expect(anim.cancelCalls).toBe(0);
    expect(fake.createdMaps[0].destroyed).toBe(false);

    await sleep();
    await sleep();

    const log = fake.createdMaps[0].callLog;
    expect(anim.settled).toBe(true);
    expect(log.indexOf("cancelViewAnimation")).toBeLessThan(log.indexOf("destroy"));
    expect(fake.createdMaps[0].destroyed).toBe(true);
  });

  it("[P1] 延迟取消失败会在同一次推进里再试一次（不把停不掉的动画留在原地）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const anim = createAnimation(fake, {});
    anim.failNextCancel = true;

    map.startViewAnimation(handle, anim);
    map.destroy(handle);
    await sleep();
    await sleep();

    // 安全窗口里的第一次取消失败 → 延迟清理再试一次并停掉动画
    expect(anim.settled).toBe(true);
    expect(anim.getListenerCount()).toBe(0);
    // SDK 对象只销毁一次：重试不会二次销毁（tornDown）
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);

    // 完成后才是真正的幂等 no-op
    expect(() => map.destroy(handle)).not.toThrow();
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("[P2] started 只能在 animationstart 派发结束后的微任务里置位（业务监听器后注册）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const anim = createAnimation(fake, {});
    map.startViewAnimation(handle, anim);
    // Driver 的监听器先注册 → 同一轮派发里业务回调后执行；此刻内部 Animation 还没建
    let duringDispatch: string | null = null;
    anim.addEventListener("animationstart", () => {
      duringDispatch = map.cancelViewAnimation(handle, anim);
    });

    await sleep();
    await sleep();

    expect(duringDispatch).toBe("deferred");
    expect(anim.cancelCalls).toBe(1);
    expect(anim.settled).toBe(true);
  });

  it("[P2] 两种监听注册顺序都必须能取消成功", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const anim = createAnimation(fake, {});
    let duringDispatch: string | null = null;
    anim.addEventListener("animationstart", () => {
      duringDispatch = map.cancelViewAnimation(handle, anim);
    });
    map.startViewAnimation(handle, anim);

    await sleep();
    await sleep();

    // 业务监听器**先**注册也是同一结果：启动窗口内只能登记请求，真正取消落在微任务
    expect(duringDispatch).toBe("deferred");
    expect(anim.cancelCalls).toBe(1);
    expect(anim.settled).toBe(true);
  });

  it("[P2] 旧动画取消失败时拒绝替换，旧记录仍可清理", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const first = createAnimation(fake, {});
    const second = createAnimation(fake, {});
    map.startViewAnimation(handle, first);
    await sleep();
    first.failNextCancel = true;

    expect(() => map.startViewAnimation(handle, second)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    // 旧动画没有被覆盖丢失：仍是当前动画，且可以再停掉（监听器归零 = 生命周期记录已释放）
    expect(fake.createdMaps[0].lastAnimation).toBe(first);
    expect(map.cancelViewAnimation(handle, first)).toBe("canceled");
    expect(first.settled).toBe(true);
    expect(first.getListenerCount()).toBe(0);
  });

  it("[P2] 取消旧动画触发业务销毁后，不得再启动新动画", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const first = createAnimation(fake, {});
    const second = createAnimation(fake, {});
    map.startViewAnimation(handle, first);
    await sleep();
    first.addEventListener("animationcancel", () => {
      map.destroy(handle);
    });

    expect(() => map.startViewAnimation(handle, second)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(
      fake.createdMaps[0].callLog.filter((call) => call === "startViewAnimation"),
    ).toHaveLength(1);
    expect(fake.createdMaps[0].lastAnimation).toBe(first);
  });

  it("[P2] 取消回调里再次 destroy 不会让 SDK destroy 执行两次（disposing 防重入）", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const anim = createAnimation(fake, {});
    map.startViewAnimation(handle, anim);
    await sleep();
    anim.addEventListener("animationcancel", () => {
      map.destroy(handle);
    });

    map.destroy(handle);
    await sleep();

    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });
});

// 第三轮复审（基线 6318c6b）保留的唯一 P1：非零 delay 下 0ms 兜底先于动画启动执行，
// 而完成判据当时没把「未启动的动画」算成未完成资源 → released 被提前置位，迟到取消失败后无路可退。
describe("视角动画生命周期（第三轮复审 P1：非零 delay）", () => {
  function delayedAnimation(fake: FakeBMapV4, delay: number) {
    return new fake.namespace.ViewAnimation([{ percentage: 0 }, { percentage: 1 }], {
      delay,
      interation: "INFINITE",
    });
  }

  it("[P1] 迟到取消失败后必须保留可用的重试入口", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = delayedAnimation(fake, 30);

    animation.failNextCancel = true;
    map.startViewAnimation(handle, animation);
    map.destroy(handle);

    await sleep(60);
    // 迟到的第一次取消已失败：记录必须保留（不能因为兜底跑过就当成清理完成）
    expect(animation.cancelCalls).toBe(1);
    expect(animation.settled).toBe(false);

    // 重试入口必须真的可用：destroy 再走一遍，把动画停掉
    expect(() => map.destroy(handle)).not.toThrow();
    expect(animation.cancelCalls).toBe(2);
    expect(animation.settled).toBe(true);
    expect(animation.getListenerCount()).toBe(0);
    // 只有一次 SDK 销毁（tornDown）
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("[P1] 未 settled 的动画记录阻止 released，直到它真正停掉", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = delayedAnimation(fake, 30);
    map.startViewAnimation(handle, animation);
    map.destroy(handle);

    // 兜底销毁已执行（约 1ms），但动画还没启动、记录还没 settled
    await sleep(5);
    expect(animation.settled).toBe(false);

    // 动画启动并取消成功后，再调 destroy 就应当是幂等 no-op（不会二次销毁）
    await sleep(60);
    expect(animation.settled).toBe(true);
    expect(() => map.destroy(handle)).not.toThrow();
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("delay: 0 的官方推荐路径仍然是「先取消、再销毁 SDK 对象」", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = delayedAnimation(fake, 0);
    map.startViewAnimation(handle, animation);

    map.destroy(handle);
    await sleep();
    await sleep();

    const log = fake.createdMaps[0].callLog;
    expect(log.indexOf("cancelViewAnimation")).toBeLessThan(log.indexOf("destroy"));
    expect(animation.settled).toBe(true);
  });
});

describe("视角动画生命周期（#122 评审 P1：待启动旧段的「清场」时机）", () => {
  function createAnimation(fake: FakeBMapV4, options: Record<string, unknown> = {}) {
    return new fake.namespace.ViewAnimation([{ percentage: 0 }, { percentage: 1 }], options);
  }

  /** `callLog` 里每个 `startViewAnimation` 的下标。 */
  const startIndexes = (log: readonly string[]): number[] =>
    log.map((call, index) => (call === "startViewAnimation" ? index : -1)).filter((i) => i >= 0);

  /**
   * **待启动**旧段：起播前的清场此刻交付不了 —— 只能登记请求，新段会先提交。
   *
   * 这是 #122 评审 P1 的形状：`cancelAnimation` 对未启动的记录只置 `cancelRequested` 就返回
   * （此窗口内 SDK 取消必抛 `TypeError`，实测见审计表 F-1 ②），而 `startViewAnimation` 紧接着就把
   * 新段提交给了 SDK。真实 4.0 上的读数是：旧段的取消落在**它自己的启动安全窗口**，
   * 与它的 `animationstart` 相隔 0.0–0.3ms，因此旧段来不及推进视角（轨迹只朝新段的末帧走）。
   *
   * 本用例钉的是**契约**：不承诺「提交新段前图上一段不剩」，只承诺「在最早的合法时刻交付取消」。
   * 想要更强保证（等旧段交付后再起播）是另一种设计，本库没有选 —— 见 PR #122 的回复。
   */
  it("[P1] 待启动旧段：提交新段时只登记请求，取消在旧段自己的安全窗口才交付", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const first = createAnimation(fake, { delay: 30 });
    const second = createAnimation(fake, {});

    map.startViewAnimation(handle, first);
    expect(map.cancelViewAnimation(handle, first)).toBe("deferred");
    map.startViewAnimation(handle, second);

    const log = fake.createdMaps[0].callLog;
    const starts = startIndexes(log);
    expect(starts, "两次 startViewAnimation 都该交给 SDK").toHaveLength(2);
    // 契约的形状（修复前这里描述成「起播前先清场」）：此刻**没有**任何已交付的取消
    expect(
      log.indexOf("cancelViewAnimation"),
      `提交新段时不该有已交付的取消（callLog=${log.join(",")}）`,
    ).toBe(-1);
    expect(first.cancelCalls).toBe(0);

    // 旧段进入安全窗口之后，登记下来的那次取消才真正交付 —— 且晚于新段的提交
    await sleep(60);
    const cancelAt = log.indexOf("cancelViewAnimation");
    expect(cancelAt, `安全窗口里必须真的交付取消（callLog=${log.join(",")}）`).toBeGreaterThanOrEqual(0);
    expect(cancelAt, `待启动旧段的取消晚于新段的提交（callLog=${log.join(",")}）`).toBeGreaterThan(starts[1]!);
    expect(first.cancelCalls).toBe(1);
    expect(first.settled).toBe(true);
    // 新段不受影响，仍是本库跟踪的那一段
    expect(second.settled).toBe(false);
    expect(map.cancelViewAnimation(handle, second)).toBe("canceled");
  });

  it("[P1] 已启动旧段（对照）：取消在提交新段**之前**交付", async () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const first = createAnimation(fake, {});
    const second = createAnimation(fake, {});
    map.startViewAnimation(handle, first);
    await sleep(); // first 已进安全窗口

    map.startViewAnimation(handle, second);

    const log = fake.createdMaps[0].callLog;
    const starts = startIndexes(log);
    expect(starts).toHaveLength(2);
    const cancelAt = log.indexOf("cancelViewAnimation");
    expect(cancelAt, `已启动旧段的取消必须先交付（callLog=${log.join(",")}）`).toBeGreaterThanOrEqual(0);
    expect(cancelAt, `已启动旧段的清场排在提交新段之前（callLog=${log.join(",")}）`).toBeLessThan(starts[1]!);
    expect(first.settled).toBe(true);
  });
});

describe("销毁的部分失败（PR #60 评审 P2）", () => {
  it("解绑抛错不阻断 SDK 销毁；重试入口保留，全部成功后才是幂等 no-op", () => {
    const { map, container, fake, events } = setup();
    const handle = map.create(container);
    events.on(handle, "click", () => {});
    const raw = handle.raw as { removeEventListener: () => void };
    const originalRemove = raw.removeEventListener;
    raw.removeEventListener = () => {
      throw new Error("unbind boom");
    };

    // 解绑失败要被汇总报告出来，而不是被吞掉
    expect(() => map.destroy(handle)).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_CALL_FAILED",
        message: expect.stringContaining("unbind boom"),
      }),
    );
    // 关键：SDK destroy 没有被前面的失败跳过
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
    // 命令闸门已关闭（资源可能还没完全释放，但业务不能再用了）
    expect(() => map.getZoom(handle)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );

    // 修好后重试：清理补齐；SDK 对象不会被二次销毁（tornDown），只补没做完的部分
    raw.removeEventListener = originalRemove;
    expect(() => map.destroy(handle)).not.toThrow();
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);

    // 清理完成后的第三次调用才是真正的幂等 no-op
    expect(() => map.destroy(handle)).not.toThrow();
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });
});
