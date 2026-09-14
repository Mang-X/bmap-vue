/**
 * PluginHost —— global 作用域插件资源的**跨地图共享宿主**（M8-PLUGIN-CORE / issue #42）
 *
 * 现状的问题不是「共享得不够优雅」，而是**同一份全局脚本会被加载多次、并且会被别的地图的卸载
 * 打断**：`PluginRegistry` 每个地图实例各建一份，`whenPlugin` 又把**地图自己的** `scope.signal`
 * 传给 `load()`。于是：
 *
 * - 同页面两张 `<BMap :plugins="['TrackAnimation']">` ⇒ 插两次 `<script>`；
 * - 地图 A 卸载 ⇒ A 的 scope abort ⇒ A 那条加载被取消，而 B 走的是另一条加载，
 *   「谁先谁后」决定 B 会不会跟着一起挂。
 *
 * `PluginHost` 把「global 作用域脚本」按它真实的形状建模：**一份文档一份资源**，由宿主独占持有，
 * 消费者只登记兴趣。所以它必须证明四件事：
 *
 * 1. **共享**：同一名字只 `load()` 一次，后到的消费者拿同一个实例；
 * 2. **消费者取消只影响自身**：一个消费者 abort，其他消费者照常拿到资源，`load()` 不被重跑；
 * 3. **失败可重试**：失败条目**不留在缓存里**（与 react-bmap 的
 *    `promise.catch(() => registry.delete(loadKey))` 同形），下一次请求真的重新加载；
 * 4. **释放权在宿主手里**：只有宿主 `dispose()` 才释放 global 资源 —— 地图卸载**不**释放，
 *    因为上游没有卸载入口，删 script / 抹全局会波及页面里其它依赖它的代码。
 *
 * 第 4 条正是本票与「引用计数式释放」的分歧点：引用计数能回收，但实现只能是「删 `<script>`
 * + 抹全局」，而 AGENTS.md 明令不得删除 / 改写上游注入的 script。
 */
import { describe, it, expect, vi } from "vitest";
import { createPluginHost } from "./PluginHost";
import type { BMapPluginDefinition, PluginContext } from "./PluginRegistry";
import { BMapError } from "../errors/BMapError";

function makeContext(): PluginContext {
  return { api: {}, map: { id: "map" } as unknown as PluginContext["map"], client: null };
}

/** 手动控制结算时机的 definition，用来观察「共享的到底是哪一次加载」。 */
function deferredPlugin(name = "Shared") {
  let settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  let calls = 0;
  const definition: BMapPluginDefinition<unknown> = {
    name,
    scope: "global",
    required: false,
    load: () => {
      calls += 1;
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  };
  return {
    definition,
    calls: () => calls,
    settle: () => settle,
  };
}

describe("PluginHost：global 资源跨消费者共享", () => {
  it("两次 acquire 只 load 一次，拿到**同一个**实例", async () => {
    const host = createPluginHost();
    const instance = { trackAnimation: true };
    const load = vi.fn(async () => instance);
    const definition: BMapPluginDefinition<unknown> = { name: "G", scope: "global", load };

    const [a, b] = await Promise.all([
      host.acquire("G", definition, makeContext()),
      host.acquire("G", definition, makeContext()),
    ]);

    expect(load, "共享任务：同一次在飞加载不得重复发起").toHaveBeenCalledTimes(1);
    expect(a).toBe(instance);
    expect(b).toBe(instance);
    host.dispose();
  });

  it("后到的消费者复用**已就绪**的实例，不会再 load", async () => {
    const host = createPluginHost();
    const load = vi.fn(async () => ({ ready: true }));
    const definition: BMapPluginDefinition<unknown> = { name: "G", scope: "global", load };

    await host.acquire("G", definition, makeContext());
    const second = await host.acquire("G", definition, makeContext());

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ready: true });
    host.dispose();
  });

  it("不同名字互不干扰（缓存按名字分桶）", async () => {
    const host = createPluginHost();
    const loadA = vi.fn(async () => "A");
    const loadB = vi.fn(async () => "B");
    expect(await host.acquire("A", { name: "A", scope: "global", load: loadA }, makeContext())).toBe(
      "A",
    );
    expect(await host.acquire("B", { name: "B", scope: "global", load: loadB }, makeContext())).toBe(
      "B",
    );
    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
    host.dispose();
  });
});

