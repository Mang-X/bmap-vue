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
 * ## 生命周期
 *
 * 实例的创建 / 重建 / 字段写入 / 释放全部交给 `useNativeLayerResource`（#36 抽出的共享内核，
 * 五个原生数据图层共用一份实现）。本组件只声明三件事：构造期选项、样式袋、数据载荷，以及事件。
 *
 * 与底图图层组件（#40）的两处**刻意不同**（都由内核按 `supports()` 决定）：
 *
 * - **`visible` 走 `setVisible(false)`，不是「摘掉图层」**：官方在原生数据图层上**有**这个
 *   setter，而且 #98 的 live 实测显示 `removeLayer` 之后的实例**再也渲染不了**（只能换新实例）。
 *   用 setter 既准确（隐藏 ≠ 释放数据）又便宜。
 * - **重建必须「先摘成功、再建新的」**：内核在摘除失败时保留旧实例并交出 `resource:error`，
 *   否则新旧两份会同时挂在图上（同一个实例 `addLayer` 不去重）。
 */
import { onUnmounted } from "vue";
import { createDevWarnOnce, devWarn } from "../../core/logger";
import { useNativeLayerResource } from "../../core/composables/useNativeLayerResource";
import { layerDataIdentity, stableLayerValue } from "../../core/layers/LayerSpec";
import { resolveFeaturePick } from "../../core/layers/nativeLayerPick";
import { projectLayerStyle } from "../../core/layers/nativeLayerStyle";
import { adaptPoints, resolveIdField, type AdaptedPoints } from "../../core/data/geojsonAdapter";
import { itemKeyReader } from "../../core/data/itemScan";
import { createProblemReporter } from "../../core/data/problems";
import { createItemIndex, type ItemIndex } from "../../core/data/itemIndex";
import type { BMapPointPick, BPointCollectionProps } from "../../types/components";
import type { NativeLayerKind } from "../../driver/types/native-layers";

/** 本组件落地的原生图层种类（v4 的「几何点」批量图层）。 */
const LAYER_KIND: NativeLayerKind = "point-shape";

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

const warnOnce = createDevWarnOnce();
/**
 * 数据问题按**原因**聚合上报（`createProblemReporter` 自己就是去重的：同一原因只报一次，
 * 之后只在计数增长时补一条）。这里**不能**再套一层按 key 去重——那会把两条不同原因压成一条。
 */
const reports = createProblemReporter("BPointCollection", (message) => devWarn(message));
/** key → 最新业务项（拾取回传用；与 DataLayerManager 共用同一份实现）。 */
const items: ItemIndex<Item> = createItemIndex<Item>();
/** 最近一次适配结果（`idKey` 与「我们送出去的那份数据」都由它给出）。 */
let lastAdapted: AdaptedPoints<Item> | null = null;

