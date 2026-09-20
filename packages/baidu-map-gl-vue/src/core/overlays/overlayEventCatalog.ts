/**
 * 覆盖物事件矩阵（M5-VECTORS / issue #31）—— 覆盖物事件的**单一事实源**
 *
 * ## 它解决什么
 *
 * 迁移前每个覆盖物组件各自 `emit("click", e)` / `emit("dblclick", e)`（BCircle 甚至只有
 * 这两个），于是三种漂移无法避免：
 *
 * 1. **同一类覆盖物的事件面不一致**：Polyline / Polygon / Circle 都是上游的
 *    `GraphEventMap`（17 个事件），组件却只发 2 个；Rectangle 干脆没有组件。
 * 2. **名字没有规范**：谁想加 `rightdblclick` 就得自己写一遍 `driver.events.on(handle, "...")`，
 *    名字、拼写、载荷解析全部靠人记。
 * 3. **能力边界不可见**：Prism / BezierCurve 的编辑事件在上游被 `Omit` 掉了
 *    （SDK 没有 `enableEditing`），但组件侧看不出这件事。
 *
 * 现在组件只声明「我是哪个 kind」，事件面由本表给出：
 * `spec.events` 退化为**覆盖项**（只写要自定义处置的条目），事件面的其余部分由内核
 * `resolveOverlayEvents()`（`core/composables/useOverlaySpec.ts`）从矩阵取出并绑定；
 * 载荷类型由 `payload` 档决定（见 `driver/types/events.ts` 的 `OverlayEventPayload` 家族）。
 *
 * ## 名字从哪来（上游权威清单）
 *
 * `@baidumap/jsapi-v4-types@4.0.4` 把每个覆盖物的事件映射表声明在**它自己那一类**的 `.d.ts` 里
 * （`overlay/OverlayEvent.d.ts` 只装其中一部分）：
 *
 * | kind | 上游声明 | 声明所在文件 |
 * | --- | --- | --- |
 * | `marker` | `MarkerEventMap`（11 个） | `overlay/OverlayEvent.d.ts` |
 * | `label` | `LabelEventMap`（8 个） | 同上 |
 * | `polyline` / `polygon` / `rectangle` / `circle` | `GraphEventMap`（17 个） | 同上 |
 * | `prism` / `bezier-curve` | `GraphEventMap` **Omit 6 个编辑事件**（11 个） | 同上 |
 * | `ground-overlay` | `GroundOverlayEventMap`（11 个） | 同上 |
 * | `info-window` | `InfoWindowEventMap`（6 个） | 同上 |
 * | `custom-overlay` | `CustomOverlayEventMap`（3 个） | `overlay/CustomOverlay.d.ts` |
 * | `context-menu` | `ContextMenuEventMap`（2 个） | `context-menu/ContextMenu.d.ts` |
 *
 * 最后两行是 issue #33 补上的：此前本表把它们登记成「上游没有事件表」，而那是**只读了一个文件**
 * 得到的结论——两张表都在，只是不在 `OverlayEvent.d.ts` 里。事件名照旧由
 * `tests/behavior/v3-overlay-event-matrix.test.ts` 对着这三个文件做**双向**比对
 * （表里多一个、少一个、或某张表换了文件都红），因此「事件命名和 payload 由统一 Catalog 管理」
 * 是一条会红的检查，而不是文档承诺。
 *
 * ## Vue 命名规范
 *
 * `vue` 名 = SDK 名把 `_` 换成 `-`（与 map 事件**同一条规则**，实现共用
 * `core/events/eventCatalog.ts` 的 `toVueEventName`，不写第二遍）。覆盖物的上游事件名本来
 * 就没有分隔符，因此当前两者逐字相同——但**仍然派生**：规范只有一处，将来上游加了带下划线的
 * 事件名（map 侧已经有 `style_loaded` 这类先例）也不会出现第二个口径。
 *
 * 订阅名永远是 SDK 名（`definition.sdk`），Vue 名只用于 `emit`。覆盖物的上游事件名当前
 * **全部**没有分隔符（`vue === sdk`），因此内核只发一次名字就够——map 侧那种「规范名 + SDK
 * 拼写」的双发（`MAP_EVENT_EMIT_ALIASES`）在这里没有对象。`vue` 仍然派生而不是手写：
 * 规范只有一处，将来上游加了带 `_` 的事件名时不需要第二个口径。
 *
 * **历史名（`drag-end`）不在这套双发机制里**：它是弃用别名（有稳定 code、要告警、将来要删），
 * 归 `core/deprecations` 管。
 *
 * ## 载荷档（`payload`）
 *
 * 三档全部来自上游声明，不是本库的偏好（细节见 `driver/types/events.ts`）：
 *
 * - `pointer`：上游 `OverlayMouseEvent.point` 必填 ⇒ Driver 补 `{lng:0,lat:0}`，载荷 `point` 必填；
 * - `partial-pointer`：上游声明可缺、或**可为 `null`**（图形族 `mouseout` = `GraphMouseOutEvent`；
 *   GroundOverlay 家族的 `GroundOverlayMouseEvent` 各字段可缺；`ContextMenuEvent.point` 是
 *   `Point | null`）⇒ **不补**，载荷 `point` 可缺（归一化把 `null` 与「缺失」都收成 `undefined`）；
 * - `base`：`OverlayBaseEvent` / `GraphLineUpdateEvent` / `GraphEditEvent` ⇒ 只有底座字段
 *   （未归一化的 `action` / `from` 等仍经 `raw` 逃生口读取，与本库对 map 事件的口径一致）。
 *
 * ## 编辑事件（`requiresEditing`）
 *
 * `editstart` / `editend` / `linevertexdrag*` / `linevertexdel` 只在开启编辑后才会派发
 * （上游文档：「需先调用 `enableEditing()`」）。**能力边界由矩阵本身表达**：Prism / BezierCurve 的
 * 事件表在上游就被 `Omit` 掉了，因此它们的矩阵里根本没有这些条目，组件也不暴露 `enableEditing`。
 *
 * `requiresEditing` 因此是**说明性元数据**（进文档表格，并被「谁有编辑能力」的门禁逐条核对），
 * **不是**运行期的订阅开关：SDK 不会在未开启编辑时派发这些事件，按 `props.enableEditing` 动态
 * 增删订阅只会引入新的释放路径（见 ADR 决策 6）。
 */
