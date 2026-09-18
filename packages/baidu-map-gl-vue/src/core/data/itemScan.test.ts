import { describe, it, expect } from "vitest";
import { isUsableItemKey, scanValidItems, type ItemProblem } from "./itemScan";

interface Row {
  id?: string | number;
  lng?: number;
  lat?: number;
}

function scan(rows: readonly Row[]) {
  const problems: ItemProblem[] = [];
  const items = scanValidItems(rows, {
    getKey: (row) => row.id as PropertyKey,
    getPosition: (row) => ({ lng: row.lng as number, lat: row.lat as number }),
    onProblem: (p) => problems.push(p),
  });
  return { items, problems };
}

describe("isUsableItemKey", () => {
  it("字符串 / 有限数 / symbol 可用；空字符串也算合法（不去发明「空白算缺失」）", () => {
    expect(isUsableItemKey("")).toBe(true);
    expect(isUsableItemKey(0)).toBe(true);
    expect(isUsableItemKey(-1.5)).toBe(true);
    expect(isUsableItemKey(Symbol("k"))).toBe(true);
  });

  it("undefined / null / NaN / Infinity / 对象不可用", () => {
    for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true]) {
      expect(isUsableItemKey(value)).toBe(false);
    }
  });
});

describe("scanValidItems", () => {
  it("返回 (item, key, point, index) 且带出原始下标", () => {
    const rows: Row[] = [
      { id: "a", lng: 1, lat: 2 },
      { id: "b", lng: 3, lat: 4 },
    ];
    const { items, problems } = scan(rows);
    expect(items).toEqual([
      { item: rows[0], key: "a", point: { lng: 1, lat: 2 }, index: 0 },
      { item: rows[1], key: "b", point: { lng: 3, lat: 4 }, index: 1 },
    ]);
    expect(problems).toEqual([]);
  });

  it("缺 key 与非法坐标各自报告，带原始下标", () => {
    const { items, problems } = scan([
      { id: "ok", lng: 1, lat: 1 },
      { lng: 1, lat: 1 },
      { id: "bad", lng: Number.NaN, lat: 1 },
    ]);
    expect(items.map((e) => e.key)).toEqual(["ok"]);
    expect(problems.map((p) => [p.kind, p.index, p.key])).toEqual([
      ["missing-key", 1, undefined],
      ["invalid-position", 2, "bad"],
    ]);
  });

  it("重复 key：后者胜且保留首次出现的位置", () => {
    const rows: Row[] = [
      { id: "a", lng: 1, lat: 1 },
      { id: "b", lng: 2, lat: 2 },
      { id: "a", lng: 9, lat: 9 },
    ];
    const { items, problems } = scan(rows);
    expect(items.map((e) => [e.key, e.point.lng, e.index])).toEqual([
      ["a", 9, 2],
      ["b", 2, 1],
    ]);
    expect(problems.map((p) => [p.kind, p.index, p.key])).toEqual([["duplicate-key", 2, "a"]]);
  });

  it("被跳过的项不占位置：后面的合法项保持自己的下标", () => {
    const { items } = scan([
      { id: "bad", lng: Number.NaN, lat: 1 },
      { id: "ok", lng: 1, lat: 1 },
    ]);
    expect(items).toEqual([{ item: { id: "ok", lng: 1, lat: 1 }, key: "ok", point: { lng: 1, lat: 1 }, index: 1 }]);
  });

  it("没有 onProblem 时也不抛错（诊断是可选出口）", () => {
    expect(() =>
      scanValidItems([{ id: undefined, lng: 1, lat: 1 }], {
        getKey: (row) => row.id as PropertyKey,
        getPosition: (row) => ({ lng: row.lng as number, lat: row.lat as number }),
      }),
    ).not.toThrow();
  });
});
