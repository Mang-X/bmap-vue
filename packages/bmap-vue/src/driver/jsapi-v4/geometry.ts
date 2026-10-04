/**
 * v4 GeometryDriver（M3A2-02 / issue #19）
 *
 * 把官方值对象（`BMap.Point` / `Pixel` / `Size` / `Bounds`）与项目纯数据
 * （`Point` / `Pixel` / `Size` / `Bounds`）互相转换。三条口径：
 *
 * 1. **不做范围校验**：官方构造器只做类型归一，不检查 `lng ∈ ±180` / `lat ∈ ±90`，
 *    驱动也不额外加码——`0/0`、`±180/±90` 都是合法坐标，范围错误应交由业务判断；
 * 2. **只拒绝真正的非法值**：非有限数、缺分量、非对象。`NaN` 一旦进入 `new BMap.Size`
 *    会静默留下 `NaN` 并让覆盖物不可见，因此在边界就换成结构化错误；复合入口
 *    （`toRawPoints` / `fromRawPoints` / `toRawBounds`）必须**先校验容器再读属性**，
 *    否则 `null` / `undefined` 会抛原生 `TypeError` 绕过错误协议（PR #59 评审 P2-2）。
 * 3. **不做墨卡托逆投影**：`webgl-v1` 在 WebGL 渲染路径下需要把 BD09MC 米制事件点位换算
 *    成度，4.0 的事件 `point` / `latLng` 本身就是经纬度（墨卡托坐标走独立的 `pointMC`
 *    字段），因此这里不引入猜测式换算。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { Bounds, GeometryDriver, Pixel, Point, Size } from "../types/geometry";
import { assertJsapiV4Namespace, namespaceCtor, sdkCall, type JsapiV4Namespace } from "./internal";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 读取有限数分量；不是有限数返回 `undefined`。 */
function readFinite(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

/** 校验 `x/y` 形式的二元值，返回归一化结果或抛结构化错误。 */
function requirePair(
  value: unknown,
  keys: readonly [string, string],
  code: "BMAP_INVALID_POINT" | "BMAP_INVALID_ARGUMENT",
  label: string,
): [number, number] {
  const record = (value ?? {}) as Record<string, unknown>;
  const first = readFinite(record[keys[0]]);
  const second = readFinite(record[keys[1]]);
  if (first === undefined || second === undefined) {
    throw new BMapError(code, `${label} 非法：(缺失或非有限数) ${keys.join(" / ")}`, {
      engine: "jsapi-v4",
    });
  }
  return [first, second];
}

/** 用于错误信息的入参形态描述（不打印可能是大对象的内容）。 */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 批量入口的容器校验。
 *
 * 复合入口（`toRawPoints` / `fromRawPoints` / `toRawBounds`）必须先校验**容器**形状再读取
 * 属性或遍历，否则 `null` / `undefined` 会在进入既有校验之前抛原生 `TypeError`，绕过
 * `BMapError` 的错误协议（调用方无法按 `code` 分类处理）。
 */
function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BMapError("BMAP_INVALID_ARGUMENT", `${label} 必须是数组（收到 ${describeValue(value)}）`, {
      engine: "jsapi-v4",
    });
  }
  return value;
}

/** 读取 Bounds 容器之前的前置校验：必须是对象，否则先读角点会抛原生 TypeError。 */
function requireBoundsContainer(value: unknown): { southwest: unknown; northeast: unknown } {
  if (!value || typeof value !== "object") {
    throw new BMapError("BMAP_INVALID_ARGUMENT", `Bounds 必须是对象（收到 ${describeValue(value)}）`, {
      engine: "jsapi-v4",
    });
  }
  return value as { southwest: unknown; northeast: unknown };
}

