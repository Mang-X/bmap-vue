<script setup lang="ts">
import {
  computed,
  inject,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onUnmounted,
  provide,
  readonly,
  ref,
  shallowRef,
  useId,
  watch,
  type ShallowRef,
} from "vue";
import { mapContextKey, type MapContext, type MapReadyContext } from "../../core/context/types";
import {
  bmapClientContextKey,
  createClientContext,
  defaultClientDefinitionKey,
  type BMapClientContext,
} from "../../core/context/client";
import { targetContextKey, type TargetContext } from "../../core/context/target";
import { MapRuntime } from "../../core/runtime/MapRuntime";
import { BMapError } from "../../core/errors/BMapError";
import type { BMapLoadOptions } from "../../core/loader/url";
import { DEFAULT_VERSION } from "../../core/loader/url";
import { baiduJsapiV4Provider } from "../../core/loader/providers/index";
import type { BMapClient, BMapProviderLike, CreateBMapClientOptions } from "../../client/types";
import {
  BMAP_COMPONENT_EVENT_EMIT_ALIASES,
  MAP_EVENT_CATALOG,
  MAP_EVENT_EMIT_ALIASES,
  MAP_EVENT_NAMES,
  type MapEventEmits,
  type MapEventName,
} from "../../core/events/eventCatalog";
import { subscribeMapEvent } from "../../core/events/subscribeMapEvent";
import { readLiveView } from "../../core/utils/liveView";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";
import type { MapInteraction, MapType } from "../../driver/types/map";
import type { Point } from "../../driver/types/geometry";
import type { MapHandle } from "../../driver/types/handles";
import { useControllableState } from "../../composables/useControllableState";
import { useMapSuspension } from "../../composables/useMapSuspension";
import { createMapCommands } from "../../core/runtime/mapCommands";
import { MAP_SUSPEND_REASONS } from "../../core/runtime/suspension";
import { isUsableSize } from "../../core/runtime/elementSize";
import type { BMapExpose } from "../../types/mapExpose";
import { ANGLE_EPSILON, anglesEqual, centerEquals, centerKey, numbersEqual } from "../../core/utils/equality";
import { resolvePluginDefinition } from "../../plugins/catalog";

export type { BMapProps };

/** `center` 的两种输入形态：点，或 v2 兼容的城市名 / 地址字符串（由 `BMapProps` 派生，单一来源）。 */
type MapCenter = NonNullable<BMapProps["center"]>;

const props = withDefaults(defineProps<BMapProps>(), {
  width: "100%",
  height: "550px",
  mapType: "BMAP_NORMAL_MAP",
  minZoom: 0,
  maxZoom: 21,
  noAnimation: false,
  enableDragging: true,
  enableScrollWheelZoom: false,
  loadingBgColor: "#f1f1f1",
  keepAliveBehavior: "suspend",
  // 容器尺寸变化时自动 `checkResize`（#29）：默认开启。`false` 时只更新读数，由调用方
  // 自己在合适的时机调用暴露的 `checkResize()`（此前这个 prop 是「接收后忽略」的假支持）。
  enableAutoResize: true,
  // 视野四字段（center/zoom/heading/tilt）**刻意不给默认值**（M4-STATE / #27）：
  // `undefined` 是「当前非受控」的判定依据，给了默认值就再也区分不出「父级传了」
  // 与「父级没传」。库默认视野移到 DEFAULT_VIEW，作为「缺省」档的兜底参与首次解析，
  // 因此「什么都不传」的行为与旧版默认值完全一致。
});

export interface MapReadyPayload extends MapReadyContext {
  container: HTMLElement;
}

/**
 * 承载本图的地图组件是否已开始卸载（M4-EVENTS / #28）。
 *
 * `onBeforeUnmount` 置位 —— 早于子树卸载（Vue 的顺序：父 `beforeUnmount` → 父作用域 stop →
 * 卸载子树 → 父 `unmounted`，地图销毁在最后一步）。`useMapEvent` 靠它区分「整图 teardown」
 * （`destroy` 订阅要活到地图销毁）与「子组件自行卸载」（订阅照常释放）。
 */
let tearingDown = false;

/**
 * map 事件的 emits 声明（M4-EVENTS / #28）：名字与载荷来自 `core/events/eventCatalog` 的
 * `MapEventEmits`（显式键的接口——`@vue/compiler-sfc` 需要可枚举的键，理由见那个接口的注释），
 * 这里**不手抄第二份**：Catalog 增删事件时模板提示、TS 提示与 `useMapEvent` 一起变。
 */
const emit = defineEmits<
  {
    ready: [payload: MapReadyPayload];
    initd: [payload: MapReadyPayload];
    "plugin-ready": [name: string];
    "plugin-error": [payload: { name: string; error: unknown }];
    unload: [];
    error: [err: unknown];
    // 视野回写（M4-STATE / #27）：`v-model:center` 等语法糖依赖这四个事件。
    // 载荷永远是 SDK 读回的**具体坐标点**：即使受控值是城市名字符串，用户交互后也会变成点。
    "update:center": [value: Point];
    "update:zoom": [value: number];
    "update:heading": [value: number];
    "update:tilt": [value: number];
  } & MapEventEmits
>();

/**
 * 转发一个 map 事件：先发规范名，再发兼容别名（都从 `MAP_EVENT_EMIT_ALIASES` 读）。
 *
 * `emit` 的键是静态类型，动态事件名在这里集中收窄一次（不让 `as` 扩散到其余代码）。
 */
const emitDynamic = emit as unknown as (name: string, ...args: unknown[]) => void;

function forwardMapEvent(vue: MapEventName, event: unknown): void {
  emitDynamic(vue, event);
  for (const alias of MAP_EVENT_EMIT_ALIASES[vue] ?? []) emitDynamic(alias, event);
}

/**
 * 发 `ready` 与它的历史别名（`initd`）。
 *
 * 别名从 Catalog 的 `BMAP_COMPONENT_EVENT_EMIT_ALIASES` 读，因此「旧名称的集中 deprecation」
 * 只有这一处（issue #28 禁止组件各自兼容）。此前 `ready` / `initd` 这对组合在 `boot()` 里
 * 写了两遍（就绪早退路径与正常路径各一次），改一处漏一处就会漂移。
 * 其余组件事件没有别名，照常走类型化的 `emit(...)`。
 */
function emitReady(payload: MapReadyPayload): void {
  emit("ready", payload);
  for (const alias of BMAP_COMPONENT_EVENT_EMIT_ALIASES.ready ?? []) {
    emitDynamic(alias, payload);
  }
}

const containerRef = ref<HTMLDivElement | null>(null);
/**
 * 组件**根容器**（作者声明的尺寸所在）。M4-HANDLE-UX / #29：容器门禁与可见性策略测量的是
 * 它，而不是内层 `bmap-canvas-host`。内层壳是 `position: absolute; inset: 0` 的定位壳，
 * 尺寸完全由根容器决定 —— 真实浏览器上两者同盒，但显式区分能让「测量谁」成为可评审的选择。
 */
const rootRef = ref<HTMLDivElement | null>(null);
// SSR-safe DOM id(服务端只输出固定容器 shell,客户端 mounted 后加载)
const containerId = useId();

// 不再复制 Runtime 状态，直接复用 runtime refs(单一来源)
const runtimeRef = shallowRef<MapRuntime | null>(null);

const status = computed(() => runtimeRef.value?.status.value ?? "idle");
const map = computed(() => runtimeRef.value?.map.value ?? null);
const client = computed(() => runtimeRef.value?.client.value ?? null);
const error = computed(() => runtimeRef.value?.error.value ?? null);

const width = computed(() => (typeof props.width === "number" ? `${props.width}px` : props.width));
const height = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

// Client 查找顺序:显式 client prop > 显式 definition > 显式 provider/ak >
// 最近 BMapProvider > app.use 默认 definition > 旧 bmapConfig > 报错
//
// M3A3-REMOVE-LEGACY（#26）：删掉了 webgl-v1 时代的两条兜底——`allowExistingGlobal` 与
// 「页面已有全局就自动回退」。它们走的是 legacy `existingGlobalProvider()`（读 `BMap ?? BMapGL`），
// 需要复用宿主已加载的 SDK 时请显式传 `existingGlobalV4Provider()`（v4 语义）。
const parentClientContext = inject(bmapClientContextKey, undefined) as
  | BMapClientContext
  | undefined;
