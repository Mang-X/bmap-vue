/**
 * useMapStatus —— 把地图的外部状态以**只读 refs** 暴露（M4-EVENTS / issue #28）
 *
 * ```ts
 * const { center, zoom, bounds, size, heading, tilt, moving, zooming } = useMapStatus()
 * watch(center, (p) => console.log('中心点', p))
 * ```
 *
 * 四条语义：
 *
 * 1. **按需订阅**：调用一次才订阅一次（不做进程/地图级共享订阅，也不建全局事件总线）。
 *    句柄未就绪时不订阅；就绪后订阅并**立即读一次**当前值（不必等第一个事件）；
 *    句柄变 `null`（销毁）时退订并把状态复位成「未知」。
 * 2. **值没变就不更新**：每次事件后重新读取，逐字段做**容差判等**（经纬度 `1e-7`、`zoom` `1e-6`、
 *    角度 `0.01`，与受控视野同一套口径）。相等时**保持原对象**——因此 `watch(center)` 不会被
 *    同一次 `moveend` 的浮点抖动唤醒，`center.value` 的引用也是稳定的。
 * 3. **`moving` / `zooming` 是布尔标志**：由 `movestart/moving/moveend`、`zoomstart/zooming/zoomend`
 *    驱动。它们**刻意不参与合帧**——同一帧里若 `moving` 被推迟到下一帧、而 `moveend` 同步处理，
 *    标志会被后到的 `moving` 重新置为 `true`，出现「已结束却仍在移动」。
 * 4. **释放路径**：返回对象带 `dispose()`；在组件 / effect scope 内调用时随作用域自动释放。
 */
import { getCurrentScope, onScopeDispose, shallowRef, toValue, watch, type ShallowRef } from "vue";
import { readLiveView } from "../core/utils/liveView";
import { anglesEqual, numbersEqual, pointEquals } from "../core/utils/equality";
import { subscribeMapEvent } from "../core/events/subscribeMapEvent";
import type { Bounds, Point, Size } from "../driver/types/geometry";
import { readEventSource, resolveMapEventSource, type MapEventSourceInput } from "./mapEventSource";

/** 只读状态集合。 */
export interface MapStatusRefs {
  /** 地图中心点；未就绪 / 读不到时为 `null`。 */
  readonly center: Readonly<ShallowRef<Point | null>>;
  /** 缩放级别。 */
  readonly zoom: Readonly<ShallowRef<number | null>>;
  /** 可视范围。 */
  readonly bounds: Readonly<ShallowRef<Bounds | null>>;
  /** 容器尺寸。 */
  readonly size: Readonly<ShallowRef<Size | null>>;
  /** 旋转角（度；v4 读回可能为负，`-90 ≡ 270`）。 */
  readonly heading: Readonly<ShallowRef<number | null>>;
  /** 倾斜角（度，0..90）。 */
  readonly tilt: Readonly<ShallowRef<number | null>>;
  /** 是否正在移动（`movestart` / `moving` 起，`moveend` 止）。 */
  readonly moving: Readonly<ShallowRef<boolean>>;
  /** 是否正在缩放（`zoomstart` / `zooming` 起，`zoomend` 止）。 */
  readonly zooming: Readonly<ShallowRef<boolean>>;
  /** 释放订阅（幂等）；在组件 / effect scope 内会自动调用。 */
  dispose(): void;
}

export interface UseMapStatusOptions {
  /** 显式订阅源；省略时取最近注入的 MapContext（须在 `<Map>` 子树内）。 */
  source?: MapEventSourceInput;
}

/** 会触发「重新读一遍状态」的事件（全部是**结束**事件或低频状态事件）。 */
const STATUS_REFRESH_EVENTS = [
  "load",
  "moveend",
  "zoomend",
  "resize",
  "headingchange",
  "tiltchange",
] as const;

/** `moving` 标志的驱动事件。 */
const MOVING_EVENTS = ["movestart", "moving", "moveend"] as const;

/** `zooming` 标志的驱动事件。 */
const ZOOMING_EVENTS = ["zoomstart", "zooming", "zoomend"] as const;

/** 带容差的 `number | null` 判等：任一侧为 `null` 时退化为严格相等。 */
function numbersEqualOrNull(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return numbersEqual(a, b);
}

/** 角度判等（环绕），`null` 语义同 `numbersEqualOrNull`。 */
function anglesEqualOrNull(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return anglesEqual(a, b);
}

/** 容器尺寸判等：整数像素即可（`getSize()` 不产生小数抖动，但真实浏览器可能给浮点）。 */
function sizesEqual(a: Size | null, b: Size | null): boolean {
  if (a === null || b === null) return a === b;
  return numbersEqual(a.width, b.width) && numbersEqual(a.height, b.height);
}

/** 可视范围判等：逐角点比较（`POINT_EPSILON` 由 `pointEquals` 兜住）。 */
function boundsEqual(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    pointEquals(a.southwest, b.southwest) && pointEquals(a.northeast, b.northeast)
  );
}

