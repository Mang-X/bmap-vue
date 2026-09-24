import { describe, it, expect, vi } from "vitest";
import { createBMapClient, jsapiV4DriverFactory, normalizeProvider } from "./createBMapClient";
import { createFakeBMapV4 } from "../../../test-utils";
import { createLoadedJsapiV4, type LoadedJsapiV4 } from "../core/loader/providers";
import { BMapError } from "../core/errors/BMapError";
import { LIBRARY_VERSION } from "../version";
import type { BMapDriver, BMapEngine } from "../driver/types/bmap";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { BMapDriverFactory } from "./types";

/**
 * v4 命名空间。
 *
 * M3A2-SERVICES-NATIVE（#23）装配了默认 Driver 工厂之后，默认路径需要**完整的** v4
 * 命名空间（`Map/Point/Pixel/Size/Bounds`）才能装出 Driver——不再是「随便给个对象，
 * 反正工厂会抛」的时代了。用 Fake v4 命名空间而不是手写最小对象，是为了让本文件的
 * 默认路径断言与其它 v4 测试跑在同一套形状上。
 */
const v4Namespace = createFakeBMapV4().namespace;

function loadedV4(overrides: Partial<{ version: string; fingerprint: string }> = {}): LoadedJsapiV4 {
  return createLoadedJsapiV4({
    providerId: "baidu-jsapi-v4",
    mode: "jsonp",
    version: overrides.version ?? "4.0",
    versionSource: "url",
    options: { ak: "test-ak-1234" },
    fingerprint: overrides.fingerprint ?? "fp-v4",
    namespace: v4Namespace,
    loadedAt: 0,
  });
}

function stubDriver(
  engine: BMapEngine,
  version: string,
  rawSdk: unknown,
  supportsMarker = true,
): BMapDriver {
  const capabilities = {
    supports: (capability: string) => supportsMarker && capability === "overlay.marker",
  } as unknown as CapabilityRegistry;
  return { engine, version, rawSdk, capabilities } as unknown as BMapDriver;
}

