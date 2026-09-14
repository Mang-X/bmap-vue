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

/**
 * 旧纪元任务的结算不得污染新纪元（评审 #88 P1-2）。
 *
 * `dispose()` 会清空 entries 并允许同名插件重新 `acquire`，但**旧纪元那条在飞任务**之后才结算时，
 * 它的处理器仍按**名字**操作这张表：失败时 `entries.delete(name)` 会把新纪元的同名条目一起删掉
 * （于是新纪元在飞/已成功的条目查不到，第三次 acquire 又会重复加载 —— global 去重失效）；
 * 成功时旧实例已经不在 entries 里、也不在 dispose 时的 ready 快照里 ⇒
 * `definition.dispose` 永远不会执行，形成孤儿资源。
 */
describe("PluginHost：旧纪元的结算不得污染新纪元", () => {
  it("旧纪元任务失败时按名字删会误删新纪元的同名条目（去重随之失效）", async () => {
    const host = createPluginHost();
    const old = deferredPlugin("G");
    const oldAcquire = host.acquire("G", old.definition, makeContext());

    host.dispose();
    // 旧纪元的消费者在 dispose 时就被结算了
    await expect(oldAcquire).rejects.toBeInstanceOf(BMapError);

    const fresh = vi.fn(async () => "fresh");
    const freshDefinition = { name: "G", scope: "global" as const, load: fresh };
    await expect(host.acquire("G", freshDefinition, makeContext())).resolves.toBe("fresh");

    // 旧纪元那条现在才失败
    old.settle().reject(new Error("old epoch fails"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.inspect("G"), "新纪元的条目必须还在").toBeDefined();
    // 去重没被破坏：再来一次应当复用新纪元已就绪的实例，而不是重新加载
    await expect(host.acquire("G", freshDefinition, makeContext())).resolves.toBe("fresh");
    expect(fresh, "第三次 acquire 不得重复加载").toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it("旧纪元的迟到成功：不写进新纪元状态，也不在判定点之前释放旧资源", async () => {
    const host = createPluginHost();
    const oldDispose = vi.fn();
    const old = deferredPlugin("G");
    const oldAcquire = host.acquire(
      "G",
      { ...old.definition, dispose: oldDispose },
      makeContext(),
    );

    host.dispose();
    await expect(oldAcquire).rejects.toBeInstanceOf(BMapError);

    // 新纪元这条用**手动可控**的加载：否则它会在同一个 tick 里就绪，下面那句
    // 「结算不得写进新纪元」的观测窗口就没了
    const fresh = deferredPlugin("G");
    const freshAcquire = host.acquire("G", fresh.definition, makeContext());
    expect(host.inspect("G")?.status, "新纪元正在飞").toBe("loading");

    // 旧纪元那条现在才成功
    old.settle().resolve("old-instance");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.inspect("G")?.status, "旧纪元任务的结算不得写进新纪元").toBe("loading");
    // 判定推迟：新纪元还在飞，谁也不知道它会不会 claim 同一个实例
    // （「确实没人认领 ⇒ 释放」那半条由下面「延迟判定不会漏掉」的用例断言）
    expect(oldDispose, "新纪元尚未结算，此刻不能释放").not.toHaveBeenCalled();

    fresh.settle().resolve("fresh-instance");
    await expect(freshAcquire, "就地释放不得牵连新纪元的加载").resolves.toBe("fresh-instance");
    host.dispose();
  });

  it("旧纪元与新纪元拿到的是**同一个**实例时不释放它（避免过度释放）", async () => {
    const host = createPluginHost();
    const shared = { shared: true };
    const dispose = vi.fn();
    const old = deferredPlugin("G");
    const oldAcquire = host.acquire("G", { ...old.definition, dispose }, makeContext());
    host.dispose();
    await expect(oldAcquire).rejects.toBeInstanceOf(BMapError);

    // 新纪元的加载先完成，且返回**同一个对象**（自定义 definition 复用一个单例完全可能）
    const freshAcquire = host.acquire(
      "G",
      { name: "G", scope: "global", load: async () => shared, dispose },
      makeContext(),
    );
    await expect(freshAcquire).resolves.toBe(shared);

    old.settle().resolve(shared);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dispose, "新纪元仍在用这个实例，释放它就是过度释放").not.toHaveBeenCalled();
    expect(host.inspect("G")?.status).toBe("ready");

    host.dispose();
    expect(dispose, "宿主 dispose 才是它的释放点").toHaveBeenCalledTimes(1);
  });

  /**
   * 上面那条只覆盖了**一个顺序**（新纪元先就绪、旧纪元后结算）。反过来才是危险的：
   * 新纪元还在飞时 `instance` 是 `null`，旧纪元先 resolve ⇒ 看上去「没人用」，于是释放掉 ——
   * 而新纪元随后拿到**同一个单例**，消费者手里就是一个已经被释放的资源（评审第三轮 P1-1）。
   */
  it("反向顺序：新纪元仍在飞时旧纪元先 resolve 同一个实例 ⇒ 不得释放", async () => {
    const host = createPluginHost();
    const shared = { shared: true };
    const dispose = vi.fn();
    const old = deferredPlugin("G");
    const oldAcquire = host.acquire("G", { ...old.definition, dispose }, makeContext());
    host.dispose();
    await expect(oldAcquire).rejects.toBeInstanceOf(BMapError);

    // 新纪元开始加载，但**还没结算**（此刻新条目的 instance 仍是 null）
    const fresh = deferredPlugin("G");
    const freshAcquire = host.acquire("G", { ...fresh.definition, dispose }, makeContext());
    expect(host.inspect("G")?.status).toBe("loading");

    // 旧纪元先 resolve 同一个实例：此刻**还判断不了**新纪元会不会 claim 它
    old.settle().resolve(shared);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispose, "新纪元还在飞，判定必须推迟，不能当场释放").not.toHaveBeenCalled();

    // 新纪元随后 resolve 同一个实例
    fresh.settle().resolve(shared);
    await expect(freshAcquire).resolves.toBe(shared);
    expect(host.inspect("G")?.status).toBe("ready");
    expect(dispose, "新纪元正在用这个实例").not.toHaveBeenCalled();

    host.dispose();
    expect(dispose, "宿主 dispose 才是释放点").toHaveBeenCalledTimes(1);
  });

  it("延迟判定不会把**确实没人认领**的旧实例漏掉（新纪元拿到另一个实例时旧的要释放）", async () => {    const host = createPluginHost();
    const orphan = { orphan: true };
    const freshInstance = { fresh: true };
    const dispose = vi.fn();
    const old = deferredPlugin("G");
    const oldAcquire = host.acquire("G", { ...old.definition, dispose }, makeContext());
    host.dispose();
    await expect(oldAcquire).rejects.toBeInstanceOf(BMapError);

    const fresh = deferredPlugin("G");
    const freshAcquire = host.acquire("G", { ...fresh.definition, dispose }, makeContext());

    old.settle().resolve(orphan);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispose, "还没到判定点").not.toHaveBeenCalled();

    fresh.settle().resolve(freshInstance);
    await expect(freshAcquire).resolves.toBe(freshInstance);

    expect(dispose, "新纪元用的是另一个实例 ⇒ 旧实例确实没人认领，必须释放").toHaveBeenCalledWith(
      orphan,
      expect.anything(),
    );
    expect(dispose, "新纪元在用的那个不当场释放").toHaveBeenCalledTimes(1);
    host.dispose();
    expect(dispose, "宿主的 ready 快照再释放一次新实例").toHaveBeenCalledTimes(2);
  });
});