const defaultDefinition = inject(defaultClientDefinitionKey, undefined) as
  | CreateBMapClientOptions
  | undefined;
const appConfig = inject(bmapConfigKey, undefined) as BMapPluginConfig | undefined;

let clientContext: BMapClientContext;
let ownClientContext = false;
if (props.client) {
  clientContext = createClientContext({ client: props.client as BMapClient });
  ownClientContext = true;
} else if (props.definition) {
  clientContext = createClientContext({ definition: props.definition });
  ownClientContext = true;
} else if (props.provider || props.ak || props.apiUrl) {
  // R25-B（issue #71）：无显式 Provider 时默认落到 v4 家族（内部委托官方 `@baidumap/jsapi-loader`）。
  // `props.apiUrl` 是「自定义入口」，默认路径无法表达，会在加载前显式报错并指向 customScriptV4Provider()。
  const provider: BMapProviderLike = props.provider ?? appConfig?.provider ?? baiduJsapiV4Provider();
  const loadOptions: BMapLoadOptions = {
    ak: props.ak ?? appConfig?.defaults?.ak,
    apiUrl: props.apiUrl ?? appConfig?.defaults?.apiUrl,
    version: appConfig?.defaults?.version ?? DEFAULT_VERSION,
  };
  // 定义直接进 Client：`createBMapClient` 的默认 Driver 工厂已是 jsapi-v4，
  // 迁移期的 `withMigrationDriver` 归一随 webgl-v1 删除（#26）。
  clientContext = createClientContext({
    definition: { provider, loadOptions },
  });
  ownClientContext = true;
} else if (parentClientContext) {
  clientContext = parentClientContext;
} else if (defaultDefinition) {
  // 定义直接透传（收口在 core/context/client.ts 与 createBMapClient）
  clientContext = createClientContext({ definition: defaultDefinition });
  ownClientContext = true;
} else if (appConfig?.provider) {
  clientContext = createClientContext({
    definition: { provider: appConfig.provider, loadOptions: appConfig.defaults },
  });
  ownClientContext = true;
} else {
  // 无定义:创建空 context,mount 时抛出明确缺失错误(经 error 事件)
  clientContext = createClientContext({ definition: undefined });
  ownClientContext = true;
}

if (ownClientContext) {
  provide(bmapClientContextKey, clientContext);
}

/* ------------------------------------------------------------------ 视野状态（M4-STATE / #27）
 *
 * `center` / `zoom` / `heading` / `tilt` 走同一个三态模型：
 *
 * - **受控**（传了该字段）：外部值变化 → 写 SDK；SDK 的用户交互事件 → 回写 model + emit `update:*`
 * - **非受控**（只传了 `defaultXxx`）：初值 = `defaultXxx`，之后内部状态自行演进
 * - **缺省**（都没传）：初值 = 库默认视野（与旧版 props 默认值一致）
 *
 * 三条禁止（详见 ADR `2026-09-14-map-controlled-state`）：
 * 1. 不用 `deep` 比较 center —— 父级传内联字面量时引用每次都变，deep/引用比较会让受控写入空跑；
 * 2. 后续 center 变化不再走 `centerAndZoom` —— 那是「重置视野」，会把 zoom 一起改掉；
 * 3. 不引入「来源标记」（如 `internalUpdate` 布尔位）来抑制回环 —— 回环抑制由**读回现值 + 容差判等**
 *    完成，它是可观察的（不依赖「事件是否恰好在某一帧内到达」），也让「用户交互 → 父级回写同一值」
 *    这条最常见的闭环自然收敛。
 */

/** 库默认视野（「缺省」档的兜底）：与 v2/v3 的 props 默认值保持一致。 */
const DEFAULT_VIEW = {
  center: { lng: 116.403901, lat: 39.915185 },
  zoom: 14,
  heading: 0,
  tilt: 0,
} as const;

/**
 * `center` 的防御性拷贝（#27 评审 P1）。
 *
 * 点必须拷：`center` / `defaultCenter` 是**可变对象**，父级拿到自己的对象后原地改一个字段
 * （`spot.lng = 5`）不会触发 props 变化，却会顺着引用改到状态内部的初值 / 镜像 / 首次视野快照上，
 * 于是「resetView 回到首次值」「default 只读一次」两条语义都被绕过。字符串是不可变的，原样返回。
 */
function cloneCenter(value: MapCenter): MapCenter {
  if (typeof value === "string") return value;
  return { lng: value.lng, lat: value.lat };
}

const centerState = useControllableState<MapCenter>({
  name: "center",
  value: () => props.center,
  defaultValue: () => props.defaultCenter,
  fallback: DEFAULT_VIEW.center,
  equals: centerEquals,
  copy: cloneCenter,
});

const zoomState = useControllableState<number>({
  name: "zoom",
  value: () => props.zoom,
  defaultValue: () => props.defaultZoom,
  fallback: DEFAULT_VIEW.zoom,
  equals: numbersEqual,
});

const headingState = useControllableState<number>({
  name: "heading",
  value: () => props.heading,
  defaultValue: () => props.defaultHeading,
  fallback: DEFAULT_VIEW.heading,
  // heading 是环绕角：v4 的 `setHeading(270)` 之后 `getHeading()` 返回 -90，
  // 线性判等会让每次自身写入都产生一条假的 `update:heading`。
  equals: anglesEqual,
});

/** tilt 是 0..90 的倾斜角（**无**环绕语义），容差与角度同级但用线性判等。 */
function tiltEquals(a: number, b: number): boolean {
  return numbersEqual(a, b, ANGLE_EPSILON);
}

const tiltState = useControllableState<number>({
  name: "tilt",
  value: () => props.tilt,
  defaultValue: () => props.defaultTilt,
  fallback: DEFAULT_VIEW.tilt,
  equals: tiltEquals,
});

/**
 * 初始视角快照：由**首次解析**的三态值构成，供 `MapRuntime` 的 `initializeView` 与
 * `resetView()` 使用。之后它不再跟随任何 prop 变化（`resetView` 的语义就是回到初值）。
 *
 * 类型上刻意**不标注 `MapView`**（它的 `heading` / `tilt` 是可选的，会削弱后面 `converge` 的
 * 类型推断）：这里的四个字段都来自三态解析，heading / tilt 恒为数字（fallback 是 0），
 * 结构上满足 `MapView`，赋给 `MapRuntime.initialView` 与 `initializeView` 都成立。
 */
const initialViewSnapshot = {
  center: centerState.initial,
  zoom: zoomState.initial,
  heading: headingState.initial,
  tilt: tiltState.initial,
};

/**
 * 受控 `center` → SDK。
 *
 * 1. 先同步内部镜像（受控值优先，并触发模式切换告警）；
 * 2. 非受控（`undefined`）直接返回，不写 SDK；
 * 3. **读回** SDK 现值做容差判等：一致就不下命令。这一步既抑制「父级回写同一值」的重复命令，
 *    也抑制真实 SDK 的浮点抖动；反过来，`centerAndZoom` 永远不会出现在这条路径上；
 * 4. 读不到（地图已销毁 / 该能力不可用）也直接返回：写命令在同样条件下只会抛同样的错。
 */
function applyCenterFromProps(next: MapCenter | undefined): void {
  centerState.syncExternal(next);
  if (next === undefined) return;
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;
  const current = readLiveView(() => c.driver.map.getCenter(m));
  if (current === null) return;
  if (centerEquals(current, next)) return;
  c.driver.map.setCenter(m, next);
}

/** 受控 `zoom` → SDK（同 `applyCenterFromProps` 的读回判等）。 */
function applyZoomFromProps(next: number | undefined): void {
  zoomState.syncExternal(next);
  if (next === undefined) return;
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;
  const current = readLiveView(() => c.driver.map.getZoom(m));
  if (current === null) return;
  if (numbersEqual(current, next)) return;
  c.driver.map.setZoom(m, next);
}

