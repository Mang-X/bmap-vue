/**
 * useInfoWindow —— BInfoWindow 的生命周期内核（M5-INFOWINDOW / issue #32）
 *
 * 组件只剩下「声明 + 渲染 slot」两件事：**拥有**它创建的 InfoWindow、按 desired/observed 收敛、
 * 以及实例的创建 / 重建 / 释放。
 *
 * ## ownership 契约：本库**拥有**这个 InfoWindow（2026-09-19 方向纠正）
 *
 * | 概念 | 是什么 |
 * | --- | --- |
 * | **desired** | `open`（旧名 `show`）这条 prop 表达的**唯一控制意图** |
 * | **observed** | 地图上**实际**开着的是不是这一个 —— 读官方公开的 `Map#getInfoWindow()` 再与 **handle 身份**比对（`driver.overlays.isCurrentInfoWindow`） |
 * | **SDK 事件** | `open` / `close` / `clickclose` **原样转发**给调用方，并作为**收敛触发**；它们**不是**第二套业务意图 |
 * | **收敛** | 只有四象限：`desired ∧ ¬observed ⇒ open`、`¬desired ∧ observed ⇒ close`，其余不动 |
 *
 * 之所以是这套模型：SDK 对 `open` / `close` 回调**不提供 request identity**（载荷无 id、无位置，
 * 官方也不承诺多次请求之间的回调顺序）。任何「这条回包属于哪次命令」的推断都得靠计数 / FIFO /
 * 时序去猜，组合会无穷增长（本仓库 #38 / #71 / #72 / #99 都是同一类教训）—— 那是**上层在恢复
 * 上游没公开的协议**。这里改成：本库拥有实例 ⇒ 只回答「地图上现在是不是我」，不问「这条回调是谁的」。
 *
 * 因此下面这些**刻意不再存在**：业务相位（`closed` / `opening` / `open` / `closing`）、
 * 在飞命令计数、命令失败冲销、回包配对窗口。留下的只有「按意图把地图收敛到期望状态」。
 *
 * **两个必须保留的例外**（它们不是「回包归属推断」，而是本库自己的所有权事实）：
 *
 * - **被同图另一个气泡顶掉**：由 per-map `InfoWindowManager` 通知。此时回写一次
 *   `update:open(false)` 并进入「不再抢回来」状态，直到父级把意图置回 `false` 再置 `true`
 *   —— 否则两个都写 `open: true` 的气泡会互相顶替、无限来回。
 * - **用户点了关闭按钮（`clickclose`）**：这是带明确来源的**用户意图**，回写一次
 *   `update:open(false)`（`clickclose` 事件本身也照常转发）。
 *
 * ## detached host 的所有权（本 issue 的核心）
 *
 * 气泡的内容节点由 **SDK 持有**（`new BMap.InfoWindow(host, opts)` 之后 SDK 会把它搬进自己的
 * 容器），而渲染子树由 **Vue Teleport 拥有**。旧实现把「Vue 渲染出来的 shell」直接交给 SDK 搬动，
 * 于是 Vue 的节点引用与实际父节点会分叉（官方 React 库 v2 的做法是
 * `ReactDOM.render(children, host)` 之后**从不 unmount**，那条路径会永久泄漏一棵渲染树）。
 *
 * 现在的分工：
 *
 * | 谁 | 拥有什么 |
 * | --- | --- |
 * | 本 composable | host 元素的**创建与释放**（`document.createElement("div")` / `host.remove()`），经 `host` ref 交给 Teleport |
 * | SDK | host 在**打开期间**的挂载位置（它可以把它搬进自己的容器） |
 * | Vue Teleport | host 内部的渲染子树（卸载 / 重建时随组件生命周期收起） |
 *
 * `host` 是 `shallowRef`：`<Teleport :to="host">` 直接吃它，重建时 Teleport 自动换目标，旧实例
 * 已经排队的重绘由 `scheduler.cancel(redrawKey)` 丢弃。
 *
 * ## 尺寸观察：观察**实际内容 host**，合帧只重绘一次
 *
 * 旧实现用无界 MutationObserver（`childList + subtree + characterData`）把「渲染树结构变了」
 * 当成「尺寸变了」——它既漏掉「文本没变但字体 / 图片异步加载导致尺寸变化」，又会对每次 DOM 变更
 * 触发一次 `redraw()`。现在：
 *
 * 1. **触发源**是 `useResizeObserver(host)`（观察的就是 SDK 实际展示内容的那块 host，不是占位 shell）；
 * 2. **读数**走项目统一的 `readElementSize()`（布局盒口径，与观察器的触发语义一致，见
 *    `core/runtime/elementSize.ts`）；
 * 3. **合帧**走地图的 `FrameScheduler`：同 key 每帧只保留最后一次任务 ⇒ 一帧内多次尺寸通知只重绘一次；
 * 4. **不自激**：重绘完成后记录**重绘之后**的尺寸，由重绘自身引起的那次变化因此与记录相等而被吞掉。
 *
 * 观察器对象是**组件级**的（一份，随组件 scope 释放），而它的**绑定目标**跟着实例走：host 换新时
 * VueUse 的 `cleanup()` 会先 `disconnect()` 旧目标再 observe 新目标 ⇒「host 重建时解绑旧目标」
 * 是结构上的事实，重建多次也只有 1 个观察者。
 *
 * ## 卸载顺序（验收项，逐步可断言）
 *
 * `registration.dispose()`（由 `useSdkResource` 在释放实例 scope **之前**调用）里严格按序：
 *
 * 1. **停业务异步**：`alive = false`（所有实例回调立刻失效）+ 取消排队中的重绘；
 * 2. **解绑 SDK 事件**（此后不再有任何 SDK → 组件的写入）；
 * 3. **关闭气泡**（走地图级 `closeInfoWindow()`，不回退通用 `removeOverlay()`）并交还归属；
 * 4. **释放 host**（`host.value = null` → Teleport 换目标 / 观察器解绑，再 `remove()` 摘掉节点），
 *    实例 scope 由 `useSdkResource` 收尾。
 *
 * 刻意**不**调任何「销毁 InfoWindow」的方法：官方 4.0 的 `InfoWindow` 没有公开的 destroy
 * （`Overlay#dispose()` 只在基类声明里，`InfoWindow` 自己的声明里没有），猜一个成员名属于
 * `AGENTS.md` 禁止的私有面嗅探。
 */
