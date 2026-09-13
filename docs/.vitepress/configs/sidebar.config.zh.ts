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
          text: "全局组件事件",
          link: "com-events",
        },
        {
          text: "Breaking Changes",
          link: "breaking-changes",
        },
        {
          text: "从 v2 迁移",
          link: "migration-from-v2",
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
          text: "BMap 地图",
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
          text: "BControl 自定义",
          link: "custom",
        },
        {
          text: "BCityList 城市列表",
          link: "citylist",
        },
        {
          text: "BNavigation3d 3D视角导航",
          link: "navigation3d",
        },
        {
          text: "BCopyright 版权",
          link: "copyright",
        },
        {
          text: "BScale 比例尺",
          link: "scale",
        },
        {
          text: "BZoom 缩放",
          link: "zoom",
        },
        {
          text: "BLocation 定位",
          link: "location",
        },
        {
          text: "BPanoramaControl 全景",
          link: "panorama-control",
        },
        {
          text: "BContextMenu 上下文菜单",
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
          text: "BCircle 圆形",
          link: "circle",
        },
        {
          text: "BLabel 文本标注",
          link: "label",
        },
        {
          text: "BMarker 标注点",
          link: "marker",
        },
        {
          text: "BMarker3d 带高度的点",
          link: "marker3d",
        },
        {
          text: "BPolygon 多边形",
          link: "polygon",
        },
        {
          text: "BPolyline 折线",
          link: "polyline",
        },
        {
          text: "BBezierCurve 贝塞尔曲线",
          link: "bezierCurve",
        },
        {
          text: "BInfoWindow 信息窗口",
          link: "infowindow",
        },
        {
          text: "BPrism 3d棱柱",
          link: "prism",
        },
        {
          text: "BGroundOverlay 地面叠加层",
          link: "ground-overlay",
        },
        {
          text: "BMapMask 掩膜",
          link: "mapMask",
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
      text: "图层组件",
      collapsed: false,
      base: "/zh-CN/components/layer/",
      items: [
        {
          text: "BPanoramaCoverageLayer 全景图层",
          link: "panorama-coverage",
        },
        {
          text: "BDistrictLayer 行政区图层",
          link: "district-layer",
        },
      ],
    },
    {
      text: "检索组件",
      collapsed: false,
      base: "/zh-CN/components/autoComplete/",
      items: [
        {
          text: "BAutoComplete 自动填充",
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
          text: "usePoint 地图实例点",
          link: "usePoint",
        },
        {
          text: "useBMapMarkerIcons 图标",
          link: "useBMapMarkerIcons",
        },
        {
          text: "useBMapIpLocation IP定位",
          link: "useBMapIpLocation",
        },
        {
          text: "useBMapGeolocation 百度定位",
          link: "useBMapGeolocation",
        },
        {
          text: "useBMapGeocodeDetail 坐标点解析",
          link: "useBMapGeocodeDetail",
        },
        {
          text: "useBMapGeocoder 地址解析",
          link: "useBMapGeocoder",
        },
        {
          text: "useBMapConvertor 坐标转换",
          link: "useBMapConvertor",
        },
        {
          text: "useBMapAreaBoundary 区域边界",
          link: "useBMapAreaBoundary",
        },
        {
          text: "useBMapViewAnimation 3d视角动画",
          link: "useBMapViewAnimation",
        },
        {
          text: "useBMapTrackAnimation 轨迹动画",
          link: "useBMapTrackAnimation",
        },
        {
          text: "useBMapAsyncTask 异步任务",
          link: "useBMapAsyncTask",
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
          text: "官方包发布契约（Loader / UI Kit）",
          link: "official-packages",
        },
      ],
    },
  ],
};
