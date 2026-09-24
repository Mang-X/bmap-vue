import { describe, it, expect, vi } from "vitest";
import {
  createPluginRegistry,
  type BMapPluginDefinition,
  type PluginContext,
} from "./PluginRegistry";
import { createPluginHost } from "./PluginHost";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { BMapError } from "../errors/BMapError";

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

function makeEvents() {
  const emit = vi.fn();
  return { emit, readyCount: () => emit.mock.calls.filter(([t]) => t === "plugin:ready").length };
}

/** 手动控制结算时机的 definition。 */
function deferredLoad(name = "Deferred") {
  let settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  let calls = 0;
  const definition: BMapPluginDefinition<unknown> = {
    name,
    load: () => {
      calls += 1;
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  };
  return { definition, calls: () => calls, settle: () => settle };
}

function registry(
  options: { host?: ReturnType<typeof createPluginHost>; scope?: ResourceScope } = {},
) {
  const events = makeEvents();
  const scope = options.scope ?? new ResourceScope();
  const plugins = createPluginRegistry(makeContext(), events, scope, options.host ? { host: options.host } : {});
  return { plugins, events, scope };
}

/**
 * 结算在飞 promise 链后的一拍。
 *
 * 「晚到的 settle」这条路径**没有消费者在等**（消费者早被 dispose 结算掉了），所以不能靠
 * `await` 某个 promise 来推进，只能等一个 macrotask。
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 事件总线里某类事件的次数。 */
function emitted(events: ReturnType<typeof makeEvents>, type: string): number {
  return events.emit.mock.calls.filter(([t]) => t === type).length;
}

describe("PluginRegistry：注册与状态", () => {
  it("registers and loads a plugin", async () => {
    const { plugins, events } = registry();
    plugins.register<{ v: number }>({ name: "A", load: async () => ({ v: 1 }) });
    const r = await plugins.whenPlugin<{ v: number }>("A");
    expect(r).toEqual({ v: 1 });
    expect(events.emit).toHaveBeenCalledWith("plugin:ready", { name: "A" });
  });

  it("rejects duplicate registration", () => {
    const { plugins } = registry();
    plugins.register({ name: "A", load: async () => ({}) });
    expect(() => plugins.register({ name: "A", load: async () => ({}) })).toThrow(
      /already registered/,
    );
  });

  it("未注册的名字明确失败（BMAP_PLUGIN_UNKNOWN），而不是静默给个空结果", async () => {
    const { plugins } = registry();
    const rejection = await plugins.whenPlugin("Nope").catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(BMapError);
    expect((rejection as BMapError).code).toBe("BMAP_PLUGIN_UNKNOWN");
    expect((rejection as BMapError).plugin).toBe("Nope");
    // 未注册的名字**不会**留下记录：`getStatus` / `inspect` 都是 `undefined`（不是 `'error'`）。
    // 这一点必须如实写在文档里 —— 「名字不认识」与「名字认得但加载失败」是两个不同的可观察结果
    // （评审 #88 文档项）。
    expect(plugins.getStatus("Nope"), "没有记录就没有状态，不是 error").toBeUndefined();
    expect(plugins.inspect("Nope")).toBeUndefined();
    expect(plugins.getError("Nope")).toBeUndefined();
  });

  it("非法的 scope 值在注册期就报错（JS 调用方的唯一防线）", () => {
    const { plugins } = registry();
    expect(() =>
      plugins.register({ name: "Bad", scope: "everywhere" as never, load: async () => ({}) }),
    ).toThrow(/scope/i);
  });

  it("不写 scope 的插件按 map 处理（保守：那是这张地图自己的事）", () => {
    const { plugins } = registry();
    plugins.register({ name: "Legacy", load: async () => ({}) });
    expect(plugins.inspect("Legacy")?.scope).toBe("map");
  });

  it("inspect 提供可读状态：scope / required / status / attempts / consumers", async () => {
    const { plugins } = registry();
    const deferred = deferredLoad("G");
    plugins.register({ ...deferred.definition, scope: "global", required: false });

    const pending = plugins.whenPlugin("G");
    const loading = plugins.inspect("G")!;
    expect(loading.scope).toBe("global");
    expect(loading.required).toBe(false);
    expect(loading.status).toBe("loading");
    expect(loading.consumers, "正在等待的消费者数").toBe(1);
    expect(loading.attempts, "进入 load() 的次数").toBe(1);

    deferred.settle().resolve({ ok: true });
    await pending;
    const ready = plugins.inspect("G")!;
    expect(ready.status).toBe("ready");
    expect(ready.consumers, "结算后消费者归零").toBe(0);
    expect(ready.attempts).toBe(1);
  });
});

describe("PluginRegistry：require / optional 与失败", () => {
  it("optional 插件失败：resolve **null**（而不是 undefined）、状态为 error、错误可读", async () => {
    const boom = new Error("cdn down");
    const { plugins } = registry();
    const load = vi.fn(async () => {
      throw boom;
    });
    plugins.register({ name: "Opt", required: false, load });

    // `null` 而不是 `undefined`：`undefined` 是「void 插件」的合法成功返回值，
    // 用它表示失败会让「只注入副作用、不产出资源的插件」被误判（评审 #85 P1-2）。
    await expect(plugins.whenPlugin("Opt")).resolves.toBeNull();
    expect(load, "optional 失败不得重复进入 load()").toHaveBeenCalledTimes(1);
    expect(plugins.getStatus("Opt")).toBe("error");
    expect(plugins.getError("Opt")).toBe(boom);
  });

  it("void 插件（load resolve undefined）是**成功**：resolve undefined、状态 ready", async () => {
    // 「只注入副作用、不产出资源」的合法形态。它与 optional 失败的差别只有一个：
    // 失败 resolve **null**。把两者混成同一个值，调用方就无法区分「装上了但没有资源」与
    // 「没装上」（评审 #85 P1-2）。
    const { plugins } = registry();
    plugins.register({ name: "Void", required: false, load: async () => undefined });

    await expect(plugins.whenPlugin("Void")).resolves.toBeUndefined();
    expect(plugins.getStatus("Void")).toBe("ready");
    expect(plugins.getError("Void")).toBeUndefined();
  });

  it("load **同步抛错**也走 optional→null（不退化成「状态卡在 loading」）", async () => {
    // `load` 是调用方给的函数，同步抛错（没有 async 的写法）完全可能。不接住它，
    // 异常会穿透注册表：不记 error、不发事件、`status` 永久停在 `loading`。
    const boom = new Error("sync boom");
    const { plugins } = registry();
    plugins.register({
      name: "Sync",
      required: false,
      load: () => {
        throw boom;
      },
    });

    await expect(plugins.whenPlugin("Sync")).resolves.toBeNull();
    expect(plugins.getStatus("Sync")).toBe("error");
    expect(plugins.getError("Sync")).toBe(boom);
  });

  it("required 插件失败：抛原始错误（同一对象），load 恰好一次", async () => {
    const boom = new Error("cdn down");
    const { plugins } = registry();
    const load = vi.fn(async () => {
      throw boom;
    });
    plugins.register({ name: "Req", required: true, load });

    await expect(plugins.whenPlugin("Req")).rejects.toBe(boom);
    expect(load).toHaveBeenCalledTimes(1);
    expect(plugins.getError("Req")).toBe(boom);
  });

  it("optional 失败只发一次 plugin:error", async () => {
    const { plugins, events } = registry();
    plugins.register({
      name: "Opt",
      required: false,
      load: async () => {
        throw new Error("cdn down");
      },
    });
    await plugins.whenPlugin("Opt");
    const errors = events.emit.mock.calls.filter(([type]) => type === "plugin:error");
    expect(errors).toHaveLength(1);
  });

  it("失败重试：再请求一次会真的重新加载，成功后旧错误必须清掉", async () => {
    const boom = new Error("first attempt fails");
    let attempt = 0;
    const { plugins } = registry();
    plugins.register({
      name: "Flaky",
      required: false,
      load: async () => {
        attempt += 1;
        if (attempt === 1) throw boom;
        return { v: attempt };
      },
    });

    await expect(plugins.whenPlugin("Flaky")).resolves.toBeNull();
    expect(plugins.getError("Flaky")).toBe(boom);

    await expect(plugins.whenPlugin("Flaky")).resolves.toEqual({ v: 2 });
    expect(plugins.getStatus("Flaky")).toBe("ready");
    // 重试成功后仍返回旧错误 = 调用方会以为「刚加载好的插件其实还在错」
    expect(plugins.getError("Flaky"), "成功后不得留着上一次的错误").toBeUndefined();
    expect(plugins.inspect("Flaky")?.attempts).toBe(2);
  });

  it("重试**在飞期间**仍能读到上一次的错误，成功后立刻清空", async () => {
    const boom = new Error("first attempt fails");
    let attempt = 0;
    let settleRetry!: (value: unknown) => void;
    const { plugins } = registry();
    plugins.register({
      name: "Flaky",
      required: false,
      load: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(boom);
        return new Promise((resolve) => {
          settleRetry = resolve;
        });
      },
    });

    await expect(plugins.whenPlugin("Flaky")).resolves.toBeNull();

    const retry = plugins.whenPlugin("Flaky");
    // 上一次失败是**已经结算过**的事实：重试还没结算完就抹掉它，等于丢诊断信息。
    expect(plugins.getStatus("Flaky")).toBe("loading");
    expect(plugins.getError("Flaky"), "重试在飞期间应仍能读到上一次的失败原因").toBe(boom);

    settleRetry({ v: "second" });
    await expect(retry).resolves.toEqual({ v: "second" });
    expect(plugins.getStatus("Flaky")).toBe("ready");
    expect(plugins.getError("Flaky"), "成功后必须清空，否则 ready 与「还在错」同时成立").toBeUndefined();
  });
});

