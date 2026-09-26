/**
 * #165 Class 1「我们已有的参数，但命名与官方不同的，直接修」的**类型面**契约。
 *
 * ## 钉住什么
 *
 * 官方 `@baidumap/jsapi-v4-types@4.0.5` 已经为下面这几个概念给出了**唯一**的名字，
 * 而我们此前用的是 v2 时代的叫法。逐条依据（改名前先核对过 d.ts 原文）：
 *
 * | 概念 | 我们的旧名 | 官方名 | 官方声明出处 |
 * | --- | --- | --- | --- |
 * | 折线的坐标点数组 | `path` | **`points`** | `overlay/Polyline.d.ts:26` `constructor(points: Array<Point>, opts?)` |
 * | 多边形的坐标点数组 | `path` | **`points`** | `overlay/Polygon.d.ts:30` `constructor(points: Array<Point> \| Array<Array<Point>>, opts?)` |
 * | 贝塞尔曲线的路径点 | `path` | **`points`** | `overlay/BezierCurve.d.ts:21` `constructor(points, controlPoints, opts?)` |
 * | 棱柱的坐标点数组 | `path` | **`points`** | `overlay/Prism.d.ts:25` `constructor(points: Array<Point> \| Array<Array<Point>>, altitude, opts?)` |
 * | Map 构造期：双击缩放 | `enableDoubleClickZoom` | **`enableDblclickZoom`** | `core/MapOptions.d.ts` `enableDblclickZoom?: boolean` |
 * | Map 构造期：滚轮 / 触摸板缩放 | `enableScrollWheelZoom` | **`enableWheelZoom`** | `core/MapOptions.d.ts` `enableWheelZoom?: boolean` |
 * | Map 构造期：手势缩放 | `enablePinchToZoom` | **`enablePinchZoom`** | `core/MapOptions.d.ts` `enablePinchZoom?: boolean` |
 * | Map 构造期：容器 resize 时中心点不变 | `enableResizeOnCenter` | **`fixCenterWhenResize`** | `core/MapOptions.d.ts` `fixCenterWhenResize?: boolean` |
 * | DistrictLayer：自动取景 | `viewport` | **`autoViewport`** | `layer/DistrictLayer.d.ts:151` `autoViewport?: boolean` |
 * | PointCollection：图形类型 | `shape` | **`shapeType`** | `layer/PointShapeLayer.d.ts:102` `shapeType?: number \| StyleExpress` |
 *
 * ⚠️ **官方对同一个概念给了两个名字**（这正是四个交互 prop 不能照抄「官方方法名」的原因）：
 * `Map` 的**实例方法**叫 `enableDoubleClickZoom()` / `disableDoubleClickZoom()` /
 * `enableScrollWheelZoom()` / `disableScrollWheelZoom()` / `enablePinchToZoom()` /
 * `disablePinchToZoom()` / `enableResizeOnCenter()` / `disableResizeOnCenter()`
 * （`core/Map.d.ts:43,47,67,71,75,79,91,95`），而 `MapOptions` 的**构造期键**叫
 * `enableDblclickZoom` / `enableWheelZoom` / `enablePinchZoom` / `fixCenterWhenResize`。
 * 本库的 prop 是**构造期语义**的（创建时写进 options / 建图后按方法落一次），因此取
 * **`MapOptions` 那一组**；实例方法名保持不变（Driver 仍按方法调用，见
 * `driver/jsapi-v4/map.ts` 的 `INTERACTION_METHODS`）。这与「官方优先」不冲突：同一个官方
 * 面内的构造期键与运行时方法本来就可以不同名，我们只跟着**所在的那一面**走。
 *
 * ## 为什么不带兼容别名
 *
 * #165 §3.6：1.0 是 clean slate，**不加** deprecated 别名 / shim / 第二个入口。旧名直接删除。
 * 本文件因此对旧名用 `@ts-expect-error` 钉死——旧名还在，本文件立刻红。
 *
 * ## 为什么落在本目录
 *
 * 见 `tsconfig.type-contracts.json` 与 `geocoder-surface.type-test.ts`：放在
 * `tests/behavior/**.test.ts` 里的 `@ts-expect-error` 不被任何 tsc 编译，是恒真的空断言。
 *
 * **判别力是双向的**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红；
 * 正控保证不是在「类型退化成什么都能收」的前提下恒绿。
 */
import type {
  MapProps,
  PolylineProps,
  PolygonProps,
  BezierCurveProps,
  PrismProps,
} from "../../packages/bmap-vue/src/types/components";
// `MapMaskProps` 声明在 SFC 内部（它没有独立的 spec 文件，是唯一仍走 `useOverlayResource`
// 的图形族覆盖物），因此从 SFC 取引用而不是从 `types/components.ts`。
import type { MapMaskProps } from "../../packages/bmap-vue/src/components/overlays/MapMask.vue";

/* ============================================================ 1. 坐标点数组：`path` → `points` */

