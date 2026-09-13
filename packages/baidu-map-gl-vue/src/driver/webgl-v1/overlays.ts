/**
 * webgl-v1 OverlayDriver
 *
 * 覆盖物构造器、图标构建与字段级 setter 全部收在 Driver 内；
 * 组件只传领域值对象（Point/Pixel/Size）。
 */
import {
  createHandle,
  type InfoWindowHandle,
  type MapHandle,
  type OverlayHandle,
} from "../types/handles";
import { BMapError } from "../../core/errors/BMapError";
// 注意：本文件内部有同名局部常量 `Point`（SDK 构造器的取值器），因此类型要换个别名导入
import type { GeometryDriver, Point as GeoPoint } from "../types/geometry";
import type {
  CustomOverlayOptions,
  InfoWindowOptions,
  LabelOptions,
  MarkerIconInput,
  MarkerOptions,
  OverlayDriver,
  PathOptions,
} from "../types/overlays";
import { overlayKindOf, overlayPropertyPolicy } from "../types/overlays";
import { callOptional, sdkCall, sdkCtor, type SdkCtor } from "./internal";

const DEFAULT_ICON_URL =
  "https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";

const ICON_OFFSETS: Record<string, [number, number, number, number]> = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
};

const SPECIAL_ICON_URLS: Record<string, string> = {
  start:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%231677ff' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
  end: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%23f04444' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
};

export interface WebGlV1OverlayDriverInput {
  rawSdk: unknown;
  geometry: GeometryDriver;
}

