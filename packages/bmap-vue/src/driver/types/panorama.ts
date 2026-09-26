/**
 * PanoramaDriver
 *
 * 全景能力分两层（M3A2-SERVICES-NATIVE / issue #23）：
 *
 * - **共享面** `PanoramaDriver`：只有 `supported`。组件的 `panorama.supported` 判断依赖它；
 * - **v4 面** `PanoramaViewerDriver`：viewer / service 的完整门面。
 *   `#23` 只交付了底层 skeleton（创建、视角、显隐、检索归一）；`#41`（M7-CONTROL-PANORAMA）
 *   在此基础上补齐**组件路径实际会消费**的那部分：读取面（`getPosition` / `getPov` /
 *   `getZoom` / `getId` / `getSceneType`）、场景切换（`setId`）、声明式配置
 *   （`setOptions` / `setPanoramaPOIType` / 滚轮缩放）与覆盖物（`PanoramaLabel`）。
 *
 * 两条口径值得写在类型上：
 *
 * 1. **只暴露有消费者的成员**。`capture()` / `clearOverlays()` 同样是官方成员，但当前没有任何
 *    组件或 composable 会调用它们（覆盖物由 `PanoramaLabel` 各自在实例 scope 里摘除），
 *    因此**不加**——「声明了但没人读」与「假支持」是同一类问题（#42 的教训）。
 * 2. **读取面是可空的**：官方把 `getPosition()` / `getId()` / `getSceneType()` 声明成非空，
 *    但场景尚未加载时运行时给不出值。这里按可空建模，让「还没加载」与「值就是空」在类型上
 *    就不混。
 */
import type { Point } from "./geometry";
import type { SdkHandle } from "./handles";
import type { ServiceCall } from "./services";

/** 共享面：本引擎是否提供全景能力。 */
export interface PanoramaDriver {
  readonly supported: boolean;
}

/** 全景查看器句柄（`new BMap.Panorama(container, options)`）。 */
export type PanoramaHandle = SdkHandle<"panorama">;
/** 全景数据检索句柄（`new BMap.PanoramaService()`）。 */
export type PanoramaServiceHandle = SdkHandle<"service:panorama">;
/** 全景标注句柄（`new BMap.PanoramaLabel(content, opts)`）。 */
export type PanoramaLabelHandle = SdkHandle<"panorama:label">;

/** 全景场景类型（官方 `PanoramaSceneType`：室外景 / 室内景）。 */
export type PanoramaSceneType = "street" | "inter";

/** 全景内可显示的 POI 类型（官方 `PanoramaPOIType`）。 */
export type PanoramaPoiType = "hotel" | "catering" | "movie" | "transit" | "indoor_scene" | "none";

/**
 * 全景视角（官方 `PanoramaPov`）：`pitch` 在不改变俯角时可省略。
 *
 * 官方声明里 `getPov()` 返回的 `pitch` 是非可空的，但 `setPov()` 的参数里它可省略
 * （「可只设置 heading」）——本类型按参数口径建模。
 */
export interface PanoramaPov {
  heading: number;
  pitch?: number;
}

/**
 * 全景的一条链接（官方 `panorama/PanoramaLink.d.ts` 的领域投影）。
 *
 * 官方八个成员**全是可选的**，因此这里也**全部可选**。投影按类型逐字段收窄，
 * 取不到就**留在 `undefined`**——**不编默认值**：`heading ?? 0` 会把「上游没给方位」
 * 与「正北」混成同一个数，而调用方正是靠这个区别决定要不要画一个指向标。
 *
 * 逐条（`description` / `heading` / `id` / `dir` / `refinedDir` / `x` / `y` / `roadWidth`）见
 * `driver/jsapi-v4/panorama.ts` 的 `toLinks`。
 */
export interface PanoramaLink {
  /** 目的地名称（如「天安门广场」）。 */
  description?: string;
  /** 相对于当前朝向的方位角（度）。 */
  heading?: number;
  /** 目的地全景 id。 */
  id?: string;
  /** 道路指示的方位角（度）。 */
  dir?: number;
  /** 官方修正后的方位角（`dir` 的细化值）。 */
  refinedDir?: number;
  /** 屏幕横坐标（像素）。 */
  x?: number;
  /** 屏幕纵坐标（像素）。 */
  y?: number;
  /** 道路宽度（米）。 */
  roadWidth?: number;
}

/**
 * 全景数据（官方 `PanoramaData` 的领域投影）。
 *
 * `tiles` **真的**不透出（官方 `PanoramaTileData` 是瓦片贴图，属渲染内部，没有业务消费者）；
 * `links` **是**透出的——旧注释把两者并列成「渲染细节 / 没有消费者」，但那个判据对 `links`
 * **不成立**：`<Panorama>` 早就声明并派发了 `linksChange`，消费者是**存在**的，
 * 缺的只是数据路径（issue #165 Class 3 / TASK 5）。官方 React 参考实现也暴露了 `getLinks()`。
 */
