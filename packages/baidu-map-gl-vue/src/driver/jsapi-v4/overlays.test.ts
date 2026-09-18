/**
 * v4 OverlayDriver（M3A2-OVERLAYS / issue #21）
 *
 * 验收点（对应 issue #21 的「测试要求」与「验收标准」）：
 * - 每种基础覆盖物的 create / update / remove；构造参数与 v4 的映射（Icon / Size / Point 数组）；
 * - 属性分类（mutable / recreate / unsupported）：mutable 走字段级 setter 且**不重建**，
 *   recreate 只告警并交给调用方重建，unsupported 显式告警而不是静默丢弃；
 * - InfoWindow 走专用 open/close/redraw API，且**不用私有字段判断状态**；
 * - Target 挂载：Map 目标原子加/摘，非 Map 目标显式失败（不产生半挂载）；
 * - 「本引擎没有运行时入口」的成员（Marker3D / MapMask）显式失败，不静默降级。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { CAPABILITY_CATALOG } from "../capability/catalog";
import { createCapabilityRegistry } from "../capability/registry";
import type { OverlayHandle } from "../types/handles";
import { OVERLAY_DESCRIPTORS } from "../types/overlays";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4OverlayDriver } from "./overlays";
import { createJsapiV4HandleRegistry } from "./registry";

function setup(options: { unsupported?: "throw" | "warn" | "silent" } = {}) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: options.unsupported ?? "throw",
  });
  const overlays = createJsapiV4OverlayDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
  });
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "300px";
  document.body.appendChild(container);
  const rawMap = new fake.namespace.Map(container);
  const map = registry.adopt("map", rawMap);

  const rawOf = (handle: OverlayHandle) => handle.raw as Record<string, unknown>;
  const marker = () => overlays.createMarker({ lng: 116.4, lat: 39.9 });
  const mapTarget = () => ({ kind: "map" as const, handle: map });

  return { fake, registry, geometry, capabilities, overlays, container, rawMap, map, rawOf, marker, mapTarget };
}

let ctx: ReturnType<typeof setup>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ctx = setup();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* 1. create：每种覆盖物的构造参数与 v4 映射                                     */
/* -------------------------------------------------------------------------- */

