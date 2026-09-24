/**
 * 服务任务内核与实例通道（issue #139）
 *
 * 这一层**框架无关**，所以用例不挂组件：手搭 `ServiceCall` 桩与 `whenReady`，断言的是
 * 「引擎语义」本身——能力门不发请求、按 Client 缓存、投影只作用于 data、取代不迟到回写、
 * 以及 #139 的核心断言：**简单通道不携带无消费者的状态**。
 */
import { describe, it, expect, vi } from "vitest";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import { createServiceCall } from "../../driver/normalize/serviceCall";
import type { ServiceCall, ServiceCallSettle } from "../../driver/types/services";
import type { BMapClient } from "../../client/types";
import { createRequestGuard } from "./requestGuard";
import { createServiceTaskCore, type ServiceTaskState } from "./serviceTaskCore";
import {
  createSharedInstanceChannel,
  createExclusiveInstanceChannel,
  type ServiceInstanceChannel,
} from "./instanceChannel";

interface StubHandle {
  readonly serial: number;
}

function makeClient(supports = true): BMapClient {
  return {
    engine: "jsapi-v4",
    rawSdk: {},
    capabilities: { supports: () => supports },
    driver: { services: {} },
  } as unknown as BMapClient;
}

interface HarnessOptions {
  supports?: boolean;
  /** 不提供时默认 `success(invokes * 10, 0)` */
  settle?: (settle: ServiceCallSettle<number>, invokeIndex: number) => void;
  loadFails?: boolean;
  createThrows?: boolean;
  channel?: ServiceInstanceChannel<StubHandle>;
}

function makeHarness(options: HarnessOptions = {}) {
  const stats = { created: 0, invokes: 0, released: 0, releaseAttempts: 0 };
  const client = makeClient(options.supports ?? true);
  const states: Array<Partial<ServiceTaskState<number>>> = [];
  const state: ServiceTaskState<number> = {
    status: "idle",
    data: null,
    error: null,
    sdkStatus: 0,
    isLoading: false,
    supported: true,
  };
  const applyPatch = (patch: Partial<ServiceTaskState<number>>) => {
    Object.assign(state, patch);
    states.push(patch);
  };
  const ctx = {
    whenReady: options.loadFails
      ? () => Promise.reject(new BMapError("BMAP_SDK_LOAD_FAILED", "SDK 加载失败"))
      : async () => ({ client, map: null }),
  };
  const channel =
    options.channel ??
    createSharedInstanceChannel<StubHandle>();
  const core = createServiceTaskCore<number, StubHandle, [string], number>({
    capability: "service.geocoder",
    create: () => {
      if (options.createThrows) throw new BMapError("BMAP_INVALID_ARGUMENT", "create 失败");
      stats.created += 1;
      return { serial: stats.created };
    },
    invoke: (_context, _handle, _arg: string) => {
      stats.invokes += 1;
      const index = stats.invokes;
      return createServiceCall<number>((settle) => {
        if (options.settle) options.settle(settle, index);
        else settle.success(index * 10, 0);
      }, { label: "stub" });
    },
    channel,
    whenReady: ctx.whenReady,
    onState: applyPatch,
  });
  return { core, stats, state, states, client, channel };
}

/** 统计某条 patch 流里是否出现过某个 key。 */
const sawKey = (states: Array<Partial<ServiceTaskState<number>>>, key: string): boolean =>
  states.some((patch) => Object.prototype.hasOwnProperty.call(patch, key));

