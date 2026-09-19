/**
 * useContextMenu —— `<BContextMenu>` 的生命周期内核（M5-CUSTOM-MENU / issue #33）
 *
 * ## 它拥有什么、不拥有什么（ownership-first）
 *
 * | 事实 | 所有者 | 本层的做法 |
 * | --- | --- | --- |
 * | 菜单实例、菜单项、宽度 | **本库**（props / 声明式 children 决定） | 指纹变了才重建菜单 |
 * | 菜单挂在哪个目标上、是否挂着 | **本库**（`visible` + 最近的 TargetContext） | 身份记账 + 先摘后挂，绝不重复下发 |
 * | 菜单当前是否**展开** | **SDK / 用户**（右键驱动） | 只转发 `open` / `close`，**不回写**成受控状态 |
 * | 哪一条菜单项被选中 | **SDK**（经 `MenuItem` 回调给出） | 在回调里派发 `select` + 调用调用方的回调 |
 *
 * 「不把 `open`/`close` 升级成第二写入口」是 issue 的 ownership-first 补充里点名的一条：官方没有
 * 可靠的「打开状态」读回，也没有「请求在某个位置打开」的公开入口（`ContextMenu#show()` 只在上一次
 * 右键的位置弹出来），把它做成 `v-model:open` 会立刻变成「猜这次回包属于哪次命令」的协议层。
 * 本层**不建** pending / outstanding / 配对表，也不新增 `MenuManager`。
 *
 * ## 为什么复用 `useSdkResource` 而不走 `OverlaySpec` 内核
 *
 * 引擎对菜单的动词是「挂到目标上」（`Map#addContextMenu` / `Marker#addContextMenu`），不是
 * 「加进地图」：菜单不出现在 `map.getOverlays()` 里，也不参与 `clearOverlays()`。内核的 `mount`
 * 固定走 `add/remove`，为菜单加一个 `mount` 覆盖钩子会让「登记 + 回滚」那段（PR #103 评审 1）
 * 出现第二份实现。这里复用的是内核**下面那层**（`useSdkResource` 的实例 child scope / 代次守卫 /
 * 释放路径）+ 同一套 `OverlayRegistry` 记账 + 同一个事件矩阵。理由同时记在 ADR 里。
 *
 * ## target 解析
 *
 * 只认 `TargetContext`（#30 起的挂载目标契约）：
 *
 * | 最近的 `TargetContext` | 结果 |
 * | --- | --- |
 * | `kind: "map"`（`<BMap>` 自己 provide 的那个） | 挂到地图 |
 * | `kind: "marker"`（写在 `<BMarker>` 里） | 挂到该标注 |
 * | 其它 kind（`overlay` / `clusterer` / …） | **显式失败**（`driver.overlays.attachContextMenu` 也拒绝，两层一致） |
 * | 一个都没有 | 回退到地图 |
 *
 * 「一个都没有」这一档只在 `<BMap>` 之外成立——`<BMap>` 子树里总有它自己的地图 target，因此
 * **不提供 `TargetContext` 的组件**（`BMapMask` / `BMarker3d` 这类）不会被当成目标，其下的菜单
 * 等价于挂在地图级。⚠️ 这条口径在合并 #105 时改过一次：此前判据依赖 `overlayContextKey`，
 * 而 #104 审计把那个 key 整条删了（「不恢复上游没公开的身份」方向的同一件事），于是本层不再
 * 试图区分「父链上有旧层覆盖物」——没有契约可依据时就不猜（改法与理由见 ADR 的评审修正一节）。
 */
