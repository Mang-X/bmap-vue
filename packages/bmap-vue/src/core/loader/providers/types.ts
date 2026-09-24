/**
 * JSAPI 4.0 Provider 契约
 *
 * M3A1-PROVIDERS（issue #17）：Provider 是唯一允许读取全局 SDK 命名空间的边界，
 * 它必须返回**结构化**的 `LoadedJsapiV4`，而不是裸 `unknown` 的全局对象——下游
 * Driver/Client 因此不必再靠运行时猜测 engine 与版本。
 *
 * 结构化对象只描述「加载了什么、从哪里来」，不是 SDK 的重新封装：`namespace` 仍是
 * raw SDK 逃生口，只允许 Driver/Client 边界使用。
 */
import type { ScriptLoader } from "../ScriptLoader";
import type { SdkRegistry } from "../SdkRegistry";
import type { BMapLoadOptions } from "../url";
import type { OfficialJsapiLoader } from "./official";

/** v4 Provider 家族标识（写入 load metadata，便于排障定位）。 */
export type JsapiV4ProviderId = "baidu-jsapi-v4" | "existing-global-v4" | "custom-script-v4";

/** Stable 基线 engine：JSAPI 4.0 单引擎（见 ADR 2026-09-10）。 */
export type JsapiV4Engine = "jsapi-v4";

/** script 级就绪信号：JSONP `callback` 或 script `load` 事件。 */
export type JsapiV4ScriptMode = "load" | "jsonp";

/** 本次加载实际走的路径；`existing-global` 表示直接复用页面已存在的全局。 */
export type JsapiV4LoadMode = JsapiV4ScriptMode | "existing-global";

/**
 * version 的来源，用于区分「我们自己拼进 URL 的版本」「从全局对象探测到的版本」
 * 与「无从探测时的基线声明值」。
 */
export type JsapiV4VersionSource = "url" | "global" | "declared";

/**
 * 全局命名空间的最小结构契约：至少包含 `Map` / `Point` / `Marker`。
 * 其余成员保持可索引，避免为整个 4.0 命名空间再造一套类型。
 */
export interface JsapiV4Namespace {
  readonly Map: unknown;
  readonly Point: unknown;
  readonly Marker: unknown;
  readonly [member: string]: unknown;
}

export interface JsapiV4LoadMetadata {
  readonly providerId: JsapiV4ProviderId;
  /** 冲突域名称（v4 固定为 `BMap`）。 */
  readonly domain: string;
  readonly mode: JsapiV4LoadMode;
  readonly versionSource: JsapiV4VersionSource;
  /** 入口 URL；已脱敏（不含完整 AK）。复用已有全局时为 `existing-global`。 */
  readonly apiUrl: string;
  /** 脱敏后的 AK 引用（`***` + 末四位）；未配置时为 `none`。 */
  readonly akRef: string;
  /** 域内用于复用 / 冲突判定的配置指纹。 */
  readonly fingerprint: string;
  readonly loadedAt: number;
}

/** v4 Provider 的加载结果：engine、version、namespace 与 load metadata。 */
export interface LoadedJsapiV4 {
  readonly engine: JsapiV4Engine;
  readonly version: string;
  readonly namespace: JsapiV4Namespace;
  readonly load: JsapiV4LoadMetadata;
}

/** 所有 v4 Provider 的统一契约（返回结构化结果，默认共享 `BMap` 冲突域）。 */
export interface JsapiV4Provider {
  readonly id: JsapiV4ProviderId;
  getCacheKey(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}

/**
 * v4 Provider 的公共注入点（测试 / 高级用法）。
 * 三个 Provider 统一接受这一形状，避免各自一套构造参数。
 *
 * 注意：`loader` 是**自研 `ScriptLoader`**，只有还走自研 transport 的 CustomScript 用得上；
 * 默认在线路径（官方 Loader）的注入点见 `BaiduJsapiV4ProviderOptions`。
 */
export interface JsapiV4ProviderOptions {
  /** 底层 script 加载器；缺省每个 Provider 自建一个。 */
  loader?: ScriptLoader;
  /** 共享的冲突域；缺省用进程级 `BMap` 域。 */
  registry?: SdkRegistry;
}

/**
 * 默认在线路径（`baiduJsapiV4Provider`）的注入点。
 *
 * 与 `JsapiV4ProviderOptions` 分开是刻意的：默认路径的加载实现**不是** `ScriptLoader`，
 * 而是官方 `@baidumap/jsapi-loader`；把两者塞进同一个字段会得到一个「类型不匹配但看起来
 * 能传」的入口。这里只接受官方的 `load` 注入点（见 `./official`）。
 *
 * `reset()` 不进注入点：它是进程级破坏性操作，组件生命周期里任何一处都不许调用（ADR 决策 6）。
 */
export interface BaiduJsapiV4ProviderOptions {
  /** 官方 Loader 的 `load` 注入点（测试 / 高级用法）；缺省用官方具名导出。 */
  loader?: OfficialJsapiLoader;
  /** 共享的冲突域；缺省用进程级 `BMap` 域。 */
  registry?: SdkRegistry;
}
