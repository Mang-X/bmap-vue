<script setup lang="ts" generic="Item">
/**
 * BPointCollection —— 批量点（**单个** SDK 资源，M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * ## 为什么不是「一个点一个 Marker」
 *
 * v4 的原生批量点图层（官方 `BMap.PointShapeLayer`）用**一个**图层实例承载成千上万个点：
 * `setData(FeatureCollection)` 一次性交付，渲染在 SDK 内部完成。逐项建 Marker 的成本随数据量
 * 线性增长（每个 marker 都是 DOM/WebGL 对象 + 监听器），这正是本组件存在的理由——
 * 验收标准「资源数量证明 PointCollection 不是逐点 Marker」由用例断言
 * （`harness.attached('overlay') === 0` 且原生图层恰好 1 个）。
 *
 * ## 名字的来历（`PointCollection` 在 4.0 的真实状态）
 *
 * v3 的 `BMap.PointCollection` 类在 4.0 的**类型包**（`@baidumap/jsapi-v4-types@4.0.4`）里
 * **没有声明**；官方 React 组件库 `huiyan-fe/react-bmap` 把它标成「整体 @removed 4.0，仅 v3 可用」。
 * 但**运行时它仍然存在**：本库的探针（`scripts/probe-point-pick.mts`，真实 AK + headless Chrome）
 * 实测 `typeof BMap.PointCollection === "function"`（与 `Marker3D` / `MapMask` 同属「运行时存在但
 * 无声明」，见 ADR `2026-09-11-jsapi-v4-overlay-facet` 的 smoke 表）。
 *
 * 本组件**不**用它：official-first 的判据是「两处都声明的等价 API」，而 4.0 的批量点专页是
 * `PointShapeLayer` / `PointIconLayer`（声明完整、数据 / 样式 / 状态 / 拾取面齐备）。因此
 * 名字里的「Collection」表达的是**业务语义**（一批点），不是「v3 那个类的包装」。
 *
 * ## 数据面（与 `BMarkerList` 一致，可平移）
 *
 * `data` + `itemKey` + `getPosition` + `dataVersion`；`properties` 额外映射属性。
 * 适配（idKey、坐标校验、重复 key、坏数据跳过）在 `core/data/geojsonAdapter.ts`，与逐项 Marker
 * 路径**共用同一份判定**（`core/data/itemScan.ts`）。
 *
 * ## 更新语义（四条路径，逐条对应官方入口）
 *
 * | 变化 | 路径 | 依据（官方 4.0.4 声明） |
 * | --- | --- | --- |
 * | `data` / `dataVersion` / `properties` | `setData()`，**不重建** | `PointShapeLayer#setData` |
 * | `shape` / `size` / `color` / `strokeColor` / `strokeWeight` | `setStyleOptions + doOnceDraw`（Driver 的 `setStyle`），**不重建** | `setStyleOptions` 是 merge；官方明确「修改后需 `doOnceDraw()` 才可见」 |
 * | `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter，**不重建** | `setVisible` / `setOpacity` / `setZIndex` / `setMinZoom` / `setMaxZoom` |
 * | `itemKey`（⇒ `idKey`）/ `enablePicked` / `pickWidth` / `pickHeight` | **重建实例** | 它们是构造选项；官方只有 `setBaseOptions`（整袋、且需 `doOnceDraw`）。「改了就换实例」比「写进去但画面不变」诚实 |
 *
 * 与图层组件（#40）的两处**刻意不同**：
 *
 * - **`visible` 走 `setVisible(false)`，不是「摘掉图层」**：官方在原生数据图层上**有**这个
 *   setter，而且 #98 的 live 实测显示 `removeLayer` 之后的实例**再也渲染不了**（只能换新实例）。
 *   用 setter 既准确（隐藏 ≠ 释放数据）又便宜。
 * - **重建必须「先摘成功、再建新的」**：`removeLayer` 失败时保留旧实例并交出 `resource:error`，
 *   否则新旧两份会同时挂在图上（同一实例 `addLayer` 不去重）。
 *
 * ## 生命周期
 *
 * 实例登记进该地图的图层账本（`MapContext.layers`），因此 `MapRuntime.dispose()` 会在
 * `map.destroy()` **之前**摘掉它（与底图图层同一条不变式）；业务监听挂在实例 child scope 上，
 * 释放顺序是「先解绑业务监听、再由 Map 摘除资源」。
 */
