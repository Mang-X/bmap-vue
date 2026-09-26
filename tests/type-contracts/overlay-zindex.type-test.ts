/**
 * `zIndex` 的**类型面**契约（issue #165 Class 3 / TASK 0 + TASK 1）
 *
 * 运行时行为（`setZIndex` 真的被调用、不重建）由 `tests/behavior/overlay-zindex.test.ts` 钉住；
 * 本文件钉的是**声明面**：九个官方有 `setZIndex` 的类对应的组件 props 必须收下 `zIndex`，
 * 收不下的那个（`CustomOverlay`）必须**仍然**能被识别出来而不是被顺手"补齐"。
 *
 * 为什么落在本目录而不是 `*.test.ts`：`tsconfig.tests.json` 只 include
 * `tests/performance` 与 `tests/browser/live-performance`，写在 `tests/behavior/` 的
 * `@ts-expect-error` **不会被任何 tsc 编译**，因此永远翻红不了（见
 * `tests/type-contracts/ground-overlay-bounds.type-test.ts` 的同款说明）。
 *
 * **判别力双向**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红。
 */
import type {
  BezierCurveProps,
  CircleProps,
  CustomOverlayProps,
  GroundOverlayProps,
  LabelProps,
  MarkerProps,
  PolygonProps,
  PolylineProps,
  PrismProps,
  RectangleProps,
} from "../../packages/bmap-vue/src/types/components";

const P = { lng: 116.4, lat: 39.9 };
const PATH = [P, { lng: 116.5, lat: 40 }];
const BOUNDS = { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } };

/* 正控：官方 `setZIndex` 的九个类，九个组件都收下 `zIndex`。
 *
 * `PathShapeProps` 一次覆盖图形六件套（Polyline / Polygon / Rectangle / Circle /
 * BezierCurve + 内联的 Prism / GroundOverlay），`LabelProps` / `MarkerProps` 各自早就有。
 */
const _polyline: PolylineProps = { path: PATH, zIndex: 1 };
const _polygon: PolygonProps = { path: PATH, zIndex: 1 };
const _rectangle: RectangleProps = { bounds: BOUNDS, zIndex: 1 };
const _circle: CircleProps = { center: P, radius: 100, zIndex: 1 };
const _bezier: BezierCurveProps = { path: PATH, controlPoints: [[P]], zIndex: 1 };
const _prism: PrismProps = { path: PATH, altitude: 100, zIndex: 1 };
const _ground: GroundOverlayProps = { type: "image", url: "a.png", bounds: BOUNDS, zIndex: 1 };
const _marker: MarkerProps = { position: P, zIndex: 1 };
const _label: LabelProps = { content: "x", position: P, zIndex: 1 };
void [_polyline, _polygon, _rectangle, _circle, _bezier, _prism, _ground, _marker, _label];

/* 反例 1：`zIndex` 仍然是**数字**，不是任意值——`setZIndex(zIndex: number)`。 */
// @ts-expect-error zIndex 必须是 number
const _badZIndex: CircleProps = { center: P, radius: 1, zIndex: "10" };
void _badZIndex;

/* 反例 2：`CustomOverlay` 的 `zIndex` 是**构造期**属性（官方没有 setZIndex），类型面
 * 必须仍然把它标成「构造期」——它不是运行时可变的，注释与描述符（`recreate`）同口径。 */
const _custom: CustomOverlayProps = { position: P, zIndex: 1 };
void _custom;

/* 正控：`CustomOverlay` 仍然**没有** `minZoom`→`setMinZoom` 之类的假出口；
 * 用一个官方确实没有的键证明「本文件不是在『类型什么都能收』的前提下恒绿」。 */
// @ts-expect-error CustomOverlay 没有 getRotationOrigin 对应的 prop（官方只有 setRotationOrigin 方法）
const _customBad: CustomOverlayProps = { position: P, rotationOrigin: 1 };
void _customBad;
