<script setup lang="ts" generic="Item">
/**
 * PointLayer —— 扩展 API 的批量点（**单个** SDK 资源，M6-POINT-CLUSTER / issue #35）
 *
 * 落在官方 `BMap.PointLayer`（**运行时存在、类型包没有类声明**）。生命周期（创建 / 重建 / 就地写入 / 释放）**完全交给**
 * `useNativeLayerResource`（#36 抽出的共享内核，五个原生数据图层共用一份实现）：
 * 本组件只声明「构造期选项 / 样式袋 / 数据载荷 / 事件」四件事，不再自持第二套状态机。
 *
 * ⚠️ 三个点图层里唯一「没有类型声明兜底」的那个：可视化实现由 SDK **按需异步注入**，
 * 因此在注入完成之前创建会显式失败（`BMAP_CAPABILITY_UNSUPPORTED`）。它**不会**自动改用
 * `PointShapeLayer` / `PointIconLayer` —— 那是另一个 SDK 能力，偷偷换掉等于改掉调用方的意图。
 *
 * 它的选项是**扁平**的（官方扩展专页的例子是 `new BMap.PointLayer({ shape, size, fillColor })`），
 * 而不是 `style` 袋 —— 由 Driver 按 kind 把样式袋映射到 `setOptions` 合并生效。
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
import type { PointPick, PointLayerProps } from "../../types/components";
import type { NativeLayerKind } from "../../driver/types/native-layers";

/** 本组件落地的原生图层种类。 */
const LAYER_KIND: NativeLayerKind = "point";
const LABEL = "PointLayer";

const props = withDefaults(defineProps<PointLayerProps<Item>>(), {
  // 布尔 prop 必须给显式默认值（Vue 对 `Boolean` 有「缺省即 false」的转换）。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：本组件的核心交互是 `item-click`，
  // 默认关掉拾取等于「给了事件但点不出来」。要省开销时显式传 `false`。
  enablePicked: true,
  // ⚠️ 下面两个**刻意写 `undefined`**（口径同 `FillLayerProps.border` / PointIconLayer 的
  // `userSizes`）：官方默认值分别是 `mouseStyleChange: true` 与 `pickThrough: false`。
  // `mouseStyleChange` 尤其不能落到 Vue 的缺省 `false`——那会让「命中后换光标」对所有
  // 不传它的用户静默失效。`pickThrough` 落到 `false` 恰好等于官方默认，写不写都一样，
  // 但显式列出才让「没传 = 不表态」这条口径在代码里看得见。
  mouseStyleChange: undefined,
  pickThrough: undefined,
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

/**
 * 构造期选项袋（官方构造参数里**不能就地更新**的那些）。
 *
 * ⚠️ 这里**没有** `pickWidth` / `pickHeight`（#165 Class 5 已删）：官方 `PointLayerOptions` 上
 * 没有这两个成员 —— 它们只在 `LineLayer` / `PointIconLayer` / `FillLayer` / `PointShapeLayer`
 * 上声明。原先无条件透传的结果是「构造器静默忽略两个不认识的键」，即收下用不了的 prop。
 * 正确成员是 `pickTolerance` / `pickThrough` / `mouseStyleChange`（由 #169 接入）。
 */
function ctorOptions(p: Readonly<PointLayerProps<Item>>): Record<string, unknown> {
  return {
    idKey: resolveIdField(p.itemKey),
    enablePicked: p.enablePicked,
    // #165：`isFlat` 曾**整个缺失**（官方 `visualization/PointLayer.d.ts:123` 声明了它，
    // 而 `PointCollection` / `PointIconLayer` 两个兄弟都投影了它）⇒ 组件收下即丢弃。
    // 官方把它写在构造参数 `PointLayerOptions` 上、没有 `setIsFlat` ⇒ 构造期项，
    // 进了本函数就自动进了重建指纹（`rebuildKey` 派生自 `ctorOptions`）。
    //
    // ⚠️ 与兄弟逐条同形：没表态时**整个键不存在**（不是 `isFlat: undefined`）。
    // 官方三处的 `@default` 互相矛盾（见 `PointLayerProps.isFlat` 的注释表），
    // 「没传 = 不表态 = SDK 自己的默认」是三族一致的处置。
    ...(p.isFlat === undefined ? {} : { isFlat: p.isFlat }),
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
    if (props.shape !== undefined) style.shape = props.shape;
    if (props.icon !== undefined) style.icon = props.icon;
    if (props.size !== undefined) style.size = props.size;
    if (props.fillColor !== undefined) style.fillColor = props.fillColor;
    if (props.fillOpacity !== undefined) style.fillOpacity = props.fillOpacity;
    if (props.strokeColor !== undefined) style.strokeColor = props.strokeColor;
    if (props.strokeWeight !== undefined) style.strokeWeight = props.strokeWeight;
    if (props.scale !== undefined) style.scale = props.scale;
    if (props.rotation !== undefined) style.rotation = props.rotation;
    if (props.offset !== undefined) style.offset = props.offset;
    if (props.anchor !== undefined) style.anchor = props.anchor;
    // #165 Class 3 / TASK 2：4.0.5 的 `PointLayerOptions` 里补齐的这一组。全部进**样式袋**
    // （官方 `PointLayer.d.ts:298` 明说 `setOptions` 会把 `renderStage` / `referCenter` 转发到
    // 对应 setter，其余样式键合并），因此都走就地更新、不换实例。
    if (props.iconSize !== undefined) style.iconSize = props.iconSize;
    if (props.mouseStyleChange !== undefined) style.mouseStyleChange = props.mouseStyleChange;
    if (props.pickTolerance !== undefined) style.pickTolerance = props.pickTolerance;
    if (props.pickThrough !== undefined) style.pickThrough = props.pickThrough;
    if (props.renderStage !== undefined) style.renderStage = props.renderStage;
    // ⚠️ `referCenter` 官方类型是 `BMap.Point`，而样式袋是**原样透传**的纯数据袋。
    // 本组件收 `{ lng, lat }`，必须由 Driver 侧换算成 `BMap.Point`——组件层不构造 SDK 构造器。
    if (props.referCenter !== undefined) style.referCenter = props.referCenter;
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

const resource = useNativeLayerResource<PointLayerProps<Item>>(props, {
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

/**
 * 插槽契约（#188）。
 *
 * 与另外 47 个组件同因：`defineSlots` 让 Volar 把载荷**内联**进插槽类型，
 * 不产生会被声明打包阶段丢弃的中间 `var`。根因与实验记录见
 * `components/map/Map.vue` 里同段注释。
 *
 * **本组件是泛型组件**（`generic="Item"`），vue-tsc 无法把它的插槽类型提升成顶层
 * 别名 —— 这正是它们在 #188 首轮被排除的原因：当时 emit 出来恰好是合法的内联形态。
 * 但「当时恰好合法」不是判据，换个 Volar 版本或改一下模板就可能退回悬空形态，
 * 而没有任何既有门禁会红。写出来之后这一类形态由 `pnpm check:dts-strict` 守着。
 *
 * 载荷用 `Record<never, never>` 而不是 `Record<string, never>`（#188 评审 P1）：后者带
 * 字符串索引签名，写错插槽 prop 时不报错（`typo` 得到 `never`，而 `never` 可赋给任何
 * 目标），错误成员静默通过。守卫见 `fixtures/consumer/strict/probe.ts` 的 `HasStringIndex`。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: LABEL });
</script>

<template>
  <slot />
</template>
