/**
 * 订阅源解析（M4-EVENTS / issue #28）：Map Context 与显式 source 两种入口
 *
 * `useMapEvent` / `useMapStatus` 都能在**两种**场景工作：
 *
 * 1. 在 `<Map>` 子树里调用（最常见）——用最近注入的 `MapContext`，它同时带 `scheduler`；
 * 2. 显式给一个 `MapEventSource`——只要求「地图句柄 + 提供 EventDriver 的 Client」，
 *    用于「拿到别处（多地图、`defineExpose()` 的句柄）的地图」这类场景。
 *
 * 显式 source 由**调用方**负责生命周期：本库不去猜那张地图何时被销毁，只保证「句柄变了就换订阅、
 * 句柄为 `null` 就不订阅」。
 */
import { getCurrentInstance, toValue, type MaybeRefOrGetter } from "vue";
import { useOptionalMapContext } from "../core/context/inject";
import type { MapReadyContext } from "../core/context/types";
import type { PublicMapContext } from "./resolveMapContext";
import { BMapError } from "../core/errors/BMapError";
import type { FrameScheduler } from "../core/scheduler/FrameScheduler";
import type { EventDriver } from "../driver/types/events";
import type { MapDriver } from "../driver/types/map";
import type { MapHandle } from "../driver/types/handles";

/**
 * 显式订阅源。
 *
 * `MapContext` 结构上就满足它（`map` / `client` 是 shallow refs，`scheduler` 是运行时的合帧器；
 * 对外经 `PublicMapContext` 传递，见 `resolveMapContext.ts`），
 * 因此 `useMapEvent(..., { source: ctx })` 与 `{ source: { map, client } }` 都能用。
 */
/**
 * 显式 source 真正需要的那一面 Client。
 *
 * 是**事件 + 地图**两面，不是一面：`useMapEvent` 只调 `driver.events`，而 `useMapStatus`
 * 读视野（`driver.map.getCenter` / `getZoom` / `getBounds` / `getSize` / `getHeading` /
 * `getTilt`）。只声明 `events` 的话，调用方传一个「只有 events」的 Client 会在
 * `useMapStatus` 里落到 `undefined.getCenter` —— 公共类型就会**承诺一个运行时没有保证的
 * 能力**，正是 ADR 2026-09-25 决策 5 与 Official-first 的「接收后忽略属于假支持」。
 *
 * 写成结构而不是 `BMapClient`：外部真的能用 SDK 句柄 + 官方 Driver 实现它，而不必伪造
 * 整个 Client（含 `id` / `libraryVersion` / `rawSdk` …）。完整 `BMapClient` 结构上满足它。
 */
export interface EventSourceClient {
  readonly driver: { readonly events: EventDriver; readonly map: MapDriver };
}

export interface MapEventSource {
  /** 地图句柄（可能为 `null`：还没就绪 / 已销毁）。 */
  map: MaybeRefOrGetter<MapHandle | null>;
  /**
   * 提供 `driver.events` 的 Client。
   *
   * 显式 source 的**能力要求**（不是本库的实现细节）：`useMapEvent` / `useMapStatus`
   * 只需要 `driver.events` 那一面。写成结构而不是 `BMapClient`，是让「我有一张
   * 自己的地图 + 一个能给我事件 Driver 的 Client」这种用法不必伪造整个 Client
   * （`MapContext` 传进来时结构上满足，见 `PublicMapContext`）。
   */
  client: MaybeRefOrGetter<EventSourceClient | null>;
  /** 可选的合帧器：给了就复用它（缺省时高频订阅自建一个并随订阅释放）。 */
  scheduler?: FrameScheduler;
  /**
   * 早期订阅挂载点：`create()` 之后、`initializeView()` **之前**回调（地图上下文自带）。
   *
   * 没有它的显式 source 只能在句柄可见时订阅 —— 对「初始化期事件」（`load`）意味着**可能收不到**，
   * 这是显式 source 的既有语义（见 `useMapEvent` 文档）。
   */
  whenMapCreated?: (callback: (ready: MapReadyContext) => void) => () => void;
  /**
   * 承载这张地图的组件是否已开始卸载（地图上下文自带）。
   *
   * 生命周期结束事件（`destroy`）的订阅**只在整图 teardown 时**才延长寿命：`true` ⇒ 订阅留给
   * 上下文收尾（活到地图销毁），`false`/缺失 ⇒ 调用方作用域停止时就释放（条件渲染 / Tab / 路由
   * 这类「子组件自己卸载」不能残留旧 handler）。
   */
  isTearingDown?: () => boolean;
  /**
   * 上下文级订阅归属：**生命周期结束事件**（`destroy`）的订阅登记在这里而不是调用方组件的
   * 作用域 —— 组件卸载先于地图销毁，挂在自己作用域上必然收不到
   * （见 ADR `2026-09-14-map-events-and-status` 决策 11）。
   *
   * 只声明**用得到的那一个方法**，而不是 `ResourceScope` 本身（issue #160）：`ResourceScope`
   * 带 `private disposers` / `private _disposed`，仓库之外既不能构造也不能实现，整类放进
   * 公共签名就是 ADR 2026-09-25 决策 5 说的「假支持」。`MapContext` 结构上仍然满足它
   * （`ResourceScope` 有 `add`），所以 `<Map>` 子树里的既有写法不变；而 `check:api` 的
   * 闭包里不再有 `ResourceScope`。
   *
   * 与 `PublicMapContext.events: { emit }` 是**同一个手法**（同一个文件里两处）：把内部
   * 类型换成「公共签名真正用到的那几个成员」的结构声明。成员不同、理由相同。
   */
  resources?: { add(disposer: () => void): () => void };
}

export type MapEventSourceInput = PublicMapContext | MapEventSource;

/**
 * 解析订阅源：显式 source 优先，其次最近注入的 `MapContext`。
 *
 * 两者都没有时抛 `BMAP_PARENT_CONTEXT_MISSING`——与 `<Map>` 子组件的报错口径一致，
 * 不做「静默不订阅」（那会让「订阅了但永远不触发」变成最难查的一类问题）。
 */
export function resolveMapEventSource(explicit?: MapEventSourceInput): MapEventSource {
  if (explicit) return explicit;
  // 只在组件 setup 上下文里 inject：显式 source 之外还可能出现「不在 setup 里误用」，
  // 那时 inject 的返回值没有意义，直接走下面的明确报错。
  const injected = getCurrentInstance() ? useOptionalMapContext() : undefined;
  if (injected) return injected;
  throw new BMapError(
    "BMAP_PARENT_CONTEXT_MISSING",
    "useMapEvent / useMapStatus must be called inside a <Map> subtree, " +
      "or be given an explicit `source` ({ map, client }).",
  );
}

/**
 * 读一次 source 里的句柄（`toValue` 解包 ref / getter）。
 *
 * 返回类型就是 `MapEventSource` 声明的那个窄面，**不做任何断言** —— 上一版在这里把
 * `EventSourceClient` 硬转成完整 `BMapClient`，而 `client` 是调用方给的，那等于用类型
 * 断言掩盖了「它可能没有 `driver.map`」这件事（issue #160 评审硬伤）。声明与取回现在
 * 是同一份契约：能力不够就在 `useMapStatus` 里显式失败，而不是在这里假装有。
 */
export function readEventSource(source: MapEventSource): {
  map: MapHandle | null;
  client: EventSourceClient | null;
} {
  return { map: toValue(source.map) ?? null, client: toValue(source.client) ?? null };
}
