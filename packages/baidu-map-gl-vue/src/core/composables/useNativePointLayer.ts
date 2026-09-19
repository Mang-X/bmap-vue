/**
 * 原生点图层的**共享生命周期**（M6-POINT-CLUSTER / issue #35）
 *
 * 本模块是 `BPointCollection`（#34）那份 600 行实现的泛化：三个点图层组件
 * （`BPointShapeLayer` / `BPointIconLayer` / `BPointLayer`）的创建、挂载、逐字段写入、
 * 数据交付、拾取投影与释放**只有这一份实现**，差异由 `NativePointLayerProfile` 描述。
 *
 * ## 为什么抽出来（而不是让三个 SFC 各写一遍）
 *
 * 这份生命周期里有六处「写错了也看不出来」的判定：构造期指纹、数据输入指纹、字段指纹、
 * merge 语义下的**逐字段**撤回、重建时「先摘成功再建新的」、以及失败不推进记账。
 * 抄三遍意味着六条不变式各有三个副本 —— 而它们**一定**会漂移，漂移的表现是
 * 「同一个 props 改动在不同组件上行为不同」。
 *
 * ## 四条更新路径（逐条对应官方入口，与 #34 的决策 6 一致）
 *
 * | 变化 | 路径 | 依据 |
 * | --- | --- | --- |
 * | `data` / `dataVersion` / `properties` | `setData()`，**不重建** | `PointShapeLayer#setData` 一族 |
 * | 视觉字段（样式 / `visible` / `opacity` / …） | 字段级写入，**不重建** | `setStyleOptions` / 各 setter |
 * | 构造期项（`itemKey` / `enablePicked` / `pickWidth` / `pickHeight` / 图标层的 `isFlat` / `isFixed`） | **重建实例** | 它们是构造选项，且官方只有整袋 `setBaseOptions`（不自动重绘） |
 * | 视觉字段「由有值变回未表态」 | **重建实例** + 告警 | 官方没有 unset 入口，本库**不猜**默认值 |
 *
 * ## 生命周期归属
 *
 * 实例登记进该地图的图层账本（`MapContext.layers`），因此 `MapRuntime.dispose()` 会在
 * `map.destroy()` **之前**摘掉它；业务监听挂在实例的 child scope 上，释放顺序是
 * 「先解绑业务监听、再由 Map 摘除资源」。
 */
import { onMounted, onScopeDispose, onUnmounted, watch } from "vue";
import { useRequiredMapContext } from "../context/inject";
import { createLayerRegistry, type LayerRecord, type LayerRegistry } from "../layers/LayerRegistry";
import { nativeLayersOf } from "../layers/nativeLayerAccess";
import { layerInputFingerprint, stableLayerValue } from "../layers/LayerSpec";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { adaptPoints, resolveIdField, type AdaptedPoints } from "../data/geojsonAdapter";
import { itemKeyReader } from "../data/itemScan";
import { createProblemReporter } from "../data/problems";
import { createItemIndex, type ItemIndex } from "../data/itemIndex";
import { BMapError } from "../errors/BMapError";
import { devWarn } from "../logger";
import { readPickValue, type NativePointLayerProfile, type NativePointPickRead } from "../data/pointLayerSpec";
import type { BMapDataProps, BMapPointPick } from "../../types/components";
import type { MapReadyContext } from "../context/types";
import type { NativeLayerHandle, NativeLayerOperation, NativeLayerDriver } from "../../driver/types/native-layers";
import { readPayloadPixel, readPayloadPointLike, type PointLike } from "../data/points";

/** 三个点图层组件共用的 props 面（`properties` 不在 `BMapDataProps` 上，但它三个都有）。 */
export interface NativePointLayerDataProps<Item> extends BMapDataProps<Item> {
  properties?: (item: Item) => Record<string, unknown> | null | undefined;
}

export interface UseNativePointLayerInput<Item, Props extends NativePointLayerDataProps<Item>> {
  /** 该 kind 的声明式 profile（`core/data/pointLayerSpec.ts`）。 */
  readonly profile: NativePointLayerProfile<Props>;
  /** 组件的 props（响应式原始对象；读值一律走它，不缓存快照）。 */
  readonly props: Props;
  /**
   * 触发收敛的 props 列表 —— 由 SFC 自己列。
   *
   * 不在这里硬编码：每个组件的可写字段不同（`BPointLayer` 没有 `opacity` / `zIndex`），
   * 而录进 watch 源但组件上不存在的键会变成 `undefined` 恒等，掩盖真正的漏项。
   */
  readonly watchSource: () => unknown;
  /** 事件出口（SFC 把它接到 `defineEmits`）。 */
  readonly emit: {
    readonly itemClick: (item: Item) => void;
    readonly click: (pick: BMapPointPick<Item>) => void;
  };
}