import { toVueEventName } from "../events/eventCatalog";
import type { OverlayKind } from "../../driver/types/overlays";

/**
 * 覆盖物事件的载荷档（决定公共载荷里哪些字段必填）。
 *
 * 与 `driver/types/events.ts` 的三个载荷类型一一对应，由类型层断言 + 用例双向锁定。
 */
export type OverlayEventPayloadKind = "pointer" | "partial-pointer" | "base";

/** 一条覆盖物事件定义。 */
export interface OverlayEventDefinition {
  /** SDK 订阅名（`events.on(handle, sdk, ...)` 用的就是它）。 */
  readonly sdk: string;
  /** 规范 Vue 名（`emit` 用的名字）。 */
  readonly vue: string;
  /** 载荷档（见文件头）。 */
  readonly payload: OverlayEventPayloadKind;
  /** 是否只在开启编辑后派发（上游 `enableEditing` 的能力边界）。 */
  readonly requiresEditing: boolean;
  /** 一句话说明（进文档表格；取自上游声明）。 */
  readonly description: string;
}

/** 声明期输入：`vue` 由 `sdk` 派生，矩阵里不手写第二份。 */
interface OverlayEventInput {
  readonly payload: OverlayEventPayloadKind;
  readonly requiresEditing: boolean;
  readonly description: string;
}

function pointer(description: string): OverlayEventInput {
  return { payload: "pointer", requiresEditing: false, description };
}

function partialPointer(description: string): OverlayEventInput {
  return { payload: "partial-pointer", requiresEditing: false, description };
}

function base(description: string): OverlayEventInput {
  return { payload: "base", requiresEditing: false, description };
}

function editing(description: string): OverlayEventInput {
  return { payload: "base", requiresEditing: true, description };
}

/** 一类覆盖物的事件表 + 它的上游依据（`null` = 上游没有为这一类声明事件表）。 */
export interface OverlayEventMatrixEntry {
  /** 上游事件映射表名（`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/OverlayEvent.d.ts`）。 */
  readonly upstream: string;
  /** 事件表：键 = 规范 Vue 名。 */
  readonly events: Readonly<Record<string, OverlayEventDefinition>>;
}

interface OverlayEventMatrixInput {
  readonly upstream: string;
  readonly events: Readonly<Record<string, OverlayEventInput>>;
}

function matrix(input: OverlayEventMatrixInput): OverlayEventMatrixEntry {
  const events: Record<string, OverlayEventDefinition> = {};
  for (const [sdk, input_] of Object.entries(input.events)) {
    events[toVueEventName(sdk)] = { sdk, vue: toVueEventName(sdk), ...input_ };
  }
  return { upstream: input.upstream, events };
}