export function useMapStatus(options: UseMapStatusOptions = {}): MapStatusRefs {
  const center = shallowRef<Point | null>(null);
  const zoom = shallowRef<number | null>(null);
  const bounds = shallowRef<Bounds | null>(null);
  const size = shallowRef<Size | null>(null);
  const heading = shallowRef<number | null>(null);
  const tilt = shallowRef<number | null>(null);
  const moving = shallowRef(false);
  const zooming = shallowRef(false);

  /**
   * 值相等就不赋值：既避免无意义更新，也让引用保持稳定。
   *
   * 判等函数必须容忍 `null`（「未知」）：`null → null` 视为没变，不会产生更新。
   */
  function commit<T>(ref: ShallowRef<T>, next: T, equals: (a: T, b: T) => boolean): void {
    if (equals(ref.value, next)) return;
    ref.value = next;
  }

  const source = resolveMapEventSource(options.source);
  let unsubscribes: Array<() => void> = [];

  /**
   * 读一遍六个字段并逐字段提交（读不出 ⇒ `null`，表示「未知」而不是「保持旧值」）。
   *
   * 读口径与受控视野**共用** `readLiveView`（`core/utils/liveView.ts`）：只忽略
   * 「资源已销毁 / 本引擎没有该能力」这两个「这次读本来就不成立」的码，其余（含
   * `BMAP_SDK_CALL_FAILED`）照旧上抛——把「读错」判成「读不到」就是静默失效。
   */
  function refresh(): void {
    const { map, client } = readEventSource(source);
    if (!map || !client) return;
    const { driver } = client;
    commit(
      center,
      readLiveView(() => driver.map.getCenter(map)),
      pointEquals,
    );
    commit(
      zoom,
      readLiveView(() => driver.map.getZoom(map)),
      numbersEqualOrNull,
    );
    commit(
      bounds,
      readLiveView(() => driver.map.getBounds(map)),
      boundsEqual,
    );
    commit(
      size,
      readLiveView(() => driver.map.getSize(map)),
      sizesEqual,
    );
    commit(
      heading,
      readLiveView(() => driver.map.getHeading(map)),
      anglesEqualOrNull,
    );
    commit(
      tilt,
      readLiveView(() => driver.map.getTilt(map)),
      anglesEqualOrNull,
    );
  }

  /** 句柄不可用时把状态复位成「未知」——不是「保持上一次的值」。 */
  function reset(): void {
    commit(center, null, pointEquals);
    commit(zoom, null, numbersEqualOrNull);
    commit(bounds, null, boundsEqual);
    commit(size, null, sizesEqual);
    commit(heading, null, anglesEqualOrNull);
    commit(tilt, null, anglesEqualOrNull);
    commit(moving, false, Object.is);
    commit(zooming, false, Object.is);
  }

  function unbind(): void {
    const pending = unsubscribes;
    unsubscribes = [];
    for (const off of pending) off();
  }

  /**
   * 绑定或重绑订阅（**事务语义**：任一步失败都不留半成品）。
   *
   * 为什么必须这样：`refresh()` 在「地图还没有有效视野」时会如实抛错（driver 的 getter 拿不到值）。
   * 那时 12 份 listener 已经建好，若直接退出，异常会把控制流带出 `useMapStatus()` ——
   * `onScopeDispose` 都还没注册，这批订阅**没有任何释放路径**。因此这里先 `unbind()` 再抛。
   *
   * 同一入口还负责**状态归属**：句柄换了身份（map A → map B）就先把状态复位，
   * 否则 A 的 in-flight `moving` / `zooming` 会被带到 B 上。
   */
  function bind(): void {
    unbind();
    reset();
    const { map, client } = readEventSource(source);
    if (!map || !client) return;
    const subscribe = (sdkEventName: string, listener: (event: unknown) => void): void => {
      // 一律**不**合帧：本 composable 在同一个回调里同时处理「读值」与「翻标志」，
      // 合帧会让同一帧内的 start / end 顺序倒置（见文件头第 3 条）。
      unsubscribes.push(
        subscribeMapEvent(client, map, sdkEventName, listener, {
          coalesce: false,
          scheduler: source.scheduler,
        }),
      );
    };

    for (const name of STATUS_REFRESH_EVENTS) subscribe(name, () => refresh());
    for (const name of MOVING_EVENTS) {
      subscribe(name, () => commit(moving, name !== "moveend", Object.is));
    }
    for (const name of ZOOMING_EVENTS) {
      subscribe(name, () => commit(zooming, name !== "zoomend", Object.is));
    }
    try {
      // 就绪即给一次值：消费者不必等第一个事件（也覆盖「地图创建后一直没动过」的场景）
      refresh();
    } catch (error) {
      // 事务回滚：读不到就把刚建好的订阅全部撤掉，别留下「没有任何释放路径」的半成品
      unbind();
      reset();
      throw error;
    }
  }

  const stopWatch = watch(
    [() => toValue(source.map), () => toValue(source.client)],
    () => bind(),
    { immediate: true, flush: "post" },
  );

  const dispose = (): void => {
    unbind();
    stopWatch();
  };

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    center: center as Readonly<ShallowRef<Point | null>>,
    zoom: zoom as Readonly<ShallowRef<number | null>>,
    bounds: bounds as Readonly<ShallowRef<Bounds | null>>,
    size: size as Readonly<ShallowRef<Size | null>>,
    heading: heading as Readonly<ShallowRef<number | null>>,
    tilt: tilt as Readonly<ShallowRef<number | null>>,
    moving: moving as Readonly<ShallowRef<boolean>>,
    zooming: zooming as Readonly<ShallowRef<boolean>>,
    dispose,
  };
}
