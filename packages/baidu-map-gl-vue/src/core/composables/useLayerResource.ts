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
import { BMapError } from "../errors/BMapError";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import { devWarn, logger } from "../logger";
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

/**
 * 「我们相信实例当前挂没挂在地图上」的三态。
 *
 * 刻意不是布尔：SDK 允许**先产生副作用、再抛错**，而调用方唯一能观测的证据就是「调用有没有
 * 成功返回」。因此 `removeLayer` / `addLayer` 抛错之后，**挂载状态是未知的**——既不能按「还挂着」
 * 记（真实可能已经 detached，那就再也挂不回来），也不能按「已经下去了」记（真实可能还在图上，
 * 再 `add` 一次会让同一个实例在图上出现两份，而 `addLayer` 不去重）。
 *
 * 未知状态的处理方式是**再尝试同步一次**（而不是猜）：见 `syncMounted`。这一步依赖「对已经摘掉的
 * 图层重复 `removeLayer` 是安全的」——该前提已由 issue #98 的 live 探针**实测成立**
 * （GeoJSON / DOM / Tile 三个家族重复摘除均未抛错，见 ADR 决策 12b）。
 */
type MountState = "attached" | "detached" | "unknown";

/** 当前实例的读数与记账（重建 = 整体替换）。 */
interface InstanceState {
  handle: LayerHandle;
  spec: LayerSpec;
  /**
   * 我们相信「当前挂在地图上」的唯一记账（用于挂载 / 摘除的幂等）。
   *
   * 三态的理由见 `MountState`：失败之后留 `unknown`，下一次同步动作会把它推回确定状态
   * （`remove -> add`）。这条路径依赖的前提 P（重复 `removeLayer` 安全）**已由 issue #98 的 live
   * 探针实测成立**（三个家族均未抛错，见 ADR 决策 12b）；万一对某个 kind / SDK 版本不成立，
   * 退化仍然有界且可观测（保持 `unknown` + `resource:error`，不会重复挂载）。
   */
  mountState: MountState;
  /**
   * 是否**调用过** `addLayer`（无论成功与否）。
   *
   * 与 `mountState` 分开的原因见 `unmount`：错误补偿必须能在「副作用已产生但调用抛错」时摘除实例。
   */
  mountAttempted: boolean;
  /**
   * 是否**成功挂上去过**（一旦为真就不再复位）。
   *
   * 用途只有一个：区分「第一次挂载」（实例是全新的，直接 `addLayer` 就行）与「摘掉之后重新可见」
   * （**必须换实例**，见 `needsRemountRebuild`）。
   */
  everAttached: boolean;
  /** 是否已经做过**永久销毁**前的清理（`clearData`）：一次性，避免重复清理同一实例。 */
  torndown: boolean;
  /** 创建该实例时用的重建指纹：props 变化时与它比较，决定「重建」还是「就地更新」。 */
  rebuildKey: string;
  /**
   * 已写入 SDK 的槽位指纹（**按槽位**记账，`data` 除外）。
   *
   * 作用：没变的槽位不重复写（`zIndex` 一类重复写是无谓的 SDK 调用）。
   *
   * ⚠️ 它代表的是「**SDK 当前值是什么**」，因此**必须在一次可能产生副作用的调用之前失效**
   * （`delete` 掉对应槽位），成功返回后再提交新指纹。只在成功后推进是不够的：一次
   * 「已经写进去了、然后抛错」的调用会让它停留在**陈旧值**上——用户改回上一次成功的取值时，
   * 指纹正好相同、于是被跳过，而 SDK 其实还停在失败那次写进去的值（第五轮评审发现 1）。
   */
  appliedSlots: Map<LayerCtorSlot, string>;
  /**
   * 已写入的 `data` **引用**（不是指纹）。
   *
   * `data` 往往是整份 `FeatureCollection`，序列化它来做去重会把「每次 props 变化」变成一次
   * 深遍历。这里按引用记：换引用才写、同一份数据重复渲染不重复写（正是旧实现里
   * 「DOM 已抹掉、定时器还在」想避免的那次多余写入）。
   *
   * 与 `appliedSlots` 同一条规则：调用之前先复位成 `UNAPPLIED`，成功后再提交。
   */
  appliedData: unknown;
  /** 已就地写入的可选 option 指纹（取值不变时不重复写 SDK）。失效规则同 `appliedSlots`。 */
  appliedMutableKey: string;
  /**
   * 「**可能**已写入」的统一槽位：**尝试过**写入，不论成功。
   *
   * 只有一个用途：判断「之前有值 → 现在变回未表态」时是否必须重建。它刻意与
   * `appliedSlots`（去重指纹，只在成功后推进）分开——两者的判据**必须**不同：
   *
   * - 去重：只认「成功写入过」的指纹，否则一次失败会被记成已完成、同值更新永久不再重试；
   * - 移除检测：认「尝试写入过」。SDK 允许在抛错**之前**已经产生副作用（与 `mountAttempted`
   *   同一条理由），按「成功过」判断会让一次**部分成功**的写入变成永久分叉：`setOptions`
   *   逐 setter 调用时第一个键已经写进 SDK，第二个键抛错，于是这个键在账本上「从没写过」，
   *   之后它变回未表态就不会重建，SDK 永久保留旧值（第四轮评审发现 2）。
   *
   * 单调集合：只增不减（「曾经尝试过」这个事实不会过期）。
   */
  possiblyAppliedSlots: Set<LayerCtorSlot>;
  /** 同上，用于可选 option 的键。 */
  possiblyAppliedOptions: Set<string>;
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

