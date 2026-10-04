<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import {
  createPanoramaContext,
  jsapiV4PanoramaOf,
  panoramaContextKey,
} from "../../core/panorama";
import { PANORAMA_EVENT_EMIT_ALIASES } from "../../core/panorama/panoramaEventCatalog";
import { BMapError } from "../../core/errors/BMapError";
import { resolveInternalMapContext } from "../../composables/resolveMapContext";
import type { Point } from "../../driver/types/geometry";
import type {
  PanoramaCaptureOptions,
  PanoramaHandle,
  PanoramaLink,
  PanoramaOptions,
  PanoramaPoiType,
  PanoramaPov,
  PanoramaSceneType,
  PanoramaViewerDriver,
} from "../../driver/types/panorama";

export interface PanoramaProps {
  /** 展示某个坐标处的全景（与 `id` 二选一；两者都给时以 `id` 为准） */
  point?: Point;
  /** 按全景 id 展示 */
  id?: string;
  /** 视角（`heading` 必填，`pitch` 省略表示不改俯角） */
  pov?: PanoramaPov;
  /** 缩放级别 */
  zoom?: number;
  /** 显隐：`true` → `show()`、`false` → `hide()` */
  visible?: boolean;
  /** 鼠标滚轮缩放开关（仅 PC 端有效） */
  scrollWheelZoom?: boolean;
  /** 外景场景点内可见的 POI 类型（默认隐藏全部） */
  poiType?: PanoramaPoiType;
  /** 查看器配置：构造期给一次，之后的变化经 `setOptions()` 整体写回 */
  options?: PanoramaOptions;
}

/**
 * Panorama —— 全景查看器（官方 `BMap.Panorama`）
 *
 * M7-CONTROL-PANORAMA / issue #41。与 `<Map>` 的关系是**并列**而不是嵌套依赖：查看器创建在
 * 自己的容器里（`new BMap.Panorama(container)`），既不挂在 Map 上，也不受地图的暂停/重试策略
 * 管辖；它只需要一个 Client，因此放在 `<Map>` 或 `<BMapProvider>` 子树里都可以。
 *
 * 命令面与 `<Map>` 的受控写入同源：`point` / `id` / `pov` / `zoom` / `visible` 都是**写命令**
 * （变化即下发）；`options` 构造期给一次，之后的变化经 `setOptions()` 写回。状态变化经
 * `positionChange` / `povChange` / `zoomChange` / `idChange` / `sceneTypeChange` /
 * `linksChange` 回报——官方的 `*_changed` 事件**不带载荷**，载荷是组件回读 getter 补齐的。
 *
 * ⚠️ 销毁：官方 4.0 的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（ADR 2026-09-12
 * 的真实 AK smoke 记录），因此组件路径的正确姿势是「先 `point` / `id`、再销毁」。真的没场景时
 * 销毁失败只告警、不抛错（卸载流程里抛异常没有任何人能接），本库自己的资源照常释放。
 */
const props = withDefaults(defineProps<PanoramaProps>(), {
  visible: true,
});