/* ------------------------------------------------------------------ 各 kind 的事件表 */

/** `MarkerEventMap`（11 个）。 */
const MARKER_EVENTS: Record<string, OverlayEventInput> = {
  click: pointer("点击标注时触发"),
  dblclick: pointer("双击标注时触发"),
  rightclick: pointer("右键点击标注时触发"),
  mousedown: pointer("在标注上按下鼠标时触发"),
  mouseup: pointer("在标注上抬起鼠标时触发"),
  mouseover: pointer("鼠标移入标注时触发"),
  mouseout: pointer("鼠标移出标注时触发"),
  dragstart: pointer("开始拖拽标注时触发（需先 enableDragging）"),
  dragging: pointer("拖拽标注过程中持续触发（需先 enableDragging）"),
  dragend: pointer("拖拽标注结束时触发（需先 enableDragging）"),
  remove: base("标注被移除（如 map.removeOverlay()）时触发"),
};

/** `LabelEventMap`（8 个）：没有拖拽、没有 rightdblclick / mousemove、没有图形族的编辑事件。 */
const LABEL_EVENTS: Record<string, OverlayEventInput> = {
  click: pointer("点击文本标注时触发"),
  dblclick: pointer("双击文本标注时触发"),
  rightclick: pointer("右键点击文本标注时触发"),
  mousedown: pointer("在文本标注上按下鼠标时触发"),
  mouseup: pointer("在文本标注上抬起鼠标时触发"),
  mouseover: pointer("鼠标移入文本标注时触发"),
  mouseout: pointer("鼠标移出文本标注时触发"),
  remove: base("文本标注被移除（如 map.removeOverlay()）时触发"),
};

/**
 * `GraphEventMap` 的公共部分（Polyline / Polygon / Rectangle / Circle 全量，Prism / BezierCurve 去掉
 * 6 个编辑事件）。
 *
 * `mouseout` 是**唯一**的 `partial-pointer`：上游类型是
 * `GraphMouseOutEvent = OverlayBaseEvent & Partial<OverlayMouseEvent>`——图形族 mouseout 可能由
 * 内部命中切换合成，坐标本来就不保证有。
 */
const GRAPH_SHARED_EVENTS: Record<string, OverlayEventInput> = {
  click: pointer("点击图形时触发"),
  dblclick: pointer("双击图形时触发"),
  mousedown: pointer("在图形上按下鼠标时触发"),
  mouseup: pointer("在图形上抬起鼠标时触发"),
  mouseover: pointer("鼠标移入图形时触发"),
  mouseout: partialPointer("鼠标移出图形时触发（合成派发时可能不带坐标）"),
  mousemove: pointer("鼠标在图形上移动时触发"),
  rightclick: pointer("右键点击图形时触发"),
  rightdblclick: pointer("右键双击图形时触发"),
  remove: base("图形被移除（如 map.removeOverlay()）时触发"),
  lineupdate: base("图形的节点数据发生变化时触发（变化来源见 raw.action）"),
};

/** 编辑能力（`enableEditing`）独有的事件：Polyline / Polygon / Rectangle / Circle 有，Prism / BezierCurve 没有。 */
const GRAPH_EDIT_EVENTS: Record<string, OverlayEventInput> = {
  editstart: editing("开始编辑（拖拽图形节点）时触发"),
  editend: editing("一次节点编辑结束时触发"),
  linevertexdragstart: editing("开始拖拽图形编辑节点时触发"),
  linevertexdragging: editing("拖拽图形编辑节点过程中持续触发"),
  linevertexdragend: editing("拖拽图形编辑节点结束时触发"),
  linevertexdel: editing("删除图形编辑节点时触发"),
};

/** 带编辑能力的图形族（17 个事件）。 */
const GRAPH_EVENTS: Record<string, OverlayEventInput> = {
  ...GRAPH_SHARED_EVENTS,
  ...GRAPH_EDIT_EVENTS,
};

/** 不带编辑能力的图形族（11 个事件）。 */
const GRAPH_EVENTS_WITHOUT_EDITING: Record<string, OverlayEventInput> = { ...GRAPH_SHARED_EVENTS };

