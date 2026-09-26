## API Signature Baseline for "bmap-vue" (entry `./composables`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/composables.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> 这个出口同时有 API report 与 forgotten-export 身份集合；本快照是第三层：
> report 对未导出类型只留 `typeof getXxx` 名字引用、集合只记符号名，
> **同名结构**的漂移只有这里看得见（ADR 2026-09-25 决策 5 / #159 三轮评审 P1）。

```ts
import { ComputedRef } from "vue";
import { MaybeRefOrGetter } from "vue";
import { Ref } from "vue";
import { ShallowRef } from "vue";
export declare type AreaBoundary = string[];
export declare interface AutocompleteOptions {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
export declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
export declare interface BMapClient {
    readonly id: symbol;
    readonly engine: BMapEngine;
    readonly libraryVersion: string;
    readonly sdkVersion: string;
    readonly driver: BMapDriver;
    readonly capabilities: CapabilityRegistry;
    readonly rawSdk: unknown;
}
export declare interface BMapDriver {
    readonly engine: BMapEngine;
    readonly version: string;
    readonly rawSdk: unknown;
    readonly capabilities: CapabilityRegistry;
    readonly geometry: GeometryDriver;
    readonly map: MapDriver;
    readonly overlays: OverlayDriver;
    readonly controls: ControlDriver;
    readonly layers: LayerDriver;
    readonly services: ServiceDriver;
    readonly panorama: PanoramaDriver;
    readonly events: EventDriver;
}
export declare interface BMapDrivingRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    policy?: MaybeRefOrGetter<DrivingPolicy_2 | undefined>;
    enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}
export declare type BMapEngine = "jsapi-v4";
export declare interface BMapGeolocationOptions {
    enableSDKLocation?: boolean;
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
}
export declare interface BMapGeoResult {
    point: {
        lng: number;
        lat: number;
    };
    accuracy: number | null;
    address: GeolocationAddressInfo | null;
    status: "BMAP_STATUS_SUCCESS";
    source: "baidu-sdk";
    timestamp: number;
}
export declare interface BMapIpLocationResult {
    name: string;
    point: {
        lng: number;
        lat: number;
    } | null;
    level: number | null;
}
export declare type BMapLocalSearchOperation = {
    kind: "search";
    keyword: LocalSearchKeyword;
    option?: LocalSearchSearchOption;
} | ({
    kind: "nearby";
} & LocalSearchNearbyRequest) | ({
    kind: "inBounds";
} & LocalSearchInBoundsRequest) | {
    kind: "page";
    page: number;
};
export declare interface BMapLocalSearchOptions {
    location?: MaybeRefOrGetter<LocalSearchLocation | undefined>;
    pageCapacity?: MaybeRefOrGetter<number | undefined>;
    pageNum?: MaybeRefOrGetter<number | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapLocalSearchRenderOptions | undefined>;
}
export declare interface BMapLocalSearchRenderOptions {
    map?: MaybeRefOrGetter<MapHandle | null | undefined>;
    panel?: string | HTMLElement;
    selectFirstResult?: boolean;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
export declare interface BMapRidingRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}
export declare type BMapRouteLocation = string | GeoPoint | MapHandle;
export declare interface BMapRouteRenderOptions {
    map?: MaybeRefOrGetter<MapHandle | null | undefined>;
    panel?: string | HTMLElement;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
export declare type BMapServiceStatus = "idle" | "loading" | ServiceCallStatus | "unsupported";
export declare interface BMapTransitRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    policy?: MaybeRefOrGetter<TransitPolicy_2 | undefined>;
    intercityPolicy?: MaybeRefOrGetter<IntercityPolicy_2 | undefined>;
    transitTypePolicy?: MaybeRefOrGetter<TransitVehiclePolicy | undefined>;
    pageCapacity?: MaybeRefOrGetter<number | undefined>;
    enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}
export declare interface BMapWalkingRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}
export declare interface Bounds {
    southwest: Point;
    northeast: Point;
}
export declare type BuiltinMarkerIconName = "simple_red" | "simple_blue" | "loc_red" | "loc_blue" | "start" | "end" | "location" | "red1" | "red2" | "red3" | "red4" | "red5" | "red6" | "red7" | "red8" | "red9" | "red10" | "blue1" | "blue2" | "blue3" | "blue4" | "blue5" | "blue6" | "blue7" | "blue8" | "blue9" | "blue10";
export declare type Capability = "map.view-state" | "map.zoom" | "map.center-and-zoom" | "map.bounds" | "map.viewport" | "map.heading" | "map.tilt" | "map.fly-to" | "map.animate" | "map.screenshot" | "map.check-resize" | "map.pixel-conversion" | "map.style" | "map.destroy" | "overlay.marker" | "overlay.label" | "overlay.info-window" | "overlay.circle" | "overlay.polyline" | "overlay.polygon" | "overlay.rectangle" | "overlay.custom-dom" | "overlay.ground" | "overlay.point-collection" | "overlay.context-menu" | "overlay.prism" | "overlay.bezier-curve" | "overlay.marker-3d" | "overlay.mapvgl" | "layer.tile" | "layer.traffic" | "layer.geojson" | "layer.point-icon" | "layer.point-shape" | "layer.district" | "layer.panorama-coverage" | "layer.line" | "layer.fill" | "layer.dom" | "layer.xyz" | "layer.wms" | "layer.wmts" | "layer.raster" | "layer.mvt" | "layer.cluster" | "layer.point" | "layer.heatmap" | "layer.track-line" | "service.local-search" | "service.autocomplete" | "service.driving-route" | "service.walking-route" | "service.riding-route" | "service.transit-route" | "service.geocoder" | "service.geolocation" | "service.local-city" | "service.boundary" | "service.convertor" | "service.track-animation" | "panorama.viewer" | "panorama.service" | "panorama.label";
export declare interface CapabilityDescriptor {
    id: Capability;
    family: CapabilityFamily;
    description: string;
    rawMembers?: readonly string[];
    status: CapabilityStatus;
    runtimeOnly: boolean;
}
export declare interface CapabilityExplanation {
    id: Capability;
    supported: boolean;
    reason: CapabilityReason;
    engine: BMapEngine;
    version: string;
    family?: CapabilityFamily;
    status: CapabilityStatus;
    runtimeOnly: boolean;
}
export declare type CapabilityFamily = "map" | "overlay" | "layer" | "service" | "panorama";
export declare type CapabilityReason = "supported" | "unlisted-capability" | "raw-member-missing" | "status-unsupported" | "overridden";
export declare interface CapabilityRegistry {
    supports(capability: Capability): boolean;
    require(capability: Capability): void;
    list(): readonly Capability[];
    explain(capability: Capability): CapabilityExplanation;
    descriptor(capability: Capability): CapabilityDescriptor | undefined;
    observeInstanceMembers(source: unknown): void;
}
export declare type CapabilityStatus = "native" | "extended" | "experimental" | "unsupported";
export declare type CircleHandle = SdkHandle<"overlay:circle">;
export declare interface ControlDriver {
    create(kind: ControlKind, options?: ControlOptions): ControlHandle;
    createCustomControl(options: {
        anchor?: string;
        offset?: Pixel;
        render: (mapContainer: HTMLElement) => HTMLElement | null;
    }): ControlHandle;
    add(target: OverlayTarget, control: ControlHandle): void;
    remove(target: OverlayTarget, control: ControlHandle): void;
    show(control: ControlHandle): void;
    hide(control: ControlHandle): void;
    setOptions(control: ControlHandle, options: Record<string, unknown>): void;
    planOptions(control: ControlHandle, keys: readonly string[]): Record<string, ControlOptionStatus>;
    addCopyright(control: ControlHandle, copyright: CopyrightEntry): void;
    removeCopyright(control: ControlHandle, id: number): void;
    listCopyrights(control: ControlHandle): CopyrightEntry[];
}
export declare type ControlHandle = SdkHandle<"control" | `control:${string}`>;
export declare type ControlKind = "zoom" | "scale" | "navigation" | "navigation-3d" | "city-list" | "location" | "map-type" | "overview" | "panorama" | "copyright" | "custom";
export declare type ControllableMode = "controlled" | "uncontrolled";
export declare interface ControllableState<T> {
    readonly value: ComputedRef<T>;
    readonly internal: ShallowRef<T>;
    readonly isControlled: ComputedRef<boolean>;
    readonly initial: T;
    syncExternal(next: T | undefined): void;
    commit(next: T): boolean;
    reset(): void;
}
export declare interface ControlOptions {
    anchor?: string;
    offset?: Pixel;
    [key: string]: unknown;
}
export declare type ControlOptionStatus = "mutable" | "recreate" | "unsupported";
export declare enum CoordinatesFromType {
    COORDINATES_WGS84 = 1,
    COORDINATES_WGS84_MC = 2,
    COORDINATES_GCJ02 = 3,
    COORDINATES_GCJ02_MC = 4,
    COORDINATES_BD09 = 5,
    COORDINATES_BD09_MC = 6,
    COORDINATES_MAPBAR = 7,
    COORDINATES_51 = 8
}
export declare enum CoordinatesToType {
    COORDINATES_GCJ02 = 3,
    COORDINATES_BD09 = 5,
    COORDINATES_BD09_MC = 6
}
export declare interface CopyrightEntry {
    id: number;
    content: string;
    bounds?: unknown;
}
export declare interface CustomOverlayOptions {
    offset?: Pixel;
    anchor?: Pixel;
    rotation?: number;
    minZoom?: number;
    maxZoom?: number;
    properties?: Record<string, unknown>;
    visible?: boolean;
    zIndex?: number;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
export declare interface DriverEvent {
    type?: string;
    point?: Point;
    pixel?: Pixel;
    size?: Size;
    zoom?: number;
    targetZoom?: number;
    trend?: boolean;
    mapType?: unknown;
    exMapType?: unknown;
    zoomLevel?: number;
    domEvent?: Event;
    raw: unknown;
    preventDefault(): void;
    stopPropagation(): void;
}
declare const DrivingPolicy_2: {
    readonly DEFAULT: 0;
    readonly LEAST_DISTANCE: 2;
    readonly AVOID_HIGHWAYS: 3;
    readonly FIRST_HIGHWAYS: 4;
    readonly AVOID_CONGESTION: 5;
    readonly AVOID_PAY: 6;
    readonly HIGHWAYS_AVOID_CONGESTION: 7;
    readonly AVOID_HIGHWAYS_CONGESTION: 8;
    readonly AVOID_CONGESTION_PAY: 9;
    readonly AVOID_HIGHWAYS_CONGESTION_PAY: 10;
    readonly AVOID_HIGHWAYS_PAY: 11;
    readonly DISTANCE_PRIORITY: 12;
    readonly TIME_PRIORITY: 13;
};
declare type DrivingPolicy_2 = (typeof DrivingPolicy_2)[keyof typeof DrivingPolicy_2];
export { DrivingPolicy_2 as DrivingPolicy };
export declare type DrivingRouteEndpoint = Point | RouteEndpointPoi;
export declare interface DrivingRouteOptions extends RouteState {
    policy?: DrivingPolicy_2;
}
export declare type DrivingRouteResult = RouteResult<RoutePlan>;
export declare type EqualFn<T> = (a: T, b: T) => boolean;
export declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
export declare interface EventSourceClient {
    readonly driver: {
        readonly events: EventDriver;
        readonly map: MapDriver;
    };
}
export declare interface FrameScheduler {
    schedule(key: PropertyKey, task: () => void): void;
    cancel(key: PropertyKey): void;
    flush(): void;
    pause(): void;
    resume(): void;
    dispose(): void;
}
export declare interface GeocodeDetailAddressComponents {
    city: string;
    district: string;
    province: string;
    street: string;
    streetNumber: string;
}
export declare interface GeocodeDetailItemResult {
    point: GeoPoint;
    detail: GeocodeDetailResult | null;
    status: BMapServiceStatus;
    error: ServiceErrorInfo | null;
}
export declare interface GeocodeDetailResult {
    point: GeoPoint;
    address: string;
    addressComponents: GeocodeDetailAddressComponents;
    surroundingPois: readonly LocalSearchPoi[];
    business: string;
}
export declare interface GeocodeItemResult {
    address: string;
    point: GeoPoint | null;
    status: BMapServiceStatus;
    error: ServiceErrorInfo | null;
}
export declare interface GeolocationAddressInfo {
    country?: string;
    province?: string;
    city?: string;
    cityCode?: string | number;
    district?: string;
    street?: string;
    streetNumber?: string;
}
export declare interface GeometryDriver {
    toRawPoint(point: Point): unknown;
    fromRawPoint(raw: unknown): Point;
    toRawPoints(points: readonly Point[]): unknown[];
    fromRawPoints(raws: readonly unknown[]): Point[];
    toRawPixel(pixel: Pixel): unknown;
    fromRawPixel(raw: unknown): Pixel;
    toRawSize(size: Size): unknown;
    fromRawSize(raw: unknown): Size;
    toRawBounds(bounds: Bounds): unknown;
    fromRawBounds(raw: unknown): Bounds;
}
export declare interface GeoPoint {
    lng: number;
    lat: number;
}
declare const HANDLE_BRAND: unique symbol;
export declare type InfoWindowHandle = SdkHandle<"overlay:info-window">;
export declare interface InfoWindowOptions {
    width?: number;
    height?: number;
    title?: string;
    offset?: Pixel;
    enableMaximize?: boolean;
    enableAutoPan?: boolean;
    enableCloseOnClick?: boolean;
    [key: string]: unknown;
}
export declare interface InitialMapOptions {
    minZoom?: number;
    maxZoom?: number;
    backgroundColor?: number[];
    restrictCenter?: boolean;
    displayOptions?: Record<string, unknown>;
    [key: string]: unknown;
}
declare const IntercityPolicy_2: {
    readonly LEAST_TIME: 0;
    readonly EARLY_START: 1;
    readonly CHEAP_PRICE: 2;
};
declare type IntercityPolicy_2 = (typeof IntercityPolicy_2)[keyof typeof IntercityPolicy_2];
export { IntercityPolicy_2 as IntercityPolicy };
export declare type LabelHandle = SdkHandle<"overlay:label">;
export declare interface LabelOptions {
    position?: Point;
    offset?: Pixel;
    zIndex?: number;
    style?: Record<string, unknown>;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
export declare interface LayerCreateOptions extends Record<string, unknown> {
    layerName?: string;
    createDOM?: (properties: object, point: {
        lng: number;
        lat: number;
    }) => HTMLElement;
}
export declare type LayerCtorSlot = "opacity" | "minZoom" | "maxZoom" | "zIndex" | "data";
export declare type LayerData = object;
export declare interface LayerDriver {
    create(kind: LayerKind, options?: LayerCreateOptions): LayerHandle;
    add(target: OverlayTarget, layer: LayerHandle): void;
    remove(target: OverlayTarget, layer: LayerHandle): void;
    setOptions(layer: LayerHandle, options: Record<string, unknown>): void;
    surface(kind: LayerKind): LayerSurface;
    supports(kind: LayerKind, operation: LayerOperation): boolean;
    isMutableOption(kind: LayerKind, key: string): boolean;
    setZIndex(layer: LayerHandle, zIndex: number): void;
    setData(layer: LayerHandle, data: LayerData): void;
    clearData(layer: LayerHandle): void;
    updateState(layer: LayerHandle, keys: NativeLayerFeatureKeys, state: NativeLayerFeatureState, append?: boolean): void;
    removeState(layer: LayerHandle, keys: NativeLayerFeatureKeys): void;
    clearState(layer: LayerHandle): void;
    replaceState(layer: LayerHandle, inputs: NativeLayerFeatureStateMap): void;
    getState(layer: LayerHandle): NativeLayerFeatureStateMap;
}
export declare type LayerHandle = SdkHandle<"layer" | `layer:${string}`>;
export declare type LayerKind = "district" | "panorama-coverage" | "tile" | "traffic" | "geojson" | "dom" | "xyz" | "wms" | "wmts" | "raster" | "mvt";
export declare type LayerOperation = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
export declare interface LayerSurface {
    readonly ctorSlots: readonly LayerCtorSlot[];
    readonly operations: readonly LayerOperation[];
}
export declare type LocalSearchBounds = Bounds;
export declare interface LocalSearchInBoundsRequest {
    keyword: LocalSearchKeyword;
    bounds: LocalSearchBounds;
}
export declare type LocalSearchKeyword = string | readonly string[];
export declare type LocalSearchLocation = string | GeoPoint | MapHandle;
export declare interface LocalSearchNearbyRequest {
    keyword: LocalSearchKeyword;
    center: string | Point;
    radius: number;
}
export declare interface LocalSearchOptions {
    renderOptions?: LocalSearchRenderOptions;
    pageCapacity?: number;
    pageNum?: number;
}
export declare interface LocalSearchPoi {
    title: string;
    uid: string;
    point: Point | null;
    address: string | null;
    city: string | null;
    province: string | null;
    phoneNumber: string | null;
    postcode: string | null;
    adcode: string | null;
    tags: readonly string[];
    isAccurate: boolean | null;
    url: string | null;
    detailUrl: string | null;
}
export declare interface LocalSearchRenderOptions {
    map?: MapHandle;
    panel?: string | HTMLElement;
    selectFirstResult?: boolean;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
export declare interface LocalSearchResult {
    keyword: string;
    city: string;
    province: string;
    center: Point | null;
    radius: number | null;
    bounds: LocalSearchBounds | null;
    pois: readonly LocalSearchPoi[];
    pageSize: number;
    total: number;
    pageCount: number;
    pageIndex: number;
    cities: readonly {
        readonly name: string;
        readonly count: number;
    }[];
    moreResultsUrl: string | null;
    suggestions: readonly string[];
}
export declare interface LocalSearchSearchOption {
    forceLocal?: boolean;
}
export declare const MAP_EVENT_CATALOG: {
    readonly load: {
        readonly sdk: "load";
        readonly declared: true;
        readonly payload: "load";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u521D\u59CB\u5316\u5B8C\u6210\uFF08\u9996\u6B21\u89C6\u91CE\u786E\u5B9A\u540E\u6D3E\u53D1\u4E00\u6B21\uFF1B\u8F7D\u8377\u53E6\u6709 point / zoom\uFF09";
    };
    readonly click: {
        readonly sdk: "click";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u5DE6\u952E\u5355\u51FB\u5730\u56FE";
    };
    readonly dblclick: {
        readonly sdk: "dblclick";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u9F20\u6807\u53CC\u51FB\u5730\u56FE";
    };
    readonly rightclick: {
        readonly sdk: "rightclick";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u53F3\u952E\u5355\u51FB\u5730\u56FE";
    };
    readonly rightdblclick: {
        readonly sdk: "rightdblclick";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u53F3\u952E\u53CC\u51FB\u5730\u56FE";
    };
    readonly mousemove: {
        readonly sdk: "mousemove";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: true;
        readonly description: "\u9F20\u6807\u5728\u5730\u56FE\u533A\u57DF\u5185\u79FB\u52A8\uFF08\u9AD8\u9891\uFF0C\u6309\u5E27\u5408\u5E27\uFF09";
    };
    readonly mousedown: {
        readonly sdk: "mousedown";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u9F20\u6807\u6309\u4E0B";
    };
    readonly mouseup: {
        readonly sdk: "mouseup";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u9F20\u6807\u677E\u5F00";
    };
    readonly mouseover: {
        readonly sdk: "mouseover";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u9F20\u6807\u79FB\u5165\u5730\u56FE\u533A\u57DF";
    };
    readonly mouseout: {
        readonly sdk: "mouseout";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u9F20\u6807\u79FB\u51FA\u5730\u56FE\u533A\u57DF";
    };
    readonly touchstart: {
        readonly sdk: "touchstart";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u89E6\u6478\u5F00\u59CB";
    };
    readonly touchmove: {
        readonly sdk: "touchmove";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: true;
        readonly description: "\u89E6\u6478\u79FB\u52A8\uFF08\u9AD8\u9891\uFF0C\u6309\u5E27\u5408\u5E27\uFF09";
    };
    readonly touchend: {
        readonly sdk: "touchend";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u89E6\u6478\u7ED3\u675F";
    };
    readonly mousewheel: {
        readonly sdk: "mousewheel";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u6EDA\u8F6E\u7F29\u653E\uFF08\u8F7D\u8377\u53E6\u6709 trend\uFF1Atrue = \u653E\u5927\uFF09";
    };
    readonly zoomexceeded: {
        readonly sdk: "zoomexceeded";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u7F29\u653E\u8BD5\u56FE\u8D85\u51FA\u5141\u8BB8\u8303\u56F4\uFF08\u8F7D\u8377\u53E6\u6709 targetZoom\uFF09";
    };
    readonly dragstart: {
        readonly sdk: "dragstart";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u5F00\u59CB\u62D6\u62FD\u5730\u56FE";
    };
    readonly dragging: {
        readonly sdk: "dragging";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: true;
        readonly description: "\u62D6\u62FD\u4E2D\uFF08\u9AD8\u9891\uFF0C\u6309\u5E27\u5408\u5E27\uFF09";
    };
    readonly dragend: {
        readonly sdk: "dragend";
        readonly declared: true;
        readonly payload: "pointer";
        readonly coalesce: false;
        readonly description: "\u7ED3\u675F\u62D6\u62FD";
    };
    readonly movestart: {
        readonly sdk: "movestart";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u79FB\u52A8\u5F00\u59CB";
    };
    readonly moving: {
        readonly sdk: "moving";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: true;
        readonly description: "\u5730\u56FE\u79FB\u52A8\u4E2D\uFF08\u9AD8\u9891\uFF0C\u6309\u5E27\u5408\u5E27\uFF09";
    };
    readonly moveend: {
        readonly sdk: "moveend";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u79FB\u52A8\u7ED3\u675F";
    };
    readonly zoomstart: {
        readonly sdk: "zoomstart";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u5F00\u59CB\u6539\u53D8\u7F29\u653E\u7EA7\u522B";
    };
    readonly zooming: {
        readonly sdk: "zooming";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: true;
        readonly description: "\u7F29\u653E\u4E2D\uFF08\u9AD8\u9891\uFF0C\u6309\u5E27\u5408\u5E27\uFF09";
    };
    readonly zoomend: {
        readonly sdk: "zoomend";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u7F29\u653E\u7ED3\u675F";
    };
    readonly beforeaddoverlay: {
        readonly sdk: "beforeaddoverlay";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u8986\u76D6\u7269\u6DFB\u52A0\u524D";
    };
    readonly addoverlay: {
        readonly sdk: "addoverlay";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "addOverlay() \u4E4B\u540E";
    };
    readonly removeoverlay: {
        readonly sdk: "removeoverlay";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "removeOverlay() \u4E4B\u540E";
    };
    readonly clearoverlays: {
        readonly sdk: "clearoverlays";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "clearOverlays() \u4E4B\u540E";
    };
    readonly addcontrol: {
        readonly sdk: "addcontrol";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "addControl() \u4E4B\u540E";
    };
    readonly removecontrol: {
        readonly sdk: "removecontrol";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "removeControl() \u4E4B\u540E";
    };
    readonly addcontextmenu: {
        readonly sdk: "addcontextmenu";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "addContextMenu() \u4E4B\u540E";
    };
    readonly removecontextmenu: {
        readonly sdk: "removecontextmenu";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "removeContextMenu() \u4E4B\u540E";
    };
    readonly maptypechange: {
        readonly sdk: "maptypechange";
        readonly declared: true;
        readonly payload: "maptypechange";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u7C7B\u578B\u53D8\u5316\uFF08\u8F7D\u8377\u53E6\u6709 mapType / exMapType\uFF09";
    };
    readonly "style-willchange": {
        readonly sdk: "style_willchange";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u4E2A\u6027\u5316\u6837\u5F0F\u5373\u5C06\u5207\u6362";
    };
    readonly "style-loaded": {
        readonly sdk: "style_loaded";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u4E2A\u6027\u5316\u6837\u5F0F\u52A0\u8F7D\u5B8C\u6210";
    };
    readonly "style-loaded-error": {
        readonly sdk: "style_loaded_error";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u4E2A\u6027\u5316\u6837\u5F0F\u52A0\u8F7D\u5931\u8D25";
    };
    readonly "style-loaded-timeout": {
        readonly sdk: "style_loaded_timeout";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u4E2A\u6027\u5316\u6837\u5F0F\u52A0\u8F7D\u8D85\u65F6";
    };
    readonly "language-change": {
        readonly sdk: "language_change";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u663E\u793A\u8BED\u8A00\u53D8\u5316";
    };
    readonly destroy: {
        readonly sdk: "destroy";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u5730\u56FE\u5B9E\u4F8B\u9500\u6BC1";
    };
    readonly tilesloaded: {
        readonly sdk: "tilesloaded";
        readonly declared: true;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u74E6\u7247\u52A0\u8F7D\u5B8C\u6210";
    };
    readonly resize: {
        readonly sdk: "resize";
        readonly declared: true;
        readonly payload: "resize";
        readonly coalesce: false;
        readonly description: "\u5BB9\u5668\u53EF\u89C6\u533A\u57DF\u5927\u5C0F\u53D8\u5316\uFF08\u8F7D\u8377\u53E6\u6709 size\uFF09";
    };
    readonly headingchange: {
        readonly sdk: "headingchange";
        readonly declared: false;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u65CB\u8F6C\u89D2\u53D8\u5316\uFF08\u4E0A\u6E38\u7C7B\u578B\u672A\u58F0\u660E\uFF0C\u8FD0\u884C\u65F6\u53EF\u89C2\u5BDF\uFF09";
    };
    readonly tiltchange: {
        readonly sdk: "tiltchange";
        readonly declared: false;
        readonly payload: "base";
        readonly coalesce: false;
        readonly description: "\u503E\u659C\u89D2\u53D8\u5316\uFF08\u4E0A\u6E38\u7C7B\u578B\u672A\u58F0\u660E\uFF0C\u8FD0\u884C\u65F6\u53EF\u89C2\u5BDF\uFF09";
    };
};
export declare interface MapDriver {
    create(container: HTMLElement, options?: InitialMapOptions): MapHandle;
    destroy(map: MapHandle): void;
    initializeView(map: MapHandle, view: MapView): void;
    setCenter(map: MapHandle, center: Point | string): void;
    getCenter(map: MapHandle): Point;
    setZoom(map: MapHandle, zoom: number): void;
    getZoom(map: MapHandle): number;
    setHeading(map: MapHandle, heading: number): void;
    getHeading(map: MapHandle): number;
    setTilt(map: MapHandle, tilt: number): void;
    getTilt(map: MapHandle): number;
    getBounds(map: MapHandle): Bounds;
    getSize(map: MapHandle): Size;
    pointToPixel(map: MapHandle, point: Point): Pixel;
    pixelToPoint(map: MapHandle, pixel: Pixel): Point;
    panTo(map: MapHandle, point: Point): void;
    panBy(map: MapHandle, pixel: Pixel): void;
    fitBounds(map: MapHandle, bounds: Bounds): void;
    setViewport(map: MapHandle, points: readonly Point[], options?: Record<string, unknown>): void;
    checkResize(map: MapHandle): void;
    setMapType(map: MapHandle, type: MapType_2): void;
    setMapStyle(map: MapHandle, style: MapStyleInput): void;
    setInteraction(map: MapHandle, name: MapInteraction, enabled: boolean): void;
    setTraffic(map: MapHandle, enabled: boolean): void;
    startViewAnimation(map: MapHandle, animation: unknown): void;
    cancelViewAnimation(map: MapHandle, animation: unknown): ViewAnimationCancelOutcome;
}
export declare interface MapEventEmits {
    load: [
        event: MapLoadPayload
    ];
    click: [
        event: MapPointerEvent
    ];
    dblclick: [
        event: MapPointerEvent
    ];
    rightclick: [
        event: MapPointerEvent
    ];
    rightdblclick: [
        event: MapPointerEvent
    ];
    mousemove: [
        event: MapPointerEvent
    ];
    mousedown: [
        event: MapPointerEvent
    ];
    mouseup: [
        event: MapPointerEvent
    ];
    mouseover: [
        event: MapPointerEvent
    ];
    mouseout: [
        event: MapPointerEvent
    ];
    touchstart: [
        event: MapPointerEvent
    ];
    touchmove: [
        event: MapPointerEvent
    ];
    touchend: [
        event: MapPointerEvent
    ];
    mousewheel: [
        event: MapPointerEvent
    ];
    zoomexceeded: [
        event: MapEventPayload
    ];
    dragstart: [
        event: MapPointerEvent
    ];
    dragging: [
        event: MapPointerEvent
    ];
    dragend: [
        event: MapPointerEvent
    ];
    movestart: [
        event: MapEventPayload
    ];
    moving: [
        event: MapEventPayload
    ];
    moveend: [
        event: MapEventPayload
    ];
    zoomstart: [
        event: MapEventPayload
    ];
    zooming: [
        event: MapEventPayload
    ];
    zoomend: [
        event: MapEventPayload
    ];
    beforeaddoverlay: [
        event: MapEventPayload
    ];
    addoverlay: [
        event: MapEventPayload
    ];
    removeoverlay: [
        event: MapEventPayload
    ];
    clearoverlays: [
        event: MapEventPayload
    ];
    addcontrol: [
        event: MapEventPayload
    ];
    removecontrol: [
        event: MapEventPayload
    ];
    addcontextmenu: [
        event: MapEventPayload
    ];
    removecontextmenu: [
        event: MapEventPayload
    ];
    maptypechange: [
        event: MapTypeChangePayload
    ];
    "style-willchange": [
        event: MapEventPayload
    ];
    "style-loaded": [
        event: MapEventPayload
    ];
    "style-loaded-error": [
        event: MapEventPayload
    ];
    "style-loaded-timeout": [
        event: MapEventPayload
    ];
    "language-change": [
        event: MapEventPayload
    ];
    destroy: [
        event: MapEventPayload
    ];
    tilesloaded: [
        event: MapEventPayload
    ];
    resize: [
        event: MapResizePayload
    ];
    headingchange: [
        event: MapEventPayload
    ];
    tiltchange: [
        event: MapEventPayload
    ];
    style_willchange: [
        event: MapEventPayload
    ];
    style_loaded: [
        event: MapEventPayload
    ];
    style_loaded_error: [
        event: MapEventPayload
    ];
    style_loaded_timeout: [
        event: MapEventPayload
    ];
    language_change: [
        event: MapEventPayload
    ];
}
export declare type MapEventHandler<K extends string> = (event: MapEventPayloadForName<K>) => void;
export declare type MapEventMap = {
    [K in MapEventName]: MapEventEmits[K][0];
};
export declare type MapEventName = keyof typeof MAP_EVENT_CATALOG;
export declare type MapEventPayload = DriverEvent & {
    type: string;
};
export declare type MapEventPayloadForName<K extends string> = K extends MapEventName ? MapEventPayloadOf<K> : MapEventPayload;
export declare type MapEventPayloadOf<K extends MapEventName> = MapEventMap[K];
export declare interface MapEventSource {
    map: MaybeRefOrGetter<MapHandle | null>;
    client: MaybeRefOrGetter<EventSourceClient | null>;
    scheduler?: FrameScheduler;
    whenMapCreated?: (callback: (ready: MapReadyContext) => void) => () => void;
    isTearingDown?: () => boolean;
    resources?: {
        add(disposer: () => void): () => void;
    };
}
export declare type MapEventSourceInput = PublicMapContext | MapEventSource;
export declare type MapHandle = SdkHandle<"map">;
export declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
export declare interface MapLoadEvent extends DriverEvent {
    point: Point;
    zoom: number;
}
export declare type MapLoadPayload = MapLoadEvent & {
    type: string;
};
export declare interface MapMouseEvent extends DriverEvent {
    point: Point;
}
export declare type MapPointerEvent = MapMouseEvent & {
    type: string;
};
export declare interface MapReadyContext {
    readonly client: BMapClient;
    readonly map: MapHandle;
}
export declare interface MapResizeEvent extends DriverEvent {
    size: Size;
}
export declare type MapResizePayload = MapResizeEvent & {
    type: string;
};
export declare type MapStatus = "idle" | "waiting-client" | "creating" | "initializing" | "ready" | "error" | "disposing" | "disposed";
export declare interface MapStatusRefs {
    readonly center: Readonly<ShallowRef<Point | null>>;
    readonly zoom: Readonly<ShallowRef<number | null>>;
    readonly bounds: Readonly<ShallowRef<Bounds | null>>;
    readonly size: Readonly<ShallowRef<Size | null>>;
    readonly heading: Readonly<ShallowRef<number | null>>;
    readonly tilt: Readonly<ShallowRef<number | null>>;
    readonly moving: Readonly<ShallowRef<boolean>>;
    readonly zooming: Readonly<ShallowRef<boolean>>;
    dispose(): void;
}
export declare type MapStyleInput = {
    styleId: string;
} | Record<string, unknown>;
declare type MapType_2 = "normal" | "satellite" | "earth";
export { MapType_2 as MapType };
export declare interface MapTypeChangeEvent extends DriverEvent {
    zoomLevel: number;
}
export declare type MapTypeChangePayload = MapTypeChangeEvent & {
    type: string;
};
export declare interface MapView {
    center: Point | string;
    zoom: number;
    heading?: number;
    tilt?: number;
}
export declare type MarkerHandle = SdkHandle<"overlay:marker">;
export declare type MarkerIconInput = string | {
    imageUrl: string;
    size: Size;
    anchor?: Pixel;
    imageOffset?: Pixel;
    imageSize?: Size;
    printImageUrl?: string;
};
export declare type MarkerIconName = BuiltinMarkerIconName;
export declare interface MarkerOptions {
    offset?: Pixel;
    title?: string;
    icon?: MarkerIconInput;
    zIndex?: number;
    rotation?: number;
    enableClicking?: boolean;
    enableDragging?: boolean;
    [key: string]: unknown;
}
export declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
export declare type NativeLayerFeatureState = Record<string, unknown>;
export declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
export declare interface OverlayDriver {
    createMarker(position: Point, options?: MarkerOptions): MarkerHandle;
    createPolyline(path: readonly Point[], options?: PathOptions): PolylineHandle;
    createPolygon(path: readonly (Point | string)[], options?: PathOptions & {
        isBoundary?: boolean;
    }): PolygonHandle;
    createRectangle(bounds: Bounds, options?: PathOptions): OverlayHandle;
    createCircle(center: Point, radius: number, options?: PathOptions): CircleHandle;
    createInfoWindow(content: HTMLElement, options?: InfoWindowOptions): InfoWindowHandle;
    createLabel(content: string, options?: LabelOptions): LabelHandle;
    createPrism(path: readonly (Point | string)[], altitude: number, options?: Record<string, unknown>): OverlayHandle;
    createMarker3D(position: Point, height: number, options?: Record<string, unknown>): OverlayHandle;
    createBezierCurve(path: readonly Point[], controlPoints: readonly (readonly Point[])[], options?: Record<string, unknown>): OverlayHandle;
    createMapMask(path: readonly Point[], options?: Record<string, unknown>): OverlayHandle;
    createGroundOverlay(bounds: Bounds, options?: Record<string, unknown>): OverlayHandle;
    createCustomOverlay(position: Point, render: () => HTMLElement, options?: CustomOverlayOptions): OverlayHandle;
    createContextMenu(options?: {
        width?: number;
    }): OverlayHandle;
    addContextMenuItem(menu: OverlayHandle, item: {
        text: string;
        callback: (point: unknown, pixel: unknown) => void;
        disabled?: boolean;
    } | "-", options?: {
        width?: number;
        id?: string;
    }): void;
    add(target: OverlayTarget, overlay: OverlayHandle): void;
    remove(target: OverlayTarget, overlay: OverlayHandle): void;
    show(overlay: OverlayHandle): boolean;
    hide(overlay: OverlayHandle): boolean;
    attachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;
    detachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;
    setPosition(overlay: OverlayHandle, position: Point): void;
    setPath(overlay: OverlayHandle, path: readonly (Point | string)[]): void;
    setOptions(overlay: OverlayHandle, options: Record<string, unknown>): void;
    updatePolicy(overlay: OverlayHandle, key: string): OverlayPropertyPolicy | undefined;
    openInfoWindow(map: MapHandle, overlay: InfoWindowHandle, position: Point): void;
    closeInfoWindow(overlay: InfoWindowHandle): void;
    redrawInfoWindow(overlay: InfoWindowHandle): void;
    isCurrentInfoWindow(map: MapHandle, overlay: InfoWindowHandle): boolean;
    buildIcon(icon: MarkerIconInput): unknown;
}
export declare type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
export declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
export declare interface OverlayTarget {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle<string>;
}
export declare interface PanoramaDataInfo {
    id: string;
    description: string;
    position: Point | null;
}
export declare interface PanoramaDriver {
    readonly supported: boolean;
}
export declare interface PathOptions {
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
    fillColor?: string;
    fillOpacity?: number;
    enableMassClear?: boolean;
    enableEditing?: boolean;
    enableClicking?: boolean;
    zIndex?: number;
    [key: string]: unknown;
}
export declare interface Pixel {
    x: number;
    y: number;
}
export declare interface Point {
    lng: number;
    lat: number;
}
export declare type PolygonHandle = SdkHandle<"overlay:polygon">;
export declare type PolylineHandle = SdkHandle<"overlay:polyline">;
export declare interface PublicBMapClient {
    readonly capabilities: CapabilityRegistry;
    readonly driver: {
        readonly services: ServiceDriver;
        readonly events: EventDriver;
        readonly map: MapDriver;
    };
}
export declare interface PublicMapContext {
    readonly isTearingDown: () => boolean;
    readonly whenReady: (signal?: AbortSignal) => Promise<MapReadyContext>;
    readonly client: Readonly<ShallowRef<PublicBMapClient | null>>;
    readonly map: Readonly<ShallowRef<MapHandle | null>>;
    readonly status: Readonly<ShallowRef<MapStatus>>;
    readonly error: Readonly<ShallowRef<unknown>>;
    readonly events: {
        emit(type: string, payload: unknown): void;
    };
}
export declare function resolveMapContext(map?: unknown): PublicMapContext;
export declare type RidingRouteOptions = RouteRenderState;
export declare type RidingRouteResult = RouteResult<RoutePlan>;
export declare type RouteEndpoint = string | Point | RouteEndpointPoi;
export declare interface RouteEndpointInfo {
    title: string;
    point: Point | null;
    uid: string;
}
export declare interface RouteEndpointPoi {
    uid: string;
    point: Point;
    name?: string;
}
export declare interface RouteLeg {
    index: number;
    planIndex: number | null;
    routeType: number | null;
    distance: number | null;
    distanceText: string | null;
    path: readonly Point[];
    steps: readonly RouteStep[];
}
export declare interface RoutePlan {
    index: number;
    distance: number | null;
    distanceText: string | null;
    duration: number | null;
    durationText: string | null;
    toll: number | null;
    tollDistance: number | null;
    taxiFare: RouteTaxiFare | null;
    dragPois: readonly RouteEndpointInfo[];
    legs: readonly RouteLeg[];
}
export declare interface RouteRenderOptions {
    map?: MapHandle;
    panel?: string | HTMLElement;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
export declare interface RouteRenderState {
    renderOptions?: RouteRenderOptions;
}
export declare interface RouteResult<TPlan> {
    start: RouteEndpointInfo | null;
    end: RouteEndpointInfo | null;
    plans: readonly TPlan[];
    policy: number | null;
    transitType: number | null;
}
export declare interface RouteState extends RouteRenderState {
    enableTraffic?: boolean;
}
export declare interface RouteStep {
    index: number;
    position: Point | null;
    description: string | null;
    distance: number | null;
    distanceText: string | null;
    routeIndex: number | null;
    planIndex: number | null;
}
export declare interface RouteTaxiFare {
    day: RouteTaxiFareDetail | null;
    night: RouteTaxiFareDetail | null;
    distance: number | null;
    remark: string | null;
}
export declare interface RouteTaxiFareDetail {
    initialFare: number | null;
    unitFare: number | null;
    totalFare: number | null;
}
export declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
export declare type ServiceCallStatus = "success" | "empty" | "failed" | "timeout" | "canceled";
export declare interface ServiceDriver {
    createGeocoder(): ServiceHandle<"service:geocoder">;
    createConvertor(): ServiceHandle<"service:convertor">;
    createGeolocation(options?: Record<string, unknown>): ServiceHandle<"service:geolocation">;
    createLocalCity(): ServiceHandle<"service:local-city">;
    createBoundary(): ServiceHandle<"service:boundary">;
    createAutocomplete(options: AutocompleteOptions): ServiceHandle<"service:autocomplete">;
    createLocalSearch(location: string | Point | MapHandle, options?: LocalSearchOptions): ServiceHandle<"service:local-search">;
    createDrivingRoute(location: string | Point | MapHandle, options?: DrivingRouteOptions): ServiceHandle<"service:driving-route">;
    createWalkingRoute(location: string | Point | MapHandle, options?: WalkingRouteOptions): ServiceHandle<"service:walking-route">;
    createRidingRoute(location: string | Point | MapHandle, options?: RidingRouteOptions): ServiceHandle<"service:riding-route">;
    createTransitRoute(location: string | Point | MapHandle, options?: TransitRouteOptions): ServiceHandle<"service:transit-route">;
    setAutocompleteOptions(handle: ServiceHandle<"service:autocomplete">, options: AutocompleteUpdateOptions): void;
    createViewAnimation(keyFrames: readonly Record<string, unknown>[], options?: Record<string, unknown>): ServiceHandle<"service:view-animation">;
    createTrackAnimation(map: MapHandle, path: readonly Point[], options?: Record<string, unknown>): ServiceHandle<"service:track-animation">;
}
export declare interface ServiceErrorInfo {
    code: number | string | null;
    message: string;
}
export declare type ServiceHandle<Kind extends string = "service"> = SdkHandle<Kind>;
export declare interface ServiceResult<T> {
    readonly status: ServiceCallStatus;
    readonly data: T | null;
    readonly error: ServiceErrorInfo | null;
    readonly sdkStatus: number | null;
}
export declare interface Size {
    width: number;
    height: number;
}
export declare interface TransitLineSegment {
    kind: "line";
    title: string;
    lineType: number | null;
    viaStops: number | null;
    onStop: RouteEndpointInfo | null;
    offStop: RouteEndpointInfo | null;
    distance: number | null;
    distanceText: string | null;
    path: readonly Point[];
}
declare const TransitPolicy_2: {
    readonly RECOMMEND: 0;
    readonly LEAST_TRANSFER: 1;
    readonly LEAST_WALKING: 2;
    readonly AVOID_SUBWAYS: 3;
    readonly LEAST_TIME: 4;
    readonly FIRST_SUBWAYS: 5;
};
declare type TransitPolicy_2 = (typeof TransitPolicy_2)[keyof typeof TransitPolicy_2];
export { TransitPolicy_2 as TransitPolicy };
export declare interface TransitRouteOptions extends RouteState {
    policy?: TransitPolicy_2;
    intercityPolicy?: IntercityPolicy_2;
    transitTypePolicy?: TransitVehiclePolicy;
    pageCapacity?: number;
}
export declare interface TransitRoutePlan {
    index: number;
    distance: number | null;
    distanceText: string | null;
    duration: number | null;
    durationText: string | null;
    description: string | null;
    linesTitle: string | null;
    walkDistance: string | null;
    segments: readonly TransitRouteSegment[];
}
export declare type TransitRouteResult = RouteResult<TransitRoutePlan>;
export declare type TransitRouteSegment = TransitLineSegment | TransitWalkSegment;
export declare const TransitVehiclePolicy: {
    readonly TRAIN: 0;
    readonly AIRPLANE: 1;
    readonly COACH: 2;
};
export declare type TransitVehiclePolicy = (typeof TransitVehiclePolicy)[keyof typeof TransitVehiclePolicy];
export declare interface TransitWalkSegment {
    kind: "walk";
    leg: RouteLeg;
}
export declare function useAreaBoundary(map?: unknown): {
    data: Readonly<ShallowRef<AreaBoundary | null>>;
    boundaries: ComputedRef<AreaBoundary>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    get: (area: string) => Promise<ServiceResult<AreaBoundary>>;
    cancel: () => void;
    reset: () => void;
};
export declare function useControllableState<T>(options: UseControllableStateOptions<T>): ControllableState<T>;
export declare interface UseControllableStateOptions<T> {
    name: string;
    value: () => T | undefined;
    defaultValue?: () => T | undefined;
    fallback: T;
    equals: EqualFn<T>;
    copy?: (value: T) => T;
    warn?: boolean;
}
export declare function useConvertor(map?: unknown): {
    data: Readonly<ShallowRef<GeoPoint[] | null>>;
    result: Readonly<ShallowRef<GeoPoint[] | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    convert: (points: readonly GeoPoint[], from: CoordinatesFromType, to: CoordinatesToType) => Promise<ServiceResult<GeoPoint[]>>;
    get: (points: readonly GeoPoint[], from: CoordinatesFromType, to: CoordinatesToType) => Promise<ServiceResult<GeoPoint[]>>;
    cancel: () => void;
    reset: () => void;
};
export declare function useDrivingRoute(options?: MaybeRefOrGetter<BMapDrivingRouteOptions>): {
    data: Readonly<ShallowRef<DrivingRouteResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    search: (start: DrivingRouteEndpoint, end: DrivingRouteEndpoint, searchOptions?: {
        waypoints?: readonly Point[];
    }) => Promise<ServiceResult<DrivingRouteResult>>;
    clear: () => void;
    cancel: () => void;
    reset: () => void;
};
export declare function useGeocodeDetail(map?: unknown): {
    data: Readonly<ShallowRef<GeocodeDetailResult | null>>;
    result: Readonly<ShallowRef<GeocodeDetailResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    get: (point: GeoPoint) => Promise<ServiceResult<GeocodeDetailResult>>;
    getBatch: (points: readonly GeoPoint[]) => Promise<GeocodeDetailItemResult[]>;
    cancel: () => void;
    reset: () => void;
};
export declare function useGeocoder(map?: unknown): {
    data: Readonly<ShallowRef<GeoPoint | null>>;
    location: Readonly<ShallowRef<GeoPoint | null>>;
    point: Readonly<ShallowRef<GeoPoint | null>>;
    result: Readonly<ShallowRef<GeoPoint | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    get: (address: string, city?: string) => Promise<ServiceResult<GeoPoint>>;
    getBatch: (addresses: readonly string[], city?: string) => Promise<GeocodeItemResult[]>;
    cancel: () => void;
    reset: () => void;
};
export declare function useGeolocation(options?: BMapGeolocationOptions, map?: unknown): {
    data: Readonly<ShallowRef<BMapGeoResult | null>>;
    location: Readonly<ShallowRef<BMapGeoResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    locate: () => Promise<ServiceResult<BMapGeoResult>>;
    get: () => Promise<ServiceResult<BMapGeoResult>>;
    cancel: () => void;
    reset: () => void;
};
export declare function useIpLocation(map?: unknown): {
    location: Readonly<ShallowRef<BMapIpLocationResult | null>>;
    data: Readonly<ShallowRef<BMapIpLocationResult | null>>;
    result: Readonly<ShallowRef<BMapIpLocationResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    get: () => Promise<ServiceResult<BMapIpLocationResult>>;
    cancel: () => void;
    reset: () => void;
};
export declare function useLocalSearch(options?: MaybeRefOrGetter<BMapLocalSearchOptions>): {
    data: Readonly<ShallowRef<LocalSearchResult[] | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    search: (keyword: LocalSearchKeyword, option?: LocalSearchSearchOption) => Promise<ServiceResult<LocalSearchResult[]>>;
    searchNearby: (keyword: LocalSearchKeyword, center: string | GeoPoint, radius: number) => Promise<ServiceResult<LocalSearchResult[]>>;
    searchInBounds: (keyword: LocalSearchKeyword, bounds: LocalSearchInBoundsRequest["bounds"]) => Promise<ServiceResult<LocalSearchResult[]>>;
    gotoPage: (page: number) => Promise<ServiceResult<LocalSearchResult[]>>;
    clear: () => void;
    cancel: () => void;
    reset: () => void;
};
export declare function useMap(): {
    status: ShallowRef<MapStatus>;
    map: ShallowRef<MapHandle | null>;
    client: ShallowRef<BMapClient | null>;
    error: ShallowRef<unknown>;
    whenReady: (signal?: AbortSignal) => Promise<MapReadyContext>;
};
export declare function useMapContext(): PublicMapContext;
export declare function useMapEvent<K extends string>(name: MaybeRefOrGetter<K>, handler: MapEventHandler<K> | Ref<MapEventHandler<K>>, options?: UseMapEventOptions): () => void;
export declare interface UseMapEventOptions {
    source?: MapEventSourceInput;
    coalesce?: boolean;
}
export declare function useMapReady(): ComputedRef<boolean>;
export declare function useMapStatus(options?: UseMapStatusOptions): MapStatusRefs;
export declare interface UseMapStatusOptions {
    source?: MapEventSourceInput;
}
export declare function useMarkerIcons(client?: BMapClient): Record<string, unknown>;
export declare function usePanoramaService(map?: unknown): {
    data: Readonly<ShallowRef<PanoramaDataInfo | null>>;
    result: Readonly<ShallowRef<PanoramaDataInfo | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    findById: (id: string) => Promise<ServiceResult<PanoramaDataInfo>>;
    findByLocation: (position: Point, radius?: number) => Promise<ServiceResult<PanoramaDataInfo>>;
    cancel: () => void;
    reset: () => void;
};
export declare function useRidingRoute(options?: MaybeRefOrGetter<BMapRidingRouteOptions>): {
    data: Readonly<ShallowRef<RidingRouteResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    search: (start: RouteEndpoint, end: RouteEndpoint) => Promise<ServiceResult<RidingRouteResult>>;
    clear: () => void;
    cancel: () => void;
    reset: () => void;
};
export declare function useTransitRoute(options?: MaybeRefOrGetter<BMapTransitRouteOptions>): {
    data: Readonly<ShallowRef<TransitRouteResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    search: (start: RouteEndpoint, end: RouteEndpoint) => Promise<ServiceResult<TransitRouteResult>>;
    clear: () => void;
    cancel: () => void;
    reset: () => void;
};
export declare function useViewAnimation(options?: UseViewAnimationOptions, map?: unknown): UseViewAnimationReturn;
export declare interface UseViewAnimationOptions {
    delay?: number;
    duration?: number;
    loop?: number | "INFINITE";
}
export declare interface UseViewAnimationReturn {
    start: (keyFrames: ViewAnimationKeyFrames[]) => Promise<void>;
    cancel: () => void;
    status: Readonly<ShallowRef<ViewAnimationStatus>>;
    ready: Promise<MapReadyContext>;
}
export declare function useWalkingRoute(options?: MaybeRefOrGetter<BMapWalkingRouteOptions>): {
    data: Readonly<ShallowRef<WalkingRouteResult | null>>;
    error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus>>;
    sdkStatus: Readonly<ShallowRef<number | null>>;
    isLoading: Readonly<ShallowRef<boolean>>;
    supported: Readonly<ShallowRef<boolean>>;
    search: (start: RouteEndpoint, end: RouteEndpoint) => Promise<ServiceResult<WalkingRouteResult>>;
    clear: () => void;
    cancel: () => void;
    reset: () => void;
};
export declare type ViewAnimationCancelOutcome = "canceled" | "deferred" | "already-settled";
export declare interface ViewAnimationKeyFrames {
    center: {
        lng: number;
        lat: number;
    };
    zoom?: number;
    tilt?: number;
    heading?: number;
    percentage: number;
}
export declare type ViewAnimationStatus = "idle" | "playing";
export declare type WalkingRouteOptions = RouteRenderState;
export declare type WalkingRouteResult = RouteResult<RoutePlan>;
export {};
```
