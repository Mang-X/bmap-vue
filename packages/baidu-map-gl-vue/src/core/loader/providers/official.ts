/**
 * 官方 Loader 适配边界（R25-B / issue #71）
 *
 * 默认在线加载**只有一条实现**：官方 `@baidumap/jsapi-loader`。本文件是本库与它之间的
 * 唯一边界，把「官方契约」翻译成本库的领域类型，并把本条路径允许 / 禁止什么写成可单测的规则。
 *
 * 为什么要有这一层，而不是在 Provider 里直接调官方 `load()`：
 *
 * 1. **选项口径**：`BMapLoadOptions` 是跨 Provider 的公共形状，比官方 Loader 的参数表大。
 *    上游没有入口的配置（`nonce` / `integrity` / `crossOrigin` / `referrerPolicy` /
 *    `apiUrl` / `callbackParam` / `language`）必须**显式报错**——「接收后忽略」是假支持
 *    （ADR 2026-09-13 决策 7）；
 * 2. **错误口径**：官方抛的是带 `[bmap-loader]` 前缀的普通 `Error`，消息里含入口 URL
 *    ⇒ 含 `ak=`。必须在这里收敛成 `BMAP_*` 码并**脱敏**，否则 AK 会经错误信息外泄；
 * 3. **注入点**：官方 `load()` 是模块级单例，单测里需要替身，因此以接口形式注入。
 *
 * 本层**不做**这些事（都属官方 Loader 自有语义，重复一份就是两套状态机）：
 * 组装入口 URL、管 script 单例、挂 / 收 JSONP 回调、判超时、判「同页版本 / AK 冲突」、
 * 复用已存在的全局。参见 `docs/zh-CN/contributing/official-packages.md` 的契约表。
 */
import { load as loadOfficialJsapi } from "@baidumap/jsapi-loader";
import { redactAk } from "../../logger";
import { BMapError } from "../../errors/BMapError";
import {
  DEFAULT_API_URL,
  DEFAULT_VERSION,
  canonicalServiceHost,
  maskUserinfo,
  readUrlUserinfo,
  resolveBrowserUrl,
  type BMapLoadOptions,
} from "../url";
import { assertJsapiV4Namespace, readJsapiV4Global } from "./namespace";

/**
 * 官方 Loader 唯一能加载的 v4 版本号（`BMapVersion = '3.0' | 'gl' | '4.0'`）。
 *
 * 用字面量类型而不是 `string`：这一层的职责就是保证传给官方的一定落在它的版本表内，
 * 类型上也不该允许别的值溜过去。类型由这个常量派生，避免同一字面量写两遍。
 */
export const OFFICIAL_V4_VERSION = "4.0";

export type OfficialJsapiV4Version = typeof OFFICIAL_V4_VERSION;

/**
 * 官方 Loader 的加载选项（`types/index.d.ts` 的 `BMapLoaderOptions` 子集）。
 *
 * 只声明本库公共配置真的能表达的字段：`protocol` / `globalConfig` 目前没有对应的公共配置入口，
 * 声明了也没有调用方——需要时按「新增公共配置」单独讨论，而不是在这里预留。
 * 刻意**不**直接引用官方包的类型：那会把上游类型拖进本包的公共声明。
 */
export interface OfficialJsapiLoadOptions {
  readonly ak?: string;
  readonly version: OfficialJsapiV4Version;
  readonly timeout: number;
  /** 代理模式服务地址；与 `ak` 二选一，设置后入口 URL 不带 `ak`。 */
  readonly serviceHost?: string;
}

/**
 * 官方 `load()` 的注入点。
 *
 * 默认实现就是官方具名导出；单测可以换成不碰 DOM / 网络的替身。
 * 刻意只暴露 `load`：`reset()` 是**进程级**破坏性操作（会 `delete window.BMap` /
 * `BMapGL`），组件生命周期里任何一处都不许调用它（ADR 决策 6），所以它不进这个接口。
 */
export interface OfficialJsapiLoader {
  load(options: OfficialJsapiLoadOptions): Promise<unknown>;
}

/** 默认实现：官方 `@baidumap/jsapi-loader@1.0.0` 的具名 `load`。 */
export const officialJsapiLoader: OfficialJsapiLoader = {
  load: (options) => loadOfficialJsapi({ ...options }),
};

/**
 * 默认路径**没有对应上游入口**的 `BMapLoadOptions` 字段。
 *
 * 顺序即报错信息里的列举顺序；`docs/zh-CN/contributing/official-packages.md`
 * 的「不支持项」表与测试共用这一份口径。
 */
export const OFFICIAL_LOADER_UNSUPPORTED_KEYS = [
  "nonce",
  "integrity",
  "crossOrigin",
  "referrerPolicy",
  "apiUrl",
  "callbackParam",
  "language",
] as const;

export type OfficialLoaderUnsupportedKey = (typeof OFFICIAL_LOADER_UNSUPPORTED_KEYS)[number];

