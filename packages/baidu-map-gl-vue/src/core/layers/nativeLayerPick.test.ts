/**
 * 拾取读取的单测（M6 / issue #36）
 *
 * `resolveFeaturePick` 是五个图层组件共用的那段逻辑，而它面对的是**没有逐字段声明的官方回包**
 * （`NormalLayerPickEvent.value` 里的 `dataIndex` / `dataItem` 是运行时约定）。因此这里逐个形状
 * 钉住语义，尤其是「身份读不出来时如实为 null」与「`itemOf` 一旦提供就是权威」这两条——
 * 组件级用例走的是替身（总是给出 `dataItem`），兜底分支只能在这里被覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  readFeatureId,
  readFeaturePropertiesAt,
  readNativeLayerPick,
  resolveFeaturePick,
} from "./nativeLayerPick";

/** 官方派发形状的事件（`DriverEvent` 归一化后：`point` / `pixel` 在顶层，原事件在 `raw`）。 */
function officialEvent(value: unknown, extra: Record<string, unknown> = {}) {
  return {
    point: { lng: 116.4, lat: 39.9 },
    pixel: { x: 5, y: 6 },
    raw: { value, latLng: { lng: 116.4, lat: 39.9 }, pixel: { x: 5, y: 6 }, ...extra },
  };
}

describe("readNativeLayerPick", () => {
  it("未命中：官方回包是 { dataIndex: -1, dataItem: undefined }（真值，不能按真值判断命中）", () => {
    const snapshot = readNativeLayerPick(officialEvent({ dataIndex: -1, dataItem: undefined }));
    expect(snapshot.hit).toBe(false);
    expect(snapshot.dataIndex).toBe(-1);
    expect(snapshot.dataItem).toBeNull();
  });

  it("命中：读出下标、要素与归一化坐标 / 像素", () => {
    const snapshot = readNativeLayerPick(officialEvent({ dataIndex: 2, dataItem: { properties: { id: "x" } } }));
    expect(snapshot).toMatchObject({
      hit: true,
      dataIndex: 2,
      dataItem: { properties: { id: "x" } },
      latLng: { lng: 116.4, lat: 39.9 },
      pixel: { x: 5, y: 6 },
    });
  });

  it("事件形状不认识时按未命中处理（不抛错）", () => {
    for (const weird of [null, undefined, 42, "nope", {}]) {
      const snapshot = readNativeLayerPick(weird);
      expect(snapshot.hit).toBe(false);
      expect(snapshot.dataIndex).toBe(-1);
      expect(snapshot.latLng).toBeNull();
    }
  });
});

describe("resolveFeaturePick：身份与业务项", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "a", name: "一路" } },
      { type: "Feature", properties: { id: "b", name: "二路" } },
    ],
  };

  it("命中且回包带 properties：id 与 item 都来自它", () => {
    const pick = resolveFeaturePick({
      event: officialEvent({ dataIndex: 1, dataItem: { properties: { id: "b", name: "二路" } } }),
      idKey: "id",
    });
    expect(pick).toMatchObject({ hit: true, dataIndex: 1, id: "b", item: { id: "b", name: "二路" } });
  });

  it("回包读不出 properties 时，用 dataIndex 在**我们自己送出去的数据**里兜底", () => {
    const pick = resolveFeaturePick({
      event: officialEvent({ dataIndex: 0, dataItem: { notAFeature: true } }),
      idKey: "id",
      sentData: () => collection,
    });
    expect(pick).toMatchObject({ hit: true, id: "a", item: { id: "a", name: "一路" } });
  });

  it("兜底也没有数据时如实返回 null（不猜身份）", () => {
    const pick = resolveFeaturePick({
      event: officialEvent({ dataIndex: 3, dataItem: undefined }),
      idKey: "id",
      sentData: () => collection,
    });
    expect(pick.hit).toBe(true);
    expect(pick.id).toBeNull();
    expect(pick.item).toBeNull();
  });

  it("idKey 没表态：id 为 null，但 item 仍是命中要素的 properties", () => {
    const pick = resolveFeaturePick({
      event: officialEvent({ dataIndex: 0, dataItem: { properties: { id: "a" } } }),
      idKey: undefined,
    });
    expect(pick.id).toBeNull();
    expect(pick.item).toEqual({ id: "a" });
  });

  it("idKey 指向的字段不是有限数字 / 字符串（含 symbol）时 id 为 null", () => {
    const properties = { id: Number.NaN, other: Symbol("s"), name: "x" };
    expect(readFeatureId(properties, "id"), "NaN 不是身份").toBeNull();
    expect(readFeatureId(properties, "other"), "symbol 不在官方取值域内").toBeNull();
    expect(readFeatureId(properties, "name")).toBe("x");
  });

  it("itemOf 一旦提供就是权威：找不到业务项时不给 properties 兜底", () => {
    const event = officialEvent({ dataIndex: 1, dataItem: { properties: { id: "b", name: "二路" } } });

    const missing = resolveFeaturePick({ event, idKey: "id", itemOf: () => undefined });
    expect(missing.item, "找不到就是 null，而不是退回 properties").toBeNull();

    const found = resolveFeaturePick({ event, idKey: "id", itemOf: (_id, properties) => properties.name });
    expect(found.item).toBe("二路");

    // falsy 业务项必须原样回传（`0` / `false` / `""` 都是合法业务项，不能当成「没找到」）
    const falsy = resolveFeaturePick({ event, idKey: "id", itemOf: () => 0 });
    expect(falsy.item).toBe(0);
  });
});

describe("readFeaturePropertiesAt", () => {
  it("负下标与非法数据返回 null（下标是「本次 setData 里的下标」，负数没有意义）", () => {
    expect(readFeaturePropertiesAt({ type: "FeatureCollection", features: [] }, -1)).toBeNull();
    expect(readFeaturePropertiesAt(null, 0)).toBeNull();
    expect(readFeaturePropertiesAt({ type: "Feature" }, 0)).toBeNull();
    expect(readFeaturePropertiesAt({ features: [{ properties: { id: "a" } }] }, 0)).toEqual({ id: "a" });
  });
});
