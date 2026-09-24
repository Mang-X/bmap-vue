/**
 * JSAPI 4.0 Driver 内部边界（M3A2-01 / issue #19）
 *
 * 官方全局命名空间（`globalThis.BMap`）只允许在 Driver / Provider 边界读取；本文件把
 * 「读到的到底是不是一个可用的 4.0 命名空间」与「怎么安全地拿构造器 / 调用成员」收敛
 * 成两件事，后续 Map / Overlay / Layer / Service Facet（#20~#23）都复用这里，不再各自
 * 探测成员。
 *
 * 刻意**不引用官方类型包**：Driver 内部只按结构化形状访问 raw 对象，因此
 * `BMap.*` 类型与 `typeof BMap` 既不出现在实现里，也不会进入公共声明产物
 * （见 ADR 2026-09-10-bmap-raw-sdk-boundary 与 `scripts/check-public-dts.mts`）。
 *
 * 与 `core/loader/providers/namespace.ts` 的分工：
 * - Loader 侧只校验「加载是否成功」的最低集合（`Map` / `Point` / `Marker`），失败语义是
 *   可重试的 `BMAP_SDK_LOAD_FAILED`；
 * - 本文件校验「Driver 干活所需的集合」（含 `Pixel` / `Size` / `Bounds`），失败语义是
 *   `BMAP_SDK_CALL_FAILED`——加载成功但缺成员属于 SDK 边界不可用，重试没有意义。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import type { SdkHandle } from "../types/handles";
import type { OverlayTarget } from "../types/overlays";

/** SDK 构造器：只按 `new (...args)` 使用，不引入官方类型。 */
export type JsapiV4Ctor = new (...args: any[]) => unknown;

/**
 * Driver 干活所需的最小 v4 命名空间形状。
 *
 * 刻意**不加字符串索引签名**：这样 `typeof BMap extends JsapiV4Namespace` 才能作为
 * 「官方类型包是否仍提供这些成员」的编译期断言（见文件末尾）。需要读取额外成员时
 * 显式补进 `JSAPI_V4_DRIVER_MEMBERS`，而不是靠索引签名绕开类型检查。
 */
export interface JsapiV4Namespace {
  readonly Map: JsapiV4Ctor;
  readonly Point: JsapiV4Ctor;
  readonly Pixel: JsapiV4Ctor;
  readonly Size: JsapiV4Ctor;
  readonly Bounds: JsapiV4Ctor;
}

/** Driver 边界要求存在的成员（顺序即错误信息的报告顺序）。 */
export const JSAPI_V4_DRIVER_MEMBERS = ["Map", "Point", "Pixel", "Size", "Bounds"] as const;

export type JsapiV4DriverMember = (typeof JSAPI_V4_DRIVER_MEMBERS)[number];

/** 对象或函数：SDK 的构造器与实例都可能以函数形态出现，统一按「可作 WeakMap 键」判定。 */
export function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * 缺失的驱动成员；空数组表示形状满足要求。
 *
 * 成员必须是构造器（`typeof === "function"`）：只判「属性存在」会放过
 * `{ Point: undefined }` 这类半成品命名空间，把错误推迟到第一次 `new` 才暴露。
 */
export function findMissingNamespaceMembers(value: unknown): JsapiV4DriverMember[] {
  if (!isObjectLike(value)) return [...JSAPI_V4_DRIVER_MEMBERS];
  const namespace = value as Record<string, unknown>;
  return JSAPI_V4_DRIVER_MEMBERS.filter((member) => typeof namespace[member] !== "function");
}

export function isJsapiV4Namespace(value: unknown): value is JsapiV4Namespace {
  return findMissingNamespaceMembers(value).length === 0;
}

/** 校验并返回命名空间；缺成员抛 `BMAP_SDK_CALL_FAILED`（不可重试）。 */
export function assertJsapiV4Namespace(value: unknown): JsapiV4Namespace {
  const missing = findMissingNamespaceMembers(value);
  if (missing.length > 0) {
    throw new BMapError(
      "BMAP_SDK_CALL_FAILED",
      `JSAPI 4.0 命名空间缺少 Driver 必需成员: ${missing.join(", ")}`,
      { engine: "jsapi-v4" },
    );
  }
  return value as JsapiV4Namespace;
}