/** `GroundOverlayEventMap`（11 个）：全部指针事件的字段在上游都是可缺的（`GroundOverlayMouseEvent`）。 */
const GROUND_OVERLAY_EVENTS: Record<string, OverlayEventInput> = {
  click: partialPointer("点击覆盖物时触发（3.0 只保证基础字段，4.0 附带坐标）"),
  dblclick: partialPointer("双击覆盖物时触发（同上）"),
  rightclick: partialPointer("右键点击覆盖物时触发"),
  rightdblclick: partialPointer("右键双击覆盖物时触发"),
  mousedown: partialPointer("在覆盖物上按下鼠标时触发"),
  mouseup: partialPointer("在覆盖物上抬起鼠标时触发"),
  mouseover: partialPointer("鼠标移入覆盖物时触发"),
  mouseout: partialPointer("鼠标移出覆盖物时触发"),
  mousemove: partialPointer("鼠标在覆盖物上移动时触发"),
  remove: base("覆盖物被移除时触发"),
  lineupdate: base("覆盖物渲染数据发生变化时触发（变化来源见 raw.action）"),
};

/** `InfoWindowEventMap`（6 个）：气泡的开关与尺寸，全部是 `OverlayBaseEvent`。 */
const INFO_WINDOW_EVENTS: Record<string, OverlayEventInput> = {
  open: base("信息窗口打开时触发"),
  close: base("信息窗口关闭时触发"),
  clickclose: base("点击信息窗口的关闭按钮时触发"),
  maximize: base("信息窗口最大化时触发（需开启 enableMaximize）"),
  restore: base("信息窗口从最大化恢复时触发"),
  resize: base("信息窗口尺寸发生变化时触发"),
};

/**
 * `CustomOverlayEventMap`（3 个）：三个事件的载荷都是 `OverlayMouseEvent<CustomOverlay>`，
 * 上游把 `point` / `pixel` / `latLng` 都声明为**必填** ⇒ 与 Marker / Label 同档（`pointer`）。
 *
 * 事件由业务 DOM 自己冒泡到 SDK（SDK 在宿主的 DOM 上绑了原生监听）：真实 v4 实测「在业务 DOM 上
 * 派发 `click` / `mouseover` / `mouseout` ⇒ 实例派发同名事件」，因此本库**可以**把它们转发给
 * 调用方，而不必让业务自己再绑一遍 DOM。
 */
const CUSTOM_OVERLAY_EVENTS: Record<string, OverlayEventInput> = {
  click: pointer("点击自定义覆盖物时触发"),
  mouseover: pointer("鼠标移入自定义覆盖物时触发"),
  mouseout: pointer("鼠标移出自定义覆盖物时触发"),
};

/**
 * `ContextMenuEventMap`（2 个）：载荷是 `ContextMenuEvent`，其中 `point` / `pixel` / `pointMC`
 * 在上游被声明为 **`Point | null`**（不是可缺，而是可能为 null）⇒ 与「上游声明可缺」同一条归一化
 * 路径：**不补** `{lng:0,lat:0}`，调用方按 `point` 是否为 `undefined` 判「这次有没有坐标」。
 *
 * 打开 / 关闭由 SDK 在真实右键（map 目标）或目标覆盖物的右键（marker 目标）时驱动；程序化
 * `menu.show()` / `hide()` 也会派发同一对事件（真实 v4 实测）。
 */
const CONTEXT_MENU_EVENTS: Record<string, OverlayEventInput> = {
  open: partialPointer("菜单打开时触发（`sdk.show()` 与真实右键都会触发）"),
  close: partialPointer("菜单关闭时触发（选中菜单项、`sdk.hide()` 都会触发）"),
};

/**
 * 事件矩阵。**键 = `OverlayKind`**，与 `OVERLAY_DESCRIPTORS` 同一套种类名。
 *
 * `as const satisfies`：保留字面量键（`OverlayEventMatrixKey` 从它派生），并在编写期校验形状。
 */
