/**
 * useInfoWindow —— BInfoWindow 的生命周期内核（M5-INFOWINDOW / issue #32）
 *
 * 组件只剩下「声明 + 渲染 slot」两件事：状态机（`infoWindowMachine`）、每地图的归属账本
 * （`InfoWindowManager`）、实例的创建 / 重建 / 释放都收在这里。
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
 * 2. **解绑 SDK 事件**（此后不再有任何 SDK → 模型的写入）；
 * 3. **关闭气泡**（走地图级 `closeInfoWindow()`，不回退通用 `removeOverlay()`）并交还归属；
 * 4. **释放 host**（`host.value = null` → Teleport 换目标 / 观察器解绑，再 `remove()` 摘掉节点），
 *    实例 scope 由 `useSdkResource` 收尾。
 *
 * 刻意**不**调任何「销毁 InfoWindow」的方法：官方 4.0 的 `InfoWindow` 没有公开的 destroy
 * （`Overlay#dispose()` 只在基类声明里，`InfoWindow` 自己的声明里没有），猜一个成员名属于
 * `AGENTS.md` 禁止的私有面嗅探。
 */
import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { useRequiredMapContext } from "../context/inject";
import type { MapReadyContext } from "../context/types";
import { BMapError } from "../errors/BMapError";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import { logger } from "../logger";
import { createDeprecationWarner, describeDeprecation, propAliasesOf } from "../deprecations";
import {
  INFO_WINDOW_DESCRIPTOR_KEYS,
  INFO_WINDOW_FIELDS,
  infoWindowOpenIntentUsesAlias,
  resolveInfoWindowOpenIntent,
  type InfoWindowFieldUpdate,
  type InfoWindowProps,
} from "../overlays/InfoWindowSpec";
import {
  createInfoWindowManager,
  type InfoWindowManager,
} from "../overlays/InfoWindowManager";
import {
  initialInfoWindowSnapshot,
  positionKeyOf,
  reduceInfoWindow,
  type InfoWindowAction,
  type InfoWindowEffect,
  type InfoWindowPhase,
  type InfoWindowSnapshot,
} from "../overlays/infoWindowMachine";
import type { InfoWindowHandle } from "../../driver/types/handles";
import type { ResourceRegistration } from "../overlays/OverlayRegistry";
import { readElementSize } from "../runtime/elementSize";
import { stableKeyOf } from "../utils/stableKey";
import { useSdkResource, type SdkResourceStatus } from "./useSdkResource";