import { onMounted, onScopeDispose, onUnmounted, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { createLayerRegistry, type LayerRegistry } from "../../core/layers/LayerRegistry";
import { nativeLayersOf } from "../../core/layers/nativeLayerAccess";
import { layerDataIdentity, stableLayerValue } from "../../core/layers/LayerSpec";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { adaptPoints, resolveIdField, type AdaptedPoints } from "../../core/data/geojsonAdapter";
import { itemKeyReader } from "../../core/data/itemScan";
import { createProblemReporter } from "../../core/data/problems";
import { createItemIndex, type ItemIndex } from "../../core/data/itemIndex";
import { BMapError } from "../../core/errors/BMapError";
import { devWarn } from "../../core/logger";
import type { BMapPointPick, BPointCollectionProps } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";
import type { NativeLayerHandle } from "../../driver/types/native-layers";
import type { PointLike } from "../../core/data/points";

/** 本组件落地的原生图层种类（v4 的「几何点」批量图层）。 */
const LAYER_KIND = "point-shape" as const;

const props = withDefaults(defineProps<BPointCollectionProps<Item>>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：本组件的核心交互是 `item-click`，
  // 默认关掉拾取等于「给了事件但点不出来」。要省开销时显式传 `false`。
  enablePicked: true,
});

const emit = defineEmits<{
  /** 命中某个要素：载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
  /** 图层级拾取（含未命中）：`hit` / 坐标 / 像素 / 解析到的业务项。 */
  click: [pick: BMapPointPick<Item>];
}>();

const ctx = useRequiredMapContext();
/** 组件作用域：等待就绪 / 卸载竞态的门禁。 */
const scope = new ResourceScope({ label: "BPointCollection" });
const reports = createProblemReporter("BPointCollection", (message) => devWarn(message));
/** key → 最新业务项（拾取回传用；与 DataLayerManager 共用同一份实现）。 */
const items: ItemIndex<Item> = createItemIndex<Item>();

let readyCtx: MapReadyContext | null = null;
/** 当前实例（未就绪 / 已释放时为 null）。 */
let instance: InstanceState | null = null;
/** 最近一次送给 SDK 的适配结果（`dataIndex` 兜底解析要用它与 SDK 侧保持同一份数据）。 */
let lastAdapted: AdaptedPoints<Item> | null = null;
/** 「这一次构建用的是哪份输入」的指纹（setData 去重用）。 */
let appliedDataKey = "";

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
   * 样式是**逐字段 merge**（官方 `setStyleOptions`），所以「整组 style 还在、但其中一个字段被撤回」
   * 时 SDK 上仍留着旧值——只判「有没有 style 对象」会漏掉这种撤回（评审第一轮的反例：
   * `color: "red" → undefined` 而 `size` 仍是 18）。有了这份字段名清单，撤回任何一个都能被发现。
   */
  appliedStyleKeys: string[];
  /** 账本记录（`Map` 卸载前摘掉它）。 */
  record: { dispose(): void };
}

/** 组件自持的账本（自定义 Context 不提供 `layers` 时用，随组件作用域释放）。 */
const ownRegistry: LayerRegistry = createLayerRegistry();
const registryOf = (): LayerRegistry => ctx.layers ?? ownRegistry;
onScopeDispose(() => {
  if (!ctx.layers) ownRegistry.disposeAll();
});

const target = (c: MapReadyContext) => ({ kind: "map" as const, handle: c.map });

/* ------------------------------------------------------------------ 指纹 */

/** 构造期指纹：决定「要不要换实例」。 */
function rebuildKey(): string {
  return [LAYER_KIND, resolveIdField(props.itemKey), props.enablePicked, props.pickWidth, props.pickHeight].join(
    "|",
  );
}

