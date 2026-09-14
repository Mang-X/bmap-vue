<script setup lang="ts">
import {
  computed,
  inject,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  provide,
  readonly,
  ref,
  shallowRef,
  useId,
  watch,
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
  // 视野四字段（center/zoom/heading/tilt）**刻意不给默认值**（M4-STATE / #27）：
  // `undefined` 是「当前非受控」的判定依据，给了默认值就再也区分不出「父级传了」
  // 与「父级没传」。库默认视野移到 DEFAULT_VIEW，作为「缺省」档的兜底参与首次解析，
  // 因此「什么都不传」的行为与旧版默认值完全一致。
});

export interface MapReadyPayload extends MapReadyContext {
  container: HTMLElement;
}

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

// 容器 ref 挂载后回填,供 MapRuntime.mount 使用(SSR 服务端不执行)
onMounted(() => {
  if (!containerRef.value) return;
  runtime.container = containerRef.value;
  boot().catch(() => {});
});

// KeepAlive:默认 suspend(不销毁 WebGL Map),激活后自动 checkResize
onDeactivated(() => {
  if (props.keepAliveBehavior === "dispose") {
    runtime.dispose();
  } else {
    runtime.suspend("keep-alive");
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
  runtime.resume("keep-alive");
  runtime.checkResize();
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

async function boot() {
  if (runtime.status.value === "ready") {
    const payload = {
      client: runtime.client.value!,
      map: runtime.map.value!,
      container: containerRef.value!,
    };
    // 重入（已 ready）：订阅可能因为地图实例换新而需要重建（`retry()` 之后的路径）
    syncMapEventSubscriptions();
    emitReady(payload);
    void loadPluginsInBackground();
    return;
  }
  try {
    const ctx = await runtime.mount();
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
    const payload = { client: ctx.client, map: ctx.map, container: containerRef.value! };
    // Map ready 不等待 optional plugin
    emitReady(payload);
    // 插件后台加载，逐个回执
    void loadPluginsInBackground();
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
  retry: () => runtime.retry(),
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

defineExpose({
  getMapInstance: () => map.value,
  getContainer: () => containerRef.value,
  whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
  // 早期订阅挂载点（M4-EVENTS / #28）：子组件的 useMapEvent 靠它在 initializeView 之前订上 `load`
  whenMapCreated: (callback: (ready: MapReadyContext) => void) =>
    runtime.whenMapCreated(callback),
  retry: () => runtime.retry(),
  suspend: (reason?: unknown) => runtime.suspend(reason),
  resume: (reason?: unknown) => runtime.resume(reason),
  checkResize: () => runtime.checkResize(),
  resetView,
  /** @deprecated Use resetView() instead. */
  resetCenter: () => {
    resetView();
  },
  setDragging: (enabled: boolean) => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setInteraction(m, "dragging", enabled);
  },
});

defineOptions({ name: "BMap" });
</script>

<template>
  <div
    :id="containerId"
    class="bmap-container"
    :style="{ width, height, background: loadingBgColor }"
    style="position: relative; overflow: hidden"
  >
    <div ref="containerRef" class="bmap-canvas-host" style="position: absolute; inset: 0" />
    <slot name="loading" :status="status" :error="error">
      <div
        v-if="status !== 'ready'"
        :style="{
          color: '#999',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
        }"
      >
        {{
          status === "loading" ||
          status === "waiting-client" ||
          status === "creating" ||
          status === "initializing"
            ? "map loading..."
            : status === "error"
              ? "map error"
              : ""
        }}
      </div>
    </slot>
    <slot :status="status" :map="map" :error="error" :client="client" />
  </div>
</template>
