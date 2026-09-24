/**
 * createBMapClient
 *
 * 唯一职责：Provider 加载 -> 结构化结果收口 -> Driver 创建 -> BMapClient 组装。
 * SDK 版本差异、构造函数、raw 对象与“不支持能力”全部限制在 Client/Driver 边界内。
 *
 * M3A1-CLIENT（issue #18）：
 * - `BMapProviderLike.load` 返回结构化 `LoadedSdk`（不再返回裸 `unknown`）；
 * - **默认注入 `jsapiV4DriverFactory`（内部 `createJsapiV4Driver`），因此默认只接受
 *   `jsapi-v4`**，不做运行时 engine 猜测。
 *
 * M3A3-REMOVE-LEGACY（issue #26）：旧引擎与迁移期入口（`migration.ts` 的
 * `withMigrationDriver` / `createLegacyBMapClient`）一并删除，`assertLoadedSdk` 成为
 * 加载结果唯一的收口点。
 */
import { assertLoadedSdk, type LoadedSdk } from "../core/loader/loaded";
import type { BMapLoadOptions } from "../core/loader/url";
import { createJsapiV4Driver } from "../driver/createJsapiV4Driver";
import type { BMapDriver } from "../driver/types/bmap";
import { LIBRARY_VERSION } from "../version";
import type { BMapClient, BMapDriverFactory, BMapProviderLike, CreateBMapClientOptions } from "./types";

export interface NormalizedProvider {
  readonly id: string;
  /** 恒为函数：Provider 未提供指纹时返回 `custom`。 */
  getCacheKey(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedSdk>;
}

export function normalizeProvider(provider: BMapProviderLike): NormalizedProvider {
  // 注意：不能直接拷贝方法引用，class 型 Provider 会丢失 this
  return {
    id: provider.id ?? "custom",
    getCacheKey: provider.getCacheKey
      ? (options) => provider.getCacheKey!(options)
      : () => "custom",
    load: (options, signal) => provider.load(options, signal),
  };
}

/**
 * 默认 Driver 工厂：只接受 jsapi-v4 的结构化加载结果。
 *
 * `createJsapiV4Driver` 装配七面（Map / Overlay / Control / Layer / Service / Panorama /
 * Native Layer），因此本工厂不是「明确失败」的占位。
 */
export const jsapiV4DriverFactory: BMapDriverFactory = (input) => {
  const loaded = assertLoadedSdk(input.loaded);
  return createJsapiV4Driver({
    rawSdk: loaded.namespace,
    version: loaded.version,
    unsupported: input.unsupported,
    capabilityOverrides: input.capabilityOverrides,
  });
};

function assembleClient(loaded: LoadedSdk, driver: BMapDriver): BMapClient {
  // SDK 运行时版本一律来自结构化加载结果（Provider 声明）；旧引擎「由 Driver 探测」的
  // 分支已随 webgl-v1 删除。
  const sdkVersion = loaded.version;
  return {
    id: Symbol("bmap-client"),
    engine: driver.engine,
    libraryVersion: LIBRARY_VERSION,
    sdkVersion,
    driver,
    capabilities: driver.capabilities,
    rawSdk: driver.rawSdk,
  };
}

export async function createBMapClient(
  options: CreateBMapClientOptions,
  signal?: AbortSignal,
): Promise<BMapClient> {
  const provider = normalizeProvider(options.provider);
  const loaded = assertLoadedSdk(await provider.load(options.loadOptions, signal));

  const driver = (options.driver ?? jsapiV4DriverFactory)({
    loaded,
    unsupported: options.unsupported ?? "warn",
    capabilityOverrides: options.capabilityOverrides,
  });

  return assembleClient(loaded, driver);
}