describe("createSharedInstanceChannel（#139 的「简单档不带死状态」）", () => {
  it("共享通道不携带 recreate / refuse / 待释放队列相关状态", () => {
    const channel = createSharedInstanceChannel<StubHandle>();
    // 共享通道是一个无状态单例形态：没有这些**状态**字段 ⇒ #139 的验收项在**结构上**成立，
    // 而不是「有字段但没人用」。（`refuseMessage` 是接口要求的只读 getter，恒为 undefined，
    // 不承载状态，因此断言它的值而不是它的存在。）
    const keys = Object.keys(channel);
    expect(keys).not.toContain("pendingReleases");
    expect(keys).not.toContain("instanceStale");
    expect(keys).not.toContain("policy");
    expect(keys).not.toContain("supersede");
    // 行为上也确实永远不 refuse、不 blocked。
    expect(channel.resolveSupersede([])).toBe("cancel");
    expect(channel.isBlocked()).toBe(false);
    expect(channel.refuseMessage).toBeUndefined();
  });

  it("共享通道的键集合恰好是接口的 9 个成员（不多不少 ⇒ 没有任何附加记账）", () => {
    // 上一条 `not.toContain` 挡不住**闭包变量**形式的死状态：`Object.keys` 看不见闭包，
    // 所以「把 pendingReleases 写成闭包变量」这种真实泄漏形态照样能过。改成**白名单**：
    // 共享通道的对象上只允许出现接口声明过的那几个成员，任何附加记账都会翻红。
    // （这仍然只覆盖「属性形态」；闭包形态由下面那条源码断言兜底。）
    const channel = createSharedInstanceChannel<StubHandle>();
    expect(Object.keys(channel).sort()).toEqual(
      [
        "acquire",
        "afterSettle",
        "invalidate",
        "isBlocked",
        "onCancel",
        "refuseMessage",
        "releaseAll",
        "resolveSupersede",
        "superseded",
      ].sort(),
    );
  });

  it("共享通道的闭包里也没有独占档的记账（源码断言：闭包变量只有那一个缓存槽）", () => {
    // `Object.keys` 看不见闭包变量，而独占档的三样状态（pendingReleases / instanceStale /
    // marksStale）在实现里**正是**闭包变量。所以这里直接读函数源码，断言这些名字在
    // `createSharedInstanceChannel` 的函数体内**一次都没出现**。
    //
    // 粗糙但**可判别**：它不是完美证明，可它对「有人把独占档那套状态复制进共享通道」会翻红，
    // 而 `Object.keys` 那条对此完全无感。两道加起来才够支撑 ADR / AGENTS 里
    // 「在**结构上**成立」这句话。
    const source = createSharedInstanceChannel.toString();
    for (const deadState of ["pendingReleases", "instanceStale", "marksStale", "tryRelease"]) {
      expect(source, `共享通道不该出现独占档的 ${deadState}`).not.toContain(deadState);
    }
  });

  it("共享通道按 Client 缓存同一实例；Client 变化即换新", () => {
    const channel = createSharedInstanceChannel<StubHandle>();
    const a = makeClient();
    const b = makeClient();
    let created = 0;
    const create = () => ({ serial: ++created });

    const h1 = channel.acquire(a, create);
    expect(channel.acquire(a, create), "同一 Client 复用").toBe(h1);
    expect(channel.acquire(b, create), "Client 变化 ⇒ 换新实例").not.toBe(h1);
    expect(created).toBe(2);
  });

  it("共享通道 settle / cancel / supersede 都不影响可用性（回包归属不依赖实例身份）", () => {
    const channel = createSharedInstanceChannel<StubHandle>();
    const a = makeClient();
    const h = channel.acquire(a, () => ({ serial: 1 }));
    channel.afterSettle("canceled");
    expect(channel.isBlocked(), "共享通道不因 canceled 变 blocked").toBe(false);
    channel.onCancel(true);
    expect(channel.isBlocked()).toBe(false);
    channel.superseded("recreate");
    expect(channel.acquire(a, () => ({ serial: 2 })), "实例仍可复用").toBe(h);
  });
});

