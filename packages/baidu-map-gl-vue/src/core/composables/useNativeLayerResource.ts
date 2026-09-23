/**
 * useNativeLayerResource —— 原生批量数据图层的**共享生命周期内核**（M6 / issue #36）
 *
 * `BPointCollection`（#34）与 #36 的四个可视化图层（`BLineLayer` / `BFillLayer` /
 * `BHeatmapLayer` / `BTrackLineLayer`）在生命周期上是同一件事：**一个 SDK 实例 + 数据 + 样式 +
 * 几个字段级开关 + 拾取事件 + 释放**。差异只有三处，都由调用方（组件）以 hook 的形式给出：
 *
 * 1. **构造期选项与重建指纹**（`ctorOptions` / `rebuildKey`）：哪些 prop 是构造期的、
 *    变了必须换实例；
 * 2. **样式袋与数据**（`style` / `data`）：各自映射成官方的 `setStyleOptions` 参数与 `setData` 载荷；
 * 3. **事件绑定**（`bind`）：官方四类专页图层的事件面相同，但组件要派发的领域事件名不同。
 *
 * 抽出来的理由就是 issue 自己的抽象顺序约束：「确认两个以上真实消费者后再提取共享状态或 style
 * 抽象」——这里是 5 个消费者，而且 #34 那份实现已经由多轮评审打磨出若干不变式（先摘成功再建新的、
 * 指纹先失效再调用、样式要逐字段判撤回、构造期项变化才重建）。再复制四份必然分叉，而分叉的表现是
 * 「同一个 prop 在不同图层上行为不同」。
 *
 * ## 四条写入路径（逐条对应官方入口）
 *
 * | 变化 | 路径 | 依据 |
 * | --- | --- | --- |
 * | `data`（有值） | `setData`，**不重建** | 官方 `setData(geojson)` 是一等公民 |
 * | `data` 由有值变为 `null`（明确「没有数据」） | **换一个没有数据的实例** | 这批图层**没有公开的清空入口**（见 `driver/jsapi-v4/native-layers.ts` 的操作表注释），重建是唯一有依据、且能收敛的表达；代价写入 ADR 已知限制 |
 * | `style` | `setStyleOptions` + `doOnceDraw`（Driver 的 `setStyle`），**不重建** | 官方是 merge，且明确「改完要重绘」 |
 * | `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | **有 setter 就写 setter**，**不重建** | 官方这批字段级 setter 逐条在 `native-layers.ts` 的 `operations` 里 |
 * | 构造期项（`idKey` / `enablePicked` / `pickWidth` …） | **换实例** | 只有 `setBaseOptions`（整袋且需重绘）；「改了就换实例」比「写进去但画面不变」诚实 |
 *
 * `data: undefined` 是**不表态**（不产生任何 SDK 调用、也不重建），与 `LayerSpec` 的口径一致；
 * 「没有数据」必须显式写 `null`——两个取值承担两件事，别用 `undefined` 兼表它们。
 * 不表态在**更新路径**上什么都不做，但在**换实例**时会把上一代成功送出的数据补齐到新实例，
 * 否则「一个与 data 无关的构造期项变化」会让画面上的数据凭空消失（见 `applyData`）。
 *
 * ## `visible` 有两种落地，按 kind 的能力面选
 *
 * - **有 `setVisible` 的 kind**（四类专页图层）：写 setter。隐藏 ≠ 释放数据（issue 的非目标明确
 *   写了「不把 setVisible(false) 当作释放数据」）。
 * - **没有 `setVisible` 的 kind**（扩展 API 的 `Heatmap` / `TrackLine`）：**挂上 / 摘掉**。
 *   这是本库的既有口径（ADR `2026-09-17-layer-spec-and-registry.md` 决策 8：「`visible` 统一
 *   表达为挂上 / 摘掉」），并且**重新可见时换实例**——依据是 #98 的 live 实测：`removeLayer`
 *   之后的实例再也渲染不了（同一个实例重挂不会让内容回来，补 `setData` 也救不回来）。
 *
 * ## 释放与不变式
 *
 * - 实例登记进该地图的图层账本（`MapContext.layers`），因此 `MapRuntime.dispose()` 会在
 *   `map.destroy()` **之前**摘掉它（与底图图层同一条不变式）；
 * - 业务监听挂在**本代** child scope 上：重建时旧监听随旧 scope 一起消失，不存在「监听留在旧实例」；
 * - **摘除失败时绝不重复挂载**：`remove` 允许「已经产生副作用、然后抛错」，因此失败后挂载状态是
 *   `unknown`，下一次同步动作会**先摘一次**把它推回确定状态（依赖前提 P：对已经摘掉的图层重复
 *   `removeLayer` 是安全的——该前提已由 #98 的 live 探针在三个家族上实测成立，见 ADR 决策 12b）；
 * - **永久销毁只有两步**：解绑业务监听（`LayerRegistry.dispose()` 先做）→ `removeLayer`。这与官方
 *   reference 的资源清理清单一致（「解绑事件 → `map.removeLayer(layer)`」）；**不**额外清数据——
 *   四类专页图层没有 `clearData` 入口（#106 评审 P1），而扩展 API 上清一次既无用又多一次可失败调用。
 *
 * ## 为什么不吃 `props` 全量、而要显式 `rebuildKey`
 *
 * 重建指纹必须**只**包含构造期项：把 `props` 整体序列化会让「父级每次渲染传新的内联对象」
 * 每次都换实例（数据图层的实例重建代价 = 整个数据集重新解析）。指纹的组成由组件给出，
 * 因为「哪些项是构造期的」只有它知道（各 kind 的官方选项表不同）。
 */
