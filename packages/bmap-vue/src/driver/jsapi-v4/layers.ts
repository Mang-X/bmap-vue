/**
 * v4 LayerDriver（M3A2-CONTROLS-LAYERS / issue #22；M7-LAYERS / issue #40 扩到 11 种）
 *
 * 把 JSAPI 4.0 的图层收敛成项目领域映射（`LayerDriver`）；公共 API 不新增 raw 成员，
 * 只把 `LayerHandle` 已有的品牌口径（`layer:<kind>`）落实到十一种图层上。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4` + 官方 Skill
 * `references/tile-and-service-layers.md` / `administrative-district.md` / `mvt-layer.md`）：
 *
 * - 4.0 用**统一**入口 `map.addLayer/removeLayer` 管理所有图层，按图层原型的家族标志位
 *   （`isDistrictLayer` / `isTileLayer` / `isGeoJSONLayer` / `isCustomHtmlLayer`）内部分发；
 *   `addDistrictLayer` / `addTileLayer` 已标记 `@deprecated`，因此这里一律走统一入口；
 * - 十一种 kind 的构造器**都在 4.0.4 的类型声明里**，例外只有 `PanoramaCoverageLayer`
 *   （官方 4.0 公开它，但类型包没有类声明）——`declared: false` 的那一种只能按结构探测；
 * - 构造签名的三种形态由 `signature` 表达：`options`（大多数）、`layerName-options`
 *   （`GeoJSONLayer`）、`createDOM-options`（`DOMLayer`）。**这两个首参不是选项**，
 *   塞进选项袋会被 SDK 忽略，因此它们有具名槽位（`layerName` / `createDOM`）；
 * - **统一槽位**（visible / opacity / minZoom / maxZoom / zIndex / data）：`visible`
 *   统一表达为「挂上 / 摘掉」（官方这批图层大多没有 `show/hide`，而统一入口对所有 kind 都
 *   成立），其余四个 + `data` 按 `ctorSlots` 进构造选项，或在 `operations` 里就地更新。
 *   逐成员核对官方声明后的结论是：这批图层**没有**公开的 `setOpacity` / `setMinZoom` /
 *   `setMaxZoom`，所以这三个槽位的变化一律走**重建**（上层据此决策）；
 * - `DistrictLayer` **没有字段级 setter**（`strokeColor` / `fillColor` 等全是构造选项），
 *   所以它的 option 更新归入「构造期」：`setOptions` 告警一次并把重建决定交给调用方；
 * - `TileLayer` 家族（含 `TrafficLayer`）只有 `zIndex` 有 setter；`TrafficLayer` 另有
 *   `setColors` / `setEdge`；`DOMLayer` 用整袋 `setStyleOptions` 更新构造项（`bagSetters`）；
 * - `GeoJSONLayer` 有 `setData` / `clearData`；`DOMLayer` 只有 `setData`（清空要
 *   `removeAllOverlays()`，不在本 issue 的归一化操作面里）；
 * - `MVTLayer`（#109）：`style` 走整袋 `setStyle`；要素状态五命令归一化到
 *   `updateState` / `removeState` / `clearState` / `replaceState` / `getState`（后两个
 *   在官方入口上分别叫 `replaceAllState` / `getAllState`，与 #36 NativeLayer 同表）。
 *   live 探针确认状态键是**复合** `layerName_id` 字符串，不是裸 id（skill
 *   `references/mvt-layer.md`「live 探针读数」）。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import { HANDLE_BRAND, type LayerHandle } from "../types/handles";
import {
  LAYER_CTOR_SLOTS,
  type LayerCtorSlot,
  type LayerData,
  type LayerDriver,
  type LayerKind,
  type LayerOperation,
  type LayerSurface,
} from "../types/layers";
import type {
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
} from "../types/native-layers";
import {
  assertJsapiV4Namespace,
  callRequired,
  createMapTargetResolver,
  createMountTracker,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  requireRuntimeCtor,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/** 构造签名的三种形态（见文件头依据）。 */
type CtorSignature = "options" | "layerName-options" | "createDOM-options";