  /**
   * 数据驱动图层的**永久销毁**前的清理：走上统一的「清空」入口。
   *
   * 只走**统一"清空"入口** `clearData`（Driver 按 kind 映射到 `clearData` / `removeAllOverlays`），
   * 因此这里不需要按 kind 分支，也**不需要判挂载状态**——后者曾经存在过（`clearScope` 三态），
   * 它建立在「`GeoJSONLayer.clearData()` 要在 `removeLayer` 之前调、之后无效」这句 reference 上，
   * 而 issue #98 的 live 探针实测**推翻**了它（见下）。**只在永久销毁时做**：普通 `visible=false`
   * 的摘挂不能清（切回可见时还得重新 `setData`）；清理失败不阻断摘除，但要可观测。
   *
   * 依据与实测（`scripts/probe-layer-detached.mts`，JSAPI 4.0 / `BMap.version === "gl"`）：
   *
   * - `GeoJSONLayer`：`removeLayer` 之后 `getData()` 集合**仍保留**（实测 2 条），此时再调
   *   `clearData()` **仍然生效**（实测 2 → 0，未抛错）⇒ reference 那句「要真正清空得在
   *   `removeLayer` 之前调」与运行时不符。可见资源也不靠它：`removeLayer` 本身已经摘掉覆盖物。
   * - `DOMLayer`：`removeLayer` **自己就把节点从文档摘掉了**（实测 `isConnected` 2 → 0，
   *   `getCustomOverlays()` 2 → 0），因此 `removeAllOverlays()` 在 detached 之后是**安全 no-op**
   *   （未抛错）。「只调 `setData(null)` 会残留」那句警告说的是 `setData(null)`，与 `removeLayer` 无关。
   *
   * 两条合起来的结论是：**清空入口与挂载状态无关**，所以「先清再摘」（attached 路径）与
   * 「已摘下后再清」（detached 路径）都安全；这里统一执行，失败只告警。
   */
  const tearDownData = (state: InstanceState, context: MapReadyContext): void => {
    const layers = context.client.driver.layers;
    if (!layers.supports(state.spec.kind, "clearData")) return;
    try {
      layers.clearData(state.handle);
    } catch (error) {
      logger.warn(
        `layer:${state.spec.kind} 销毁前的 clearData 失败（图层仍会被摘除，SDK 侧可能残留数据覆盖物）`,
        { error: (error as Error)?.message ?? String(error) },
      );
    }
  };