describe("基础覆盖物的创建与构造参数映射", () => {
  it("Marker：位置为位置参数，offset 转 Size、icon 转 Icon 实例", () => {
    const handle = ctx.overlays.createMarker(
      { lng: 116.404, lat: 39.915 },
      {
        offset: { x: 4, y: -8 },
        title: "标记",
        zIndex: 12,
        rotation: 30,
        enableDragging: true,
        enableClicking: true,
        icon: {
          imageUrl: "https://example.com/marker.png",
          size: { width: 32, height: 40 },
          anchor: { x: 16, y: 40 },
          imageOffset: { x: 1, y: 2 },
          imageSize: { width: 64, height: 80 },
        },
      },
    );
    const raw = ctx.rawOf(handle);

    expect(raw).toBeInstanceOf(ctx.fake.namespace.Marker);
    expect(raw.position).toMatchObject({ lng: 116.404, lat: 39.915 });
    expect(raw.options).toMatchObject({
      title: "标记",
      zIndex: 12,
      rotation: 30,
      enableDragging: true,
      enableClicking: true,
    });
    // 领域值对象 → v4 构造器实例，不是裸对象
    expect(raw.options.offset).toBeInstanceOf(ctx.fake.namespace.Size);
    expect((raw.options.offset as { width: number }).width).toBe(4);
    const icon = raw.options.icon as InstanceType<FakeBMapV4["namespace"]["Icon"]>;
    expect(icon).toBeInstanceOf(ctx.fake.namespace.Icon);
    expect(icon.imageUrl).toBe("https://example.com/marker.png");
    expect(icon.size).toMatchObject({ width: 32, height: 40 });
    expect(icon.anchor).toMatchObject({ width: 16, height: 40 });
    expect(icon.imageOffset).toMatchObject({ width: 1, height: 2 });
    expect(icon.imageSize).toMatchObject({ width: 64, height: 80 });
  });

  it("Polyline / Polygon / Circle / Rectangle：路径、圆心半径与 bounds 映射为 v4 值", () => {
    const polyline = ctx.overlays.createPolyline(
      [
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.92 },
      ],
      { strokeColor: "#1677ff", strokeWeight: 4, enableEditing: true },
    );
    expect(ctx.rawOf(polyline)).toBeInstanceOf(ctx.fake.namespace.Polyline);
    expect(ctx.rawOf(polyline).path).toHaveLength(2);
    expect((ctx.rawOf(polyline).path as unknown[])[0]).toBeInstanceOf(ctx.fake.namespace.Point);
    expect(ctx.rawOf(polyline).options).toMatchObject({
      strokeColor: "#1677ff",
      strokeWeight: 4,
      enableEditing: true,
    });

    const polygon = ctx.overlays.createPolygon(
      [
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.9 },
        { lng: 116.41, lat: 39.92 },
      ],
      { fillColor: "#13a8a8" },
    );
    expect(ctx.rawOf(polygon)).toBeInstanceOf(ctx.fake.namespace.Polygon);

    const rectangle = ctx.overlays.createRectangle(
      { southwest: { lng: 116.39, lat: 39.9 }, northeast: { lng: 116.42, lat: 39.92 } },
      { strokeColor: "#d93025" },
    );
    expect(ctx.rawOf(rectangle)).toBeInstanceOf(ctx.fake.namespace.Rectangle);
    expect(ctx.rawOf(rectangle).bounds).toBeInstanceOf(ctx.fake.namespace.Bounds);

    const circle = ctx.overlays.createCircle({ lng: 116.404, lat: 39.915 }, 800, {
      fillOpacity: 0.2,
    });
    expect(ctx.rawOf(circle)).toBeInstanceOf(ctx.fake.namespace.Circle);
    expect(ctx.rawOf(circle)).toMatchObject({ radius: 800 });
    expect(ctx.rawOf(circle).center).toBeInstanceOf(ctx.fake.namespace.Point);
  });

  it("Label / InfoWindow / GroundOverlay / Prism / BezierCurve / CustomOverlay", () => {
    const label = ctx.overlays.createLabel("文本", {
      position: { lng: 116.4, lat: 39.9 },
      offset: { x: 12, y: -16 },
      style: { color: "#1677ff" },
    });
    expect(ctx.rawOf(label)).toBeInstanceOf(ctx.fake.namespace.Label);
    // 项目的 style（单数）→ v4 构造选项 styles（复数）
    expect(ctx.rawOf(label).options).toMatchObject({ styles: { color: "#1677ff" } });

    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"), {
      width: 280,
      title: "标题",
      enableAutoPan: true,
    });
    expect(ctx.rawOf(infoWindow)).toBeInstanceOf(ctx.fake.namespace.InfoWindow);
    expect(ctx.rawOf(infoWindow).options).toMatchObject({
      width: 280,
      title: "标题",
      enableAutoPan: true,
    });

    const ground = ctx.overlays.createGroundOverlay(
      { southwest: { lng: 116.39, lat: 39.9 }, northeast: { lng: 116.42, lat: 39.92 } },
      { opacity: 0.7, url: "https://example.com/a.png", type: "image" },
    );
    expect(ctx.rawOf(ground)).toBeInstanceOf(ctx.fake.namespace.GroundOverlay);
    // 领域里没有的 v4 构造选项（type）按逃生口透传，不被丢弃
    expect(ctx.rawOf(ground).options).toMatchObject({
      opacity: 0.7,
      url: "https://example.com/a.png",
      type: "image",
    });

    const prism = ctx.overlays.createPrism(
      [
        { lng: 116.399, lat: 39.91 },
        { lng: 116.409, lat: 39.91 },
        { lng: 116.406, lat: 39.92 },
      ],
      300,
      { topFillColor: "#1677ff", altitude: 300, autoCenter: true },
    );
    expect(ctx.rawOf(prism)).toBeInstanceOf(ctx.fake.namespace.Prism);
    expect(ctx.rawOf(prism)).toMatchObject({ altitude: 300 });
    // 位置参数（path / altitude）不会重复出现在构造 options 里
    expect(ctx.rawOf(prism).options).not.toHaveProperty("altitude");
    expect(ctx.rawOf(prism).options).toMatchObject({ topFillColor: "#1677ff", autoCenter: true });

    const bezier = ctx.overlays.createBezierCurve(
      [
        { lng: 116.392, lat: 39.906 },
        { lng: 116.418, lat: 39.924 },
      ],
      [[{ lng: 116.405, lat: 39.936 }]],
      { strokeColor: "#722ed1" },
    );
    expect(ctx.rawOf(bezier)).toBeInstanceOf(ctx.fake.namespace.BezierCurve);
    expect(ctx.rawOf(bezier).controlPoints).toHaveLength(1);

    let domCalls = 0;
    const custom = ctx.overlays.createCustomOverlay(
      { lng: 116.404, lat: 39.915 },
      () => {
        domCalls++;
        const el = document.createElement("button");
        el.textContent = "门店";
        return el;
      },
      { anchor: { x: 0.5, y: 1 }, offset: { x: 2, y: -2 }, zIndex: 8 },
    );
    expect(ctx.rawOf(custom)).toBeInstanceOf(ctx.fake.namespace.CustomOverlay);
    expect(domCalls).toBe(0); // SDK 只在挂载时调用 DOM 工厂
    expect(ctx.rawOf(custom).options).toMatchObject({
      anchors: [0.5, 1],
      offsetX: 2,
      offsetY: -2,
      zIndex: 8,
    });
    expect((ctx.rawOf(custom).options as { point?: unknown }).point).toBeInstanceOf(
      ctx.fake.namespace.Point,
    );
  });

  it("缺少构造器时抛结构化错误（不是静默返回空句柄）", () => {
    const { Marker, Rectangle, ...rest } = ctx.fake.namespace;
    void Marker;
    void Rectangle;
    const overlays = createJsapiV4OverlayDriver({
      rawSdk: rest,
      geometry: ctx.geometry,
      capabilities: ctx.capabilities,
      registry: ctx.registry,
    });
    expect(() => overlays.createMarker({ lng: 0, lat: 0 })).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(() =>
      overlays.createRectangle({
        southwest: { lng: 0, lat: 0 },
        northeast: { lng: 1, lat: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }));
  });
});

