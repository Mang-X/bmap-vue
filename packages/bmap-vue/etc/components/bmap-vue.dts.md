## API Signature Baseline for "bmap-vue" (entry `./components`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/components.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> API Extractor 分析不了这两个出口的 Volar `__VLS_` 悬空引用，
> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。

```ts
import { AllowedComponentProps } from "vue";
import { ComponentCustomProps } from "vue";
import { ComponentOptionsMixin } from "vue";
import { ComponentProvideOptions } from "vue";
import { ComputedRef } from "vue";
import { DefineComponent } from "vue";
import { PublicProps } from "vue";
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
    select: (event: ContextMenuSelectPayload_2) => any;
    close: (event: OverlayPartialPointerEvent) => any;
    open: (event: OverlayPartialPointerEvent) => any;
}, string, PublicProps, Readonly<ContextMenuProps> & Readonly<{
    onSelect?: ((event: ContextMenuSelectPayload_2) => any) | undefined;
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
    getBounds(): Bounds_2 | null;
    getSize(): Size_2 | null;
    setCenter(center: Point): void;
    setZoom(zoom: number): void;
    setHeading(heading: number): void;
    setTilt(tilt: number): void;
    panTo(point: Point): void;
    panBy(pixel: Pixel_2): void;
    fitBounds(bounds: Bounds_2): void;
    supports(capability: Capability_2): boolean;
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
    kind: DistrictType;
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
    "update:position": (event: Point_2) => any;
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
    "onUpdate:position"?: ((event: Point_2) => any) | undefined;
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
    offset: Pixel_2;
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
export declare const Autocomplete: DefineComponent<AutocompleteProps, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {
    searchComplete: (e: unknown) => any;
    highlight: (e: unknown) => any;
    confirm: (e: unknown) => any;
}, string, PublicProps, Readonly<AutocompleteProps> & Readonly<{
    onSearchComplete?: ((e: unknown) => any) | undefined;
    onHighlight?: ((e: unknown) => any) | undefined;
    onConfirm?: ((e: unknown) => any) | undefined;
}>, {}, {}, {}, {}, string, ComponentProvideOptions, false, {}, any>;
declare interface AutocompleteOptions {
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
declare interface AutocompleteUpdateOptions {
    location?: unknown;
    types?: string[];
}
export declare const BezierCurve: __VLS_WithSlots_14<typeof __VLS_component_14, __VLS_Slots_14>;
declare interface BezierCurveProps extends PathStrokeProps, PathShapeProps {
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
declare interface BMapClient {
    readonly id: symbol;
    readonly engine: BMapEngine;
    readonly libraryVersion: string;
    readonly sdkVersion: string;
    readonly driver: BMapDriver;
    readonly capabilities: CapabilityRegistry;
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
declare type BMapDriverFactory = (input: BMapDriverInput) => BMapDriver;
declare interface BMapDriverInput {
    readonly loaded: LoadedJsapiV4;
    readonly unsupported: UnsupportedBehavior;
    readonly capabilityOverrides?: Partial<Record<Capability, boolean>>;
}
declare type BMapEngine = "jsapi-v4";
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
export declare const BMapProvider: __VLS_WithSlots<typeof __VLS_component, __VLS_Slots>;
declare interface BMapProviderLike {
    readonly id?: string;
    getCacheKey?(options: BMapLoadOptions): string;
    load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4>;
}
declare interface BMapProviderProps {
    client?: BMapClient;
    definition?: CreateBMapClientOptions;
    provider?: BMapProviderLike;
    loadOptions?: BMapLoadOptions;
    autoLoad?: boolean;
    suspense?: boolean;
}
declare interface Bounds {
    southwest: Point;
    northeast: Point;
}
declare interface Bounds_2 {
    southwest: Point_2;
    northeast: Point_2;
}
declare type BuiltinMarkerIconName = "simple_red" | "simple_blue" | "loc_red" | "loc_blue" | "start" | "end" | "location" | "red1" | "red2" | "red3" | "red4" | "red5" | "red6" | "red7" | "red8" | "red9" | "red10" | "blue1" | "blue2" | "blue3" | "blue4" | "blue5" | "blue6" | "blue7" | "blue8" | "blue9" | "blue10";
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
export declare const Circle: __VLS_WithSlots_5<typeof __VLS_component_5, __VLS_Slots_5>;
declare type CircleHandle = SdkHandle<"overlay:circle">;
declare interface CircleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
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
declare type ClientStatus = "idle" | "loading" | "ready" | "error" | "disposed";
declare interface ClusterChange {
    engine: MarkerClusterEngine;
    clusters: number;
    singles: number;
    zoom: number | null;
}
declare interface ClusterPick<Item> {
    engine: MarkerClusterEngine;
    id: string;
    size: number;
    position: {
        lng: number;
        lat: number;
    };
    items: Item[] | null;
}
export declare const ContextMenu: __VLS_WithSlots_10<typeof __VLS_component_10, __VLS_Slots_10>;
declare interface ContextMenuItem {
    text: string;
    callback?: (payload: ContextMenuSelectPayload) => void;
    disabled?: boolean;
    width?: number;
    id?: string;
}
declare interface ContextMenuItem_2 {
    text: string;
    callback?: (payload: ContextMenuSelectPayload_2) => void;
    disabled?: boolean;
    width?: number;
    id?: string;
}
declare interface ContextMenuProps {
    items?: (ContextMenuItem | ContextMenuSeparator)[];
    width?: number;
    visible?: boolean;
}
declare interface ContextMenuSelectPayload {
    item: ContextMenuItem;
    index: number;
    point?: Point;
    pixel?: Pixel;
    map: MapHandle;
    target: SdkHandle<string> | null;
}
declare interface ContextMenuSelectPayload_2 {
    item: ContextMenuItem_2;
    index: number;
    point?: Point_2;
    pixel?: Pixel_2;
    map: MapHandle_2;
    target: SdkHandle_2<string> | null;
}
declare type ContextMenuSeparator = "-";
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
export declare const CopyrightControl: __VLS_WithSlots_27<typeof __VLS_component_27, __VLS_Slots_27>;
declare interface CopyrightControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
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
declare interface CustomOverlayProps {
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
declare interface DataComponentProps<Item> {
    data: readonly Item[];
    itemKey: keyof Item | ((item: Item) => PropertyKey);
    getPosition: (item: Item) => {
        lng: number;
        lat: number;
    } | null | undefined;
    dataVersion?: PropertyKey;
    visible?: boolean;
}
export declare const DistrictLayer: __VLS_WithSlots_28<typeof __VLS_component_28, __VLS_Slots_28>;
declare interface DistrictLayerProps {
    visible?: boolean;
    name: string;
    kind?: DistrictType;
    fillColor?: string;
    fillOpacity?: number;
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    viewport?: boolean;
    adcode?: string;
}
declare type DistrictType = DistrictTypeValue;
declare const DistrictType_2: {
    readonly PROVINCE: 0;
    readonly CITY: 1;
    readonly AREA: 2;
};
declare type DistrictTypeValue = (typeof DistrictType_2)[keyof typeof DistrictType_2];
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
declare interface DriverEvent {
    type?: string;
    point?: Point_2;
    pixel?: Pixel_2;
    size?: Size_2;
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
declare interface DrivingRouteOptions extends RouteState {
    policy?: DrivingPolicy_2;
}
declare interface EventDriver {
    on<TEvent = unknown>(target: SdkHandle<string>, type: string, listener: (event: TEvent) => void): () => void;
}
declare type FeaturePick = PointPick<Record<string, unknown>>;
declare interface FeatureStateApi<KeyDomain extends FeatureStateKeyDomain = "default"> {
    update(keys: FeatureStateKeysOf<KeyDomain>, state: NativeLayerFeatureState_2, options?: FeatureStateUpdateOptions): void;
    remove(keys: FeatureStateKeysOf<KeyDomain>): void;
    clear(): void;
    replace(inputs: NativeLayerFeatureStateMap_2): void;
    get(keys?: FeatureStateKeysOf<KeyDomain>): NativeLayerFeatureStateMap_2;
}
declare type FeatureStateKeyDomain = "default" | "string";
declare type FeatureStateKeysOf<KeyDomain extends FeatureStateKeyDomain = "default"> = KeyDomain extends "string" ? string | ReadonlyArray<string> : NativeLayerFeatureKeys_2;
declare interface FeatureStateUpdateOptions {
    readonly append?: boolean;
}
export declare const FillLayer: __VLS_WithSlots_40<typeof __VLS_component_40, __VLS_Slots_40>;
declare interface FillLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
    data?: object | null;
    style?: FillLayerStyle;
    border?: boolean;
}
declare interface FillLayerStyle {
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
export declare const GroundOverlay: __VLS_WithSlots_13<typeof __VLS_component_13, __VLS_Slots_13>;
declare interface GroundOverlayProps {
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
declare type GroundOverlayType = "image" | "video" | "canvas";
declare type GroundOverlayUrl = string | HTMLCanvasElement | (() => string | HTMLCanvasElement);
declare const HANDLE_BRAND: unique symbol;
declare const HANDLE_BRAND_2: unique symbol;
export declare const HeatmapLayer: __VLS_WithSlots_41<typeof __VLS_component_41, __VLS_Slots_41>;
declare interface HeatmapLayerProps {
    data?: object | null;
    style?: Record<string, unknown>;
    visible?: boolean;
}
export declare const InfoWindow: __VLS_WithSlots_4<typeof __VLS_component_4, __VLS_Slots_4>;
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
declare interface InfoWindowProps extends InfoWindowProps_2 {
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
export declare const Label: __VLS_WithSlots_9<typeof __VLS_component_9, __VLS_Slots_9>;
declare type LabelHandle = SdkHandle<"overlay:label">;
declare interface LabelOptions {
    position?: Point;
    offset?: Pixel;
    zIndex?: number;
    style?: Record<string, unknown>;
    enableMassClear?: boolean;
    [key: string]: unknown;
}
declare interface LabelProps {
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
declare type LabelStyle = Record<string, unknown>;
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
export declare const LineLayer: __VLS_WithSlots_39<typeof __VLS_component_39, __VLS_Slots_39>;
declare interface LineLayerProps extends NativeLayerCommonProps, NativeLayerPickOptions {
    data?: object | null;
    style?: LineLayerStyle;
}
declare interface LineLayerStyle {
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
declare const MAP_SUSPEND_REASONS: {
    readonly user: "user";
    readonly keepAlive: "keep-alive";
    readonly document: "document";
    readonly offscreen: "offscreen";
    readonly disposed: "disposed";
};
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
declare type MapEventPayload = DriverEvent & {
    type: string;
};
declare type MapHandle = SdkHandle<"map">;
declare type MapHandle_2 = SdkHandle_2<"map">;
declare type MapInteraction = "dragging" | "scroll-zoom" | "inertial-dragging" | "pinch-zoom" | "keyboard" | "double-click-zoom" | "continuous-zoom" | "resize-on-center" | "rotate" | "rotate-gestures" | "tilt" | "tilt-gestures";
declare interface MapLoadEvent extends DriverEvent {
    point: Point_2;
    zoom: number;
}
declare type MapLoadPayload = MapLoadEvent & {
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
declare type MapMaskShowRegion = "inside" | "outside";
declare interface MapMouseEvent extends DriverEvent {
    point: Point_2;
}
declare type MapPointerEvent = MapMouseEvent & {
    type: string;
};
declare interface MapProps {
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
declare interface MapReadyContext {
    readonly client: BMapClient;
    readonly map: MapHandle;
}
declare interface MapReadyPayload extends MapReadyContext {
    container: HTMLElement;
}
declare interface MapResizeEvent extends DriverEvent {
    size: Size_2;
}
declare type MapResizePayload = MapResizeEvent & {
    type: string;
};
declare type MapStyleInput = {
    styleId: string;
} | Record<string, unknown>;
declare type MapSuspendReason = (typeof MAP_SUSPEND_REASONS)[keyof typeof MAP_SUSPEND_REASONS] | (string & {});
declare type MapType_2 = "normal" | "satellite" | "earth";
declare interface MapTypeChangeEvent extends DriverEvent {
    zoomLevel: number;
}
declare type MapTypeChangePayload = MapTypeChangeEvent & {
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
declare interface MapView {
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
declare type MarkerClusterEngine = "native" | "markers";
declare interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
    gridSize?: number;
    minClusterSize?: number;
    zoom?: number;
}
declare interface MarkerClusterProps<Item> extends DataComponentProps<Item> {
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
declare interface MarkerCustomIcon {
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
declare type MarkerHandle = SdkHandle<"overlay:marker">;
declare type MarkerIcon = MarkerIconName | MarkerCustomIcon;
declare type MarkerIconInput = string | {
    imageUrl: string;
    size: Size;
    anchor?: Pixel;
    imageOffset?: Pixel;
    imageSize?: Size;
    printImageUrl?: string;
};
declare type MarkerIconName = BuiltinMarkerIconName;
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
declare interface MarkerListProps<Item> extends DataComponentProps<Item> {
}
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
declare interface MarkerProps {
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
declare interface MenuItemProps {
    text: string;
    disabled?: boolean;
    width?: number;
    id?: string;
}
export declare const MenuSeparator: DefineComponent<{}, {}, {}, {}, {}, ComponentOptionsMixin, ComponentOptionsMixin, {}, string, PublicProps, Readonly<{}> & Readonly<{}>, {}, {}, {}, {}, string, ComponentProvideOptions, true, {}, any>;
export declare const MVTLayer: __VLS_WithSlots_38<typeof __VLS_component_38, __VLS_Slots_38>;
declare interface MVTLayerBaseEvent {
    type?: string;
    [key: string]: unknown;
}
declare interface MVTLayerEntity {
    id: string;
    layerName: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
}
declare interface MVTLayerMouseEvent {
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
declare interface MVTLayerMouseMoveEvent extends MVTLayerMouseEvent {
    value: MVTLayerEntity[];
}
declare interface MVTLayerPickEvent extends MVTLayerMouseEvent {
    value?: MVTLayerEntity[];
}
declare interface MVTLayerProps {
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
declare type MVTLayerStyle = Record<string, MVTLayerStyleEntry>;
declare interface MVTLayerStyleEntry {
    type?: string;
    painter?: Record<string, unknown>;
    [key: string]: unknown;
}
declare interface NativeLayerCommonProps {
    visible?: boolean;
    opacity?: number;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
}
declare type NativeLayerFeatureKeys = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureKeys_2 = string | number | ReadonlyArray<string | number>;
declare type NativeLayerFeatureState = Record<string, unknown>;
declare type NativeLayerFeatureState_2 = Record<string, unknown>;
declare type NativeLayerFeatureStateMap = Record<string, NativeLayerFeatureState>;
declare type NativeLayerFeatureStateMap_2 = Record<string, NativeLayerFeatureState_2>;
declare interface NativeLayerPickOptions {
    idKey?: string;
    crs?: string;
    enablePicked?: boolean;
    pickWidth?: number;
    pickHeight?: number;
    autoSelect?: boolean;
    selectedColor?: string;
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
declare interface OverlayEventPayload extends DriverEvent {
    type: string;
}
declare type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
declare interface OverlayPartialPointerEvent extends OverlayEventPayload {
    point?: Point_2;
}
declare interface OverlayPointerEvent extends OverlayEventPayload {
    point: Point_2;
}
declare type OverlayPropertyPolicy = "mutable" | "recreate" | "unsupported";
declare interface OverlayTarget {
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
declare interface PanoramaDriver {
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
declare type PanoramaLabelHandle = SdkHandle<"panorama:label">;
declare interface PanoramaLabelProps {
    content?: string;
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
declare type PanoramaSceneType = "street" | "inter";
declare type PanoramaStatus = "idle" | "waiting-client" | "creating" | "ready" | "error" | "disposing" | "disposed";
declare interface PathEditableProps {
    enableEditing?: boolean;
}
declare interface PathFillProps {
    fillColor?: string;
    fillOpacity?: number;
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
declare interface PointCollectionProps<Item> extends DataComponentProps<Item> {
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
declare interface PointIconLayerProps<Item> extends DataComponentProps<Item> {
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
declare interface PointLayerProps<Item> extends DataComponentProps<Item> {
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
declare interface PointPick<Item> {
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
declare type PolygonHandle = SdkHandle<"overlay:polygon">;
declare interface PolygonProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
    path: ({
        lng: number;
        lat: number;
    } | string)[];
    pathVersion?: string | number;
    isBoundary?: boolean;
}
export declare const Polyline: __VLS_WithSlots_6<typeof __VLS_component_6, __VLS_Slots_6>;
declare type PolylineHandle = SdkHandle<"overlay:polyline">;
declare interface PolylineProps extends PathStrokeProps, PathShapeProps, PathEditableProps {
    path: {
        lng: number;
        lat: number;
    }[];
    pathVersion?: string | number;
}
export declare const Prism: __VLS_WithSlots_12<typeof __VLS_component_12, __VLS_Slots_12>;
declare interface PrismProps {
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
declare interface RectangleProps extends PathStrokeProps, PathFillProps, PathShapeProps, PathEditableProps {
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
declare function retry(): Promise<void>;
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
export declare const ScaleControl: __VLS_WithSlots_23<typeof __VLS_component_23, __VLS_Slots_23>;
declare interface ScaleControlProps {
    anchor?: string;
    offset?: {
        x: number;
        y: number;
    };
    visible?: boolean;
}
declare interface SdkHandle<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND]: Kind;
    readonly raw: Raw;
}
declare interface SdkHandle_2<Kind extends string, Raw = unknown> {
    readonly [HANDLE_BRAND_2]: Kind;
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
declare interface Size_2 {
    width: number;
    height: number;
}
declare type StyleExpression = string | Record<string, unknown> | ((properties: Record<string, unknown>) => unknown);
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
export declare const TrackLineLayer: __VLS_WithSlots_42<typeof __VLS_component_42, __VLS_Slots_42>;
declare interface TrackLineLayerProps {
    data?: object | null;
    visible?: boolean;
    pauseOnHidden?: boolean;
}
declare interface TrackLineObserved {
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
declare type ViewAnimationCancelOutcome = "canceled" | "deferred" | "already-settled";
declare type WalkingRouteOptions = RouteRenderState;
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