/** 每个不支持项对应的**合法替代**（报错信息必须给出下一步，否则调用方只能猜）。 */
const UNSUPPORTED_GUIDANCE: Record<OfficialLoaderUnsupportedKey, string> = {
  nonce:
    "上游 Loader 1.0.0 没有 nonce 入口；请自行预加载 SDK 后改用 existingGlobalV4Provider()",
  integrity:
    "上游 Loader 1.0.0 没有 integrity 入口；请自行预加载 SDK 后改用 existingGlobalV4Provider()",
  crossOrigin:
    "上游 Loader 1.0.0 没有 crossOrigin 入口；请自行预加载 SDK 后改用 existingGlobalV4Provider()",
  referrerPolicy:
    "上游 Loader 1.0.0 没有 referrerPolicy 入口；请自行预加载 SDK 后改用 existingGlobalV4Provider()",
  apiUrl:
    "默认路径的入口 URL 由官方 Loader 决定（恒为 api.map.baidu.com）；企业自托管 / 非标准资源请改用 customScriptV4Provider(scriptSrc)",
  callbackParam:
    "默认路径的就绪信号由官方 Loader 自管（callback 参数名固定）；非标准入口请改用 customScriptV4Provider(scriptSrc, { mode: 'jsonp' })",
  language:
    "上游 Loader 1.0.0 不会把 language 写进入口 URL；需要多语言入口请自行预加载后改用 existingGlobalV4Provider()",
};

/** 「有实义取值」：`undefined` / `null` / 空串都按未设置处理。 */
function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * 把本库的加载配置映射为官方 Loader 选项；**遇到上游没有入口的配置直接抛错**。
 *
 * 调用时机必须在任何加载动作之前：这样「配置不可表达」不会先插入 script 再失败。
 */
export function toOfficialLoadOptions(
  options: BMapLoadOptions,
  providerId: string,
): OfficialJsapiLoadOptions {
  const unsupported = OFFICIAL_LOADER_UNSUPPORTED_KEYS.filter((key) => hasValue(options[key]));
  if (unsupported.length > 0) {
    const detail = unsupported
      .map((key) => `「${key}」：${UNSUPPORTED_GUIDANCE[key]}`)
      .join("；");
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `默认加载路径（${providerId}）无法表达这些配置，已显式拒绝而不是忽略——${detail}`,
      { engine: "jsapi-v4" },
    );
  }

  const version = options.version ?? DEFAULT_VERSION;
  // 官方只认 '4.0' 一个 v4 版本号；`4.1` / `4.0.4` 这类值无法表达，不能静默按 4.0 加载。
  if (version !== OFFICIAL_V4_VERSION) {
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `默认加载路径（${providerId}）只支持官方 Loader 的 version '${OFFICIAL_V4_VERSION}'，收到「${version}」；` +
        "需要其它版本入口请改用 customScriptV4Provider(scriptSrc)",
      { engine: "jsapi-v4", version },
    );
  }

  return {
    ak: options.ak,
    version: OFFICIAL_V4_VERSION,
    // `timeout` 是官方**支持**的参数：`0` = 不超时（不是「用默认值」），必须原样传递。
    timeout: options.timeout ?? 0,
    // `serviceHost` 同样是官方支持的参数（代理模式，与 `ak` 二选一）。原样传递：末尾斜杠
    // 由官方补并 warn，本库不代它归一化，避免与官方行为产生第二套口径。
    ...(hasValue(options.serviceHost) ? { serviceHost: options.serviceHost as string } : {}),
  };
}

/** 官方超时文案：`JSAPI 加载超时(<n>ms)`。 */
const OFFICIAL_TIMEOUT_PATTERN = /加载超时/;

/**
 * 上游错误 → 本库结构化错误。
 *
 * 两件事：① 按官方文案区分超时与其它失败；② **脱敏**——官方消息里带入口 URL，而入口 URL 可能
 * 带 `ak=` 或 userinfo（代理入口的 HTTP 认证）。已知值时按值替换，未知时按形状替换。
 *
 * `cause` 也必须脱敏：`BMapError.cause` 是**对外**暴露的（`toJSON()` 会带上它，Sentry /
 * OpenTelemetry 这类上报工具还会直接读 `cause.message`）。因此这里不把上游的 Error 原样挂上去，
 * 而是留一份**只含脱敏文本**的副本（保留上游的 `name` 以便定位是哪一层的错误）。
 */
export function toOfficialLoadError(error: unknown, options: BMapLoadOptions): BMapError {
  const knownAk = hasValue(options.ak) ? options.ak! : null;
  const knownUserinfo = readUrlUserinfo(options.serviceHost) ?? readUrlUserinfo(options.apiUrl);
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactAk(maskUserinfo(raw, knownUserinfo), knownAk);
  const code = OFFICIAL_TIMEOUT_PATTERN.test(raw) ? "BMAP_SDK_LOAD_TIMEOUT" : "BMAP_SDK_LOAD_FAILED";
  return new BMapError(code, message, {
    cause: sanitizeUpstreamCause(error, message, knownAk, knownUserinfo),
    engine: "jsapi-v4",
  });
}

