/**
 * 精简地图命令面（M4-HANDLE-UX / issue #29）
 *
 * 命令面的契约只有三条，三条都要能被证伪：
 * 1. **没句柄**：读返回 `null`（不是抛错、也不是「排到就绪后再放」）、写是空操作、`supports` 为 `false`；
 * 2. **有句柄**：命令逐条透传到 Driver 的对应方法（参数原样，不做二次加工）；
 * 3. **读的容错口径与 `readLiveView` 一致**：「资源已销毁 / 该能力不可用」算读不到，
 *    其余 `BMapError` 与非 `BMapError` 一律上抛 —— 把「读错」当成「读不到」就是静默失效。
 */
import { describe, expect, it, vi } from "vitest";
import type { BMapClient } from "../../client/types";
import type { Bounds, Pixel, Point } from "../../driver/types/geometry";
import type { MapHandle } from "../../driver/types/handles";
import type { Viewport } from "../../driver/types/map";
import { BMapError } from "../errors/BMapError";
import { createMapCommands } from "./mapCommands";

const POINT: Point = { lng: 116.404, lat: 39.915 };
const PIXEL: Pixel = { x: 12, y: -8 };
const BOUNDS: Bounds = { southwest: { lng: 116, lat: 39 }, northeast: { lng: 117, lat: 40 } };
const SIZE = { width: 320, height: 240 };
const VIEWPORT: Viewport = { center: POINT, zoom: 12 };
const SCREENSHOT = "data:image/png;base64,iVBORw0KGgo=";

function createFixture() {
  const mapDriver = {
    getCenter: vi.fn(() => POINT),
    getZoom: vi.fn(() => 12),
    getHeading: vi.fn(() => 30),
    getTilt: vi.fn(() => 45),
    getBounds: vi.fn(() => BOUNDS),
    getSize: vi.fn(() => SIZE),
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    setHeading: vi.fn(),
    setTilt: vi.fn(),
    panTo: vi.fn(),
    panBy: vi.fn(),
    fitBounds: vi.fn(),
    getViewport: vi.fn(() => VIEWPORT),
    getScreenshot: vi.fn(() => SCREENSHOT),
    flyTo: vi.fn(),
  };
  const supports = vi.fn((capability: string) => capability === "map.zoom");
  const client = {
    capabilities: { supports },
    driver: { map: mapDriver },
  } as unknown as BMapClient;
  const map = { brand: "map" } as unknown as MapHandle;

  let target: { client: BMapClient; map: MapHandle } | null = { client, map };
  const commands = createMapCommands({
    client: () => target?.client ?? null,
    map: () => target?.map ?? null,
  });
  return {
    commands,
    mapDriver,
    supports,
    detach: () => {
      target = null;
    },
    reattach: () => {
      target = { client, map };
    },
  };
}

describe("createMapCommands：没有句柄时", () => {
  it("读命令全给 null，写命令与 supports 走各自的空路径", () => {
    const { commands, mapDriver, supports, detach } = createFixture();
    detach();

    expect(commands.getCenter()).toBeNull();
    expect(commands.getZoom()).toBeNull();
    expect(commands.getHeading()).toBeNull();
    expect(commands.getTilt()).toBeNull();
    expect(commands.getBounds()).toBeNull();
    expect(commands.getSize()).toBeNull();
    expect(commands.getViewport([POINT])).toBeNull();
    expect(commands.getViewport(BOUNDS)).toBeNull();
    expect(commands.getScreenshot()).toBeNull();
    expect(commands.supports("map.zoom"), "「还不知道」与「不支持」在调用方视角合并成 false").toBe(
      false,
    );

    commands.setCenter(POINT);
    commands.setZoom(14);
    commands.setHeading(0);
    commands.setTilt(0);
    commands.panTo(POINT);
    commands.panBy(PIXEL);
    commands.fitBounds(BOUNDS);
    commands.flyTo(POINT, 15);
    expect(mapDriver.setCenter).not.toHaveBeenCalled();
    expect(mapDriver.setZoom).not.toHaveBeenCalled();
    expect(mapDriver.setHeading).not.toHaveBeenCalled();
    expect(mapDriver.setTilt).not.toHaveBeenCalled();
    expect(mapDriver.panTo).not.toHaveBeenCalled();
    expect(mapDriver.panBy).not.toHaveBeenCalled();
    expect(mapDriver.fitBounds).not.toHaveBeenCalled();
    expect(mapDriver.getViewport).not.toHaveBeenCalled();
    expect(mapDriver.getScreenshot).not.toHaveBeenCalled();
    expect(mapDriver.flyTo).not.toHaveBeenCalled();
    expect(supports).not.toHaveBeenCalled();
  });
});