/** 受控 `heading` → SDK（环绕判等）。 */
function applyHeadingFromProps(next: number | undefined): void {
  headingState.syncExternal(next);
  if (next === undefined) return;
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;
  const current = readLiveView(() => c.driver.map.getHeading(m));
  if (current === null) return;
  if (anglesEqual(current, next)) return;
  c.driver.map.setHeading(m, next);
}

/** 受控 `tilt` → SDK。 */
function applyTiltFromProps(next: number | undefined): void {
  tiltState.syncExternal(next);
  if (next === undefined) return;
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;
  const current = readLiveView(() => c.driver.map.getTilt(m));
  if (current === null) return;
  if (numbersEqual(current, next, ANGLE_EPSILON)) return;
  c.driver.map.setTilt(m, next);
}

/**
 * ready 时的**唯一**收敛路径：把「生效值」写进地图（#27 评审第二 / 三轮）。
 *
 * 两点合起来决定了它的形状：
 *
 * 1. **必须覆盖非受控档**（第二轮 P1）：加载窗口里可能发生 **受控 → 非受控**——那时内部状态已经
 *    接管（保留最后一次外部值），可 watcher 之后不会再跑（prop 不再变化），于是「内部状态 = A、
 *    地图 = 首次快照」永久分叉，正好违反「受控 → 非受控 由内部状态接管」这条规则。因此目标是
 *    **生效值**（受控时外部值、非受控时内部状态），而不是「props 是否有值」。
 * 2. **不能与 `apply*FromProps` 叠加**（第三轮 P2）：字符串 `center` 无法与读回的点判等，
 *    先跑 `apply*FromProps` 再跑这里会写两次。现在 ready 时每个字段**至多写一次**。
 *
 * 判定用的是**可证明的前提**：调用点紧接 `initializeView`，而加载窗口内没有 map 可写 ⇒ 期间
 * 没有任何视野写入落地，因此「与首次快照相同的字段」一定已经在地图上（短路即可）。这条短路同时
 * 挡掉了「字符串中心点无法与读回值判等」造成的假写入（`center="北京市"` 且没变过 ⇒ 0 条命令）。
 */
function convergeViewToState(): void {
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;

  /** 目标与快照相同 ⇒ 初始化已经写过；否则读回判等后再写。 */
  function converge<T>(
    snapshotValue: T,
    target: T,
    equals: (a: T, b: T) => boolean,
    read: () => T | null,
    write: (value: T) => void,
  ): void {
    if (equals(target, snapshotValue)) return;
    const current = read();
    if (current === null || equals(current, target)) return;
    write(target);
  }

  converge(
    initialViewSnapshot.center,
    centerState.value.value,
    centerEquals,
    () => readLiveView(() => c.driver.map.getCenter(m)),
    (value) => c.driver.map.setCenter(m, value),
  );
  converge(
    initialViewSnapshot.zoom,
    zoomState.value.value,
    numbersEqual,
    () => readLiveView(() => c.driver.map.getZoom(m)),
    (value) => c.driver.map.setZoom(m, value),
  );
  converge(
    initialViewSnapshot.heading,
    headingState.value.value,
    anglesEqual,
    () => readLiveView(() => c.driver.map.getHeading(m)),
    (value) => c.driver.map.setHeading(m, value),
  );
  converge(
    initialViewSnapshot.tilt,
    tiltState.value.value,
    tiltEquals,
    () => readLiveView(() => c.driver.map.getTilt(m)),
    (value) => c.driver.map.setTilt(m, value),
  );
}

/**
 * ready 之前的视野收敛（#27 评审两轮，第三轮统一为**一条路径**）。
 *
 * 为什么必须有这一步：watcher 在 SDK 未就绪时会跳过写入（那时没有 map 可写），而首次视野用的是
 * setup 阶段冻结的快照。父级在「SDK 加载中」改 prop 是**文档明确支持**的用法
 * （`:center="loaded ? spot : undefined"`）：那次写入会被丢掉，之后 prop 不再变化 ⇒ watcher
 * 不会重跑 ⇒ 地图永远停在旧初值。
 *
 * **单一收敛路径**（第三轮 P2）：这里只做「同步三态（模式 + 镜像）→ 按生效值收敛」，
 * 不再先跑一遍 `apply*FromProps`。两条路径叠加会让**字符串 `center`** 被写两次——
 * 字符串无法与读回的点判等，`applyCenterFromProps` 写一次、`convergeViewToState` 再写一次。
 * 现在每个字段在 ready 时**至多写一次**（见 `convergeViewToState` 的快照短路）。
 */
function syncControlledView(): void {
  centerState.syncExternal(props.center);
  zoomState.syncExternal(props.zoom);
  headingState.syncExternal(props.heading);
  tiltState.syncExternal(props.tilt);
  convergeViewToState();
}

/**
 * 只订阅 SDK 的**结束**事件（`moveend` / `zoomend` / `headingchange` / `tiltchange`）：
 * 中途事件（`moving` / `zooming`）按帧派发，逐帧回写会让父级每帧重渲染，并与受控写入来回打架。
 *
 * 订阅与「是否受控」无关——非受控模式下这也是「内部状态跟随用户操作」的唯一入口，
 * `v-model` 的首次回写同样走这里。订阅经 Runtime 的 ResourceScope 记账，随卸载一并释放。
 */
function bindViewEvents(ctx: MapReadyContext): void {
  const { client: c, map: m } = ctx;
  const driver = c.driver;

  runtime.resources.add(
    driver.events.on(m, "moveend", () => {
      const next = readLiveView(() => driver.map.getCenter(m));
      if (!next) return;
      if (centerState.commit(next)) emit("update:center", next);
    }),
  );
  runtime.resources.add(
    driver.events.on(m, "zoomend", () => {
      const next = readLiveView(() => driver.map.getZoom(m));
      if (next === null) return;
      if (zoomState.commit(next)) emit("update:zoom", next);
    }),
  );
  runtime.resources.add(
    driver.events.on(m, "headingchange", () => {
      const next = readLiveView(() => driver.map.getHeading(m));
      if (next === null) return;
      if (headingState.commit(next)) emit("update:heading", next);
    }),
  );
  runtime.resources.add(
    driver.events.on(m, "tiltchange", () => {
      const next = readLiveView(() => driver.map.getTilt(m));
      if (next === null) return;
      if (tiltState.commit(next)) emit("update:tilt", next);
    }),
  );
}

/** v2 风格地图类型字符串 → 语义 MapType */
function toMapType(value: string | undefined): MapType {
  const map: Record<string, MapType> = {
    BMAP_NORMAL_MAP: "normal",
    BMAP_EARTH_MAP: "earth",
    BMAP_SATELLITE_MAP: "satellite",
  };
  return map[value ?? "BMAP_NORMAL_MAP"] ?? "normal";
}

/** 将 mapType prop 同步为 SDK setMapType */
function applyMapType(ctx: MapReadyContext) {
  ctx.client.driver.map.setMapType(ctx.map, toMapType(props.mapType));
}

/** enableXxx 布尔开关 → 语义 interaction */
const INTERACTION_PROPS: Array<[keyof BMapProps, MapInteraction]> = [
  ["enableDragging", "dragging"],
  ["enableScrollWheelZoom", "scroll-zoom"],
  ["enableInertialDragging", "inertial-dragging"],
  ["enablePinchToZoom", "pinch-zoom"],
  ["enableKeyboard", "keyboard"],
  ["enableDoubleClickZoom", "double-click-zoom"],
  ["enableContinuousZoom", "continuous-zoom"],
  ["enableResizeOnCenter", "resize-on-center"],
];

/** 将 props 上的 enableXxx 布尔值同步到 SDK map 实例 */
function syncEnableProps(ctx: MapReadyContext) {
  for (const [prop, interaction] of INTERACTION_PROPS) {
    const value = props[prop];
    if (value === undefined) continue;
    ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
  }
  if (props.enableTraffic !== undefined) {
    ctx.client.driver.map.setTraffic(ctx.map, props.enableTraffic);
  }
}

function applyStyleProps(ctx: MapReadyContext) {
  if (props.mapStyleJson) {
    ctx.client.driver.map.setMapStyle(ctx.map, props.mapStyleJson);
  } else if (props.mapStyleId) {
    ctx.client.driver.map.setMapStyle(ctx.map, { styleId: props.mapStyleId });
  }
}

