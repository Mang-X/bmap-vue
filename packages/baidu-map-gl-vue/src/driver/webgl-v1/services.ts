/**
 * webgl-v1 ServiceDriver
 *
 * SDK 服务类统一创建；业务层通过 ServiceHandle 使用。
 * TrackAnimation 依赖插件构造器，缺失时抛 BMAP_PLUGIN_LOAD_FAILED（由插件注册表负责加载）。
 *
 * **不嗅探 SDK 私有面**（R25-C / #72）：这里曾经再导出 `captureJsonpServiceError`（扫 `_rd`
 * 回调注册表、包装回调以还原服务端错误码）。本库源码不得访问 `_rd` / `qt=` / `getSeckeyAndSign`
 * 这类私有面，服务结论只允许来自公开的 callback 参数与实例状态；缺证据时报「不可用」而不是
 * 编造精确错误码。边界见 ADR `2026-09-13-private-sdk-surface-removal.md`。
 */
import { BMapError } from "../../core/errors/BMapError";
import { createHandle, type MapHandle } from "../types/handles";
import type { AutocompleteOptions, ServiceDriver } from "../types/services";
import type { GeometryDriver } from "../types/geometry";
import { sdkCall, sdkCtor, callOptional } from "./internal";

export interface WebGlV1ServiceDriverInput {
  rawSdk: unknown;
  geometry: GeometryDriver;
}

function normalizeLocation(rawSdk: unknown, location: unknown): unknown {
  if (location && typeof location === "object") {
    const maybe = location as { raw?: unknown; lng?: unknown; lat?: unknown };
    if ("raw" in maybe) return maybe.raw;
    if (typeof maybe.lng === "number" && typeof maybe.lat === "number") {
      return new (sdkCtor(rawSdk, "Point"))(maybe.lng, maybe.lat);
    }
  }
  return location;
}

export function createWebGlV1ServiceDriver(input: WebGlV1ServiceDriverInput): ServiceDriver {
  const { rawSdk, geometry } = input;

  return {
    createGeocoder() {
      const Geocoder = sdkCtor(rawSdk, "Geocoder");
      return createHandle("service:geocoder", sdkCall("Geocoder", () => new Geocoder()));
    },

    createConvertor() {
      const Convertor = sdkCtor(rawSdk, "Convertor");
      return createHandle("service:convertor", sdkCall("Convertor", () => new Convertor()));
    },

    createGeolocation(options = {}) {
      const Geolocation = sdkCtor(rawSdk, "Geolocation");
      return createHandle(
        "service:geolocation",
        sdkCall("Geolocation", () => new Geolocation(options)),
      );
    },

    createLocalCity() {
      const LocalCity = sdkCtor(rawSdk, "LocalCity");
      return createHandle("service:local-city", sdkCall("LocalCity", () => new LocalCity()));
    },

    createBoundary() {
      const Boundary = sdkCtor(rawSdk, "Boundary");
      return createHandle("service:boundary", sdkCall("Boundary", () => new Boundary()));
    },

    createAutocomplete(options: AutocompleteOptions) {
      const Autocomplete = sdkCtor(rawSdk, "Autocomplete");
      const location = normalizeLocation(rawSdk, options.location);
      const instance = sdkCall("Autocomplete", () =>
        new Autocomplete({
          location,
          input: options.input,
          types: options.types,
          onSearchComplete: options.onSearchComplete,
        }),
      );
      return createHandle("service:autocomplete", instance);
    },

    /**
     * 与 v4 同形：成员不存在时是 no-op（`callOptional`），不把「该 SDK 没有这个 setter」
     * 变成组件侧的运行时异常——组件只表达意图，落不到哪一层是引擎的事。
     */
    setAutocompleteOptions(handle, options) {
      const raw = handle.raw as {
        setLocation?: (location: unknown) => void;
        setTypes?: (types: string[]) => void;
      };
      if (options.location !== undefined) {
        callOptional(raw, "setLocation", normalizeLocation(rawSdk, options.location));
      }
      if (options.types !== undefined) {
        callOptional(raw, "setTypes", options.types);
      }
    },

    createViewAnimation(keyFrames, options = {}) {
      const ViewAnimation = sdkCtor(rawSdk, "ViewAnimation");
      const frames = keyFrames.map((frame) => ({
        ...frame,
        center:
          typeof frame.center === "object" && frame.center
            ? geometry.toRawPoint(frame.center as { lng: number; lat: number })
            : frame.center,
      }));
      const anim = sdkCall("ViewAnimation", () =>
        new ViewAnimation(frames, {
          duration: options.duration ?? 1000,
          delay: options.delay ?? 0,
          interation: options.loop ?? 1,
        }),
      );
      return createHandle("service:view-animation", anim);
    },

    createTrackAnimation(map: MapHandle, path, options = {}) {
      const TrackAnimationCtor =
        (rawSdk as { TrackAnimation?: unknown }).TrackAnimation ??
        (typeof globalThis !== "undefined"
          ? (globalThis as { BMapGLLib?: { TrackAnimation?: unknown } }).BMapGLLib?.TrackAnimation
          : undefined);
      if (typeof TrackAnimationCtor !== "function") {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          "TrackAnimation plugin is not ready. Add plugins=['TrackAnimation'] to BMap.",
        );
      }
      const Polyline = sdkCtor(rawSdk, "Polyline");
      const polyline = sdkCall("Polyline", () =>
        new Polyline(geometry.toRawPoints(path), {
          strokeColor: "#1677ff",
          strokeWeight: 5,
          strokeOpacity: 0.9,
        }),
      );
      const animation = sdkCall("TrackAnimation", () =>
        new (TrackAnimationCtor as new (...args: unknown[]) => unknown)(
          map.raw,
          polyline,
          options,
        ),
      );
      return createHandle("service:track-animation", animation);
    },
  };
}
