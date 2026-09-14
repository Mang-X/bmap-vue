/**
 * BMapClient 类型
 *
 * M3A1-CLIENT（issue #18）：Client 从结构化的 `LoadedSdk` 创建 Driver，metadata 上把
 * **组件库版本 / engine / SDK 运行时版本** 三个维度独立报告，不再用同一个 `version`
 * 混合表达。
 *
 * M3A3-REMOVE-LEGACY（issue #26）：旧引擎删除后 Provider 只剩**结构化**一种形状，因此
 * `LooseBMapProviderLike`（v2 / v3-beta 的裸全局 `{ load }`）与 `AnyBMapProviderLike`
 * （两者的并集）一并移除——「接收裸全局再猜 engine」的入口不存在了。
 */
import type { BMapLoadOptions } from "../core/loader/url";
import type { LoadedSdk } from "../core/loader/loaded";
import type { Capability } from "../driver/capability/catalog";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { UnsupportedBehavior } from "../driver/capability/unsupported";
import type { BMapDriver, BMapEngine } from "../driver/types/bmap";

/**
 * 结构化 Provider：`load` 必须返回 `LoadedSdk`（JSAPI 4.0）。
 *
 * 内置 v4 家族（`baiduJsapiV4Provider()` / `existingGlobalV4Provider()` /
 * `customScriptV4Provider()`）与测试替身都满足这一形状。
 */
export interface BMapProviderLike {
  readonly id?: string;
  getCacheKey?(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedSdk>;
}

/** Driver 工厂的输入：结构化加载结果 + 能力策略。 */
export interface BMapDriverInput {
  readonly loaded: LoadedSdk;
  readonly unsupported: UnsupportedBehavior;
  readonly capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/**
 * Driver 工厂注入点。
 *
 * 默认注入 `jsapiV4DriverFactory`（内部先 `assertLoadedSdk`，因此只接受 jsapi-v4 的
 * 结构化加载结果）。
 */
export type BMapDriverFactory = (input: BMapDriverInput) => BMapDriver;

export interface BMapClient {
  readonly id: symbol;
  readonly engine: BMapEngine;
  /** 组件库版本（`baidu-map-gl-vue` 包版本，见 `src/version.ts`）。 */
  readonly libraryVersion: string;
  /** SDK 运行时版本（来自 Provider 的结构化加载结果）。 */
  readonly sdkVersion: string;
  /** @deprecated 兼容别名，等于 `sdkVersion`；请按语义选择 `libraryVersion` / `sdkVersion`。 */
  readonly version: string;
  readonly driver: BMapDriver;
  readonly capabilities: CapabilityRegistry;
  /** raw SDK 逃生口：普通业务代码请优先使用 driver；只有 `./advanced` 使用者才应读取 */
  readonly rawSdk: unknown;
}

export interface CreateBMapClientOptions {
  /** 结构化的 Provider：`load` 必须返回 `LoadedSdk`（不接受裸全局对象）。 */
  provider: BMapProviderLike;
  loadOptions: BMapLoadOptions;
  /**
   * Driver 工厂注入点。缺省注入 `jsapiV4DriverFactory`，因此默认路径只接受 jsapi-v4 的
   * 结构化加载结果；需要别的 Driver 实现时显式注入。
   */
  driver?: BMapDriverFactory;
  unsupported?: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/** 命名一致化入口：把内联对象归一为 CreateBMapClientOptions */
export function createBMapClientDefinition(options: CreateBMapClientOptions): CreateBMapClientOptions {
  return options;
}
