/**
 * MapContext 解析:不再伪造空 resources/events/scheduler Context。
 *
 * 查找顺序(与 <Map> 的 Client 查找顺序一致):
 * 1. 最近注入的 MapContext(<Map> 子树,推荐)。
 * 2. 最近注入的 ClientContext(<BMapProvider> 子树,client-only 服务)。
 * 3. app.use(createBMapPlugin(...)) 的默认定义或旧 bmapConfig:就地创建真实
 *    ClientContext 适配器(真实 ResourceScope/EventBus/Scheduler/Registries)。
 * 4. 以上皆无:抛出明确 BMAP_PARENT_CONTEXT_MISSING,不再静默构造假 Context,
 *    也不再有任何全局兜底——旧引擎(读 `Map ?? BMapGL` 的 legacy Provider)已在 3.0 删除;
 *    宿主自己加载了 SDK 时请显式传 `existingGlobalV4Provider()`。
 */
import { shallowRef, toRaw } from "vue";
import type { ShallowRef } from "vue";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { EventDriver } from "../driver/types/events";
import type { MapDriver } from "../driver/types/map";
import type { MapHandle } from "../driver/types/handles";
import type { ServiceDriver } from "../driver/types/services";
import { useOptionalMapContext } from "../core/context/inject";
import {
  createClientContext,
  defaultClientDefinitionKey,
  useOptionalClientContext,
  type BMapClientContext,
} from "../core/context/client";
import { bmapConfigKey } from "../core/context/pluginConfig";
import { inject } from "vue";
import type {
  MapContext as InternalMapContext,
  MapReadyContext,
  MapStatus,
} from "../core/context/types";
import { ResourceScope } from "../core/lifecycle/ResourceScope";
import { createMapEventBus } from "../core/events/MapEventBus";
import { createFrameScheduler } from "../core/scheduler/FrameScheduler";
import { createOverlayRegistry } from "../core/overlays/OverlayRegistry";
import { createLayerRegistry } from "../core/layers/LayerRegistry";
import { createPluginRegistry } from "../core/plugins/PluginRegistry";
import { BMapError } from "../core/errors/BMapError";

/**
 * `resolveMapContext()` / `useMapContext()` 的**公共返回类型**（issue #160）。
 *
 * 为什么不让内部的 `MapContext` 直接当返回值：它 `extends MapRuntimeShape`，因而带着
 * `resources` / `events` / `scheduler` / `overlays` / `layers` / `infoWindows` 一整套
 * **运行时实现**。那些类型带私有成员、仓库之外既不能构造也不能实现，一旦随返回值
 * 出现在公共声明里，`check:api` 的 `ae-forgotten-export` 就会把 `MapContext` 及其
 * 整条内层闭包（`MapRuntimeShape` → `MapDriver` / `OverlayDriver` / `ServiceDriver` …，
 * 二十几个）逐个报成「未导出」——而消费方真正需要的只有下面这六个字段。
 *
 * 因此这里显式写出**业务侧真正读的那部分**。结构上 `MapContext` 满足它，
 * 所以 `<Map>` 子树里的既有行为一字不变；变的只是「调用方看得见什么」。
 */
/**
 * 公共 `BMapClient` 面：**Capability 表 + 服务 Driver 门面**。
 *
 * 见 `PublicMapContext.client` 的注释——完整 `BMapClient` 的其余部分是组件的接线面。
 */
export interface PublicBMapClient {
  /** 能力表（`CAPABILITY_UNSUPPORTED` 的判定入口）。 */
  readonly capabilities: CapabilityRegistry;
  /**
   * 归一化调用面：服务（服务类 composable 真正调用的那一面）+ 事件
   * （`useMapEvent` / `useMapStatus` 的显式 source 需要它）。
   */
  readonly driver: {
    readonly services: ServiceDriver;
    readonly events: EventDriver;
    readonly map: MapDriver;
  };
}