import { nextTick, onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useRequiredMapContext } from "../context/inject";
import type { MapReadyContext } from "../context/types";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import { createDeprecationWarner, describeDeprecation, propAliasesOf } from "../deprecations";
import {
  INFO_WINDOW_DESCRIPTOR_KEYS,
  INFO_WINDOW_FIELDS,
  infoWindowOpenIntentUsesAlias,
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
import { useSdkResource } from "./useSdkResource";

/**
 * SDK 侧事件 → 组件侧事件的转发表。
 *
 * 覆盖官方 `InfoWindowEventMap` 里除 `resize` 之外的全部成员（`resize` 不转发，理由见
 * ADR `2026-09-18-infowindow-host-and-ownership` 的「不转发项」）。它们**全部原样转发**，
 * 其中 `open` / `close` / `clickclose` 同时作为**收敛触发**（不是业务状态）。
 */
const FORWARDED_SDK_EVENTS = ["open", "close", "clickclose", "maximize", "restore"] as const;
type ForwardedSdkEvent = (typeof FORWARDED_SDK_EVENTS)[number];

export interface UseInfoWindowOptions {
  /** 组件的 `emit`。动态事件名在这里集中收窄一次（不让 `as` 散到各处）。 */
  readonly emit: (name: string, payload?: unknown) => void;
  /** 诊断通道：失败交给地图事件总线的 `resource:error`（与其它覆盖物同一条出口）。 */
  readonly reportError: (error: BMapError) => void;
  /** 组件名（诊断用）。 */
  readonly component?: string;
}

/**
 * 观察面**只暴露有消费者的东西**（与 ADR 2026-09-17 决策 1 对 `useOverlaySpec` 的口径一致）：
 * 组件只需要 `host` 交给 Teleport。
 */
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
  /** SDK 事件解绑器（实例级，必须能**先于**关闭命令逐个调用）。 */
  readonly unbind: Array<() => void>;
  alive: boolean;
  /**
   * 「上一次**观测到**它是开着的」——**只用来决定要不要排重绘**，不参与任何收敛判断。
   *
   * 之所以敢缓存：重绘早一帧 / 晚一帧都不改变对外语义；而每次尺寸变化都去读一次 SDK
   * （`getInfoWindow()`）既贵又没必要。真正的收敛判断永远读实时观测，不读这个字段。
   */
  opened: boolean;
  /**
   * 是否处于「被顶掉之后不抢回来」：同图另一个气泡接管过之后置位，
   * 直到父级把意图置回 `false` 再置 `true` 才清除（见模块注释的 ownership 契约）。
   */
  suppressed: boolean;
  /**
   * 最后一次**我们下发打开命令**用的位置指纹。
   *
   * 官方 4.0 的 `InfoWindow` **没有 `setPosition`**（ADR 2026-09-13 的实测结论：位置只能由
   * `map.openInfoWindow(iw, point)` 提供），所以「开着但位置变了」只能**再下发一次打开**。
   * 没有它的话，「desired 与 observed 一致就什么都不做」会把**移动**整个丢掉。
   */
  lastOpenPositionKey: string | null;
  /**
   * 已经向父级回写过一次「关」？
   *
   * 回写表达的是**状态变化**，不是事件计数 —— 同一次用户点击可能来多条 `clickclose`
   * （实测：条数随实例被打开过几次累积），而父级只需要被告知一次。
   * 父级把意图置回「开」时复位（下一次关闭又是一次新的状态变化）。
   */
  echoedClosed: boolean;
  /** 最后一次**重绘之后**的 host 尺寸（读不到为 `null`），用来吞掉由重绘自身引起的尺寸变化。 */
  lastRedrawnSize: string | null;
}