// runtime 创建(SSR-safe:构造不访问 window/document;container 挂载后回填,mount 仅 onMounted)
const currentRuntime = new MapRuntime({
  clientContext,
  container: null as unknown as HTMLElement,
  initialView: initialViewSnapshot,
  mapOptions: {
    minZoom: props.minZoom,
    maxZoom: props.maxZoom,
    restrictCenter: props.restrictCenter,
    displayOptions: props.displayOptions,
    backgroundColor: props.backgroundColor,
  },
  // 建图前的最后一个等待点（#29 三轮复审 P1）：容器尺寸是异步得到的，「启动之前判一次」有
  // TOCTOU 窗口（慢网络下 SDK 加载完成时容器可能已被收起），因此判据要放在 create() 之前。
  beforeCreateMap: () => waitForUsableContainer(),
});
/**
 * 订阅挂载点（M4-EVENTS / #28）：官方 `load` 在首次 `centerAndZoom()` 之后派发，而那次调用发生在
 * `mount()` resolve 之前、`map` 句柄对外可见之前 —— 等 ready 再订阅就**永远收不到** `load`。
 * 在初始化视野之前把订阅挂上（同一次订阅记账，句柄身份一致时幂等）。
 */
currentRuntime.whenMapCreated((ready) => syncMapEventSubscriptions(ready));

/**
 * `plugins` prop 的解析结果，按**用户写的顺序**排列。
 *
 * 为什么不在 setup 里直接抛未知名字（M8-PLUGIN-CORE / #42）：Catalog 的解析**确实**会抛
 * `BMAP_PLUGIN_UNKNOWN`（不静默降级成空实现），但一个拼写错误不该让整张地图不渲染 ——
 * 那既把运行时问题变成渲染期崩溃，也违反「插件故障不得阻断地图」的既有隔离口径。
 * 所以这里逐个名字捕获，未知名字记进 plan，稍后在后台按 `plugin-error` 回执：
 * **明确失败**（绝不假装成功）与**阻断地图**是两件事。
 */
const pluginPlan: { name: string; error?: BMapError }[] = [];
{
  const seen = new Set<string>();
  for (const name of props.plugins ?? []) {
    // 同一个名字写两遍：注册表会 `already registered` 抛错，但调用方的本意显然不是「报错」。
    // 按一次处理，并且只回执一次。
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      currentRuntime.plugins.register(resolvePluginDefinition(name));
      pluginPlan.push({ name });
    } catch (error) {
      pluginPlan.push({
        name,
        error:
          error instanceof BMapError
            ? error
            : new BMapError("BMAP_PLUGIN_UNKNOWN", `plugin "${name}" 解析失败`, {
                plugin: name,
                cause: error,
              }),
      });
    }
  }
}
runtimeRef.value = currentRuntime;
const runtime = currentRuntime;

/* --------------------------------------------- 容器门禁与可见性策略（M4-HANDLE-UX / #29）
 *
 * 两个决定合在 `useMapSuspension` 一处（同一个环境适配、同一条尺寸变化路径）：
 *
 * 1. **容器门禁**：容器拿到非零尺寸之前**不创建地图**。零尺寸建图在真实浏览器上会得到一个
 *    0×0 的 WebGL 画布，而 Tab / Drawer / 折叠面板在展开之前正是 0×0 —— 这正是 issue 要求
 *    「Tab/Drawer/Resize 场景」的原因。门禁只决定「何时建图」：地图建好之后容器又变成 0
 *    （折叠、切走）**不销毁地图**，与 issue 的非目标一致；
 * 2. **可见性策略**：页面前后台、容器是否在视口附近 → 暂停原因；减少动画偏好 → 只读信号。
 *    容器尺寸变化经**既有 FrameScheduler** 合帧后调用 `checkResize()`，后台 / 视口外不排帧。
 *
 * 释放走 `onUnmounted` 的 `suspension.dispose()`（观察器与订阅都挂在这个控制器上），
 * 不依赖 Vue 的组件作用域 —— 于是「谁释放」只有一个答案。SSR 下 `onMounted` 不执行，
 * 观察器一个都不建（`useMapSuspension` 也不在任何模块顶层碰 `window`）。
 */
const suspension = useMapSuspension({
  target: runtime,
  // 观察**根容器**：它才是「作者声明的尺寸」所在（内层 host 是 `inset: 0` 的定位壳，
  // SDK 在它内部建 canvas）。两者在真实浏览器上同盒，但「测量谁」必须是显式选择。
  measure: () => rootRef.value,
  onContainerReady: () => mountMap(),
  autoResize: () => props.enableAutoResize,
});

// 观察器与订阅归属**地图实例的资源作用域**（#29 评审 P1）：`keepAliveBehavior="dispose"` 时
// `onDeactivated` 会调 `runtime.dispose()`，而组件那一刻还在 KeepAlive 的 cache 里 —— 只靠
// `onUnmounted` 释放会让 Resize / Intersection 观察器活到「下一次真正卸载」。登记进
// `resources` 之后 `runtime.dispose()` 会一并释放它们（`onUnmounted` 里的显式 `dispose()`
// 保留，幂等，用来保证「先断源再收尾」的顺序）。
runtime.resources.add(() => suspension.dispose());
// 悬挂的 retry 请求同样归属地图实例的资源作用域（#29 三轮复审 P1）：任何 `runtime.dispose()`
// （KeepAlive 停用、`MapContext.dispose()`、组件卸载）都必须终止它们 —— 观察器这时已经一起释放，
// 容器再也不可能变可用，留着就是永久 pending。
runtime.resources.add(() => rejectPendingWaiters(disposedError()));

/**
 * 容器门禁是否**曾经**放行（状态插槽的读数；只增的 latch）。
 *
 * 「地图建好之后容器又变成 0」（折叠 / 切走）不算门禁被取消（ADR 决策 4：不销毁地图），
 * 因此它不回退。需要「**当前**能不能建图」时读 `suspension.size` + `isUsableSize()` ——
 * `beginMount()` 与 `retry()` 就是这么做的（#29 评审 P2）。
 *
 * 与 `status` 的关系：容器零尺寸期间 `status` 停在 `idle`（不会进入加载流程），因此「怎么还没
 * 加载」与「容器还没展开」在这份读数上可以区分。
 */
const containerReady: Readonly<ShallowRef<boolean>> = suspension.containerReady;

/**
 * 组件级 boot 状态机（#29 复审 P1 / P2）。三条语义都要求「一次**完整**启动」是单飞的 ——
 * 而不是只让 Runtime 的建图单飞：
 *
 * 1. **并发 retry 共享同一次 boot**：否则两次 `start()` 都会 `await` 同一个 `mountPromise`，
 *    地图只建一张，但 `emitReady` / `initd` / 插件加载会各跑两遍；
 * 2. **容器不可用时的 retry 要「挂起」而不是「立刻失败」**：`MapRuntime.whenReady()` 在 error
 *    态是立即 reject，用它表达「还没开始」会把「等容器展开」误报成「重试失败了」；
 * 3. **首挂载、普通 retry、延迟 retry 走同一条路径**（`mountMap()` 只判断「现在能不能启动」）。
 *
 * 于是：正在跑的那次 boot 记为 `bootTask`（并发调用共享它，结束后复位以便下一次重试）；
 * 容器不可用时的请求排进 `deferredWaiters`，容器重新可用 → `mountMap()` 启动 → 同一个 Promise
 * 随那次 boot 的结果 settle。
 */
let mountStarted = false;
let bootTask: Promise<MapReadyContext> | null = null;
let deferredWaiters: Array<{
  resolve: (ctx: MapReadyContext) => void;
  reject: (error: unknown) => void;
}> = [];
/**
 * 「失败期间同步提出的 retry」排的下一轮（#29 三轮复审 P2）。
 *
 * `boot()` 是「先同步 `emit('error')`、再 throw」，而 `bootTask` 要到 `.finally()` 才复位 ——
 * 于是 `@error="mapRef?.retry()"` 这种写法会命中「已有 bootTask」并复用那条**即将 reject** 的
 * 任务，实际并没有排下一次重试。这类请求记在这里，等当前任务 settle 后真正启动下一轮。
 */