/* -------------------------------------------------------------------------- */
/* 2. add / remove / show / hide 与 Target                                       */
/* -------------------------------------------------------------------------- */

describe("挂载与释放", () => {
  it("add / remove 以 map.addOverlay / removeOverlay 落地，且不会重复挂载", () => {
    const marker = ctx.marker();
    ctx.overlays.add(ctx.mapTarget(), marker);
    ctx.overlays.add(ctx.mapTarget(), marker);
    expect(ctx.rawMap.overlays).toHaveLength(1);
    expect(ctx.rawOf(marker).attachedMap).toBe(ctx.rawMap);

    ctx.overlays.remove(ctx.mapTarget(), marker);
    expect(ctx.rawMap.overlays).toHaveLength(0);
    expect(ctx.rawOf(marker).attachedMap).toBeNull();
  });

  it("show / hide 经官方 Overlay#show/hide，返回是否真正应用", () => {
    const marker = ctx.marker();
    expect(ctx.overlays.hide(marker)).toBe(true);
    expect(ctx.rawOf(marker).visible).toBe(false);
    expect(ctx.overlays.show(marker)).toBe(true);
    expect(ctx.rawOf(marker).visible).toBe(true);
    // 没有 show/hide 的实例返回 false，交给调用方回退 add/remove
    const bare = ctx.registry.adopt("overlay:marker", {});
    expect(ctx.overlays.show(bare)).toBe(false);
  });

  it("非 Map 目标显式失败，且不产生半挂载", () => {
    const marker = ctx.marker();
    const other = ctx.marker();
    expect(() =>
      ctx.overlays.add({ kind: "marker", handle: other }, marker),
    ).toThrowError(expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }));
    expect(ctx.rawMap.overlays).toHaveLength(0);
    expect(ctx.rawOf(marker).attachedMap).toBeNull();
  });

  it("remove 之后的 remove 与 hide 幂等，不抛错", () => {
    const marker = ctx.marker();
    ctx.overlays.add(ctx.mapTarget(), marker);
    ctx.overlays.remove(ctx.mapTarget(), marker);
    expect(() => ctx.overlays.remove(ctx.mapTarget(), marker)).not.toThrow();
  });

  it("跨 Client 的句柄在对覆盖物的任何操作上都被拒绝", () => {
    const foreign = createJsapiV4HandleRegistry();
    const foreignMarker = foreign.adopt(
      "overlay:marker",
      new ctx.fake.namespace.Marker(new ctx.fake.namespace.Point(0, 0)),
    );
    expect(() => ctx.overlays.add(ctx.mapTarget(), foreignMarker)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
    expect(() => ctx.overlays.setOptions(foreignMarker, { title: "x" })).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 3. setOptions：属性分类驱动的更新                                              */
/* -------------------------------------------------------------------------- */

describe("属性分类驱动的 setOptions", () => {
  it("mutable 属性走字段级 setter，不重建实例", () => {
    const marker = ctx.marker();
    const before = ctx.fake.createdOverlays.length;

    ctx.overlays.setOptions(marker, {
      offset: { x: 3, y: 4 },
      title: "新标题",
      zIndex: 5,
      rotation: 45,
      enableDragging: true,
      enableMassClear: false,
    });

    const log = ctx.rawOf(marker).callLog as string[];
    expect(log).toContain("setOffset");
    expect(log).toContain("setTitle");
    expect(log).toContain("setZIndex");
    expect(log).toContain("setRotation");
    expect(log).toContain("enableDragging");
    expect(log).toContain("disableMassClear");
    expect(ctx.fake.createdOverlays.length).toBe(before);
  });

  it("mutable 的 icon 走 setIcon，并把领域 icon 描述转成 Icon 实例", () => {
    const marker = ctx.marker();
    ctx.overlays.setOptions(marker, {
      icon: { imageUrl: "https://example.com/b.png", size: { width: 10, height: 10 } },
    });
    expect(ctx.rawOf(marker).callLog).toContain("setIcon");
    expect(ctx.rawOf(marker).icon).toBeInstanceOf(ctx.fake.namespace.Icon);
  });

  it("recreate 属性不就地更新：告警一次，等待调用方重建", () => {
    const marker = ctx.marker();
    const before = ctx.fake.createdOverlays.length;

    ctx.overlays.setOptions(marker, { enableClicking: false });
    ctx.overlays.setOptions(marker, { enableClicking: true });

    expect(ctx.rawOf(marker).callLog).not.toContain("setOptions");
    expect(ctx.fake.createdOverlays.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("enableClicking");
  });

  it("unsupported 属性显式告警（Polyline 没有填充、InfoWindow 没有 setPosition）", () => {
    const polyline = ctx.overlays.createPolyline([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }]);
    ctx.overlays.setOptions(polyline, { fillColor: "#fff" });
    expect(String(warn.mock.calls[0][0])).toContain("fillColor");

    warn.mockClear();
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.setOptions(infoWindow, { position: { lng: 1, lat: 1 } });
    expect(String(warn.mock.calls[0][0])).toContain("openInfoWindow");
  });

  it("未知键走 set<Key> 逃生口，方法不存在时告警一次", () => {
    const marker = ctx.marker();
    ctx.overlays.setOptions(marker, { rank: 3 });
    expect(ctx.rawOf(marker).callLog).toContain("setRank");

    warn.mockClear();
    ctx.overlays.setOptions(marker, { unknownThing: 1 });
    ctx.overlays.setOptions(marker, { unknownThing: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("updatePolicy 是属性分类的唯一入口（未知键 undefined）", () => {
    const marker = ctx.marker();
    expect(ctx.overlays.updatePolicy(marker, "icon")).toBe("mutable");
    expect(ctx.overlays.updatePolicy(marker, "position")).toBe("mutable");
    expect(ctx.overlays.updatePolicy(marker, "enableClicking")).toBe("recreate");
    expect(ctx.overlays.updatePolicy(marker, "anchor")).toBe("recreate");
    expect(ctx.overlays.updatePolicy(marker, "notAProperty")).toBeUndefined();

    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    expect(ctx.overlays.updatePolicy(infoWindow, "offset")).toBe("recreate");
    expect(ctx.overlays.updatePolicy(infoWindow, "position")).toBe("unsupported");

    ctx.overlays.createPolygon([{ lng: 0, lat: 0 }]);
    // 非覆盖物句柄：返回 undefined 而不是抛错（纯元数据查询）
    expect(ctx.overlays.updatePolicy(ctx.map as never, "icon")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 4. InfoWindow 专用 API                                                       */
/* -------------------------------------------------------------------------- */

describe("InfoWindow 专用 open / close / redraw", () => {
  it("openInfoWindow 用 map.openInfoWindow(iw, point)，closeInfoWindow 用 map.closeInfoWindow()", () => {
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.openInfoWindow(ctx.map, infoWindow, { lng: 116.4, lat: 39.9 });

    expect(ctx.rawMap.infoWindow).toBe(ctx.rawOf(infoWindow));
    expect(ctx.rawMap.callLog).toContain("openInfoWindow");
    expect((ctx.rawOf(infoWindow).isOpen as () => boolean)()).toBe(true);
    expect(ctx.rawOf(infoWindow).openedAt).toMatchObject({ lng: 116.4, lat: 39.9 });

    ctx.overlays.closeInfoWindow(infoWindow);
    expect(ctx.rawMap.infoWindow).toBeNull();
    expect(ctx.rawMap.callLog).toContain("closeInfoWindow");
    expect((ctx.rawOf(infoWindow).isOpen as () => boolean)()).toBe(false);
    // 幂等：重复关闭不抛错
    expect(() => ctx.overlays.closeInfoWindow(infoWindow)).not.toThrow();
  });

  it("open 之后立刻 close（真实 SDK 尚未打开：getInfoWindow 仍为空）仍然关闭", () => {
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.openInfoWindow(ctx.map, infoWindow, { lng: 1, lat: 1 });
    // 真实 4.0 的打开是异步的：`openInfoWindow()` 之后同一 tick 里 `map.getInfoWindow()` 仍是
    // `null`（真实 AK smoke：0ms 为 null、~100ms 变成该实例）。这里手工复现那个窗口。
    ctx.rawMap.infoWindow = null;

    ctx.overlays.closeInfoWindow(infoWindow);
    expect(ctx.rawMap.callLog).toContain("closeInfoWindow");
  });

  it("closeInfoWindow 不会关掉别的组件当前打开的气泡（状态来自公开 getInfoWindow）", () => {
    const mine = ctx.overlays.createInfoWindow(document.createElement("div"));
    const theirs = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.openInfoWindow(ctx.map, mine, { lng: 1, lat: 1 });
    ctx.overlays.openInfoWindow(ctx.map, theirs, { lng: 2, lat: 2 });

    ctx.overlays.closeInfoWindow(mine);
    expect(ctx.rawMap.infoWindow).toBe(ctx.rawOf(theirs));
    expect((ctx.rawOf(theirs).isOpen as () => boolean)()).toBe(true);
  });

  it("没有位置时显式失败：不保留实例级运行时回退（官方 4.0 的 point 是必需参数）", () => {
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));

    // 运行期兜底（类型已被约束成必需，这里验证 JS 调用方 / 类型被绕过的情形）
    expect(() =>
      ctx.overlays.openInfoWindow(ctx.map, infoWindow, undefined as never),
    ).toThrowError(
      expect.objectContaining({
        code: "BMAP_INVALID_ARGUMENT",
        message: expect.stringContaining("position"),
      }),
    );
    expect((ctx.rawOf(infoWindow).isOpen as () => boolean)(), "没有位置就不该打开").toBe(false);
    expect(ctx.rawMap.callLog).not.toContain("openInfoWindow");
    expect(ctx.rawMap.callLog).not.toContain("infoWindow.openInfoWindow");
  });

  it("redrawInfoWindow 未打开时是 no-op，打开后才真正重绘", () => {
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.redrawInfoWindow(infoWindow);
    expect(ctx.rawOf(infoWindow).redrawCalls).toBe(0);

    ctx.overlays.openInfoWindow(ctx.map, infoWindow, { lng: 1, lat: 1 });
    ctx.overlays.redrawInfoWindow(infoWindow);
    expect(ctx.rawOf(infoWindow).redrawCalls).toBe(1);
  });

  it("InfoWindow 不作为普通 Overlay 加/摘", () => {
    const infoWindow = ctx.overlays.createInfoWindow(document.createElement("div"));
    expect(() => ctx.overlays.add(ctx.mapTarget(), infoWindow)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
    expect(() => ctx.overlays.remove(ctx.mapTarget(), infoWindow)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
    expect(ctx.rawMap.overlays).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. 右键菜单                                                                  */
/* -------------------------------------------------------------------------- */

describe("右键菜单", () => {
  it("ContextMenu 挂在 Map 上，MenuItem 带 width，分隔线走 addSeparator", () => {
    const menu = ctx.overlays.createContextMenu({ width: 160 });
    const handler = vi.fn();
    ctx.overlays.addContextMenuItem(menu, { text: "设为地图中心", callback: handler });
    ctx.overlays.addContextMenuItem(menu, "-");

    const raw = ctx.rawOf(menu);
    expect(raw).toBeInstanceOf(ctx.fake.namespace.ContextMenu);
    expect(raw.items).toHaveLength(2);
    expect((raw.items as { options: { width?: number } }[])[0].options).toMatchObject({
      width: 160,
    });
    expect(raw.callLog).toContain("addSeparator");

    ctx.overlays.attachContextMenu(ctx.mapTarget(), menu);
    expect(ctx.rawMap.contextMenus).toContain(raw);
    ctx.overlays.detachContextMenu(ctx.mapTarget(), menu);
    expect(ctx.rawMap.contextMenus).not.toContain(raw);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. 本引擎没有运行时入口的成员                                                  */
/* -------------------------------------------------------------------------- */

describe("运行时扩展成员", () => {
  it("createMarker3D / createMapMask 显式失败（4.0.4 与官方参考都没有该声明）", () => {
    expect(() => ctx.overlays.createMarker3D({ lng: 0, lat: 0 }, 100)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(() => ctx.overlays.createMapMask([{ lng: 0, lat: 0 }])).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("Marker3D");
  });

  it("命名空间确实提供 Marker3D 时按结构创建（不预判版本）", () => {
    const seen: unknown[] = [];
    class RuntimeMarker3D {
      constructor(point: unknown, height: number, options: Record<string, unknown>) {
        seen.push({ point, height, options });
      }
    }
    const overlays = createJsapiV4OverlayDriver({
      rawSdk: { ...ctx.fake.namespace, Marker3D: RuntimeMarker3D },
      geometry: ctx.geometry,
      capabilities: createCapabilityRegistry({
        engine: "jsapi-v4",
        version: ctx.fake.namespace.VERSION,
        rawSdk: { ...ctx.fake.namespace, Marker3D: RuntimeMarker3D },
        unsupported: "throw",
      }),
      registry: ctx.registry,
    });
    const handle = overlays.createMarker3D({ lng: 1, lat: 2 }, 50, { zIndex: 3 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ height: 50, options: { zIndex: 3 } });
    expect(ctx.rawOf(handle)).toBeInstanceOf(RuntimeMarker3D);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. buildIcon 与 setPosition 的 v4 语义                                       */
/* -------------------------------------------------------------------------- */

describe("buildIcon 与 setPosition", () => {
  it("对象形式 → Icon(imageUrl, Size, { anchor, imageOffset, imageSize })", () => {
    const icon = ctx.overlays.buildIcon({
      imageUrl: "https://example.com/i.png",
      size: { width: 24, height: 32 },
      anchor: { x: 12, y: 32 },
      imageOffset: { x: 1, y: 1 },
      imageSize: { width: 48, height: 64 },
    }) as InstanceType<FakeBMapV4["namespace"]["Icon"]>;

    expect(icon).toBeInstanceOf(ctx.fake.namespace.Icon);
    expect(icon.imageUrl).toBe("https://example.com/i.png");
    expect(icon.size).toMatchObject({ width: 24, height: 32 });
  });

  it("内置名称走雪碧图映射；printImageUrl 在 v4 无对应项 → 丢弃 + 告警", () => {
    const icon = ctx.overlays.buildIcon("simple_red") as InstanceType<
      FakeBMapV4["namespace"]["Icon"]
    >;
    expect(icon.imageUrl).toContain("markers_new2x");
    expect(icon.imageOffset).toMatchObject({ width: 227, height: 189 });

    ctx.overlays.buildIcon({
      imageUrl: "https://example.com/i.png",
      size: { width: 8, height: 8 },
      printImageUrl: "https://example.com/print.png",
    });
    expect(String(warn.mock.calls[0][0])).toContain("printImageUrl");
  });

  it("setPosition 对 Circle 走 setCenter、对 CustomOverlay 只位移（不重建业务 DOM）", () => {
    const circle = ctx.overlays.createCircle({ lng: 1, lat: 1 }, 100);
    ctx.overlays.setPosition(circle, { lng: 2, lat: 2 });
    expect(ctx.rawOf(circle).callLog).toContain("setCenter");

    const custom = ctx.overlays.createCustomOverlay({ lng: 1, lat: 1 }, () =>
      document.createElement("div"),
    );
    ctx.overlays.setPosition(custom, { lng: 3, lat: 3 });
    expect(ctx.rawOf(custom).callLog).toContain("setPoint:noReCreate");
    expect(ctx.rawOf(custom).domCreateCalls).toBe(0);
  });

  it("setPath 走 setPath", () => {
    const polyline = ctx.overlays.createPolyline([{ lng: 0, lat: 0 }]);
    ctx.overlays.setPath(polyline, [
      { lng: 5, lat: 5 },
      { lng: 6, lat: 6 },
    ]);
    expect(ctx.rawOf(polyline).callLog).toContain("setPath");
    expect(ctx.rawOf(polyline).path).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. PR #61 评审反例（先红后绿）                                                */
/* -------------------------------------------------------------------------- */

describe("PR #61 评审反例", () => {
  it("[P2-2] setOptions({ position }) 与 setPosition 一致：只位移、不重建业务 DOM", () => {
    const custom = ctx.overlays.createCustomOverlay({ lng: 1, lat: 1 }, () =>
      document.createElement("div"),
    );
    ctx.overlays.add(ctx.mapTarget(), custom);

    ctx.overlays.setOptions(custom, { position: { lng: 3, lat: 3 } });

    // 官方 setPoint 的第二参数默认 false（会重建 DOM）；通用入口必须与专用入口同样传 true
    expect(ctx.rawOf(custom).callLog).toContain("setPoint:noReCreate");
    expect(ctx.rawOf(custom).domCreateCalls).toBe(0);
  });

  it("[P2-3] createMarker3D 之后 setPosition 使用 setPoint（运行时实测的经纬度入口）", () => {
    class RuntimeMarker3D {
      point: unknown = null
      /** 实测：`setPosition` 会把经纬度写坏，因此描述符**不能**映射到它 */
      setPositionCalls = 0
      constructor(point: unknown) {
        this.point = point
      }
      setPoint(point: unknown): void {
        this.point = point
      }
      setPosition(): void {
        this.setPositionCalls++
      }
    }
    const overlays = createJsapiV4OverlayDriver({
      rawSdk: { ...ctx.fake.namespace, Marker3D: RuntimeMarker3D },
      geometry: ctx.geometry,
      capabilities: createCapabilityRegistry({
        engine: "jsapi-v4",
        version: ctx.fake.namespace.VERSION,
        rawSdk: { ...ctx.fake.namespace, Marker3D: RuntimeMarker3D },
        unsupported: "throw",
      }),
      registry: ctx.registry,
    });
    const handle = overlays.createMarker3D({ lng: 1, lat: 2 }, 50);

    expect(() => overlays.setPosition(handle, { lng: 3, lat: 4 })).not.toThrow();
    expect((handle.raw as RuntimeMarker3D).point).toMatchObject({ lng: 3, lat: 4 });
    expect((handle.raw as RuntimeMarker3D).setPositionCalls).toBe(0);
  });

  it("[P2-4] CustomOverlay 已声明的构造期属性在描述符里有分类（recreate）", () => {
    const custom = ctx.overlays.createCustomOverlay(
      { lng: 1, lat: 1 },
      () => document.createElement("div"),
      { offset: { x: 1, y: 1 }, anchor: { x: 0, y: 1 }, minZoom: 10, maxZoom: 18 },
    );

    for (const key of ["offset", "anchor", "minZoom", "maxZoom"]) {
      expect(ctx.overlays.updatePolicy(custom, key)).toBe("recreate");
    }
  });

  it("[P2-4] CustomOverlay 构造期属性走 setOptions 时告警一次（而不是落到未知 setter）", () => {
    const custom = ctx.overlays.createCustomOverlay({ lng: 1, lat: 1 }, () =>
      document.createElement("div"),
    );
    ctx.overlays.setOptions(custom, { offset: { x: 2, y: 2 }, minZoom: 12 });

    expect(warn).toHaveBeenCalledTimes(2); // 每个键各一次（recreate 告警）
    expect(String(warn.mock.calls[0][0])).toContain("offset");
  });

  it("[双气泡风险] 两个打开请求都未完成时，关闭先前的那个不会碰地图", () => {
    const a = ctx.overlays.createInfoWindow(document.createElement("div"));
    const b = ctx.overlays.createInfoWindow(document.createElement("div"));

    ctx.overlays.openInfoWindow(ctx.map, a, { lng: 1, lat: 1 });
    ctx.rawMap.infoWindow = null; // 真实 SDK：打开是异步的，此刻 A 还没成为当前气泡
    ctx.overlays.openInfoWindow(ctx.map, b, { lng: 2, lat: 2 });
    ctx.rawMap.infoWindow = null; // B 也仍在打开中

    const closesBefore = ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length;
    ctx.overlays.closeInfoWindow(a);

    // 地图上「最近一次被请求打开的气泡」是 B → 关 A 不能调用地图级 close（否则会取消 B 的打开）
    expect(ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length).toBe(closesBefore);
  });

  it("[双气泡风险] 单气泡快速开关仍然生效（不因上面的收紧而回归）", () => {
    const only = ctx.overlays.createInfoWindow(document.createElement("div"));
    ctx.overlays.openInfoWindow(ctx.map, only, { lng: 1, lat: 1 });
    ctx.rawMap.infoWindow = null; // 尚未真正打开
    ctx.overlays.closeInfoWindow(only);
    expect(ctx.rawMap.callLog).toContain("closeInfoWindow");
  });

  it("[迟到接管] 当前气泡确实是我 ⇒ 即使最后请求者不是我，关闭也必须真的发给地图", () => {
    const a = ctx.overlays.createInfoWindow(document.createElement("div"));
    const b = ctx.overlays.createInfoWindow(document.createElement("div"));

    ctx.overlays.openInfoWindow(ctx.map, a, { lng: 1, lat: 1 });
    ctx.rawMap.infoWindow = null; // A 的打开仍在飞
    ctx.overlays.openInfoWindow(ctx.map, b, { lng: 2, lat: 2 }); // 最后请求者变成 B
    // ★ A 的迟到请求这时才真正接管：地图上「当前气泡」实际就是 A。
    // 这与「两个请求都没完成」是两种不同的局面 —— 前者地图上确实显示着 A，
    // 此刻关 A 既是在执行调用方的明确意图，也不会动到任何别的气泡。
    ctx.rawMap.infoWindow = ctx.rawOf(a);

    const closesBefore = ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length;
    ctx.overlays.closeInfoWindow(a);

    expect(
      ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length,
      "地图上开着的就是 A ⇒ 这条 close 必须真的发出去（否则气泡留在图上、账也没人还）",
    ).toBe(closesBefore + 1);
    expect(ctx.rawMap.infoWindow).toBeNull();
  });

  it("[迟到接管] 当前气泡是别人时仍然不碰地图（反向：别把收紧改松）", () => {
    const a = ctx.overlays.createInfoWindow(document.createElement("div"));
    const b = ctx.overlays.createInfoWindow(document.createElement("div"));

    ctx.overlays.openInfoWindow(ctx.map, a, { lng: 1, lat: 1 });
    ctx.overlays.openInfoWindow(ctx.map, b, { lng: 2, lat: 2 });

    const closesBefore = ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length;
    ctx.overlays.closeInfoWindow(a);

    expect(
      ctx.rawMap.callLog.filter((c) => c === "closeInfoWindow").length,
      "当前气泡是 B ⇒ 关 A 不得调用地图级 close（会关掉 B）",
    ).toBe(closesBefore);
    expect(ctx.rawMap.infoWindow).toBe(ctx.rawOf(b));
  });
});

/* -------------------------------------------------------------------------- */
/* 8. 描述符与 Capability Catalog 同源                                          */
/* -------------------------------------------------------------------------- */

describe("属性描述符与能力目录同源", () => {
  it("有能力的 kind：构造器名必须等于 Capability Catalog 的 rawMembers[0]（防止两处漂移）", () => {
    for (const [kind, descriptor] of Object.entries(OVERLAY_DESCRIPTORS)) {
      if (!descriptor.capability) continue;
      // 构造器名刻意写成字面量（这样 `as const` 才能做官方类型一致性断言），
      // 因此用这条断言把「两处必须一致」变成会失败的测试而不是口头约定。
      expect(
        `${kind} → ${descriptor.ctor}`,
      ).toBe(`${kind} → ${CAPABILITY_CATALOG[descriptor.capability].rawMembers?.[0]}`);
    }
  });

  it("没有能力的 kind（map-mask）在目录里没有对应能力项", () => {
    expect(OVERLAY_DESCRIPTORS["map-mask"].capability).toBeUndefined();
  });
});
