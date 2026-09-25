/**
 * CustomScriptV4Provider —— 企业自托管 / 私有入口的 JSAPI 4.0
 *
 * - 就绪信号必须**显式**：`jsonp` 走全局 callback，`load` 走 script `load` 事件。
 *   缺省是 `load`——JSONP 只有在入口确实支持 `callback` 时才是正确信号，不能靠
 *   「传了 apiUrl」这种间接特征猜；
 * - 支持相对 `scriptSrc`：JSONP 分支用 `appendCallback` 基于 `document.baseURI` 解析，
 *   `load` 分支交给浏览器原生解析，metadata 里统一记录归一化后的绝对 URL；
 * - 与 CDN / ExistingGlobal Provider 共享同一进程级 `BMap` 冲突域。
 */
import { BMapError } from "../../errors/BMapError";
import { SdkRegistry, getProcessSdkRegistry } from "../SdkRegistry";
import { ScriptLoader, scriptOptions } from "../ScriptLoader";
import type { BMapLoadOptions } from "../url";
import {
  DEFAULT_CALLBACK_PARAM,
  appendCallback,
  createCallbackName,
  fingerprintConfig,
} from "../url";
import { createLoadedJsapiV4 } from "./loaded";
import { loadJsapiV4Script } from "./load";
import {
  JSAPI_V4_DOMAIN,
  assertSupportedJsapiV4Version,
  requireJsapiV4Global,
  resolveExistingJsapiV4Version,
} from "./namespace";
import { reuseExistingJsapiV4 } from "./reuse";
import type {
  JsapiV4Provider,
  JsapiV4ProviderInternalOptions,
  JsapiV4ScriptMode,
  LoadedJsapiV4,
} from "./types";

/** 一次性全局回调名前缀（与 legacy `__bmap_offline_` 区分，便于排障）。 */
const CALLBACK_PREFIX = "__bmap_v4_custom_";

export interface CustomScriptV4ProviderOptions {
  /** 就绪信号；缺省 `load`。入口支持 `callback` 时必须显式传 `jsonp`。 */
  mode?: JsapiV4ScriptMode;
}

/**
 * 内部选项：公共的 `mode` + 仅内部 / 测试的 transport 与冲突域注入（见
 * `JsapiV4ProviderInternalOptions`）。`./advanced` 只承诺 `CustomScriptV4ProviderOptions`。
 */
export interface CustomScriptV4ProviderInternalOptions
  extends CustomScriptV4ProviderOptions,
    JsapiV4ProviderInternalOptions {}

export class CustomScriptV4Provider implements JsapiV4Provider {
  readonly id = "custom-script-v4" as const;
  private readonly scriptSrc: string;
  private readonly mode: JsapiV4ScriptMode;
  private readonly loader: ScriptLoader;
  private readonly domain: SdkRegistry;

  constructor(scriptSrc: string, options: CustomScriptV4ProviderInternalOptions = {}) {
    if (!scriptSrc) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        "customScriptV4Provider requires a non-empty scriptSrc",
      );
    }
    this.scriptSrc = scriptSrc;
    this.mode = options.mode ?? "load";
    this.loader = options.loader ?? new ScriptLoader();
    this.domain =
      options.registry ?? getProcessSdkRegistry(JSAPI_V4_DOMAIN);
  }

  getCacheKey(options: BMapLoadOptions): string {
    // 只有 JSONP 模式下回调参数由 Loader 管理（会被本次回调名覆盖），必须从身份中剔除；
    // `load` 模式下它只是入口 URL 的普通 query，漏掉会把不同租户入口合并成同一配置。
    const managedCallbackParam =
      this.mode === "jsonp" ? (options.callbackParam ?? DEFAULT_CALLBACK_PARAM) : null;
    return fingerprintConfig({ ...options, apiUrl: this.scriptSrc }, managedCallbackParam);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4> {
    const fingerprint = this.getCacheKey(options);
    return this.domain.load<LoadedJsapiV4>(
      {
        fingerprint,
        loader: (requestSignal) => this.performLoad(options, fingerprint, requestSignal),
      },
      signal,
    );
  }

  private async performLoad(
    options: BMapLoadOptions,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<LoadedJsapiV4> {
    assertSupportedJsapiV4Version(options, this.id);

    // 页面已存在 v4 全局：直接校验并复用，不再插入 script。
    // 这条捷径是同步成功的，因此必须先把聚合 signal 交给它（见 `reuseExistingJsapiV4`）。
    const reused = reuseExistingJsapiV4({ providerId: this.id, options, fingerprint, signal });
    if (reused) return reused;

    const target = this.scriptSrc;
    const mode = this.mode;
    const callbackName = mode === "jsonp" ? createCallbackName(CALLBACK_PREFIX) : undefined;
    const src = callbackName
      ? appendCallback(target, callbackName, options.callbackParam)
      : target;

    // 成功前校验（必经）：成员完整性 + 版本来源都算「就绪」的一部分。
    // 版本策略与 CDN 不同——自托管入口不由我们拼 `v=`，因此以全局自述为准。
    const assertReady = () => {
      const namespace = requireJsapiV4Global(this.id);
      resolveExistingJsapiV4Version(namespace, this.id, options.version);
    };
    const namespace = await loadJsapiV4Script({
      loader: this.loader,
      providerId: this.id,
      signal,
      loadOptions: callbackName
        ? {
            mode: "jsonp",
            src,
            callbackName,
            callbackParam: options.callbackParam,
            assertReady,
            ...scriptOptions(options),
          }
        : { mode: "load", src, assertReady, ...scriptOptions(options) },
    });

    // 自托管入口不由我们拼 `v=`，因此版本以全局自述为准，读不到才回退声明值。
    const resolved = resolveExistingJsapiV4Version(namespace, this.id, options.version);
    return createLoadedJsapiV4({
      providerId: this.id,
      mode,
      version: resolved.version,
      versionSource: resolved.source,
      options,
      fingerprint,
      apiUrl: src,
      namespace,
    });
  }
}

/** 企业自托管 / 私有入口 Provider 工厂。 */
export function customScriptV4Provider(
  scriptSrc: string,
  options: CustomScriptV4ProviderInternalOptions = {},
): CustomScriptV4Provider {
  return new CustomScriptV4Provider(scriptSrc, options);
}