/**
 * 数据输入指纹：与「送给 SDK 的那一份」比对，值没变就不重复 `setData`。
 *
 * 三条判据**刻意不同**（这里最容易写出「每次渲染都重写一遍」的缺陷）：
 *
 * - `data` 按**引用**（等于不深遍历：整份 FeatureCollection 序列化一次就是 O(n)）；
 * - 函数（`getPosition` / `properties` / 函数式 `itemKey`）按**源码文本**折叠：父级的内联箭头
 *   每次渲染都是新对象、但源码相同 ⇒ 指纹稳定（这与图层内核「内联箭头不触发重建」同源）。
 *   代价写在文档里：**换的是闭包里的值**（源码没变）时，请配合 `dataVersion` 表态；
 * - 其余按取值（`dataVersion` / 字符串 `itemKey`）。
 */
function dataInputKey(): string {
  return [props.data, props.dataVersion, props.itemKey, props.properties, props.getPosition]
    .map(inputFingerprint)
    .join("|");
}

/**
 * 输入指纹：函数按**源码文本**折叠（内联箭头每次渲染都是新对象、但源码相同 ⇒ 稳定），
 * 其余走 `core/layers/LayerSpec.ts` 的 `layerDataIdentity`（对象 ⇒ 稳定编号，原始值 ⇒ 取值）。
 *
 * `layerDataIdentity` 是仓库里唯一一份「对象引用身份」实现；**不要**在这里再写一个 WeakMap
 * 计数器：两套编号空间看似等价，但语义分叉（一个覆盖函数、一个不覆盖）时表现为「同一个值
 * 有时判等、有时不判等」，极难定位。
 */
function inputFingerprint(value: unknown): string {
  if (typeof value === "function") return `fn:${String(value)}`;
  return layerDataIdentity(value);
}

/**
 * 字段指纹（**按值**比较，函数折叠成 `fn`）。
 *
 * 直接用 `core/layers/LayerSpec` 的 `stableLayerValue`：它是仓库里唯一一份「稳定值指纹」实现
 * （键排序、函数折叠、DOM/类实例折叠），再写一份必然与它分叉。**不能**按对象引用比较——
 * `styleValue()` 每次都返回新对象，按引用会让样式在每次 props 变化时都被重写。
 */
function fieldFingerprint(value: unknown): string {
  return stableLayerValue(value);
}

/* ------------------------------------------------------------------ 适配 */

/** 业务数据 → FeatureCollection（坏数据跳过并告警；同一份判定也服务逐项 Marker 路径）。 */
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
  ctx.events.emit("resource:error", { error: wrapped, component: "BPointCollection" });
}

/** 创建 + 挂载 + 首次写入 + 绑事件（**只**在「确定要新建一个实例」时调用）。 */
function createInstance(c: MapReadyContext): InstanceState {
  const nativeLayers = nativeLayersOf(c.client);
  const adapted = adapt();
  lastAdapted = adapted;
  const handle = nativeLayers.create(LAYER_KIND, {
    idKey: adapted.idKey,
    // 官方默认 false；本组件的默认值在 props 那一层（见 withDefaults）。
    enablePicked: props.enablePicked,
    ...(props.pickWidth === undefined ? {} : { pickWidth: props.pickWidth }),
    ...(props.pickHeight === undefined ? {} : { pickHeight: props.pickHeight }),
  });
  const listenerScope = new ResourceScope({ label: "point-collection:instance" });
  const state: InstanceState = {
    handle,
    listenerScope,
    rebuildKey: rebuildKey(),
    applied: new Map(),
    appliedStyleKeys: [],
    record: { dispose: () => {} },
  };

  // 账本先登记：任何一步抛错时，卸载路径上一定有一个「能把它从图上摘掉」的记录。
  state.record = registryOf().register({
    kind: LAYER_KIND,
    handle,
    scope: listenerScope,
    remove: () => {
      if (instance === state) instance = null;
      nativeLayers.remove(target(c), handle);
    },
  });
  try {
    nativeLayers.add(target(c), handle);
    // 顺序：先样式 / 显隐 / 层级，**最后**才交付数据 —— 数据一到就渲染，先写到位的字段
    // 才不会让第一帧出现「默认样式闪一下」。
    applyFields(state, c, styleValue());
    // 传 `adapted` 强制写入首份数据（不依赖指纹是否为空）
    applyData(state, c, adapted);
    bindEvents(state, c);
  } catch (error) {
    state.record.dispose();
    throw error;
  }
  instance = state;
  return state;
}

