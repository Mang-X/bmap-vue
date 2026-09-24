/**
 * useInfoWindow —— InfoWindow 的生命周期内核（M5-INFOWINDOW / issue #32）
 *
 * 职责：拥有组件创建的那个 InfoWindow（创建 / 重建 / 释放）、按 desired/observed 收敛、转发 SDK 事件。
 *
 * - desired：`open` 这条 prop 表达的意图（1.0 不接受旧名 `show`）。
 * - observed：地图上实际开着的是不是这一个（`driver.overlays.isCurrentInfoWindow`）。
 * - 收敛：期望开而没开 ⇒ 打开；开着但 `position` 变了 ⇒ 再开一次（官方没有 `setPosition`）；
 *   期望关而开着 ⇒ 关闭。
 * - SDK 事件：原样转发，并作为收敛触发。
 * - 两个所有权例外：被同图另一个气泡顶掉 ⇒ 回写一次 `update:open(false)` 且不再抢回来；
 *   用户点关闭按钮 ⇒ 回写一次 `update:open(false)`。
 *
 * 宿主分工：本 composable 创建 / 释放 host；SDK 决定它打开期间挂在哪；Teleport 拥有 host 内部的渲染子树。
 *
 * 尺寸：`useResizeObserver(host, { box: "border-box" })` 触发、`readElementSize()` 读数、
 * 经 `FrameScheduler` 合帧（同 key 每帧一次），重绘后记录尺寸以免自激。
 *
 * 契约细节见 ADR `2026-09-18-infowindow-host-and-ownership`。
 */
import {
  onScopeDispose,
  shallowRef,
  watch,
  watchPostEffect,
  type ShallowRef,
} from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useRequiredMapContext } from "../context/inject";
import type { MapReadyContext } from "../context/types";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import {
  INFO_WINDOW_DESCRIPTOR_KEYS,
  INFO_WINDOW_FIELDS,
  positionKeyOf,
  resolveInfoWindowOpenIntent,
  type InfoWindowFieldUpdate,
  type InfoWindowProps,
} from "../overlays/InfoWindowSpec";
import {
  createInfoWindowManager,
  type InfoWindowManager,
} from "../overlays/InfoWindowManager";
import type { InfoWindowHandle } from "../../driver/types/handles";
import type { ResourceRegistration } from "../overlays/OverlayRegistry";
import { readElementSize } from "../runtime/elementSize";
import { stableKeyOf } from "../utils/stableKey";
import { watchKeyedSources, type KeyedSource } from "../utils/keyedSources";
import { useSdkResource } from "./useSdkResource";

/** 转发的 SDK 事件名（官方 `InfoWindowEventMap` 去掉 `resize`）。 */
const FORWARDED_SDK_EVENTS = ["open", "close", "clickclose", "maximize", "restore"] as const;
type ForwardedSdkEvent = (typeof FORWARDED_SDK_EVENTS)[number];

/**
 * `resize` 在事件矩阵里、但**没有**派发点——这不是遗漏，是一个已知的显式限制。
 *
 * 官方 `InfoWindowEventMap` 声明了 6 个事件，本文件只转发 5 个：气泡尺寸由组件自己的
 * `width` / `height` prop 驱动并经 `setContent` 重绘（见 `drainOptions`），
 * 官方的 `resize` 事件在本库**没有派发点**——`bindSdkEvents` 只遍历
 * `FORWARDED_SDK_EVENTS`，`resize` 从未注册监听，也因此没有载荷可转发；
 * 它在本库既不驱动任何状态、也不对外暴露。
 *
 * 因此 `<InfoWindow>` 的 `defineEmits` **不包含** `resize`，也不把它算进事件面
 * （`scripts/generate-overlay-emits.mts` 的载荷覆写表同款口径，见 ADR #138 决策 ⑥）。
 * 真要暴露它，得先回答「调用方拿它做什么」——目前没有可回答的消费者。
 */

