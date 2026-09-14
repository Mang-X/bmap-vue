/**
 * v4 MapDriver（M3A2-MAP / issue #20）
 *
 * 把 JSAPI 4.0 的 `BMap.Map` 收敛成项目领域映射（`MapDriver`），公共 API 零新增。
 *
 * 行为依据（官方 4.0 文档 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - 构造：`new BMap.Map(idOrElement, options)`，`MapOptions` 支持 `center` / `zoom` /
 *   `heading` / `tilt` / `minZoom` / `maxZoom` / `displayOptions` 与一组 `enable*` 开关；
 * - 视野：`centerAndZoom` 一次设定（v4 **没有** `setView`），后续受控更新走
 *   `setCenter` / `setZoom` 两个独立调用；
 * - 摇摆/倾斜：`setHeading` / `setTilt` 有动画选项；`getHeading()` 返回**带符号**角度
 *   （`setHeading(270)` → `getHeading()` 为 `-90`），因此 heading 不是纯 round-trip 值；
 * - 交互：官方 4.0 API 参考仍公开列出成对 `enable*` / `disable*` 方法（本 facet 使用它们，
 *   原因见 ADR 2026-09-11-jsapi-v4-map-facet「为什么不用 setOptions」）；
 * - 路况：v4 把路况收敛成 `TrafficLayer`，`Map` 自身没有开关 → 交由 Layer Facet（#22），
 *   本 facet 显式 warn + no-op；
 * - 释放：`destroy()` 清空 Map 自身监听器但管不到子对象，因此 Driver 先摘掉自己的订阅分组
 *   与动画引用，再销毁 SDK 对象。
 *
 * 生命周期：每张地图的销毁状态由 `WeakMap<raw, Teardown>` 上的状态机表达
 * （`disposed` / `disposing` / `tornDown` / `released`，见 `Teardown` 注释）。「清理完成」
 * 的判据是「无失败 && 没有未 settled 的动画记录」，不是「同步调用没抛错」；取消失败或仍有
 * 停不掉的动画时保留 `destroy` 重试入口。`disposed` 同时保证「destroy 过程中的重入调用」与
 * 「destroy 之后的命令」都被拒绝（`BMAP_RESOURCE_DISPOSED`）。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import type { CapabilityRegistry } from "../capability/registry";
import type { Bounds, GeometryDriver, Pixel, Point } from "../types/geometry";
import { HANDLE_BRAND, type MapHandle, type SdkHandle } from "../types/handles";
import type {
  InitialMapOptions,
  MapDriver,
  MapInteraction,
  MapType,
  MapView,
} from "../types/map";
import type { JsapiV4EventDriver } from "./events";
import {
  assertJsapiV4Namespace,
  callOptional,
  callRequired,
  isObjectLike,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 语义交互名 → 官方成对方法名（与 4.0 API 参考逐一对应）。
 *
 * **`tilt-gestures` 的成员存在性有分歧，因此这里不预判**：官方 4.0 API 参考的 `BMap.Map`
 * 方法表与 `@baidumap/jsapi-v4-types@4.0.4` 都没有 `enableTiltGestures()` / `disableTiltGestures()`
 * （对比 `enableRotateGestures()` 是有的），而公开的 React 参考实现 `huiyan-fe/react-bmap`
 * 直接调用它们并用 try/catch 吞掉失败。本 Facet 既不臆造声明、也不靠异常控制流：
 * `setInteraction` 先做**结构性存在判断**，有就调用、没有就告警一次（见实现）。
 *
 * 与 `webgl-v1/map.ts` 的同名映射表**刻意保持两份**：跨引擎抽取会让 #26 待删除的实现
 * 阻塞 v4 底座（见 ADR 2026-09-11-jsapi-v4-driver-foundation「负面 / 成本」）。
 */
const INTERACTION_METHODS: Record<MapInteraction, { enable: string; disable: string }> = {
  dragging: { enable: "enableDragging", disable: "disableDragging" },
  "scroll-zoom": { enable: "enableScrollWheelZoom", disable: "disableScrollWheelZoom" },
  "inertial-dragging": { enable: "enableInertialDragging", disable: "disableInertialDragging" },
  "pinch-zoom": { enable: "enablePinchToZoom", disable: "disablePinchToZoom" },
  keyboard: { enable: "enableKeyboard", disable: "disableKeyboard" },
  "double-click-zoom": { enable: "enableDoubleClickZoom", disable: "disableDoubleClickZoom" },
  "continuous-zoom": { enable: "enableContinuousZoom", disable: "disableContinuousZoom" },
  "resize-on-center": { enable: "enableResizeOnCenter", disable: "disableResizeOnCenter" },
  rotate: { enable: "enableRotate", disable: "disableRotate" },
  "rotate-gestures": { enable: "enableRotateGestures", disable: "disableRotateGestures" },
  tilt: { enable: "enableTilt", disable: "disableTilt" },
  "tilt-gestures": { enable: "enableTiltGestures", disable: "disableTiltGestures" },
};

