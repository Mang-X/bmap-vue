/**
 * serviceTask —— 服务类 composable 的两档任务（M7-SERVICE-CORE / #38，#139 分层）
 *
 * 两档的契约都要**直接**被钉住（而不是只靠上层用例间接覆盖）：
 *
 * - **共有**（本文件上半）：能力门（不发请求）、实例按 Client 缓存、投影只作用于 data、
 *   `whenReady` 失败归一、scope dispose 后状态冻结、取消之后迟到回包不回写；
 * - **简单档特有**：`useSimpleServiceTask` **不接受** `release` / `supersede` / `refuseMessage`，
 *   也**不暴露** `invalidateService`——官方没有为那 7 个服务提供实例销毁入口，携带这些状态
 *   就是无消费者的死状态（#139 的验收项）。**类型面**由 `tests/type-contracts/` 的独立门禁守
 *   （本文件不在任何 typecheck 范围内，`@ts-expect-error` 在这里没有判别力），这里只守运行期；
 * - **独占档特有**（下半）：释放失败重试 / `recreate` / `refuse` / 「等 `whenReady` 期间也算忙」。
 *
 * 用例里的「网络语义」用**真实的** `createServiceCall` 适配器，而不是手搭 Promise——
 * 这样断言的是真会跑的那份超时 / 先到者胜实现。
 */
import { describe, it, expect } from "vitest";
import { defineComponent, h, provide } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { mapContextKey, type MapContext } from "../core/context/types";
import { createServiceCall } from "../driver/normalize/serviceCall";
import { BMapError } from "../core/errors/BMapError";
import type { ServiceCallSettle } from "../driver/types/services";
import { useSimpleServiceTask, useExclusiveServiceTask } from "./serviceTask";
import type { SimpleServiceTask, ExclusiveServiceTask } from "./serviceTask";

interface StubHandle {
  readonly serial: number;
}

interface StubService {
  /** `deferredReady` 时用来放行 `whenReady()` */
  releaseReady: () => void;
  readonly stats: {
    created: number;
    released: number;
    invokes: number;
    /** `release` 被调用的次数（含失败的尝试） */
    releaseAttempts: number;
  };
  readonly client: unknown;
  readonly ctx: MapContext;
}

interface StubServiceOptions {
  supports?: boolean;
  /** 不提供时默认 `success(invokes * 10, 0)` */
  settle?: (settle: ServiceCallSettle<number>, invokeIndex: number) => void;
  /** 覆盖 `create`（用来注入抛错路径） */
  createHandle?: () => StubHandle;
  /** `whenReady` 是否失败 */
  loadFails?: boolean;
  /** 前 N 次 `release` 抛错（验证「释放失败保留引用并重试」） */
  releaseFails?: number;
  /** `whenReady()` 挂起，直到调用 `service.releaseReady()`（验证「已开始但未拿到 ServiceCall」的窗口） */
  deferredReady?: boolean;
  /** 取代策略（只在独占档给） */
  supersede?: "cancel" | "recreate" | (() => "cancel" | "recreate" | "refuse");
}

function makeService(options: StubServiceOptions = {}): StubService {
  const stats = { created: 0, released: 0, invokes: 0, releaseAttempts: 0 };
  const client = {
    engine: "jsapi-v4",
    rawSdk: {},
    capabilities: { supports: () => options.supports ?? true },
    driver: { services: {} },
  };
  let releaseReadyFn: () => void = () => {};
  const readyGate = new Promise<void>((resolve) => {
    releaseReadyFn = resolve;
  });
  const ctx = {
    id: Symbol("stub"),
    status: { value: "ready" },
    client: { value: client },
    map: { value: {} },
    error: { value: null },
    resources: {},
    events: {},
    scheduler: {},
    overlays: null,
    plugins: null,
    whenReady: options.loadFails
      ? () => Promise.reject(new BMapError("BMAP_SDK_LOAD_FAILED", "SDK 加载失败"))
      : async () => {
          if (options.deferredReady) await readyGate;
          return { client, map: {} };
        },
    dispose: () => {},
  } as unknown as MapContext;

  const service: StubService = { stats, client, ctx, releaseReady: () => releaseReadyFn() };
  return service;
}

/** 建一次任务的公共部分（供各用例拼不同的 options）。 */
function taskOptions(service: StubService, options: StubServiceOptions = {}) {
  const stats = service.stats;
  return {
    capability: "service.geocoder" as const,
    create:
      options.createHandle ??
      (() => {
        stats.created += 1;
        return { serial: stats.created } satisfies StubHandle;
      }),
    invoke: () => {
      stats.invokes += 1;
      const index = stats.invokes;
      return createServiceCall<number>((settle) => {
        if (options.settle) options.settle(settle, index);
        else settle.success(index * 10, 0);
      }, { label: "stub" });
    },
  };
}