export interface UseInfoWindowOptions {
  /** 组件的 `emit`。 */
  readonly emit: (name: string, payload?: unknown) => void;
  /** 诊断通道：`resource:error`。 */
  readonly reportError: (error: BMapError) => void;
  /** 组件名（诊断用）。 */
  readonly component?: string;
}

export interface UseInfoWindowResult {
  /** detached host：`<Teleport :to="host">` 的目标（实例未就绪时为 `null`）。 */
  readonly host: Readonly<ShallowRef<HTMLElement | null>>;
}

/** 当前存活实例的簿记（重建即换一份）。 */
interface ActiveInstance {
  readonly generation: number;
  readonly handle: InfoWindowHandle;
  readonly host: HTMLElement;
  readonly redrawKey: symbol;
  /** SDK 事件解绑器（实例级）。 */
  readonly unbind: Array<() => void>;
  alive: boolean;
  /** 上次观测到「开着」；只用于判断要不要排重绘。 */
  opened: boolean;
  /** 被同图另一个气泡顶掉过；父级把意图置回 `false` 时清除。 */
  suppressed: boolean;
  /** 最后一次打开命令用的位置指纹（`null` = 没下发过）。 */
  lastOpenPositionKey: string | null;
  /** 已经回写过一次「关」；回写的是状态变化，同一状态只回写一次。 */
  echoedClosed: boolean;
  /** 最后一次重绘之后的 host 尺寸，用于吞掉重绘自身引起的尺寸变化。 */
  lastRedrawnSize: string | null;
}

/** 宿主尺寸指纹（读不到为 `null`）。 */
function sizeKeyOf(host: HTMLElement | null): string | null {
  const size = readElementSize(host);
  return size ? `${size.width}x${size.height}` : null;
}