export function createWebGlV1OverlayDriver(input: WebGlV1OverlayDriverInput): OverlayDriver {
  const { rawSdk, geometry } = input;

  const ctor = (name: string): SdkCtor => sdkCtor(rawSdk, name);
  const Point = () => ctor("Point");
  const Size = () => ctor("Size");

  function buildIcon(icon: MarkerIconInput): unknown {
    const Icon = ctor("Icon");
    if (typeof icon === "string") {
      const special = SPECIAL_ICON_URLS[icon];
      if (special) {
        return new Icon(special, new (Size())(24, 32), {
          anchor: new (Size())(12, 16),
        });
      }
      const [ox, oy, w, h] = ICON_OFFSETS[icon] ?? [454, 378, 42, 66];
      return new Icon(DEFAULT_ICON_URL, new (Size())(w / 2, h / 2), {
        imageOffset: new (Size())(ox / 2, oy / 2),
        imageSize: new (Size())(600 / 2, 600 / 2),
      });
    }
    const c = icon;
    const opts: Record<string, unknown> = {
      size: new (Size())(c.size.width, c.size.height),
    };
    if (c.imageSize) opts.imageSize = new (Size())(c.imageSize.width, c.imageSize.height);
    if (c.anchor) opts.anchor = new (Size())(c.anchor.x, c.anchor.y);
    if (c.imageOffset) opts.imageOffset = new (Size())(c.imageOffset.x, c.imageOffset.y);
    if (c.printImageUrl) opts.printImageUrl = c.printImageUrl;
    return new Icon(c.imageUrl, new (Size())(c.size.width, c.size.height), opts);
  }

  const rawPoint = (point: { lng: number; lat: number }) =>
    new (Point())(point.lng, point.lat);

  const rawSize = (offset: { x: number; y: number }) => new (Size())(offset.x, offset.y);

  const toRawPath = (path: readonly ({ lng: number; lat: number } | string)[]): unknown[] =>
    path.map((point) => (typeof point === "string" ? point : rawPoint(point)));

  function pathOptions(options: PathOptions): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (options.strokeColor != null) opts.strokeColor = options.strokeColor;
    if (options.strokeWeight != null) opts.strokeWeight = options.strokeWeight;
    if (options.strokeOpacity != null) opts.strokeOpacity = options.strokeOpacity;
    if (options.strokeStyle != null) opts.strokeStyle = options.strokeStyle;
    if (options.fillColor != null) opts.fillColor = options.fillColor;
    if (options.fillOpacity != null) opts.fillOpacity = options.fillOpacity;
    if (options.enableMassClear != null) opts.enableMassClear = options.enableMassClear;
    if (options.enableEditing != null) opts.enableEditing = options.enableEditing;
    return opts;
  }

  function applyOption(instance: unknown, key: string, value: unknown): unknown {
    switch (key) {
      case "strokeColor":
        return callOptional(instance, "setStrokeColor", value);
      case "strokeWeight":
        return callOptional(instance, "setStrokeWeight", value);
      case "strokeOpacity":
        return callOptional(instance, "setStrokeOpacity", value);
      case "strokeStyle":
        return callOptional(instance, "setStrokeStyle", value);
      case "fillColor":
        return callOptional(instance, "setFillColor", value);
      case "fillOpacity":
        return callOptional(instance, "setFillOpacity", value);
      case "enableMassClear":
        return callOptional(instance, value ? "enableMassClear" : "disableMassClear");
      case "enableEditing":
        return callOptional(instance, value ? "enableEditing" : "disableEditing");
      case "enableDragging":
        return callOptional(instance, value ? "enableDragging" : "disableDragging");
      case "zIndex":
        return callOptional(instance, "setZIndex", value);
      case "rotation":
        return callOptional(instance, "setRotation", value);
      case "title":
        return callOptional(instance, "setTitle", value);
      case "offset":
        return callOptional(instance, "setOffset", rawSize(value as { x: number; y: number }));
      case "icon":
        return callOptional(instance, "setIcon", buildIcon(value as MarkerIconInput));
      case "content":
        return callOptional(instance, "setContent", value);
      case "style":
        return callOptional(instance, "setStyle", value);
      case "opacity":
        return callOptional(instance, "setOpacity", value);
      case "url":
        return callOptional(instance, "setUrl", value);
      case "bounds":
        return callOptional(instance, "setBounds", geometry.toRawBounds(value as never));
      case "position":
        return callOptional(
          instance,
          "setPosition",
          geometry.toRawPoint(value as { lng: number; lat: number }),
        );
      case "width":
        return callOptional(instance, "setWidth", value);
      case "height":
        return callOptional(instance, "setHeight", value);
      case "maxWidth":
        return callOptional(instance, "setMaxWidth", value);
      case "altitude":
        return callOptional(instance, "setAltitude", value);
      case "topFillColor":
        return callOptional(instance, "setTopFillColor", value);
      case "topFillOpacity":
        return callOptional(instance, "setTopFillOpacity", value);
      case "sideFillColor":
        return callOptional(instance, "setSideFillColor", value);
      case "sideFillOpacity":
        return callOptional(instance, "setSideFillOpacity", value);
      case "controlPoints":
        return callOptional(
          instance,
          "setControlPoints",
          (value as readonly ({ lng: number; lat: number }[])[]).map((c) =>
            geometry.toRawPoints(c),
          ),
        );
      case "redraw":
        return callOptional(instance, "redraw");
      case "showRegion":
      case "isBuildingMask":
      case "isMapMask":
      case "isPoiMask":
        // MapMask 类选项：经 raw.setOptions 部分更新
        return callOptional(instance, "setOptions", { [key]: value });
      default: {
        const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (typeof (instance as Record<string, unknown>)[setter] === "function") {
          callOptional(instance, setter, value);
        }
      }
    }
  }

  return {
    createMarker(position, options: MarkerOptions = {}) {
      const Marker = ctor("Marker");
      const opts: Record<string, unknown> = {};
      if (options.offset) opts.offset = rawSize(options.offset);
      if (options.title != null) opts.title = options.title;
      if (options.enableClicking != null) opts.enableClicking = options.enableClicking;
      if (options.enableDragging != null) opts.enableDragging = options.enableDragging;
      if (options.rotation != null) opts.rotation = options.rotation;
      if (options.icon) opts.icon = buildIcon(options.icon);
      const marker = sdkCall("Marker", () => new Marker(rawPoint(position), opts));
      if (options.rotation != null) callOptional(marker, "setRotation", options.rotation);
      if (options.zIndex != null) callOptional(marker, "setZIndex", options.zIndex);
      if (options.enableDragging) callOptional(marker, "enableDragging");
      return createHandle("overlay:marker", marker);
    },

    createPolyline(path, options: PathOptions = {}) {
      const Polyline = ctor("Polyline");
      const line = sdkCall("Polyline", () =>
        new Polyline(geometry.toRawPoints(path), { ...pathOptions(options) }),
      );
      return createHandle("overlay:polyline", line);
    },

    createPolygon(path, options: PathOptions & { isBoundary?: boolean } = {}) {
      const Polygon = ctor("Polygon");
      const rawPath = toRawPath(path);
      const polygon = sdkCall("Polygon", () =>
        new Polygon(rawPath, { ...pathOptions(options), isBoundary: options.isBoundary }),
      );
      return createHandle("overlay:polygon", polygon);
    },

    createCircle(center, radius, options: PathOptions = {}) {
      const Circle = ctor("Circle");
      const circle = sdkCall("Circle", () =>
        new Circle(rawPoint(center), radius, { ...pathOptions(options) }),
      );
      return createHandle("overlay:circle", circle);
    },

    createRectangle(bounds, options: PathOptions = {}) {
      const Rectangle = ctor("Rectangle");
      const rectangle = sdkCall("Rectangle", () =>
        new Rectangle(geometry.toRawBounds(bounds), { ...pathOptions(options) }),
      );
      return createHandle("overlay:rectangle", rectangle);
    },

    createCustomOverlay(position, render, options: CustomOverlayOptions = {}) {
      const CustomOverlay = ctor("CustomOverlay");
      // 领域形状 → BMapGL 构造选项：anchors 是元组、offset 拆成 offsetX / offsetY
      const { anchor, offset, ...rest } = options;
      const opts: Record<string, unknown> = { ...rest, point: geometry.toRawPoint(position) };
      if (anchor) opts.anchors = [anchor.x, anchor.y];
      if (offset) {
        opts.offsetX = offset.x;
        opts.offsetY = offset.y;
      }
      const overlay = sdkCall("CustomOverlay", () => new CustomOverlay(render, opts));
      return createHandle("overlay:custom-overlay", overlay);
    },

    createInfoWindow(content, options: InfoWindowOptions = {}) {
      const InfoWindow = ctor("InfoWindow");
      const opts: Record<string, unknown> = {};
      if (options.width != null) opts.width = options.width;
      if (options.height != null) opts.height = options.height;
      if (options.title != null) opts.title = options.title;
      if (options.enableMaximize != null) opts.enableMaximize = options.enableMaximize;
      if (options.enableAutoPan != null) opts.enableAutoPan = options.enableAutoPan;
      if (options.enableCloseOnClick != null) opts.enableCloseOnClick = options.enableCloseOnClick;
      if (options.offset) opts.offset = rawSize(options.offset);
      const iw = sdkCall("InfoWindow", () => new InfoWindow(content, opts));
      return createHandle("overlay:info-window", iw);
    },

    createLabel(content, options: LabelOptions = {}) {
      const Label = ctor("Label");
      const opts: Record<string, unknown> = {};
      if (options.position) opts.position = rawPoint(options.position);
      if (options.offset) opts.offset = rawSize(options.offset);
      if (options.enableMassClear != null) opts.enableMassClear = options.enableMassClear;
      const label = sdkCall("Label", () => new Label(content, opts));
      if (options.style) callOptional(label, "setStyle", options.style);
      return createHandle("overlay:label", label);
    },

    createPrism(path, altitude, options: Record<string, unknown> = {}) {
      const Prism = ctor("Prism");
      const rawPath = toRawPath(path);
      const prism = sdkCall("Prism", () => new Prism(rawPath, altitude, options));
      return createHandle("overlay:prism", prism);
    },

    createMarker3D(position, height, options: Record<string, unknown> = {}) {
      const Marker3D = ctor("Marker3D");
      const opts: Record<string, unknown> = { ...options };
      if (options.icon) opts.icon = buildIcon(options.icon as MarkerIconInput);
      if (typeof options.shape === "string") {
        const win = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
        opts.shape = (win[options.shape] as unknown) ?? options.shape;
      }
      const marker = sdkCall("Marker3D", () => new Marker3D(rawPoint(position), height, opts));
      return createHandle("overlay:marker3d", marker);
    },

    createBezierCurve(path, controlPoints, options: Record<string, unknown> = {}) {
      const BezierCurve = ctor("BezierCurve");
      const curve = sdkCall("BezierCurve", () =>
        new BezierCurve(
          geometry.toRawPoints(path),
          controlPoints.map((c) => geometry.toRawPoints(c)),
          options,
        ),
      );
      return createHandle("overlay:bezier-curve", curve);
    },

    createMapMask(path, options: Record<string, unknown> = {}) {
      const MapMask = ctor("MapMask");
      const mask = sdkCall("MapMask", () =>
        new MapMask(geometry.toRawPoints(path), options),
      );
      return createHandle("overlay:map-mask", mask);
    },

    createGroundOverlay(bounds, options: Record<string, unknown> = {}) {
      const GroundOverlay = ctor("GroundOverlay");
      const overlay = sdkCall("GroundOverlay", () =>
        new GroundOverlay(geometry.toRawBounds(bounds), options),
      );
      return createHandle("overlay:ground-overlay", overlay);
    },

    createContextMenu() {
      const ContextMenu = ctor("ContextMenu");
      const menu = sdkCall("ContextMenu", () => new ContextMenu());
      return createHandle("overlay:context-menu", menu);
    },

    addContextMenuItem(menu, item, options) {
      const raw = menu.raw as { addItem: (i: unknown) => void; addSeparator: () => void };
      if (item === "-") {
        sdkCall("ContextMenu.addSeparator", () => raw.addSeparator());
        return;
      }
      const MenuItem = ctor("MenuItem");
      const menuItem = new MenuItem(item.text, item.callback, { width: options?.width });
      sdkCall("ContextMenu.addItem", () => raw.addItem(menuItem));
    },

    add(target, overlay) {
      const rawMap = target.handle.raw as { addOverlay: (o: unknown) => void };
      sdkCall("map.addOverlay", () => rawMap.addOverlay(overlay.raw));
    },

    remove(target, overlay) {
      // 先隐藏再移除：SDK 的异步渲染管线可能在 removeOverlay 之后仍访问
      // 覆盖物数据（如 MapMask 的填充顶点），直接移除会间歇性崩溃。
      // hide 失败不阻断移除。
      try {
        callOptional(overlay.raw, "hide");
      } catch {
        /* 忽略隐藏错误 */
      }
      const rawMap = target.handle.raw as { removeOverlay: (o: unknown) => void };
      sdkCall("map.removeOverlay", () => rawMap.removeOverlay(overlay.raw));
    },

    show(overlay) {
      const raw = overlay.raw as { show?: () => void };
      if (typeof raw.show !== "function") return false;
      callOptional(raw, "show");
      return true;
    },

    hide(overlay) {
      const raw = overlay.raw as { hide?: () => void };
      if (typeof raw.hide !== "function") return false;
      callOptional(raw, "hide");
      return true;
    },

    attachContextMenu(target, menu) {
      callOptional(target.handle.raw, "addContextMenu", menu.raw);
    },

    detachContextMenu(target, menu) {
      callOptional(target.handle.raw, "removeContextMenu", menu.raw);
    },

    setPosition(overlay, position) {
      const raw = overlay.raw as {
        setPosition?: (p: unknown) => void;
        setCenter?: (p: unknown) => void;
      };
      const point = geometry.toRawPoint(position);
      if (typeof raw.setPosition === "function") callOptional(raw, "setPosition", point);
      else if (typeof raw.setCenter === "function") callOptional(raw, "setCenter", point);
    },

    setPath(overlay, path) {
      callOptional(overlay.raw, "setPath", toRawPath(path));
    },

    setOptions(overlay, options) {
      for (const [key, value] of Object.entries(options)) {
        applyOption(overlay.raw, key, value);
      }
    },

    // 元数据来自公共 `OVERLAY_DESCRIPTORS`（与 v4 同一份事实源）；webgl-v1 的 setOptions
    // 仍然是自己的 switch 实现（#26 待删除，不追平 v4 的分类驱动路径）。
    updatePolicy(overlay, key) {
      const kind = overlayKindOf(overlay);
      return kind ? overlayPropertyPolicy(kind, key) : undefined;
    },

    openInfoWindow(map: MapHandle, overlay, position: GeoPoint) {
      // 与 v4 同一份契约（R25-C 复审 P1）：位置必需，不做「实例级回退」。
      // legacy 的 `InfoWindow#openInfoWindow(point)` 在官方文档里同样要求位置，而位置从哪来
      // 一直是未定义的——把「碰巧打开」变成显式失败，两个引擎的公共契约才是同一条。
      if (!position || !Number.isFinite(position.lng) || !Number.isFinite(position.lat)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "OverlayDriver.openInfoWindow: 必须给出 position——官方 map.openInfoWindow(infoWnd, point) " +
            "里 point 是必需参数（气泡挂到 Marker 的目标级打开属 M5 #31/#32）",
          { engine: "webgl-v1" },
        );
      }
      const rawMap = map.raw as { openInfoWindow: (w: unknown, p?: unknown) => void };
      sdkCall("map.openInfoWindow", () =>
        rawMap.openInfoWindow(overlay.raw, geometry.toRawPoint(position)),
      );
    },

    closeInfoWindow(overlay: InfoWindowHandle) {
      const raw = overlay.raw as { hide?: () => void };
      callOptional(raw, "hide");
    },

    redrawInfoWindow(overlay) {
      callOptional(overlay.raw, "redraw");
    },

    buildIcon,
  };
}