export interface PublicMapContext {
  /** 地图是否已经开始拆除（早于子树卸载）。 */
  readonly isTearingDown: () => boolean;
  /** 地图就绪（resolve 的是**这一次** ready；重复调用返回同一个 Promise）。 */
  readonly whenReady: () => Promise<MapReadyContext>;
  /**
   * 本图持有的 Client（未就绪时 `null`）。
   *
   * 只暴露 **Capability 表 + Driver 的 `services` / `events` / `map` 三面**——
   * 这正是服务类 composable（geocoder / convertor / localSearch / 四条路线 / panorama）
   * 与 `useMapEvent` / `useMapStatus` 真正调用的部分。三面齐了，`MapEventSource` 的
   * `client` 契约（`EventSourceClient`）也被结构性地满足，不靠断言。
   * 完整 `BMapClient` 还带 `driver.map` / `overlays` / `controls` / `layers` / `panorama`，
   * 那些是**组件**的接线面：把它们放进公共返回类型，会让 `MapDriver` / `OverlayDriver` /
   * `ServiceDriver` / `PanoramaDriver` / `ControlDriver` / `LayerDriver` / `GeometryDriver` /
   * `EventDriver` 一整串（约二十个，含它们的 options / handle 闭包）被
   * `ae-forgotten-export` 逐个点名（issue #160），而业务侧写服务 composable 时
   * 一个都用不到。需要完整 Client 的场景请显式传 `useMarkerIcons` 之类的 API。
   */
  readonly client: ShallowRef<PublicBMapClient | null>;
  /** SDK 地图句柄（未就绪时 `null`）。 */
  readonly map: ShallowRef<MapHandle | null>;
  /** 地图状态。 */
  readonly status: ShallowRef<MapStatus>;
  /** 最近的错误（未就绪 / 从未出错时为 `null`）。 */
  readonly error: ShallowRef<unknown>;
  /**
   * 事件总线 —— 只暴露 `emit`：`resource:error` 等**本库自造**事件的出口。
   *
   * 完整 `MapEventBus` 还有 `on` / `off`（要 SDK 句柄 + 事件 Driver），那是内部运行时的
   * 接线面。把它放进公共返回类型会让 `MapEventBus` 及其闭包（`MapDriver` /
   * `OverlayDriver` / `ServiceDriver` …）整串被 `ae-forgotten-export` 点名（issue #160）；
   * 而业务侧要的只是「报个错」这一个动作。
   *
   * 与 `MapEventSource.resources: { add }` 是**同一个手法**（同一个文件里两处）：把内部
   * 类型换成「公共签名真正用到的那几个成员」的结构声明。成员不同、理由相同。
   */
  readonly events: { emit(type: string, payload: unknown): void };
}

/**
 * 完整 `MapContext` → 对外的窄面。
 *
 * `isTearingDown` 在内部是可选字段（不是每条解析路径都提供），这里缺省成 `() => false`：
 * 「没有这个能力」与「还没开始拆」在业务上同义，缺省不会让调用方误判。
 */
export function toPublicMapContext(context: InternalMapContext): PublicMapContext {
  return {
    isTearingDown: context.isTearingDown ?? (() => false),
    whenReady: () => context.whenReady(),
    client: context.client,
    map: context.map,
    status: context.status,
    error: context.error,
    events: context.events,
  };
}

/** 读取外部传入值:ref 实时解包 `.value`,普通对象直接返回 */
function readValue(input: unknown): unknown {
  if (input && typeof input === "object" && "value" in (input as Record<string, unknown>)) {
    return toRaw((input as { value: unknown }).value);
  }
  return input;
}

export function resolveMapContext(map?: unknown): PublicMapContext {
  return toPublicMapContext(resolveInternalMapContext(map));
}

/**
 * 内部接线用的完整 `MapContext`。
 *
 * **刻意不进 `./composables` 的公共类型面**（issue #160）：它一出现，`MapContext` 及其
 * 内层闭包（`MapRuntimeShape` → `MapDriver` / `OverlayDriver` / `ServiceDriver` …）就会被
 * `ae-forgotten-export` 逐个点名。组件与 serviceTask 确实要读 `overlays` / `layers` /
 * `resources` / `events` —— 那是本库自己的运行时，由本文件自己转出去，不经公共出口。
 * 对外只暴露 `PublicMapContext`（见其文件头注释）。
 */
