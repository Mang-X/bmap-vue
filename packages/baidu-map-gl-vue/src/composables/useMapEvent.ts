/**
 * useMapEvent —— 订阅 map 事件（M4-EVENTS / issue #28）
 *
 * ```ts
 * // 在 <BMap> 子树里（最常见）
 * useMapEvent('click', (e) => console.log(e.point, e.pixel))
 * useMapEvent('moving', (e) => console.log('moving', e.raw))  // 高频：一帧最多一次
 *
 * // 显式 source（多地图 / 拿到别处的句柄）
 * useMapEvent('click', handler, { source: { map, client } })
 * ```
 *
 * 四条语义：
 *
 * 1. **handler 更新不重绑**：SDK 侧只绑一个稳定 wrapper，handler 存在 `shallowRef` 里、派发时读。
 *    传函数是「捕获一次」（Vue 的闭包读的就是 ref 对象，本来就是最新值，不像 React 每渲染都要换
 *    新函数）；要「按条件切换 handler 实现」则传 `ref(handler)`，换实现同样不触碰订阅；
 * 2. **按需订阅**：只有 `map` 与 `client` 都就绪时才订阅；任一变成 `null`（换图 / 销毁）
 *    就解绑。`name` 变化同样重订阅；
 * 3. **高频事件按帧合帧**：`MAP_EVENT_CATALOG` 里 `coalesce: true` 的事件一帧最多投递一次、
 *    取最后一次载荷（可用 `options.coalesce` 覆盖）；
 * 4. **释放路径明确**：返回的 disposer 幂等；在组件 / effect scope 里调用时随作用域自动释放。
 *
 * ## 生命周期事件（`load` / `destroy`）在 Map Context 路径下也能收到
 *
 * 两条与「普通事件」不同的规则，都来自同一件事实：**组件卸载先于地图销毁**（Vue 的卸载顺序是
 * 父 `beforeUnmount` → 父作用域 stop → 子树卸载（子作用域 stop）→ 父 `unmounted`，而地图销毁在
 * `<BMap>` 的 `onUnmounted` 里）：
 *
 * - `load`：用上下文提供的 `whenMapCreated`（`create()` 之后、`initializeView()` **之前**）提前订阅，
 *   否则等句柄可见时官方 `load` 已经派发完；
 * - `destroy`：订阅登记在**上下文的 `ResourceScope`** 上（`MAP_CONTEXT_OWNED_EVENTS`），因此组件卸载
 *   不会摘掉它 —— 它要活到地图销毁那一刻。要提前停止请用返回的 disposer。
 *
 * **显式 `MapEventSource` 保持 SDK 订阅语义**：没有这两个上下文能力，`load` 在「订阅时地图已初始化」
 * 时收不到、`destroy` 只在订阅仍然存活时收得到（订阅归调用方）。
 *
 * 名字任一种拼写都认（`'style-loaded'` / `'style_loaded'` / `'styleLoaded'`）。**Catalog 之外
 * 的名字原样订阅**——这是 raw 逃生口：上游以后新增的事件不需要等本库发版（代价是载荷类型只能是
 * 公共底座 `MapEventPayload`；表内事件有逐事件的精确类型）。
 */