const emit = defineEmits<{
  /** 全景数据加载完成（官方 `dataload`） */
  load: [event: unknown];
  /** 全景数据加载失败（官方 `pano_error`） */
  error: [event: unknown];
  positionChange: [position: Point | null];
  povChange: [pov: PanoramaPov | null];
  zoomChange: [zoom: number | null];
  idChange: [id: string | null];
  sceneTypeChange: [sceneType: PanoramaSceneType | null];
  /**
   * 相邻链接变化（官方 `links_changed`）。
   *
   * **载荷是 `PanoramaLink[]`**——官方 `links_changed` 不带值，载荷由组件回读
   * `getLinks()` 补齐（与 `positionChange` / `povChange` 同一手法）。
   *
   * 此前这一条是**空载荷**：Driver 的注释说「`links` 没有消费者所以不透出」，
   * 但消费者（这个事件本身）**早就存在**，缺的只是数据路径——issue #165 Class 3 /
   * TASK 5 补上。官方 React 参考实现同样暴露 `getLinks()`。
   *
   * 逐条投影依据见 `driver/types/panorama.ts` 的 `PanoramaLink`：八个成员全是可选的，
   * **不补默认值**（`heading ?? 0` 会把「没给方位」与「正北」混成同一个数）。
   */
  linksChange: [links: PanoramaLink[]];
  /**
   * 道路链接**显隐状态**变化（官方 `links_visible_changed: { value: boolean }`）。
   *
   * **载荷是裸 `boolean`**，不是官方那个 `{ value }` 包装——与 `visiblePoiTypeChanged`
   * 投影成裸字面量同一手法：官方包装对象是 SDK 的形状，不是本库的领域形状。
   *
   * ⚠️ **与 `linksChange` 是两件事，名字相近但语义不同**：
   * - `linksChange`（官方 `links_changed`）= **列表**变了，载荷是回读 `getLinks()` 补的
   *   `PanoramaLink[]`；
   * - 本条 = **显隐**变了，载荷是官方自己声明的 `{ value: boolean }`。
   *
   * 此前本库把官方这条判为「不加」，理由是「它由官方自带控件（`linksControl`）的显隐驱动，
   * 而本库没有读回入口」。该理由**不成立**：载荷 `{ value: boolean }` 是官方**声明过的**、
   * **自足**的（不需要回读任何 getter），因此它与同族另外两条一样有一条**可核对**的
   * 消费路径——「道路指示现在是不是亮着」。`linksControl` 本身仍是本库已暴露的构造选项，
   * 业务可以用它把控件关掉，但**关掉之后控件不再自己管显隐**这条信息正是本事件的内容。
   */
  linksVisibleChanged: [visible: boolean];

  /* --- issue #168 item 3：官方 `PanoramaEventMap` 的 23 条里，此处新增 13 条 ---
   *
   * 逐条裁决（**加 / 不加** 与理由）见 `docs/zh-CN/contributing/168-remaining-surface.md`
   * 与 `tests/behavior/panorama-events.test.ts` 的文件头总表；这里只记**载荷形状**的依据。
   *
   * 对外名一律 **camelCase**，这不是待清理的偏差：官方 React 封装
   * `huiyan-fe/react-bmap@2.0.6`（`master`，`src/components/Panorama/index.tsx:46-66`）的
   * 公共事件面就是 camelCase `on*` props，#165 的对齐规则「参照官方封装」指的是它，
   * 不是 SDK 声明的 snake_case。SDK 拼写作为一一对应的别名发出，形状复用 map 事件的
   * `MAP_EVENT_EMIT_ALIASES`（`core/events/eventCatalog.ts`）。
   */

  /**
   * 画面交互事件（官方 `click` / `dblclick` / `touchstart` / `touchend`）。
   *
   * **载荷是收窄投影，不是官方 `MouseEvent` / `TouchEvent`**：那两个是 DOM 原生事件对象，
   * 原样转发会把 SDK 内部的 DOM 结构与 `target` 变成公共契约（`target` 还是 raw
   * `Panorama`）。因此只保留一个**领域**字段 `type`（官方 `type` 是事件名本身）。
   *
   * 刻意**不**投影 `clientX` / `clientY`：那是**屏幕像素偏移**，与本库的 `{lng, lat}`
   * 领域坐标不是一回事，也没有官方读回入口把它换算成经纬度——编一个「看起来像坐标」的数
   * 比不给更糟（调用方会拿它去 `setPov` 或算方位）。
   */
  click: [e: PanoramaInteractionEvent];
  dblclick: [e: PanoramaInteractionEvent];
  touchstart: [e: PanoramaInteractionEvent];
  touchend: [e: PanoramaInteractionEvent];
  /**
   * 单击道路链接（官方 `link_click: PanoramaBaseEvent & { id: string }`）。
   *
   * 载荷只保留官方那个**唯一有业务含义**的字段 `id`——它就是相邻全景的 id，
   * 正好是 `setId(id)` 的入参，于是「点一下导航过去」是纯声明式的。`target` /
   * `currentTarget` 是 raw `Panorama`，不投影。
   *
   * 上游没给 `id` 时 `id` 留在 `undefined`（不补 `""`）：空串是一个**合法**的全景 id 形状，
   * 补上去会让「上游没给」与「导航到空 id」在调用方那里长得一样。
   */
  linkClick: [e: PanoramaLinkClickEvent];
  /**
   * 单击道路（官方 `clickonroad: PanoramaBaseEvent`）。
   *
   * 官方只声明了底座字段（`type` / `target` / `currentTarget`），**没有**道路 id 之类的
   * 业务字段 ⇒ 载荷只保留 `type`。这仍然值得暴露：它是「用户点了地面道路」的唯一通知，
   * 而全景**没有**别的表达方式（不像地图可以用别的组件代表一次点击）。
   */
  clickonroad: [e: PanoramaInteractionEvent];
  /**
   * 拖拽视角后的惯性运动结束（官方 `pov_changed_end`）。
   *
   * 官方 `*_end` 事件不带值，载荷按**本组件既有的回读手法**补齐（与 `positionChange` /
   * `povChange` / `linksChange` 同一手法）：回调里回读 `getPov()`。
   * 它的价值在于「动画**停了**」——`povChange` 在动画期间会连续触发很多次，
   * 业务要的是「现在可以拿最终视角去做点什么」的那一刻。
   */
  povChangedEnd: [pov: PanoramaPov | null];
  /**
   * 场景切换动画结束（官方 `scene_change_end`）。
   *
   * 同上：回读 `getSceneType()` 补载荷。它是「切完了」的信号——室内/室外场景的控件
   * 布局在切换动画结束后才稳定。
   */
  sceneChangeEnd: [sceneType: PanoramaSceneType | null];
  /**
   * 全景容器尺寸变化（官方 `size_changed`）。
   *
   * **无载荷**：官方 `PanoramaBaseEvent` 里没有尺寸字段，SDK 也没有
   * `getSize()` / `getContainerSize()` 之类的读回入口。编一个 `{width: 0, height: 0}`
   * 会把「上游没给尺寸」变成「尺寸是零」——那会让调用方按零尺寸重排布局。
   * 本事件只回答「变了」这一个可证伪的问题；真要尺寸，自己量容器 DOM
   * （`ResizeObserver` 属于业务侧的事，本库不代劳）。
   */
  sizeChanged: [];
  /**
   * 添加 / 移除 / 清空全景覆盖物（官方 `overlay_add` / `overlay_remove` / `overlays_clear`）。
   *
   * 官方这三个事件的载荷分别是 raw `PanoramaLabel`（前两个）与 `PanoramaBaseEvent`（最后一个）。
   * **一律不投影 raw 标注实例**：那会把 SDK 内部对象交出边界。因此：
   * - `overlayAdd` / `overlayRemove`：载荷 `null`（「有一个标注挂上了」这一事实本身即全部信息；
   *   标注的业务内容由拥有它的 `<PanoramaLabel>` 组件自己记账）；
   * - `overlaysClear`：`null`。
   *
   * 之所以值得暴露：`<PanoramaLabel>` 由子组件管理，**父级没有别的观察面**知道
   * 标注什么时候真的挂上了（挂载是异步的：等 Client → 建查看器 → 等场景加载）。
   */
  overlayAdd: [];
  overlayRemove: [];
  overlaysClear: [];
  /**
   * 可见 POI 类型变化（官方 `visible_poi_type_changed: { visiblePOIType }`）。
   *
   * 载荷投影成本库既有的 `PanoramaPoiType`（`"hotel" | … | "none"` 的字面量联合），
   * 而不是官方那个 POI 常量对象——后者是 raw SDK 成员。
   * 上游给了不认识的取值时给 `null`（不塞一个联合之外的字符串，那会让类型说谎）。
   *
   * 它的价值是**闭环**：`setPanoramaPoiType()` 是本库已暴露的写入口，
   * 有了这条事件才能确认「写下去生效了」。
   */
  visiblePoiTypeChanged: [poiType: PanoramaPoiType | null];
  /**
   * ⚠️ **刻意没有** `destroy` 事件（官方 `PanoramaEventMap` 声明了它）。
   *
   * 要让业务听见它，本库的释放顺序就得倒过来：现在
   * `core/panorama/index.ts` 的 `dispose()` 是「**先解绑业务监听、再 `driver.destroy()`**」
   * （ADR 2026-09-11 §6 的「先解绑、后摘除」——SDK 在 `destroy` 期间**同步**派发事件时，
   * 这个顺序保证回调不会打到已拆解的状态上）。
   *
   * 倒过来的代价是拿一个**真实存在的正确性风险**换一句「实例收尾了」的信号：业务回调会在
   * 组件已经进入卸载流程时执行，而 Vue 组件此时的状态是未定义的。
   * 「组件要结束时清理自己的东西」用 `onUnmounted` 就够，且那本来就是 Vue 的正确出口——
   * 为它绕开一条已定的安全属性不划算。
   *
   * 因此本库不声明这条事件。裁决与取舍的完整记录见
   * `docs/zh-CN/contributing/168-remaining-surface.md`。
   */

  /* --- issue #165 TASK 6：SDK 拼写的**兼容别名**（`PANORAMA_EVENT_EMIT_ALIASES`）---
   *
   * 用户拿到事件名的来源有**两份且拼写不同**：JSAPI 声明的 `PanoramaEventMap` 键是
   * snake_case（`link_click`），官方 React 参考的 `on*` props 是 camelCase（`onLinkClick`）。
   * 两种拼写都必须能绑上——与 `<Map>` 的 `MAP_EVENT_EMIT_ALIASES` 同一口径。
   *
   * ⚠️ **别名必须在这里声明**（与 `MapEventEmits` 的同一条硬约束）：Vue 只把**已声明**的
   * 事件名交给 `emit()` 匹配，未声明的名字会落到 `attrs`，`emit()` 唤不醒它（**静默失败**——
   * 监听写对了却什么都不发生）。因此这些键与它们的规范名成对出现，载荷完全相同。
   *
   * 载荷类型逐字复用对应规范名的类型（不是另写一份），因此「别名与规范名载荷不一致」
   * 在类型上就不可能发生。哪些算别名、哪些是**改名**（`load` / `error`）不进这张表，
   * 理由见 `core/panorama/panoramaEventCatalog.ts` 的文件头。
   */
  position_changed: [position: Point | null];
  pov_changed: [pov: PanoramaPov | null];
  zoom_changed: [zoom: number | null];
  id_changed: [id: string | null];
  scene_type_changed: [sceneType: PanoramaSceneType | null];
  links_changed: [links: PanoramaLink[]];
  links_visible_changed: [visible: boolean];
  link_click: [e: PanoramaLinkClickEvent];
  pov_changed_end: [pov: PanoramaPov | null];
  scene_change_end: [sceneType: PanoramaSceneType | null];
  size_changed: [];
  overlay_add: [];
  overlay_remove: [];
  overlays_clear: [];
  visible_poi_type_changed: [poiType: PanoramaPoiType | null];
}>();

