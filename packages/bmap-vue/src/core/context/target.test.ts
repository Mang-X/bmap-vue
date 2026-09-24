import { describe, it, expect } from "vitest";
import { defineComponent, h, shallowRef } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createClientContext, bmapClientContextKey } from "./client";
import { createLoadedJsapiV4 } from "../loader/providers";
import { targetContextKey } from "./target";
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