/** 独占档才有的 `release`：记录尝试次数，前 N 次抛错。 */
function releaseOption(service: StubService, options: StubServiceOptions) {
  return () => {
    service.stats.releaseAttempts += 1;
    if (service.stats.releaseAttempts <= (options.releaseFails ?? 0)) {
      throw new Error(`release failed (attempt ${service.stats.releaseAttempts})`);
    }
    service.stats.released += 1;
  };
}

/** 在有 effect scope 的组件里建**简单档**任务（`onScopeDispose` 需要作用域）。 */
function mountTask<TResult = number>(
  service: StubService,
  options: StubServiceOptions = {},
  project?: (value: number) => TResult,
): { wrapper: VueWrapper; task: SimpleServiceTask<TResult, []> } {
  let exposed: SimpleServiceTask<TResult, []> | null = null;
  const Child = defineComponent({
    setup() {
      exposed = useSimpleServiceTask<number, StubHandle, [], TResult>(service.ctx, {
        ...taskOptions(service, options),
        ...(project ? { project } : {}),
      });
      return () => h("div");
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(mapContextKey, service.ctx);
        return () => h(Child);
      },
    }),
  );
  if (!exposed) throw new Error("任务未建立");
  return { wrapper, task: exposed };
}

/** 在有 effect scope 的组件里建**独占档**任务。 */
function mountExclusiveTask<TResult = number>(
  service: StubService,
  options: StubServiceOptions = {},
): { wrapper: VueWrapper; task: ExclusiveServiceTask<TResult, []> } {
  let exposed: ExclusiveServiceTask<TResult, []> | null = null;
  const Child = defineComponent({
    setup() {
      exposed = useExclusiveServiceTask<number, StubHandle, [], TResult>(service.ctx, {
        ...taskOptions(service, options),
        release: releaseOption(service, options),
        ...(options.supersede ? { supersede: options.supersede } : {}),
      });
      return () => h("div");
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(mapContextKey, service.ctx);
        return () => h(Child);
      },
    }),
  );
  if (!exposed) throw new Error("任务未建立");
  return { wrapper, task: exposed };
}

