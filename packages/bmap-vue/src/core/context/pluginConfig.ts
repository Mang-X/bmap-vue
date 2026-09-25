/**
 * app 级 provider 配置注入 key 与类型(与 createBMapPlugin 解耦,避免循环依赖)
 *
 * M3A3-REMOVE-LEGACY（#26）：旧引擎与「宽松 Provider」形状删除后，`provider` 只剩
 * **结构化**一种类型（`load()` 返回 `LoadedJsapiV4`，engine = `jsapi-v4`），因此这里不再需要
 * 跨引擎的并集类型。
 */
import type { InjectionKey } from "vue";
import type { BMapProviderLike } from "../../client/types";
import type { BMapLoadOptions } from "../loader/url";

export interface BMapPluginConfig {
  provider: BMapProviderLike;
  defaults: BMapLoadOptions;
}

/** app 级 provider 配置注入 key */
export const bmapConfigKey: InjectionKey<BMapPluginConfig> = Symbol("bmap-vue:config");