/* ------------------------------------------------------------------ 指纹 */

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
function dataKey(): string {
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
 * 适配业务数据 → `FeatureCollection`（坏数据跳过并告警；同一份判定也服务逐项 Marker 路径）。
 *
 * 只在**输入指纹变化**时被内核调用（见 `NativeLayerDataHooks.key` 的契约），因此这里是 O(n)
 * 也不影响「父级重渲染」的开销。
 */
function adapt(): AdaptedPoints<Item> {
  const adapted = adaptPoints(props.data, {
    itemKey: props.itemKey,
    getPosition: props.getPosition,
    properties: props.properties,
    onProblem: (problem) => reports.report(problem),
  });
  lastAdapted = adapted;
  const readKey = itemKeyReader(props.itemKey);
  items.replace(adapted.items.map((item) => ({ key: readKey(item), item })));
  reports.flush();
  return adapted;
}

/* ------------------------------------------------------------------ 装配 */

/** 构造期选项袋（官方构造参数里不能就地更新的那些）。 */
function ctorOptions(p: Readonly<BPointCollectionProps<Item>>): Record<string, unknown> {
  return {
    idKey: resolveIdField(p.itemKey),
    enablePicked: p.enablePicked,
    ...(p.pickWidth === undefined ? {} : { pickWidth: p.pickWidth }),
    ...(p.pickHeight === undefined ? {} : { pickHeight: p.pickHeight }),
  };
}

const resource = useNativeLayerResource<BPointCollectionProps<Item>>(props, {
  component: "BPointCollection",
  kind: LAYER_KIND,
  ctorOptions,
  // 重建指纹**派生自选项袋**（与 `useVisualLayer` 同一条口径）：新增构造期 prop 时不会漏进指纹
  // ——漏掉的表现是「改了没反应」而不是报错。代价：选项袋里不能有函数（会被折叠成 `fn`）。
  rebuildKey: (p) => `${LAYER_KIND}|${stableLayerValue(ctorOptions(p))}`,
  style: styleValue,
  data: {
    key: dataKey,
    /**
     * `data` 在类型上是必填的 `readonly Item[]`，但 JS 调用方可以传 `null` / `undefined`：
     * 分别按「没有数据」/「不表态」处理（与图层组件同一口径），而不是在适配层里对 `null` 取坐标
     * 抛一个看不懂的 `TypeError`。
     */
    state: (p) => (p.data == null ? (p.data === null ? "empty" : "absent") : "value"),
    value: () => adapt().data as unknown as object,
  },
  // 身份口径：`resolveIdField(itemKey)` 恒有值（函数式 key 落保留字段 `__id`），因此
  // BPointCollection 的要素状态命令面**不会**遇到「身份未声明」那条拒绝路径。
  identity: (p) => resolveIdField(p.itemKey),
  /**
   * 官方这批图层只派发 `dataparsed` / `mousemove` / `click` / `dblclick` / `rightclick`
   * （`NormalLayerEventMap`）——**没有** mouseover / mouseout，所以本组件不声明它们。
   */
  bind: ({ handle, context, scope }) => {
    scope.add(context.client.driver.events.on(handle, "click", (event) => handlePick(event)));
  },
});

/**
 * 样式对象（只包含**有表态**的字段：`undefined` 不进 SDK，避免把官方默认值盖成 undefined）。
 *
 * 走共享的 `projectLayerStyle`：这里目前只有原始值（`PointShapeStyle` 的五个字段没有函数支），
 * 但统一入口让「函数型样式的转发口径」只有一处实现——将来若暴露函数型样式字段，不需要在组件里
 * 再补一遍 `forwardCallback`。
 */
function styleValue(): Record<string, unknown> | undefined {
  return projectLayerStyle(() => {
    const style: Record<string, unknown> = {};
    if (props.shape !== undefined) style.shapeType = props.shape;
    if (props.size !== undefined) style.size = props.size;
    if (props.color !== undefined) style.color = props.color;
    if (props.strokeColor !== undefined) style.strokeColor = props.strokeColor;
    if (props.strokeWeight !== undefined) style.strokeWeight = props.strokeWeight;
    return Object.keys(style).length > 0 ? style : undefined;
  });
}

/* ------------------------------------------------------------------ 拾取 */

/**
 * 拾取载荷 → 业务项。
 *
 * 身份来源**只有两处，都是公开的**（都在 `resolveFeaturePick` 里）：
 *
 * 1. 官方回包 `value.dataItem.properties[idKey]`（官方示例的取法）；
 * 2. 兜底：`dataIndex` 指向**我们自己送出去的那份数据**的对应要素——它仍然是我们自己的输入，
 *    不是从内部对象 / 事件顺序里恢复出来的猜测。
 *
 * 两处都取不到身份时**如实返回未命中语义**（`item: null` 且不派发 `item-click`），并告警一次。
 */
function handlePick(event: unknown): void {
  const pick = resolveFeaturePick<Item>({
    event,
    idKey: lastAdapted?.idKey,
    sentData: resource.sentData,
    // 业务对象与要素分离：身份 → 最新业务项由本组件的索引回答（找不到就是找不到，
    // 不退回「拿 properties 当业务项」）。
    // 参数是**业务键**的原始值（`PropertyKey`，含 symbol 与空字符串业务键），不是公开 `id`
    // ——按公开 id 的 `string | number` 域去判会让 symbol 型 `itemKey` 丢掉 `item-click`。
    itemOf: (key) => (key === null ? undefined : items.latest(key)),
  });

  emit("click", pick);
  // falsy 业务项（`0` / `false` / `""`）也是「命中了」，必须派发（评审 #102 F4）
  if (pick.item !== null) emit("item-click", pick.item);
  else if (pick.hit) {
    warnOnce(
      "pick-unresolved",
      `[BPointCollection] 命中了要素（dataIndex=${pick.dataIndex}）但取不到业务项：` +
        "要素身份来自 feature.properties[idKey]，若数据在本次点击之前刚被替换过，这一帧可能已经过期",
    );
  }
}

/**
 * 卸载时清掉组件自持的账本。
 *
 * 实例生命周期（摘图层 / 清数据 / 解绑监听）由共享内核负责；这里清的是**组件自己的**两份状态：
 * `items`（key → 业务项）与 `lastAdapted`。它们在组件被卸载后本来就不可达（闭包随实例被回收），
 * 但显式复位能让「迟到的事件回调 / 计时器」即使引用到它们也拿不到已经失效的业务对象。
 */
onUnmounted(() => {
  items.clear();
  lastAdapted = null;
});

defineExpose({
  /**
   * 要素状态命令面（按业务 id = `itemKey` 指向的字段定位）。
   *
   * 未就绪时命令**不排队**（告警一次并跳过）；`get()` 走 SDK 的公开读回。
   */
  featureState: resource.featureState,
});

defineOptions({ name: "BPointCollection" });
</script>

<template>
  <slot />
</template>