/** 生成可安全外泄的上游错误副本：上游 `name` + 已脱敏的 `message` / `stack`。 */
function sanitizeUpstreamCause(
  error: unknown,
  redactedMessage: string,
  knownAk: string | null,
  knownUserinfo: string | null,
): Error {
  const upstream = error instanceof Error ? error : undefined;
  const cause = new Error(redactedMessage);
  if (upstream?.name) cause.name = upstream.name;
  // stack 的首行就是原始 message，因此它同样要过脱敏；保留它只是为了不丢失调用栈信息。
  if (upstream?.stack) {
    cause.stack = redactAk(maskUserinfo(upstream.stack, knownUserinfo), knownAk);
  }
  return cause;
}

/**
 * 判定「官方这次加载真的把可用的 v4 命名空间交出来了」。
 *
 * 为什么不能只看 Promise resolve：官方 v4 路径 resolve 的是它从 `window.BMap` 读到的值，
 * 而**脚本加载成功但没定义命名空间**时它同样 resolve（值为 `undefined`）。若照单全收，
 * 残缺 / 空命名空间会被当成成功结果缓存，后续所有消费者都拿到不可用的 SDK。
 *
 * 结算值优先、全局兜底：官方契约里两者本应是同一个对象，但「脚本已执行完、结算值尚未
 * 反映」的时序下以当下全局为准更贴近事实。这里**不**参考 `isRejectedJsapiV4Global` 的残留
 * 标记：那个标记的含义是「不要把它当成宿主预先提供的全局来短路加载」，而此刻我们本就
 * 刚加载过一轮——只要它**现在**结构完整，就是可用命名空间。
 */
export function resolveOfficialNamespace(
  resolved: unknown,
  providerId: string,
): Record<string, unknown> {
  try {
    return assertJsapiV4Namespace(resolved, providerId);
  } catch (error) {
    const current = readJsapiV4Global();
    if (current !== undefined && current !== resolved) {
      return assertJsapiV4Namespace(current, providerId);
    }
    throw error;
  }
}

/**
 * 本次请求是否走**代理入口**（官方 `serviceHost` 模式）。
 *
 * 代理模式下官方 Loader 的入口是 `<serviceHost>/api?v=4.0`，且 **URL 不带 `ak`**
 * （`ak` 与 `serviceHost` 二选一，见官方 `L()` 的 `if (!serviceHost && ak) push ak`）。
 * metadata 构造与 `akRef` 都以此为准，避免「声称请求了 CDN / 声称 AK 生效了」。
 */
export function usesProxyEntry(options: BMapLoadOptions): boolean {
  return hasValue(options.serviceHost);
}

/**
 * metadata 视角的加载配置：代理模式下摘掉 `ak`。
 *
 * `createLoadedJsapiV4()` 会按「入口 URL 里的 ak → 否则 options.ak」决定 `akRef`；代理入口
 * 不带 ak，因此不摘掉就会得到 `akRef: "***3456"`，让人以为 AK 参与了实际入口。
 */
export function officialMetadataOptions(options: BMapLoadOptions): BMapLoadOptions {
  return usesProxyEntry(options) ? { ...options, ak: undefined } : options;
}

/**
 * 本次请求的入口 URL，只用于 load metadata。
 *
 * 与官方 `1.0.0` 的入口拼法一致（`dist/index.mjs` 的 `L()`）：
 * - 非代理：`{protocol://api.map.baidu.com/}api?v=4.0&ak=...&callback=<自增序号>`；
 * - 代理：`{serviceHost}/api?v=4.0&callback=<自增序号>`（**不带 ak**；末尾 `/` 官方会补）。
 *
 * 除上面这条已由 #70 契约锁验证过的形状外，本库不复制官方的其它 URL 规则：**不写 `callback`**
 * ——回调名是官方每次调用自增的实现细节，不参与配置身份，写进 metadata 只会制造无意义差异。
 * 值里出现的 AK 与 userinfo 由 `createLoadedJsapiV4()` 统一脱敏。
 */
export function officialEntryUrl(options: BMapLoadOptions): string {
  if (usesProxyEntry(options)) {
    const url = resolveBrowserUrl(`${canonicalServiceHost(options.serviceHost as string)}api`);
    url.searchParams.set("v", options.version ?? DEFAULT_VERSION);
    return url.toString();
  }
  const url = resolveBrowserUrl(DEFAULT_API_URL);
  url.searchParams.set("v", options.version ?? DEFAULT_VERSION);
  if (options.ak && !url.searchParams.has("ak")) url.searchParams.set("ak", options.ak);
  return url.toString();
}