describe("PluginRegistry：依赖与调度", () => {
  it("loads dependencies in topological order", async () => {
    const order: string[] = [];
    const { plugins } = registry();
    plugins.register<void>({
      name: "base",
      load: async () => {
        order.push("base");
      },
    });
    plugins.register<void>({
      name: "dep",
      dependencies: ["base"],
      load: async () => {
        order.push("dep");
      },
    });
    plugins.register<void>({
      name: "root",
      dependencies: ["dep"],
      load: async () => {
        order.push("root");
      },
    });
    await plugins.whenPlugin("root");
    expect(order).toEqual(["base", "dep", "root"]);
  });

  it("同层依赖**并行**加载（不是逐个 await）", async () => {
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const { plugins } = registry();
    for (const name of ["A", "B"]) {
      plugins.register<void>({
        name,
        load: () =>
          new Promise<void>((resolve) => {
            started.push(name);
            gates.set(name, resolve);
          }),
      });
    }
    plugins.register<void>({
      name: "Top",
      dependencies: ["A", "B"],
      load: async () => {
        started.push("Top");
      },
    });

    const pending = plugins.whenPlugin("Top");
    await Promise.resolve();
    // 串行实现这里只会看到 ["A"]；「同层并行」这条验收点就得靠它区分
    expect([...started].sort()).toEqual(["A", "B"]);

    gates.get("A")!();
    gates.get("B")!();
    await pending;
    expect(started).toContain("Top");
  });

  it("带依赖的插件：依赖先于目标各加载一次（顺序与次数都要对）", async () => {
    const order: string[] = [];
    const { plugins } = registry();
    plugins.register({
      name: "Dep",
      load: async () => {
        order.push("Dep");
        return { dep: true };
      },
    });
    plugins.register({
      name: "Target",
      dependencies: ["Dep"],
      load: async () => {
        order.push("Target");
        return { target: true };
      },
    });

    const result = await plugins.whenPlugin<{ target: boolean }>("Target");
    expect(result!.target).toBe(true);
    expect(order).toEqual(["Dep", "Target"]);
  });

  it("检测循环依赖", async () => {
    const { plugins } = registry();
    plugins.register<void>({ name: "a", dependencies: ["b"], load: async () => {} });
    plugins.register<void>({ name: "b", dependencies: ["a"], load: async () => {} });
    await expect(plugins.whenPlugin("a")).rejects.toThrow(/cyclic/i);
  });

  it("检测缺失依赖", async () => {
    const { plugins } = registry();
    plugins.register<void>({ name: "a", dependencies: ["missing"], load: async () => {} });
    await expect(plugins.whenPlugin("a")).rejects.toThrow(/missing plugin/i);
  });

  it("目标自己也是环的一部分时同样被抓到（不能只看依赖闭包）", async () => {
    const { plugins } = registry();
    plugins.register<void>({ name: "a", dependencies: ["a"], load: async () => {} });
    await expect(plugins.whenPlugin("a")).rejects.toThrow(/cyclic/i);
  });
});