/** 画面交互事件载荷（官方 `MouseEvent | TouchEvent` 的收窄投影，只留 `type`）。 */
export interface PanoramaInteractionEvent {
  /** 官方事件名（`click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`）。 */
  type: string;
}

/** `linkClick` 的载荷（官方 `link_click` 里唯一有业务含义的字段）。 */
export interface PanoramaLinkClickEvent {
  /** 相邻全景 id（`setId(id)` 的入参）；上游没给时留在 `undefined`。 */
  id?: string;
}

const containerRef = ref<HTMLElement | null>(null);

/**
 * 动态事件名的 `emit`（issue #165 TASK 6）。
 *
 * `emit` 的键是静态类型，别名要从 `PANORAMA_EVENT_EMIT_ALIASES` 里**按数据**取，
 * 因此动态事件名在这里集中收窄一次（不让 `as` 扩散到其余代码）——与 `<Map>` 的
 * `emitDynamic` 同一手法。
 */
const emitDynamic = emit as unknown as (name: string, ...args: unknown[]) => void;

/**
 * 发一个事件：**先发对外名，再发它的 SDK 拼写别名**（别名为空时只发一次）。
 *
 * 与 `<Map>` 的 `forwardMapEvent()` 同一形状：组件里没有第二份兼容代码。
 *
 * 实参用 rest 转发而不是「永远带一个 payload」：`sizeChanged` / `overlayAdd` 等是**无载荷**
 * 事件，`emit("sizeChanged", undefined)` 会让监听回调收到一个 `undefined` 实参——
 * 与 `emit("sizeChanged")` 对回调而言不等价。
 */
