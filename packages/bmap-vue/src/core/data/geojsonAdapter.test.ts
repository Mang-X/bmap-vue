import { describe, it, expect } from "vitest";
import { GENERATED_ID_FIELD, adaptPoints, resolveIdField, type GeoJsonProblem } from "./geojsonAdapter";

interface Station {
  id: string;
  lng: number;
  lat: number;
  name?: string;
}

const stations: Station[] = [
  { id: "a", lng: 116.404, lat: 39.915, name: "百度大厦" },
  { id: "b", lng: 116.41, lat: 39.92 },
];

function adaptWithProblems(items: readonly Station[], extra: Partial<Parameters<typeof adaptPoints<Station>>[1]> = {}) {
  const problems: GeoJsonProblem[] = [];
  const adapted = adaptPoints(items, {
    itemKey: "id",
    getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
    ...extra,
    onProblem: (p) => problems.push(p),
  });
  return { adapted, problems };
}

describe("adaptPoints", () => {
  it("Item[] → FeatureCollection：坐标顺序是 [lng, lat]，id 写进 properties", () => {
    const { adapted } = adaptWithProblems(stations);
    expect(adapted.idKey).toBe("id");
    expect(adapted.data).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [116.404, 39.915] },
          properties: { id: "a" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [116.41, 39.92] },
          properties: { id: "b" },
        },
      ],
    });
    expect(adapted.items).toEqual(stations);
    expect(adapted.problems).toEqual([]);
  });

  it("properties 映射进 feature.properties，id 字段最后写入（用户覆盖不了要素身份）", () => {
    const problems: GeoJsonProblem[] = [];
    const adapted = adaptPoints(stations, {
      itemKey: "id",
      getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
      properties: (item) => ({ name: item.name ?? "未命名", id: item.id === "a" ? "被用户改写" : item.id }),
      onProblem: (p) => problems.push(p),
    });
    expect(adapted.data.features[0]!.properties).toEqual({ name: "百度大厦", id: "a" });
    expect(problems.map((p) => p.kind)).toEqual(["id-field-overwritten"]);
    expect(problems[0]!.index).toBe(0);
  });

  it("itemKey 是函数时用保留字段 __id，并把它作为 idKey", () => {
    const adapted = adaptPoints(stations, {
      itemKey: (item) => item.id.toUpperCase(),
      getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
    });
    expect(adapted.idKey).toBe(GENERATED_ID_FIELD);
    expect(adapted.data.features.map((f) => f.properties.__id)).toEqual(["A", "B"]);
    expect(resolveIdField((item: Station) => item.id)).toBe(GENERATED_ID_FIELD);
  });

  it("缺失 key ⇒ 跳过该项并报 missing-key", () => {
    const { adapted, problems } = adaptWithProblems([stations[0]!, { lng: 1, lat: 1 } as Station]);
    expect(adapted.data.features).toHaveLength(1);
    expect(adapted.items).toEqual([stations[0]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "missing-key", index: 1 });
  });

  it("NaN key 跳过（NaN !== NaN，登记进去会让每帧都判成新增）", () => {
    const { adapted, problems } = adaptWithProblems([{ id: Number.NaN, lng: 1, lat: 1 } as unknown as Station]);
    expect(adapted.data.features).toHaveLength(0);
    expect(problems[0]!.kind).toBe("missing-key");
  });

  it("非法坐标 ⇒ 跳过该项并报 invalid-position（带原因）", () => {
    const { adapted, problems } = adaptWithProblems([
      stations[0]!,
      { id: "nan", lng: Number.NaN, lat: 1 },
      { id: "far", lng: 730, lat: 1 },
    ]);
    expect(adapted.data.features.map((f) => f.properties.id)).toEqual(["a"]);
    expect(problems.map((p) => [p.kind, p.key, p.detail.includes("not-finite")])).toEqual([
      ["invalid-position", "nan", true],
      ["invalid-position", "far", false],
    ]);
    expect(problems[1]!.detail).toContain("out-of-range");
  });

  it("(0, 0) 是合法坐标：照常生成要素", () => {
    const { adapted, problems } = adaptWithProblems([{ id: "origin", lng: 0, lat: 0 }]);
    expect(adapted.data.features[0]!.geometry.coordinates).toEqual([0, 0]);
    expect(problems).toEqual([]);
  });

  it("重复 key：后者胜，且只保留一个要素（顺序稳定在首次出现处）", () => {
    const { adapted, problems } = adaptWithProblems([
      { id: "a", lng: 1, lat: 1 },
      { id: "b", lng: 2, lat: 2 },
      { id: "a", lng: 9, lat: 9 },
    ]);
    expect(adapted.data.features.map((f) => f.properties.id)).toEqual(["a", "b"]);
    expect(adapted.data.features[0]!.geometry.coordinates).toEqual([9, 9]);
    expect(adapted.items.map((i) => i.lng)).toEqual([9, 2]);
    expect(problems.map((p) => [p.kind, p.index, p.key])).toEqual([["duplicate-key", 2, "a"]]);
  });

  it("getPosition 返回 null / undefined ⇒ 跳过（显式的「这一项没有位置」）", () => {
    const { adapted, problems } = adaptWithProblems(stations, {
      getPosition: (item) => (item.id === "b" ? null : { lng: item.lng, lat: item.lat }),
    });
    expect(adapted.data.features).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "invalid-position", key: "b" });
    expect(problems[0]!.detail).toContain("missing");
  });

  it("空数组 ⇒ 空 FeatureCollection（不是 undefined）", () => {
    const adapted = adaptPoints([] as Station[], {
      itemKey: "id",
      getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
    });
    expect(adapted.data).toEqual({ type: "FeatureCollection", features: [] });
    expect(adapted.problems).toEqual([]);
  });

  it("problems 与 onProblem 是同一批（调用方不必读两次）", () => {
    const seen: GeoJsonProblem[] = [];
    const adapted = adaptPoints([{ id: "x", lng: Number.NaN, lat: 1 }], {
      itemKey: "id",
      getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
      onProblem: (p) => seen.push(p),
    });
    expect(seen).toEqual([...adapted.problems]);
    expect(seen).toHaveLength(1);
  });
});
