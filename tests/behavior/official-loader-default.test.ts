/**
 * 默认在线路径 = 官方 `@baidumap/jsapi-loader`（R25-B / issue #71）
 *
 * 这一份用**真实官方模块**（不 mock 它的实现）驱动默认路径，覆盖 issue 里那些「只能在真实
 * 加载器上验证」的验收点：
 *
 * - `createBMapPlugin()` / `<Map>` 未显式指定 Provider 时，官方 `load()` 真的被调用，
 *   并且注入的 script 是官方形状（`callback=__bmapJSApiOnLoad_<n>`，本库源码里没有这个字面量）；
 * - 同配置并发只加载一次；不同配置按冲突拒绝；
 * - 取消一个消费者不影响另一个；**全部**消费者取消后底层任务保留，后续请求不重复插 script；
 * - 加载成功后销毁所有 Map 不破坏进程级全局 SDK，重新建图可用（不 reset、不删 script）；
 * - 超时 / 重试按官方契约结算（失败不移除旧 script，重试会再插一个）。
 *
 * 「官方 load 被调用」用**属性级 spy** 观察（`officialJsapiLoader` 是 Provider 默认持有的那个
 * 对象，spy 它的 `load` 即观察默认路径本身），不 mock 模块实现——mock 掉就变成在测替身。
 *
 * 环境上必须做两件事，否则测出来的是测试基建而不是官方契约（与 #70 的契约锁同源）：
 * 1. `tests/setup.ts` 会把 `document.createElement` 换成「凡百度脚本一律自动回调」的桩，
 *    还预置 fake `window.BMapGL`；本文件在 `beforeEach` 里 `vi.restoreAllMocks()` 并清掉全局，
 *    把「什么时候回包」的控制权拿回来；
 * 2. happy-dom 默认会真的去 fetch 外部 script、失败时派发 error，于是官方 Loader 会抢在
 *    我们手动回包之前结算成 failed；下面那行环境指令把外部加载关掉并按成功处理。
 */
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { getStatus, reset } from "@baidumap/jsapi-loader";
import { createBMapPlugin } from "../../packages/bmap-vue/src/plugins/createBMapPlugin";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import { baiduJsapiV4Provider } from "../../packages/bmap-vue/src/core/loader/providers/BaiduJsapiV4Provider";
import { officialJsapiLoader } from "../../packages/bmap-vue/src/core/loader/providers/official";
import { resetProcessSdkRegistryForTests, getProcessSdkRegistry } from "../../packages/bmap-vue/src/core/loader/SdkRegistry";
import { BMapError } from "../../packages/bmap-vue/src/core/errors/BMapError";
import { createFakeBMapV4 } from "../../packages/test-utils/fake-bmap-v4/index.ts";

const AK = "ak-abcdef123456";
const SDKWIN = globalThis as unknown as Record<string, unknown>;

const SDK_SCRIPT_SELECTOR = 'script[src*="api.map.baidu.com/api"]';

function scriptCount(): number {
  return document.querySelectorAll(SDK_SCRIPT_SELECTOR).length;
}

/** 读最近一次注入的 script，并解析出官方 Loader 自己挂的回调名。 */
function lastInjectedCallback(): string {
  const nodes = Array.from(document.querySelectorAll(SDK_SCRIPT_SELECTOR));
  const last = nodes[nodes.length - 1] as HTMLScriptElement | undefined;
  if (!last) throw new Error("官方 Loader 没有注入 script");
  const name = /[?&]callback=([^&]+)/.exec(last.getAttribute("src") ?? "")?.[1];
  if (!name) throw new Error("注入的 script 上没有回调参数");
  return name;
}

/** 模拟官方 JSONP 回包：先让全局命名空间就位，再调用官方注册的回调。 */
function deliverNamespace(callbackName: string, namespace: unknown): void {
  SDKWIN.BMap = namespace;
  const callback = SDKWIN[callbackName];
  if (typeof callback !== "function") throw new Error(`window.${callbackName} 不是函数`);
  (callback as () => void)();
}

function sizedHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.width = "320px";
  host.style.height = "240px";
  document.body.append(host);
  return host;
}

function cleanup(): void {
  for (const node of Array.from(document.querySelectorAll(SDK_SCRIPT_SELECTOR))) node.remove();
  delete SDKWIN.BMap;
  delete SDKWIN.BMapGL;
  delete SDKWIN._BMapSecurityConfig;
  reset();
}

let officialLoadSpy: MockInstance;