  /**
   * 摘除的唯一入口。
   *
   * 以 `mountAttempted`（**调用过** `addLayer`）而不是 `mountState === "attached"`（**成功返回过**）
   * 为门禁：真实 SDK 的 `addLayer` 可能「已经产生副作用、然后抛错」，用成功返回的记账当门禁会让
   * 那次补偿摘除被跳过，实例就永久留在图上（Driver 侧的 `remove` 明确不读记账，正是为了支持这种
   * best-effort 摘除；这一层不能用更严格的记账把它挡掉）。
   *
   * 失败之后 `mountAttempted` **保留**（还有没人认领的实例要摘），`mountState` 置为 `unknown`
   * （既不能按「还挂着」也不能按「已经下去了」记，见 `MountState`）。
   *
   * `permanent` 区分两条语义：**临时摘挂**（`visible=false`，保留数据与实例、**不清**数据覆盖物）与
   * **永久销毁**（组件卸载 / 重建 / Map 销毁）。永久销毁这一侧有两种落法，取决于调用时的挂载状态：
   *
   * - `attached`（含 add 失败补偿）：**先清数据覆盖物、再摘除**，即官方推荐的
   *   `clearData()` / `removeAllOverlays()` → `removeLayer()` 顺序；
   * - 已经 `detached`（此前 `visible=false` 已成功摘过一次）：只做 **detached cleanup**——
   *   可执行的清空照常做（见 `tearDownData`），但**不会再摘一次**（`mountAttempted` 已复位，
   *   下面那道门禁会直接 return）。重复 `removeLayer` 的安全性已由 issue #98 实测（三个家族均未
   *   抛错，见决策 12b），但**这条路径本身只做一次摘除**——重复摘除只出现在「挂载状态未知」时的
   *   收敛动作里。
   */
  const unmount = (state: InstanceState, context: MapReadyContext, permanent = false): void => {
    // 清理只与「这个实例要被永久丢弃」有关，与「它还挂不挂着」无关（要不要执行由清空操作的
    // 作用域决定，见 `tearDownData`）。放在门禁之前，是为了让「已经摘下」这条路径也走到它。
    if (permanent && !state.torndown) {
      state.torndown = true;
      tearDownData(state, context);
    }
    if (!state.mountAttempted) return;
    // 记账在**摘除成功返回之后**才复位。`removeLayer` 与 `addLayer` 一样允许「副作用还没完成就
    // 抛错」，先复位的话 `mountAttempted` 就变成「从未挂过」，后续的永久销毁（组件卸载 / 重建 /
    // Map 销毁）会在门口 return 而**不再重试** —— SDK 上留下一个再也没人认领的图层。
    // 保留记账 = 保留「仍需 best-effort 摘除」的所有权。
    try {
      context.client.driver.layers.remove(target(context), state.handle);
    } catch (error) {
      // 「可能摘掉了、也可能没摘掉」——两种都真实存在（SDK 允许先产生副作用再抛错）。
      state.mountState = "unknown";
      throw error;
    }
    state.mountState = "detached";
    state.mountAttempted = false;
  };

  /**
   * 挂上 / 摘掉：图层的显隐口径。
   *
   * `unknown` 时**尝试**通过「先摘一次、再挂」收敛，而不是猜：
   *
   * - 要挂上时先 best-effort 摘一次（成功即「确定已 detached」），再 `add`；
   * - 要摘掉时直接 `unmount`（它内部同样把 `unknown` 再推一次）。
   *
   * 它依赖前提 P——「对已经摘掉的图层重复 `removeLayer` 是安全的」。**该前提已由 issue #98 的
   * live 探针实测成立**（GeoJSON / DOM / Tile 重复摘除均未抛错，见 ADR 决策 12b），因此两种失败
   * 形状都落到「恰好挂一份」（上一步真的没摘掉 ⇒ 这次摘掉；上一步其实已摘掉 ⇒ 这次是 no-op）。
   *
   * 覆盖范围按证据写准：三个家族实测 + 其余 kind 走**同一个** `map.removeLayer` 入口。若将来某个
   * kind / SDK 版本不成立，退化仍然有界且可观测（状态停在 `unknown`、失败经 `resource:error` 交出，
   * 且**绝不会**因为「猜已经下去了」去 `add` 而出现两份）——这条防御性不变量由悲观契约的用例钉住。
   *
   * 这次尝试**不是免费的**（多一次 SDK 调用），但它只在「上一次调用抛过错」之后才发生。
   */
  const syncMounted = (state: InstanceState, context: MapReadyContext): void => {
    const layers = context.client.driver.layers;
    const shouldMount = state.spec.visible !== false;
    if (!shouldMount) {
      unmount(state, context);
      return;
    }
    if (state.mountState === "attached") return;
    if (state.mountState === "unknown") {
      // 先摘一次把未知变确定。它自己失败就再抛（状态仍是 unknown，等下一次机会）。
      unmount(state, context);
    }
    state.mountAttempted = true;
    try {
      layers.add(target(context), state.handle);
    } catch (error) {
      // 「副作用可能已经产生」⇒ best-effort 摘一次，再把**原错误**抛出去：`addLayer` 为什么没
      // 挂上，比「补偿摘除也失败了」更值得让调用方看见。补偿自身失败不静默——`mountAttempted`
      // 会保留为 true，因此 `create()` 的 catch 里那次 `record.dispose()` 会经永久销毁路径再试
      // 一次，失败时由 `LayerRegistry` 留下 `logger.warn`。
      try {
        unmount(state, context);
      } catch {
        /* 有意吞掉：原错误在下一行抛出，补偿失败的兜底见上 */
      }
      throw error;
    }
    state.mountState = "attached";
    state.everAttached = true;
  };

