<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import {
  createPanoramaContext,
  jsapiV4PanoramaOf,
  panoramaContextKey,
} from "../../core/panorama";
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

  /* --- issue #168 item 3：官方 `PanoramaEventMap` 的 23 条里，此处新增 13 条 ---
   *
   * 逐条裁决（**加 / 不加** 与理由）见 `docs/zh-CN/contributing/168-remaining-surface.md`
   * 与 `tests/behavior/panorama-events.test.ts` 的文件头总表；这里只记**载荷形状**的依据。
   *
   * ⚠️ **命名偏差（已存在，非本次引入）**：全库规则 `toVueEventName` 产出 kebab-case，
   * 而本组件早已发布的 8 条是 camelCase。新增事件**沿用 camelCase** 以免同一组件内
   * 混两套命名；改名那 8 条是破坏性变更，属父决策。
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
 */
function subscribe(target: ActiveViewer): void {
  const { driver, viewer } = target;
  const scope = context.resources;
  scope.add(driver.on(viewer, "position_changed", () => emit("positionChange", driver.getPosition(viewer))));
  scope.add(driver.on(viewer, "pov_changed", () => emit("povChange", driver.getPov(viewer))));
  scope.add(driver.on(viewer, "zoom_changed", () => emit("zoomChange", driver.getZoom(viewer))));
  scope.add(driver.on(viewer, "id_changed", () => emit("idChange", driver.getId(viewer))));
  scope.add(driver.on(viewer, "scene_type_changed", () => emit("sceneTypeChange", driver.getSceneType(viewer))));
  // `links_changed` 不带值 ⇒ 回读 `getLinks()` 补载荷（与上面五个 `*_changed` 同一手法）
  scope.add(driver.on(viewer, "links_changed", () => emit("linksChange", driver.getLinks(viewer))));
  scope.add(driver.on(viewer, "dataload", (event: unknown) => emit("load", event)));
  scope.add(driver.on(viewer, "pano_error", (event: unknown) => emit("error", event)));
  // ---- issue #168 item 3：其余 13 条官方事件的订阅 ----
  //
  // 全部经 `driver.on` 的**原样**通道（与上面 8 条同一路径），差别只在**载荷怎么投影**：
  // 「回读 getter 补值」的三条（`pov_changed_end` / `scene_change_end`）与纯转发/收窄的其余条。
  //
  // ⚠️ `destroy` 的订阅**在 scope 里**：scope 在 `context.dispose()` 时释放，而事件由
  // `driver.destroy()` 派发——两者都在 `onUnmounted` 里，因此业务回调仍能收到它
  // （`tests/behavior/panorama-events.test.ts` 的「销毁时派发一次」就是这条的断言）。
  // 五个画面交互事件的**订阅名与 emit 名逐字相同**（上游事件名本来就没有分隔符），
  // 因此一张表同时给出「订阅什么」与「emit 什么」。逐条展开而不是在循环里 `emit(name)`：
  // `defineEmits` 的重载要求实参是**字面量键**，循环里的联合类型过不了这一关
  // ——把展开写死，也让「哪五条是这一族」在源码里一眼可见。
  scope.add(driver.on(viewer, "click", (e: unknown) => emit("click", projectInteraction(e, "click"))));
  scope.add(
    driver.on(viewer, "dblclick", (e: unknown) => emit("dblclick", projectInteraction(e, "dblclick"))),
  );
  scope.add(
    driver.on(viewer, "touchstart", (e: unknown) =>
      emit("touchstart", projectInteraction(e, "touchstart")),
    ),
  );
  scope.add(
    driver.on(viewer, "touchend", (e: unknown) => emit("touchend", projectInteraction(e, "touchend"))),
  );
  scope.add(
    driver.on(viewer, "clickonroad", (e: unknown) =>
      emit("clickonroad", projectInteraction(e, "clickonroad")),
    ),
  );
  scope.add(
    driver.on(viewer, "link_click", (event: unknown) => emit("linkClick", projectLinkClick(event))),
  );
  scope.add(
    driver.on(viewer, "pov_changed_end", () => emit("povChangedEnd", driver.getPov(viewer))),
  );
  scope.add(
    driver.on(viewer, "scene_change_end", () =>
      emit("sceneChangeEnd", driver.getSceneType(viewer)),
    ),
  );
  // `size_changed`：只报「变了」。官方没有尺寸字段、SDK 也没有读回入口 ⇒ 载荷为空
  scope.add(driver.on(viewer, "size_changed", () => emit("sizeChanged")));
  // 覆盖物三兄弟：官方载荷是 raw `PanoramaLabel` / `PanoramaBaseEvent`，一律不投影
  scope.add(driver.on(viewer, "overlay_add", () => emit("overlayAdd")));
  scope.add(driver.on(viewer, "overlay_remove", () => emit("overlayRemove")));
  scope.add(driver.on(viewer, "overlays_clear", () => emit("overlaysClear")));
  scope.add(
    driver.on(viewer, "visible_poi_type_changed", (event: unknown) =>
      emit("visiblePoiTypeChanged", projectPoiType(event)),
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
   * 清空查看器里的**全部**覆盖物（官方 `Panorama#clearOverlays`，issue #171 item I）。
   *
   * 与逐个 `removeLabel()` 是两条路：`<PanoramaLabel>` 的释放路径是各自的摘除，而业务
   * 「把这一屏标注撤掉重画」时手上未必有那些句柄。未就绪 / 已释放**显式抛**
   * `BMAP_RESOURCE_DISPOSED`（不静默 no-op——清不掉却报告成功会让标注静默叠加）。
   */
  clearOverlays: (): void => {
    const current = active;
    if (!current) throw panoramaDisposed("clearOverlays");
    current.driver.clearOverlays(current.viewer);
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
