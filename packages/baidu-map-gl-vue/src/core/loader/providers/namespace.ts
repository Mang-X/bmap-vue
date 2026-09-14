/**
 * JSAPI 4.0 全局命名空间边界
 *
 * 只允许在 Loader / Provider 边界内读取 `globalThis.BMap`。Provider 负责探测、校验与
 * 结构化封装；组件、业务 composable 与 runtime 一律经 Facade Driver 访问，禁止直接
 * 触碰全局（见 `scripts/raw-sdk-boundary.mts`）。
 *
 * 这里只认 JSAPI 4.0 的 `BMap`：读到 `BMapGL` **不算**就绪。旧引擎（`webgl-v1`，读
 * `BMap ?? BMapGL` 的 legacy Provider）已在 `#26` 删除，因此不再有「读到 BMapGL 就走
 * legacy 路径」这条分支——它现在只是一个应当走 `existingGlobalV4Provider()` 的信号。
 */
import { BMapError } from "../../errors/BMapError";
import { DEFAULT_VERSION, type BMapLoadOptions } from "../url";
import type { JsapiV4VersionSource } from "./types";

/** 所有 v4 Provider 共享的进程级冲突域名称。 */
export const JSAPI_V4_DOMAIN = "BMap";

/** v4 命名空间可用的最小成员集合。 */
export const JSAPI_V4_REQUIRED_MEMBERS = ["Map", "Point", "Marker"] as const;

/**
 * 全局对象上的版本探测键。
 *
 * 官方 `@baidumap/jsapi-v4-types@4.0.4` 未声明版本常量，因此这里是**尽力探测**：
 * 探测不到时回退到基线声明值，并由 `versionSource: "declared"` 如实标注。
 *
 * `version` 也列在候选里，但它**只在整个取值确实形如版本号时才作数**：真实 4.0 的
 * `BMap.version` 是构建标记 `"gl"`（#70 实测，见
 * `docs/zh-CN/contributing/official-packages.md`），拿它当版本号会让「宿主预加载 /
 * 同页复用既有全局」这整条路径被判成「不是 JSAPI 4.0」。
 */
export const JSAPI_V4_VERSION_PROBE_KEYS = ["VERSION", "version"] as const;

/**
 * 形如版本号的探测值（`4.0` / `4.0.4`）。
 *
 * 只有这种取值才参与「是不是 4.x」的判定：`"gl"` 这类构建标记、以及任何非纯数字串都
 * 只说明「探测不到版本」，而不是「版本不对」。
 */
const VERSION_NUMBER_SHAPE = /^\d+(\.\d+)*$/;

/** 读取 v4 全局命名空间；未就绪返回 `undefined`。 */
export function readJsapiV4Global(): unknown {
  return (globalThis as { BMap?: unknown }).BMap;
}

/**
 * script 就绪后的命名空间读取：未就绪或结构不完整都抛 `BMAP_SDK_LOAD_FAILED`。
 *
 * 「脚本加载成功但全局命名空间缺失 / 不完整」是 v4 最常见的失败形态，统一在这里
 * 收敛，Provider 不必各写一份。
 *
 * 请把它交给 Loader 的 **`assertReady`**（`assertReady: () => requireJsapiV4Global(id)`），
 * 而**不是** `exportGetter`：`assertReady` 是成功提交前的必经校验，`exportGetter` 只是
 * 「回调没带实参时的取值兜底」，回调带实参时会整段跳过，拿它当校验点会留下绕过路径。
 *
 * 为什么必须在成功提交之前：若放在 Provider `await` 之后，底层已经把这次加载记为成功并
 * 缓存，Provider 侧再失败就只删掉了 registry 条目——重试会命中底层成功缓存、不再插入
 * script，失败的 script 也不会被回收。
 */
export function requireJsapiV4Global(providerId: string): Record<string, unknown> {
  const value = readJsapiV4Global();
  if (value === undefined) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `SDK script resolved but global BMap namespace is missing (provider: ${providerId})`,
      { engine: "jsapi-v4" },
    );
  }
  return assertJsapiV4Namespace(value, providerId);
}

/**
 * v4 Provider 的入口前置校验：显式声明的 `version` 必须属于 4.x。
 *
 * CDN 入口固定 `v=4.0`（见 ADR 2026-09-10），这里把「调用方要求别的版本」变成显式
 * 失败，而不是静默按 4.0 加载、或用非 4.0 的指纹污染冲突域。
 */
export function assertSupportedJsapiV4Version(
  options: Pick<BMapLoadOptions, "version">,
  providerId: string,
): void {
  if (options.version) assertJsapiV4Version(options.version, providerId);
}

/** 缺少的最小成员；空数组表示结构满足要求。 */
export function findMissingJsapiV4Members(value: unknown): string[] {
  if (value === null || value === undefined) return [...JSAPI_V4_REQUIRED_MEMBERS];
  if (typeof value !== "object" && typeof value !== "function") {
    return [...JSAPI_V4_REQUIRED_MEMBERS];
  }
  const namespace = value as Record<string, unknown>;
  return JSAPI_V4_REQUIRED_MEMBERS.filter(
    (member) => namespace[member] === undefined || namespace[member] === null,
  );
}

