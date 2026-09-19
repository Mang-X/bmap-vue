/**
 * Feature State 命令面单测（M6 / issue #36）
 *
 * 断言的组织方式对应 issue 的「测试要求」与「验收补充」：
 *
 * - **单选 / 多选 / 替换 / 清空**（`update` / `replace` / `clear` 三种语义各自的边界）；
 * - **身份只有业务 id**：非法 id 在任何 SDK 调用之前就失败，且调用点真的没被碰到；
 * - **读回是 SDK 的当前值**，不是本地账本；
 * - **未就绪不排队**（不产生 SDK 调用，也不抛）；
 * - **换实例之后写的是新实例**（闭包捕获旧句柄是最难查的一类「设置没生效」）。
 *
 * 用真实的 v4 Driver + Fake（而不是手写桩）：`supports()` 与「不支持显式失败」这两条不变式
 * 本身就由 Driver 维护，手写桩只会把它们复制一遍。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { createFeatureStateApi } from "./featureState";
import { createCapabilityRegistry } from "../../driver/capability/registry";
import { createJsapiV4HandleRegistry } from "../../driver/jsapi-v4/registry";
import { createJsapiV4NativeLayerDriver } from "../../driver/jsapi-v4/native-layers";
import type { NativeLayerDriver, NativeLayerHandle } from "../../driver/types/native-layers";

let fake: FakeBMapV4;
let driver: NativeLayerDriver;

/** 当前句柄（用例可以替换它来模拟「重建之后」）。 */
let handle: NativeLayerHandle | null;

function rawOf(): { state: Record<string, unknown>; callLog: string[] } {
  return handle!.raw as unknown as { state: Record<string, unknown>; callLog: string[] };
}

/** 会话取值器：与内核的接线同形（未就绪时整段为 null）。 */
const session = () => (handle === null ? null : { driver, handle });

/** 业务身份字段：默认有（多数用例关心的是命令本身），`undefined` 用来验证「身份未声明」的拒绝。 */
let identityField: string | undefined = "id";

function api(component = "BTestLayer") {
  return createFeatureStateApi({ session, identity: () => identityField, component });
}

beforeEach(() => {
  fake = createFakeBMapV4();
  driver = createJsapiV4NativeLayerDriver({
    rawSdk: fake.namespace,
    capabilities: createCapabilityRegistry({
      engine: "jsapi-v4",
      version: fake.namespace.VERSION,
      rawSdk: fake.namespace,
      unsupported: "throw",
    }),
    registry: createJsapiV4HandleRegistry(),
  });
  handle = driver.create("line");
  identityField = "id";
});

describe("Feature State：写命令", () => {
  it("update 单个 / 多个 id；默认是**替换**该要素的整个状态对象", () => {
    const state = api();
    state.update("a", { selected: true });
    state.update(["a", "b"], { hovered: true });

    expect(rawOf().state).toEqual({ a: { hovered: true }, b: { hovered: true } });
  });

  it("append: true 才是合并（缺省不能当合并，否则旧键会被静默保留）", () => {
    const state = api();
    state.update("a", { selected: true });
    state.update("a", { hovered: true }, { append: true });

    expect(rawOf().state).toEqual({ a: { selected: true, hovered: true } });
  });

  it("remove 只摘掉列出的 id；clear 清空全部", () => {
    const state = api();
    state.update(["a", "b", "c"], { selected: true });
    state.remove(["a", "c"]);
    expect(rawOf().state).toEqual({ b: { selected: true } });

    state.clear();
    expect(rawOf().state).toEqual({});
  });

  it("replace 是全量替换：未覆盖到的 id 必须消失（不是合并）", () => {
    const state = api();
    state.update(["a", "b"], { selected: true });
    state.replace({ b: { hovered: true } });

    expect(rawOf().state).toEqual({ b: { hovered: true } });
  });

  it("空 keys / 空 id 数组是合法输入：不产生 SDK 调用", () => {
    const state = api();
    const before = rawOf().callLog.length;
    state.update([], { selected: true });
    state.remove([]);
    expect(rawOf().callLog.length).toBe(before);
  });
});

