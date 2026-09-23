<script setup lang="ts">
/**
 * BMVTLayer —— MVT 矢量瓦片图层（官方 `BMap.MVTLayer`，4.0）
 *
 * 挂载与能力面全部由 live 探针取证（2026-09-23，issue #109；读数见 skill
 * `references/mvt-layer.md`「live 探针读数」）：
 *
 * - 挂载：直接 `map.addLayer(mvt)` 即可（壳有 `isTileLayer`）；占位符用 `[z]/[x]/[y]`，`{z}` 不解析；
 * - `layers` 必须是**源图层名字符串数组**（worker `Xb` 按 `indexOf(name)` 过滤），对象数组整层失效；
 * - 样式在给了 `layers` 时按**源图层名键** `{ lines: { type, painter } }` 读（d.ts 的扁平 `MVTLayerStyle` 与运行时不符）；
 * - 拾取走事件 `value: Entity[]`（`pickFeatures(x,y)` 返回空，本库不包装它）；
 * - 要素状态键是复合 **`layerName_id`**（裸 id 只有噪声级 Δ），且样式须先含 `feature-state` 表达式。
 *
 * 更新口径（与 `LAYER_DESCRIPTORS.mvt` 一致）：
 * - `zIndex` 就地 `setZIndex`、`style` 整袋 `setStyle`（**不重建**）；
 * - `tileUrlTemplate` / `layers` / `idProperty` / `minZoom` / `maxZoom` **构造期**（无 setter）⇒ 重建；
 * - `visible` = 挂上 / 摘掉。
 *
 * 官方**没有** `opacity` / `setVisible` / `setMinZoom` / `setMaxZoom` / `setData`：本组件
 * 因此不声明它们（声明了再忽略 = 假支持）。
 *
 * Feature State 是命令面（不是 prop）：`featureState.update/remove/clear/replace/get`，
 * 键域 **string-only**、键形 `layerName_id`（`mvtFeatureStateKey()`），身份前置是 `idProperty`。
 */
import { createFeatureStateApi } from "../../core/data/featureState";
import { normalizeIdField } from "../../core/data/identity";
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";
import type {
  BMVTLayerBaseEvent,
  BMVTLayerMouseMoveEvent,
  BMVTLayerPickEvent,
  BMVTLayerProps,
} from "../../types/components";

const props = withDefaults(defineProps<BMVTLayerProps>(), {
  visible: true,
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」=「不表态」（ADR 2026-09-17 决策 5，与 BXYZLayer / BRasterLayer 同口径）。
  noCollision: undefined,
  useThumb: undefined,
  encrypt: undefined,
  onclick: undefined,
  ondblclick: undefined,
  onmousemove: undefined,
  onmouseout: undefined,
});

const emit = defineEmits<{
  click: [e: BMVTLayerPickEvent];
  dblclick: [e: BMVTLayerPickEvent];
  mousemove: [e: BMVTLayerMouseMoveEvent];
  mouseout: [e: BMVTLayerBaseEvent];
  tilesloadstart: [e: BMVTLayerBaseEvent];
  tilesloadend: [e: BMVTLayerBaseEvent];
}>();

const resource = useLayerResource<BMVTLayerProps>(props, {
  component: "BMVTLayer",
  toSpec: (p) => ({
    kind: "mvt",
    visible: p.visible,
    zIndex: p.zIndex,
    // 统一槽位（构造期：mvt 没有 setMinZoom / setMaxZoom ⇒ 变化即重建）
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    options: {
      layers: p.layers,
      idProperty: p.idProperty,
      // style 走字段级 `setStyle(styleMap)`（descriptor.mutable.style），**不是** bagSetters：
      // bagSetters 会把 value 再包一层 `{ style: … }`，与官方 `setStyle(styleMap)` 签名不符。
      style: p.style,
      ...pickLayerOptions(p, [
        "tileUrlTemplate",
        "transform",
        "gridModel",
        "spanLevel",
        "noCollision",
        "useThumb",
        "encrypt",
        // 官方 MVTLayerOptions 的四个构造回调（与 addEventListener 并存的逃生口）
        "onclick",
        "ondblclick",
        "onmousemove",
        "onmouseout",
      ]),
    },
  }),
  bind: ({ handle, context, scope }) => {
    const events = context.client.driver.events;
    // 六个事件名全部 live 探针确认可绑；与官方 `MVTLayerEventMap` 一致。
    // 条件订阅会漏事件（Vue 不把 listener 放进 props，见 useVisualLayer 同一段注释）⇒ 无条件绑。
    scope.add(events.on(handle, "click", (e) => emit("click", e as BMVTLayerPickEvent)));
    scope.add(events.on(handle, "dblclick", (e) => emit("dblclick", e as BMVTLayerPickEvent)));
    scope.add(
      events.on(handle, "mousemove", (e) => emit("mousemove", e as BMVTLayerMouseMoveEvent)),
    );
    scope.add(events.on(handle, "mouseout", (e) => emit("mouseout", e as BMVTLayerBaseEvent)));
    scope.add(
      events.on(handle, "tilesloadstart", (e) =>
        emit("tilesloadstart", e as BMVTLayerBaseEvent),
      ),
    );
    scope.add(
      events.on(handle, "tilesloadend", (e) => emit("tilesloadend", e as BMVTLayerBaseEvent)),
    );
  },
});

/**
 * 要素状态命令面。
 *
 * `keyDomain: "string"`：MVT 官方签名 `updateState(keys: string | Array<string>)`，数字键在
 * 任何 SDK 调用之前被拒绝。`identityProp: "idProperty"`：告警文案点名正确的 prop。
 * 会话每次命令重新求值（`useLayerResource().session`），重建后不会写进旧实例。
 */
const featureState = createFeatureStateApi({
  component: "BMVTLayer",
  session: () => resource.session(),
  identity: () => normalizeIdField(props.idProperty),
  identityProp: "idProperty",
  keyDomain: "string",
});

defineExpose({
  /**
   * 要素状态命令面（键 = **复合** `layerName_id`，见 `mvtFeatureStateKey`）。
   *
   * 官方入口：`updateState` / `removeState` / `clearState` / `replaceAllState` / `getAllState`。
   * `idProperty` 未声明时五个命令一律拒绝（告警一次）；未就绪时不排队。
   * 样式须先含 `feature-state` 表达式，否则写入无可见效果（探针前置条件）。
   */
  featureState,
});

defineOptions({ name: "BMVTLayer" });
</script>

<template>
  <slot />
</template>
