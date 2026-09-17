/**
 * Capability Catalog
 *
 * 语义能力名 → 描述符。`rawMembers` 指向 SDK 顶层构造器名或 `Map` 原型方法名，
 * 用于在无真实 SDK 的测试/离线环境做能力探测。
 *
 * 命名与状态约定（M3A0-06 / issue #15）：
 * - 能力名按 `<family>.<capability>` 语义命名，family 覆盖
 *   Map / Overlay / Layer / Service / Panorama / Runtime。
 * - `status` 表达生命周期意图：
 *   - `native`：SDK 原生能力，直接映射官方 API；
 *   - `extended`：项目在 SDK 之上的扩展能力（需要额外实现或组合）；
 *   - `experimental`：实验性能力，API 可能变更或移除；
 *   - `unsupported`：明确不支持；`supports()` 恒为 false（用户 override 除外），
 *     保留槽位使错误信息、文档与能力矩阵保持一致。
 * - `runtimeOnly`：只能通过实例/原型成员在运行时探测，官方类型包无对应静态声明
 *   （例如 `Map` 原型方法、`PointCollection`、`Marker3D` 或纯项目运行时能力）。
 *
 * `rawMembers` 名称以官方 `@baidumap/jsapi-v4-types@4.0.4` 为基准核对：
 * `core/Map.d.ts` 的 Map 原型方法与各子目录 `declare namespace BMap` 类声明。
 */
import type { BMapEngine } from "../types/bmap";

export type Capability =
  // Map
  | "map.view-state"
  | "map.zoom"
  | "map.center-and-zoom"
  | "map.bounds"
  | "map.viewport"
  | "map.heading"
  | "map.tilt"
  | "map.fly-to"
  | "map.animate"
  | "map.screenshot"
  | "map.check-resize"
  | "map.pixel-conversion"
  | "map.style"
  | "map.destroy"
  // Overlay
  | "overlay.marker"
  | "overlay.label"
  | "overlay.info-window"
  | "overlay.circle"
  | "overlay.polyline"
  | "overlay.polygon"
  | "overlay.rectangle"
  | "overlay.custom-dom"
  | "overlay.ground"
  | "overlay.point-collection"
  | "overlay.context-menu"
  | "overlay.prism"
  | "overlay.bezier-curve"
  | "overlay.marker-3d"
  | "overlay.mapvgl"
  // Layer
  | "layer.tile"
  | "layer.traffic"
  | "layer.geojson"
  | "layer.point-icon"
  | "layer.point-shape"
  | "layer.district"
  | "layer.panorama-coverage"
  | "layer.line"
  | "layer.fill"
  | "layer.mvt"
  | "layer.dom"
  | "layer.cluster"
  | "layer.point"
  | "layer.heatmap"
  | "layer.track-line"
  // Service
  | "service.local-search"
  | "service.autocomplete"
  | "service.driving-route"
  | "service.walking-route"
  | "service.riding-route"
  | "service.transit-route"
  | "service.truck-route"
  | "service.geocoder"
  | "service.geolocation"
  | "service.local-city"
  | "service.boundary"
  | "service.convertor"
  | "service.track-animation"
  // Panorama
  | "panorama.viewer"
  | "panorama.service"
  | "panorama.label"
  // Runtime（项目运行时能力，无对应 SDK 成员）
  | "runtime.resource-scope"
  | "runtime.capability-override"
  | "runtime.fake-sdk"
  | "runtime.async-task";

export type CapabilityFamily = "map" | "overlay" | "layer" | "service" | "panorama" | "runtime";

export type CapabilityStatus = "native" | "extended" | "experimental" | "unsupported";

export interface CapabilityDescriptor {
  id: Capability;
  family: CapabilityFamily;
  /** 一句话语义说明（进入生成的能力矩阵） */
  description: string;
  /** SDK 顶层构造器名或 Map 原型方法名；空数组表示无 SDK 成员 */
  rawMembers?: readonly string[];
  engines: readonly BMapEngine[];
  status: CapabilityStatus;
  /** 只能在运行时探测（官方类型包无静态声明） */
  runtimeOnly: boolean;
}