/** 释放实例（摘除 SDK 资源 + 解绑业务监听 + 账本销账）。 */
function disposeInstance(): void {
  const state = instance;
  if (!state) return;
  instance = null;
  state.record.dispose();
  if (!state.listenerScope.isDisposed) state.listenerScope.dispose("point-collection-released");
}

/**
 * 换实例：**先确认旧实例已经从图上摘掉**，再建新的。
 *
 * `removeLayer` 允许「先产生副作用、再抛错」，因此摘除失败时无法判断旧实例是否还在图上；
 * 此时**保留旧实例并交出错误**（宁可这一次不更新，也不能出现两份同图——那会更难收拾）。
 */
function recreate(c: MapReadyContext): void {
  const old = instance;
  if (old) {
    try {
      nativeLayersOf(c.client).remove(target(c), old.handle);
    } catch (error) {
      reportError(error);
      return;
    }
    // 摘除成功 ⇒ 旧实例连同它的监听与账本记录一起作废
    old.record.dispose();
    if (!old.listenerScope.isDisposed) old.listenerScope.dispose("point-collection-recreated");
    instance = null;
  }
  createInstance(c);
}

/** 数据写入（`setData`；输入没变就不写）。 */
function applyData(state: InstanceState, c: MapReadyContext, adapted?: AdaptedPoints<Item>): void {
  // 指纹只算一次（它是「整份数据的引用 + 版本 + 三个取值函数」的拼接，没必要算两遍）
  const key = dataInputKey();
  // 挂载时传 `adapted`（首份数据必须写）；之后按输入指纹去重，值没变就不产生 SDK 调用。
  if (adapted === undefined && key === appliedDataKey && lastAdapted) return;
  const next = adapted ?? adapt();
  lastAdapted = next;
  const readKey = itemKeyReader(props.itemKey);
  items.replace(next.items.map((item) => ({ key: readKey(item), item })));
  nativeLayersOf(c.client).setData(state.handle, next.data as unknown as Record<string, unknown>);
  appliedDataKey = key;
  reports.flush();
}

/**
 * 可就地更新的字段（样式 / 显隐 / 透明度 / 层级 / 缩放范围）：值没变就不写。
 *
 * `undefined` 一律**不写**：它是「不表态」（构造期的默认值由 SDK 自己决定），把 `undefined`
 * 传给 setter 只会让 SDK 收到一个非法值。
 */
function applyFields(state: InstanceState, c: MapReadyContext, style: Record<string, unknown> | undefined): void {
  const nativeLayers = nativeLayersOf(c.client);
  const writes: Array<[string, unknown, () => void]> = [
    ["visible", props.visible, () => nativeLayers.setVisible(state.handle, props.visible)],
    ["opacity", props.opacity, () => nativeLayers.setOpacity(state.handle, props.opacity as number)],
    // 层级必须**挂载之后**写（官方：层级调整会访问已关联的 Map 与图层管理器）
    ["zIndex", props.zIndex, () => nativeLayers.setZIndex(state.handle, props.zIndex as number)],
    [
      "zoomRange",
      props.minZoom === undefined && props.maxZoom === undefined ? undefined : `${props.minZoom}/${props.maxZoom}`,
      () => nativeLayers.setZoomRange(state.handle, { min: props.minZoom, max: props.maxZoom }),
    ],
    ["style", style, () => nativeLayers.setStyle(state.handle, style as Record<string, unknown>)],
  ];

  for (const [field, value, write] of writes) {
    if (value === undefined) continue;
    const fingerprint = fieldFingerprint(value);
    if (state.applied.get(field) === fingerprint) continue;
    // 指纹**先失效**再调用：一次「已经写进去、然后抛错」的调用会让旧指纹不再代表 SDK 的当前值。
    state.applied.delete(field);
    write();
    state.applied.set(field, fingerprint);
    // 样式另记一份**字段名清单**：`setStyleOptions` 是 merge，撤回单个字段要在下一次同步时被发现
    if (field === "style") state.appliedStyleKeys = Object.keys(style ?? {});
  }
}