/**
 * SDK 侧事件 → 组件侧事件的转发表。
 *
 * 覆盖官方 `InfoWindowEventMap` 里除 `resize` 之外的全部成员（`resize` 不转发，理由见
 * ADR `2026-09-18-infowindow-host-and-ownership` 的「不转发项」）。其中三个会驱动状态机
 * （`open` / `close` / `clickclose`），`maximize` / `restore` 只是转发 —— 它们是**界面状态**，
 * 与「打开 / 关闭」不是同一维，混进状态机会让相位变成六个。
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
 * 组件只需要 `host` 交给 Teleport。实例句柄、`status`、`phase` 都是本层内部/诊断用，
 * 等真有第二类消费者再加 —— 加一个没人读的导出会让「它是不是契约的一部分」变成糊涂账。
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
   * 每张地图一份的归属账本。自定义 Context（只实现 `MapRuntimeShape` 的适配器）可以不提供，
   * 此时退化为组件自持的账本，并在组件作用域结束时释放 —— 与 `useLayerResource` 的
   * LayerRegistry 回落同口径。
   */
  const ownManager = createInfoWindowManager();
  const manager: InfoWindowManager = mapContext.infoWindows ?? ownManager;

  const host = shallowRef<HTMLElement | null>(null);
  const phase = shallowRef<InfoWindowPhase>("closed");
  const emit = options.emit;

  /** 状态机快照。所有相位变化都经 `dispatch()`，组件里不另存一份状态。 */
  let machine: InfoWindowSnapshot = initialInfoWindowSnapshot();
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

  onScopeDispose(() => {
    // 组件级收尾：把机器推进**终态**（此后任何输入都被 `reduceInfoWindow` 丢弃，见该模块的
    // 「终态」一条），而不是在 `dispatch` 外面再挂一个并行的布尔门闩 —— 终态语义只有一处。
    dispatch({ type: "dispose" });
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
          `InfoWindowSpec: 字段 "${prop}" 由状态机驱动（state），必须同时把描述符键标成 null`,
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

  /* ------------------------------------------------------------------ 状态机驱动 */

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
   * 执行状态机下发的命令。
   *
   * **命令没下发成的每一条路径，都必须把账冲销掉**（外部评审第四轮 P1 的推广形态）。机器在
   * 下发 `open` / `close` 时已经记了一份在飞账（`effect.accounted`），只有真的把命令交给 SDK
   * 才可能有一条回包来还账；同步抛错、以及下面那个「没有可用的位置」的提前返回，都不会有回包。
   * 遗留计数不会自己消失，它会把**后续一次真实事件**归错类（外部打开被当成自己的迟到回包 ⇒ 主动关掉，
   * 或真实的关闭被当成旧命令结算 ⇒ 吞掉）。
   *
   * 命令失败时**收敛回关闭**：过渡相位不允许在效果失败后停留 —— 否则模型会一直说「开着」而地图上
   * 没有任何气泡，且再也没有事件来唤醒它。于是「打不开」与「被关掉」在本库是同一个可观察形态
   * （`update:open false`），调用方只需要处理一种。
   */
  function runEffect(effect: InfoWindowEffect): void {
    const instance = activeInstance;
    const context = readyCtx;
    if (!instance || !instance.alive || !context) return;
    if (effect.generation !== machine.generation) return;
    const driver = context.client.driver.overlays;
    const generation = instance.generation;
    /** 命令作废（没交给 SDK / 交给 SDK 但抛错）：按 `accounted` 精确冲销在飞账并收敛相位。 */
    const failCommand = (command: "open" | "close"): void => {
      dispatch({ type: "command-failed", command, accounted: effect.accounted, generation });
    };
    if (effect.type === "open") {
      // 读 `props.position` 而不是机器记下的位置指纹：效果是**同步**执行的（`dispatch` 内联调用），
      // 与产生它的那次 `intent` 是同一个 tick，因此 `props.position` 就是那次判定的位置
      // （两者分叉只可能发生在 `await` 之后，而这里没有 await）。
      const position = props.position;
      if (!position || positionKeyOf(position) === null) {
        // 防御性分支：机器用**同一个** `positionKeyOf` 算 `canOpen`，它只在 `canOpen` 时下发 `open`，
        // 因此这里按构造不可达。仍然走冲销而不是裸 `return` —— 账已经记下了，静默返回就是幽灵账。
        failCommand("open");
        return;
      }
      try {
        driver.openInfoWindow(context.map, instance.handle, position);
        // **打开成功之后**才声明归属：过早声明会在打开失败时白白顶掉别人
        manager.activate(instance.handle);
      } catch (error) {
        options.reportError(toBMapError(error));
        // 失败是**独立动作**：命令作废 ⇒ 不会有回包 ⇒ 冲销它在飞账并收敛相位。
        // 刻意**不**再伪造一条 `sdk-close`（那既冲不掉 open 侧的账，也会把还开着的气泡在
        // 模型里关掉 —— 移动请求失败时就是这种情形，外部评审第四轮 P1）。
        failCommand("open");
      }
      return;
    }
    try {
      driver.closeInfoWindow(instance.handle);
    } catch (error) {
      // 关闭失败不致命（气泡可能已被别的实例顶掉），但不得静默：留一条可观测的痕迹，
      // 并且同样按「命令作废」冲销那笔计数（否则残账会吸收后续一次真实的关闭）
      logger.warn(
        `useInfoWindow(${component}).close: 关闭气泡失败: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
      failCommand("close");
    } finally {
      manager.deactivate(instance.handle);
    }
  }

  /**
   * 唯一的状态机入口。顺序是硬要求：
   *
   * 1. **先落状态**再执行效果 —— SDK 可能在我们调用期间**同步**回调（本仓库的 Fake 就是同步的，
   *    真机在 `openInfoWindow()` 之后也会很快派发 `open`），那时机器必须已经是转换后的状态，
   *    否则嵌套进来的那次 dispatch 会按旧相位决策；
   * 2. 变化只在**真的变了**时回写（由 `changeOpen` 保证），且 `prop` 来源不回声（受控语义）。
   */
  function dispatch(action: InfoWindowAction): void {
    const transition = reduceInfoWindow(machine, action);
    machine = transition.snapshot;
    if (phase.value !== machine.phase) phase.value = machine.phase;
    for (const notice of transition.notices) {
      if (notice === "missing-position") reportMissingPosition();
    }
    for (const change of transition.changes) {
      if (change.source === "sdk") {
        emit("update:open", change.open);
        emit("update:show", change.open);
      }
      if (change.open) emit("open");
      else emit("close");
    }
    for (const effect of transition.effects) runEffect(effect);
  }

  /**
   * 把当前的受控意图喂给状态机。
   *
   * 这是 `open` / `show` / `position` 三条 prop 的**唯一**同步路径（验收「prop / SDK / map-click
   * 的竞态无重复开关回环」的可断言形态：一条路径 ⇒ 不存在两条规则各自下发命令的可能）。
   */
  function applyIntent(): void {
    if (!activeInstance?.alive) return;
    const positionKey = positionKeyOf(props.position);
    dispatch({
      type: "intent",
      wantOpen: resolveInfoWindowOpenIntent(props),
      canOpen: positionKey !== null,
      positionKey,
    });
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

  /** 排队一次重绘（同 key 每帧一次）。只有「真的开着」才重绘。 */
  function scheduleRedraw(): void {
    const instance = activeInstance;
    if (!instance?.alive) return;
    if (machine.phase !== "open") return;
    if (sizeKeyOf(instance.host) === instance.lastRedrawnSize) return;
    scheduler.schedule(instance.redrawKey, () => {
      // 排到这一帧时实例可能已经被替换 / 卸下
      if (activeInstance !== instance || !instance.alive) return;
      if (machine.phase !== "open") return;
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
          if (machine.phase === "open") redrawNow(instance);
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
    // `useSdkResource` 的观察面（resource / status / error）在本层没有消费者：状态机持有相位、
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
        // 新代次：旧代的**任何**回调立即失效（generation 不匹配），相位从 closed 起步；
        // 期望状态由 `bind` 的 reconciliation 重新施加。
        dispatch({ type: "rebuild", generation });
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
        applyIntent();
        void enqueueOptions({});
      },

      watch: ({ scope }) => {
        // 受控意图：`open` / `show` / `position` 合成**一个** watch 源，只有一个同步路径
        scope.add(
          watch(
            () =>
              `${resolveInfoWindowOpenIntent(props) ? 1 : 0}|${positionKeyOf(props.position)}`,
            () => applyIntent(),
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
   * 把旧实例的一切收起，因此这里只需要把「期望状态」记在机器里 —— `bind` 的 reconciliation 会
   * 把它重新施加到新实例上。
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
   * 关闭类事件之后，账本要不要退场 —— **判据是状态机的结论，不是「收到了一条 close」**
   * （外部评审第七轮 P1）。
   *
   * `sdk-close` 里有一类是**过期回包**：`closeOutstanding > 0` 且模型仍是「开」（重开确认先到、
   * 旧 close 后到，第一轮 P1 修复的核心）。那种情况下状态机只减账、保持 `open` —— 地图上开着的
   * 仍然是它，账本不能退场，否则又回到「地图开着、账本没有 current」的分叉，
   * 后续互斥通知会基于陈旧归属。
   *
   * 因此两个方向的**顺序要求恰好相反**：
   * - `open`：先 `manager.activate()` 再喂状态机 —— 状态机可能同步下发纠偏 close，
   *   而那条 close 的收尾会 `deactivate(自己)`，必须打在已经换成自己的账本上；
   * - `close` / `clickclose`：先喂状态机，**再按转换后的机器状态**决定是否 `deactivate`。
   *
   * 注意这里读的是 `machine` 而不是单次 transition：`dispatch` 期间可能发生（同步 SDK 回调触发的）
   * 重入，`machine` 是全部收敛完成后的状态，正是我们要的口径。
   */
  function syncLedgerAfterClose(instance: ActiveInstance): void {
    if (machine.open) return; // 过期回包：状态机仍认为开着 ⇒ 账本不动
    manager.deactivate(instance.handle);
  }

  /**
   * 绑定 SDK 事件。
   *
   * 每条回调带**两道守卫**：实例身份（`activeInstance !== instance` / `!instance.alive`）与
   * **代次**（`instance.generation !== machine.generation`）。
   *
   * ⚠️ 这两道在当前实现里是**防御性**的，不是「唯一防线」：释放路径已经先解绑事件
   * （见 `createRegistration().dispose()` 的第 2 步），因此真实到达这里的过期回调在今天的
   * 代码里构造不出来（单点反证验证过：去掉任意一道，全部用例仍是绿的）。保留它们的理由是
   * **让「回调归属」不依赖释放顺序** —— 万一将来有人把解绑挪到关闭之后（或某条路径直接
   * `close()`），过期回调仍然不会写模型、更不会下发命令。
   *
   * 真正被用例锁住的那一层是**状态机**：`reduceInfoWindow` 对代次不匹配的
   * `sdk-open` / `sdk-close` / `superseded` 一律丢弃（`infoWindowMachine.test.ts` 的
   * 「迟到回调按代次丢弃」一组）。
   */
  function bindSdkEvents(context: MapReadyContext, instance: ActiveInstance): void {
    for (const name of FORWARDED_SDK_EVENTS) {
      const off = context.client.driver.events.on(instance.handle, name, (event: unknown) => {
        if (!instance.alive || activeInstance !== instance) return;
        if (instance.generation !== machine.generation) return;
        switch (name as ForwardedSdkEvent) {
          case "open":
            // **先**把账本对齐到实际归属，**再**喂状态机（外部评审第六轮 P1）。顺序不能反：
            // `activate()` 会把真正被顶掉的那个通知为 `superseded`；而我们的状态机在
            // 「这条 open 是自己下发的、模型却是关」时会立刻下发一条纠偏 close，那条 close 的
            // 收尾会 `deactivate(自己)` —— 如果账本此刻还指着别人，那次 `deactivate` 是 no-op，
            // 结果就是「地图已经空了、账本还指着别人」的幽灵 current。
            manager.activate(instance.handle);
            dispatch({ type: "sdk-open", generation: instance.generation });
            break;
          case "clickclose":
            // 点关闭按钮：与 `close` 走同一套归属判定（含「过期回包不改账本」），
            // 另外把「是谁关的」告诉调用方。
            dispatch({ type: "sdk-close", generation: instance.generation });
            syncLedgerAfterClose(instance);
            emit("clickclose", event);
            break;
          case "maximize":
          case "restore":
            // 界面状态（最大化 / 还原），不改变「打开」这一维，只转发
            emit(name, event);
            break;
          case "close":
          default:
            // ⚠️ 顺序与 `open` 相反：**先让状态机判定这条 close 是否真的改变了「打开」这一维**，
            // 再决定账本要不要退场（过期回包只减账、不改状态 ⇒ 账本保持不动，见 `syncLedgerAfterClose`）。
            dispatch({ type: "sdk-close", generation: instance.generation });
            syncLedgerAfterClose(instance);
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
        // 被同一张地图上另一个气泡顶掉：**只收敛自己的状态**，绝不碰 SDK（见 Manager 契约）
        dispatch({ type: "superseded", generation: instance.generation });
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
        // 2) 解绑 SDK 事件（此后不再有任何 SDK → 模型的写入）
        for (const off of instance.unbind.splice(0)) off();
        // 3) 关闭气泡（地图级专用入口，不回退通用 removeOverlay）并交还归属。
        //
        // 这里**无条件**调用：气泡是不是我们「以为」开着的并不重要 —— 地图级关闭本身就幂等
        // （没有气泡时是 no-op），而被顶掉的一方由 Driver 的「只关本 Driver 最后请求打开的那个」
        // 守卫挡住，不会误伤别人。反过来「按模型跳过」会留下真实泄漏：SDK 侧已经关掉但模型已经
        // 收敛（例如 `close` 事件先到）时，卸载就再也没人去关它了。
        //
        // 也**不**回喂状态机：这条路径的服务对象是「实例」，不是「模型」。重建要在对外表现上原子
        // （只有 `destroy`/`rebuild`），回喂一条 `sdk-close` 会让父级收到一次假的 `close` 事件。
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
