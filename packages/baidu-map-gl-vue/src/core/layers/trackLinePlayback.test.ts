/**
 * TrackLine 播放命令面的参数边界与未就绪口径（#110）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTrackLinePlaybackApi } from "./trackLinePlayback";
import type { TrackLinePlaybackSession } from "./trackLinePlayback";
import type { NativeLayerDriver, NativeLayerHandle } from "../../driver/types/native-layers";

function fakeDriver(): NativeLayerDriver {
  return {
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setProcess: vi.fn(),
  } as unknown as NativeLayerDriver;
}

const handle = {} as NativeLayerHandle;

describe("createTrackLinePlaybackApi", () => {
  let driver: NativeLayerDriver;
  let session: TrackLinePlaybackSession | null;

  beforeEach(() => {
    driver = fakeDriver();
    session = { driver, handle };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("六条命令在会话就绪时转发到 Driver", () => {
    const api = createTrackLinePlaybackApi({
      component: "BTrackLineLayer",
      session: () => session,
    });

    api.start();
    api.pause();
    api.resume();
    api.stop();
    api.setSpeed(2);
    api.setProcess(0.5);

    expect(driver.start).toHaveBeenCalledWith(handle);
    expect(driver.pause).toHaveBeenCalledWith(handle);
    expect(driver.resume).toHaveBeenCalledWith(handle);
    expect(driver.stop).toHaveBeenCalledWith(handle);
    expect(driver.setSpeed).toHaveBeenCalledWith(handle, 2);
    expect(driver.setProcess).toHaveBeenCalledWith(handle, 0.5);
  });

  it("未就绪时告警一次并跳过（不排队、不补发、不碰 Driver）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    session = null;
    const api = createTrackLinePlaybackApi({
      component: "BTrackLineLayer",
      session: () => session,
    });

    api.start();
    api.start(); // 第二次不再告警（warnOnce 按命令去重）
    api.pause();
    api.setProcess(0.3);

    expect(driver.start).not.toHaveBeenCalled();
    expect(driver.pause).not.toHaveBeenCalled();
    expect(driver.setProcess).not.toHaveBeenCalled();
    // 三个不同命令各告警一次（与 featureState 同源：键里带命令名）
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("setProcess 越界在任何会话判定之前抛 BMAP_INVALID_ARGUMENT", () => {
    const api = createTrackLinePlaybackApi({
      component: "BTrackLineLayer",
      session: () => session,
    });

    for (const bad of [-0.1, 1.1, Number.NaN, "0.5" as unknown as number]) {
      expect(() => api.setProcess(bad)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    expect(driver.setProcess).not.toHaveBeenCalled();

    // 合法边界
    expect(() => api.setProcess(0)).not.toThrow();
    expect(() => api.setProcess(1)).not.toThrow();
    expect(driver.setProcess).toHaveBeenCalledTimes(2);
  });

  it("setSpeed 非法值（0 / 负数 / 非有限）在任何会话判定之前抛", () => {
    const api = createTrackLinePlaybackApi({
      component: "BTrackLineLayer",
      session: () => session,
    });

    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => api.setSpeed(bad)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    expect(driver.setSpeed).not.toHaveBeenCalled();
    expect(() => api.setSpeed(0.5)).not.toThrow();
  });

  it("会话在命令之间可以变化（每次重新求值，不捕获旧句柄）", () => {
    const api = createTrackLinePlaybackApi({
      component: "BTrackLineLayer",
      session: () => session,
    });
    api.start();
    expect(driver.start).toHaveBeenCalledWith(handle);

    session = null;
    api.stop();
    expect(driver.stop).not.toHaveBeenCalled();
  });
});
