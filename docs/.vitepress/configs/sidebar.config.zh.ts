import { DefaultTheme } from "vitepress";
export const sidebarConfigZh: DefaultTheme.Sidebar = {
  "/zh-CN/": [
    {
      text: "指南",
      collapsed: false,
      base: "/zh-CN/guide/",
      items: [
        {
          text: "简介",
          link: "introduction",
        },
        {
          text: "安装",
          link: "installation",
        },
        {
          text: "快速开始",
          link: "quick-start",
        },
        {
          text: "配置与插件",
          link: "config",
        },
        {
          text: "官方 UI Kit（./ui-kit）",
          link: "ui-kit",
        },
        {
          text: "扩展契约（./advanced 与 ./core）",
          link: "advanced",
        },
        {
          text: "全局组件事件",
          link: "com-events",
        },
        {
          text: "FAQ",
          link: "faq",
        },
      ],
    },
    {
      text: "基础组件",
      collapsed: false,
      items: [
        {
          text: "Map 地图",
          link: "/zh-CN/components/map",
        },
        {
          text: "BMapProvider 上下文",
          link: "/zh-CN/components/provider",
        },
      ],
    },
    {
      text: "控件组件",
      collapsed: false,
      base: "/zh-CN/components/control/",
      items: [
        {
          text: "CustomControl 自定义",
          link: "custom",
        },
        {
          text: "CityListControl 城市列表",
          link: "citylist",
        },
        {
          text: "NavigationControl3D 3D视角导航",
          link: "navigation3d",
        },
        {
          text: "NavigationControl 平移缩放",
          link: "navigation",
        },
        {
          text: "MapTypeControl 地图类型",
          link: "map-type",
        },
        {
          text: "OverviewMapControl 鹰眼",
          link: "overview",
        },
        {
          text: "CopyrightControl 版权",
          link: "copyright",
        },
        {
          text: "ScaleControl 比例尺",
          link: "scale",
        },
        {
          text: "ZoomControl 缩放",
          link: "zoom",
        },
        {
          text: "LocationControl 定位",
          link: "location",
        },
        {
          text: "PanoramaControl 全景",
          link: "panorama-control",
        },
        {
          text: "ContextMenu 上下文菜单",
          link: "context-menu",
        },
      ],
    },
    {
      text: "覆盖物组件",
      collapsed: false,
      base: "/zh-CN/components/overlay/",
      items: [
        {
          text: "Circle 圆形",
          link: "circle",
        },
        {
          text: "Label 文本标注",
          link: "label",
        },
        {
          text: "Marker 标注点",
          link: "marker",
        },
        {
          text: "Marker3D 带高度的点",
          link: "marker3d",
        },
        {
          text: "Polygon 多边形",
          link: "polygon",
        },
        {
          text: "Rectangle 矩形",
          link: "rectangle",
        },
        {
          text: "Polyline 折线",
          link: "polyline",
        },
        {
          text: "BezierCurve 贝塞尔曲线",
          link: "bezierCurve",
        },
        {
          text: "InfoWindow 信息窗口",
          link: "infowindow",
        },
        {
          text: "Prism 3d棱柱",
          link: "prism",
        },
        {
          text: "GroundOverlay 地面叠加层",
          link: "ground-overlay",
        },
        {
          text: "CustomOverlay 自定义 DOM 覆盖物",
          link: "custom-overlay",
        },
        {
          text: "MapMask 掩膜",
          link: "mapMask",
        },
        {
          text: "覆盖物事件矩阵",
          link: "events",
        },
      ],
    },
    {
      text: "数据组件",
      collapsed: false,
      items: [
        {
          text: "Marker 列表与聚合",
          link: "/zh-CN/components/data",
        },
      ],
    },
    {
      text: "原生批量可视化图层",
      collapsed: false,
      base: "/zh-CN/components/layer/",
      items: [
        {
          text: "线 / 面 / 热力 / 轨迹线（+ 要素状态）",
          link: "native-visual-layers",
        },
      ],
    },
    {
      text: "图层组件",
      collapsed: false,
      base: "/zh-CN/components/layer/",
      items: [
        {
          text: "图层总览与排障",
          link: "index",
        },
        {
          text: "PanoramaCoverageLayer 全景图层",
          link: "panorama-coverage",
        },
        {
          text: "DistrictLayer 行政区图层",
          link: "district-layer",
        },
        {
          text: "TileLayer 瓦片图层",
          link: "tile-layer",
        },
        {
          text: "TrafficLayer 路况图层",
          link: "traffic-layer",
        },
        {
          text: "GeoJSONLayer GeoJSON 图层",
          link: "geojson-layer",
        },
        {
          text: "DOMLayer DOM 图层",
          link: "dom-layer",
        },
        {
          text: "XYZLayer 标准瓦片图层",
          link: "xyz-layer",
        },
        {
          text: "WMSLayer WMS 图层",
          link: "wms-layer",
        },
        {
          text: "WMTSLayer WMTS 图层",
          link: "wmts-layer",
        },
        {
          text: "RasterTileLayer 栅格瓦片图层",
          link: "raster-layer",
        },
        {
          text: "MVTLayer 矢量瓦片",
          link: "mvt-layer",
        },
      ],
    },
    {
      text: "全景组件",
      collapsed: false,
      base: "/zh-CN/components/panorama/",
      items: [
        {
          text: "Panorama 全景查看器",
          link: "index",
        },
        {
          text: "PanoramaLabel 全景标注",
          link: "label",
        },
      ],
    },
    {
      text: "检索组件",
      collapsed: false,
      base: "/zh-CN/components/autoComplete/",
      items: [
        {
          text: "Autocomplete 自动填充",
          link: "index",
        },
      ],
    },
    {
      text: "Hooks",
      collapsed: false,
      base: "/zh-CN/hooks/",
      items: [
        {
          text: "usePoint 地图实例点（v2 已移除，仅留迁移说明）",
          link: "usePoint",
        },
        {
          text: "useMarkerIcons 图标",
          link: "useMarkerIcons",
        },
        {
          text: "useIpLocation IP定位",
          link: "useIpLocation",
        },
        {
          text: "useGeolocation 百度定位",
          link: "useGeolocation",
        },
        {
          text: "useGeocodeDetail 坐标点解析",
          link: "useGeocodeDetail",
        },
        {
          text: "useGeocoder 地址解析",
          link: "useGeocoder",
        },
        {
          text: "useConvertor 坐标转换",
          link: "useConvertor",
        },
        {
          text: "useAreaBoundary 区域边界",
          link: "useAreaBoundary",
        },
        {
          text: "usePanoramaService 全景检索",
          link: "usePanoramaService",
        },
        {
          text: "useLocalSearch 本地检索",
          link: "useLocalSearch",
        },
        {
          text: "useDrivingRoute 驾车路线",
          link: "useDrivingRoute",
        },
        {
          text: "useWalkingRoute 步行路线",
          link: "useWalkingRoute",
        },
        {
          text: "useRidingRoute 骑行路线",
          link: "useRidingRoute",
        },
        {
          text: "useTransitRoute 公交路线",
          link: "useTransitRoute",
        },
        {
          text: "useViewAnimation 3d视角动画",
          link: "useViewAnimation",
        },
        {
          text: "useControllableState 受控/非受控状态",
          link: "useControllableState",
        },
        {
          text: "useMapEvent 地图事件订阅",
          link: "useMapEvent",
        },
        {
          text: "useMapStatus 地图状态",
          link: "useMapStatus",
        },
      ],
    },
    {
      text: "扩展",
      collapsed: false,
      base: "/zh-CN/expand/",
      items: [
        {
          text: "离线地图",
          link: "offline-map",
        },
        {
          text: "MapVGL 可视化",
          link: "mapvgl",
        },
        {
          text: "bmap-draw 鼠标测量与绘制",
          link: "bmap-draw",
        },
      ],
    },
    {
      text: "贡献",
      collapsed: false,
      base: "/zh-CN/contributing/",
      items: [
        {
          text: "AI 开发与官方 Skill",
          link: "ai-development",
        },
        {
          text: "Capability Catalog 能力矩阵",
          link: "capability-matrix",
        },
        {
          text: "公开 API 对照（官方 React）",
          link: "official-api-alignment",
        },
        {
          text: "Ownership-first 存量审计表",
          link: "architecture-ownership-audit",
        },
        {
          text: "插件兼容 inventory",
          link: "plugin-compat-inventory",
        },
        {
          text: "官方包发布契约（Loader / UI Kit）",
          link: "official-packages",
        },
        {
          text: "v4 浏览器 smoke（默认链路 / 组件 / UI Kit）",
          link: "v4-browser-smoke",
        },
        {
          text: "性能基准与预算",
          link: "performance-baseline",
        },
      ],
    },
  ],
};
