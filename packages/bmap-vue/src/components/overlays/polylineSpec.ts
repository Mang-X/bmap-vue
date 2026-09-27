/**
 * Polyline 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.polyline`） |
 * | --- | --- | --- | --- |
 * | `points` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `pathVersion` | `version` | **版本令牌**：只作为 `points` 的 watch 源之一 | 不是 SDK 属性（不经描述符） |
 * | `strokeColor` / `strokeWeight` / `strokeOpacity` / `strokeStyle` | `options` | 各自的 setter | `PATH_STYLE` |
 * | `enableMassClear` / `enableEditing` | `options` | 成对开关 | `PATH_STYLE` |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 * | ↓ **issue #165 补的十个，全部 `recreate`**（官方没有对应 setter，改 prop 即重建） |||
 * | `enableClicking` | `recreate` | 构造期选项 | 官方无 `enableClicking()` / `disableClicking()` 成对开关 |
 * | `strokeLineCap` / `strokeLineJoin` | `recreate` | 构造期选项 | ⚠️ **live 读数**：原型链 layer 2 上有同名 setter、调得动，但**调完 `getStrokeStyle()` 不变**且官方无读回 ⇒ 可观察地**不生效** ⇒ 仍是构造期（`mutateBy` = 静默假支持） |
 * | `geodesic` | `recreate` | 构造期选项 | 无 `setGeodesic`；它决定**路径本身**（两点怎么连） |
 * | `linkRight` | `recreate` | 构造期选项 | 无 `setLinkRight`；是绘制算法的输入 |
 * | `clip` | `recreate` | 构造期选项 | 无 `setClip`；是**渲染期裁剪**，不是几何 |
 * | `coordType` | `recreate` | 构造期选项 | 无 `setCoordType`；决定**输入点怎么解读**，构造后无从改 |
 * | `dashArray` | `recreate` | 构造期选项 | 无 `setDashArray`，也**无** `setDash` |
 * | `icons` | `recreate` | 构造期选项 | 无 `setIcons`；⚠️ 官方 `IconSequence` **已 `@deprecated`**（4.0 起改用 `strokeTexture`） |
 * | `strokeTexture` | `recreate` | 构造期选项 | 无 `setStrokeTexture`；官方注明**仅 WebGL 渲染模式支持** |
 *
 * ## `points` 为什么不是内容指纹
 *
 * `points` 是**大数组**（路线动辄上万点）。按内容取指纹意味着每次父级渲染都做一次 O(n) 序列化，
 * 而「路径变了没有」本来就有更便宜的答案：**根引用 + `pathVersion`**
 * （`watchSources: { points: { source: "versioned", versionProp: "pathVersion" } }`）。
 * 两种写法都在用：替换根引用（不可变风格）与原地改数组 + 递增 `pathVersion`。
 *
 * ## 事件面（17 个）来自 `GraphEventMap`
 *
 * 包括编辑六件套（`editstart` / `editend` / `linevertexdrag*` / `linevertexdel`）与
 * `lineupdate`。上游把它们声明在图形族的公共表里，而 **Prism / BezierCurve 的同类表把它们 Omit 掉了**
 * （SDK 没有 `enableEditing`）——这条能力边界由事件矩阵表达，组件不需要知道。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { PolylineHandle } from "../../driver/types/handles";
import {
  createPathCommands,
  createPathReadBacks,
} from "../../core/overlays/overlayCommands";
import type { PolylineProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_COORD_TYPE_FIELD,
  PATH_DASH_ARRAY_FIELD,
  PATH_LINE_JOINT_FIELDS,
  PATH_LINK_RIGHT_FIELD,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  PATH_ZINDEX_FIELD,
  POLYLINE_ONLY_CTOR_FIELDS,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const POLYLINE_FIELDS: OverlayFieldMap<PolylineProps> = {
  points: "options",
  pathVersion: "version",
  ...PATH_STROKE_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_ZINDEX_FIELD,
  // ↓ issue #165 图形族补齐：Polyline 一次补上**十个**官方选项（4.0.5 的 PolylineOptions 共 17 个，
  // 此前覆盖 7 个）。逐条分类依据见文件头的表与 `driver/types/overlays.ts` 的 `PATH_CTOR_*`。
  ...PATH_CLICKING_FIELD,
  ...PATH_COORD_TYPE_FIELD,
  ...PATH_DASH_ARRAY_FIELD,
  ...PATH_LINE_JOINT_FIELDS,
  ...PATH_LINK_RIGHT_FIELD,
  ...POLYLINE_ONLY_CTOR_FIELDS,
  ...VISIBILITY_FIELD,
};

/**
 * `points` 的 watch 源：根引用 + `pathVersion`（大数组不做内容指纹，理由见文件头）。
 */
