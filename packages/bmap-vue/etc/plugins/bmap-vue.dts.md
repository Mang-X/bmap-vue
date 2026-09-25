## API Signature Baseline for "bmap-vue" (entry `./plugins`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/plugins.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> API Extractor 分析不了这两个出口的 Volar `__VLS_` 悬空引用，
> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。

```ts
import { App } from "vue";
import { InjectionKey } from "vue";
declare interface AutocompleteOptions {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
declare interface BMapClient {
    readonly id: symbol;
    readonly engine: BMapEngine;
    readonly libraryVersion: string;
    readonly sdkVersion: string;
    readonly driver: BMapDriver;
    readonly capabilities: CapabilityRegistry;
    readonly rawSdk: unknown;
}
export declare const bmapConfigKey: InjectionKey<BMapPluginConfig>;
declare interface BMapDriver {
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
declare type BMapDriverFactory = (input: BMapDriverInput) => BMapDriver;
declare interface BMapDriverInput {
    readonly loaded: LoadedJsapiV4;
    readonly unsupported: UnsupportedBehavior;
    readonly capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
declare type BMapEngine = "jsapi-v4";
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
export declare interface BMapPluginConfig {
    provider: BMapProviderLike;
    defaults: BMapLoadOptions;
}
export declare interface BMapPluginDefinition<Resource = unknown> {
    readonly name: string;
    readonly scope?: PluginScope;
    readonly dependencies?: readonly string[];
    readonly required?: boolean;
    load(context: PluginContext, signal: AbortSignal): Promise<Resource>;
    setup?(resource: Resource, runtime: unknown): void | Disposer;
    dispose?(resource: Resource, runtime: unknown): void;
}
declare interface BMapProviderLike {
    readonly id?: string;
    getCacheKey?(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
declare interface Bounds {
    southwest: Point;
    northeast: Point;
}
export declare const BUILTIN_PLUGIN_CATALOG: Readonly<Record<BuiltinPluginName, PluginCatalogEntry>>;
export declare const BUILTIN_PLUGIN_NAMES: readonly BuiltinPluginName[];
export declare const BUILTIN_PLUGIN_URLS: {
    readonly trackAnimation: "https://mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js";
    readonly drawingManager: "https://mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js";
    readonly geoUtils: "https://mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js";
    readonly mapvgl: "https://unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js";
};
export declare type BuiltinPluginName = "TrackAnimation" | "DrawingManager" | "GeoUtils" | "Mapvgl";
declare type Capability = "map.view-state" | "map.zoom" | "map.center-and-zoom" | "map.bounds" | "map.viewport" | "map.heading" | "map.tilt" | "map.fly-to" | "map.animate" | "map.screenshot" | "map.check-resize" | "map.pixel-conversion" | "map.style" | "map.destroy" | "overlay.marker" | "overlay.label" | "overlay.info-window" | "overlay.circle" | "overlay.polyline" | "overlay.polygon" | "overlay.rectangle" | "overlay.custom-dom" | "overlay.ground" | "overlay.point-collection" | "overlay.context-menu" | "overlay.prism" | "overlay.bezier-curve" | "overlay.marker-3d" | "overlay.mapvgl" | "layer.tile" | "layer.traffic" | "layer.geojson" | "layer.point-icon" | "layer.point-shape" | "layer.district" | "layer.panorama-coverage" | "layer.line" | "layer.fill" | "layer.dom" | "layer.xyz" | "layer.wms" | "layer.wmts" | "layer.raster" | "layer.mvt" | "layer.cluster" | "layer.point" | "layer.heatmap" | "layer.track-line" | "service.local-search" | "service.autocomplete" | "service.driving-route" | "service.walking-route" | "service.riding-route" | "service.transit-route" | "service.geocoder" | "service.geolocation" | "service.local-city" | "service.boundary" | "service.convertor" | "service.track-animation" | "panorama.viewer" | "panorama.service" | "panorama.label";
declare interface CapabilityDescriptor {
    id: Capability;
    family: CapabilityFamily;
    description: string;
    rawMembers?: readonly string[];
    status: CapabilityStatus;
    runtimeOnly: boolean;
}
declare interface CapabilityExplanation {
    id: Capability;
    supported: boolean;
    reason: CapabilityReason;
    engine: BMapEngine;
    version: string;
    family?: CapabilityFamily;
    status: CapabilityStatus;
    runtimeOnly: boolean;
}
declare type CapabilityFamily = "map" | "overlay" | "layer" | "service" | "panorama";
declare type CapabilityReason = "supported" | "unlisted-capability" | "raw-member-missing" | "status-unsupported" | "overridden";
declare interface CapabilityRegistry {
    supports(capability: Capability): boolean;
    require(capability: Capability): void;
    list(): readonly Capability[];
    explain(capability: Capability): CapabilityExplanation;
    descriptor(capability: Capability): CapabilityDescriptor | undefined;
    observeInstanceMembers(source: unknown): void;
}
declare type CapabilityStatus = "native" | "extended" | "experimental" | "unsupported";
declare type CircleHandle = SdkHandle<"overlay:circle">;
declare interface ControlDriver {
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
declare type ControlHandle = SdkHandle<"control" | `control:${string}`>;
declare type ControlKind = "zoom" | "scale" | "navigation" | "navigation-3d" | "city-list" | "location" | "map-type" | "overview" | "panorama" | "copyright" | "custom";
declare interface ControlOptions {
    anchor?: string;
    offset?: Pixel;
    [key: string]: unknown;
}
declare type ControlOptionStatus = "mutable" | "recreate" | "unsupported";
declare interface CopyrightEntry {
    id: number;
    content: string;
    bounds?: unknown;
}
declare interface CreateBMapClientOptions {
    provider: BMapProviderLike;
    loadOptions: BMapLoadOptions;
    driver?: BMapDriverFactory;
    unsupported?: UnsupportedBehavior;
    capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
export declare function createBMapPlugin(options?: CreateBMapPluginOptions): {
    install(app: App): void;
    version: string;
    config: BMapPluginConfig;
};
export declare interface CreateBMapPluginOptions {
    provider?: BMapProviderLike;
    ak?: string;
    apiUrl?: string;
    version?: string;
    plugins?: string[];
    defaults?: Partial<BMapLoadOptions>;
    client?: CreateBMapClientOptions;
}
export declare function createPluginHost(label?: string): PluginHost;
declare type CrossOriginValue = "anonymous" | "use-credentials";
declare interface CustomOverlayOptions {
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
export declare function disposeDefaultPluginHost(): void;
declare type Disposer = () => void;
export declare function drawingManagerPlugin(): BMapPluginDefinition<unknown>;
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
declare interface DrivingRouteOptions extends RouteState {
    policy?: DrivingPolicy_2;
}
declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
declare interface GeometryDriver {
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
export declare function geoUtilsPlugin(): BMapPluginDefinition<unknown>;
export declare function getDefaultPluginHost(): PluginHost;
declare const HANDLE_BRAND: unique symbol;
declare type InfoWindowHandle = SdkHandle<"overlay:info-window">;
declare interface InfoWindowOptions {
    width?: number;
    height?: number;
    title?: string;
    offset?: Pixel;
    enableMaximize?: boolean;
    enableAutoPan?: boolean;
    enableCloseOnClick?: boolean;
    [key: string]: unknown;
}
declare interface InitialMapOptions {
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
declare type JsapiV4ProviderId = "baidu-jsapi-v4" | "existing-global-v4" | "custom-script-v4";
declare type JsapiV4ScriptMode = "load" | "jsonp";
declare type JsapiV4VersionSource = "url" | "global" | "declared";
declare type LabelHandle = SdkHandle<"overlay:label">;
declare interface LabelOptions {
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
declare interface LayerDriver {
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
declare type LayerHandle = SdkHandle<"layer" | `layer:${string}`>;
declare type LayerKind = "district" | "panorama-coverage" | "tile" | "traffic" | "geojson" | "dom" | "xyz" | "wms" | "wmts" | "raster" | "mvt";
declare type LayerOperation = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
declare interface LayerSurface {
    readonly ctorSlots: readonly LayerCtorSlot[];
    readonly operations: readonly LayerOperation[];
}
declare interface LoadedJsapiV4 {
    readonly engine: JsapiV4Engine;
    readonly version: string;
    readonly namespace: JsapiV4Namespace;
    readonly load: JsapiV4LoadMetadata;
}
declare interface LocalSearchOptions {
    renderOptions?: LocalSearchRenderOptions;
    pageCapacity?: number;
    pageNum?: number;
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
declare interface MapDriver {
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
declare type MapHandle = SdkHandle<"map">;
declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
declare type MapStyleInput = {
    styleId: string;
} | Record<string, unknown>;
declare type MapType_2 = "normal" | "satellite" | "earth";
export declare function mapVglPlugin(): BMapPluginDefinition<unknown>;
declare interface MapView {
    center: Point | string;
    zoom: number;
    heading?: number;
    tilt?: number;
}
declare type MarkerHandle = SdkHandle<"overlay:marker">;
declare type MarkerIconInput = string | {
    imageUrl: string;
    size: Size;
    anchor?: Pixel;
    imageOffset?: Pixel;
    imageSize?: Size;
    printImageUrl?: string;
};
declare interface MarkerOptions {
    offset?: Pixel;
    title?: string;
    icon?: MarkerIconInput;
    zIndex?: number;
    rotation?: number;
    enableClicking?: boolean;
    enableDragging?: boolean;
    [key: string]: unknown;
}
declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureState = Record<string, unknown>;
declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
declare interface OverlayDriver {
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
declare type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
declare interface OverlayTarget {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle<string>;
}
declare interface PanoramaDriver {
    readonly supported: boolean;
}
declare interface PathOptions {
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
declare interface Pixel {
    x: number;
    y: number;
}
export declare const PLUGIN_COMPAT_BY_ID: Readonly<Record<BuiltinPluginName, PluginCompatEntry>>;
export declare const PLUGIN_COMPAT_INVENTORY: readonly PluginCompatEntry[];
export declare const PLUGIN_EVIDENCE_BASIS_MEANING: Record<PluginEvidenceBasis, string>;
export declare const PLUGIN_VERDICT_MEANING: Record<PluginVerdict, string>;
export declare const PLUGIN_VERDICTS: readonly PluginVerdict[];
export declare interface PluginCatalogEntry {
    readonly name: BuiltinPluginName;
    readonly create: () => BMapPluginDefinition<unknown>;
}
export declare interface PluginCompatEntry {
    readonly id: BuiltinPluginName;
    readonly urlKey: PluginUrlKey;
    readonly exposedGlobal: string;
    readonly required: false;
    readonly versionLock: PluginVersionLock;
    readonly artifactDigest: {
        readonly algo: "sha256";
        readonly value: string;
    };
    readonly sdkNamespaceMembers: readonly string[];
    readonly hasPrivateSurface: boolean;
    readonly privateSurfaceNote: string;
    readonly manualInstanceChecks: readonly string[];
    readonly selfInjectedMarkers: readonly string[];
    readonly capability?: Capability;
    readonly verdict: PluginVerdict;
    readonly migrationPath: PluginMigrationPath;
    readonly basis: readonly PluginEvidenceBasis[];
    readonly runtime?: PluginRuntimeReading;
    readonly summary: string;
    readonly residualRisks: readonly string[];
}
declare interface PluginContext {
    readonly client: BMapClient | null;
    readonly map: MapHandle | null;
    readonly api: unknown;
}
export declare type PluginEvidenceBasis = "artifact" | "declaration" | "runtime";
export declare interface PluginHost {
    acquire(name: string, definition: BMapPluginDefinition<unknown>, context: PluginContext, signal?: AbortSignal): Promise<unknown>;
    inspect(name: string): PluginHostEntryInspection | undefined;
    dispose(): void;
}
export declare interface PluginHostEntryInspection {
    readonly name: string;
    readonly status: PluginHostEntryStatus;
    readonly attempts: number;
    readonly consumers: number;
}
declare type PluginHostEntryStatus = "loading" | "ready";
export declare interface PluginMigrationPath {
    readonly kind: "native" | "plugin" | "none";
    readonly target: string;
    readonly nativeComponent?: string;
    readonly note: string;
}
export declare interface PluginRuntimeReading {
    readonly status: "verified" | "threw";
    readonly detail: string;
    readonly covered: readonly string[];
    readonly uncovered: readonly string[];
}
declare type PluginScope = "global" | "map";
declare type PluginUrlKey = "trackAnimation" | "drawingManager" | "geoUtils" | "mapvgl";
export declare type PluginVerdict = "native" | "compatible" | "adapter" | "incompatible" | "unverified";
export declare interface PluginVersionLock {
    readonly versioned: boolean;
    readonly note: string;
}
declare interface Point {
    lng: number;
    lat: number;
}
declare type PolygonHandle = SdkHandle<"overlay:polygon">;
declare type PolylineHandle = SdkHandle<"overlay:polyline">;
export declare function resolvePluginDefinition(name: string): BMapPluginDefinition<unknown>;
declare type RidingRouteOptions = RouteRenderState;
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
declare interface RouteState extends RouteRenderState {
    enableTraffic?: boolean;
}
declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
declare interface ServiceDriver {
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
declare type ServiceHandle<Kind extends string = "service"> = SdkHandle<Kind>;
declare interface Size {
    width: number;
    height: number;
}
export declare function stringToPluginDefinitions(names: readonly string[]): BMapPluginDefinition<unknown>[];
export declare function trackAnimationPlugin(): BMapPluginDefinition<unknown>;
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
declare const TransitVehiclePolicy: {
    readonly TRAIN: 0;
    readonly AIRPLANE: 1;
    readonly COACH: 2;
};
declare type TransitVehiclePolicy = (typeof TransitVehiclePolicy)[keyof typeof TransitVehiclePolicy];
declare type UnsupportedBehavior = "throw" | "warn" | "silent";
export declare function urlPluginDefinition<T>(name: string, url: string, exportGetter: () => unknown, options?: {
    required?: boolean;
    scope?: "global" | "map";
    dependencies?: readonly string[];
}): BMapPluginDefinition<T>;
declare type ViewAnimationCancelOutcome = "canceled" | "deferred" | "already-settled";
declare type WalkingRouteOptions = RouteRenderState;
export {};
```