/** 读取命名空间成员；缺失（`undefined` / `null`）返回 `undefined`。 */
export function readNamespaceMember(namespace: unknown, member: string): unknown {
  if (!isObjectLike(namespace)) return undefined;
  const value = (namespace as Record<string, unknown>)[member];
  return value === null ? undefined : value;
}

/** 取构造器；不存在或不是函数时抛 `BMAP_SDK_CALL_FAILED`。 */
export function namespaceCtor(namespace: unknown, member: string): JsapiV4Ctor {
  const ctor = readNamespaceMember(namespace, member);
  if (typeof ctor !== "function") {
    throw new BMapError("BMAP_SDK_CALL_FAILED", `BMap.${member} is not available`, {
      engine: "jsapi-v4",
    });
  }
  return ctor as JsapiV4Ctor;
}

/** 把 SDK 调用异常归一为结构化错误，并保留原始 cause。 */
export function sdkCall<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new BMapError(
      "BMAP_SDK_CALL_FAILED",
      `${label} failed: ${(error as Error)?.message ?? String(error)}`,
      { cause: error, engine: "jsapi-v4" },
    );
  }
}

/**
 * 可选方法调用：方法不存在时静默返回 `undefined`。
 *
 * 只在「4.0 各版本间可选」的成员上使用；驱动必需成员一律走 `namespaceCtor`，
 * 避免把版本差异误当成「不支持」而被静默吞掉。
 */
export function callOptional(instance: unknown, method: string, ...args: unknown[]): unknown {
  const fn = readNamespaceMember(instance, method);
  if (typeof fn === "function") {
    return (fn as (...a: unknown[]) => unknown).apply(instance, args);
  }
  return undefined;
}

/**
 * 必需方法调用：成员缺失抛 `BMAP_SDK_CALL_FAILED`，调用异常由 `sdkCall` 归一。
 *
 * 与 `callOptional` 的分工是「失败是否可接受」：读视图状态（`getCenter` / `getBounds`）
 * 这类无法用缺省值代替的调用必须显式失败，否则会把「SDK 缺成员」伪装成「读到了空值」。
 */
export function callRequired(instance: unknown, method: string, ...args: unknown[]): unknown {
  const fn = readNamespaceMember(instance, method);
  if (typeof fn !== "function") {
    throw new BMapError("BMAP_SDK_CALL_FAILED", `SDK 实例缺少方法 ${method}()`, {
      engine: "jsapi-v4",
    });
  }
  return sdkCall(method, () => (fn as (...a: unknown[]) => unknown).apply(instance, args));
}

/**
 * 结构性查找「官方类型包没有声明」的运行时扩展构造器（Overlay / Layer Facet 共用）。
 *
 * 不预判版本、也不臆造 augmentation：有就按结构返回，没有就由调用方给的 `onMissing`
 * 告警一次并抛 `BMAP_CAPABILITY_UNSUPPORTED`（显式失败，不是静默降级）。
 * 与 `namespaceCtor` 的分工：后者用于**类型包已声明**的构造器，失败语义是
 * `BMAP_SDK_CALL_FAILED`（加载成功却缺成员）。
 */
export function requireRuntimeCtor(
  namespace: unknown,
  name: string,
  onMissing: (message: string) => void,
): JsapiV4Ctor {
  const ctor = readNamespaceMember(namespace, name);
  if (typeof ctor === "function") return ctor as JsapiV4Ctor;
  onMissing(
    `当前 SDK 运行时没有提供 ${name}（@baidumap/jsapi-v4-types@4.0.4 也没有它的类声明），` +
      "该能力无法创建",
  );
  throw new BMapError(
    "BMAP_CAPABILITY_UNSUPPORTED",
    `BMap.${name} is not available（当前运行时没有提供该构造器）`,
    { engine: "jsapi-v4" },
  );
}