import {
  getCurrentScope,
  isRef,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from "vue";
import {
  MAP_CONTEXT_OWNED_EVENTS,
  resolveMapEventName,
  type MapEventName,
  type MapEventPayload,
  type MapEventPayloadOf,
} from "../core/events/eventCatalog";
import { subscribeMapEvent } from "../core/events/subscribeMapEvent";
import type { BMapClient } from "../client/types";
import type { MapHandle } from "../driver/types/handles";
import { readEventSource, resolveMapEventSource, type MapEventSourceInput } from "./mapEventSource";

/**
 * 事件载荷类型：表内事件取逐事件的精确载荷，表外（raw 逃生口）退化为公共底座。
 *
 * 刻意**不用 `any`**：「不认识这个名字」不该把调用方的类型环境变成无检查。
 */
export type MapEventPayloadForName<K extends string> = K extends MapEventName
  ? MapEventPayloadOf<K>
  : MapEventPayload;

/** 事件回调类型：载荷随事件名走（表外名字退化为公共底座）。 */
export type MapEventHandler<K extends string> = (event: MapEventPayloadForName<K>) => void;

export interface UseMapEventOptions {
  /** 显式订阅源；省略时取最近注入的 MapContext（须在 `<BMap>` 子树内）。 */
  source?: MapEventSourceInput;
  /**
   * 是否按帧合帧。省略时按 Catalog 的高频标记判定
   * （`mousemove` / `touchmove` / `dragging` / `moving` / `zooming` 为 true）。
   */
  coalesce?: boolean;
}

/**
 * @param name 事件名（可传 ref / getter；任一种拼写）
 * @param handler 事件回调；**更新 handler 不会重绑 SDK 订阅**
 * @returns 幂等 disposer（在组件 / effect scope 内调用时也会随作用域自动释放）
 */
export function useMapEvent<K extends string>(
  name: MaybeRefOrGetter<K>,
  handler: MapEventHandler<K> | Ref<MapEventHandler<K>>,
  options: UseMapEventOptions = {},
): () => void {
  /**
   * 最新 handler 的槽位。
   *
   * 两种传法都支持，因为 Vue 与 React 的「陈旧闭包」问题不同：
   * - **传函数**（最常见）：捕获一次即可——Vue 的闭包读的是 ref 对象，本身就是最新值，
   *   不像 React 那样每次渲染都要换一个新函数（这是 React 需要 `useLatest` 的原因）。
   *   派发时从 `shallowRef` 里读，SDK 侧只绑一个稳定 wrapper（本文件第 1 条语义）；
   * - **传 `ref(handler)`**：每次派发都读 `.value`，适合「按条件切换 handler 实现」——
   *   换实现同样不触碰 SDK 订阅。
   */
  const handlerRef: ShallowRef<MapEventHandler<K>> = isRef(handler)
    ? handler
    : shallowRef(handler);

  const source = resolveMapEventSource(options.source);
  /** 当前生效的订阅（含它的归属与释放入口）。 */
  let active: {
    map: MapHandle;
    sdkEventName: string;
    coalesce: boolean;
    release: () => void;
    /** `true` = 订阅挂在地图上下文的 scope 上（生命周期结束事件），不随组件卸载释放。 */
    contextOwned: boolean;
  } | null = null;

  const releaseActive = (): void => {
    const current = active;
    active = null;
    current?.release();
  };

  /** 建立/替换订阅：同一个「句柄 + SDK 名 + 合帧口径」上是幂等的。 */
  const ensure = (map: MapHandle | null, client: BMapClient | null): void => {
    const rawName = String(toValue(name) ?? "");
    const entry = resolveMapEventName(rawName);
    // 表外名字原样订阅（raw 逃生口）；表内名字用 Catalog 的 SDK 拼写
    const sdkEventName = entry?.sdk ?? rawName;
    if (!map || !client || !sdkEventName) {
      releaseActive();
      return;
    }
    const coalesce = options.coalesce ?? entry?.coalesce ?? false;
    if (
      active &&
      active.map === map &&
      active.sdkEventName === sdkEventName &&
      active.coalesce === coalesce
    ) {
      return;
    }
    releaseActive();
    const off = subscribeMapEvent(
      client,
      map,
      sdkEventName,
      (event) => {
        // 载荷形状由本 composable 声明（`EventDriver.on` 的泛型契约），Driver 负责归一化
        handlerRef.value(event as MapEventPayloadForName<K>);
      },
      { coalesce, scheduler: source.scheduler },
    );
    // 生命周期结束事件在 Map Context 路径下由**上下文**持有订阅（组件卸载先于地图销毁，见文件头）
    const contextOwned =
      entry !== undefined &&
      source.resources !== undefined &&
      MAP_CONTEXT_OWNED_EVENTS.includes(entry.vue);
    const release = contextOwned ? source.resources!.add(off) : off;
    active = { map, sdkEventName, coalesce, release, contextOwned };
  };

  const sync = (): void => {
    const { map, client } = readEventSource(source);
    ensure(map, client);
  };

  // 只把「订阅真的会变的东西」放进 watch 源：handler 不在其中，所以内联函数不会触发重订阅
  const stopWatch = watch(
    [() => toValue(source.map), () => toValue(source.client), () => toValue(name)],
    sync,
    { immediate: true, flush: "post" },
  );

  // 早期挂载点：`load` 这类初始化期事件在地图创建时（`initializeView()` **之前**）就派发
  const stopEarly = source.whenMapCreated?.((ready) => ensure(ready.map, ready.client));

  /** 调用方显式释放：全部释放（含上下文归属的那一类）。 */
  const dispose = (): void => {
    releaseActive();
    stopWatch();
    stopEarly?.();
  };

  if (getCurrentScope()) {
    onScopeDispose(() => {
      // 上下文归属的订阅（生命周期结束事件）**不**在这里释放：它要活到地图销毁那一刻，
      // 由上下文的 ResourceScope 收尾（见文件头「生命周期事件」一节）。
      if (!active?.contextOwned) releaseActive();
      stopWatch();
      stopEarly?.();
    });
  }

  return dispose;
}