export interface PanoramaDataInfo {
  id: string;
  description: string;
  position: Point | null;
}

/**
 * 查看器配置（官方 `PanoramaOptions` 的自持投影）。
 *
 * 自持而不是 import 上游类型包：本项目公共声明面不得依赖 `@baidumap/jsapi-v4-types`
 * （它是 devDependency，消费者装不到），结构等价由 `driver/jsapi-v4/panorama.test.ts` 的
 * 「上游声明 → 本库字段」逐键核对承担。
 */
export interface PanoramaOptions {
  /** 是否显示全景的导航控件（官方默认 `true`） */
  navigationControl?: boolean;
  /** 是否显示道路指示控件（官方默认 `true`） */
  linksControl?: boolean;
  /** 是否显示室内场景切换控件，仅对室内景生效（官方默认 `true`） */
  indoorSceneSwitchControl?: boolean;
  /** 是否显示相册控件（官方默认 `false`） */
  albumsControl?: boolean;
  /** 相册控件配置；形状由官方 `AlbumsControlOptions` 决定，本库不投影（透传） */
  albumsControlOptions?: Record<string, unknown>;
}

/** `setId()` 的切换配置（官方 `Panorama#setId` 的第三个参数）。 */
export interface PanoramaSwitchOptions {
  animation?: boolean;
  fisheye?: boolean;
  animationType?: string;
  pov?: Partial<PanoramaPov>;
}

/** 全景标注的构造选项（官方 `PanoramaLabelOptions`）。 */
export interface PanoramaLabelOptions {
  position?: Point;
  /** 距地面高度（米，官方默认 `2`） */
  altitude?: number;
  /** 是否显示到当前场景点的距离（官方默认 `true`） */
  displayDistance?: boolean;
}

/**
 * v4 的全景面：viewer / service / 标注的完整门面。
 *
 * `extends PanoramaDriver` 是刻意的：`BMapDriver.panorama` 是共享契约，v4 的实现必须
 * 仍然是「一个 `PanoramaDriver`」（`supported` 在这里被实现成**每次读取都重新探测**的
 * getter，见 `jsapi-v4/panorama.ts`），这样 `JsapiV4Driver extends BMapDriver` 成立。
 */
export interface PanoramaViewerDriver extends PanoramaDriver {
  /** 在容器里创建查看器；容器不存在时让 SDK 的错误经 `sdkCall` 归一，不做预检 */
  create(container: string | HTMLElement, options?: PanoramaOptions): PanoramaHandle;
  /** 销毁查看器（幂等：重复调用不抛错） */
  destroy(viewer: PanoramaHandle): void;

  /**
   * 订阅查看器 / 标注上的 SDK 事件，**原样投递** SDK 的事件对象。
   *
   * 为什么不复用共享的 `EventDriver.on()`：那一条路径按 **Map 事件**的形状归一化
   * （`normalizeDriverEvent` 会重建 `{type, point, pixel, size, zoom, mapType…}`），而全景事件的
   * 载荷由官方 `PanoramaEventMap` 定义——`dataload` 是 `{data}`、`pano_error` 是
   * `{data}`、`id_changed` 干脆是一个字符串、其余 `*_changed` 只有
   * `{type, target, currentTarget}`。用 Map 的归一化规则套上去会把载荷**丢掉**
   * （`dataload.data` 在归一化后的对象里根本不存在），而「加一句 if 判断事件名放行原样」
   * 就是在共享契约里塞特例。因此全景有自己的一条原样订阅路径，`destroy()` 会兜底释放它。
   */
  on(
    target: PanoramaHandle | PanoramaLabelHandle,
    type: string,
    listener: (event: unknown) => void,
  ): () => void;

  // ---------------------------------------------------------------- 读取面
  /**
   * 当前位置；场景未加载时为 `null`。
   *
   * 这几个 getter 不只是「读给调用方看」：官方的 `position_changed` / `pov_changed` /
   * `zoom_changed` / `scene_type_changed` 是**不带载荷**的事件对象，组件要补出对外事件
   * 的载荷就必须回读——所以它们是 emit 路径的真实消费者。
   */
  getPosition(viewer: PanoramaHandle): Point | null;
  getPov(viewer: PanoramaHandle): PanoramaPov | null;
  getZoom(viewer: PanoramaHandle): number | null;
  getId(viewer: PanoramaHandle): string | null;
  getSceneType(viewer: PanoramaHandle): PanoramaSceneType | null;
  /**
   * 当前场景的相邻链接（官方 `Panorama#getLinks(): PanoramaLink[]`）。
   *
   * 拿不到（实例没有该成员 / 返回的不是数组）时给**空数组**，不抛错、不给 `undefined`：
   * 「没有链接」与「拿不到链接」在上游没有可区分的证据，而这两者对调用方是同一件事
   * （没有可画的道路指示）。**与 `getPosition()` 的 `null` 不同**——那里「还没加载」
   * 是调用方要区分的已知状态，而链接列表的空与非空不承载这种语义。
   */
  getLinks(viewer: PanoramaHandle): PanoramaLink[];
  /** 当前是否可见；实例缺该方法时由 SDK 边界归一为错误（不猜） */
  getVisible(viewer: PanoramaHandle): boolean;