/**
 * 每种图层的完整描述符。
 *
 * 七件事写在**同一条**记录里，是为了让它们不能互相漂移：
 * - `ctor`：4.0 构造器名（文件末尾的断言把它钉在官方 `BMap` 命名空间上）；
 * - `declared`：`@baidumap/jsapi-v4-types@4.0.4` 是否声明了该类。`false` 的 kind 只能按结构
 *   探测构造器（缺成员时报 `BMAP_CAPABILITY_UNSUPPORTED`），**且**它的 option 没有可核对的
 *   声明，未命中键走结构逃生口而不是「构造期」告警；
 * - `signature`：构造首参形态；
 * - `ctorSlots`：可由构造选项承载的统一槽位；
 * - `ctorSlotKeys`：统一槽位名 → 官方选项名的改名（只有 `GeoJSONLayer` 的 `data → dataSource`
 *   与 `DOMLayer` 的 `data → data` 这种必须显式写出的差异才登记）；
 * - `aliases` / `mutable` / `bagSetters` / `operations`：更新口径（见 `LayerSurface`）。
 */
interface LayerDescriptor {
  ctor: string;
  declared: boolean;
  signature: CtorSignature;
  ctorSlots: readonly LayerCtorSlot[];
  ctorSlotKeys: Readonly<Partial<Record<LayerCtorSlot, string>>>;
  /** 领域 option 名 → 4.0 构造选项名（历史上项目侧的叫法与官方不同时）。 */
  aliases: Readonly<Record<string, string>>;
  /** 有字段级 setter 的 option：键 → `setXxx(value)`。 */
  mutable: Readonly<Record<string, string>>;
  /** 用整袋 setter 更新的 option：键 → `setXxx(partialBag)`。 */
  bagSetters: Readonly<Record<string, string>>;
  /**
   * 归一化操作 `clearData` 在本 kind 上的官方入口名。
   *
   * `GeoJSONLayer` 有 `clearData()`；`DOMLayer` **没有**——它的「清空」入口是
   * `removeAllOverlays()`（清掉这批 DOM 覆盖物即等价于把数据清空）。把两者映射到同一个
   * 领域操作，是为了让「数据驱动的图层都能被清空」成为一句可以验证的话，而不是调用方
   * 按 kind 分支。
   *
   * **只在 `operations` 含 `clearData` 的 kind 上给出**；瓦片家族 / `mvt` / `district`
   * 等没有清空入口的 kind 刻意省略（写了也没读，属于假事实）。
   */
  clearEntry?: string;
  operations: readonly LayerOperation[];
}

/** 瓦片家族共享的就地更新面：只有 `setZIndex`。 */
const TILE_OPERATIONS = ["setZIndex"] as const satisfies readonly LayerOperation[];
const TILE_MUTABLE = { zIndex: "setZIndex" } as const;

/**
 * 图层 option 的更新口径（「动态 option 与必须重建的 option」的分类，issue #22 实施步骤 3）。
 *
 * 表用 `Record<LayerKind, …>`：新增一个图层种类却忘记写分类会直接编译失败。
 */
