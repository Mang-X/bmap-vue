/**
 * ExistingGlobalV4Provider —— 复用页面里已经存在的 JSAPI 4.0 全局
 *
 * 用于「入口由宿主页面 / 其他构建工具负责，本库只消费」的场景。与 legacy
 * `existingGlobalProvider()` 的宽松探测不同，v4 Provider 必须**校验**：
 * - 结构：命名空间至少包含 `Map` / `Point` / `Marker`，缺一即失败；
 * - 版本来源：能从全局探测到版本时必须形如 `4.x`（Stable 只支持单引擎），
 *   探测不到则标注 `versionSource: "declared"`，不假装知道版本。
 *
 * 已知限制：复用已有全局时无法反查它当初用的 AK / 版本，只能按本次请求的指纹登记，
 * 因此这条路径不会产生配置冲突（决策见 ADR 2026-09-10-sdk-conflict-domain）。
 * 它仍经由进程级 `BMap` 冲突域加载，能与 CDN / Custom Provider 共享后续冲突判定。
 */
import { BMapError } from "../../errors/BMapError";
import { SdkRegistry, getProcessSdkRegistry } from "../SdkRegistry";
import type { BMapLoadOptions } from "../url";
import { fingerprintConfig } from "../url";
import { JSAPI_V4_DOMAIN, assertSupportedJsapiV4Version } from "./namespace";
import { reuseExistingJsapiV4 } from "./reuse";
import type { JsapiV4Provider, JsapiV4ProviderOptions, LoadedJsapiV4 } from "./types";

export class ExistingGlobalV4Provider implements JsapiV4Provider {
  readonly id = "existing-global-v4" as const;
  private readonly domain: SdkRegistry;

  constructor(options: JsapiV4ProviderOptions = {}) {
    this.domain =
      options.registry ?? getProcessSdkRegistry(JSAPI_V4_DOMAIN, { domain: JSAPI_V4_DOMAIN });
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig(options);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4> {
    const fingerprint = fingerprintConfig(options);
    return this.domain.load<LoadedJsapiV4>(
      {
        fingerprint,
        // 这里的「加载」只是同步采纳页面已有的全局，没有任何可取消的底层工作 ⇒ 按
        // `cancellable: true` 的约定执行：聚合 signal abort 之后不得再成功结算。
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
    const reused = reuseExistingJsapiV4({ providerId: this.id, options, fingerprint, signal });
    if (reused) return reused;
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      "global JSAPI 4.0 namespace (BMap) is not present",
      { engine: "jsapi-v4" },
    );
  }
}

/** 复用既有 v4 全局的 Provider 工厂。 */
export function existingGlobalV4Provider(
  options: JsapiV4ProviderOptions = {},
): ExistingGlobalV4Provider {
  return new ExistingGlobalV4Provider(options);
}
