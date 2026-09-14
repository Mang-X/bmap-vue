/**
 * useBMapServiceTask —— 服务类 composable 的统一状态机（M7-SERVICE-CORE / #38）
 *
 * 六个 service composable 共用这一个原语，因此它的契约要**直接**被钉住（而不是只靠上层用例
 * 间接覆盖）：能力门（不发请求）、实例缓存与重建、投影只作用于 data、`whenReady` 失败归一、
 * scope dispose 时释放实例、取消之后迟到回包不回写。
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
import type { ServiceCall, ServiceCallSettle } from "../driver/types/services";
import { useBMapServiceTask, type BMapServiceTask } from "./useBMapServiceTask";

interface StubHandle {
  readonly serial: number;
}

interface StubService {
  readonly stats: { created: number; released: number; invokes: number };
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
}

function makeService(options: StubServiceOptions = {}): StubService {
  const stats = { created: 0, released: 0, invokes: 0 };
  const client = {
    engine: "jsapi-v4",
    rawSdk: {},
    capabilities: { supports: () => options.supports ?? true },
    driver: { services: {} },
  };
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
      : async () => ({ client, map: {} }),
    dispose: () => {},
  } as unknown as MapContext;

  const service: StubService = { stats, client, ctx };
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
    release: () => {
      stats.released += 1;
    },
  };
}

/**
 * 在**有 effect scope** 的组件里建任务（`onScopeDispose` 需要作用域），并把任务暴露给用例。
 * 返回的 `wrapper.unmount()` 就是「组件卸载」。
 */
function mountTask<TResult = number>(
  service: StubService,
  options: StubServiceOptions = {},
  project?: (value: number) => TResult,
): { wrapper: VueWrapper; task: BMapServiceTask<TResult, [], StubHandle> } {
  let exposed: BMapServiceTask<TResult, [], StubHandle> | null = null;
  const Child = defineComponent({
    setup() {
      exposed = useBMapServiceTask<number, StubHandle, [], TResult>(service.ctx, {
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

describe("useBMapServiceTask", () => {
  it("实例按 Client 缓存：重复调用只创建一次；invalidateService 之后重建", async () => {
    const service = makeService();
    const { wrapper, task } = mountTask(service);
    await flushPromises();

    await task.execute();
    await task.execute();
    expect(service.stats.created, "同一 Client 只创建一个实例").toBe(1);
    expect(service.stats.invokes).toBe(2);

    task.invalidateService();
    expect(service.stats.released, "丢弃实例时先释放它").toBe(1);
    await task.execute();
    expect(service.stats.created).toBe(2);

    wrapper.unmount();
    await flushPromises();
    expect(service.stats.released, "scope dispose 时释放缓存实例").toBe(2);
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
    expect(service.stats.released, "卸载时释放实例").toBe(1);
  });
});