export const OVERLAY_EVENT_MATRIX = {
  marker: matrix({ upstream: "MarkerEventMap", events: MARKER_EVENTS }),
  label: matrix({ upstream: "LabelEventMap", events: LABEL_EVENTS }),
  polyline: matrix({ upstream: "GraphEventMap", events: GRAPH_EVENTS }),
  polygon: matrix({ upstream: "GraphEventMap", events: GRAPH_EVENTS }),
  rectangle: matrix({ upstream: "GraphEventMap", events: GRAPH_EVENTS }),
  circle: matrix({ upstream: "GraphEventMap", events: GRAPH_EVENTS }),
  prism: matrix({
    upstream: "GraphEventMap (Omit 编辑事件)",
    events: GRAPH_EVENTS_WITHOUT_EDITING,
  }),
  "bezier-curve": matrix({
    upstream: "GraphEventMap (Omit 编辑事件)",
    events: GRAPH_EVENTS_WITHOUT_EDITING,
  }),
  "ground-overlay": matrix({
    upstream: "GroundOverlayEventMap",
    events: GROUND_OVERLAY_EVENTS,
  }),
  "info-window": matrix({ upstream: "InfoWindowEventMap", events: INFO_WINDOW_EVENTS }),
  "custom-overlay": matrix({
    upstream: "CustomOverlayEventMap",
    events: CUSTOM_OVERLAY_EVENTS,
  }),
  "context-menu": matrix({ upstream: "ContextMenuEventMap", events: CONTEXT_MENU_EVENTS }),
} as const satisfies Record<string, OverlayEventMatrixEntry>;

/** 有事件矩阵的 kind。 */
export type OverlayEventMatrixKey = keyof typeof OVERLAY_EVENT_MATRIX;

/**
 * 上游**没有**为它们声明事件表的 kind，以及为什么。
 *
 * 这张表是 fail-closed 的另一半：`OverlayKind` 里出现一个既不在矩阵、也不在这里的种类时
 * 会**编译失败**（见文末的类型门禁），因此「新加了一类覆盖物却忘了事件面」不可能悄悄通过。
 */
export const OVERLAY_KINDS_WITHOUT_EVENT_MATRIX = {
  "map-mask": "掩膜：4.0.4 没有 MapMaskEventMap（MapMask 本身不在类型包的类声明里）",
  marker3d:
    "3D 标注：构造器 Marker3D 不在 4.0.4 的类声明里，因此也没有事件表；" +
    "事件面要等运行时取证（与 TrafficLayer / 图层事件同一路径）",
} as const satisfies Record<string, string>;

/** 无事件矩阵的 kind。 */
export type OverlayKindWithoutEventMatrix = keyof typeof OVERLAY_KINDS_WITHOUT_EVENT_MATRIX;

/* ---------------------------------------------------------------------- 查询入口 */

/** 该 kind 的事件定义（有矩阵时为空数组）。 */
export function overlayEventsOf(kind: OverlayKind): readonly OverlayEventDefinition[] {
  const entry = (OVERLAY_EVENT_MATRIX as Record<string, OverlayEventMatrixEntry | undefined>)[kind];
  return entry ? Object.values(entry.events) : [];
}

/** 该 kind 的一条事件定义（按 Vue 名或 SDK 名查询）。 */
export function overlayEventOf(
  kind: OverlayKind,
  name: string,
): OverlayEventDefinition | undefined {
  const entry = (OVERLAY_EVENT_MATRIX as Record<string, OverlayEventMatrixEntry | undefined>)[kind];
  if (!entry) return undefined;
  const direct = entry.events[name];
  if (direct) return direct;
  return Object.values(entry.events).find((event) => event.sdk === name);
}

/**
 * 归一化策略：该 (kind, sdk 事件) 的指针兜底是 `default`（按 `POINTER_EVENT_NAMES` 补
 * `{lng:0,lat:0}`）还是 `never`（上游声明可缺 ⇒ 保留缺失语义）。
 *
 * 未被矩阵覆盖的 kind 返回 `default`：那是 map / layer 的既有口径，不因本表而改变。
 */
export function overlayPointerFallback(
  kind: OverlayKind | undefined,
  sdkName: string,
): "default" | "never" {
  if (!kind) return "default";
  const definition = overlayEventOf(kind, sdkName);
  if (!definition) return "default";
  return definition.payload === "pointer" ? "default" : "never";
}

/* --------------------------------------------------------- 类型门禁（`typecheck:v3` 会跑）
 *
 * 声明在类型位置、不产生运行时代码：任一条不成立都会让 `vue-tsc` 报 TS2344 ——
 * 「每一类覆盖物的事件面都有归属（矩阵或显式登记的无事件原因）」因此不靠人眼。
 */

/** 参数类型必须是 `never`（差集非空即编译失败）。 */
type AssertNever<T extends never> = T;

/** 每个 `OverlayKind` 必须要么有事件矩阵、要么在「无事件表」里显式登记。 */
type UnclassifiedOverlayKinds = AssertNever<
  Exclude<OverlayKind, OverlayEventMatrixKey | OverlayKindWithoutEventMatrix>
>;

export type OverlayEventMatrixTypeGates = [UnclassifiedOverlayKinds];