let nextBootWaiters: Array<{
  resolve: (ctx: MapReadyContext) => void;
  reject: (error: unknown) => void;
}> = [];
/** 在「建图等待点」里等容器变可用的唤醒函数（见 `waitForUsableContainer`）。 */
let containerUsableWaiters: Array<() => void> = [];

/** 启动一次 boot；并发调用共享同一个 Promise（结束后复位，让下一次 retry 能重新启动）。 */
function startBoot(): Promise<MapReadyContext> {
  bootTask ??= boot().finally(() => {
    bootTask = null;
  });
  return bootTask;
}

/** 把挂起的等待者接到这次 boot 上：成功一起 resolve、失败一起 reject。 */
function attachWaiters(task: Promise<MapReadyContext>): void {
  const waiting = deferredWaiters;
  deferredWaiters = [];
  for (const waiter of waiting) task.then(waiter.resolve, waiter.reject);
}

/**
 * 终止所有悬挂的等待者（#29 三轮复审 P1）。
 *
 * 三组等待者都必须能被「Runtime 被销毁」终止，而不只是「组件被卸载」：
 * `keepAliveBehavior="dispose"` 的 `onDeactivated → runtime.dispose()` 不会触发 `onUnmounted`，
 * 而 `MapContext.dispose()` 也是公开路径 —— 只挂 `onUnmounted` 会让那些 Promise 永久 pending
 * （观察器已经随 Runtime 释放，容器再也不可能变可用 ⇒ 永远没有唤醒源）。
 *
 * - `deferredWaiters` / `nextBootWaiters`：以传入的错误 reject；
 * - `containerUsableWaiters`：只**唤醒** —— 让建图等待点重新检查并退出，由 Runtime 自己的
 *   disposed 守卫抛出 `BMAP_RUNTIME_DISPOSED`（比在这里造错更贴近真实原因）。
 */
function rejectPendingWaiters(error: unknown): void {
  stopUsableRecheck();
  for (const waiter of deferredWaiters.splice(0)) waiter.reject(error);
  for (const waiter of nextBootWaiters.splice(0)) waiter.reject(error);
  for (const resolve of containerUsableWaiters.splice(0)) resolve();
}

/** Runtime 被销毁时终止悬挂请求用的错误（与 `whenReady()` 同码）。 */
function disposedError(): BMapError {
  return new BMapError(
    "BMAP_RUNTIME_DISPOSED",
    "BMap map runtime disposed while a retry was pending",
  );
}

/**
 * 建图等待点的**兜底唤醒**：只要还有等待者，就每帧做一次 fresh 复查（#29 五轮复审 P1）。
 *
 * 主唤醒源仍然是尺寸观察器，但它只在**缓存层**出现「不可用 → 可用」转换时回调。fresh 判据与
 * 缓存可能不一致 —— DOM 在观察器交付之前变回原尺寸时，缓存里根本没有那次 0×0，
 * `applySize()` 的 `sizeEquals` 去重会把这次交付吞掉，于是等待者被搁浅、Runtime 永远停在
 * `creating`（fresh 门禁 + 缓存唤醒源之间的活性竞态）。
 *
 * 因此：**只有存在等待者时**才启动这个复查，全部唤醒 / 销毁后立刻停（`cancelAnimationFrame`
 * 由 `rejectPendingWaiters()` 统一收尾）—— 常态路径（观察器唤醒）完全不受影响，
 * 也不建第二套观察器。
 */
let usableRecheckFrame: number | null = null;

function stopUsableRecheck(): void {
  if (usableRecheckFrame === null) return;
  cancelAnimationFrame(usableRecheckFrame);
  usableRecheckFrame = null;
}

function ensureUsableRecheck(): void {
  if (usableRecheckFrame !== null || containerUsableWaiters.length === 0) return;
  usableRecheckFrame = requestAnimationFrame(() => {
    usableRecheckFrame = null;
    if (containerUsableWaiters.length === 0) return;
    // `mountMap()` 用 fresh 读数判定；可用则唤醒等待者（它在 `bootTask` 早退之前就先唤醒）
    mountMap();
    ensureUsableRecheck();
  });
}

/**
 * 「建图等待点」（`MapRuntimeOptions.beforeCreateMap`，#29 三轮复审 P1）：容器当前不可用就等到可用。
 *
 * 与 `mountMap()` 用**同一份**判据、同一个读数（`suspension.measureNow()` —— **fresh DOM 读数**），
 * 区别只是位置 —— 这里是「最后一个异步边界之后、`create()` 之前」。
 *
 * 为什么必须是 fresh 读数而不是 `suspension.size`（#29 四轮复审 P1）：`size` 是「最近一次测得」
 * 的缓存，在「父级改 display / 折叠动画 → DOM 已变 → ResizeObserver 尚未交付」这个窗口里它是
 * **过期**的，那时 `map.create()` 仍会落在 0×0 容器上。用 `while` 而不是 `if`：被唤醒后再判一次
 * （尺寸可能又被改回去），Runtime 正在销毁时直接退出，由它的 disposed 守卫收尾。
 */
async function waitForUsableContainer(): Promise<void> {
  for (;;) {
    const status = runtime.status.value as string;
    if (status === "disposing" || status === "disposed") return;
    if (isUsableSize(suspension.measureNow())) return;
    await new Promise<void>((resolve) => {
      containerUsableWaiters.push(resolve);
      // 单靠观察器可能永远唤不醒（见 `ensureUsableRecheck` 的说明）
      ensureUsableRecheck();
    });
  }
}

/**
 * 建图 / 重试的**统一入口**（幂等）。
 *
 * 判据是**当前**尺寸（`suspension.measureNow()`，fresh DOM 读数），不是一次性 latch ——
 * 评审 P2 指出：只在首次 mount 上守门，会让「容器收起后调用 `retry()`」在 0×0 容器上建出第二张图。于是：
 *
 * - 容器当前不可用 ⇒ 什么都不做（请求留在 `deferredWaiters` 上）；等「不可用 → 可用」的放行
 *   回调再走一遍（尺寸观察器**每次**这种转换都会回调，因此折起来再展开也接得上）；
 * - 已经 `ready` ⇒ 把挂起的等待者接到「已就绪」的结果上（幂等：不重跑装配、也不重复广播）；
 * - 已经在启动中（`bootTask`）⇒ 什么都不做，等它（复审 P2：不能并发起两次 boot）；
 * - 其它情况：首挂载，或「已经建过图 + 有人要求重试」⇒ 启动一次 boot。
 *
 * 调用点：`onMounted` 的同步测量、尺寸观察器的放行回调。
 */
function mountMap(): void {
  const status = runtime.status.value as string;
  if (status === "disposing" || status === "disposed") return;
  const host = containerRef.value;
  // 判据与建图等待点共用同一个读数（fresh DOM，不是观察器缓存）
  if (!host || !isUsableSize(suspension.measureNow())) return;
  // 先唤醒「建图等待点」里等容器可用的那一次挂载（它已经跑到 SDK 加载之后了）
  for (const resolve of containerUsableWaiters.splice(0)) resolve();
  if (runtime.status.value === "ready") {
    attachWaiters(runtime.whenReady());
    return;
  }
  if (bootTask) return;
  if (mountStarted && deferredWaiters.length === 0) return;
  mountStarted = true;
  runtime.container = host;
  const task = startBoot();
  // 门禁自动启动的那一次没有人 await：错误已经由 `error` 事件如实上报，这里只吞掉 rejection
  // （有等待者时它们各自带 reject handler，不需要这一句）。
  if (deferredWaiters.length === 0) task.catch(() => {});
  attachWaiters(task);
}

// 容器 ref 挂载后回填,供 MapRuntime.mount 使用(SSR 服务端不执行)
onMounted(() => {
  if (!containerRef.value) return;
  runtime.container = containerRef.value;
  // 同步测一次：观察器要等一个 post-flush 才建立，而「容器一开始就有尺寸」是最常见的路径
  suspension.begin();
});

// KeepAlive:默认 suspend(不销毁 WebGL Map),激活后自动 checkResize
onDeactivated(() => {
  if (props.keepAliveBehavior === "dispose") {
    runtime.dispose();
  } else {
    runtime.suspend(MAP_SUSPEND_REASONS.keepAlive);
  }
});

