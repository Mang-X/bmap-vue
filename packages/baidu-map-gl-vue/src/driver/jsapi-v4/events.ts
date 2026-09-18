/**
 * v4 EventDriver（M3A2-02 / issue #19）
 *
 * 与 `webgl-v1` 的直通实现相比，这里承担三件事：
 *
 * 1. **可释放且可重复调用的 disposer**：每次订阅都返回 disposer，重复调用安全（幂等）；
 * 2. **同 target+type 只有一个 raw listener**：官方 API 按函数身份解绑，而组件每次重渲染
 *    都会传入新的 handler，若每次都 `addEventListener` 就会持续泄漏。这里把订阅者聚合成
 *    一个稳定的 raw 包装函数——handler 更新/追加只改订阅集合，**不重绑**；最后一个订阅
 *    释放时才 `removeEventListener`，监听器计数回到零；
 * 3. **边界归一化 + 所有权校验**：派发前把 raw event 归一化为 `DriverEvent`，并拒绝不属于
 *    本 Client 的句柄（跨地图操作必须在这里失败，而不是在 SDK 里产生难定位的异常）。
 *
 * 生命周期：订阅集合为空时立刻删除 `groups` 里的 target/type 条目，驱动不会因为
 * 「曾经订阅过某张地图」而长期持有已销毁的 raw 对象。
 *
 * 订阅语义（PR #59 评审修正）：
 * - **每次 `on()` 都是一份独立订阅**，disposer 与它一一对应；同一函数订阅两次就是两份，
 *   各自释放一份、计数归零才解绑。因此早期用 `Set<函数>` 做身份去重的实现被替换为
 *   「函数 → 份数」计数：`Set` 无法表达两份订阅，且旧 disposer 会连带摘掉比它更晚建立的
 *   那份订阅。
 * - 派发时同一个函数每轮只调用一次，与「一个 target+type 只有一个 raw 绑定」保持一致。
 * - 摘除分组必须**校验分组身份**：只有仍是当前分组的那个才允许解绑，避免旧 disposer
 *   解绑后来替换掉的新分组。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import { overlayPointerFallback } from "../../core/overlays/overlayEventCatalog";
import { normalizeDriverEvent } from "../normalize";
import { overlayKindOf } from "../types/overlays";
import type { DriverEvent, EventDriver } from "../types/events";
import type { GeometryDriver } from "../types/geometry";
import type { SdkHandle } from "../types/handles";
import { readNamespaceMember } from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

type RawListener = (event: unknown) => void;
type RawMethod = (type: string, listener: RawListener) => void;
type TypedListener = (event: DriverEvent) => void;

interface SubscriptionGroup {
  /** 真正注册到 SDK 上的稳定包装函数：订阅集合变化时不重建。 */
  readonly raw: RawListener;
  /**
   * 函数 → 仍在生效的订阅份数。
   *
   * 用计数而非 `Set`：同一函数可以被订阅多次，每份都要有自己的 disposer 语义
   * （释放一份不能影响另一份），计数归零才把函数从分组里摘掉。
   */
  readonly claims: Map<TypedListener, number>;
}

export interface CreateJsapiV4EventDriverInput {
  registry: JsapiV4HandleRegistry;
  geometry: GeometryDriver;
}

/**
 * v4 EventDriver：公共 `EventDriver` 契约 + **只在 Driver 内部使用**的 target 释放入口。
 *
 * `release` 是 Map Facet 的 `destroy()` 需要的（M3A2-MAP / #20）：销毁地图时必须先摘掉
 * Driver 自己在该 target 上的订阅分组，否则 `groups` 会以强引用长期持有已销毁的 raw 对象
 * （`groups` 是 `Map`，不是 `WeakMap`）。它不进公共 `EventDriver` 类型，消费者看不到。
 *
 * 失败语义（PR #60 评审 P2）：**逐项尽力**解绑，任一失败不跳过其余项，最后汇总抛出。
 * `removeGroup` 会先移除记账条目再解绑，因此即使解绑抛错也不会留下强引用；调用方
 * （`MapDriver.destroy`）据此把「释放订阅」的失败与「销毁 SDK 对象」解耦。
 */
export interface JsapiV4EventDriver extends EventDriver {
  /** 释放该 target 上由 Driver 建立的全部订阅（解绑 raw listener 并删除分组）。 */
  release(target: SdkHandle<string>): void;
  /**
   * 向该 target 的订阅者**合成派发**一个事件（只给 Driver 内部用）。
   *
   * 唯一的消费者是 `map.destroy()`：官方 `destroy` 事件在**我们摘掉订阅之后**才派发
   * （`release` 先于销毁 SDK 对象），因此订阅者在正常路径下永远看不到它。合成派发走
   * 与真实派发**同一条**归一化路径，所以载荷形状与 `on()` 收到的完全一致；
   * 订阅集合为空时是 no-op。
   */
  dispatch(target: SdkHandle<string>, type: string, raw?: unknown): void;
}