describe("PluginRegistry：消费者取消只影响自身", () => {
  it("一个消费者 abort：它自己拒绝，另一消费者照常拿到资源，load 不重跑", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const deferred = deferredLoad("G");
    plugins.register({ ...deferred.definition, scope: "global" });

    const controller = new AbortController();
    const aborted = plugins.whenPlugin("G", controller.signal);
    const survivor = plugins.whenPlugin("G");
    expect(deferred.calls()).toBe(1);

    controller.abort(new Error("component unmounted"));
    await expect(aborted).rejects.toBeInstanceOf(BMapError);
    // 消费者取消**不是插件失败**：注册表状态不该被写成 error
    expect(plugins.getStatus("G"), "取消不得污染插件状态").not.toBe("error");
    expect(plugins.inspect("G")?.consumers).toBe(1);

    const instance = { ok: true };
    deferred.settle().resolve(instance);
    await expect(survivor).resolves.toBe(instance);
    expect(deferred.calls()).toBe(1);
    host.dispose();
  });

  it("已 abort 的消费者立刻拒绝，且不产生任何加载", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const load = vi.fn(async () => ({ v: 1 }));
    plugins.register({ name: "G", scope: "global", load });
    const controller = new AbortController();
    controller.abort();

    await expect(plugins.whenPlugin("G", controller.signal)).rejects.toBeInstanceOf(BMapError);
    expect(load).not.toHaveBeenCalled();
    host.dispose();
  });

  it("取消发生在**依赖加载阶段**也会结算这一次调用（不是只认目标那一段）", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const dep = deferredLoad("Dep");
    plugins.register({ ...dep.definition, scope: "global" });
    plugins.register({ name: "Top", scope: "global", dependencies: ["Dep"], load: async () => 1 });

    const controller = new AbortController();
    const pending = plugins.whenPlugin("Top", controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(BMapError);
    dep.settle().resolve({});
    host.dispose();
  });
});

