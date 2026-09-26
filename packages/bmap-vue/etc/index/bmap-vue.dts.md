## API Signature Baseline for "bmap-vue" (entry `.`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/index.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> API Extractor 分析不了这两个出口的 Volar `__VLS_` 悬空引用，
> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。

```ts
import { AllowedComponentProps } from "vue";
import { App } from "vue";
import { ComponentCustomProps } from "vue";
import { ComponentOptionsMixin } from "vue";
import { ComponentProvideOptions } from "vue";
import { ComputedRef } from "vue";
import { DefineComponent } from "vue";
import { InjectionKey } from "vue";
import { MaybeRefOrGetter } from "vue";
import { PublicProps } from "vue";
import { Ref } from "vue";
import { ShallowRef } from "vue";
import { ShallowUnwrapRef } from "vue";
import { VNode } from "vue";
import { VNodeProps } from "vue";
declare const __VLS_component: DefineComponent<BMapProviderProps, {
    status: ComputedRef<ClientStatus>;
    client: ComputedRef<BMapClient | null>;
    error: ComputedRef<BMapError | null>;
    load: (signal?: AbortSignal) => Promise<BMapClient>;
    retry: typeof retry;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    error: (error: BMapError) => any;
    ready: (client: BMapClient) => any;
}, string, PublicProps, Readonly<BMapProviderProps> & Readonly<{
    onError?: ((error: BMapError) => any) | undefined;
    onReady?: ((client: BMapClient) => any) | undefined;
}>, {
    autoLoad: boolean;
    suspense: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_10: DefineComponent<ContextMenuProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    select: (event: ContextMenuSelectPayload) => any;
    close: (event: OverlayPartialPointerEvent) => any;
    open: (event: OverlayPartialPointerEvent) => any;
}, string, PublicProps, Readonly<ContextMenuProps> & Readonly<{
    onSelect?: ((event: ContextMenuSelectPayload) => any) | undefined;
    onClose?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onOpen?: ((event: OverlayPartialPointerEvent) => any) | undefined;
}>, {
    width: number;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_11: DefineComponent<CustomOverlayProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
}, string, PublicProps, Readonly<CustomOverlayProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
}>, {
    offset: {
        x: number;
        y: number;
    };
    zIndex: number;
    rotation: number;
    enableMassClear: boolean;
    anchor: {
        x: number;
        y: number;
    };
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_12: DefineComponent<PrismProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<PrismProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    enableMassClear: boolean;
    visible: boolean;
    isBoundary: boolean;
    autoCenter: boolean;
    topFillColor: string;
    topFillOpacity: number;
    sideFillColor: string;
    sideFillOpacity: number;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_13: DefineComponent<GroundOverlayProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPartialPointerEvent) => any;
    dblclick: (event: OverlayPartialPointerEvent) => any;
    mousedown: (event: OverlayPartialPointerEvent) => any;
    mousemove: (event: OverlayPartialPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPartialPointerEvent) => any;
    mouseup: (event: OverlayPartialPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPartialPointerEvent) => any;
    rightdblclick: (event: OverlayPartialPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<GroundOverlayProps> & Readonly<{
    onClick?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    visible: boolean;
    opacity: number;
    autoCenter: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_14: DefineComponent<BezierCurveProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<BezierCurveProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    enableMassClear: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_15: DefineComponent<MapMaskProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (e: unknown) => any;
    dblclick: (e: unknown) => any;
    mousedown: (e: unknown) => any;
    mouseout: (e: unknown) => any;
    mouseover: (e: unknown) => any;
    mouseup: (e: unknown) => any;
    rightclick: (e: unknown) => any;
}, string, PublicProps, Readonly<MapMaskProps> & Readonly<{
    onClick?: ((e: unknown) => any) | undefined;
    onDblclick?: ((e: unknown) => any) | undefined;
    onMousedown?: ((e: unknown) => any) | undefined;
    onMouseout?: ((e: unknown) => any) | undefined;
    onMouseover?: ((e: unknown) => any) | undefined;
    onMouseup?: ((e: unknown) => any) | undefined;
    onRightclick?: ((e: unknown) => any) | undefined;
}>, {
    visible: boolean;
    showRegion: MapMaskShowRegion;
    isBuildingMask: boolean;
    isMapMask: boolean;
    isPoiMask: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_16: DefineComponent<Marker3DProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (e: unknown) => any;
    dblclick: (e: unknown) => any;
    mousedown: (e: unknown) => any;
    mouseout: (e: unknown) => any;
    mouseover: (e: unknown) => any;
    mouseup: (e: unknown) => any;
    remove: (e: unknown) => any;
    rightclick: (e: unknown) => any;
}, string, PublicProps, Readonly<Marker3DProps> & Readonly<{
    onClick?: ((e: unknown) => any) | undefined;
    onDblclick?: ((e: unknown) => any) | undefined;
    onMousedown?: ((e: unknown) => any) | undefined;
    onMouseout?: ((e: unknown) => any) | undefined;
    onMouseover?: ((e: unknown) => any) | undefined;
    onMouseup?: ((e: unknown) => any) | undefined;
    onRemove?: ((e: unknown) => any) | undefined;
    onRightclick?: ((e: unknown) => any) | undefined;
}>, {
    fillColor: string;
    fillOpacity: number;
    enableMassClear: boolean;
    visible: boolean;
    size: number;
    shape: Marker3dShape;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_17: DefineComponent<PanoramaControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<PanoramaControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_18: DefineComponent<CustomControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<CustomControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_19: DefineComponent<ZoomControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<ZoomControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_2: DefineComponent<MapProps, {
    getContainer(): HTMLElement | null;
    isContainerReady(): boolean;
    checkResize(): void;
    getMapInstance(): MapHandle | null;
    whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
    whenMapCreated(callback: (ready: MapReadyContext) => void): () => void;
    isTearingDown(): boolean;
    retry(): Promise<MapReadyContext>;
    suspend(reason?: MapSuspendReason): void;
    resume(reason?: MapSuspendReason): void;
    isSuspended(): boolean;
    suspendReasons(): readonly string[];
    resetView(): void;
    setDragging(enabled: boolean): void;
    prefersReducedMotion(): boolean;
    getCenter(): Point | null;
    getZoom(): number | null;
    getHeading(): number | null;
    getTilt(): number | null;
    getBounds(): Bounds | null;
    getSize(): Size | null;
    setCenter(center: Point): void;
    setZoom(zoom: number): void;
    setHeading(heading: number): void;
    setTilt(tilt: number): void;
    panTo(point: Point): void;
    panBy(pixel: Pixel): void;
    fitBounds(bounds: Bounds): void;
    supports(capability: Capability): boolean;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    error: (err: unknown) => any;
    load: (event: MapLoadPayload) => any;
    click: (event: MapPointerEvent) => any;
    dblclick: (event: MapPointerEvent) => any;
    dragend: (event: MapPointerEvent) => any;
    dragstart: (event: MapPointerEvent) => any;
    mousedown: (event: MapPointerEvent) => any;
    mousemove: (event: MapPointerEvent) => any;
    mouseout: (event: MapPointerEvent) => any;
    mouseover: (event: MapPointerEvent) => any;
    mouseup: (event: MapPointerEvent) => any;
    resize: (event: MapResizePayload) => any;
    touchend: (event: MapPointerEvent) => any;
    touchmove: (event: MapPointerEvent) => any;
    touchstart: (event: MapPointerEvent) => any;
    ready: (payload: MapReadyPayload) => any;
    destroy: (event: MapEventPayload) => any;
    dragging: (event: MapPointerEvent) => any;
    maptypechange: (event: MapTypeChangePayload) => any;
    rightclick: (event: MapPointerEvent) => any;
    rightdblclick: (event: MapPointerEvent) => any;
    mousewheel: (event: MapPointerEvent) => any;
    zoomexceeded: (event: MapEventPayload) => any;
    movestart: (event: MapEventPayload) => any;
    moving: (event: MapEventPayload) => any;
    moveend: (event: MapEventPayload) => any;
    zoomstart: (event: MapEventPayload) => any;
    zooming: (event: MapEventPayload) => any;
    zoomend: (event: MapEventPayload) => any;
    beforeaddoverlay: (event: MapEventPayload) => any;
    addoverlay: (event: MapEventPayload) => any;
    removeoverlay: (event: MapEventPayload) => any;
    clearoverlays: (event: MapEventPayload) => any;
    addcontrol: (event: MapEventPayload) => any;
    removecontrol: (event: MapEventPayload) => any;
    addcontextmenu: (event: MapEventPayload) => any;
    removecontextmenu: (event: MapEventPayload) => any;
    "style-willchange": (event: MapEventPayload) => any;
    style_willchange: (event: MapEventPayload) => any;
    "style-loaded": (event: MapEventPayload) => any;
    style_loaded: (event: MapEventPayload) => any;
    "style-loaded-error": (event: MapEventPayload) => any;
    style_loaded_error: (event: MapEventPayload) => any;
    "style-loaded-timeout": (event: MapEventPayload) => any;
    style_loaded_timeout: (event: MapEventPayload) => any;
    "language-change": (event: MapEventPayload) => any;
    language_change: (event: MapEventPayload) => any;
    tilesloaded: (event: MapEventPayload) => any;
    headingchange: (event: MapEventPayload) => any;
    tiltchange: (event: MapEventPayload) => any;
    "plugin-ready": (name: string) => any;
    "plugin-error": (payload: {
        name: string;
        error: unknown;
    }) => any;
    unload: () => any;
    "update:center": (value: Point) => any;
    "update:zoom": (value: number) => any;
    "update:heading": (value: number) => any;
    "update:tilt": (value: number) => any;
}, string, PublicProps, Readonly<MapProps> & Readonly<{
    onError?: ((err: unknown) => any) | undefined;
    onLoad?: ((event: MapLoadPayload) => any) | undefined;
    onClick?: ((event: MapPointerEvent) => any) | undefined;
    onDblclick?: ((event: MapPointerEvent) => any) | undefined;
    onDragend?: ((event: MapPointerEvent) => any) | undefined;
    onDragstart?: ((event: MapPointerEvent) => any) | undefined;
    onMousedown?: ((event: MapPointerEvent) => any) | undefined;
    onMousemove?: ((event: MapPointerEvent) => any) | undefined;
    onMouseout?: ((event: MapPointerEvent) => any) | undefined;
    onMouseover?: ((event: MapPointerEvent) => any) | undefined;
    onMouseup?: ((event: MapPointerEvent) => any) | undefined;
    onResize?: ((event: MapResizePayload) => any) | undefined;
    onTouchend?: ((event: MapPointerEvent) => any) | undefined;
    onTouchmove?: ((event: MapPointerEvent) => any) | undefined;
    onTouchstart?: ((event: MapPointerEvent) => any) | undefined;
    onReady?: ((payload: MapReadyPayload) => any) | undefined;
    onDestroy?: ((event: MapEventPayload) => any) | undefined;
    onDragging?: ((event: MapPointerEvent) => any) | undefined;
    onMaptypechange?: ((event: MapTypeChangePayload) => any) | undefined;
    onRightclick?: ((event: MapPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: MapPointerEvent) => any) | undefined;
    onMousewheel?: ((event: MapPointerEvent) => any) | undefined;
    onZoomexceeded?: ((event: MapEventPayload) => any) | undefined;
    onMovestart?: ((event: MapEventPayload) => any) | undefined;
    onMoving?: ((event: MapEventPayload) => any) | undefined;
    onMoveend?: ((event: MapEventPayload) => any) | undefined;
    onZoomstart?: ((event: MapEventPayload) => any) | undefined;
    onZooming?: ((event: MapEventPayload) => any) | undefined;
    onZoomend?: ((event: MapEventPayload) => any) | undefined;
    onBeforeaddoverlay?: ((event: MapEventPayload) => any) | undefined;
    onAddoverlay?: ((event: MapEventPayload) => any) | undefined;
    onRemoveoverlay?: ((event: MapEventPayload) => any) | undefined;
    onClearoverlays?: ((event: MapEventPayload) => any) | undefined;
    onAddcontrol?: ((event: MapEventPayload) => any) | undefined;
    onRemovecontrol?: ((event: MapEventPayload) => any) | undefined;
    onAddcontextmenu?: ((event: MapEventPayload) => any) | undefined;
    onRemovecontextmenu?: ((event: MapEventPayload) => any) | undefined;
    "onStyle-willchange"?: ((event: MapEventPayload) => any) | undefined;
    onStyle_willchange?: ((event: MapEventPayload) => any) | undefined;
    "onStyle-loaded"?: ((event: MapEventPayload) => any) | undefined;
    onStyle_loaded?: ((event: MapEventPayload) => any) | undefined;
    "onStyle-loaded-error"?: ((event: MapEventPayload) => any) | undefined;
    onStyle_loaded_error?: ((event: MapEventPayload) => any) | undefined;
    "onStyle-loaded-timeout"?: ((event: MapEventPayload) => any) | undefined;
    onStyle_loaded_timeout?: ((event: MapEventPayload) => any) | undefined;
    "onLanguage-change"?: ((event: MapEventPayload) => any) | undefined;
    onLanguage_change?: ((event: MapEventPayload) => any) | undefined;
    onTilesloaded?: ((event: MapEventPayload) => any) | undefined;
    onHeadingchange?: ((event: MapEventPayload) => any) | undefined;
    onTiltchange?: ((event: MapEventPayload) => any) | undefined;
    "onPlugin-ready"?: ((name: string) => any) | undefined;
    "onPlugin-error"?: ((payload: {
        name: string;
        error: unknown;
    }) => any) | undefined;
    onUnload?: (() => any) | undefined;
    "onUpdate:center"?: ((value: Point) => any) | undefined;
    "onUpdate:zoom"?: ((value: number) => any) | undefined;
    "onUpdate:heading"?: ((value: number) => any) | undefined;
    "onUpdate:tilt"?: ((value: number) => any) | undefined;
}>, {
    enableDragging: boolean;
    width: string | number;
    height: string | number;
    minZoom: number;
    maxZoom: number;
    mapType: string;
    enableScrollWheelZoom: boolean;
    noAnimation: boolean;
    keepAliveBehavior: "suspend" | "dispose";
    enableAutoResize: boolean;
    loadingBgColor: string;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_20: DefineComponent<NavigationControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<NavigationControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
    showZoomInfo: boolean;
    enableGeolocation: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_21: DefineComponent<MapTypeControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<MapTypeControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
    showStreetLayer: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_22: DefineComponent<OverviewMapControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<OverviewMapControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
    isOpen: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_23: DefineComponent<ScaleControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<ScaleControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_24: DefineComponent<CityListControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<CityListControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
    expand: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_25: DefineComponent<LocationControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    locationSuccess: (e: unknown) => any;
    locationError: (e: unknown) => any;
}, string, PublicProps, Readonly<LocationControlProps> & Readonly<{
    onLocationSuccess?: ((e: unknown) => any) | undefined;
    onLocationError?: ((e: unknown) => any) | undefined;
}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_26: DefineComponent<NavigationControl3DProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<NavigationControl3DProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_27: DefineComponent<CopyrightControlProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<CopyrightControlProps> & Readonly<{}>, {
    offset: {
        x: number;
        y: number;
    };
    anchor: string;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_28: DefineComponent<DistrictLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (e: unknown) => any;
    mouseout: (e: unknown) => any;
    mouseover: (e: unknown) => any;
}, string, PublicProps, Readonly<DistrictLayerProps> & Readonly<{
    onClick?: ((e: unknown) => any) | undefined;
    onMouseout?: ((e: unknown) => any) | undefined;
    onMouseover?: ((e: unknown) => any) | undefined;
}>, {
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    fillColor: string;
    fillOpacity: number;
    visible: boolean;
    viewport: boolean;
    kind: DistrictType_2;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_29: DefineComponent<PanoramaCoverageLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<PanoramaCoverageLayerProps> & Readonly<{}>, {
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_3: DefineComponent<MarkerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    dragend: (event: OverlayPointerEvent) => any;
    dragstart: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    dragging: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    "update:position": (event: Point) => any;
}, string, PublicProps, Readonly<MarkerProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDragend?: ((event: OverlayPointerEvent) => any) | undefined;
    onDragstart?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onDragging?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    "onUpdate:position"?: ((event: Point) => any) | undefined;
}>, {
    title: string;
    offset: {
        x: number;
        y: number;
    };
    enableClicking: boolean;
    enableDragging: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_30: DefineComponent<TileLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<TileLayerProps> & Readonly<{}>, {
    visible: boolean;
    retry: boolean;
    transparentPng: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_31: DefineComponent<TrafficLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<TrafficLayerProps> & Readonly<{}>, {
    visible: boolean;
    edge: boolean;
    autoRefresh: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_32: DefineComponent<GeoJSONLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (e: unknown) => any;
    mousemove: (e: unknown) => any;
    mouseout: (e: unknown) => any;
}, string, PublicProps, Readonly<GeoJSONLayerProps> & Readonly<{
    onClick?: ((e: unknown) => any) | undefined;
    onMousemove?: ((e: unknown) => any) | undefined;
    onMouseout?: ((e: unknown) => any) | undefined;
}>, {
    visible: boolean;
    layerName: string;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_33: DefineComponent<DOMLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<DOMLayerProps> & Readonly<{}>, {
    visible: boolean;
    enableDraggingMap: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_34: DefineComponent<XYZLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<XYZLayerProps> & Readonly<{}>, {
    visible: boolean;
    extentCRSIsWGS84: boolean;
    useThumbData: boolean;
    tms: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_35: DefineComponent<WMSLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<WMSLayerProps> & Readonly<{}>, {
    visible: boolean;
    retry: boolean;
    extentCRSIsWGS84: boolean;
    useThumbData: boolean;
    reproject: boolean;
    png8: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_36: DefineComponent<WMTSLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<WMTSLayerProps> & Readonly<{}>, {
    visible: boolean;
    retry: boolean;
    extentCRSIsWGS84: boolean;
    useThumbData: boolean;
    reproject: boolean;
    png8: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_37: DefineComponent<RasterTileLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<RasterTileLayerProps> & Readonly<{}>, {
    visible: boolean;
    retry: boolean;
    useThumbData: boolean;
    boundsInWGS84: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_38: DefineComponent<MVTLayerProps, {
    featureState: FeatureStateApi<"string">;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (e: MVTLayerPickEvent) => any;
    dblclick: (e: MVTLayerPickEvent) => any;
    mousemove: (e: MVTLayerMouseMoveEvent) => any;
    mouseout: (e: MVTLayerMouseEvent) => any;
    tilesloadstart: (e: MVTLayerBaseEvent) => any;
    tilesloadend: (e: MVTLayerBaseEvent) => any;
}, string, PublicProps, Readonly<MVTLayerProps> & Readonly<{
    onClick?: ((e: MVTLayerPickEvent) => any) | undefined;
    onDblclick?: ((e: MVTLayerPickEvent) => any) | undefined;
    onMousemove?: ((e: MVTLayerMouseMoveEvent) => any) | undefined;
    onMouseout?: ((e: MVTLayerMouseEvent) => any) | undefined;
    onTilesloadstart?: ((e: MVTLayerBaseEvent) => any) | undefined;
    onTilesloadend?: ((e: MVTLayerBaseEvent) => any) | undefined;
}>, {
    visible: boolean;
    noCollision: boolean;
    useThumb: boolean;
    encrypt: boolean;
    onclick: (e: MVTLayerPickEvent) => void;
    ondblclick: (e: MVTLayerPickEvent) => void;
    onmousemove: (e: MVTLayerMouseMoveEvent) => void;
    onmouseout: (e: MVTLayerMouseEvent) => void;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_39: DefineComponent<LineLayerProps, {
    featureState: FeatureStateApi<"default">;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (pick: FeaturePick) => any;
    dblclick: (pick: FeaturePick) => any;
    mousemove: (pick: FeaturePick) => any;
    rightclick: (pick: FeaturePick) => any;
}, string, PublicProps, Readonly<LineLayerProps> & Readonly<{
    onClick?: ((pick: FeaturePick) => any) | undefined;
    onDblclick?: ((pick: FeaturePick) => any) | undefined;
    onMousemove?: ((pick: FeaturePick) => any) | undefined;
    onRightclick?: ((pick: FeaturePick) => any) | undefined;
}>, {
    visible: boolean;
    enablePicked: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_4: DefineComponent<InfoWindowProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    close: () => any;
    destroy: (event: number) => any;
    rebuild: (event: number) => any;
    open: () => any;
    clickclose: (event: unknown) => any;
    maximize: (event: unknown) => any;
    restore: (event: unknown) => any;
    "update:open": (event: boolean) => any;
}, string, PublicProps, Readonly<InfoWindowProps> & Readonly<{
    onClose?: (() => any) | undefined;
    onDestroy?: ((event: number) => any) | undefined;
    onRebuild?: ((event: number) => any) | undefined;
    onOpen?: (() => any) | undefined;
    onClickclose?: ((event: unknown) => any) | undefined;
    onMaximize?: ((event: unknown) => any) | undefined;
    onRestore?: ((event: unknown) => any) | undefined;
    "onUpdate:open"?: ((event: boolean) => any) | undefined;
}>, {
    title: string;
    offset: Pixel;
    width: number;
    height: number;
    enableMaximize: boolean;
    enableAutoPan: boolean;
    enableCloseOnClick: boolean;
    open: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_40: DefineComponent<FillLayerProps, {
    featureState: FeatureStateApi<"default">;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (pick: FeaturePick) => any;
    dblclick: (pick: FeaturePick) => any;
    mousemove: (pick: FeaturePick) => any;
    rightclick: (pick: FeaturePick) => any;
}, string, PublicProps, Readonly<FillLayerProps> & Readonly<{
    onClick?: ((pick: FeaturePick) => any) | undefined;
    onDblclick?: ((pick: FeaturePick) => any) | undefined;
    onMousemove?: ((pick: FeaturePick) => any) | undefined;
    onRightclick?: ((pick: FeaturePick) => any) | undefined;
}>, {
    visible: boolean;
    border: boolean;
    enablePicked: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_41: DefineComponent<HeatmapLayerProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<HeatmapLayerProps> & Readonly<{}>, {
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_42: DefineComponent<TrackLineLayerProps, {
    playback: TrackLinePlaybackApi;
    observed: TrackLineObserved | null;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    progress: (observed: TrackLineObserved) => any;
    statuschange: (observed: TrackLineObserved) => any;
}, string, PublicProps, Readonly<TrackLineLayerProps> & Readonly<{
    onProgress?: ((observed: TrackLineObserved) => any) | undefined;
    onStatuschange?: ((observed: TrackLineObserved) => any) | undefined;
}>, {
    visible: boolean;
    pauseOnHidden: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_43: DefineComponent<PanoramaProps, {
    whenReady: (signal?: AbortSignal) => Promise<PanoramaReadyContext>;
    viewer: Readonly<ShallowRef<PanoramaHandle | null>>;
    status: Readonly<ShallowRef<PanoramaStatus>>;
    error: Readonly<ShallowRef<BMapError | null>>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    error: (event: unknown) => any;
    load: (event: unknown) => any;
    positionChange: (position: Point | null) => any;
    povChange: (pov: PanoramaPov | null) => any;
    zoomChange: (zoom: number | null) => any;
    idChange: (id: string | null) => any;
    sceneTypeChange: (sceneType: PanoramaSceneType | null) => any;
    linksChange: () => any;
}, string, PublicProps, Readonly<PanoramaProps> & Readonly<{
    onError?: ((event: unknown) => any) | undefined;
    onLoad?: ((event: unknown) => any) | undefined;
    onPositionChange?: ((position: Point | null) => any) | undefined;
    onPovChange?: ((pov: PanoramaPov | null) => any) | undefined;
    onZoomChange?: ((zoom: number | null) => any) | undefined;
    onIdChange?: ((id: string | null) => any) | undefined;
    onSceneTypeChange?: ((sceneType: PanoramaSceneType | null) => any) | undefined;
    onLinksChange?: (() => any) | undefined;
}>, {
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_5: DefineComponent<CircleProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
    editstart: (event: OverlayEventPayload) => any;
    editend: (event: OverlayEventPayload) => any;
    linevertexdragstart: (event: OverlayEventPayload) => any;
    linevertexdragging: (event: OverlayEventPayload) => any;
    linevertexdragend: (event: OverlayEventPayload) => any;
    linevertexdel: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<CircleProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
    onEditstart?: ((event: OverlayEventPayload) => any) | undefined;
    onEditend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragstart?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragging?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdel?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    enableClicking: boolean;
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    fillColor: string;
    fillOpacity: number;
    enableMassClear: boolean;
    enableEditing: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_6: DefineComponent<PolylineProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
    editstart: (event: OverlayEventPayload) => any;
    editend: (event: OverlayEventPayload) => any;
    linevertexdragstart: (event: OverlayEventPayload) => any;
    linevertexdragging: (event: OverlayEventPayload) => any;
    linevertexdragend: (event: OverlayEventPayload) => any;
    linevertexdel: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<PolylineProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
    onEditstart?: ((event: OverlayEventPayload) => any) | undefined;
    onEditend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragstart?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragging?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdel?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    enableMassClear: boolean;
    enableEditing: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_7: DefineComponent<PolygonProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
    editstart: (event: OverlayEventPayload) => any;
    editend: (event: OverlayEventPayload) => any;
    linevertexdragstart: (event: OverlayEventPayload) => any;
    linevertexdragging: (event: OverlayEventPayload) => any;
    linevertexdragend: (event: OverlayEventPayload) => any;
    linevertexdel: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<PolygonProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
    onEditstart?: ((event: OverlayEventPayload) => any) | undefined;
    onEditend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragstart?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragging?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdel?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    fillColor: string;
    fillOpacity: number;
    enableMassClear: boolean;
    enableEditing: boolean;
    visible: boolean;
    isBoundary: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_8: DefineComponent<RectangleProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mousemove: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPartialPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
    rightdblclick: (event: OverlayPointerEvent) => any;
    lineupdate: (event: OverlayEventPayload) => any;
    editstart: (event: OverlayEventPayload) => any;
    editend: (event: OverlayEventPayload) => any;
    linevertexdragstart: (event: OverlayEventPayload) => any;
    linevertexdragging: (event: OverlayEventPayload) => any;
    linevertexdragend: (event: OverlayEventPayload) => any;
    linevertexdel: (event: OverlayEventPayload) => any;
}, string, PublicProps, Readonly<RectangleProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousemove?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPartialPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onRightdblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onLineupdate?: ((event: OverlayEventPayload) => any) | undefined;
    onEditstart?: ((event: OverlayEventPayload) => any) | undefined;
    onEditend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragstart?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragging?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdragend?: ((event: OverlayEventPayload) => any) | undefined;
    onLinevertexdel?: ((event: OverlayEventPayload) => any) | undefined;
}>, {
    enableClicking: boolean;
    strokeColor: string;
    strokeWeight: number;
    strokeOpacity: number;
    strokeStyle: "solid" | "dashed" | "dotted";
    fillColor: string;
    fillOpacity: number;
    enableMassClear: boolean;
    enableEditing: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare const __VLS_component_9: DefineComponent<LabelProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: OverlayPointerEvent) => any;
    dblclick: (event: OverlayPointerEvent) => any;
    mousedown: (event: OverlayPointerEvent) => any;
    mouseout: (event: OverlayPointerEvent) => any;
    mouseover: (event: OverlayPointerEvent) => any;
    mouseup: (event: OverlayPointerEvent) => any;
    remove: (event: OverlayEventPayload) => any;
    rightclick: (event: OverlayPointerEvent) => any;
}, string, PublicProps, Readonly<LabelProps> & Readonly<{
    onClick?: ((event: OverlayPointerEvent) => any) | undefined;
    onDblclick?: ((event: OverlayPointerEvent) => any) | undefined;
    onMousedown?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseout?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseover?: ((event: OverlayPointerEvent) => any) | undefined;
    onMouseup?: ((event: OverlayPointerEvent) => any) | undefined;
    onRemove?: ((event: OverlayEventPayload) => any) | undefined;
    onRightclick?: ((event: OverlayPointerEvent) => any) | undefined;
}>, {
    offset: {
        x: number;
        y: number;
    };
    enableMassClear: boolean;
    visible: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare type __VLS_PrettifyLocal<T> = {
    [K in keyof T]: T[K];
} & {};
declare type __VLS_PrettifyLocal_2<T> = {
    [K in keyof T]: T[K];
} & {};
declare type __VLS_PrettifyLocal_3<T> = {
    [K in keyof T]: T[K];
} & {};
declare type __VLS_PrettifyLocal_4<T> = {
    [K in keyof T]: T[K];
} & {};
declare type __VLS_PrettifyLocal_5<T> = {
    [K in keyof T]: T[K];
} & {};
declare type __VLS_Slots = {} & {
    error?: (props: typeof __VLS_1) => any;
} & {
    loading?: (props: typeof __VLS_3) => any;
} & {
    default?: (props: typeof __VLS_5) => any;
};
declare type __VLS_Slots_10 = {} & {
    default?: (props: typeof __VLS_5) => any;
};
declare type __VLS_Slots_11 = {} & {
    default?: (props: typeof __VLS_5) => any;
};
declare type __VLS_Slots_12 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_13 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_14 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_15 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_16 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_17 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_18 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_19 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_2 = {} & {
    error?: (props: typeof __VLS_1) => any;
} & {
    loading?: (props: typeof __VLS_3) => any;
} & {
    default?: (props: typeof __VLS_5) => any;
};
declare type __VLS_Slots_20 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_21 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_22 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_23 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_24 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_25 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_26 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_27 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_28 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_29 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_3 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_30 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_31 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_32 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_33 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_34 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_35 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_36 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_37 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_38 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_39 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_4 = {} & {
    default?: (props: typeof __VLS_5) => any;
};
declare type __VLS_Slots_40 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_41 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_42 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_43 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_5 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_6 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_7 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_8 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_Slots_9 = {} & {
    default?: (props: typeof __VLS_1) => any;
};
declare type __VLS_WithSlots<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_10<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_11<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_12<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_13<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_14<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_15<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_16<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_17<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_18<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_19<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_2<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_20<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_21<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_22<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_23<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_24<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_25<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_26<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_27<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_28<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_29<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_3<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_30<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_31<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_32<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_33<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_34<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_35<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_36<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_37<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_38<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_39<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_4<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_40<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_41<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_42<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_43<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_5<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_6<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_7<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_8<T, S> = T & {
    new (): {
        $slots: S;
    };
};
declare type __VLS_WithSlots_9<T, S> = T & {
    new (): {
        $slots: S;
    };
};
export declare type AreaBoundary = string[];
export declare const Autocomplete: DefineComponent<AutocompleteProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    searchComplete: (e: unknown) => any;
    highlight: (e: unknown) => any;
    confirm: (e: unknown) => any;
}, string, PublicProps, Readonly<AutocompleteProps> & Readonly<{
    onSearchComplete?: ((e: unknown) => any) | undefined;
    onHighlight?: ((e: unknown) => any) | undefined;
    onConfirm?: ((e: unknown) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface AutocompleteOptions {
    input: HTMLInputElement;
    location?: unknown;
    types?: string[];
    onSearchComplete?: (event: unknown) => void;
}
declare interface AutocompleteProps {
    location?: string | {
        lng: number;
        lat: number;
    } | unknown;
    types?: string[];
    onSearchComplete?: (e: unknown) => void;
    onHighlight?: (e: unknown) => void;
    onConfirm?: (e: unknown) => void;
}
export declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
export declare const BezierCurve: __VLS_WithSlots_14<typeof __VLS_component_14, __VLS_Slots_14>;
export declare interface BezierCurveProps extends PathStrokeProps, PathShapeProps {
    path: {
        lng: number;
        lat: number;
    }[];
    controlPoints: {
        lng: number;
        lat: number;
    }[][];
    pathVersion?: string | number;
    controlPointsVersion?: string | number;
}
export declare const BMAP_COMPONENT_EVENT_CATALOG: {
    readonly ready: {
        readonly description: "\u5730\u56FE\u5C31\u7EEA\uFF08client + map \u53EF\u7528\uFF09";
    };
    readonly "plugin-ready": {
        readonly description: "\u5355\u4E2A\u63D2\u4EF6\u52A0\u8F7D\u5B8C\u6210\uFF08\u8F7D\u8377\u4E3A\u63D2\u4EF6\u540D\uFF09";
    };
    readonly "plugin-error": {
        readonly description: "\u5355\u4E2A\u63D2\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF08\u8F7D\u8377\u4E3A { name, error }\uFF09";
    };
    readonly unload: {
        readonly description: "\u5730\u56FE\u7EC4\u4EF6\u5378\u8F7D";
    };
    readonly error: {
        readonly description: "\u5730\u56FE\u6216 Client \u52A0\u8F7D\u5931\u8D25\uFF08\u8F7D\u8377\u4E3A BMapError\uFF09";
    };
    readonly "update:center": {
        readonly description: "\u7528\u6237\u4EA4\u4E92\u540E\u7684\u4E2D\u5FC3\u70B9\u56DE\u5199\uFF08v-model:center\uFF09";
    };
    readonly "update:zoom": {
        readonly description: "\u7528\u6237\u4EA4\u4E92\u540E\u7684\u7F29\u653E\u7EA7\u522B\u56DE\u5199\uFF08v-model:zoom\uFF09";
    };
    readonly "update:heading": {
        readonly description: "\u7528\u6237\u4EA4\u4E92\u540E\u7684\u65CB\u8F6C\u89D2\u56DE\u5199\uFF08v-model:heading\uFF09";
    };
    readonly "update:tilt": {
        readonly description: "\u7528\u6237\u4EA4\u4E92\u540E\u7684\u503E\u659C\u89D2\u56DE\u5199\uFF08v-model:tilt\uFF09";
    };
};
export declare interface BMapClient {
    readonly id: symbol;
    readonly engine: BMapEngine;
    readonly libraryVersion: string;
    readonly sdkVersion: string;
    readonly driver: BMapDriver;
    readonly capabilities: CapabilityRegistry;
    readonly rawSdk: unknown;
}
export declare interface BMapClientContext {
    readonly status: Readonly<ShallowRef<ClientStatus>>;
    readonly client: Readonly<ShallowRef<BMapClient | null>>;
    readonly error: Readonly<ShallowRef<BMapError | null>>;
    load(signal?: AbortSignal): Promise<BMapClient>;
    retry(signal?: AbortSignal): Promise<BMapClient>;
    dispose(): void;
}
export declare const bmapClientContextKey: InjectionKey<BMapClientContext>;
export declare const bmapConfigKey: InjectionKey<BMapPluginConfig>;
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
export declare interface BMapDrivingRouteOptions {
    location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
    policy?: MaybeRefOrGetter<DrivingPolicy_2 | undefined>;
    enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
    renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
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
export declare interface BMapPluginConfig {
    provider: BMapProviderLike;
    defaults: BMapLoadOptions;
}
declare interface BMapPluginDefinition<Resource = unknown> {
    readonly name: string;
    readonly scope?: PluginScope;
    readonly dependencies?: readonly string[];
    readonly required?: boolean;
    load(context: PluginContext, signal: AbortSignal): Promise<Resource>;
    setup?(resource: Resource, runtime: unknown): void | Disposer;
    dispose?(resource: Resource, runtime: unknown): void;
}
export declare const BMapProvider: __VLS_WithSlots<typeof __VLS_component, __VLS_Slots>;
export declare interface BMapProviderLike {
    readonly id?: string;
    getCacheKey?(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
export declare interface BMapProviderProps {
    client?: BMapClient;
    definition?: CreateBMapClientOptions;
    provider?: BMapProviderLike;
    loadOptions?: BMapLoadOptions;
    autoLoad?: boolean;
    suspense?: boolean;
}
export declare function BMapResolver(): ComponentResolverLike;
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
declare interface BoundaryRequest {
    name: string;
}
export declare interface BoundaryRings {
    readonly raw: readonly string[];
    readonly rings: readonly (readonly Point[])[];
}
export declare interface Bounds {
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
export declare type BuiltinMarkerIconName = "simple_red" | "simple_blue" | "loc_red" | "loc_blue" | "start" | "end" | "location" | "red1" | "red2" | "red3" | "red4" | "red5" | "red6" | "red7" | "red8" | "red9" | "red10" | "blue1" | "blue2" | "blue3" | "blue4" | "blue5" | "blue6" | "blue7" | "blue8" | "blue9" | "blue10";
declare type BuiltinPluginName = "TrackAnimation" | "DrawingManager" | "GeoUtils" | "Mapvgl";
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
export declare const Circle: __VLS_WithSlots_5<typeof __VLS_component_5, __VLS_Slots_5>;
export declare type CircleHandle = SdkHandle<"overlay:circle">;
export declare interface CircleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
    center: {
        lng: number;
        lat: number;
    };
    radius: number;
    enableClicking?: boolean;
}
export declare const CityListControl: __VLS_WithSlots_24<typeof __VLS_component_24, __VLS_Slots_24>;
declare interface CityListControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    expand?: boolean;
    visible?: boolean;
}
export declare type ClientStatus = "idle" | "loading" | "ready" | "error" | "disposed";
export declare interface ClusterChange {
    engine: MarkerClusterEngine;
    clusters: number;
    singles: number;
    zoom: number | null;
}
export declare interface ClusterPick<Item> {
    engine: MarkerClusterEngine;
    id: string;
    size: number;
    position: {
        lng: number;
        lat: number;
    };
    items: Item[] | null;
}
declare interface ComponentResolverLike {
    type?: "component" | "directive";
    resolve: (name: string) => {
        name: string;
        from: string;
    } | undefined | void;
}
export declare const ContextMenu: __VLS_WithSlots_10<typeof __VLS_component_10, __VLS_Slots_10>;
export declare interface ContextMenuItem {
    text: string;
    callback?: (payload: ContextMenuSelectPayload) => void;
    disabled?: boolean;
    width?: number;
    id?: string;
}
export declare interface ContextMenuProps {
    items?: (ContextMenuItem | ContextMenuSeparator)[];
    width?: number;
    visible?: boolean;
}
export declare interface ContextMenuSelectPayload {
    item: ContextMenuItem;
    index: number;
    point?: Point;
    pixel?: Pixel;
    map: MapHandle;
    target: SdkHandle<string> | null;
}
export declare type ContextMenuSeparator = "-";
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
declare interface ConvertorRequest {
    points: readonly Point[];
    from: CoordinateFromType;
    to: CoordinateToType;
}
declare type CoordinateFromType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
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
declare type CoordinateToType = 3 | 5 | 6;
export declare const CopyrightControl: __VLS_WithSlots_27<typeof __VLS_component_27, __VLS_Slots_27>;
declare interface CopyrightControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
export declare interface CopyrightEntry {
    id: number;
    content: string;
    bounds?: unknown;
}
export declare function createBMapClientDefinition(options: CreateBMapClientOptions): CreateBMapClientOptions;
export declare interface CreateBMapClientOptions {
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
export declare function createClientContext(options?: CreateClientContextOptions): BMapClientContext;
declare interface CreateClientContextOptions {
    definition?: CreateBMapClientOptions;
    client?: BMapClient;
}
declare type CrossOriginValue = "anonymous" | "use-credentials";
export declare const CustomControl: __VLS_WithSlots_18<typeof __VLS_component_18, __VLS_Slots_18>;
declare interface CustomControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
export declare const CustomOverlay: __VLS_WithSlots_11<typeof __VLS_component_11, __VLS_Slots_11>;
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
export declare interface CustomOverlayProps {
    position: {
        lng: number;
        lat: number;
    };
    offset?: {
        x: number;
        y: number;
    };
    anchor?: {
        x: number;
        y: number;
    };
    rotation?: number;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
    properties?: Record<string, unknown>;
    visible?: boolean;
    enableMassClear?: boolean;
}
export declare interface DataComponentProps<Item> {
    data: readonly Item[];
    itemKey: keyof Item | ((item: Item) => PropertyKey);
    getPosition: (item: Item) => {
        lng: number;
        lat: number;
    } | null | undefined;
    dataVersion?: PropertyKey;
    visible?: boolean;
}
export declare const defaultClientDefinitionKey: InjectionKey<CreateBMapClientOptions | undefined>;
export declare type Disposer = () => void;
export declare const DistrictLayer: __VLS_WithSlots_28<typeof __VLS_component_28, __VLS_Slots_28>;
declare interface DistrictLayerProps {
    visible?: boolean;
    name: string;
    kind?: DistrictType_2;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    viewport?: boolean;
    adcode?: string;
}
export declare const DistrictType: {
    readonly PROVINCE: 0;
    readonly CITY: 1;
    readonly AREA: 2;
};
declare type DistrictType_2 = DistrictTypeValue;
export declare type DistrictTypeValue = (typeof DistrictType)[keyof typeof DistrictType];
export declare const DOMLayer: __VLS_WithSlots_33<typeof __VLS_component_33, __VLS_Slots_33>;
declare interface DOMLayerProps {
    visible?: boolean;
    data?: object | null;
    createDom: (properties: object, point: {
        lng: number;
        lat: number;
    }) => HTMLElement;
    minZoom?: number;
    maxZoom?: number;
    zIndex?: number;
    offsetX?: number;
    offsetY?: number;
    anchors?: [
        number,
        number
    ];
    coordinate?: string;
    enableDraggingMap?: boolean;
}
export declare function drawingManagerPlugin(): BMapPluginDefinition<unknown>;
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
export declare interface DrivingRouteRequest {
    start: DrivingRouteEndpoint;
    end: DrivingRouteEndpoint;
    waypoints?: readonly Point[];
}
export declare type DrivingRouteResult = RouteResult<RoutePlan>;
export declare function dynamicEmit(emit: unknown): (name: string, payload: unknown) => void;
declare interface Emitter<Events extends Record<EventType, unknown>> {
    all: EventHandlerMap<Events>;
    on<Key extends keyof Events>(type: Key, handler: Handler<Events[Key]>): void;
    on(type: "*", handler: WildcardHandler<Events>): void;
    off<Key extends keyof Events>(type: Key, handler?: Handler<Events[Key]>): void;
    off(type: "*", handler: WildcardHandler<Events>): void;
    emit<Key extends keyof Events>(type: Key, event: Events[Key]): void;
    emit<Key extends keyof Events>(type: undefined extends Events[Key] ? Key : never): void;
}
export declare type EqualFn<T> = (a: T, b: T) => boolean;
export declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
declare type EventHandlerList<T = unknown> = Array<Handler<T>>;
declare type EventHandlerMap<Events extends Record<EventType, unknown>> = Map<keyof Events | "*", EventHandlerList<Events[keyof Events]> | WildCardEventHandlerList<Events>>;
export declare interface EventSourceClient {
    readonly driver: {
        readonly events: EventDriver;
        readonly map: MapDriver;
    };
}
declare type EventType = string | symbol;
export declare type FeaturePick = PointPick<Record<string, unknown>>;
export declare interface FeatureStateApi<KeyDomain extends FeatureStateKeyDomain = "default"> {
    update(keys: FeatureStateKeysOf<KeyDomain>, state: NativeLayerFeatureState, options?: FeatureStateUpdateOptions): void;
    remove(keys: FeatureStateKeysOf<KeyDomain>): void;
    clear(): void;
    replace(inputs: NativeLayerFeatureStateMap): void;
    get(keys?: FeatureStateKeysOf<KeyDomain>): NativeLayerFeatureStateMap;
}
export declare type FeatureStateKeyDomain = "default" | "string";
export declare type FeatureStateKeys = FeatureStateKeysOf<"default">;
export declare type FeatureStateKeysOf<KeyDomain extends FeatureStateKeyDomain = "default"> = KeyDomain extends "string" ? string | ReadonlyArray<string> : NativeLayerFeatureKeys;
export declare interface FeatureStateUpdateOptions {
    readonly append?: boolean;
}
export declare const FillLayer: __VLS_WithSlots_40<typeof __VLS_component_40, __VLS_Slots_40>;
export declare interface FillLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
    data?: object | null;
    style?: FillLayerStyle;
    border?: boolean;
}
export declare interface FillLayerStyle {
    fillColor?: string | StyleExpression;
    fillOpacity?: number | StyleExpression;
    pattern?: boolean;
    patternMask?: boolean;
    patternUrl?: string;
    patternMapping?: string | StyleExpression;
    patternScale?: number | StyleExpression;
    patternOffset?: string | StyleExpression;
    sequence?: boolean;
    marginLength?: number;
    borderCovered?: boolean;
    borderMask?: boolean;
    borderWeight?: number | StyleExpression;
    borderColor?: string | StyleExpression;
    strokeTextureUrl?: string | StyleExpression;
    strokeTextureWidth?: number | StyleExpression;
    strokeTextureHeight?: number | StyleExpression;
    strokeLineJoin?: string | StyleExpression;
    strokeLineCap?: string | StyleExpression;
    strokeColor?: string | StyleExpression;
    strokeWeight?: number | StyleExpression;
    strokeOpacity?: number | StyleExpression;
    strokeStyle?: string | StyleExpression;
    dashArray?: number[] | StyleExpression;
    height?: number | StyleExpression;
}
export declare interface FrameScheduler {
    schedule(key: PropertyKey, task: () => void): void;
    cancel(key: PropertyKey): void;
    flush(): void;
    pause(): void;
    resume(): void;
    dispose(): void;
}
export declare interface GeocodedAddress {
    address: string;
    point: Point | null;
    business: string | null;
    addressComponents: GeocodedAddressComponents;
    surroundingPois: readonly LocalSearchPoi[];
    poiCount: number;
}
export declare interface GeocodedAddressComponents {
    province: string | null;
    city: string | null;
    district: string | null;
    street: string | null;
    streetNumber: string | null;
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
declare interface GeocodeRequest {
    address: string;
    city?: string;
}
export declare const GeoJSONLayer: __VLS_WithSlots_32<typeof __VLS_component_32, __VLS_Slots_32>;
declare interface GeoJSONLayerProps {
    visible?: boolean;
    data?: object | null;
    layerName?: string;
    minZoom?: number;
    maxZoom?: number;
    reference?: string;
    markerStyle?: unknown;
    polylineStyle?: unknown;
    polygonStyle?: unknown;
    level?: number;
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
export declare interface GeoPoint {
    lng: number;
    lat: number;
}
export declare function geoUtilsPlugin(): BMapPluginDefinition<unknown>;
export declare const GroundOverlay: __VLS_WithSlots_13<typeof __VLS_component_13, __VLS_Slots_13>;
export declare interface GroundOverlayProps {
    bounds: {
        southwest: {
            lng: number;
            lat: number;
        };
        northeast: {
            lng: number;
            lat: number;
        };
    };
    type: GroundOverlayType;
    url: GroundOverlayUrl;
    opacity?: number;
    autoCenter?: boolean;
    visible?: boolean;
}
export declare type GroundOverlayType = "image" | "video" | "canvas";
export declare type GroundOverlayUrl = string | HTMLCanvasElement | (() => string | HTMLCanvasElement);
declare const HANDLE_BRAND: unique symbol;
declare type Handler<T = unknown> = (event: T) => void;
export declare const HeatmapLayer: __VLS_WithSlots_41<typeof __VLS_component_41, __VLS_Slots_41>;
export declare interface HeatmapLayerProps {
    data?: object | null;
    style?: Record<string, unknown>;
    visible?: boolean;
}
export declare const InfoWindow: __VLS_WithSlots_4<typeof __VLS_component_4, __VLS_Slots_4>;
export declare type InfoWindowHandle = SdkHandle<"overlay:info-window">;
declare interface InfoWindowManager {
    register(input: InfoWindowRegistrationInput): InfoWindowRegistration;
    activate(resource: InfoWindowHandle): void;
    deactivate(resource: InfoWindowHandle): void;
    current(): InfoWindowHandle | null;
    isCurrent(resource: InfoWindowHandle): boolean;
    readonly size: number;
    dispose(): void;
}
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
export declare interface InfoWindowProps extends InfoWindowProps_2 {
}
declare interface InfoWindowProps_2 {
    position?: Point;
    title?: string;
    width?: number;
    height?: number;
    offset?: Pixel;
    open?: boolean;
    enableMaximize?: boolean;
    enableAutoPan?: boolean;
    enableCloseOnClick?: boolean;
}
declare interface InfoWindowRegistration {
    readonly id: symbol;
    readonly resource: InfoWindowHandle;
    readonly disposed: boolean;
    dispose(): void;
}
declare interface InfoWindowRegistrationInput {
    readonly resource: InfoWindowHandle;
    readonly onSuperseded: () => void;
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
export declare interface JsapiV4Driver extends BMapDriver {
    readonly services: JsapiV4ServiceDriver;
    readonly panorama: PanoramaViewerDriver;
    readonly nativeLayers: NativeLayerDriver;
}
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
declare interface JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver {
    disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">): void;
    clearLocalSearch(handle: ServiceHandle<"service:local-search">): void;
    disposeLocalSearch(handle: ServiceHandle<"service:local-search">): void;
}
declare type JsapiV4VersionSource = "url" | "global" | "declared";
export declare const Label: __VLS_WithSlots_9<typeof __VLS_component_9, __VLS_Slots_9>;
export declare type LabelHandle = SdkHandle<"overlay:label">;
export declare interface LabelOptions {
    position?: Point;
    offset?: Pixel;
    zIndex?: number;
    style?: Record<string, unknown>;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
export declare interface LabelProps {
    content: string;
    position: {
        lng: number;
        lat: number;
    };
    offset?: {
        x: number;
        y: number;
    };
    zIndex?: number;
    style?: LabelStyle;
    enableMassClear?: boolean;
    visible?: boolean;
}
export declare type LabelStyle = Record<string, unknown>;
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
declare type LayerLedgerHandle = LayerHandle | NativeLayerHandle;
declare type LayerLedgerKind = LayerKind | NativeLayerKind;
export declare type LayerOperation = "setZIndex" | "setData" | "clearData" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState";
declare interface LayerRecord {
    readonly id: symbol;
    readonly kind: LayerLedgerKind;
    readonly handle: LayerLedgerHandle;
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
declare interface LayerRegistryInput {
    readonly kind: LayerLedgerKind;
    readonly handle: LayerLedgerHandle;
    readonly scope: ResourceScope;
    readonly remove: () => void;
    readonly quiesce?: (active: boolean) => void;
}
export declare interface LayerSurface {
    readonly ctorSlots: readonly LayerCtorSlot[];
    readonly operations: readonly LayerOperation[];
}
export declare const LineLayer: __VLS_WithSlots_39<typeof __VLS_component_39, __VLS_Slots_39>;
export declare interface LineLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
    data?: object | null;
    style?: LineLayerStyle;
}
export declare interface LineLayerStyle {
    sequence?: boolean;
    marginLength?: number;
    borderCovered?: boolean;
    borderMask?: boolean;
    borderWeight?: number | StyleExpression;
    borderColor?: string | StyleExpression;
    strokeTextureUrl?: string | StyleExpression;
    strokeTextureWidth?: number | StyleExpression;
    strokeTextureHeight?: number | StyleExpression;
    strokeLineJoin?: string | StyleExpression;
    strokeLineCap?: string | StyleExpression;
    strokeColor?: string | StyleExpression;
    strokeWeight?: number | StyleExpression;
    strokeOpacity?: number | StyleExpression;
    strokeStyle?: string | StyleExpression;
    dashArray?: number[] | StyleExpression;
    linksLine?: boolean;
    strokeColorControl?: (line: number, segment: number) => string;
    traceDisappear?: boolean;
    traceStart?: boolean;
    traceControl?: (line: number[]) => number[];
    traceColor?: [
        number,
        number,
        number
    ];
    height?: number | StyleExpression;
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
export declare const LocationControl: __VLS_WithSlots_25<typeof __VLS_component_25, __VLS_Slots_25>;
declare interface LocationControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
declare const Map_2: __VLS_WithSlots_2<typeof __VLS_component_2, __VLS_Slots_2>;
export { Map_2 as Map };
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
export declare const MAP_EVENT_EMIT_ALIASES: Readonly<Record<string, readonly string[]>>;
export declare const MAP_EVENT_NAMES: readonly MapEventName[];
export declare const MAP_SUSPEND_REASONS: {
    readonly user: "user";
    readonly keepAlive: "keep-alive";
    readonly document: "document";
    readonly offscreen: "offscreen";
    readonly disposed: "disposed";
};
export declare interface MapCommands {
    getCenter(): Point | null;
    getZoom(): number | null;
    getHeading(): number | null;
    getTilt(): number | null;
    getBounds(): Bounds | null;
    getSize(): Size | null;
    setCenter(center: Point): void;
    setZoom(zoom: number): void;
    setHeading(heading: number): void;
    setTilt(tilt: number): void;
    panTo(point: Point): void;
    panBy(pixel: Pixel): void;
    fitBounds(bounds: Bounds): void;
    supports(capability: Capability): boolean;
}
export declare type MapComponentEventName = keyof typeof BMAP_COMPONENT_EVENT_CATALOG;
export declare interface MapContext extends MapRuntimeShape {
    readonly overlays: OverlayRegistry;
    readonly layers?: LayerRegistry;
    readonly infoWindows?: InfoWindowManager;
    readonly controls?: unknown;
    readonly plugins: unknown;
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
declare type MapEventBus = {
    on: Emitter<InternalMapEvents>["on"];
    off: Emitter<InternalMapEvents>["off"];
    emit: Emitter<InternalMapEvents>["emit"];
    clear: () => void;
};
export declare interface MapEventDefinition {
    readonly sdk: string;
    readonly declared: boolean;
    readonly payload: MapEventPayloadKind;
    readonly coalesce: boolean;
    readonly description: string;
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
export declare type MapEventPayloadKind = "base" | "pointer" | "load" | "resize" | "maptypechange";
export declare type MapEventPayloadOf<K extends MapEventName> = MapEventMap[K];
export declare type MapEventSdkName = (typeof MAP_EVENT_CATALOG)[MapEventName]["sdk"];
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
export declare interface MapExpose extends MapCommands {
    getContainer(): HTMLElement | null;
    isContainerReady(): boolean;
    checkResize(): void;
    getMapInstance(): MapHandle | null;
    whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
    whenMapCreated(callback: (ready: MapReadyContext) => void): () => void;
    isTearingDown(): boolean;
    retry(): Promise<MapReadyContext>;
    suspend(reason?: MapSuspendReason): void;
    resume(reason?: MapSuspendReason): void;
    isSuspended(): boolean;
    suspendReasons(): readonly string[];
    resetView(): void;
    setDragging(enabled: boolean): void;
    prefersReducedMotion(): boolean;
}
export declare type MapHandle = SdkHandle<"map">;
export declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
export declare interface MapLoadEvent extends DriverEvent {
    point: Point;
    zoom: number;
}
export declare type MapLoadPayload = MapLoadEvent & {
    type: string;
};
export declare const MapMask: __VLS_WithSlots_15<typeof __VLS_component_15, __VLS_Slots_15>;
declare interface MapMaskProps {
    path: {
        lng: number;
        lat: number;
    }[];
    pathVersion?: string | number;
    showRegion?: MapMaskShowRegion;
    isBuildingMask?: boolean;
    isMapMask?: boolean;
    isPoiMask?: boolean;
    visible?: boolean;
}
export declare type MapMaskShowRegion = "inside" | "outside";
export declare interface MapMouseEvent extends DriverEvent {
    point: Point;
}
export declare type MapPointerEvent = MapMouseEvent & {
    type: string;
};
export declare interface MapProps {
    ak?: string;
    apiUrl?: string;
    provider?: BMapProviderLike;
    client?: BMapClient;
    definition?: CreateBMapClientOptions;
    keepAliveBehavior?: "suspend" | "dispose";
    center?: {
        lng: number;
        lat: number;
    } | string;
    zoom?: number;
    heading?: number;
    tilt?: number;
    defaultCenter?: {
        lng: number;
        lat: number;
    } | string;
    defaultZoom?: number;
    defaultHeading?: number;
    defaultTilt?: number;
    width?: string | number;
    height?: string | number;
    mapType?: string;
    mapStyleId?: string;
    mapStyleJson?: Record<string, unknown>;
    displayOptions?: Record<string, unknown>;
    restrictCenter?: boolean;
    minZoom?: number;
    maxZoom?: number;
    noAnimation?: boolean;
    enableDragging?: boolean;
    enableScrollWheelZoom?: boolean;
    enableInertialDragging?: boolean;
    enablePinchToZoom?: boolean;
    enableKeyboard?: boolean;
    enableDoubleClickZoom?: boolean;
    enableContinuousZoom?: boolean;
    enableTraffic?: boolean;
    enableResizeOnCenter?: boolean;
    enableAutoResize?: boolean;
    loadingBgColor?: string;
    backgroundColor?: number[];
    plugins?: string[];
}
export declare interface MapReadyContext {
    readonly client: BMapClient;
    readonly map: MapHandle;
}
declare interface MapReadyPayload extends MapReadyContext {
    container: HTMLElement;
}
export declare interface MapResizeEvent extends DriverEvent {
    size: Size;
}
export declare type MapResizePayload = MapResizeEvent & {
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
export declare type MapSuspendReason = (typeof MAP_SUSPEND_REASONS)[keyof typeof MAP_SUSPEND_REASONS] | (string & {});
declare type MapType_2 = "normal" | "satellite" | "earth";
export { MapType_2 as MapType };
export declare interface MapTypeChangeEvent extends DriverEvent {
    zoomLevel: number;
}
export declare type MapTypeChangePayload = MapTypeChangeEvent & {
    type: string;
};
export declare const MapTypeControl: __VLS_WithSlots_21<typeof __VLS_component_21, __VLS_Slots_21>;
declare interface MapTypeControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    type?: string;
    mapTypes?: readonly number[];
    showStreetLayer?: boolean;
    visible?: boolean;
}
export declare function mapVglPlugin(): BMapPluginDefinition<unknown>;
export declare interface MapView {
    center: Point | string;
    zoom: number;
    heading?: number;
    tilt?: number;
}
export declare const Marker: __VLS_WithSlots_3<typeof __VLS_component_3, __VLS_Slots_3>;
export declare const Marker3D: __VLS_WithSlots_16<typeof __VLS_component_16, __VLS_Slots_16>;
declare interface Marker3dCustomIcon {
    anchor?: {
        x: number;
        y: number;
    };
    imageOffset?: {
        x: number;
        y: number;
    };
    imageSize: {
        width: number;
        height: number;
    };
    imageUrl: string;
    printImageUrl?: string;
}
declare interface Marker3DProps {
    position: {
        lng: number;
        lat: number;
    };
    height: number;
    size?: number;
    shape?: Marker3dShape;
    fillColor?: string;
    fillOpacity?: number;
    icon?: Marker3dCustomIcon;
    enableMassClear?: boolean;
    visible?: boolean;
}
declare type Marker3dShape = "BMAP_SHAPE_CIRCLE" | "BMAP_SHAPE_RECT";
export declare const MarkerCluster: <Item>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal_5<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_expose?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: __VLS_PrettifyLocal_5<Pick<Partial<{}> & Omit<{
        readonly "onItem-click"?: ((item: Item) => any) | undefined;
        readonly "onCluster-click"?: ((pick: ClusterPick<Item>) => any) | undefined;
        readonly "onCluster-change"?: ((change: ClusterChange) => any) | undefined;
    } & VNodeProps & AllowedComponentProps & ComponentCustomProps, never>, "onItem-click" | "onCluster-click" | "onCluster-change"> & MarkerClusterProps<Item> & Partial<{}>> & PublicProps;
    expose(exposed: ShallowUnwrapRef<{}>): void;
    attrs: any;
    slots: {
        default?: (props: {}) => any;
    };
    emit: ((evt: "item-click", item: Item) => void) & ((evt: "cluster-click", pick: ClusterPick<Item>) => void) & ((evt: "cluster-change", change: ClusterChange) => void);
}>) => VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
export declare type MarkerClusterEngine = "native" | "markers";
export declare interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
    gridSize?: number;
    minClusterSize?: number;
    zoom?: number;
}
export declare interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
    engine?: MarkerClusterEngine;
    gridSize?: number;
    minClusterSize?: number;
    zoom?: number;
    clusterRadius?: number;
    clusterMinPoints?: number;
    clusterMinZoom?: number;
    clusterMaxZoom?: number;
    fitViewOnClick?: boolean;
    singleStyle?: Record<string, unknown>;
}
export declare interface MarkerCustomIcon {
    imageUrl: string;
    size: {
        width: number;
        height: number;
    };
    anchor?: {
        x: number;
        y: number;
    };
    imageOffset?: {
        x: number;
        y: number;
    };
    imageSize?: {
        width: number;
        height: number;
    };
    printImageUrl?: string;
}
export declare type MarkerHandle = SdkHandle<"overlay:marker">;
export declare type MarkerIcon = MarkerIconName | MarkerCustomIcon;
export declare type MarkerIconInput = string | {
    imageUrl: string;
    size: Size;
    anchor?: Pixel;
    imageOffset?: Pixel;
    imageSize?: Size;
    printImageUrl?: string;
};
export declare type MarkerIconName = BuiltinMarkerIconName;
export declare const MarkerList: <Item>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_expose?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: __VLS_PrettifyLocal<Pick<Partial<{}> & Omit<{
        readonly "onItem-click"?: ((item: Item) => any) | undefined;
    } & VNodeProps & AllowedComponentProps & ComponentCustomProps, never>, "onItem-click"> & MarkerListProps<Item> & Partial<{}>> & PublicProps;
    expose(exposed: ShallowUnwrapRef<{}>): void;
    attrs: any;
    slots: {
        default?: (props: {}) => any;
    };
    emit: (evt: "item-click", item: Item) => void;
}>) => VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
export declare interface MarkerListProps<Item> extends DataComponentProps<Item> {
}
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
export declare interface MarkerProps {
    position: {
        lng: number;
        lat: number;
    };
    offset?: {
        x: number;
        y: number;
    };
    zIndex?: number;
    visible?: boolean;
    title?: string;
    enableDragging?: boolean;
    enableClicking?: boolean;
    rotation?: number;
    icon?: MarkerIcon;
}
export declare const MenuItem: DefineComponent<MenuItemProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    select: (payload: ContextMenuSelectPayload) => any;
}, string, PublicProps, Readonly<MenuItemProps> & Readonly<{
    onSelect?: ((payload: ContextMenuSelectPayload) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare interface MenuItemProps {
    text: string;
    disabled?: boolean;
    width?: number;
    id?: string;
}
export declare const MenuSeparator: DefineComponent<{}, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<{}> & Readonly<{}>, {}, {}, {}, {}, string, ComponentProvideOptions, true, {}, any>;
export declare function mvtFeatureStateKey(layerName: string, id: string | number): string;
export declare const MVTLayer: __VLS_WithSlots_38<typeof __VLS_component_38, __VLS_Slots_38>;
export declare interface MVTLayerBaseEvent {
    type?: string;
    [key: string]: unknown;
}
export declare interface MVTLayerEntity {
    id: string;
    layerName: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare interface MVTLayerMouseEvent {
    type?: string;
    pixel?: {
        x: number;
        y: number;
    };
    latLng?: {
        lng: number;
        lat: number;
    };
    [key: string]: unknown;
}
export declare interface MVTLayerMouseMoveEvent extends MVTLayerMouseEvent {
    value: MVTLayerEntity[];
}
export declare interface MVTLayerPickEvent extends MVTLayerMouseEvent {
    value?: MVTLayerEntity[];
}
export declare interface MVTLayerProps {
    visible?: boolean;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
    tileUrlTemplate?: string;
    layers?: string[];
    idProperty?: string;
    style?: MVTLayerStyle;
    transform?: unknown;
    gridModel?: unknown;
    spanLevel?: number;
    noCollision?: boolean;
    useThumb?: boolean;
    encrypt?: boolean;
    onclick?: (e: MVTLayerPickEvent) => void;
    ondblclick?: (e: MVTLayerPickEvent) => void;
    onmousemove?: (e: MVTLayerMouseMoveEvent) => void;
    onmouseout?: (e: MVTLayerMouseEvent) => void;
}
export declare type MVTLayerStyle = Record<string, MVTLayerStyleEntry>;
export declare interface MVTLayerStyleEntry {
    type?: string;
    painter?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare interface NativeLayerCommonProps {
    visible?: boolean;
    opacity?: number;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
}
declare type NativeLayerData = Record<string, unknown>;
export declare interface NativeLayerDriver {
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
export declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
export declare type NativeLayerFeatureState = Record<string, unknown>;
export declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
declare type NativeLayerHandle = SdkHandle<"native-layer" | `native-layer:${string}`>;
export declare type NativeLayerKind = "point" | "cluster" | "point-icon" | "point-shape" | "line" | "fill" | "heatmap" | "track-line";
export declare type NativeLayerOperation = "setData" | "clearData" | "setStyle" | "setVisible" | "setOpacity" | "setZIndex" | "setZoomRange" | "updateState" | "removeState" | "clearState" | "replaceState" | "getState" | "setEnablePicked" | "hitTest" | "start" | "pause" | "resume" | "stop" | "setSpeed" | "setProcess";
declare interface NativeLayerPick {
    dataIndex: number;
    dataItem: unknown;
}
export declare interface NativeLayerPickOptions {
    idKey?: string;
    crs?: string;
    enablePicked?: boolean;
    pickWidth?: number;
    pickHeight?: number;
    autoSelect?: boolean;
    selectedColor?: string;
}
declare interface NativeLayerZoomRange {
    min?: number;
    max?: number;
}
export declare const NavigationControl: __VLS_WithSlots_20<typeof __VLS_component_20, __VLS_Slots_20>;
export declare const NavigationControl3D: __VLS_WithSlots_26<typeof __VLS_component_26, __VLS_Slots_26>;
declare interface NavigationControl3DProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
declare interface NavigationControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    type?: string;
    showZoomInfo?: boolean;
    enableGeolocation?: boolean;
    visible?: boolean;
}
export declare function normalizeEventKey(name: string): string;
export declare const OVERLAY_EVENT_MATRIX: {
    readonly marker: OverlayEventMatrixEntry;
    readonly label: OverlayEventMatrixEntry;
    readonly polyline: OverlayEventMatrixEntry;
    readonly polygon: OverlayEventMatrixEntry;
    readonly rectangle: OverlayEventMatrixEntry;
    readonly circle: OverlayEventMatrixEntry;
    readonly prism: OverlayEventMatrixEntry;
    readonly "bezier-curve": OverlayEventMatrixEntry;
    readonly "ground-overlay": OverlayEventMatrixEntry;
    readonly "info-window": OverlayEventMatrixEntry;
    readonly "custom-overlay": OverlayEventMatrixEntry;
    readonly "context-menu": OverlayEventMatrixEntry;
};
export declare const OVERLAY_KINDS_WITHOUT_EVENT_MATRIX: {
    readonly "map-mask": "\u63A9\u819C\uFF1A4.0.4 \u6CA1\u6709 MapMaskEventMap\uFF08MapMask \u672C\u8EAB\u4E0D\u5728\u7C7B\u578B\u5305\u7684\u7C7B\u58F0\u660E\u91CC\uFF09";
    readonly marker3d: string;
};
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
export declare interface OverlayEventDefinition {
    readonly sdk: string;
    readonly vue: string;
    readonly payload: OverlayEventPayloadKind;
    readonly requiresEditing: boolean;
    readonly description: string;
}
export declare interface OverlayEventMatrixEntry {
    readonly upstream: string;
    readonly events: Readonly<Record<string, OverlayEventDefinition>>;
}
export declare type OverlayEventMatrixKey = keyof typeof OVERLAY_EVENT_MATRIX;
export declare function overlayEventOf(kind: OverlayKind, name: string): OverlayEventDefinition | undefined;
export declare interface OverlayEventPayload extends DriverEvent {
    type: string;
}
export declare type OverlayEventPayloadKind = "pointer" | "partial-pointer" | "base";
export declare function overlayEventsOf(kind: OverlayKind): readonly OverlayEventDefinition[];
export declare type OverlayEventSpec = {
    readonly sdk: string;
    readonly emit: string;
} | {
    readonly sdk: string;
    readonly handle: (event: unknown) => void;
};
export declare type OverlayFieldMap<Props> = {
    readonly [K in keyof Props]-?: OverlayFieldUpdate;
};
export declare type OverlayFieldUpdate = "position" | "options" | "recreate" | "visibility" | "version";
export declare type OverlayFieldWatch = "fingerprint" | "reference" | {
    readonly source: "versioned";
    readonly versionProp: string;
};
export declare type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
export declare type OverlayKind = "marker" | "polyline" | "polygon" | "rectangle" | "circle" | "info-window" | "label" | "prism" | "marker3d" | "bezier-curve" | "custom-overlay" | "map-mask" | "ground-overlay" | "context-menu";
export declare interface OverlayPartialPointerEvent extends OverlayEventPayload {
    point?: Point;
}
export declare interface OverlayPointerEvent extends OverlayEventPayload {
    point: Point;
}
export declare function overlayPointerFallback(kind: OverlayKind | undefined, sdkName: string): "default" | "never";
export declare interface OverlayPositionModel {
    current(): Point | undefined;
    applyFromProps(next: Point | undefined): void;
    observeFromSdk(next: Point): boolean;
}
export declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
declare interface OverlayRecord<Resource = unknown> {
    readonly id: symbol;
    readonly type: string;
    readonly instance: Resource;
    readonly owner: ResourceScope;
}
declare interface OverlayRegistry {
    registerResource<Resource>(input: ResourceRegistrationInput<Resource>): ResourceRegistration<Resource>;
    get(id: symbol): OverlayRecord | undefined;
    getByType<Resource = unknown>(type: string): OverlayRecord<Resource>[];
    clearAll(): void;
    dispose(): void;
    get size(): number;
}
export declare interface OverlaySpec<Props extends object, Resource> {
    readonly type: string;
    readonly kind?: OverlayKind;
    readonly fields: OverlayFieldMap<Props>;
    readonly descriptorKeys?: Partial<Record<keyof Props & string, string | null>>;
    readonly watchSources?: Partial<Record<keyof Props & string, OverlayFieldWatch>>;
    readonly fieldValues?: Partial<Record<keyof Props & string, (value: unknown) => unknown>>;
    readonly afterMount?: (context: MapReadyContext, resource: Resource, props: Readonly<Props>) => void;
    readonly targetKind?: TargetKind;
    create(context: MapReadyContext, props: Readonly<Props>): Resource | Promise<Resource>;
    readonly events?: readonly OverlayEventSpec[];
}
export declare interface OverlayTarget {
    kind: "map" | "marker" | "clusterer" | "overlay";
    handle: SdkHandle<string>;
}
export declare const OverviewMapControl: __VLS_WithSlots_22<typeof __VLS_component_22, __VLS_Slots_22>;
declare interface OverviewMapControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    size?: {
        x: number;
        y: number;
    };
    isOpen?: boolean;
    zoomInterval?: number;
    padding?: number;
    visible?: boolean;
}
export declare const Panorama: __VLS_WithSlots_43<typeof __VLS_component_43, __VLS_Slots_43>;
export declare const PanoramaControl: __VLS_WithSlots_17<typeof __VLS_component_17, __VLS_Slots_17>;
declare interface PanoramaControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
export declare const PanoramaCoverageLayer: __VLS_WithSlots_29<typeof __VLS_component_29, __VLS_Slots_29>;
declare interface PanoramaCoverageLayerProps {
    visible?: boolean;
}
export declare interface PanoramaDataInfo {
    id: string;
    description: string;
    position: Point | null;
}
export declare interface PanoramaDriver {
    readonly supported: boolean;
}
declare type PanoramaHandle = SdkHandle<"panorama">;
export declare const PanoramaLabel: DefineComponent<PanoramaLabelProps, {
    label: ShallowRef<PanoramaLabelHandle | null, PanoramaLabelHandle | null>;
}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    click: (event: unknown) => any;
}, string, PublicProps, Readonly<PanoramaLabelProps> & Readonly<{
    onClick?: ((event: unknown) => any) | undefined;
}>, {
    content: string;
    displayDistance: boolean;
}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
export declare type PanoramaLabelHandle = SdkHandle<"panorama:label">;
export declare interface PanoramaLabelOptions {
    position?: Point;
    altitude?: number;
    displayDistance?: boolean;
}
declare interface PanoramaLabelProps {
    content?: string;
    position?: Point;
    altitude?: number;
    displayDistance?: boolean;
}
export declare interface PanoramaOptions {
    navigationControl?: boolean;
    linksControl?: boolean;
    indoorSceneSwitchControl?: boolean;
    albumsControl?: boolean;
    albumsControlOptions?: Record<string, unknown>;
}
export declare type PanoramaPoiType = "hotel" | "catering" | "movie" | "transit" | "indoor_scene" | "none";
export declare interface PanoramaPov {
    heading: number;
    pitch?: number;
}
declare interface PanoramaProps {
    point?: Point;
    id?: string;
    pov?: PanoramaPov;
    zoom?: number;
    visible?: boolean;
    scrollWheelZoom?: boolean;
    poiType?: PanoramaPoiType;
    options?: PanoramaOptions;
}
declare interface PanoramaReadyContext {
    readonly client: BMapClient;
    readonly viewer: PanoramaHandle;
}
export declare type PanoramaSceneType = "street" | "inter";
declare type PanoramaServiceHandle = SdkHandle<"service:panorama">;
declare type PanoramaStatus = "idle" | "waiting-client" | "creating" | "ready" | "error" | "disposing" | "disposed";
declare interface PanoramaSwitchOptions {
    animation?: boolean;
    fisheye?: boolean;
    animationType?: string;
    pov?: Partial<PanoramaPov>;
}
export declare interface PanoramaViewerDriver extends PanoramaDriver {
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
declare interface PathEditableProps {
    enableEditing?: boolean;
}
declare interface PathFillProps {
    fillColor?: string;
    fillOpacity?: number;
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
declare interface PathShapeProps {
    enableMassClear?: boolean;
    visible?: boolean;
}
declare interface PathStrokeProps {
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
}
export declare interface Pixel {
    x: number;
    y: number;
}
export declare interface PluginCatalogEntry {
    readonly name: BuiltinPluginName;
    readonly create: () => BMapPluginDefinition<unknown>;
}
declare interface PluginContext {
    readonly client: BMapClient | null;
    readonly map: MapHandle | null;
    readonly api: unknown;
}
declare type PluginScope = "global" | "map";
export declare interface Point {
    lng: number;
    lat: number;
}
export declare const PointCollection: <Item>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal_2<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_expose?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: __VLS_PrettifyLocal_2<Pick<Partial<{}> & Omit<{
        readonly onClick?: ((pick: PointPick<Item>) => any) | undefined;
        readonly "onItem-click"?: ((item: Item) => any) | undefined;
    } & VNodeProps & AllowedComponentProps & ComponentCustomProps, never>, "onClick" | "onItem-click"> & PointCollectionProps<Item> & Partial<{}>> & PublicProps;
    expose(exposed: ShallowUnwrapRef<{
        featureState: FeatureStateApi<"default">;
    }>): void;
    attrs: any;
    slots: {
        default?: (props: {}) => any;
    };
    emit: ((evt: "click", pick: PointPick<Item>) => void) & ((evt: "item-click", item: Item) => void);
}>) => VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
export declare interface PointCollectionProps<Item> extends DataComponentProps<Item> {
    properties?: (item: Item) => Record<string, unknown> | null | undefined;
    shape?: number;
    size?: number;
    color?: string;
    strokeColor?: string;
    strokeWeight?: number;
    opacity?: number;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
    isFlat?: boolean;
    enablePicked?: boolean;
    pickWidth?: number;
    pickHeight?: number;
}
export declare const PointIconLayer: <Item>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal_3<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_expose?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: __VLS_PrettifyLocal_3<Pick<Partial<{}> & Omit<{
        readonly onClick?: ((pick: PointPick<Item>) => any) | undefined;
        readonly "onItem-click"?: ((item: Item) => any) | undefined;
    } & VNodeProps & AllowedComponentProps & ComponentCustomProps, never>, "onClick" | "onItem-click"> & PointIconLayerProps<Item> & Partial<{}>> & PublicProps;
    expose(exposed: ShallowUnwrapRef<{
        featureState: FeatureStateApi<"default">;
    }>): void;
    attrs: any;
    slots: {
        default?: (props: {}) => any;
    };
    emit: ((evt: "click", pick: PointPick<Item>) => void) & ((evt: "item-click", item: Item) => void);
}>) => VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
export declare interface PointIconLayerProps<Item> extends DataComponentProps<Item> {
    properties?: (item: Item) => Record<string, unknown> | null | undefined;
    icon?: string;
    width?: number;
    height?: number;
    anchors?: [
        number,
        number
    ];
    offset?: [
        number,
        number
    ];
    scale?: number;
    rotation?: number;
    isFlat?: boolean;
    isFixed?: boolean;
    opacity?: number;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
    enablePicked?: boolean;
    pickWidth?: number;
    pickHeight?: number;
}
export declare type PointInput = Point | readonly [
    lng: number,
    lat: number
];
export declare const PointLayer: <Item>(__VLS_props: NonNullable<Awaited<typeof __VLS_setup>>["props"], __VLS_ctx?: __VLS_PrettifyLocal_4<Pick<NonNullable<Awaited<typeof __VLS_setup>>, "attrs" | "emit" | "slots">>, __VLS_expose?: NonNullable<Awaited<typeof __VLS_setup>>["expose"], __VLS_setup?: Promise<{
    props: __VLS_PrettifyLocal_4<Pick<Partial<{}> & Omit<{
        readonly onClick?: ((pick: PointPick<Item>) => any) | undefined;
        readonly "onItem-click"?: ((item: Item) => any) | undefined;
    } & VNodeProps & AllowedComponentProps & ComponentCustomProps, never>, "onClick" | "onItem-click"> & PointLayerProps<Item> & Partial<{}>> & PublicProps;
    expose(exposed: ShallowUnwrapRef<{
        featureState: FeatureStateApi<"default">;
    }>): void;
    attrs: any;
    slots: {
        default?: (props: {}) => any;
    };
    emit: ((evt: "click", pick: PointPick<Item>) => void) & ((evt: "item-click", item: Item) => void);
}>) => VNode & {
    __ctx?: Awaited<typeof __VLS_setup>;
};
export declare interface PointLayerProps<Item> extends DataComponentProps<Item> {
    properties?: (item: Item) => Record<string, unknown> | null | undefined;
    shape?: string;
    icon?: string;
    size?: number;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeWeight?: number;
    scale?: number;
    rotation?: number;
    offset?: [
        number,
        number
    ];
    anchor?: string;
    enablePicked?: boolean;
    pickWidth?: number;
    pickHeight?: number;
}
export declare interface PointLike {
    lng: number;
    lat: number;
}
export declare interface PointPick<Item> {
    hit: boolean;
    dataIndex: number;
    id: string | number | null;
    item: Item | null;
    latLng: {
        lng: number;
        lat: number;
    } | null;
    pixel: {
        x: number;
        y: number;
    } | null;
}
export declare const Polygon: __VLS_WithSlots_7<typeof __VLS_component_7, __VLS_Slots_7>;
export declare type PolygonHandle = SdkHandle<"overlay:polygon">;
export declare interface PolygonProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
    path: ({
        lng: number;
        lat: number;
    } | string)[];
    pathVersion?: string | number;
    isBoundary?: boolean;
}
export declare const Polyline: __VLS_WithSlots_6<typeof __VLS_component_6, __VLS_Slots_6>;
export declare type PolylineHandle = SdkHandle<"overlay:polyline">;
export declare interface PolylineProps extends PathStrokeProps, PathShapeProps, PathEditableProps {
    path: {
        lng: number;
        lat: number;
    }[];
    pathVersion?: string | number;
}
export declare const Prism: __VLS_WithSlots_12<typeof __VLS_component_12, __VLS_Slots_12>;
export declare interface PrismProps {
    path: ({
        lng: number;
        lat: number;
    } | string)[];
    altitude: number;
    topFillColor?: string;
    topFillOpacity?: number;
    sideFillColor?: string;
    sideFillOpacity?: number;
    isBoundary?: boolean;
    autoCenter?: boolean;
    enableMassClear?: boolean;
    visible?: boolean;
}
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
    readonly whenReady: () => Promise<MapReadyContext>;
    readonly client: ShallowRef<PublicBMapClient | null>;
    readonly map: ShallowRef<MapHandle | null>;
    readonly status: ShallowRef<MapStatus>;
    readonly error: ShallowRef<unknown>;
    readonly events: {
        emit(type: string, payload: unknown): void;
    };
}
export declare const RasterTileLayer: __VLS_WithSlots_37<typeof __VLS_component_37, __VLS_Slots_37>;
declare interface RasterTileLayerProps {
    visible?: boolean;
    opacity?: number;
    minZoom?: number;
    maxZoom?: number;
    zIndex?: number;
    url: string | ((x: number, y: number, z: number) => string);
    subdomains?: string[];
    projection?: string;
    bounds?: number[];
    boundsInWGS84?: boolean;
    spanLevel?: number;
    useThumbData?: boolean;
    boundary?: string | string[];
    showRegion?: "inside" | "outside";
    height?: number;
    retry?: boolean;
    retryTime?: number;
    cacheSize?: number;
    tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
    tileLoadObserver?: TileLoadObserver;
}
export declare const Rectangle: __VLS_WithSlots_8<typeof __VLS_component_8, __VLS_Slots_8>;
export declare interface RectangleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
    bounds: {
        southwest: {
            lng: number;
            lat: number;
        };
        northeast: {
            lng: number;
            lat: number;
        };
    };
    enableClicking?: boolean;
}
export declare interface ResolvedMapEvent {
    readonly vue: MapEventName;
    readonly sdk: MapEventSdkName;
    readonly coalesce: boolean;
    readonly declared: boolean;
}
export declare function resolveMapContext(map?: unknown): PublicMapContext;
export declare function resolveMapEventName(name: string): ResolvedMapEvent | undefined;
export declare function resolvePluginDefinition(name: string): BMapPluginDefinition<unknown>;
declare interface ResourceRegistration<Resource = unknown> {
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
export declare class ResourceScope {
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
export declare interface ResourceScopeOptions {
    label?: string;
}
declare function retry(): Promise<void>;
declare interface ReverseGeocodeRequest {
    point: Point;
    poiRadius?: number;
    numPois?: number;
}
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
export declare interface RouteRequest {
    start: RouteEndpoint;
    end: RouteEndpoint;
}
export declare interface RouteResult<TPlan> {
    start: RouteEndpointInfo | null;
    end: RouteEndpointInfo | null;
    plans: readonly TPlan[];
    policy: number | null;
    transitType: number | null;
}
export declare type RouteServiceHandle = ServiceHandle<RouteServiceKind>;
export declare type RouteServiceKind = "service:driving-route" | "service:walking-route" | "service:riding-route" | "service:transit-route";
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
export declare const ScaleControl: __VLS_WithSlots_23<typeof __VLS_component_23, __VLS_Slots_23>;
declare interface ScaleControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
export declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
export declare interface SdkResourceSpec<Props, Resource, Context> {
    readonly type: string;
    create(input: {
        context: Context;
        props: Readonly<Props>;
        scope: ResourceScope;
    }): Resource | Promise<Resource>;
    mount(input: {
        context: Context;
        resource: Resource;
        props: Readonly<Props>;
        scope: ResourceScope;
        stale?: boolean;
    }): ResourceRegistration<Resource> | void;
    bind?(input: {
        context: Context;
        resource: Resource;
        props: Readonly<Props>;
        scope: ResourceScope;
    }): void;
    watch?(input: {
        context: () => Context | null;
        resource: () => Resource | null;
        props: Readonly<Props>;
        replace: () => Promise<void>;
        scope: ResourceScope;
    }): void;
}
export declare type SdkResourceStatus = "idle" | "creating" | "ready" | "error" | "disposing" | "disposed";
export declare interface ServiceCall<T> {
    readonly result: Promise<ServiceResult<T>>;
    cancel(): void;
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
export declare interface ServiceInvocationDriver {
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
export declare interface SizeLike {
    width: number;
    height: number;
}
export declare function stringToPluginDefinitions(names: readonly string[]): BMapPluginDefinition<unknown>[];
export declare type StyleExpression = string | Record<string, unknown> | ((properties: Record<string, unknown>) => unknown);
export declare interface TargetContext {
    readonly kind: Readonly<ShallowRef<TargetKind>>;
    readonly target: Readonly<ShallowRef<SdkHandle<string> | null>>;
    add(resource: OverlayHandle): void;
    remove(resource: OverlayHandle): void;
}
export declare const targetContextKey: InjectionKey<TargetContext>;
export declare type TargetKind = "map" | "marker" | "overlay" | "clusterer" | "layer";
export declare const TileLayer: __VLS_WithSlots_30<typeof __VLS_component_30, __VLS_Slots_30>;
declare interface TileLayerProps {
    visible?: boolean;
    opacity?: number;
    zIndex?: number;
    tileUrlTemplate?: string;
    transparentPng?: boolean;
    boundary?: string | string[];
    showRegion?: string;
    retry?: boolean;
    retryTime?: number;
    cacheSize?: number;
    tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
    tileLoadObserver?: TileLoadObserver;
}
declare interface TileLoadInfo {
    readonly url: string;
    readonly tile: HTMLImageElement;
}
declare interface TileLoadObserver {
    onRequest?(info: TileLoadInfo): void;
    onLoaded?(info: TileLoadInfo): void;
    onError?(info: TileLoadInfo): void;
}
export declare function toSdkEventName(vueName: string): string;
export declare function toVueEventName(sdkName: string): string;
export declare function trackAnimationPlugin(): BMapPluginDefinition<unknown>;
export declare const TrackLineLayer: __VLS_WithSlots_42<typeof __VLS_component_42, __VLS_Slots_42>;
export declare interface TrackLineLayerExpose {
    playback: TrackLinePlaybackApi;
    observed: TrackLineObserved | null;
}
export declare interface TrackLineLayerProps {
    data?: object | null;
    visible?: boolean;
    pauseOnHidden?: boolean;
}
export declare interface TrackLineObserved {
    process?: number;
    elapsed?: number;
    distance?: number;
    point?: unknown;
    angle?: number;
    status?: number;
    statusName?: string;
}
declare interface TrackLinePlaybackApi {
    start(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    setSpeed(speed: number): void;
    setProcess(process: number): void;
}
export declare const TrafficLayer: __VLS_WithSlots_31<typeof __VLS_component_31, __VLS_Slots_31>;
declare interface TrafficLayerProps {
    visible?: boolean;
    opacity?: number;
    zIndex?: number;
    autoRefresh?: boolean;
    refreshInterval?: number;
    colors?: string[];
    edge?: boolean;
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
export declare type TransitRouteRequest = RouteRequest;
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
export declare type UnsupportedBehavior = "throw" | "warn" | "silent";
export declare function urlPluginDefinition<T>(name: string, url: string, exportGetter: () => unknown, options?: {
    required?: boolean;
    scope?: "global" | "map";
    dependencies?: readonly string[];
}): BMapPluginDefinition<T>;
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
export declare function useOptionalClientContext(): BMapClientContext | undefined;
export declare function useOverlaySpec<Props extends object, Resource>(props: Props, spec: OverlaySpec<Props, Resource>, options?: UseOverlaySpecOptions): UseOverlaySpecResult<Resource>;
export declare interface UseOverlaySpecOptions {
    emit?: (name: string, payload: unknown) => void;
}
export declare interface UseOverlaySpecResult<Resource> {
    readonly resource: Readonly<ShallowRef<Resource | null>>;
    readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
    readonly error: Readonly<ShallowRef<BMapError | null>>;
    readonly position: OverlayPositionModel | null;
    readonly events: readonly string[];
}
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
export declare function useParentOverlayHandle(): ShallowRef<SdkHandle<string> | null>;
export declare function useRequiredClientContext(): BMapClientContext;
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
export declare function useSdkResource<Props, Resource, Context>(options: UseSdkResourceOptions<Props, Resource, Context>): UseSdkResourceResult<Resource>;
declare interface UseSdkResourceOptions<Props, Resource, Context> {
    props: Readonly<Props>;
    spec: SdkResourceSpec<Props, Resource, Context>;
    resolveContext: (signal: AbortSignal) => Promise<Context>;
    onError?: (error: BMapError) => void;
    label?: string;
}
declare interface UseSdkResourceResult<Resource> {
    readonly resource: Readonly<ShallowRef<Resource | null>>;
    readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
    readonly error: Readonly<ShallowRef<BMapError | null>>;
    replace: () => Promise<void>;
    dispose: () => void;
    whenReady: () => Promise<Resource>;
}
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
declare type WildCardEventHandlerList<T = Record<string, unknown>> = Array<WildcardHandler<T>>;
declare type WildcardHandler<T = Record<string, unknown>> = (type: keyof T, event: T[keyof T]) => void;
export declare const WMSLayer: __VLS_WithSlots_35<typeof __VLS_component_35, __VLS_Slots_35>;
declare interface WMSLayerProps {
    visible?: boolean;
    opacity?: number;
    minZoom?: number;
    maxZoom?: number;
    zIndex?: number;
    url: string;
    params?: Record<string, string>;
    projection?: string;
    tileSize?: number;
    extent?: number[];
    extentCRSIsWGS84?: boolean;
    useThumbData?: boolean;
    spanLevel?: number;
    reproject?: boolean;
    reprojectSourceCRS?: string;
    png8?: boolean;
    height?: number;
    retry?: boolean;
    retryTime?: number;
    dataType?: string;
    cacheSize?: number;
    boundary?: string[];
    thumbParentDepth?: number;
    thumbChildDepth?: number;
    tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
    tileLoadObserver?: TileLoadObserver;
}
export declare const WMTSLayer: __VLS_WithSlots_36<typeof __VLS_component_36, __VLS_Slots_36>;
declare interface WMTSLayerProps {
    visible?: boolean;
    opacity?: number;
    minZoom?: number;
    maxZoom?: number;
    zIndex?: number;
    url: string;
    params?: Record<string, string>;
    extent?: number[];
    extentCRSIsWGS84?: boolean;
    transform?: {
        source?: string;
        target?: string;
    };
    xTemplate?: (x: number, y: number, z: number) => number | string;
    yTemplate?: (x: number, y: number, z: number) => number | string;
    zTemplate?: (x: number, y: number, z: number) => number | string;
    useThumbData?: boolean;
    spanLevel?: number;
    reproject?: boolean;
    reprojectSourceCRS?: string;
    png8?: boolean;
    height?: number;
    retry?: boolean;
    retryTime?: number;
    dataType?: string;
    cacheSize?: number;
    boundary?: string[];
    thumbParentDepth?: number;
    thumbChildDepth?: number;
    tileLoadFunction?: (tile: HTMLImageElement, url: string) => void;
    tileLoadObserver?: TileLoadObserver;
}
export declare interface XYLike {
    x: number;
    y: number;
}
export declare const XYZLayer: __VLS_WithSlots_34<typeof __VLS_component_34, __VLS_Slots_34>;
declare interface XYZLayerProps {
    visible?: boolean;
    opacity?: number;
    minZoom?: number;
    maxZoom?: number;
    zIndex?: number;
    tileUrlTemplate?: string;
    xTemplate?: (x: number, y: number, z: number) => number | string;
    yTemplate?: (x: number, y: number, z: number) => number | string;
    zTemplate?: (x: number, y: number, z: number) => number | string;
    bTemplate?: (x: number, y: number, z: number) => string;
    extent?: number[];
    extentCRSIsWGS84?: boolean;
    boundary?: string[];
    useThumbData?: boolean;
    tms?: boolean;
}
export declare const ZoomControl: __VLS_WithSlots_19<typeof __VLS_component_19, __VLS_Slots_19>;
declare interface ZoomControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
export {};
```