export function isJsapiV4Namespace(value: unknown): boolean {
  return findMissingJsapiV4Members(value).length === 0;
}

/**
 * 校验并返回命名空间。缺成员时抛 `BMAP_SDK_LOAD_FAILED`（可重试），消息里带上
 * provider 与缺失成员，便于定位「脚本加载成功但命名空间不完整」这一类问题。
 */
export function assertJsapiV4Namespace(
  value: unknown,
  providerId: string,
): Record<string, unknown> {
  const missing = findMissingJsapiV4Members(value);
  if (missing.length > 0) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `JSAPI 4.0 namespace is incomplete (provider: ${providerId}); missing member(s): ${missing.join(", ")}`,
      { engine: "jsapi-v4" },
    );
  }
  return value as Record<string, unknown>;
}

/** 从全局对象尽力读取版本号字符串；读不到（含非版本号形状的取值）返回 `undefined`。 */
export function probeJsapiV4Version(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const namespace = value as Record<string, unknown>;
  for (const key of JSAPI_V4_VERSION_PROBE_KEYS) {
    const found = namespace[key];
    if (typeof found === "string" && VERSION_NUMBER_SHAPE.test(found)) return found;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* 失败残留标记                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 本 realm 内「由本库某次加载产生、但未通过校验」的全局对象。
 *
 * 用来区分两种残缺全局：
 * - **宿主预先提供**的全局残缺 → 明确失败，不替宿主做决定；
 * - **本库本次加载留下**的残缺残留（例如脚本先补了部分成员、或加载本身失败）
 *   → 不该阻断重试，调用方应能重新插入 script。
 *
 * 只按对象身份记录，用 `WeakSet` 不阻止回收；**从不删除**任何全局对象。
 *
 * 存储放在 realm 共享的 `globalThis[Symbol.for(...)]` 上（与 `SdkRegistry` 同一模式）：
 * 全局命名空间本身是**进程级**资源，同页可能存在多份独立打包的库副本，如果残留标记是
 * 模块局部状态，副本 A 留下的残留对副本 B 不可见——B 会把残缺全局当成宿主全局拒绝，
 * 于是一次失败后再也无法重试。共享范围必须与它描述的对象一致。
 */
const REJECTED_GLOBALS_SYMBOL = Symbol.for("baidu-map-gl-vue.rejected-jsapi-v4-globals");

type GlobalWithRejectedGlobals = typeof globalThis & {
  [REJECTED_GLOBALS_SYMBOL]?: WeakSet<object>;
};

/** 取 realm 共享的残留存储（不存在则创建）。 */
function rejectedGlobalStore(): WeakSet<object> {
  const scope = globalThis as GlobalWithRejectedGlobals;
  return (scope[REJECTED_GLOBALS_SYMBOL] ??= new WeakSet<object>());
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** 标记一个全局对象为「本库本次加载产生的残缺残留」。 */
export function markRejectedJsapiV4Global(value: unknown): void {
  if (isObjectLike(value)) rejectedGlobalStore().add(value);
}

export function isRejectedJsapiV4Global(value: unknown): boolean {
  return isObjectLike(value) && rejectedGlobalStore().has(value);
}

/** 仅测试使用：重置 realm 共享的残留标记（所有库副本共用同一存储）。 */
export function resetRejectedJsapiV4GlobalsForTests(): void {
  (globalThis as GlobalWithRejectedGlobals)[REJECTED_GLOBALS_SYMBOL] = new WeakSet<object>();
}

/**
 * 校验版本号确实属于 JSAPI 4.0（Stable 单引擎基线）。
 * 不匹配即失败——否则会把 `BMapGL` / 3.0 时代的全局当成 v4 使用。
 */
export function assertJsapiV4Version(version: string, providerId: string): string {
  if (!/^4(\.|$)/.test(version)) {
    throw new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `SDK version "${version}" is not JSAPI 4.0 (provider: ${providerId})`,
      { engine: "jsapi-v4", version },
    );
  }
  return version;
}

/**
 * 解析「已存在全局」的版本来源。
 *
 * - 探测到版本 → 校验必须是 `4.x`，来源标注 `global`；
 * - 完全探测不到 → 回退调用方声明值（再退基线 `4.0`），标注 `declared`。
 */
export function resolveExistingJsapiV4Version(
  namespace: unknown,
  providerId: string,
  declaredVersion?: string,
): { version: string; source: JsapiV4VersionSource } {
  const probed = probeJsapiV4Version(namespace);
  if (!probed) return { version: declaredVersion ?? DEFAULT_VERSION, source: "declared" };
  return { version: assertJsapiV4Version(probed, providerId), source: "global" };
}