/**
 * 语义地图类型 → `BMap.MapTypeId` 静态成员名**候选**（按顺序取第一个存在的）。
 *
 * 常量从 **SDK 命名空间**读取（`MapTypeId` 的静态成员），不读全局 `BMAP_*_MAP`：
 * Driver 边界只认 `rawSdk` 传入的命名空间，避免访问未经 Provider 校验的全局值。
 *
 * **顺序由真实运行决定，不由类型声明决定**（R25-E / issue #74 的 required smoke 实测）：
 *
 * - 上游 `@baidumap/jsapi-v4-types@4.0.4` 的 `map-type/MapTypeId.d.ts` 声明的是
 *   `BMAP_NORMAL_MAP` 这类成员名；
 * - 真实 `v=4.0` 运行时的 `BMap.MapTypeId` 实际只有 `{ NORMAL, EARTH, SATELLITE }`；
 *   带 `BMAP_` 前缀的那组常量挂在**全局**（`globalThis.BMAP_NORMAL_MAP`），
 *   `MapTypeId.BMAP_NORMAL_MAP` 是 `undefined`。
 *
 * 于是「只看声明」的实现在真实 SDK 上会让 `<BMap>` 直接落到 `error` 状态（ready 永远不来）。
 * 处置：**运行时名做主候选**，声明里的名字留作后备（不同构建/别名下仍可解析），
 * 每个名字都只经由 `readNamespaceMember` 读命名空间成员，**不猜常量值、不读全局**。
 * 依据见 ADR `2026-09-11-jsapi-v4-map-facet` §9 与 `docs/zh-CN/contributing/v4-browser-smoke.md`。
 */
const MAP_TYPE_CONSTANT_CANDIDATES: Record<MapType, readonly string[]> = {
  normal: ["NORMAL", "BMAP_NORMAL_MAP"],
  satellite: ["SATELLITE", "BMAP_SATELLITE_MAP"],
  earth: ["EARTH", "BMAP_EARTH_MAP"],
};

/**
 * 项目 MapOptions 与 v4 `MapOptions` 同名的键（直接映射）。
 *
 * 刻意**不透传**整个项目 options 对象：`InitialMapOptions` 的索引签名允许任意键，整体透传等于
 * 依赖 SDK 静默忽略不认识的键（「依赖隐式默认」）。
 */
const PASSTHROUGH_OPTION_KEYS = ["minZoom", "maxZoom", "displayOptions"] as const;

/**
 * 库固定默认的交互开关（写进构造 options，不依赖 v4 隐式默认）。
 *
 * 只列**库与 v4 默认不一致**或库已声明默认值的项：组件 `<BMap>` 的默认是
 * `enableDragging: true` / `enableScrollWheelZoom: false`，而 v4 的 `enableWheelZoom`
 * 隐式默认是 `true`——不显式固定就会「同一个组件换引擎后行为改变」。其余交互项库没有声明默认值，
 * 沿用 v4 默认（差异清单见 ADR）。
 */
const LIBRARY_MAP_DEFAULTS: Record<string, unknown> = {
  enableDragging: true,
  enableWheelZoom: false,
};

/** 项目已声明但 v4 `MapOptions` 无对应项、且无法无损翻译的键。 */
const UNSUPPORTED_OPTION_KEYS = new Set(["backgroundColor", "restrictCenter"]);

export interface CreateJsapiV4MapDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
  /** 同 Client 的 v4 EventDriver：`destroy` 需要它的 target 释放入口。 */
  events: JsapiV4EventDriver;
}

function numberOf(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BMapError("BMAP_SDK_CALL_FAILED", `${label} 返回了非数值: ${String(value)}`, {
      engine: "jsapi-v4",
    });
  }
  return value;
}

