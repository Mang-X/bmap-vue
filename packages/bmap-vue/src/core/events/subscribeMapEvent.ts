/**
 * 单次 SDK 事件订阅原语（M4-EVENTS / issue #28）
 *
 * `useMapEvent` 与 `useMapStatus` 共用这一份「怎么订阅」：调用方只关心「订阅哪一个 SDK 事件、
 * 收到事件后做什么」，不各自重写取句柄、合帧、释放的流程。
 *
 * 三条语义：
 *
 * 1. **句柄由调用方给**：`map` / `client` 未就绪时不订阅，返回一个空 disposer
 *    （就绪后由调用方重新调用本函数——上层是 `watch`，见 `composables/useMapEvent.ts`）；
 * 2. **合帧**（`coalesce: true`）：同一帧内多次派发只投递**最后一次**的载荷，key 是每次订阅
 *    自己的 symbol，因此共享一个 `FrameScheduler` 的多份订阅互不覆盖；
 * 3. **释放是幂等的**：解绑 SDK 订阅 + 取消挂起任务；自建合帧器（调用方没给 scheduler 时）
 *    一并释放，而**共享的合帧器不会被释放**——它属于地图运行时。
 *
 * 订阅名恒为 SDK 拼写：`on` 的实现按 `target + type` 聚合，因此同一事件的多次订阅
 * 只对应**一个** raw 监听器（`driver/jsapi-v4/events.ts`）。
 */
import { createFrameScheduler, type FrameScheduler } from "../scheduler/FrameScheduler";
import type { EventDriver } from "../../driver/types/events";
import type { MapHandle } from "../../driver/types/handles";

export interface SubscribeMapEventOptions {
  /** 是否按帧合帧（高频事件）。缺省不合帧。 */
  coalesce?: boolean;
  /** 复用外部合帧器（地图运行时持有）；缺省时高频订阅自建一个，随订阅释放。 */
  scheduler?: FrameScheduler;
}

/**
 * 订阅一个 map 事件（SDK 拼写）。
 *
 * @returns 幂等 disposer：解绑订阅、丢弃未投递的合帧任务；自建合帧器时同时释放它。
 */
export function subscribeMapEvent(
  client: { driver: { events: EventDriver } } | null,
  map: MapHandle | null,
  sdkEventName: string,
  listener: (event: unknown) => void,
  options: SubscribeMapEventOptions = {},
): () => void {
  if (!client || !map) return () => {};

  const coalesce = options.coalesce === true;
  let ownedScheduler: FrameScheduler | null = null;
  let scheduler: FrameScheduler | null = null;
  if (coalesce) {
    scheduler = options.scheduler ?? (ownedScheduler = createFrameScheduler());
  }

  let disposed = false;
  const key = Symbol(`map-event:${sdkEventName}`);
  let latest: unknown;

  const deliver = (event: unknown): void => {
    if (disposed) return;
    listener(event);
  };

  /**
   * 合帧路径的投递（M4-EVENTS / #28 评审）：**handler 抛错必须和不合帧路径一样可见**。
   *
   * 不合帧时异常会穿过 SDK 的事件派发（未捕获）；合帧时任务跑在 RAF 回调里，而 `FrameScheduler`
   * 按设计 `catch {}`（单任务错误不阻断同帧其余任务）——于是 `moving` 的 handler 抛错会**完全消失**，
   * 而 `click` 的同类错误照常冒出来。这里把异常重新抛到一个微任务里：同样是「未捕获错误」，
   * 一样能被全局错误处理看到，同时不动 FrameScheduler 的语义。
   */
  const deliverCoalesced = (event: unknown): void => {
    try {
      deliver(event);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  };

  const raw = scheduler
    ? (event: unknown): void => {
        latest = event;
        // 同一帧内同 key 只保留最后一次任务（`FrameScheduler.schedule` 的语义）
        scheduler!.schedule(key, () => deliverCoalesced(latest));
      }
    : deliver;

  const off = client.driver.events.on(map, sdkEventName, raw);

  return () => {
    if (disposed) return;
    disposed = true;
    off();
    // 先取消挂起任务再释放：共享合帧器上不能留下指向本次订阅的闭包
    scheduler?.cancel(key);
    ownedScheduler?.dispose();
  };
}
