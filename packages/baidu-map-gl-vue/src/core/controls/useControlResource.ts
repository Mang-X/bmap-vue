/**
 * useControlResource —— 统一 Control adapter（M7-CONTROL-PANORAMA / issue #41）
 *
 * 从 `useSdkResource` 派生：实例的创建 / 竞态 / 释放都由它管，本文件只负责**控件特有的四件事**：
 *
 * | 关注点 | 落地 |
 * | --- | --- |
 * | `visible` | 默认 SDK `show()` / `hide()`（可被 `spec.setVisible` 覆盖），变更即时生效 |
 * | `anchor` / `offset` | 与其它 option 走**同一条 diff**（此前只在构造期生效——issue 明确要求动态更新） |
 * | 普通 option | 变化时先问 `ControlDriver.planOptions()`：`mutable` 就地 `setOptions`，`recreate` 重建控件 |
 * | SDK 事件 | `spec.events()` 的绑定进入**实例 scope**，随实例释放 |
 *
 * 释放顺序是硬约束（ADR 2026-09-11 §6，issue #22 实施步骤 4）：卸载时**先解绑业务事件**，
 * 再由 Map 移除 SDK 资源——否则 SDK 在 `removeControl` 期间同步派发的事件会打到已经开始
 * 拆解的业务回调上（`BLocation` 的 locationSuccess/locationError 就是这种绑定）。
 * `useSdkResource` 的默认顺序是「先 registration.dispose、再 instanceScope.dispose」，
 * 所以本适配器把 `scope.dispose()` 放进 registration 的 `dispose()` 里自己保证这个顺序。
 *
 * 「构造期快照」与「运行期读到的值」是两份，因此**挂载后必须收敛一次**：`create` 与 `mount`
 * 之间隔着一个微任务，用户完全可以在那个窗口里改 props；只把构造期的值记成 diff 基线会让
 * 那次改动永远不再被检测到（同 #27 的「快照 + 延迟创建」教训）。
 */
import { watch, type ShallowRef } from "vue";
import type { ControlHandle } from "../../driver/types/handles";
import type { ControlOptions } from "../../driver/types/controls";
import type { OverlayTarget } from "../../driver/types/overlays";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import type { MapReadyContext } from "../context/types";
import { useRequiredMapContext } from "../context/inject";
import {
  useSdkResource,
  type SdkResourceSpec,
  type SdkResourceStatus,
} from "../composables/useSdkResource";
import { changedOptionKeys, optionKey, optionSnapshot, type OptionSnapshot } from "./optionKey";
import type { ControlBaseProps, ControlSpec } from "./spec";

export interface UseControlResourceResult {
  /** 当前控件句柄（未创建 / 已重建窗口内为 `null`）。 */
  readonly resource: Readonly<ShallowRef<ControlHandle | null>>;
  /** 实例状态（`idle` / `creating` / `ready` / `error` / `disposing` / `disposed`）。 */
  readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
}

const mapTarget = (context: MapReadyContext): OverlayTarget => ({
  kind: "map",
  handle: context.map,
});

/**
 * 默认的实例创建：内置控件走 `driver.controls.create(kind, options)`；`custom` 走
 * `createCustomControl`（它要的是 DOM 工厂，不是构造选项）。
 */
function createDefault<Props extends ControlBaseProps>(
  spec: ControlSpec<Props>,
  context: MapReadyContext,
  props: Readonly<Props>,
): ControlHandle {
  const controls = context.client.driver.controls;
  const options = spec.options(props);
  if (spec.kind === "custom") {
    const render = spec.render?.(props);
    if (!render) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        'ControlSpec(kind="custom") 必须提供 render()：自定义控件的 DOM 只能由 DOM 工厂产出',
      );
    }
    return controls.createCustomControl({
      anchor: options.anchor,
      offset: options.offset,
      render,
    });
  }
  return controls.create(spec.kind, options);
}

