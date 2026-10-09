/**
 * `useLocalSearch` 运行期覆盖的**纯判据**（#165，第二轮评审 P1）
 *
 * 为什么不是端到端：`<Map>` 在 provider prop 变化时**不会**重建 Client（实测
 * `ctx.client.value` 不变），所以「同一 composable scope 内 Client 切换」在现有 harness 里
 * 造不出来。判据纯化后可以直接喂**合成句柄**做行为级反例 —— 这正是本文件存在的理由。
 *
 * 覆盖要解决的真实缺陷：同步 setter 改的是活实例，而新检索取代在飞检索时会**重建实例**；
 * 若不把设置带过去，`search()` 会悄悄用回旧值（评审第一轮 P1）。而带过去时又必须校验
 * 「句柄属于哪个 Client」，否则旧 Client 的 `MapHandle` 会被永久带进新 Client、
 * 让检索一直 `failed`（第二轮 P1）。
 */
import { describe, expect, it } from "vitest";
import { HANDLE_BRAND } from "../../packages/bmap-vue/src/driver/types/handles";
import {
  isMapHandleLocation,
  preferOverride,
  usableLocationOverride,
  type LocalSearchRuntimeOverrides,
} from "../../packages/bmap-vue/src/composables/localSearchRuntimeOverrides";

/** 合成 MapHandle（只看品牌，不看内部形状）。 */
const mapHandle = (): Record<PropertyKey, unknown> => ({ [HANDLE_BRAND]: "map" });
/** 合成 Client 令牌（身份比较即可）。 */
const client = (name: string): { name: string } => ({ name });

describe("isMapHandleLocation", () => {
  it("认出本库 MapHandle，不把普通对象 / 城市名 / null 当句柄", () => {
    expect(isMapHandleLocation(mapHandle())).toBe(true);
    expect(isMapHandleLocation({ lng: 1, lat: 2 })).toBe(false);
    expect(isMapHandleLocation("上海市")).toBe(false);
    expect(isMapHandleLocation(null)).toBe(false);
    expect(isMapHandleLocation(undefined)).toBe(false);
  });
});

describe("usableLocationOverride", () => {
  it("没有 location 覆盖 ⇒ undefined（调用方回退声明式）", () => {
    expect(usableLocationOverride({}, client("A"), null)).toBeUndefined();
  });

  it("城市名（非句柄）与 Client / 地图都无关：换 Client 仍然可用", () => {
    const overrides: LocalSearchRuntimeOverrides<string, unknown> = { location: "上海市" };
    expect(usableLocationOverride(overrides, client("A"), null)).toBe("上海市");
    expect(usableLocationOverride(overrides, client("B"), mapHandle())).toBe("上海市");
  });

  it("**MapHandle 属于当前 Client 且仍是当前地图** ⇒ 可用", () => {
    const a = client("A");
    const handle = mapHandle();
    const overrides: LocalSearchRuntimeOverrides<unknown, unknown> = {
      location: handle,
      locationClient: a,
    };
    expect(usableLocationOverride(overrides, a, handle)).toBe(handle);
  });

  it("**MapHandle 属于别的 Client** ⇒ 丢弃（否则检索会永远 failed）", () => {
    const a = client("A");
    const b = client("B");
    const handle = mapHandle();
    const overrides: LocalSearchRuntimeOverrides<unknown, unknown> = {
      location: handle,
      locationClient: a,
    };
    expect(usableLocationOverride(overrides, b, mapHandle())).toBeUndefined();
  });

  it("**同 Client 但地图已换/已卸载** ⇒ 丢弃（registry.resolve 不查 raw 是否销毁）", () => {
    const a = client("A");
    const oldMap = mapHandle();
    const overrides: LocalSearchRuntimeOverrides<unknown, unknown> = {
      location: oldMap,
      locationClient: a,
    };
    // 地图卸载后换新：Client 没变，但旧句柄指向**已销毁**的 raw Map
    expect(usableLocationOverride(overrides, a, mapHandle())).toBeUndefined();
    // 地图整个卸载（ctx.map === null）
    expect(usableLocationOverride(overrides, a, null)).toBeUndefined();
  });

  it("句柄没记归属（异常态）⇒ 一律丢弃，不猜", () => {
    const handle = mapHandle();
    const overrides: LocalSearchRuntimeOverrides<unknown, unknown> = { location: handle };
    expect(usableLocationOverride(overrides, client("A"), handle)).toBeUndefined();
  });
});

describe("preferOverride", () => {
  it("覆盖优先，缺失则退回声明式（0 / 空串也是有效覆盖）", () => {
    expect(preferOverride(20, 5)).toBe(20);
    expect(preferOverride(undefined, 5)).toBe(5);
    expect(preferOverride(0, 5)).toBe(0);
    expect(preferOverride(undefined, undefined)).toBeUndefined();
  });
});
