/**
 * createBMapPlugin（M3A1-CLIENT / #18；M3A3-REMOVE-LEGACY / #26）
 *
 * - 组件注册由 Manifest 生成的 `components/index.ts` 驱动（单一事实源），不再维护手写数组；
 * - 默认版本取 `DEFAULT_VERSION`（JSAPI 4.0 基线）；
 * - 默认 Provider 是 `baiduJsapiV4Provider()`（内部委托官方 Loader，R25-B / #71）；
 * - `#26`：默认 definition **不再经任何归一**（`withMigrationDriver` 已删除），原样交给
 *   `createBMapClient`；旧引擎的加载结果会被对方的收口拒绝。
 * - `#136`：旧 `globalProperties` 映射（`$baiduMapAk` / `$baiduMapApiUrl`）已删除，安装不再
 *   写任何全局属性、也不再打迁移警告。
 */
import { createApp, inject } from "vue";
import { describe, it, expect } from "vitest";
import { createBMapPlugin } from "./createBMapPlugin";
import { componentManifest } from "../manifest";
import * as manifestComponents from "../components/index";
import { DEFAULT_VERSION } from "../core/loader/url";
import { defaultClientDefinitionKey } from "../core/context/client";
import { createBMapClient } from "../client/createBMapClient";
import { createFakeBMapV4 } from "../../../test-utils";
import { createLoadedJsapiV4 } from "../core/loader/providers";
import type { CreateBMapClientOptions } from "../client/types";

function createTestApp() {
  return createApp({ template: "<div />", render: () => null });
}

/** 读插件注入的默认 definition（不 mount 也能拿到：`inject` 只在 setup 里可用）。 */
function captureDefaultDefinition(plugin: ReturnType<typeof createBMapPlugin>) {
  const captured: { definition?: CreateBMapClientOptions } = {};
  const app = createApp({
    setup() {
      captured.definition = inject(defaultClientDefinitionKey, undefined);
      return () => null;
    },
  });
  app.use(plugin);
  app.mount(document.createElement("div"));
  return captured;
}

describe("createBMapPlugin", () => {
  it("按 Manifest 全量注册组件（包含此前手写数组漏掉的 MarkerList）", () => {
    const app = createTestApp();
    app.use(createBMapPlugin());

    const names = componentManifest.map((c) => c.name);
    expect(names).toContain("MarkerList");
    for (const name of names) {
      expect(app.component(name), `${name} 未注册`).toBeTruthy();
    }
  });

  it("接受 v4 Provider：默认 definition 装出可用的 v4 Client", async () => {
    const provider = {
      id: "v4-test",
      load: async () =>
        createLoadedJsapiV4({
          providerId: "baidu-jsapi-v4",
          mode: "jsonp",
          version: "4.0",
          versionSource: "url",
          options: { ak: "test" },
          fingerprint: "fp-v4",
          namespace: createFakeBMapV4().namespace,
          loadedAt: 0,
        }),
    };
    const captured = captureDefaultDefinition(createBMapPlugin({ provider }));

    // 默认 definition 现在**原样**就是「这个 provider + defaults」——不再被包装、
    // 也不再注入任何迁移期 Driver 工厂。
    expect(captured.definition?.provider).toBe(provider);
    expect(captured.definition?.driver).toBeUndefined();

    const client = await createBMapClient(captured.definition!);
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
  });

  it("旧引擎（webgl-v1）加载结果在默认路径上被拒绝（不回退旧引擎）", async () => {
    const captured = captureDefaultDefinition(
      createBMapPlugin({
        provider: {
          id: "test-legacy",
          getCacheKey: () => "fp",
          // 旧引擎已删除：这类 Provider 只可能来自「有人把旧代码加回来」
          load: async () => ({ engine: "webgl-v1", namespace: {} }) as never,
        },
      }),
    );

    expect(captured.definition).toBeTruthy();
    await expect(createBMapClient(captured.definition!)).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
    });
  });

  it("按需导入与全局注册指向同一组件实现（Manifest 单一事实源）", async () => {
    const app = createTestApp();
    const plugin = createBMapPlugin();
    app.use(plugin);

    // 按需导入走同一个生成物模块；全局注册的必须是同一引用，避免「注册了一份、
    // 按需导入了另一份」造成的实例/类型不一致
    for (const [name, component] of Object.entries(manifestComponents)) {
      expect(app.component(name)).toBe(component);
    }
    expect(plugin.config.provider).toBeTruthy();
  });

  it("默认版本对齐 JSAPI 4.0 基线", () => {
    const plugin = createBMapPlugin({});
    expect(plugin.config.defaults.version).toBe(DEFAULT_VERSION);

    const custom = createBMapPlugin({ version: "4.0.x" });
    expect(custom.config.defaults.version).toBe("4.0.x");
  });

  it("安装不向 globalProperties 写任何东西（#136 删掉 v2 兼容映射）", () => {
    const app = createTestApp();
    const before = Object.keys(app.config.globalProperties);
    app.use(createBMapPlugin({ ak: "test", apiUrl: "/offline/getApiScripts.js" }));

    expect(Object.keys(app.config.globalProperties)).toEqual(before);
    expect(app.config.globalProperties.$baiduMapAk).toBeUndefined();
    expect(app.config.globalProperties.$baiduMapApiUrl).toBeUndefined();
  });
});

