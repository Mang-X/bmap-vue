import { describe, it, expect, vi } from "vitest";
import {
  createPluginRegistry,
  type BMapPluginDefinition,
  type PluginContext,
} from "./PluginRegistry";
import { ResourceScope } from "../lifecycle/ResourceScope";

/**
 * 测试用的最小 plugin context。
 *
 * `map` 在 `PluginContext` 里是品牌化的 `MapHandle`，测试只需要一个「非空占位」——用一次显式断言
 * 把它收口在这里，别在每个用例里各写一遍（此前 10 处 `createPluginRegistry(makeContext(), …)`
 * 都在报 TS2345，其中 7 处是既有的）。
 */
function makeContext(): PluginContext {
  return {
    api: { BMapGL: {} },
    map: { id: "map" } as unknown as PluginContext["map"],
    client: null,
  };
}

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PluginRegistry", () => {
  /**
   * 评审 #85 P1-1 的回归：`whenPlugin()` 曾把目标插件**加载两次**（失败时）。
   *
   * 机制：`collectDeps(name)` 会把目标自己放进依赖集合，`loadPluginsInOrder()` 已经加载过一次；
   * 随后 `return loadPlugin(target)` 又来一次。成功时因为状态是 `ready` 会短路，**失败时状态是
   * `error`，于是真的重新进入 `load()`** —— 一次 CDN 失败会产生两次请求 / 两次 script 注入机会，
   * 并重复发 `plugin:error`。四个内置插件都改成 optional 之后这条路径变得很常见。
   */
  it("optional 插件失败：load 恰好一次、plugin:error 恰好一次", async () => {
    const events = { emit: vi.fn() };
    const reg = createPluginRegistry(makeContext(), events, new ResourceScope());
    const load = vi.fn(async () => {
      throw new Error("cdn down");
    });
    reg.register({ name: "Opt", required: false, load });

    await expect(reg.whenPlugin("Opt")).resolves.toBeUndefined();
    expect(load, "optional 失败不得重复进入 load()").toHaveBeenCalledTimes(1);
    expect(
      events.emit.mock.calls.filter(([type]) => type === "plugin:error"),
      "失败只该发一次 plugin:error",
    ).toHaveLength(1);
  });

  it("required 插件失败：load 恰好一次（且只抛一次）", async () => {
    const boom = new Error("cdn down");
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    const load = vi.fn(async () => {
      throw boom;
    });
    reg.register({ name: "Req", required: true, load });

    await expect(reg.whenPlugin("Req")).rejects.toBe(boom);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("带依赖的插件：依赖先于目标各加载一次（顺序与次数都要对）", async () => {
    const order: string[] = [];
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register({
      name: "Dep",
      load: async () => {
        order.push("Dep");
        return { dep: true };
      },
    });
    reg.register({
      name: "Target",
      dependencies: ["Dep"],
      load: async () => {
        order.push("Target");
        return { target: true };
      },
    });

    const result = await reg.whenPlugin<{ target: boolean }>("Target");
    expect(result.target).toBe(true);
    expect(order).toEqual(["Dep", "Target"]);
  });


  it("registers and loads a plugin", async () => {
    const events = { emit: vi.fn() };
    const scope = new ResourceScope();
    const reg = createPluginRegistry(makeContext(), events, scope);
    reg.register<{ v: number }>({
      name: "A",
      load: async () => ({ v: 1 }),
    });
    const r = await reg.whenPlugin<{ v: number }>("A");
    expect(r.v).toBe(1);
    expect(events.emit).toHaveBeenCalledWith("plugin:ready", { name: "A" });
  });

  it("rejects duplicate registration", () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register({ name: "A", load: async () => ({}) });
    expect(() => reg.register({ name: "A", load: async () => ({}) })).toThrow(/already registered/);
  });

  it("loads dependencies in topological order", async () => {
    const order: string[] = [];
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({
      name: "base",
      load: async () => {
        order.push("base");
      },
    });
    reg.register<void>({
      name: "dep",
      dependencies: ["base"],
      load: async () => {
        order.push("dep");
      },
    });
    reg.register<void>({
      name: "root",
      dependencies: ["dep"],
      load: async () => {
        order.push("root");
      },
    });
    await reg.whenPlugin("root");
    expect(order).toEqual(["base", "dep", "root"]);
  });

  it("detects circular dependencies", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({ name: "a", dependencies: ["b"], load: async () => {} });
    reg.register<void>({ name: "b", dependencies: ["a"], load: async () => {} });
    await expect(reg.whenPlugin("a")).rejects.toThrow(/cyclic/i);
  });

  it("throws for missing dependency", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({ name: "a", dependencies: ["missing"], load: async () => {} });
    await expect(reg.whenPlugin("a")).rejects.toThrow(/missing plugin/i);
  });

  it("handles required=false plugin failure gracefully", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: vi.fn() }, new ResourceScope());
    reg.register<void>({
      name: "optional",
      required: false,
      load: async () => {
        throw new Error("opt fail");
      },
    });
    const result = await reg.whenPlugin("optional");
    expect(result).toBeUndefined();
    expect(reg.getStatus("optional")).toBe("error");
  });

  it("dispose calls plugin dispose and marks disposed", async () => {
    const dispose = vi.fn();
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register({ name: "p", load: async () => ({ x: 1 }), dispose });
    await reg.whenPlugin("p");
    reg.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reg.getStatus("p")).toBe("disposed");
  });
});