describe("createMapCommands：有句柄时", () => {
  it("读命令逐条透传，不做二次加工", () => {
    const { commands, mapDriver } = createFixture();
    expect(commands.getCenter()).toEqual(POINT);
    expect(commands.getZoom()).toBe(12);
    expect(commands.getHeading()).toBe(30);
    expect(commands.getTilt()).toBe(45);
    expect(commands.getBounds()).toEqual(BOUNDS);
    expect(commands.getSize()).toEqual(SIZE);
    expect(mapDriver.getCenter).toHaveBeenCalledTimes(1);
  });

  // #165 回填：`getViewport` / `getScreenshot` / `flyTo` 三条命令透传不做二次加工。
  it("getViewport 两种 view 形态与 options 都按参数原样透传给 Driver", () => {
    const { commands, mapDriver } = createFixture();
    const options = { margins: [10, 20, 30, 40] };

    expect(commands.getViewport([POINT])).toEqual(VIEWPORT);
    expect(mapDriver.getViewport).toHaveBeenNthCalledWith(1, expect.anything(), [POINT], undefined);

    expect(commands.getViewport(BOUNDS, options)).toEqual(VIEWPORT);
    expect(mapDriver.getViewport).toHaveBeenNthCalledWith(2, expect.anything(), BOUNDS, options);
  });

  it("getScreenshot 透传 Driver 的返回值（业务自己拿到的就是 SDK 那一串）", () => {
    const { commands, mapDriver } = createFixture();
    expect(commands.getScreenshot()).toBe(SCREENSHOT);
    expect(mapDriver.getScreenshot).toHaveBeenCalledWith(expect.anything());
  });

  it("flyTo 按参数原样透传（center / zoom / options 一次到位）", () => {
    const { commands, mapDriver } = createFixture();
    const options = { noAnimation: true };
    commands.flyTo(POINT, 15, options);
    expect(mapDriver.flyTo).toHaveBeenCalledWith(expect.anything(), POINT, 15, options);
  });

  it("写命令按参数原样透传（每个方法一次）", () => {
    const { commands, mapDriver } = createFixture();
    commands.setCenter(POINT);
    commands.setZoom(15);
    commands.setHeading(90);
    commands.setTilt(20);
    commands.panTo(POINT);
    commands.panBy(PIXEL);
    commands.fitBounds(BOUNDS);

    // 五条视野命令多出的第三个参数是官方的 `options`（#171）：不传时是 `undefined`，
    // 命令面**不**把它换成 `{}`（判空与投影是 Driver 的职责，命令面再实现一份就会漂移）
    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), POINT, undefined);
    expect(mapDriver.setZoom).toHaveBeenCalledWith(expect.anything(), 15, undefined);
    expect(mapDriver.setHeading).toHaveBeenCalledWith(expect.anything(), 90, undefined);
    expect(mapDriver.setTilt).toHaveBeenCalledWith(expect.anything(), 20, undefined);
    expect(mapDriver.panTo).toHaveBeenCalledWith(expect.anything(), POINT, undefined);
    expect(mapDriver.panBy).toHaveBeenCalledWith(expect.anything(), PIXEL);
    expect(mapDriver.fitBounds).toHaveBeenCalledWith(expect.anything(), BOUNDS);
  });

  it("supports 走 Capability Registry", () => {
    const { commands, supports } = createFixture();
    expect(commands.supports("map.zoom")).toBe(true);
    expect(commands.supports("overlay.marker-3d")).toBe(false);
    expect(supports).toHaveBeenCalledWith("overlay.marker-3d");
  });
});