describe("PluginRegistry：global 与 map 作用域", () => {
  it("global 插件跨注册表**只加载一次**，两个注册表拿到同一实例", async () => {
    const host = createPluginHost();
    const instance = { lib: true };
    const load = vi.fn(async () => instance);
    const definition: BMapPluginDefinition<unknown> = { name: "G", scope: "global", load };

    const a = registry({ host });
    const b = registry({ host });
    a.plugins.register(definition);
    b.plugins.register(definition);

    const [ra, rb] = await Promise.all([a.plugins.whenPlugin("G"), b.plugins.whenPlugin("G")]);
    expect(load, "同页面两份地图不得各插一份脚本").toHaveBeenCalledTimes(1);
    expect(ra).toBe(instance);
    expect(rb).toBe(instance);
    expect(a.plugins.getStatus("G")).toBe("ready");
    expect(b.plugins.getStatus("G")).toBe("ready");
    // 各自回执各自的 plugin:ready（每张地图的消费者都要收到）
    expect(a.events.readyCount()).toBe(1);
    expect(b.events.readyCount()).toBe(1);
    host.dispose();
  });

  it("map 插件**不共享**：两个注册表各加载一次，实例互不相同", async () => {
    const load = vi.fn(async () => ({ id: Math.random() }));
    const definition: BMapPluginDefinition<unknown> = { name: "M", scope: "map", load };
    const a = registry();
    const b = registry();
    a.plugins.register(definition);
    b.plugins.register(definition);

    const ra = await a.plugins.whenPlugin("M");
    const rb = await b.plugins.whenPlugin("M");
    expect(load).toHaveBeenCalledTimes(2);
    expect(ra).not.toBe(rb);
  });

  it("卸载地图 A 不得破坏地图 B：global 资源保留、不重跑 load、不调 definition.dispose", async () => {
    const host = createPluginHost();
    const instance = { lib: true };
    const load = vi.fn(async () => instance);
    const dispose = vi.fn();
    const definition: BMapPluginDefinition<unknown> = {
      name: "G",
      scope: "global",
      load,
      dispose,
    };

    const a = registry({ host });
    const b = registry({ host });
    a.plugins.register(definition);
    b.plugins.register(definition);

    await a.plugins.whenPlugin("G");
    await b.plugins.whenPlugin("G");

    a.plugins.dispose();
    expect(a.plugins.getStatus("G")).toBe("disposed");
    expect(dispose, "释放权在宿主手里，地图卸载无权释放全局资源").not.toHaveBeenCalled();
    expect(host.inspect("G")?.status, "地图 A 卸载后共享条目仍在").toBe("ready");

    // B 仍在用：既没有重跑加载，也没有被 A 的卸载牵连
    await expect(b.plugins.whenPlugin("G")).resolves.toBe(instance);
    expect(load).toHaveBeenCalledTimes(1);
    host.dispose();
    // 宿主才是合法所有者
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(instance, expect.anything());
  });

  it("map 插件随地图释放：dispose 调用 definition.dispose，且不影响另一张地图", async () => {
    const dispose = vi.fn();
    const make = (): BMapPluginDefinition<unknown> => ({
      name: "M",
      scope: "map",
      load: async () => ({ ok: true }),
      dispose,
    });
    const a = registry();
    const b = registry();
    a.plugins.register(make());
    b.plugins.register(make());

    const instanceA = await a.plugins.whenPlugin("M");
    await b.plugins.whenPlugin("M");

    a.plugins.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(instanceA, expect.anything());
    expect(b.plugins.getStatus("M"), "另一张地图的 map 插件不受影响").toBe("ready");
  });

  it("dispose 后该注册表整体进入 disposed，且不再接受加载", async () => {
    const { plugins } = registry();
    plugins.register({ name: "M", scope: "map", load: async () => ({}) });
    plugins.dispose();
    expect(plugins.getStatus("M")).toBe("disposed");
    await expect(plugins.whenPlugin("M")).rejects.toBeInstanceOf(BMapError);
  });

  it("dispose 不会把消费者计数减成负数（inspect 读得到不可能的值）", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const deferred = deferredLoad("G");
    plugins.register({ ...deferred.definition, scope: "global" });

    const pending = plugins.whenPlugin("G");
    expect(plugins.inspect("G")?.consumers).toBe(1);

    plugins.dispose();
    await expect(pending).rejects.toBeInstanceOf(BMapError);
    expect(plugins.getStatus("G")).toBe("disposed");
    expect(plugins.inspect("G")?.consumers, "结算后是 0，不是 -1").toBe(0);
    host.dispose();
  });
});