  // ---------------------------------------------------------------- 写入面
  /**
   * 按全景 id 切换场景。
   *
   * ⚠️ 组件的销毁路径**必须先切到某个场景**再 `destroy()`：ADR 2026-09-12 的真实 AK smoke
   * 记录里，未加载场景的实例 `destroy()` 会抛
   * `TypeError: Cannot read properties of undefined (reading 'START')`。
   */
  setId(viewer: PanoramaHandle, id: string, options?: PanoramaSwitchOptions): void;
  setPosition(viewer: PanoramaHandle, position: Point): void;
  setPov(viewer: PanoramaHandle, pov: PanoramaPov, options?: { animation?: boolean }): void;
  setZoom(viewer: PanoramaHandle, zoom: number, options?: { noAnimation?: boolean }): void;
  /** 整体写回查看器配置（官方 `Panorama#setOptions`）；与构造期选项同一份形状 */
  setOptions(viewer: PanoramaHandle, options: PanoramaOptions): void;
  /** 外景场景点内可见的 POI 类型（官方默认隐藏全部） */
  setPanoramaPoiType(viewer: PanoramaHandle, poiType: PanoramaPoiType): void;
  /** 开启鼠标滚轮缩放（仅 PC 端有效） */
  enableScrollWheelZoom(viewer: PanoramaHandle): void;
  /** 关闭鼠标滚轮缩放 */
  disableScrollWheelZoom(viewer: PanoramaHandle): void;
  show(viewer: PanoramaHandle): void;
  hide(viewer: PanoramaHandle): void;

  // ------------------------------------------------------------ 标注（覆盖物）
  /** 创建标注（官方 `new PanoramaLabel(content, opts)`，`content` 是文本内容） */
  createLabel(content: string, options?: PanoramaLabelOptions): PanoramaLabelHandle;
  /** 挂到查看器里（官方 `Panorama#addOverlay`） */
  addLabel(viewer: PanoramaHandle, label: PanoramaLabelHandle): void;
  /** 从查看器摘除（官方 `Panorama#removeOverlay`） */
  removeLabel(viewer: PanoramaHandle, label: PanoramaLabelHandle): void;
  setLabelPosition(label: PanoramaLabelHandle, position: Point): void;
  setLabelContent(label: PanoramaLabelHandle, content: string): void;
  setLabelAltitude(label: PanoramaLabelHandle, altitude: number): void;
  /**
   * 标注显隐（官方 `PanoramaLabel#show(): void` / `#hide(): void`）。
   *
   * 此前**没有调用路径**——一个全景标注只能靠「卸载组件」消失，而卸载会连实例一起摘掉
   * （`Panorama#removeOverlay`），因此「临时藏起一个标签」这条最常见的诉求无处落地
   * （issue #165 Class 3 / TASK 2h）。
   *
   * ⚠️ **与「组件卸载」是两种语义**：命令只改 SDK 当前态，标注仍在查看器里、
   * 仍占一个实例；组件卸载则走 `removeLabel` 摘除。刻意不做「命令 ⇄ props 同步」——
   * `visible` 不是 `PanoramaLabelProps` 的字段（官方 `PanoramaLabelOptions` 也没有），
   * 加上它就是自研一个官方没有的 prop。
   */
  showLabel(label: PanoramaLabelHandle): void;
  hideLabel(label: PanoramaLabelHandle): void;
  // ⚠️ **刻意没有** `isLabelVisible`：官方 `PanoramaLabel` 声明的是
  // `setPosition` / `getPosition` / `getPov` / `setContent` / `getContent` / `show` / `hide` /
  // `setAltitude` / `getAltitude`——**没有** `isVisible()` / `getVisible()`。
  // 造一个恒返回 `false` 的「读回」会让调用方拿到一个编出来的答案
  // （AGENTS.md 明确禁止「镜像读不回的 SDK 内部状态」）。要确认显隐是否生效，
  // 请在调用侧记账，或观察画面。

  // ------------------------------------------------------------------ 检索
  createService(): PanoramaServiceHandle;
  /** 按全景 id 检索（官方 `getPanoramaById`；查不到时回调参数为 `null`） */
  findById(service: PanoramaServiceHandle, id: string): ServiceCall<PanoramaDataInfo>;
  /** 按坐标检索（官方 `getPanoramaByLocation`，半径默认 50 米） */
  findByLocation(
    service: PanoramaServiceHandle,
    position: Point,
    radius?: number,
  ): ServiceCall<PanoramaDataInfo>;
}
