/**
 * useOverlaySpec —— 由 `OverlaySpec` 声明驱动的覆盖物生命周期（M5-SPEC-MARKER / issue #30，
 * M5-VECTORS / issue #31 扩展）
 *
 * 这一层把「所有覆盖物都要做的事」收在一处，组件侧只声明 `OverlaySpec`：
 *
 * | 阶段 | 谁做 | 落在哪 |
 * | --- | --- | --- |
 * | 解析 Map 上下文 | `useSdkResource`（`resolveContext`） | 本文件只做包装（顺手留下 ctx 供更新路径用） |
 * | 创建（create） | `useSdkResource` → `spec.create` | 每次创建一个**新的实例 child scope** |
 * | 挂载（mount） | 本文件：`driver.overlays.add({ kind: "map" })` + Registry registration | registration 与实例 scope 绑定 |
 * | 绑定（bind） | 本文件：**kind 的事件矩阵 + `spec.events` 覆盖项** → SDK 事件 | 全部进实例 scope，重建即释放 |
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
 * 这套语义继承自 `useOverlayResource`（PR #61 三轮评审的收敛点），迁到本层后由 #31 迁移过来的
 * 八个覆盖物共用；`MapMask` / `Marker3D` / `InfoWindow` / `ContextMenu` 仍走旧层，
 * 理由见 ADR `2026-09-18-overlay-event-matrix` 的已知限制。
 *
 * ## issue #31 在本层加的三件事
 *
 * 1. **事件面由矩阵派生**（`overlayEventsOf(spec.kind)`）：组件不再逐个手写 `emit("click", e)`，
 *    于是「同一类覆盖物的事件面不一致」在结构上不可能。`spec.events` 只剩**覆盖项**。
 * 2. **读 props 走「别名感知视图」**：集中弃用表登记的旧 prop 名（`startPoint` / `endPoint`）在
 *    **正典 prop 缺失**时才生效，并告警一次；`create` / watch / 更新队列读到的都是同一份值，
 *    因此不存在「初始用旧名、更新用新名」这类分叉。
 * 3. **卸载路径上的事件不再回放**：实例被摘除后，SDK 在解绑窗口里派发的 `remove` 之类事件
 *    不再冒泡给调用方（`removeOverlay` 恰好发生在监听解绑之前）。
 */
