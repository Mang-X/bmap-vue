/**
 * BGroundOverlay 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["ground-overlay"]`） |
 * | --- | --- | --- | --- |
 * | `bounds` | `options` | `setBounds`（`value: "bounds"`） | `mutateBy("setBounds", { ctorKey: null })` |
 * | `startPoint` / `endPoint` | `alias` | **旧名**：由集中弃用层解析成 `bounds`，自身不下发 | 不是 SDK 属性（不经描述符） |
 * | `type` | `recreate` | 构造期选项（`image` / `video` / `canvas`） | 实例上没有 `setType` |
 * | `url` | `options` | `setImage`（`value` 经**值投影**解掉惰性工厂） | `mutateBy("setImage", { ctorKey: "url" })` |
 * | `opacity` | `options` | `setOpacity` | `mutateBy("setOpacity", …)` |
 * | `autoCenter` | `recreate` | 组件侧行为（构造后按区域居中地图） | 不是 SDK 选项 |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * ## 三处值得单独说明
 *
 * 1. **`bounds` 取代 `startPoint` + `endPoint`**：上游是 `createGroundOverlay(bounds, options)`，
 *    与驱动、官方参考实现同形。旧名仍可用，但只是在**读取层**被解析（新 API 优先 + 同实例一次告警），
 *    因此不存在「两套几何模型」——内部始终只有 `bounds` 一份事实。
 * 2. **`url` 的惰性工厂**：`type: "canvas"` 的用法是传 `() => canvas`。工厂与 `stableKeyOf`
 *    不兼容（函数被折叠成常量），因此它的 watch 源是 `"reference"`（只比引用），值投影保证
 *    交给 SDK 的永远是真实来源。
 * 3. **`autoCenter` 走 `afterMount`**：它是「创建完成后按显示区域居中地图」，不是字段更新，
 *    因此只在挂载后执行一次（与迁移前 `addToMap` 里那段逻辑同位）。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { BGroundOverlayProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const GROUND_OVERLAY_FIELDS: OverlayFieldMap<BGroundOverlayProps> = {
  bounds: "options",
  // 旧名：由 core/deprecations 的别名表在读取层解析（`assertOverlayFieldDeclarations` 会核对登记）
  startPoint: "alias",
  endPoint: "alias",
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
  startPoint: null,
  endPoint: null,
  url: "url",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * `url` 的值投影：工厂只在**创建 / 显式替换**时求值一次，绝不把函数交给 `setImage`。
 *
 * 与迁移前 `resolveUrl()` 的位置不同（那时在组件里、且更新路径另写一次），现在只有这一处。
 */
export const GROUND_OVERLAY_FIELD_VALUES = {
  url: (value: unknown) => (typeof value === "function" ? value() : value),
} as const;

export function createGroundOverlaySpec(): OverlaySpec<BGroundOverlayProps, OverlayHandle> {
  return {
    type: "ground-overlay",
    kind: "ground-overlay",
    fields: GROUND_OVERLAY_FIELDS,
    descriptorKeys: GROUND_OVERLAY_DESCRIPTOR_KEYS,
    watchSources: GROUND_OVERLAY_WATCH_SOURCES,
    fieldValues: GROUND_OVERLAY_FIELD_VALUES,
    create: (context, p) => {
      // `bounds` 已经过别名解析：只给旧名（`startPoint` + `endPoint`）时这里也能拿到值
      if (!p.bounds) {
        throw new Error(
          "BGroundOverlay 需要 bounds（{ southwest, northeast }），或旧的 startPoint + endPoint 组合",
        );
      }
      if (!p.url) {
        throw new Error("BGroundOverlay url is required");
      }
      return context.client.driver.overlays.createGroundOverlay(p.bounds, {
        opacity: p.opacity,
        type: p.type,
        url: p.url,
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
