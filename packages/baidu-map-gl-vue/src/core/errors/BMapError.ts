/**
 * 错误模型
 *
 * 所有运行时错误都以稳定 code 表达,携带 mapId/component/plugin 等上下文。
 * 日志输出不得包含完整 AK。
 */

export type BMapErrorCode =
  | "BMAP_SDK_LOAD_FAILED"
  | "BMAP_SDK_LOAD_TIMEOUT"
  | "BMAP_SDK_CONFIG_CONFLICT"
  | "BMAP_SDK_ENGINE_MISMATCH"
  | "BMAP_PROVIDER_ABORTED"
  | "BMAP_RUNTIME_DISPOSED"
  | "BMAP_RESOURCE_DISPOSED"
  | "BMAP_PARENT_CONTEXT_MISSING"
  | "BMAP_RESOURCE_CREATE_FAILED"
  | "BMAP_RESOURCE_UPDATE_FAILED"
  | "BMAP_PLUGIN_LOAD_FAILED"
  /**
   * 插件**名字**不在 Catalog 里（`plugins: ['Typo']`）。
   *
   * 与 `BMAP_PLUGIN_LOAD_FAILED`（名字认得、脚本/依赖加载失败）分开：前者是调用方的配置错误、
   * 重试没有意义；后者才可能因为 CDN 抖动而值得重试。合在一起会让 `retryable` 说谎。
   */
  | "BMAP_PLUGIN_UNKNOWN"
  | "BMAP_CAPABILITY_UNSUPPORTED"
  | "BMAP_SDK_CALL_FAILED"
  | "BMAP_SERVICE_FAILED"
  | "BMAP_INVALID_ARGUMENT"
  | "BMAP_INVALID_POINT"
  | "BMAP_HANDLE_FOREIGN"
  | "BMAP_DUPLICATE_ITEM_KEY"
  /** `./ui-kit` 的官方 UI Kit 不可用：无 DOM 环境调用，或 optional peer 未安装 / 加载失败。 */
  | "BMAP_UI_KIT_UNAVAILABLE";

export interface BMapErrorOptions {
  cause?: unknown;
  mapId?: symbol | string;
  component?: string;
  plugin?: string;
  capability?: string;
  engine?: string;
  version?: string;
}

export class BMapError extends Error {
  readonly code: BMapErrorCode;
  readonly mapId?: symbol | string;
  readonly component?: string;
  readonly plugin?: string;

  constructor(code: BMapErrorCode, message: string, options?: BMapErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = "BMapError";
    this.code = code;
    this.mapId = options?.mapId;
    this.component = options?.component;
    this.plugin = options?.plugin;
  }

  /** 结构化错误上下文,便于错误报告面板/日志 */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause,
      mapId: this.mapId != null ? String(this.mapId) : undefined,
      component: this.component,
      plugin: this.plugin,
    };
  }

  /** 是否可重试(加载/配置类错误可重试,资源/上下文类不可) */
  get retryable(): boolean {
    return (
      this.code === "BMAP_SDK_LOAD_FAILED" ||
      this.code === "BMAP_SDK_LOAD_TIMEOUT" ||
      this.code === "BMAP_PROVIDER_ABORTED" ||
      this.code === "BMAP_PLUGIN_LOAD_FAILED"
    );
  }

  static readonly codes = {
    SDK_LOAD_FAILED: "BMAP_SDK_LOAD_FAILED" as const,
    SDK_LOAD_TIMEOUT: "BMAP_SDK_LOAD_TIMEOUT" as const,
    SDK_CONFIG_CONFLICT: "BMAP_SDK_CONFIG_CONFLICT" as const,
    SDK_ENGINE_MISMATCH: "BMAP_SDK_ENGINE_MISMATCH" as const,
    PROVIDER_ABORTED: "BMAP_PROVIDER_ABORTED" as const,
    RUNTIME_DISPOSED: "BMAP_RUNTIME_DISPOSED" as const,
    RESOURCE_DISPOSED: "BMAP_RESOURCE_DISPOSED" as const,
    PARENT_CONTEXT_MISSING: "BMAP_PARENT_CONTEXT_MISSING" as const,
    RESOURCE_CREATE_FAILED: "BMAP_RESOURCE_CREATE_FAILED" as const,
    RESOURCE_UPDATE_FAILED: "BMAP_RESOURCE_UPDATE_FAILED" as const,
    PLUGIN_LOAD_FAILED: "BMAP_PLUGIN_LOAD_FAILED" as const,
    PLUGIN_UNKNOWN: "BMAP_PLUGIN_UNKNOWN" as const,
    CAPABILITY_UNSUPPORTED: "BMAP_CAPABILITY_UNSUPPORTED" as const,
    SDK_CALL_FAILED: "BMAP_SDK_CALL_FAILED" as const,
    SERVICE_FAILED: "BMAP_SERVICE_FAILED" as const,
    INVALID_ARGUMENT: "BMAP_INVALID_ARGUMENT" as const,
    INVALID_POINT: "BMAP_INVALID_POINT" as const,
    HANDLE_FOREIGN: "BMAP_HANDLE_FOREIGN" as const,
    DUPLICATE_ITEM_KEY: "BMAP_DUPLICATE_ITEM_KEY" as const,
    UI_KIT_UNAVAILABLE: "BMAP_UI_KIT_UNAVAILABLE" as const,
  };
}