function noop(): void {}

/** 幂等 disposer：重复调用只执行一次释放逻辑。 */
function createDisposer(release: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    release();
  };
}

/**
 * 事件 → 「raw 缺失时可以读回地图补齐」的字段（M4-EVENTS / #28 评审）。
 *
 * 依据：上游把这几个字段声明为**事件级必填**（`MapLoadEvent.point/zoom`、`MapResizeEvent.size`、
 * `MapTypeChangeEvent.zoomLevel`），而 4.0 的 `load` / `resize` 在某些触发路径上给的 raw 并不完整。
 * 与其把公共契约写成 optional（那就等于宣布「我们不保证」），不如**在 Driver 边界读回地图补上**：
 * 这几个事件都是低频事件（每个会话一次 / 容器尺寸变化时），多一次 getter 调用可以忽略。
 *
 * 与 Catalog 的 `payload` 种类一一对应，由 `tests/behavior/v3-map-event-catalog.test.ts` 逐项比对。
 */
export const MAP_EVENT_READBACK_FIELDS: Readonly<Record<string, readonly ReadbackField[]>> =
  Object.freeze({
    load: ["point", "zoom"],
    resize: ["size"],
    maptypechange: ["zoomLevel"],
  });

/** 可读回补齐的字段。 */
export type ReadbackField = "point" | "zoom" | "size" | "zoomLevel";

/** 字段 → 地图 getter。 */
const READBACK_READERS: Record<ReadbackField, string> = {
  point: "getCenter",
  zoom: "getZoom",
  size: "getSize",
  zoomLevel: "getZoom",
};

/**
 * 读一个字段：目标没有该 getter（不是地图）或读回值不可用时返回 `undefined`。
 *
 * 容错口径与归一化一致：**event 路径不允许把异常抛回 SDK 的 dispatch**。读回失败只意味着
 * 「这个字段补不上」，不意味着「事件没发生」——因此这里吞掉异常并告警一次，事件照常派发。
 */