export function resolveInternalMapContext(map?: unknown): InternalMapContext {
  const injected = useOptionalMapContext();
  if (injected) return injected;

  const clientContext =
    useOptionalClientContext() ?? resolveDefaultClientContext();
  if (clientContext) {
    return createClientAdapter(clientContext, map);
  }

  throw new BMapError(
    "BMAP_PARENT_CONTEXT_MISSING",
    "Component must be a descendant of <Map> (or <BMapProvider> for client-only services). " +
      "Use the component inside a <Map> root.",
  );
}

/**
 * 无注入上下文时,回退到 app.use 默认定义,就地创建真实 ClientContext。
 * 同一 definition 复用同一 context(WeakMap),避免重复加载 SDK。
 */
const defaultContextCache = new WeakMap<object, BMapClientContext>();

function resolveDefaultClientContext(): BMapClientContext | undefined {
  const definition = inject(defaultClientDefinitionKey, undefined);
  if (definition) {
    const cached = defaultContextCache.get(definition);
    if (cached) return cached;
    const created = createClientContext({ definition });
    defaultContextCache.set(definition, created);
    return created;
  }
  // 旧 bmapConfig 兼容:provider + defaults 组装 definition
  const appConfig = inject(bmapConfigKey, undefined);
  if (appConfig?.provider) {
    const key = appConfig as object;
    const cached = defaultContextCache.get(key);
    if (cached) return cached;
    const created = createClientContext({
      // 旧 bmapConfig 兼容路径：definition 直接组装，不再经迁移期归一（#26 删除）。
      definition: {
        provider: appConfig.provider,
        loadOptions: appConfig.defaults,
      },
    });
    defaultContextCache.set(key, created);
    return created;
  }
  return undefined;
}

/** 基于 ClientContext 的真实适配器(真实 Scope/总线/注册表,无伪造空对象) */
function createClientAdapter(clientContext: BMapClientContext, map?: unknown): InternalMapContext {
  const resources = new ResourceScope({ label: "external-client-adapter" });
  const events = createMapEventBus();
  const scheduler = createFrameScheduler();
  const overlays = createOverlayRegistry();
  const layers = createLayerRegistry();
  const controls = createOverlayRegistry();
  const plugins = createPluginRegistry(
    () => ({ client: clientRef.value, map: mapRef.value, api: clientRef.value?.rawSdk ?? null }),
    { emit: (type: string, payload: unknown) => events.emit(type as never, payload as never) },
    resources,
  );
  const clientRef = shallowRef(clientContext.client.value);
  const mapRef = shallowRef(null) as InternalMapContext["map"];
  const statusRef = shallowRef("idle") as unknown as InternalMapContext["status"];
  const errorRef = shallowRef(null) as unknown as InternalMapContext["error"];

  const whenReady = async (signal?: AbortSignal): Promise<MapReadyContext> => {
    const client = await clientContext.load(signal);
    clientRef.value = client;
    const rawMap = readValue(map);
    // Client-only 服务(map 未传):仅需 client,直接返回,map 置空;
    // 需要 map 能力的调用方应使用 <Map> 内上下文。
    if (!rawMap) {
      const existing = mapRef.value;
      if (existing) return { client, map: existing };
      return { client, map: null as unknown as MapReadyContext["map"] };
    }
    const handle = rawMap as MapReadyContext["map"];
    mapRef.value = handle;
    statusRef.value = "ready" as never;
    return { client, map: handle };
  };

  return {
    id: Symbol("client-adapter-map-context"),
    status: statusRef,
    client: clientRef as unknown as InternalMapContext["client"],
    map: mapRef,
    handle: mapRef as unknown as InternalMapContext["handle"],
    error: errorRef,
    resources,
    events,
    scheduler,
    overlays,
    layers,
    controls,
    plugins,
    whenReady,
    dispose: () => resources.dispose(),
  };
}