describe("createBMapClient（默认 v4 收口）", () => {
  it("默认注入 createJsapiV4Driver：默认路径装出可用的 v4 Client", async () => {
    // #23 之前这里是「明确失败」（抛 BMAP_CAPABILITY_UNSUPPORTED，消息含 M3A.2）——
    // Facet 装配完成后，同一条调用必须真的装出 Driver。断言保留「engine + Facet 齐全」，
    // 这样 #25 的默认 Provider 切换前就有可回归的基线。
    const client = await createBMapClient({
      provider: { load: async () => loadedV4() },
      loadOptions: { ak: "test-ak-1234" },
    });

    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver.engine).toBe("jsapi-v4");
    expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
    expect(client.driver.services.createGeocoder().raw).toBeTruthy();
  });

  it("v4 命名空间不完整时（Provider 声明了 v4 但缺成员）按 SDK 边界失败", async () => {
    await expect(
      createBMapClient({
        provider: {
          load: async () =>
            createLoadedJsapiV4({
              providerId: "baidu-jsapi-v4",
              mode: "jsonp",
              version: "4.0",
              versionSource: "url",
              options: { ak: "test-ak-1234" },
              fingerprint: "fp-v4-partial",
              // 缺 Pixel/Size/Bounds：加载成功但命名空间不可用 → 不可重试的调用失败
              namespace: { Map: class {}, Point: class {} },
              loadedAt: 0,
            }),
        },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_CALL_FAILED",
      message: expect.stringContaining("Pixel"),
    });
  });

  it("拒绝已删除的 engine 取值（webgl-v1）", async () => {
    await expect(
      createBMapClient({
        provider: {
          // 旧引擎已删除：这类加载结果现在只能来自「有人把旧代码加回来」
          load: async () =>
            ({ engine: "webgl-v1", namespace: v4Namespace }) as unknown as LoadedJsapiV4,
        },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("本库只支持 JSAPI 4.0"),
    });
  });

  it("拒绝裸 SDK unknown 加载结果（Provider 未结构化）", async () => {
    await expect(
      createBMapClient({
        // 刻意绕过类型：运行期给的就是**裸命名空间**（已删除的宽松 Provider 形状），
        // 类型层用断言表达「这个形状本就不该出现在这里」。
        provider: { load: async () => v4Namespace as unknown as LoadedJsapiV4 },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("LoadedSdk"),
    });
  });

  it("拒绝不完整的结构化结果（缺 version / load），不会产出 sdkVersion=undefined 的 client", async () => {
    // 评审 P2 的场景：`{ engine, namespace }` 这类半成品（JS 消费者 / `any` / 第三方 Provider 都能造出来）
    // 此前会被收窄成完整 `LoadedSdk`，`createBMapClient` 读到 `version: undefined` 并透传给 Driver，
    // 最终 `client.sdkVersion` 也是 `undefined`。
    await expect(
      createBMapClient({
        provider: {
          load: async () =>
            ({ engine: "jsapi-v4", namespace: v4Namespace }) as unknown as LoadedJsapiV4,
        },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("version"),
    });
  });

  it("注入 driver 工厂：透传加载结果、unsupported 策略与 signal", async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => loadedV4());
    const factory = vi.fn<BMapDriverFactory>(({ loaded }) =>
      stubDriver("jsapi-v4", (loaded as LoadedJsapiV4).version, loaded.namespace),
    );

    const client = await createBMapClient(
      {
        provider: { id: "v4", load },
        loadOptions: { ak: "test-ak-1234" },
        driver: factory,
        unsupported: "throw",
        capabilityOverrides: { "overlay.marker": false },
      },
      controller.signal,
    );

    expect(load).toHaveBeenCalledWith({ ak: "test-ak-1234" }, controller.signal);
    expect(factory).toHaveBeenCalledWith({
      loaded: expect.objectContaining({ engine: "jsapi-v4", version: "4.0" }),
      unsupported: "throw",
      capabilityOverrides: { "overlay.marker": false },
    });
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver).toBeTruthy();
  });

  it("metadata 把组件库版本 / engine / SDK 运行时版本分开报告", async () => {
    const client = await createBMapClient({
      provider: { load: async () => loadedV4({ version: "4.0" }) },
      loadOptions: {},
      driver: ({ loaded }) =>
        stubDriver("jsapi-v4", (loaded as LoadedJsapiV4).version, loaded.namespace),
    });

    expect(client.libraryVersion).toBe(LIBRARY_VERSION);
    expect(client.engine).toBe("jsapi-v4");
    expect(client.sdkVersion).toBe("4.0");
    expect(typeof client.id).toBe("symbol");
    expect(client.rawSdk).toBe(v4Namespace);
  });

  it("default driver factory 只接受 jsapi-v4（缺省不猜测 engine）", () => {
    expect(() =>
      jsapiV4DriverFactory({
        loaded: { engine: "webgl-v1", namespace: v4Namespace } as unknown as LoadedJsapiV4,
        unsupported: "warn",
      }),
    ).toThrow(/jsapi-v4/);
  });

  it("provider load 失败原样抛出", async () => {
    await expect(
      createBMapClient({
        provider: { load: async () => Promise.reject(new Error("boom")) },
        loadOptions: {},
      }),
    ).rejects.toThrow("boom");
  });
});

describe("normalizeProvider", () => {
  it("归一轻量 provider 形状", () => {
    const provider = normalizeProvider({ load: async () => loadedV4() });
    expect(provider.id).toBe("custom");
    expect(provider.getCacheKey({})).toBe("custom");
  });

  it("保持 class 型 Provider 的 this 绑定", async () => {
    class CustomProvider {
      readonly id = "custom-class";
      private readonly prefix = "ak:";
      getCacheKey() {
        return `${this.prefix}key`;
      }
      async load() {
        return { ...loadedV4(), marker: `${this.prefix}x` };
      }
    }
    const provider = normalizeProvider(new CustomProvider());
    expect(provider.getCacheKey({})).toBe("ak:key");
    await expect(provider.load({})).resolves.toMatchObject({ marker: "ak:x" });
  });
});
