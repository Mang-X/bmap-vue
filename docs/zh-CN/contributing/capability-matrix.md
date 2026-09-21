<!-- Generated file. Do not edit directly. -->

# Capability Catalog 能力矩阵

> 由 `packages/baidu-map-gl-vue/src/driver/capability/catalog.ts` 生成，请勿手工编辑。
> 更新 Catalog 后运行 `pnpm generate:capability-matrix`，CI 用 `--check` 校验无漂移。

能力总数：**62**

## 状态说明

| 状态 | 含义 | 数量 |
| --- | --- | --- |
| `native` | SDK 原生能力，直接映射官方 API | 45 |
| `extended` | 项目在 SDK 之上的扩展能力（需要额外实现或组合） | 2 |
| `experimental` | 实验性能力，API 可能变更或移除 | 13 |
| `unsupported` | 明确不支持；`supports()` 恒为 false（用户 override 除外） | 2 |

## 家族分布

| 家族 | 能力数 |
| --- | --- |
| `map` | 14 |
| `overlay` | 15 |
| `layer` | 18 |
| `service` | 12 |
| `panorama` | 3 |

## 引擎矩阵

「运行时探测」表示该能力只能通过实例/原型成员在运行时探测（官方类型包无对应静态声明）。

| 家族 | 能力 | 状态 | 运行时探测 | jsapi-v4 | raw members | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| map | `map.view-state` | native | ✓ | ✓ | getCenter, setCenter | 视图中心读写（getCenter / setCenter） |
| map | `map.zoom` | native | ✓ | ✓ | getZoom, setZoom | 缩放级别读写（getZoom / setZoom） |
| map | `map.center-and-zoom` | native | ✓ | ✓ | centerAndZoom | 一次调用同时设置中心与缩放（centerAndZoom） |
| map | `map.bounds` | native | ✓ | ✓ | getBounds, setBounds | 可视范围读写（getBounds / setBounds） |
| map | `map.viewport` | native | ✓ | ✓ | getViewport, setViewport | 视口（中心 + 缩放 + 旋转 + 倾斜）读写（getViewport / setViewport） |
| map | `map.heading` | native | ✓ | ✓ | setHeading | 地图旋转角（setHeading） |
| map | `map.tilt` | native | ✓ | ✓ | setTilt | 地图倾斜角（setTilt） |
| map | `map.fly-to` | extended | ✓ | ✓ | panTo | 平滑飞行定位（v4 原生 flyTo；探测成员 panTo） |
| map | `map.animate` | native | ✓ | ✓ | startViewAnimation, cancelViewAnimation | 视角关键帧动画（startViewAnimation / cancelViewAnimation） |
| map | `map.screenshot` | native | ✓ | ✓ | getScreenshot | 地图截图（getScreenshot） |
| map | `map.check-resize` | native | ✓ | ✓ | checkResize | 容器尺寸变化后重算视图（checkResize） |
| map | `map.pixel-conversion` | native | ✓ | ✓ | pointToPixel, pixelToPoint | 经纬度与像素互转（pointToPixel / pixelToPoint） |
| map | `map.style` | native | ✓ | ✓ | setMapStyle | 个性化地图样式（setMapStyle） |
| map | `map.destroy` | native | ✓ | ✓ | destroy | 销毁地图并释放资源（v4 destroy） |
| overlay | `overlay.marker` | native | — | ✓ | Marker | 点标记（Marker） |
| overlay | `overlay.label` | native | — | ✓ | Label | 文本标注（Label） |
| overlay | `overlay.info-window` | native | — | ✓ | InfoWindow | 信息窗口（InfoWindow） |
| overlay | `overlay.circle` | native | — | ✓ | Circle | 圆（Circle） |
| overlay | `overlay.polyline` | native | — | ✓ | Polyline | 折线（Polyline） |
| overlay | `overlay.polygon` | native | — | ✓ | Polygon | 多边形（Polygon） |
| overlay | `overlay.rectangle` | native | — | ✓ | Rectangle | 矩形（Rectangle） |
| overlay | `overlay.custom-dom` | native | — | ✓ | CustomOverlay | 自定义 DOM 覆盖物（CustomOverlay） |
| overlay | `overlay.ground` | native | — | ✓ | GroundOverlay | 地面叠加层（GroundOverlay） |
| overlay | `overlay.point-collection` | native | ✓ | ✓ | PointCollection | 海量点（PointCollection）；官方 4.0.4 文档引用但未声明类型 |
| overlay | `overlay.context-menu` | native | — | ✓ | ContextMenu, MenuItem | 右键菜单（ContextMenu / MenuItem） |
| overlay | `overlay.prism` | experimental | — | ✓ | Prism | 3D 棱柱（Prism） |
| overlay | `overlay.bezier-curve` | experimental | — | ✓ | BezierCurve | 贝塞尔曲线（BezierCurve） |
| overlay | `overlay.marker-3d` | experimental | ✓ | ✓ | Marker3D | 3D 标记（Marker3D）；官方 4.0.4 文档引用但未声明类型 |
| overlay | `overlay.mapvgl` | unsupported | ✓ | ✓ | — | MapVGL 渲染叠加层；在 JSAPI 4.0 上**不兼容**（结论 `incompatible`，无迁移路径）：脚本的 JSONP 传输层依赖 SDK 的私有回调表（成员名 `_rd`），且它的 bmap 适配层要往 `getPanes().mapPane` 上挂视图容器、而 4.0 的 panes 里没有 `mapPane`。本库明令不得访问私有面，也不为它写适配层 —— 改用原生图层。依据与复现见 plugin-compat-inventory（#25 / #43） |
| layer | `layer.tile` | native | — | ✓ | TileLayer | 瓦片图层（TileLayer） |
| layer | `layer.traffic` | native | — | ✓ | TrafficLayer | 实时路况图层（TrafficLayer） |
| layer | `layer.geojson` | native | — | ✓ | GeoJSONLayer | GeoJSON 图层（GeoJSONLayer） |
| layer | `layer.point-icon` | native | — | ✓ | PointIconLayer | 点图标图层（PointIconLayer） |
| layer | `layer.point-shape` | native | — | ✓ | PointShapeLayer | 点形状图层（PointShapeLayer） |
| layer | `layer.district` | native | — | ✓ | DistrictLayer | 行政区划图层（DistrictLayer） |
| layer | `layer.panorama-coverage` | native | ✓ | ✓ | PanoramaCoverageLayer | 全景覆盖图层（PanoramaCoverageLayer）；官方 4.0.4 文档引用但未声明类型 |
| layer | `layer.line` | experimental | — | ✓ | LineLayer | 线图层（LineLayer） |
| layer | `layer.fill` | experimental | — | ✓ | FillLayer | 面图层（FillLayer） |
| layer | `layer.dom` | experimental | — | ✓ | DOMLayer | DOM 图层（DOMLayer） |
| layer | `layer.xyz` | experimental | — | ✓ | XYZLayer | 第三方标准瓦片图层（XYZLayer）；内置 EPSG:3857 → BD09MC 转换，可加载 XYZ/TMS 服务 |
| layer | `layer.wms` | experimental | — | ✓ | WMSLayer | WMS 瓦片服务图层（WMSLayer）；按 BBOX/WIDTH/HEIGHT 驱动瓦片请求 |
| layer | `layer.wmts` | experimental | — | ✓ | WMTSLayer | WMTS 标准瓦片服务图层（WMTSLayer）；按 TileMatrixSet 拼接请求 |
| layer | `layer.raster` | experimental | — | ✓ | RasterTileLayer | 栅格瓦片图层（RasterTileLayer）；支持子域轮询、TMS 翻转与四至裁剪 |
| layer | `layer.cluster` | extended | ✓ | ✓ | — | 聚合图层（ClusterLayer）；BMarkerCluster 的默认路径；另有显式可选的 markers 引擎（唯一能给出簇内业务项的路径）。取证见 ADR 2026-09-19 |
| layer | `layer.point` | experimental | ✓ | ✓ | PointLayer | 原生点图层（PointLayer）；支持形状或图标，属扩展 API，由 BPointLayer 落地 |
| layer | `layer.heatmap` | experimental | ✓ | ✓ | Heatmap | 热力图（Heatmap）；按权重渲染点密度，属扩展 API |
| layer | `layer.track-line` | experimental | ✓ | ✓ | TrackLine | 轨迹线（TrackLine）；数据的绘制属扩展 API。**它是 legacy 插件 `service.track-animation` 的迁移目标**（结论见 plugin-compat-inventory）；播放控制命令面归 #110。 |
| service | `service.local-search` | native | — | ✓ | LocalSearch | 本地检索（LocalSearch） |
| service | `service.autocomplete` | native | — | ✓ | Autocomplete | 输入提示（Autocomplete）：构造、输入框绑定与 `onSearchComplete` 转发都是原生的。本库**不**提供程序化检索（原 `suggest()` 的回包归属靠未证实的 keyword / FIFO 推断，已按 #104 删除；需要程序化建议时改用 `LocalSearch` 或官方 UI Kit） |
| service | `service.driving-route` | native | — | ✓ | DrivingRoute | 驾车路线规划（DrivingRoute） |
| service | `service.walking-route` | native | — | ✓ | WalkingRoute | 步行路线规划（WalkingRoute） |
| service | `service.riding-route` | native | — | ✓ | RidingRoute | 骑行路线规划（RidingRoute） |
| service | `service.transit-route` | native | — | ✓ | TransitRoute | 公交路线规划（TransitRoute） |
| service | `service.geocoder` | native | — | ✓ | Geocoder | 地理编码 / 逆地理编码（Geocoder） |
| service | `service.geolocation` | native | — | ✓ | Geolocation | 浏览器定位（Geolocation） |
| service | `service.local-city` | native | — | ✓ | LocalCity | IP 定位城市（LocalCity） |
| service | `service.boundary` | native | — | ✓ | Boundary | 行政区边界（Boundary） |
| service | `service.convertor` | native | — | ✓ | Convertor | 坐标转换（Convertor） |
| service | `service.track-animation` | unsupported | ✓ | ✓ | — | 轨迹动画（BMapGLLib 插件）；结论 `native`：**4.0 的对应能力是原生图层 `layer.track-line`**（组件 `<BTrackLineLayer>`），本库不再为这个 legacy 插件提供封装，播放命令面的归属见 #110。脚本自身引用面在 4.0.4 声明里没有缺口，且**最小运行时路径已验证**（真实 4.0 上构造 + `start()` + 视角跟随 + `pause()` / `continue()` + 播放到结尾跑通）；依据与复现见 plugin-compat-inventory（#25 / #43） |
| panorama | `panorama.viewer` | native | — | ✓ | Panorama | 全景查看器（Panorama） |
| panorama | `panorama.service` | native | — | ✓ | PanoramaService | 全景服务（PanoramaService） |
| panorama | `panorama.label` | native | — | ✓ | PanoramaLabel | 全景标注（PanoramaLabel）。#41 起由 `<BPanoramaLabel>` 消费，因此状态由 experimental 提升为 native：本能力不再是「只登记、没落地」的槽位。**组件 API 的稳定级别是另一件事**（Panorama 属 post-stable，见 `docs/zh-CN/components/panorama/index.md` 的范围表） |