export function useControlResource<Props extends ControlBaseProps>(
  props: Readonly<Props>,
  controlSpec: ControlSpec<Props>,
): UseControlResourceResult {
  const ctx = useRequiredMapContext();
  /**
   * 上一次写进 SDK 的选项的**逐键值快照**（diff 基线）。
   *
   * 两个要点：
   * - 记「期望值」而不是「回读值」：SDK 对未声明的键既不回读也不报错，回读会把
   *   「值写下去了但 SDK 没用」判成「没写过」而反复下发；
   * - 记**快照**而不是 `options()` 返回的对象：后者里的 `offset` / `size` / `mapTypes` 与父级
   *   是同一个引用，父级原地改字段时基线会跟着一起变，diff 于是判成「没变化」而把更新吃掉
   *   （#95 评审第 2 轮 P1）。序列化字符串在建立基线的那一刻就与引用解耦。
   */
  let applied: OptionSnapshot | null = null;
  /** `create` 实际交给 SDK 的那份选项的快照；`mount` 用它当基线，再对当前 props 收敛一次。 */
  let createdWith: OptionSnapshot | null = null;
  /** 已就 `unsupported` 告警过的键（每个键一次，避免每次 props 变化都刷屏）。 */
  const warnedUnsupported = new Set<string>();
  /** `useSdkResource` 的 `replace`；声明在 spec 之前，供 `mount` 的收敛路径使用。 */
  let replaceRef: (() => Promise<void>) | null = null;

  const spec: SdkResourceSpec<Props, ControlHandle, MapReadyContext> = {
    type: `control:${controlSpec.kind}`,

    create({ context, props: current, scope }) {
      const handle =
        controlSpec.create?.({ context, props: current, scope }) ??
        createDefault(controlSpec, context, current);
      createdWith = optionSnapshot(controlSpec.options(current));
      return handle;
    },

    mount({ context, resource, props: current, scope }) {
      // 基线取**构造期实际下发的那份**，随后对当前 props 收敛一次——中间那个微任务里
      // 用户改过的 props 必须在这里被补写，否则它永远不会再被 diff 检测到。
      applied = createdWith ?? optionSnapshot(controlSpec.options(current));
      createdWith = null;

      if (controlSpec.mount) controlSpec.mount({ context, resource, props: current, scope });
      else context.client.driver.controls.add(mapTarget(context), resource);

      // `visible: false` 在挂载时就要落地（默认 `true` 无需动作）。同一 tick 内 add + hide，
      // 中间不产生绘制，因此不会出现「闪一下再消失」。
      if (current.visible === false) applyVisible(context, resource, current, false);

      for (const [name, handler] of controlSpec.events?.(current) ?? []) {
        scope.add(context.client.driver.events.on(resource, name, handler));
      }

      if (replaceRef) applyOptions(context, resource, current, replaceRef);

      // 最小 registration：`useSdkResource` 只消费 `dispose()`，其余字段用于标识与诊断
      let released = false;
      return {
        id: Symbol(`control:${controlSpec.kind}`),
        type: `control:${controlSpec.kind}`,
        resource,
        get disposed() {
          return released;
        },
        dispose() {
          if (released) return;
          released = true;
          // ADR 2026-09-11 §6：先解绑业务事件（实例 scope 里的 SDK 监听 / watch / timer），
          // 再由 Map 移除 SDK 资源。`scope.dispose()` 幂等，`useSdkResource` 随后的
          // 第二次 dispose 是 no-op。
          scope.dispose("control-unmounted");
          if (controlSpec.unmount) {
            try {
              controlSpec.unmount({ context, resource, props: current, scope });
            } catch (error) {
              // 覆盖了 unmount 的控件自己负责摘除；钩子失败**不能**静默——那会让
              // 「控件/共享实例留在图上」与「组件已经卸载」这两个事实长期分叉。
              // 这里的错误不穿透（`useSdkResource` 的 dispose 路径不该抛），但必须可见。
              logger.warn(
                `ControlSpec(${controlSpec.kind}).unmount 抛错，实例可能残留在宿主上：` +
                  `${(error as Error)?.message ?? String(error)}`,
              );
            }
            return;
          }
          context.client.driver.controls.remove(mapTarget(context), resource);
        },
      };
    },

    watch({ context, resource, props: current, replace, scope }) {
      // 选项 diff：anchor / offset 与 kind 专属选项走同一条路径（此前 anchor/offset 完全没有
      // 更新入口，是 issue #41 要修的缺口）。
      scope.add(
        watch(
          // 源用稳定键，而不是选项对象：父级每次渲染传内联字面量不应触发任何下发。
          () => optionKey(controlSpec.options(current)),
          () => {
            const handle = resource();
            const ready = context();
            if (!handle || !ready) return;
            applyOptions(ready, handle, current, replace);
          },
        ),
      );

      scope.add(
        watch(
          () => current.visible,
          (visible) => {
            const handle = resource();
            const ready = context();
            if (!handle || !ready || visible === undefined) return;
            applyVisible(ready, handle, current, visible);
          },
        ),
      );
    },
  };

  const { resource, status, replace } = useSdkResource<Props, ControlHandle, MapReadyContext>({
    props,
    spec,
    resolveContext: (signal) => ctx.whenReady(signal),
    label: `control:${controlSpec.kind}`,
    onError: (error) => {
      ctx.events.emit("resource:error", { error, component: `control:${controlSpec.kind}` });
    },
  });
  replaceRef = replace;

  function applyVisible(
    context: MapReadyContext,
    resource: ControlHandle,
    current: Readonly<Props>,
    visible: boolean,
  ): void {
    if (controlSpec.setVisible) {
      controlSpec.setVisible({ context, resource, props: current, visible });
      return;
    }
    const controls = context.client.driver.controls;
    if (visible) controls.show(resource);
    else controls.hide(resource);
  }

  /**
   * 选项变化 → 就地更新 / 重建。
   *
   * 判据来自 Driver（`planOptions`），组件侧不维护第二张表：
   * - 任一变化键是 `recreate`，或**值变回 `undefined`** ⇒ **整只重建**（把新选项交给构造期）；
   * - 其余（`mutable`）⇒ 只把变了的键写下去；
   * - `unsupported` ⇒ 不写也不重建（三态设计的本意：这种键**连构造期也没有入口**，重建同样无效）。
   *   它不是静默丢弃——适配器会为它告警一次（每个键一次），否则调用方只知道「没生效」而不知道
   *   为什么。
   *
   * `anchor` 与 `offset` 必须**成对写**：真实 4.0 上 `setAnchor()` 会把控件偏移重置回
   * 控件默认值，只写 anchor 会把用户给的 offset 悄悄吃掉。
   */
  function applyOptions(
    context: MapReadyContext,
    resource: ControlHandle,
    current: Readonly<Props>,
    replace: () => Promise<void>,
  ): void {
    const next = controlSpec.options(current);
    const changed = changedOptionKeys(applied ?? {}, next);
    if (changed.length === 0) return;
    // 基线在**决定处置之前**前移：`replace()` 的重新创建会再写一次基线，
    // 而「本次变化已经处理过」这个事实不能依赖后续异步路径成功与否。
    applied = optionSnapshot(next);

    const plan = context.client.driver.controls.planOptions(resource, changed);
    /**
     * **重建**（就地写做不到）的两种情形：
     *
     * 1. `recreate`：Driver 说这个键**只有构造期生效**——既包括分类表里显式声明的构造期项
     *    （`map-type.type` / `overview.isOpen` / 版权控件的 `anchor`），也包括「未命中分类表、
     *    但 4.0 会把构造选项**原样透传**」的键（后者依然可能在构造期生效，所以归 `recreate`）；
     * 2. **值变回 `undefined`**（有值 → 没值）：语义是「回到 SDK 默认」，而默认值只存在于构造期
     *    ——就地写的话 `setOptions` 会按 `value === undefined` 跳过（#95 评审第 1 轮 P1：
     *    `BNavigation.type` 一旦设过 `SMALL`，`undefined` 就再也回不到默认）。
     *
     * `unsupported` **刻意不重建**：按三态的定义，它意味着「连构造期也没有入口」（例如自定义
     * 控件上未知的键），重建同样不会生效——这正是三态要避免的无效重建与内部状态丢失
     * （#95 评审第 3 轮）。为了不让它变成「静默丢弃」，下面会为这类键告警一次。
     */
    if (changed.some((key) => plan[key] === "recreate" || next[key] === undefined)) {
      void replace();
      return;
    }

    // `unsupported` 的键：写也不会生效、重建也不会生效，但**必须说出来**（每个键一次）
    for (const key of changed) {
      if (plan[key] !== "unsupported" || warnedUnsupported.has(key)) continue;
      warnedUnsupported.add(key);
      logger.warn(
        `ControlSpec(${controlSpec.kind}): option "${key}" 在本引擎没有入口（连构造期也没有，` +
          "例如自定义控件上未知的键），本次变化被忽略——重建同样不会生效",
      );
    }

    const patch: ControlOptions = {};
    /**
     * `anchor` 与 `offset` 必须**成对且按 `anchor → offset` 的顺序**下发。
     *
     * 真实 4.0 的 `setAnchor()` 会把偏移重置回控件默认值（官方参考实现的控件工厂特意跳过首次
     * `setAnchor`，注释写的就是这条）。两个方向都只有 SDK 才看得见：
     * - 只写 `anchor` ⇒ 用户给的 `offset` 被静默吃掉；
     * - 先写 `offset` 再写 `anchor`（同一个 patch 里的键顺序）⇒ 同一次调用里 `offset` 又被重置掉。
     *
     * 因此判据是「**先** anchor、**后** offset」，而不是「都带上就行」。只改 `offset` 时**不**
     * 顺带写 anchor——那会平白触发一次重置再盖回来（语义等价，但没有必要）。
     */
    const anchorChanged = changed.includes("anchor");
    const offsetChanged = changed.includes("offset");
    if (anchorChanged || offsetChanged) {
      if (anchorChanged && next.anchor !== undefined) patch.anchor = next.anchor;
      if (next.offset !== undefined) patch.offset = next.offset;
    }
    for (const key of changed) {
      if (key === "anchor" || key === "offset") continue;
      if (plan[key] === "mutable") patch[key] = next[key];
    }
    if (Object.keys(patch).length > 0) context.client.driver.controls.setOptions(resource, patch);
  }

  return {
    resource,
    status,
  };
}
