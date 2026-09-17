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
import { BMapError } from "../errors/BMapError";
import { createMapCommands } from "./mapCommands";

const POINT: Point = { lng: 116.404, lat: 39.915 };
const PIXEL: Pixel = { x: 12, y: -8 };
const BOUNDS: Bounds = { southwest: { lng: 116, lat: 39 }, northeast: { lng: 117, lat: 40 } };
const SIZE = { width: 320, height: 240 };

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
    expect(mapDriver.setCenter).not.toHaveBeenCalled();
    expect(mapDriver.setZoom).not.toHaveBeenCalled();
    expect(mapDriver.setHeading).not.toHaveBeenCalled();
    expect(mapDriver.setTilt).not.toHaveBeenCalled();
    expect(mapDriver.panTo).not.toHaveBeenCalled();
    expect(mapDriver.panBy).not.toHaveBeenCalled();
    expect(mapDriver.fitBounds).not.toHaveBeenCalled();
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

  it("写命令按参数原样透传（每个方法一次）", () => {
    const { commands, mapDriver } = createFixture();
    commands.setCenter(POINT);
    commands.setZoom(15);
    commands.setHeading(90);
    commands.setTilt(20);
    commands.panTo(POINT);
    commands.panBy(PIXEL);
    commands.fitBounds(BOUNDS);

    expect(mapDriver.setCenter).toHaveBeenCalledWith(expect.anything(), POINT);
    expect(mapDriver.setZoom).toHaveBeenCalledWith(expect.anything(), 15);
    expect(mapDriver.setHeading).toHaveBeenCalledWith(expect.anything(), 90);
    expect(mapDriver.setTilt).toHaveBeenCalledWith(expect.anything(), 20);
    expect(mapDriver.panTo).toHaveBeenCalledWith(expect.anything(), POINT);
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
});
