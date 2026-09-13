<!-- Generated file. Do not edit directly. -->

# Capability Catalog 能力矩阵

> 由 `packages/baidu-map-gl-vue/src/driver/capability/catalog.ts` 生成，请勿手工编辑。
> 更新 Catalog 后运行 `pnpm generate:capability-matrix`，CI 用 `--check` 校验无漂移。

能力总数：**64**

## 状态说明

| 状态 | 含义 | 数量 |
| --- | --- | --- |
| `native` | SDK 原生能力，直接映射官方 API | 43 |
| `extended` | 项目在 SDK 之上的扩展能力（需要额外实现或组合） | 4 |
| `experimental` | 实验性能力，API 可能变更或移除 | 15 |
| `unsupported` | 明确不支持；`supports()` 恒为 false（用户 override 除外） | 2 |

## 家族分布

| 家族 | 能力数 |
| --- | --- |
| `map` | 14 |
| `overlay` | 15 |
| `layer` | 15 |
| `service` | 13 |
| `panorama` | 3 |
| `runtime` | 4 |

## 引擎矩阵

「运行时探测」表示该能力只能通过实例/原型成员在运行时探测（官方类型包无对应静态声明）。

| 家族 | 能力 | 状态 | 运行时探测 | webgl-v1 | jsapi-v3 | jsapi-v4 | raw members | 回退 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| map | `map.view-state` | native | ✓ | ✓ | ✓ | ✓ | getCenter, setCenter | — | 视图中心读写（getCenter / setCenter） |
| map | `map.zoom` | native | ✓ | ✓ | ✓ | ✓ | getZoom, setZoom | — | 缩放级别读写（getZoom / setZoom） |
| map | `map.center-and-zoom` | native | ✓ | ✓ | — | ✓ | centerAndZoom | — | 一次调用同时设置中心与缩放（centerAndZoom） |
| map | `map.bounds` | native | ✓ | ✓ | ✓ | ✓ | getBounds, setBounds | — | 可视范围读写（getBounds / setBounds） |
| map | `map.viewport` | native | ✓ | — | — | ✓ | getViewport, setViewport | — | 视口（中心 + 缩放 + 旋转 + 倾斜）读写（getViewport / setViewport） |
| map | `map.heading` | native | ✓ | ✓ | — | ✓ | setHeading | — | 地图旋转角（setHeading） |
| map | `map.tilt` | native | ✓ | ✓ | — | ✓ | setTilt | — | 地图倾斜角（setTilt） |
| map | `map.fly-to` | extended | ✓ | ✓ | ✓ | ✓ | panTo | `panTo` | 平滑飞行定位；v4 原生 flyTo，迁移期经 panTo 回退 |
| map | `map.animate` | native | ✓ | — | — | ✓ | startViewAnimation, cancelViewAnimation | — | 视角关键帧动画（startViewAnimation / cancelViewAnimation） |
| map | `map.screenshot` | native | ✓ | ✓ | — | ✓ | getScreenshot | — | 地图截图（getScreenshot） |
| map | `map.check-resize` | native | ✓ | ✓ | ✓ | ✓ | checkResize | — | 容器尺寸变化后重算视图（checkResize） |
| map | `map.pixel-conversion` | native | ✓ | ✓ | — | ✓ | pointToPixel, pixelToPoint | — | 经纬度与像素互转（pointToPixel / pixelToPoint） |
| map | `map.style` | native | ✓ | ✓ | — | ✓ | setMapStyle | — | 个性化地图样式（setMapStyle） |
| map | `map.destroy` | native | ✓ | — | — | ✓ | destroy | — | 销毁地图并释放资源（v4 destroy） |
| overlay | `overlay.marker` | native | — | ✓ | ✓ | ✓ | Marker | — | 点标记（Marker） |
| overlay | `overlay.label` | native | — | ✓ | ✓ | ✓ | Label | — | 文本标注（Label） |
| overlay | `overlay.info-window` | native | — | ✓ | ✓ | ✓ | InfoWindow | — | 信息窗口（InfoWindow） |
| overlay | `overlay.circle` | native | — | ✓ | ✓ | ✓ | Circle | — | 圆（Circle） |
| overlay | `overlay.polyline` | native | — | ✓ | ✓ | ✓ | Polyline | — | 折线（Polyline） |
| overlay | `overlay.polygon` | native | — | ✓ | ✓ | ✓ | Polygon | — | 多边形（Polygon） |
| overlay | `overlay.rectangle` | native | — | ✓ | — | ✓ | Rectangle | — | 矩形（Rectangle） |
| overlay | `overlay.custom-dom` | native | — | ✓ | — | ✓ | CustomOverlay | — | 自定义 DOM 覆盖物（CustomOverlay） |
| overlay | `overlay.ground` | native | — | ✓ | — | ✓ | GroundOverlay | — | 地面叠加层（GroundOverlay） |
| overlay | `overlay.point-collection` | native | ✓ | ✓ | — | ✓ | PointCollection | — | 海量点（PointCollection）；官方 4.0.4 文档引用但未声明类型 |
| overlay | `overlay.context-menu` | native | — | ✓ | — | ✓ | ContextMenu, MenuItem | — | 右键菜单（ContextMenu / MenuItem） |
| overlay | `overlay.prism` | experimental | — | ✓ | — | ✓ | Prism | — | 3D 棱柱（Prism） |
| overlay | `overlay.bezier-curve` | experimental | — | ✓ | — | ✓ | BezierCurve | — | 贝塞尔曲线（BezierCurve） |
| overlay | `overlay.marker-3d` | experimental | ✓ | — | — | ✓ | Marker3D | — | 3D 标记（Marker3D）；官方 4.0.4 文档引用但未声明类型 |
| overlay | `overlay.mapvgl` | unsupported | ✓ | ✓ | ✓ | ✓ | — | — | MapVGL 渲染叠加层；在 JSAPI 4.0 上**不兼容**——脚本的 JSONP 传输层依赖 SDK 的私有回调表（成员名 `_rd`），本库明令不得访问私有面（M3A3-07 / #25，依据与复现见 plugin-compat-inventory） |
| layer | `layer.tile` | native | — | ✓ | ✓ | ✓ | TileLayer | — | 瓦片图层（TileLayer） |
| layer | `layer.traffic` | native | — | ✓ | ✓ | ✓ | TrafficLayer | — | 实时路况图层（TrafficLayer） |
| layer | `layer.geojson` | native | — | ✓ | — | ✓ | GeoJSONLayer | — | GeoJSON 图层（GeoJSONLayer） |
| layer | `layer.point-icon` | native | — | ✓ | — | ✓ | PointIconLayer | — | 点图标图层（PointIconLayer） |
| layer | `layer.point-shape` | native | — | ✓ | — | ✓ | PointShapeLayer | — | 点形状图层（PointShapeLayer） |
| layer | `layer.district` | native | — | ✓ | — | ✓ | DistrictLayer | — | 行政区划图层（DistrictLayer） |
| layer | `layer.panorama-coverage` | native | ✓ | ✓ | — | ✓ | PanoramaCoverageLayer | — | 全景覆盖图层（PanoramaCoverageLayer）；官方 4.0.4 文档引用但未声明类型 |
| layer | `layer.line` | experimental | — | — | — | ✓ | LineLayer | — | 线图层（LineLayer） |
| layer | `layer.fill` | experimental | — | — | — | ✓ | FillLayer | — | 面图层（FillLayer） |
| layer | `layer.mvt` | experimental | — | — | — | ✓ | MVTLayer | — | MVT 矢量瓦片图层（MVTLayer） |
| layer | `layer.dom` | experimental | — | — | — | ✓ | DOMLayer | — | DOM 图层（DOMLayer） |
| layer | `layer.cluster` | extended | ✓ | ✓ | ✓ | ✓ | — | — | 聚合图层；优先使用 SDK 原生能力，缺失时由项目提供 fallback 聚类 |
| layer | `layer.point` | experimental | ✓ | — | — | ✓ | PointLayer | — | 原生点图层（PointLayer）；支持形状或图标，属扩展 API |
| layer | `layer.heatmap` | experimental | ✓ | — | — | ✓ | Heatmap | — | 热力图（Heatmap）；按权重渲染点密度，属扩展 API |
| layer | `layer.track-line` | experimental | ✓ | — | — | ✓ | TrackLine | — | 轨迹线（TrackLine）；数据的绘制/播放/跟随，属扩展 API；播放控制与迁移结论见 M8（#43） |
| service | `service.local-search` | native | — | ✓ | ✓ | ✓ | LocalSearch | — | 本地检索（LocalSearch） |
| service | `service.autocomplete` | experimental | — | ✓ | ✓ | ✓ | Autocomplete | — | 输入提示（Autocomplete）：构造与输入框绑定是原生的；程序化检索（suggest）的**请求归属**依赖未经真实运行时证明的 keyword / FIFO 假设（R25-C / #72 标注，收口属 M7 #38） |
| service | `service.driving-route` | native | — | ✓ | ✓ | ✓ | DrivingRoute | — | 驾车路线规划（DrivingRoute） |
| service | `service.walking-route` | native | — | ✓ | ✓ | ✓ | WalkingRoute | — | 步行路线规划（WalkingRoute） |
| service | `service.riding-route` | native | — | ✓ | ✓ | ✓ | RidingRoute | — | 骑行路线规划（RidingRoute） |
| service | `service.transit-route` | native | — | ✓ | ✓ | ✓ | TransitRoute | — | 公交路线规划（TransitRoute） |
| service | `service.truck-route` | experimental | — | ✓ | — | ✓ | TruckRoute | — | 货车路线规划；官方 4.0.4 未声明 TruckRoute 类，可用性待服务模块核查 |
| service | `service.geocoder` | native | — | ✓ | ✓ | ✓ | Geocoder | — | 地理编码 / 逆地理编码（Geocoder） |
| service | `service.geolocation` | native | — | ✓ | ✓ | ✓ | Geolocation | — | 浏览器定位（Geolocation） |
| service | `service.local-city` | native | — | ✓ | ✓ | ✓ | LocalCity | — | IP 定位城市（LocalCity） |
| service | `service.boundary` | native | — | ✓ | ✓ | ✓ | Boundary | — | 行政区边界（Boundary） |
| service | `service.convertor` | native | — | ✓ | ✓ | ✓ | Convertor | — | 坐标转换（Convertor） |
| service | `service.track-animation` | unsupported | ✓ | ✓ | ✓ | ✓ | — | — | 轨迹动画（BMapGLLib 插件）；脚本引用面在 4.0.4 声明里没有缺口，但**运行时未验证**，本阶段不装配（4.0 的对应能力是原生图层 `layer.track-line`）；依据与复现见 plugin-compat-inventory（M3A3-07 / #25） |
| panorama | `panorama.viewer` | native | — | ✓ | — | ✓ | Panorama | — | 全景查看器（Panorama） |
| panorama | `panorama.service` | native | — | ✓ | — | ✓ | PanoramaService | — | 全景服务（PanoramaService） |
| panorama | `panorama.label` | experimental | — | — | — | ✓ | PanoramaLabel | — | 全景标注（PanoramaLabel） |
| runtime | `runtime.resource-scope` | extended | ✓ | ✓ | ✓ | ✓ | — | — | 项目资源生命周期作用域（监听器/覆盖物/图层的统一释放路径） |
| runtime | `runtime.capability-override` | extended | ✓ | ✓ | ✓ | ✓ | — | — | 运行时能力 override（显式修正能力探测结果） |
| runtime | `runtime.fake-sdk` | experimental | ✓ | ✓ | ✓ | ✓ | — | — | Fake SDK 测试替身（M3A.3 双 Driver 行为验证） |
| runtime | `runtime.async-task` | experimental | ✓ | ✓ | ✓ | ✓ | — | — | 异步任务控制器（服务与动画的取消/状态统一） |