import { inject, nextTick, onScopeDispose, provide, shallowRef, watch, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../context/inject";
import { targetContextKey } from "../context/target";
import type { TargetContext } from "../context/target";
import { contextMenuChildrenKey, createContextMenuChildrenRegistry } from "../context/menu";
import type { MapReadyContext } from "../context/types";
import { useSdkResource } from "./useSdkResource";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import {
  createDeprecationWarner,
  describeDeprecation,
  propAliasesOf,
  resolvePropAliasValue,
} from "../deprecations";
import { overlayEventsOf } from "../overlays/overlayEventCatalog";
import {
  contextMenuEntriesFingerprint,
  contextMenuEntryFromData,
  type ContextMenuEntry,
} from "../overlays/ContextMenuSpec";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";
import type { OverlayTarget } from "../../driver/types/overlays";
import type { BContextMenuProps, ContextMenuSelectPayload } from "../../types/components";
import type { Pixel, Point } from "../../driver/types/geometry";

export interface UseContextMenuOptions {
  /** 组件的 `emit`（`open` / `close` / `select` 都经它落地）。 */
  readonly emit: (name: string, payload: unknown) => void;
  /** 失败统一走组件既有的 `resource:error` 诊断通道。 */
  readonly reportError: (error: BMapError) => void;
}

export interface UseContextMenuResult {
  /**
   * 声明式 children 的渲染宿主（detached `<div>`，永不在文档里）。
   *
   * 组件把它当 `<Teleport :to>` 的目标：`<BMenuItem>` 们因此能挂载（从而登记自己）却不出现在
   * 地图容器的 DOM 里。SSR 下为 `null`（没有 `document`），子组件不渲染。
   *
   * 只返回它：注册表由本层 `provide` 给子组件（不需要经返回值），实例 / 状态 / 错误由组件
   * 经 `resource:error` 与 props 观察——**没有消费者的返回值不加**。
   */
  readonly itemsHost: Readonly<ShallowRef<HTMLElement | null>>;
}

/** 已经挂上去的那一份（身份记账：`null` = 当前没挂）。 */
interface AttachedMenu {
  readonly kind: "map" | "marker";
  readonly handle: SdkHandle<string>;
  readonly menu: OverlayHandle;
}

/** 目标解析结果。`unsupported` 是**显式失败**，`pending` 是「目标还没就绪」。 */
type TargetPlan =
  | { readonly kind: "map" | "marker"; readonly handle: SdkHandle<string> }
  | { readonly kind: "pending"; readonly targetKind: string }
  | { readonly kind: "unsupported"; readonly targetKind: string };

/** `defineEmits` 的返回值 → 动态名转发器（名字是字符串常量，见 `core/composables/dynamicEmit`）。 */
type DynamicEmit = (name: string, payload: unknown) => void;

export function useContextMenu(
  props: Readonly<BContextMenuProps>,
  options: UseContextMenuOptions,
): UseContextMenuResult {
  const mapContext = useRequiredMapContext();
  const overlayRegistry = mapContext.overlays;
  const emit = options.emit as DynamicEmit;
  const reportError = options.reportError;

  const deprecation = createDeprecationWarner("context-menu");
  const itemsAlias = propAliasesOf("context-menu").find((alias) => alias.canonical === "items");

  const children = createContextMenuChildrenRegistry();
  provide(contextMenuChildrenKey, children);

  /**
   * 声明式 children 的渲染宿主，**setup 期**就创建。
   *
   * 与 `useCustomOverlay` 的「第一次 create 才创建宿主」不同，这是**刻意的**：那边宿主只交给 SDK、
   * 不必在首次渲染前存在；这边它是 `<Teleport :to>` 的目标，而 `<BMenuItem>` 要在**首次渲染**时
   * 就挂载（从而登记自己），因此必须提前可用。
   *
   * SSR 安全靠同一句 `typeof document === "undefined"` 守卫：真服务端没有 `document` ⇒ `null` ⇒
   * 模板的 `v-if` 不渲染 Teleport，子组件也不挂载（它们本来就不产出 DOM）。
   */
  const itemsHost = shallowRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  /**
   * 最近的挂载目标契约。
   *
   * 直接用 **`targetContextKey`** 注入，而不是再包一个 `useXxx()` helper：`useOptionalTargetContext()`
   * 已被 #104 的存量审计删除（「只有一个消费者的公共 helper」），因此不能为了本组件把它加回来
   * ——#104 的结论是「无消费者的公共面不加」，而一个 helper 只为「包一层 `inject`」存在时，
   * 它的消费者永远只有本文件。这里读同一个 key，不新增公共出口。
   */
  const targetContext = inject<TargetContext | undefined>(targetContextKey, undefined);

  let readyCtx: MapReadyContext | null = null;
  let attached: AttachedMenu | null = null;
  /**
   * **最新**的条目列表。
   *
   * 菜单项的 SDK 回调按序号回读它，而不是捕获创建时的那个函数：这样「父级每次渲染传新的内联
   * 回调」不会触发重建（回调不进指纹），回调也不会停留在旧闭包上。
   */
  let latestEntries: ContextMenuEntry[] = [];
  /** 当前实例的条目指纹（「变化才重建」的判据）。 */
  let currentFingerprint = "";
  /** 声明式 children 的解析是否已经排队（合帧：一次 flush 只解析一次）。 */
  let resolveScheduled = false;

  const rawProps = props as unknown as Record<string, unknown>;

  /* ------------------------------------------------------------------ 条目解析 */

  /** 数据 API 的取值：`items`；正典缺失时按集中弃用层读 `menuItems` 并告警一次。 */
  function readDataItems(): unknown {
    if (!itemsAlias) return rawProps.items;
    const resolved = resolvePropAliasValue(itemsAlias, rawProps);
    if (resolved.usedAlias) deprecation.warn(describeDeprecation(itemsAlias));
    return resolved.value;
  }

  /**
   * 声明式 children 的条目，按**当前渲染顺序**。
   *
   * 顺序来自占位元素在宿主里的先后（见 `core/context/menu.ts`）。宿主是 detached 的，因此这里读到
   * 的永远是「Vue 刚刚 patch 出来的那一份」。
   */
  function readChildEntries(): ContextMenuEntry[] {
    const host = itemsHost.value;
    if (!host) return [];
    const entries: ContextMenuEntry[] = [];
    for (const node of Array.from(host.childNodes)) {
      if (!(node instanceof Element)) continue;
      const key = node.getAttribute(children.keyAttribute);
      if (!key) continue;
      const declaration = children.lookup(key);
      if (declaration === undefined) continue;
      if (declaration === "-") {
        entries.push(contextMenuEntryFromData("-"));
        continue;
      }
      // **与数据 API 走同一条归一化路径**（`contextMenuEntryFromData`）：声明式的 `onSelect`
      // 就是数据 API 的 `callback`。此前这里手写了一遍同样的字段映射，于是「两份实现」在
      // `onSelect` 的守卫上就已经分叉——那正是本 PR 在 `core/deprecations/resolve.ts` 里
      // 明确要避免的形态。
      entries.push(
        contextMenuEntryFromData({
          text: declaration.text,
          ...(declaration.onSelect === undefined ? {} : { callback: declaration.onSelect }),
          ...(declaration.disabled === undefined ? {} : { disabled: declaration.disabled }),
          ...(declaration.width === undefined ? {} : { width: declaration.width }),
          ...(declaration.id === undefined ? {} : { id: declaration.id }),
        }),
      );
    }
    return entries;
  }

  function resolveEntries(): ContextMenuEntry[] {
    const data = readDataItems();
    const dataEntries = Array.isArray(data)
      ? data.map((value) => contextMenuEntryFromData(value as never))
      : [];
    return [...dataEntries, ...readChildEntries()];
  }

  /**
   * 解析条目 → **无条件**同步 `latestEntries` → 返回指纹。
   *
   * 两件事必须分开：`latestEntries` 是「SDK 回调该调用谁」的唯一依据，**回调不进指纹**（那是刻意的，
   * 见 `contextMenuEntriesFingerprint` 的注释：父级每次渲染传内联箭头不该让菜单闪一下）。因此
   * 「指纹没变 ⇒ 不重建」**不等于**「什么都不用做」——只换 callback 时菜单实例保持不变，但回调必须
   * 换到新的那个。第一版只在 `create()` 里赋值，于是 callback-only 更新永远调用旧函数（复审 P2）。
   *
   * 调用点因此有两类：`create()`（建实例）与**每一处变化**（watch 源 / children 通知），
   * 后一类即使最终不重建也已经把最新条目装好了。
   */
  function syncEntries(): string {
    const entries = resolveEntries();
    latestEntries = entries;
    return contextMenuEntriesFingerprint(entries);
  }

  /* ---------------------------------------------------------------- target 解析 */

  /**
   * 解析当前该挂到哪儿。
   *
   * 三种结果，**都不可省**（fixture smoke 实测抓过一次）：
   *
   * - `map` / `marker`：目标句柄可用；
   * - `pending`：`TargetContext` 说目标是 marker / overlay，但句柄**还没就绪**（父覆盖物是异步建的）。
   *   此时**什么都不做**——等 `target` 的 watcher 唤醒再挂。此前这里回退到地图，于是
   *   「挂在标注上」的菜单会**静默挂到整张地图上**（菜单在任何地方右键都弹出来），
   *   而这是最难排查的一类错：它看起来「能用」。「挂错地方」必须比「明确失败」更难发生。
   * - `unsupported`：这个 kind 没有入口证据（含旧层组件）。
   */
  function planTarget(): TargetPlan {
    const map = readyCtx?.map as unknown as SdkHandle<string> | undefined;
    if (!targetContext) {
      return map ? { kind: "map", handle: map } : { kind: "pending", targetKind: "map" };
    }
    const kind = targetContext.kind.value;
    if (kind !== "map" && kind !== "marker") return { kind: "unsupported", targetKind: kind };
    const handle = (targetContext.target.value ?? null) as SdkHandle<string> | null;
    if (handle) return { kind, handle };
    // 地图目标的句柄来自 ready 上下文；其余目标等 `TargetContext.target` 就绪
    if (kind === "map" && map) return { kind: "map", handle: map };
    return { kind: "pending", targetKind: kind };
  }

  /* ---------------------------------------------------------------- 挂载 / 摘除 */

  function readVisible(): boolean {
    return props.visible !== false;
  }

  function unsupportedTargetError(targetKind: string): BMapError {
    return new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `BContextMenu: 无法把菜单挂到 ${targetKind} 目标上；` +
        "JSAPI 4.0 的右键菜单只有 map 与 marker 两个实测入口" +
        "（旧层覆盖物不提供 TargetContext，其下的菜单没有可挂的目标）",
      { engine: "jsapi-v4" },
    );
  }

  /**
   * 挂到当前目标上（先摘旧的，再挂新的）。
   *
   * **身份记账**保证「同一个菜单 + 同一个目标」不会重复下发；target 变化时先摘旧再挂新，因此不会
   * 出现「同时挂在两个目标上」。同一个目标重复挂载虽然被 SDK 按身份去重（真实 4.0 实测：挂三次
   * 仍只派发一条 `open`），但本库不依赖这条去重——**命令级**的不重复才是可断言的（用例读 Driver 的
   * 调用计数）。
   */
  function attach(menu: OverlayHandle | null | undefined): void {
    const context = readyCtx;
    if (!context || !menu) return;
    if (!readVisible()) return;

    const plan = planTarget();
    // 目标还没就绪：**什么都不做**，等 `target` 的 watcher 唤醒（不回落、不失败）
    if (plan.kind === "pending") return;
    if (plan.kind === "unsupported") throw unsupportedTargetError(plan.targetKind);
    if (
      attached &&
      attached.menu === menu &&
      attached.kind === plan.kind &&
      attached.handle === plan.handle
    ) {
      return;
    }
    detach();
    const target: OverlayTarget = { kind: plan.kind, handle: plan.handle };
    context.client.driver.overlays.attachContextMenu(target, menu);
    attached = { kind: plan.kind, handle: plan.handle, menu };
  }

  /** 已经进入**最终释放**流程的实例：它们的 SDK 事件不再回放给调用方（与 `useOverlaySpec` 同一口径）。 */
  const detachedMenus = new WeakSet<object>();

  /**
   * 摘除当前挂载；幂等，且**不**改变「事件是否回放」的判定。
   *
   * 它同时服务两条语义完全不同的路径：
   * - **临时摘挂**（`visible=false`、target 迁移）：随后会把**同一个实例**挂回去，事件当然要继续转发；
   * - **最终释放**（重建 / 卸载）：这一代到此结束，回放事件没有意义。
   *
   * 因此「不再回放」的标记只能在**最终释放**那条路径上立（见 `release()`）。第一版把标记写在
   * `detach()` 里，于是「隐藏再显示」之后同一个菜单实例的事件被永久吞掉——复审 P1 抓到的正是它。
   */
  function detach(): void {
    const context = readyCtx;
    const current = attached;
    attached = null;
    if (!context || !current) return;
    try {
      context.client.driver.overlays.detachContextMenu(
        { kind: current.kind, handle: current.handle } satisfies OverlayTarget,
        current.menu,
      );
    } catch (error) {
      logger.warn(
        `BContextMenu: 从 ${current.kind} 目标上摘除菜单失败（目标可能已被重建或销毁）: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  }

  /**
   * **最终释放**这一代菜单：先立「不再回放事件」的标记，再摘除。
   *
   * 释放顺序是「先 `registration.dispose()`（⇒ 我们这里摘除）→ 再由 instance scope 解绑监听」，
   * 所以摘除窗口里 SDK 若同步派发，监听仍然活着——标记就是为这个窗口准备的（与 `useOverlaySpec`
   * 的 `detachedResources` 同一理由）。该时序在真实 SDK 上**未取证**，回归用例用注入的方式复现。
   */
  function release(): void {
    const current = attached;
    if (current) detachedMenus.add(current.menu as unknown as object);
    detach();
  }

  /* ---------------------------------------------------------------- select 派发 */

  /**
   * 一条菜单项被选中。
   *
   * `open` / `close` 是 SDK 事件（由事件矩阵派生并原样转发），**选中不是**：官方把它经
   * `MenuItem` 的构造回调给出。因此这里派发的 `select` 是本库自己的事件，载荷把坐标归一化成领域值
   * （`geometry.fromRawPoint` / `fromRawPixel`）并带上「哪一条」。
   *
   * 归一化失败（SDK 给了空点）**不阻断**菜单动作本身——与迁移前的口径一致。
   */
  function dispatchSelect(index: number, rawPoint: unknown, rawPixel: unknown): void {
    const context = readyCtx;
    const entry = latestEntries[index];
    // 菜单实例由 `create` 建出，而 `create` 只在拿到 ready 上下文之后才跑 ⇒ 这里 context 必然存在。
    // 唯一能走到这里而没有上下文的情形是「菜单已被释放但 SDK 仍回调了」——直接丢弃，不派发半截载荷。
    if (!context || !entry) return;
    const geometry = context.client.driver.geometry;
    let point: Point | undefined;
    let pixel: Pixel | undefined;
    try {
      point = rawPoint ? geometry.fromRawPoint(rawPoint) : undefined;
    } catch {
      point = undefined;
    }
    try {
      pixel = rawPixel ? geometry.fromRawPixel(rawPixel) : undefined;
    } catch {
      pixel = undefined;
    }
    const payload: ContextMenuSelectPayload = {
      item: {
        text: entry.text,
        ...(entry.disabled ? { disabled: true } : {}),
        ...(entry.width === undefined ? {} : { width: entry.width }),
        ...(entry.id === undefined ? {} : { id: entry.id }),
      },
      index,
      ...(point === undefined ? {} : { point }),
      ...(pixel === undefined ? {} : { pixel }),
      map: context.map,
      target: attached ? attached.handle : null,
    };
    entry.onSelect?.(payload);
    emit("select", payload);
  }

  /* ---------------------------------------------------------------- 资源生命周期 */

  const resolvedEvents = overlayEventsOf("context-menu");

  /**
   * 合帧的重建。
   *
   * 必须等 `nextTick`：`<BMenuItem>` 的挂载 / 卸载发生在 patch 期间，而占位元素的最终顺序要等 patch
   * 结束才可读。没有存活实例时**不做**（第一次 `create` 会读到最新的条目，无需空转一次）。
   */
  function scheduleRebuild(
    replace: () => Promise<void>,
    resource: () => OverlayHandle | null,
    isDisposed: () => boolean,
  ): void {
    if (resolveScheduled) return;
    resolveScheduled = true;
    void nextTick(() => {
      resolveScheduled = false;
      if (isDisposed()) return;
      if (!resource()) return;
      // 先同步条目（即使不重建，回调也要换到最新），再按指纹决定要不要重建
      if (syncEntries() === currentFingerprint) return;
      void replace();
    });
  }

  /** 把 attach / target 变化路径上的失败统一收进诊断通道（不让 watcher 里抛出去）。 */
  function attachReportingErrors(menu: OverlayHandle | null | undefined): void {
    try {
      attach(menu);
    } catch (error) {
      reportError(
        error instanceof BMapError
          ? error
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
      );
    }
  }

  // 返回值刻意**不接**：本层只用它的生命周期与释放路径，观察面由组件经 props / `resource:error` 走
  useSdkResource<Record<string, unknown>, OverlayHandle, MapReadyContext>({
    props: rawProps,
    label: "overlay:context-menu",
    resolveContext: async (signal) => {
      const ready = await mapContext.whenReady(signal);
      readyCtx = ready;
      return ready;
    },
    onError: (error) => reportError(error),
    spec: {
      type: "context-menu",
      create: ({ context }) => {
        // `syncEntries()` 无条件把最新条目装进 `latestEntries`（回调不进指纹，见它的注释）
        currentFingerprint = syncEntries();
        const entries = latestEntries;
        const menu = context.client.driver.overlays.createContextMenu({ width: props.width });
        entries.forEach((entry, index) => {
          // 每项自己的宽度 / id 优先；宽度不给时由 `createContextMenu({ width })` 记下的菜单级宽度兜底
          const itemOptions: { width?: number; id?: string } = {};
          if (entry.width !== undefined) itemOptions.width = entry.width;
          if (entry.id !== undefined) itemOptions.id = entry.id;
          context.client.driver.overlays.addContextMenuItem(
            menu,
            entry.kind === "separator"
              ? "-"
              : {
                  text: entry.text,
                  disabled: entry.disabled,
                  callback: (point, pixel) => dispatchSelect(index, point, pixel),
                },
            Object.keys(itemOptions).length > 0 ? itemOptions : undefined,
          );
        });
        return menu;
      },
      mount: ({ context, resource, scope }) => {
        // 登记在前（与 `useOverlaySpec` 同一条顺序要求）：`remove` 是唯一的回滚入口。
        // `remove` 走 `release()`（**最终释放**语义：立标记 + 摘除），不是 `detach()`。
        const registration = overlayRegistry.registerResource({
          type: "context-menu",
          resource,
          scope,
          remove: () => release(),
        });
        for (const event of resolvedEvents) {
          scope.add(
            context.client.driver.events.on(resource, event.sdk, (payload) => {
              // 卸载 / 重建窗口里 SDK 仍可能派发事件：此刻**不该**把它们回放给调用方
              // （与 `useOverlaySpec` 的 `detachedResources` 同一条口径：那是实现细节的副产品，
              // 不是业务事实）。释放顺序是「先 detach（登记 remove）→ 再由 scope 解绑监听」，
              // 因此这个窗口真实存在。
              if (detachedMenus.has(resource as unknown as object)) return;
              // `open` / `close` 原样转发；本层不把它当成受控状态的一部分（ownership-first）
              emit(event.vue, payload);
            }),
          );
        }
        // 目标不支持时在这里**显式失败**（`useSdkResource` 会把状态标成 error 并释放实例），
        // 而不是留下一个「永远挂不上去但看起来正常」的菜单
        attach(resource);
        return registration;
      },
      watch: ({ scope, replace, resource }) => {
        // 显隐 = 挂 / 不挂（**不是**弹层显隐，见模块注释）
        scope.add(
          watch(
            () => readVisible(),
            () => {
              if (!resource()) return;
              if (!readVisible()) {
                detach();
                return;
              }
              attachReportingErrors(resource());
            },
          ),
        );
        // target 变化：只做**资源所有权迁移**（先摘旧、再挂新）；不推断旧事件属于哪次迁移。
        // watch 源返回句柄对象本身 ⇒ Vue 按身份比较，重建出的新实例一定会被认出来。
        scope.add(
          watch(
            () => (targetContext ? targetContext.target.value : null),
            () => {
              if (!resource()) return;
              attachReportingErrors(resource());
            },
          ),
        );
        // 数据 API 变化：**无条件同步条目**（回调即使不进指纹也要换新），指纹不同才重建。
        // watch 源里做同步是刻意的：只换 callback 时指纹不变、回调不会被触发，只有「源每次求值都同步」
        // 才能让 `latestEntries` 跟上。
        scope.add(
          watch(
            () => syncEntries(),
            () => scheduleRebuild(replace, resource, () => scope.isDisposed),
          ),
        );
        // `width` 是 `MenuItemOptions.width`（**每项的构造期选项**，`ContextMenu` 实例上没有宽度
        // setter）：变化必须重建菜单。没有这一路就会变成「收了参数但忽略」——调用方改了 `width`
        // 什么都不发生，而那正是本库明确要避免的假支持。
        scope.add(
          watch(
            () => props.width,
            () => {
              if (!resource()) return;
              void replace();
            },
          ),
        );
        // 声明式 children 变化：宿主 DOM 的顺序要等本次 patch 结束才可读，因此排到 nextTick
        scope.add(
          children.subscribe(() => scheduleRebuild(replace, resource, () => scope.isDisposed)),
        );
      },
    },
  });

  onScopeDispose(() => {
    attached = null;
    itemsHost.value = null;
    readyCtx = null;
  });

  return { itemsHost: itemsHost as Readonly<ShallowRef<HTMLElement | null>> };
}
