/**
 * M3A1-CLIENT（#18）：<BMapProvider> 的 loading / error / retry slot 行为
 *
 * Client Context 的结构化 load/retry/status/error 必须真实驱动插槽：
 * - loading：load 未结算时显示 loading slot；
 * - ready：结算后显示默认插槽并 emit ready；
 * - error：失败时显示 error slot（带 error + retry）并 emit error；
 * - retry：从 error 恢复为 ready，且不残留上一轮错误。
 *
 * M3A3-REMOVE-LEGACY（#26）后的移植：`withMigrationDriver` 已随 webgl-v1 删除，definition
 * 直接进 `createBMapClient`；Provider 必须是**结构化** v4 形状（`engine: "jsapi-v4"` +
 * `namespace`），旧用例里的 `engine: "webgl-v1"` 断言相应换成 `"jsapi-v4"`。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { h, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import { createLoadedJsapiV4 } from "../../packages/bmap-vue/src/core/loader/providers";
import type { BMapLoadOptions } from "../../packages/bmap-vue/src/core/loader/url";
import type { BMapClient } from "../../packages/bmap-vue/src/client/types";
import type { LoadedJsapiV4 } from "../../packages/bmap-vue/src/core/loader/loaded";
import { BMapError } from "../../packages/bmap-vue/src/core/errors/BMapError";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";

// #26 后没有「宽松 Provider → legacy Driver」这条分派，engine 恒为 jsapi-v4。
let fake: FakeBMapV4;

/** 结构化 v4 加载结果（`assertLoadedSdk` 只认 engine + namespace）。 */
function loadedV4(): LoadedJsapiV4 {
  return createLoadedJsapiV4({
    providerId: "custom-script-v4",
    mode: "jsonp",
    version: fake.namespace.VERSION,
    versionSource: "url",
    options: { ak: "test" },
    fingerprint: "bmapprovider-slots",
    namespace: fake.namespace,
    loadedAt: 0,
  });
}

function definitionFor(load: (options: BMapLoadOptions) => Promise<LoadedJsapiV4>) {
  return {
    provider: { id: "test-v4", getCacheKey: () => "fp", load },
    loadOptions: { ak: "test" },
  };
}

let seenRetry: (() => Promise<void>) | undefined;
let seenError: BMapError | undefined;

function slots() {
  return {
    default: () => h("div", { "data-test": "child" }, "child"),
    loading: () => h("div", { "data-test": "loading" }, "loading"),
    error: (slotProps: { error: BMapError; retry: () => Promise<void> }) => {
      seenError = slotProps.error;
      seenRetry = slotProps.retry;
      return h("div", { "data-test": "error" }, slotProps.error.code);
    },
  };
}

beforeEach(() => {
  seenRetry = undefined;
  seenError = undefined;
  fake = createFakeBMapV4();
  fake.diagnostics.reset();
});

describe("<BMapProvider> 状态插槽", () => {
  it("loading → ready：loading 插槽出现，默认插槽常驻并 emit ready", async () => {
    let resolveLoad!: (value: LoadedJsapiV4) => void;
    const load = vi.fn(
      () =>
        new Promise<LoadedJsapiV4>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const wrapper = mount(BMapProvider, {
      props: { definition: definitionFor(load) },
      slots: slots(),
    });

    // mounted 之后才发起加载：先渲染 idle，再进入 loading
    await nextTick();
    expect(wrapper.find('[data-test="loading"]').exists()).toBe(true);
    // 文档约定：默认插槽常驻（加载中也渲染），加载状态以插槽叠加形式暴露
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);

    resolveLoad(loadedV4());
    await flushPromises();

    expect(wrapper.find('[data-test="loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);

    const ready = wrapper.emitted("ready") as [BMapClient][] | undefined;
    expect(ready).toHaveLength(1);
    // 原来是 "webgl-v1"；#26 后唯一引擎是 jsapi-v4
    expect(ready![0]![0].engine).toBe("jsapi-v4");

    wrapper.unmount();
  });

  it("load 失败 → error 插槽带 error/retry，retry 恢复为 ready", async () => {
    let attempts = 0;
    const load = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("boom");
      return loadedV4();
    });
    const wrapper = mount(BMapProvider, {
      props: { definition: definitionFor(load) },
      slots: slots(),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    expect(seenError?.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(typeof seenRetry).toBe("function");
    const failed = wrapper.emitted("error") as [BMapError][] | undefined;
    expect(failed).toHaveLength(1);

    await seenRetry!();
    await flushPromises();

    expect(attempts).toBe(2);
    expect(wrapper.find('[data-test="error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    expect((wrapper.emitted("ready") as unknown[]).length).toBe(1);

    wrapper.unmount();
  });

  it("provider prop 走显式 v4 Provider", async () => {
    // 原来是「迁移期默认路径 ⇒ 显式 legacy 工厂」；#26 后 legacy 入口删除，
    // `provider` prop 与 `definition` 等价，直接走 v4。
    const wrapper = mount(BMapProvider, {
      props: {
        provider: { id: "test-v4", load: async () => loadedV4() },
        loadOptions: {},
      },
      slots: slots(),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    const ready = wrapper.emitted("ready") as [BMapClient][] | undefined;
    expect(ready?.[0]?.[0].engine).toBe("jsapi-v4");

    wrapper.unmount();
  });
});
