// Generated file. Do not edit directly.
//
// 由 scripts/generate-overlay-emits.mts 生成，事实源三处：
//   1. core/overlays/overlayEventCatalog.ts 的 OVERLAY_EVENT_MATRIX（SDK 事件 + 载荷档）
//   2. scripts/generate-overlay-emits.mts 的 NON_SDK_EVENTS（本库事件 + 派发点）
//   3. scripts/generate-overlay-emits.mts 的 EXCLUDED_EVENTS（矩阵有、但本库无派发点的键）
//
// 改事实源后跑 `pnpm generate:overlay-emits`；CI 用 `--check` 校验无漂移。
//
// 为什么是**显式键 interface** 而不是 mapped type：`@vue/compiler-sfc` 必须把
// `defineEmits` 的类型实参解析成有限个键，`{ [K in keyof typeof MATRIX]: … }` 与含条件
// 类型的值都会报 `Failed to resolve index type into finite keys`（完整实测表见
// core/events/eventCatalog.ts 的 `MapEventEmits`）。名字只在这里写死一次，
// 运行时仍由内核按矩阵绑定——两边由生成器 join，不是各写一遍。
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { Point } from "../../driver/types/geometry";
import type { ContextMenuSelectPayload } from "../../types/components";

/** `marker` 覆盖物的事件面：11 个 SDK 事件 + 1 个本库事件（共 12 个），供 `Marker.vue` 的 `defineEmits` 使用。 */
export interface MarkerEmits {
  /** 点击标注时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击标注时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 右键点击标注时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 在标注上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在标注上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入标注时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出标注时触发 */
  mouseout: [event: OverlayPointerEvent];
  /** 开始拖拽标注时触发（需先 enableDragging） */
  dragstart: [event: OverlayPointerEvent];
  /** 拖拽标注过程中持续触发（需先 enableDragging） */
  dragging: [event: OverlayPointerEvent];
  /** 拖拽标注结束时触发（需先 enableDragging） */
  dragend: [event: OverlayPointerEvent];
  /** 标注被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 本库事件（不是 SDK 事件）：components/overlays/markerSpec.ts 派发。 */
  "update:position": [event: Point];
}

/** `label` 覆盖物的事件面：8 个 SDK 事件（共 8 个），供 `Label.vue` 的 `defineEmits` 使用。 */
export interface LabelEmits {
  /** 点击文本标注时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击文本标注时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 右键点击文本标注时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 在文本标注上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在文本标注上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入文本标注时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出文本标注时触发 */
  mouseout: [event: OverlayPointerEvent];
  /** 文本标注被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
}

/** `polyline` 覆盖物的事件面：17 个 SDK 事件（共 17 个），供 `Polyline.vue` 的 `defineEmits` 使用。 */
export interface PolylineEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
  /** 开始编辑（拖拽图形节点）时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editstart: [event: OverlayEventPayload];
  /** 一次节点编辑结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editend: [event: OverlayEventPayload];
  /** 开始拖拽图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragstart: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点过程中持续触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragging: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragend: [event: OverlayEventPayload];
  /** 删除图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdel: [event: OverlayEventPayload];
}

/** `polygon` 覆盖物的事件面：17 个 SDK 事件（共 17 个），供 `Polygon.vue` 的 `defineEmits` 使用。 */
export interface PolygonEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
  /** 开始编辑（拖拽图形节点）时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editstart: [event: OverlayEventPayload];
  /** 一次节点编辑结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editend: [event: OverlayEventPayload];
  /** 开始拖拽图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragstart: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点过程中持续触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragging: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragend: [event: OverlayEventPayload];
  /** 删除图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdel: [event: OverlayEventPayload];
}

/** `rectangle` 覆盖物的事件面：17 个 SDK 事件（共 17 个），供 `Rectangle.vue` 的 `defineEmits` 使用。 */
export interface RectangleEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
  /** 开始编辑（拖拽图形节点）时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editstart: [event: OverlayEventPayload];
  /** 一次节点编辑结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editend: [event: OverlayEventPayload];
  /** 开始拖拽图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragstart: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点过程中持续触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragging: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragend: [event: OverlayEventPayload];
  /** 删除图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdel: [event: OverlayEventPayload];
}

/** `circle` 覆盖物的事件面：17 个 SDK 事件（共 17 个），供 `Circle.vue` 的 `defineEmits` 使用。 */
export interface CircleEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
  /** 开始编辑（拖拽图形节点）时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editstart: [event: OverlayEventPayload];
  /** 一次节点编辑结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  editend: [event: OverlayEventPayload];
  /** 开始拖拽图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragstart: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点过程中持续触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragging: [event: OverlayEventPayload];
  /** 拖拽图形编辑节点结束时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdragend: [event: OverlayEventPayload];
  /** 删除图形编辑节点时触发 上游文档：需先调用 `enableEditing()`；未开启时不会派发。 */
  linevertexdel: [event: OverlayEventPayload];
}

/** `prism` 覆盖物的事件面：11 个 SDK 事件（共 11 个），供 `Prism.vue` 的 `defineEmits` 使用。 */
export interface PrismEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
}

