## API Signature Baseline for "bmap-vue" (entry `./advanced`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/advanced.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> 这个出口同时有 API report 与 forgotten-export 身份集合；本快照是第三层：
> report 对未导出类型只留 `typeof getXxx` 名字引用、集合只记符号名，
> **同名结构**的漂移只有这里看得见（ADR 2026-09-25 决策 5 / #159 三轮评审 P1）。

```ts
export declare function assertLoadedSdk(value: unknown): LoadedJsapiV4;
export declare interface AutocompleteOptions {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
export declare const baiduJsapiV4Provider: (options?: BaiduJsapiV4ProviderOptions) => JsapiV4Provider;
export declare interface BaiduJsapiV4ProviderOptions {
    loader?: OfficialJsapiLoader;
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
export declare type BMapDriverFactory = (input: BMapDriverInput) => BMapDriver;
export declare interface BMapDriverInput {
    readonly loaded: LoadedJsapiV4;
    readonly unsupported: UnsupportedBehavior;
    readonly capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
export declare type BMapEngine = "jsapi-v4";
declare class BMapError extends Error {
    readonly code: BMapErrorCode;
    readonly mapId?: symbol | string;
    readonly component?: string;
    readonly plugin?: string;
    constructor(code: BMapErrorCode, message: string, options?: BMapErrorOptions);
    toJSON(): {
        name: string;
        code: BMapErrorCode;
        message: string;
        cause: unknown;
        mapId: string | undefined;
        component: string | undefined;
        plugin: string | undefined;
    };
    get retryable(): boolean;
    static readonly codes: {
        SDK_LOAD_FAILED: "BMAP_SDK_LOAD_FAILED";
        SDK_LOAD_TIMEOUT: "BMAP_SDK_LOAD_TIMEOUT";
        SDK_CONFIG_CONFLICT: "BMAP_SDK_CONFIG_CONFLICT";
        SDK_ENGINE_MISMATCH: "BMAP_SDK_ENGINE_MISMATCH";
        PROVIDER_ABORTED: "BMAP_PROVIDER_ABORTED";
        RUNTIME_DISPOSED: "BMAP_RUNTIME_DISPOSED";
        RESOURCE_DISPOSED: "BMAP_RESOURCE_DISPOSED";
        PARENT_CONTEXT_MISSING: "BMAP_PARENT_CONTEXT_MISSING";
        RESOURCE_CREATE_FAILED: "BMAP_RESOURCE_CREATE_FAILED";
        RESOURCE_UPDATE_FAILED: "BMAP_RESOURCE_UPDATE_FAILED";
        PLUGIN_LOAD_FAILED: "BMAP_PLUGIN_LOAD_FAILED";
        PLUGIN_UNKNOWN: "BMAP_PLUGIN_UNKNOWN";
        CAPABILITY_UNSUPPORTED: "BMAP_CAPABILITY_UNSUPPORTED";
        SDK_CALL_FAILED: "BMAP_SDK_CALL_FAILED";
        SERVICE_FAILED: "BMAP_SERVICE_FAILED";
        INVALID_ARGUMENT: "BMAP_INVALID_ARGUMENT";
        INVALID_POINT: "BMAP_INVALID_POINT";
        HANDLE_FOREIGN: "BMAP_HANDLE_FOREIGN";
        DUPLICATE_ITEM_KEY: "BMAP_DUPLICATE_ITEM_KEY";
        UI_KIT_UNAVAILABLE: "BMAP_UI_KIT_UNAVAILABLE";
    };
}
declare type BMapErrorCode = "BMAP_SDK_LOAD_FAILED" | "BMAP_SDK_LOAD_TIMEOUT" | "BMAP_SDK_CONFIG_CONFLICT" | "BMAP_SDK_ENGINE_MISMATCH" | "BMAP_PROVIDER_ABORTED" | "BMAP_RUNTIME_DISPOSED" | "BMAP_RESOURCE_DISPOSED" | "BMAP_PARENT_CONTEXT_MISSING" | "BMAP_RESOURCE_CREATE_FAILED" | "BMAP_RESOURCE_UPDATE_FAILED" | "BMAP_PLUGIN_LOAD_FAILED" | "BMAP_PLUGIN_UNKNOWN" | "BMAP_CAPABILITY_UNSUPPORTED" | "BMAP_SDK_CALL_FAILED" | "BMAP_SERVICE_FAILED" | "BMAP_INVALID_ARGUMENT" | "BMAP_INVALID_POINT" | "BMAP_HANDLE_FOREIGN" | "BMAP_DUPLICATE_ITEM_KEY" | "BMAP_UI_KIT_UNAVAILABLE";
declare interface BMapErrorOptions {
    cause?: unknown;
    mapId?: symbol | string;
    component?: string;
    plugin?: string;
    capability?: string;
    engine?: string;
    version?: string;
}
declare type BMapLoadOptions = {
    ak?: string;
    apiUrl?: string;
    version?: string;
    language?: string;
    timeout?: number;
    serviceHost?: string;
    nonce?: string;
    integrity?: string;
    crossOrigin?: CrossOriginValue;
    referrerPolicy?: ReferrerPolicy;
    callbackParam?: string;
};
export declare interface BMapProviderLike {
    readonly id?: string;
    getCacheKey?(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
declare interface BoundaryRequest {
    name: string;
}
declare interface BoundaryRings {
    readonly raw: readonly string[];
    readonly rings: readonly (readonly Point[])[];
}
export declare interface Bounds {
    southwest: Point;
    northeast: Point;
}
export declare type Capability = "map.view-state" | "map.zoom" | "map.center-and-zoom" | "map.bounds" | "map.viewport" | "map.heading" | "map.tilt" | "map.fly-to" | "map.animate" | "map.screenshot" | "map.check-resize" | "map.pixel-conversion" | "map.style" | "map.destroy" | "overlay.marker" | "overlay.label" | "overlay.info-window" | "overlay.circle" | "overlay.polyline" | "overlay.polygon" | "overlay.rectangle" | "overlay.custom-dom" | "overlay.ground" | "overlay.point-collection" | "overlay.context-menu" | "overlay.prism" | "overlay.bezier-curve" | "overlay.marker-3d" | "overlay.mapvgl" | "layer.tile" | "layer.traffic" | "layer.geojson" | "layer.point-icon" | "layer.point-shape" | "layer.district" | "layer.panorama-coverage" | "layer.line" | "layer.fill" | "layer.dom" | "layer.xyz" | "layer.wms" | "layer.wmts" | "layer.raster" | "layer.mvt" | "layer.cluster" | "layer.point" | "layer.heatmap" | "layer.track-line" | "service.local-search" | "service.autocomplete" | "service.driving-route" | "service.walking-route" | "service.riding-route" | "service.transit-route" | "service.geocoder" | "service.geolocation" | "service.local-city" | "service.boundary" | "service.convertor" | "service.track-animation" | "panorama.viewer" | "panorama.service" | "panorama.label";
export declare const CAPABILITY_CATALOG: Record<Capability, CapabilityDescriptor>;
export declare const CAPABILITY_FAMILIES: readonly CapabilityFamily[];
export declare const CAPABILITY_IDS: readonly Capability[];
export declare const CAPABILITY_STATUSES: readonly CapabilityStatus[];
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
export declare interface ControlOptions {
    anchor?: string;
    offset?: Pixel;
    [key: string]: unknown;
}
declare type ControlOptionStatus = "mutable" | "recreate" | "unsupported";
declare interface ConvertorRequest {
    points: readonly Point[];
    from: CoordinateFromType;
    to: CoordinateToType;
}
declare type CoordinateFromType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
declare type CoordinateToType = 3 | 5 | 6;
export declare interface CopyrightEntry {
    id: number;
    content: string;
    bounds?: unknown;
}
export declare function createBMapClient(options: CreateBMapClientOptions, signal?: AbortSignal): Promise<BMapClient>;
export declare function createBMapClientDefinition(options: CreateBMapClientOptions): CreateBMapClientOptions;
export declare interface CreateBMapClientOptions {
    provider: BMapProviderLike;
    loadOptions: BMapLoadOptions;
    driver?: BMapDriverFactory;
    unsupported?: UnsupportedBehavior;
    capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
export declare function createCapabilityRegistry(options: CreateCapabilityRegistryOptions): CapabilityRegistry;
declare interface CreateCapabilityRegistryOptions {
    engine: BMapEngine;
    version: string;
    rawSdk: unknown;
    unsupported?: UnsupportedBehavior;
    overrides?: Partial<Record<Capability, boolean>>;
}
export declare function createHandle<Kind extends string, Raw>(kind: Kind, raw: Raw): SdkHandle<Kind, Raw>;
export declare function createJsapiV4Driver(input: CreateJsapiV4DriverInput): JsapiV4Driver;
export declare interface CreateJsapiV4DriverInput {
    rawSdk: unknown;
    version: string;
    unsupported: UnsupportedBehavior;
    capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
export declare function createLoadedJsapiV4(input: CreateLoadedJsapiV4Input): LoadedJsapiV4;
export declare interface CreateLoadedJsapiV4Input {
    readonly providerId: JsapiV4ProviderId;
    readonly mode: JsapiV4LoadMode;
    readonly version: string;
    readonly versionSource: JsapiV4VersionSource;
    readonly options: BMapLoadOptions;
    readonly fingerprint: string;
    readonly namespace: unknown;
    readonly apiUrl?: string;
    readonly loadedAt?: number;
}
declare type CrossOriginValue = "anonymous" | "use-credentials";
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
export declare const customScriptV4Provider: (scriptSrc: string, options?: CustomScriptV4ProviderOptions) => JsapiV4Provider;
export declare interface CustomScriptV4ProviderOptions {
    mode?: JsapiV4ScriptMode;
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
declare type DrivingRouteEndpoint = Point | RouteEndpointPoi;
declare interface DrivingRouteOptions extends RouteState {
    policy?: DrivingPolicy_2;
}
declare interface DrivingRouteRequest {
    start: DrivingRouteEndpoint;
    end: DrivingRouteEndpoint;
    waypoints?: readonly Point[];
}
declare type DrivingRouteResult = RouteResult<RoutePlan>;
export declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
export declare const existingGlobalV4Provider: () => JsapiV4Provider;
declare interface GeocodedAddress {
    address: string;
    point: Point | null;
    business: string | null;
    addressComponents: GeocodedAddressComponents;
    surroundingPois: readonly LocalSearchPoi[];
    poiCount: number;
}
declare interface GeocodedAddressComponents {
    province: string | null;
    city: string | null;
    district: string | null;
    street: string | null;
    streetNumber: string | null;
}
declare interface GeocodeRequest {
    address: string;
    city?: string;
}
declare interface GeolocationAddressInfo {
    country?: string;
    province?: string;
    city?: string;
    cityCode?: string | number;
    district?: string;
    street?: string;
    streetNumber?: string;
}
declare interface GeolocationFix {
    point: Point;
    accuracy: number | null;
    address: GeolocationAddressInfo | null;
}
declare interface GeolocationOptions {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
    SDKLocation?: boolean;
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
export declare const HANDLE_BRAND: unique symbol;
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
export declare function isLoadedSdk(value: unknown): value is LoadedJsapiV4;
export declare function isPointLike(value: unknown): value is Point;
declare interface JsapiV4Driver extends BMapDriver {
    readonly services: JsapiV4ServiceDriver;
    readonly panorama: PanoramaViewerDriver;
    readonly nativeLayers: NativeLayerDriver;
}
export declare const jsapiV4DriverFactory: BMapDriverFactory;
declare type JsapiV4Engine = "jsapi-v4";
declare interface JsapiV4LoadMetadata {
    readonly providerId: JsapiV4ProviderId;
    readonly domain: string;
    readonly mode: JsapiV4LoadMode;
    readonly versionSource: JsapiV4VersionSource;
    readonly apiUrl: string;
    readonly akRef: string;
    readonly fingerprint: string;
    readonly loadedAt: number;
}
declare type JsapiV4LoadMode = JsapiV4ScriptMode | "existing-global";
declare interface JsapiV4Namespace {
    readonly Map: unknown;
    readonly Point: unknown;
    readonly Marker: unknown;
    readonly [member: string]: unknown;
}
export declare interface JsapiV4Provider {
    readonly id: JsapiV4ProviderId;
    getCacheKey(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
declare type JsapiV4ProviderId = "baidu-jsapi-v4" | "existing-global-v4" | "custom-script-v4";
export declare type JsapiV4ScriptMode = "load" | "jsonp";
declare interface JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver {
    disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">): void;
    clearLocalSearch(handle: ServiceHandle<"service:local-search">): void;
    disposeLocalSearch(handle: ServiceHandle<"service:local-search">): void;
}
declare type JsapiV4VersionSource = "url" | "global" | "declared";
export declare type LabelHandle = SdkHandle<"overlay:label">;
export declare interface LabelOptions {
    position?: Point;
    offset?: Pixel;
    zIndex?: number;
    style?: Record<string, unknown>;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
declare interface LayerCreateOptions extends Record<string, unknown> {
    layerName?: string;
    createDOM?: (properties: object, point: {
        lng: number;
        lat: number;
    }) => HTMLElement;
}
declare type LayerCtorSlot = "opacity" | "minZoom" | "maxZoom" | "zIndex" | "data";
declare type LayerData = object;
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
declare type LayerOperation = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
declare interface LayerSurface {
    readonly ctorSlots: readonly LayerCtorSlot[];
    readonly operations: readonly LayerOperation[];
}
export declare interface LoadedJsapiV4 {
    readonly engine: JsapiV4Engine;
    readonly version: string;
    readonly namespace: JsapiV4Namespace;
    readonly load: JsapiV4LoadMetadata;
}
declare interface LocalCityFix {
    name: string;
    center: Point | null;
    level: number | null;
}
declare type LocalSearchBounds = Bounds;
declare interface LocalSearchInBoundsRequest {
    keyword: LocalSearchKeyword;
    bounds: LocalSearchBounds;
}
declare type LocalSearchKeyword = string | readonly string[];
declare interface LocalSearchNearbyRequest {
    keyword: LocalSearchKeyword;
    center: string | Point;
    radius: number;
}
declare interface LocalSearchOptions {
    renderOptions?: LocalSearchRenderOptions;
    pageCapacity?: number;
    pageNum?: number;
}
declare interface LocalSearchPoi {
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
declare interface LocalSearchRenderOptions {
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
declare interface LocalSearchResult {
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
declare interface LocalSearchSearchOption {
    forceLocal?: boolean;
}
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
export declare type MapHandle = SdkHandle<"map">;
export declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
export declare interface MapMouseEvent extends DriverEvent {
    point: Point;
}
export declare type MapStyleInput = {
    styleId: string;
} | Record<string, unknown>;
declare type MapType_2 = "normal" | "satellite" | "earth";
export { MapType_2 as MapType };
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
declare type NativeLayerData = Record<string, unknown>;
declare interface NativeLayerDriver {
    create(kind: NativeLayerKind, options?: Record<string, unknown>): NativeLayerHandle;
    add(target: OverlayTarget, layer: NativeLayerHandle): void;
    remove(target: OverlayTarget, layer: NativeLayerHandle): void;
    supports(kind: NativeLayerKind, operation: NativeLayerOperation): boolean;
    setData(layer: NativeLayerHandle, data: NativeLayerData): void;
    clearData(layer: NativeLayerHandle): void;
    setStyle(layer: NativeLayerHandle, style: Record<string, unknown>): void;
    setVisible(layer: NativeLayerHandle, visible: boolean): void;
    setOpacity(layer: NativeLayerHandle, opacity: number): void;
    setZIndex(layer: NativeLayerHandle, zIndex: number): void;
    setZoomRange(layer: NativeLayerHandle, range: NativeLayerZoomRange): void;
    updateState(layer: NativeLayerHandle, keys: NativeLayerFeatureKeys, state: NativeLayerFeatureState, append?: boolean): void;
    removeState(layer: NativeLayerHandle, keys: NativeLayerFeatureKeys): void;
    clearState(layer: NativeLayerHandle): void;
    replaceState(layer: NativeLayerHandle, inputs: NativeLayerFeatureStateMap): void;
    getState(layer: NativeLayerHandle): NativeLayerFeatureStateMap;
    setEnablePicked(layer: NativeLayerHandle, enabled: boolean): void;
    hitTest(layer: NativeLayerHandle, pixel: Pixel): NativeLayerPick | null;
    start(layer: NativeLayerHandle): void;
    pause(layer: NativeLayerHandle): void;
    resume(layer: NativeLayerHandle): void;
    stop(layer: NativeLayerHandle): void;
    setSpeed(layer: NativeLayerHandle, speed: number): void;
    setProcess(layer: NativeLayerHandle, process: number): void;
}
declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureState = Record<string, unknown>;
declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
declare type NativeLayerHandle = SdkHandle<"native-layer" | `native-layer:${string}`>;
declare type NativeLayerKind = "point" | "cluster" | "point-icon" | "point-shape" | "line" | "fill" | "heatmap" | "track-line";
declare type NativeLayerOperation = "setData" | "clearData" | "setStyle" | "setVisible" | "setOpacity" | "setZIndex" | "setZoomRange" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState" | "setEnablePicked" | "hitTest" | "start" | "pause" | "resume" | "stop" | "setSpeed" | "setProcess";
declare interface NativeLayerPick {
    dataIndex: number;
    dataItem: unknown;
}
declare interface NativeLayerZoomRange {
    min?: number;
    max?: number;
}
declare interface NormalizedProvider {
    readonly id: string;
    getCacheKey(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
export declare function normalizeMapMouseEvent(raw: unknown, geometry: GeometryDriver): MapMouseEvent;
export declare function normalizeProvider(provider: BMapProviderLike): NormalizedProvider;
declare const OFFICIAL_V4_VERSION = "4.0";
export declare interface OfficialJsapiLoader {
    load(options: OfficialJsapiLoadOptions): Promise<unknown>;
}
export declare interface OfficialJsapiLoadOptions {
    readonly ak?: string;
    readonly version: OfficialJsapiV4Version;
    readonly timeout: number;
    readonly serviceHost?: string;
}
declare type OfficialJsapiV4Version = typeof OFFICIAL_V4_VERSION;
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
export declare type OverlayKind = "marker" | "polyline" | "polygon" | "rectangle" | "circle" | "info-window" | "label" | "prism" | "marker3d" | "bezier-curve" | "custom-overlay" | "map-mask" | "ground-overlay" | "context-menu";
export declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
export declare interface OverlayTarget {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle<string>;
}
declare interface PanoramaDataInfo {
    id: string;
    description: string;
    position: Point | null;
}
export declare interface PanoramaDriver {
    readonly supported: boolean;
}
declare type PanoramaHandle = SdkHandle<"panorama">;
declare type PanoramaLabelHandle = SdkHandle<"panorama:label">;
declare interface PanoramaLabelOptions {
    position?: Point;
    altitude?: number;
    displayDistance?: boolean;
}
declare interface PanoramaOptions {
    navigationControl?: boolean;
    linksControl?: boolean;
    indoorSceneSwitchControl?: boolean;
    albumsControl?: boolean;
    albumsControlOptions?: Record<string, unknown>;
}
declare type PanoramaPoiType = "hotel" | "catering" | "movie" | "transit" | "indoor_scene" | "none";
declare interface PanoramaPov {
    heading: number;
    pitch?: number;
}
declare type PanoramaSceneType = "street" | "inter";
declare type PanoramaServiceHandle = SdkHandle<"service:panorama">;
declare interface PanoramaSwitchOptions {
    animation?: boolean;
    fisheye?: boolean;
    animationType?: string;
    pov?: Partial<PanoramaPov>;
}
declare interface PanoramaViewerDriver extends PanoramaDriver {
    create(container: string | HTMLElement, options?: PanoramaOptions): PanoramaHandle;
    destroy(viewer: PanoramaHandle): void;
    on(target: PanoramaHandle | PanoramaLabelHandle, type: string, listener: (event: unknown) => void): () => void;
    getPosition(viewer: PanoramaHandle): Point | null;
    getPov(viewer: PanoramaHandle): PanoramaPov | null;
    getZoom(viewer: PanoramaHandle): number | null;
    getId(viewer: PanoramaHandle): string | null;
    getSceneType(viewer: PanoramaHandle): PanoramaSceneType | null;
    getVisible(viewer: PanoramaHandle): boolean;
    setId(viewer: PanoramaHandle, id: string, options?: PanoramaSwitchOptions): void;
    setPosition(viewer: PanoramaHandle, position: Point): void;
    setPov(viewer: PanoramaHandle, pov: PanoramaPov, options?: {
        animation?: boolean;
    }): void;
    setZoom(viewer: PanoramaHandle, zoom: number, options?: {
        noAnimation?: boolean;
    }): void;
    setOptions(viewer: PanoramaHandle, options: PanoramaOptions): void;
    setPanoramaPoiType(viewer: PanoramaHandle, poiType: PanoramaPoiType): void;
    enableScrollWheelZoom(viewer: PanoramaHandle): void;
    disableScrollWheelZoom(viewer: PanoramaHandle): void;
    show(viewer: PanoramaHandle): void;
    hide(viewer: PanoramaHandle): void;
    createLabel(content: string, options?: PanoramaLabelOptions): PanoramaLabelHandle;
    addLabel(viewer: PanoramaHandle, label: PanoramaLabelHandle): void;
    removeLabel(viewer: PanoramaHandle, label: PanoramaLabelHandle): void;
    setLabelPosition(label: PanoramaLabelHandle, position: Point): void;
    setLabelContent(label: PanoramaLabelHandle, content: string): void;
    setLabelAltitude(label: PanoramaLabelHandle, altitude: number): void;
    createService(): PanoramaServiceHandle;
    findById(service: PanoramaServiceHandle, id: string): ServiceCall<PanoramaDataInfo>;
    findByLocation(service: PanoramaServiceHandle, position: Point, radius?: number): ServiceCall<PanoramaDataInfo>;
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
export declare type PointInput = Point | readonly [
    lng: number,
    lat: number
];
export declare type PolygonHandle = SdkHandle<"overlay:polygon">;
export declare type PolylineHandle = SdkHandle<"overlay:polyline">;
declare interface ReverseGeocodeRequest {
    point: Point;
    poiRadius?: number;
    numPois?: number;
}
declare type RidingRouteOptions = RouteRenderState;
declare type RidingRouteResult = RouteResult<RoutePlan>;
declare type RouteEndpoint = string | Point | RouteEndpointPoi;
declare interface RouteEndpointInfo {
    title: string;
    point: Point | null;
    uid: string;
}
declare interface RouteEndpointPoi {
    uid: string;
    point: Point;
    name?: string;
}
declare interface RouteLeg {
    index: number;
    planIndex: number | null;
    routeType: number | null;
    distance: number | null;
    distanceText: string | null;
    path: readonly Point[];
    steps: readonly RouteStep[];
}
declare interface RoutePlan {
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
declare interface RouteRenderOptions {
    map?: MapHandle;
    panel?: string | HTMLElement;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
declare interface RouteRenderState {
    renderOptions?: RouteRenderOptions;
}
declare interface RouteRequest {
    start: RouteEndpoint;
    end: RouteEndpoint;
}
declare interface RouteResult<TPlan> {
    start: RouteEndpointInfo | null;
    end: RouteEndpointInfo | null;
    plans: readonly TPlan[];
    policy: number | null;
    transitType: number | null;
}
declare type RouteServiceHandle = ServiceHandle<RouteServiceKind>;
declare type RouteServiceKind = "service:driving-route" | "service:walking-route" | "service:riding-route" | "service:transit-route";
declare interface RouteState extends RouteRenderState {
    enableTraffic?: boolean;
}
declare interface RouteStep {
    index: number;
    position: Point | null;
    description: string | null;
    distance: number | null;
    distanceText: string | null;
    routeIndex: number | null;
    planIndex: number | null;
}
declare interface RouteTaxiFare {
    day: RouteTaxiFareDetail | null;
    night: RouteTaxiFareDetail | null;
    distance: number | null;
    remark: string | null;
}
declare interface RouteTaxiFareDetail {
    initialFare: number | null;
    unitFare: number | null;
    totalFare: number | null;
}
export declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
declare interface ServiceCall<T> {
    readonly result: Promise<ServiceResult<T>>;
    cancel(): void;
}
declare type ServiceCallStatus = "success" | "empty" | "failed" | "timeout" | "canceled";
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
declare interface ServiceErrorInfo {
    code: number | string | null;
    message: string;
}
export declare type ServiceHandle<Kind extends string = "service"> = SdkHandle<Kind>;
declare interface ServiceInvocationDriver {
    geocode(handle: ServiceHandle<"service:geocoder">, request: GeocodeRequest): ServiceCall<Point>;
    reverseGeocode(handle: ServiceHandle<"service:geocoder">, request: ReverseGeocodeRequest): ServiceCall<GeocodedAddress>;
    convert(handle: ServiceHandle<"service:convertor">, request: ConvertorRequest): ServiceCall<Point[]>;
    queryBoundary(handle: ServiceHandle<"service:boundary">, request: BoundaryRequest): ServiceCall<BoundaryRings>;
    locate(handle: ServiceHandle<"service:geolocation">, options?: GeolocationOptions): ServiceCall<GeolocationFix>;
    locateCity(handle: ServiceHandle<"service:local-city">): ServiceCall<LocalCityFix>;
    search(handle: ServiceHandle<"service:local-search">, keyword: LocalSearchKeyword, option?: LocalSearchSearchOption): ServiceCall<LocalSearchResult[]>;
    searchNearby(handle: ServiceHandle<"service:local-search">, request: LocalSearchNearbyRequest): ServiceCall<LocalSearchResult[]>;
    searchInBounds(handle: ServiceHandle<"service:local-search">, request: LocalSearchInBoundsRequest): ServiceCall<LocalSearchResult[]>;
    gotoPage(handle: ServiceHandle<"service:local-search">, page: number): ServiceCall<LocalSearchResult[]>;
    searchDrivingRoute(handle: ServiceHandle<"service:driving-route">, request: DrivingRouteRequest): ServiceCall<DrivingRouteResult>;
    searchWalkingRoute(handle: ServiceHandle<"service:walking-route">, request: RouteRequest): ServiceCall<WalkingRouteResult>;
    searchRidingRoute(handle: ServiceHandle<"service:riding-route">, request: RouteRequest): ServiceCall<RidingRouteResult>;
    searchTransitRoute(handle: ServiceHandle<"service:transit-route">, request: TransitRouteRequest): ServiceCall<TransitRouteResult>;
    clearRouteResults(handle: RouteServiceHandle): void;
    disposeRoute(handle: RouteServiceHandle): void;
}
declare interface ServiceResult<T> {
    readonly status: ServiceCallStatus;
    readonly data: T | null;
    readonly error: ServiceErrorInfo | null;
    readonly sdkStatus: number | null;
}
export declare interface Size {
    width: number;
    height: number;
}
export declare function toPlainPoint(raw: {
    lng: number;
    lat: number;
}): Point;
export declare function toPlainPoints(raw: readonly {
    lng: number;
    lat: number;
}[]): Point[];
export declare function toPoint(input: PointInput): Point;
declare interface TransitLineSegment {
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
declare interface TransitRouteOptions extends RouteState {
    policy?: TransitPolicy_2;
    intercityPolicy?: IntercityPolicy_2;
    transitTypePolicy?: TransitVehiclePolicy;
    pageCapacity?: number;
}
declare interface TransitRoutePlan {
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
declare type TransitRouteRequest = RouteRequest;
declare type TransitRouteResult = RouteResult<TransitRoutePlan>;
declare type TransitRouteSegment = TransitLineSegment | TransitWalkSegment;
declare const TransitVehiclePolicy: {
    readonly TRAIN: 0;
    readonly AIRPLANE: 1;
    readonly COACH: 2;
};
declare type TransitVehiclePolicy = (typeof TransitVehiclePolicy)[keyof typeof TransitVehiclePolicy];
declare interface TransitWalkSegment {
    kind: "walk";
    leg: RouteLeg;
}
export declare type UnsupportedBehavior = "throw" | "warn" | "silent";
export declare class UnsupportedCapabilityError extends BMapError {
    readonly capability: Capability;
    readonly engine: BMapEngine;
    readonly version: string;
    constructor(capability: Capability, engine: BMapEngine, version: string);
}
export declare function unwrapRaw<T = unknown>(handle: SdkHandle<string>): T;
declare type ViewAnimationCancelOutcome = "canceled" | "deferred" | "already-settled";
declare type WalkingRouteOptions = RouteRenderState;
declare type WalkingRouteResult = RouteResult<RoutePlan>;
export {};
```
