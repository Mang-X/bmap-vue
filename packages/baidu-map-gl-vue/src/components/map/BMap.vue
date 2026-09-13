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
import { logger } from "../../core/logger";
import type { BMapLoadOptions } from "../../core/loader/url";
import { DEFAULT_VERSION } from "../../core/loader/url";
import {
  existingGlobalProvider,
  hasExistingGlobalSdk,
} from "../../core/loader/Provider";
import { baiduJsapiV4Provider } from "../../core/loader/providers/index";
import type { AnyBMapProviderLike, BMapClient, CreateBMapClientOptions } from "../../client/types";
import { withMigrationDriver } from "../../client/migration";
import { normalizeMapMouseEvent } from "../../driver/normalize";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";
import type { MapInteraction, MapType } from "../../driver/types/map";
import { stringToPluginDefinitions } from "../../plugins/builtins";

export type { BMapProps };

const props = withDefaults(defineProps<BMapProps>(), {
  zoom: 14,
  center: () => ({ lat: 39.915185, lng: 116.403901 }),
  width: "100%",
  height: "550px",
  mapType: "BMAP_NORMAL_MAP",
  heading: 0,
  tilt: 0,
  minZoom: 0,
  maxZoom: 21,
  noAnimation: false,
  enableDragging: true,
  enableScrollWheelZoom: false,
  loadingBgColor: "#f1f1f1",
  keepAliveBehavior: "suspend",
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
// 最近 BMapProvider > app.use 默认 definition > 旧 bmapConfig > opt-in existingGlobal > 报错
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
  const provider = (props.provider as BMapClientContext extends never ? never : AnyBMapProviderLike) ?? appConfig?.provider ?? baiduJsapiV4Provider();
  const loadOptions: BMapLoadOptions = {
    ak: props.ak ?? appConfig?.defaults?.ak,
    apiUrl: props.apiUrl ?? appConfig?.defaults?.apiUrl,
    version: appConfig?.defaults?.version ?? DEFAULT_VERSION,
  };
  // M3A1-CLIENT(#18): 组件默认路径走迁移归一（按加载 engine 分派 Driver，默认 cutover
  // 属 #25）；createBMapClient 自身的默认已收口到 jsapi-v4。
  clientContext = createClientContext({
    definition: withMigrationDriver({
      provider: provider as AnyBMapProviderLike,
      loadOptions,
    }),
  });
  ownClientContext = true;
} else if (parentClientContext) {
  clientContext = parentClientContext;
} else if (defaultDefinition) {
  // 迁移期归一在 Client Context 收口（见 core/context/client.ts），此处直接透传
  clientContext = createClientContext({ definition: defaultDefinition });
  ownClientContext = true;
} else if (appConfig?.provider) {
  clientContext = createClientContext({
    definition: withMigrationDriver({
      provider: appConfig.provider,
      loadOptions: appConfig.defaults,
    }),
  });
  ownClientContext = true;
} else if (props.allowExistingGlobal) {
  clientContext = createClientContext({
    definition: { provider: existingGlobalProvider(), loadOptions: {} },
  });
  ownClientContext = true;
} else if (hasExistingGlobalSdk()) {
  // 向后兼容:默认不静默读取全局 SDK,仅在已存在时经 Loader 边界回退并 warn
  logger.warn("BMap resolved existing global SDK fallback; prefer <BMapProvider> or app.use(createBMapPlugin(...))");
  clientContext = createClientContext({
    definition: { provider: existingGlobalProvider(), loadOptions: {} },
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

// 初始视角快照，供 resetView 恢复
const initialViewSnapshot: {
  center: { lng: number; lat: number } | string;
  zoom: number;
  heading?: number;
  tilt?: number;
} = {
  center:
    typeof props.center === "string"
      ? props.center
      : { ...(props.center as { lng: number; lat: number }) },
  zoom: props.zoom as number,
  heading: props.heading,
  tilt: props.tilt,
};

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

// 后续 center 更新只 setCenter，不重置 zoom；分别监听 lng/lat，禁止 deep
function centerLng(value: BMapProps["center"]): number | string | undefined {
  if (typeof value === "string") return value;
  return value?.lng;
}
function centerLat(value: BMapProps["center"]): number | undefined {
  if (typeof value === "string") return undefined;
  return (value as { lat?: number } | undefined)?.lat;
}
watch(
  [() => centerLng(props.center), () => centerLat(props.center)],
  ([lng, lat], [oldLng, oldLat]) => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    if (typeof props.center === "string") {
      if (props.center === oldLng) return;
      c.driver.map.setCenter(m, props.center);
      return;
    }
    if (lng == null || lat == null) return;
    if (lng === oldLng && lat === oldLat) return;
    c.driver.map.setCenter(m, { lng: lng as number, lat });
  },
  { flush: "post" },
);

// zoom 单独更新只 setZoom
watch(
  () => props.zoom,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setZoom(m, value);
  },
  { flush: "post" },
);

// heading/tilt 外部更新同步（SDK 支持才调用）
watch(
  () => props.heading,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setHeading(m, value);
  },
  { flush: "post" },
);

watch(
  () => props.tilt,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setTilt(m, value);
  },
  { flush: "post" },
);

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