onActivated(() => {
  if (runtime.status.value === "disposed" && props.keepAliveBehavior === "dispose") {
    if (containerRef.value) {
      runtime.container = containerRef.value;
      // 注意:disposed 后 mount 会抛,此处重建路径经全新 Runtime?保持简单:重新 boot 前需外部重挂
    }
    return;
  }
  // 评审 P2：`resume()` 在**最后一个暂停原因被移除**时已经补偿过一次 `checkResize()`；
  // 这里再调一次会让同一次激活下发两条 resize 命令。补偿语义只保留在 Runtime 一个事实源。
  runtime.resume(MAP_SUSPEND_REASONS.keepAlive);
});

/**
 * 组件卸载：**先释放观察器与订阅**，再交给 Runtime 收尾（注册顺序保证这一点 —— 本钩子注册在
 * `onUnmounted(runtime.dispose)` 之前）。顺序反过来会让观察器在 Runtime 已经 disposed 之后
 * 仍尝试请求 `checkResize`（虽然那时的调用会被短路，但「先断源再收尾」是能自证的一步）。
 */
onUnmounted(() => {
  suspension.dispose();
  // 挂起的 retry 等待者不能永远 pending：卸载即终态（与 `MapRuntime.whenReady()` 同码）。
  // 注：真正的「任何 Runtime dispose 都要终止」由上面登记进 `resources` 的那条保证，这里只是
  // 让「先断源再收尾」的顺序在组件卸载路径上也成立（重复调用是 no-op）。
  rejectPendingWaiters(disposedError());
});

/** 插件不阻塞 map ready；ready 后台加载插件并逐个 emit */
async function loadPluginsInBackground() {
  for (const entry of pluginPlan) {
    // 未知名字：Catalog 已经明确失败（`BMAP_PLUGIN_UNKNOWN`），这里如实回执，不阻断地图、
    // 也不影响同一列表里其它插件。
    if (entry.error) {
      emit("plugin-error", { name: entry.name, error: entry.error });
      continue;
    }
    try {
      await runtime.plugins.whenPlugin(entry.name, runtime.resources.signal);
      // **只以注册表状态判定成败**。两点都要注意（评审 #85 P1-2）：
      // - optional 插件失败时注册表以 `null` resolve ⇒ 不能把「拿到了返回值」当成成功；
      // - 但反过来也不行：`null` 之外的值**不等于**失败 —— 只注入副作用、不产出资源的
      //   「void 插件」返回 `undefined` 本来就是合法形态，用 `loaded == null` 判失败会把它们
      //   一起否掉。失败（required 抛错、optional 被吞）统一由状态识别。
      if (runtime.plugins.getStatus(entry.name) !== "ready") {
        throw new BMapError(
          "BMAP_RESOURCE_CREATE_FAILED",
          `plugin "${entry.name}" 未加载成功（status: ${runtime.plugins.getStatus(entry.name) ?? "unknown"}）`,
          { plugin: entry.name, cause: runtime.plugins.getError(entry.name) },
        );
      }
      // 只发 kebab 规范事件：Vue 会把 `plugin-ready` 回退匹配到 `@pluginReady`
      // 监听器，双事件会导致同一监听器被调两次（一次 name、一次 map）
      emit("plugin-ready", entry.name);
    } catch (e) {
      const err =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `plugin ${entry.name} failed`, {
              plugin: entry.name,
              cause: e,
            });
      emit("plugin-error", { name: entry.name, error: err });
    }
  }
}

/* ------------------------------------------------------- map 事件转发（M4-EVENTS / #28）
 *
 * `<BMap>` 声明 Catalog 里的全部 map 事件（模板 / TS 都有完整提示），并在**地图就绪时一次性**
 * 订阅 Catalog 里的所有 SDK 事件；未绑定 handler 的事件由 Vue 的 `emit` 直接丢弃（一次属性查找）。
 *
 * ## 为什么不「按需订阅」（只订父级绑了的那种）
 *
 * 试过，而且**不可靠**：Vue 决定子组件要不要重渲染时，**emit listener 不参与属性比较**
 * （`@vue/runtime-core@3.5.42` 的 `hasPropsChanged`：`hasPropValueChanged(...) && !isEmitListener(...)`），
 * 于是「监听器从 `undefined` 变成函数」这种变化**不会让 `<BMap>` 重渲染**，依赖 `onUpdated` 的
 * 增量同步就看不到它 —— 事件会**静默丢失**。而 Vue 也没有把 emit listener 放进 `attrs`
 * （`setFullProps` 明确跳过 `isEmitListener` 的键），所以子组件拿不到任何「监听器变了」的响应式信号。
 *
 * 结论：要么无条件订阅（本实现），要么漏事件。43 个 `addEventListener` 是每个地图一次的固定成本，
 * 换来的是「父级怎么改绑定都不会丢事件」。
 *
 * 各拼写的可达性由 **Vue 的 handler key 规则**决定（实测 `@vue/compiler-dom@3.5.42` +
 * `@vue/runtime-core` 的 `emit()`）：
 *
 * | 事件 | 能命中 handler 的写法 |
 * | --- | --- |
 * | `click` | `@click` / `@click.once` |
 * | `style-loaded`（canonical） | `@style-loaded` / `@styleLoaded` / 两者的 `.once` |
 * | `style_loaded`（别名） | `@style_loaded` / 两者的 `.once`（`camelize` 只认 `-`） |
 * | `maptypechange` | `@maptypechange`（名字没有词边界，`@mapTypeChange` 不在查找链上） |
 *
 * 订阅记账按「事件名 + 地图身份」：`retry()` 之类让地图实例换新的路径会重建订阅（旧句柄上的订阅
 * 由 `ResourceScope` 的 remover 释放），而同一个句柄上的重复同步是幂等的。
 */

/**
 * 已建立的 map 事件订阅：规范名 → 订阅记录。
 *
 * `release` 是 **ResourceScope.add() 返回的那把 remover**（从 scope 账本里摘除 + 执行释放），
 * 而不是原始 `off`：只调 `off` 会让 raw 监听器解绑、却把已失效的闭包永久留在
 * `scope.disposers` 里（反复「绑定 → 解绑 → 再绑定」会持续堆积）。`off` 是幂等 disposer，
 * 因此 scope 收尾与提前解绑重复触发是安全的。
 */
const mapEventSubscriptions = new Map<MapEventName, { map: MapHandle; release: () => void }>();

/** 撤销某个事件名上的订阅（幂等：remover 自身幂等，重复调用安全）。 */
function unsubscribeMapEvent(vue: MapEventName): void {
  const current = mapEventSubscriptions.get(vue);
  if (!current) return;
  mapEventSubscriptions.delete(vue);
  current.release();
}

/**
 * 让订阅与当前地图对齐：Catalog 里的事件全订；句柄换了身份就重建。
 *
 * `early` 来自 `MapRuntime.onMapCreated`（初始化视野之前）：那一刻组件的 `map` computed 还是 null，
 * 但句柄已经可用 —— 用显式 ctx 才能把 `load` 订上（官方 `load` 在首次 `centerAndZoom` 之后派发）。
 */
function syncMapEventSubscriptions(early?: { client: BMapClient; map: MapHandle }): void {
  const m = early?.map ?? map.value;
  const c = early?.client ?? client.value;
  const scheduler = runtime.scheduler;
  if (!m || !c || !scheduler) return;

  for (const [vue, subscription] of [...mapEventSubscriptions]) {
    if (subscription.map !== m) unsubscribeMapEvent(vue);
  }

  for (const vue of MAP_EVENT_NAMES) {
    if (mapEventSubscriptions.has(vue)) continue;
    const entry = MAP_EVENT_CATALOG[vue];
    // 复用与 `useMapEvent` 同一份订阅原语：高频事件按帧合帧、释放路径一致
    const off = subscribeMapEvent(
      c,
      m,
      entry.sdk,
      (event) => forwardMapEvent(vue, event),
      { coalesce: entry.coalesce, scheduler },
    );
    // 逐个登记进 Runtime 的 ResourceScope，并**保留 add() 返回的 remover**：
    // 卸载 / dispose 时 scope 自己会释放；提前解绑时也必须走 remover，否则 scope 账本会留下失效闭包
    const release = runtime.resources.add(off);
    mapEventSubscriptions.set(vue, { map: m, release });
  }
}

