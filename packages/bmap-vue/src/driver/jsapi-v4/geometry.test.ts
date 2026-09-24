/**
 * v4 GeometryDriver（M3A2-02 / issue #19）
 *
 * 覆盖验收要求的四类输入：
 * - round-trip：`toRaw*` / `fromRaw*` 往返后数值不变；
 * - 空值：空 `Bounds`、`null`、非对象；
 * - 边界值：`0/0`、`±180/±90` 必须合法（官方构造器不做范围校验）；
 * - 非法值：非有限数、缺分量 → 结构化错误，而不是把 `NaN` 悄悄带进 SDK。
 */
import { describe, it, expect } from "vitest";
import { createFakeBMapV4 } from "../../../../test-utils";
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from "../../../../test-utils/fake-bmap-v4";
import { createJsapiV4GeometryDriver } from "./geometry";
import { assertJsapiV4Namespace } from "./internal";

const fake = createFakeBMapV4();
const geometry = createJsapiV4GeometryDriver(fake.namespace);

describe("createJsapiV4GeometryDriver 前置校验", () => {
  it("命名空间缺驱动成员时明确失败", () => {
    expect(() => createJsapiV4GeometryDriver({})).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("接受已校验的 namespace", () => {
    expect(() => createJsapiV4GeometryDriver(assertJsapiV4Namespace(fake.namespace))).not.toThrow();
  });
});

describe("Point", () => {
  it("toRawPoint 使用官方构造器（lng, lat 顺序）", () => {
    const raw = geometry.toRawPoint({ lng: 116.404, lat: 39.915 });
    expect(raw).toBeInstanceOf(FakeV4Point);
    expect(raw).toMatchObject({ lng: 116.404, lat: 39.915 });
  });

  it("round-trip 保持数值", () => {
    const point = { lng: 121.5, lat: 31.2 };
    expect(geometry.fromRawPoint(geometry.toRawPoint(point))).toEqual(point);
  });

  it("0/0 是合法坐标（不得被当成缺失值）", () => {
    expect(geometry.toRawPoint({ lng: 0, lat: 0 })).toMatchObject({ lng: 0, lat: 0 });
    expect(geometry.fromRawPoint(geometry.toRawPoint({ lng: 0, lat: 0 }))).toEqual({ lng: 0, lat: 0 });
  });

  it("边界值 ±180 / ±90 合法（官方构造器不做范围校验，驱动不额外加码）", () => {
    for (const point of [
      { lng: 180, lat: 90 },
      { lng: -180, lat: -90 },
    ]) {
      expect(geometry.fromRawPoint(geometry.toRawPoint(point))).toEqual(point);
    }
  });

  it("toRawPoints 批量转换保持顺序", () => {
    const points = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 2 },
    ];
    const raws = geometry.toRawPoints(points);
    expect(raws).toHaveLength(2);
    expect(raws.map((raw) => geometry.fromRawPoint(raw))).toEqual(points);
  });

  it("非有限数 / 缺分量 → BMAP_INVALID_POINT", () => {
    const invalid = [
      { lng: Number.NaN, lat: 0 },
      { lng: 0, lat: Number.POSITIVE_INFINITY },
      { lng: 0 },
      {},
    ];
    for (const input of invalid) {
      expect(() => geometry.toRawPoint(input as never)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_POINT" }),
      );
    }
  });

  it("fromRawPoint 对 null / 原始值 / 残缺对象抛 BMAP_INVALID_POINT", () => {
    for (const raw of [null, undefined, "p", 1, { lng: "1", lat: 2 }, { lng: 1 }]) {
      expect(() => geometry.fromRawPoint(raw)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_POINT" }),
      );
    }
  });
});