export const POLYLINE_WATCH_SOURCES = {
  points: { source: "versioned", versionProp: "pathVersion" },
} as const;

export const POLYLINE_DESCRIPTOR_KEYS = {
  points: "path",
  pathVersion: null,
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * 构造期选项的袋（issue #165 图形族补齐）。
 *
 * ## 为什么这十项要走条件展开而不是直接写 `{ enableClicking: p.enableClicking }`
 *
 * `Polyline` 的 `points`（以及 `dashArray` / `icons` / `strokeTexture`）是**数组 / 对象**，
 * 而 `enableClicking` / `geodesic` / `linkRight` / `clip` / `strokeLineCap` / `strokeLineJoin` /
 * `coordType` 是标量。**两类都要「未给即键不存在」**，理由各不同：
 *
 * - **数组类**：Driver 的 `projectOptions` 按**键**投影并跳过 `undefined` 值，
 *   但一个 `undefined` 的数组在 `dashArray` 上会走 `value: "raw"` 的原样透传——
 *   跳过与否取决于值而不是键，写不写条件展开**结果一样**，写出来只是为了与
 *   `PointCollection.vue` / `PointLayer.vue` 的既有写法**同形**（可读性，不是行为）。
 * - **标量类**：`clip` / `linkRight` / `enableClicking` 的**官方默认是 `true`**。
 *   Vue 的 `Boolean` prop 未给时运行时是 `false`——若写 `{ clip: p.clip }` 而 SFC 的
 *   `withDefaults` 忘了钉 `undefined`，这里就会把 `false` 真真切切送进 SDK，
 *   **与官方默认相反**。条件展开 + SFC 的 `withDefaults` 双重保证「没表态 ⇒ 键不存在」，
 *   让 SDK 沿用它自己的 `true`。
 *
 * 逐条分类依据见 `driver/types/overlays.ts` 的 `PATH_CTOR_*` 与 `OVERLAY_DESCRIPTORS.polyline`。
 */
function ctorOptions(p: Readonly<PolylineProps>): Record<string, unknown> {
  return {
    strokeColor: p.strokeColor,
    strokeWeight: p.strokeWeight,
    strokeOpacity: p.strokeOpacity,
    strokeStyle: p.strokeStyle,
    zIndex: p.zIndex,
    enableMassClear: p.enableMassClear,
    enableEditing: p.enableEditing,
    ...(p.enableClicking === undefined ? {} : { enableClicking: p.enableClicking }),
    ...(p.strokeLineCap === undefined ? {} : { strokeLineCap: p.strokeLineCap }),
    ...(p.strokeLineJoin === undefined ? {} : { strokeLineJoin: p.strokeLineJoin }),
    ...(p.geodesic === undefined ? {} : { geodesic: p.geodesic }),
    ...(p.linkRight === undefined ? {} : { linkRight: p.linkRight }),
    ...(p.clip === undefined ? {} : { clip: p.clip }),
    ...(p.coordType === undefined ? {} : { coordType: p.coordType }),
    ...(p.dashArray === undefined ? {} : { dashArray: p.dashArray }),
    ...(p.icons === undefined ? {} : { icons: p.icons }),
    ...(p.strokeTexture === undefined ? {} : { strokeTexture: p.strokeTexture }),
  };
}

export function createPolylineSpec(): OverlaySpec<PolylineProps, PolylineHandle> {
  return {
    type: "polyline",
    kind: "polyline",
    fields: POLYLINE_FIELDS,
    descriptorKeys: POLYLINE_DESCRIPTOR_KEYS,
    watchSources: POLYLINE_WATCH_SOURCES,
    create: (context, p) => context.client.driver.overlays.createPolyline(p.points, ctorOptions(p)),
    /**
     * 命令面（#165 Class 3 / TASK 2g）：官方声明的**读回**。
     *
     * 写这一侧（`setPath` / 描边填充 setter / `setZIndex`）已由 `path` / 样式 / `zIndex`
     * 这些**受控 prop** 覆盖，#165 §5-C 明确「能改 prop」不算实现同名方法，因此不重复暴露。
     * 读这一侧没有任何 prop 能替代 —— 组件永远不会替调用方读一次。
     *
     * ⚠️ 不镜像成组件状态（官方 getter 给的是**当前值**而不是 SDK 默认值）。
     *
     * 另外给 `setPositionAt`（官方 `Polyline.d.ts`：`setPositionAt(index: number, point: Point): void`）
     * ——它**没有**对应 prop：`path` 只能整体替换，而「只动第 i 个顶点」是官方独有的粒度。
     * 注意它**不**写回 `props.path`（详见 `core/overlays/overlayCommands.ts` 的 `PathCommandApi`）。
     */
    expose: (exposeCtx) => ({
      ...createPathReadBacks(exposeCtx, { fill: false }),
      ...createPathCommands(exposeCtx),
    }),
  };
}