const LAYER_DESCRIPTORS = {
  district: {
    ctor: "DistrictLayer",
    declared: true,
    signature: "options",
    // 4.0 的 DistrictLayer 只有构造选项（strokeColor / fillColor / kind / …），没有 setter；
    // 它也没有统一 opacitiy 槽位（只有 fillOpacity / strokeOpacity 两个专属项）。
    ctorSlots: [],
    ctorSlotKeys: {},
    aliases: { viewport: "autoViewport" },
    mutable: {},
    bagSetters: {},
    operations: [],
  },
  "panorama-coverage": {
    ctor: "PanoramaCoverageLayer",
    declared: false,
    signature: "options",
    ctorSlots: [],
    ctorSlotKeys: {},
    aliases: {},
    mutable: {},
    bagSetters: {},
    operations: [],
  },
  tile: {
    ctor: "TileLayer",
    declared: true,
    signature: "options",
    // TileLayerOptions：transparentPng / tileUrlTemplate / zIndex / boundary / opacity /
    // showRegion / retry / retryTime / cacheSize / tileLoadFunction。没有 minZoom/maxZoom。
    ctorSlots: ["opacity", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: TILE_MUTABLE,
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  traffic: {
    ctor: "TrafficLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["opacity", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: { ...TILE_MUTABLE, colors: "setColors", edge: "setEdge" },
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  geojson: {
    ctor: "GeoJSONLayer",
    declared: true,
    signature: "layerName-options",
    // GeoJSONLayerOptions：dataSource / reference / markerStyle / polylineStyle /
    // polygonStyle / minZoom / maxZoom / level / visible。构造首参是 layerName。
    ctorSlots: ["minZoom", "maxZoom", "data"],
    ctorSlotKeys: { data: "dataSource" },
    aliases: {},
    mutable: {},
    bagSetters: {},
    clearEntry: "clearData",
    operations: ["setData", "clearData"],
  },
  dom: {
    ctor: "DOMLayer",
    declared: true,
    signature: "createDOM-options",
    // DOMLayerOptions：minZoom / maxZoom / zIndex / offsetX / offsetY / anchors /
    // coordinate / enableDraggingMap / visible / data。构造首参是 createDOM。
    ctorSlots: ["minZoom", "maxZoom", "zIndex", "data"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: {},
    // 官方用整袋 `setStyleOptions(partial)` 更新这批构造项（没有逐字段 setter）。
    bagSetters: {
      minZoom: "setStyleOptions",
      maxZoom: "setStyleOptions",
      zIndex: "setStyleOptions",
      offsetX: "setStyleOptions",
      offsetY: "setStyleOptions",
      anchors: "setStyleOptions",
      coordinate: "setStyleOptions",
      enableDraggingMap: "setStyleOptions",
    },
    // DOMLayer 有 setData；清空走 removeAllOverlays()（`clearEntry` 表达这个差异）。
    clearEntry: "removeAllOverlays",
    operations: ["setData", "clearData"],
  },
  xyz: {
    ctor: "XYZLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["opacity", "minZoom", "maxZoom", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: TILE_MUTABLE,
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  wms: {
    ctor: "WMSLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["opacity", "minZoom", "maxZoom", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: TILE_MUTABLE,
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  wmts: {
    ctor: "WMTSLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["opacity", "minZoom", "maxZoom", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: TILE_MUTABLE,
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  raster: {
    ctor: "RasterTileLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["opacity", "minZoom", "maxZoom", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: TILE_MUTABLE,
    bagSetters: {},
    operations: TILE_OPERATIONS,
  },
  // #109：MVT 矢量瓦片。官方没有 `opacity` / `setMinZoom` / `setMaxZoom` / `setData` / `clearData`；
  // `zIndex` / `style` 都是字段级 setter（`setZIndex` / `setStyle(styleMap)` 直接收样式袋，
  // 不是 `setStyleOptions` 那种「option 键袋」——bagSetters 会把 value 再包一层 `{ style: … }`，
  // 与官方签名不符，因此 style 归 mutable）。
  // 要素状态五个操作全部声明（`updateState`/`clearState` 在 d.ts，其余三个在原型上探到）。
  // 刻意不给 `clearEntry`：官方 MVT 没有 `clearData`（探针 apiPresence.clearData = false）。
  mvt: {
    ctor: "MVTLayer",
    declared: true,
    signature: "options",
    ctorSlots: ["minZoom", "maxZoom", "zIndex"],
    ctorSlotKeys: {},
    aliases: {},
    mutable: { ...TILE_MUTABLE, style: "setStyle" },
    bagSetters: {},
    operations: [
      "setZIndex",
      "updateState",
      "removeState",
      "clearState",
      "replaceState",
      "getState",
    ],
  },
} as const satisfies Record<LayerKind, LayerDescriptor>;

/** 每种图层对应的语义能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const LAYER_CAPABILITIES: Readonly<Record<LayerKind, Capability>> = {
  district: "layer.district",
  "panorama-coverage": "layer.panorama-coverage",
  tile: "layer.tile",
  traffic: "layer.traffic",
  geojson: "layer.geojson",
  dom: "layer.dom",
  xyz: "layer.xyz",
  wms: "layer.wms",
  wmts: "layer.wmts",
  raster: "layer.raster",
  mvt: "layer.mvt",
};

export interface CreateJsapiV4LayerDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4LayerDriver(input: CreateJsapiV4LayerDriverInput): LayerDriver {
  const { rawSdk, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /** 已告警过的「分类 / 键 / 种类」组合：每个 Driver 一份，避免重复刷屏。 */
  const warnOnce = createWarnOnce();
  /**
   * 已挂到某张地图上的图层。
   *
   * 不把「4.0 的 `addLayer` 会不会去重」当成可以依赖的行为，Driver 自己记账，
   * 保证「重复 add 只挂一次」这条不变式。
   */
  const mounted = createMountTracker();
  /** 图层只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const requireMapTarget = createMapTargetResolver({
    facet: "LayerDriver",
    entry: "map.addLayer / removeLayer",
    resolve: (handle) => registry.resolve<object>(handle),
    warn: warnOnce,
  });

  /** 冻结过的能力面缓存：`surface()` 每次返回同一个对象（调用方可以按引用比较）。 */
  const surfaces = new Map<LayerKind, LayerSurface>();

  /** 图层句柄种类：品牌即 `layer:<kind>`（纯元数据，所有权校验留给 `registry.resolve`）。 */
  const kindOfLayer = (layer: LayerHandle): LayerKind | undefined => {
    const match = /^layer:(.+)$/.exec(String(layer[HANDLE_BRAND]));
    return match?.[1] as LayerKind | undefined;
  };

  const descriptorOf = (layer: LayerHandle): LayerDescriptor | undefined => {
    const kind = kindOfLayer(layer);
    return kind ? (LAYER_DESCRIPTORS[kind] as LayerDescriptor) : undefined;
  };

  /**
   * 领域 options → 4.0 构造 options。
   *
   * 三条规则：
   * 1. **改名**（`viewport` → `autoViewport`）：别名键与目标键同时出现时以显式写下的 v4 键
   *    为准——判据是**目标键有没有有效取值**（`!== undefined`），不是「键在不在」；
   * 2. **统一槽位**按 `ctorSlots` 决定收或丢：不在该 kind 的槽位表里（例如 `district` 的
   *    `opacity`）时告警一次并**丢掉**——转发给 SDK 会被静默忽略，「传了不生效」正是本库
   *    明令禁止的假支持；
   * 3. `visible` **永远不进构造选项**：图层的显隐在本库统一表达为「挂上 / 摘掉」。转发它会
   *    造出「实例自称不可见、却被挂在图上」这种两个事实源的状态。
   *
   * 其余键原样透传：项目 option 接口带索引签名，它就是「4.0 自身构造选项」的逃生口
   * （`tileUrlTemplate` / `boundary` / `params` / `transparentPng` …）。
   */
  const projectOptions = (
    kind: LayerKind,
    descriptor: LayerDescriptor,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const source = options ?? {};
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (key === "visible") {
        warnOnce(
          `visible:${kind}`,
          `LayerDriver.create: ${kind} 的 "visible" 不参与构造选项（图层显隐在本库统一表达为` +
            "「挂上 / 摘掉」）；请用图层组件的 visible 控制挂载状态，本次构造选项已忽略该键",
        );
        continue;
      }
      if ((LAYER_CTOR_SLOTS as readonly string[]).includes(key)) {
        const slot = key as LayerCtorSlot;
        if (!descriptor.ctorSlots.includes(slot)) {
          warnOnce(
            `slot:${kind}:${key}`,
            `LayerDriver.create: ${kind} 没有 "${key}" 这个统一槽位（官方该图层的构造选项里没有它），` +
              "本次构造选项已忽略该键",
          );
          continue;
        }
        projected[descriptor.ctorSlotKeys[slot] ?? slot] = value;
        continue;
      }
      const target = descriptor.aliases[key];
      if (target && source[target] !== undefined) continue;
      projected[target ?? key] = value;
    }
    return projected;
  };

  const ctorFor = (kind: LayerKind, ctorName: string): JsapiV4Ctor => {
    if ((LAYER_DESCRIPTORS[kind] as LayerDescriptor).declared) {
      return namespaceCtor(namespace, ctorName);
    }
    return requireRuntimeCtor(namespace, ctorName, (message) =>
      warnOnce(
        `${kind}:no-runtime-entry`,
        `LayerDriver: ${message}；"${kind}" 无法创建（本仓库的该图层入口依赖 4.0 运行时提供它）`,
      ),
    );
  };

  /**
   * 按构造签名组装实参。
   *
   * `layerName-options` / `createDOM-options` 的两个首参**必须**存在：缺了就显式失败
   * （`BMAP_INVALID_ARGUMENT`），而不是让 SDK 抛一个内部错、或造出一个永远画不出东西的图层。
   * 这两个键同时从选项袋里剔除——官方签名里它们不是选项。
   */
  const buildCtorArgs = (
    kind: LayerKind,
    descriptor: LayerDescriptor,
    options: Record<string, unknown>,
  ): unknown[] => {
    if (descriptor.signature === "options") return [options];
    const firstKey = descriptor.signature === "layerName-options" ? "layerName" : "createDOM";
    const first = options[firstKey];
    const bag: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      if (key === firstKey) continue;
      bag[key] = value;
    }
    if (first === undefined || first === null) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `LayerDriver.create: ${kind} 的官方构造签名是 new ${descriptor.ctor}(${firstKey}, options)，` +
          `缺少必需的首参 "${firstKey}"`,
        { engine: "jsapi-v4", capability: LAYER_CAPABILITIES[kind] },
      );
    }
    return [first, bag];
  };

  /**
   * 解析句柄并断言该 kind 支持这个操作。
   *
   * 不支持的操作显式失败（`BMAP_CAPABILITY_UNSUPPORTED`），不静默 no-op——
   * 「看起来调成功了但什么都没发生」是图层最难排查的一类问题。
   */
  const open = (
    layer: LayerHandle,
    operation: LayerOperation,
  ): { raw: Record<string, unknown>; descriptor: LayerDescriptor; kind: LayerKind } => {
    const kind = kindOfLayer(layer);
    const descriptor = descriptorOf(layer);
    if (!kind || !descriptor) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `LayerDriver.${operation}: 句柄不是本 Driver 创建的图层句柄`,
        { engine: "jsapi-v4" },
      );
    }
    if (!descriptor.operations.includes(operation)) {
      warnOnce(
        `${kind}:unsupported:${operation}`,
        `LayerDriver: ${kind} 没有 "${operation}" 的运行时入口（官方 4.0 的该图层不公开这个方法），` +
          "本次调用被拒绝——不静默降级，否则调用方会以为设置生效了",
      );
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `LayerDriver: ${kind}.${operation} 在 JSAPI 4.0 没有运行时入口`,
        { engine: "jsapi-v4", capability: LAYER_CAPABILITIES[kind] },
      );
    }
    return { raw: registry.resolve<Record<string, unknown>>(layer), descriptor, kind };
  };

  const driver: LayerDriver = {
    create(kind: LayerKind, options: Record<string, unknown> = {}): LayerHandle {
      const descriptor = LAYER_DESCRIPTORS[kind] as LayerDescriptor | undefined;
      if (!descriptor) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知图层种类: ${String(kind)}`, {
          engine: "jsapi-v4",
        });
      }
      const ctorName = descriptor.ctor;
      // 能力守卫先于构造：在 `unsupported: "throw"` 策略下不会产生「创建好但没人用」的实例。
      capabilities.require(LAYER_CAPABILITIES[kind]);
      const Ctor = ctorFor(kind, ctorName);
      const args = buildCtorArgs(kind, descriptor, projectOptions(kind, descriptor, options));
      const raw = sdkCall(ctorName, () => new Ctor(...args));
      return registry.adopt(`layer:${kind}`, raw);
    },

    add(target, layer) {
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(layer);
      if (!mounted.claim(rawMap, raw)) return;
      try {
        // 统一入口：4.0 的 addDistrictLayer / addTileLayer 已 deprecated
        sdkCall("map.addLayer", () => callRequired(rawMap, "addLayer", raw));
      } catch (error) {
        // 失败必须回滚记账（同 controls.add）：否则「用同一个句柄重试」会被记成已挂过而静默跳过。
        mounted.release(rawMap, raw);
        throw error;
      }
    },

    remove(target, layer) {
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(layer);
      sdkCall("map.removeLayer", () => callRequired(rawMap, "removeLayer", raw));
      mounted.release(rawMap, raw);
    },

    surface(kind) {
      const cached = surfaces.get(kind);
      if (cached) return cached;
      const descriptor = LAYER_DESCRIPTORS[kind] as LayerDescriptor | undefined;
      if (!descriptor) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知图层种类: ${String(kind)}`, {
          engine: "jsapi-v4",
        });
      }
      const surface: LayerSurface = Object.freeze({
        ctorSlots: Object.freeze([...descriptor.ctorSlots]),
        operations: Object.freeze([...descriptor.operations]),
      });
      surfaces.set(kind, surface);
      return surface;
    },

    supports(kind, operation) {
      const descriptor = LAYER_DESCRIPTORS[kind] as LayerDescriptor | undefined;
      return descriptor ? descriptor.operations.includes(operation) : false;
    },

    isMutableOption(kind, key) {
      const descriptor = LAYER_DESCRIPTORS[kind] as LayerDescriptor | undefined;
      if (!descriptor) return false;
      if (descriptor.mutable[key] || descriptor.bagSetters[key]) return true;
      // `data` 由归一化操作承载（`setData`），不走 option 更新路径
      return key === "data" && descriptor.operations.includes("setData");
    },


    setOptions(layer, options) {
      const raw = registry.resolve<Record<string, unknown>>(layer);
      const descriptor = descriptorOf(layer);
      const kind = kindOfLayer(layer);
      /** 同一批次里指向同一个整袋 setter 的键合并成一次调用（官方签名就是整袋）。 */
      const bags = new Map<string, Record<string, unknown>>();

      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        const method = descriptor?.mutable[key];
        if (method) {
          if (typeof readNamespaceMember(raw, method) !== "function") {
            warnOnce(
              `missing:${kind}:${method}`,
              `LayerDriver.setOptions: ${kind}.${key} 声明为可就地更新（${method}），但当前实例没有该方法，` +
                "本次更新被忽略",
            );
            continue;
          }
          callRequired(raw, method, value);
          continue;
        }
        const bagMethod = descriptor?.bagSetters[key];
        if (bagMethod) {
          const bag = bags.get(bagMethod) ?? {};
          bag[key] = value;
          bags.set(bagMethod, bag);
          continue;
        }
        // 统一槽位名落在「该 kind **已声明**、且根本没有这个槽位」的情况（例如
        // `geojson.zIndex` / `district.opacity`）：报出来的是「没有这个语义」，而不是
        // 「需要重建」——前者重建多少次都不会生效，后者重建一次就对了。
        //
        // 只在 `declared` 时做这个判定：`panorama-coverage` 没有可核对的声明，它的选项面
        // 只能按结构探测，把统一槽位名拦在这里会挡掉「运行时确实有 setOpacity」的情形。
        if (
          descriptor?.declared &&
          (LAYER_CTOR_SLOTS as readonly string[]).includes(key) &&
          !descriptor.ctorSlots.includes(key as LayerCtorSlot)
        ) {
          warnOnce(
            `no-slot:${kind}:${key}`,
            `LayerDriver.setOptions: ${kind} 没有 "${key}" 这个统一槽位（官方该图层的声明里没有它），` +
              "本次更新被忽略",
          );
          continue;
        }
        if (descriptor?.declared) {
          warnOnce(
            `recreate:${kind}:${key}`,
            `LayerDriver.setOptions: ${kind}.${key} 只有构造期生效（4.0 的 ${kind} 图层没有该字段的 ` +
              "setter）；本次更新被忽略，需要生效请重建图层",
          );
          continue;
        }
        // 逃生口：类没有可核对的声明（运行时扩展类），按 `set<Key>` 结构调用并探测
        const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (typeof readNamespaceMember(raw, setter) !== "function") {
          warnOnce(
            `unknown:${kind}:${key}`,
            `LayerDriver.setOptions: ${kind} 没有 "${key}" 的字段级 setter（也不在图层 option 分类里），` +
              "本次更新被忽略",
          );
          continue;
        }
        callRequired(raw, setter, value);
      }

      for (const [method, bag] of bags) {
        if (typeof readNamespaceMember(raw, method) !== "function") {
          warnOnce(
            `missing-bag:${kind}:${method}`,
            `LayerDriver.setOptions: ${kind} 声明用 ${method} 就地更新 ${Object.keys(bag).join(" / ")}，` +
              "但当前实例没有该方法，本次更新被忽略",
          );
          continue;
        }
        callRequired(raw, method, bag);
      }
    },

    setZIndex(layer, zIndex) {
      const { raw, descriptor } = open(layer, "setZIndex");
      const method = descriptor.mutable.zIndex ?? "setZIndex";
      callRequired(raw, method, zIndex);
    },

    setData(layer, data: LayerData) {
      const { raw } = open(layer, "setData");
      callRequired(raw, "setData", data);
    },

    clearData(layer) {
      const { raw, descriptor } = open(layer, "clearData");
      // open() 只在 operations 含 clearData 时放行；该 kind 必须给出 clearEntry（geojson / dom）。
      const entry = descriptor.clearEntry;
      if (!entry) {
        throw new BMapError(
          "BMAP_CAPABILITY_UNSUPPORTED",
          `LayerDriver.clearData: ${kindOfLayer(layer)} 声明了 clearData 却没有 clearEntry`,
          { engine: "jsapi-v4" },
        );
      }
      callRequired(raw, entry);
    },

    // 要素状态（#109）：归一化名 → 官方入口与 #36 NativeLayer 同一张表；
    // 只有 `operations` 里声明了这些操作的 kind（当前仅 `mvt`）能通过 `open()`。
    updateState(layer, keys, state, append = false) {
      const { raw } = open(layer, "updateState");
      callRequired(raw, "updateState", keys, state, append);
    },

    removeState(layer, keys) {
      const { raw } = open(layer, "removeState");
      callRequired(raw, "removeState", keys);
    },

    clearState(layer) {
      const { raw } = open(layer, "clearState");
      callRequired(raw, "clearState");
    },

    replaceState(layer, inputs) {
      const { raw } = open(layer, "replaceState");
      callRequired(raw, "replaceAllState", inputs);
    },

    getState(layer) {
      const { raw } = open(layer, "getState");
      const result = sdkCall("Layer.getAllState", () => callRequired(raw, "getAllState"));
      if (result === null || typeof result !== "object" || Array.isArray(result)) {
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `LayerDriver.getState: getAllState() 应当返回 id → 状态的对象，实际是 ${typeof result}`,
          { engine: "jsapi-v4" },
        );
      }
      return result as NativeLayerFeatureStateMap;
    },
  };

  return driver;
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 类型包**已声明**类声明的图层构造器名必须与官方 `BMap` 命名空间一致。
 *
 * 「哪些 kind 被声明」直接从 `LAYER_DESCRIPTORS[*].declared` 派生（`as const satisfies` 让
 * `declared` 保持字面量），因此**表与断言不可能漂移**：把 `panorama-coverage` 的 `declared`
 * 改成 `true`（或反过来）都会连同运行时策略一起生效。
 *
 * `PanoramaCoverageLayer` 之所以 `declared: false`：它不在
 * `@baidumap/jsapi-v4-types@4.0.4` 的声明里（官方 Skill 明确它是 4.0 公开图层，属运行时能力），
 * 存在性只能由 `requireRuntimeCtor` 在运行时按结构判断；上游补齐声明后把 `declared` 改成
 * `true`，这条断言会立刻校验它的构造器名。
 */