/**
 * #165 Class 2 / E：`setCenter` 的入参在**两张脸上不一致**。
 *
 * `<Map center>` prop 接受 `{lng,lat} | string`（v2 兼容的城市名 / 地址），
 * 官方 `setCenter(center: Point | string, options?)` 也**明确声明**接受 `string`，
 * 而 `MapDriver.setCenter(map, center: Point | string)` 与 `toRawCenter` **已经**处理字符串。
 * 只有命令面 `MapCommands.setCenter(center: Point)` 这一层把它收窄掉了。
 *
 * live 实测（2026-09-27，真实 AK）：`setCenter('北京')` 真的会让地图**动过去**（起点上海
 * → 落点 116.413, 39.911），`setCenter('NotACityName-zzz')` 同样不抛错、也真的动了
 * （官方对无法识别的地名**回落到某处**而不是拒绝）。因此「命令面不能收字符串」不只是
 * 少一个类型：它让「prop 收、命令不收」这件事在同一个组件上自相矛盾。
 */
describe("createMapCommands：setCenter 接受官方声明的 string 中心（#165 Class 2 / E）", () => {
  it("字符串中心按原样透传给 Driver（Driver 已有的 Point | string 收窄不被这里截断）", () => {
    const { commands, mapDriver } = createFixture();
    commands.setCenter("北京");
    // 第三个参数是 options（#171 补齐的官方第二个参数）：不传时是 `undefined`，
    // 命令面**不**把它换成 `{}`——判空与投影都是 Driver 的职责
    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), "北京", undefined);
  });

  it("点形态不受影响", () => {
    const { commands, mapDriver } = createFixture();
    commands.setCenter(POINT);
    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), POINT, undefined);
  });
});

describe("createMapCommands：错误口径", () => {
  it("读：资源已销毁 / 能力不可用 ⇒ null（这两种「本来就读不到」）", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.getCenter.mockImplementation(() => {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "disposed");
    });
    mapDriver.getZoom.mockImplementation(() => {
      throw new BMapError("BMAP_CAPABILITY_UNSUPPORTED", "no capability");
    });
    expect(commands.getCenter()).toBeNull();
    expect(commands.getZoom()).toBeNull();
  });

  it("读：其余 BMapError 与编程错误一律上抛（不伪装成「读不到」）", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.getBounds.mockImplementation(() => {
      throw new BMapError("BMAP_SDK_CALL_FAILED", "sdk boom");
    });
    expect(() => commands.getBounds()).toThrowError(/sdk boom/);

    mapDriver.getSize.mockImplementation(() => {
      throw new TypeError("bad state");
    });
    expect(() => commands.getSize()).toThrowError(TypeError);
  });

  it("写：SDK 错误如实抛出（不做「静默失败」）", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.setZoom.mockImplementation(() => {
      throw new BMapError("BMAP_INVALID_ARGUMENT", "zoom out of range");
    });
    expect(() => commands.setZoom(99)).toThrowError(/zoom out of range/);
  });

  // #165 回填：三个新成员沿用**同一条**错误口径，不因为「是新加的」就另立一套。
  it("读：getViewport / getScreenshot 在资源已销毁或能力不可用时给 null", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.getViewport.mockImplementation(() => {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "disposed");
    });
    mapDriver.getScreenshot.mockImplementation(() => {
      throw new BMapError("BMAP_CAPABILITY_UNSUPPORTED", "no capability");
    });
    expect(commands.getViewport([POINT])).toBeNull();
    expect(commands.getScreenshot()).toBeNull();
  });

  it("读：getViewport / getScreenshot 的其余错误一律上抛", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.getViewport.mockImplementation(() => {
      throw new BMapError("BMAP_INVALID_POINT", "bad point");
    });
    mapDriver.getScreenshot.mockImplementation(() => {
      throw new BMapError("BMAP_SDK_CALL_FAILED", "screenshot boom");
    });
    expect(() => commands.getViewport([POINT])).toThrowError(/bad point/);
    expect(() => commands.getScreenshot()).toThrowError(/screenshot boom/);
  });

  it("写：flyTo 的 SDK 错误如实上抛，不吞成「飞过了」", () => {
    const { commands, mapDriver } = createFixture();
    mapDriver.flyTo.mockImplementation(() => {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "disposed");
    });
    expect(() => commands.flyTo(POINT, 15)).toThrowError(/disposed/);
  });
});