/**
 * 「曾经写过、现在变回未表态」的字段。
 *
 * 官方这批图层**没有 unset 入口**（官方只提供各字段的 setter），所以「用户把 `opacity` 撤回
 * `undefined`」在 SDK 侧无法表达。本库的口径与图层内核一致：**不猜默认值，重建实例**，让它回到
 * SDK 自己的默认状态（并告警一次——静默保留旧值会让声明与画面分叉）。
 *
 * **样式要逐字段判**：`setStyleOptions` 是 merge，只要还有任何一个样式字段在，整组就不算撤回——
 * 而被撤回的那个字段仍留在 SDK 上（评审第一轮的反例：`color` 撤回而 `size` 还在）。
 *
 * 判定与执行分开（判出来就不要再执行就地写入）：这一步要在 `applyFields` **之前**跑。
 */
function detectRemovedFields(state: InstanceState, style: Record<string, unknown> | undefined): string[] {
  // 只看「这一项还有没有表态」，不比取值：指纹是「值」的标识，这里问的是「在不在」。
  const present: Record<string, boolean> = {
    opacity: props.opacity !== undefined,
    zIndex: props.zIndex !== undefined,
    zoomRange: props.minZoom !== undefined || props.maxZoom !== undefined,
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

/** 样式对象（只包含**有表态**的字段：`undefined` 不进 SDK，避免把官方默认值盖成 undefined）。 */
function styleValue(): Record<string, unknown> | undefined {
  const style: Record<string, unknown> = {};
  if (props.shape !== undefined) style.shapeType = props.shape;
  if (props.size !== undefined) style.size = props.size;
  if (props.color !== undefined) style.color = props.color;
  if (props.strokeColor !== undefined) style.strokeColor = props.strokeColor;
  if (props.strokeWeight !== undefined) style.strokeWeight = props.strokeWeight;
  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * 绑定图层级事件。
 *
 * 官方这批图层只派发 `dataparsed` / `mousemove` / `click` / `dblclick` / `rightclick`
 * （`NormalLayerEventMap`）——**没有** mouseover / mouseout，所以本组件不声明它们。
 */
function bindEvents(state: InstanceState, c: MapReadyContext): void {
  const events = c.client.driver.events;
  state.listenerScope.add(events.on(state.handle, "click", (event) => handlePick(event)));
}

/** 拾取载荷 → 业务项。形状依据见函数内注释。 */
function handlePick(event: unknown): void {
  const payload = readPick(event);
  const item = resolveItem(payload);
  const pick: BMapPointPick<Item> = {
    hit: payload.hit,
    dataIndex: payload.dataIndex,
    item: item ?? null,
    latLng: payload.latLng,
    pixel: payload.pixel,
  };
  emit("click", pick);
  if (item) emit("item-click", item);
}

interface ReadPick {
  hit: boolean;
  dataIndex: number;
  /** 命中的要素身份（从 `value.dataItem.properties[idKey]` 取回，取不到时为 `undefined`）。 */
  key: PropertyKey | undefined;
  latLng: PointLike | null;
  pixel: { x: number; y: number } | null;
}

/**
 * 读官方拾取事件。
 *
 * 形状依据 = 官方 4.0 的 `NormalLayerPickEvent`（`.d.ts`：`pixel` / `latLng` / `value: object`）
 * ＋ 官方 Skill 的批量图层专页（`event.value.dataItem.properties.id` 取业务键）：
 *
 * - **未命中也派发事件**，且 `event.value` 是 `{ dataIndex: -1, dataItem: undefined }`（真值）
 *   ⇒ 必须用 `dataIndex !== -1` 判命中，`if (event.value)` 是错的；
 * - `value` 在 `.d.ts` 里只声明成 `object`，字段是运行时约定 ⇒ 这里做结构化读取，
 *   读不到就按「未命中」处理并告警一次（不静默猜一个业务项出来）。
 *
 * ⚠️ 回调拿到的是 **Driver 归一化后的 `DriverEvent`**，不是 raw 事件：`value` 这类
 * facet 独有的字段不在归一化面里，因此这里从 `raw` 逃生口读 `value`，而坐标 / 像素用
 * 归一化后的 `point` / `pixel`（`events.ts` 公开契约：`raw` 就是「访问未归一化字段」的入口）。
 */
function readPick(event: unknown): ReadPick {
  const normalized = (event ?? {}) as {
    raw?: unknown;
    point?: unknown;
    pixel?: unknown;
  };
  const raw = (normalized.raw ?? event) as { value?: unknown; latLng?: unknown; pixel?: unknown };
  const value = raw?.value as { dataIndex?: unknown; dataItem?: unknown } | undefined;
  const dataIndex = typeof value?.dataIndex === "number" ? value.dataIndex : -1;
  const properties = (value?.dataItem as { properties?: Record<string, unknown> } | undefined)?.properties;
  const adapted = lastAdapted;
  let key: PropertyKey | undefined;
  if (properties && adapted) {
    const candidate = properties[adapted.idKey];
    if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "symbol") {
      key = candidate;
    }
  }
  return {
    hit: dataIndex !== -1,
    dataIndex,
    key,
    latLng: readPoint(normalized.point) ?? readPoint(raw?.latLng),
    pixel: readPixel(normalized.pixel) ?? readPixel(raw?.pixel),
  };
}

/** 逗号前后分别是「命中的是哪个业务项」与「找不到时的兜底」。 */
function resolveItem(payload: ReadPick): Item | undefined {
  if (!payload.hit) return undefined;
  if (payload.key !== undefined) {
    const latest = items.latest(payload.key);
    if (latest) return latest;
  }
  // 兜底：`value` 的形状在类型层只是 `object`，读不到身份时用 dataIndex 对回我们自己送出去的那份数据。
  const feature = lastAdapted?.data.features[payload.dataIndex];
  const fallbackKey = feature?.properties[lastAdapted?.idKey ?? ""];
  if (typeof fallbackKey === "string" || typeof fallbackKey === "number" || typeof fallbackKey === "symbol") {
    const latest = items.latest(fallbackKey);
    if (latest) return latest;
  }
  warnOnce(
    "pick-unresolved",
    `命中了要素（dataIndex=${payload.dataIndex}）但取不到业务项：` +
      "要素身份来自 feature.properties[idKey]，若数据在本次点击之前刚被替换过，这一帧可能已经过期",
  );
  return undefined;
}

const warnings = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnings.has(key)) return;
  warnings.add(key);
  devWarn(`[BPointCollection] ${message}`);
}

