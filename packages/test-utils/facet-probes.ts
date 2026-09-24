/**
 * Facet 探针（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 与 `driver-contract.ts` 的分工：这里只有**纯调用与结构化记录**，不 import vitest、
 * 不 import Fake，因此同一段代码可以在两个环境里跑：
 *
 * - vitest（Fake v4）：`driver-contract.ts` 的 `run*FacetContract` 用 vitest 断言这里的结果；
 * - 真实 AK smoke（浏览器 / headless Chromium）：直接 `import` 本文件，把结果写进页面。
 *
 * 拆开是被逼出来的：`driver-contract.ts` 顶部 import 了 vitest，浏览器里根本加载不了。
 * 「同一 Contract Harness 可运行 Fake v4 和真实 smoke 子集」（issue #23 实施步骤 5）
 * 因此落成「探针共用 + 断言各自」这两半。
 */
import type { Point } from "../bmap-vue/src/driver/types/geometry";
import type {
  NativeLayerDriver,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
} from "../bmap-vue/src/driver/types/native-layers";
import type { OverlayTarget } from "../bmap-vue/src/driver/types/overlays";
import type {
  PanoramaDataInfo,
  PanoramaViewerDriver,
} from "../bmap-vue/src/driver/types/panorama";
import type {
  AutocompleteOptions,
  BoundaryRequest,
  BoundaryRings,
  ConvertorRequest,
  GeocodeRequest,
  GeocodedAddress,
  GeolocationFix,
  JsapiV4ServiceDriver,
  LocalCityFix,
  LocalSearchResult,
  ReverseGeocodeRequest,
  ServiceResult,
} from "../bmap-vue/src/driver/types/services";

/* --------------------------------------------------------------------- Service */

export interface ServiceFacetFixture {
  address: string;
  city: string;
  /** 逆地址解析用的坐标 */
  point: Point;
  boundaryName: string;
  convert: ConvertorRequest;
  input(): HTMLInputElement;
}

export const DEFAULT_SERVICE_FACET_FIXTURE: ServiceFacetFixture = {
  address: "北京市海淀区中关村",
  city: "北京市",
  point: { lng: 116.404, lat: 39.915 },
  boundaryName: "北京市",
  convert: { points: [{ lng: 116.404, lat: 39.915 }], from: 3, to: 5 },
  /**
   * 默认输入框：**挂到文档**（真实 4.0 的硬要求）。
   *
   * 真实 4.0 里 `new BMap.Autocomplete({ input })` 对**脱离文档**的 input 会直接抛
   * `TypeError: Cannot read properties of null (reading 'top')`（2026-09-12 smoke 三种形态：
   * detached 抛错、attached-body / attached-box 都构造成功）。
   *
   * 探针不打字，因此也不依赖任何回包：这里只覆盖「构造 + 释放」这条本库真实承诺的路径
   * （#104 删掉了原先的程序化 `suggest()` 归属层，探针不再猜回包）。
   */
  input: () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    return el;
  },
};

export interface ServiceFacetProbes {
  geocode: ServiceResult<Point>;
  reverseGeocode: ServiceResult<GeocodedAddress>;
  convert: ServiceResult<Point[]>;
  boundary: ServiceResult<BoundaryRings>;
  locate: ServiceResult<GeolocationFix>;
  locateCity: ServiceResult<LocalCityFix>;
  /** 本地检索（`LocalSearch#search`，#38） */
  search: ServiceResult<LocalSearchResult[]>;
  /** 取消之后的结算：用来固定「迟到回调不复活已取消的调用」 */
  canceled: ServiceResult<Point>;
}

/**
 * 跑一遍 Service Facet 的七个归一化调用 + 一次取消，返回结构化结果。
 *
 * `Autocomplete` **不在这一面上**（#104）：它绑输入框、只有一条不带请求身份的
 * `onSearchComplete`，所以这里只走「构造 + 释放」，不猜回包。
 *
 * 注意 `live` 环境（真实 AK）里 `geocode` / `search` 的结果取决于配额与网络，
 * 因此这里**只负责记录**，期望值由调用方给（vitest 侧分 fixture / live 两档）。
 */
