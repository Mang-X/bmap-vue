/**
 * 原生点图层 profile 的纯函数单测（M6-POINT-CLUSTER / issue #35）
 *
 * 三个点图层组件的生命周期共用 `useNativePointLayer`，差异**全部**落在这三个 profile 上：
 * 构造期选项、就地写入的字段名、构造期指纹、命中载荷的读法。组件级用例（
 * `tests/behavior/v3-component-scenarios.test.ts`）覆盖的是「接线」，这里覆盖的是「映射」——
 * 两者分开才能定位「是内核坏了还是 profile 写错了」。
 *
 * 重点断言**字段名**：`stylePayload()` 的键就是写进 SDK 的字段名（`@baidumap/jsapi-v4-types@4.0.4`
 * 的 `PointShapeStyle` / `PointIconStyle`，以及官方扩展专页的扁平 `PointLayer` 选项），
 * 写错一个键名在运行时**没有任何报错**——SDK 只是静静地什么都不做。
 */
import { describe, expect, it } from "vitest";
import {
  pointIconLayerProfile,
  pointLayerProfile,
  pointShapeLayerProfile,
  readPickValue,
} from "./pointLayerSpec";

describe("[#35] pointShapeLayerProfile", () => {
  const profile = pointShapeLayerProfile<{ id: string }>();

  it("构造期选项只放「改了就换实例」的项（样式一律挂载后写）", () => {
    expect(
      profile.constructorOptions({ enablePicked: true, pickWidth: 40, pickHeight: 50 } as never, "id"),
    ).toEqual({ idKey: "id", enablePicked: true, pickWidth: 40, pickHeight: 50 });
    // 没表态的字段一个都不进构造选项（把 undefined 传下去只会让 SDK 收到非法值）
    expect(profile.constructorOptions({ enablePicked: false } as never, "__id")).toEqual({
      idKey: "__id",
      enablePicked: false,
    });
  });

  it("样式字段用官方 PointShapeStyle 的键名（shapeType 而不是 shape）", () => {
    expect(
      profile.stylePayload({
        shape: 7,
        size: 18,
        color: "#1677ff",
        strokeColor: "#fff",
        strokeWeight: 2,
      } as never),
    ).toEqual({ shapeType: 7, size: 18, color: "#1677ff", strokeColor: "#fff", strokeWeight: 2 });
    // 一个字段都没表态 ⇒ 不产生样式写入
    expect(profile.stylePayload({} as never)).toBeUndefined();
  });

  it("构造期指纹只看构造期项（样式变化不该换实例）", () => {
    const base = { enablePicked: true, pickWidth: 30, pickHeight: 30 };
    const key = profile.rebuildKey(base as never, "id");
    expect(profile.rebuildKey({ ...base, size: 99, color: "red" } as never, "id")).toBe(key);
    expect(profile.rebuildKey({ ...base, pickWidth: 31 } as never, "id")).not.toBe(key);
    expect(profile.rebuildKey(base as never, "name")).not.toBe(key);
  });
});

describe("[#35] pointIconLayerProfile", () => {
  const profile = pointIconLayerProfile<{ id: string }>();

  it("isFlat / isFixed 是构造期项（它们决定渲染通道）", () => {
    expect(
      profile.constructorOptions({ isFlat: false, isFixed: true, enablePicked: true } as never, "id"),
    ).toEqual({ idKey: "id", enablePicked: true, isFlat: false, isFixed: true });
    const key = profile.rebuildKey({ enablePicked: true, isFlat: true } as never, "id");
    expect(profile.rebuildKey({ enablePicked: true, isFlat: false } as never, "id")).not.toBe(key);
  });

  it("样式字段用官方 PointIconStyle 的键名", () => {
    expect(
      profile.stylePayload({
        icon: "https://example.com/pin.png",
        width: 32,
        height: 32,
        anchors: [0, -1],
        offset: [0, -16],
        scale: 1.5,
        rotation: 45,
      } as never),
    ).toEqual({
      icon: "https://example.com/pin.png",
      width: 32,
      height: 32,
      anchors: [0, -1],
      offset: [0, -16],
      scale: 1.5,
      rotation: 45,
    });
  });
});