beforeEach(() => {
  // 抹掉 `tests/setup.ts` 的 SDK 桩（自动回调 + fake BMapGL），拿回回包时机的控制权。
  vi.restoreAllMocks();
  cleanup();
  resetProcessSdkRegistryForTests();
  officialLoadSpy = vi.spyOn(officialJsapiLoader, "load");
});

afterEach(() => {
  cleanup();
  resetProcessSdkRegistryForTests();
});

describe("默认入口真的委托官方 Loader", () => {
  it("createBMapPlugin 未显式传 provider 时，默认就是 v4 Provider，并真的调用官方 load", async () => {
    const fake = createFakeBMapV4();
    const plugin = createBMapPlugin({ ak: AK });
    // 默认 provider 的 id 直接可读：不是「装了依赖但默认仍走自研」。
    expect((plugin.config.provider as { id: string }).id).toBe("baidu-jsapi-v4");

    const wrapper = mount(defineComponent({ setup: () => () => h(Map) }), {
      attachTo: sizedHost(),
      global: { plugins: [plugin] },
    });
    await flushPromises();

    // 官方 load 被调用，且收到映射后的选项。
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);
    expect(officialLoadSpy.mock.calls[0]![0]).toMatchObject({ ak: AK, version: "4.0" });

    // 注入的 script 是官方形状（回调名前缀由官方实现生成，本库源码没有这个字面量）。
    const callbackName = lastInjectedCallback();
    expect(callbackName).toMatch(/^__bmapJSApiOnLoad_\d+$/);

    deliverNamespace(callbackName, fake.namespace);
    await flushPromises();
    await nextTick();

    // 地图真的建起来了（默认路径不只是「load 被调用」，而是整条链可用）。
    expect(fake.createdMaps).toHaveLength(1);
    expect(
      (wrapper.findComponent(Map).vm as unknown as { getMapInstance: () => unknown }).getMapInstance(),
    ).toBeTruthy();

    wrapper.unmount();
    await flushPromises();
  });

  it("同配置并发加载只调用一次官方 load，且只注入一个 script", async () => {
    const provider = baiduJsapiV4Provider();
    const a = provider.load({ ak: AK });
    const b = provider.load({ ak: AK });
    await Promise.resolve();

    expect(officialLoadSpy).toHaveBeenCalledTimes(1);
    expect(scriptCount()).toBe(1);

    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    const [loadedA, loadedB] = await Promise.all([a, b]);
    expect(loadedA).toBe(loadedB);
    expect(loadedA.engine).toBe("jsapi-v4");
  });

  it("不同配置按本库冲突域拒绝，不重复发起加载", async () => {
    const provider = baiduJsapiV4Provider();
    const first = provider.load({ ak: AK });
    await Promise.resolve();

    const conflict = (await provider
      .load({ ak: "ak-zzzzzzzzzzzz" })
      .catch((error: unknown) => error)) as BMapError;
    expect(conflict).toBeInstanceOf(BMapError);
    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);

    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    await expect(first).resolves.toMatchObject({ engine: "jsapi-v4" });
  });
});

describe("取消等待的隔离（消费者 A 取消不影响 B）", () => {
  it("A 取消后 B 仍成功结算", async () => {
    const provider = baiduJsapiV4Provider();
    const c1 = new AbortController();
    const a = provider.load({ ak: AK }, c1.signal);
    const b = provider.load({ ak: AK });
    await Promise.resolve();

    c1.abort();
    await expect(a).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    await expect(b).resolves.toMatchObject({ engine: "jsapi-v4" });
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);
  });

  it("全部消费者取消后底层任务保留：再次订阅复用同一任务，不重复插 script、不重发官方 load", async () => {
    const provider = baiduJsapiV4Provider();
    const c1 = new AbortController();
    const first = provider.load({ ak: AK }, c1.signal);
    await Promise.resolve();
    expect(scriptCount()).toBe(1);

    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 官方任务不可取消 ⇒ 本库保留条目/占用/任务，同配置再次订阅是**复用**而不是重发。
    const again = provider.load({ ak: AK });
    await Promise.resolve();
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);
    expect(scriptCount()).toBe(1);

    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    await expect(again).resolves.toMatchObject({ engine: "jsapi-v4" });
    expect(getStatus()).toBe("loaded");
  });

  it("不可取消任务在飞时另一份配置在启动前被冲突拒绝，且原配置的成功仍被记账", async () => {
    const provider = baiduJsapiV4Provider();
    const c1 = new AbortController();
    const first = provider.load({ ak: AK }, c1.signal);
    await Promise.resolve();
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 另一份配置**在启动前**就被拒绝（不是自己起一份加载，也不是等 A 成功后才冲突）。
    const conflict = (await provider
      .load({ ak: "ak-zzzzzzzzzzzz" })
      .catch((error: unknown) => error)) as BMapError;
    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);
    expect(scriptCount()).toBe(1);

    // A 真正结算后：记账落在 A 上（真实成功不会被遗忘），同配置复用、其它配置继续冲突。
    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    await expect(provider.load({ ak: AK })).resolves.toMatchObject({ engine: "jsapi-v4" });
    const domain = getProcessSdkRegistry("BMap", { domain: "BMap" });
    expect(domain.activeFingerprint).toBe(baiduJsapiV4Provider().getCacheKey({ ak: AK }));
    await expect(provider.load({ ak: "ak-zzzzzzzzzzzz" })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });
  });
});

