import { describe, it, expect } from "vitest";
import { readValidPoint } from "./points";

describe("readValidPoint", () => {
  it("接受有限范围内的坐标", () => {
    expect(readValidPoint({ lng: 116.404, lat: 39.915 })).toEqual({
      ok: true,
      point: { lng: 116.404, lat: 39.915 },
    });
  });

  it("(0, 0) 是合法坐标，不当作「缺失」的哨兵", () => {
    // 几内亚湾是真的经纬度 0/0；把 0 当缺失是猜测，会让真实数据被静默丢掉。
    expect(readValidPoint({ lng: 0, lat: 0 })).toEqual({ ok: true, point: { lng: 0, lat: 0 } });
  });

  it("边界值 ±180 / ±90 合法", () => {
    expect(readValidPoint({ lng: 180, lat: 90 })).toEqual({ ok: true, point: { lng: 180, lat: 90 } });
    expect(readValidPoint({ lng: -180, lat: -90 })).toEqual({ ok: true, point: { lng: -180, lat: -90 } });
  });

  it("缺失（null / undefined / 非对象）判为 missing", () => {
    for (const value of [null, undefined, "116,39", 42, [], {}]) {
      const result = readValidPoint(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing");
    }
  });

  it("非有限数（NaN / ±Infinity / 字符串 / 缺一个字段）判为 not-finite", () => {
    const cases: unknown[] = [
      { lng: Number.NaN, lat: 39 },
      { lng: 116, lat: Number.POSITIVE_INFINITY },
      { lng: "116.404", lat: 39.915 },
      { lng: 116.404 },
      { lat: 39.915 },
      { lng: null, lat: 39 },
    ];
    for (const value of cases) {
      const result = readValidPoint(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-finite");
    }
  });

  it("越界（|lng| > 180 或 |lat| > 90）判为 out-of-range", () => {
    const cases: unknown[] = [
      { lng: 180.0001, lat: 0 },
      { lng: -180.0001, lat: 0 },
      { lng: 0, lat: 90.0001 },
      { lng: 0, lat: -90.0001 },
      { lng: 730, lat: 39 },
    ];
    for (const value of cases) {
      const result = readValidPoint(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("out-of-range");
    }
  });

  it("详情里点名具体取值（诊断要能定位数据）", () => {
    const result = readValidPoint({ lng: 730, lat: 39 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("730");
  });
});
