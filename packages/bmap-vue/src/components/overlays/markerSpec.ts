/**
 * Marker 的 `OverlaySpec` 声明（M5-SPEC-MARKER / issue #30）
 *
 * 从 SFC 里抽出来是为了**可测**：`tests/behavior/overlay-spec.test.ts` 要拿 `fields` 与
 * `MarkerProps` 的键集、以及 Driver 的属性描述符逐条交叉核对。放在 `.vue` 里就只能靠人眼。
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
import { createMarkerCommands } from "../../core/overlays/overlayCommands";
import type { OverlayCommandContext } from "../../core/overlays/overlayCommands";
import type { MarkerProps } from "../../types/components";

/**
 * prop → 更新策略。
 *
 * 类型是 `OverlayFieldMap<MarkerProps>`（映射类型带 `-?`）：**漏一个 prop 就编译失败**，
 * 因此「Marker 所有公开属性都有明确更新策略」是编译期保证，不是文档承诺。
 */
export const MARKER_FIELDS: OverlayFieldMap<MarkerProps> = {
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
export const MARKER_DESCRIPTOR_KEYS: Partial<Record<keyof MarkerProps & string, string | null>> = {
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

export function createMarkerSpec(deps: MarkerSpecDeps): OverlaySpec<MarkerProps, MarkerHandle> {
  return {
    type: "marker",
    // 事件面由事件矩阵给出（`MarkerEventMap` 的 11 个事件）；这里只覆盖 `dragend` 的处置方式。
    // 清单与载荷档见 core/overlays/overlayEventCatalog.ts 与 docs/zh-CN/components/overlay/events.md
    kind: "marker",
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

    /**
     * 命令面（#165 Class 3 / TASK 2a）。
     *
     * 逐条依据（`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/Marker.d.ts`）：
     *
     * | 暴露 | 官方声明 | 为什么不能走 prop |
     * | --- | --- | --- |
     * | `getRank()` | `getRank(): number` | **读回**：组件永远不会替调用方读 |
     * | `setRank(n)` | `setRank(rank: number): void` | 无对应 prop（它是「避让权重」，不是几何 / 样式） |
     * | `setRotationOrigin(a)` | `setRotationOrigin(angle: number): void` | 同上；`rotation` 是**图形本身**的转角，原点是**锚点** |
     * | `getTitle()` | `getTitle(): string` | 读回（`title` prop 是写入口） |
     * | `getOffset()` | `getOffset(): Size` | 读回；**返回领域 Pixel**（`{x, y}`），不是 raw `BMap.Size` |
     * | `getRotation()` | `getRotation(): number` | 读回（`rotation` prop 是写入口） |
     * | `getPosition()` | `getPosition(): Point` | 读回（`position` prop 是**受控**入口，用户拖动后的真值只能这样取） |
     * | `closePlaceDetail()` | `closePlaceDetail(): void` | 动作，无参数、无对应 prop |
     *
     * **刻意不暴露**的两条（逐条依据见 `driver/types/overlays.ts` 的 `MarkerReadBackApi`）：
     * - `openPlaceDetail(placeDetail)`：入参是 raw `BMap.PlaceDetail`，本库**没有**这个
     *   Driver 资源（它只在 `./ui-kit` 子入口，而那一族不能进根模块图）；
     * - `setLabel(label)` / `getLabel()`：入参 / 返回值都是 raw `BMap.Label`。本库的 `<Label>`
     *   是**独立组件**（自带 own scope / Registry 记账），把一个 `BMap.Label` 实例从外部塞进来
     *   会绕开那套归属——要么交出 raw 对象（违反边界），要么造第二个「可以脱离组件存在的
     *   Label」（无归属、无释放路径）。因此给 `any` 形参被明确拒绝。
     */
    expose: (exposeCtx) => createMarkerCommands(exposeCtx),
    events: [
      {
        sdk: "dragend",
        handle: (event) => {
          deps.emit("dragend", event);
          // `drag-end` 是历史别名，由集中弃用层在派发后补发（一次告警）；
          // 两者都不是 `update:position` 的替代。
          const point = readDragEndPoint(event);
          if (!point) return;
          // 只有**真的变了**才 emit：SDK 重复派发同一位置不应产生新的 update（回环抑制的模型侧）
          if (deps.position()?.observeFromSdk(point)) deps.emit("update:position", point);
        },
      },
    ],
  };
}
