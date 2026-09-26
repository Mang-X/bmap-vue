## API Signature Baseline for "bmap-vue" (entry `./ui-kit`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/ui-kit.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> 这个出口同时有 API report 与 forgotten-export 身份集合；本快照是第三层：
> report 对未导出类型只留 `typeof getXxx` 名字引用、集合只记符号名，
> **同名结构**的漂移只有这里看得见（ADR 2026-09-25 决策 5 / #159 三轮评审 P1）。

```ts
import { ComponentOptionsMixin } from "vue";
import { ComponentProvideOptions } from "vue";
import { DefineComponent } from "vue";
import { PublicProps } from "vue";
import { Ref } from "vue";
import { ShallowRef } from "vue";
export declare class BMapError extends Error {
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
export declare type BMapErrorCode = "BMAP_SDK_LOAD_FAILED" | "BMAP_SDK_LOAD_TIMEOUT" | "BMAP_SDK_CONFIG_CONFLICT" | "BMAP_SDK_ENGINE_MISMATCH" | "BMAP_PROVIDER_ABORTED" | "BMAP_RUNTIME_DISPOSED" | "BMAP_RESOURCE_DISPOSED" | "BMAP_PARENT_CONTEXT_MISSING" | "BMAP_RESOURCE_CREATE_FAILED" | "BMAP_RESOURCE_UPDATE_FAILED" | "BMAP_PLUGIN_LOAD_FAILED" | "BMAP_PLUGIN_UNKNOWN" | "BMAP_CAPABILITY_UNSUPPORTED" | "BMAP_SDK_CALL_FAILED" | "BMAP_SERVICE_FAILED" | "BMAP_INVALID_ARGUMENT" | "BMAP_INVALID_POINT" | "BMAP_HANDLE_FOREIGN" | "BMAP_DUPLICATE_ITEM_KEY" | "BMAP_UI_KIT_UNAVAILABLE";
export declare interface BMapErrorOptions {
    cause?: unknown;
    mapId?: symbol | string;
    component?: string;
    plugin?: string;
    capability?: string;
    engine?: string;
    version?: string;
}
export declare function isUiKitLoaded(): boolean;
export declare function loadUiKit(): Promise<UiKitModule>;
export declare const PlaceAutocomplete: DefineComponent<PlaceAutocompleteProps, {
    status: UiKitWidgetStatus;
    search(keyword: string): Promise<void>;
    setInputValue(value: string): Promise<void>;
    getInputValue(): Promise<string>;
    setLocation(location: string): Promise<void>;
    setCitylimit(citylimit: boolean): Promise<void>;
    setTypes(types: "all" | "city"): Promise<void>;
    show(): Promise<void>;
    hide(): Promise<void>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    select: (suggestion: PlaceSuggestionDTO) => any;
    highlight: (change: PlaceHighlightChangeDTO) => any;
    suggest: (suggestions: PlaceSuggestionDTO[]) => any;
}, string, PublicProps, Readonly<PlaceAutocompleteProps> & Readonly<{
    onSelect?: ((suggestion: PlaceSuggestionDTO) => any) | undefined;
    onHighlight?: ((change: PlaceHighlightChangeDTO) => any) | undefined;
    onSuggest?: ((suggestions: PlaceSuggestionDTO[]) => any) | undefined;
}>, {
    citylimit: boolean;
    showSuggestion: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface PlaceAutocompleteDisplayDTO {
    address?: boolean;
    district?: boolean;
    tag?: boolean;
}
export declare interface PlaceAutocompleteExpose {
    readonly status: UiKitWidgetStatus;
    search(keyword: string): Promise<void>;
    setInputValue(value: string): Promise<void>;
    getInputValue(): Promise<string>;
    setLocation(location: string): Promise<void>;
    setCitylimit(citylimit: boolean): Promise<void>;
    setTypes(types: "all" | "city"): Promise<void>;
    show(): Promise<void>;
    hide(): Promise<void>;
}
export declare interface PlaceAutocompleteProps {
    placeholder?: string;
    debounce?: number;
    location?: string;
    citylimit?: boolean;
    types?: "all" | "city";
    minLength?: number;
    showSuggestion?: boolean;
    suggestionCount?: number;
    display?: PlaceAutocompleteDisplayDTO;
}
export declare interface PlaceBoundsDTO {
    sw: PlacePointDTO;
    ne: PlacePointDTO;
}
export declare const PlaceDetail: DefineComponent<PlaceDetailProps, {
    status: UiKitWidgetStatus;
    setPlace(uidOrPoi: PlaceDetailPlaceInput): Promise<void>;
    clear(): Promise<void>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    load: (detail: PlaceDetailDTO) => any;
}, string, PublicProps, Readonly<PlaceDetailProps> & Readonly<{
    onLoad?: ((detail: PlaceDetailDTO) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface PlaceDetailDisplayDTO {
    image?: boolean;
    title?: boolean;
    address?: boolean;
    type?: boolean;
    phone?: boolean;
    rating?: boolean;
    openingHours?: boolean;
    comment?: boolean;
    price?: boolean;
    rank?: boolean;
    tag?: boolean;
    openmap?: boolean;
}
export declare interface PlaceDetailDTO {
    title: string;
    address: string;
    uid?: string;
    point?: PlacePointDTO;
    tel?: string;
}
export declare interface PlaceDetailExpose {
    readonly status: UiKitWidgetStatus;
    setPlace(uidOrPoi: PlaceDetailPlaceInput): Promise<void>;
    clear(): Promise<void>;
}
export declare type PlaceDetailPlaceInput = string | PlaceDetailPlaceObject;
export declare type PlaceDetailPlaceObject = object;
export declare interface PlaceDetailProps {
    uid?: string;
    display?: PlaceDetailDisplayDTO;
}
export declare interface PlaceHighlightChangeDTO {
    from: PlaceHighlightDTO | null;
    to: PlaceHighlightDTO;
}
export declare interface PlaceHighlightDTO {
    index: number;
    value: PlaceSuggestionDTO;
}
export declare interface PlacePoiDTO {
    title: string;
    address: string;
    uid?: string;
    tel?: string;
    point?: PlacePointDTO;
}
export declare interface PlacePointDTO {
    lng: number;
    lat: number;
}
export declare const PlaceSearch: DefineComponent<PlaceSearchProps, {
    status: UiKitWidgetStatus;
    search(keyword: string, option?: {
        city?: string;
    }): Promise<void>;
    searchNearby(keyword: string, center: PlacePointDTO, radius?: number): Promise<void>;
    searchInBounds(keyword: string, bounds: PlaceBoundsDTO): Promise<void>;
    prevPage(): Promise<void>;
    nextPage(): Promise<void>;
    goToPage(page: number): Promise<void>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    load: (pois: PlacePoiDTO[]) => any;
    select: (poi: PlacePoiDTO) => any;
}, string, PublicProps, Readonly<PlaceSearchProps> & Readonly<{
    onLoad?: ((pois: PlacePoiDTO[]) => any) | undefined;
    onSelect?: ((poi: PlacePoiDTO) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface PlaceSearchDisplayDTO {
    image?: boolean;
    title?: boolean;
    address?: boolean;
    type?: boolean;
    phone?: boolean;
    rating?: boolean;
    openingHours?: boolean;
    comment?: boolean;
    price?: boolean;
    rank?: boolean;
    tag?: boolean;
}
export declare interface PlaceSearchExpose {
    readonly status: UiKitWidgetStatus;
    search(keyword: string, option?: {
        city?: string;
    }): Promise<void>;
    searchNearby(keyword: string, center: PlacePointDTO, radius?: number): Promise<void>;
    searchInBounds(keyword: string, bounds: PlaceBoundsDTO): Promise<void>;
    prevPage(): Promise<void>;
    nextPage(): Promise<void>;
    goToPage(page: number): Promise<void>;
}
export declare interface PlaceSearchProps {
    pageCapacity?: number;
    pageNum?: number;
    display?: PlaceSearchDisplayDTO;
}
export declare interface PlaceSuggestionDTO {
    name: string;
    province: string;
    city: string;
    district: string;
    business: string;
    address: string;
    tag?: string;
    uid?: string;
    point?: PlacePointDTO;
}
export declare interface RouteDriveSegmentDTO extends RouteSegmentBaseDTO {
    type: "drive";
    description: string;
    location: PlacePointDTO;
    roadName?: string;
}
export declare const RoutePlan: DefineComponent<RoutePlanProps, {
    status: UiKitWidgetStatus;
    search(options: RoutePlanSearchOptionsDTO): Promise<RoutePlanResultDTO>;
    clear(): Promise<void>;
    getCurrentType(): Promise<RoutePlanMode>;
    getLastResult(): Promise<RoutePlanResultDTO | null>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    error: (error: BMapError) => any;
    clear: () => any;
    result: (result: RoutePlanResultDTO) => any;
    typechange: (change: RoutePlanTypeChangeDTO) => any;
    planselect: (selected: RoutePlanPlanSelectDTO) => any;
    navclick: (click: RoutePlanNavClickDTO) => any;
}, string, PublicProps, Readonly<RoutePlanProps> & Readonly<{
    onError?: ((error: BMapError) => any) | undefined;
    onClear?: (() => any) | undefined;
    onResult?: ((result: RoutePlanResultDTO) => any) | undefined;
    onTypechange?: ((change: RoutePlanTypeChangeDTO) => any) | undefined;
    onPlanselect?: ((selected: RoutePlanPlanSelectDTO) => any) | undefined;
    onNavclick?: ((click: RoutePlanNavClickDTO) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface RoutePlanDrivingOptionsDTO {
    policy?: RoutePlanDrivingPolicy;
    alternatives?: number;
}
export declare const RoutePlanDrivingPolicy: {
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
};
export declare type RoutePlanDrivingPolicy = (typeof RoutePlanDrivingPolicy)[keyof typeof RoutePlanDrivingPolicy];
export declare interface RoutePlanDTO {
    distance: number;
    distanceText: string;
    duration: number;
    durationText: string;
    segments: RouteSegmentDTO[];
    toll?: number;
    tollDistance?: number;
    trafficLights?: number;
    tag?: string;
    waypoints?: string[];
    transitType?: number;
    walkDistance?: string;
    path?: PlacePointDTO[];
}
export declare type RoutePlanEndpointInput = PlacePointDTO | string;
export declare interface RoutePlanExpose {
    readonly status: UiKitWidgetStatus;
    search(options: RoutePlanSearchOptionsDTO): Promise<RoutePlanResultDTO>;
    clear(): Promise<void>;
    getCurrentType(): Promise<RoutePlanMode>;
    getLastResult(): Promise<RoutePlanResultDTO | null>;
}
export declare type RoutePlanMode = "driving" | "transit" | "riding" | "walking";
export declare interface RoutePlanNavClickDTO {
    type: RoutePlanMode;
    result: RoutePlanResultDTO | null;
    planIndex: number;
    plan?: RoutePlanDTO;
}
export declare interface RoutePlanPlanSelectDTO {
    type: RoutePlanMode;
    planIndex: number;
    plan: RoutePlanDTO;
}
export declare interface RoutePlanProps {
    drivingOptions?: RoutePlanDrivingOptionsDTO;
}
export declare interface RoutePlanResultDTO {
    type: RoutePlanMode;
    start: RoutePointDTO;
    end: RoutePointDTO;
    plans: RoutePlanDTO[];
}
export declare interface RoutePlanSearchOptionsDTO {
    start: RoutePlanEndpointInput;
    end: RoutePlanEndpointInput;
    startName?: string;
    endName?: string;
    startUid?: string;
    endUid?: string;
    waypoints?: PlacePointDTO[];
}
export declare interface RoutePlanTypeChangeDTO {
    type: RoutePlanMode;
}
export declare interface RoutePointDTO {
    title: string;
    location: PlacePointDTO;
    city?: string;
    uid?: string;
}
export declare interface RouteRidingSegmentDTO extends RouteSegmentBaseDTO {
    type: "riding";
}
export declare interface RouteSegmentBaseDTO {
    type: RouteSegmentType;
    distance: number;
    distanceText: string;
    path?: PlacePointDTO[];
    description?: string;
    duration?: number;
}
export declare type RouteSegmentDTO = RouteDriveSegmentDTO | RouteWalkSegmentDTO | RouteTransitSegmentDTO | RouteRidingSegmentDTO;
export declare type RouteSegmentType = "drive" | "walk" | "transit" | "riding";
export declare interface RouteTransitSegmentDTO extends RouteSegmentBaseDTO {
    type: "transit";
    subType: RouteTransitSubType;
    lineName: string;
    onStop: string;
    offStop: string;
    stopCount: number;
}
export declare type RouteTransitSubType = "bus" | "subway" | "ferry" | "train" | "airplane" | "coach";
export declare interface RouteWalkSegmentDTO extends RouteSegmentBaseDTO {
    type: "walk";
}
export declare const UI_KIT_PACKAGE = "@baidumap/jsapi-ui-kit";
export declare const UI_KIT_STYLE_PATH = "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
export declare interface UiKitAutocompleteWidget extends UiKitWidgetHandle {
    search(keyword: string): void;
    setInputValue(value: string): void;
    getInputValue(): string;
    setLocation(location: string): void;
    setCitylimit(citylimit: boolean): void;
    setTypes(types: "all" | "city"): void;
    show(): void;
    hide(): void;
}
export declare interface UiKitModule {
    PlaceAutocomplete: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitAutocompleteWidget;
    PlaceSearch: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitSearchWidget;
    PlaceDetail: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitPlaceDetailWidget;
    RoutePlan: new (container: string | HTMLElement, options: UiKitWidgetOptions) => UiKitRoutePlanWidget;
    [exportedName: string]: unknown;
}
export declare interface UiKitPlaceDetailWidget extends UiKitWidgetHandle {
    setPlace(uidOrPoi: PlaceDetailPlaceInput): void;
    clear(): void;
}
export declare interface UiKitRoutePlanWidget extends UiKitWidgetHandle {
    search(options: object): Promise<unknown>;
    clear(): void;
    getCurrentType(): RoutePlanMode;
    getLastResult(): unknown;
}
export declare interface UiKitSearchWidget extends UiKitWidgetHandle {
    search(keyword: string, option?: {
        city?: string;
    }): Promise<void>;
    searchNearby(keyword: string, center: unknown, radius?: number): Promise<void>;
    searchInBounds(keyword: string, bounds: {
        sw: unknown;
        ne: unknown;
    }): Promise<void>;
    prevPage(): void;
    nextPage(): void;
    goToPage(page: number): void;
}
export declare interface UiKitSubscription {
    event: string;
    handler: (...args: unknown[]) => void;
}
export declare interface UiKitWidgetHandle {
    on(event: string, handler: (...args: unknown[]) => void): unknown;
    off(event: string, handler?: (...args: unknown[]) => void): unknown;
    destroy(): void;
}
export declare type UiKitWidgetOptions = Record<string, unknown> & {
    map: unknown;
};
export declare type UiKitWidgetStatus = "idle" | "loading" | "ready" | "error" | "disposed";
export declare function useUiKitWidget<TWidget extends UiKitWidgetHandle>(options: UseUiKitWidgetOptions<TWidget>): UseUiKitWidgetResult<TWidget>;
export declare interface UseUiKitWidgetOptions<TWidget extends UiKitWidgetHandle> {
    component: string;
    host: Ref<HTMLElement | null>;
    buildOptions: () => Record<string, unknown>;
    constructorOptions?: () => Record<string, unknown>;
    create: (module: UiKitModule, host: HTMLElement, options: UiKitWidgetOptions) => TWidget;
    bind?: (widget: TWidget) => readonly UiKitSubscription[];
}
export declare interface UseUiKitWidgetResult<TWidget extends UiKitWidgetHandle> {
    readonly widget: ShallowRef<TWidget | null>;
    readonly status: Ref<UiKitWidgetStatus>;
    withWidget<R>(run: (widget: TWidget) => R): Promise<Awaited<R>>;
    applyIfReady(run: (widget: TWidget) => void): void;
    rebuild(): void;
    toRawPoint(point: PlacePointDTO): Promise<unknown>;
}
export {};
```