export function createJsapiV4GeometryDriver(rawSdk: unknown): GeometryDriver {
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);
  const PointCtor = namespaceCtor(namespace, "Point");
  const PixelCtor = namespaceCtor(namespace, "Pixel");
  const SizeCtor = namespaceCtor(namespace, "Size");
  const BoundsCtor = namespaceCtor(namespace, "Bounds");

  const toRawPoint = (point: Point): unknown => {
    const [lng, lat] = requirePair(point, ["lng", "lat"], "BMAP_INVALID_POINT", "Point");
    return sdkCall("Point", () => new PointCtor(lng, lat));
  };

  const fromRawPoint = (raw: unknown): Point => {
    const [lng, lat] = requirePair(raw, ["lng", "lat"], "BMAP_INVALID_POINT", "raw Point");
    return { lng, lat };
  };

  const toRawPixel = (pixel: Pixel): unknown => {
    const [x, y] = requirePair(pixel, ["x", "y"], "BMAP_INVALID_ARGUMENT", "Pixel");
    return sdkCall("Pixel", () => new PixelCtor(x, y));
  };

  const fromRawPixel = (raw: unknown): Pixel => {
    const [x, y] = requirePair(raw, ["x", "y"], "BMAP_INVALID_ARGUMENT", "raw Pixel");
    return { x, y };
  };

  const toRawSize = (size: Size): unknown => {
    const [width, height] = requirePair(
      size,
      ["width", "height"],
      "BMAP_INVALID_ARGUMENT",
      "Size",
    );
    return sdkCall("Size", () => new SizeCtor(width, height));
  };

  const fromRawSize = (raw: unknown): Size => {
    const [width, height] = requirePair(
      raw,
      ["width", "height"],
      "BMAP_INVALID_ARGUMENT",
      "raw Size",
    );
    return { width, height };
  };

  const toRawBounds = (bounds: Bounds): unknown => {
    const container = requireBoundsContainer(bounds);
    const southwest = toRawPoint(container.southwest as Point);
    const northeast = toRawPoint(container.northeast as Point);
    return sdkCall("Bounds", () => new BoundsCtor(southwest, northeast));
  };

  const fromRawBounds = (raw: unknown): Bounds => {
    const reader = raw as
      | { getSouthWest?: unknown; getNorthEast?: unknown }
      | null
      | undefined;
    if (typeof reader?.getSouthWest !== "function" || typeof reader.getNorthEast !== "function") {
      throw new BMapError("BMAP_INVALID_ARGUMENT", "raw Bounds 缺少 getSouthWest / getNorthEast", {
        engine: "jsapi-v4",
      });
    }
    const southwest = sdkCall("Bounds#getSouthWest", () =>
      (reader.getSouthWest as () => unknown).call(raw),
    );
    const northeast = sdkCall("Bounds#getNorthEast", () =>
      (reader.getNorthEast as () => unknown).call(raw),
    );
    // 空 Bounds（无参构造 / 尚未 extend）在运行时返回 null —— 官方类型声明为不可空，
    // 这里按实际行为处理，避免把 null 当作 0/0 带进业务。
    return {
      southwest: fromRawPointOrInvalidBounds(southwest),
      northeast: fromRawPointOrInvalidBounds(northeast),
    };
  };

  return {
    toRawPoint,
    fromRawPoint,
    toRawPoints(points) {
      return requireArray(points, "toRawPoints 入参").map((point) => toRawPoint(point as Point));
    },
    fromRawPoints(raws) {
      return requireArray(raws, "fromRawPoints 入参").map((raw) => fromRawPoint(raw));
    },
    toRawPixel,
    fromRawPixel,
    toRawSize,
    fromRawSize,
    toRawBounds,
    fromRawBounds,
  };
}

/** 空 Bounds 的角点：`null` / 非法点统一按「不是有效 Bounds」上报。 */
function fromRawPointOrInvalidBounds(value: unknown): Point {
  const record = (value ?? {}) as Record<string, unknown>;
  const lng = readFinite(record.lng);
  const lat = readFinite(record.lat);
  if (lng === undefined || lat === undefined) {
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      "raw Bounds 为空（isEmpty）或角点非法，无法归一化",
      { engine: "jsapi-v4" },
    );
  }
  return { lng, lat };
}