  /**
   * **纯判定**：「上一次挂上去过的实例，现在要重新可见」⇒ 必须重建，不能复用。
   *
   * 依据是 issue #98 的 live 读数（真实 4.0，严格按内核的 `addLayer → setData` 顺序）：
   *
   * | 步骤 | DOMLayer 的节点（连在文档） |
   * | --- | --- |
   * | 挂载 + `setData` | 2 |
   * | `removeLayer`（内核的「隐藏」） | 0 |
   * | **再 `addLayer`（内核的「再显示」）** | **0 —— 内容不会自己回来** |
   * | 再补一次 `setData` | 0，且**调用本身抛错**（`Cannot read properties of null (reading 'coordinate')`）|
   * | 对照：**换一个新实例** | **2 —— 正常渲染** |
   *
   * 也就是说 `removeLayer` 会清空图层持有的 Map 引用，该实例**再也渲染不了**，补 `setData` 也救不回来。
   * `GeoJSONLayer` 的 `getData()` 集合在同样路径下**还在**（2 条），但「集合在」不等于「覆盖物回到图上」——
   * 那一点没有公开手段可观测（`Map` 上没有列出覆盖物的方法），因此**不构成「复用可行」的证据**。
   *
   * 既然没有任何 kind 的「摘掉之后复用」被证实可行，就不去猜：**重新可见一律重建**。
   * 代价是一次重建（与「构造期选项变化」同级，且只发生在 hide → show 这条不热的路径上）。
   */
  const needsRemountRebuild = (state: InstanceState): boolean =>
    state.everAttached && state.mountState !== "attached" && state.spec.visible !== false;

  /**
   * 就地写入「依赖已挂载」的槽位。
   *
   * **不在 `map.addLayer` 之前执行这类操作**（issue #40 的非目标）：官方明确层级调整会访问
   * 已关联的 Map 与图层管理器，未挂载时调用是未定义行为。因此这里以「我们相信它确实挂着」
   * （`mountState === "attached"`）为前置——`unknown` 同样不写（那时连它在地图上的状态都不确定）。
   */
  const syncPostMountSlots = (state: InstanceState, context: MapReadyContext): void => {
    const layers = context.client.driver.layers;
    const probe = probeOf(context);
    const kind = state.spec.kind;

    // 未挂载时**不写、也不记账**：官方明确「层级调整一类操作会访问已关联的 Map 与图层管理器」，
    // 未挂载时调用是未定义行为（issue #40 的非目标）。等挂载发生时这里会被再调一次。
    if (state.mountState !== "attached") return;
    /** 走 option 通道的槽位攒成**一次** `setOptions`（Driver 再按整袋 / 字段 setter 分类）。 */
    const optionBag: Record<string, unknown> = {};
    /** 整袋调用成功**之后**才提交的去重指纹。 */
    const pendingBagSlots: Array<[LayerCtorSlot, string]> = [];

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
        // 去重指纹在调用**之前**失效：这一次调用可能已经改了 SDK 然后抛错，那之后旧指纹就不再
        // 代表 SDK 的当前值（见 `appliedSlots` 的说明）。成功返回后才重新提交。
        state.appliedData = UNAPPLIED;
        if (value === null) layers.clearData(state.handle);
        else layers.setData(state.handle, value);
        state.appliedData = value;
        continue;
      }

      const fingerprint = slotFingerprint(value);
      if (state.appliedSlots.get(slot) === fingerprint) continue;

      if (slot === "zIndex" && layers.supports(kind, "setZIndex")) {
        // 「尝试过」先记：这一笔的意义是「SDK 可能已经改了」——它抛错也可能发生在改变之后。
        state.possiblyAppliedSlots.add(slot);
        // 同上：去重指纹先失效，成功后再提交。
        state.appliedSlots.delete(slot);
        layers.setZIndex(state.handle, value as number);
        state.appliedSlots.set(slot, fingerprint);
        continue;
      }

