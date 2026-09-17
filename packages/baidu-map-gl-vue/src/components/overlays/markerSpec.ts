/**
 * BMarker 的 `OverlaySpec` 声明（M5-SPEC-MARKER / issue #30）
 *
 * 从 SFC 里抽出来是为了**可测**：`tests/behavior/v3-overlay-spec.test.ts` 要拿 `fields` 与
 * `BMarkerProps` 的键集、以及 Driver 的属性描述符逐条交叉核对。放在 `.vue` 里就只能靠人眼。
 *
 * ## 每个公开属性的更新策略（`MARKER_FIELDS` 是唯一声明点）
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.marker`） |
 * | --- | --- | --- | --- |
 * | `position` | `position` | `driver.overlays.setPosition` + 双向同步 | `mutateBy("setPosition", { value: "point" })` |
 * | `offset` | `options` | `setOptions` → `setOffset` | `mutable` |
 * | `title` | `options` | `setOptions` → `setTitle` | `mutable` |
 * | `icon` | `options` | `setOptions` → `setIcon`（+ 图标 LRU 缓存） | `mutable` |
 * | `zIndex` | `options` | `setOptions` → `setZIndex` | `mutable` |
 * | `rotation` | `options` | `setOptions` → `setRotation` | `mutable` |
 * | `enableDragging` | `options` | `setOptions` → `enableDragging`/`disableDragging` | `mutable` |
 * | `enableClicking` | `recreate` | 重建实例（构造期选项） | `recreate`：4.0 的 Marker 只有构造选项 `enableClicking`，没有 `setEnableClicking` |
 * | `visible` | `visibility` | `show`/`hide`，SDK 无这两个成员时退回 `add`/`remove` | 继承自 `Overlay` 基类，**不是**属性描述符里的键 |
 */
import type { OverlaySpec, OverlayFieldMap } from "../../core/overlays/OverlaySpec";
import type { OverlayPositionModel } from "../../core/composables/useOverlaySpec";
import type { MarkerHandle } from "../../driver/types/handles";
import type { BMarkerProps } from "../../types/components";

/**
 * prop → 更新策略。
 *
 * 类型是 `OverlayFieldMap<BMarkerProps>`（映射类型带 `-?`）：**漏一个 prop 就编译失败**，
 * 因此「Marker 所有公开属性都有明确更新策略」是编译期保证，不是文档承诺。
 */
export const MARKER_FIELDS: OverlayFieldMap<BMarkerProps> = {
  position: "position",
  offset: "options",
  title: "options",
  icon: "options",
  zIndex: "options",
  rotation: "options",
  enableDragging: "options",
  enableClicking: "recreate",
  visible: "visibility",
};

/**
 * prop → Driver 描述符键的**显式**映射。
 *
 * 只写「与 prop 同名但必须是语义键」和「不是描述符属性」的两项：
 * - `position` 在描述符里是**构造期位置参数**（`ctorKey: null`），语义键是 `position`；
 * - `visible` 不是 SDK 属性（`show`/`hide` 是继承来的方法），必须显式标成 `null`。
 *
 * 其余字段与描述符键同名，走缺省（`useOverlaySpec` 的缺省是「同名」，而不是按命名规律推断语义）。
 */
export const MARKER_DESCRIPTOR_KEYS: Partial<Record<keyof BMarkerProps & string, string | null>> = {
  position: "position",
  visible: null,
};

type DragEndEvent = {
  point?: { lng: number; lat: number };
};

export interface MarkerSpecDeps {
  /** 组件的 `emit`（动态名在这里集中收窄一次）。 */
  readonly emit: (name: string, payload: unknown) => void;
  /**
   * 位置模型的读取器。
   *
   * 用**读取器**而不是值：`useOverlaySpec` 的返回值要在 spec 之后才拿到，而 `dragend` 处理器
   * 是运行时才被调用的，因此可以晚绑定（避免「先造 spec 再造模型」的循环依赖）。
   */
  readonly position: () => OverlayPositionModel | null;
}

/**
 * 从 `dragend` 载荷里取出新位置。
 *
 * 读的是**归一化后**的 `point`（不是 raw 载荷）：官方 `MarkerEventMap.dragend` 的类型是
 * `OverlayMouseEvent<Marker>`，其中 `point: Point` 与 `pixel: Pixel` 都是**必填**——
 * 也就是说「dragend 一定带地理坐标」是上游声明的契约，本库的
 * `driver/normalize/events.ts` 就是按这份契约把它归一化成 `point` 的。
 *
 * 数值守卫留给 JS / `any` 调用方（类型被绕过时 `point` 可能不是点）：拿不到合法点就
 * **不**回写模型——猜一个位置比不更新更糟。
 */
function readDragEndPoint(event: unknown): { lng: number; lat: number } | null {
  const point = (event as DragEndEvent | null | undefined)?.point;
  if (!point || typeof point.lng !== "number" || typeof point.lat !== "number") return null;
  return { lng: point.lng, lat: point.lat };
}

export function createMarkerSpec(deps: MarkerSpecDeps): OverlaySpec<BMarkerProps, MarkerHandle> {
  return {
    type: "marker",
    targetKind: "marker",
    fields: MARKER_FIELDS,
    descriptorKeys: MARKER_DESCRIPTOR_KEYS,
    create: (context, p) =>
      context.client.driver.overlays.createMarker(p.position, {
        offset: p.offset,
        title: p.title,
        enableClicking: p.enableClicking,
        enableDragging: p.enableDragging,
        rotation: p.rotation,
        zIndex: p.zIndex,
        icon: p.icon,
      }),
    events: [
      { sdk: "click", emit: "click" },
      { sdk: "dblclick", emit: "dblclick" },
      { sdk: "rightclick", emit: "rightclick" },
      { sdk: "mousedown", emit: "mousedown" },
      { sdk: "mouseup", emit: "mouseup" },
      { sdk: "mouseover", emit: "mouseover" },
      { sdk: "mouseout", emit: "mouseout" },
      { sdk: "dragstart", emit: "dragstart" },
      { sdk: "dragging", emit: "dragging" },
      {
        sdk: "dragend",
        handle: (event) => {
          deps.emit("dragend", event);
          // `drag-end` 是历史别名（kebab 拼写），与 `dragend` 一起发；两者都不是 `update:position`
          deps.emit("drag-end", event);
          const point = readDragEndPoint(event);
          if (!point) return;
          // 只有**真的变了**才 emit：SDK 重复派发同一位置不应产生新的 update（回环抑制的模型侧）
          if (deps.position()?.observeFromSdk(point)) deps.emit("update:position", point);
        },
      },
      { sdk: "remove", emit: "remove" },
    ],
  };
}