/**
 * 视角动画的生命周期记录（PR #60 评审 P1/P2、复审 P1/P2）。
 *
 * 官方 4.0 的动画是**异步启动**的（`startViewAnimation` 内部按 `delay` 用 setTimeout 启动，
 * 没有公开句柄），且 `animationstart` 在内部 Animation 构造**之前**同步派发。因此「取消」
 * 只在启动之后才合法，在这之前调用一律抛 `TypeError`。四个状态就是把
 * 「已派发启动事件」和「已经进入可取消窗口」分开：
 *
 * - `started=false` + `cancelRequested=true`：收到了停止/销毁请求，但要等启动后的微任务才取消；
 * - `started=true` + `settled=false`：可以立刻取消；
 * - `settled=true`：已正常结束或已取消，无需再取消。
 *
 * `started` **只能在 `animationstart` 那次派发结束后的微任务里置位**（复审 P2）：派发期间
 * 内部 Animation 还不存在，此时若认为「可取消」，同一轮派发里后执行的业务监听器就会
 * 立刻去取消而抛 `TypeError`。因此监听器的注册顺序不能影响结果——两种顺序都必须走延迟取消。
 */
interface AnimationRecord {
  readonly instance: unknown;
  started: boolean;
  settled: boolean;
  cancelRequested: boolean;
  /** 解绑 Driver 挂在动画实例上的生命周期监听器。 */
  detach: () => void;
}

/**
 * 每张地图的销毁状态机（两轮评审的收敛点）。
 *
 * 转换（`destroy` 是唯一推进者，动画的安全窗口是唯一的异步推进点）：
 *
 * ```text
 *                 ┌─ 有未启动动画 → 登记取消请求 → 等安全窗口（animationstart 之后的微任务）
 * destroy() ──────┤                                   ├─ 取消成功 → 执行步骤 → released
 *   disposed=true │                                   └─ 取消失败 → 保留记录 + 抛错（destroy 可重试）
 *                 └─ 其它 → 立即执行步骤（release + SDK destroy）→ released
 * ```
 *
 * 四个标记各管一件事，**不能互相替代**：
 * - `disposed`：命令闸门（入口即置位；destroy 过程中的重入命令会被拒）；
 * - `disposing`：清理在飞（防同步重入，例如业务在 `animationcancel` 回调里再次 destroy）；
 * - `tornDown`：订阅与 SDK 对象已释放（重试时不再重复执行步骤，避免二次销毁 SDK 对象）；
 * - `released`：**全部**完成（含所有动画记录 settled）→ `destroy` 的幂等短路条件。
 *
 * 「完成」的判据是 **无失败 && 没有未 settled 的动画记录**（记录为空即全部 settled），
 * 而不是「同步调用没抛错」：未启动的动画也是未完成资源——它的取消只是被**请求**了，
 * 还没确认（复审 P1）。
 */
interface Teardown {
  /** 命令闸门 */
  disposed: boolean;
  /** 清理进行中（防重入） */
  disposing: boolean;
  /** 订阅 + SDK 对象已释放 */
  tornDown: boolean;
  /** 全部完成（含动画） */
  released: boolean;
  /** 本次尝试收集到的失败（每次尝试开始时清空） */
  failures: unknown[];
  /** 待启动动画的清理体：等安全窗口执行 */
  deferredFinish: (() => void) | null;
  /** 兜底定时器：动画始终不启动时也能推进销毁 */
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  /** 清理体需要句柄（微任务里拿不到调用方的 map 参数） */
  handle: MapHandle | null;
}