describe("销毁 Map 不破坏进程级全局 SDK", () => {
  it("卸载所有 Map 后全局、script 与官方状态都保留，重新建图可用", async () => {
    const fake = createFakeBMapV4();
    const plugin = createBMapPlugin({ ak: AK });

    const wrapper = mount(defineComponent({ setup: () => () => h(Map) }), {
      attachTo: sizedHost(),
      global: { plugins: [plugin] },
    });
    await flushPromises();
    deliverNamespace(lastInjectedCallback(), fake.namespace);
    await flushPromises();
    await nextTick();
    expect(fake.createdMaps).toHaveLength(1);
    const scriptNode = document.querySelector(SDK_SCRIPT_SELECTOR);
    expect(scriptNode).not.toBeNull();

    wrapper.unmount();
    await flushPromises();

    // 组件卸载**不得**调用官方 reset / 删 script / 删全局：这些是进程级共享状态。
    expect(SDKWIN.BMap).toBe(fake.namespace);
    expect(document.querySelector(SDK_SCRIPT_SELECTOR)).toBe(scriptNode);
    expect(getStatus()).toBe("loaded");

    // 重新建图：不需要新的 script，也不需要新的官方加载。
    const second = mount(defineComponent({ setup: () => () => h(Map) }), {
      attachTo: sizedHost(),
      global: { plugins: [createBMapPlugin({ ak: AK })] },
    });
    await flushPromises();
    await nextTick();
    expect(
      (second.findComponent(Map).vm as unknown as { getMapInstance: () => unknown }).getMapInstance(),
    ).toBeTruthy();
    expect(fake.createdMaps).toHaveLength(2);
    expect(scriptCount()).toBe(1);
    expect(officialLoadSpy).toHaveBeenCalledTimes(1);

    second.unmount();
    await flushPromises();
  });

  it("页面已有可用 v4 全局时不需要注入 script（复用由官方判定）", async () => {
    const fake = createFakeBMapV4();
    SDKWIN.BMap = fake.namespace;

    const provider = baiduJsapiV4Provider();
    const loaded = await provider.load({ ak: AK });

    expect(scriptCount()).toBe(0);
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.versionSource).toBe("global");
    expect(SDKWIN.BMap).toBe(fake.namespace);
  });
});

describe("超时、重试与错误脱敏", () => {
  it("超时按 BMAP_SDK_LOAD_TIMEOUT 结算；重试会再插一个 script（官方不移除失败的 script）", async () => {
    const provider = baiduJsapiV4Provider();
    const timeoutError = (await provider
      .load({ ak: AK, timeout: 5 })
      .catch((error: unknown) => error)) as BMapError;
    expect(timeoutError).toBeInstanceOf(BMapError);
    expect(timeoutError.code).toBe("BMAP_SDK_LOAD_TIMEOUT");
    expect(scriptCount()).toBe(1);

    const retry = provider.load({ ak: AK });
    await Promise.resolve();
    expect(scriptCount()).toBe(2);

    deliverNamespace(lastInjectedCallback(), createFakeBMapV4().namespace);
    await expect(retry).resolves.toMatchObject({ engine: "jsapi-v4" });
    expect(getStatus()).toBe("loaded");
  });

  it("错误信息不含 AK（官方消息里带入口 URL）", async () => {
    const provider = baiduJsapiV4Provider();
    // 超时是唯一能在无网络/无外部加载的测试环境里稳定触发的官方失败路径，
    // 它的消息不含 URL；带 URL 的脚本失败消息由 `official.test.ts` 的脱敏用例覆盖。
    const error = (await provider
      .load({ ak: AK, timeout: 5 })
      .catch((e: unknown) => e as BMapError))!;
    expect(error.message).not.toContain(AK);
    expect(JSON.stringify(error.toJSON())).not.toContain(AK);
  });
});
