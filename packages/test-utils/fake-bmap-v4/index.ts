/**
 * Fake BMap v4 namespace
 *
 * JSAPI 4.0（`v=4.0`，全局 `BMap`）的最小可观察替身：几何构造器、Map、`MapTypeId`
 * 常量、核心与高级覆盖物、右键菜单与图标、控件（#22）、图层（#22）、六个基础服务与
 * JSONP 注册表（#23），以及统一的诊断计数（监听器 / 资源 / 定时器 / 回调，见 `diagnostics.ts`，
 * #24）。
 * 它位于 raw SDK 边界之外（`packages/test-utils` 不在 `check-raw-sdk` 扫描范围内），
 * 是 v4 Driver 的 Fake 边界。
 *
 * 刻意**不提供** `Marker3D` / `MapMask`：这两个构造器不在 `@baidumap/jsapi-v4-types@4.0.4`
 * 的声明里，官方参考也没有对应章节，属于「本引擎没有可核对的运行时入口」的成员。
 * 覆盖物 Facet（#21）据此把它们做成显式失败路径，Fake 缺这两个成员正是那条路径的测试依据。
 *
 * 相反，`PanoramaCoverageLayer` 虽然同样不在 4.0.4 的类型声明里，但官方 Skill 明确它是 4.0
 * 公开控件/图层之一，因此 Fake **提供**它，用来覆盖「真实运行时存在」的创建路径（#22）。
 *
 * 用法：
 *   const fake = createFakeBMapV4()
 *   const geometry = createJsapiV4GeometryDriver(fake.namespace)
 *   fake.diagnostics.reset() // 每个用例开头重置
 *   fake.diagnostics.assertNoLeaks() // 卸载之后断言资源全部释放
 */
import { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4RuntimeExtensions } from './runtime-extensions.ts'
import {
  FakeV4Map,
  FakeV4MapTypeId,
  FakeV4ViewAnimation,
  type FakeV4AnimationOptions,
} from './FakeMap.ts'
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
import {
  FakeV4CityListControl,
  FakeV4Control,
  FakeV4CopyrightControl,
  FakeV4DistrictLayer,
  FakeV4GeolocationControl,
  FakeV4Layer,
  FakeV4NavigationControl,
  FakeV4OverviewMapControl,
  FakeV4PanoramaCoverageLayer,
  FakeV4ScaleControl,
  FakeV4TileLayer,
} from './controls-layers.ts'
import {
  FakeV4BezierCurve,
  FakeV4Circle,
  FakeV4ContextMenu,
  FakeV4CustomOverlay,
  FakeV4GroundOverlay,
  FakeV4Icon,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4MenuItem,
  FakeV4Polygon,
  FakeV4Polyline,
  FakeV4Prism,
  FakeV4Rectangle,
} from './objects.ts'
import {
  FakeV4Autocomplete,
  FakeV4AutocompleteResult,
  FakeV4Boundary,
  FakeV4CallbackQueue,
  FakeV4Convertor,
  FakeV4DrivingRoute,
  FakeV4Geocoder,
  FakeV4Geolocation,
  FakeV4LocalCity,
  FakeV4LocalResult,
  FakeV4LocalResultPoi,
  FakeV4LocalSearch,
  FakeV4RidingRoute,
  FakeV4RouteService,
  FakeV4TransitRoute,
  FakeV4WalkingRoute,
} from './services.ts'
import {
  FakeV4ClusterLayer,
  FakeV4FillLayer,
  FakeV4Heatmap,
  FakeV4LineLayer,
  FakeV4PointIconLayer,
  FakeV4PointLayer,
  FakeV4PointShapeLayer,
  FakeV4TrackLine,
} from './native-layers.ts'
import { FakeV4Panorama, FakeV4PanoramaService } from './panorama.ts'

