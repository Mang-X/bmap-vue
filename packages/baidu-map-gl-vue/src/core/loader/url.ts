/**
 * SDK URL 构造（在线 / 离线 Provider 共用）
 *
 * 目标 SDK 是百度地图 JSAPI 4.0：入口固定
 * `https://api.map.baidu.com/api?v=4.0&ak=...`，加载完成后使用全局 `BMap`，
 * 不再使用旧 `BMapGL` 的 `type=webgl` 参数。
 *
 * - 所有参数经 URL API 构造，保留 apiUrl 上已有的 query；
 * - 支持相对 apiUrl（基于 `document.baseURI`，SSR 回退 localhost）；
 * - 已存在的 `callback` 参数属于冲突项，用本次回调名覆盖而非追加重复参数。
 */

/** JSAPI 4.0 在线入口（不含查询串）。 */
export const DEFAULT_API_URL = "https://api.map.baidu.com/api";

/** Stable 基线版本；4.0 加载器不需要也不允许 `type` 参数。 */
export const DEFAULT_VERSION = "4.0";

/** JSONP 就绪回调的默认参数名。 */
export const DEFAULT_CALLBACK_PARAM = "callback";

export type CrossOriginValue = "anonymous" | "use-credentials";

export type BMapLoadOptions = {
  ak?: string;
  /** 支持相对路径（基于 `document.baseURI` 解析）与已有 query；缺省用在线 CDN。 */
  apiUrl?: string;
  version?: string;
  language?: string;
  timeout?: number;
  /**
   * 代理模式的服务地址（官方 Loader 的 `serviceHost`，末尾需带 `/`，缺了由官方补并 warn）。
   *
   * 官方契约：`ak` 与 `serviceHost` 二选一；代理模式下入口 URL **不带** `ak`，
   * 改由 `window._BMapSecurityConfig = { serviceHost }` 声明。这也是官方 React 封装
   * （`react-bmap` 的 `<BMapProvider serviceHost>`）公开的「隐藏 ak / 走代理」入口。
   */
  serviceHost?: string;
  nonce?: string;
  integrity?: string;
  crossOrigin?: CrossOriginValue;
  referrerPolicy?: ReferrerPolicy;
  /** JSONP 就绪回调的参数名，默认 `callback`。 */
  callbackParam?: string;
};

/** SSR 安全 base：浏览器优先 `document.baseURI`，否则回退 localhost。 */
export function resolveBaseUrl(base?: string): string {
  if (base) return base;
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  return "http://localhost/";
}

/** 浏览器相对 URL 解析：基于 `document.baseURI`，SSR 回退 localhost。 */
export function resolveBrowserUrl(input: string, base?: string): URL {
  return new URL(input, resolveBaseUrl(base));
}

/** 离线 / 私有 apiUrl 兼容：仅追加 callback 参数（保留既有 query）。 */
export function appendCallback(
  url: string,
  callbackName: string,
  callbackParam: string = DEFAULT_CALLBACK_PARAM,
  base?: string,
): string {
  const u = resolveBrowserUrl(url, base);
  u.searchParams.set(callbackParam, callbackName);
  return u.toString();
}

/** 内部：`callbackParam` 为 `null` 表示本次加载**不管理**任何回调参数。 */
function normalizeApiUrlInternal(apiUrl: string | undefined, callbackParam: string | null): string {
  if (!apiUrl) return DEFAULT_API_URL;
  try {
    const url = resolveBrowserUrl(apiUrl);
    if (callbackParam) url.searchParams.delete(callbackParam);
    return url.toString();
  } catch {
    // 非法 URL 交给加载流程报告错误，fingerprint 保留原始输入。
    return apiUrl;
  }
}

/**
 * 归一化 apiUrl 用于 fingerprint：只剔除**本次真正使用的**回调参数，
 * 避免随机回调名污染去重；自定义 callbackParam 时不得连带删除 `callback`。
 */
export function normalizeApiUrl(apiUrl?: string, callbackParam?: string): string {
  return normalizeApiUrlInternal(apiUrl, callbackParam ?? DEFAULT_CALLBACK_PARAM);
}

/**
 * 指纹用的 apiUrl 归一：在 `normalizeApiUrl` 的基础上，把内嵌的 `ak` 参数值换成哈希。
 *
 * 调用方可能把 AK 直接写在 `apiUrl` 里（企业自托管入口很常见），而归一后的 apiUrl 会
 * 进入 fingerprint，fingerprint 又会进入 load metadata 与冲突日志——原样保留即等于
 * 泄漏。这里用哈希而不是掩码：不同 AK 仍必须产生不同指纹，否则冲突会被漏判。
 *
 * @param managedCallbackParam 由 Loader 管理的回调参数名；`null` 表示本次加载不管理
 *   任何回调参数（script `load` 模式），此时 URL 上的 `callback` 只是普通查询参数，
 *   必须参与身份判定，否则两个租户入口会被错误合并。
 */
