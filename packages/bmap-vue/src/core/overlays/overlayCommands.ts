/**
 * 覆盖物的**命令面**（ / TASK 2）
 *
 * ## 为什么单独一个文件
 *
 * 的判据是「官方有的公开方法**有没有调用路径**」。`grep defineExpose` 在 27 个覆盖物 /
 * 控件组件上返回 0 命中 ⇒ 官方 `Marker#setRank` / `Polyline#setPositionAt` /
 * `InfoWindow#maximize` / `ContextMenu#removeItem` 这一整族**在本库没有任何入口**。
 * 「改 prop」不算：那是**受控写入**，与「持有 ref 调一个官方同名的方法」是两条路径
 * （`InfoWindow#maximize()` 是动作，没有对应的 prop；`Marker#getRank()` 是读回，
 * 组件永远不会替你读）。
 *
 * ## 三条口径
 *
 * 1. **本文件是框架无关的**（不 import vue），入参只有「一次可用的会话」+ 组件名，
 *    因此可以在没有 Vue 的单测里直接驱动（与 `core/layers/trackLinePlayback.ts` 同一手法）。
 * 2. **释放后必须显式失败，绝不静默 no-op**。会话取不到时抛 `BMAP_RESOURCE_DISPOSED`——
 *    与 `trackLinePlayback` 的「告警一次并跳过」**刻意不同**：那边是**播放意图**（漏掉一帧
 *    下一次自然补上），这边是「调用方明确要求一个结果」（读回 / 删除）；静默返回 `undefined`
 *    会让调用方把「资源已释放」误判成「SDK 说没有」。判定是**每次命令现取会话**，
 *    因此重建（换实例）后旧闭包不会打进已死的实例。
 * 3. **不碰 raw SDK**。所有 SDK 调用都经 `OverlayDriver` 的归一化读回 / 命令面
 *    （`driver/types/overlays.ts` 的 `InfoWindowReadBackApi` / `MarkerReadBackApi` / …），
 *    raw 几何的投影收在 Driver 内（`driver/jsapi-v4/overlays.ts` 的 `fromRawPoint` 一族）。
 *    本文件因此**不出现**任何 `handle.raw`——AGENTS.md 的 raw SDK 边界是 Driver / Provider
 *    / 插件专属，`core/` 不在其中。
 *
 * ## 读回族为什么只覆盖图形四类
 *
 * 官方在 `Circle` / `Polygon` / `Rectangle` / `Polyline` 上有完整的一族
 * `getBounds` / `getCenter` / `getRadius` / `getStrokeColor` / …，它们**返回当前值**——
 * 与本库「props 是主模型」的口径一致（`OVERLAY_REVERT_RATIONALE` 逐条说明了「getter 给的是
 * 当前值而不是 SDK 默认值」）。因此这些读回**不镜像成组件状态**，只作为命令面按需取。
 * `BezierCurve` / `Prism` / `Label` / `GroundOverlay` **不**在这族里：官方 4.0.5 没有为它们
 * 声明对应 getter（`GroundOverlay` 有 `getBounds` / `getOpacity` / `getImageURL`，
 * 但那是**地面叠加**的独立一族；本期不铺开，理由与逐条依据见
 * `tests/behavior/overlay-expose.test.ts` 的「刻意不做」一组）。
 */
import { BMapError } from "../errors/BMapError";
import type { OverlayDriver } from "../../driver/types/overlays";
import type { OverlayHandle } from "../../driver/types/handles";
import type { Point } from "../../driver/types/geometry";
import type {
  CircleReadBackApi,
  InfoWindowReadBackApi,
  MarkerReadBackApi,
  PathReadBackApi,
} from "../../driver/types/overlays";

/**
 * 一次可用的覆盖物会话：**两个引用必须来自同一时刻**（重建期间取到的 driver 与 handle
 * 可能分属两代），因此它们被绑在一个对象里由调用方一起求值。
 */
export interface OverlayCommandSession {
  readonly driver: OverlayDriver;
  readonly handle: OverlayHandle;
}

/** 命令面的创建输入（与 `trackLinePlayback` 同一形状）。 */
export interface OverlayCommandContext {
  /**
   * **当前会话**的取值器；未就绪、重建窗口内或已释放时返回 `null`。
   *
   * 每条命令都重新求值：覆盖物会因构造期属性变化而换实例，闭包里存死句柄会让命令
   * 打到一个已经不在地图上的覆盖物上。
   */
  session(): OverlayCommandSession | null;
  /** 组件名（诊断用）。 */
  component: string;
}