describe("Pixel", () => {
  it("round-trip 保持数值（含负偏移）", () => {
    const pixel = { x: -12, y: 24 };
    const raw = geometry.toRawPixel(pixel);
    expect(raw).toBeInstanceOf(FakeV4Pixel);
    expect(geometry.fromRawPixel(raw)).toEqual(pixel);
  });

  it("非有限数 → BMAP_INVALID_ARGUMENT", () => {
    expect(() => geometry.toRawPixel({ x: Number.NaN, y: 0 })).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("fromRawPixel 对残缺对象抛 BMAP_INVALID_ARGUMENT", () => {
    expect(() => geometry.fromRawPixel({ x: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});

describe("Size", () => {
  it("round-trip 保持数值", () => {
    const size = { width: 320, height: 180 };
    const raw = geometry.toRawSize(size);
    expect(raw).toBeInstanceOf(FakeV4Size);
    expect(geometry.fromRawSize(raw)).toEqual(size);
  });

  it("Size 允许 0 尺寸（隐藏容器），但拒绝 NaN", () => {
    expect(geometry.fromRawSize(geometry.toRawSize({ width: 0, height: 0 }))).toEqual({
      width: 0,
      height: 0,
    });
    expect(() => geometry.toRawSize({ width: 0, height: Number.NaN })).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("fromRawSize 对 null 抛 BMAP_INVALID_ARGUMENT", () => {
    expect(() => geometry.fromRawSize(null)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});

describe("Bounds", () => {
  it("round-trip 保持西南/东北角", () => {
    const bounds = {
      southwest: { lng: 116.38, lat: 39.9 },
      northeast: { lng: 116.43, lat: 39.93 },
    };
    const raw = geometry.toRawBounds(bounds);
    expect(raw).toBeInstanceOf(FakeV4Bounds);
    expect(geometry.fromRawBounds(raw)).toEqual(bounds);
  });

  it("0/0 边界的 Bounds 合法（不得被当成空范围）", () => {
    const bounds = { southwest: { lng: 0, lat: 0 }, northeast: { lng: 0, lat: 0 } };
    expect(geometry.fromRawBounds(geometry.toRawBounds(bounds))).toEqual(bounds);
  });

  it("空 Bounds（无参构造）→ BMAP_INVALID_ARGUMENT，而不是把 null 当坐标", () => {
    expect(() => geometry.fromRawBounds(new FakeV4Bounds())).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("fromRawBounds 对缺方法的对象抛 BMAP_INVALID_ARGUMENT", () => {
    expect(() => geometry.fromRawBounds({})).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("toRawBounds 对非法角点抛 BMAP_INVALID_POINT", () => {
    expect(() =>
      geometry.toRawBounds({
        southwest: { lng: Number.NaN, lat: 0 },
        northeast: { lng: 1, lat: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "BMAP_INVALID_POINT" }));
  });
});

/**
 * 回归：PR #59 评审 P2（复合几何入口遇到空值时的错误契约）
 *
 * 旧实现在校验之前就读 `bounds.southwest` / 直接调参数的 `.map()`，容器为
 * `null` / `undefined` 时会抛原生 `TypeError`，绕过 `BMapError` 的错误协议。
 * 要求：**拒绝空值也必须走结构化错误**；空数组与 `0/0` 仍然合法。
 */
describe("回归 PR#59-P2-2：复合入口的空容器必须走结构化错误", () => {
  const emptyContainers = [null, undefined];

  it("toRawPoints / fromRawPoints 对 null / undefined 抛 BMapError 而不是 TypeError", () => {
    for (const value of emptyContainers) {
      expect(() => geometry.toRawPoints(value as never)).toThrowError(
        expect.objectContaining({ name: "BMapError", code: "BMAP_INVALID_ARGUMENT" }),
      );
      expect(() => geometry.fromRawPoints(value as never)).toThrowError(
        expect.objectContaining({ name: "BMapError", code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
  });

  it("toRawBounds 对 null / undefined 抛 BMapError 而不是 TypeError", () => {
    for (const value of emptyContainers) {
      expect(() => geometry.toRawBounds(value as never)).toThrowError(
        expect.objectContaining({ name: "BMapError", code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
  });

  it("非数组 / 非对象的容器同样走结构化错误", () => {
    for (const value of ["points", 1, {}, true]) {
      expect(() => geometry.toRawPoints(value as never)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
      expect(() => geometry.fromRawPoints(value as never)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    for (const value of ["bounds", 1, true]) {
      expect(() => geometry.toRawBounds(value as never)).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
  });

  it("空数组与 0/0 坐标仍然合法", () => {
    expect(geometry.toRawPoints([])).toEqual([]);
    expect(geometry.fromRawPoints([])).toEqual([]);
    const origin = { lng: 0, lat: 0 };
    expect(geometry.fromRawPoints(geometry.toRawPoints([origin]))).toEqual([origin]);
  });

  it("批量数组里的非法元素仍按 BMAP_INVALID_POINT 上报", () => {
    expect(() => geometry.toRawPoints([{ lng: 0, lat: 0 }, { lng: Number.NaN, lat: 1 }])).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_POINT" }),
    );
    expect(() => geometry.fromRawPoints([null])).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_POINT" }),
    );
  });
});