describe("PluginHost：消费者取消只影响自身", () => {
  it("一个消费者 abort：它自己 reject，另一个照常拿到资源，load 不重跑", async () => {
    const host = createPluginHost();
    const deferred = deferredPlugin();
    const controller = new AbortController();

    const aborted = host.acquire(
      "Shared",
      deferred.definition,
      makeContext(),
      controller.signal,
    );
    const survivor = host.acquire("Shared", deferred.definition, makeContext());

    // 先证明两个消费者真的在等**同一次**加载（否则下面「不重跑」是空的）
    expect(deferred.calls()).toBe(1);
    expect(host.inspect("Shared")?.consumers).toBe(2);

    controller.abort(new Error("component unmounted"));
    await expect(aborted).rejects.toBeInstanceOf(BMapError);
    // 取消是**消费者自己的**结算，不是插件失败：状态不该被写成 error
    expect(host.inspect("Shared")?.status).toBe("loading");
    expect(host.inspect("Shared")?.consumers, "取消后消费者数应下降").toBe(1);

    const instance = { ok: true };
    deferred.settle().resolve(instance);
    await expect(survivor).resolves.toBe(instance);
    expect(deferred.calls(), "消费者取消不得触发一次新的加载").toBe(1);
    host.dispose();
  });

  it("已 abort 的消费者**不会**启动加载（不产生无人等待的请求）", async () => {
    const host = createPluginHost();
    const load = vi.fn(async () => ({ v: 1 }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      host.acquire("G", { name: "G", scope: "global", load }, makeContext(), controller.signal),
    ).rejects.toBeInstanceOf(BMapError);
    expect(load).not.toHaveBeenCalled();
    expect(host.inspect("G")).toBeUndefined();
    host.dispose();
  });

  it("宿主 dispose 会结算仍在等待的消费者（不会让他们永远挂着）", async () => {
    const host = createPluginHost();
    const deferred = deferredPlugin();
    const waiting = host.acquire("Shared", deferred.definition, makeContext());

    host.dispose();
    await expect(waiting).rejects.toBeInstanceOf(BMapError);
  });

  it("取消后状态可读：consumers 归零，条目仍在飞（在飞 ≠ 未释放）", async () => {
    const host = createPluginHost();
    const deferred = deferredPlugin();
    const controller = new AbortController();
    const waiting = host.acquire(
      "Shared",
      deferred.definition,
      makeContext(),
      controller.signal,
    );
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(BMapError);

    const inspection = host.inspect("Shared");
    expect(inspection, "消费者全走了，条目仍应可读").toBeDefined();
    expect(inspection!.consumers).toBe(0);
    expect(inspection!.attempts).toBe(1);
    host.dispose();
  });
});

describe("PluginHost：失败重试", () => {
  it("加载失败后条目**不留在缓存里**：下一次 acquire 真的重新加载并成功", async () => {
    const host = createPluginHost();
    const boom = new Error("cdn down");
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw boom;
      return { v: attempt };
    });
    const definition: BMapPluginDefinition<unknown> = { name: "G", scope: "global", load };

    await expect(host.acquire("G", definition, makeContext())).rejects.toBe(boom);
    expect(host.inspect("G"), "失败条目必须从缓存里移除，否则重试是假的").toBeUndefined();

    await expect(host.acquire("G", definition, makeContext())).resolves.toEqual({ v: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.inspect("G")?.attempts, "attempts 应记录到重试过").toBe(2);
    host.dispose();
  });

  it("失败广播给**所有**当前消费者（同一次加载同一条错误对象）", async () => {
    const host = createPluginHost();
    const boom = new Error("cdn down");
    const deferred = deferredPlugin();
    const first = host.acquire("Shared", deferred.definition, makeContext());
    const second = host.acquire("Shared", deferred.definition, makeContext());
    deferred.settle().reject(boom);
    await expect(first).rejects.toBe(boom);
    await expect(second).rejects.toBe(boom);
    host.dispose();
  });
});

describe("PluginHost：释放权在宿主手里", () => {
  it("dispose 调用 setup 返回的 disposer，并清空缓存", async () => {
    const host = createPluginHost();
    const disposeResource = vi.fn();
    const definition: BMapPluginDefinition<unknown> = {
      name: "G",
      scope: "global",
      load: async () => ({ v: 1 }),
      setup: () => disposeResource,
    };
    await host.acquire("G", definition, makeContext());
    expect(disposeResource).not.toHaveBeenCalled();

    host.dispose();
    expect(disposeResource).toHaveBeenCalledTimes(1);
    expect(host.inspect("G")).toBeUndefined();
  });

  it("同名不同 definition：复用**先到**的那一份（当前口径，不是意外）", async () => {
    // 宿主按**名字**去重，不比较 definition 身份。跨注册表的同名冲突检测需要 definition 级别的
    // 指纹（参考实现用的是 `loadKey`），那属于扩展契约，本票不做 —— 所以这里把现状钉住，
    // 免得「静默复用」既是行为又没人知道。见 ADR 2026-09-14 的「已知限制」。
    const host = createPluginHost();
    const first = vi.fn(async () => "first");
    const second = vi.fn(async () => "second");
    const a = await host.acquire("G", { name: "G", scope: "global", load: first }, makeContext());
    const b = await host.acquire("G", { name: "G", scope: "global", load: second }, makeContext());

    expect(a).toBe("first");
    expect(b, "第二个 definition 不会生效").toBe("first");
    expect(second).not.toHaveBeenCalled();
    host.dispose();
  });

  it("dispose 后可以重新加载，且拿到的是**新**实例（不是旧缓存）", async () => {
    const host = createPluginHost();
    let n = 0;
    const load = vi.fn(async () => ({ n: ++n }));
    const definition: BMapPluginDefinition<unknown> = { name: "G", scope: "global", load };
    expect(await host.acquire("G", definition, makeContext())).toEqual({ n: 1 });
    host.dispose();
    expect(await host.acquire("G", definition, makeContext())).toEqual({ n: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    host.dispose();
  });
});
