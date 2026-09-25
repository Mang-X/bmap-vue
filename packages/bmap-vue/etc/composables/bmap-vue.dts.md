## API Signature Baseline for "bmap-vue" (entry `./composables`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/composables.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> API Extractor 分析不了这两个出口的 Volar `__VLS_` 悬空引用，
> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。

```ts
import { ComputedRef } from "vue";
import { MaybeRefOrGetter } from "vue";
import { Ref } from "vue";
import { ShallowRef } from "vue";
export declare type AreaBoundary = string[];
declare interface AutocompleteOptions {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
declare interface AutocompleteOptions_2 {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
declare interface AutocompleteUpdateOptions_2 {
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
declare interface BMapClient_2 {
    readonly id: symbol;
    readonly engine: BMapEngine_2;
    readonly libraryVersion: string;
    readonly sdkVersion: string;
    readonly driver: BMapDriver_2;
    readonly capabilities: CapabilityRegistry_2;
    readonly rawSdk: unknown;
}
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
declare interface BMapDriver_2 {
    readonly engine: BMapEngine_2;
    readonly version: string;
    readonly rawSdk: unknown;
    readonly capabilities: CapabilityRegistry_2;
    readonly geometry: GeometryDriver_2;
    readonly map: MapDriver_2;
    readonly overlays: OverlayDriver_2;
    readonly controls: ControlDriver_2;
    readonly layers: LayerDriver_2;
    readonly services: ServiceDriver_2;
    readonly panorama: PanoramaDriver_2;
    readonly events: EventDriver_2;
}
export declare interface BMapDrivingRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    policy?: MaybeRefOrGetter<DrivingPolicy_2 | undefined>;
    enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}
declare type BMapEngine = "jsapi-v4";
declare type BMapEngine_2 = "jsapi-v4";
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
declare type BMapRouteLocation = string | GeoPoint | MapHandle;
declare interface BMapRouteRenderOptions {
    map?: MaybeRefOrGetter<MapHandle | null | undefined>;
    panel?: string | HTMLElement;
    autoViewport?: boolean;
    viewportOptions?: {
        noAnimation?: boolean;
        margins?: readonly number[];
        zoomFactor?: number;
    };
}
declare type BMapServiceStatus = "idle" | "loading" | ServiceCallStatus | "unsupported";
declare type BMapServiceStatus_2 = "idle" | "loading" | ServiceCallStatus_2 | "unsupported";
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
declare interface Bounds {
    southwest: Point;
    northeast: Point;
}
declare interface Bounds_2 {
    southwest: Point_2;
    northeast: Point_2;
}
declare type BuiltinMarkerIconName = keyof typeof MARKER_ICON_SPRITES;
declare type Capability = "map.view-state" | "map.zoom" | "map.center-and-zoom" | "map.bounds" | "map.viewport" | "map.heading" | "map.tilt" | "map.fly-to" | "map.animate" | "map.screenshot" | "map.check-resize" | "map.pixel-conversion" | "map.style" | "map.destroy" | "overlay.marker" | "overlay.label" | "overlay.info-window" | "overlay.circle" | "overlay.polyline" | "overlay.polygon" | "overlay.rectangle" | "overlay.custom-dom" | "overlay.ground" | "overlay.point-collection" | "overlay.context-menu" | "overlay.prism" | "overlay.bezier-curve" | "overlay.marker-3d" | "overlay.mapvgl" | "layer.tile" | "layer.traffic" | "layer.geojson" | "layer.point-icon" | "layer.point-shape" | "layer.district" | "layer.panorama-coverage" | "layer.line" | "layer.fill" | "layer.dom" | "layer.xyz" | "layer.wms" | "layer.wmts" | "layer.raster" | "layer.mvt" | "layer.cluster" | "layer.point" | "layer.heatmap" | "layer.track-line" | "service.local-search" | "service.autocomplete" | "service.driving-route" | "service.walking-route" | "service.riding-route" | "service.transit-route" | "service.geocoder" | "service.geolocation" | "service.local-city" | "service.boundary" | "service.convertor" | "service.track-animation" | "panorama.viewer" | "panorama.service" | "panorama.label";
declare type Capability_2 = "map.view-state" | "map.zoom" | "map.center-and-zoom" | "map.bounds" | "map.viewport" | "map.heading" | "map.tilt" | "map.fly-to" | "map.animate" | "map.screenshot" | "map.check-resize" | "map.pixel-conversion" | "map.style" | "map.destroy" | "overlay.marker" | "overlay.label" | "overlay.info-window" | "overlay.circle" | "overlay.polyline" | "overlay.polygon" | "overlay.rectangle" | "overlay.custom-dom" | "overlay.ground" | "overlay.point-collection" | "overlay.context-menu" | "overlay.prism" | "overlay.bezier-curve" | "overlay.marker-3d" | "overlay.mapvgl" | "layer.tile" | "layer.traffic" | "layer.geojson" | "layer.point-icon" | "layer.point-shape" | "layer.district" | "layer.panorama-coverage" | "layer.line" | "layer.fill" | "layer.dom" | "layer.xyz" | "layer.wms" | "layer.wmts" | "layer.raster" | "layer.mvt" | "layer.cluster" | "layer.point" | "layer.heatmap" | "layer.track-line" | "service.local-search" | "service.autocomplete" | "service.driving-route" | "service.walking-route" | "service.riding-route" | "service.transit-route" | "service.geocoder" | "service.geolocation" | "service.local-city" | "service.boundary" | "service.convertor" | "service.track-animation" | "panorama.viewer" | "panorama.service" | "panorama.label";
declare interface CapabilityDescriptor {
    id: Capability;
    family: CapabilityFamily;
    description: string;
    rawMembers?: readonly string[];
    status: CapabilityStatus;
    runtimeOnly: boolean;
}
declare interface CapabilityDescriptor_2 {
    id: Capability_2;
    family: CapabilityFamily_2;
    description: string;
    rawMembers?: readonly string[];
    status: CapabilityStatus_2;
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
declare interface CapabilityExplanation_2 {
    id: Capability_2;
    supported: boolean;
    reason: CapabilityReason_2;
    engine: BMapEngine_2;
    version: string;
    family?: CapabilityFamily_2;
    status: CapabilityStatus_2;
    runtimeOnly: boolean;
}
declare type CapabilityFamily = "map" | "overlay" | "layer" | "service" | "panorama";
declare type CapabilityFamily_2 = "map" | "overlay" | "layer" | "service" | "panorama";
declare type CapabilityReason = "supported" | "unlisted-capability" | "raw-member-missing" | "status-unsupported" | "overridden";
declare type CapabilityReason_2 = "supported" | "unlisted-capability" | "raw-member-missing" | "status-unsupported" | "overridden";
declare interface CapabilityRegistry {
    supports(capability: Capability): boolean;
    require(capability: Capability): void;
    list(): readonly Capability[];
    explain(capability: Capability): CapabilityExplanation;
    descriptor(capability: Capability): CapabilityDescriptor | undefined;
    observeInstanceMembers(source: unknown): void;
}
declare interface CapabilityRegistry_2 {
    supports(capability: Capability_2): boolean;
    require(capability: Capability_2): void;
    list(): readonly Capability_2[];
    explain(capability: Capability_2): CapabilityExplanation_2;
    descriptor(capability: Capability_2): CapabilityDescriptor_2 | undefined;
    observeInstanceMembers(source: unknown): void;
}
declare type CapabilityStatus = "native" | "extended" | "experimental" | "unsupported";
declare type CapabilityStatus_2 = "native" | "extended" | "experimental" | "unsupported";
declare type CircleHandle = SdkHandle<"overlay:circle">;
declare type CircleHandle_2 = SdkHandle_2<"overlay:circle">;
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
declare interface ControlDriver_2 {
    create(kind: ControlKind_2, options?: ControlOptions_2): ControlHandle_2;
    createCustomControl(options: {
        anchor?: string;
        offset?: Pixel_2;
        render: (mapContainer: HTMLElement) => HTMLElement | null;
    }): ControlHandle_2;
    add(target: OverlayTarget_2, control: ControlHandle_2): void;
    remove(target: OverlayTarget_2, control: ControlHandle_2): void;
    show(control: ControlHandle_2): void;
    hide(control: ControlHandle_2): void;
    setOptions(control: ControlHandle_2, options: Record<string, unknown>): void;
    planOptions(control: ControlHandle_2, keys: readonly string[]): Record<string, ControlOptionStatus_2>;
    addCopyright(control: ControlHandle_2, copyright: CopyrightEntry_2): void;
    removeCopyright(control: ControlHandle_2, id: number): void;
    listCopyrights(control: ControlHandle_2): CopyrightEntry_2[];
}
declare type ControlHandle = SdkHandle<"control" | `control:${string}`>;
declare type ControlHandle_2 = SdkHandle_2<"control" | `control:${string}`>;
declare type ControlKind = "zoom" | "scale" | "navigation" | "navigation-3d" | "city-list" | "location" | "map-type" | "overview" | "panorama" | "copyright" | "custom";
declare type ControlKind_2 = "zoom" | "scale" | "navigation" | "navigation-3d" | "city-list" | "location" | "map-type" | "overview" | "panorama" | "copyright" | "custom";
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
declare interface ControlOptions {
    anchor?: string;
    offset?: Pixel;
    [key: string]: unknown;
}
declare interface ControlOptions_2 {
    anchor?: string;
    offset?: Pixel_2;
    [key: string]: unknown;
}
declare type ControlOptionStatus = "mutable" | "recreate" | "unsupported";
declare type ControlOptionStatus_2 = "mutable" | "recreate" | "unsupported";
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
declare interface CopyrightEntry {
    id: number;
    content: string;
    bounds?: unknown;
}
declare interface CopyrightEntry_2 {
    id: number;
    content: string;
    bounds?: unknown;
}
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
declare interface CustomOverlayOptions_2 {
    offset?: Pixel_2;
    anchor?: Pixel_2;
    rotation?: number;
    minZoom?: number;
    maxZoom?: number;
    properties?: Record<string, unknown>;
    visible?: boolean;
    zIndex?: number;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
declare type Disposer = () => void;
declare type Disposer_2 = () => void;
declare interface DriverEvent {
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
declare const DrivingPolicy_2_2: {
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
declare type DrivingPolicy_2_2 = (typeof DrivingPolicy_2_2)[keyof typeof DrivingPolicy_2_2];
declare type DrivingRouteEndpoint = Point | RouteEndpointPoi;
declare interface DrivingRouteOptions extends RouteState {
    policy?: DrivingPolicy_2;
}
declare interface DrivingRouteOptions_2 extends RouteState_2 {
    policy?: DrivingPolicy_2_2;
}
declare type DrivingRouteResult = RouteResult<RoutePlan>;
declare interface Emitter<Events extends Record<EventType, unknown>> {
    all: EventHandlerMap<Events>;
    on<Key extends keyof Events>(type: Key, handler: Handler<Events[Key]>): void;
    on(type: "*", handler: WildcardHandler<Events>): void;
    off<Key extends keyof Events>(type: Key, handler?: Handler<Events[Key]>): void;
    off(type: "*", handler: WildcardHandler<Events>): void;
    emit<Key extends keyof Events>(type: Key, event: Events[Key]): void;
    emit<Key extends keyof Events>(type: undefined extends Events[Key] ? Key : never): void;
}
declare interface Emitter_2<Events extends Record<EventType_2, unknown>> {
    all: EventHandlerMap_2<Events>;
    on<Key extends keyof Events>(type: Key, handler: Handler_2<Events[Key]>): void;
    on(type: "*", handler: WildcardHandler_2<Events>): void;
    off<Key extends keyof Events>(type: Key, handler?: Handler_2<Events[Key]>): void;
    off(type: "*", handler: WildcardHandler_2<Events>): void;
    emit<Key extends keyof Events>(type: Key, event: Events[Key]): void;
    emit<Key extends keyof Events>(type: undefined extends Events[Key] ? Key : never): void;
}
export declare type EqualFn<T> = (a: T, b: T) => boolean;
declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
declare interface EventDriver_2 {
    on<TEvent = unknown>(target: SdkHandle_2<string>, type: string, listener: (event: TEvent) => void): () => void;
}
declare type EventHandlerList<T = unknown> = Array<Handler<T>>;
declare type EventHandlerList_2<T = unknown> = Array<Handler_2<T>>;
declare type EventHandlerMap<Events extends Record<EventType, unknown>> = Map<keyof Events | "*", EventHandlerList<Events[keyof Events]> | WildCardEventHandlerList<Events>>;
declare type EventHandlerMap_2<Events extends Record<EventType_2, unknown>> = Map<keyof Events | "*", EventHandlerList_2<Events[keyof Events]> | WildCardEventHandlerList_2<Events>>;
declare type EventType = string | symbol;
declare type EventType_2 = string | symbol;
declare interface FrameScheduler {
    schedule(key: PropertyKey, task: () => void): void;
    cancel(key: PropertyKey): void;
    flush(): void;
    pause(): void;
    resume(): void;
    dispose(): void;
}
declare interface FrameScheduler_2 {
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
    status: BMapServiceStatus_2;
    error: ServiceErrorInfo_2 | null;
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
    status: BMapServiceStatus_2;
    error: ServiceErrorInfo_2 | null;
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
declare interface GeometryDriver_2 {
    toRawPoint(point: Point_2): unknown;
    fromRawPoint(raw: unknown): Point_2;
    toRawPoints(points: readonly Point_2[]): unknown[];
    fromRawPoints(raws: readonly unknown[]): Point_2[];
    toRawPixel(pixel: Pixel_2): unknown;
    fromRawPixel(raw: unknown): Pixel_2;
    toRawSize(size: Size_2): unknown;
    fromRawSize(raw: unknown): Size_2;
    toRawBounds(bounds: Bounds_2): unknown;
    fromRawBounds(raw: unknown): Bounds_2;
}
export declare interface GeoPoint {
    lng: number;
    lat: number;
}
declare const HANDLE_BRAND: unique symbol;
declare const HANDLE_BRAND_2: unique symbol;
declare type Handler<T = unknown> = (event: T) => void;
declare type Handler_2<T = unknown> = (event: T) => void;
declare type InfoWindowHandle = SdkHandle<"overlay:info-window">;
declare type InfoWindowHandle_2 = SdkHandle_2<"overlay:info-window">;
declare interface InfoWindowManager {
    register(input: InfoWindowRegistrationInput): InfoWindowRegistration;
    activate(resource: InfoWindowHandle): void;
    deactivate(resource: InfoWindowHandle): void;
    current(): InfoWindowHandle | null;
    isCurrent(resource: InfoWindowHandle): boolean;
    readonly size: number;
    dispose(): void;
}
declare interface InfoWindowManager_2 {
    register(input: InfoWindowRegistrationInput_2): InfoWindowRegistration_2;
    activate(resource: InfoWindowHandle_2): void;
    deactivate(resource: InfoWindowHandle_2): void;
    current(): InfoWindowHandle_2 | null;
    isCurrent(resource: InfoWindowHandle_2): boolean;
    readonly size: number;
    dispose(): void;
}
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
declare interface InfoWindowOptions_2 {
    width?: number;
    height?: number;
    title?: string;
    offset?: Pixel_2;
    enableMaximize?: boolean;
    enableAutoPan?: boolean;
    enableCloseOnClick?: boolean;
    [key: string]: unknown;
}
declare interface InfoWindowRegistration {
    readonly id: symbol;
    readonly resource: InfoWindowHandle;
    readonly disposed: boolean;
    dispose(): void;
}
declare interface InfoWindowRegistration_2 {
    readonly id: symbol;
    readonly resource: InfoWindowHandle_2;
    readonly disposed: boolean;
    dispose(): void;
}
declare interface InfoWindowRegistrationInput {
    readonly resource: InfoWindowHandle;
    readonly onSuperseded: () => void;
}
declare interface InfoWindowRegistrationInput_2 {
    readonly resource: InfoWindowHandle_2;
    readonly onSuperseded: () => void;
}
declare interface InitialMapOptions {
    minZoom?: number;
    maxZoom?: number;
    backgroundColor?: number[];
    restrictCenter?: boolean;
    displayOptions?: Record<string, unknown>;
    [key: string]: unknown;
}
declare interface InitialMapOptions_2 {
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
declare const IntercityPolicy_2_2: {
    readonly LEAST_TIME: 0;
    readonly EARLY_START: 1;
    readonly CHEAP_PRICE: 2;
};
declare type IntercityPolicy_2_2 = (typeof IntercityPolicy_2_2)[keyof typeof IntercityPolicy_2_2];
declare type InternalMapEvents = {
    "resource:error": {
        error: unknown;
        component?: string;
    };
    "overlay:registered": {
        id: symbol;
        type: string;
    };
    "overlay:disposed": {
        id: symbol;
        type: string;
    };
    "plugin:ready": {
        name: string;
    };
    "plugin:error": {
        name: string;
        error: unknown;
    };
};
declare type InternalMapEvents_2 = {
    "resource:error": {
        error: unknown;
        component?: string;
    };
    "overlay:registered": {
        id: symbol;
        type: string;
    };
    "overlay:disposed": {
        id: symbol;
        type: string;
    };
    "plugin:ready": {
        name: string;
    };
    "plugin:error": {
        name: string;
        error: unknown;
    };
};
declare type LabelHandle = SdkHandle<"overlay:label">;
declare type LabelHandle_2 = SdkHandle_2<"overlay:label">;
declare interface LabelOptions {
    position?: Point;
    offset?: Pixel;
    zIndex?: number;
    style?: Record<string, unknown>;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
declare interface LabelOptions_2 {
    position?: Point_2;
    offset?: Pixel_2;
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
declare interface LayerCreateOptions_2 extends Record<string, unknown> {
    layerName?: string;
    createDOM?: (properties: object, point: {
        lng: number;
        lat: number;
    }) => HTMLElement;
}
declare type LayerCtorSlot = "opacity" | "minZoom" | "maxZoom" | "zIndex" | "data";
declare type LayerCtorSlot_2 = "opacity" | "minZoom" | "maxZoom" | "zIndex" | "data";
declare type LayerData = object;
declare type LayerData_2 = object;
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
declare interface LayerDriver_2 {
    create(kind: LayerKind_2, options?: LayerCreateOptions_2): LayerHandle_2;
    add(target: OverlayTarget_2, layer: LayerHandle_2): void;
    remove(target: OverlayTarget_2, layer: LayerHandle_2): void;
    setOptions(layer: LayerHandle_2, options: Record<string, unknown>): void;
    surface(kind: LayerKind_2): LayerSurface_2;
    supports(kind: LayerKind_2, operation: LayerOperation_2): boolean;
    isMutableOption(kind: LayerKind_2, key: string): boolean;
    setZIndex(layer: LayerHandle_2, zIndex: number): void;
    setData(layer: LayerHandle_2, data: LayerData_2): void;
    clearData(layer: LayerHandle_2): void;
    updateState(layer: LayerHandle_2, keys: NativeLayerFeatureKeys_2, state: NativeLayerFeatureState_2, append?: boolean): void;
    removeState(layer: LayerHandle_2, keys: NativeLayerFeatureKeys_2): void;
    clearState(layer: LayerHandle_2): void;
    replaceState(layer: LayerHandle_2, inputs: NativeLayerFeatureStateMap_2): void;
    getState(layer: LayerHandle_2): NativeLayerFeatureStateMap_2;
}
declare type LayerHandle = SdkHandle<"layer" | `layer:${string}`>;
declare type LayerHandle_2 = SdkHandle_2<"layer" | `layer:${string}`>;
declare type LayerKind = "district" | "panorama-coverage" | "tile" | "traffic" | "geojson" | "dom" | "xyz" | "wms" | "wmts" | "raster" | "mvt";
declare type LayerKind_2 = "district" | "panorama-coverage" | "tile" | "traffic" | "geojson" | "dom" | "xyz" | "wms" | "wmts" | "raster" | "mvt";
declare type LayerLedgerHandle = LayerHandle | NativeLayerHandle;
declare type LayerLedgerHandle_2 = LayerHandle_2 | NativeLayerHandle_2;
declare type LayerLedgerKind = LayerKind | NativeLayerKind;
declare type LayerLedgerKind_2 = LayerKind_2 | NativeLayerKind_2;
declare type LayerOperation = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
declare type LayerOperation_2 = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
declare interface LayerRecord {
    readonly id: symbol;
    readonly kind: LayerLedgerKind;
    readonly handle: LayerLedgerHandle;
    readonly disposed: boolean;
    dispose(): void;
    detach(): void;
}
declare interface LayerRecord_2 {
    readonly id: symbol;
    readonly kind: LayerLedgerKind_2;
    readonly handle: LayerLedgerHandle_2;
    readonly disposed: boolean;
    dispose(): void;
    detach(): void;
}
declare interface LayerRegistry {
    register(input: LayerRegistryInput): LayerRecord;
    disposeAll(): void;
    readonly size: number;
    kinds(): LayerLedgerKind[];
}
declare interface LayerRegistry_2 {
    register(input: LayerRegistryInput_2): LayerRecord_2;
    disposeAll(): void;
    readonly size: number;
    kinds(): LayerLedgerKind_2[];
}
declare interface LayerRegistryInput {
    readonly kind: LayerLedgerKind;
    readonly handle: LayerLedgerHandle;
    readonly scope: ResourceScope;
    readonly remove: () => void;
    readonly quiesce?: (active: boolean) => void;
}
declare interface LayerRegistryInput_2 {
    readonly kind: LayerLedgerKind_2;
    readonly handle: LayerLedgerHandle_2;
    readonly scope: ResourceScope_2;
    readonly remove: () => void;
    readonly quiesce?: (active: boolean) => void;
}
declare interface LayerSurface {
    readonly ctorSlots: readonly LayerCtorSlot[];
    readonly operations: readonly LayerOperation[];
}
declare interface LayerSurface_2 {
    readonly ctorSlots: readonly LayerCtorSlot_2[];
    readonly operations: readonly LayerOperation_2[];
}
declare type LocalSearchBounds = Bounds;
declare interface LocalSearchInBoundsRequest {
    keyword: LocalSearchKeyword;
    bounds: LocalSearchBounds;
}
declare type LocalSearchKeyword = string | readonly string[];
export declare type LocalSearchLocation = string | GeoPoint | MapHandle;
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
declare interface LocalSearchOptions_2 {
    renderOptions?: LocalSearchRenderOptions_2;
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
declare interface LocalSearchRenderOptions_2 {
    map?: MapHandle_2;
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
declare const MAP_EVENT_CATALOG: {
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
declare interface MapContext extends MapRuntimeShape {
    readonly overlays: OverlayRegistry;
    readonly layers?: LayerRegistry;
    readonly infoWindows?: InfoWindowManager;
    readonly controls?: unknown;
    readonly plugins: unknown;
}
declare interface MapContext_2 extends MapRuntimeShape_2 {
    readonly overlays: OverlayRegistry_2;
    readonly layers?: LayerRegistry_2;
    readonly infoWindows?: InfoWindowManager_2;
    readonly controls?: unknown;
    readonly plugins: unknown;
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
declare interface MapDriver_2 {
    create(container: HTMLElement, options?: InitialMapOptions_2): MapHandle_2;
    destroy(map: MapHandle_2): void;
    initializeView(map: MapHandle_2, view: MapView_2): void;
    setCenter(map: MapHandle_2, center: Point_2 | string): void;
    getCenter(map: MapHandle_2): Point_2;
    setZoom(map: MapHandle_2, zoom: number): void;
    getZoom(map: MapHandle_2): number;
    setHeading(map: MapHandle_2, heading: number): void;
    getHeading(map: MapHandle_2): number;
    setTilt(map: MapHandle_2, tilt: number): void;
    getTilt(map: MapHandle_2): number;
    getBounds(map: MapHandle_2): Bounds_2;
    getSize(map: MapHandle_2): Size_2;
    pointToPixel(map: MapHandle_2, point: Point_2): Pixel_2;
    pixelToPoint(map: MapHandle_2, pixel: Pixel_2): Point_2;
    panTo(map: MapHandle_2, point: Point_2): void;
    panBy(map: MapHandle_2, pixel: Pixel_2): void;
    fitBounds(map: MapHandle_2, bounds: Bounds_2): void;
    setViewport(map: MapHandle_2, points: readonly Point_2[], options?: Record<string, unknown>): void;
    checkResize(map: MapHandle_2): void;
    setMapType(map: MapHandle_2, type: MapType_2_2): void;
    setMapStyle(map: MapHandle_2, style: MapStyleInput_2): void;
    setInteraction(map: MapHandle_2, name: MapInteraction_2, enabled: boolean): void;
    setTraffic(map: MapHandle_2, enabled: boolean): void;
    startViewAnimation(map: MapHandle_2, animation: unknown): void;
    cancelViewAnimation(map: MapHandle_2, animation: unknown): ViewAnimationCancelOutcome_2;
}
declare type MapEventBus = {
    on: Emitter<InternalMapEvents>["on"];
    off: Emitter<InternalMapEvents>["off"];
    emit: Emitter<InternalMapEvents>["emit"];
    clear: () => void;
};
declare type MapEventBus_2 = {
    on: Emitter_2<InternalMapEvents_2>["on"];
    off: Emitter_2<InternalMapEvents_2>["off"];
    emit: Emitter_2<InternalMapEvents_2>["emit"];
    clear: () => void;
};
declare interface MapEventEmits {
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
declare type MapEventMap = {
    [K in MapEventName]: MapEventEmits[K][0];
};
declare type MapEventName = keyof typeof MAP_EVENT_CATALOG;
declare type MapEventPayload = DriverEvent & {
    type: string;
};
export declare type MapEventPayloadForName<K extends string> = K extends MapEventName ? MapEventPayloadOf<K> : MapEventPayload;
declare type MapEventPayloadOf<K extends MapEventName> = MapEventMap[K];
export declare interface MapEventSource {
    map: MaybeRefOrGetter<MapHandle | null>;
    client: MaybeRefOrGetter<BMapClient | null>;
    scheduler?: FrameScheduler;
    whenMapCreated?: (callback: (ready: MapReadyContext) => void) => () => void;
    isTearingDown?: () => boolean;
    resources?: ResourceScope;
}
export declare type MapEventSourceInput = MapContext | MapEventSource;
declare type MapHandle = SdkHandle<"map">;
declare type MapHandle_2 = SdkHandle_2<"map">;
declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
declare type MapInteraction_2 = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
declare interface MapLoadEvent extends DriverEvent {
    point: Point;
    zoom: number;
}
declare type MapLoadPayload = MapLoadEvent & {
    type: string;
};
declare interface MapMouseEvent extends DriverEvent {
    point: Point;
}
declare type MapPointerEvent = MapMouseEvent & {
    type: string;
};
export declare interface MapReadyContext {
    readonly client: BMapClient;
    readonly map: MapHandle;
}
declare interface MapReadyContext_2 {
    readonly client: BMapClient_2;
    readonly map: MapHandle_2;
}
declare interface MapResizeEvent extends DriverEvent {
    size: Size;
}
declare type MapResizePayload = MapResizeEvent & {
    type: string;
};
declare interface MapRuntimeShape {
    readonly id: symbol;
    readonly status: ShallowRef<MapStatus>;
    readonly client: ShallowRef<BMapClient | null>;
    readonly map: ShallowRef<MapHandle | null>;
    readonly handle?: ShallowRef<MapHandle | null>;
    readonly error: ShallowRef<unknown>;
    readonly resources: ResourceScope;
    readonly events: MapEventBus;
    readonly scheduler: FrameScheduler;
    whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
    whenMapCreated?(callback: (ready: MapReadyContext) => void): () => void;
    isTearingDown?(): boolean;
    retry?(): Promise<MapReadyContext>;
    dispose(): void;
}
declare interface MapRuntimeShape_2 {
    readonly id: symbol;
    readonly status: ShallowRef<MapStatus_2>;
    readonly client: ShallowRef<BMapClient_2 | null>;
    readonly map: ShallowRef<MapHandle_2 | null>;
    readonly handle?: ShallowRef<MapHandle_2 | null>;
    readonly error: ShallowRef<unknown>;
    readonly resources: ResourceScope_2;
    readonly events: MapEventBus_2;
    readonly scheduler: FrameScheduler_2;
    whenReady(signal?: AbortSignal): Promise<MapReadyContext_2>;
    whenMapCreated?(callback: (ready: MapReadyContext_2) => void): () => void;
    isTearingDown?(): boolean;
    retry?(): Promise<MapReadyContext_2>;
    dispose(): void;
}
declare type MapStatus = "idle" | "waiting-client" | "creating" | "initializing" | "ready" | "error" | "disposing" | "disposed";
declare type MapStatus_2 = "idle" | "waiting-client" | "creating" | "initializing" | "ready" | "error" | "disposing" | "disposed";
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
declare type MapStyleInput = {
    styleId: string;
} | Record<string, unknown>;
declare type MapStyleInput_2 = {
    styleId: string;
} | Record<string, unknown>;
declare type MapType_2 = "normal" | "satellite" | "earth";
declare type MapType_2_2 = "normal" | "satellite" | "earth";
declare interface MapTypeChangeEvent extends DriverEvent {
    zoomLevel: number;
}
declare type MapTypeChangePayload = MapTypeChangeEvent & {
    type: string;
};
declare interface MapView {
    center: Point | string;
    zoom: number;
    heading?: number;
    tilt?: number;
}
declare interface MapView_2 {
    center: Point_2 | string;
    zoom: number;
    heading?: number;
    tilt?: number;
}
declare const MARKER_ICON_SPRITES: {
    readonly simple_red: readonly [
        454,
        378,
        42,
        66
    ];
    readonly simple_blue: readonly [
        454,
        450,
        42,
        66
    ];
    readonly loc_red: readonly [
        400,
        378,
        46,
        70
    ];
    readonly loc_blue: readonly [
        400,
        450,
        46,
        70
    ];
    readonly start: readonly [
        298,
        450,
        46,
        70
    ];
    readonly end: readonly [
        298,
        378,
        46,
        70
    ];
    readonly location: readonly [
        400,
        378,
        46,
        70
    ];
    readonly red1: readonly [
        0,
        0,
        38,
        38
    ];
    readonly red2: readonly [
        38,
        0,
        38,
        38
    ];
    readonly red3: readonly [
        76,
        0,
        38,
        38
    ];
    readonly red4: readonly [
        114,
        0,
        38,
        38
    ];
    readonly red5: readonly [
        152,
        0,
        38,
        38
    ];
    readonly red6: readonly [
        190,
        0,
        38,
        38
    ];
    readonly red7: readonly [
        228,
        0,
        38,
        38
    ];
    readonly red8: readonly [
        266,
        0,
        38,
        38
    ];
    readonly red9: readonly [
        304,
        0,
        38,
        38
    ];
    readonly red10: readonly [
        342,
        0,
        38,
        38
    ];
    readonly blue1: readonly [
        0,
        38,
        38,
        38
    ];
    readonly blue2: readonly [
        38,
        38,
        38,
        38
    ];
    readonly blue3: readonly [
        76,
        38,
        38,
        38
    ];
    readonly blue4: readonly [
        114,
        38,
        38,
        38
    ];
    readonly blue5: readonly [
        152,
        38,
        38,
        38
    ];
    readonly blue6: readonly [
        190,
        38,
        38,
        38
    ];
    readonly blue7: readonly [
        228,
        38,
        38,
        38
    ];
    readonly blue8: readonly [
        266,
        38,
        38,
        38
    ];
    readonly blue9: readonly [
        304,
        38,
        38,
        38
    ];
    readonly blue10: readonly [
        342,
        38,
        38,
        38
    ];
};
declare type MarkerHandle = SdkHandle<"overlay:marker">;
declare type MarkerHandle_2 = SdkHandle_2<"overlay:marker">;
declare type MarkerIconInput = string | {
    imageUrl: string;
    size: Size;
    anchor?: Pixel;
    imageOffset?: Pixel;
    imageSize?: Size;
    printImageUrl?: string;
};
declare type MarkerIconInput_2 = string | {
    imageUrl: string;
    size: Size_2;
    anchor?: Pixel_2;
    imageOffset?: Pixel_2;
    imageSize?: Size_2;
    printImageUrl?: string;
};
export declare type MarkerIconName = BuiltinMarkerIconName;
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
declare interface MarkerOptions_2 {
    offset?: Pixel_2;
    title?: string;
    icon?: MarkerIconInput_2;
    zIndex?: number;
    rotation?: number;
    enableClicking?: boolean;
    enableDragging?: boolean;
    [key: string]: unknown;
}
declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureKeys_2 = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureState = Record<string, unknown>;
declare type NativeLayerFeatureState_2 = Record<string, unknown>;
declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
declare type NativeLayerFeatureStateMap_2 = Record<string, NativeLayerFeatureState_2>;
declare type NativeLayerHandle = SdkHandle<"native-layer" | `native-layer:${string}`>;
declare type NativeLayerHandle_2 = SdkHandle_2<"native-layer" | `native-layer:${string}`>;
declare type NativeLayerKind = "point" | "cluster" | "point-icon" | "point-shape" | "line" | "fill" | "heatmap" | "track-line";
declare type NativeLayerKind_2 = "point" | "cluster" | "point-icon" | "point-shape" | "line" | "fill" | "heatmap" | "track-line";
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
declare interface OverlayDriver_2 {
    createMarker(position: Point_2, options?: MarkerOptions_2): MarkerHandle_2;
    createPolyline(path: readonly Point_2[], options?: PathOptions_2): PolylineHandle_2;
    createPolygon(path: readonly (Point_2 | string)[], options?: PathOptions_2 & {
        isBoundary?: boolean;
    }): PolygonHandle_2;
    createRectangle(bounds: Bounds_2, options?: PathOptions_2): OverlayHandle_2;
    createCircle(center: Point_2, radius: number, options?: PathOptions_2): CircleHandle_2;
    createInfoWindow(content: HTMLElement, options?: InfoWindowOptions_2): InfoWindowHandle_2;
    createLabel(content: string, options?: LabelOptions_2): LabelHandle_2;
    createPrism(path: readonly (Point_2 | string)[], altitude: number, options?: Record<string, unknown>): OverlayHandle_2;
    createMarker3D(position: Point_2, height: number, options?: Record<string, unknown>): OverlayHandle_2;
    createBezierCurve(path: readonly Point_2[], controlPoints: readonly (readonly Point_2[])[], options?: Record<string, unknown>): OverlayHandle_2;
    createMapMask(path: readonly Point_2[], options?: Record<string, unknown>): OverlayHandle_2;
    createGroundOverlay(bounds: Bounds_2, options?: Record<string, unknown>): OverlayHandle_2;
    createCustomOverlay(position: Point_2, render: () => HTMLElement, options?: CustomOverlayOptions_2): OverlayHandle_2;
    createContextMenu(options?: {
        width?: number;
    }): OverlayHandle_2;
    addContextMenuItem(menu: OverlayHandle_2, item: {
        text: string;
        callback: (point: unknown, pixel: unknown) => void;
        disabled?: boolean;
    } | "-", options?: {
        width?: number;
        id?: string;
    }): void;
    add(target: OverlayTarget_2, overlay: OverlayHandle_2): void;
    remove(target: OverlayTarget_2, overlay: OverlayHandle_2): void;
    show(overlay: OverlayHandle_2): boolean;
    hide(overlay: OverlayHandle_2): boolean;
    attachContextMenu(target: OverlayTarget_2, menu: OverlayHandle_2): void;
    detachContextMenu(target: OverlayTarget_2, menu: OverlayHandle_2): void;
    setPosition(overlay: OverlayHandle_2, position: Point_2): void;
    setPath(overlay: OverlayHandle_2, path: readonly (Point_2 | string)[]): void;
    setOptions(overlay: OverlayHandle_2, options: Record<string, unknown>): void;
    updatePolicy(overlay: OverlayHandle_2, key: string): OverlayPropertyPolicy_2 | undefined;
    openInfoWindow(map: MapHandle_2, overlay: InfoWindowHandle_2, position: Point_2): void;
    closeInfoWindow(overlay: InfoWindowHandle_2): void;
    redrawInfoWindow(overlay: InfoWindowHandle_2): void;
    isCurrentInfoWindow(map: MapHandle_2, overlay: InfoWindowHandle_2): boolean;
    buildIcon(icon: MarkerIconInput_2): unknown;
}
declare type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
declare type OverlayHandle_2 = SdkHandle_2<"overlay" | `overlay:${string}`>;
declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
declare type OverlayPropertyPolicy_2 = "mutable" | "recreate" | "unsupported";
declare interface OverlayRecord<Resource = unknown> {
    readonly id: symbol;
    readonly type: string;
    readonly instance: Resource;
    readonly owner: ResourceScope;
}
declare interface OverlayRecord_2<Resource = unknown> {
    readonly id: symbol;
    readonly type: string;
    readonly instance: Resource;
    readonly owner: ResourceScope_2;
}
declare interface OverlayRegistry {
    registerResource<Resource>(input: ResourceRegistrationInput<Resource>): ResourceRegistration<Resource>;
    get(id: symbol): OverlayRecord | undefined;
    getByType<Resource = unknown>(type: string): OverlayRecord<Resource>[];
    clearAll(): void;
    dispose(): void;
    get size(): number;
}
declare interface OverlayRegistry_2 {
    registerResource<Resource>(input: ResourceRegistrationInput_2<Resource>): ResourceRegistration_2<Resource>;
    get(id: symbol): OverlayRecord_2 | undefined;
    getByType<Resource = unknown>(type: string): OverlayRecord_2<Resource>[];
    clearAll(): void;
    dispose(): void;
    get size(): number;
}
declare interface OverlayTarget {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle<string>;
}
declare interface OverlayTarget_2 {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle_2<string>;
}
declare interface PanoramaDataInfo {
    id: string;
    description: string;
    position: Point | null;
}
declare interface PanoramaDriver {
    readonly supported: boolean;
}
declare interface PanoramaDriver_2 {
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
declare interface PathOptions_2 {
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
declare interface Pixel_2 {
    x: number;
    y: number;
}
declare interface Point {
    lng: number;
    lat: number;
}
declare interface Point_2 {
    lng: number;
    lat: number;
}
declare type PolygonHandle = SdkHandle<"overlay:polygon">;
declare type PolygonHandle_2 = SdkHandle_2<"overlay:polygon">;
declare type PolylineHandle = SdkHandle<"overlay:polyline">;
declare type PolylineHandle_2 = SdkHandle_2<"overlay:polyline">;
export declare function resolveMapContext(map?: unknown): MapContext;
declare interface ResourceRegistration<Resource = unknown> {
    readonly id: symbol;
    readonly type: string;
    readonly resource: Resource;
    readonly disposed: boolean;
    dispose(): void;
}
declare interface ResourceRegistration_2<Resource = unknown> {
    readonly id: symbol;
    readonly type: string;
    readonly resource: Resource;
    readonly disposed: boolean;
    dispose(): void;
}
declare interface ResourceRegistrationInput<Resource = unknown> {
    type: string;
    resource: Resource;
    scope: ResourceScope;
    remove: (resource: Resource) => void;
}
declare interface ResourceRegistrationInput_2<Resource = unknown> {
    type: string;
    resource: Resource;
    scope: ResourceScope_2;
    remove: (resource: Resource) => void;
}
declare class ResourceScope {
    readonly controller: AbortController;
    readonly label?: string;
    private readonly disposers;
    private _disposed;
    constructor(options?: ResourceScopeOptions);
    get signal(): AbortSignal;
    get isDisposed(): boolean;
    get size(): number;
    add(disposer: Disposer): Disposer;
    fork(label?: string): ResourceScope;
    dispose(reason?: unknown): void;
}
declare class ResourceScope_2 {
    readonly controller: AbortController;
    readonly label?: string;
    private readonly disposers;
    private _disposed;
    constructor(options?: ResourceScopeOptions_2);
    get signal(): AbortSignal;
    get isDisposed(): boolean;
    get size(): number;
    add(disposer: Disposer_2): Disposer_2;
    fork(label?: string): ResourceScope_2;
    dispose(reason?: unknown): void;
}
declare interface ResourceScopeOptions {
    label?: string;
}
declare interface ResourceScopeOptions_2 {
    label?: string;
}
declare type RidingRouteOptions = RouteRenderState;
declare type RidingRouteOptions_2 = RouteRenderState_2;
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
declare interface RouteRenderOptions_2 {
    map?: MapHandle_2;
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
declare interface RouteRenderState_2 {
    renderOptions?: RouteRenderOptions_2;
}
declare interface RouteResult<TPlan> {
    start: RouteEndpointInfo | null;
    end: RouteEndpointInfo | null;
    plans: readonly TPlan[];
    policy: number | null;
    transitType: number | null;
}
declare interface RouteState extends RouteRenderState {
    enableTraffic?: boolean;
}
declare interface RouteState_2 extends RouteRenderState_2 {
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
declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
declare interface SdkHandle_2<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND_2]: Kind;
    readonly raw: Raw;
}
declare type ServiceCallStatus = "success" | "empty" | "failed" | "timeout" | "canceled";
declare type ServiceCallStatus_2 = "success" | "empty" | "failed" | "timeout" | "canceled";
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
declare interface ServiceDriver_2 {
    createGeocoder(): ServiceHandle_2<"service:geocoder">;
    createConvertor(): ServiceHandle_2<"service:convertor">;
    createGeolocation(options?: Record<string, unknown>): ServiceHandle_2<"service:geolocation">;
    createLocalCity(): ServiceHandle_2<"service:local-city">;
    createBoundary(): ServiceHandle_2<"service:boundary">;
    createAutocomplete(options: AutocompleteOptions_2): ServiceHandle_2<"service:autocomplete">;
    createLocalSearch(location: string | Point_2 | MapHandle_2, options?: LocalSearchOptions_2): ServiceHandle_2<"service:local-search">;
    createDrivingRoute(location: string | Point_2 | MapHandle_2, options?: DrivingRouteOptions_2): ServiceHandle_2<"service:driving-route">;
    createWalkingRoute(location: string | Point_2 | MapHandle_2, options?: WalkingRouteOptions_2): ServiceHandle_2<"service:walking-route">;
    createRidingRoute(location: string | Point_2 | MapHandle_2, options?: RidingRouteOptions_2): ServiceHandle_2<"service:riding-route">;
    createTransitRoute(location: string | Point_2 | MapHandle_2, options?: TransitRouteOptions_2): ServiceHandle_2<"service:transit-route">;
    setAutocompleteOptions(handle: ServiceHandle_2<"service:autocomplete">, options: AutocompleteUpdateOptions_2): void;
    createViewAnimation(keyFrames: readonly Record<string, unknown>[], options?: Record<string, unknown>): ServiceHandle_2<"service:view-animation">;
    createTrackAnimation(map: MapHandle_2, path: readonly Point_2[], options?: Record<string, unknown>): ServiceHandle_2<"service:track-animation">;
}
declare interface ServiceErrorInfo {
    code: number | string | null;
    message: string;
}
declare interface ServiceErrorInfo_2 {
    code: number | string | null;
    message: string;
}
declare type ServiceHandle<Kind extends string = "service"> = SdkHandle<Kind>;
declare type ServiceHandle_2<Kind extends string = "service"> = SdkHandle_2<Kind>;
declare interface ServiceResult<T> {
    readonly status: ServiceCallStatus;
    readonly data: T | null;
    readonly error: ServiceErrorInfo | null;
    readonly sdkStatus: number | null;
}
declare interface Size {
    width: number;
    height: number;
}
declare interface Size_2 {
    width: number;
    height: number;
}
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
declare const TransitPolicy_2_2: {
    readonly RECOMMEND: 0;
    readonly LEAST_TRANSFER: 1;
    readonly LEAST_WALKING: 2;
    readonly AVOID_SUBWAYS: 3;
    readonly LEAST_TIME: 4;
    readonly FIRST_SUBWAYS: 5;
};
declare type TransitPolicy_2_2 = (typeof TransitPolicy_2_2)[keyof typeof TransitPolicy_2_2];
declare interface TransitRouteOptions extends RouteState {
    policy?: TransitPolicy_2;
    intercityPolicy?: IntercityPolicy_2;
    transitTypePolicy?: TransitVehiclePolicy;
    pageCapacity?: number;
}
declare interface TransitRouteOptions_2 extends RouteState_2 {
    policy?: TransitPolicy_2_2;
    intercityPolicy?: IntercityPolicy_2_2;
    transitTypePolicy?: TransitVehiclePolicy_2;
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
declare type TransitRouteResult = RouteResult<TransitRoutePlan>;
declare type TransitRouteSegment = TransitLineSegment | TransitWalkSegment;
declare const TransitVehiclePolicy: {
    readonly TRAIN: 0;
    readonly AIRPLANE: 1;
    readonly COACH: 2;
};
declare type TransitVehiclePolicy = (typeof TransitVehiclePolicy)[keyof typeof TransitVehiclePolicy];
declare const TransitVehiclePolicy_2: {
    readonly TRAIN: 0;
    readonly AIRPLANE: 1;
    readonly COACH: 2;
};
declare type TransitVehiclePolicy_2 = (typeof TransitVehiclePolicy_2)[keyof typeof TransitVehiclePolicy_2];
declare interface TransitWalkSegment {
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
    error: Readonly<ShallowRef<ServiceErrorInfo_2 | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus_2>>;
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
    error: Readonly<ShallowRef<ServiceErrorInfo_2 | null>>;
    isError: ComputedRef<boolean>;
    isEmpty: ComputedRef<boolean>;
    status: Readonly<ShallowRef<BMapServiceStatus_2>>;
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
    status: ShallowRef<MapStatus_2>;
    map: ShallowRef<MapHandle_2 | null>;
    client: ShallowRef<BMapClient_2 | null>;
    error: ShallowRef<unknown>;
    whenReady: (signal?: AbortSignal) => Promise<MapReadyContext>;
};
export declare function useMapContext(): MapContext_2;
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
declare type ViewAnimationCancelOutcome = "canceled" | "deferred" | "already-settled";
declare type ViewAnimationCancelOutcome_2 = "canceled" | "deferred" | "already-settled";
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
declare type WalkingRouteOptions = RouteRenderState;
declare type WalkingRouteOptions_2 = RouteRenderState_2;
declare type WalkingRouteResult = RouteResult<RoutePlan>;
declare type WildCardEventHandlerList<T = Record<string, unknown>> = Array<WildcardHandler<T>>;
declare type WildCardEventHandlerList_2<T = Record<string, unknown>> = Array<WildcardHandler_2<T>>;
declare type WildcardHandler<T = Record<string, unknown>> = (type: keyof T, event: T[keyof T]) => void;
declare type WildcardHandler_2<T = Record<string, unknown>> = (type: keyof T, event: T[keyof T]) => void;
export {};
```
