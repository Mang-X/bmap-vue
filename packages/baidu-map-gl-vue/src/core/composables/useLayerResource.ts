/**
 * useLayerResource —— 图层组件的统一生命周期（M7-LAYERS / issue #40）
 *
 * 建立在 `useSdkResource` 之上的**图层挂载适配器**：它把「一份 `LayerSpec` → 一个 SDK 图层
 * 实例」的创建、挂载、就地更新、重建与释放收敛成一处，十个图层组件（`BDistrictLayer` …
 * `BRasterLayer`）只声明「自己的 props 怎么映射成 `LayerSpec`」。
 *
 * ## 三种变化，三条路径
 *
 * | 变化 | 路径 | 判据 |
 * | --- | --- | --- |
 * | `visible` | 挂上 / 摘掉 | 图层的显隐在本库统一表达为挂载状态（见 `driver/types/layers.ts`） |
 * | **可就地更新**的槽位（有 setter 的 `zIndex`、`data`）与可选 option（`colors` / `edge` …） | 原地写入 | Driver 的 `surface().operations` / `isMutableOption()` |
 * | 其余（构造选项、URL、只能构造期生效的 `opacity` / `minZoom` / `maxZoom`） | **重建** | `layerRebuildKey()` 变化 |
 *
 * 「URL 变化重建与旧请求过期」由重建路径负责：`replace()` 是**原子替换**（先摘旧实例再建新的，
 * 中间不挂两个），旧实例的 child scope 随 `LayerRecord.dispose()` 一起释放，因此旧图层的
 * 在飞瓦片请求与新实例之间没有共享状态。
 *
 * ## 就绪之前怎么处理
 *
 * 监视源刻意用一个**廉价、且不需要 Driver** 的指纹（`layerWatchKey(spec)`，`data` 只比引用
 * 身份）：SDK 未就绪时 `resource()` 还是 `null`，没有实例可就地更新，而 `create()` 读的是
 * **当下**的规格，所以「还没就绪时 props 变了」不需要额外动作（也不会丢——这正是
 * 「快照 + 延迟创建」类缺陷的反面：创建用的值永远是创建那一刻读到的值）。
 * 细粒度分流（重建 / 就地更新）在回调里才需要 Driver。
 *
 * ## 与实例的对应关系
 *
 * 一次生成（generation）= 一个 `LayerRecord` = 一个 child scope。监听器写在 `bind()` 里、
 * 挂到该代的 scope 上，因此重建之后旧监听随旧 scope 消失，不存在「监听留在旧实例上」的残留。
 */
