/**
 * useBMapGeocodeDetail（M7-SERVICE-CORE / #38）
 *
 * 这一层验证 composable 的**状态机**：它只调用 Driver 的归一化调用面
 * （`services.reverseGeocode` → `ServiceCall<ServiceResult>`），因此用例里给的是**真实的**
 * `createServiceCall` 适配器 + 受控回包，而不是手搭 Promise——这样「超时 / 迟到回包 /
 * 取消」三条语义测的是真正会跑的那份实现。
 *
 * Driver 自己的投影（`addressComponents` / `surroundingPois`）在
 * `src/driver/jsapi-v4/services.test.ts` 里断言；这里断言的是「composable 把结果原样交给调用方，
 * 且过期结果绝不回写」。
 */
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, provide } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { mapContextKey, type MapContext } from "../core/context/types";
import { createServiceCall } from "../driver/normalize/serviceCall";
import type {
  GeocodedAddress,
  ServiceCall,
  ServiceCallSettle,
} from "../driver/types/services";
import { useBMapGeocodeDetail } from "./useBMapGeocodeDetail";

type ReverseStarter = (
  settle: ServiceCallSettle<GeocodedAddress>,
  request: { point: { lng: number; lat: number } },
) => void;

function stubContext(opts: {
  reverse?: ReverseStarter;
  supports?: boolean;
  whenReady?: () => Promise<{ client: unknown; map: unknown }>;
}): MapContext {
  const reverse =
    opts.reverse ??
    ((settle) =>
      settle.success({
        address: "某地址",
        point: { lng: 116.4, lat: 39.9 },
        business: "上地",
        addressComponents: {
          city: "北京市",
          district: "海淀区",
          province: "北京市",
          street: "上地10街",
          streetNumber: "1号",
        },
        surroundingPois: [],
        poiCount: 0,
      }));

  const sentinelClient = {
    engine: "jsapi-v4",
    rawSdk: {},
    capabilities: { supports: () => opts.supports ?? true },
    driver: {
      geometry: { toRawPoint: (p: unknown) => p },
      services: {
        // `jsapiV4ServicesOf` 按运行时成员判断「有没有归一化调用面」
        geocode: () =>
          createServiceCall<{ lng: number; lat: number }>((settle) => settle.empty(), {
            label: "stub.geocode",
          }),
        createGeocoder: () => ({ __handle: "geocoder" }),
        reverseGeocode: (
          _handle: unknown,
          request: { point: { lng: number; lat: number } },
        ): ServiceCall<GeocodedAddress> =>
          createServiceCall<GeocodedAddress>((settle) => reverse(settle, request), {
            label: "stub.reverseGeocode",
          }),
      },
    },
  };

  return {
    id: Symbol("stub"),
    status: { value: "ready" } as never,
    client: { value: sentinelClient } as never,
    map: { value: {} } as never,
    error: { value: null } as never,
    resources: {} as never,
    events: {} as never,
    scheduler: {} as never,
    // `MapContext.overlays` 是 `OverlayRegistry`（M5-SPEC-MARKER / #30 起不再是 `unknown`）；
    // 本文件的 Context 全部是 `as never` 桩，这里保持一致（真实的 Runtime 永远给一个注册表）
    overlays: {} as never,
    plugins: null,
    whenReady:
      (opts.whenReady as MapContext["whenReady"]) ??
      (async () => ({ client: sentinelClient as never, map: {} as never })),
    dispose: () => {},
  };
}

function mountWithHook(
  ctx: MapContext,
  run: (hook: ReturnType<typeof useBMapGeocodeDetail>) => void | Promise<void>,
) {
  const Child = defineComponent({
    setup() {
      const hook = useBMapGeocodeDetail();
      void Promise.resolve(run(hook));
      return () => h("div");
    },
  });
  return mount(
    defineComponent({
      setup() {
        provide(mapContextKey, ctx);
        return () => h(Child);
      },
    }),
  );
}

