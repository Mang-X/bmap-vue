/**
 * createBMapPlugin（M3A1-CLIENT / #18）
 *
 * - 组件注册由 Manifest 生成的 `components/index.ts` 驱动（单一事实源），不再维护手写数组；
 * - 默认版本取 `DEFAULT_VERSION`（JSAPI 4.0 基线）；
 * - 默认 Client definition 走迁移归一（按加载结果 engine 分派）；R25-B（#71）起默认 Provider 是
 *   `baiduJsapiV4Provider()`（内部委托官方 Loader），显式传入的 legacy Provider 仍可用；
 * - 旧 globalProperties 只保留迁移期兼容，并给出明确的 beta 警告。
 */
import { createApp, inject } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createBMapPlugin,
  resetLegacyGlobalPropertiesWarningForTests,
} from "./createBMapPlugin";
import { componentManifest } from "../manifest";
import * as manifestComponents from "../components/index";
import { DEFAULT_VERSION } from "../core/loader/url";
import { defaultClientDefinitionKey } from "../core/context/client";
import { createBMapClient } from "../client/createBMapClient";
import { createFakeBMapV4 } from "../../../test-utils";
import { createLoadedJsapiV4 } from "../core/loader/providers";
import type { CreateBMapClientOptions } from "../client/types";
import { logger } from "../core/logger";

const fakeNamespace = { Map: class {}, Point: class {}, Marker: class {}, VERSION: "1.0" };

function createTestApp() {
  return createApp({ template: "<div />", render: () => null });
}

beforeEach(() => {
  resetLegacyGlobalPropertiesWarningForTests();
});

describe("createBMapPlugin", () => {
  it("按 Manifest 全量注册组件（包含此前手写数组漏掉的 BMarkerList）", () => {
    const app = createTestApp();
    app.use(createBMapPlugin());

    const names = componentManifest.map((c) => c.name);
    expect(names).toContain("BMarkerList");
    for (const name of names) {
      expect(app.component(name), `${name} 未注册`).toBeTruthy();
    }
  });

  it("接受 v4 Provider 并按 engine 分派（不被默认 legacy 破坏）", async () => {
    const captured: { definition?: CreateBMapClientOptions } = {};
    const app = createApp({
      setup() {
        captured.definition = inject(defaultClientDefinitionKey, undefined);
        return () => null;
      },
    });
    app.use(
      createBMapPlugin({
        provider: {
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
        },
      }),
    );
    app.mount(document.createElement("div"));

    // 分派必须落在 v4 路径，而不是被当成 legacy（那会是 BMAP_SDK_ENGINE_MISMATCH）。
    // #23 装配了 `createJsapiV4Driver`，因此这里从「v4 路径明确失败」改成**正向**断言：
    // 同一条 definition 现在能装出 v4 Client。
    const client = await createBMapClient(captured.definition!);
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
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

  it("默认 Client definition 走迁移归一（legacy Provider 可用）", async () => {
    const captured: { definition?: CreateBMapClientOptions } = {};
    const app = createApp({
      setup() {
        captured.definition = inject(defaultClientDefinitionKey, undefined);
        return () => null;
      },
    });
    app.use(
      createBMapPlugin({
        provider: {
          id: "test-legacy",
          getCacheKey: () => "fp",
          load: async () => ({ engine: "webgl-v1" as const, namespace: fakeNamespace }),
        },
      }),
    );
    app.mount(document.createElement("div"));

    expect(captured.definition).toBeTruthy();
    expect(captured.definition?.driver).toBeTruthy();

    const client = await createBMapClient(captured.definition!);
    expect(client.engine).toBe("webgl-v1");
    expect(client.sdkVersion).toBe("1.0");
  });

  it("globalProperties 兼容映射给出明确的 beta 迁移警告，且进程内只提示一次", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const app = createTestApp();
    app.use(createBMapPlugin({ ak: "test", apiUrl: "/offline/getApiScripts.js" }));

    const props = app.config.globalProperties as Record<string, unknown>;
    expect(props.$baiduMapAk).toBe("test");
    expect(props.$baiduMapApiUrl).toBe("/offline/getApiScripts.js");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("迁移期兼容映射");
    expect(String(warn.mock.calls[0]?.[0])).toContain("3.0.0 Stable");

    // 第二次安装不再重复提示（避免多 app / 多插件实例刷屏）
    const second = createTestApp();
    second.use(createBMapPlugin({ ak: "test" }));
    expect(warn).toHaveBeenCalledTimes(1);

    // 未使用 globalProperties 时完全不提示
    const silent = createTestApp();
    silent.use(createBMapPlugin({}));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
