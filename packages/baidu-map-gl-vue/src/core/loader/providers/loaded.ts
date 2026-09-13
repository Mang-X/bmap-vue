/**
 * LoadedJsapiV4 组装
 *
 * 三个 v4 Provider 共用同一套 metadata 构造，保证「engine / version / namespace /
 * load metadata」的形状、脱敏规则与来源标注完全一致，不会随 Provider 漂移。
 */
import { redactAk } from "../../logger";
import {
  maskUserinfo,
  normalizeApiUrl,
  readUrlUserinfo,
  resolveBrowserUrl,
  type BMapLoadOptions,
} from "../url";
import { JSAPI_V4_DOMAIN } from "./namespace";
import type {
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4ProviderId,
  JsapiV4VersionSource,
  LoadedJsapiV4,
} from "./types";

/** 复用页面已有全局时，metadata 中入口 URL 的占位值。 */
export const EXISTING_GLOBAL_URL = "existing-global";

/** AK 引用：只保留末四位。 */
export function akRef(ak?: string): string {
  return ak ? `***${ak.slice(-4)}` : "none";
}

/** 读取 URL 里的 `ak` 参数值；没有则返回 `undefined`。 */
function readAkParam(url: string): string | undefined {
  try {
    return resolveBrowserUrl(url).searchParams.get("ak") ?? undefined;
  } catch {
    // 非法 URL：交给其它脱敏路径处理。
    return undefined;
  }
}

/**
 * URL 脱敏，三条路径都要走：
 *
 * 0. **抹掉 userinfo**——代理 / 自托管入口可能带 HTTP 认证凭据（与 AK 同类）；
 * 1. **按 URL 参数**脱敏真实的 `ak`——入口自带 AK 时它以 URL 为准，此时 `options.ak`
 *    可能完全是另一个值，只做「替换已知 AK 字符串」会把它整段漏出去；
 * 2. 再兜底替换已知 AK 字符串（可能出现在路径、其它参数或无法解析的 URL 中）。
 */
function redactUrl(url: string, ak?: string): string {
  if (!url) return url;
  const withoutUserinfo = maskUserinfo(url, readUrlUserinfo(url));
  let redacted = withoutUserinfo;
  const embedded = readAkParam(withoutUserinfo);
  if (embedded) {
    try {
      const parsed = resolveBrowserUrl(withoutUserinfo);
      parsed.searchParams.set("ak", akRef(embedded));
      redacted = parsed.toString();
    } catch {
      /* 非法 URL 走第 2 步 */
    }
  }
  // AK 过短（不可能是真实 AK）或未知时退回模式匹配，避免误伤 URL。
  return redactAk(redacted, ak && ak.length >= 6 ? ak : null);
}

export interface CreateLoadedJsapiV4Input {
  readonly providerId: JsapiV4ProviderId;
  readonly mode: JsapiV4LoadMode;
  readonly version: string;
  readonly versionSource: JsapiV4VersionSource;
  readonly options: BMapLoadOptions;
  readonly fingerprint: string;
  readonly namespace: unknown;
  /** 本次真正请求的入口 URL；缺省按 `options.apiUrl` 归一。 */
  readonly apiUrl?: string;
  /** 测试注入时钟。 */
  readonly loadedAt?: number;
}

export function createLoadedJsapiV4(input: CreateLoadedJsapiV4Input): LoadedJsapiV4 {
  const { options } = input;
  const source = input.apiUrl ?? options.apiUrl;
  const normalized = source ? normalizeApiUrl(source, options.callbackParam) : EXISTING_GLOBAL_URL;
  // URL 自带 AK 时会覆盖 `options.ak`，`akRef` 必须反映真正生效的那一个。
  const embeddedAk = readAkParam(normalized);
  const metadata: JsapiV4LoadMetadata = {
    providerId: input.providerId,
    domain: JSAPI_V4_DOMAIN,
    mode: input.mode,
    versionSource: input.versionSource,
    apiUrl: redactUrl(normalized, options.ak),
    akRef: embeddedAk ? akRef(embeddedAk) : akRef(options.ak),
    fingerprint: input.fingerprint,
    loadedAt: input.loadedAt ?? Date.now(),
  };
  return {
    engine: "jsapi-v4",
    version: input.version,
    namespace: input.namespace as LoadedJsapiV4["namespace"],
    load: metadata,
  };
}