function disposed(component: string, command: string): BMapError {
  return new BMapError(
    "BMAP_RESOURCE_DISPOSED",
    `${component}.${command}(): 覆盖物未就绪、正在重建或已经释放，本次调用被拒绝` +
      "（不静默 no-op——读回会拿到 undefined、动作会悄无声息地丢掉）。" +
      "请在资源就绪后调用（先看组件 ref 上的 status）。",
    { component },
  );
}

/** 取会话；取不到即**显式失败**。命令面里没有「静默返回」这一档（见文件头第 2 条）。 */
function require<C extends OverlayCommandContext>(
  input: C,
  command: string,
): OverlayCommandSession {
  const session = input.session();
  if (!session) throw disposed(input.component, command);
  return session;
}

/* ------------------------------------------------------------------------- 读回族 */

/** `Circle` 的读回面（官方 `Circle.d.ts` 的九个 getter）。 */
export function createCircleReadBacks(input: OverlayCommandContext): CircleReadBackApi {
  const circle = (): CircleReadBackApi =>
    require(input, "circleReadBacks").driver.circleReadBacks(
      require(input, "circleReadBacks").handle,
    );
  return {
    getBounds: () => circle().getBounds(),
    getCenter: () => circle().getCenter(),
    getRadius: () => circle().getRadius(),
    getStrokeColor: () => circle().getStrokeColor(),
    getStrokeOpacity: () => circle().getStrokeOpacity(),
    getStrokeWeight: () => circle().getStrokeWeight(),
    getStrokeStyle: () => circle().getStrokeStyle(),
    getFillColor: () => circle().getFillColor(),
    getFillOpacity: () => circle().getFillOpacity(),
  };
}

/** `Polygon` / `Rectangle` 的读回面（官方各自声明的 getter；Polyline 没有填充）。 */
export function createPathReadBacks(
  input: OverlayCommandContext,
  options: { fill: boolean },
): PathReadBackApi & { getFillColor(): string; getFillOpacity(): number } {
  const base = (): PathReadBackApi =>
    require(input, "pathReadBacks").driver.pathReadBacks(require(input, "pathReadBacks").handle);
  const fill = () =>
    require(input, "pathFillReadBacks").driver.pathFillReadBacks(
      require(input, "pathFillReadBacks").handle,
    );
  return {
    getBounds: () => base().getBounds(),
    getStrokeColor: () => base().getStrokeColor(),
    getStrokeOpacity: () => base().getStrokeOpacity(),
    getStrokeWeight: () => base().getStrokeWeight(),
    getStrokeStyle: () => base().getStrokeStyle(),
    getFillColor: (): string =>
      options.fill
        ? fill().getFillColor()
        : readBackUnsupported(input, "getFillColor", "Polyline"),
    getFillOpacity: (): number =>
      options.fill
        ? fill().getFillOpacity()
        : readBackUnsupported(input, "getFillOpacity", "Polyline"),
  };
}

/** 读回一个官方**没有**声明的能力时抛错（不返回 `undefined` 冒充「读到了空」）。 */
function readBackUnsupported(
  input: OverlayCommandContext,
  command: string,
  kind: string,
): never {
  throw new BMapError(
    "BMAP_CAPABILITY_UNSUPPORTED",
    `${input.component}.${command}(): ${kind} 没有这个读回入口——官方 4.0.5 没有声明该 getter` +
      "（Polyline 只有描边 getter，没有 getFillColor/getFillOpacity）",
    { component: input.component },
  );
}

/* ------------------------------------------------------------------ 顶点逐点更新 */

/**
 * `setPositionAt(index, point, deep?)`（官方 `Polyline.d.ts:116` 一族）的命令面。
 *
 * 逐条依据：
 * - `Polyline.d.ts`：`setPositionAt(index: number, point: Point): void`
 * - `Polygon.d.ts`：`setPositionAt(index: number, point: Point, deep?: number): void`
 *
 * `deep` **只属于 `Polygon`**：它的路径是 `Array<Point> | Array<Array<Point>>`（多环），
 * `deep` 指定「改的是第几层环」。判据放在 **Driver**（`setPositionAt` 的 kind 检查），
 * 因此不依赖调用方记住这条规则；本文件的 `deep` 只是把参数递下去。
 *
 * ⚠️ **不镜像回 props**：`props.path` 仍是主模型。逐点改动后调用方应同时更新 `path`
 * （或递增 `pathVersion`），否则下一次路径更新会覆盖它。这是**刻意不做**双向同步的理由：
 * 官方没有「顶点被改了」的事件，猜不出一次 `setPositionAt` 属于哪次路径写入。
 */