describe("PluginRegistry：setup 的 disposer 与 map dispose 的顺序", () => {
  it("map 插件的 setup disposer 由注册表 scope 释放，dispose() 只负责插件自己那一半", async () => {
    const order: string[] = [];
    const scope = new ResourceScope();
    const { plugins } = registry({ scope });
    plugins.register({
      name: "M",
      scope: "map",
      load: async () => ({ ok: true }),
      setup: () => () => order.push("setup-disposer"),
      dispose: () => order.push("definition-dispose"),
    });
    await plugins.whenPlugin("M");

    plugins.dispose();
    expect(order, "definition.dispose 在注册表 dispose 时执行").toEqual(["definition-dispose"]);
    scope.dispose();
    expect(order, "setup 的 disposer 归 scope 释放").toEqual([
      "definition-dispose",
      "setup-disposer",
    ]);
  });
});

/**
 * dispose 之后**晚到的结算**不得复活记录（评审 #88 P1-1）。
 *
 * `dispose()` 只把 record 标成 `disposed`，但 `loadPlugin()` 里早先挂上的 `.then/.catch`
 * 仍会无条件回写 `status` / `instance` / `error` 并广播事件。于是「地图卸载了，插件脚本这才
 * 下载完/失败」会把这个注册表从 disposed 拉回 ready / error：状态说谎、事件发到已销毁的地图上，
 * 而且 `map` 作用域那条晚到的实例此刻**没有任何所有者**（dispose 的快照里它是 null），
 * 再也不会有谁去调 `definition.dispose`。
 */