function forward(name: string, ...args: unknown[]): void {
  emitDynamic(name, ...args);
  for (const alias of PANORAMA_EVENT_EMIT_ALIASES[name] ?? []) emitDynamic(alias, ...args);
}

// 全景只需要 Client：`resolveInternalMapContext()` 在 `<Map>` 子树里给地图 context、在 `<BMapProvider>`
// 子树里给 client-only 适配器；两者都能满足 `whenReady()`（后者 `map` 为 null）。
const context = createPanoramaContext({ mapContext: resolveInternalMapContext() });
provide(panoramaContextKey, context);

/** 当前实例（Driver 已按 `jsapiV4PanoramaOf` 收窄过一次，调用点不再写 `!`）。 */
interface ActiveViewer {
  readonly driver: PanoramaViewerDriver;
  readonly viewer: PanoramaHandle;
}
let active: ActiveViewer | null = null;
/**
 * **构造期实际生效的那一份 `options` 的变化键**（不是选项对象本身）。
 *
 * 用来在就绪收敛时判断「构造之后 options 变过没有」：`context.mount()` 可能还在等 Client，
 * 这段窗口里 watcher 会触发，但那时 `active === null`（查看器还不存在），改动会被跳过；
 * 若不在 ready 后补一次，它就永久停在构造期那份了（#95 评审 P2）。比对键而不是无条件重发，
 * 是为了不破坏「同一个值重设不产生多余下发」。
 *
 * 存**键**而不是对象引用，与控件侧的 `optionSnapshot` 是同一手法：基线一旦持有父级传进来的对象，
 * 父级原地改字段就会把基线一起改掉，「构造期到底生效了什么」这个事实随之丢失。此处这个变体在
 * 当前生命周线下不可观测（`context.mount()` 直到构造完成才 resolve，而构造读的是活对象，晚一点的
 * 改动本来就会被构造期看到），因此没有对应的回归用例——写死成键是为了不把正确性寄托在「那个窗口
 * 恰好是同一条同步续体」上。
 */
let createdOptionsKey: string | undefined;

/** `options` 的变化键（watcher 与就绪收敛共用一份判据）。 */
const optionsKeyOf = (options: PanoramaOptions | undefined): string =>
  JSON.stringify([
    options?.navigationControl,
    options?.linksControl,
    options?.indoorSceneSwitchControl,
    options?.albumsControl,
    options?.albumsControlOptions,
  ]);

/**
 * 在本轮创建出来的查看器上执行一次；返回**是否真的执行了**。
 *
 * 调用方靠这个返回值决定要不要推进「构造期基线」——只推进**真的下发过**的那些变化。
 * （未就绪时静默跳过是对的：那一份由 ready 收敛负责补发；但如果这里也把基线推了，
 * 收敛就会以为「已经生效」，改动反而永久丢失。）
 */
function onViewer(run: (target: ActiveViewer) => void): boolean {
  if (!active) return false;
  run(active);
  return true;
}

/** 构造期之后把全部受控 props 落到新实例上（创建与「重建」共用同一份判据）。 */
function applyControlled(target: ActiveViewer): void {
  const { driver, viewer } = target;
  if (props.id !== undefined) driver.setId(viewer, props.id);
  else if (props.point) driver.setPosition(viewer, props.point);
  if (props.pov) driver.setPov(viewer, props.pov);
  if (props.zoom !== undefined) driver.setZoom(viewer, props.zoom);
  if (props.visible === false) driver.hide(viewer);
  if (props.scrollWheelZoom !== undefined) {
    if (props.scrollWheelZoom) driver.enableScrollWheelZoom(viewer);
    else driver.disableScrollWheelZoom(viewer);
  }
  if (props.poiType !== undefined) driver.setPanoramaPoiType(viewer, props.poiType);
  // 收敛等待期间变过的 options（构造期生效的是 `createdOptionsKey` 那一份）
  if (optionsKeyOf(props.options) !== createdOptionsKey && props.options) {
    driver.setOptions(viewer, props.options);
    createdOptionsKey = optionsKeyOf(props.options);
  }
}

