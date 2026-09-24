/**
 * 默认 definition 在不同入口的一致性（评审 P2 回归；M3A3-REMOVE-LEGACY / #26 改写）
 *
 * 原文针对的是「迁移期结构化 legacy definition 在任意入口都必须进入 legacy Driver」。
 * 旧引擎与 `withMigrationDriver` 归一删除后，这条性质收敛成更朴素、也更容易回归的一句：
 *
 * **同一份 definition 在任意入口（`<BMap>` / `<BMapProvider>` / 插件 `client` /
 * `resolveMapContext`）必须产出同一个 Client**；不应因为「放在组件 prop / 插件 client /
 * app 默认定义 / 地图外 context」而报 `BMAP_SDK_ENGINE_MISMATCH`。
 *
 * 第二条性质是它的反面：definition 里带**已删除引擎**的加载结果时，各入口也必须一致地失败
 * （修复前的形态正是「换个入口就报不同的错，或者干脆成功」）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import BMap from "../../packages/bmap-vue/src/components/map/BMap.vue";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import { createBMapPlugin } from "../../packages/bmap-vue/src/plugins/createBMapPlugin";
import { resolveMapContext } from "../../packages/bmap-vue/src/composables/resolveMapContext";
import { createFakeV4Harness } from "../../packages/test-utils";
import type { BMapClient, BMapDriverFactory } from "../../packages/bmap-vue/src/client/types";
import type { LoadedSdk } from "../../packages/bmap-vue/src/core/loader/loaded";
import { BMapError } from "../../packages/bmap-vue/src/core/errors/BMapError";

const { harness, fake } = createFakeV4Harness();

/** 结构化的 v4 Provider：自述 engine，namespace 是完整的 Fake v4 命名空间。 */
function v4Provider(load?: () => Promise<LoadedSdk>) {
  return {
    id: "review-v4",
    getCacheKey: () => "review-v4",
    load: load ?? (async (): Promise<LoadedSdk> => (await harness.provider().load({})) as LoadedSdk),
  };
}

/** 同一份 definition：各入口共用，避免「各写一份」掩盖差异。 */
function sharedDefinition() {
  return { provider: v4Provider(), loadOptions: {} };
}

function host() {
  const el = document.createElement("div");
  el.style.width = "200px";
  el.style.height = "200px";
  document.body.appendChild(el);
  return el;
}

function expectV4Client(client: BMapClient | null | undefined, entry: string) {
  expect(client, `${entry} 未产出 client`).toBeTruthy();
  expect(client!.engine, `${entry} 的 engine 不是 jsapi-v4`).toBe("jsapi-v4");
  expect(client!.sdkVersion).toBe("4.0");
}

beforeEach(() => {
  harness.reset();
});