describe("PluginRegistry：dispose 之后晚到的结算不得复活记录", () => {
  it("dispose 后底层才 reject：状态仍是 disposed，不再发 plugin:error、不记 late error", async () => {
    const boom = new Error("late failure");
    const { plugins, events } = registry();
    const deferred = deferredLoad("M");
    plugins.register({ ...deferred.definition, scope: "map", required: false });

    const pending = plugins.whenPlugin("M");
    expect(plugins.getStatus("M")).toBe("loading");

    plugins.dispose();
    // 消费者在 dispose 时就被结算（这是既有行为，保持不变）
    await expect(pending).rejects.toBeInstanceOf(BMapError);

    deferred.settle().reject(boom);
    await flush();

    expect(plugins.getStatus("M"), "晚到的失败不得把 disposed 改回 error").toBe("disposed");
    expect(emitted(events, "plugin:error"), "disposed 后不得再广播").toBe(0);
    expect(plugins.getError("M"), "也不该把 late error 写进记录").toBeUndefined();
  });

  it("dispose 后底层才 resolve：状态仍是 disposed、不 emit ready，且 map 资源被就地释放", async () => {
    const { plugins, events } = registry();
    const dispose = vi.fn();
    const deferred = deferredLoad("M");
    plugins.register({ ...deferred.definition, scope: "map", dispose });

    const pending = plugins.whenPlugin("M");
    plugins.dispose();
    await expect(pending).rejects.toBeInstanceOf(BMapError);

    const instance = { late: true };
    deferred.settle().resolve(instance);
    await flush();

    expect(plugins.getStatus("M"), "晚到的成功不得把 disposed 改回 ready").toBe("disposed");
    expect(events.readyCount(), "disposed 后不得再广播").toBe(0);
    expect(
      dispose,
      "晚到的 map 资源此刻没有别的所有者，必须就地释放（否则既没进 dispose 快照，也不会被 scope 回收）",
    ).toHaveBeenCalledWith(instance, expect.anything());
  });

  it("global 作用域的迟到成功不由注册表释放（释放权在宿主的 dispose）", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const dispose = vi.fn();
    const deferred = deferredLoad("G");
    plugins.register({ ...deferred.definition, scope: "global", dispose });

    const pending = plugins.whenPlugin("G");
    plugins.dispose();
    await expect(pending).rejects.toBeInstanceOf(BMapError);

    deferred.settle().resolve({ shared: true });
    await flush();

    expect(plugins.getStatus("G")).toBe("disposed");
    expect(dispose, "global 资源归宿主管，注册表无权释放").not.toHaveBeenCalled();
    host.dispose();
    expect(dispose, "宿主才是它的所有者").toHaveBeenCalledTimes(1);
  });

  it("反证：没有 dispose 时，同样的晚到结算照常记账（别把守卫写成恒不记账）", async () => {
    const { plugins, events } = registry();
    const dispose = vi.fn();
    const deferred = deferredLoad("M");
    plugins.register({ ...deferred.definition, scope: "map", dispose });

    const pending = plugins.whenPlugin("M");
    const instance = { ok: true };
    deferred.settle().resolve(instance);
    await expect(pending).resolves.toBe(instance);

    expect(plugins.getStatus("M")).toBe("ready");
    expect(emitted(events, "plugin:ready")).toBe(1);
    expect(dispose, "正常路径不由加载流程释放").not.toHaveBeenCalled();
  });
});

/**
 * `setup()` 的执行时机（评审第三轮 P1-2）。
 *
 * `setup()` 原本跑在 `loadOwnedResource()` 里 —— 也就是**早于** generation / disposed 校验。
 * 两个后果：
 *
 * 1. 「地图已经销毁、插件脚本这才下载完」时，仍然会在销毁后执行一次 `setup()`（可能重新产生副作用）；
 * 2. 更糟的是 `setup()` 抛错时，实例**到不了**过期结算那条释放路径：异常把 promise 推进 catch，
 *    而 catch 只把错误重新抛出 ⇒ 刚创建出来的 `map` 资源没人释放。
 *
 * 正确顺序：产出实例 → 校验这次加载还算不算数 → 算数才 `setup` → ready；
 * 不算数就地释放；`setup` 抛错则把实例释放掉再按失败结算。
 */