/**
 * 已经把「地图就绪之后的一次性装配」做完的地图句柄（M4-HANDLE-UX / #29）。
 *
 * `retry()` 成功后要重跑一次装配（样式 / 类型 / 交互开关 / 视野收敛 / 事件订阅），而
 * 「重复 retry」不得把订阅叠两遍 —— 因此装配按**句柄身份**幂等：同一张地图只装配一次。
 * `retry()` 之后 `MapRuntime` 会创建**第二张**地图（新的句柄），那时装配照常再跑一遍。
 */
let assembledMap: MapHandle | null = null;

/** 地图就绪之后的装配（按句柄身份幂等；首次建图与 `retry()` 共用）。 */
function assemble(ctx: MapReadyContext): void {
  if (assembledMap === ctx.map) return;
  assembledMap = ctx.map;
  // initialView 已由 Runtime.initializeView 应用,此处仅应用样式/类型/开关
  applyStyleProps(ctx);
  applyMapType(ctx);
  syncEnableProps(ctx);
  // 加载期间父级可能已经改过受控视野（那时没有 map 可写），ready 之前按当前 props 收敛一次
  syncControlledView();
  // 视野回写订阅（M4-STATE / #27）：用户交互 → model → emit update:*
  bindViewEvents(ctx);
  // map 事件转发（M4-EVENTS / #28）：Catalog 里的事件全订（`load` 已由 onMapCreated 提前订上，
  // 这里是幂等的补齐：同一个句柄不重复订阅）
  syncMapEventSubscriptions();
}

/**
 * 建图 → 装配 → 广播 `ready` → 后台加载插件：首次建图与 `retry()` 共用的**唯一**路径。
 *
 * 走 `MapRuntime.retry()` 而不是 `mount()`：两者的差别只有一处 —— 失败态下 `retry()` 会先
 * **清掉 `runtime.error`**。用 `mount()` 会让「重试成功」之后 `error` 仍是那条旧错误，
 * 于是四个出口（默认插槽的 `error`、`#loading` / `#error` 的 `slotProps.error`、
 * `MapContext.error`）都继续显示已经过去的那次失败。非 error 态（idle / loading / disposed）
 * 下 `retry()` 等价于 `mount()`，因此这一处没有副作用。
 *
 * 调用点只有两个（`beginMount()` 的首挂载与 `retry()` 的重试），两者都不会在 `ready` 时进来
 * —— 「已经 ready 就直接返回当前上下文」由 `retry()` 统一短路，这里不再重复判一次。
 */
async function start(): Promise<MapReadyContext> {
  const ctx: MapReadyContext = await runtime.retry();
  assemble(ctx);
  const payload = { client: ctx.client, map: ctx.map, container: containerRef.value! };
  // Map ready 不等待 optional plugin
  emitReady(payload);
  // 插件后台加载，逐个回执
  void loadPluginsInBackground();
  return ctx;
}

/** 走完整路径，并把错误经 `error` 事件如实上报（调用方仍拿到拒绝的 Promise）。 */
async function boot(): Promise<MapReadyContext> {
  try {
    return await start();
  } catch (e) {
    emit(
      "error",
      e instanceof BMapError
        ? e
        : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e }),
    );
    throw e;
  }
}

/**
 * 重试加载（`#error` / `#loading` 插槽与 expose 共用同一份实现）。
 *
 * 返回的 Promise 语义**只有一条**（#29 复审 P1 收口了此前自相矛盾的两句）：
 * **它就是「这一次重试的结果」** —— 成功时 resolve 出那次启动的上下文，失败时 reject 那次启动
 * 的错误；容器当前不可用时它保持 **pending**，直到容器恢复、这次重试真正执行完。
 *
 * 三种入口状态：
 *
 * 1. **已经 ready**：立刻 resolve 当前上下文（幂等：不重跑装配、不重复广播 `ready`）；
 * 2. **已经在启动中**（首挂载或上一次 retry 还在飞）：返回**同一个** Promise —— 复审 P2：
 *    `boot()` 必须单飞，否则 `ready` / `initd` / 插件加载会跟着重复；
 * 3. **容器当前不可用**（Tab / Drawer 收起、宿主隐藏）：**不建图**（复审 P2：门禁要覆盖
 *    retry / recreate），这次请求挂到 `deferredWaiters` 上并返回一个 **pending** 的 Promise，
 *    容器重新可用时由放行回调启动，同一个 Promise 随结果 settle。
 *
 * 因此「失败态」下调用它的两种结果都是**如实**的：容器可用 ⇒ 重新走一遍完整启动（`MapRuntime.retry()`
 * 清错重入 → 装配按句柄身份重跑 → 重新广播 `ready`，失败则 reject **这次**的错误）；容器不可用 ⇒
 * 一直 pending，等容器展开。不再出现「拿旧的错误立刻 reject 一个其实还没开始的延迟重试」。
 */
/**
 * 把「失败期间同步提出的 retry」排到下一轮（#29 三轮复审 P2）。
 *
 * 当前 `bootTask` settle（`.finally()` 复位它）之后，用同一个 `retry()` 启动下一轮，并把排队的
 * 等待者接到那一轮上 —— 于是调用方拿到的是**下一次重试**的结果，而不是眼前这条失败的任务。
 */
function requestNextBoot(): Promise<MapReadyContext> {
  const previous = bootTask;
  const queued = new Promise<MapReadyContext>((resolve, reject) => {
    nextBootWaiters.push({ resolve, reject });
  });
  void previous
    ?.catch(() => {})
    .then(() => {
      const waiters = nextBootWaiters.splice(0);
      if (waiters.length === 0) return;
      // `startBoot()` 的 `.finally()` 先于这里复位 `bootTask`；显式再确认一次，避免被旧任务挡住
      if (bootTask === previous) bootTask = null;
      const task = retry();
      for (const waiter of waiters) task.then(waiter.resolve, waiter.reject);
    });
  return queued;
}

function retry(): Promise<MapReadyContext> {
  const status = runtime.status.value as string;
  if (status === "disposing" || status === "disposed") {
    // 已经（正在）销毁：直接以终态错误拒绝，不要塞一个永远没有唤醒源的等待者
    return Promise.reject(disposedError());
  }
  if (runtime.status.value === "ready") {
    const settled = runtime.whenReady();
    attachWaiters(settled);
    return settled;
  }
  if (bootTask) {
    // 失败**已经发生**但任务还没 settle（`emit('error')` 里同步调 `retry()` 就落在这里）：
    // 复用这条即将 reject 的任务等于没重试 —— 排到下一轮（#29 三轮复审 P2）
    if (runtime.status.value === "error") return requestNextBoot();
    return bootTask;
  }
  const host = containerRef.value;
  if (!host || !isUsableSize(suspension.size.value)) {
    // 容器当前不可用：挂起（不建图、也不以旧错误立刻拒绝），等放行回调启动这次重试
    return new Promise<MapReadyContext>((resolve, reject) => {
      deferredWaiters.push({ resolve, reject });
    });
  }
  mountStarted = true;
  runtime.container = host;
  const task = startBoot();
  attachWaiters(task);
  return task;
}

onBeforeUnmount(() => {
  // 必须在子树卸载**之前**置位：子组件的作用域在子树卸载时停止，那时它们要能问出「整图在 teardown」
  tearingDown = true;
});

onUnmounted(() => {
  runtime.dispose();
  runtimeRef.value = null;
  emit("unload");
});

// props.enableXxx 变化时同步 SDK
watch(
  () => [
    props.enableDragging,
    props.enableScrollWheelZoom,
    props.enableInertialDragging,
    props.enablePinchToZoom,
    props.enableKeyboard,
    props.enableDoubleClickZoom,
    props.enableContinuousZoom,
    props.enableResizeOnCenter,
    props.enableTraffic,
  ],
  () => {
    const ready = runtimeRef.value;
    const m = map.value;
    const c = client.value;
    if (!ready || !m || !c) return;
    syncEnableProps({ client: c, map: m });
  },
  { flush: "post" },
);

// props.mapType 变化时同步 SDK
watch(
  () => props.mapType,
  () => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    applyMapType({ client: c, map: m });
  },
  { flush: "post" },
);