/**
 * 事件订阅：官方 `*_changed` 事件不带值，载荷由回读 getter 补上；
 * 订阅走 Facet 自己的**原样**通道（`driver.on`），不经过 Map 事件的归一化。
 *
 * 全部 emit 经 `forward()`：它发规范名 + SDK 拼写别名（issue #165 TASK 6）。
 * 别名表里没有的（`load` / `error` / 五个逐字相同的交互事件）只发一次。
 */
function subscribe(target: ActiveViewer): void {
  const { driver, viewer } = target;
  const scope = context.resources;
  scope.add(
    driver.on(viewer, "position_changed", () =>
      forward("positionChange", driver.getPosition(viewer)),
    ),
  );
  scope.add(driver.on(viewer, "pov_changed", () => forward("povChange", driver.getPov(viewer))));
  scope.add(driver.on(viewer, "zoom_changed", () => forward("zoomChange", driver.getZoom(viewer))));
  scope.add(driver.on(viewer, "id_changed", () => forward("idChange", driver.getId(viewer))));
  scope.add(
    driver.on(viewer, "scene_type_changed", () =>
      forward("sceneTypeChange", driver.getSceneType(viewer)),
    ),
  );
  // `links_changed` 不带值 ⇒ 回读 `getLinks()` 补载荷（与上面五个 `*_changed` 同一手法）
  scope.add(
    driver.on(viewer, "links_changed", () => forward("linksChange", driver.getLinks(viewer))),
  );
  // `links_visible_changed` 的载荷 `{ value: boolean }` 是官方**声明过且自足**的 ⇒ 不回读
  scope.add(
    driver.on(viewer, "links_visible_changed", (event: unknown) =>
      forward("linksVisibleChanged", projectLinksVisible(event)),
    ),
  );
  // ⚠️ 这两条是**改名**不是拼写别名（`dataload → load` / `pano_error → error`），
  // 因此直接 `emit`、不走 `forward`。理由见 `PANORAMA_EVENT_RENAMED`。
  scope.add(driver.on(viewer, "dataload", (event: unknown) => emit("load", event)));
  scope.add(driver.on(viewer, "pano_error", (event: unknown) => emit("error", event)));
  // ---- issue #168 item 3：其余 13 条官方事件的订阅 ----
  //
  // 全部经 `driver.on` 的**原样**通道（与上面 8 条同一路径），差别只在**载荷怎么投影**：
  // 「回读 getter 补值」的三条（`pov_changed_end` / `scene_change_end`）与纯转发/收窄的其余条。
  //
  // 五个画面交互事件（`click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`）
  // 的**订阅名与对外名逐字相同**（上游事件名本来就没有分隔符）⇒ 别名表里没有它们，
  // `forward()` 对它们只发一次。仍走 `forward` 而不是裸 `emit` 是为了「组件里没有第二份
  // 兼容代码」这条不变量成立：将来某个交互事件上游加了分隔符，改的是**表**，不是这里。
  scope.add(
    driver.on(viewer, "click", (e: unknown) => forward("click", projectInteraction(e, "click"))),
  );
  scope.add(
    driver.on(viewer, "dblclick", (e: unknown) =>
      forward("dblclick", projectInteraction(e, "dblclick")),
    ),
  );
  scope.add(
    driver.on(viewer, "touchstart", (e: unknown) =>
      forward("touchstart", projectInteraction(e, "touchstart")),
    ),
  );
  scope.add(
    driver.on(viewer, "touchend", (e: unknown) =>
      forward("touchend", projectInteraction(e, "touchend")),
    ),
  );
  scope.add(
    driver.on(viewer, "clickonroad", (e: unknown) =>
      forward("clickonroad", projectInteraction(e, "clickonroad")),
    ),
  );
  scope.add(
    driver.on(viewer, "link_click", (event: unknown) =>
      forward("linkClick", projectLinkClick(event)),
    ),
  );
  scope.add(
    driver.on(viewer, "pov_changed_end", () => forward("povChangedEnd", driver.getPov(viewer))),
  );
  scope.add(
    driver.on(viewer, "scene_change_end", () =>
      forward("sceneChangeEnd", driver.getSceneType(viewer)),
    ),
  );
  // `size_changed`：只报「变了」。官方没有尺寸字段、SDK 也没有读回入口 ⇒ 载荷为空
  scope.add(driver.on(viewer, "size_changed", () => forward("sizeChanged")));
  // 覆盖物三兄弟：官方载荷是 raw `PanoramaLabel` / `PanoramaBaseEvent`，一律不投影
  scope.add(driver.on(viewer, "overlay_add", () => forward("overlayAdd")));
  scope.add(driver.on(viewer, "overlay_remove", () => forward("overlayRemove")));
  scope.add(driver.on(viewer, "overlays_clear", () => forward("overlaysClear")));
  scope.add(
    driver.on(viewer, "visible_poi_type_changed", (event: unknown) =>
      forward("visiblePoiTypeChanged", projectPoiType(event)),
    ),
  );
  // ⚠️ 官方还有 `destroy`，**刻意不订阅**（释放顺序与 ADR 2026-09-11 §6 冲突，
  // 逐条取舍见上面 `defineEmits` 里那条注释）。
}

