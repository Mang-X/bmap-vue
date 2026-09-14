import { describe, it, expect } from "vitest";
import { defineComponent, h, nextTick, provide, shallowRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createClientContext, bmapClientContextKey } from "./client";
import { createLoadedJsapiV4 } from "../loader/providers";
import { useResolvedTarget, targetContextKey, type TargetContext } from "./target";
import { mapContextKey, type MapContext } from "./types";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { createMapEventBus } from "../events/MapEventBus";
import { createFrameScheduler } from "../scheduler/FrameScheduler";
import { createOverlayRegistry } from "../overlays/OverlayRegistry";
import { createPluginRegistry } from "../plugins/PluginRegistry";
import { createHandle } from "../../driver/types/handles";

function fakeMapContext(mapHandle: unknown): MapContext {
  const resources = new ResourceScope();
  const status = shallowRef("ready") as unknown as MapContext["status"];
  const client = shallowRef({ driver: { overlays: { add: () => {}, remove: () => {} } } }) as unknown as MapContext["client"];
  const map = shallowRef(mapHandle) as unknown as MapContext["map"];
  return {
    id: Symbol("t"),
    status,
    client,
    map,
    error: shallowRef(null) as unknown as MapContext["error"],
    resources,
    events: createMapEventBus(),
    scheduler: createFrameScheduler(),
    overlays: createOverlayRegistry(),
    plugins: createPluginRegistry(
      () => ({ client: null, map: null, api: null }),
      { emit: () => {} },
      resources,
    ),
    whenReady: async () => ({ client: client.value as never, map: map.value as never }),
    dispose: () => resources.dispose(),
  };
}

describe("TargetContext", () => {
  it("defaults to the map target", async () => {
    const mapHandle = createHandle("map", { id: 1 });
    const mapCtx = fakeMapContext(mapHandle);
    let seen: TargetContext | null = null;
    const Child = defineComponent({
      setup() {
        const target = useResolvedTarget(mapCtx);
        seen = target.value;
        return () => h("div");
      },
    });
    const wrapper = mount(defineComponent({
      setup: () => () => h(Child),
    }));
    await flushPromises();
    expect(seen).toBeTruthy();
    expect((seen as unknown as TargetContext).kind.value).toBe("map");
    expect((seen as unknown as TargetContext).target.value).toBe(mapHandle);
    wrapper.unmount();
    mapCtx.dispose();
  });

  it("prefers the nearest injected target (marker late-ready)", async () => {
    const mapHandle = createHandle("map", { id: "map" });
    const mapCtx = fakeMapContext(mapHandle);
    const markerRef = shallowRef<unknown>(null);
    const markerTarget: TargetContext = {
      kind: shallowRef("marker") as never,
      target: markerRef as never,
      add: () => {},
      remove: () => {},
    };
    let seenKind: string | null = null;
    const Child = defineComponent({
      setup() {
        const target = useResolvedTarget(mapCtx);
        seenKind = target.value.kind.value;
        return () => h("div", target.value.target.value ? "has" : "none");
      },
    });
    const Parent = defineComponent({
      setup(_, { slots }) {
        provide(targetContextKey, markerTarget);
        return () => slots.default?.();
      },
    });
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(Parent, null, { default: () => h(Child) }),
      }),
    );
    await flushPromises();
    // 注入覆盖:最近 Target 为 marker(初始 null,晚就绪后更新)
    expect(seenKind).toBe("marker");
    expect(wrapper.text()).toBe("none");
    markerRef.value = createHandle("overlay:marker", { id: "m" });
    await nextTick();
    await flushPromises();
    expect(wrapper.text()).toBe("has");
    wrapper.unmount();
    mapCtx.dispose();
  });

  it("client context is injectable without a map", async () => {
    const ctx = createClientContext({
      // 加载结果必须是**完整**的结构化结果（`assertLoadedSdk` 会逐字段校验，见 loaded.test.ts）；
      // Driver 用 stub，本用例只关心 Context 可注入
      definition: {
        provider: {
          load: async () =>
            createLoadedJsapiV4({
              providerId: "existing-global-v4",
              mode: "existing-global",
              version: "4.0",
              versionSource: "global",
              options: {},
              fingerprint: "target-context-test",
              namespace: {},
            }),
        },
        loadOptions: {},
        driver: () => ({ engine: "jsapi-v4" }) as never,
      },
    });
    const Child = defineComponent({
      setup() {
        return () => h("div", "child");
      },
    });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            defineComponent({
              setup(_, { slots }) {
                return () => slots.default?.();
              },
            }),
            null,
            { default: () => h(Child) },
          ),
      }),
      {
        global: {
          provide: { [bmapClientContextKey as symbol]: ctx },
        },
      },
    );
    const client = await ctx.load();
    expect(client).toBeTruthy();
    expect(ctx.status.value).toBe("ready");
    wrapper.unmount();
    ctx.dispose();
  });

  it("map context key provides layers/controls registries", () => {
    const mapCtx = fakeMapContext(createHandle("map", {}));
    expect(mapCtx.overlays).toBeTruthy();
    mapCtx.dispose();
    expect(mapContextKey).toBeTruthy();
    expect(targetContextKey).toBeTruthy();
  });
});
