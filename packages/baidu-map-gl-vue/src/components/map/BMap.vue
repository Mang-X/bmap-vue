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
import { normalizeMapMouseEvent } from "../../driver/normalize";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";
import type { MapInteraction, MapType, MapView } from "../../driver/types/map";
import type { Point } from "../../driver/types/geometry";
import { stringToPluginDefinitions } from "../../plugins/builtins";
import { useControllableState } from "../../composables/useControllableState";
import { ANGLE_EPSILON, anglesEqual, centerEquals, centerKey, numbersEqual } from "../../core/utils/equality";

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

const emit = defineEmits<{
  ready: [payload: MapReadyPayload];
  initd: [payload: MapReadyPayload];
  "plugin-ready": [name: string];
  "plugin-error": [payload: { name: string; error: unknown }];
  click: [event: unknown];
  unload: [];
  error: [err: unknown];
  // 视野回写（M4-STATE / #27）：`v-model:center` 等语法糖依赖这四个事件。
  // 载荷永远是 SDK 读回的**具体坐标点**：即使受控值是城市名字符串，用户交互后也会变成点。
  "update:center": [value: Point];
  "update:zoom": [value: number];
  "update:heading": [value: number];
  "update:tilt": [value: number];
}>();

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

const centerState = useControllableState<MapCenter>({
  name: "center",
  value: () => props.center,
  defaultValue: () => props.defaultCenter,
  fallback: DEFAULT_VIEW.center,
  equals: centerEquals,
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
 */
const initialViewSnapshot: MapView = {
  center: centerState.initial,
  zoom: zoomState.initial,
  heading: headingState.initial,
  tilt: tiltState.initial,
};

/**
 * 读回地图当前值；读不到时返回 `null`。
 *
 * 「读不到」= SDK 已销毁（`BMAP_RESOURCE_DISPOSED`）或该能力在本引擎不可用——两者都由
 * 库自己的错误协议（`BMapError`）表达。读不到就**不**写下一条命令：写命令在同样条件下只会
 * 抛同样的错，而这里的调用来自 prop watcher 与 SDK 事件回调，让异常从这两处逃逸只会在
 * 销毁 / 降级路径上产生噪音。
 *
 * **不吞**非 `BMapError` 的异常：`TypeError` 一类是编程错误（或测试替身失真），
 * 归零成 `null` 会让「读不到」与「读错」混在一起，变成静默失效。
 */
function readLiveView<T>(read: () => T): T | null {
  try {
    return read();
  } catch (e) {
    if (e instanceof BMapError) return null;
    throw e;
  }
}

/**
 * 受控 `center` → SDK。
 *
 * 1. 先同步内部镜像（受控值优先，并触发模式切换告警）；
 * 2. 非受控（`undefined`）直接返回，不写 SDK；
 * 3. **读回** SDK 现值做容差判等：一致就不下命令。这一步既抑制「父级回写同一值」的重复命令，
 *    也抑制真实 SDK 的浮点抖动；反过来，`centerAndZoom` 永远不会出现在这条路径上。
 */
function applyCenterFromProps(next: MapCenter | undefined): void {
  centerState.syncExternal(next);
  if (next === undefined) return;
  const m = map.value;
  const c = client.value;
  if (!m || !c) return;
  const current = readLiveView(() => c.driver.map.getCenter(m));
  if (current && centerEquals(current, next)) return;
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
  if (current !== null && numbersEqual(current, next)) return;
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
  if (current !== null && anglesEqual(current, next)) return;
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
  if (current !== null && numbersEqual(current, next, ANGLE_EPSILON)) return;
  c.driver.map.setTilt(m, next);
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
for (const definition of stringToPluginDefinitions(props.plugins ?? [])) {
  currentRuntime.plugins.register(definition);
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
  for (const name of props.plugins ?? []) {
    try {
      await runtime.plugins.whenPlugin(name, runtime.resources.signal);
      // **只以注册表状态判定成败**。两点都要注意（评审 #85 P1-2）：
      // - optional 插件失败时注册表以 `undefined` resolve ⇒ 不能把「拿到了返回值」当成成功；
      // - 但反过来也不行：`undefined` **不等于**失败 —— 只注入副作用、不产出资源的「void 插件」
      //   本来就是这种合法形态，用 `loaded === undefined` 判失败会把它们一起否掉。
      // 失败（required 抛错、optional 被吞）统一由状态识别，并带回注册表记录到的原始错误。
      if (runtime.plugins.getStatus(name) !== "ready") {
        throw new BMapError(
          "BMAP_RESOURCE_CREATE_FAILED",
          `plugin "${name}" 未加载成功（status: ${runtime.plugins.getStatus(name) ?? "unknown"}）`,
          { cause: runtime.plugins.getError(name) },
        );
      }
      // 只发 kebab 规范事件：Vue 会把 `plugin-ready` 回退匹配到 `@pluginReady`
      // 监听器，双事件会导致同一监听器被调两次（一次 name、一次 map）
      emit("plugin-ready", name);
    } catch (e) {
      const err =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `plugin ${name} failed`, { cause: e });
      emit("plugin-error", { name, error: err });
    }
  }
}

async function boot() {
  if (runtime.status.value === "ready") {
    const payload = {
      client: runtime.client.value!,
      map: runtime.map.value!,
      container: containerRef.value!,
    };
    emit("ready", payload);
    emit("initd", payload);
    void loadPluginsInBackground();
    return;
  }
  try {
    const ctx = await runtime.mount();
    // initialView 已由 Runtime.initializeView 应用,此处仅应用样式/类型/开关
    applyStyleProps(ctx);
    applyMapType(ctx);
    syncEnableProps(ctx);
    // 视野回写订阅（M4-STATE / #27）：用户交互 → model → emit update:*
    bindViewEvents(ctx);
    runtime.resources.add(
      ctx.client.driver.events.on(ctx.map, "click", (event) => {
        emit("click", normalizeMapMouseEvent(event, ctx.client.driver.geometry));
      }),
    );
    const payload = { client: ctx.client, map: ctx.map, container: containerRef.value! };
    // Map ready 不等待 optional plugin
    emit("ready", payload);
    emit("initd", payload);
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

/** 真正重置视角到初始快照 */
function resetView() {
  const m = map.value;
  const c = client.value;
  if (!m || !c || !initialViewSnapshot) return;
  c.driver.map.initializeView(m, initialViewSnapshot);
}

defineExpose({
  getMapInstance: () => map.value,
  getContainer: () => containerRef.value,
  whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
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