describe("useSimpleServiceTask（简单档：官方没有实例释放入口的那 7 个服务）", () => {
  it("实例按 Client 缓存：重复调用只创建一次", async () => {
    const service = makeService();
    const { wrapper, task } = mountTask(service);
    await flushPromises();

    await task.execute();
    await task.execute();
    expect(service.stats.created, "同一 Client 只创建一个实例").toBe(1);
    expect(service.stats.invokes).toBe(2);

    wrapper.unmount();
  });

  it("不暴露 invalidateService：官方没有销毁入口，没有「丢弃实例」这个动作", async () => {
    const service = makeService();
    const { wrapper, task } = mountTask(service);
    await flushPromises();

    // #139 的验收项落在**公开面**上：简单任务没有这个成员，调用方想传也传不进来。
    expect(Object.keys(task)).not.toContain("invalidateService");
    // @ts-expect-error 简单档刻意不接受 `release`（官方无销毁入口）
    void useSimpleServiceTask(service.ctx, { ...taskOptions(service), release: () => {} });

    wrapper.unmount();
  });

  it("卸载时不调用任何释放入口（简单档没有 release 回调可调）", async () => {
    const service = makeService();
    const { wrapper, task } = mountTask(service);
    await flushPromises();

    await task.execute();
    expect(service.stats.created).toBe(1);
    wrapper.unmount();
    await flushPromises();
    expect(
      service.stats.releaseAttempts,
      "官方没有释放入口 ⇒ 释放队列/重试机制在简单档是死状态",
    ).toBe(0);
  });

  it("能力不支持 ⇒ unsupported，且不创建实例、不发起调用", async () => {
    const service = makeService({ supports: false });
    const { wrapper, task } = mountTask(service, { supports: false });
    await flushPromises();

    const result = await task.execute();
    expect(task.status.value).toBe("unsupported");
    expect(task.supported.value).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    expect(service.stats.created).toBe(0);
    expect(service.stats.invokes).toBe(0);

    wrapper.unmount();
  });

  it("project 只作用于 data；status / sdkStatus 是引擎结论，原样透传", async () => {
    const service = makeService({ settle: (settle) => settle.success(5, 7) });
    const { wrapper, task } = mountTask(
      service,
      { settle: (settle) => settle.success(5, 7) },
      (value) => ({ doubled: value * 2 }),
    );
    await flushPromises();

    const result = await task.execute();
    expect(result.data).toEqual({ doubled: 10 });
    expect(task.data.value).toEqual({ doubled: 10 });
    expect(result.sdkStatus).toBe(7);
    expect(task.sdkStatus.value).toBe(7);

    wrapper.unmount();
  });

  it("whenReady 失败 ⇒ failed 载荷（归一成 ServiceErrorInfo，不抛错）", async () => {
    const service = makeService({ loadFails: true });
    const { wrapper, task } = mountTask(service, { loadFails: true });
    await flushPromises();

    const result = await task.execute();
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: "BMAP_SDK_LOAD_FAILED", message: "SDK 加载失败" });
    expect(task.status.value).toBe("failed");
    expect(task.isLoading.value).toBe(false);

    wrapper.unmount();
  });

  it("create 抛错（如检索区域非法）⇒ failed，不冒泡到调用方", async () => {
    const service = makeService();
    const { wrapper, task } = mountTask(service, {
      createHandle: () => {
        throw new BMapError("BMAP_INVALID_ARGUMENT", "create 失败");
      },
    });
    await flushPromises();

    const result = await task.execute();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("create 失败");
    expect(service.stats.invokes).toBe(0);

    wrapper.unmount();
  });

  it("cancel 只把状态退回 idle；迟到回包不回写；reset 清空状态但保留实例", async () => {
    const pending: Array<(value: number) => void> = [];
    const settleHook = (settle: ServiceCallSettle<number>): void => {
      pending.push((value) => settle.success(value));
    };
    const service = makeService({ settle: (settle) => settleHook(settle) });
    const { wrapper, task } = mountTask(service, { settle: (settle) => settleHook(settle) });
    await flushPromises();

    const running = task.execute();
    await flushPromises();
    expect(task.status.value).toBe("loading");

    task.cancel();
    expect(task.status.value).toBe("idle");
    expect((await running).status).toBe("canceled");

    pending[0]?.(42);
    await flushPromises();
    expect(task.data.value, "取消之后的迟到回包不回写").toBeNull();

    task.reset();
    expect(task.status.value).toBe("idle");
    expect(task.data.value).toBeNull();
    expect(service.stats.created, "reset 不释放实例").toBe(1);

    wrapper.unmount();
  });

  it("卸载后回包不回写（scope dispose 之后状态冻结）", async () => {
    const pending: Array<(value: number) => void> = [];
    const settleHook = (settle: ServiceCallSettle<number>): void => {
      pending.push((value) => settle.success(value));
    };
    const service = makeService({ settle: (settle) => settleHook(settle) });
    const { wrapper, task } = mountTask(service, { settle: (settle) => settleHook(settle) });
    await flushPromises();

    const running = task.execute();
    await flushPromises();
    expect(task.status.value).toBe("loading");

    wrapper.unmount();
    pending[0]?.(99);
    await flushPromises();

    expect(task.data.value).toBeNull();
    expect(task.status.value).toBe("loading");
    expect((await running).status).toBe("canceled");
  });
});