const points = [
  { lng: 116.3, lat: 39.8 },
  { lng: 116.5, lat: 40 },
];

/** 正控：新名被接受（否则下面全错只是因为导入坏了）。 */
const _polyline: PolylineProps = { points };
const _polygon: PolygonProps = { points };
const _bezier: BezierCurveProps = { points, controlPoints: [points] };
const _prism: PrismProps = { points, altitude: 10 };
void _polyline;
void _polygon;
void _bezier;
void _prism;

/** 反例：四个图形族覆盖物的旧名 `path` 已删除（官方构造参数名是 `points`）。 */
// @ts-expect-error 官方 `Polyline` 的坐标数组参数名是 `points`；`path` 已于 #165 删除
const _polylineOld: PolylineProps = { path: points };
// @ts-expect-error 官方 `Polygon` 的坐标数组参数名是 `points`；`path` 已于 #165 删除
const _polygonOld: PolygonProps = { path: points };
// @ts-expect-error 官方 `BezierCurve` 的坐标数组参数名是 `points`；`path` 已于 #165 删除
const _bezierOld: BezierCurveProps = { path: points, controlPoints: [points] };
// @ts-expect-error 官方 `Prism` 的坐标数组参数名是 `points`；`path` 已于 #165 删除
const _prismOld: PrismProps = { path: points, altitude: 10 };
void _polylineOld;
void _polygonOld;
void _bezierOld;
void _prismOld;

/**
 * 反例：**`path` 已不是「有坐标数组」这个概念的名字**——`MapMask` 也是图形族，官方没有类声明
 * （真实运行时才有构造器），因此它与上面四个一致地取 `points`。这一条同时证明上面四条
 * 不是「只删了某一处的类型」而是概念级改名。
 */
// @ts-expect-error MapMask 的坐标数组同样改名 `points`（官方 4.0 运行时构造器接收点数组）
const _mapMaskOld: MapMaskProps = { path: points };
// 正控：新名被接受
const _mapMask: MapMaskProps = { points };
void _mapMaskOld;
void _mapMask;

/* ================================================================ 2. `<Map>` 四个交互 prop */

/**
 * 正控：四个官方构造期键被接受。
 *
 * ⚠️ `enableWheelZoom` 的**默认值**仍是本库的 `false`（官方 d.ts 的默认是 `true`）——那是
 * 另一条有意决策（见 `driver/jsapi-v4/map.ts` 的 `LIBRARY_MAP_DEFAULTS`），**不在**本次改名范围。
 */
const _mapNew: MapProps = {
  enableDblclickZoom: true,
  enableWheelZoom: false,
  enablePinchZoom: true,
  fixCenterWhenResize: false,
};
void _mapNew;

// @ts-expect-error 官方构造期键是 `enableDblclickZoom`（注意官方拼 `Dbl`）；旧名已删除
const _mapDblOld: MapProps = { enableDoubleClickZoom: true };
// @ts-expect-error 官方构造期键是 `enableWheelZoom`；`enableScrollWheelZoom` 是**实例方法**名，不是构造期键
const _mapWheelOld: MapProps = { enableScrollWheelZoom: true };
// @ts-expect-error 官方构造期键是 `enablePinchZoom`；`enablePinchToZoom` 是**实例方法**名，不是构造期键
const _mapPinchOld: MapProps = { enablePinchToZoom: true };
// @ts-expect-error 官方构造期键是 `fixCenterWhenResize`；`enableResizeOnCenter` 是 v2 时代的叫法（v2 沿用名）
const _mapResizeOld: MapProps = { enableResizeOnCenter: true };
void _mapDblOld;
void _mapWheelOld;
void _mapPinchOld;
void _mapResizeOld;

/* ================================================ 4. 走查新发现的另外两处 Class 1 */

/**
 * 正控：`DistrictLayer` / `PointCollection` 的官方名被接受。
 *
 * 这两处此前**不是**裸的类型差异，而是**已知的命名缺口被 Driver 别名掩盖**：
 * `driver/jsapi-v4/layers.ts` 写着 `aliases: { viewport: "autoViewport" }`、
 * `PointCollection.vue` 写着 `style.shapeType = props.shape`——官方键一直是 `autoViewport` /
 * `shapeType`，只是公开面没跟上。改名之后那两处别名映射一并删除。
 */
import type { DistrictLayerProps } from "../../packages/bmap-vue/src/components/layers/DistrictLayer.vue";

const _district: DistrictLayerProps = { name: "(北京市)", autoViewport: true };
void _district;

// @ts-expect-error 官方构造选项是 `autoViewport`；`viewport` 是 4.0 运行时未声明的别名，#165 已删
const _districtOld: DistrictLayerProps = { name: "(北京市)", viewport: true };
void _districtOld;

import type { PointCollectionProps } from "../../packages/bmap-vue/src/types/components";

const _pointCollection: PointCollectionProps<{ id: string }> = {
  data: [],
  itemKey: "id",
  getPosition: () => null,
  shapeType: 7,
};
void _pointCollection;