describe("[#35] pointLayerProfile（扩展 API，扁平选项）", () => {
  const profile = pointLayerProfile<{ id: string }>();

  it("样式字段是**扁平**的（fillColor 而不是 color，与 PointShapeStyle 不同）", () => {
    expect(
      profile.stylePayload({
        shape: "circle",
        size: 18,
        fillColor: "#1677ff",
        fillOpacity: 0.8,
        strokeColor: "#fff",
        strokeWeight: 2,
        scale: 1,
        rotation: 0,
        offset: [0, 0],
        anchor: "center",
      } as never),
    ).toEqual({
      shape: "circle",
      size: 18,
      fillColor: "#1677ff",
      fillOpacity: 0.8,
      strokeColor: "#fff",
      strokeWeight: 2,
      scale: 1,
      rotation: 0,
      offset: [0, 0],
      anchor: "center",
    });
  });

  it("未配置任何视觉字段时没有样式写入（图标模式与几何模式都靠这一条不误写）", () => {
    expect(profile.stylePayload({} as never)).toBeUndefined();
  });
});

describe("[#35] 命中载荷的读法（两个形状，依据是真实 4.0 实测）", () => {
  const declared = pointShapeLayerProfile<{ id: string }>();
  const extension = pointLayerProfile<{ id: string }>();

  it("声明面：dataIndex 是命中判据，业务键在 value.dataItem.properties 上", () => {
    expect(
      declared.readPick({ dataIndex: 1, dataItem: { properties: { id: "b" } } }, "id"),
    ).toEqual({ hit: true, dataIndex: 1, key: "b" });
  });

  it("声明面：未命中也派发事件（dataIndex === -1），不能当成命中", () => {
    expect(declared.readPick({ dataIndex: -1, dataItem: undefined }, "id")).toEqual({
      hit: false,
      dataIndex: -1,
      key: undefined,
    });
  });

  it("扩展 API：业务键在 value.properties / value.id 上，dataIndex 如实给 -1", () => {
    expect(
      extension.readPick({ id: "a", index: 0, properties: { id: "a" } }, "id"),
    ).toEqual({ hit: true, dataIndex: -1, key: "a" });
    // 载荷里那个 `index` **不读**：它的语义没有取证，拿它当要素下标会静默映射到别的业务项
    expect(extension.readPick({ id: "a", index: 7 }, "id").dataIndex).toBe(-1);
  });

  it("扩展 API：解析不出业务身份就是未命中（不编一个 key 出来）", () => {
    expect(extension.readPick({ lng: 116, lat: 39 }, "id").hit).toBe(false);
    expect(extension.readPick(undefined, "id")).toEqual({ hit: false, dataIndex: -1, key: undefined });
  });

  it("falsy 业务键（0 / 空串）是合法身份，不能被真值判断丢掉", () => {
    // 走公开的 readPick 而不是内部 helper：这条性质的消费者是拾取，不是某个工具函数
    expect(extension.readPick({ id: 0 }, "id")).toEqual({ hit: true, dataIndex: -1, key: 0 });
    expect(extension.readPick({ id: "" }, "id")).toEqual({ hit: true, dataIndex: -1, key: "" });
    expect(declared.readPick({ dataIndex: 0, dataItem: { properties: { id: 0 } } }, "id").key).toBe(0);
    expect(
      declared.readPick({ dataIndex: 0, dataItem: { properties: { id: Number.NaN } } }, "id").key,
      "NaN !== NaN：登记进去会让同一项每次 diff 都判成新增",
    ).toBeUndefined();
    expect(declared.readPick({ dataIndex: 0, dataItem: { properties: { id: null } } }, "id").key).toBeUndefined();
  });

  it("readPickValue 从 DriverEvent 的 raw 逃生口读 value（value 不在归一化面里）", () => {
    expect(readPickValue({ type: "click", raw: { value: { dataIndex: 2 } } })).toEqual({ dataIndex: 2 });
    // 没有 raw 时退回事件本身（兜底，不是主路径）
    expect(readPickValue({ value: { dataIndex: 3 } })).toEqual({ dataIndex: 3 });
    expect(readPickValue(null)).toBeUndefined();
  });
});