function readbackField(
  rawTarget: object,
  field: ReadbackField,
  geometry: GeometryDriver,
): unknown {
  const member = READBACK_READERS[field];
  const reader = readNamespaceMember(rawTarget, member);
  if (typeof reader !== "function") return undefined;
  try {
    const value = (reader as () => unknown).call(rawTarget);
    switch (field) {
      case "point":
        return geometry.fromRawPoint(value);
      case "size":
        return geometry.fromRawSize(value);
      default:
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
  } catch (error) {
    logger.warn(
      `EventDriver: 读回 ${member}() 补齐 "${field}" 失败（事件仍会派发）: ${
        (error as Error)?.message ?? String(error)
      }`,
    );
    return undefined;
  }
}

/**
 * 按 `MAP_EVENT_READBACK_FIELDS` 把 raw 缺失的必填字段从地图读回补上。
 *
 * 其余事件原样返回（不产生额外 getter 调用）。补不上的字段保持缺失——引擎既没给也读不出属于
 * 引擎状态异常，本库不做猜测（但类型上它仍是必填：这是**上游契约**，异常路径不该改写契约）。
 */
export function enrichDriverEvent(
  rawTarget: object,
  type: string,
  payload: DriverEvent,
  geometry: GeometryDriver,
): DriverEvent {
  const fields = MAP_EVENT_READBACK_FIELDS[type];
  if (!fields) return payload;
  let enriched = payload;
  for (const field of fields) {
    if (enriched[field] !== undefined) continue;
    const value = readbackField(rawTarget, field, geometry);
    if (value === undefined) continue;
    enriched = { ...enriched, [field]: value };
  }
  return enriched;
}

export function createJsapiV4EventDriver(input: CreateJsapiV4EventDriverInput): JsapiV4EventDriver {
  const { registry, geometry } = input;

  /** target → type → 订阅组；集合为空时删除条目，不长期持有 raw 对象。 */
  const groups = new Map<object, Map<string, SubscriptionGroup>>();

  const removeGroup = (
    target: object,
    type: string,
    group: SubscriptionGroup,
    removeEventListener: RawMethod,
  ): void => {
    const byType = groups.get(target);
    // 身份校验：只允许解绑**自己那一份**分组。旧 disposer 在分组已被替换后仍可能被调用，
    // 按 target+type 盲删会把后来建立的订阅一起解绑。
    if (!byType || byType.get(type) !== group) return;
    byType.delete(type);
    if (byType.size === 0) groups.delete(target);
    removeEventListener.call(target, type, group.raw);
  };

  const createGroup = (
    type: string,
    rawTarget: object,
    pointerFallback: "default" | "never",
  ): SubscriptionGroup => {
    const group: SubscriptionGroup = {
      claims: new Map<TypedListener, number>(),
      raw: (event: unknown) => {
        const payload = enrichDriverEvent(
          rawTarget,
          type,
          normalizeDriverEvent(type, event, geometry, { pointerFallback }),
          geometry,
        );
        // 复制一份再遍历：监听器内部 dispose 不影响本轮派发
        for (const listener of [...group.claims.keys()]) listener(payload);
      },
    };
    return group;
  };

  return {
    on<TEvent = unknown>(
      target: SdkHandle<string>,
      type: string,
      listener: (event: TEvent) => void,
    ): () => void {
      // 跨 Client 句柄在这里失败（BMAP_HANDLE_FOREIGN），不会被静默当成可订阅目标
      const rawTarget = registry.resolve<object>(target);
      const addEventListener = readNamespaceMember(rawTarget, "addEventListener");
      const removeEventListener = readNamespaceMember(rawTarget, "removeEventListener");
      if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
        logger.warn(
          `EventDriver: target 缺少 addEventListener/removeEventListener，事件 "${type}" 的订阅被忽略`,
        );
        return noop;
      }
      const remove = removeEventListener as RawMethod;

      const byType = groups.get(rawTarget);
      const existing = byType?.get(type);
      let group: SubscriptionGroup;

      if (existing) {
        // handler 更新/追加：复用同一个 raw listener，不重新绑定
        group = existing;
      } else {
        // 指针兜底策略在**订阅时**定一次（判据是事件矩阵，见 overlayPointerFallback）：
        // 覆盖物里上游声明「坐标可缺」的事件不补 `(0,0)`，map / layer 维持既有口径。
        group = createGroup(
          type,
          rawTarget,
          overlayPointerFallback(overlayKindOf(target), type),
        );
        // 先绑定、后登记：addEventListener 抛错时不在 groups 里留下空分组
        (addEventListener as RawMethod).call(rawTarget, type, group.raw);
        if (byType) {
          byType.set(type, group);
        } else {
          groups.set(rawTarget, new Map([[type, group]]));
        }
      }

      const typed = listener as TypedListener;
      group.claims.set(typed, (group.claims.get(typed) ?? 0) + 1);

      return createDisposer(() => {
        // 只释放本 disposer 的这一份；同一函数的其它订阅不受影响
        const remaining = (group.claims.get(typed) ?? 0) - 1;
        if (remaining > 0) group.claims.set(typed, remaining);
        else group.claims.delete(typed);
        if (group.claims.size === 0) removeGroup(rawTarget, type, group, remove);
      });
    },

    dispatch(target, type, raw) {
      const rawTarget = registry.resolve<object>(target);
      const group = groups.get(rawTarget)?.get(type);
      if (!group) return;
      const payload = enrichDriverEvent(
        rawTarget,
        type,
        normalizeDriverEvent(type, raw, geometry),
        geometry,
      );
      // 与真实派发同一口径：复制一份再遍历，监听器内部 dispose 不影响本轮
      for (const listener of [...group.claims.keys()]) listener(payload);
    },

    release(target) {
      // 所有权校验：跨 Client 句柄在这里失败，不会被当成「没有订阅」而静默通过
      const rawTarget = registry.resolve<object>(target);
      const byType = groups.get(rawTarget);
      if (!byType) return;
      const removeEventListener = readNamespaceMember(rawTarget, "removeEventListener");
      if (typeof removeEventListener !== "function") {
        // 目标没有解绑能力（同 on() 的告警分支）：只丢弃分组，不抛错
        groups.delete(rawTarget);
        return;
      }
      const remove = removeEventListener as RawMethod;
      // 逐条走 removeGroup（复用分组身份校验与「集合空则删除 target 条目」的收尾逻辑），
      // 并且**逐项隔离异常**：某一项解绑失败不能跳过其余订阅的释放。
      const failures: unknown[] = [];
      for (const [type, group] of [...byType]) {
        try {
          removeGroup(rawTarget, type, group, remove);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        // 汇总抛出：调用方决定是否阻断后续步骤（MapDriver.destroy 会继续销毁 SDK 对象）
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `释放 target 订阅时有 ${failures.length} 项解绑失败（其余项已尽力释放；` +
            `记账条目已移除，但 SDK 侧监听器可能仍在）: ` +
            failures.map((failure) => (failure as Error)?.message ?? String(failure)).join("; "),
          { cause: failures[0], engine: "jsapi-v4" },
        );
      }
    },
  };
}