type DeclaredLayerKind = {
  [K in LayerKind]: (typeof LAYER_DESCRIPTORS)[K]["declared"] extends true ? K : never;
}[LayerKind];
type MissingDeclaredCtors = {
  [K in DeclaredLayerKind]: (typeof LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? never
    : K;
}[DeclaredLayerKind];
type _AssertDeclaredLayerCtors = ExpectTrue<MissingDeclaredCtors extends never ? true : false>;

/**
 * 声明了操作 / 可选 setter 的 kind，其官方类型上**必须真的有那些成员**。
 *
 * 这是「逐成员核对官方声明」这句话的**可执行版本**：`supports()` / `surface()` / `isMutableOption()`
 * 回答的一切都来自 `LAYER_DESCRIPTORS`，而这张表此前只有「构造器名」一条类型层证据。
 * 上游改名或删除某个 setter 时，这里会在 `pnpm typecheck:package` 阶段直接编译失败，而不是等到
 * 运行时才发现「声明了却没入口」。
 *
 * 反向也要有：`district` 声明**没有**任何操作，因此官方类型上也不得出现这些成员——上游哪天
 * 给它补了 `setZIndex`，这条断言会立刻提醒我们「该把能力面补上」。
 */
/** 缺失成员判据：把「差集为空」写成可实例化的条件类型，只有**实例化处**才断言 `true`。 */
type MissingMembers<T, K extends string> = Exclude<K, keyof T>;
/** 不该有的成员判据（`district` 用）。 */
type ExtraMembers<T, K extends string> = Extract<K, keyof T>;

type _AssertTileMembers = ExpectTrue<
  MissingMembers<
    BMap.TileLayer,
    "setZIndex" | "addBoundary" | "clearBoundary" | "clearCache" | "setZIndexTop" | "isTransparentPng"
  > extends never
    ? true
    : false
>;

type _AssertTrafficMembers = ExpectTrue<
  MissingMembers<
    BMap.TrafficLayer,
    // `setColors` / `setEdge` 是本库声明为「可变 option」的两个入口；`setZIndex` 继承自 TileLayer
    "setColors" | "setEdge" | "setZIndex"
  > extends never
    ? true
    : false
>;

type _AssertGeoJSONMembers = ExpectTrue<
  MissingMembers<
    BMap.GeoJSONLayer,
    "setData" | "clearData" | "setLevel" | "setVisible" | "resetStyle" | "addEventListener"
  > extends never
    ? true
    : false
>;

type _AssertDomMembers = ExpectTrue<
  MissingMembers<
    BMap.DOMLayer,
    "setData" | "show" | "hide" | "setStyleOptions" | "removeAllOverlays" | "addEventListener"
  > extends never
    ? true
    : false
>;

type _AssertStandardTileMembers = ExpectTrue<
  MissingMembers<
    BMap.XYZLayer | BMap.WMSLayer | BMap.WMTSLayer | BMap.RasterTileLayer,
    "setZIndex" | "addBoundary" | "clearBoundary" | "clearCache"
  > extends never
    ? true
    : false
>;

// `XYZLayer` 额外声明了 `show` / `hide`（本库**不用**它们：显隐统一为挂载状态，见 ADR 决策 7）
type _AssertXyzVisibilityMembers = ExpectTrue<
  MissingMembers<BMap.XYZLayer, "show" | "hide" | "isVisible"> extends never ? true : false
>;

/** `district` 声明**没有**任何操作：官方类型上也不得出现这些成员（上游补了就该更新能力面）。 */
type _AssertDistrictHasNoOperations = ExpectTrue<
  ExtraMembers<BMap.DistrictLayer, "setZIndex" | "setData" | "clearData" | "setOpacity"> extends never
    ? true
    : false
>;

/**
 * `mvt`（#109）在官方 `MVTLayer` 类声明上**必须**有的成员（d.ts 可核对的那部分）。
 *
 * `removeState` / `replaceAllState` / `getAllState` 是原型上探到的扩展面，**不在** d.ts
 * 的 class body 里（`declaredMembersOf` 交叉核对会对它们失败），因此它们只进运行时
 * 测试与 fake 替身，不进这条断言。反向断言：官方没有本库声明会走重建假象的 setter。
 */
type _AssertMvtDeclaredMembers = ExpectTrue<
  MissingMembers<
    BMap.MVTLayer,
    | "updateState"
    | "clearState"
    | "setStyle"
    | "setZIndex"
    | "getZIndex"
    | "setZIndexTop"
    | "setUpLevel"
    | "setDownLevel"
    | "addEventListener"
    | "removeEventListener"
  > extends never
    ? true
    : false
>;

/** `mvt` 上本库**不得**声明为「就地可更新」的成员（官方没有这些入口）。 */
type _AssertMvtHasNoFalseSetters = ExpectTrue<
  ExtraMembers<
    BMap.MVTLayer,
    "setData" | "clearData" | "setOpacity" | "setVisible" | "setMinZoom" | "setMaxZoom"
  > extends never
    ? true
    : false
>;

/**
 * 反过来：`declared: false` 的构造器名**不得**出现在官方声明里。
 *
 * 上游补齐 `PanoramaCoverageLayer` 的类声明时，这条断言会立刻失败——提醒把 `declared`
 * 改成 `true`（并顺手去掉结构探测那条逃生路径），而不是让「运行时探测」悄悄留在原地。
 */
type RuntimeLayerKind = {
  [K in LayerKind]: (typeof LAYER_DESCRIPTORS)[K]["declared"] extends false ? K : never;
}[LayerKind];
type DeclaredRuntimeCtors = {
  [K in RuntimeLayerKind]: (typeof LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? K
    : never;
}[RuntimeLayerKind];
type _AssertRuntimeCtorsUndeclared = ExpectTrue<DeclaredRuntimeCtors extends never ? true : false>;