/**
 * 视野命令的 `options` 透传（#171 / #165 裁决 F）。
 *
 * 这一层只锁**接线**：`options` 原样到达 Driver。判空（空对象不下发）、`zoomCenter` 的几何
 * 投影、callback 的交付都在 Driver 那一层验（`driver/jsapi-v4/map.test.ts`）。
 *
 * 「原样」是刻意的：命令面不判空、不填默认、不包装 callback —— 它再实现一份就会与 Driver 的
 * `toRaw*Options` 漂移，而漂移的表现是「空对象被递给 SDK」这类只在真实引擎上才看得出来的偏差。
 */
describe("createMapCommands：options 原样透传给 Driver（#171）", () => {
  it("五条命令都把 options 按引用递下去（不复制、不补默认）", () => {
    const { commands, mapDriver } = createFixture();
    const options = { noAnimation: true, callback: (): void => {} };

    commands.setCenter(POINT, options);
    commands.setZoom(15, options);
    commands.setHeading(90, options);
    commands.setTilt(20, options);
    commands.panTo(POINT, options);

    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), POINT, options);
    expect(mapDriver.setZoom).toHaveBeenCalledWith(expect.anything(), 15, options);
    expect(mapDriver.setHeading).toHaveBeenCalledWith(expect.anything(), 90, options);
    expect(mapDriver.setTilt).toHaveBeenCalledWith(expect.anything(), 20, options);
    expect(mapDriver.panTo).toHaveBeenCalledWith(expect.anything(), POINT, options);
    // 「按引用」是契约的一部分：包装 callback 就等于改变了上游对它的调用方式
    expect(mapDriver.setCenter.mock.calls[0]![2]).toBe(options);
  });

  it("传空对象时也原样递 `{}`（判空是 Driver 的职责，不在命令面）", () => {
    const { commands, mapDriver } = createFixture();
    const empty = {};

    commands.setCenter(POINT, empty);

    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), POINT, empty);
  });

  it("setZoom 的 zoomCenter 走 SetZoomOptions，不被命令面拆开", () => {
    const { commands, mapDriver } = createFixture();
    const options = { zoomCenter: POINT, noAnimation: true };

    commands.setZoom(15, options);

    expect(mapDriver.setZoom).toHaveBeenCalledWith(expect.anything(), 15, options);
  });

  it("panTo 的 duration 走 PanToOptions", () => {
    const { commands, mapDriver } = createFixture();
    const options = { duration: 300, noAnimation: false };

    commands.panTo(POINT, options);

    expect(mapDriver.panTo).toHaveBeenCalledWith(expect.anything(), POINT, options);
  });

  it("没有句柄时 options 里的 callback 不会被调用（空操作是真的什么都不做）", () => {
    const { commands, mapDriver, detach } = createFixture();
    let calls = 0;
    detach();

    commands.setCenter(POINT, {
      noAnimation: true,
      callback: () => {
        calls++;
      },
    });

    expect(calls).toBe(0);
    expect(mapDriver.setCenter).not.toHaveBeenCalled();
  });
});