export async function probeServiceFacet(
  services: JsapiV4ServiceDriver,
  fixture: ServiceFacetFixture = DEFAULT_SERVICE_FACET_FIXTURE,
): Promise<ServiceFacetProbes> {
  const geocoder = services.createGeocoder();
  const convertor = services.createConvertor();
  const boundary = services.createBoundary();
  const geolocation = services.createGeolocation();
  const localCity = services.createLocalCity();
  const autocompleteInput = fixture.input();
  const autocompleteOptions: AutocompleteOptions = { input: autocompleteInput };
  const autocomplete = services.createAutocomplete(autocompleteOptions);
  // 纯 headless：不传 `renderOptions.map`，因此不会在任何地图上绘制覆盖物
  const localSearch = services.createLocalSearch(fixture.city);

  const geocodeRequest: GeocodeRequest = { address: fixture.address, city: fixture.city };
  const canceled = services.geocode(geocoder, geocodeRequest);
  canceled.cancel();
  const canceledResult = await canceled.result;

  const reverseRequest: ReverseGeocodeRequest = { point: fixture.point };
  const boundaryRequest: BoundaryRequest = { name: fixture.boundaryName };

  const probes: ServiceFacetProbes = {
    geocode: await services.geocode(geocoder, geocodeRequest).result,
    reverseGeocode: await services.reverseGeocode(geocoder, reverseRequest).result,
    convert: await services.convert(convertor, fixture.convert).result,
    boundary: await services.queryBoundary(boundary, boundaryRequest).result,
    locate: await services.locate(geolocation).result,
    locateCity: await services.locateCity(localCity).result,
    search: await services.search(localSearch, fixture.address).result,
    canceled: canceledResult,
  };

  // 探针创建的实例在**有释放入口**时必须放掉：`Autocomplete` 与 `LocalSearch` 都载着 Driver 侧的
  // 订阅记账，留在页面/用例里就是真实泄漏（smoke 页面尤其明显）。输入框由探针挂到文档上，
  // 也要由探针摘掉——官方 `dispose()` 不回收调用方提供的 DOM。
  services.disposeAutocomplete(autocomplete);
  services.disposeLocalSearch(localSearch);
  autocompleteInput.remove();

  return probes;
}

/* --------------------------------------------------------------- Native Layer */

/**
 * 全部原生图层 kind。
 *
 * `as const satisfies` + 文件末尾的完备性断言：新增一个 `NativeLayerKind` 却忘了加进这张表，
 * 会在**编译期**失败——否则契约会静默漏测一个 kind。
 */
export const NATIVE_LAYER_FACET_KINDS = [
  "point",
  "cluster",
  "point-icon",
  "point-shape",
  "line",
  "fill",
  "heatmap",
  "track-line",
] as const satisfies readonly NativeLayerKind[];

/** 全部归一化操作（同上：新增操作漏加进表会编译失败，而不是静默漏测）。 */
export const NATIVE_LAYER_FACET_OPERATIONS = [
  "setData",
  "clearData",
  "setStyle",
  "setVisible",
  "setOpacity",
  "setZIndex",
  "setZoomRange",
  "updateState",
  "removeState",
  "clearState",
  "replaceState",
  "getState",
  "setEnablePicked",
  "hitTest",
  // TrackLine 播放命令（#110；方法名经 live 探针取证）
  "start",
  "pause",
  "resume",
  "stop",
  "setSpeed",
  "setProcess",
] as const satisfies readonly NativeLayerOperation[];

/**
 * 每个归一化操作的最小可调用载荷。
 *
 * Fake 侧单测与真实 smoke 共用同一份「怎么调」——否则「契约里测的那套调用」与
 * 「浏览器里跑的那套调用」会各自漂移。
 */
export function callNativeLayerOperation(
  driver: NativeLayerDriver,
  layer: NativeLayerHandle,
  operation: NativeLayerOperation,
): void {
  switch (operation) {
    case "setData":
      driver.setData(layer, { type: "FeatureCollection", features: [] });
      return;
    case "clearData":
      driver.clearData(layer);
      return;
    case "setStyle":
      driver.setStyle(layer, {});
      return;
    case "setVisible":
      driver.setVisible(layer, true);
      return;
    case "setOpacity":
      driver.setOpacity(layer, 1);
      return;
    case "setZIndex":
      driver.setZIndex(layer, 1);
      return;
    case "setZoomRange":
      driver.setZoomRange(layer, { min: 1 });
      return;
    case "updateState":
      driver.updateState(layer, "contract-key", { selected: true });
      return;
    case "removeState":
      driver.removeState(layer, "contract-key");
      return;
    case "clearState":
      driver.clearState(layer);
      return;
    case "replaceState":
      driver.replaceState(layer, { "contract-key": { selected: true } });
      return;
    case "getState":
      // 有返回值的操作：这里只要「不抛错」就算通过（值的形状由各 facet 自身的用例断言）
      driver.getState(layer);
      return;
    case "setEnablePicked":
      driver.setEnablePicked(layer, true);
      return;
    case "hitTest":
      driver.hitTest(layer, { x: 0, y: 0 });
      return;
    case "start":
      driver.start(layer);
      return;
    case "pause":
      driver.pause(layer);
      return;
    case "resume":
      driver.resume(layer);
      return;
    case "stop":
      driver.stop(layer);
      return;
    case "setSpeed":
      // 合法载荷（有限正数）：契约只验证「不抛错」，非法值的边界由驱动自己的单测断言
      driver.setSpeed(layer, 2);
      return;
    case "setProcess":
      driver.setProcess(layer, 0.5);
      return;
    default: {
      const exhaustive: never = operation;
      throw new Error(`未覆盖的归一化操作: ${String(exhaustive)}`);
    }
  }
}