export function createJsapiV4MapDriver(input: CreateJsapiV4MapDriverInput): MapDriver {
  const { rawSdk, geometry, capabilities, registry, events } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);
  const MapCtor = namespaceCtor(namespace, "Map");
  const mapTypeId = readNamespaceMember(rawSdk, "MapTypeId");

  /** raw map → 销毁状态机。 */
  const teardowns = new WeakMap<object, Teardown>();
  /**
   * raw map → 该地图上**所有未结束**动画的记录集合。
   *
   * 用集合而不是「最近一个」：替换动画时如果取消失败，单槽位会把旧记录覆盖掉，于是那份动画
   * 再也清理不到（复审 P2）。集合让每份动画都有独立的清理路径。
   */
  const animations = new WeakMap<object, Set<AnimationRecord>>();

  const teardownOf = (raw: object): Teardown => {
    let state = teardowns.get(raw);
    if (!state) {
      state = {
        disposed: false,
        disposing: false,
        tornDown: false,
        released: false,
        failures: [],
        deferredFinish: null,
        fallbackTimer: null,
        handle: null,
      };
      teardowns.set(raw, state);
    }
    return state;
  };

  let droppedOptionsWarned = false;
  let trafficWarned = false;
  /** 已告警过的缺失交互方法（按方法名去重；每个 Driver 一份）。 */
  const warnedInteractionMethods = new Set<string>();

  /** 句柄 → 存活的 raw map：所有权校验 + 销毁后拒绝命令。 */
  const resolveLive = (map: MapHandle): object => {
    const raw = registry.resolve<object>(map);
    if (teardowns.get(raw)?.disposed) {
      throw new BMapError(
        "BMAP_RESOURCE_DISPOSED",
        "地图已销毁：destroy 之后的命令一律拒绝（避免继续访问已释放的 WebGL/监听器资源）",
        { engine: "jsapi-v4" },
      );
    }
    return raw;
  };

  const noop = (): void => {};

  const recordsOf = (raw: object): AnimationRecord[] =>
    animations.has(raw) ? [...animations.get(raw)!] : [];

  /** 仍在跑的动画（已启动但没 settled）：这类无法交付的清理必须保留重试入口。 */
  const hasUnstoppedAnimation = (raw: object): boolean =>
    recordsOf(raw).some((record) => record.started && !record.settled);

  /** 还没启动、也还没结束的动画：取消只能被请求，等安全窗口才能确认。 */
  const hasPendingStart = (raw: object): boolean =>
    recordsOf(raw).some((record) => !record.started && !record.settled);

  /** 释放记录：从集合移除并解绑生命周期监听器（按身份移除，不影响同地图的其它动画记录）。 */
  const dropRecord = (raw: object, record: AnimationRecord): void => {
    const records = animations.get(raw);
    if (records) {
      records.delete(record);
      if (records.size === 0) animations.delete(raw);
    }
    record.detach();
  };

  const addRecord = (raw: object, record: AnimationRecord): void => {
    const records = animations.get(raw);
    if (records) records.add(record);
    else animations.set(raw, new Set([record]));
  };

  /**
   * 在**安全窗口**内取消动画。
   *
   * - 未启动：只登记取消请求——此窗口内 SDK 会抛 `TypeError`，取消要等 `animationstart`
   *   之后的微任务（见 `trackAnimation`）；
   * - 已启动：立即取消，**成功之后**才标记结束并释放记录。取消失败时记录保留，
   *   因此调用方（`stopViewAnimation` / `startViewAnimation` / `destroy`）可以重试。
   */
  const cancelAnimation = (raw: object, record: AnimationRecord): void => {
    if (record.settled) {
      dropRecord(raw, record);
      return;
    }
    if (!record.started) {
      record.cancelRequested = true;
      return;
    }
    sdkCall("map.cancelViewAnimation", () =>
      callOptional(raw, "cancelViewAnimation", record.instance),
    );
    // 官方取消实现会派发 animationcancel（由监听器置位）；这里兜底，保证记录一定被释放
    record.settled = true;
    dropRecord(raw, record);
  };

  /** 取消该地图上所有未结束的动画；任一失败则汇总抛出（记录保留以便重试）。 */
  const cancelAllAnimations = (raw: object): void => {
    const records = recordsOf(raw);
    const failures: unknown[] = [];
    for (const record of records) {
      try {
        cancelAnimation(raw, record);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `取消视角动画时有 ${failures.length} 项失败（记录保留，可再次 stop/destroy 重试）: ` +
          failures.map((failure) => (failure as Error)?.message ?? String(failure)).join("; "),
        { cause: failures[0], engine: "jsapi-v4" },
      );
    }
  };

  /**
   * 完成判据：**无失败 && 没有未 settled 的动画记录**（记录集合为空即全部 settled）。
   *
   * 未启动的动画也算未完成资源——它的取消只是被请求了，还没确认；只有它的记录被释放
   * （取消成功 / 正常结束）才算这笔账结清（复审 P1）。
   */
  const completeIfDone = (raw: object, state: Teardown): void => {
    if (state.failures.length > 0) return;
    if (state.tornDown && recordsOf(raw).length === 0) state.released = true;
  };

  /**
   * 合成 `destroy` 事件（M4-EVENTS / #28 评审 P1）。
   *
   * 官方在**我们摘掉订阅之后**才派发 `destroy`（`release` 先于销毁 SDK 对象），所以订阅者在
   * 正常路径下永远看不到它——「Catalog 里声明了 `destroy` 却收不到」是假支持。这里在 `release`
   * 之前派发一次同语义事件：载荷走同一条归一化路径，`raw` 是被销毁的那个 SDK 对象。
   *
   * 用户 handler 抛错**不影响**销毁推进（只告警）：销毁是命令方的事，不能被订阅者打断。
   */
  const dispatchDestroy = (state: Teardown): void => {
    if (!state.handle || state.tornDown) return;
    try {
      events.dispatch(state.handle, "destroy", state.handle.raw);
    } catch (error) {
      logger.warn(
        `MapDriver: destroy 事件的订阅者抛错（不阻断销毁）: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  };

  /** 执行「合成 destroy + 释放订阅 + 销毁 SDK 对象」：只执行一次，重试不会二次销毁 SDK 对象。 */
  const runTeardownSteps = (state: Teardown): void => {
    if (!state.handle) return;
    dispatchDestroy(state);
    try {
      events.release(state.handle);
    } catch (error) {
      state.failures.push(error);
    }
    if (state.tornDown) return;
    try {
      sdkCall("map.destroy", () => callOptional(state.handle!.raw, "destroy"));
      state.tornDown = true;
    } catch (error) {
      state.failures.push(error);
    }
  };

  const clearFallback = (state: Teardown): void => {
    if (state.fallbackTimer !== null) {
      clearTimeout(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  };

  /** 微任务 / 定时器里没有调用方能承接错误：告警并保留 `destroy` 重试入口。 */
  const guard = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      logger.warn(
        `MapDriver: 延迟清理未完成（保留 destroy 重试入口）: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  };

  /**
   * 推进一次清理。
   *
   * 步骤：取消所有未结束动画 → 释放订阅 + 销毁 SDK 对象（只做一次）→ 按完成判据收尾。
   * 任一环节失败或仍有「停不掉的动画」时汇总抛出，且**不**置 `released`，
   * 保证 `destroy` 是一个真正可用的重试入口。
   */
  const finish = (raw: object, state: Teardown): void => {
    if (state.released) return;
    state.failures.length = 0;
    clearFallback(state);
    state.deferredFinish = null;

    try {
      cancelAllAnimations(raw);
    } catch (error) {
      state.failures.push(error);
    }
    runTeardownSteps(state);
    state.disposing = false;
    completeIfDone(raw, state);

    if (state.failures.length > 0 || hasUnstoppedAnimation(raw)) {
      const details = state.failures
        .map((failure) => (failure as Error)?.message ?? String(failure))
        .join("; ");
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `地图销毁时有 ${state.failures.length || 1} 项清理未完成（其余步骤已尽力执行；再次 destroy 会重试）` +
          (details ? `: ${details}` : ": 仍有未停止的视角动画"),
        { cause: state.failures[0], engine: "jsapi-v4" },
      );
    }
  };

  /** 安全窗口到达：先完成待办取消，再补齐被推迟的销毁清理。 */
  const settleAtSafePoint = (raw: object, record: AnimationRecord): void => {
    record.started = true;
    if (!record.settled && record.cancelRequested) {
      try {
        cancelAnimation(raw, record);
      } catch (error) {
        // 微任务里没有调用方能承接错误：告警并保留记录，让 stop/destroy 之后可以重试
        logger.warn(
          `MapDriver: 视角动画的延迟取消失败（记录保留，可再次 stopViewAnimation/destroy 重试）: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    }

    const state = teardowns.get(raw);
    if (!state) return;
    if (hasPendingStart(raw)) return; // 还有别的未启动动画：继续等
    if (!state.deferredFinish) {
      // 兜底已经推进过清理：这里只补一次完成判据（动画 settle 后再置 released）
      completeIfDone(raw, state);
      return;
    }
    const deferredFinish = state.deferredFinish;
    state.deferredFinish = null;
    clearFallback(state);
    guard(() => deferredFinish());
  };

  /** 建立生命周期记录：订阅动画自身的 start / end / cancel，掌握可取消窗口。 */
  const trackAnimation = (raw: object, instance: unknown): AnimationRecord => {
    const record: AnimationRecord = {
      instance,
      started: false,
      settled: false,
      cancelRequested: false,
      detach: noop,
    };

    const addEventListener = readNamespaceMember(instance, "addEventListener");
    const removeEventListener = readNamespaceMember(instance, "removeEventListener");
    if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
      // 不是能观察生命周期的动画对象：无法等待安全窗口，只能按「已启动」尽力取消
      record.started = true;
      return record;
    }

    const bind = addEventListener as (type: string, fn: () => void) => void;
    const unbind = removeEventListener as (type: string, fn: () => void) => void;

    const onStart = (): void => {
      // 官方：animationstart 在内部 Animation 构造之前同步派发，所以**本次派发期间**
      // 还不能取消（同一轮里后注册的业务监听器也可能来取消）。一律等微任务。
      Promise.resolve().then(() => settleAtSafePoint(raw, record));
    };
    const onSettled = (): void => {
      record.settled = true;
      dropRecord(raw, record);
    };

    bind.call(instance, "animationstart", onStart);
    bind.call(instance, "animationend", onSettled);
    bind.call(instance, "animationcancel", onSettled);
    record.detach = () => {
      try {
        unbind.call(instance, "animationstart", onStart);
        unbind.call(instance, "animationend", onSettled);
        unbind.call(instance, "animationcancel", onSettled);
      } catch (error) {
        logger.warn(
          `MapDriver: 解绑视角动画生命周期监听器失败: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    };
    return record;
  };

  const toRawCenter = (center: Point | string): unknown =>
    typeof center === "string" ? center : geometry.toRawPoint(center);

  const toV4MapOptions = (options?: InitialMapOptions): Record<string, unknown> => {
    const mapped: Record<string, unknown> = { ...LIBRARY_MAP_DEFAULTS };
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      if ((PASSTHROUGH_OPTION_KEYS as readonly string[]).includes(key)) {
        mapped[key] = value;
        continue;
      }
      if (UNSUPPORTED_OPTION_KEYS.has(key)) {
        dropped.push(key);
        continue;
      }
      // 索引签名键：v4 自身构造选项的显式逃生口，按原样透传。
      mapped[key] = value;
    }
    if (dropped.length > 0 && !droppedOptionsWarned) {
      droppedOptionsWarned = true;
      logger.warn(
        `MapDriver: 项目 MapOptions 的 ${dropped.join(" / ")} 在 JSAPI 4.0 无对应构造项，已丢弃` +
          "（范围限制请用 restrictBounds(bounds)，容器背景请用样式）；不透传给 SDK 以免依赖其静默忽略",
      );
    }
    return mapped;
  };

  const resolveMapTypeConstant = (type: MapType): unknown => {
    const candidates = MAP_TYPE_CONSTANT_CANDIDATES[type];
    if (!candidates) {
      throw new BMapError("BMAP_INVALID_ARGUMENT", `未知地图类型: ${String(type)}`, {
        engine: "jsapi-v4",
      });
    }
    for (const constantName of candidates) {
      const value = readNamespaceMember(mapTypeId, constantName);
      if (value != null) return value;
    }
    throw new BMapError(
      "BMAP_SDK_CALL_FAILED",
      `BMap.MapTypeId 缺少 "${type}" 的地图类型常量（已尝试 ${candidates.join(" / ")}）`,
      { engine: "jsapi-v4", component: "MapDriver" },
    );
  };

  /**
   * 视角动画实例 → 原生 SDK 对象。
   *
   * 只能有一个入口：凡带 Handle 品牌的对象**一律**交给 Registry 解析，由它做所有权校验
   * （跨 Client 抛 `BMAP_HANDLE_FOREIGN`）。用 `registry.owns()` 做前置判断是个错误——
   * 它把「别的 Client 的 Handle」和「原生 SDK 对象」都归到 `false`，于是外来句柄会被当作
   * 原生对象**原样透传**给 SDK（PR #60 评审 P2）。
   */
  const resolveAnimation = (animation: unknown): unknown => {
    if (isObjectLike(animation) && HANDLE_BRAND in animation) {
      return registry.resolve(animation as SdkHandle<string>);
    }
    if (!isObjectLike(animation)) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `视角动画实例必须是对象或本 Client 的 Handle（收到 ${typeof animation}）`,
        { engine: "jsapi-v4" },
      );
    }
    return animation;
  };

  return {
    create(container, options) {
      const mapOptions = toV4MapOptions(options);
      const raw = sdkCall("Map", () => new MapCtor(container, mapOptions));
      return registry.adopt("map", raw);
    },

    destroy(map) {
      const raw = registry.resolve<object>(map);
      const state = teardownOf(raw);
      // 幂等短路只认「全部完成」；清理在飞时直接返回（防重入：业务可能在 animationcancel
      // 回调里再次 destroy，重复走一遍会二次销毁 SDK 对象）
      if (state.released || state.disposing) return;
      state.handle = map;
      state.disposed = true;
      state.disposing = true;

      // 进入待销毁状态就先登记取消请求：待启动的动画在这个时刻无法取消（SDK 抛 TypeError），
      // 请求先挂上，等它进入安全窗口再确认（复审 P1）
      try {
        cancelAllAnimations(raw);
      } catch (error) {
        state.failures.push(error);
      }

      // 仍有待启动动画 → 按官方参考把「取消 + 销毁 Map」一起推迟到安全窗口；
      // 兜底定时器保证动画始终不启动时也能推进销毁（迟到启动由记录自己的安全点兜住）。
      // 注意：兜底**不**置 released —— 未 settled 的记录仍算未完成资源（复审 P1）。
      if (hasPendingStart(raw)) {
        state.deferredFinish = () => finish(raw, state);
        state.fallbackTimer = setTimeout(() => {
          state.fallbackTimer = null;
          guard(() => finish(raw, state));
        }, 0);
        return;
      }

      finish(raw, state);
    },

    initializeView(map, view: MapView) {
      const raw = resolveLive(map);
      // 先校验能力再动 SDK 状态：能力守卫在 throw 策略下会抛错，先抛就不会留下
      // 「已 centerAndZoom 但 heading 未应用」的半初始化视野。
      const applyHeading = view.heading != null;
      const applyTilt = view.tilt != null;
      if (applyHeading) capabilities.require("map.heading");
      if (applyTilt) capabilities.require("map.tilt");

      // 初次视野用 centerAndZoom 一次设定（v4 无 setView）；显式 noAnimation，
      // 不依赖 v4 隐式默认，也避免 resetView 时产生动画跳变。
      const options = { noAnimation: true };
      if (typeof view.center === "string") {
        callRequired(raw, "centerAndZoom", view.center, view.zoom, options);
      } else {
        callRequired(raw, "centerAndZoom", geometry.toRawPoint(view.center), view.zoom, options);
      }
      if (applyHeading) callOptional(raw, "setHeading", view.heading, options);
      if (applyTilt) callOptional(raw, "setTilt", view.tilt, options);
    },

    setCenter(map, center) {
      callRequired(resolveLive(map), "setCenter", toRawCenter(center));
    },

    getCenter(map) {
      return geometry.fromRawPoint(callRequired(resolveLive(map), "getCenter"));
    },

    setZoom(map, zoom) {
      callRequired(resolveLive(map), "setZoom", zoom);
    },

    getZoom(map) {
      const raw = resolveLive(map);
      return numberOf("map.getZoom", callRequired(raw, "getZoom"));
    },

    setHeading(map, heading) {
      const raw = resolveLive(map);
      capabilities.require("map.heading");
      callOptional(raw, "setHeading", heading);
    },

    getHeading(map) {
      const raw = resolveLive(map);
      capabilities.require("map.heading");
      return numberOf("map.getHeading", callOptional(raw, "getHeading"));
    },

    setTilt(map, tilt) {
      const raw = resolveLive(map);
      capabilities.require("map.tilt");
      callOptional(raw, "setTilt", tilt);
    },

    getTilt(map) {
      const raw = resolveLive(map);
      capabilities.require("map.tilt");
      return numberOf("map.getTilt", callOptional(raw, "getTilt"));
    },

    getBounds(map) {
      const raw = resolveLive(map);
      return geometry.fromRawBounds(callRequired(raw, "getBounds"));
    },

    getSize(map) {
      const raw = resolveLive(map);
      return geometry.fromRawSize(callRequired(raw, "getSize"));
    },

    pointToPixel(map, point) {
      const raw = resolveLive(map);
      capabilities.require("map.pixel-conversion");
      return geometry.fromRawPixel(
        callRequired(raw, "pointToPixel", geometry.toRawPoint(point)),
      );
    },

    pixelToPoint(map, pixel) {
      const raw = resolveLive(map);
      capabilities.require("map.pixel-conversion");
      return geometry.fromRawPoint(
        callRequired(raw, "pixelToPoint", geometry.toRawPixel(pixel)),
      );
    },

    panTo(map, point) {
      callOptional(resolveLive(map), "panTo", geometry.toRawPoint(point));
    },

    panBy(map, pixel) {
      // v4 `panBy(x, y, options?)` 接收两个数字，不是 Pixel 对象
      callOptional(resolveLive(map), "panBy", pixel.x, pixel.y);
    },

    fitBounds(map, bounds: Bounds) {
      const raw = resolveLive(map);
      capabilities.require("map.viewport");
      // v4 没有 fitBounds：用 setViewport 包含西南 / 东北两个角点（官方语义保证包含传入坐标）
      callOptional(raw, "setViewport", [
        geometry.toRawPoint(bounds.southwest),
        geometry.toRawPoint(bounds.northeast),
      ]);
    },

    setViewport(map, points: readonly Point[], options?: Record<string, unknown>) {
      const raw = resolveLive(map);
      capabilities.require("map.viewport");
      callOptional(raw, "setViewport", points.map((point) => geometry.toRawPoint(point)), options ?? {});
    },

    checkResize(map) {
      callOptional(resolveLive(map), "checkResize");
    },

    setMapType(map, type) {
      callOptional(resolveLive(map), "setMapType", resolveMapTypeConstant(type));
    },

    setMapStyle(map, style) {
      const raw = resolveLive(map);
      capabilities.require("map.style");
      callOptional(raw, "setMapStyle", style as Record<string, unknown>);
    },

    setInteraction(map, name, enabled) {
      const raw = resolveLive(map);
      const methods = INTERACTION_METHODS[name];
      if (!methods) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知交互项: ${String(name)}`, {
          engine: "jsapi-v4",
        });
      }
      const method = enabled ? methods.enable : methods.disable;
      // 结构性存在判断，而不是靠异常分类（ADR 2026-09-11-jsapi-v4-driver-foundation 拒绝
      // 用异常做控制流）：有就调、没有就告警一次。这样上游文档缺失不会让一个可能可用的
      // 开关静默失效，也不会臆造类型声明（`tilt-gestures` 的两处官方来源不一致）。
      const fn = readNamespaceMember(raw, method);
      if (typeof fn !== "function") {
        if (!warnedInteractionMethods.has(method)) {
          warnedInteractionMethods.add(method);
          logger.warn(
            `MapDriver.setInteraction: 当前 SDK 没有 ${method}()（官方 4.0 参考与类型包未声明该成员），` +
              `本次 "${name}" 开关被忽略；若构造期支持，请在 options 中显式传入`,
          );
        }
        return;
      }
      sdkCall(method, () => (fn as () => unknown).apply(raw));
    },

    setTraffic(map, enabled) {
      resolveLive(map);
      void enabled;
      // v4 把路况收敛为 TrafficLayer（`map.addLayer`），Map 自身没有开关。
      // 这里不做「看起来生效」的静默降级：显式告警一次，由 Layer Facet（#22）承接。
      if (!trafficWarned) {
        trafficWarned = true;
        logger.warn(
          "MapDriver.setTraffic: JSAPI 4.0 的路况是 TrafficLayer，需经 Layer Facet（#22 / M3A2-CONTROLS-LAYERS）接入；" +
            "本次调用被忽略，未对地图产生任何效果",
        );
      }
    },

    startViewAnimation(map, animation) {
      const raw = resolveLive(map);
      capabilities.require("map.animate");
      const instance = resolveAnimation(animation);

      // 同一张地图不应同时跑两个动画：先把未结束的都停掉。
      // 取消失败时**不替换**——旧记录保留可重试，否则它会变成再也清理不到的动画（复审 P2）。
      cancelAllAnimations(raw);

      // 取消旧动画会同步触发业务的 animationcancel 回调，业务可能在里面销毁地图；
      // 这里必须重新检查存活，否则会在已销毁的地图上启动新动画（复审 P2）。
      if (teardowns.get(raw)?.disposed) {
        throw new BMapError(
          "BMAP_RESOURCE_DISPOSED",
          "取消上一个视角动画的过程中地图被销毁，本次 startViewAnimation 未执行",
          { engine: "jsapi-v4" },
        );
      }

      const record = trackAnimation(raw, instance);
      addRecord(raw, record);
      callOptional(raw, "startViewAnimation", instance);
    },

    stopViewAnimation(map) {
      const raw = resolveLive(map);
      capabilities.require("map.animate");
      if (!animations.has(raw)) return;
      // 未启动 → 登记取消请求（启动后由微任务取消）；已启动 → 立即取消；
      // 取消失败 → 记录保留并抛出，下一次 stop/destroy 仍可重试
      cancelAllAnimations(raw);
    },
  };
}