export { FakeV4Diagnostics } from './diagnostics.ts'
export { FakeV4EventTarget } from './event-target.ts'
export {
  FAKE_V4_RUNTIME_INJECTED_MEMBERS,
  FakeV4RuntimeExtensions,
} from './runtime-extensions.ts'
export type { FakeV4RuntimeInjectedMember } from './runtime-extensions.ts'
export type {
  FakeV4ActivityCounters,
  FakeV4AttachmentKind,
  FakeV4DiagnosticsSnapshot,
  FakeV4LeakCounters,
  FakeV4LifecycleKind,
  FakeV4ResourceKind,
} from './diagnostics.ts'
export {
  FAKE_V4_INTERACTIONS,
  FakeV4Map,
  FakeV4MapTypeId,
  FakeV4ViewAnimation,
} from './FakeMap.ts'
export type { FakeV4AnimationOptions, FakeV4Interaction } from './FakeMap.ts'
export { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
export {
  FakeV4CityListControl,
  FakeV4Control,
  FakeV4CopyrightControl,
  FakeV4DistrictLayer,
  FakeV4GeolocationControl,
  FakeV4Layer,
  FakeV4NavigationControl,
  FakeV4OverviewMapControl,
  FakeV4PanoramaCoverageLayer,
  FakeV4ScaleControl,
  FakeV4TileLayer,
} from './controls-layers.ts'
export {
  FakeV4BezierCurve,
  FakeV4Circle,
  FakeV4ContextMenu,
  FakeV4CustomOverlay,
  FakeV4GroundOverlay,
  FakeV4Icon,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4MenuItem,
  FakeV4Overlay,
  FakeV4Polygon,
  FakeV4Polyline,
  FakeV4Prism,
  FakeV4Rectangle,
} from './objects.ts'
export {
  FakeV4Autocomplete,
  FakeV4AutocompleteResult,
  FakeV4Boundary,
  FakeV4CallbackQueue,
  FakeV4Convertor,
  FakeV4DrivingRoute,
  FakeV4Geocoder,
  FakeV4Geolocation,
  FakeV4LocalCity,
  FakeV4LocalResult,
  FakeV4LocalResultPoi,
  FakeV4LocalSearch,
  FakeV4RidingRoute,
  FakeV4RoutePlan,
  FakeV4RoutePoi,
  FakeV4RouteResult,
  FakeV4RouteService,
  FakeV4RouteStep,
  FakeV4Route as FakeV4RoutePath,
  FakeV4TransitLine,
  FakeV4TransitRoute,
  FakeV4TransitRoutePlan,
  FakeV4TransitRouteResult,
  FakeV4WalkingRoute,
} from './services.ts'
export type {
  FakeV4LocalResultOptions,
  FakeV4LocalSearchPoiOptions,
  FakeV4PointLike,
} from './services.ts'
export {
  FakeV4ClusterLayer,
  FakeV4FillLayer,
  FakeV4Heatmap,
  FakeV4LineLayer,
  FakeV4NativeLayerBase,
  FakeV4PointIconLayer,
  FakeV4PointLayer,
  FakeV4PointShapeLayer,
  FakeV4RuntimeLayer,
  FakeV4TrackLine,
} from './native-layers.ts'
export { FakeV4Panorama, FakeV4PanoramaService } from './panorama.ts'

export interface FakeBMapV4Namespace {
  Map: new (container: string | HTMLElement, options?: Record<string, unknown>) => FakeV4Map
  Point: new (lng: number, lat: number) => FakeV4Point
  Pixel: new (x: number, y: number) => FakeV4Pixel
  Size: new (width: number, height: number) => FakeV4Size
  Bounds: new (sw?: FakeV4Point, ne?: FakeV4Point) => FakeV4Bounds
  Marker: new (point: FakeV4Point, options?: Record<string, unknown>) => FakeV4Marker
  Polyline: new (path: FakeV4Point[], options?: Record<string, unknown>) => FakeV4Polyline
  Polygon: new (path: FakeV4Point[], options?: Record<string, unknown>) => FakeV4Polygon
  Rectangle: new (bounds: FakeV4Bounds, options?: Record<string, unknown>) => FakeV4Rectangle
  Circle: new (point: FakeV4Point, radius: number, options?: Record<string, unknown>) => FakeV4Circle
  Label: new (content: string, options?: Record<string, unknown>) => FakeV4Label
  InfoWindow: new (content: string | HTMLElement, options?: Record<string, unknown>) => FakeV4InfoWindow
  GroundOverlay: new (bounds: FakeV4Bounds, options?: Record<string, unknown>) => FakeV4GroundOverlay
  Prism: new (
    path: FakeV4Point[],
    altitude: number,
    options?: Record<string, unknown>,
  ) => FakeV4Prism
  BezierCurve: new (
    path: FakeV4Point[],
    controlPoints: FakeV4Point[][],
    options?: Record<string, unknown>,
  ) => FakeV4BezierCurve
  CustomOverlay: new (
    domCreate: () => HTMLElement,
    options?: Record<string, unknown>,
  ) => FakeV4CustomOverlay
  ContextMenu: new (options?: Record<string, unknown>) => FakeV4ContextMenu
  MenuItem: new (
    text: string,
    callback: (...args: unknown[]) => void,
    options?: Record<string, unknown>,
  ) => FakeV4MenuItem
  Icon: new (
    image: string | HTMLCanvasElement | HTMLImageElement,
    size: FakeV4Size,
    opts?: Record<string, unknown>,
  ) => FakeV4Icon
  /** 视角动画构造器（官方 `BMap.ViewAnimation`）。 */
  ViewAnimation: new (
    keyFrames: unknown[],
    options?: FakeV4AnimationOptions,
  ) => FakeV4ViewAnimation
  /** 地图类型常量（官方 4.0.4 以静态成员声明在 `BMap.MapTypeId` 上）。 */
  MapTypeId: typeof FakeV4MapTypeId
  /* ---------------------------------------------------- 控件（#22） */
  Control: new () => FakeV4Control
  ZoomControl: new (options?: Record<string, unknown>) => FakeV4Control
  ScaleControl: new (options?: Record<string, unknown>) => FakeV4ScaleControl
  NavigationControl: new (options?: Record<string, unknown>) => FakeV4NavigationControl
  NavigationControl3D: new (options?: Record<string, unknown>) => FakeV4Control
  CityListControl: new (options?: Record<string, unknown>) => FakeV4CityListControl
  /** 官方 `location` 语义在 4.0 上统一写 `GeolocationControl`（领域名仍是 `location`）。 */
  GeolocationControl: new (options?: Record<string, unknown>) => FakeV4GeolocationControl
  MapTypeControl: new (options?: Record<string, unknown>) => FakeV4Control
  OverviewMapControl: new (options?: Record<string, unknown>) => FakeV4OverviewMapControl
  PanoramaControl: new (options?: Record<string, unknown>) => FakeV4Control
  CopyrightControl: new (options?: Record<string, unknown>) => FakeV4CopyrightControl
  /* ---------------------------------------------------- 图层（#22） */
  DistrictLayer: new (options?: Record<string, unknown>) => FakeV4DistrictLayer
  TileLayer: new (options?: Record<string, unknown>) => FakeV4TileLayer
  /** 官方 4.0 运行时公开、但 4.0.4 类型包未声明类声明的成员。 */
  PanoramaCoverageLayer: new () => FakeV4PanoramaCoverageLayer
  /* -------------------------------------------------- 服务（#23） */
  Geocoder: new (opts?: Record<string, unknown>) => FakeV4Geocoder
  Convertor: new () => FakeV4Convertor
  Boundary: new () => FakeV4Boundary
  Geolocation: new (options?: Record<string, unknown>) => FakeV4Geolocation
  LocalCity: new (options?: Record<string, unknown>) => FakeV4LocalCity
  Autocomplete: new (options?: Record<string, unknown>) => FakeV4Autocomplete
  LocalSearch: new (
    location: unknown,
    options?: Record<string, unknown>,
  ) => FakeV4LocalSearch
  /* ------------------------------------------- 路线规划（#39） */
  DrivingRoute: new (location: unknown, options?: Record<string, unknown>) => FakeV4DrivingRoute
  WalkingRoute: new (location: unknown, options?: Record<string, unknown>) => FakeV4WalkingRoute
  RidingRoute: new (location: unknown, options?: Record<string, unknown>) => FakeV4RidingRoute
  TransitRoute: new (location: unknown, options?: Record<string, unknown>) => FakeV4TransitRoute
  /* ---------------------------------------------- 原生数据图层（#23） */
  PointIconLayer: new (options?: Record<string, unknown>) => FakeV4PointIconLayer
  PointShapeLayer: new (options?: Record<string, unknown>) => FakeV4PointShapeLayer
  LineLayer: new (options?: Record<string, unknown>) => FakeV4LineLayer
  FillLayer: new (options?: Record<string, unknown>) => FakeV4FillLayer
  /** 4.0 运行时公开、4.0.4 类型包未声明类声明的扩展 API。 */
  PointLayer: new (options?: Record<string, unknown>) => FakeV4PointLayer
  ClusterLayer: new (options?: Record<string, unknown>) => FakeV4ClusterLayer
  Heatmap: new (options?: Record<string, unknown>) => FakeV4Heatmap
  TrackLine: new (options?: Record<string, unknown>) => FakeV4TrackLine
  /* -------------------------------------------------- 全景（#23） */
  Panorama: new (
    container: string | HTMLElement,
    options?: Record<string, unknown>,
  ) => FakeV4Panorama
  PanoramaService: new () => FakeV4PanoramaService
  VERSION: string
}

export interface FakeBMapV4 {
  namespace: FakeBMapV4Namespace
  /**
   * 诊断计数（泄漏门禁 + 活动口径）。
   *
   * `stats` 是同一对象的别名（#24 之前的名字只统计监听器）；新代码请用 `diagnostics`，
   * 两者指向同一个实例，调用 `reset()` 任一即可清零。
   */
  diagnostics: FakeV4Diagnostics
  /** @deprecated 诊断对象的历史别名，等价于 `diagnostics`。 */
  stats: FakeV4Diagnostics
  /** 测试辅助：记录已创建的 Map 实例 */
  createdMaps: FakeV4Map[]
  /** 测试辅助：记录已创建的覆盖物实例（构造器调用计数，用于「重建一次」断言） */
  createdOverlays: unknown[]
  /** 测试辅助：记录已创建的控件实例（#22） */
  createdControls: FakeV4Control[]
  /** 测试辅助：记录已创建的图层实例（#22） */
  createdLayers: FakeV4Layer[]
  /** 测试辅助：记录已创建的服务实例（#23） */
  createdGeocoders: FakeV4Geocoder[]
  createdConvertors: FakeV4Convertor[]
  createdBoundaries: FakeV4Boundary[]
  createdGeolocations: FakeV4Geolocation[]
  createdLocalCities: FakeV4LocalCity[]
  createdAutocompletes: FakeV4Autocomplete[]
  /** 测试辅助：记录已创建的本地检索实例（#38） */
  createdLocalSearches: FakeV4LocalSearch[]
  /**
   * 测试辅助：已创建的路线服务实例，按 SDK 构造器名分桶（M7-ROUTES / #39）。
   *
   * 分桶而不是四个平行数组：四类替身的方法面一致（`queue` / `planCount` / `status` / `respond`），
   * 用例读作 `fake.rawRoutes.DrivingRoute[0]`，新增服务时也不需要再加一个数组。
   */
  rawRoutes: Record<
    "DrivingRoute" | "WalkingRoute" | "RidingRoute" | "TransitRoute",
    FakeV4RouteService[]
  >
  /** 测试辅助：记录已创建的原生数据图层实例（#23） */
  createdNativeLayers: FakeV4Layer[]
  /** 测试辅助：记录已创建的全景查看器 / 检索实例（#23） */
  createdPanoramas: FakeV4Panorama[]
  createdPanoramaServices: FakeV4PanoramaService[]
  /**
   * 测试辅助：运行时注入成员的可控开关（卸下 / 装回扩展 API 的类）。
   *
   * 官方 4.0 的扩展成员是**异步注入**的，因此「注入前失败、注入后同一个 Driver 可用」是
   * 真实语义；这个入口让测试能主动摆出那个时机，而不是各自 `delete namespace.X`。
   */
  runtimeExtensions: FakeV4RuntimeExtensions
}

export function createFakeBMapV4(version = '4.0'): FakeBMapV4 {
  const stats = new FakeV4Diagnostics()
  const createdMaps: FakeV4Map[] = []
  const createdOverlays: unknown[] = []
  const createdControls: FakeV4Control[] = []
  const createdLayers: FakeV4Layer[] = []
  const createdGeocoders: FakeV4Geocoder[] = []
  const createdConvertors: FakeV4Convertor[] = []
  const createdBoundaries: FakeV4Boundary[] = []
  const createdGeolocations: FakeV4Geolocation[] = []
  const createdLocalCities: FakeV4LocalCity[] = []
  const createdAutocompletes: FakeV4Autocomplete[] = []
  const createdLocalSearches: FakeV4LocalSearch[] = []
  /** 路线服务实例账本（#39）：按 SDK 构造器名分桶，读法见 `FakeBMapV4["rawRoutes"]` */
  const rawRoutes: Record<
    "DrivingRoute" | "WalkingRoute" | "RidingRoute" | "TransitRoute",
    FakeV4RouteService[]
  > = { DrivingRoute: [], WalkingRoute: [], RidingRoute: [], TransitRoute: [] }
  const createdNativeLayers: FakeV4Layer[] = []
  const createdPanoramas: FakeV4Panorama[] = []
  const createdPanoramaServices: FakeV4PanoramaService[] = []

  class MapClass extends FakeV4Map {
    constructor(container: string | HTMLElement, options?: Record<string, unknown>) {
      super(container, options ?? {}, stats)
      createdMaps.push(this)
    }
  }
  class MarkerClass extends FakeV4Marker {
    constructor(point: FakeV4Point, options?: Record<string, unknown>) {
      super(point, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PolylineClass extends FakeV4Polyline {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PolygonClass extends FakeV4Polygon {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class RectangleClass extends FakeV4Rectangle {
    constructor(bounds: FakeV4Bounds, options?: Record<string, unknown>) {
      super(bounds, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class CircleClass extends FakeV4Circle {
    constructor(point: FakeV4Point, radius: number, options?: Record<string, unknown>) {
      super(point, radius, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class LabelClass extends FakeV4Label {
    constructor(content: string, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class InfoWindowClass extends FakeV4InfoWindow {
    constructor(content: string | HTMLElement, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class GroundOverlayClass extends FakeV4GroundOverlay {
    constructor(bounds: FakeV4Bounds, options?: Record<string, unknown>) {
      super(bounds, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PrismClass extends FakeV4Prism {
    constructor(path: FakeV4Point[], altitude: number, options?: Record<string, unknown>) {
      super(path, altitude, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class BezierCurveClass extends FakeV4BezierCurve {
    constructor(path: FakeV4Point[], controlPoints: FakeV4Point[][], options?: Record<string, unknown>) {
      super(path, controlPoints, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class CustomOverlayClass extends FakeV4CustomOverlay {
    constructor(domCreate: () => HTMLElement, options?: Record<string, unknown>) {
      super(domCreate, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class ContextMenuClass extends FakeV4ContextMenu {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class ViewAnimationClass extends FakeV4ViewAnimation {
    constructor(keyFrames: unknown[], options?: FakeV4AnimationOptions) {
      super(keyFrames, options ?? {}, stats)
    }
  }

  /* ---------------------------------------------------- 控件（#22） */

  class ControlClass extends FakeV4Control {
    constructor() {
      super({}, stats)
      createdControls.push(this)
    }
  }
  class ZoomControlClass extends FakeV4Control {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class ScaleControlClass extends FakeV4ScaleControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class NavigationControlClass extends FakeV4NavigationControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class NavigationControl3DClass extends FakeV4Control {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class CityListControlClass extends FakeV4CityListControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class GeolocationControlClass extends FakeV4GeolocationControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class MapTypeControlClass extends FakeV4Control {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class OverviewMapControlClass extends FakeV4OverviewMapControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class PanoramaControlClass extends FakeV4Control {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }
  class CopyrightControlClass extends FakeV4CopyrightControl {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdControls.push(this)
    }
  }

  /* ---------------------------------------------------- 图层（#22） */

  class DistrictLayerClass extends FakeV4DistrictLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdLayers.push(this)
    }
  }
  class TileLayerClass extends FakeV4TileLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdLayers.push(this)
    }
  }
  class PanoramaCoverageLayerClass extends FakeV4PanoramaCoverageLayer {
    constructor() {
      super(stats)
      createdLayers.push(this)
    }
  }

  /* ---------------------------------------------------- 服务（#23） */

  class GeocoderClass extends FakeV4Geocoder {
    constructor() {
      super(stats)
      createdGeocoders.push(this)
    }
  }
  class ConvertorClass extends FakeV4Convertor {
    constructor() {
      super(stats)
      createdConvertors.push(this)
    }
  }
  class BoundaryClass extends FakeV4Boundary {
    constructor() {
      super(stats)
      createdBoundaries.push(this)
    }
  }
  class GeolocationClass extends FakeV4Geolocation {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdGeolocations.push(this)
    }
  }
  class LocalCityClass extends FakeV4LocalCity {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdLocalCities.push(this)
    }
  }
  class AutocompleteClass extends FakeV4Autocomplete {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdAutocompletes.push(this)
    }
  }
  class LocalSearchClass extends FakeV4LocalSearch {
    constructor(location: unknown, options?: Record<string, unknown>) {
      super(location, options ?? {}, stats)
      createdLocalSearches.push(this)
    }
  }

  /* ------------------------------------------- 路线规划（#39） */

  class DrivingRouteClass extends FakeV4DrivingRoute {
    constructor(location: unknown, options?: Record<string, unknown>) {
      super(location, options ?? {}, stats)
      rawRoutes.DrivingRoute.push(this)
    }
  }
  class WalkingRouteClass extends FakeV4WalkingRoute {
    constructor(location: unknown, options?: Record<string, unknown>) {
      super(location, options ?? {}, stats)
      rawRoutes.WalkingRoute.push(this)
    }
  }
  class RidingRouteClass extends FakeV4RidingRoute {
    constructor(location: unknown, options?: Record<string, unknown>) {
      super(location, options ?? {}, stats)
      rawRoutes.RidingRoute.push(this)
    }
  }
  class TransitRouteClass extends FakeV4TransitRoute {
    constructor(location: unknown, options?: Record<string, unknown>) {
      super(location, options ?? {}, stats)
      rawRoutes.TransitRoute.push(this)
    }
  }

  /* ---------------------------------------------- 原生数据图层（#23） */

  class PointIconLayerClass extends FakeV4PointIconLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class PointShapeLayerClass extends FakeV4PointShapeLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class LineLayerClass extends FakeV4LineLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class FillLayerClass extends FakeV4FillLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class PointLayerClass extends FakeV4PointLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class ClusterLayerClass extends FakeV4ClusterLayer {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class HeatmapClass extends FakeV4Heatmap {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }
  class TrackLineClass extends FakeV4TrackLine {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdNativeLayers.push(this)
    }
  }

  /* ---------------------------------------------------- 全景（#23） */

  class PanoramaClass extends FakeV4Panorama {
    constructor(container: string | HTMLElement, options?: Record<string, unknown>) {
      super(container, options ?? {}, stats)
      createdPanoramas.push(this)
    }
  }
  class PanoramaServiceClass extends FakeV4PanoramaService {
    constructor() {
      super(stats)
      createdPanoramaServices.push(this)
    }
  }

  const namespace: FakeBMapV4Namespace = {
    Map: MapClass,
    Point: FakeV4Point,
    Pixel: FakeV4Pixel,
    Size: FakeV4Size,
    Bounds: FakeV4Bounds,
    Marker: MarkerClass,
    Polyline: PolylineClass,
    Polygon: PolygonClass,
    Rectangle: RectangleClass,
    Circle: CircleClass,
    Label: LabelClass,
    InfoWindow: InfoWindowClass,
    GroundOverlay: GroundOverlayClass,
    Prism: PrismClass,
    BezierCurve: BezierCurveClass,
    CustomOverlay: CustomOverlayClass,
    ContextMenu: ContextMenuClass,
    MenuItem: FakeV4MenuItem,
    Icon: FakeV4Icon,
    ViewAnimation: ViewAnimationClass,
    MapTypeId: FakeV4MapTypeId,
    Control: ControlClass,
    ZoomControl: ZoomControlClass,
    ScaleControl: ScaleControlClass,
    NavigationControl: NavigationControlClass,
    NavigationControl3D: NavigationControl3DClass,
    CityListControl: CityListControlClass,
    GeolocationControl: GeolocationControlClass,
    MapTypeControl: MapTypeControlClass,
    OverviewMapControl: OverviewMapControlClass,
    PanoramaControl: PanoramaControlClass,
    CopyrightControl: CopyrightControlClass,
    DistrictLayer: DistrictLayerClass,
    TileLayer: TileLayerClass,
    PanoramaCoverageLayer: PanoramaCoverageLayerClass,
    Geocoder: GeocoderClass,
    Convertor: ConvertorClass,
    Boundary: BoundaryClass,
    Geolocation: GeolocationClass,
    LocalCity: LocalCityClass,
    Autocomplete: AutocompleteClass,
    LocalSearch: LocalSearchClass,
    DrivingRoute: DrivingRouteClass,
    WalkingRoute: WalkingRouteClass,
    RidingRoute: RidingRouteClass,
    TransitRoute: TransitRouteClass,
    PointIconLayer: PointIconLayerClass,
    PointShapeLayer: PointShapeLayerClass,
    LineLayer: LineLayerClass,
    FillLayer: FillLayerClass,
    PointLayer: PointLayerClass,
    ClusterLayer: ClusterLayerClass,
    Heatmap: HeatmapClass,
    TrackLine: TrackLineClass,
    Panorama: PanoramaClass,
    PanoramaService: PanoramaServiceClass,
    VERSION: version,
  }

  return {
    namespace,
    diagnostics: stats,
    stats,
    runtimeExtensions: new FakeV4RuntimeExtensions(namespace),
    createdMaps,
    createdOverlays,
    createdControls,
    createdLayers,
    createdGeocoders,
    createdConvertors,
    createdBoundaries,
    createdGeolocations,
    createdLocalCities,
    createdAutocompletes,
    createdLocalSearches,
    rawRoutes,
    createdNativeLayers,
    createdPanoramas,
    createdPanoramaServices,
  }
}