// 官方 `PointShapeStyle` 的键是 `shapeType`；旧名 `shape` 已于 #165 删除。
// ⚠️ 诊断落在**属性那一行**（TS2353 excess property），因此 `@ts-expect-error` 写在这里——
// 放在 const 那一行会变成 TS2578（unused）。
const _pointCollectionOld: PointCollectionProps<{ id: string }> = {
  data: [],
  itemKey: "id",
  getPosition: () => null,
  // @ts-expect-error 旧名 `shape` 不再是合法键
  shape: 7,
};
void _pointCollectionOld;

/**
 * 正控：`<PointLayer>` 的 `shape` **不动**——那是另一个官方类
 * （`visualization/PointLayer.d.ts:73` 就叫 `shape`），两个组件各按各自的官方类走。
 */
import type { PointLayerProps } from "../../packages/bmap-vue/src/types/components";

const _pointLayer: PointLayerProps<{ id: string }> = {
  data: [],
  itemKey: "id",
  getPosition: () => null,
  shape: "circle",
};
void _pointLayer;

/* ================================================================ 3. 未被改名的键（防「顺手改掉」） */

/**
 * 正控：同族里**不该**被改的键仍然在。
 *
 * 逐条理由（这些都是「我们已刻意偏离官方」或「官方根本没有」，改名会破坏已有契约）：
 *
 * - `RectangleProps.bounds` / `GroundOverlayProps.bounds` —— 官方 ctor 形参就叫 `bounds`
 *   （`overlay/Rectangle.d.ts` `constructor(bounds: Bounds, opts?)`、
 *   `overlay/GroundOverlay.d.ts` `constructor(bounds: Bounds, opts?)`），**本来就是对的**；
 * - `CircleProps.center` / `radius` —— 官方 `constructor(center: Point, radius: number, opts?)`；
 * - `MarkerProps.position` —— 官方 `constructor(point: Point, opts?)` 的形参是 `point`，但
 *   `position` 是本库对「这个位置是受控点」的表达，与 `<DataComponentProps>` 家族一致，
 *   属 Class 4（Vue 适配）——**保持**；
 * - `pathVersion` / `controlPointsVersion` —— 官方**没有**对应概念（它是大数组原地变更的
 *   响应式失效令牌，本库自设计），属 Class 4 保留，**只**改坐标数组的名字。
 */
import type { CircleProps, RectangleProps, GroundOverlayProps, MarkerProps } from "../../packages/bmap-vue/src/types/components";

const _rect: RectangleProps = {
  bounds: { southwest: points[0]!, northeast: points[1]! },
};
const _ground: GroundOverlayProps = {
  bounds: { southwest: points[0]!, northeast: points[1]! },
  type: "image",
  url: "a.png",
};
const _circle: CircleProps = { center: points[0]!, radius: 100 };
const _marker: MarkerProps = { position: points[0]! };
const _polylineVersion: PolylineProps = { points, pathVersion: 1 };
const _bezierControlVersion: BezierCurveProps = { points, controlPoints: [points], controlPointsVersion: 1 };
void _rect;
void _ground;
void _circle;
void _marker;
void _polylineVersion;
void _bezierControlVersion;

/* ================================================================== 5. `mapType` 的取值域 */

/**
 * 正控：官方 `MapTypeId` 的**五个**常量全部被接受。
 *
 * 官方 `map-type/MapTypeId.d.ts` 声明五个静态成员：`BMAP_NORMAL_MAP` / `BMAP_SATELLITE_MAP` /
 * `BMAP_HYBRID_MAP` / `BMAP_EARTH_MAP` / `BMAP_NONE_MAP`。此前只有前三个（外加 EARTH）能
 * 落到 SDK，`BMAP_HYBRID_MAP` 与 `BMAP_NONE_MAP` 被 `toMapType()` **静默降级**成 `normal`——
 * 用户要混合图拿到的是普通图，且没有任何错误。类型层这里把五个都放进合法取值域，
 * 钉住「不再是三选一」。
 */
const _hybrid: MapProps = { mapType: "BMAP_HYBRID_MAP" };
const _none: MapProps = { mapType: "BMAP_NONE_MAP" };
const _satellite: MapProps = { mapType: "BMAP_SATELLITE_MAP" };
const _earth: MapProps = { mapType: "BMAP_EARTH_MAP" };
const _normal: MapProps = { mapType: "BMAP_NORMAL_MAP" };
void _hybrid;
void _none;
void _satellite;
void _earth;
void _normal;

/**
 * 反例：仍然是**封闭**取值域（不是 `string` 的退化）——拼错的常量名在类型层就被拒，
 * 而不是运行时静默降级。
 */
// @ts-expect-error 官方常量只有这五个；拼错的名字必须在类型层被拒
const _typo: MapProps = { mapType: "BMAP_HYBRID" };
// @ts-expect-error v2 语义名不是官方常量名
const _legacyName: MapProps = { mapType: "hybrid" };
void _typo;
void _legacyName;