interface InstanceState {
  handle: NativeLayerHandle;
  /** 本代的 child scope：业务监听挂这里（先解绑、再摘除）。 */
  listenerScope: ResourceScope;
  /** 构造期指纹：变化 ⇒ 换实例。 */
  rebuildKey: string;
  /** 已写入的「可就地更新」字段指纹（**按字段**记账，值没变就不重复写 SDK）。 */
  applied: Map<string, string>;
  /**
   * 最近一次**成功写入** SDK 的样式字段名。
   *
   * 样式是**逐字段 merge**（官方 `setStyleOptions` / `setOptions`），所以「整组 style 还在、
   * 但其中一个字段被撤回」时 SDK 上仍留着旧值——只判「有没有 style 对象」会漏掉这种撤回
   * （#34 评审第一轮的反例：`color: "red" → undefined` 而 `size` 仍是 18）。
   */
  appliedStyleKeys: string[];
  /** 账本记录（`Map` 卸载前摘掉它；换实例时走它的**严格** `detach()`）。登记成功前为 `null`。 */
  record: LayerRecord | null;
}

/**
 * 与 kind 无关、**只读 props** 的字段写入表。
 *
 * 每一项带一个 `NativeLayerOperation`：`supports()` 是「这个 kind 有没有这个入口」的单一事实源
 * （在 Driver 的 `NATIVE_LAYER_DESCRIPTORS` 里），组件侧再抄一份必然与它漂移。不支持的项
 * **不静默跳过**：告警一次并点名缺失的能力（收下一个用不了的 prop 属于假支持）。
 */
type FieldWrite = readonly [field: string, value: unknown, operation: NativeLayerOperation, write: () => void];

const FIELD_OPERATIONS = {
  visible: "setVisible",
  opacity: "setOpacity",
  zIndex: "setZIndex",
  zoomRange: "setZoomRange",
  style: "setStyle",
} as const satisfies Record<string, NativeLayerOperation>;

/** props 里可能出现的「可就地更新」字段（组件不一定都声明，所以按记录读）。 */
interface FieldProps {
  visible?: boolean;
  opacity?: number;
  zIndex?: number;
  minZoom?: number;
  maxZoom?: number;
}

