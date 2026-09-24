<script setup lang="ts" generic="Item">
/**
 * PointIconLayer —— 批量图标点（**单个** SDK 资源，M6-POINT-CLUSTER / issue #35）
 *
 * 落在官方 `BMap.PointIconLayer`（**两处都声明**：类型包有完整类声明，官方 React 参考实现也有同名组件）。生命周期（创建 / 重建 / 就地写入 / 释放）**完全交给**
 * `useNativeLayerResource`（#36 抽出的共享内核，五个原生数据图层共用一份实现）：
 * 本组件只声明「构造期选项 / 样式袋 / 数据载荷 / 事件」四件事，不再自持第二套状态机。
 *
 * 与形状层的差异只有「每个点画什么」：这里画一张图标。两处实现细节值得写在明处：
 *
 * - `isFlat` / `isFixed` 是**构造期**选项（官方写在 `PointIconLayerOptions` 上而不是 style 里，
 *   它们决定渲染通道）⇒ 变化时**换实例**；
 * - 图标按 URL **异步加载**，SDK 没有公开「图标就绪」事件 ⇒ 组件层不观测加载失败（不要指望
 *   `dataparsed` 代表图标已经可见）。
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
import type { PointPick, PointIconLayerProps } from "../../types/components";
import type { NativeLayerKind } from "../../driver/types/native-layers";

/** 本组件落地的原生图层种类。 */
const LAYER_KIND: NativeLayerKind = "point-icon";
const LABEL = "PointIconLayer";

const props = withDefaults(defineProps<PointIconLayerProps<Item>>(), {
  // 布尔 prop 必须给显式默认值（Vue 对 `Boolean` 有「缺省即 false」的转换）。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：本组件的核心交互是 `item-click`，
  // 默认关掉拾取等于「给了事件但点不出来」。要省开销时显式传 `false`。
  enablePicked: true,
});

const emit = defineEmits<{
  /** 命中某个要素：载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
  /** 图层级拾取（含未命中）：`hit` / 坐标 / 像素 / 解析到的业务项。 */
  click: [pick: PointPick<Item>];
}>();

const warnOnce = createDevWarnOnce();
const reports = createProblemReporter(LABEL, (message) => devWarn(message));
/** key → 最新业务项（拾取回传用；与 DataLayerManager 共用同一份实现）。 */
const items: ItemIndex<Item> = createItemIndex<Item>();
/** 最近一次适配结果（`idKey` 与「我们送出去的那份数据」都由它给出）。 */
let lastAdapted: AdaptedPoints<Item> | null = null;

/* ------------------------------------------------------------------ 指纹 */

/**
 * 数据输入指纹：与「送给 SDK 的那一份」比对，值没变就不重复 `setData`。
 *
 * 三条判据**刻意不同**：`data` 按引用（等于不深遍历）；函数（`getPosition` / `properties` /
 * 函数式 `itemKey`）按**源码文本**折叠（父级内联箭头每次渲染都是新对象、但源码相同 ⇒ 指纹稳定）；
 * 其余按取值。口径与 `PointCollection` 逐条一致（同一份实现，不另写一套）。
 */
function dataKey(): string {
  return [props.data, props.dataVersion, props.itemKey, props.properties, props.getPosition]
    .map(inputFingerprint)
    .join("|");
}

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

/** 构造期选项袋（官方构造参数里**不能就地更新**的那些）。 */
function ctorOptions(p: Readonly<PointIconLayerProps<Item>>): Record<string, unknown> {
  return {
    idKey: resolveIdField(p.itemKey),
    enablePicked: p.enablePicked,
    ...(p.isFlat === undefined ? {} : { isFlat: p.isFlat }),
    ...(p.isFixed === undefined ? {} : { isFixed: p.isFixed }),
    ...(p.pickWidth === undefined ? {} : { pickWidth: p.pickWidth }),
    ...(p.pickHeight === undefined ? {} : { pickHeight: p.pickHeight }),
  };
}

/**
 * 样式对象（只包含**有表态**的字段：`undefined` 不进 SDK，避免把官方默认值盖成 undefined）。
 *
 * 走共享的 `projectLayerStyle`：统一入口让「函数型样式的转发口径」只有一处实现。
 */
function styleValue(): Record<string, unknown> | undefined {
  return projectLayerStyle(() => {
    const style: Record<string, unknown> = {};
    if (props.icon !== undefined) style.icon = props.icon;
    if (props.width !== undefined) style.width = props.width;
    if (props.height !== undefined) style.height = props.height;
    if (props.anchors !== undefined) style.anchors = props.anchors;
    if (props.offset !== undefined) style.offset = props.offset;
    if (props.scale !== undefined) style.scale = props.scale;
    if (props.rotation !== undefined) style.rotation = props.rotation;
    return Object.keys(style).length > 0 ? style : undefined;
  });
}

/* ------------------------------------------------------------------ 拾取 */

/**
 * 拾取载荷 → 业务项。
 *
 * 读取与身份判定**全部**走共享的 `resolveFeaturePick`（含扩展 API 载荷形状的归一，见
 * `core/layers/nativeLayerPick.ts`）：这里只负责把结果投影成组件的事件。
 */
function handlePick(event: unknown): void {
  const pick = resolveFeaturePick<Item>({
    event,
    idKey: lastAdapted?.idKey,
    sentData: () => resource.sentData,
    // 参数是**业务键**的原始值（`PropertyKey`，含 symbol 与空字符串业务键），不是公开 `id`。
    itemOf: (key) => (key === null ? undefined : items.latest(key)),
  });

  emit("click", pick);
  // falsy 业务项（`0` / `false` / `""`）也是「命中了」，必须派发（评审 #102 F4）
  if (pick.item !== null) emit("item-click", pick.item);
  else if (pick.hit) {
    warnOnce(
      "pick-unresolved",
      `[${LABEL}] 命中了要素（dataIndex=${pick.dataIndex}）但取不到业务项：` +
        "要素身份来自 feature.properties[idKey]，若数据在本次点击之前刚被替换过，这一帧可能已经过期",
    );
  }
}

const resource = useNativeLayerResource<PointIconLayerProps<Item>>(props, {
  component: LABEL,
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
  identity: (p) => resolveIdField(p.itemKey),
  bind: ({ handle, context, scope, isQuiescing }) => {
    scope.add(
      context.client.driver.events.on(handle, "click", (event) => {
        // 摘除期间（严格换实例的 quiesce 阶段）不穿透：SDK 可能在 removeLayer 里同步派发事件
        if (isQuiescing()) return;
        handlePick(event);
      }),
    );
  },
});

/**
 * 卸载时清掉组件自持的账本：`items` 与 `lastAdapted`。
 *
 * 实例生命周期由共享内核负责；这里清的是组件自己的两份状态（闭包随实例回收本来就不可达，
 * 显式复位让迟到的事件回调即使引用到它们也拿不到已经失效的业务对象）。
 */
onUnmounted(() => {
  items.clear();
  lastAdapted = null;
});

defineExpose({
  /**
   * 要素状态命令面（按业务 id = `itemKey` 指向的字段定位）。
   * 未就绪时命令**不排队**（告警一次并跳过）；`get()` 走 SDK 的公开读回。
   */
  featureState: resource.featureState,
});

defineOptions({ name: LABEL });
</script>

<template>
  <slot />
</template>