/**
 * 宿主的 `setup()` 抛错同样不能泄漏（评审第四轮 P1）。
 *
 * Registry 在上一轮已经把「守卫必须排在副作用之前」修掉了，宿主这边还是老样子：
 * 先写 `entry.instance` / `status = "ready"`、再调 `setup()`；`setup()` 抛错时 catch 只把条目
 * 从 `entries` 删掉并重新抛 —— 实例已经创建、却没有任何缓存记录指向它，之后 `host.dispose()`
 * 也找不到它。**global 资源的所有者本来就是宿主**，所以这一份必须由宿主自己回收。
 */
describe("PluginHost：setup 抛错时的资源归属", () => {
  it("setup 抛错：实例由宿主释放一次，条目被清掉（可重试），acquire 抛原始错误", async () => {
    const host = createPluginHost();
    const boom = new Error("setup failed");
    const instance = { ok: true };
    const dispose = vi.fn();
    const definition: BMapPluginDefinition<unknown> = {
      name: "G",
      scope: "global",
      load: async () => instance,
      setup: () => {
        throw boom;
      },
      dispose,
    };

    await expect(host.acquire("G", definition, makeContext())).rejects.toBe(boom);
    expect(dispose, "创建出来却没就绪的实例必须由宿主释放").toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(instance, expect.anything());
    expect(host.inspect("G"), "失败条目不留缓存 ⇒ 可重试").toBeUndefined();

    // 反证：修好之后重试仍能成功（失败没有被记成「已加载」）
    const retryInstance = { retry: true };
    const retry: BMapPluginDefinition<unknown> = {
      name: "G",
      scope: "global",
      load: async () => retryInstance,
      dispose,
    };
    await expect(host.acquire("G", retry, makeContext())).resolves.toBe(retryInstance);
    host.dispose();
  });
});

/**
 * 候选孤儿要按**实例 identity** 去重（评审第四轮 P2）。
 *
 * `BMapPluginDefinition.dispose` 没有幂等契约，而候选是按名字存进数组的 —— 两个旧纪元各自
 * `resolve` 出**同一个单例**（`load` 忽略 abort 是完全合法的写法）时会被挂两次，结算时同一个实例
 * 就被 `dispose` 两次。
 */
describe("PluginHost：候选孤儿按实例去重", () => {
  it("两个旧纪元 resolve 同一个单例：只挂一次、只释放一次（三纪元场景）", async () => {
    const host = createPluginHost();
    const shared = { shared: true };
    const freshInstance = { fresh: true };
    const dispose = vi.fn();

    const epoch0 = deferredPlugin("G");
    const acquired0 = host.acquire("G", { ...epoch0.definition, dispose }, makeContext());
    host.dispose();
    const epoch1 = deferredPlugin("G");
    const acquired1 = host.acquire("G", { ...epoch1.definition, dispose }, makeContext());
    host.dispose();
    await expect(acquired0).rejects.toBeInstanceOf(BMapError);
    await expect(acquired1).rejects.toBeInstanceOf(BMapError);

    // 第三个纪元正在加载
    const epoch2 = deferredPlugin("G");
    const acquired2 = host.acquire("G", { ...epoch2.definition, dispose }, makeContext());

    // 两个旧纪元都 resolve **同一个** 实例
    epoch0.settle().resolve(shared);
    await new Promise((resolve) => setTimeout(resolve, 0));
    epoch1.settle().resolve(shared);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispose, "还没到判定点").not.toHaveBeenCalled();

    // 第三个纪元拿到另一个实例 ⇒ 旧实例该释放，但**只能一次**
    epoch2.settle().resolve(freshInstance);
    await expect(acquired2).resolves.toBe(freshInstance);
    expect(
      dispose.mock.calls.filter(([instance]) => instance === shared),
      "同一个实例不得被 dispose 两次",
    ).toHaveLength(1);

    host.dispose();
  });
});