/**
 * 每个 Facet Driver 一份的「告警一次」记录。
 *
 * 同一个问题（同一个 kind 的同一个键、同一个缺失成员）只刷一条日志：既保留可观测性，
 * 又不会在响应式更新里把控制台刷满。键由调用方给，通常形如 `<kind>:<policy>:<key>`。
 */
export function createWarnOnce(): (key: string, message: string) => void {
  const warned = new Set<string>();
  return (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
  };
}

/**
 * 「重复挂载只挂一次」的记账（Overlay / Control / Layer Facet 共用）。
 *
 * SDK **不保证** `addControl` / `addLayer` 去重（官方「常见错误」把「同一实例重复添加」
 * 列为误用），因此这条不变式由 Driver 自己保证：
 * `claim()` 返回 false 表示已挂过，调用方**不要**再调 SDK；`release()` 在移除后清记账，
 * 使「remove 之后可以重新挂载」成立。
 */
export interface MountTracker {
  claim(parent: object, child: object): boolean;
  release(parent: object, child: object): void;
}

export function createMountTracker(): MountTracker {
  const mounted = new WeakMap<object, WeakSet<object>>();
  return {
    claim(parent, child) {
      let children = mounted.get(parent);
      if (!children) {
        children = new WeakSet<object>();
        mounted.set(parent, children);
      }
      if (children.has(child)) return false;
      children.add(child);
      return true;
    },
    release(parent, child) {
      mounted.get(parent)?.delete(child);
    },
  };
}

/**
 * Map 目标守卫工厂：v4 的控件 / 图层只能挂到 Map。
 *
 * 非 Map 目标显式失败（`BMAP_CAPABILITY_UNSUPPORTED`）而不是让 SDK 调用变成静默 no-op；
 * 同时 `warn` 一次保证「组件 catch 了挂载异常」时仍可观测（与 Overlay Facet 对
 * `<ContextMenu>` 挂 Marker 的处理同源）。
 */
export function createMapTargetResolver(options: {
  /** Driver 名，用于告警与错误信息（例：`ControlDriver`）。 */
  facet: string;
  /** 该 Facet 的挂载入口描述（例：`map.addControl / removeControl`）。 */
  entry: string;
  resolve: (handle: SdkHandle<string>) => object;
  warn: (key: string, message: string) => void;
}): (target: OverlayTarget, operation: string) => object {
  const { facet, entry, resolve, warn } = options;
  return (target, operation) => {
    if (target.kind !== "map") {
      warn(
        `target:${target.kind}`,
        `${facet}.${operation}: JSAPI 4.0 的该资源只能挂到 Map（${entry}）；` +
          `目标 kind="${target.kind}" 没有运行时入口，本次调用被拒绝`,
      );
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `${facet}.${operation}: target.kind="${target.kind}" 在 JSAPI 4.0 没有运行时入口`,
        { engine: "jsapi-v4" },
      );
    }
    return resolve(target.handle);
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                    */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * `@baidumap/jsapi-v4-types@4.0.4` 的全局 `BMap` 必须提供 Driver 的全部必需成员。
 *
 * 上游类型包移除或改名这些成员时，`pnpm typecheck:package`（`skipLibCheck: false`）会在
 * **编译期**失败，而不是等到运行时才发现 `BMap.Size is not available`。
 * `typeof BMap` 属于 raw SDK 边界内允许的用法（v4 Driver / Provider / Fake / augmentation，
 * 见 ADR 2026-09-10-bmap-raw-sdk-boundary）；本文件不进入发布产物，因此不会外泄给消费者。
 */
type OfficialNamespaceCheck = ExpectTrue<
  typeof BMap extends JsapiV4Namespace ? true : false
>;

// 断言结果不参与运行时；存在性由类型检查保证（`noUnusedLocals` 未开启）。
type _AssertOfficialJsapiV4Namespace = OfficialNamespaceCheck;
