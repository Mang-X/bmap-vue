/**
 * 订阅源解析（M4-EVENTS / issue #28）：Map Context 与显式 source 两种入口
 *
 * `useMapEvent` / `useMapStatus` 都能在**两种**场景工作：
 *
 * 1. 在 `<BMap>` 子树里调用（最常见）——用最近注入的 `MapContext`，它同时带 `scheduler`；
 * 2. 显式给一个 `MapEventSource`——只要求「地图句柄 + 提供 EventDriver 的 Client」，
 *    用于「拿到别处（多地图、`defineExpose()` 的句柄）的地图」这类场景。
 *
 * 显式 source 由**调用方**负责生命周期：本库不去猜那张地图何时被销毁，只保证「句柄变了就换订阅、
 * 句柄为 `null` 就不订阅」。
 */
import { getCurrentInstance, toValue, type MaybeRefOrGetter } from "vue";
import type { BMapClient } from "../client/types";
import { useOptionalMapContext } from "../core/context/inject";
import type { MapContext } from "../core/context/types";
import { BMapError } from "../core/errors/BMapError";
import type { FrameScheduler } from "../core/scheduler/FrameScheduler";
import type { MapHandle } from "../driver/types/handles";

/**
 * 显式订阅源。
 *
 * `MapContext` 结构上就满足它（`map` / `client` 是 shallow refs，`scheduler` 是运行时的合帧器），
 * 因此 `useMapEvent(..., { source: ctx })` 与 `{ source: { map, client } }` 都能用。
 */
export interface MapEventSource {
  /** 地图句柄（可能为 `null`：还没就绪 / 已销毁）。 */
  map: MaybeRefOrGetter<MapHandle | null>;
  /** 提供 `driver.events` 的 Client。 */
  client: MaybeRefOrGetter<BMapClient | null>;
  /** 可选的合帧器：给了就复用它（缺省时高频订阅自建一个并随订阅释放）。 */
  scheduler?: FrameScheduler;
}

export type MapEventSourceInput = MapContext | MapEventSource;

/**
 * 解析订阅源：显式 source 优先，其次最近注入的 `MapContext`。
 *
 * 两者都没有时抛 `BMAP_PARENT_CONTEXT_MISSING`——与 `<BMap>` 子组件的报错口径一致，
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
    "useMapEvent / useMapStatus must be called inside a <BMap> subtree, " +
      "or be given an explicit `source` ({ map, client }).",
  );
}

/** 读一次 source 里的句柄（`toValue` 解包 ref / getter）。 */
export function readEventSource(source: MapEventSource): {
  map: MapHandle | null;
  client: BMapClient | null;
} {
  return { map: toValue(source.map) ?? null, client: toValue(source.client) ?? null };
}
