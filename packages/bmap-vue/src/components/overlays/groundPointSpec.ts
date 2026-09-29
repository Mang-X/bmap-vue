/**
 * GroundPoint 的 `OverlaySpec` 声明（issue #178）
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["ground-point"]`，逐条对 `overlay/GroundPoint.d.ts` 的实例方法表） |
 * | --- | --- | --- | --- |
 * | `point` | `position` | `driver.overlays.setPosition` → 描述符解析到 **`setPoint`** | `GroundPoint.d.ts:29` `setPoint(point, update?)` |
 * | `scale` | `options` | `setScale` | `GroundPoint.d.ts:39` |
 * | `size` | `options` | `setSize`（`value: "size-shape"`） | `GroundPoint.d.ts:49` |
 * | `rotation` | `options` | `setRotation` | `GroundPoint.d.ts:59` |
 * | `anchor` | `options` | `setAnchor`（`value: "size-shape"`） | `GroundPoint.d.ts:69` |
 * | `offset` | `options` | `setOffset`（`value: "size-shape"`） | `GroundPoint.d.ts:79` |
 * | `url` | `options` | `setImage` | `GroundOverlay.d.ts:62`（继承） |
 * | `opacity` | `options` | `setOpacity` | `GroundOverlay.d.ts:48`（继承） |
 * | `displayOnMinLevel` | `options` | `setDisplayOnMinLevel` | `GroundOverlay.d.ts:82`（继承） |
 * | `displayOnMaxLevel` | `options` | `setDisplayOnMaxLevel` | `GroundOverlay.d.ts:95`（继承） |
 * | `zIndex` | `options` | `setZIndex` | `GroundOverlay.d.ts:104`（继承） |
 * | `enableMassClear` | `options` | 成对开关 | `GroundOverlay.d.ts:108/112`（继承） |
 * | `level` | `recreate` | 构造期 | 6 个 setter 里**没有** `setLevel` |
 * | `enableClicking` | `recreate` | 构造期 | 无 `setEnableClicking`，也无成对开关 |
 * | `top` | `recreate` | 构造期 | 无 `setTop`（`setZIndex` 语义不同，不能顶替） |
 * | `visible` | `visibility` | `show`/`hide` | 继承自 `Overlay` 基类，不是描述符键 |
 *
 * ## 为什么 `point` 走 `position` 策略而不是 `options`
 *
 * `"position"` 与 `"options"` 的差别不在落地方法（两者最终都会打到 `setPoint`），而在
 * **双向同步 + 回环抑制**：`position` 策略让 SDK 侧回读的位置能写回 prop，且父级传同一个
 * 对象时不会产生自激循环。位置是贴地点最常变的字段，因此按位置处理。
 *
 * ## 为什么三个尺寸字段用 `size-shape` 而不是 `size`
 *
 * 官方 `GroundPointOptions` 的 `size` / `anchor` / `offset` 声明为 `Size`（`{width, height}`），
 * 而图形族偏移那一档（`MarkerProps.offset`）在组件侧是 `Pixel`（`{x, y}`）——那是本库的**历史**
 * 约定，不是官方形状。两者若共用一档，`useOverlaySpec` 的 watch 键会按 `pixelKey` 读 `x` / `y`，
 * `{width, height}` 恒被判成「没变」⇒ 更新被静默吞掉。详见 `driver/types/overlays.ts`
 * 的 `size-shape` 档注释。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { GroundPointProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const GROUND_POINT_FIELDS: OverlayFieldMap<GroundPointProps> = {
  point: "position",
  // ---- `GroundPointOptions` 自带的 6 个键（都有实例 setter）----
  size: "options",
  anchor: "options",
  offset: "options",
  scale: "options",
  rotation: "options",
  // ---- `GroundOverlayOptions` 继承来的键 ----
  url: "options",
  opacity: "options",
  displayOnMinLevel: "options",
  displayOnMaxLevel: "options",
  zIndex: "options",
  enableMassClear: "options",
  // ---- 构造期三键（实例成员表上没有对应 setter）----
  level: "recreate",
  enableClicking: "recreate",
  top: "recreate",
  ...VISIBILITY_FIELD,
};

export const GROUND_POINT_DESCRIPTOR_KEYS = {
  // `position` 是「组件侧语义名」，描述符里的键叫 `point`（对应官方 `setPoint`）。
  // 不写这条映射的话，`setPosition` 会按语义键 `position` 查描述符并落空。
  point: "point",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createGroundPointSpec(): OverlaySpec<GroundPointProps, OverlayHandle> {
  return {
    type: "ground-point",
    kind: "ground-point",
    fields: GROUND_POINT_FIELDS,
    descriptorKeys: GROUND_POINT_DESCRIPTOR_KEYS,
    create: (context, p) => {
      if (!p.point || typeof p.point.lng !== "number" || typeof p.point.lat !== "number") {
        throw new Error("GroundPoint 需要 point（{ lng, lat }）");
      }
      // `point` 是构造器的**位置参数**（`constructor(point, opts?)`），描述符里 `ctorKey: null`
      // ⇒ `projectOptions` 会把它从 options 里剔除，这里只把其余键交给构造器。
      return context.client.driver.overlays.createGroundPoint(p.point, {
        size: p.size,
        anchor: p.anchor,
        offset: p.offset,
        scale: p.scale,
        rotation: p.rotation,
        level: p.level,
        url: p.url,
        opacity: p.opacity,
        displayOnMinLevel: p.displayOnMinLevel,
        displayOnMaxLevel: p.displayOnMaxLevel,
        zIndex: p.zIndex,
        // 官方默认是 `true` 的两项在 SFC 的 `withDefaults` 里钉成 `undefined`，
        // 因此未给时不会进入构造选项，由 SDK 沿用自己的默认。
        enableMassClear: p.enableMassClear,
        enableClicking: p.enableClicking,
        top: p.top,
      });
    },
  };
}
