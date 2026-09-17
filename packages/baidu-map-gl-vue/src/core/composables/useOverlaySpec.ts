/**
 * useOverlaySpec —— 由 `OverlaySpec` 声明驱动的覆盖物生命周期（M5-SPEC-MARKER / issue #30）
 *
 * 这一层把「所有覆盖物都要做的事」收在一处，组件侧只声明 `OverlaySpec`：
 *
 * | 阶段 | 谁做 | 落在哪 |
 * | --- | --- | --- |
 * | 解析 Map 上下文 | `useSdkResource`（`resolveContext`） | 本文件只做包装（顺手留下 ctx 供更新路径用） |
 * | 创建（create） | `useSdkResource` → `spec.create` | 每次创建一个**新的实例 child scope** |
 * | 挂载（mount） | 本文件：`driver.overlays.add({ kind: "map" })` + Registry registration | registration 与实例 scope 绑定 |
 * | 绑定（bind） | 本文件：`spec.events` → SDK 事件 | 全部进实例 scope，重建即释放 |
 * | 就地更新 / 重建 | 本文件：**按键合并的待办队列** → `driver.overlays.setOptions` / `replace()` | 分类来自 Driver 描述符 |
 * | 卸载（unmount） | `useSdkResource`：先摘 registration，再释放实例 scope，最后释放组件 scope | 幂等 |
 *
 * ## 为什么更新走「按键合并的待办队列」而不是每个字段直接调用
 *
 * 同一次父级更新里可能同时改掉构造期属性（`recreate`）与就地属性（`mutable`）。逐字段直接下单会
 * 得到两种错误：mutable 落在一个**马上要被移除**的中间实例上（值丢失），或者构造期属性各触发
 * 一次重建（N 个字段 → N 次重建）。队列保证：
 *
 * 1. 同一轮里的所有更新合并成一批；
 * 2. 批里只要有 `recreate` 键就**先重建**，再把 mutable 落到**最终存活**的实例；
 * 3. 排空过程中新到的更新并入同一轮，因此**后到的值总是最后生效**。
 *
 * 这套语义继承自 `useOverlayResource`（PR #61 三轮评审的收敛点），迁到本层后由 Marker 使用；
 * 其余覆盖物仍在 `useOverlayResource` 上，迁移按 issue #30 的「风险与回滚」留给后续票。
 */