function readPoint(value: unknown): PointLike | null {
  if (value === null || typeof value !== "object") return null;
  const { lng, lat } = value as { lng?: unknown; lat?: unknown };
  return typeof lng === "number" && typeof lat === "number" ? { lng, lat } : null;
}

function readPixel(value: unknown): { x: number; y: number } | null {
  if (value === null || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
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
  if (state.rebuildKey !== rebuildKey()) {
    try {
      recreate(c);
    } catch (error) {
      reportError(error);
    }
    return;
  }
  // **先判定、后执行**：一旦确定要重建（有字段变回未表态），就不再执行就地写入——
  // 否则同一次更新里的一步 SDK 异常会把这个已经确定的收敛挡掉，而 props 已稳定、不会再来一次。
  const style = styleValue();
  const removed = detectRemovedFields(state, style);
  if (removed.length > 0) {
    devWarn(
      `[BPointCollection] ${removed.join(" / ")} 由有值变为未表态：SDK 没有 unset 入口，` +
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

watch(
  () => [
    props.data,
    props.dataVersion,
    props.properties,
    props.getPosition,
    props.itemKey,
    props.visible,
    props.opacity,
    props.zIndex,
    props.minZoom,
    props.maxZoom,
    props.shape,
    props.size,
    props.color,
    props.strokeColor,
    props.strokeWeight,
    props.enablePicked,
    props.pickWidth,
    props.pickHeight,
  ],
  () => sync(),
  { deep: false, flush: "sync" },
);

defineOptions({ name: "BPointCollection" });
</script>

<template>
  <slot />
</template>