describe("PluginRegistry：setup 的执行时机", () => {
  it("dispose 后 load 才 resolve：**不执行** setup，但仍就地释放实例", async () => {
    const { plugins } = registry();
    const setup = vi.fn(() => () => {});
    const dispose = vi.fn();
    const deferred = deferredLoad("M");
    plugins.register({
      ...deferred.definition,
      scope: "map",
      required: false,
      setup,
      dispose,
    });

    const pending = plugins.whenPlugin("M");
    plugins.dispose();
    await expect(pending).rejects.toBeInstanceOf(BMapError);

    const instance = { late: true };
    deferred.settle().resolve(instance);
    await flush();

    expect(setup, "地图销毁后不得再产生 setup 副作用").not.toHaveBeenCalled();
    expect(dispose, "资源仍要释放").toHaveBeenCalledWith(instance, expect.anything());
  });

  it("setup 抛错：已创建的实例仍被释放，插件按失败结算（不是泄漏 + 假成功）", async () => {
    const boom = new Error("setup failed");
    const { plugins, events } = registry();
    const instance = { ok: true };
    const dispose = vi.fn();
    plugins.register({
      name: "M",
      scope: "map",
      required: false,
      load: async () => instance,
      setup: () => {
        throw boom;
      },
      dispose,
    });

    await expect(plugins.whenPlugin("M")).resolves.toBeNull();
    expect(plugins.getStatus("M")).toBe("error");
    expect(plugins.getError("M")).toBe(boom);
    expect(emitted(events, "plugin:ready"), "没就绪就不该回执 ready").toBe(0);
    expect(emitted(events, "plugin:error")).toBe(1);
    expect(dispose, "创建出来却没就绪的实例必须释放").toHaveBeenCalledWith(
      instance,
      expect.anything(),
    );
  });

  it("反证：正常路径会执行 setup，且**不**在加载流程里释放实例", async () => {
    const { plugins, events } = registry();
    const instance = { ok: true };
    const dispose = vi.fn();
    const setup = vi.fn(() => () => {});
    plugins.register({
      name: "M",
      scope: "map",
      load: async () => instance,
      setup,
      dispose,
    });

    await expect(plugins.whenPlugin("M")).resolves.toBe(instance);
    expect(setup, "正常路径必须执行 setup").toHaveBeenCalledWith(instance, expect.anything());
    expect(plugins.getStatus("M")).toBe("ready");
    expect(emitted(events, "plugin:ready")).toBe(1);
    expect(dispose, "正常路径不由加载流程释放").not.toHaveBeenCalled();
  });
});

/**
 * `setup` 只由**资源的所有者**执行一次（自查发现，同一轮改动带出来的）。
 *
 * `global` 作用域的资源归宿主管：宿主在它的纪元 scope 上跑一次 `setup`。注册表如果也跑一次，
 * 同一个副作用会被登记两遍，而且它返回的 disposer 会被挂到**地图** scope 上 —— 于是地图一卸载
 * 就拆掉了宿主持有的那份状态。所以注册表只对 `map` 作用域执行 `setup`。
 */
describe("PluginRegistry：setup 只由资源所有者执行一次", () => {
  it("global 插件：setup 恰好一次（宿主执行），注册表不重复执行", async () => {
    const host = createPluginHost();
    const { plugins } = registry({ host });
    const setup = vi.fn(() => () => {});
    plugins.register({ name: "G", scope: "global", load: async () => ({ lib: true }), setup });

    await plugins.whenPlugin("G");
    expect(setup, "global 资源的 setup 归宿主管，只跑一次").toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it("map 插件：setup 仍由注册表执行（它才是这张地图资源的所有者）", async () => {
    const { plugins } = registry();
    const setup = vi.fn(() => () => {});
    plugins.register({ name: "M", scope: "map", load: async () => ({ local: true }), setup });

    await plugins.whenPlugin("M");
    expect(setup).toHaveBeenCalledTimes(1);
  });
});

/**
 * `setup()` 内同步重入注册表的 `dispose()`（评审第五轮 P2）。
 *
 * 只把 `setup` 排在校验之后还不够：`setup` 是调用方代码，它可以在内部调 `plugins.dispose()`。
 * 那时 record 已经变成 `disposed`，而成功分支随后仍会把 `status` 写回 `ready`、并往已销毁的注册表
 * 广播 `plugin:ready`；刚产出的 map 资源也没人释放。
 */
describe("PluginRegistry：setup 内同步重入 dispose", () => {
  it("map 插件的 setup 内调用 plugins.dispose()：保持 disposed、释放实例、不发 ready", async () => {
    const { plugins, events } = registry();
    const instance = { ok: true };
    const dispose = vi.fn(() => {});
    plugins.register({
      name: "M",
      scope: "map",
      required: false,
      load: async () => instance,
      setup: () => {
        plugins.dispose();
      },
      dispose,
    });

    // 消费者被注册表的内部 abort 结算
    await expect(plugins.whenPlugin("M")).rejects.toBeInstanceOf(BMapError);

    expect(plugins.getStatus("M"), "不得被写回 ready").toBe("disposed");
    expect(emitted(events, "plugin:ready"), "已销毁的注册表不得再广播").toBe(0);
    expect(dispose, "刚产出的 map 资源要就地释放").toHaveBeenCalledWith(
      instance,
      expect.anything(),
    );
  });
});
