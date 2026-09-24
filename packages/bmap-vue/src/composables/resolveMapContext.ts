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
import { useOptionalMapContext } from "../core/context/inject";
import {
  createClientContext,
  defaultClientDefinitionKey,
  useOptionalClientContext,
  type BMapClientContext,
} from "../core/context/client";
import { bmapConfigKey } from "../core/context/pluginConfig";
import { inject } from "vue";
import type { MapContext, MapReadyContext } from "../core/context/types";
import { ResourceScope } from "../core/lifecycle/ResourceScope";
import { createMapEventBus } from "../core/events/MapEventBus";
import { createFrameScheduler } from "../core/scheduler/FrameScheduler";
import { createOverlayRegistry } from "../core/overlays/OverlayRegistry";
import { createLayerRegistry } from "../core/layers/LayerRegistry";
import { createPluginRegistry } from "../core/plugins/PluginRegistry";
import { BMapError } from "../core/errors/BMapError";

/** 读取外部传入值:ref 实时解包 `.value`,普通对象直接返回 */
function readValue(input: unknown): unknown {
  if (input && typeof input === "object" && "value" in (input as Record<string, unknown>)) {
    return toRaw((input as { value: unknown }).value);
  }
  return input;
}

export function resolveMapContext(map?: unknown): MapContext {
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
function createClientAdapter(clientContext: BMapClientContext, map?: unknown): MapContext {
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
  const mapRef = shallowRef(null) as MapContext["map"];
  const statusRef = shallowRef("idle") as unknown as MapContext["status"];
  const errorRef = shallowRef(null) as unknown as MapContext["error"];

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
    client: clientRef as unknown as MapContext["client"],
    map: mapRef,
    handle: mapRef as unknown as MapContext["handle"],
    error: errorRef,
    resources,
    scope: resources,
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