/**
 * 宿主尺寸的指纹。
 *
 * 读不到（元素不存在 / 环境不提供读数）返回 `null`，**不**用 `""` 之类的哨兵把「读不到」与
 * 「某一具体尺寸」合并 —— 与 `core/runtime/elementSize.ts` 的既有口径一致（那条口径的理由是
 * 「两者对调用方的处理相同，但语义不同」）。
 */
function sizeKeyOf(host: HTMLElement | null): string | null {
  const size = readElementSize(host);
  return size ? `${size.width}x${size.height}` : null;
}

export function useInfoWindow<Props extends InfoWindowProps>(
  props: Props,
  options: UseInfoWindowOptions,
): UseInfoWindowResult {
  const mapContext = useRequiredMapContext();
  const component = options.component ?? "BInfoWindow";
  const scheduler = mapContext.scheduler;

  /**
   * 每张地图一份的**资源归属**账本（谁的文件是当前项）。自定义 Context（只实现
   * `MapRuntimeShape` 的适配器）可以不提供，此时退化为组件自持的账本，并在组件作用域结束时释放
   * —— 与 `useLayerResource` 的 LayerRegistry 回落同口径。
   */
  const ownManager = createInfoWindowManager();
  const manager: InfoWindowManager = mapContext.infoWindows ?? ownManager;

  const host = shallowRef<HTMLElement | null>(null);
  const emit = options.emit;

  let activeInstance: ActiveInstance | null = null;
  /**
   * **每一代实例按它自己的 handle 索引**（创建时登记、释放时摘除）。
   *
   * `useSdkResource` 的释放路径会在「已过期的那一代」上补调一次 `spec.mount({ resource })`
   * 再立刻 `dispose()`（见它 `createOnce()` 的 stale 分支）。那一代**不一定是** `activeInstance`
   * ——成功路径上 `activeInstance` 永远是最后创建的那一个，而 stale 分支拿到的可能是更早的
   * `resource`。因此 `mount` / `bind` 必须**按传进来的 handle 取实例**：用全局的 `activeInstance`
   * 去代表它，轻则配不上（旧实例没人释放），重则拿新实例去给旧 resource 记账（外部评审 P1）。
   */
  const instancesByHandle = new Map<InfoWindowHandle, ActiveInstance>();
  let readyCtx: MapReadyContext | null = null;
  let generationCounter = 0;
  /** 组件级终态：scope 释放后一切输入丢弃（**唯一**一处终态标记）。 */
  let disposed = false;
  /** 「想开但缺位置」只报一次：进入该状态时报，离开即复位（与旧口径一致）。 */
  let missingPositionNotified = false;

  onScopeDispose(() => {
    disposed = true;
    if (!mapContext.infoWindows) ownManager.dispose();
  });

  /* ------------------------------------------------------------------ 声明面自检 */

  /**
   * 声明自相矛盾时立刻失败（与 `useOverlaySpec` 的 `assertOverlayFieldDeclarations` 同口径）：
   * 把 `state` 字段挂到描述符键上会让它被 `setOptions` 静默丢弃；把 `options` 字段标成
   * `null` 则永远不会被下发。两者在运行时的表现都是「改了 prop 没反应」，排查成本极高。
   */
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

  /**
   * 集中弃用层：`show`（v2 的 `v-model:show`）由 `core/deprecations` 统一处置 ——
   * 稳定 code、统一文案、**同实例只警告一次**、production 默认不输出。
   *
   * 组件**不**写自己的兼容代码，也不自己拼告警文案（那是 #28 明令禁止、#31 收掉的形态）。
   * 告警只在旧名**确实是数据来源**时发：正典 `open` 一旦有值，`show` 完全不参与（连告警都不发）。
   */
  const deprecation = createDeprecationWarner(component);
  if (infoWindowOpenIntentUsesAlias(props)) {
    const alias = propAliasesOf("info-window").find((entry) => entry.canonical === "open");
    if (alias) deprecation.warn(describeDeprecation(alias));
  }

  /* ------------------------------------------------------------------ 收敛（reconcile） */

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

  /**
   * 读**实时观测**：地图上现在开着的是不是这一个。
   *
   * 读失败时**不静默当成「不是我」**：那会让收敛朝错误方向走（明明开着却以为没开 ⇒ 再开一次）。
   * 报错之后按「没观测到」返回 —— 收敛本身是幂等的，下一次触发会重新读。
   */
  function observe(context: MapReadyContext, instance: ActiveInstance): boolean {
    try {
      return context.client.driver.overlays.isCurrentInfoWindow(context.map, instance.handle);
    } catch (error) {
      options.reportError(toBMapError(error));
      return false;
    }
  }

  /**
   * **唯一的收敛入口**。desired 与 observed 决定要不要下发命令，再加上一条**移动**规则：
   *
   * | desired | observed | 处置 |
   * | --- | --- | --- |
   * | 开 | 关 | `openInfoWindow(map, handle, position)` |
   * | 开 | 开，但位置指纹变了 | **再下发一次打开**（官方没有 `setPosition`，重开是唯一的移动手段） |
   * | 关 | 开 | `closeInfoWindow(handle)` |
   * | 其余 | | 什么都不做 |
   *
   * 「缺位置」是 desired 不成立的**前置**（不是失败）：只按边沿报一次，不产生命令。
   */
  function reconcile(): void {
    const instance = activeInstance;
    const context = readyCtx;
    if (disposed || !instance || !instance.alive || !context) return;
    if (instance.suppressed) return;

    const wantOpen = resolveInfoWindowOpenIntent(props);
    const position = props.position;
    const positionKey = positionKeyOf(position);
    // **「缺位置」不满足打开条件**：想开但没有可用位置时，期望状态是「关」（旧口径「气泡打开必须给出
    // position」的延续）。因此它既不该下发打开命令，也不该让已经开着的气泡继续留着 ——
    // 只按边沿报一次错。
    const canOpen = positionKey !== null;
    if (wantOpen && !canOpen) {
      if (!missingPositionNotified) {
        missingPositionNotified = true;
        reportMissingPosition();
      }
    } else {
      missingPositionNotified = false;
    }
    const desired = wantOpen && canOpen;

    const observed = observe(context, instance);
    if (desired) {
      if (observed && instance.lastOpenPositionKey === positionKey) return;
      if (!position || positionKey === null) return; // 上面已经挡掉；这里只为收窄类型
      try {
        context.client.driver.overlays.openInfoWindow(context.map, instance.handle, position);
        // **打开命令成功之后**才声明归属：过早声明会在打开失败时白白顶掉别人
        manager.activate(instance.handle);
        instance.opened = true;
        instance.lastOpenPositionKey = positionKey;
      } catch (error) {
        options.reportError(toBMapError(error));
      }
      return;
    }
    if (!observed) return;
    // 用户刚关掉它（`clickclose`，我们已经把这个状态回报给父级）⇒ **不再补一条关闭命令**：
    // 真实 SDK 的 `getInfoWindow()` 在关闭之后还会短暂返回旧值（异步拆除），照读回值再关一次
    // 只会白叫一次 `closeInfoWindow()` 并多转发一条 `close` 事件（外部评审第十一轮实测到）。
    // 父级再次要求「开」时 `echoedClosed` 会复位，所以这不影响后续任何一次真实的关闭。
    if (instance.echoedClosed) return;
    try {
      context.client.driver.overlays.closeInfoWindow(instance.handle);
    } catch (error) {
      // 关闭失败不致命（气泡可能已被别的实例顶掉），但不得静默
      logger.warn(
        `useInfoWindow(${component}).close: 关闭气泡失败: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    } finally {
      manager.deactivate(instance.handle);
      instance.opened = false;
      instance.lastOpenPositionKey = null;
    }
  }

  /**
   * **观测驱动**的收敛：合并到本 task 的末尾、且**在父级的受控更新落地之后**再执行一次。
   *
   * 两个原因，都是实测逼出来的：
   *
   * 1. 一次用户操作会被 SDK 派发成**一组**事件（实测：点关闭按钮产生 `close` + `clickclose`×N，
   *    都在同一个 task 内），它们描述的是**同一个新局面**。逐条收敛会在了解全貌之前先动一次 ——
   *    先因 `close` 重新打开、再因 `clickclose` 又关掉，一次可见的闪烁。
   * 2. 更关键的是**顺序**：`update:open` 靠父级（`v-model`）把 `open` 改成新值，而那次赋值要等
   *    Vue 的渲染 flush 才反映到 `props` 上。若收敛只排一个微任务，它会在 flush **之前**跑 ——
   *    读到的是**旧的** `open`（仍是 `true`）⇒ 把刚被用户关掉的气泡又打开一次。
   *    `nextTick()` 的语义正是「本轮的渲染 flush 之后」，因此用它。
   *
   * 这里不合并任何事件本身：每条事件照旧各自被转发、各自生效。prop 驱动的意图变化**不**走这里 ——
   * 那是所有者的命令，必须同步落到地图上。
   */
  let convergeQueued = false;

  function scheduleConverge(): void {
    if (convergeQueued) return;
    convergeQueued = true;
    // **两跳** `nextTick`：第一跳把「本轮渲染 flush」排进微任务队列，第二跳落在它**之后** ——
    // 于是读到的 `open` 是父级（`v-model`）已经落地的最新值，而不是陈旧的 prop。
    // 只跳一次会在 flush 之前跑：那样「用户点关闭按钮」这一组事件里先到的 `close` 会看到
    // 仍是 `true` 的旧 prop，把气泡重新打开一次（实测：多出一次 open + 一次 close 的闪烁）。
    void nextTick(() => {
      void nextTick(() => {
        convergeQueued = false;
        reconcile();
      });
    });
  }

  /**
   * 意图变化（`open` / `show` / `position` 合一的那条 watch）的落点。
   *
   * 「父级把意图置回 `false`」也是**解除「被顶掉后不抢回来」**的唯一依据：父级再次明确要求打开时
   * 会经历一次 `false → true`，那时才允许抢回来（见模块注释）。
   */
  function onIntentChanged(): void {
    const instance = activeInstance;
    if (!instance?.alive) return;
    const wantOpen = resolveInfoWindowOpenIntent(props);
    if (wantOpen) {
      // 父级又要求「开」⇒ 下一次关闭是一次**新的**状态变化，需要重新回写
      instance.echoedClosed = false;
    } else {
      instance.suppressed = false;
    }
    reconcile();
  }

  /* ------------------------------------------------------------------ 尺寸与重绘 */

  /** 真正重绘一次，并把「重绘之后的尺寸」记进账（防自激：见模块注释）。 */
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

  /** 排队一次重绘（同 key 每帧一次）。只有「上次观测到开着」才重绘。 */
  function scheduleRedraw(): void {
    const instance = activeInstance;
    if (!instance?.alive || !instance.opened) return;
    if (sizeKeyOf(instance.host) === instance.lastRedrawnSize) return;
    scheduler.schedule(instance.redrawKey, () => {
      // 排到这一帧时实例可能已经被替换 / 卸下
      if (activeInstance !== instance || !instance.alive || !instance.opened) return;
      redrawNow(instance);
    });
  }

  // 观察器在 setup 期同步创建（scope 绑定可靠），目标即是 host —— 实例换新时 VueUse 会
  // disconnect 旧目标再 observe 新目标（这就是「host 重建时解绑旧目标」）。
  //
  // `box: "border-box"` 是**必须**的：读数走 `readElementSize()`（布局盒 = border-box），
  // 而 `ResizeObserver` 的默认是 `content-box` —— 两者不同语义时，`class` / `style` 带来的
  // padding / border 变化会出现「布局盒变了但不通知」（ADR 2026-09-14 已知限制 5 的同一条）。
  useResizeObserver(host, () => scheduleRedraw(), { box: "border-box" });

  /* ------------------------------------------------------------------ 选项落地 */

  let pendingOptions: Record<string, unknown> | null = null;
  let draining = false;

  /**
   * 就地更新：按键合并成一批下发（同键后写覆盖先写），单飞排空；实例未就绪时留在待办里，
   * 由 `bind` 的 reconciliation 排空。
   *
   * **与 `useOverlaySpec` 的更新队列逐条对齐**（同键合并 / 单飞 / 排空期间新值并入 / 后到者胜 /
   * 没有落点时留在待办里），只有两处因为「气泡不是覆盖物」而不同：
   *
   * 1. 这里**没有重建分类**：气泡的构造期属性（`offset`）变化走的是显式的 `rebuild()`，
   *    不靠「批里有没有 recreate 键」推断；
   * 2. 没有落点时的判据是 `activeInstance`（实例身份），不是 `sdk.resource.value`
   *    —— 本层的实例簿记在 `activeInstance` 上（`useSdkResource` 的观察面在本层没有消费者）。
   *
   * 两处刻意不抽共享原语：仓库里同样的取舍已经做过一次（ADR 2026-09-17 决策 2 与已知限制 2 把
   * 「队列语义逐条对齐 + 一处刻意差异」写成契约，而不是抽出 `useOverlayResource` 与
   * `useOverlaySpec` 共用的队列），再抽一次会要求两处统一**异常策略**（那边 setOptions 之外
   * 的异常向上抛、这边全部就地告警），那是对已合并路径的行为改动。
   * **改其中一处时必须同时改另一处**，收口在 #31/#33（ADR 2026-09-17 已知限制 6）。
   */
  async function enqueueOptions(updates: Record<string, unknown>): Promise<void> {
    pendingOptions = { ...(pendingOptions ?? {}), ...updates };
    if (draining) return;
    draining = true;
    try {
      while (pendingOptions && activeInstance?.alive && readyCtx) {
        const instance = activeInstance;
        const context = readyCtx;
        const batch = pendingOptions;
        pendingOptions = null;
        if (Object.keys(batch).length === 0) continue;
        try {
          context.client.driver.overlays.setOptions(instance.handle, batch);
          // 选项变化（尤其 width/height）不会改到我们观察的 host 尺寸，因此显式补一次重绘；
          // 它与观察器共用同一本「已重绘尺寸」账，不会与观察器互相激发。
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
      draining = false;
    }
  }

  /* ------------------------------------------------------------------ 实例生命周期 */

  const sdk = useSdkResource<InfoWindowProps, InfoWindowHandle, MapReadyContext>({
    // `useSdkResource` 的观察面（resource / status / error）在本层没有消费者：
    // 实例句柄走 `activeInstance`。保留 `sdk` 只是为了 `replace()`（重建）。
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
        // 开放的 DOM 契约：外部（宿主页 / 浏览器 smoke）据此定位到 SDK 实际展示内容的那块 host，
        // 用来检查「内容是否可见」「卸载后是否残留」。host 由本层创建与释放，SDK 只决定它挂在哪。
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
        // host 先交给 Teleport；注册与事件绑定的失败路径都不影响它的释放（dispose 里有 remove）
        host.value = element;
        // **首次创建不发 `rebuild`**：那个名字的语义是「实例被重建」。父级在挂载组件时本来就知道
        // 实例要建（它需要一个信号来重新施加 DOM 操作的是「重建之后」这一次）。
        if (generation > 1) emit("rebuild", generation);
        return handle;
      },

      mount: ({ context, resource }) => {
        // **按 handle 取实例**（不是 `activeInstance`）：stale 分支会把更早那一代的 resource
        // 传进来，它必须连同自己那一代一起被记账 / 释放。
        const instance = instancesByHandle.get(resource);
        if (!instance) return;
        return createRegistration(context, instance, resource);
      },

      bind: ({ resource }) => {
        // 同上：按 handle 取实例（`instancesByHandle` 里找不到说明这一代已经被释放）
        const instance = instancesByHandle.get(resource);
        const context = readyCtx;
        if (!instance || !context) return;
        bindSdkEvents(context, instance);
        // 就绪窗口的收敛（与 `useOverlaySpec` 的 4b 同口径）：`create` 与 `bind` 之间到达的
        // prop 变化在实例上还没有落点，此刻补一次「意图 + 待办选项」。
        // 这里是**同步**的：意图是所有者下达的命令，不该被推迟一个微任务。
        reconcile();
        void enqueueOptions({});
      },

      watch: ({ scope }) => {
        // 受控意图：`open` / `show` / `position` 合成**一个** watch 源，只有一个同步路径
        scope.add(
          watch(
            () =>
              `${resolveInfoWindowOpenIntent(props) ? 1 : 0}|${positionKeyOf(props.position)}`,
            () => onIntentChanged(),
            { immediate: true },
          ),
        );
        for (const [prop, update] of Object.entries(INFO_WINDOW_FIELDS) as Array<
          [string, InfoWindowFieldUpdate]
        >) {
          if (update === "state") continue;
          const declared = INFO_WINDOW_DESCRIPTOR_KEYS[prop as keyof InfoWindowProps];
          const key = declared === undefined ? prop : declared;
          if (key === null) continue;
          if (update === "recreate") {
            scope.add(
              watch(
                () => stableKeyOf((props as Record<string, unknown>)[prop]),
                () => rebuild(),
              ),
            );
            continue;
          }
          scope.add(
            watch(
              // watch 源用**稳定序列化**：父级每次渲染传内联对象也会被按内容判等
              () => stableKeyOf((props as Record<string, unknown>)[prop]),
              () => void enqueueOptions({ [key]: (props as Record<string, unknown>)[prop] }),
            ),
          );
        }
      },
    },
  });

  /**
   * 重建实例（构造期属性变化）—— **单飞 + 合并成一次尾随重建**。
   *
   * `useSdkResource.replace()` 是**原子替换**：先释放旧实例（含关闭气泡、解绑事件、摘掉 host），
   * 再创建新的，中间不会同时存在两个。释放路径本身已经通过 `createRegistration().dispose()`
   * 把旧实例的一切收起，因此这里只需要让新实例的 `bind` 收敛一次即可。
   *
   * ## 为什么要串行化（外部评审 P1）
   *
   * 两条 `replace()` 重叠时，先发起的那条会以「token 已过期」的身份走完它的 stale 清理路径 ——
   * 而那条路径里 `mount({ resource })` 拿到的是**它自己那一代**的 resource。重叠本身就让
   * 「哪一代对应哪个实例」这件事必须靠身份而不是靠全局变量来回答（见 `instancesByHandle`）。
   * 串行化把这件事**从结构上**变成不可能：任何时刻只有一次 `replace()` 在飞，过期清理只会
   * 发生在「组件正在卸载」这一条路径上（已由 `createRegistration().dispose()` 的身份判定覆盖）。
   *
   * 语义：**已经在飞时，新请求合并成一次尾随重建**（而不是排队 N 次）——
   * `create` 每次都读当前 props，因此尾随那次一定用最新值；连续的构造期变化只多付一次重建。
   */
  let rebuildInFlight: Promise<void> | null = null;
  let rebuildPending = false;

  function rebuild(): Promise<void> {
    if (rebuildInFlight) {
      rebuildPending = true;
      return rebuildInFlight;
    }
    // 销毁之后 `useSdkResource.replace()` 自己会短路（`disposed || componentScope.isDisposed`）
    const run = (async () => {
      try {
        await sdk.replace();
      } catch (error) {
        // replace 内部已经把失败交到 `resource:error`（`useSdkResource.onError`）；这里只是兜底，
        // 不让它变成未处理的 rejection
        logger.warn(
          `useInfoWindow(${component}).rebuild: 重建失败: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    })().finally(() => {
      // 先清指针、**再**看一次待办：否则「最后一次 replace 之后、清指针之前」到达的请求会被丢掉，
      // 实例就会停在不是最新 props 的那一代上。
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

  /**
   * 回写一次「关」：`clickclose`（用户意图）与 `superseded`（被同图另一个气泡顶掉）共用。
   *
   * **幂等**：回写的是状态变化而不是事件计数，所以同一状态只回写一次（见 `echoedClosed`）。
   */
  function echoClosed(instance: ActiveInstance): void {
    if (instance.echoedClosed) return;
    instance.echoedClosed = true;
    emit("update:open", false);
    emit("update:show", false);
  }

  /**
   * 绑定 SDK 事件。
   *
   * **顺序是契约的一部分：先转发、再收敛。** 受控父级（`v-model:open`）在收到事件的那一帧就会把
   * `open` 改成新值；先转发让那次同步回写生效，随后的收敛因此看到的是**父级最新的意图**
   * ——「用户点了 X」这类事件不会因为我们抢在父级之前收敛而把气泡重新拉开。
   *
   * 每条回调带**两道守卫**：实例身份（`activeInstance !== instance` / `!instance.alive`）与
   * **代次**（`instance.generation !== activeInstance?.generation`）。它们让「过期实例的回调」
   * 不写任何东西 —— **不再有命令在飞，所以也不存在半途的状态需要它去收尾**。
   */
  function bindSdkEvents(context: MapReadyContext, instance: ActiveInstance): void {
    for (const name of FORWARDED_SDK_EVENTS) {
      const off = context.client.driver.events.on(instance.handle, name, (event: unknown) => {
        if (!instance.alive || activeInstance !== instance) return;
        switch (name as ForwardedSdkEvent) {
          case "open":
            // 观测到「我开着」⇒ 资源账本跟上（它会通知被顶掉的那一个），再转发、再收敛
            instance.opened = true;
            manager.activate(instance.handle);
            emit("open");
            scheduleConverge();
            break;
          case "close":
            instance.opened = false;
            manager.deactivate(instance.handle);
            emit("close");
            scheduleConverge();
            break;
          case "clickclose":
            // 用户点了关闭按钮：这是**带明确来源的用户意图**（官方契约：「点击信息窗口的关闭按钮时触发」），
            // 因此除了原样转发，还要回写一次 `update:open(false)` 让受控父级跟上。
            instance.opened = false;
            manager.deactivate(instance.handle);
            emit("clickclose", event);
            echoClosed(instance);
            scheduleConverge();
            break;
          case "maximize":
          case "restore":
            // 界面状态（最大化 / 还原），不改变「打开」这一维，只转发
            emit(name, event);
            break;
          default:
            break;
        }
      });
      instance.unbind.push(off);
    }
  }

  /**
   * 一等释放凭据。`useSdkResource` 会在释放实例 scope **之前**调用它的 `dispose()`，
   * 因此这里就是「先停异步 → 解绑 → 关闭 → 释放 host」这条顺序的唯一落点。
   */
  function createRegistration(
    context: MapReadyContext,
    instance: ActiveInstance,
    resource: InfoWindowHandle,
  ): ResourceRegistration<InfoWindowHandle> {
    const registration = manager.register({
      resource: instance.handle,
      onSuperseded: () => {
        if (!instance.alive) return;
        // 被同一张地图上另一个气泡顶掉：**只收敛自己的状态**，绝不碰 SDK（见 Manager 契约）。
        // 回写一次「关」让受控父级跟上，并在父级再次明确要求打开之前**不抢回来** ——
        // 否则两个都写 `open: true` 的气泡会互相顶替、无限来回。
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
        // 1) 停业务异步：所有实例回调立刻失效，并丢弃排队中的重绘
        instance.alive = false;
        scheduler.cancel(instance.redrawKey);
        // 2) 解绑 SDK 事件（此后不再有任何 SDK → 组件的写入）
        for (const off of instance.unbind.splice(0)) off();
        // 3) 关闭气泡（地图级专用入口，不回退通用 removeOverlay）并交还归属。
        //
        // 这里**无条件**调用：气泡是不是我们「以为」开着的并不重要 —— 地图级关闭本身就幂等
        // （没有气泡时是 no-op），而被顶掉的一方由 Driver 的守卫挡住，不会误伤别人。
        // 反过来「按观测跳过」会留下真实泄漏：SDK 侧已经关掉但观测还是 true 时，卸载就再也没人去关它了。
        try {
          context.client.driver.overlays.closeInfoWindow(instance.handle);
        } catch {
          /* 忽略：可能已被别的实例顶掉 */
        }
        registration.dispose();
        manager.deactivate(instance.handle);
        // 4) 释放 host（Teleport 换目标 + 观察器解绑）与实例 scope（由 useSdkResource 收尾）
        if (activeInstance === instance) {
          activeInstance = null;
          host.value = null;
        }
        instance.host.remove();
        // 摘掉索引（按身份判等：被替换的那一代不该把新主人从表里删掉）
        if (instancesByHandle.get(instance.handle) === instance) {
          instancesByHandle.delete(instance.handle);
        }
        emit("destroy", instance.generation);
      },
    };
  }

  return { host };
}