import {
  computed,
  getCurrentInstance,
  onScopeDispose,
  provide,
  readonly,
  shallowRef,
  watch,
} from "vue";
import type { ComponentInternalInstance, ShallowRef } from "vue";
import { useSdkResource, type SdkResourceStatus } from "./useSdkResource";
import { useRequiredMapContext } from "../context/inject";
import { targetContextKey, type TargetContext, type TargetKind } from "../context/target";
import type { MapReadyContext } from "../context/types";
import type { Point } from "../../driver/types/geometry";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";
import type { OverlayKind } from "../../driver/types/overlays";
import type { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import { pointEquals } from "../utils/equality";
import { stableKeyOf } from "../utils/stableKey";
import { assertOverlayFieldDeclarations } from "../overlays/OverlaySpec";
import type { OverlayFieldUpdate, OverlaySpec } from "../overlays/OverlaySpec";
import { overlayEventsOf } from "../overlays/overlayEventCatalog";
import {
  createDeprecationWarner,
  describeDeprecation,
  eventAliasesOf,
  propAliasesOf,
  resolvePropAliasValue,
  type OverlayPropAlias,
} from "../deprecations";

/**
 * 位置字段的**双向同步模型**（`"position"` 策略）。
 *
 * 两条方向都经「最后一次与 SDK 一致的位置」+ 容差判等收敛：
 * - `applyFromProps`：外部值变化 → 写 SDK。父级把我们刚上报的值写回时（`v-model` 的正常闭环），
 *   它与 `synced` 相等 ⇒ **一次命令都不发**（这就是回环抑制）；
 * - `observeFromSdk`：SDK 侧观测到新位置（如 Marker `dragend`）→ 更新模型并告诉调用方「是否真的变了」，
 *   调用方据此决定要不要 `emit("update:position")`。
 *
 * **为什么不是「读回 SDK 现值判等」**（`<Map>` 视野用的那条路）：覆盖物的位置在
 * `OverlayDriver` 上**没有读回入口**（`getPosition` 只在具体覆盖物原型上，不在本库的归一化调用面里；
 * 补一个位置读回 API 属于其它覆盖物的范围）。这里的判据仍是**值**而不是「来源标记」：两条方向都会
 * 更新它，因此不依赖「事件与命令谁先到」的隐式假设。
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
 * 就绪与否读 `status` 即可。等真有命令式消费者时再加（与 `OverlaySpec` 不加 `add`/`remove` 同一口径）。
 */
export interface UseOverlaySpecResult<Resource> {
  readonly resource: Readonly<ShallowRef<Resource | null>>;
  readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  /** 位置模型（仅当 `spec.fields` 里声明了 `"position"` 策略字段时存在）。 */
  readonly position: OverlayPositionModel | null;
  /**
   * 该实例实际绑定的事件（矩阵派生 + 覆盖项），按矩阵声明顺序 —— **领域读数**。
   *
   * 组件用例据此断言「事件面来自矩阵」而不必逐个 `emit` 试；也写进 ADR 的对照表。
   */
  readonly events: readonly string[];
}

/** 领域点 → 防御性拷贝（两条方向都不与调用方共享引用）。 */
function clonePoint(point: Point): Point {
  return { lng: point.lng, lat: point.lat };
}

/** 解析后的一条事件绑定：SDK 名 + 组件 emit 名 + 可选的组件侧处置。 */
interface ResolvedOverlayEvent {
  /** SDK 订阅名。 */
  readonly sdk: string;
  /** 规范 Vue 名（别名查找的键）。 */
  readonly vue: string;
  /** 纯转发的 emit 名。 */
  readonly emit?: string;
  /** 组件自定义处置（与 `emit` 互斥）。 */
  readonly handle?: (event: unknown) => void;
}

/**
 * 事件面 = kind 的事件矩阵 ∪ `spec.events` 覆盖项（覆盖项按 SDK 名匹配，必须落在矩阵内）。
 *
 * 没有 `kind` 的 spec（第三方自建覆盖物：#30 的形态）**没有矩阵**：此时只有 `spec.events` 生效，
 * 行为与 #30 完全一致。**没有「按名字猜 kind」的回落**——猜想会让「声明了 emit 却永不触发」
 * 变成静默失败（见 `OverlaySpec.kind` 的说明）。
 */
function resolveOverlayEvents<Props extends object, Resource>(
  spec: OverlaySpec<Props, Resource>,
): ResolvedOverlayEvent[] {
  const declared = spec.events ?? [];
  const kind = spec.kind;
  if (!kind) {
    return declared.map((entry) =>
      "handle" in entry
        ? { sdk: entry.sdk, vue: entry.sdk, handle: entry.handle }
        : { sdk: entry.sdk, vue: entry.sdk, emit: entry.emit },
    );
  }

  const overrides = new Map(declared.map((entry) => [entry.sdk, entry]));
  const fromMatrix = overlayEventsOf(kind);
  const known = new Set(fromMatrix.map((event) => event.sdk));
  const strays = [...overrides.keys()].filter((sdk) => !known.has(sdk));
  if (strays.length > 0) {
    throw new Error(
      `OverlaySpec(${spec.type}): events 里的 ${strays.join(", ")} 不在 ${kind} 的事件矩阵里；` +
        "覆盖项只能改处置方式，事件面本身由 core/overlays/overlayEventCatalog.ts 决定",
    );
  }
  return fromMatrix.map((definition) => {
    const override = overrides.get(definition.sdk);
    if (!override) return { sdk: definition.sdk, vue: definition.vue, emit: definition.vue };
    return "handle" in override
      ? { sdk: definition.sdk, vue: definition.vue, handle: override.handle }
      : { sdk: definition.sdk, vue: definition.vue, emit: override.emit };
  });
}

/**
 * 父级是否给这个事件名绑了监听器（照 Vue `emit` 的查找规则：`on<Name>` 与 camelCase 两种拼写）。
 *
 * 判据只能从**当前组件的 vnode props** 读：Vue 的 `emit()` 本身就是在
 * `instance.vnode.props[toHandlerKey(name)]` 上找监听器（`@drag-end` 编译成 `onDrag-end`，
 * 而手写 `h()` 常见的是 `onDragEnd` ⇒ 两种都要认）。刻意**每轮派发现读**而不是在 setup 里快照：
 * 父级可以在运行期换掉监听器（动态 `v-if` / 换 handler 对象），快照会让告警判据过期。
 *
 * 读不到实例（比如在 setup 之外调用内核）时返回 `false`——宁可少提示，也不要误报。
 */
function hasListenerFor(instance: ComponentInternalInstance | null, name: string): boolean {
  // 实例必须在 **setup 期**捕获：`getCurrentInstance()` 只在 setup / render 的同步栈里有值，
  // 而这里是在 SDK 的事件回调里被调用的（那时它已经是 null，直接调用会永远返回 false）。
  const props = instance?.vnode.props as Record<string, unknown> | null | undefined;
  if (!props) return false;
  const camel = name.replace(/-([a-zA-Z])/g, (_, char: string) => char.toUpperCase());
  const handlerKeys = [
    `on${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    `on${camel.charAt(0).toUpperCase()}${camel.slice(1)}`,
  ];
  return handlerKeys.some((key) => typeof props[key] === "function");
}

export function useOverlaySpec<Props extends object, Resource>(
  props: Props,
  spec: OverlaySpec<Props, Resource>,
  options: UseOverlaySpecOptions = {},
): UseOverlaySpecResult<Resource> {
  const mapContext = useRequiredMapContext();
  const overlayRegistry = mapContext.overlays;
  const emit = options.emit;
  const kind: OverlayKind | undefined = spec.kind;
  /** 本组件实例（父级监听器的读取依据，见 `hasListenerFor`）；非组件上下文里为 null。 */
  const ownerInstance = getCurrentInstance();

  /** 集中弃用层：prop 别名（读取层）与事件别名（派发层）共用这一份「同实例一次」的去重。 */
  const deprecation = createDeprecationWarner(spec.type);
  const propAliases: readonly OverlayPropAlias[] = propAliasesOf(kind);

  /** ready 上下文：`useSdkResource` 内部缓存它，这里留一份给自己（更新路径要用 driver / map）。 */
  let readyCtx: MapReadyContext | null = null;

  const fields = Object.entries(spec.fields) as Array<[string, OverlayFieldUpdate]>;
  const positionField = fields.find(([, update]) => update === "position")?.[0] ?? null;
  const visibilityField = fields.find(([, update]) => update === "visibility")?.[0] ?? null;
  const rawProps = props as Record<string, unknown>;

  /**
   * **统一 props 视图**：别名解析（旧 prop 名）+ 值投影（惰性值）。
   *
   * 正典 prop（`bounds`）缺失、而旧名组（`startPoint` + `endPoint`）齐备时，读 `bounds`
   * 得到的是旧名派生出来的值——`create` / watch / 更新队列因此看到同一份值，不存在
   * 「初始用旧名、更新用新名」这类分叉。正典一旦有值，旧名**完全不参与**（连告警都不发）：
   * 这是「新 API 优先」，不是「两边合并」。
   *
   * 值投影在别名之后：`url` 的工厂函数必须先求值再交给 SDK（`setImage` 只接受真实来源）。
   */
  function resolveAliasValue(alias: OverlayPropAlias, target: Record<string, unknown>): unknown {
    // 读取规则（新 API 优先 / 旧名要齐备 / 不猜）收在 `core/deprecations/resolve.ts`：
    // `ContextMenuSpec` 的 `menuItems` → `items` 用的是同一条规则，两处各写一遍必然分叉。
    const resolved = resolvePropAliasValue(alias, target);
    if (resolved.usedAlias) deprecation.warn(describeDeprecation(alias));
    return resolved.value;
  }

  const fieldValues: Partial<Record<keyof Props & string, (value: unknown) => unknown>> =
    spec.fieldValues ?? {};
  const needsView = propAliases.length > 0 || Object.keys(fieldValues).length > 0;

  const propsView: Record<string, unknown> = !needsView
    ? rawProps
    : new Proxy(rawProps, {
        get(target, key, receiver) {
          if (typeof key !== "string") return Reflect.get(target, key, receiver);
          const alias = propAliases.find((entry) => entry.canonical === key);
          const value = alias
            ? resolveAliasValue(alias, target)
            : Reflect.get(target, key, receiver);
          const project = fieldValues[key as keyof Props & string];
          return project ? project(value) : value;
        },
      });

  /** 经视图读取（别名 + 投影）：`create` / watch / 更新队列都用它。 */
  const readProp = (name: string): unknown => propsView[name];

  /** **原始** prop（不经别名与投影）：只给按引用比较的 watch 源用。 */
  const readRawProp = (name: string): unknown => rawProps[name];

  /** prop → 描述符键：缺省同名，显式 `null` 表示该字段不经描述符。 */
  function descriptorKeyOf(prop: string): string | null {
    const declared = spec.descriptorKeys?.[prop as keyof Props & string];
    return declared === undefined ? prop : declared;
  }

  // 构造期自检：声明自相矛盾时立刻失败（判据与用例共用 `assertOverlayFieldDeclarations`）。
  assertOverlayFieldDeclarations(spec, { propAliases });

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

  /**
   * 已经进入摘除流程的实例。
   *
   * `useSdkResource.disposeInstance()` 的顺序是「先摘 registration（⇒ `removeOverlay`）→
   * 再释放实例 scope（⇒ 解绑监听）」，因此 SDK 会**在监听仍然活着的窗口里**派发 `remove`。
   * 若不设这道闸，调用方会在组件卸载 / 重建的过程中收到「对象正在消失」的事件——那是实现
   * 细节的副产品，不是业务事实。
   *
   * 用 `WeakSet<实例>` 而不是一个布尔标记：竞态分支里**过期的那一代**也会走一遍 mount → dispose，
   * 布尔标记会把「已经由新一代接管的组件」的事件面在整个会话里关掉（同一 bug class：
   * 「按全局状态判断某一代是否还在工作」）。
   */
  const detachedResources = new WeakSet<object>();

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

  /**
   * **调用 `spec.create()` 那一刻**的位置。
   *
   * 必须在 create 之前取：`create` 可能异步，而异步工厂的自然写法是「入口处读一次 props，
   * 然后做异步工作」——`await` 之后它已经看不到后来的变化了。若改在 `mount` 里读当时的 props，
   * 就会出现「实例是按旧位置建的，但同步模型记为新位置」，随后**相同值全被回环抑制吃掉**。
   */
  let createdPosition: Point | null = null;

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

  /* ---------------------------------------------------------------------------- 事件面 */

  const resolvedEvents = resolveOverlayEvents(spec);

  /**
   * 派发一条事件：正典名 + **弃用别名**（各一次）。
   *
   * 别名在**首次派发**时告警一次，而不是在绑定时：只有真的有人触发它，旧名字才算被用到——
   * 组件里绑了 `@click` 却从不点击，不该收到「你在用旧事件名」的提示。
   */
  function dispatchEvent(event: ResolvedOverlayEvent, payload: unknown): void {
    if (event.handle) event.handle(payload);
    else if (event.emit) emit?.(event.emit, payload);
    for (const alias of eventAliasesOf(kind, event.vue)) {
      // 兼容派发照旧（没人监听的 `emit` 是 no-op），但**告警只在父级真的绑了旧名字时发**
      // （PR #103 评审 3）：只监听规范名的应用升级后不该收到迁移提示——「SDK 派发过某个事件」
      // 与「调用方用了弃用名」是两件事。
      if (hasListenerFor(ownerInstance, alias.alias)) deprecation.warn(describeDeprecation(alias));
      emit?.(alias.alias, payload);
    }
  }

  /* ------------------------------------------------------------------------------ 主体 */

  const sdk = useSdkResource<Props, Resource, MapReadyContext>({
    props: propsView as Props,
    label: `overlay:${spec.type}`,
    resolveContext: async (signal) => {
      const ready = await mapContext.whenReady(signal);
      readyCtx = ready;
      return ready;
    },
    spec: {
      type: spec.type,
      create: ({ context, props: current }) => {
        // 「实例是按哪个位置建的」必须在**调用 create 之前**取，理由见 `createdPosition`。
        createdPosition = positionField ? (readPosition() ?? null) : null;
        return spec.create(context, current);
      },
      mount: ({ context, resource, props: current, scope, stale }) => {
        // **先登记，再做副作用**（PR #103 评审 1b）：`addToMap` 与 `afterMount` 都可能失败
        // （SDK 抛错 / 组件侧副作用抛错），而唯一的回滚入口是 registration 的 `remove`。
        // 登记在前 ⇒ 任一失败都能经 `registration.dispose()` 把已 add 的实例摘掉 + 摘记录；
        // 登记在后 ⇒ 失败路径只剩「实例留在图上、注册表不知道」这一种结局（已用用例钉住）。
        //
        // registration 与**实例 scope** 绑定：scope 释放（重建 / 卸载）时记录自动摘除，
        // Registry 只保留当前存活实例，不保留历史 disposer 闭包。
        const registration = overlayRegistry.registerResource({
          type: spec.type,
          resource,
          scope,
          remove: (target) => removeFromMap(context, target),
        });

        // 同步模型记的是**实例真实所在的位置**（create 那一刻的值），不是当前的 props——
        // 两者在异步 create 窗口里会分叉，收敛交给 `bind` 的 reconciliation。
        if (positionField) {
          syncedPosition = createdPosition ? clonePoint(createdPosition) : null;
        }

        try {
          // 初始可见性：`visible: false` 的实例**不挂到地图**（不是「先挂再等 watcher」）。
          // 只有「尚未有任何实例挂上」时才补挂：竞态分支里两个实例可能先后走到这里，
          // 后一个不该把前一个的挂载记录顶掉。
          if (!attachedResource && (!visibilityField || readProp(visibilityField) !== false)) {
            addToMap(context, resource);
          }
          // 组件侧副作用（`afterMount`）：与迁移前 `addToMap` 里那段 `if (p.autoCenter) …` 同位。
          // 刻意**不**看可见性（`autoCenter` 描述的是地图视野）；但**过期一代不执行**——那条路径
          // 上的 mount 只为了拿 registration 再 dispose，业务副作用既无意义也回滚不了（评审 1a）。
          if (!stale) spec.afterMount?.(context, resource, current);
        } catch (error) {
          // 回滚：把已经 add 的实例摘掉、把记录摘掉（`dispose()` 幂等，registration 已摘除时是 no-op），
          // 然后**原样抛出**——调用方（`useSdkResource`）据此把状态标成 error，原因不被吞掉。
          try {
            registration.dispose();
          } catch {
            /* 回滚失败不覆盖原错误：instance scope 的释放仍会走到（`useSdkResource` 的 catch） */
          }
          throw error;
        }

        return {
          id: registration.id,
          type: registration.type,
          resource: registration.resource,
          get disposed() {
            return registration.disposed;
          },
          /**
           * 摘下实例 = 「这一代结束」。先立标记再交给注册表：`dispose()` 内部会
           * `removeOverlay`，而那一刻监听还没解绑（实例 scope 由 `useSdkResource` 稍后释放）。
           */
          dispose: () => {
            // 只立标记，**不**碰 `attachedResource`：真正的 SDK 侧摘除由 `registration.dispose()`
            // 经 `removeFromMap` 完成，提前清账会让它以为「已经摘过了」而跳过 `removeOverlay`。
            detachedResources.add(resource as unknown as object);
            registration.dispose();
          },
        };
      },
      bind: ({ context, resource, scope }) => {
        for (const event of resolvedEvents) {
          const off = context.client.driver.events.on(
            resource as unknown as OverlayHandle,
            event.sdk,
            (payload) => {
              if (detachedResources.has(resource as unknown as object)) return;
              dispatchEvent(event, payload);
            },
          );
          scope.add(off);
        }
        // **就绪窗口的 reconciliation**：实例在 `create` 完成之前没有落点，这段时间到达的更新
        // 既下发不了（`resource` 还是 null）、也进不了实例（`create` 在入口处就把 props 读完了）。
        // 此刻 `resource` 已经可见（`useSdkResource` 在 `bind` 之前赋值），因此在这里补一次：
        // - 位置：与「建实例时用的值」不等时补一条 `setPosition`；相等时 `applyFromProps`
        //   自己会短路，因此**不会**产生多余命令（幂等，有专门用例）；
        // - 待办队列：排空（就地更新落到这个实例上）。
        // 不做这一步的后果是外部评审 P1 复现的那条：更新永久停摆、位置在模型与 SDK 之间分叉。
        if (positionModel) positionModel.applyFromProps(readPosition());
        void drainAppliedUpdates();
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
          // 组件侧语义字段：`version` 只作为配对字段的 watch 源之一，`alias` 只经正典名被读取
          if (update === "visibility" || update === "position") continue;
          if (update === "version" || update === "alias") continue;
          const key = descriptorKeyOf(prop);
          if (key === null) continue;
          const source = spec.watchSources?.[prop as keyof Props & string] ?? "fingerprint";
          const apply = () => void enqueue({ [key]: readProp(prop) });
          if (source === "fingerprint") {
            // watch 源用**稳定序列化**：对象字段（icon / offset / style / bounds）必须按内容判等，
            // 否则父级每次渲染传内联字面量都会重新下发一次命令。
            scope.add(watch(() => stableKeyOf(readProp(prop)), apply));
            continue;
          }
          if (source === "reference") {
            // 内容不可序列化的字段（url 的惰性工厂）：只比根引用，读**原始** prop
            scope.add(watch(() => readRawProp(prop), apply));
            continue;
          }
          // 大数组（path / controlPoints）：根引用 + 版本 prop，不做 O(n) 的内容指纹。
          // `flush: "sync"` 沿用 v3 既有语义：路径更新要与父级渲染同一次提交内落地。
          scope.add(
            watch([() => readRawProp(prop), () => readProp(source.versionProp)], apply, {
              flush: "sync",
            }),
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
   * 自己去挂（例如 `ContextMenu` 的 `attachContextMenu`）。这里若悄悄回退到 Map，
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
    events: resolvedEvents.map((event) => event.sdk),
  };
}