/**
 * 画面交互事件（官方 `MouseEvent | TouchEvent`）→ 领域载荷。
 *
 * **只保留 `type`**，理由逐条写在 `defineEmits` 的 `click` 一组上：`target` / `currentTarget`
 * 是 raw `Panorama`，`clientX` / `clientY` 是屏幕像素偏移（与本库的 `{lng, lat}` 不是一回事，
 * 也没有官方读回入口能换算）。编一个「看起来像坐标」的数比不给更糟。
 *
 * 事件对象整体取不到时给**空对象**而不是 `null`：这条事件的全部信息就是「它发生了」，
 * 载荷形状不符不该让调用方以为「事件没派发」。
 */
function projectInteraction(event: unknown, fallbackType: string): PanoramaInteractionEvent {
  const raw = (event as { type?: unknown } | null)?.type;
  return { type: typeof raw === "string" ? raw : fallbackType };
}

/**
 * `link_click` → 领域载荷：只投影官方那个 `id`。
 *
 * 上游没给 `id` 时**留在 `undefined`**（不补空串）：空串是**合法**的全景 id 形状，
 * 补上去会让「上游没给」与「导航到一个空 id」在调用方那里长得一样。
 */
function projectLinkClick(event: unknown): PanoramaLinkClickEvent {
  const raw = (event as { id?: unknown } | null)?.id;
  return typeof raw === "string" && raw.length > 0 ? { id: raw } : {};
}

/**
 * `links_visible_changed` → 裸 `boolean`。
 *
 * 官方声明的载荷是 `{ value: boolean }`——**字段**才是那个布尔，事件对象本身没有别的内容。
 * 与 `visiblePoiTypeChanged` 投影成裸字面量同一手法：不交出官方包装对象。
 *
 * ⚠️ **上游没给 `value` / 给了非 boolean 时归成 `false`，而不是 `undefined`**：
 * 载荷类型是 `boolean`（非可空），塞 `undefined` 会让类型对调用方说谎；而这条事件的
 * 全部语义就是「亮着 / 没亮着」这一个二值判断，「没给」与「false」在**没有读回入口**
 * 的前提下只能落成同一个答案（这与 `getLinks()` 的空数组同源取舍，理由见
 * `driver/types/panorama.ts` 的 `getLinks`）。
 */
function projectLinksVisible(event: unknown): boolean {
  const raw = (event as { value?: unknown } | null)?.value;
  return raw === true;
}

/**
 * `visible_poi_type_changed` → 本库的 `PanoramaPoiType` 字面量。
 *
 * 官方声明的载荷是 `{ visiblePOIType: PanoramaPOIType }`——**字段**才是那个 POI 类型，
 * 事件对象本身是底座形状（`type` / `target` / `currentTarget`）。因此先取字段。
 *
 * ⚠️ 兼容一个**形状退化**的读法：若上游把值直接挂在事件对象上（没有 `visiblePOIType`
 * 这层包装），也接受它。两处都取不到时给 `null`——塞一个联合外的字符串会让类型说谎
 * （调用方会以为它一定是那六个之一）。
 */
function projectPoiType(event: unknown): PanoramaPoiType | null {
  const record = event as { visiblePOIType?: unknown } | null;
  const raw = record?.visiblePOIType ?? event;
  return typeof raw === "string" && (PANORAMA_POI_TYPES as readonly string[]).includes(raw)
    ? (raw as PanoramaPoiType)
    : null;
}

/** 官方 `PanoramaPOIType` 的取值集合（与 `driver/types/panorama.ts` 的 `PanoramaPoiType` 同一份）。 */
const PANORAMA_POI_TYPES: readonly PanoramaPoiType[] = [
  "hotel",
  "catering",
  "movie",
  "transit",
  "indoor_scene",
  "none",
];

onMounted(async () => {
  const container = containerRef.value;
  if (!container) return;
  // 与传给 `mount()` 的**同一个值**：这段窗口里父级可能改 options，收敛时要用它做基线
  const initialOptions = props.options;
  createdOptionsKey = optionsKeyOf(initialOptions);
  try {
    const ready = await context.mount(container, initialOptions);
    active = { driver: jsapiV4PanoramaOf(ready.client), viewer: ready.viewer };
    applyControlled(active);
    subscribe(active);
  } catch {
    // 创建失败已写进 `context.error` / `context.status`（对 `ref` 可见），这里不再补事件：
    // 本组件的 `error` 事件对应的是官方 `pano_error`（**场景数据**加载失败），
    // 与「查看器没建起来」不是同一件事，混用会让调用方分不清该重试哪一个。
  }
});