describe("默认 definition 在不同入口的一致性", () => {
  it("<BMap :definition> 与 <BMapProvider :definition> 行为一致", async () => {
    const providerWrapper = mount(BMapProvider, {
      props: { definition: sharedDefinition() },
      slots: { default: () => h("div") },
    });
    await flushPromises();
    expectV4Client(
      (providerWrapper.emitted("ready") as [BMapClient][])?.[0]?.[0],
      "<BMapProvider :definition>",
    );
    providerWrapper.unmount();

    const mapWrapper = mount(BMap, {
      attachTo: host(),
      props: { definition: sharedDefinition() },
    });
    await flushPromises();
    const errorCodes = (mapWrapper.emitted("error") as [unknown][] | undefined)?.map(
      (e) => (e[0] as BMapError)?.code,
    );
    expect(errorCodes ?? [], "<BMap :definition> 不应报错").not.toContain(
      "BMAP_SDK_ENGINE_MISMATCH",
    );
    expect(errorCodes ?? []).not.toContain("BMAP_CAPABILITY_UNSUPPORTED");
    const ready = mapWrapper.emitted("ready") as [{ client: BMapClient }][] | undefined;
    expect(ready?.length, "<BMap :definition> 未产出 ready").toBeGreaterThan(0);
    expectV4Client(ready?.[0]?.[0]?.client, "<BMap :definition>");
    mapWrapper.unmount();
  });

  it("插件 client → <BMapProvider>（app 默认 definition）产出同一个 v4 Client", async () => {
    const wrapper = mount(BMapProvider, {
      slots: { default: () => h("div") },
      global: { plugins: [createBMapPlugin({ client: sharedDefinition() })] },
    });
    await flushPromises();
    expectV4Client(
      (wrapper.emitted("ready") as [BMapClient][])?.[0]?.[0],
      "插件 client → <BMapProvider>",
    );
    wrapper.unmount();
  });

  it("插件 client → resolveMapContext（地图外服务）产出同一个 v4 Client", async () => {
    let context: ReturnType<typeof resolveMapContext> | undefined;
    const Probe = defineComponent({
      setup() {
        context = resolveMapContext();
        return () => h("div");
      },
    });
    const wrapper = mount(Probe, {
      global: { plugins: [createBMapPlugin({ client: sharedDefinition() })] },
    });

    let client: BMapClient | null = null;
    let failure: unknown = null;
    try {
      const ready = await context!.whenReady();
      client = ready.client;
    } catch (e) {
      failure = e;
    }
    await flushPromises();

    expect(failure, `resolveMapContext 不应失败：${(failure as Error)?.message}`).toBeNull();
    expectV4Client(client, "插件 client → resolveMapContext");
    wrapper.unmount();
  });

  it("显式 driver 优先：不会因为定义未声明 driver 而被默认工厂顶掉", async () => {
    const seen: string[] = [];
    const injectedDriver = ((input: { loaded: LoadedSdk }) => {
      seen.push(input.loaded.engine);
      // 返回一个明确的失败，用来证明「真的是这个工厂被调用了」
      throw new BMapError("BMAP_CAPABILITY_UNSUPPORTED", "injected driver");
    }) as unknown as BMapDriverFactory;

    const wrapper = mount(BMapProvider, {
      props: {
        definition: { provider: v4Provider(), loadOptions: {}, driver: injectedDriver },
      },
      slots: { default: () => h("div") },
    });
    await flushPromises();

    expect(seen, "注入的 Driver 工厂没有被调用").toEqual(["jsapi-v4"]);
    expect(wrapper.emitted("ready")).toBeUndefined();
    const codes = ((wrapper.emitted("error") as [BMapError][]) ?? []).map((e) => e[0]?.code);
    expect(codes).toContain("BMAP_CAPABILITY_UNSUPPORTED");
    wrapper.unmount();
  });

  it("各入口对「已删除引擎」的加载结果一致失败（不会换个入口就成功）", async () => {
    const legacyLoaded = async () =>
      ({ engine: "webgl-v1", namespace: fake.namespace }) as unknown as LoadedSdk;

    const definition = () => ({ provider: v4Provider(legacyLoaded), loadOptions: {} });

    const providerWrapper = mount(BMapProvider, {
      props: { definition: definition() },
      slots: { default: () => h("div") },
    });
    await flushPromises();
    expect(providerWrapper.emitted("ready"), "<BMapProvider> 不该成功").toBeUndefined();
    expect(
      ((providerWrapper.emitted("error") as [BMapError][]) ?? []).map((e) => e[0]?.code),
    ).toContain("BMAP_SDK_ENGINE_MISMATCH");
    providerWrapper.unmount();

    const mapWrapper = mount(BMap, { attachTo: host(), props: { definition: definition() } });
    await flushPromises();
    expect(mapWrapper.emitted("ready"), "<BMap> 不该成功").toBeUndefined();
    expect(((mapWrapper.emitted("error") as [BMapError][]) ?? []).map((e) => e[0]?.code)).toContain(
      "BMAP_SDK_ENGINE_MISMATCH",
    );
    mapWrapper.unmount();
  });
});