describe("createExclusiveInstanceChannel（实例身份语义）", () => {
  const makeExclusive = (supersede?: "recreate" | (() => "refuse"), releaseFails = 0) => {
    const released: StubHandle[] = [];
    /** 释放时**实际收到**的 Client —— 用来钉住「通道交回当初那个 client」这条不变量。 */
    const releasedWith: BMapClient[] = [];
    let attempts = 0;
    const channel = createExclusiveInstanceChannel<StubHandle, []>({
      label: "test-service",
      // 参数是 `(client, handle)`。早先这里写成 `release: (handle) =>`，于是 `handle`
      // 实际收到的是 **client**，`released` 里攒的也是 client 而非句柄——断言照样绿，
      // 却把整条「释放失败重试」用例建在一个类型错误的桩上。（本文件不在任何 typecheck
      // gate 的范围内：`tsconfig.build.json` 排除 `*.test.ts`，`tsconfig.tests.json` 只含
      // tests/performance 与 tests/browser/live-performance，所以只有单独跑 vue-tsc 才看得见。）
      release: (client, handle) => {
        attempts += 1;
        if (attempts <= releaseFails) throw new Error("release failed");
        releasedWith.push(client);
        released.push(handle);
      },
      ...(supersede ? { supersede } : {}),
    });
    return { channel, released, releasedWith, attempts: () => attempts };
  };

  it("释放用的是实例**当初所属的那个** Client（跨 Client 的句柄会被 Driver 拒绝）", () => {
    const { channel, releasedWith } = makeExclusive();
    const first = makeClient();
    const second = makeClient();

    channel.acquire(first, () => ({ serial: 1 }));
    channel.releaseAll();
    // 在别的 Client 上释放 ⇒ Driver 会拒绝（BMAP_HANDLE_FOREIGN），所以通道必须记住
    // 自己的那个 client 并原样交回，而不是读「当前」的。
    expect(releasedWith).toEqual([first]);
    expect(releasedWith[0], "不能是另一个 Client").not.toBe(second);
  });

  it("独占通道携带 supersede / stale / 待释放状态（与共享档的对照）", () => {
    const { channel } = makeExclusive("recreate");
    expect(Object.keys(channel)).toEqual(
      expect.arrayContaining(["acquire", "isBlocked", "refuseMessage"]),
    );
    // 修一处类型窄化的 TS 报错：显式确认独占档确实会 refuse（由策略决定）。
    const refusing = createExclusiveInstanceChannel<StubHandle, []>({
      label: "test-service",
      release: () => {},
      supersede: () => "refuse",
      refuseMessage: "busy",
    });
    expect(refusing.resolveSupersede([])).toBe("refuse");
    expect(refusing.refuseMessage).toBe("busy");
    expect(channel.resolveSupersede([])).toBe("recreate");
  });

  it("canceled / timeout 之后实例被标记过期（isBlocked），下一次换新", () => {
    const { channel } = makeExclusive("recreate");
    const a = makeClient();
    const h1 = channel.acquire(a, () => ({ serial: 1 }));
    channel.afterSettle("canceled");
    expect(channel.isBlocked(), "canceled ⇒ 实例过期").toBe(true);
    const h2 = channel.acquire(a, () => ({ serial: 2 }));
    expect(h2).not.toBe(h1);
  });

  it("正常结算（success / failed / empty）不把实例标记过期", () => {
    const { channel } = makeExclusive("recreate");
    const a = makeClient();
    channel.acquire(a, () => ({ serial: 1 }));
    channel.afterSettle("success");
    expect(channel.isBlocked(), "回调已到达 ⇒ 仍可用").toBe(false);
    channel.afterSettle("failed");
    expect(channel.isBlocked()).toBe(false);
  });

  it("没有在飞调用时 cancel 不把实例标记过期（no-op 不应变 stale）", () => {
    const { channel } = makeExclusive("recreate");
    channel.acquire(makeClient(), () => ({ serial: 1 }));
    channel.onCancel(false);
    expect(channel.isBlocked()).toBe(false);
    channel.onCancel(true);
    expect(channel.isBlocked()).toBe(true);
  });

  it("释放失败：同一次释放内重试，仍失败则保留引用到下一次释放（PR #89 P2-1 语义不丢）", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // 前 2 次 attempt 失败：第一次释放 → 缓存项失败入队 → 同一次内重试 → 仍失败 ⇒ 留队
    const { channel, released, attempts } = makeExclusive(undefined, 2);
    channel.acquire(makeClient(), () => ({ serial: 1 }));

    channel.releaseAll();
    // 释放是「缓存项 + 待释放队列」在同一次里各试一遍：attempt 1（缓存项，失败入队）、
    // attempt 2（队列里的它，再失败）⇒ 引用保留，尚未销账。
    expect(attempts()).toBe(2);
    expect(released).toHaveLength(0);

    // 下一次释放（这里用 acquire 触发换 Client 时的 releaseCached）⇒ attempt 3 成功
    channel.acquire(makeClient(), () => ({ serial: 2 }));
    expect(released.length, "重试成功即销账").toBe(1);
    warn.mockRestore();
  });

  it("释放失败会告警（不静默泄漏）", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { channel } = makeExclusive(undefined, 5);
    channel.acquire(makeClient(), () => ({ serial: 1 }));
    channel.releaseAll();
    expect(warn, "释放失败必须留下可观察信号").toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createServiceTaskCore（框架无关的共有语义）", () => {
  it("能力不支持 ⇒ unsupported，且不创建实例、不发起调用", async () => {
    const { core, stats, state } = makeHarness({ supports: false });
    const result = await core.execute("addr");
    expect(state.status).toBe("unsupported");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    expect(stats.created).toBe(0);
    expect(stats.invokes, "能力门不发请求").toBe(0);
  });

  it("实例按 Client 缓存：重复调用只创建一次", async () => {
    const { core, stats } = makeHarness();
    await core.execute("a");
    await core.execute("b");
    expect(stats.created, "同一 Client 只创建一个实例").toBe(1);
    expect(stats.invokes).toBe(2);
  });

  it("whenReady 失败 ⇒ failed 载荷（不抛错）", async () => {
    const { core, state } = makeHarness({ loadFails: true });
    const result = await core.execute("a");
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: "BMAP_SDK_LOAD_FAILED", message: "SDK 加载失败" });
    expect(state.isLoading).toBe(false);
  });

  it("create 抛错 ⇒ failed，不冒泡", async () => {
    const { core, stats } = makeHarness({ createThrows: true });
    const result = await core.execute("a");
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("create 失败");
    expect(stats.invokes).toBe(0);
  });

  it("cancel 只把状态退回 idle；迟到回包不回写", async () => {
    const pending: Array<(v: number) => void> = [];
    const { core, state } = makeHarness({
      settle: (settle) => {
        pending.push((v) => settle.success(v));
      },
    });
    const running = core.execute("a");
    await Promise.resolve();
    await Promise.resolve();
    expect(state.status).toBe("loading");

    core.cancel();
    expect(state.status).toBe("idle");
    expect((await running).status).toBe("canceled");

    pending[0]?.(42);
    await Promise.resolve();
    expect(state.data, "取消之后的迟到回包不回写").toBeNull();
  });

  it("dispose 之后**再发起**调用不回写任何状态（execute 是可能被保留的句柄）", async () => {
    // 「冻结回写」不只针对**在飞**的那次回包：组件卸载后仍可能有人拿着 execute 句柄再调一次
    // （watcher 回调 / setTimeout / `await search()` 的续体）。那次调用连 `loading` 都不许写。
    const { core, state } = makeHarness();
    core.dispose();

    const result = await core.execute("after-unmount");
    expect(result.status, "卸载后的调用结算为 canceled").toBe("canceled");
    // 一次 execute 都没发生过：既没建实例也没发起调用。
    expect(state.status, "状态未被写到 loading").not.toBe("loading");
    expect(state.isLoading).toBe(false);
  });

  it("dispose 之后回包不回写、且释放实例（状态冻结）", async () => {
    const pending: Array<(v: number) => void> = [];
    const channel = createSharedInstanceChannel<StubHandle>();
    const release = vi.fn();
    const { core, state } = makeHarness({
      settle: (settle) => {
        pending.push((v) => settle.success(v));
      },
      // 用一个带释放计数的共享通道，验证 dispose 会 releaseAll
      channel: Object.assign(createSharedInstanceChannel<StubHandle>(), {
        releaseAll: release,
      }) as ServiceInstanceChannel<StubHandle>,
    });
    const running = core.execute("a");
    await Promise.resolve();
    await Promise.resolve();

    core.dispose();
    pending[0]?.(99);
    await Promise.resolve();

    expect(state.data).toBeNull();
    expect((await running).status).toBe("canceled");
    expect(release, "dispose 释放通道持有的实例").toHaveBeenCalled();
  });
});