describe("Feature State：身份与校验", () => {
  it("非法 id（NaN / null / 对象）在调用之前失败，且**不产生任何 SDK 调用**", () => {
    const state = api();
    const before = rawOf().callLog.length;

    for (const bad of [Number.NaN, null, undefined, {}, [Number.NaN], [{}]] as unknown[]) {
      expect(() => state.update(bad as never, { selected: true })).toThrowError(
        expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
      );
    }
    expect(rawOf().callLog.length, "校验失败不得碰到 SDK").toBe(before);
  });

  it("状态不是对象时失败（数组也不接受）", () => {
    const state = api();
    expect(() => state.update("a", [] as never)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
    expect(() => state.replace({ a: null as never })).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("错误文案点名调用方与出错的取值（诊断要能直接定位）", () => {
    const state = api("BLineLayer");
    expect(() => state.update(Number.NaN, { selected: true })).toThrowError(/BLineLayer/);
    expect(() => state.update(Number.NaN, { selected: true })).toThrowError(/下标 0/);
  });

  it("数字 id 与字符串 id 是同一个槽位（SDK 的映射键是字符串）", () => {
    const state = api();
    state.update(1, { selected: true });
    expect(state.get(1)).toEqual({ "1": { selected: true } });
  });
});

describe("Feature State：读回与就绪", () => {
  it("get 走 SDK 公开读回；给了 keys 就只返回这些 id", () => {
    const state = api();
    state.update(["a", "b"], { selected: true });

    expect(state.get()).toEqual({ a: { selected: true }, b: { selected: true } });
    expect(state.get(["b", "missing"])).toEqual({ b: { selected: true } });
  });

  it("get 返回的是快照：改回包不影响 SDK 侧状态", () => {
    const state = api();
    state.update("a", { selected: true });
    const snapshot = state.get("a");
    (snapshot.a as Record<string, unknown>).selected = false;
    expect(state.get("a")).toEqual({ a: { selected: true } });
  });

  it("未就绪（handle 为 null）：写命令不抛也不调用，get 返回空映射，并告警一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = api();
    const target = handle!;
    handle = null;
    const callsBefore = (target.raw as unknown as { callLog: string[] }).callLog.length;

    expect(() => state.update("a", { selected: true })).not.toThrow();
    expect(() => state.clear()).not.toThrow();
    expect(state.get()).toEqual({});
    expect((target.raw as unknown as { callLog: string[] }).callLog.length).toBe(callsBefore);
    expect(warn, "未就绪必须说出来，不能静默丢弃").toHaveBeenCalled();
  });

  it("换实例之后写的是**当前**句柄（旧实例不再被写）", () => {
    const state = api();
    const stale = handle!;
    state.update("a", { selected: true });
    const staleLog = (stale.raw as unknown as { callLog: string[] }).callLog;
    const staleCalls = staleLog.length;

    handle = driver.create("line");
    state.update("a", { hovered: true });

    expect(rawOf().state).toEqual({ a: { hovered: true } });
    expect(staleLog.length, "旧实例上不该再出现新的状态调用").toBe(staleCalls);
    expect((stale.raw as unknown as { state: unknown }).state, "旧实例的状态保持原样").toEqual({
      a: { selected: true },
    });
  });

  it("身份字段没声明时五个命令都**拒绝执行**（不猜 SDK 的默认 idKey）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = api("BLineLayer");
    const callsBefore = rawOf().callLog.length;
    identityField = undefined;

    expect(() => state.update("a", { selected: true })).not.toThrow();
    expect(() => state.remove("a")).not.toThrow();
    expect(() => state.clear()).not.toThrow();
    expect(() => state.replace({ a: { selected: true } })).not.toThrow();
    expect(state.get(), "读回同样拒绝（返回空映射）").toEqual({});

    expect(rawOf().callLog.length, "被拒绝的命令不得碰到 SDK").toBe(callsBefore);
    expect(rawOf().state, "SDK 侧状态不得被改动").toEqual({});
    expect(warn, "必须说出来（否则使用者以为写成功了）").toHaveBeenCalled();
  });

  it("当前图层种类没有这个入口时，Driver 显式失败（本模块不预先吞掉）", () => {
    handle = driver.create("heatmap");
    const state = api();
    expect(() => state.update("a", { selected: true })).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });
});
