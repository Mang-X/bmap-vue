import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, provide } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { mapContextKey, type MapContext } from "../core/context/types";
import { useBMapGeocodeDetail } from "./useBMapGeocodeDetail";

function stubContext(opts: {
  getLocation: (point: unknown, cb: (r: unknown) => void) => void;
  toRawPoint: (p: { lng: number; lat: number }) => unknown;
  rawSdk?: unknown;
}): MapContext {
  const sentinelClient = {
    rawSdk: opts.rawSdk ?? {},
    driver: {
      geometry: { toRawPoint: opts.toRawPoint },
      services: {
        createGeocoder: () => ({ raw: { getLocation: opts.getLocation } }),
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
    overlays: null,
    plugins: null,
    whenReady: async () => ({
      client: sentinelClient as never,
      map: {} as never,
    }),
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
  it("passes a driver-converted raw Point to getLocation (not the plain object)", async () => {
    const sentinel = { __sdkPoint: true };
    const seen: unknown[] = [];
    const ctx = stubContext({
      toRawPoint: (p) => {
        expect(p).toEqual({ lng: 116.4, lat: 39.9 });
        return sentinel;
      },
      getLocation: (point, cb) => {
        seen.push(point);
        cb({
          point: { lng: 116.4, lat: 39.9 },
          address: "某地址",
          addressComponents: {
            city: "北京市",
            district: "海淀区",
            province: "北京市",
            street: "上地10街",
            streetNumber: "1号",
          },
          surroundingPois: [],
          business: "上地",
        });
      },
    });
    let result: unknown = "unset";
    const wrapper = mountWithHook(ctx, async (hook) => {
      result = await hook.get({ lng: 116.4, lat: 39.9 });
    });
    await flushPromises();
    // 真机 SDK 会对裸对象直接回 null,必须传 Driver 转换后的 Point
    expect(seen).toEqual([sentinel]);
    expect(result).toMatchObject({ address: "某地址", business: "上地" });
    wrapper.unmount();
  });

  it("maps null result to null data (isEmpty)", async () => {
    const ctx = stubContext({
      toRawPoint: (p) => p,
      getLocation: (_point, cb) => cb(null),
    });
    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      await hook.get({ lng: 0, lat: 0 });
    });
    await flushPromises();
    expect(hookRef!.isEmpty.value).toBe(true);
    wrapper.unmount();
  });

  it("rejects invalid point input", async () => {
    const ctx = stubContext({
      toRawPoint: (p) => p,
      getLocation: (_p, cb) => cb(null),
    });
    // execute 按设计把 runner 错误收敛到 error ref 并返回 null,不抛错
    let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      hookRef = hook;
      await hook.get({ lng: "x", lat: 1 } as unknown as { lng: number; lat: number });
    });
    await flushPromises();
    expect(hookRef!.status.value).toBe("error");
    expect(hookRef!.error.value).toMatchObject({ code: "BMAP_INVALID_POINT" });
    wrapper.unmount();
  });

  it("getBatch keeps per-item results", async () => {
    const ctx = stubContext({
      toRawPoint: (p) => p,
      getLocation: (_p, cb) =>
        cb({ point: { lng: 1, lat: 2 }, address: "A", business: "B" }),
    });
    let batch: unknown = null;
    const wrapper = mountWithHook(ctx, async (hook) => {
      batch = await hook.getBatch([
        { lng: 1, lat: 2 },
        { lng: 3, lat: 4 },
      ]);
    });
    await flushPromises();
    expect(batch).toHaveLength(2);
    expect((batch as Array<{ detail: { address: string } }>)[0].detail.address).toBe("A");
    wrapper.unmount();
  });

  it("不触碰 SDK 的 `_rd` 私有回调表（R25-C / #72：不嗅探、不包装）", async () => {
    // 真实 SDK 在调用内同步注册 JSONP 回调，服务端错误码只写在私有表里。
    // 反向守卫：本库既不许**读**它，更不许把里面的函数换成包装器——换掉就是 monkey-patch。
    const rd: Record<string, unknown> = {};
    const original = () => "ok";
    let seen: unknown = "unset";
    const ctx = stubContext({
      rawSdk: { _rd: rd },
      toRawPoint: (p) => p,
      getLocation: (_point, cb) => {
        rd._cbk9 = original;
        seen = rd._cbk9;
        cb({ point: { lng: 1, lat: 2 }, address: "A", business: "B" });
      },
    });
    const wrapper = mountWithHook(ctx, async (hook) => {
      await hook.get({ lng: 1, lat: 2 });
    });
    await flushPromises();

    expect(seen, "前置守卫：桩确实把回调放进了 `_rd`（否则这条断言是空转）").toBe(original);
    expect(rd._cbk9, "本库不得包装/替换 SDK 私有回调表里的函数").toBe(original);
    wrapper.unmount();
  });

  it("surfaces service timeout as error instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const ctx = stubContext({
        toRawPoint: (p) => p,
        // 永不回掉,模拟网络被墙
        getLocation: () => {},
      });
      let hookRef: ReturnType<typeof useBMapGeocodeDetail> | null = null;
      const wrapper = mountWithHook(ctx, (hook) => {
        hookRef = hook;
        void hook.get({ lng: 1, lat: 2 }).catch(() => {});
      });
      await flushPromises();
      expect(hookRef!.isLoading.value).toBe(true);
      await vi.advanceTimersByTimeAsync(16000);
      await flushPromises();
      expect(hookRef!.status.value).toBe("error");
      expect(hookRef!.error.value).toMatchObject({ code: "BMAP_SERVICE_FAILED" });
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