export function useInfoWindow<Props extends InfoWindowProps>(
  props: Props,
  options: UseInfoWindowOptions,
): UseInfoWindowResult {
  const mapContext = useRequiredMapContext();
  const component = options.component ?? "InfoWindow";
  const scheduler = mapContext.scheduler;

  /** 每张地图一份的资源归属账本；Context 未提供时退化为组件自持。 */
  const ownManager = createInfoWindowManager();
  const manager: InfoWindowManager = mapContext.infoWindows ?? ownManager;

  const host = shallowRef<HTMLElement | null>(null);
  const emit = options.emit;

  let activeInstance: ActiveInstance | null = null;
  /** 每代实例按自己的 handle 索引：`mount` / `bind` 拿到的 resource 不一定是 `activeInstance`。 */
  const instancesByHandle = new Map<InfoWindowHandle, ActiveInstance>();
  let readyCtx: MapReadyContext | null = null;
  let generationCounter = 0;
  /** 组件级终态：scope 释放后一切输入丢弃。 */
  let disposed = false;
  /** 「想开但缺位置」是否已报过（边沿触发）。 */
  let missingPositionNotified = false;

  onScopeDispose(() => {
    disposed = true;
    if (!mapContext.infoWindows) ownManager.dispose();
  });

  /* ------------------------------------------------------------------ 声明面自检 */

  /** 声明自相矛盾时立刻失败（`state` 字段不得有描述符键；其它字段必须有）。 */
  function assertFieldDeclarations(): void {
    const entries = Object.entries(INFO_WINDOW_FIELDS) as Array<[string, InfoWindowFieldUpdate]>;
    for (const [prop, update] of entries) {
      const declared = INFO_WINDOW_DESCRIPTOR_KEYS[prop as keyof InfoWindowProps];
      const descriptorKey = declared === undefined ? prop : declared;
      if (update === "state" && descriptorKey !== null) {
        throw new Error(
          `InfoWindowSpec: 字段 "${prop}" 由组件驱动（state），必须同时把描述符键标成 null`,
        );
      }
      if (update !== "state" && descriptorKey === null) {
        throw new Error(
          `InfoWindowSpec: 字段 "${prop}" 声明为 ${update}，却标记为不经描述符 —— 它永远不会被下发`,
        );
      }
    }
  }

  assertFieldDeclarations();

  /* ------------------------------------------------------------------ 收敛（reconcile） */

  /** 报一次「想开但缺位置」。 */
  function reportMissingPosition(): void {
    options.reportError(
      new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `<${component}>: 打开气泡必须给出 position——官方 4.0 的 map.openInfoWindow(infoWnd, point) ` +
          "里 point 是必需参数，且 InfoWindow 实例没有公开的 openInfoWindow()（气泡挂到 Marker 的" +
          "目标级打开属 M5 #31）",
      ),
    );
  }

  function toBMapError(error: unknown): BMapError {
    if (error instanceof BMapError) return error;
    return new BMapError("BMAP_SDK_CALL_FAILED", (error as Error)?.message ?? String(error), {
      cause: error,
    });
  }

  /** 读实时观测：地图上现在开着的是不是这一个。读失败时上报并返回 `false`。 */
  function observe(context: MapReadyContext, instance: ActiveInstance): boolean {
    try {
      return context.client.driver.overlays.isCurrentInfoWindow(context.map, instance.handle);
    } catch (error) {
      options.reportError(toBMapError(error));
      return false;
    }
  }

  /**
   * 事件侧同步归属：`opened` 与 Manager 只在**公开读回说「不是我」**时才清。
   *
   * 一条 `close` 可能在同一实例**重新打开之后**才迟到（那时地图上仍是它）。
   */
  function syncOwnership(context: MapReadyContext, instance: ActiveInstance): void {
    if (observe(context, instance)) return;
    instance.opened = false;
    manager.deactivate(instance.handle);
  }

  /** 当前意图：`wantOpen` 是 `open` 这条 prop；`desired` 还要求有位置（缺位置不满足打开条件）。 */
  function readIntent(): { wantOpen: boolean; positionKey: string | null; desired: boolean } {
    const wantOpen = resolveInfoWindowOpenIntent(props);
    const positionKey = positionKeyOf(props.position);
    return { wantOpen, positionKey, desired: wantOpen && positionKey !== null };
  }

  /**
   * 唯一的收敛入口：把 desired 施加到地图上。
   *
   * | desired | observed | 处置 |
   * | --- | --- | --- |
   * | 开 | 关 | `openInfoWindow(map, handle, position)` |
   * | 开 | 开，但位置指纹变了 | 再下发一次打开（重开是唯一的移动手段） |
   * | 关 | 开 | `closeInfoWindow(handle)` |
   * | 其余 | | 什么都不做 |
   */
  function reconcile(): void {
    const instance = activeInstance;
    const context = readyCtx;
    if (disposed || !instance || !instance.alive || !context) return;
    if (instance.suppressed) return;

    const { wantOpen, positionKey, desired } = readIntent();
    const position = props.position;
    // 缺位置不满足打开条件：期望为「关」，并按边沿报一次
    if (wantOpen && !desired) {
      if (!missingPositionNotified) {
        missingPositionNotified = true;
        reportMissingPosition();
      }
    } else {
      missingPositionNotified = false;
    }

    const observed = observe(context, instance);
    if (desired) {
      if (observed && instance.lastOpenPositionKey === positionKey) return;
      if (!position || positionKey === null) return;
      try {
        // 命令只表达 intent：`opened` 与 Manager 的归属都由 SDK 事件更新（打开是异步生效的）
        context.client.driver.overlays.openInfoWindow(context.map, instance.handle, position);
        instance.lastOpenPositionKey = positionKey;
      } catch (error) {
        options.reportError(toBMapError(error));
      }
      return;
    }
    if (!observed) return;
    // 刚回报过用户关闭就不再补关（读回值在关闭后仍会短暂为旧值）
    if (instance.echoedClosed) return;
    // 发起关闭后「上次打开请求的位置」不再有意义
    instance.lastOpenPositionKey = null;
    try {
      context.client.driver.overlays.closeInfoWindow(instance.handle);
    } catch (error) {
      // 失败只上报：事实（Manager 归属 / observed）保持不变，下一次触发仍会重试
      options.reportError(toBMapError(error));
    }
  }

  /**
   * 观测驱动的收敛：**一个计数器 + 一个 post-flush effect**（#138 替掉原来的双 `nextTick`）。
   *
   * ## 为什么双 `nextTick` 是承重的，以及它为什么必须被换掉
   *
   * `clickclose` 的收敛链是「转发 → `echoClosed()` 发 `update:open(false)` → 父级 `v-model`
   * 写 ref → 父组件重渲染 → 子组件 props 更新」。真正要等的是**最后一次**：收敛读的是
   * `props.open`（`readIntent()` 现读），父级重渲染之前那个值还是旧的。
   *
   * 而两跳之所以能等到，恰恰因为 `nextTick` **排在父级的 `flushJobs` 之前**：
   * `nextTick(cb)` 先入微任务队列，随后 `emit` 触发的父级更新再入一个（`queueFlush`），
   * 于是顺序是 `cb1 → flushJobs（父级重渲染）→ cb2`，`cb2` 才看得到新意图。
   * 这是一个**靠队列入队顺序**成立的时序，也是它难读、难改、难证明的原因。
   *
   * 换成 post-flush 后这个顺序由 Vue 自己保证：`watchPostEffect` 的回调在**本轮 flush 的
   * post queue** 里跑，而 post queue 排在 render effects **之后**——父级重渲染必然已经完成。
   * 于是「等父级落地」不再需要手写跳数。
   *
   * `convergeTick` 的作用从「数 tick」变成「同一轮里合并多个 SDK 事件」：
   * `open` + `close` + `clickclose` 在一次派发里连着到达时只排一次 post effect
   * （Vue 对同一轮里的多次 `trigger` 天然合并；计数器在此只当「有没有待收敛」的标志位用，
   * `=== 0` 表示尚无请求）。
   *
   * **收敛只有一个 post-flush 入口**（#138）：`onIntentChanged` 与 `scheduleConverge` 都只
   * 「请求」收敛，不自己跑。两者分离出第二个 `reconcile()` 调用点时，post effect 会紧接着
   * 再跑一次——「关闭命令抛错」那条用例正是因此多发了一次 `closeInfoWindow`（第一次抛错、
   * 第二次成功），把「失败保持事实不变、下一次触发才重试」这条不变量吃掉了。
   */
  const convergeTick = shallowRef(0);

  function scheduleConverge(): void {
    convergeTick.value += 1;
  }

  // 收敛读的是实时意图（`readIntent()` 现读 `props`），因此 post-flush 读到的必然是本轮最终值。
  // `watchPostEffect` 注册在本组件的 effect scope 里，`onScopeDispose` 随之释放。
  watchPostEffect(() => {
    if (convergeTick.value === 0) return;
    reconcile();
  });

  /** 意图变化的落点（`open` + `position` 合一的 watch）。 */
  function onIntentChanged(): void {
    const instance = activeInstance;
    if (!instance?.alive) return;
    const wantOpen = resolveInfoWindowOpenIntent(props);
    if (wantOpen) {
      instance.echoedClosed = false;
    } else {
      instance.suppressed = false;
    }
    // 与事件驱动共用同一个 post-flush 入口（见上）
    scheduleConverge();
  }

  /* ------------------------------------------------------------------ 尺寸与重绘 */

  /** 重绘一次，并记录重绘之后的尺寸。 */
  function redrawNow(instance: ActiveInstance): void {
    const context = readyCtx;
    if (!context) return;
    try {
      context.client.driver.overlays.redrawInfoWindow(instance.handle);
    } catch (error) {
      logger.warn(
        `useInfoWindow(${component}).redraw: 重绘失败: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
    instance.lastRedrawnSize = sizeKeyOf(instance.host);
  }

  /** 排队一次重绘（同 key 每帧一次）；只有观测到开着时才重绘。 */
  function scheduleRedraw(): void {
    const instance = activeInstance;
    if (!instance?.alive || !instance.opened) return;
    if (sizeKeyOf(instance.host) === instance.lastRedrawnSize) return;
    scheduler.schedule(instance.redrawKey, () => {
      if (activeInstance !== instance || !instance.alive || !instance.opened) return;
      redrawNow(instance);
    });
  }

  // 观察实际展示内容的那块 host，`border-box` 与 `readElementSize()` 同语义
  useResizeObserver(host, () => scheduleRedraw(), { box: "border-box" });

  /* ------------------------------------------------------------------ 选项落地 */

  /**
   * 标脏的选项（#138：与覆盖物内核同构——「按键标脏 + 一次排空」，合并交给 Vue 的 batching）。
   *
   * 全部 `options` 字段的 watcher 合成**一个** array-source watcher（见 `watch` 里那一段），
   * 因此「一次提交改 N 个选项」本来就只有一次回调；这里保留 `Record` 是为了同名字段只留最后
   * 一个值，以及实例未就绪时把值留到 `bind` 排空（不丢值）。
   */
  let dirtyOptions: Record<string, unknown> | null = null;

  /** 排空重入闸。排空期间新标脏的由 `while` 消费，因此入口直接返回即可。 */
  let drainingOptions = false;

  /** 按键标脏（`options` 字段的 watcher 落点）。 */
  function markOptionsDirty(updates: Record<string, unknown>): void {
    dirtyOptions = { ...(dirtyOptions ?? {}), ...updates };
    void drainOptions();
  }

  /**
   * 排空标脏的选项。`while (dirtyOptions && …)` 的两个条件各挡一类死循环：
   * - `activeInstance?.alive && readyCtx`：实例未就绪时值原样留在 `dirtyOptions`，由 `bind` 排空
   *   （否则「取出来 → 下不下发 → 放回去」会原地转）；
   * - `dirtyOptions`：取走即置空。
   */
  async function drainOptions(): Promise<void> {
    if (drainingOptions) return;
    drainingOptions = true;
    try {
      while (dirtyOptions && activeInstance?.alive && readyCtx) {
        const instance = activeInstance;
        const context = readyCtx;
        const batch = dirtyOptions;
        dirtyOptions = null;
        if (Object.keys(batch).length === 0) continue;
        try {
          context.client.driver.overlays.setOptions(instance.handle, batch);
          // 选项变化不会改到我们观察的 host 尺寸，显式补一次重绘
          if (instance.opened) redrawNow(instance);
        } catch (error) {
          logger.warn(
            `useInfoWindow(${component}).setOptions: 字段级更新失败: ${
              (error as Error)?.message ?? String(error)
            }`,
          );
        }
      }
    } finally {
      drainingOptions = false;
    }
  }

  /* ------------------------------------------------------------------ 实例生命周期 */

  const sdk = useSdkResource<InfoWindowProps, InfoWindowHandle, MapReadyContext>({
    props,
    label: "overlay:info-window",
    resolveContext: async (signal) => {
      const ready = await mapContext.whenReady(signal);
      readyCtx = ready;
      return ready;
    },
    onError: (error) => options.reportError(error),
    spec: {
      type: "info-window",

      create: ({ context }) => {
        const generation = ++generationCounter;
        const element = document.createElement("div");
        // 开放的 DOM 契约：外部据此定位 SDK 实际展示内容的那块 host
        element.setAttribute("data-bmap-infowindow-content", "");
        const handle = context.client.driver.overlays.createInfoWindow(element, {
          width: props.width,
          height: props.height,
          title: props.title,
          enableMaximize: props.enableMaximize,
          enableAutoPan: props.enableAutoPan,
          enableCloseOnClick: props.enableCloseOnClick,
          offset: props.offset,
        });
        const created: ActiveInstance = {
          generation,
          handle,
          host: element,
          redrawKey: Symbol(`info-window-redraw:${generation}`),
          unbind: [],
          alive: true,
          opened: false,
          suppressed: false,
          lastOpenPositionKey: null,
          echoedClosed: false,
          lastRedrawnSize: null,
        };
        activeInstance = created;
        instancesByHandle.set(handle, created);
        host.value = element;
        // 首次创建不发 `rebuild`
        if (generation > 1) emit("rebuild", generation);
        return handle;
      },

      mount: ({ context, resource }) => {
        const instance = instancesByHandle.get(resource);
        if (!instance) return;
        return createRegistration(context, instance, resource);
      },

      bind: ({ resource }) => {
        const instance = instancesByHandle.get(resource);
        const context = readyCtx;
        if (!instance || !context) return;
        bindSdkEvents(context, instance);
        // 就绪窗口的收敛：`create` 与 `bind` 之间到达的 prop 变化此刻补一次
        reconcile();
        // 同理排一次选项：标脏期间（`create` 是异步的）到达的选项变化此刻落到这个实例上
        void drainOptions();
      },

      watch: ({ scope }) => {
        // `open` + `position` 合成一个 watch 源，`flush: "post"`（#138）
        //
        // 为什么 post：收敛要读父级 `v-model` 的**最终**值。与事件驱动的 `scheduleConverge`
        // 共用同一个 post-flush 时序，于是「prop 驱动」与「事件驱动」两条路在同一个队列里
        // 相遇，一条 `onIntentChanged` 就够——不再需要「谁先谁后」的隐式约定。
        scope.add(
          watch(
            () =>
              `${resolveInfoWindowOpenIntent(props) ? 1 : 0}|${positionKeyOf(props.position)}`,
            () => onIntentChanged(),
            { immediate: true, flush: "post" },
          ),
        );

        // #138：所有 `options` 字段合成**一个** array-source watcher（与覆盖物内核同构）。
        // 各写各的会让 N 个回调在同一 flush 里逐个跑，第一个就把 `setOptions` 发出去；
        // 合成之后「一轮一次回调」由 Vue 的 batching 保证。
        //
        // 每个 option 源同时带「下发给 Driver 的描述符键 `key`」（声明缺省时等于 prop 名）与
        // 取当前值的 `read`——两者**同趟循环产出**：分两趟派生会分叉，而分叉的后果是
        // 「改了 prop 却改了另一个键」。
        const optionSources: KeyedSource<unknown>[] = [];
        for (const [prop, update] of Object.entries(INFO_WINDOW_FIELDS) as Array<
          [string, InfoWindowFieldUpdate]
        >) {
          if (update === "state") continue;
          const declared = INFO_WINDOW_DESCRIPTOR_KEYS[prop as keyof InfoWindowProps];
          const key = declared === undefined ? prop : declared;
          if (key === null) continue;
          if (update === "recreate") {
            // 构造期字段各自重建：`rebuild()` 本身单飞（飞行中的请求合并成一次尾随重建）
            scope.add(
              watch(
                () => stableKeyOf((props as Record<string, unknown>)[prop]),
                () => rebuild(),
              ),
            );
            continue;
          }
          // 源用稳定序列化：内联对象按内容判等
          optionSources.push({
            key,
            source: () => stableKeyOf((props as Record<string, unknown>)[prop]),
            read: () => (props as Record<string, unknown>)[prop],
          });
        }

        if (optionSources.length > 0) {
          // 回调在 post-flush 跑，因此读到的是**本轮最终**的值（不是触发那一刻的中间值）。
          // 机制见 `watchKeyedSources`（与 `useOverlaySpec` 共用同一个数组源 watcher）。
          scope.add(watchKeyedSources(optionSources, markOptionsDirty));
        }
      },
    },
  });

  /** 重建实例（构造期属性变化）：单飞，已在飞时合并成一次尾随重建。 */
  let rebuildInFlight: Promise<void> | null = null;
  let rebuildPending = false;

  function rebuild(): Promise<void> {
    if (rebuildInFlight) {
      rebuildPending = true;
      return rebuildInFlight;
    }
    const run = (async () => {
      try {
        await sdk.replace();
      } catch (error) {
        logger.warn(
          `useInfoWindow(${component}).rebuild: 重建失败: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    })().finally(() => {
      // 先清指针再看待办，否则期间到达的请求会被丢掉
      rebuildInFlight = null;
      if (rebuildPending) {
        rebuildPending = false;
        void rebuild();
      }
    });
    rebuildInFlight = run;
    return run;
  }

  /* ------------------------------------------------------------------------ 内部 */

  /** 回写一次「关」（`clickclose` 与 `superseded` 共用）；幂等。 */
  function echoClosed(instance: ActiveInstance): void {
    if (instance.echoedClosed) return;
    instance.echoedClosed = true;
    emit("update:open", false);
  }

  /**
   * 绑定 SDK 事件。顺序：先转发、再收敛（让父级的受控回写先生效）。
   *
   * 每条回调带实例身份与代次守卫，过期实例的回调不写任何东西。
   */
  function bindSdkEvents(context: MapReadyContext, instance: ActiveInstance): void {
    for (const name of FORWARDED_SDK_EVENTS) {
      const off = context.client.driver.events.on(instance.handle, name, (event: unknown) => {
        if (!instance.alive || activeInstance !== instance) return;
        switch (name as ForwardedSdkEvent) {
          case "open":
            instance.opened = true;
            manager.activate(instance.handle);
            emit("open");
            scheduleConverge();
            break;
          case "close":
            syncOwnership(context, instance);
            emit("close");
            scheduleConverge();
            break;
          case "clickclose":
            // 带来源的用户意图：转发 + 回写一次
            syncOwnership(context, instance);
            emit("clickclose", event);
            echoClosed(instance);
            scheduleConverge();
            break;
          case "maximize":
          case "restore":
            emit(name, event);
            break;
          default:
            break;
        }
      });
      instance.unbind.push(off);
    }
  }

  /** 释放凭据：`dispose()` 里按「停异步 → 解绑 → 关闭 → 释放 host」的顺序收尾。 */
  function createRegistration(
    context: MapReadyContext,
    instance: ActiveInstance,
    resource: InfoWindowHandle,
  ): ResourceRegistration<InfoWindowHandle> {
    const registration = manager.register({
      resource: instance.handle,
      onSuperseded: () => {
        if (!instance.alive) return;
        // 已经退出竞争（desired 为假）⇒ 这是陈旧账本造成的假通知
        if (!readIntent().desired) return;
        // 被同图另一个气泡顶掉：回写一次并停止抢回来，绝不碰 SDK
        instance.suppressed = true;
        instance.opened = false;
        echoClosed(instance);
      },
    });
    return {
      id: registration.id,
      type: "info-window",
      resource,
      get disposed() {
        return registration.disposed;
      },
      dispose: () => {
        // 1) 停业务异步
        instance.alive = false;
        scheduler.cancel(instance.redrawKey);
        // 2) 解绑 SDK 事件
        for (const off of instance.unbind.splice(0)) off();
        // 3) 关闭气泡（地图级入口幂等；被顶掉的一方由 Driver 守卫挡住）
        try {
          context.client.driver.overlays.closeInfoWindow(instance.handle);
        } catch {
          /* 可能已被别的实例顶掉 */
        }
        registration.dispose();
        manager.deactivate(instance.handle);
        // 4) 释放 host 与实例 scope
        if (activeInstance === instance) {
          activeInstance = null;
          host.value = null;
        }
        instance.host.remove();
        if (instancesByHandle.get(instance.handle) === instance) {
          instancesByHandle.delete(instance.handle);
        }
        emit("destroy", instance.generation);
      },
    };
  }

  return { host };
}