describe("useExclusiveServiceTask：实例缓存、释放失败与取代策略（PR #89 评审 P2）", () => {
  it("invalidateService 丢弃实例（释放旧实例），下一次调用重建", async () => {
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service);
    await flushPromises();

    await task.execute();
    expect(service.stats.created).toBe(1);
    task.invalidateService();
    expect(service.stats.released, "丢弃实例时先释放它").toBe(1);
    await task.execute();
    expect(service.stats.created).toBe(2);

    wrapper.unmount();
    await flushPromises();
    expect(service.stats.released, "scope dispose 时释放缓存实例").toBe(2);
  });

  it("释放失败不丢引用：同一次释放内重试，成功后销账（不静默泄漏）", async () => {
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service, { releaseFails: 1 });
    await flushPromises();

    await task.execute();
    task.invalidateService();

    expect(service.stats.releaseAttempts, "失败后立刻重试一次").toBe(2);
    expect(service.stats.released, "重试成功即销账").toBe(1);
    wrapper.unmount();
  });

  it("释放持续失败：引用保留到下一次释放（scope 卸载时再试），不抛错", async () => {
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service, { releaseFails: 2 });
    await flushPromises();

    await task.execute();
    task.invalidateService(); // 两次尝试都失败 ⇒ 留在待释放队列里
    expect(service.stats.released).toBe(0);

    await task.execute(); // 新建实例（失败项继续留在队列）
    expect(service.stats.created).toBe(2);

    wrapper.unmount(); // scope 卸载时再试：这次成功
    await flushPromises();
    expect(service.stats.released, "最终释放成功，且没有把错误抛到卸载路径").toBe(2);
  });

  it('supersede="recreate"：取代在飞调用时释放旧实例并新建（旧结果不会污染新结果）', async () => {
    const pending: Array<(value: number) => void> = [];
    const settleHook = (settle: ServiceCallSettle<number>, index: number): void => {
      pending.push((value) => settle.success(value, index));
    };
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service, {
      settle: settleHook,
      supersede: "recreate",
    });
    await flushPromises();

    const first = task.execute();
    await flushPromises();
    expect(service.stats.created).toBe(1);

    const second = task.execute();
    await flushPromises();
    expect(service.stats.created, "取代 ⇒ 新建实例").toBe(2);
    expect(service.stats.released, "旧实例被释放").toBe(1);

    pending[0]?.(1);
    pending[1]?.(2);
    expect((await first).status).toBe("canceled");
    const settled = await second;
    expect(settled.status).toBe("success");
    expect(settled.data, "新调用拿到的是自己的结果（不是被取代那次的数据）").toBe(2);
    expect(service.stats.created, "同一次取代只新建一个实例").toBe(2);

    wrapper.unmount();
  });

  it('supersede="recreate"：cancel 之后实例被标记过期，下一次调用重建', async () => {
    const pending: Array<(value: number) => void> = [];
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service, {
      settle: (settle) => {
        pending.push((value) => settle.success(value, 0));
      },
      supersede: "recreate",
    });
    await flushPromises();

    const inflight = task.execute();
    await flushPromises();
    task.cancel();
    expect((await inflight).status).toBe("canceled");
    expect(service.stats.created).toBe(1);

    const retried = task.execute();
    await flushPromises();
    expect(service.stats.created, "cancel 之后的下一次调用重建实例").toBe(2);
    expect(service.stats.released).toBe(1);

    // 旧实例的迟到回包 / 新实例自己的回包各归其位
    pending[0]?.(1);
    pending[1]?.(2);
    expect((await retried).status).toBe("success");
    expect(task.data.value).toBe(2);

    wrapper.unmount();
  });

  it('supersede 返回 "refuse"：本次调用直接 failed，不发起请求、也不作废在飞调用', async () => {
    const pending: Array<(value: number) => void> = [];
    const service = makeService();
    const { wrapper, task } = mountExclusiveTask(service, {
      settle: (settle) => {
        pending.push((value) => settle.success(value, 0));
      },
      supersede: () => "refuse",
    });
    await flushPromises();

    const inflight = task.execute();
    await flushPromises();
    // 空闲时也照常拒绝（策略说「这次调用不能被接受」）——但**不得**影响在飞调用
    const refused = await task.execute();
    expect(refused.status).toBe("failed");
    expect(refused.error?.code).toBe("BMAP_SERVICE_FAILED");

    pending[0]?.(7);
    const settled = await inflight;
    expect(settled.status, "在飞调用不受拒绝影响").toBe("success");
    expect(settled.data).toBe(7);

    wrapper.unmount();
  });
});

describe("useExclusiveServiceTask：取代判定必须覆盖「还没拿到 ServiceCall」的窗口（PR #89 复审 P1）", () => {
  it('supersede="refuse"：等 whenReady 期间的调用也要算「忙」，不得作废它', async () => {
    const service = makeService({ deferredReady: true });
    const { wrapper, task } = mountExclusiveTask(service, {
      deferredReady: true,
      supersede: () => "refuse",
    });
    await flushPromises();

    // 第一次调用已经进入 loading，但还在 await whenReady()（此时还没有 ServiceCall）
    const first = task.execute();
    await flushPromises();
    expect(task.status.value).toBe("loading");
    expect(service.stats.invokes, "还没拿到实例 ⇒ 还没发起").toBe(0);

    // 第二次调用：必须被拒绝（契约：上一次还没结算时不能取代它）
    const second = task.execute();
    await flushPromises();

    // 放行 whenReady：第一条照常发起并结算
    service.releaseReady();
    await flushPromises();
    const [firstResult, secondResult] = [await first, await second];

    expect(firstResult.status, "第一条不得被这条调用作废").toBe("success");
    expect(secondResult.status).toBe("failed");
    expect(secondResult.error?.code).toBe("BMAP_SERVICE_FAILED");
    expect(service.stats.invokes, "被拒绝的调用不得落到 SDK").toBe(1);

    wrapper.unmount();
  });
});