export interface NativeLayerRoundTrip {
  kind: NativeLayerKind;
  /** 挂载计数（未提供 `attachedCount` 的环境为 `null`，例如真实 SDK smoke） */
  attached: number | null;
  attachedAfterDuplicateAdd: number | null;
  attachedAfterRemove: number | null;
  attachedAfterRemount: number | null;
  /** `supports()` 回答 true 且调用成功的操作 */
  applied: NativeLayerOperation[];
  /** `supports()` 回答 false 的操作 */
  unsupported: NativeLayerOperation[];
  /** 不支持的操作**全部**显式失败（抛 `BMAP_CAPABILITY_UNSUPPORTED`）时为 true */
  rejectedWhenUnsupported: boolean;
}

export interface NativeLayerFacetProbeOptions {
  target: OverlayTarget;
  /** 挂载计数（Fake 环境提供；真实 SDK 省略） */
  attachedCount?: () => number;
  kinds?: readonly NativeLayerKind[];
  operations?: readonly NativeLayerOperation[];
}

/**
 * 跑一遍原生数据图层的「挂载往返 + 操作面」并返回结构化结果。
 *
 * 只记录、断言交给调用方（`runNativeLayerFacetContract` 或 smoke 页面）。
 */
export function probeNativeLayerFacet(
  driver: NativeLayerDriver,
  options: NativeLayerFacetProbeOptions,
): NativeLayerRoundTrip[] {
  const { target, attachedCount, kinds = NATIVE_LAYER_FACET_KINDS } = options;
  const operations = options.operations ?? NATIVE_LAYER_FACET_OPERATIONS;
  const count = () => (attachedCount ? attachedCount() : null);

  return kinds.map((kind) => {
    const layer = driver.create(kind);
    driver.add(target, layer);
    const attached = count();
    driver.add(target, layer);
    const attachedAfterDuplicateAdd = count();

    const applied: NativeLayerOperation[] = [];
    const unsupported: NativeLayerOperation[] = [];
    let rejectedWhenUnsupported = true;

    for (const operation of operations) {
      if (driver.supports(kind, operation)) {
        callNativeLayerOperation(driver, layer, operation);
        applied.push(operation);
        continue;
      }
      unsupported.push(operation);
      try {
        callNativeLayerOperation(driver, layer, operation);
        rejectedWhenUnsupported = false;
      } catch {
        /* 期望路径：不支持的操作必须显式失败 */
      }
    }

    driver.remove(target, layer);
    const attachedAfterRemove = count();
    driver.add(target, layer);
    const attachedAfterRemount = count();
    driver.remove(target, layer);

    return {
      kind,
      attached,
      attachedAfterDuplicateAdd,
      attachedAfterRemove,
      attachedAfterRemount,
      applied,
      unsupported,
      rejectedWhenUnsupported,
    };
  });
}

/* -------------------------------------------------------------------- Panorama */

export interface PanoramaFacetProbes {
  supported: boolean;
  /** 第一次 `destroy()` 的结果（真实 4.0 在**未加载场景**的实例上会抛 TypeError） */
  destroyStatus: "ok" | "failed";
  destroyError: string | null;
  /**
   * 重复销毁是否被 Driver 记账短路（**只在第一次成功时**有意义：失败会保留记账以便重试，
   * 此时第二次仍会打到 SDK）。
   */
  destroyIdempotent: boolean;
  byId: ServiceResult<PanoramaDataInfo>;
  byLocation: ServiceResult<PanoramaDataInfo>;
}

export async function probePanoramaFacet(
  driver: PanoramaViewerDriver,
  container: HTMLElement,
): Promise<PanoramaFacetProbes> {
  const supported = driver.supported;
  const viewer = driver.create(container);
  driver.setPosition(viewer, { lng: 116.404, lat: 39.915 });
  driver.setPov(viewer, { heading: 0 });
  driver.setZoom(viewer, 1, { noAnimation: true });
  driver.hide(viewer);
  driver.show(viewer);

  let destroyStatus: "ok" | "failed" = "ok";
  let destroyError: string | null = null;
  try {
    driver.destroy(viewer);
  } catch (error) {
    destroyStatus = "failed";
    destroyError = String((error as Error)?.message ?? error);
  }

  let destroyIdempotent = true;
  try {
    driver.destroy(viewer);
  } catch (error) {
    destroyIdempotent = false;
    destroyError = destroyError ?? String((error as Error)?.message ?? error);
  }

  const service = driver.createService();
  return {
    supported,
    destroyStatus,
    destroyError,
    destroyIdempotent,
    byId: await driver.findById(service, "contract-panorama-id").result,
    byLocation: await driver.findByLocation(service, { lng: 116.404, lat: 39.915 }).result,
  };
}

/* -------------------------------------------------------------------------- */
/* 完备性断言（类型层，零运行时开销；浏览器里被完全擦除）                        */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/** `NATIVE_LAYER_FACET_KINDS` 必须覆盖全部 kind（漏一个 → 编译失败，而不是契约漏测）。 */
type _AssertAllKindsCovered = ExpectTrue<
  NativeLayerKind extends (typeof NATIVE_LAYER_FACET_KINDS)[number] ? true : false
>;

/** `NATIVE_LAYER_FACET_OPERATIONS` 必须覆盖全部操作（同上）。 */
type _AssertAllOperationsCovered = ExpectTrue<
  NativeLayerOperation extends (typeof NATIVE_LAYER_FACET_OPERATIONS)[number] ? true : false
>;
