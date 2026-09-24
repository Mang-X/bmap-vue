/**
 * EventBridge
 *
 * 将 SDK 对象的 addEventListener/removeEventListener 包成可释放的 Disposer。
 * 解决 v2 bindEvents 匿名回调无法解除、动态监听不同步的问题。
 *
 * 另外提供归一化事件包装,不修改原始 SDK event 对象。
 */
import type { Disposer } from "../lifecycle/ResourceScope";

export interface BMapSdkEventTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

/** 绑定单一 SDK 事件,返回可精确移除的 Disposer */
export function bindSdkEvent(
  target: BMapSdkEventTarget,
  type: string,
  listener: (...args: any[]) => void,
): Disposer {
  target.addEventListener(type, listener as (event: any) => void);
  return () => target.removeEventListener(type, listener as (event: any) => void);
}

/** 批量绑定一组事件,返回可同时移除全部事件的 Disposer */
export function bindSdkEvents(
  target: BMapSdkEventTarget,
  events: [type: string, listener: (...args: any[]) => void][],
): Disposer {
  const disposers = events.map(([type, listener]) => bindSdkEvent(target, type, listener));
  return () => {
    // 逆序移除
    for (const dispose of [...disposers].reverse()) {
      dispose();
    }
  };
}

/** 归一化事件:不修改原始 event,提供 preventDefault/stopPropagation */
export interface NormalizedMapEvent<Raw> {
  raw: Raw;
  domEvent?: Event;
  preventDefault(): void;
  stopPropagation(): void;
}

export function normalizeMapEvent<Raw>(raw: Raw): NormalizedMapEvent<Raw> {
  const domEvent = (raw as { domEvent?: Event })?.domEvent as Event | undefined;
  return {
    raw,
    domEvent,
    preventDefault: () => domEvent?.preventDefault?.(),
    stopPropagation: () => domEvent?.stopPropagation?.(),
  };
}