import { computed, onScopeDispose, provide, readonly, shallowRef, watch } from "vue";
import type { ShallowRef } from "vue";
import { useSdkResource, type SdkResourceStatus } from "./useSdkResource";
import { useRequiredMapContext } from "../context/inject";
import { targetContextKey, type TargetContext, type TargetKind } from "../context/target";
import type { MapReadyContext } from "../context/types";
import type { Point } from "../../driver/types/geometry";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";
import type { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import { pointEquals } from "../utils/equality";
import { stableKeyOf } from "../utils/stableKey";
import { assertOverlayFieldDeclarations } from "../overlays/OverlaySpec";
import type { OverlayFieldUpdate, OverlaySpec } from "../overlays/OverlaySpec";

/**
 * 位置字段的**双向同步模型**（`"position"` 策略）。
 *
 * 两条方向都经「最后一次与 SDK 一致的位置」+ 容差判等收敛：
 * - `applyFromProps`：外部值变化 → 写 SDK。父级把我们刚上报的值写回时（`v-model` 的正常闭环），
 *   它与 `synced` 相等 ⇒ **一次命令都不发**（这就是回环抑制）；
 * - `observeFromSdk`：SDK 侧观测到新位置（如 Marker `dragend`）→ 更新模型并告诉调用方「是否真的变了」，
 *   调用方据此决定要不要 `emit("update:position")`。
 *
 * **为什么不是「读回 SDK 现值判等」**（`<BMap>` 视野用的那条路）：覆盖物的位置在
 * `OverlayDriver` 上**没有读回入口**（`getPosition` 只在具体覆盖物原型上，不在本库的归一化调用面里；
 * 补一个位置读回 API 属于其它覆盖物的范围）。这里的判据仍是**值**而不是「来源标记」：两条方向都会
 * 更新它，因此不依赖「事件与命令谁先到」的隐式假设。取舍与备选方案见 ADR
 * `2026-09-17-overlay-spec-and-marker`。
 */
export interface OverlayPositionModel {
  /** 当前生效位置（props 上的值）。 */
  current(): Point | undefined;
  /** 外部值变化 → 写 SDK（含回环抑制）。 */
  applyFromProps(next: Point | undefined): void;
  /** SDK 侧观测到的新位置 → 更新模型；返回是否**真的**变化（含容差）。 */
  observeFromSdk(next: Point): boolean;
}

export interface UseOverlaySpecOptions {
  /** 组件的 `emit`（`defineEmits` 的返回值）。`spec.events` 里的 `emit` 转发经它落地。 */
  emit?: (name: string, payload: unknown) => void;
}

/**
 * 读到的**只有观察面**：实例句柄、状态、错误与位置模型。
 *
 * 刻意**不**暴露 `replace()` / `applyOptions()` / `whenReady()` 这类命令与等待入口：声明式的消费者
 * （组件只声明 `fields`）全部不需要它们——重建由 `recreate` 分类触发、字段下发由 watcher 入队、
 * 就绪与否读 `status` 即可。等真有命令式消费者时再加（与 `OverlaySpec` 不加 `add`/`remove` 同一口径，
 * 见 ADR 已知限制 5）。
 */
export interface UseOverlaySpecResult<Resource> {
  readonly resource: Readonly<ShallowRef<Resource | null>>;
  readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  /** 位置模型（仅当 `spec.fields` 里声明了 `"position"` 策略字段时存在）。 */
  readonly position: OverlayPositionModel | null;
}

/** 领域点 → 防御性拷贝（两条方向都不与调用方共享引用）。 */
function clonePoint(point: Point): Point {
  return { lng: point.lng, lat: point.lat };
}

export function useOverlaySpec<Props extends object, Resource>(
  props: Props,
  spec: OverlaySpec<Props, Resource>,
  options: UseOverlaySpecOptions = {},
): UseOverlaySpecResult<Resource> {
  const mapContext = useRequiredMapContext();
  const overlayRegistry = mapContext.overlays;
  const emit = options.emit;

  /** ready 上下文：`useSdkResource` 内部缓存它，这里留一份给自己（更新路径要用 driver / map）。 */
  let readyCtx: MapReadyContext | null = null;

  const fields = Object.entries(spec.fields) as Array<[string, OverlayFieldUpdate]>;
  const positionField = fields.find(([, update]) => update === "position")?.[0] ?? null;
  const visibilityField = fields.find(([, update]) => update === "visibility")?.[0] ?? null;
  const readProp = (name: string): unknown => (props as Record<string, unknown>)[name];

  /** prop → 描述符键：缺省同名，显式 `null` 表示该字段不经描述符。 */
  function descriptorKeyOf(prop: string): string | null {
    const declared = spec.descriptorKeys?.[prop as keyof Props & string];
    return declared === undefined ? prop : declared;
  }

  // 构造期自检：声明自相矛盾时立刻失败（判据与用例共用 `assertOverlayFieldDeclarations`）。
  assertOverlayFieldDeclarations(spec);

  /* ------------------------------------------------------------------ 实例挂载与 Registry */

  /**
   * **当前挂在地图上的那个实例**（不是布尔标记）。
   *
   * 用身份而不是 `onMap` 计数：`useSdkResource.createOnce` 的竞态分支是「先 `mount`（含加进地图）
   * 再发现这一代已经过期」，于是**两个实例可能先后都执行过挂载**。布尔标记会被后一次
   * `remove` 归零，从而把「仍然存活的那一代」也记成没挂载（此后 `visible` 变化会重复 add）。
   * 按身份记账时，过期实例的移除只看自己那一份，不会动别人的记录。
   */
  let attachedResource: Resource | null = null;

  function addToMap(context: MapReadyContext, resource: Resource): void {
    if (attachedResource === resource) return;
    context.client.driver.overlays.add(
      { kind: "map", handle: context.map },
      resource as unknown as OverlayHandle,
    );
    attachedResource = resource;
  }

  function removeFromMap(context: MapReadyContext, resource: Resource): void {
    if (attachedResource !== resource) return;
    attachedResource = null;
    context.client.driver.overlays.remove(
      { kind: "map", handle: context.map },
      resource as unknown as OverlayHandle,
    );
  }

  /* -------------------------------------------------------------------------- 位置模型 */

  const readPosition = (): Point | undefined =>
    positionField ? (readProp(positionField) as Point | undefined) : undefined;

  /** 最后一次已知与 SDK 一致的位置（两条方向都更新它）。 */
  let syncedPosition: Point | null = null;

  const positionModel: OverlayPositionModel | null = positionField
    ? {
        current: () => readPosition(),
        applyFromProps(next) {
          if (next === undefined) return;
          // 回环抑制：与我们刚上报给 SDK 的值相等 ⇒ 这是父级的正常回写，不重复下发命令
          if (syncedPosition && pointEquals(syncedPosition, next)) return;
          const resource = sdk.resource.value;
          const context = readyCtx;
          if (!resource || !context) return;
          context.client.driver.overlays.setPosition(
            resource as unknown as OverlayHandle,
            next,
          );
          syncedPosition = clonePoint(next);
        },
        observeFromSdk(next) {
          if (syncedPosition && pointEquals(syncedPosition, next)) return false;
          syncedPosition = clonePoint(next);
          return true;
        },
      }
    : null;

  /* ------------------------------------------------------------------------ 更新队列 */

  let pendingApply: Record<string, unknown> | null = null;
  let draining = false;

  /**
   * 把**更早取出的旧批次**放回待办。
   *
   * 展开顺序必须是「已有队列在后」：`batch` 是先前取走的那一批，而 `pendingApply` 里可能已经
   * 积压了等待期间到达的**更新**的值；反过来展开会让旧值覆盖新值。
   */
  function requeueStaleBatch(batch: Record<string, unknown>): void {
    pendingApply = { ...batch, ...(pendingApply ?? {}) };
  }

  /** 把一批已合并的更新落到**最终存活**的实例：先重建（若有构造期键），再就地更新。 */
  async function applyBatch(batch: Record<string, unknown>): Promise<void> {
    const context = readyCtx;
    const current = sdk.resource.value;
    if (!context || !current) {
      requeueStaleBatch(batch);
      return;
    }
    const overlays = context.client.driver.overlays;
    const handle = current as unknown as OverlayHandle;
    const inPlace: Record<string, unknown> = {};
    let needsReplace = false;
    for (const [key, value] of Object.entries(batch)) {
      if (overlays.updatePolicy(handle, key) === "recreate") {
        needsReplace = true;
        continue;
      }
      inPlace[key] = value;
    }
    if (needsReplace) await sdk.replace();
    const target = sdk.resource.value;
    if (!target) {
      requeueStaleBatch(batch);
      return;
    }
    if (Object.keys(inPlace).length === 0) return;
    try {
      overlays.setOptions(target as unknown as OverlayHandle, inPlace);
    } catch (error) {
      // 不静默吞：字段级更新失败必须留下可观测的痕迹
      logger.warn(
        `useOverlaySpec(${spec.type}).applyOptions: 字段级更新失败: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  }

  /**
   * 排空待办：**单飞 + while**。排空过程中新到的更新继续并入待办、由同一轮消费 ——
   * 因此旧批永远不会覆盖后到的新值。
   *
   * 返回值语义与 `useOverlayResource` 一致：**不等待在飞的那一轮**（值已并入待办，一定会被消费）。
   */
  async function drainAppliedUpdates(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (pendingApply && sdk.resource.value) {
        const batch = pendingApply;
        pendingApply = null;
        await applyBatch(batch);
      }
    } finally {
      draining = false;
    }
  }

  /** 按键合并入队：没有存活实例时留在待办里，等下一次挂载后排空。 */
  async function enqueue(updates: Record<string, unknown>): Promise<void> {
    pendingApply = { ...(pendingApply ?? {}), ...updates };
    await drainAppliedUpdates();
  }

  /** 显隐：优先 `show`/`hide`（不破坏覆盖物归属），SDK 没有这两个成员时退回 `add`/`remove`。 */
  function applyVisibility(): void {
    if (!visibilityField) return;
    const resource = sdk.resource.value;
    const context = readyCtx;
    if (!resource || !context) return;
    const driver = context.client.driver.overlays;
    const handle = resource as unknown as OverlayHandle;
    if (readProp(visibilityField) !== false) {
      if (attachedResource === resource) driver.show(handle);
      else addToMap(context, resource);
      return;
    }
    if (attachedResource !== resource) return;
    if (!driver.hide(handle)) removeFromMap(context, resource);
  }

  /* ------------------------------------------------------------------------------ 主体 */

  const sdk = useSdkResource<Props, Resource, MapReadyContext>({
    props,
    label: `overlay:${spec.type}`,
    resolveContext: async (signal) => {
      const ready = await mapContext.whenReady(signal);
      readyCtx = ready;
      return ready;
    },
    spec: {
      type: spec.type,
      create: ({ context, props: current }) => spec.create(context, current),
      mount: ({ context, resource, props: current, scope }) => {
        // 初始可见性：`visible: false` 的实例**不挂到地图**（不是「先挂再等 watcher」）。
        // 只有「尚未有任何实例挂上」时才补挂：竞态分支里两个实例可能先后走到这里，
        // 后一个不该把前一个的挂载记录顶掉。
        if (
          !attachedResource &&
          (!visibilityField || readProp(visibilityField) !== false)
        ) {
          addToMap(context, resource);
        }
        if (positionField) {
          const initial = (current as Record<string, unknown>)[positionField] as Point | undefined;
          syncedPosition = initial ? clonePoint(initial) : null;
        }
        // registration 与**实例 scope** 绑定：scope 释放（重建 / 卸载）时记录自动摘除，
        // Registry 只保留当前存活实例，不保留历史 disposer 闭包。
        return overlayRegistry.registerResource({
          type: spec.type,
          resource,
          scope,
          remove: (target) => removeFromMap(context, target),
        });
      },
      bind: ({ context, resource, scope }) => {
        for (const entry of spec.events ?? []) {
          const off = context.client.driver.events.on(
            resource as unknown as OverlayHandle,
            entry.sdk,
            (event) => {
              if ("handle" in entry) entry.handle(event);
              else emit?.(entry.emit, event);
            },
          );
          scope.add(off);
        }
      },
      watch: ({ scope }) => {
        if (visibilityField) {
          scope.add(watch(() => readProp(visibilityField), () => applyVisibility()));
        }
        if (positionModel) {
          scope.add(
            watch(
              // 点按两个标量当 watch 源：父级传内联字面量时引用每次都变，deep / 引用比较会空跑
              () => {
                const next = readPosition();
                return next ? `${next.lng},${next.lat}` : "";
              },
              () => positionModel.applyFromProps(readPosition()),
            ),
          );
        }
        for (const [prop, update] of fields) {
          if (update === "visibility" || update === "position") continue;
          const key = descriptorKeyOf(prop);
          if (key === null) continue;
          scope.add(
            watch(
              // watch 源用**稳定序列化**：对象字段（icon / offset）必须按内容判等，
              // 否则父级每次渲染传内联字面量都会重新下发一次命令。
              () => stableKeyOf(readProp(prop)),
              () => void enqueue({ [key]: readProp(prop) }),
            ),
          );
        }
      },
    },
  });

  /* ---------------------------------------------------------------- Target 自动注册 */

  /**
   * 子组件看到的挂载目标：**自动提供**（此前每个组件要记得自己 `provide`），并随实例就绪原子
   * 更新（重建后子组件在同一次 commit 内看到新句柄，因此不会留在已移除的旧实例上）。
   *
   * `add` / `remove` 刻意是 **no-op**，不是「帮你挂到父覆盖物上」：JSAPI 4.0 的覆盖物只能挂到
   * Map（`OverlayDriver` 对 `kind !== "map"` 的目标显式拒绝），子资源应该经 `TargetContext.target`
   * 自己去挂（例如 `BContextMenu` 的 `attachContextMenu`）。这里若悄悄回退到 Map，
   * 就把「这个目标不支持」变成了「挂错地方」——假支持比明确的失败更难排查。
   */
  const targetKindRef = shallowRef<TargetKind>(spec.targetKind ?? "overlay");
  const targetRef = computed(
    () => (sdk.resource.value as unknown as SdkHandle<string> | null) ?? null,
  );
  const targetContext: TargetContext = {
    kind: readonly(targetKindRef),
    target: readonly(targetRef),
    add: () => {},
    remove: () => {},
  };
  provide(targetContextKey, targetContext);

  onScopeDispose(() => {
    pendingApply = null;
    readyCtx = null;
  });

  return {
    resource: sdk.resource,
    status: sdk.status,
    error: sdk.error,
    position: positionModel,
  };
}
