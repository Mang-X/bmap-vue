/**
 * M3: createBMapPlugin —— 安装 API
 *
 * 通过 app.use() 提供全局默认 Client definition(AK/版本/Provider),Map 组件从
 * app 级 config 与 definition 读取默认 provider(而非直接访问 window,符合依赖规则)。
 *
 * M3A1-CLIENT（issue #18）的调整：
 * - **组件注册改由 Manifest 生成的 `components/index.ts` 驱动**（单一事实源），不再维护
 *   一份手写数组——两处清单漂移会导致 `app.use` 少注册组件；
 * - 默认版本改用 `DEFAULT_VERSION`（JSAPI 4.0 基线），不再硬编码 `1.0`；插件自身报告的
 *   库版本改用 `LIBRARY_VERSION`，与 `package.json` 单一事实源对齐；
 * - 默认 Provider 自 R25-B（issue #71）起是 `baiduJsapiV4Provider()`（内部委托官方
 *   `@baidumap/jsapi-loader`）；
 * - M3A3-REMOVE-LEGACY（#26）：迁移期的 `withMigrationDriver` 归一与 `allowExistingGlobal`
 *   一并删除。默认 definition 直接交给 `createBMapClient`（缺省注入 jsapi-v4 Driver 工厂），
 *   需要复用宿主已加载的 SDK 时显式传 `existingGlobalV4Provider()`；
 * - 旧 `globalProperties` 映射随 #136 删除：它绕过 Provider/Client 边界让组件直接读全局配置，
 *   配置一律经 `<BMapProvider>` 或 `createBMapPlugin({ ak })` 的默认 Client definition。
 */
import type { App, Component } from "vue";
import { baiduJsapiV4Provider } from "../core/loader/providers/index";
import { DEFAULT_VERSION, type BMapLoadOptions } from "../core/loader/url";
import { bmapConfigKey, type BMapPluginConfig } from "../core/context/pluginConfig";
import { defaultClientDefinitionKey } from "../core/context/client";
import type { BMapProviderLike, CreateBMapClientOptions } from "../client/types";
import { LIBRARY_VERSION } from "../version";
import * as manifestComponents from "../components/index";

export interface CreateBMapPluginOptions {
  /**
   * 默认 SDK Provider（结构化：`load()` 返回 `LoadedJsapiV4`，engine = `jsapi-v4`）。
   *
   * 内置 v4 家族：`baiduJsapiV4Provider()`（默认）/ `existingGlobalV4Provider()` /
   * `customScriptV4Provider()`。
   */
  provider?: BMapProviderLike;
  ak?: string;
  apiUrl?: string;
  version?: string;
  plugins?: string[];
  defaults?: Partial<BMapLoadOptions>;
  client?: CreateBMapClientOptions;
}

export { bmapConfigKey } from "../core/context/pluginConfig";
export type { BMapPluginConfig } from "../core/context/pluginConfig";
export { defaultClientDefinitionKey } from "../core/context/client";

export function createBMapPlugin(options: CreateBMapPluginOptions = {}) {
  // R25-B（issue #71）：默认 Provider 是 `baiduJsapiV4Provider()`——它内部真的调用官方
  // `@baidumap/jsapi-loader`，不再走自研 JSONP transport。legacy `baiduCdnProvider()` 已随
  // webgl-v1 在 #26 删除，根入口也不再导出它。
  const provider = options.provider ?? baiduJsapiV4Provider();
  const defaults: BMapLoadOptions = {
    ak: options.ak,
    apiUrl: options.apiUrl,
    version: options.version ?? DEFAULT_VERSION,
    ...options.defaults,
  };
  const config: BMapPluginConfig = { provider, defaults };
  // 显式 `client` 与默认 definition 走同一条路（也是 #26 之前 `withMigrationDriver` 保证过的
  // 「两边一致」）：两者都直接交给 `createBMapClient`，不再有裸 Provider 归一。
  const clientDefinition: CreateBMapClientOptions = options.client ?? {
    provider,
    loadOptions: defaults,
  };

  return {
    install(app: App) {
      app.provide(bmapConfigKey, config);
      // 新规范:app.use 只提供默认 Client Definition,可被 <BMapProvider> 覆盖
      app.provide(defaultClientDefinitionKey, clientDefinition);
      // 注册全局组件（注册名取 manifest 清单，见下方 `installableComponents`）
      for (const [name, component] of installableComponents()) {
        if (component) app.component(name, component);
      }
    },
    version: LIBRARY_VERSION,
    /** 供按需导入使用 */
    config,
  };
}

/**
 * 组件清单:来自 Manifest 生成的 `components/index.ts`(单一事实源)。
 *
 * 该文件由 `scripts/generate-manifest-artifacts.mts` 依据 `src/manifest.ts` 生成,
 * `pnpm generate:manifest:check` 会阻止漂移。注册名取 **manifest 的组件名**(导出名),
 * 与 resolver / volar.d.ts 使用同一命名,避免「两处清单漂移导致少注册组件」。
 */
function installableComponents(): readonly (readonly [string, Component])[] {
  return Object.entries(manifestComponents) as unknown as readonly (readonly [string, Component])[];
}