      // 其余可就地更新的槽位（`DOMLayer` 的 `zIndex` / `minZoom` / `maxZoom` 一类）走整袋 /
      // 字段 setter 通道，由 Driver 的 `mutable` / `bagSetters` 分类决定具体入口。
      optionBag[slot] = value;
      pendingBagSlots.push([slot, fingerprint]);
    }

    if (Object.keys(optionBag).length > 0) {
      // 顺序要紧：**先让旧指纹失效、再记「尝试过」、再调用、成功之后才提交新指纹**。
      // - 旧指纹先失效：这一次调用可能已经改了 SDK 然后抛错，那之后它就不再代表 SDK 的当前值
      //   （第五轮评审发现 1）；
      // - 「尝试过」先记：整袋 setter 内部同样可能逐键生效（Driver 按 `bagSetters` / `mutable`
      //   分类后可能拆成多次调用），第一个键写成功、第二个键抛错时，前一个键已经真的改了 SDK；
      // - 新指纹最后记：反过来的话，一次失败的整袋更新会被记成已完成，之后同值更新被指纹跳过、
      //   永久不再重试（声明与 SDK 状态静默分叉）。
      for (const [slot] of pendingBagSlots) {
        state.possiblyAppliedSlots.add(slot);
        state.appliedSlots.delete(slot);
      }
      layers.setOptions(state.handle, optionBag);
      for (const [slot, fingerprint] of pendingBagSlots) state.appliedSlots.set(slot, fingerprint);
    }
  };

  /**
   * 就地写入「可选 option」（`colors` / `edge` 这类有 setter 的构造项）。
   *
   * 只是写入，**不负责判断「要不要重建」**：那个判定已经前置到 `detectRemovedState()`（见该函数
   * 与 watch 路径的顺序说明）。这里唯一的记账是「去重指纹」与「可能已写入」两组，含义见
   * `InstanceState`。
   */
  const syncMutableOptions = (state: InstanceState, context: MapReadyContext): void => {
    const mutable = layerMutableOptions(state.spec, probeOf(context));
    const nextKeys = Object.keys(mutable);

    if (nextKeys.length === 0) return;
    const fingerprint = stableLayerValue(mutable);
    if (fingerprint === state.appliedMutableKey) return;
    // 未挂载时**不写、也不记账**：切回可见时这里会被再调一次（记成「已应用」会让那次写入永久丢失）
    if (state.mountState !== "attached") return;

    // 同 `syncPostMountSlots`，三条顺序都不能换：
    // ① 旧指纹失效（一次可能已生效的失败会让它陈旧 ⇒ 用户改回上一次成功值会被误跳过）；
    // ② 「尝试过」整批先记（`setOptions` 在 Traffic 上是**逐 setter** 调用：`setColors` 成功、
    //    `setEdge` 抛错时，前一个键已经真的改了 SDK，整批不记就会在移除时漏掉重建）；
    // ③ 新指纹最后记（失败被记成完成 ⇒ 同值更新永不重试）。
    state.appliedMutableKey = NO_MUTABLE_KEY;
    for (const key of nextKeys) state.possiblyAppliedOptions.add(key);
    context.client.driver.layers.setOptions(state.handle, mutable);
    state.appliedMutableKey = fingerprint;
  };

  /**
   * **纯判定**：有没有「已经写过 / 可能写过、现在变回未表态」的状态（槽位 / 可变 option）。
   *
   * 这是「必须重建」的判据，刻意与执行分开：一旦判定必须重建，就**不该**再执行就地写入
   * （否则一步 SDK 异常会把已经确定的收敛挡掉——第三轮评审发现 3）。`data` 例外：它有
   * `null = 清空` 的显式语义，`undefined` 表示「不表态（保持现状）」。
   *
   * 判据用的是「**可能**已写入」而不是「成功写入过」：详见 `possiblyAppliedSlots` 的说明——
   * 按成功判断会让一次部分成功的写入变成永久分叉。
   */
  const detectRemovedState = (state: InstanceState, context: MapReadyContext): string[] => {
    const mutable = layerMutableOptions(state.spec, probeOf(context));
    const removedSlots = [...state.possiblyAppliedSlots].filter(
      (slot) => layerSlotValue(state.spec, slot) === undefined,
    );
    const removedOptions = [...state.possiblyAppliedOptions].filter((key) => !(key in mutable));
    return [...removedSlots, ...removedOptions];
  };

  /** 组件侧失败的唯一上报出口（mount 路径与 watch 路径共用，避免两条路各写一份）。 */
  const reportResourceError = (error: unknown): void => {
    const wrapped =
      error instanceof BMapError
        ? error
        : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error });
    mapContext.events.emit("resource:error", { error: wrapped, component: hooks.component });
  };

  /** 逐步隔离执行：一步失败只上报，不阻断同一次更新里的其它步骤。 */
  const runIsolated = (step: () => void): void => {
    try {
      step();
    } catch (error) {
      reportResourceError(error);
    }
  };

  const resource = useSdkResource<Readonly<Props>, LayerHandle, MapReadyContext>({
    props,
    label: "layer-resource",
    /**
     * 失败经 `resource:error` 交出（与 `useOverlayResource` / `useControlResource` 同一条
     * 诊断通道）：图层组件的错误不该只留在内部 ref 里。
     */
    onError: reportResourceError,
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
          mountState: "detached",
          mountAttempted: false,
          everAttached: false,
          torndown: false,
          rebuildKey: layerRebuildKey(spec, probeOf(context)),
          appliedSlots: new Map(),
          appliedData: UNAPPLIED,
          // 用「未写」哨兵而不是当前值的指纹：可就地更新的 option **不进构造选项**，
          // 因此挂载后的这一次写入是它们的唯一生效路径（否则初始值会被静默丢弃）。
          appliedMutableKey: NO_MUTABLE_KEY,
          // 同为空集：这两个是「尝试过写入」的单调账本，由就地写入那几步自己填。
          possiblyAppliedSlots: new Set(),
          possiblyAppliedOptions: new Set(),
        };
        instance = state;
        const record = registryOf().register({
          kind: spec.kind,
          handle,
          scope,
          remove: () => {
            // 摘除只在这里发生（`unmount` 以「调用过 add」为门禁），因此重复 dispose
            // （组件卸载 / 重建 / Map 卸载）不会多摘一次。这条路径是**永久销毁**：
            // 先清数据覆盖物，再由 Map 摘除图层。
            if (instance === state) instance = null;
            unmount(state, context, true);
          },
        });
        // 先登记账本、再做副作用：`syncMounted` / 槽位写入里任何一步抛错时，错误路径上
        // **一定**有一个可释放的记录（`useSdkResource` 拿到异常后会 dispose 本代 scope，
        // 但那时它还没有 registration；先登记能让 `remove` 兜住已经挂到图上的实例）。
        try {
          syncMounted(state, context);
          // 挂载路径**不需要**跑 `detectRemovedState()`：它是全新实例，两个「可能已写入」的账本
          // 都是空的，不可能存在「变回未表态」的状态（那正是 `replace()` 才要判的事）。
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
              // 这一步里的 SDK 调用都可能抛错，抛出来就是 unhandled rejection —— 必须收成
              // `resource:error`（与 mount 路径同一条诊断通道）。
              try {
                const next = hooks.toSpec(current);
                if (layerRebuildKey(next, probeOf(ready)) !== state.rebuildKey) {
                  void replace();
                  return;
                }
                state.spec = next;

                // **重新可见**要换实例（`removeLayer` 之后的实例再也渲染不了，见 `needsRemountRebuild`）：
                // 与「必须重建」同一条通道，判定同样放在任何就地写入之前。
                if (needsRemountRebuild(state)) {
                  void replace();
                  return;
                }

                // **先判定、后执行**：一旦确定「必须重建」，就不再执行就地写入——否则同一次更新里
                // 一步 SDK 异常会把这个已经确定的收敛挡掉，而 props 已稳定、不会再来一次
                // （第三轮评审发现 3）。
                const removed = detectRemovedState(state, ready);
                if (removed.length > 0) {
                  devWarn(
                    `[layer:${state.spec.kind}] ${removed.join(" / ")} 由有值变为未表态：` +
                      "SDK 没有 unset 入口，本库不猜默认值 ⇒ 重建图层，让它回到 SDK 自己的默认状态",
                  );
                  void replace();
                  return;
                }

                // 各步互相隔离：一次写入失败不该连带吞掉同一次更新里其它步骤（各自上报为
                // `resource:error`；失败的记账不会提交，下一次变化或重挂载会重试）。
                runIsolated(() => syncMounted(state, ready));
                runIsolated(() => syncPostMountSlots(state, ready));
                runIsolated(() => syncMutableOptions(state, ready));
              } catch (error) {
                reportResourceError(error);
              }
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