/** `bezier-curve` 覆盖物的事件面：11 个 SDK 事件（共 11 个），供 `BezierCurve.vue` 的 `defineEmits` 使用。 */
export interface BezierCurveEmits {
  /** 点击图形时触发 */
  click: [event: OverlayPointerEvent];
  /** 双击图形时触发 */
  dblclick: [event: OverlayPointerEvent];
  /** 在图形上按下鼠标时触发 */
  mousedown: [event: OverlayPointerEvent];
  /** 在图形上抬起鼠标时触发 */
  mouseup: [event: OverlayPointerEvent];
  /** 鼠标移入图形时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出图形时触发（合成派发时可能不带坐标） */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在图形上移动时触发 */
  mousemove: [event: OverlayPointerEvent];
  /** 右键点击图形时触发 */
  rightclick: [event: OverlayPointerEvent];
  /** 右键双击图形时触发 */
  rightdblclick: [event: OverlayPointerEvent];
  /** 图形被移除（如 map.removeOverlay()）时触发 */
  remove: [event: OverlayEventPayload];
  /** 图形的节点数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
}

/** `ground-overlay` 覆盖物的事件面：11 个 SDK 事件（共 11 个），供 `GroundOverlay.vue` 的 `defineEmits` 使用。 */
export interface GroundOverlayEmits {
  /** 点击覆盖物时触发（3.0 只保证基础字段，4.0 附带坐标） */
  click: [event: OverlayPartialPointerEvent];
  /** 双击覆盖物时触发（同上） */
  dblclick: [event: OverlayPartialPointerEvent];
  /** 右键点击覆盖物时触发 */
  rightclick: [event: OverlayPartialPointerEvent];
  /** 右键双击覆盖物时触发 */
  rightdblclick: [event: OverlayPartialPointerEvent];
  /** 在覆盖物上按下鼠标时触发 */
  mousedown: [event: OverlayPartialPointerEvent];
  /** 在覆盖物上抬起鼠标时触发 */
  mouseup: [event: OverlayPartialPointerEvent];
  /** 鼠标移入覆盖物时触发 */
  mouseover: [event: OverlayPartialPointerEvent];
  /** 鼠标移出覆盖物时触发 */
  mouseout: [event: OverlayPartialPointerEvent];
  /** 鼠标在覆盖物上移动时触发 */
  mousemove: [event: OverlayPartialPointerEvent];
  /** 覆盖物被移除时触发 */
  remove: [event: OverlayEventPayload];
  /** 覆盖物渲染数据发生变化时触发（变化来源见 raw.action） */
  lineupdate: [event: OverlayEventPayload];
}

/** `info-window` 覆盖物的事件面：5 个 SDK 事件 （另排除 1 个无派发点：resize） + 3 个本库事件（共 8 个），供 `InfoWindow.vue` 的 `defineEmits` 使用。 */
export interface InfoWindowEmits {
  /** 信息窗口打开时触发（载荷按转发路径的真实形状声明，不按矩阵的档。） */
  open: [];
  /** 信息窗口关闭时触发（载荷按转发路径的真实形状声明，不按矩阵的档。） */
  close: [];
  /** 点击信息窗口的关闭按钮时触发（载荷按转发路径的真实形状声明，不按矩阵的档。） */
  clickclose: [event: unknown];
  /** 信息窗口最大化时触发（需开启 enableMaximize）（载荷按转发路径的真实形状声明，不按矩阵的档。） */
  maximize: [event: unknown];
  /** 信息窗口从最大化恢复时触发（载荷按转发路径的真实形状声明，不按矩阵的档。） */
  restore: [event: unknown];
  /** 本库事件（不是 SDK 事件）：core/composables/useInfoWindow.ts 派发。 */
  "update:open": [event: boolean];
  /** 本库事件（不是 SDK 事件）：core/composables/useInfoWindow.ts 派发。 */
  rebuild: [event: number];
  /** 本库事件（不是 SDK 事件）：core/composables/useInfoWindow.ts 派发。 */
  destroy: [event: number];
}

/** `custom-overlay` 覆盖物的事件面：3 个 SDK 事件（共 3 个），供 `CustomOverlay.vue` 的 `defineEmits` 使用。 */
export interface CustomOverlayEmits {
  /** 点击自定义覆盖物时触发 */
  click: [event: OverlayPointerEvent];
  /** 鼠标移入自定义覆盖物时触发 */
  mouseover: [event: OverlayPointerEvent];
  /** 鼠标移出自定义覆盖物时触发 */
  mouseout: [event: OverlayPointerEvent];
}

/** `context-menu` 覆盖物的事件面：2 个 SDK 事件 + 1 个本库事件（共 3 个），供 `ContextMenu.vue` 的 `defineEmits` 使用。 */
export interface ContextMenuEmits {
  /** 菜单打开时触发（`sdk.show()` 与真实右键都会触发） */
  open: [event: OverlayPartialPointerEvent];
  /** 菜单关闭时触发（选中菜单项、`sdk.hide()` 都会触发） */
  close: [event: OverlayPartialPointerEvent];
  /** 本库事件（不是 SDK 事件）：core/composables/useContextMenu.ts 派发。 */
  select: [event: ContextMenuSelectPayload];
}

/**
 * 事件矩阵与本文件声明之间的**全部**已知偏离，逐条给出理由。
 * 除此之外没有任何偏离：矩阵有的键都在这里，载荷也都等于矩阵的档。
 *
 * - `info-window.resize` **不在**本接口里：官方 `InfoWindowEventMap` 声明了它，但气泡尺寸由 `width` / `height` prop 经 `setContent` 重绘驱动；官方 `resize` 在本库只被观察、不驱动任何状态，因此没有派发点，也不进声明。
 * - `info-window.open` 的载荷**不按矩阵的 `payload` 档**：本组件不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。
 * - `info-window.close` 的载荷**不按矩阵的 `payload` 档**：本组件不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。
 * - `info-window.clickclose` 的载荷**不按矩阵的 `payload` 档**：本组件不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。
 * - `info-window.maximize` 的载荷**不按矩阵的 `payload` 档**：本组件不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。
 * - `info-window.restore` 的载荷**不按矩阵的 `payload` 档**：本组件不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。
 */