export interface PathCommandApi {
  /**
   * 逐点移动路径上的一个顶点（官方 `setPositionAt`）。
   *
   * `options.deep` **只对 `polygon` 有效**；其它 kind 传了它抛 `BMAP_INVALID_ARGUMENT`
   * （官方签名只有两个参数，第三个会被静默忽略）。
   */
  setPositionAt(index: number, point: Point, options?: { deep?: number }): void;
}

export function createPathCommands(input: OverlayCommandContext): PathCommandApi {
  return {
    setPositionAt(index, point, options) {
      // 参数校验**前置于**取会话：参数错了就说参数错，不要因为「还没就绪」而掩盖成
      // disposed。真正的校验（index 是非负整数 / point 是有限坐标 / deep 只对 polygon）
      // 在 Driver 做——那里才知道 kind；本层不重复一份判据。
      const session = require(input, "setPositionAt");
      session.driver.setPositionAt(session.handle, index, point, options);
    },
  };
}

/* ------------------------------------------------------------------------- Marker */

/** `Marker` 的读回与动作面（官方 `overlay/Marker.d.ts`）。 */
export function createMarkerCommands(input: OverlayCommandContext): MarkerReadBackApi {
  const commands = (): MarkerReadBackApi =>
    require(input, "markerCommands").driver.markerCommands(
      require(input, "markerCommands").handle as never,
    );
  return {
    getRank: () => commands().getRank(),
    setRank: (rank) => commands().setRank(rank),
    setRotationOrigin: (angle) => commands().setRotationOrigin(angle),
    getTitle: () => commands().getTitle(),
    getOffset: () => commands().getOffset(),
    getRotation: () => commands().getRotation(),
    getPosition: () => commands().getPosition(),
    closePlaceDetail: () => commands().closePlaceDetail(),
  };
}

/* --------------------------------------------------------------------- InfoWindow */

/** `InfoWindow` 的读回与动作面（官方 `overlay/InfoWindow.d.ts` 的六个成员）。 */
export function createInfoWindowCommands(
  input: OverlayCommandContext,
): InfoWindowReadBackApi {
  const commands = (): InfoWindowReadBackApi =>
    require(input, "infoWindowCommands").driver.infoWindowCommands(
      require(input, "infoWindowCommands").handle as never,
    );
  return {
    getTitle: () => commands().getTitle(),
    getContent: () => commands().getContent(),
    isOpen: () => commands().isOpen(),
    getOffset: () => commands().getOffset(),
    maximize: () => commands().maximize(),
    restore: () => commands().restore(),
  };
}

/* ------------------------------------------------------------------ 公开类型出口 */

/**
 * 全部覆盖物命令面的**按组件**索引（ / TASK 2）。
 *
 * 消费方在父组件里写 `const marker = useTemplateRef<...>()` 或标注一个 handler 时，
 * 需要知道「`<Marker>` 的 ref 上有哪些方法」——逐个去翻 `markerSpec.ts` 不可行。
 * 这张表是 `OverlaySpec.expose` 的**类型层**对照，与运行时那条用例
 * （`tests/behavior/overlay-expose.test.ts`）逐组件对齐。
 *
 * 键是**组件名**（不是 `OverlayKind`）——调用方看到的是 `<Marker ref>`，不是 kind。
 * 没有命令面的组件**不出现在这张表里**：那正好表达「拿 ref 也没有命令」，
 * 而不是给一个空对象。
 */
export interface OverlayCommandTypes {
  Marker: MarkerReadBackApi;
  Circle: CircleReadBackApi;
  /** 官方 `Polygon` 的 `setPositionAt` 带 `deep`（多环路径的层数）。 */
  Polygon: PathReadBackApi & { getFillColor(): string; getFillOpacity(): number } & PathCommandApi;
  Rectangle: PathReadBackApi & { getFillColor(): string; getFillOpacity(): number };
  /** 官方 `Polyline` 没有填充，且 `setPositionAt` 只有两个参数。 */
  Polyline: PathReadBackApi & { getFillColor(): string; getFillOpacity(): number } & PathCommandApi;
  InfoWindow: InfoWindowReadBackApi;
}