export function fingerprintApiUrl(
  apiUrl?: string,
  managedCallbackParam: string | null = DEFAULT_CALLBACK_PARAM,
): string {
  const normalized = normalizeApiUrlInternal(apiUrl, managedCallbackParam);
  try {
    const url = resolveBrowserUrl(normalized);
    const embedded = url.searchParams.get("ak");
    if (embedded) url.searchParams.set("ak", hash(embedded));
    // userinfo 与 AK 同属凭据，指纹又会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息 ⇒ 不能带原文。
    // 但**不能**统一抹成同一个值：不同凭据是不同的入口身份，合并会让冲突漏判 ⇒ 换成哈希。
    const userinfo = `${url.username}${url.password ? `:${url.password}` : ""}`;
    if (userinfo) {
      url.username = `***h${hash(userinfo)}`;
      url.password = "";
    }
    return url.toString();
  } catch {
    // 解析不了的入口没法逐项脱敏（`new URL` 直接抛错），而 fingerprint 会进
    // `BMAP_SDK_CONFIG_CONFLICT` 的消息文本 ⇒ 这里**不保留
    // 任何原文**：把整串哈希成不透明标识。身份区分能力保留（不同非法入口仍是不同配置），
    // 泄漏面归零（加载流程仍会用原始输入去报错，那条路径由脱敏函数处理）。
    return `invalid-url:${hash(normalized)}`;
  }
}

/**
 * 读取 URL 里的 userinfo（`user[:pass]@`）；没有则返回 `null`。
 *
 * userinfo 是 HTTP 认证凭据，与 `ak` 同属「不得进日志 / 遥测」的内容：**展示用途**只保留
 * `***@`（见 `maskUserinfo`），**身份用途**只保留哈希（见 `fingerprintApiUrl`）。
 */
export function readUrlUserinfo(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = resolveBrowserUrl(url);
    if (!parsed.username && !parsed.password) return null;
    return `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * 抹掉**文本里**出现的 URL userinfo：`https://user:pass@host/...` → `https://***@host/...`。
 *
 * 错误消息 / 调用栈里嵌的是一整段文本（官方文案 + 栈帧），不是一个纯 URL，所以先按形状匹配
 * （`scheme://` 之后、第一个 `/` 或空白之前的那一段），再按**已知 userinfo** 兜底替换一次，
 * 覆盖连字符编码 / 百分号编码等形状变化。这里宁可多抹一点：错误文本少几个字符可以接受，
 * 凭据漏一次不行。
 */
export function maskUserinfo(text: string, known?: string | null): string {
  let out = text.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/g, "$1***@");
  if (known) out = out.split(known).join("***");
  return out;
}

/**
 * 代理服务地址（`serviceHost`）的**规范形式**：末尾缺 `/` 时补上。
 *
 * 官方 `@baidumap/jsapi-loader@1.0.0` 自己就会这么做（末尾无 `/` 时 warn 后补），补出来的
 * 入口 URL 是同一个，因此 `/svc` 与 `/svc/` 必须算**同一份配置**。指纹与 metadata 共用它，
 * 避免两处口径漂移。
 */
export function canonicalServiceHost(serviceHost: string): string {
  return serviceHost.endsWith("/") ? serviceHost : `${serviceHost}/`;
}

/**
 * 计算配置 fingerprint，用于 SDK Registry 去重 / 冲突检测。
 *
 * 覆盖影响全局 SDK 语义的所有配置（版本、AK、apiUrl、serviceHost、语言）；AK 与
 * serviceHost 仅以哈希出现（指纹会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息，不得外泄原始值）；
 * callback / timeout / nonce 等 script 级细节不参与——**除非**该回调参数不由 Loader 管理
 * （见 `managedCallbackParam`）。
 *
 * @param managedCallbackParam 由 Loader 管理的回调参数名，缺省按 `options.callbackParam`
 *   或 `callback` 推断；传 `null` 表示本次加载不管理回调参数。
 */
export function fingerprintConfig(
  options: BMapLoadOptions,
  managedCallbackParam?: string | null,
): string {
  const managed =
    managedCallbackParam === undefined
      ? (options.callbackParam ?? DEFAULT_CALLBACK_PARAM)
      : managedCallbackParam;
  const parts = [
    `v:${options.version ?? DEFAULT_VERSION}`,
    `ak:${options.ak ? hash(options.ak) : "none"}`,
    `url:${fingerprintApiUrl(options.apiUrl, managed)}`,
  ];
  // 代理地址决定 SDK 从哪个入口加载，属「影响全局语义」的配置：不参与身份判定会让两个不同
  // 代理的请求被当成同一份配置（冲突漏判）。但指纹会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息，
  // 而代理地址可能含内部域名 / 路径 / userinfo / token query——因此**只以哈希
  // 入指纹**（官方 React 封装的 `stableHash({...})` 是同一口径）。
  if (options.serviceHost) {
    parts.push(`host:${hash(canonicalServiceHost(options.serviceHost))}`);
  }
  if (options.language) parts.push(`lang:${options.language}`);
  return parts.join("|");
}

/** 简单字符串哈希(非加密)，只用于 fingerprint 对比，不存储原始值。 */
export function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * 生成一次性 JSONP 回调名（挂到全局的函数名）。
 *
 * 名字只需要在本次加载的生命周期内唯一，`prefix` 用于排障时区分调用方；
 * 加载结束（成功 / 失败 / 取消）由 SharedLoadTask 负责把该全局名释放干净。
 */
export function createCallbackName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
