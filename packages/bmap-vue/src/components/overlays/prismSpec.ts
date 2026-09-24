/**
 * Prism 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.prism`） |
 * | --- | --- | --- | --- |
 * | `path` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `altitude` | `options` | `setAltitude` | `mutateBy("setAltitude", { ctorKey: null })` |
 * | `topFillColor` / `topFillOpacity` / `sideFillColor` / `sideFillOpacity` | `options` | 各自的 setter | 描述符逐个列出 |
 * | `enableMassClear` | `options` | 成对开关 | 描述符 |
 * | `isBoundary` / `autoCenter` | `recreate` | 构造期透传 | **未取证**：`PrismOptions`（4.0.4）里没有这两个键 |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * ## 两个「未取证」的构造期 prop 为什么不删也不假装支持
 *
 * 它们是 v2 就有的公开 prop，迁移前原样进构造选项。4.0.4 的 `PrismOptions` 里没有它们，
 * 而本库没有运行时证据说 SDK 会读（也没有证据说不读）。处置是三条一起：
 *
 * 1. **不删**（删掉会让已发布的用法静默失效，且删除本身也没有运行时依据）；
 * 2. **不声称支持**：分类是 `recreate`（构造期透传）+ 描述符的 `reason` 里写明「未取证」，
 *    ADR 的已知限制里也列出来；
 * 3. **不给字段级更新**：没有 `setIsBoundary` 之类入口，改变它只能重建——与迁移前「只有构造期
 *    生效」的实际行为一致。
 *
 * ## `path` 用内容指纹（而不是版本令牌）
 *
 * Prism 的 path 是**建筑底面轮廓**（几十个点），不是路线；组件也没有 `pathVersion` prop
 * （不新增公开面）。因此这里显式声明 `"fingerprint"`：既做了「父级传内联数组不产生多余命令」
 * 的判等，又不必为它引入第二个版本令牌。
 *
 * ## 事件面（11 个）来自 `GraphEventMap` Omit 编辑六件套
 *
 * 官方参考明确「Prism 不实现编辑能力」：上游事件表把 `editstart` / `editend` / `linevertexdrag*` /
 * `linevertexdel` 都 Omit 掉了，本组件也不暴露 `enableEditing`。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { PrismProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const PRISM_FIELDS: OverlayFieldMap<PrismProps> = {
  path: "options",
  altitude: "options",
  topFillColor: "options",
  topFillOpacity: "options",
  sideFillColor: "options",
  sideFillOpacity: "options",
  isBoundary: "recreate",
  autoCenter: "recreate",
  enableMassClear: "options",
  ...VISIBILITY_FIELD,
};

export const PRISM_WATCH_SOURCES = {
  // 显式写出来（而不是依赖缺省）：这两条与「大数组用版本令牌」的规则不同，需要被评审看见
  path: "fingerprint",
} as const;

export const PRISM_DESCRIPTOR_KEYS = {
  path: "path",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createPrismSpec(): OverlaySpec<PrismProps, OverlayHandle> {
  return {
    type: "prism",
    kind: "prism",
    fields: PRISM_FIELDS,
    descriptorKeys: PRISM_DESCRIPTOR_KEYS,
    watchSources: PRISM_WATCH_SOURCES,
    create: (context, p) => {
      if (!p.path?.length) {
        throw new Error("Prism path is required");
      }
      return context.client.driver.overlays.createPrism(p.path, p.altitude, {
        topFillColor: p.topFillColor,
        topFillOpacity: p.topFillOpacity,
        sideFillColor: p.sideFillColor,
        sideFillOpacity: p.sideFillOpacity,
        isBoundary: p.isBoundary,
        autoCenter: p.autoCenter,
        enableMassClear: p.enableMassClear,
      });
    },
  };
}
