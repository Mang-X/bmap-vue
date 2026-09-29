/**
 * 图形类**构造期**选项的类型面契约（issue #165 图形族补齐）
 *
 * 运行时行为（选项真的到达 SDK 的构造 options、`recreate` 真的重建实例、「未给 ⇒ 键不存在」）
 * 由 `tests/behavior/vector-overlay-options.test.ts` 钉住；本文件钉的是**声明面**——
 * 官方 4.0.5 的 `overlay/*Options.d.ts` 逐条核对后，**哪些键该被收下、哪些键必须收不下**。
 *
 * 为什么落在本目录而不是 `*.test.ts`：`tsconfig.tests.json` 只 include
 * `tests/performance` 与 `tests/browser/live-performance`，写在 `tests/behavior/` 的
 * `@ts-expect-error` **不会被任何 tsc 编译**，因此永远翻红不了（见
 * `tests/type-contracts/overlay-zindex.type-test.ts` 的同款说明）。
 *
 * **判别力双向**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红。
 *
 * ## 本文件最要紧的一条：**反向的键必须收不下**
 *
 * 「补齐官方选项」最自然的坏结果是**补过头**——把某个类**没有**的官方键也加上，
 * 让调用方以为 `<Circle>` 支持 `linkRight`。那比缺一个选项更糟：缺了会得到编译错误，
 * 补过了会得到「传了但 SDK 忽略」——**假支持**。
 * 因此本文件对每一条反向键都写了 `@ts-expect-error`，它们与正控同样重要。
 */
import type {
  BezierCurveProps,
  CircleProps,
  PolygonProps,
  PolylineProps,
  RectangleProps,
} from "../../packages/bmap-vue/src/types/components";

const P = { lng: 116.4, lat: 39.9 };
const PATH = [P, { lng: 116.5, lat: 40 }];
const BOUNDS = { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } };

/* ------------------------------------------------------------------ 正控（#165 补的键）
 *
 * 逐条对应官方 4.0.5 的 `overlay/<Class>Options.d.ts`：
 * - `PolylineOptions` 的 `strokeLineCap` / `strokeLineJoin`（:28 / :33）
 * - `PolylineOptions` 的 `enableClicking` / `geodesic` / `linkRight` / `clip`（:48 / :53 / :58 / :63）
 * - `PolylineOptions` 的 `coordType` / `icons` / `strokeTexture` / `dashArray`（:67 / :71 / :75 / :93）
 * - `PolygonOptions` 的同名六项（:36 / :42 / :56 / :61 / :65 / :69）
 * - `CircleOptions` 的 `coordType` / `dashArray`（:50 / :54）
 * - `BezierCurveOptions` 的 `enableClicking` / `dashArray`（:36 / :41）
 */
const _polyline: PolylineProps = {
  points: PATH,
  strokeLineCap: "butt",
  strokeLineJoin: "miter",
  enableClicking: false,
  geodesic: true,
  linkRight: true,
  clip: false,
  coordType: "BMAP_COORD_GCJ02",
  icons: [],
  strokeTexture: { url: "/arrow.png", width: 16, height: 16 },
  dashArray: [8, 4],
};
const _polygon: PolygonProps = {
  points: PATH,
  strokeLineCap: "square",
  strokeLineJoin: "bevel",
  enableClicking: false,
  linkRight: true,
  coordType: "BMAP_COORD_WGS84",
  dashArray: [6, 2],
};
const _rectangle: RectangleProps = {
  bounds: BOUNDS,
  coordType: "BMAP_COORD_BD09",
  linkRight: true,
  dashArray: [4, 4],
};
const _circle: CircleProps = {
  center: P,
  radius: 100,
  coordType: "BMAP_COORD_BD09",
  dashArray: [4, 4],
};
const _bezier: BezierCurveProps = {
  points: PATH,
  controlPoints: [[P]],
  enableClicking: false,
  dashArray: [3, 3],
};
void [_polyline, _polygon, _rectangle, _circle, _bezier];