import { onMounted, onScopeDispose, onUnmounted, watch } from "vue";
import { useRequiredMapContext } from "../context/inject";
import type { MapReadyContext } from "../context/types";
import { createFeatureStateApi, type FeatureStateApi, type FeatureStateSession } from "../data/featureState";
import { normalizeIdField } from "../data/identity";
import { BMapError } from "../errors/BMapError";
import { createDevWarnOnce } from "../logger";
import { createLayerRegistry, type LayerRecord, type LayerRegistry } from "../layers/LayerRegistry";
import { nativeLayersOf } from "../layers/nativeLayerAccess";
import { stableLayerValue } from "../layers/LayerSpec";
import { ResourceScope } from "../lifecycle/ResourceScope";
import type {
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
} from "../../driver/types/native-layers";
import type { OverlayTarget } from "../../driver/types/overlays";

/** 统一的字段级开关（各组件按自己 kind 的官方能力面**声明其中的子集**）。 */
export interface NativeLayerUnifiedFields {
  visible?: boolean;
  opacity?: number;
  zIndex?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface NativeLayerBindInput {
  readonly handle: NativeLayerHandle;
  readonly context: MapReadyContext;
  /** 本代的 child scope：监听器 / watcher 都挂这里（重建后旧监听随之消失）。 */
  readonly scope: ResourceScope;
  /**
   * **摘除期间的回调门**：严格换实例时内核对旧实例做 `quiesce → remove → commit`，在 `remove`
   * 期间这个函数返回 `true`。`bind()` 里的事件回调必须据此**提前返回**。
   *
   * 为什么需要它：`removeLayer` 期间 SDK 可能同步派发事件（真实 SDK 的 `tileload` 一类），而那个
   * 实例正在被拆。用「先把监听 dispose 掉」来挡是没有回头路的 —— `scope.dispose()` 不可逆，
   * 一旦 `remove` 抛错，旧实例就变成「还在图上但点不动」，而我们要的是「失败后完全恢复可用」。
   */
  readonly isQuiescing: () => boolean;
}

/**
 * 数据面的三个 hook。
 *
 * 刻意把「廉价的表态 / 指纹」与「真正的载荷」分开：真正的载荷往往是一次**数据变换**
 * （适配 `Item[]` → `FeatureCollection`、校验、建索引），而前两者是在**每次 props 变化**时都要算的。
 * 合成一步会让「父级重渲染」变成一次 O(n) 变换——这正是 #34 把「输入指纹」与「适配结果」分开的
 * 理由，不能因为抽内核又合回去。
 */
export interface NativeLayerDataHooks<Props> {
  /**
   * 廉价的输入指纹（watch 源）：**不得**做深遍历或数据变换。
   *
   * 引用 + 版本 + 取值函数源码文本是这里的常见组合；相同指纹 ⇒ 不产生任何 SDK 调用。
   */
  key(props: Readonly<Props>): string;
  /**
   * 这次输入的**表态**（同样是廉价的属性读取）：
   *
   * - `"value"`：有数据 ⇒ `setData`；
   * - `"empty"`：`null`，明确要求「没有数据」⇒ 见 `sync()` 的重建判据；
   * - `"absent"`：`undefined`，**不表态** ⇒ 不产生任何 SDK 调用（既有数据保持不变），
   *   与 `LayerSpec` 的口径一致。
   */
  state(props: Readonly<Props>): "value" | "empty" | "absent";
  /**
   * 真正交给 `setData` 的载荷（只在 `state === "value"` 且指纹变化 / 首次挂载时求值）。
   *
   * 返回非对象时**不调用 SDK**（那是 hook 契约被违反，告警一次即可，不静默写一个非法值进 SDK）。
   */
  value(props: Readonly<Props>): object | null | undefined;
}

export interface NativeLayerResourceHooks<Props> {
  /** 组件名（诊断通道 `resource:error` 与开发期告警都用它）。 */
  component: string;
  /** 图层种类（决定 `supports()` 的答案）。 */
  kind: NativeLayerKind;
  /**
   * 构造期选项（官方构造参数里**不能就地更新**的那些）。
   *
   * 必须是**纯投影**（只读 props、无副作用）：每次 props 变化与每次创建都会调用。
   */
  ctorOptions(props: Readonly<Props>): Record<string, unknown>;
  /** 构造期指纹：与已创建实例的指纹比对，不同 ⇒ 换实例。 */
  rebuildKey(props: Readonly<Props>): string;
  /** 样式袋（Driver 按 kind 映射到 `setStyleOptions` / `setOptions`）。`undefined` = 不表态。 */
  style(props: Readonly<Props>): Record<string, unknown> | undefined;
  /** 数据面（见 `NativeLayerDataHooks`）。 */
  data?: NativeLayerDataHooks<Props>;
  /**
   * 业务身份字段名（构造期 `idKey`）；**没表态时返回 `undefined`**。
   *
   * 它是要素状态命令面的前置条件：身份未知时「按 id 定位」没有意义，命令面会显式拒绝并告警一次
   * ——与拾取在同样情况下如实返回 `id: null` 是**同一条口径**（不允许出现两套身份语义：
   * 拾取说「认不出」，状态命令却悄悄依赖 SDK 的默认身份）。
   */
  identity?(props: Readonly<Props>): string | undefined;
  /** 绑定官方事件（每个实例一次，重建时拿到的是新实例 + 新 scope）。 */
  bind?(input: NativeLayerBindInput): void;
}

export interface NativeLayerResource {
  /** 要素状态命令面（按业务 id 定位；未就绪时命令不排队，见 `featureState.ts`）。 */
  readonly featureState: FeatureStateApi;
  /**
   * **当前会话**（Driver + 句柄）的取值器；未就绪（或已释放）时返回 `null`。
   *
   * 暴露给组件侧的**第二**命令面（如 TrackLine 的播放控制）复用：每条命令重新求值，
   * 与 `featureState` 同一条口径——图层会因构造期选项变化而换实例，闭包里的旧句柄会让
   * 命令打进一个已经不在地图上的图层。
   */
  session(): FeatureStateSession | null;
  /**
   * 最近一次**成功送出**的数据。
   *
   * 拾取的要索身份兜底要用它（`dataIndex` 指向的正是我们自己送出去的那份数据），与 SDK 侧
   * 保持同一份——两者各留一份会让「点击一个刚被替换掉的要素」返回另一个数据集的属性。
   */
  sentData(): object | null;
}

/** 挂载状态的三种读数（理由见文件头「摘除失败时绝不重复挂载」）。 */
type MountState = "attached" | "detached" | "unknown";

interface InstanceState {
  handle: NativeLayerHandle;
  /** 本代 child scope（业务监听挂这里）。 */
  listenerScope: ResourceScope;
  rebuildKey: string;
  /** 已写入字段的指纹（值没变就不重复写 SDK）。失效规则见 `applyFields`。 */
  applied: Map<string, string>;
  /**
   * 「**可能**已写入」的字段/选项（单调只增）。
   *
   * 与 `applied`（去重指纹）是**两本账**，判据刻意不同（ADR `2026-09-17-layer-spec-and-registry.md`
   * 决策 6）：
   *
   * - 去重只认「成功写入过」的指纹（`applied`：调用之前先失效、成功返回后才提交）；
   * - 「撤回检测」认「**尝试**写入过」（这一本）。SDK 允许在抛错**之前**已经产生副作用，按「成功过」
   *   判断会让一次**部分成功**的写入变成永久分叉：某个字段已经写进 SDK、随后另一个字段抛错，
   *   于是它在账本上「从没写过」，之后变回未表态就不会重建，SDK 永久保留旧值。
   */
  possiblyApplied: Set<string>;
  /**
   * 最近一次**成功写入**的样式字段名。
   *
   * 样式是**逐字段 merge**（官方 `setStyleOptions`），因此「整组 style 还在、其中一个字段被撤回」
   * 必须在 SDK 上被发现：只判「有没有 style 对象」会漏掉这种撤回（评审第一轮的反例：
   * `color: "red" → undefined` 而 `size` 仍是 18）。
   */
  appliedStyleKeys: string[];
  mountState: MountState;
  /**
   * 是否**调用过** `addLayer`（无论成功与否）。
   *
   * 与 `mountState` 分开的理由与 `useLayerResource` 完全同源：SDK 允许「已经产生副作用、然后
   * 抛错」，用「成功返回过」当摘除门禁会让那次补偿摘除被跳过，实例就永久留在图上。
   */
  mountAttempted: boolean;
  /** 是否**成功挂上去过**（用于「重新可见必须换实例」的判定）。 */
  everAttached: boolean;
  /** 账本记录（`Map` 卸载前摘掉它）。 */
  record: LayerRecord | null;
  /** 摘除期间的业务回调门（由账本的严格 detach 驱动，见 `NativeLayerBindInput.isQuiescing`）。 */
  quiescing: boolean;
}

export function useNativeLayerResource<Props>(
  props: Readonly<Props>,
  hooks: NativeLayerResourceHooks<Props>,
): NativeLayerResource {
  const ctx = useRequiredMapContext();
  const warnOnce = createDevWarnOnce();
  const warn = (key: string, message: string): void => warnOnce(`${hooks.component}:${key}`, message);

  /** 等待就绪 / 卸载竞态的门禁。 */
  const scope = new ResourceScope({ label: hooks.component });
  /** 组件自持的账本（自定义 Context 不提供 `layers` 时用，随组件作用域释放）。 */
  const ownRegistry: LayerRegistry = createLayerRegistry();
  const registryOf = (): LayerRegistry => ctx.layers ?? ownRegistry;
  onScopeDispose(() => {
    if (!ctx.layers) ownRegistry.disposeAll();
  });

  let readyCtx: MapReadyContext | null = null;
  let instance: InstanceState | null = null;
  /** 最近一次**成功送出**的数据（`setData` 之后才更新）。 */
  let sent: object | null = null;
  /** 「这一次构建用的是哪份输入」的指纹（`setData` 去重用）。 */
  let appliedDataKey = "";

  const target = (context: MapReadyContext): OverlayTarget => ({ kind: "map", handle: context.map });

  /** 统一字段的当前取值（组件按 kind 的能力面声明其中的子集）。 */
  const unifiedFields = (): NativeLayerUnifiedFields => {
    const source = props as unknown as NativeLayerUnifiedFields;
    return {
      visible: source.visible,
      opacity: source.opacity,
      zIndex: source.zIndex,
      minZoom: source.minZoom,
      maxZoom: source.maxZoom,
    };
  };

  /* ------------------------------------------------------------ 挂载 / 摘除 */

  /**
   * 该 kind 的 `visible` 走哪条路。
   *
   * 有 `setVisible` 就写 setter（隐藏 ≠ 释放数据）；没有就挂上/摘掉。判据来自 Driver 的
   * `supports()`（单一事实源），本组件不自己维护一张 kind 表。
   */
  const hidesBySetter = (context: MapReadyContext): boolean =>
    nativeLayersOf(context.client).supports(hooks.kind, "setVisible");

  const detach = (state: InstanceState, context: MapReadyContext): void => {
    // 以「**调用过** `addLayer`」而不是「成功返回过」为门禁（理由见 `mountAttempted`）
    if (!state.mountAttempted) return;
    try {
      nativeLayersOf(context.client).remove(target(context), state.handle);
    } catch (error) {
      // 「可能摘了、也可能没摘」——两种都真实存在（SDK 允许先产生副作用再抛错）
      state.mountState = "unknown";
      throw error;
    }
    state.mountState = "detached";
    state.mountAttempted = false;
  };

  const attach = (state: InstanceState, context: MapReadyContext): void => {
    if (state.mountState === "attached") return;
    if (state.mountState === "unknown") {
      // 先把未知推回确定：摘一次（已摘掉时是安全 no-op，前提 P 由 #98 实测）
      detach(state, context);
    }
    state.mountAttempted = true;
    try {
      nativeLayersOf(context.client).add(target(context), state.handle);
    } catch (error) {
      // 「副作用可能已经产生」⇒ best-effort 摘一次，再把**原错误**抛出去（补偿失败不静默：
      // `mountAttempted` 会保留，后续的永久销毁路径还会再试一次）
      try {
        detach(state, context);
      } catch {
        /* 有意吞掉：原错误在下一行抛出 */
      }
      throw error;
    }
    state.mountState = "attached";
    state.everAttached = true;
  };

  /**
   * 挂载同步。
   *
   * ⚠️ `visible` 走 setter 的 kind **始终挂着**实例：`addLayer` / `removeLayer` 表达的是「实例在不在
   * 图上」，而 `setVisible(false)` 表达「还在图上但不可见」——两者正交（issue 的非目标明确写了
   * 「不把 `setVisible(false)` 当作释放数据」）。所以这里只有「没有 setter」的 kind 才用摘挂表达显隐。
   */
  const syncMounted = (state: InstanceState, context: MapReadyContext): void => {
    if (hidesBySetter(context) || unifiedFields().visible !== false) {
      attach(state, context);
      return;
    }
    detach(state, context);
  };

  /**
   * **纯判定**：「摘掉过的实例现在要重新可见」⇒ 必须换实例。
   *
   * 依据是 #98 的 live 读数：`removeLayer` 之后的实例再也渲染不了（重挂不会让内容回来，
   * 补 `setData` 也救不回来），因此不去猜「复用可行」。
   */
  const needsRemountRebuild = (state: InstanceState, context: MapReadyContext): boolean =>
    state.everAttached && state.mountState !== "attached" && unifiedFields().visible !== false && !hidesBySetter(context);

  /* ------------------------------------------------------------ 字段写入 */

  /** 统一字段 → 官方 setter 的映射（只有该 kind 真的支持时才写，否则告警一次并跳过）。 */
  const fieldWrites = (
    state: InstanceState,
    context: MapReadyContext,
  ): Array<[field: string, value: unknown, write: () => void]> => {
    const nativeLayers = nativeLayersOf(context.client);
    const fields = unifiedFields();
    const writes: Array<[string, unknown, () => void]> = [];
    /**
     * 「声明了却在当前 kind 上没有入口」的字段：**告警一次并跳过**。
     *
     * 不静默 no-op 是仓库的一贯口径（同 Driver 的「不支持的操作显式失败」）；这里选择告警而不是
     * 抛错，因为它是**声明面**的问题（组件声明了该 kind 没有的 prop），抛错会把一次渲染炸掉。
     */
    const push = (
      field: keyof NativeLayerUnifiedFields,
      operation: NativeLayerOperation,
      write: (value: never) => void,
    ): void => {
      const value = fields[field];
      if (value === undefined) return;
      if (!nativeLayers.supports(hooks.kind, operation)) {
        warn(
          `${field}:unsupported`,
          `[${hooks.component}] ${hooks.kind} 没有 "${operation}" 的运行时入口：${field} 本次被忽略` +
            "（官方该图层不公开这个 setter）。要隐藏整层请用 visible",
        );
        return;
      }
      writes.push([field, value, () => write(value as never)]);
    };

    // `visible` 只在有 setter 的 kind 上走这条路（没有 setter 的由挂载状态表达）
    if (hidesBySetter(context)) {
      push("visible", "setVisible", (value: boolean) => nativeLayers.setVisible(state.handle, value));
    }
    push("opacity", "setOpacity", (value: number) => nativeLayers.setOpacity(state.handle, value));
    // 层级必须**挂载之后**写（官方：层级调整会访问已关联的 Map 与图层管理器）
    push("zIndex", "setZIndex", (value: number) => nativeLayers.setZIndex(state.handle, value));
    const range = { min: fields.minZoom, max: fields.maxZoom };
    if (range.min !== undefined || range.max !== undefined) {
      if (nativeLayers.supports(hooks.kind, "setZoomRange")) {
        writes.push([
          "zoomRange",
          `${range.min}/${range.max}`,
          () => nativeLayers.setZoomRange(state.handle, range),
        ]);
      } else {
        warn(
          "zoomRange:unsupported",
          `[${hooks.component}] ${hooks.kind} 没有 "setZoomRange" 的运行时入口：` +
            "minZoom / maxZoom 本次被忽略",
        );
      }
    }
    const style = styleOf();
    if (style !== undefined) {
      if (nativeLayers.supports(hooks.kind, "setStyle")) {
        writes.push(["style", style, () => nativeLayers.setStyle(state.handle, style)]);
      } else {
        warn(
          "style:unsupported",
          `[${hooks.component}] ${hooks.kind} 没有 "setStyle" 的运行时入口：style 本次被忽略`,
        );
      }
    }
    return writes;
  };

  /**
   * 写入可就地更新的字段：值没变就不写。
   *
   * `undefined` 一律**不写**：它是「不表态」（默认值由 SDK 自己决定），把 `undefined` 传给
   * setter 只会让 SDK 收到一个非法值。
   */
  const applyFields = (state: InstanceState, context: MapReadyContext): void => {
    // 挂载态未知 ⇒ 一个字都不写（它可能已经不在图上；真实 SDK 对已摘下的实例补 setData 会内部抛错）
    if (state.mountState === "unknown") return;
    for (const [field, value, write] of fieldWrites(state, context)) {
      const fingerprint = stableLayerValue(value);
      if (state.applied.get(field) === fingerprint) continue;
      // 「尝试过」**先**记（单调，专供撤回检测）：这一次调用可能已经改了 SDK 然后抛错
      state.possiblyApplied.add(field);
      // 去重指纹**先失效**再调用：一次「已经写进去、然后抛错」的调用会让旧指纹不再代表 SDK 的当前值
      state.applied.delete(field);
      write();
      state.applied.set(field, fingerprint);
      // 样式另记一份**字段名清单**：merge 语义下，撤回单个字段要在下一次同步时被发现
      if (field === "style") state.appliedStyleKeys = Object.keys(value as Record<string, unknown>);
    }
  };

  /**
   * 「曾经写过、现在变回未表态」的字段。
   *
   * 官方这批图层**没有 unset 入口**（只有各字段的 setter），所以「用户把 `opacity` 撤回
   * `undefined`」在 SDK 侧无法表达。本库的口径与图层内核一致：**不猜默认值，重建实例**，让它
   * 回到 SDK 自己的默认状态（并告警一次——静默保留旧值会让声明与画面分叉）。
   *
   * 判定与执行分开（判出来就不要再执行就地写入）：这一步在 `applyFields` **之前**跑。
   */
  const detectRemovedFields = (state: InstanceState): string[] => {
    const fields = unifiedFields();
    const style = styleOf();
    // 只看「这一项还有没有表态」，不比取值：指纹是「值」的标识，这里问的是「在不在」。
    const present: Record<string, boolean> = {
      opacity: fields.opacity !== undefined,
      zIndex: fields.zIndex !== undefined,
      zoomRange: fields.minZoom !== undefined || fields.maxZoom !== undefined,
      style: style !== undefined,
      // `visible` 有默认值（`true`），永远不会变回未表态
      visible: true,
    };
    // 「撤回检测」读的是 `possiblyApplied`（尝试过写入）而不是 `applied`（成功写入过）：
    // 一次「已产生副作用后抛错」的写入会让 `applied` 里没有这个字段，此时撤回不重建 =
    // SDK 永久保留那个值（与声明分叉）。
    const removed = [...state.possiblyApplied].filter((field) => present[field] !== true);
    const currentStyleKeys = new Set(Object.keys(style ?? {}));
    for (const key of state.appliedStyleKeys) {
      if (!currentStyleKeys.has(key)) removed.push(`style.${key}`);
    }
    return removed;
  };

  /* ------------------------------------------------------------ 数据 */

  /**
   * 数据写入（只有 `state === "value"` 才会真的调 `setData`；输入指纹没变就不写）。
   *
   * `"empty"`（`null`）在这里**不产生 SDK 调用**，这是刻意的：这批图层没有公开的清空入口
   * （见 Driver 的操作表注释），「没有数据」的落地方式是**换一个没有数据的实例**——那件事由
   * `sync()` 的重建判据负责（`dataIsEmpty`），本函数只在创建路径上把空输入记成「这个实例没有数据」。
   *
   * `"absent"`（`undefined`）在更新路径上什么都不做（不表态 ≠ 清空 ≠ 有值），但在**创建路径**上
   * 必须把**上一代成功送出的那份数据补齐到新实例**（#106 评审第二轮 P1）：
   *
   * - 不补的话，一个与 `data` 无关的构造期项变化（或扩展 API 图层的「隐藏 → 显示」）会换实例，
   *   而新实例什么数据都没有 ⇒ 画面上的数据凭空消失，违背「不表态 = 保持不变」的承诺；
   * - 同时 `sentData()` 还留着上一代的数据，拾取兜底账本与真实实例分叉（SDK 空了、账本说有）。
   *
   * 「上一代成功送出」这个事实由 `sent` 承载：它在 `setData` 成功后更新、在「没有数据」与卸载时清空，
   * 因此创建路径上 `sent !== null` 正好等价于「这一代之前确实有一份数据需要继承」。
   */
  const applyData = (state: InstanceState, context: MapReadyContext, force = false): void => {
    // 同 `applyFields`：挂载态未知时不写
    if (state.mountState === "unknown") return;
    const data = hooks.data;
    if (!data) return;
    const mode = data.state(props);
    const key = data.key(props);
    if (mode === "absent") {
      if (force && sent !== null) {
        nativeLayersOf(context.client).setData(
          state.handle,
          sent as unknown as Record<string, unknown>,
        );
      }
      return;
    }
    if (mode === "empty") {
      // 创建路径：新实例本来就没有数据 ⇒ 不需要任何调用；更新路径：`sync()` 已经先换过实例了。
      sent = null;
      appliedDataKey = key;
      return;
    }
    if (!force && key === appliedDataKey) return;
    const value = data.value(props);
    if (value === null || typeof value !== "object") {
      // hook 契约被违反（`state` 说有值、`value` 却给不出载荷）：不静默写一个非法值进 SDK
      warn(
        "data-value-invalid",
        `[${hooks.component}] data 表态为「有值」但取不到对象载荷（实际是 ${value === null ? "null" : typeof value}）：` +
          "本次不调用 setData",
      );
      return;
    }
    nativeLayersOf(context.client).setData(state.handle, value as unknown as Record<string, unknown>);
    sent = value;
    appliedDataKey = key;
  };

  /** **纯判定**：这次输入要不要数据（`null`）——只在重建判据与 `applyData` 里用。 */
  const dataIsEmpty = (): boolean => hooks.data?.state(props) === "empty";

  /* ------------------------------------------------------------ 实例生命周期 */

  const styleOf = (): Record<string, unknown> | undefined => hooks.style(props);

  const reportError = (error: unknown): void => {
    const wrapped =
      error instanceof BMapError
        ? error
        : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error });
    ctx.events.emit("resource:error", { error: wrapped, component: hooks.component });
  };

  /** 创建 + 挂载 + 首次写入 + 绑事件（**只**在「确定要新建一个实例」时调用）。 */
  const createInstance = (context: MapReadyContext): InstanceState => {
    const nativeLayers = nativeLayersOf(context.client);
    const handle = nativeLayers.create(hooks.kind, hooks.ctorOptions(props));
    const listenerScope = new ResourceScope({ label: `${hooks.component}:instance` });
    const state: InstanceState = {
      handle,
      listenerScope,
      rebuildKey: hooks.rebuildKey(props),
      applied: new Map(),
      possiblyApplied: new Set(),
      appliedStyleKeys: [],
      mountState: "detached",
      mountAttempted: false,
      everAttached: false,
      record: null,
      quiescing: false,
    };

    // 账本先登记：任何一步抛错时，卸载路径上一定有一个「能把它从图上摘掉」的记录
    state.record = registryOf().register({
      kind: hooks.kind,
      handle,
      scope: listenerScope,
      /** 摘除期间挡业务回调（可恢复）：见 `NativeLayerBindInput.isQuiescing`。 */
      quiesce: (active) => {
        state.quiescing = active;
      },
      remove: () => {
        // ⚠️ 顺序：**先摘、后销账**。反过来（先清 `instance`）时，一次抛错的 `removeLayer` 会把记账
        // 清成「已经没有实例了」，之后的重试 / 卸载都会跳过摘除 —— 资源留在图上没人认领。
        // （这条是 #35 / PR #108 四轮评审的结论，迁移到共享内核时保留。）
        // 永久销毁只有「摘图层」这一步（`detach` 以「调用过 add」为门禁，因此重复销毁不会多摘一次）。
        // 清数据**不在这里**：四类专页图层没有 `clearData` 入口，而实例随摘除被丢弃、SDK 侧的数据
        // 也随之成为垃圾（官方 reference 的清理清单同样只有「解绑事件 → removeLayer」）。
        detach(state, context);
        if (instance === state) instance = null;
      },
    });
    try {
      syncMounted(state, context);
      // 顺序：先样式 / 显隐 / 层级，**最后**才交付数据 —— 数据一到就渲染，先写到位的字段
      // 才不会让第一帧出现「默认样式闪一下」。
      applyFields(state, context);
      // 传 `force`：首份数据必须写（不依赖指纹是否为空）
      applyData(state, context, true);
      hooks.bind?.({ handle, context, scope: listenerScope, isQuiescing: () => state.quiescing });
    } catch (error) {
      state.record?.dispose();
      throw error;
    }
    instance = state;
    return state;
  };

  /** 释放当前实例（摘除 SDK 资源 + 解绑业务监听 + 账本销账）。 */
  const disposeInstance = (): void => {
    const state = instance;
    if (!state) return;
    instance = null;
    state.record?.dispose();
    if (!state.listenerScope.isDisposed) {
      state.listenerScope.dispose(`${hooks.component}-released`);
    }
  };

  /**
   * 换实例：**先确认旧实例已经从图上摘掉**，再建新的。
   *
   * `removeLayer` 允许「先产生副作用、再抛错」，因此摘除失败时无法判断旧实例是否还在图上；
   * 此时**保留旧实例并交出错误**（宁可这一次不更新，也不能出现两份同图——那会更难收拾）。
   */
  const recreate = (context: MapReadyContext): void => {
    const old = instance;
    if (old) {
      /**
       * 顺序与 `LayerRegistry.dispose()` 一致：**先解绑业务监听**，再摘图层。
       *
       * 常规卸载路径由 `LayerRegistry` 保证这个顺序，但换实例绕过了它（不能走 `record.dispose()`：
       * 那会把账本记录**永久删除**，一旦摘除失败就再也没人认领那个实例）。反过来（先 `removeLayer`
       * 再解绑）会让 SDK 在 `removeLayer` 期间同步派发的事件打到已经开始拆解的业务回调上
       * （ADR `2026-09-17-layer-spec-and-registry.md` 决策 14）。
       */
      /**
       * 走账本的**严格**摘除（三阶段：quiesce 挡业务回调 → `removeLayer` → commit 解绑监听 + 销账）。
       *
       * 不用「先 `releaseListeners(old)` 再 `detach(old)`」：`scope.dispose()` **不可逆**，一旦
       * `removeLayer` 抛错，旧实例就变成「还在图上但已经点不动」——而调用方以为「保留了旧实例」。
       * 现在失败时**不解绑、不销账**：门关掉就完全恢复可用，所有权也还在账本里（下次 sync 再试）。
       * 摘除期间业务回调照样不穿透（消费方按 `isQuiescing()` 提前返回），#22 的口径不变。
       */
      try {
        old.record?.detach();
      } catch (error) {
        reportError(error);
        return;
      }
      instance = null;
    }
    createInstance(context);
  };

  /* ------------------------------------------------------------ 收敛 */

  /**
   * 每次 props 变化后的收敛：能就地写就地写，构造期项 / 撤回 / 重新可见才换实例。
   *
   * **先判定、后执行**：一旦确定要重建，就不再执行就地写入——否则同一次更新里的一步 SDK 异常
   * 会把已经确定的收敛挡掉，而 props 已稳定、不会再来一次（#40 第三轮评审的结论）。
   */
  const sync = (): void => {
    const context = readyCtx;
    if (!context) return; // 还没就绪：创建时会读到最新的 props
    const state = instance;
    if (!state) {
      try {
        createInstance(context);
      } catch (error) {
        reportError(error);
      }
      return;
    }

    try {
      /**
       * ⚠️ **`unknown` 优先于构造指纹**：挂载态未知是「必须先收敛」的状态。只看 `rebuildKey` 会让
       * 一个稳定复现永久卡住：构造项 A → B 时摘除失败（实例可能已不在图上）⇒ 用户把参数改回 A ⇒
       * 指纹重新相等 ⇒ 后面每次 sync 都只命中「不写」的门，**再没有任何收敛动作**。
       */
      if (state.mountState === "unknown") {
        recreate(context);
        return;
      }
      if (
        state.rebuildKey !== hooks.rebuildKey(props) ||
        needsRemountRebuild(state, context)
      ) {
        recreate(context);
        return;
      }
      const removed = detectRemovedFields(state);
      if (removed.length > 0) {
        warn(
          "removed-fields",
          `[${hooks.component}] ${removed.join(" / ")} 由有值变为未表态：SDK 没有 unset 入口，` +
            "本库不猜默认值 ⇒ 重建图层，让它回到 SDK 自己的默认状态",
        );
        recreate(context);
        return;
      }
      // 「没有数据」（`data: null`）与上面那条同形：这批图层没有公开的清空入口，SDK 侧也无法
      // unset，所以换一个**没有数据的实例**来表达它——否则旧数据会继续画在图上（#106 评审 P1-2）。
      // 判据只用两个廉价事实：这次输入要不要数据（`dataIsEmpty`）、当前实例有没有数据（`sent`）。
      if (sent !== null && dataIsEmpty()) {
        warn(
          "data-cleared",
          `[${hooks.component}] data 置为 null 表示「没有数据」，而 ${hooks.kind} 没有公开的清空入口：` +
            "换一个没有数据的实例让它收敛（旧实例连同它的数据一起被丢弃）",
        );
        recreate(context);
        return;
      }
    } catch (error) {
      reportError(error);
      return;
    }

    // 逐步隔离：一步失败不该吞掉同一次更新里的其它步骤（各自上报）。
    // 顺序与创建路径一致（**字段在前、数据最后**）：数据一到就渲染，先写到位的样式 / 显隐 /
    // 层级才不会让这一帧出现「默认样式」的效果。
    try {
      syncMounted(state, context);
    } catch (error) {
      reportError(error);
    }
    try {
      applyFields(state, context);
    } catch (error) {
      reportError(error);
    }
    try {
      applyData(state, context);
    } catch (error) {
      reportError(error);
    }
  };

  /** 监视源：**廉价**指纹（不深遍历数据、也不调 Driver），SDK 未就绪时也能算。 */
  const watchKey = (): string => {
    return [
      hooks.rebuildKey(props),
      stableLayerValue(unifiedFields()),
      stableLayerValue(styleOf() ?? null),
      hooks.data?.key(props) ?? "",
    ].join("::");
  };

  onMounted(async () => {
    const context = await ctx.whenReady(scope.signal);
    if (scope.isDisposed) return;
    readyCtx = context;
    sync();
  });

  onUnmounted(() => {
    disposeInstance();
    sent = null;
    appliedDataKey = "";
    readyCtx = null;
    scope.dispose();
  });

  watch(watchKey, () => sync(), { deep: false, flush: "sync" });

  /**
   * 要素状态命令面。
   *
   * 会话（Driver + 句柄）与**业务身份**都在**每次命令**时求值：
   *
   * - 未就绪 / 已释放 ⇒ `session()` 返回 `null`，命令面告警一次并跳过（不排队）。这样父级 ref 在
   *   `onMounted` 之前拿到实例也不会拿到一个假的成功；
   * - 身份字段没表态（组件没给 `idKey`）⇒ `identity()` 返回 `undefined`，命令面**显式拒绝**。
   *   这条与拾取如实返回 `id: null` 是同一条口径：不让「按 id 定位」悄悄落回 SDK 的默认身份，
   *   否则同一个图层上会出现两套身份语义（#106 评审的建议项）。
   */
  const featureState = createFeatureStateApi({
    component: hooks.component,
    // 身份判定走唯一判定点（`""` / 非字符串都算未声明），与拾取读取用同一个判据
    identity: () => normalizeIdField(hooks.identity?.(props)),
    session: () => session(),
  });

  /** 会话取值器（`featureState` 与组件侧第二命令面共用同一条求值路径）。 */
  function session(): FeatureStateSession | null {
    const state = instance;
    const context = readyCtx;
    if (!state || !context) return null;
    return { driver: nativeLayersOf(context.client), handle: state.handle };
  }

  return { featureState, session, sentData: () => sent };
}