describe("useBMapGeocodeDetail", () => {
  it("把领域 Point 交给 Driver 的归一化调用面（raw 转换属于 Driver）", async () => {
    const seen: unknown[] = [];
    const ctx = stubContext({
      reverse: (settle, request) => {
        seen.push(request.point);
        settle.success({
          address: "某地址",
          point: { lng: 1, lat: 2 },
          business: "上地",
          addressComponents: {
            city: "",
            district: "",
            province: "",
            street: "",
            streetNumber: "",
          },
          surroundingPois: [],
          poiCount: 0,
        });
      },
    });
    let result: { data: { address: string; business: string } | null } | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      result = await hook.get({ lng: 116.4, lat: 39.9 });
    });
    await flushPromises();

    expect(seen).toEqual([{ lng: 116.4, lat: 39.9 }]);
    expect(result!.data).toMatchObject({ address: "某地址", business: "上地" });
    wrapper.unmount();
  });

  it("回包为 null ⇒ empty：data 为 null、isEmpty 为 true、error 也是 null（没有公开原因）", async () => {
    const ctx = stubContext({ reverse: (settle) => settle.empty() });
    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      await hook.get({ lng: 0, lat: 0 });
    });
    await flushPromises();

    expect(hookRef!.status.value).toBe("empty");
    expect(hookRef!.data.value).toBeNull();
    expect(hookRef!.isEmpty.value).toBe(true);
    expect(hookRef!.error.value).toBeNull();
    wrapper.unmount();
  });

  it("点非法 ⇒ failed(BMAP_INVALID_ARGUMENT)，不抛错（走结果通道）", async () => {
    const ctx = stubContext({
      reverse: (settle) =>
        settle.failed({ code: "BMAP_INVALID_ARGUMENT", message: "point 必须是 { lng, lat }" }),
    });
    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      await hook.get({ lng: Number.NaN, lat: 1 });
    });
    await flushPromises();

    expect(hookRef!.status.value).toBe("failed");
    expect(hookRef!.error.value).toMatchObject({ code: "BMAP_INVALID_ARGUMENT" });
    wrapper.unmount();
  });

  it("超时 ⇒ timeout（不是 error），并带上适配器的 BMAP_SERVICE_FAILED", async () => {
    vi.useFakeTimers();
    try {
      const ctx = stubContext({ reverse: () => {} });
      let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
      const wrapper = mountWithHook(ctx, (hook) => {
        hookRef = hook;
        void hook.get({ lng: 1, lat: 2 }).catch(() => {});
      });
      await flushPromises();
      expect(hookRef!.isLoading.value).toBe(true);

      await vi.advanceTimersByTimeAsync(16000);
      await flushPromises();

      expect(hookRef!.status.value).toBe("timeout");
      expect(hookRef!.isLoading.value).toBe(false);
      expect(hookRef!.error.value).toMatchObject({ code: "BMAP_SERVICE_FAILED" });
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("getBatch keeps per-item results（部分成功：每项带自己的终态）", async () => {
    let call = 0;
    const ctx = stubContext({
      reverse: (settle) => {
        call += 1;
        if (call === 2) {
          settle.failed({ code: 5, message: "非法请求" });
          return;
        }
        settle.success({
          address: "A",
          point: { lng: 1, lat: 2 },
          business: "B",
          addressComponents: {
            city: "",
            district: "",
            province: "",
            street: "",
            streetNumber: "",
          },
          surroundingPois: [],
          poiCount: 0,
        });
      },
    });
    let batch: Awaited<ReturnType<ReturnType<typeof useBMapGeocodeDetail>["getBatch"]>> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      batch = await hook.getBatch([
        { lng: 1, lat: 2 },
        { lng: 3, lat: 4 },
      ]);
    });
    await flushPromises();

    expect(batch).toHaveLength(2);
    expect(batch![0]!.detail?.address).toBe("A");
    expect(batch![0]!.status).toBe("success");
    expect(batch![1]!.detail).toBeNull();
    expect(batch![1]!.status).toBe("failed");
    expect(batch![1]!.error).toMatchObject({ code: 5 });
    wrapper.unmount();
  });

  it("不触碰 SDK 的 `_rd` 私有回调表（R25-C / #72：不嗅探、不包装）", async () => {
    // 真实 SDK 在调用内同步注册 JSONP 回调，服务端错误码只写在私有表里。
    // 反向守卫：本库既不许**读**它，更不许把里面的函数换成包装器——换掉就是 monkey-patch。
    const rd: Record<string, unknown> = {};
    const original = () => "ok";
    let observed: Record<string, unknown> | null = null;
    const ctx = stubContext({
      reverse: (settle) => {
        rd._cbk9 = original;
        observed = { ...rd };
        settle.empty();
      },
    });
    (ctx.client.value as unknown as { rawSdk: unknown }).rawSdk = { _rd: rd };

    const wrapper = mountWithHook(ctx, async (hook) => {
      await hook.get({ lng: 1, lat: 2 });
    });
    await flushPromises();

    expect(rd._cbk9, "本库不得包装/替换 SDK 私有回调表里的函数").toBe(original);
    expect(Object.keys(observed ?? {})).toEqual(["_cbk9"]);
    wrapper.unmount();
  });

  it("旧请求不得覆盖新结果：先发的慢回包被丢弃", async () => {
    const pending: Array<() => void> = [];
    let index = 0;
    const ctx = stubContext({
      reverse: (settle) => {
        index += 1;
        const label = index;
        pending.push(() => {
          settle.success({
            address: `结果-${label}`,
            point: { lng: label, lat: label },
            business: null,
            addressComponents: {
              city: "",
              district: "",
              province: "",
              street: "",
              streetNumber: "",
            },
            surroundingPois: [],
            poiCount: 0,
          });
        });
      },
    });

    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    let firstStatus = "unset";
    let done: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      const first = hook.get({ lng: 1, lat: 1 });
      await flushPromises(); // 第一次真的发起（已登记 pending）
      const second = hook.get({ lng: 2, lat: 2 });
      await flushPromises(); // 第二次真的发起，并逻辑取消第一次

      // 第一次的迟到回包先到：它已被取代，不得覆盖结果
      pending[0]?.();
      pending[1]?.();

      firstStatus = (await first).status;
      await second;
      done();
    });
    await flushPromises();
    await finished;

    expect(firstStatus, "被取代的调用以 canceled 结算").toBe("canceled");
    expect(hookRef!.data.value?.address, "最新一次请求的结果胜出").toBe("结果-2");
    wrapper.unmount();
  });

  it("卸载之后回包不回写（scope dispose 之后状态不再变化）", async () => {
    const pending: Array<() => void> = [];
    const ctx = stubContext({
      reverse: (settle) => {
        pending.push(() =>
          settle.success({
            address: "迟到结果",
            point: { lng: 1, lat: 1 },
            business: null,
            addressComponents: {
              city: "",
              district: "",
              province: "",
              street: "",
              streetNumber: "",
            },
            surroundingPois: [],
            poiCount: 0,
          }),
        );
      },
    });

    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, (hook) => {
      hookRef = hook;
      void hook.get({ lng: 1, lat: 1 }).catch(() => {});
    });
    await flushPromises();
    wrapper.unmount();
    pending[0]?.();
    await flushPromises();

    expect(hookRef!.data.value).toBeNull();
    expect(hookRef!.status.value).toBe("loading");
  });

  it("能力不支持 ⇒ 状态是 unsupported，且**没有发起请求**（与 failed 区分）", async () => {
    let called = 0;
    const ctx = stubContext({
      supports: false,
      reverse: (settle) => {
        called += 1;
        settle.empty();
      },
    });
    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      await hook.get({ lng: 1, lat: 1 });
    });
    await flushPromises();

    expect(hookRef!.status.value).toBe("unsupported");
    expect(hookRef!.supported.value).toBe(false);
    expect(called, "不支持时一次都不该落到 SDK").toBe(0);
    wrapper.unmount();
  });
});