import { onScopeDispose, watch, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../context/inject";
import type { MapReadyContext } from "../context/types";
import type { BMapError } from "../errors/BMapError";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import { devWarn } from "../logger";
import { createLayerRegistry, type LayerRegistry } from "../layers/LayerRegistry";
import {
  LAYER_CTOR_SLOTS,
  isUpdatableSlot,
  layerCtorOptions,
  layerMutableOptions,
  layerRebuildKey,
  layerSlotValue,
  layerWatchKey,
  stableLayerValue,
  type LayerProbe,
  type LayerSpec,
} from "../layers/LayerSpec";
import type { LayerHandle } from "../../driver/types/handles";
import type { LayerCtorSlot, LayerDriver, LayerKind } from "../../driver/types/layers";
import type { OverlayTarget } from "../../driver/types/overlays";
import { useSdkResource, type SdkResourceStatus } from "./useSdkResource";

/** `bind()` 的入参：每次创建（含重建）后调用一次。 */
export interface LayerResourceBindInput {
  readonly handle: LayerHandle;
  readonly context: MapReadyContext;
  /** 本代的 child scope：监听器 / watcher / timer 都挂在这里。 */
  readonly scope: ResourceScope;
}

export interface LayerResourceHooks<Props> {
  /**
   * 组件 props → 领域规格。
   *
   * 必须是**纯投影**（只读 props、无副作用）：它在每次 props 变化与每次创建时都会被调用。
   */
  toSpec(props: Readonly<Props>): LayerSpec;
  /** 绑定 SDK 事件（可选）。重建时拿到的是新实例 + 新 scope。 */
  bind?(input: LayerResourceBindInput): void;
  /**
   * 组件名：创建 / 绑定失败时经地图事件总线的 `resource:error` 交出（与覆盖物 / 控件组件
   * 同一条诊断通道）。
   */
  component?: string;
}

export interface UseLayerResourceResult {
  /** 当前图层句柄（未就绪 / 已释放时为 `null`）。 */
  readonly handle: Readonly<ShallowRef<LayerHandle | null>>;
  readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
}

/** 当前实例的读数与记账（重建 = 整体替换）。 */
interface InstanceState {
  handle: LayerHandle;
  spec: LayerSpec;
  mounted: boolean;
  /** 创建该实例时用的重建指纹：props 变化时与它比较，决定「重建」还是「就地更新」。 */
  rebuildKey: string;
  /**
   * 已写入 SDK 的槽位指纹（**按槽位**记账，`data` 除外）。
   *
   * 作用：没变的槽位不重复写（`zIndex` 一类重复写是无谓的 SDK 调用）。
   */
  appliedSlots: Map<LayerCtorSlot, string>;
  /**
   * 已写入的 `data` **引用**（不是指纹）。
   *
   * `data` 往往是整份 `FeatureCollection`，序列化它来做去重会把「每次 props 变化」变成一次
   * 深遍历。这里按引用记：换引用才写、同一份数据重复渲染不重复写（正是旧实现里
   * 「DOM 已抹掉、定时器还在」想避免的那次多余写入）。
   */
  appliedData: unknown;
  /** 已就地写入的可选 option 指纹（取值不变时不重复写 SDK）。 */
  mutableKey: string;
  /** 已就地写入的可选 option 键（由有值变为 undefined 的键要提示一次）。 */
  mutableKeys: Set<string>;
}

/** 槽位值的指纹：`undefined` 不写也不记账，`null` 单独记（它是「清空」而不是「没表态」）。 */
function slotFingerprint(value: unknown): string {
  return value === null ? "null" : stableLayerValue(value);
}

/**
 * 「这个槽位还没写过」的哨兵。
 *
 * 不能用 `undefined`：`data` 没表态与「写过一个 undefined」是两件事；也不能用 `null`（它是
 * 「清空」的合法取值）。
 */
const UNAPPLIED = Symbol("layer-slot-unapplied");

/** `mutableKey` 的初值同理：必须与任何真实指纹都不同，这样**挂载时**才会真的写一次。 */
const NO_MUTABLE_KEY = "<unapplied>";

export function useLayerResource<Props>(
  props: Readonly<Props>,
  hooks: LayerResourceHooks<Props>,
): UseLayerResourceResult {
  const mapContext = useRequiredMapContext();
  /**
   * 图层账本。
   *
   * 正常路径下来自 `MapContext.layers`（`MapRuntime` 持有，随地图一起释放——「Registry 与
   * Map dispose 一致」就是这条）；自定义 Context（client 适配器之外的实现）可能不提供它，
   * 此时退化为组件自持的账本，并在组件作用域结束时释放，避免图层无人认领。
   */
  const ownRegistry = createLayerRegistry();
  const registryOf = (): LayerRegistry => mapContext.layers ?? ownRegistry;
  onScopeDispose(() => {
    if (!mapContext.layers) ownRegistry.disposeAll();
  });

  const target = (context: MapReadyContext): OverlayTarget => ({
    kind: "map",
    handle: context.map,
  });
  const probeOf = (context: MapReadyContext): LayerProbe => {
    const driver: LayerDriver = context.client.driver.layers;
    return {
      surface: (kind: LayerKind) => driver.surface(kind),
      isMutableOption: (kind: LayerKind, key: string) => driver.isMutableOption(kind, key),
    };
  };

  /** 当前生成（generation）的状态；`replace()` 会先把它置空。 */
  let instance: InstanceState | null = null;

  /** 挂上 / 摘掉：图层的显隐口径。 */
  const syncMounted = (state: InstanceState, context: MapReadyContext): void => {
    const layers = context.client.driver.layers;
    const shouldMount = state.spec.visible !== false;
    if (shouldMount === state.mounted) return;
    if (shouldMount) layers.add(target(context), state.handle);
    else layers.remove(target(context), state.handle);
    state.mounted = shouldMount;
  };

  /**
   * 就地写入「依赖已挂载」的槽位。
   *
   * **不在 `map.addLayer` 之前执行这类操作**（issue #40 的非目标）：官方明确层级调整会访问
   * 已关联的 Map 与图层管理器，未挂载时调用是未定义行为。因此这里以 `state.mounted` 为前置。
   */
  const syncPostMountSlots = (state: InstanceState, context: MapReadyContext): void => {
    // 未挂载时**不写、也不记账**：官方明确「层级调整一类操作会访问已关联的 Map 与图层管理器」，
    // 未挂载时调用是未定义行为（issue #40 的非目标）。等挂载发生时这里会被再调一次。
    if (!state.mounted) return;
    const layers = context.client.driver.layers;
    const probe = probeOf(context);
    const kind = state.spec.kind;
    /** 走 option 通道的槽位攒成**一次** `setOptions`（Driver 再按整袋 / 字段 setter 分类）。 */
    const optionBag: Record<string, unknown> = {};

    for (const slot of LAYER_CTOR_SLOTS) {
      if (!isUpdatableSlot(state.spec, probe, slot)) continue;
      const value = layerSlotValue(state.spec, slot);
      if (value === undefined) continue;

      if (slot === "data") {
        // 按**引用**去重（见 `InstanceState.appliedData` 的说明）：同一份数据不重复写
        if (state.appliedData !== UNAPPLIED && state.appliedData === value) continue;
        // `data: null` = 清空（归一化操作用 `clearData`）
        if (value === null && !layers.supports(kind, "clearData")) {
          devWarn(
            `[layer:${kind}] data 置为 null 表示清空，但该图层没有 clearData 入口；` +
              "本次清空被忽略（传一份空 FeatureCollection 才能达到同样效果）",
          );
          continue;
        }
        if (value === null) layers.clearData(state.handle);
        else layers.setData(state.handle, value);
        state.appliedData = value;
        continue;
      }

      const fingerprint = slotFingerprint(value);
      if (state.appliedSlots.get(slot) === fingerprint) continue;

      if (slot === "zIndex" && layers.supports(kind, "setZIndex")) {
        layers.setZIndex(state.handle, value as number);
        state.appliedSlots.set(slot, fingerprint);
        continue;
      }

      // 其余可就地更新的槽位（`DOMLayer` 的 `zIndex` / `minZoom` / `maxZoom` 一类）走整袋 /
      // 字段 setter 通道，由 Driver 的 `mutable` / `bagSetters` 分类决定具体入口。
      optionBag[slot] = value;
      state.appliedSlots.set(slot, fingerprint);
    }

    if (Object.keys(optionBag).length > 0) {
      layers.setOptions(state.handle, optionBag);
    }
  };

  /**
   * 就地写入「可选 option」（`colors` / `edge` 这类有 setter 的构造项）。
   *
   * 只有**键集合或取值**变化时才写 SDK；键消失（由有值变为 `undefined`）时**不猜默认值**
   * ——官方没有默认值回读入口，本库只提示一次，而不是静默保留旧值（那会让调用方以为还原了）。
   */
  const syncMutableOptions = (state: InstanceState, context: MapReadyContext): void => {
    const mutable = layerMutableOptions(state.spec, probeOf(context));
    const nextKeys = Object.keys(mutable);
    const removed = [...state.mutableKeys].filter((key) => !nextKeys.includes(key));
    state.mutableKeys = new Set(nextKeys);
    if (removed.length > 0) {
      devWarn(
        `[layer:${state.spec.kind}] 可就地更新的 option ${removed.join(" / ")} 变为 undefined：` +
          "本库不还原 SDK 默认值（4.0 没有默认值回读入口），图层上仍是上一次设置的值",
      );
      state.mutableKeys = new Set(nextKeys);
    }
    if (nextKeys.length === 0) return;
    if (stableLayerValue(mutable) === state.mutableKey) return;
    state.mutableKey = stableLayerValue(mutable);
    if (!state.mounted) return;
    context.client.driver.layers.setOptions(state.handle, mutable);
  };

  const resource = useSdkResource<Readonly<Props>, LayerHandle, MapReadyContext>({
    props,
    label: "layer-resource",
    /**
     * 失败经 `resource:error` 交出（与 `useOverlayResource` / `useControlResource` 同一条
     * 诊断通道）：图层组件的错误不该只留在内部 ref 里。
     */
    onError: (error) => {
      mapContext.events.emit("resource:error", { error, component: hooks.component });
    },
    resolveContext: async (signal) => {
      const context = await mapContext.whenReady(signal);
      if (!context.map) {
        throw new Error(
          "layer components must be used inside a <BMap> that owns a map instance（当前上下文只有 client）",
        );
      }
      return context;
    },
    spec: {
      type: "layer-resource",
      create: ({ props: current, context }) => {
        const spec = hooks.toSpec(current);
        const probe = probeOf(context);
        return context.client.driver.layers.create(spec.kind, layerCtorOptions(spec, probe));
      },
      mount: ({ props: current, resource: handle, context, scope }) => {
        const spec = hooks.toSpec(current);
        const state: InstanceState = {
          handle,
          spec,
          mounted: false,
          rebuildKey: layerRebuildKey(spec, probeOf(context)),
          appliedSlots: new Map(),
          appliedData: UNAPPLIED,
          mutableKeys: new Set(Object.keys(layerMutableOptions(spec, probeOf(context)))),
          // 刻意用「未写」哨兵而不是当前值的指纹：可就地更新的 option **不进构造选项**，
          // 因此挂载后的这一次写入是它们的唯一生效路径（否则初始值会被静默丢弃）。
          mutableKey: NO_MUTABLE_KEY,
        };
        instance = state;
        const record = registryOf().register({
          kind: spec.kind,
          handle,
          scope,
          remove: () => {
            // 摘除只在这里发生：`state.mounted` 是本库对「挂没挂上」的唯一记账，
            // 因此重复 dispose（组件卸载 / 重建 / Map 卸载）不会多摘一次。
            if (instance === state) instance = null;
            if (!state.mounted) return;
            state.mounted = false;
            context.client.driver.layers.remove(target(context), handle);
          },
        });
        // 先登记账本、再做副作用：`syncMounted` / 槽位写入里任何一步抛错时，错误路径上
        // **一定**有一个可释放的记录（`useSdkResource` 拿到异常后会 dispose 本代 scope，
        // 但那时它还没有 registration；先登记能让 `remove` 兜住已经挂到图上的实例）。
        try {
          syncMounted(state, context);
          syncPostMountSlots(state, context);
          syncMutableOptions(state, context);
        } catch (error) {
          record.dispose();
          throw error;
        }

        // 交给 `useSdkResource` 的返回值形状是 `ResourceRegistration`（它只调 `dispose()`）；
        // 这里显式适配，而不是把 `type` / `resource` 塞进领域账本记录。
        return {
          id: record.id,
          type: `layer:${spec.kind}`,
          resource: handle,
          get disposed() {
            return record.disposed;
          },
          dispose: () => record.dispose(),
        };
      },
      bind: ({ resource: handle, context, scope }) => {
        hooks.bind?.({ handle, context, scope });
      },
      watch: ({ props: current, context, resource: currentHandle, replace, scope }) => {
        scope.run(() => {
          watch(
            // 廉价指纹：不含 Driver 信息、也不深遍历 data，SDK 未就绪也能算
            // （见 `layerWatchKey` 与文件头「就绪之前怎么处理」）。
            () => layerWatchKey(hooks.toSpec(current)),
            () => {
              const ready = context();
              const handle = currentHandle();
              const state = instance;
              // 还没就绪或没有实例：`create()` 会读到最新的规格，这里不需要动作。
              if (!ready || !handle || !state) return;
              const next = hooks.toSpec(current);
              if (layerRebuildKey(next, probeOf(ready)) !== state.rebuildKey) {
                void replace();
                return;
              }
              state.spec = next;
              syncMounted(state, ready);
              syncPostMountSlots(state, ready);
              syncMutableOptions(state, ready);
            },
          );
        });
      },
    },
  });

  return {
    handle: resource.resource as Readonly<ShallowRef<LayerHandle | null>>,
    status: resource.status,
    error: resource.error,
  };
}

/**
 * 统一槽位的领域名清单（供组件做 `props` 校验与文档表格复用）。
 *
 * 导出的是**同一份** `LAYER_CTOR_SLOTS`：组件不该自己再抄一遍槽位名。
 */
export { LAYER_CTOR_SLOTS };
export type { LayerCtorSlot };