export function useNativePointLayer<Item, Props extends NativePointLayerDataProps<Item>>(
  input: UseNativePointLayerInput<Item, Props>,
): void {
  const { profile, props, emit } = input;
  const ctx = useRequiredMapContext();
  /** 组件作用域：等待就绪 / 卸载竞态的门禁。 */
  const scope = new ResourceScope({ label: profile.label });
  const reports = createProblemReporter(profile.label, (message) => devWarn(message));
  /** key → 最新业务项（拾取回传用；与 DataLayerManager 共用同一份实现）。 */
  const items: ItemIndex<Item> = createItemIndex<Item>();

  let readyCtx: MapReadyContext | null = null;
  /** 当前实例（未就绪 / 已释放时为 null）。 */
  let instance: InstanceState | null = null;
  /** 最近一次送给 SDK 的适配结果（`dataIndex` 兜底解析要用它与 SDK 侧保持同一份数据）。 */
  let lastAdapted: AdaptedPoints<Item> | null = null;
  /** 「这一次构建用的是哪份输入」的指纹（setData 去重用）。 */
  let appliedDataKey = "";
  const warnings = new Set<string>();

  /** 组件自持的账本（自定义 Context 不提供 `layers` 时用，随组件作用域释放）。 */
  const ownRegistry: LayerRegistry = createLayerRegistry();
  const registryOf = (): LayerRegistry => ctx.layers ?? ownRegistry;
  onScopeDispose(() => {
    if (!ctx.layers) ownRegistry.disposeAll();
  });

  const target = (c: MapReadyContext) => ({ kind: "map" as const, handle: c.map });

  /* ------------------------------------------------------------------ 指纹 */

  /** 字段指纹（**按值**比较，函数折叠成 `fn`）。复用仓库里唯一一份「稳定值指纹」。 */
  function fieldFingerprint(value: unknown): string {
    return stableLayerValue(value);
  }

  /**
   * 数据输入指纹：与「送给 SDK 的那一份」比对，值没变就不重复 `setData`。
   *
   * 三条判据**刻意不同**（这里最容易写出「每次渲染都重写一遍」的缺陷）：
   *
   * - `data` 按**引用**（等于不深遍历：整份 FeatureCollection 序列化一次就是 O(n)）；
   * - 函数（`getPosition` / `properties` / 函数式 `itemKey`）按**源码文本**折叠：父级的内联箭头
   *   每次渲染都是新对象、但源码相同 ⇒ 指纹稳定（与逐项 Marker 路径同源）。代价写在文档里：
   *   **换的是闭包里的值**（源码没变）时，请配合 `dataVersion` 表态；
   * - 其余按取值（`dataVersion` / 字符串 `itemKey`）。
   */
  function dataInputKey(): string {
    return [props.data, props.dataVersion, props.itemKey, props.properties, props.getPosition]
      .map(inputFingerprint)
      .join("|");
  }

  /**
   * 输入指纹：函数按**源码文本**折叠、其余按对象身份 —— 直接用仓库里唯一一份实现
   * （`layerInputFingerprint`）。**不要**在这里再写一个：两套编号空间看似等价，
   * 但语义分叉（一个覆盖函数、一个不覆盖）时表现为「同一个值有时判等、有时不判等」，极难定位。
   */
  const inputFingerprint = layerInputFingerprint;

  /* ------------------------------------------------------------------ 适配 */

  function idKey(): string {
    return resolveIdField(props.itemKey);
  }

  /** 业务数据 → FeatureCollection（坏数据跳过并告警；判定与逐项 Marker 路径共用一份）。 */
  function adapt(): AdaptedPoints<Item> {
    return adaptPoints(props.data, {
      itemKey: props.itemKey,
      getPosition: props.getPosition,
      properties: props.properties,
      onProblem: (problem) => reports.report(problem),
    });
  }

  /* ------------------------------------------------------------------ 生命周期 */

  function reportError(error: unknown): void {
    const wrapped =
      error instanceof BMapError ? error : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error });
    ctx.events.emit("resource:error", { error: wrapped, component: profile.label });
  }

  /** 创建 + 挂载 + 首次写入 + 绑事件（**只**在「确定要新建一个实例」时调用）。 */
  function createInstance(c: MapReadyContext): void {
    const nativeLayers = nativeLayersOf(c.client);
    const adapted = adapt();
    lastAdapted = adapted;
    const handle = nativeLayers.create(profile.kind, profile.constructorOptions(props, adapted.idKey));
    const listenerScope = new ResourceScope({ label: `${profile.label}:instance` });
    const state: InstanceState = {
      handle,
      listenerScope,
      rebuildKey: profile.rebuildKey(props, adapted.idKey),
      applied: new Map(),
      appliedStyleKeys: [],
      // 账本记录在下面**先登记再挂载**（任何一步抛错时，卸载路径上一定有一条能摘掉它的记录）
      record: null,
    };

    // 账本先登记：任何一步抛错时，卸载路径上一定有一个「能把它从图上摘掉」的记录。
    state.record = registryOf().register({
      kind: profile.kind,
      handle,
      scope: listenerScope,
      remove: () => {
        // ⚠️ 顺序：**先摘、后销账**。反过来（先清 `instance`）时，一次抛错的 `removeLayer` 会把
        // 记账清成「已经没有实例了」，让之后的重试 / 卸载跳过摘除（资源留在图上没人认领）。
        nativeLayers.remove(target(c), handle);
        if (instance === state) instance = null;
      },
    });
    try {
      nativeLayers.add(target(c), handle);
      // 顺序：先样式 / 显隐 / 层级，**最后**才交付数据 —— 数据一到就渲染，先写到位的字段
      // 才不会让第一帧出现「默认样式闪一下」。
      applyFields(state, c, profile.stylePayload(props as unknown as Props));
      // 传 `adapted` 强制写入首份数据（不依赖指纹是否为空）
      applyData(state, c, adapted);
      bindEvents(state, c);
    } catch (error) {
      state.record?.dispose();
      throw error;
    }
    instance = state;
  }

  /** 释放实例（摘除 SDK 资源 + 解绑业务监听 + 账本销账）。 */
  function disposeInstance(): void {
    const state = instance;
    if (!state) return;
    instance = null;
    state.record?.dispose();
    if (!state.listenerScope.isDisposed) state.listenerScope.dispose(`${profile.label}-released`);
  }

  /**
   * 换实例：**先确认旧实例已经从图上摘掉**，再建新的。
   *
   * 摘除走账本的**严格路径** `record.detach()`（先解绑业务监听 → 摘资源 → 销账），
   * 因此这里既不重复摘除、也不在监听还活着的时候动资源。`removeLayer` 允许「先产生副作用、
   * 再抛错」，所以**摘除失败时必须认为旧实例还在图上**：保留它、交出错误、这一次不更新
   * （宁可这次不更新，也不能出现两份同图）。
   */
  function recreate(c: MapReadyContext): void {
    const old = instance;
    if (old) {
      try {
        // 严格摘除：先解绑业务监听、再摘资源，失败会抛（此时保留旧实例、这次不更新）
        old.record?.detach();
      } catch (error) {
        reportError(error);
        return;
      }
      // 摘除成功 ⇒ 旧实例连同它的监听与账本记录一起作废
      instance = null;
    }
    createInstance(c);
  }

  /**
   * 数据写入（`setData`；输入没变就不写）。
   *
   * **空数据走 `clearData()`**：官方为这类图层提供了 `clearData`（清空数据、保留图层），
   * 一条空 `FeatureCollection` 与「没有数据」在语义上不同 —— 前者要求 SDK 解析并进入一次
   * 无要素的渲染，后者是图层自己的空态。这是本库对 `clearData` 的唯一调用点：数据清空是
   * 唯一有明确语义的时机（卸载走 `removeLayer`，不需要先清数据）。
   */
  function applyData(state: InstanceState, c: MapReadyContext, adapted?: AdaptedPoints<Item>): void {
    // 指纹只算一次（它是「整份数据的引用 + 版本 + 三个取值函数」的拼接，没必要算两遍）
    const key = dataInputKey();
    // 挂载时传 `adapted`（首份数据必须写）；之后按输入指纹去重，值没变就不产生 SDK 调用。
    if (adapted === undefined && key === appliedDataKey && lastAdapted) return;
    const next = adapted ?? adapt();
    lastAdapted = next;
    const readKey = itemKeyReader(props.itemKey);
    items.replace(next.items.map((item) => ({ key: readKey(item), item })));
    const nativeLayers = nativeLayersOf(c.client);
    if (next.data.features.length === 0) nativeLayers.clearData(state.handle);
    else nativeLayers.setData(state.handle, next.data as unknown as Record<string, unknown>);
    appliedDataKey = key;
    reports.flush();
  }

  /**
   * 可就地更新的字段（样式 / 显隐 / 透明度 / 层级 / 缩放范围）：值没变就不写。
   *
   * `undefined` 一律**不写**：它是「不表态」（构造期的默认值由 SDK 自己决定），把 `undefined`
   * 传给 setter 只会让 SDK 收到一个非法值。
   */
  function applyFields(
    state: InstanceState,
    c: MapReadyContext,
    style: Record<string, unknown> | undefined,
  ): void {
    const nativeLayers = nativeLayersOf(c.client);
    const fields = props as unknown as FieldProps;
    const writes: FieldWrite[] = [
      [
        "visible",
        fields.visible,
        FIELD_OPERATIONS.visible,
        () => nativeLayers.setVisible(state.handle, fields.visible as boolean),
      ],
      [
        "opacity",
        fields.opacity,
        FIELD_OPERATIONS.opacity,
        () => nativeLayers.setOpacity(state.handle, fields.opacity as number),
      ],
      // 层级必须**挂载之后**写（官方：层级调整会访问已关联的 Map 与图层管理器）
      [
        "zIndex",
        fields.zIndex,
        FIELD_OPERATIONS.zIndex,
        () => nativeLayers.setZIndex(state.handle, fields.zIndex as number),
      ],
      [
        "zoomRange",
        fields.minZoom === undefined && fields.maxZoom === undefined
          ? undefined
          : `${fields.minZoom}/${fields.maxZoom}`,
        FIELD_OPERATIONS.zoomRange,
        () => nativeLayers.setZoomRange(state.handle, { min: fields.minZoom, max: fields.maxZoom }),
      ],
      ["style", style, FIELD_OPERATIONS.style, () => nativeLayers.setStyle(state.handle, style as Record<string, unknown>)],
    ];

    for (const [field, value, operation, write] of writes) {
      if (value === undefined) continue;
      if (!assertFieldSupported(nativeLayers, field, operation)) continue;
      const fingerprint = fieldFingerprint(value);
      if (state.applied.get(field) === fingerprint) continue;
      // 指纹**先失效**再调用：一次「已经写进去、然后抛错」的调用会让旧指纹不再代表 SDK 的当前值。
      state.applied.delete(field);
      write();
      state.applied.set(field, fingerprint);
      // 样式另记一份**字段名清单**：样式是 merge，撤回单个字段要在下一次同步时被发现
      if (field === "style") state.appliedStyleKeys = Object.keys(style ?? {});
    }
  }

  /**
   * 「这个 kind 有没有这个字段的入口」——问 Driver，**不猜**。
   *
   * 收下了一个用不了的 prop 却什么都不做，是最难排查的一类问题；这里告警一次并点名缺失的
   * 能力（提示语里带上 kind，因为用户无从知道 `BPointLayer` 背后是扩展 API）。
   */
  function assertFieldSupported(
    nativeLayers: NativeLayerDriver,
    field: string,
    operation: NativeLayerOperation,
  ): boolean {
    if (nativeLayers.supports(profile.kind, operation)) return true;
    warnOnce(
      `unsupported:${operation}`,
      `${field} 在 ${profile.kind} 上没有就地写入的入口（官方 4.0 的该类不公开 ${operation}），` +
        "本次改动静默不生效——本库不把它悄悄降级成别的调用",
    );
    return false;
  }

  /**
   * 「曾经写过、现在变回未表态」的字段。
   *
   * 官方这批图层**没有 unset 入口**（官方只提供各字段的 setter），所以「用户把 `opacity` 撤回
   * `undefined`」在 SDK 侧无法表达。本库的口径：**不猜默认值，重建实例**，让它回到 SDK 自己的
   * 默认状态（并告警一次——静默保留旧值会让声明与画面分叉）。
   *
   * **样式要逐字段判**：样式是 merge，只要还有任何一个样式字段在，整组就不算撤回 ——
   * 而被撤回的那个字段仍留在 SDK 上。
   *
   * 判定与执行分开（判出来就不要再执行就地写入）：这一步要在 `applyFields` **之前**跑。
   */
  function detectRemovedFields(state: InstanceState, style: Record<string, unknown> | undefined): string[] {
    const fields = props as unknown as FieldProps;
    // 只看「这一项还有没有表态」，不比取值：指纹是「值」的标识，这里问的是「在不在」。
    const present: Record<string, boolean> = {
      opacity: fields.opacity !== undefined,
      zIndex: fields.zIndex !== undefined,
      zoomRange: fields.minZoom !== undefined || fields.maxZoom !== undefined,
      style: style !== undefined,
      // `visible` 有默认值（`true`），永远不会变回未表态
      visible: true,
    };
    const removed = [...state.applied.keys()].filter((field) => present[field] !== true);
    // 样式**逐字段**判：整组还在、但某个字段被撤回时，SDK 上（merge 语义）仍留着旧值
    const currentStyleKeys = new Set(Object.keys(style ?? {}));
    for (const key of state.appliedStyleKeys) {
      if (!currentStyleKeys.has(key)) removed.push(`style.${key}`);
    }
    return removed;
  }

  /**
   * 绑定图层级事件。
   *
   * 官方这批图层只派发 `dataparsed` / `mousemove` / `click` / `dblclick` / `rightclick`
   * （`NormalLayerEventMap`）——**没有** mouseover / mouseout，所以这里只订阅 `click`。
   */
  function bindEvents(state: InstanceState, c: MapReadyContext): void {
    state.listenerScope.add(c.client.driver.events.on(state.handle, "click", (event) => handlePick(event)));
  }

  /** 拾取载荷 → 业务项，并派发两个事件。 */
  function handlePick(event: unknown): void {
    const read = profile.readPick(readPickValue(event), idKey());
    const item = resolveItem(read);
    const shape = (event ?? {}) as { point?: unknown; pixel?: unknown; raw?: { latLng?: unknown; pixel?: unknown } };
    emit.click({
      hit: read.hit,
      dataIndex: read.dataIndex,
      item: item ?? null,
      latLng: readPayloadPointLike(shape.point) ?? readPayloadPointLike(shape.raw?.latLng),
      pixel: readPayloadPixel(shape.pixel) ?? readPayloadPixel(shape.raw?.pixel),
    });
    // falsy 业务项（`0` / `false` / `""`）也是「命中了」，必须派发（#34 评审 F4）
    if (item !== undefined) emit.itemClick(item);
  }

  /**
   * 命中读数 → 业务项。
   *
   * ⚠️ 判「找没找到」**必须用 `!== undefined`**：公开泛型没有把 `Item` 约束成 object，因此
   * `0` / `false` / `""` 都是合法业务项（配函数式 `itemKey` / `getPosition` 即可）。用真值判断
   * 会把它们当成「没找到」，于是 `click.item` 变成 null 且不派发 `item-click`。
   */
  function resolveItem(read: NativePointPickRead): Item | undefined {
    if (!read.hit) return undefined;
    if (read.key !== undefined) {
      const latest = items.latest(read.key);
      if (latest !== undefined) return latest;
    }
    // 兜底：命中载荷的形状在类型层只是 `object`，读不到身份时用要素下标对回我们自己送出去的那份数据。
    const adapted = lastAdapted;
    if (adapted && read.dataIndex >= 0) {
      const feature = adapted.data.features[read.dataIndex];
      const fallbackKey = feature?.properties[adapted.idKey];
      if (typeof fallbackKey === "string" || typeof fallbackKey === "number" || typeof fallbackKey === "symbol") {
        const latest = items.latest(fallbackKey);
        if (latest !== undefined) return latest;
      }
    }
    warnOnce(
      "pick-unresolved",
      `命中了要素（dataIndex=${read.dataIndex}）但取不到业务项：` +
        "要素身份来自 feature.properties[idKey]，若数据在本次点击之前刚被替换过，这一帧可能已经过期",
    );
    return undefined;
  }

  function warnOnce(key: string, message: string): void {
    if (warnings.has(key)) return;
    warnings.add(key);
    devWarn(`[${profile.label}] ${message}`);
  }

  /* ------------------------------------------------------------------ 装配 */

  /** 每次 props 变化后的收敛：不重建就就地写，构造期项变了就换实例。 */
  function sync(): void {
    const c = readyCtx;
    if (!c) return; // 还没就绪：创建时会读到最新的 props
    const state = instance;
    if (!state) {
      try {
        createInstance(c);
      } catch (error) {
        reportError(error);
      }
      return;
    }
    if (state.rebuildKey !== profile.rebuildKey(props, idKey())) {
      try {
        recreate(c);
      } catch (error) {
        reportError(error);
      }
      return;
    }
    // **先判定、后执行**：一旦确定要重建（有字段变回未表态），就不再执行就地写入——
    // 否则同一次更新里的一步 SDK 异常会把这个已经确定的收敛挡掉，而 props 已稳定、不会再来一次。
    const style = profile.stylePayload(props as unknown as Props);
    const removed = detectRemovedFields(state, style);
    if (removed.length > 0) {
      devWarn(
        `[${profile.label}] ${removed.join(" / ")} 由有值变为未表态：SDK 没有 unset 入口，` +
          "本库不猜默认值 ⇒ 重建图层，让它回到 SDK 自己的默认状态",
      );
      try {
        recreate(c);
      } catch (error) {
        reportError(error);
      }
      return;
    }
    // 逐步隔离：一步失败不该吞掉同一次更新里的其它步骤（各自上报）
    try {
      applyData(state, c);
    } catch (error) {
      reportError(error);
    }
    try {
      applyFields(state, c, style);
    } catch (error) {
      reportError(error);
    }
  }

  onMounted(async () => {
    const c = await ctx.whenReady(scope.signal);
    if (scope.isDisposed) return;
    readyCtx = c;
    sync();
  });

  onUnmounted(() => {
    disposeInstance();
    items.clear();
    lastAdapted = null;
    warnings.clear();
    readyCtx = null;
    scope.dispose();
  });

  watch(input.watchSource, () => sync(), { deep: false, flush: "sync" });
}