// 受控视野 → SDK（M4-STATE / #27）。
//
// 四个字段各自独立监听、独立判等：`center` 的 watch 源是 `lng,lat` 两个标量
// （`core/utils/equality` 的 `centerKey`，禁止 deep / 引用比较），
// 因此父级传内联对象字面量不会让 watch 空跑；`flush: "post"` 让「同一次父级更新里的多个字段」
// 按 DOM 更新后的同一批执行，各自读回现值判等、互不干扰。
watch(() => centerKey(props.center), () => applyCenterFromProps(props.center), { flush: "post" });

watch(() => props.zoom, (next) => applyZoomFromProps(next), { flush: "post" });

watch(() => props.heading, (next) => applyHeadingFromProps(next), { flush: "post" });

watch(() => props.tilt, (next) => applyTiltFromProps(next), { flush: "post" });

const context: MapContext = {
  id: runtime.id,
  status: status as unknown as MapContext["status"],
  client: client as unknown as MapContext["client"],
  map: map as unknown as MapContext["map"],
  handle: map as unknown as MapContext["handle"],
  error: error as unknown as MapContext["error"],
  resources: runtime.resources,
  scope: runtime.resources,
  events: runtime.events,
  scheduler: runtime.scheduler,
  overlays: runtime.overlays,
  layers: runtime.layers,
  controls: runtime.controls,
  plugins: runtime.plugins,
  whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
  // 早期订阅挂载点（M4-EVENTS / #28）：子组件的 useMapEvent 靠它在 initializeView 之前订上 `load`
  whenMapCreated: (callback: (ready: MapReadyContext) => void) =>
    runtime.whenMapCreated(callback),
  // 整图卸载标记：子组件的 useMapEvent 据此决定 `destroy` 订阅是否延长到地图销毁那一刻
  isTearingDown: () => tearingDown,
  // 与 expose 的 `retry()` 同一实现（#29 评审）：子组件走 context 重试时，门禁未放行同样**不建图**，
  // 不会绕开容器门禁去 mount
  retry: () => retry(),
  dispose: () => runtime.dispose(),
};
provide(mapContextKey, context);

// 默认 Target:挂到 Map,随 handle 就绪自动更新;嵌套 Marker/Cluster 覆盖此 Target
{
  const kindRef = shallowRef<"map">("map");
  const targetRef = computed(
    () => (map.value as unknown as import("../../driver/types/handles").SdkHandle<string> | null) ?? null,
  );
  const mapTarget: TargetContext = {
    kind: readonly(kindRef),
    target: targetRef,
    add: (resource) => {
      const m = map.value;
      const c = client.value;
      if (!m || !c) return;
      c.driver.overlays.add({ kind: "map", handle: m }, resource);
    },
    remove: (resource) => {
      const m = map.value;
      const c = client.value;
      if (!m || !c) return;
      try {
        c.driver.overlays.remove({ kind: "map", handle: m }, resource);
      } catch {
        /* ignore */
      }
    },
  };
  provide(targetContextKey, mapTarget);
}

/**
 * 真正重置视角到初始快照。
 *
 * 除了把地图移回快照，**还要把四个状态一起重置**（#27 评审第三轮 P1）：非受控档下内部状态就是
 * 事实源，只重置地图会让两者分叉——之后用户再拖回「重置前的那个值」时，`commit` 判等为「没变化」
 * 而不 emit，那次真实操作就丢了。`reset()` 刻意不 emit（这是命令方决定的，不是用户交互）。
 *
 * 同时冻结语义：重置之后如果受控值被移除（受控 → 非受控），接管的是**重置值**（而不是重置前的外部值），
 * 因此地图不会被拉回重置前的位置。
 */
function resetView() {
  const m = map.value;
  const c = client.value;
  if (!m || !c || !initialViewSnapshot) return;
  c.driver.map.initializeView(m, initialViewSnapshot);
  centerState.reset();
  zoomState.reset();
  headingState.reset();
  tiltState.reset();
}

/**
 * 状态插槽的载荷（M4-HANDLE-UX / #29）。
 *
 * `#loading` 与 `#error` 收到**同一份**载荷：业务判断「为什么还没好」所需的信息（运行时状态、
 * 结构化错误、容器门禁是否放行、重试入口）在这里一次给全，不需要自己去监听内部 Runtime。
 */
const slotProps = computed(() => ({
  status: status.value,
  error: error.value,
  containerReady: containerReady.value,
  retry,
}));

/** 默认状态文案的样式（沿用 #27 之前的居中灰字，两个插槽共用）。 */
const statusMessageStyle = {
  color: "#999",
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%,-50%)",
  display: "flex",
  alignItems: "center",
  gap: "8px",
} as const;

/** 默认错误文案里的重试按钮（覆盖 `#error` 插槽即可完全接管，包括去掉它）。 */
const retryButtonStyle = {
  padding: "2px 10px",
  border: "1px solid currentColor",
  borderRadius: "4px",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
} as const;

/** 默认重试按钮的点击处理：失败仍由 `error` 事件与状态插槽表达，这里只吞掉拒绝。 */
function onRetryClick(): void {
  void retry().catch(() => {});
}

/**
 * 组件对外的命令面（M4-HANDLE-UX / #29）。
 *
 * 返回类型**显式标注**为 `BMapExpose`：`defineExpose()` 会把它推导成组件实例类型，因此消费方
 * （含 `fixtures/v3-consumer` 里针对真实 tarball 的 `vue-tsc`）拿到的就是这份冻结面 ——
 * 少一个成员、多一个成员、改一个签名都会在类型检查里报出来。
 *
 * 与 #28 相比**只有一处删除**：`resetCenter`。它是「名字说重置中心、实现重置整个视野」的
 * 废弃别名（issue #29 的验收明确要求 expose 里不再有它），`resetView()` 是唯一入口。
 */
function createExpose(): BMapExpose {
  return {
    // —— 常用命令（get / set / pan / fit / supports）：实现只有一份，在 core/runtime/mapCommands
    ...createMapCommands({
      client: () => client.value,
      map: () => map.value,
    }),

    // —— 容器
    getContainer: () => containerRef.value,
    isContainerReady: () => containerReady.value,
    checkResize: () => runtime.checkResize(),

    // —— 生命周期
    getMapInstance: () => map.value,
    whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
    whenMapCreated: (callback: (ready: MapReadyContext) => void) =>
      runtime.whenMapCreated(callback),
    isTearingDown: () => tearingDown,
    retry,

    // —— 暂停策略：默认原因是 `user`（调用方的显式暂停），与 `document` / `offscreen` 分账
    suspend: (reason) => runtime.suspend(reason ?? MAP_SUSPEND_REASONS.user),
    resume: (reason) => runtime.resume(reason ?? MAP_SUSPEND_REASONS.user),
    isSuspended: () => runtime.isSuspended,
    suspendReasons: () => runtime.suspendReasons(),

    // —— 视野 / 交互
    resetView,
    setDragging: (enabled: boolean) => {
      const m = map.value;
      const c = client.value;
      if (!m || !c) return;
      c.driver.map.setInteraction(m, "dragging", enabled);
    },

    // —— 环境偏好：只读信号，不参与暂停
    prefersReducedMotion: () => suspension.reducedMotion.value,
  };
}

defineExpose(createExpose());

defineOptions({ name: "BMap" });
</script>

<template>
  <div
    :id="containerId"
    ref="rootRef"
    class="bmap-container"
    :style="{ width, height, background: loadingBgColor }"
    style="position: relative; overflow: hidden"
  >
    <div ref="containerRef" class="bmap-canvas-host" style="position: absolute; inset: 0" />
    <slot v-if="status === 'error'" name="error" v-bind="slotProps">
      <div :style="statusMessageStyle">
        <span>map error</span>
        <button type="button" :style="retryButtonStyle" @click="onRetryClick">重试</button>
      </div>
    </slot>
    <slot v-else-if="status !== 'ready'" name="loading" v-bind="slotProps">
      <div :style="statusMessageStyle">
        {{ containerReady ? "map loading..." : "waiting for container size..." }}
      </div>
    </slot>
    <slot :status="status" :map="map" :error="error" :client="client" />
  </div>
</template>