/**
 * 单引擎基线（M3A3-REMOVE-LEGACY / issue #26）。
 *
 * 旧引擎（`webgl-v1`）删除后 `BMapEngine` 只剩 `jsapi-v4`，原先用来区分
 * 「三个引擎都支持 / webgl-v4 支持 / 仅 v4 支持」的三个常量因此合并为一个：能力矩阵里的
 * 引擎列退化成一列，这是**如实反映单引擎基线**，而不是把旧引擎的支持状态留成历史注解。
 *
 * 已知欠账：`engines` 维度与 `CapabilityReason` 的 `engine-unsupported` 随之退化
 * （唯一引擎恒命中白名单；该 reason 只剩「描述符缺失」这条防御分支可达）。
 * 是否移除整个维度属独立决策，见 ADR 2026-09-14-remove-legacy-engine 的「已知限制」。
 */
const JSAPI_V4: readonly BMapEngine[] = ["jsapi-v4"];

export const CAPABILITY_CATALOG: Record<Capability, CapabilityDescriptor> = {
  // ---------------------------------------------------------------- Map
  "map.view-state": {
    id: "map.view-state",
    family: "map",
    description: "视图中心读写（getCenter / setCenter）",
    rawMembers: ["getCenter", "setCenter"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.zoom": {
    id: "map.zoom",
    family: "map",
    description: "缩放级别读写（getZoom / setZoom）",
    rawMembers: ["getZoom", "setZoom"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.center-and-zoom": {
    id: "map.center-and-zoom",
    family: "map",
    description: "一次调用同时设置中心与缩放（centerAndZoom）",
    rawMembers: ["centerAndZoom"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.bounds": {
    id: "map.bounds",
    family: "map",
    description: "可视范围读写（getBounds / setBounds）",
    rawMembers: ["getBounds", "setBounds"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.viewport": {
    id: "map.viewport",
    family: "map",
    description: "视口（中心 + 缩放 + 旋转 + 倾斜）读写（getViewport / setViewport）",
    rawMembers: ["getViewport", "setViewport"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.heading": {
    id: "map.heading",
    family: "map",
    description: "地图旋转角（setHeading）",
    rawMembers: ["setHeading"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.tilt": {
    id: "map.tilt",
    family: "map",
    description: "地图倾斜角（setTilt）",
    rawMembers: ["setTilt"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.fly-to": {
    id: "map.fly-to",
    family: "map",
    description: "平滑飞行定位（v4 原生 flyTo；探测成员 panTo）",
    rawMembers: ["panTo"],
    engines: JSAPI_V4,
    status: "extended",
    runtimeOnly: true,
  },
  "map.animate": {
    id: "map.animate",
    family: "map",
    description: "视角关键帧动画（startViewAnimation / cancelViewAnimation）",
    rawMembers: ["startViewAnimation", "cancelViewAnimation"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.screenshot": {
    id: "map.screenshot",
    family: "map",
    description: "地图截图（getScreenshot）",
    rawMembers: ["getScreenshot"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.check-resize": {
    id: "map.check-resize",
    family: "map",
    description: "容器尺寸变化后重算视图（checkResize）",
    rawMembers: ["checkResize"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.pixel-conversion": {
    id: "map.pixel-conversion",
    family: "map",
    description: "经纬度与像素互转（pointToPixel / pixelToPoint）",
    rawMembers: ["pointToPixel", "pixelToPoint"],
    // M3A2-MAP（#20）曾经因为「公共 MapDriver 成员在 webgl-v1 上也要可用」把这条从
    // 「仅 v4」放宽过一次；旧引擎删除后（#26）所有条目都只声明 `jsapi-v4`，这里不再需要
    // 单独说明——`engines` 维度的整体退化见本文件顶部的单引擎基线注释。
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.style": {
    id: "map.style",
    family: "map",
    description: "个性化地图样式（setMapStyle）",
    rawMembers: ["setMapStyle"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "map.destroy": {
    id: "map.destroy",
    family: "map",
    description: "销毁地图并释放资源（v4 destroy）",
    rawMembers: ["destroy"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },

  // ------------------------------------------------------------ Overlay
  "overlay.marker": {
    id: "overlay.marker",
    family: "overlay",
    description: "点标记（Marker）",
    rawMembers: ["Marker"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.label": {
    id: "overlay.label",
    family: "overlay",
    description: "文本标注（Label）",
    rawMembers: ["Label"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.info-window": {
    id: "overlay.info-window",
    family: "overlay",
    description: "信息窗口（InfoWindow）",
    rawMembers: ["InfoWindow"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.circle": {
    id: "overlay.circle",
    family: "overlay",
    description: "圆（Circle）",
    rawMembers: ["Circle"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.polyline": {
    id: "overlay.polyline",
    family: "overlay",
    description: "折线（Polyline）",
    rawMembers: ["Polyline"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.polygon": {
    id: "overlay.polygon",
    family: "overlay",
    description: "多边形（Polygon）",
    rawMembers: ["Polygon"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.rectangle": {
    id: "overlay.rectangle",
    family: "overlay",
    description: "矩形（Rectangle）",
    rawMembers: ["Rectangle"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.custom-dom": {
    id: "overlay.custom-dom",
    family: "overlay",
    description: "自定义 DOM 覆盖物（CustomOverlay）",
    rawMembers: ["CustomOverlay"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.ground": {
    id: "overlay.ground",
    family: "overlay",
    description: "地面叠加层（GroundOverlay）",
    rawMembers: ["GroundOverlay"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.point-collection": {
    id: "overlay.point-collection",
    family: "overlay",
    description: "海量点（PointCollection）；官方 4.0.4 文档引用但未声明类型",
    rawMembers: ["PointCollection"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "overlay.context-menu": {
    id: "overlay.context-menu",
    family: "overlay",
    description: "右键菜单（ContextMenu / MenuItem）",
    rawMembers: ["ContextMenu", "MenuItem"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "overlay.prism": {
    id: "overlay.prism",
    family: "overlay",
    description: "3D 棱柱（Prism）",
    rawMembers: ["Prism"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "overlay.bezier-curve": {
    id: "overlay.bezier-curve",
    family: "overlay",
    description: "贝塞尔曲线（BezierCurve）",
    rawMembers: ["BezierCurve"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "overlay.marker-3d": {
    id: "overlay.marker-3d",
    family: "overlay",
    description: "3D 标记（Marker3D）；官方 4.0.4 文档引用但未声明类型",
    rawMembers: ["Marker3D"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },
  "overlay.mapvgl": {
    id: "overlay.mapvgl",
    family: "overlay",
    description:
      "MapVGL 渲染叠加层；在 JSAPI 4.0 上**不兼容**——脚本的 JSONP 传输层依赖 SDK 的私有回调表" +
      "（成员名 `_rd`），本库明令不得访问私有面（M3A3-07 / #25，依据与复现见 plugin-compat-inventory）",
    engines: JSAPI_V4,
    status: "unsupported",
    runtimeOnly: true,
  },

  // -------------------------------------------------------------- Layer
  "layer.tile": {
    id: "layer.tile",
    family: "layer",
    description: "瓦片图层（TileLayer）",
    rawMembers: ["TileLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.traffic": {
    id: "layer.traffic",
    family: "layer",
    description: "实时路况图层（TrafficLayer）",
    rawMembers: ["TrafficLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.geojson": {
    id: "layer.geojson",
    family: "layer",
    description: "GeoJSON 图层（GeoJSONLayer）",
    rawMembers: ["GeoJSONLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.point-icon": {
    id: "layer.point-icon",
    family: "layer",
    description: "点图标图层（PointIconLayer）",
    rawMembers: ["PointIconLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.point-shape": {
    id: "layer.point-shape",
    family: "layer",
    description: "点形状图层（PointShapeLayer）",
    rawMembers: ["PointShapeLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.district": {
    id: "layer.district",
    family: "layer",
    description: "行政区划图层（DistrictLayer）",
    rawMembers: ["DistrictLayer"],
    // M3A2-CONTROLS-LAYERS（#22）曾经因为「`LayerDriver` 的共享契约要求两个引擎都能创建行政区
    // 图层」把这条从「仅 v4」放宽过一次；旧引擎删除后（#26）所有条目都只声明 `jsapi-v4`，
    // 这里不再需要单独说明——`engines` 维度的整体退化见本文件顶部的单引擎基线注释。
    // （与 #20 对 `map.pixel-conversion` 的处理同源）。
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "layer.panorama-coverage": {
    id: "layer.panorama-coverage",
    family: "layer",
    description: "全景覆盖图层（PanoramaCoverageLayer）；官方 4.0.4 文档引用但未声明类型",
    rawMembers: ["PanoramaCoverageLayer"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: true,
  },
  "layer.line": {
    id: "layer.line",
    family: "layer",
    description: "线图层（LineLayer）",
    rawMembers: ["LineLayer"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.fill": {
    id: "layer.fill",
    family: "layer",
    description: "面图层（FillLayer）",
    rawMembers: ["FillLayer"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.mvt": {
    id: "layer.mvt",
    family: "layer",
    description: "MVT 矢量瓦片图层（MVTLayer）",
    rawMembers: ["MVTLayer"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.dom": {
    id: "layer.dom",
    family: "layer",
    description: "DOM 图层（DOMLayer）",
    rawMembers: ["DOMLayer"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.cluster": {
    id: "layer.cluster",
    family: "layer",
    description: "聚合图层；优先使用 SDK 原生能力，缺失时由项目提供 fallback 聚类",
    engines: JSAPI_V4,
    status: "extended",
    runtimeOnly: true,
  },
  // M3A2-SERVICES-NATIVE（#23）补齐原生数据图层里缺少的三个能力槽位。
  // 三者都是「4.0 运行时公开、4.0.4 类型包没有类声明」的扩展 API：`runtimeOnly: true`
  // 表达「存在性只能在运行时按结构探测」，`experimental` 表达「接口面可能变」（官方把这
  // 几个类归在「扩展 API」下，且可视化实现是**异步注入**的）。
  "layer.point": {
    id: "layer.point",
    family: "layer",
    description: "原生点图层（PointLayer）；支持形状或图标，属扩展 API",
    rawMembers: ["PointLayer"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },
  "layer.heatmap": {
    id: "layer.heatmap",
    family: "layer",
    description: "热力图（Heatmap）；按权重渲染点密度，属扩展 API",
    rawMembers: ["Heatmap"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },
  "layer.track-line": {
    id: "layer.track-line",
    family: "layer",
    description:
      "轨迹线（TrackLine）；数据的绘制/播放/跟随，属扩展 API；播放控制与迁移结论见 M8（#43）",
    rawMembers: ["TrackLine"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },

  // ------------------------------------------------------------ Service
  "service.local-search": {
    id: "service.local-search",
    family: "service",
    description: "本地检索（LocalSearch）",
    rawMembers: ["LocalSearch"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.autocomplete": {
    id: "service.autocomplete",
    family: "service",
    description:
      "输入提示（Autocomplete）：构造与输入框绑定是原生的；程序化检索（suggest）的**请求归属**" +
      "依赖未经真实运行时证明的 keyword / FIFO 假设（R25-C / #72 标注，收口属 M7 #38）",
    rawMembers: ["Autocomplete"],
    engines: JSAPI_V4,
    // R25-C / #72：能力本身（构造 + 输入框联想）是 native，但 `suggest()` 的归属规则建立在一个
    // 未证实的假设上（见 `jsapi-v4/services.ts` 的 pendingSuggest 注释），因此按 `experimental`
    // 标注——它**不**影响 `supports()`（只有 `unsupported` 会），只是让能力矩阵如实反映风险。
    status: "experimental",
    runtimeOnly: false,
  },
  "service.driving-route": {
    id: "service.driving-route",
    family: "service",
    description: "驾车路线规划（DrivingRoute）",
    rawMembers: ["DrivingRoute"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.walking-route": {
    id: "service.walking-route",
    family: "service",
    description: "步行路线规划（WalkingRoute）",
    rawMembers: ["WalkingRoute"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.riding-route": {
    id: "service.riding-route",
    family: "service",
    description: "骑行路线规划（RidingRoute）",
    rawMembers: ["RidingRoute"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.transit-route": {
    id: "service.transit-route",
    family: "service",
    description: "公交路线规划（TransitRoute）",
    rawMembers: ["TransitRoute"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.truck-route": {
    id: "service.truck-route",
    family: "service",
    description: "货车路线规划；官方 4.0.4 未声明 TruckRoute 类，可用性待服务模块核查",
    rawMembers: ["TruckRoute"],
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: false,
  },
  "service.geocoder": {
    id: "service.geocoder",
    family: "service",
    description: "地理编码 / 逆地理编码（Geocoder）",
    rawMembers: ["Geocoder"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.geolocation": {
    id: "service.geolocation",
    family: "service",
    description: "浏览器定位（Geolocation）",
    rawMembers: ["Geolocation"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.local-city": {
    id: "service.local-city",
    family: "service",
    description: "IP 定位城市（LocalCity）",
    rawMembers: ["LocalCity"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.boundary": {
    id: "service.boundary",
    family: "service",
    description: "行政区边界（Boundary）",
    rawMembers: ["Boundary"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.convertor": {
    id: "service.convertor",
    family: "service",
    description: "坐标转换（Convertor）",
    rawMembers: ["Convertor"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "service.track-animation": {
    id: "service.track-animation",
    family: "service",
    description:
      "轨迹动画（BMapGLLib 插件）；脚本引用面在 4.0.4 声明里没有缺口，且**最小运行时路径已验证**" +
      "（真实 4.0 上构造 + `start()` + 视角跟随跑通），**完整功能链路仍未验证**；本阶段不装配" +
      "（4.0 的对应能力是原生图层 `layer.track-line`）；依据与复现见 plugin-compat-inventory" +
      "（M3A3-07 / #25）",
    engines: JSAPI_V4,
    status: "unsupported",
    runtimeOnly: true,
  },

  // ----------------------------------------------------------- Panorama
  "panorama.viewer": {
    id: "panorama.viewer",
    family: "panorama",
    description: "全景查看器（Panorama）",
    rawMembers: ["Panorama"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "panorama.service": {
    id: "panorama.service",
    family: "panorama",
    description: "全景服务（PanoramaService）",
    rawMembers: ["PanoramaService"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },
  "panorama.label": {
    id: "panorama.label",
    family: "panorama",
    description:
      "全景标注（PanoramaLabel）。#41 起由 `<BPanoramaLabel>` 消费，因此状态由 experimental 提升为 " +
      "native：本能力不再是「只登记、没落地」的槽位。**组件 API 的稳定级别是另一件事**" +
      "（Panorama 属 post-stable，见 `docs/zh-CN/components/panorama/index.md` 的范围表）",
    rawMembers: ["PanoramaLabel"],
    engines: JSAPI_V4,
    status: "native",
    runtimeOnly: false,
  },

  // ------------------------------------------------------------ Runtime
  "runtime.resource-scope": {
    id: "runtime.resource-scope",
    family: "runtime",
    description: "项目资源生命周期作用域（监听器/覆盖物/图层的统一释放路径）",
    engines: JSAPI_V4,
    status: "extended",
    runtimeOnly: true,
  },
  "runtime.capability-override": {
    id: "runtime.capability-override",
    family: "runtime",
    description: "运行时能力 override（显式修正能力探测结果）",
    engines: JSAPI_V4,
    status: "extended",
    runtimeOnly: true,
  },
  "runtime.fake-sdk": {
    id: "runtime.fake-sdk",
    family: "runtime",
    description: "Fake SDK 测试替身（单引擎 jsapi-v4 的组件级 / Facet 级验证）",
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },
  "runtime.async-task": {
    id: "runtime.async-task",
    family: "runtime",
    description: "异步任务控制器（服务与动画的取消/状态统一）",
    engines: JSAPI_V4,
    status: "experimental",
    runtimeOnly: true,
  },
};

export const CAPABILITY_IDS = Object.keys(CAPABILITY_CATALOG) as readonly Capability[];

export const CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  "map",
  "overlay",
  "layer",
  "service",
  "panorama",
  "runtime",
];

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "native",
  "extended",
  "experimental",
  "unsupported",
];