// 卸载顺序：**父的 `onUnmounted` 在子树之后**，因此 `<PanoramaLabel>` 先把自己从查看器上摘掉，
// 再由这里销毁查看器（反过来会让子组件对已销毁的查看器调用 removeOverlay）。
onUnmounted(() => {
  active = null;
  context.dispose();
});

watch(
  // 键按字段展开：父级传内联字面量不应触发一次多余的下发。
  // `point` 与 `id` 同一份键：同时给出时以 `id` 为准（构造期与更新期必须同一判据）。
  () => JSON.stringify([props.point?.lng, props.point?.lat, props.id]),
  () => {
    onViewer((target) => {
      if (props.id !== undefined) target.driver.setId(target.viewer, props.id);
      else if (props.point) target.driver.setPosition(target.viewer, props.point);
    });
  },
);

watch(
  () => JSON.stringify([props.pov?.heading, props.pov?.pitch]),
  () => {
    const pov = props.pov;
    if (pov) onViewer((target) => target.driver.setPov(target.viewer, pov));
  },
);

watch(
  () => props.zoom,
  (zoom) => {
    if (zoom !== undefined) onViewer((target) => target.driver.setZoom(target.viewer, zoom));
  },
);

watch(
  () => props.visible,
  (visible) => {
    if (visible === undefined) return;
    onViewer((target) => {
      if (visible) target.driver.show(target.viewer);
      else target.driver.hide(target.viewer);
    });
  },
);

watch(
  () => props.scrollWheelZoom,
  (enabled) => {
    if (enabled === undefined) return;
    onViewer((target) => {
      if (enabled) target.driver.enableScrollWheelZoom(target.viewer);
      else target.driver.disableScrollWheelZoom(target.viewer);
    });
  },
);

watch(
  () => props.poiType,
  (poiType) => {
    if (poiType === undefined) return;
    onViewer((target) => target.driver.setPanoramaPoiType(target.viewer, poiType));
  },
);

watch(
  // 键按字段展开：父级传内联字面量不应触发一次多余的整体写回
  () => optionsKeyOf(props.options),
  () => {
    const options = props.options;
    if (!options) return;
    // 只有真的下发成功才推进基线；未就绪时留给 ready 收敛（见 `onViewer` 的注释）
    const applied = onViewer((target) => target.driver.setOptions(target.viewer, options));
    if (applied) createdOptionsKey = optionsKeyOf(options);
  },
);

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "Panorama" });

/**
 * 组件命令面在「未就绪 / 正在重建 / 已释放」时的**显式失败**（issue #171 item I）。
 *
 * 与 `core/overlays/overlayCommands.ts` 的 `disposed()`、`<PanoramaLabel>` 的命令面同一口径，
 * 也与 ADR 2026-09-11 的「destroy 之后命令必须失败」一致。命令面里**没有**「静默返回」这一档：
 * 静默会让调用方把「资源已释放」误判成「SDK 说没有」。`capture` / `clearOverlays` 都在这条
 * 口径下（`getLinks` 是唯一例外，它的空与非空不承载语义——理由写在那条方法上）。
 */
function panoramaDisposed(command: string): BMapError {
  return new BMapError(
    "BMAP_RESOURCE_DISPOSED",
    `<Panorama>.${command}(): 查看器未就绪、正在重建或已经释放，本次调用被拒绝` +
      "（不静默 no-op——读会拿到编出来的值、写会悄无声息地丢掉）。" +
      "请在就绪后调用（先 await whenReady()，或看组件 ref 上的 status）。",
    { component: "Panorama" },
  );
}