/* ------------------------------------------------ 反向：官方**没有**的键必须收不下
 *
 * 逐条对应官方 4.0.5 各 `*Options.d.ts` 的**键集**：
 * - `CircleOptions` 共 12 个键，**没有** `strokeLineCap` / `strokeLineJoin` / `linkRight`；
 * - `BezierCurveOptions` 共 8 个键，**没有** `coordType` / `linkRight` / `strokeLineCap`；
 * - `RectangleOptions` 共 15 个键，**没有** `strokeLineCap` / `strokeLineJoin`；
 * - `PolygonOptions` 共 15 个键，**没有** `geodesic` / `clip` / `icons` / `strokeTexture`。
 *
 * 收下任何一个都是「本库声称支持、官方没承诺」的**假支持**——比缺一个选项更糟。
 */
const _circleNoCap: CircleProps = {
  center: P,
  radius: 1,
  // @ts-expect-error CircleOptions 没有 strokeLineCap（官方 12 个键里没有）
  strokeLineCap: "butt",
};
const _circleNoLink: CircleProps = {
  center: P,
  radius: 1,
  // @ts-expect-error CircleOptions 没有 linkRight（圆形的几何是「圆心 + 半径」，无跨经度路径）
  linkRight: true,
};
const _bezierNoCoord: BezierCurveProps = {
  points: PATH,
  controlPoints: [[P]],
  // @ts-expect-error BezierCurveOptions 没有 coordType（官方 8 个键里没有）
  coordType: "BMAP_COORD_WGS84",
};
const _bezierNoLink: BezierCurveProps = {
  points: PATH,
  controlPoints: [[P]],
  // @ts-expect-error BezierCurveOptions 没有 linkRight
  linkRight: true,
};
const _rectNoCap: RectangleProps = {
  bounds: BOUNDS,
  // @ts-expect-error RectangleOptions 没有 strokeLineCap（只有 PolylineOptions / PolygonOptions 有）
  strokeLineCap: "butt",
};
const _polygonNoGeodesic: PolygonProps = {
  points: PATH,
  // @ts-expect-error PolygonOptions 没有 geodesic（只有 PolylineOptions 有）
  geodesic: true,
};
const _polygonNoIcons: PolygonProps = {
  points: PATH,
  // @ts-expect-error PolygonOptions 没有 icons（线上符号是 Polyline 独有的）
  icons: [],
};
void [_circleNoCap, _circleNoLink, _bezierNoCoord, _bezierNoLink, _rectNoCap, _polygonNoGeodesic, _polygonNoIcons];

/* ---------------------------------------------------------------- 枚举的封闭性
 *
 * `coordType` **刻意不收全官方 `const/CoordType.d.ts` 的六个值**：官方在图形类的
 * `coordType` 上**只声明了三个**，另外三个墨卡托变体（`BMAP_COORD_MERCATOR` /
 * `BMAP_COORD_GCJ02MERCATOR` / `BMAP_COORD_EPSG3857`）是给**地图全局** `BMap.coordType` 用的。
 * 收下它们就是「本库声称支持、官方在覆盖物上没承诺」。
 */
const _badCoord: PolylineProps = {
  points: PATH,
  // @ts-expect-error 官方在图形类的 coordType 上只声明了三个（不含墨卡托变体）
  coordType: "BMAP_COORD_EPSG3857",
};
const _badCap: PolylineProps = {
  points: PATH,
  // @ts-expect-error strokeLineCap 只有 round / butt / square 三个合法值
  strokeLineCap: "flat",
};
const _badJoin: PolylineProps = {
  points: PATH,
  // @ts-expect-error strokeLineJoin 只有 round / miter / bevel 三个合法值
  strokeLineJoin: "sharp",
};
void [_badCoord, _badCap, _badJoin];

/* ---------------------------------------------------------------- `dashArray` 的元素类型
 *
 * 官方是 `number[]`（像素长度），不是「字符串形式的虚线」也不是元组。
 */
const _badDash: PolylineProps = {
  points: PATH,
  // @ts-expect-error dashArray 的元素是 number
  dashArray: ["8", "4"],
};
void _badDash;
