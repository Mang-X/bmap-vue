/**
 * GroundOverlay 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["ground-overlay"]`） |
 * | --- | --- | --- | --- |
 * | `bounds` | `options` | `setBounds`（`value: "bounds"`） | `mutateBy("setBounds", { ctorKey: null })` |
 * | `type` | `recreate` | 构造期选项（`image` / `video` / `canvas`） | 实例上没有 `setType` |
 * | `url` | `options` | `setImage`（`value` 经**值投影**解掉惰性工厂） | `mutateBy("setImage", { ctorKey: "url" })` |
 * | `opacity` | `options` | `setOpacity` | `mutateBy("setOpacity", …)` |
 * | `autoCenter` | `recreate` | 组件侧行为（构造后按区域居中地图） | 不是 SDK 选项 |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * ## 两处值得单独说明
 *
 * 1. **`bounds` 是唯一几何入口**：上游是 `createGroundOverlay(bounds, options)`，与驱动、官方
 *    参考实现同形。旧的两个角点 prop 已随集中弃用层在 #136 删除，因此内部只有 `bounds` 一份事实，
 *    不存在「两套几何模型」。
 * 2. **`url` 的惰性工厂**：`type: "canvas"` 的用法是传 `() => canvas`。工厂与 `stableKeyOf`
 *    不兼容（函数被折叠成常量），因此它的 watch 源是 `"reference"`（只比引用），值投影保证
 *    交给 SDK 的永远是真实来源。
 * 3. **`autoCenter` 走 `afterMount`**：它是「创建完成后按显示区域居中地图」，不是字段更新，
 *    因此只在挂载后执行一次。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { GroundOverlayProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const GROUND_OVERLAY_FIELDS: OverlayFieldMap<GroundOverlayProps> = {
  bounds: "options",
  type: "recreate",
  url: "options",
  opacity: "options",
  autoCenter: "recreate",
  ...VISIBILITY_FIELD,
};

export const GROUND_OVERLAY_WATCH_SOURCES = {
  // 惰性工厂不可序列化：只比引用（换了一个工厂必须重新求值）
  url: "reference",
} as const;

export const GROUND_OVERLAY_DESCRIPTOR_KEYS = {
  bounds: "bounds",
  url: "url",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * `url` 的值投影：工厂只在**创建 / 显式替换**时求值一次，绝不把函数交给 `setImage`。
 */
export const GROUND_OVERLAY_FIELD_VALUES = {
  url: (value: unknown) => (typeof value === "function" ? value() : value),
} as const;

export function createGroundOverlaySpec(): OverlaySpec<GroundOverlayProps, OverlayHandle> {
  return {
    type: "ground-overlay",
    kind: "ground-overlay",
    fields: GROUND_OVERLAY_FIELDS,
    descriptorKeys: GROUND_OVERLAY_DESCRIPTOR_KEYS,
    watchSources: GROUND_OVERLAY_WATCH_SOURCES,
    fieldValues: GROUND_OVERLAY_FIELD_VALUES,
    create: (context, p) => {
      if (!p.bounds) {
        throw new Error("GroundOverlay 需要 bounds（{ southwest, northeast }）");
      }
      // **只读一次 `url`**（PR #103 评审 2）：`fieldValues` 的投影是「每次读取求值一次」，
      // 而惰性工厂每求值一次就新建一份 canvas ⇒ 读两次会让「校验的对象」与「交给 SDK 的对象」
      // 变成两个不同实例（旧实现是先 `resolveUrl()` 再复用）。需要单次求值的字段都由调用点
      // 自己取一次，这是 `fieldValues` 的显式契约（见 `OverlaySpec.fieldValues` 的 JSDoc）。
      const url = p.url;
      if (!url) {
        throw new Error("GroundOverlay url is required");
      }
      return context.client.driver.overlays.createGroundOverlay(p.bounds, {
        opacity: p.opacity,
        type: p.type,
        url,
      });
    },
    afterMount: (context, _resource, p) => {
      if (!p.autoCenter || !p.bounds) return;
      context.client.driver.map.setViewport(
        context.map,
        [p.bounds.southwest, p.bounds.northeast],
        { margins: [20, 20, 20, 20] },
      );
    },
  };
}