defineExpose({
  /** 查看器就绪（含 Client）；供业务做命令式操作或判定加载结果 */
  whenReady: (signal?: AbortSignal) => context.whenReady(signal),
  /**
   * 当前场景的相邻链接（官方 `Panorama#getLinks(): PanoramaLink[]`）。
   *
   * 官方 React 参考实现同样暴露它；此前本库**没有**这条读取路径。
   * 未就绪时给**空数组**（理由见 `driver/types/panorama.ts` 的 `getLinks`），
   * 不抛错、不给 `undefined`——`linksChange` 的初始载荷也因此是 `[]` 而不是「未定义」。
   */
  getLinks: (): PanoramaLink[] => {
    const current = active;
    if (!current) return [];
    try {
      return current.driver.getLinks(current.viewer);
    } catch {
      // 官方 `getLinks` 的成员缺失 / 形状不符已被 Driver 归一成空数组；
      // 这里的 catch 只覆盖「查看器已在 dispose 与本调用之间被换掉」那一瞬的 SDK 抛错。
      return [];
    }
  },
  /**
   * 取当前全景画面为 Data URL（官方 `Panorama#capture`，issue #171 item I）。
   *
   * **返回 `string | null`，但「未就绪」不是 `null`**：
   * - `null` = 官方那条承诺的「当前渲染器不支持截图」（原声明是 `undefined`，Driver 归一）；
   *   拿到它意味着「换一条取画面的路」（例如 `<Map>` 的 `getScreenshot()`）；
   * - 未就绪 / 已释放 / 重建窗口内 → **抛 `BMAP_RESOURCE_DISPOSED`**，绝不静默给 `null`。
   *
   * 为什么不把「未就绪」也降级成 `null`（`getLinks` 那条是这么做的）：`getLinks` 的空与非空
   * **不承载语义**（没有链接 ≡ 拿不到链接，对调用方是同一件事）；而 `capture` 的 `null`
   * 是**一条有后果的判断**——调用方据此决定换路。把它和「组件已卸载」混在一起，会让一个
   * 已经卸载的组件被读成「这个环境截不了图」，从而走进一条永远拿不到画面的分支。
   * 覆盖面内的**其余**失败（SDK 抛错、成员缺失）照常上抛，不进 `null`。
   */
  capture: (options?: PanoramaCaptureOptions): string | null => {
    const current = active;
    if (!current) throw panoramaDisposed("capture");
    return current.driver.capture(current.viewer, options);
  },
  /**
   * 清空查看器里**本库不管理的**覆盖物（官方 `Panorama#clearOverlays`，issue #171 item I）。
   *
   * ## 对调用方的语义（**这条是契约**）
   *
   * 官方 `clearOverlays()` 清的是**全部**覆盖物。官方**没有**枚举接口——`Panorama` 的覆盖物面
   * 只有 `addOverlay` / `removeOverlay` / `clearOverlays` 三个方法
   * （`panorama/Panorama.d.ts:87` / `:92` / `:115`）——所以「跳过本库管理的、只清其余的」
   * 在官方面上**写不出来**：判不出哪个是其余的。可写的只有一条：清完之后把**当前挂载着的
   * `<PanoramaLabel>`** 按名册**重新挂回去**。
   *
   * ⇒ 调用方看到的效果是：**业务自己挂上去的覆盖物（经 `advanced` 逃生口或直接用 SDK）被清掉，
   * `<PanoramaLabel>` 管理的标注保留且是当前的**。重新挂回的是**同一个句柄**，因此标注的
   * 业务内容不变，后续 prop 变化照常落到画面上。
   *
   * 要连 `<PanoramaLabel>` 一起清掉，正确做法是**卸载那些组件**——它们的释放路径是各自的
   * `removeLabel()`，这也是「谁创建谁摘除」这条所有权不变式的落点。
   *
   * ## 为什么不是「限制 clearOverlays 让它碰不到本库管理的」
   *
   * 那要么是**不调用**官方那条命令（业务要的「把这一屏标注撤掉重画」就没了，而那正是
   * #171 补这条命令的唯一理由），要么是**自己枚举后逐个 remove**（没有枚举接口，只能去摸
   * SDK 内部状态——AGENTS.md 禁止「镜像读不回的内部状态」）。协调是唯一有依据的第三条路。
   *
   * 未就绪 / 已释放**显式抛** `BMAP_RESOURCE_DISPOSED`（不静默 no-op——清不掉却报告成功会让
   * 标注静默叠加）。
   *
   * 重新挂回**失败**时：逐个继续、最后抛出一次汇总错误。静默吞掉会让那些标注停在
   * 「组件认为挂着、画面上不存在」——正是本函数要消灭的那一类分叉。
   */
  clearOverlays: (): void => {
    const current = active;
    if (!current) throw panoramaDisposed("clearOverlays");
    current.driver.clearOverlays(current.viewer);
    // 名册取**一次**快照：清空与重新挂回之间是同步的，但把快照固定下来能让错误消息里的
    // 分母与实际尝试过的数量是同一个值（重新求值名册理论上仍会一致，写死是为了让
    // 「报出去的数字」与「真的做了什么」不可能分叉）。
    const labels = context.managedLabels();
    const failures: unknown[] = [];
    for (const label of labels) {
      try {
        current.driver.addLabel(current.viewer, label);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `<Panorama>.clearOverlays(): ${labels.length - failures.length} / ${labels.length} ` +
          "个本库标注已重新挂回，其余失败——" +
          "这些标注此刻**不在画面上**（它们的组件仍认为已挂载），请重新挂载对应组件",
        { component: "Panorama", cause: failures[0] },
      );
    }
  },
  /** 当前查看器句柄（未就绪为 `null`） */
  viewer: context.viewer,
  /** 实例状态（`idle` / `waiting-client` / `creating` / `ready` / `error` / `disposing` / `disposed`） */
  status: context.status,
  /** 最近一次失败（`status === "error"` 时有值） */
  error: context.error,
});
</script>

<template>
  <!--
    全景容器由 SDK 在内部填充；本组件只给出这个宿主 div（尺寸由使用方经 class/style 提供）。
    **必须保留 `<slot />`**：`<PanoramaLabel>` 这类子组件要挂载才会创建标注——没有出口的话
    它们永远不会 mount（#41 实测踩到：标注用例全绿但一条标注都没建出来）。
  -->
  <div ref="containerRef">
    <slot />
  </div>
</template>
