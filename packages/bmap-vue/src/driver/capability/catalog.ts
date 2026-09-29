/**
 * Capability Catalog
 *
 * 语义能力名 → 描述符。`rawMembers` 指向 SDK 顶层构造器名或 `Map` 原型方法名，
 * 用于在无真实 SDK 的测试/离线环境做能力探测。
 *
 * 命名与状态约定（M3A0-06 / issue #15）：
 * - 能力名按 `<family>.<capability>` 语义命名，family 覆盖 Map / Overlay / Layer / Service /
 *   Panorama。目录只登记 **SDK 的能力**：本库自己的模块（生命周期、测试替身等）不进这张表，
 *   「`supports()` 一个自家模块名」没有意义（#104 删掉了原来冒充能力的 `runtime` 族）。
 * - `status` 表达生命周期意图：
 *   - `native`：SDK 原生能力，直接映射官方 API；
 *   - `extended`：项目在 SDK 之上的扩展能力（需要额外实现或组合）；
 *   - `experimental`：实验性能力，API 可能变更或移除；
 *   - `unsupported`：明确不支持；`supports()` 恒为 false（用户 override 除外），
 *     保留槽位使错误信息、文档与能力矩阵保持一致。
 * - `runtimeOnly`：只能通过实例/原型成员在运行时探测，官方类型包无对应静态声明
 *   （例如 `Map` 原型方法、`PointCollection`、`Marker3D`，或只有文档没有类型声明的构造器）。
 *
 * `rawMembers` 名称以官方 `@baidumap/jsapi-v4-types@4.0.5` 为基准核对：
 * `core/Map.d.ts` 的 Map 原型方法与各子目录 `declare namespace BMap` 类声明。
 */

export type Capability =
  // Map
  | "map.view-state"
  | "map.zoom"
  | "map.center-and-zoom"
  | "map.bounds"
  | "map.viewport"
  | "map.fly-to"
  | "map.screenshot"
  | "map.heading"
  | "map.tilt"
  | "map.animate"
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
  | "layer.dom"
  // M7-LAYERS（#40）：第三方标准瓦片服务基线（XYZ / WMS / WMTS / 栅格）
  | "layer.xyz"
  | "layer.wms"
  | "layer.wmts"
  | "layer.raster"
  | "layer.mvt"
  | "layer.cluster"
  | "layer.point"
  | "layer.heatmap"
  | "layer.track-line"
  | "layer.polygon"
  | "layer.polyline"
  | "layer.text"
  // Service
  | "service.local-search"
  | "service.autocomplete"
  | "service.driving-route"
  | "service.walking-route"
  | "service.riding-route"
  | "service.transit-route"
  | "service.geocoder"
  | "service.geolocation"
  | "service.local-city"
  | "service.boundary"
  | "service.convertor"
  | "service.track-animation"
  // Panorama
  | "panorama.viewer"
  | "panorama.service"
  | "panorama.label";

export type CapabilityFamily = "map" | "overlay" | "layer" | "service" | "panorama";

export type CapabilityStatus = "native" | "extended" | "experimental" | "unsupported";

export interface CapabilityDescriptor {
  id: Capability;
  family: CapabilityFamily;
  /** 一句话语义说明（进入生成的能力矩阵） */
  description: string;
  /** SDK 顶层构造器名或 Map 原型方法名；空数组表示无 SDK 成员 */
  rawMembers?: readonly string[];
  status: CapabilityStatus;
  /** 只能在运行时探测（官方类型包无静态声明） */
  runtimeOnly: boolean;
}

/**
 * 单引擎收口（#26 删除 `webgl-v1` / `jsapi-v3`，#126 结算退化维度）。
 *
 * 描述符**不再**声明 `engines`：单引擎下「已收录能力按引擎区分」不产生任何区分力
 * （每条都恒为全集），留着它只是为未实现的多引擎留位。原字段的**唯一**可达拒绝路径
 * ——「目录未收录该 id」——已改由 `CapabilityReason` 的 `unlisted-capability` 表达，
 * 名字与该路径一致。引擎身份仍在 `CapabilityRegistry` / `CapabilityExplanation` 的
 * `engine` 字段与错误信息里（那是有消费者的），删掉的只是目录里恒真的那一列。
 * 决策见 ADR `2026-09-24-single-engine-capability-catalog`。
 */

export const CAPABILITY_CATALOG: Record<Capability, CapabilityDescriptor> = {
  // ---------------------------------------------------------------- Map
  "map.view-state": {
    id: "map.view-state",
    family: "map",
    description: "视图中心读写（getCenter / setCenter）",
    rawMembers: ["getCenter", "setCenter"],
    status: "native",
    runtimeOnly: true,
  },
  "map.zoom": {
    id: "map.zoom",
    family: "map",
    description: "缩放级别读写（getZoom / setZoom）",
    rawMembers: ["getZoom", "setZoom"],
    status: "native",
    runtimeOnly: true,
  },
  "map.center-and-zoom": {
    id: "map.center-and-zoom",
    family: "map",
    description: "一次调用同时设置中心与缩放（centerAndZoom）",
    rawMembers: ["centerAndZoom"],
    status: "native",
    runtimeOnly: true,
  },
  "map.bounds": {
    id: "map.bounds",
    family: "map",
    description: "可视范围读写（getBounds / setBounds）",
    rawMembers: ["getBounds", "setBounds"],
    status: "native",
    runtimeOnly: true,
  },
  "map.viewport": {
    id: "map.viewport",
    family: "map",
    description: "视口读写（getViewport 只读最佳视野 / setViewport 施加视野）",
    // #165 回填：`getViewport` 回到探测表。此前 Class 5 把它摘掉的理由是「`MapDriver`
    // 从不调用它」——那是**用实现缺失去论证能力不存在**，与 #165 §3.3「不得无理由裁剪
    // 能力」相悖。live AK 实测两个成员运行时都在位（`165-runtime-verification.md`
    // 结论四），且 `MapDriver.getViewport` 现在真的调用它。
    rawMembers: ["getViewport", "setViewport"],
    status: "native",
    runtimeOnly: true,
  },
  "map.heading": {
    id: "map.heading",
    family: "map",
    description: "地图旋转角（setHeading）",
    rawMembers: ["setHeading"],
    status: "native",
    runtimeOnly: true,
  },
  "map.tilt": {
    id: "map.tilt",
    family: "map",
    description: "地图倾斜角（setTilt）",
    rawMembers: ["setTilt"],
    status: "native",
    runtimeOnly: true,
  },
  "map.animate": {
    id: "map.animate",
    family: "map",
    description: "视角关键帧动画（startViewAnimation / cancelViewAnimation）",
    rawMembers: ["startViewAnimation", "cancelViewAnimation"],
    status: "native",
    runtimeOnly: true,
  },
  // #165 回填：`map.screenshot` / `map.fly-to` 两条**恢复**收录。
  //
  // 它们此前被 Class 5 删除，理由是「`MapDriver` 没有对应命令面，而 `supports()` 却返回
  // true —— 一个兑现不了的承诺」。那条推理的前提（成员在运行时不存在）**是错的**：
  // live AK 实测 `BMap.Map.prototype` 上 `getScreenshot` / `flyTo` / `getViewport` / `setViewport`
  // 全部在位（`docs/zh-CN/contributing/165-runtime-verification.md` 结论四，取证探针
  // `scripts/probe-runtime-members.mts`）。**用「我们还没接线」论证「能力不存在」，
  // 等于把「实现缺口」记成「上游缺口」**—— #165 §3.3 要求能力不得无理由裁剪，
  // 正确的处置是补实现，而不是删条目。两条现已由 `MapDriver.getScreenshot` /
  // `MapDriver.flyTo` 兑现。
  //
  // 两条的状态取 `native` 而非 `experimental`/`extended`：它们是对官方成员的直接投影，
  // 本库没有加任何项目语义。`map.screenshot` 的官方限制（地球模式不支持、需
  // `preserveDrawingBuffer: true` 否则黑屏）写在 `MapDriver.getScreenshot` 的文档注释上——
  // 那是**使用前提**，不是「本库把它做得半成品」，因此不构成降级状态。
  "map.fly-to": {
    id: "map.fly-to",
    family: "map",
    description: "平滑飞行到目标中心与级别（flyTo）",
    // 探测 `flyTo` **本身**。此前这条 rawMembers 写的是 `panTo` —— 那是**另一个成员**
    // （瞬移，没有飞行动画），拿它当「飞行定位已支持」的依据属于张冠李戴。
    rawMembers: ["flyTo"],
    status: "native",
    runtimeOnly: true,
  },
  "map.screenshot": {
    id: "map.screenshot",
    family: "map",
    description: "取当前画布截图（getScreenshot；官方限制：地球模式不支持，且需建图时带 preserveDrawingBuffer: true）",
    rawMembers: ["getScreenshot"],
    status: "native",
    runtimeOnly: true,
  },
  "map.check-resize": {
    id: "map.check-resize",
    family: "map",
    description: "容器尺寸变化后重算视图（checkResize）",
    rawMembers: ["checkResize"],
    status: "native",
    runtimeOnly: true,
  },
  "map.pixel-conversion": {
    id: "map.pixel-conversion",
    family: "map",
    description: "经纬度与像素互转（pointToPixel / pixelToPoint）",
    rawMembers: ["pointToPixel", "pixelToPoint"],
    status: "native",
    runtimeOnly: true,
  },
  "map.style": {
    id: "map.style",
    family: "map",
    description: "个性化地图样式（setMapStyle）",
    rawMembers: ["setMapStyle"],
    status: "native",
    runtimeOnly: true,
  },
  "map.destroy": {
    id: "map.destroy",
    family: "map",
    description: "销毁地图并释放资源（v4 destroy）",
    rawMembers: ["destroy"],
    status: "native",
    runtimeOnly: true,
  },

  // ------------------------------------------------------------ Overlay
  "overlay.marker": {
    id: "overlay.marker",
    family: "overlay",
    description: "点标记（Marker）",
    rawMembers: ["Marker"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.label": {
    id: "overlay.label",
    family: "overlay",
    description: "文本标注（Label）",
    rawMembers: ["Label"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.info-window": {
    id: "overlay.info-window",
    family: "overlay",
    description: "信息窗口（InfoWindow）",
    rawMembers: ["InfoWindow"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.circle": {
    id: "overlay.circle",
    family: "overlay",
    description: "圆（Circle）",
    rawMembers: ["Circle"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.polyline": {
    id: "overlay.polyline",
    family: "overlay",
    description: "折线（Polyline）",
    rawMembers: ["Polyline"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.polygon": {
    id: "overlay.polygon",
    family: "overlay",
    description: "多边形（Polygon）",
    rawMembers: ["Polygon"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.rectangle": {
    id: "overlay.rectangle",
    family: "overlay",
    description: "矩形（Rectangle）",
    rawMembers: ["Rectangle"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.custom-dom": {
    id: "overlay.custom-dom",
    family: "overlay",
    description: "自定义 DOM 覆盖物（CustomOverlay）",
    rawMembers: ["CustomOverlay"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.ground": {
    id: "overlay.ground",
    family: "overlay",
    description: "地面叠加层（GroundOverlay）",
    rawMembers: ["GroundOverlay"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.point-collection": {
    id: "overlay.point-collection",
    family: "overlay",
    description: "海量点（PointCollection）；官方 4.0.5 文档引用但未声明类型",
    rawMembers: ["PointCollection"],
    status: "native",
    runtimeOnly: true,
  },
  "overlay.context-menu": {
    id: "overlay.context-menu",
    family: "overlay",
    description: "右键菜单（ContextMenu / MenuItem）",
    rawMembers: ["ContextMenu", "MenuItem"],
    status: "native",
    runtimeOnly: false,
  },
  "overlay.prism": {
    id: "overlay.prism",
    family: "overlay",
    description: "3D 棱柱（Prism）",
    rawMembers: ["Prism"],
    status: "experimental",
    runtimeOnly: false,
  },
  "overlay.bezier-curve": {
    id: "overlay.bezier-curve",
    family: "overlay",
    description: "贝塞尔曲线（BezierCurve）",
    rawMembers: ["BezierCurve"],
    status: "experimental",
    runtimeOnly: false,
  },
  "overlay.marker-3d": {
    id: "overlay.marker-3d",
    family: "overlay",
    description: "3D 标记（Marker3D）；官方 4.0.5 文档引用但未声明类型",
    rawMembers: ["Marker3D"],
    status: "experimental",
    runtimeOnly: true,
  },
  "overlay.mapvgl": {
    id: "overlay.mapvgl",
    family: "overlay",
    description:
      "MapVGL 渲染叠加层；在 JSAPI 4.0 上**不兼容**（结论 `incompatible`，无迁移路径）：脚本的 JSONP " +
      "传输层依赖 SDK 的私有回调表（成员名 `_rd`），且它的 bmap 适配层要往 `getPanes().mapPane` 上挂视图容器、" +
      "而 4.0 的 panes 里没有 `mapPane`。本库明令不得访问私有面，也不为它写适配层 —— 改用原生图层。" +
      "依据与复现见 plugin-compat-inventory",
    status: "unsupported",
    runtimeOnly: true,
  },

  // -------------------------------------------------------------- Layer
  "layer.tile": {
    id: "layer.tile",
    family: "layer",
    description: "瓦片图层（TileLayer）",
    rawMembers: ["TileLayer"],
    status: "native",
    runtimeOnly: false,
  },
  "layer.traffic": {
    id: "layer.traffic",
    family: "layer",
    description: "实时路况图层（TrafficLayer）",
    rawMembers: ["TrafficLayer"],
    status: "native",
    runtimeOnly: false,
  },
  // ⚠️ **不要**在这里为 `FeatureLayer` 增加能力项（#165 收口，实测裁决：不加）。
  //
  // 三方分歧与逐条读数（live AK / headless Chrome，`scripts/probe-165-feature-layer.mts`，
  // `BMap.version === "gl"`，SDK 4.0.5；补齐等待 `settled=true`、0ms 后取样）：
  //
  // | 来源 | 说法 |
  // | --- | --- |
  // | `@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`，207 个 `.d.ts`） | **零命中** |
  // | 官方 React 参考 `react-bmap` master `fde5bbd` | 有 `src/components/Layer/FeatureLayer.tsx` + `createFeatureLayer` 工厂 |
  // | 官方 Vue 参考 `vue-bmap` master `ffc6dad` | **没有** `FeatureLayer` 组件（`src/components/Layer/` 下只有 `index.ts`） |
  // | 运行时 | `typeof BMap.FeatureLayer === "undefined"`；`BMap` 上不是自有属性；`new BMap.FeatureLayer({})` 抛 `is not a constructor` |
  //
  // ⇒ **不封装**。理由不是「参考实现不算证据」这句原则本身，而是三条**可复核**的读数：
  //
  // 1. 运行时根本没有这个构造器（补齐之后仍然没有，不是取样错位——同一轮等待
  //    `GeoJSONLayer` / `NormalLayer` 都判定为 settled，所以「缺席」有资格成立）；
  // 2. 它与 `BMap.NormalLayer` **没有任何关系**：`FeatureLayer === NormalLayer` 为 false，
  //    两者都不可用/可用分别成立，`NormalLayer.prototype` 的 39 个成员里没有 `FeatureLayer`
  //    的痕迹（官方 React 参考的组件文件头「继承 NormalLayer」只是一句注释，运行时无从印证）；
  // 3. 参考实现自己的**能力矩阵**里就没有 `FeatureLayer`
  //    （`src/drivers/capabilityMatrix.ts` 的 `V4_LAYER_CLASS` 逐条读过，零命中），
  //    而 `createLayerFactory` 第一行就是 `if (!capabilities.has(cap)) return null`
  //    ⇒ `createFeatureLayer` 在参考实现内部是**不可达的死代码**，永远返回 `null`。
  //    它的选项类型也是这一段里**唯一**写成 `unknown` 的（邻居都有具名 options 接口）。
  //
  // 为一条永远为 false 的能力登记条目，比不登记更坏：`supports("layer.feature")` 会开始
  // 回答一个恒定的值，能力矩阵里多一行需要长期维护的假事实。因此**只留注释**。
  //
  // 顺带一条**范围更大的**事实（同样实测）：`BMap.NormalLayer` 在运行时**存在**
  // （原型 39 个成员，含 `isNormalLayer` / `setOpacity` / `setZIndex` / `pick` / `onAdd`），
  // 但官方类型包里**也没有 `class NormalLayer`**（`layer/NormalLayer.d.ts` 只有
  // `NormalLayerEventMap` / `NormalLayerPickEvent` 等接口）。⇒「类型包没有」**不等于**
  // 「运行时没有」；反过来「运行时没有」也不能反推类型包。本库不因此新增 `layer.normal`
  // （没有组件消费它，且 `NormalLayer` 是**要自己继承实现**的基类，不是一个可直接实例化的
  // 数据图层），这一条同样只作为口径记录在此。
  "layer.geojson": {
    id: "layer.geojson",
    family: "layer",
    description: "GeoJSON 图层（GeoJSONLayer）",
    rawMembers: ["GeoJSONLayer"],
    status: "native",
    runtimeOnly: false,
  },
  // ⚠️ 官方 `@deprecated`（4.0.5 给 `layer/PointIconLayer.d.ts` 的类加的，建议改用
  // `visualization.PointLayer` 的图标模式）。这里**保持 `status: "native"`**：
  // `status` 的词表只有 native / extended / experimental / unsupported，四个值的判据是
  // 「能力从哪来」，**没有一档表示「官方把它标记为弃用」**。为它新造一个 `deprecated`
  // 状态会让 `supports()` / `require()` / 能力矩阵全线跟着改语义（`native` 能力突然不再被列出），
  // 那是用一个展示层的事实去改一个判定层的契约。
  //
  // 因此弃用只落在**说明**上：组件继续可用（Development 期告警一次 + 类型层 `@deprecated`
  // + 文档），真正的替代品（`<PointLayer>`）本库已提供。详见 #165 与
  // `docs/zh-CN/components/data.md`。
  "layer.point-icon": {
    id: "layer.point-icon",
    family: "layer",
    description:
      "点图标图层（PointIconLayer）；⚠️ 官方 4.0.5 已标 @deprecated，建议改用 visualization.PointLayer（图标模式）",
    rawMembers: ["PointIconLayer"],
    status: "native",
    runtimeOnly: false,
  },
  // 同上：`PointShapeLayer` 也在 4.0.5 的弃用名单上（建议改用 `visualization.PointLayer`
  // 的形状模式），本库同样只登记、不改 `status`。⚠️ 本库**没有** `<PointShapeLayer>` 组件：
  // 形状点走 `<PointCollection>`（`BMap.PointCollection`，4.0 类型包里无声明，见 data.md）。
  "layer.point-shape": {
    id: "layer.point-shape",
    family: "layer",
    description:
      "点形状图层（PointShapeLayer）；⚠️ 官方 4.0.5 已标 @deprecated，建议改用 visualization.PointLayer（形状模式）",
    rawMembers: ["PointShapeLayer"],
    status: "native",
    runtimeOnly: false,
  },
  "layer.district": {
    id: "layer.district",
    family: "layer",
    description: "行政区划图层（DistrictLayer）",
    rawMembers: ["DistrictLayer"],
    status: "native",
    runtimeOnly: false,
  },
  "layer.panorama-coverage": {
    id: "layer.panorama-coverage",
    family: "layer",
    description: "全景覆盖图层（PanoramaCoverageLayer）；官方 4.0.5 文档引用但未声明类型",
    rawMembers: ["PanoramaCoverageLayer"],
    status: "native",
    runtimeOnly: true,
  },
  // ⚠️ 官方 `@deprecated`（4.0.5 给 `layer/LineLayer.d.ts` 的类加的，建议改用
  // `visualization.PolylineLayer`）。`status` 保持 `experimental` **不动**——那一位的判据是
  // 「这一族新、接口面可能变」，与「官方标了弃用」是两件不同的事；官方弃用只落说明。
  // 官方建议的替代组件 `<PolylineLayer>` 本库**已提供**（#166），组件本身继续可用。
  "layer.line": {
    id: "layer.line",
    family: "layer",
    description:
      "线图层（LineLayer）；⚠️ 官方 4.0.5 已标 @deprecated，建议改用 visualization.PolylineLayer" +
      "（本库已提供该组件，见 #166；迁移不是改个名字——两者 style 字段不同族）",
    rawMembers: ["LineLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  // 同上：`FillLayer` 也在 4.0.5 的弃用名单上（建议改用 `visualization.PolygonLayer`），
  // 替代组件同样已由 #166 提供。
  "layer.fill": {
    id: "layer.fill",
    family: "layer",
    description:
      "面图层（FillLayer）；⚠️ 官方 4.0.5 已标 @deprecated，建议改用 visualization.PolygonLayer" +
      "（本库已提供该组件，见 #166；迁移不是改个名字——两者 style 字段不同族）",
    rawMembers: ["FillLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.dom": {
    id: "layer.dom",
    family: "layer",
    description: "DOM 图层（DOMLayer）",
    rawMembers: ["DOMLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  // M7-LAYERS（#40）的四种「第三方标准瓦片服务」基线。它们都是 4.0 **新增**的独立构造器
  // （只有类声明，没有官方专页/Skill 背书），且第三方服务的可用性、坐标系与使用条款不受本库
  // 控制，因此标 `experimental`：接口面可能变，接入不等于保证可用。
  "layer.xyz": {
    id: "layer.xyz",
    family: "layer",
    description: "第三方标准瓦片图层（XYZLayer）；内置 EPSG:3857 → BD09MC 转换，可加载 XYZ/TMS 服务",
    rawMembers: ["XYZLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.wms": {
    id: "layer.wms",
    family: "layer",
    description: "WMS 瓦片服务图层（WMSLayer）；按 BBOX/WIDTH/HEIGHT 驱动瓦片请求",
    rawMembers: ["WMSLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.wmts": {
    id: "layer.wmts",
    family: "layer",
    description: "WMTS 标准瓦片服务图层（WMTSLayer）；按 TileMatrixSet 拼接请求",
    rawMembers: ["WMTSLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.raster": {
    id: "layer.raster",
    family: "layer",
    description: "栅格瓦片图层（RasterTileLayer）；支持子域轮询、TMS 翻转与四至裁剪",
    rawMembers: ["RasterTileLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  // #109：MVT 矢量瓦片。挂载（直接 `addLayer`）、`layers` 字符串数组、状态键 `layerName_id`
  // 均由 live 探针取证（skill `references/mvt-layer.md`「live 探针读数」）；类在 4.0.5 有完整声明。
  "layer.mvt": {
    id: "layer.mvt",
    family: "layer",
    description: "MVT 矢量瓦片图层（MVTLayer）；按源图层名过滤与样式，要素状态键为 layerName_id",
    rawMembers: ["MVTLayer"],
    status: "native",
    runtimeOnly: false,
  },
  // 聚合：默认路径就是原生。`status: "extended"` 表达的是「本库在原生能力之上还提供了一个
  // 显式可选的 `markers` 引擎（网格聚合 + Marker）」，而**不是**「原生缺失时的 fallback」——
  // issue #35 的实测（`scripts/probe-native-point-cluster.mts`）证明原生可用，因此自动降级不成立；
  // `markers` 的增量是「簇内业务项」（官方没有公开的读回入口）。`runtimeOnly: true` 是因为
  // `ClusterLayer` 属可视化扩展 API：实现按需异步注入，**存在性只能在调用时刻判断**
  // （4.0.5 给它补了类声明，但「类型里有形状」≠「运行时已加载」，因此 `runtimeOnly`
  // 说的是注入时机，不是类型包有没有声明）。
  "layer.cluster": {
    id: "layer.cluster",
    family: "layer",
    description:
      "聚合图层（ClusterLayer）；MarkerCluster 的默认路径；另有显式可选的 markers 引擎" +
      "（唯一能给出簇内业务项的路径）。",
    status: "extended",
    runtimeOnly: true,
  },
  // M3A2-SERVICES-NATIVE（#23）补齐原生数据图层里缺少的三个能力槽位。
  // 三者都是官方归在「扩展 API」下的可视化图层，实现**异步注入**：`runtimeOnly: true` 表达
  // 「存在性只能在运行时判断」，`experimental` 表达「接口面可能变」。
  // 4.0.5（`5ba67f4`）已为它们补上类声明，因此 `rawMembers` 现在有官方出处；`runtimeOnly`
  // 依然成立——它说的是**注入时机**，与类型包是否声明无关。
  "layer.point": {
    id: "layer.point",
    family: "layer",
    description:
      "原生点图层（PointLayer）；支持形状或图标，属扩展 API，由 PointLayer 落地。" +
      "4.0.5 声明了显隐 / 层级 / 绘制阶段 / 参考中心点这一组显示属性（官方**没有** setOpacity）。",
    rawMembers: ["PointLayer"],
    status: "experimental",
    runtimeOnly: true,
  },
  "layer.heatmap": {
    id: "layer.heatmap",
    family: "layer",
    description:
      "热力图（Heatmap）；按权重渲染点密度，属扩展 API。" +
      "4.0.5 声明了显隐 / 透明度 / 层级这一组显示属性——显隐因此走 setter 而不是摘挂实例。",
    rawMembers: ["Heatmap"],
    status: "experimental",
    runtimeOnly: true,
  },
  "layer.track-line": {
    id: "layer.track-line",
    family: "layer",
    description:
      "轨迹线（TrackLine）；数据绘制 + 播放命令面（start/pause/resume/stop/setSpeed/setProcess）" +
      "属扩展 API，由 TrackLineLayer 落地（playback expose + observed 事件观察 + pauseOnHidden）。" +
      "**它是 legacy 插件 `service.track-animation` 的迁移目标**" +
      "（结论见 plugin-compat-inventory）；播放命令的方法名经 live 探针取证（#110，2026-09-23）。" +
      "4.0.5 声明了显隐 / 透明度 / 层级这一组显示属性——显隐因此走 setter，" +
      "重新可见**不**换实例（换实例会丢掉播放进度）。",
    rawMembers: ["TrackLine"],
    status: "experimental",
    runtimeOnly: true,
  },

  // #166：官方 4.0.5（git `5ba67f4`）新增的 `visualization/` 两族。它们是 4.0.5
  // **同时弃用**的 `FillLayer` / `LineLayer` 的**官方指定替代**。
  //
  // `status: "experimental"` 的判据与 `layer.line` / `layer.fill` 相同：「这一族新、
  // 接口面可能变」——4.0.5 才第一次出现在类型包里，且官方文档仍在补（`PolygonLayer.d.ts:171`
  // 的注释连「含内部描边」的实现细节都写进去了，说明还在演进）。**不是**因为官方标了弃用。
  //
  // `runtimeOnly: false`（与扩展 API 那四类相反）：live 探针
  // （`scripts/probe-runtime-members.mts` case 3b 的 `injectionTiming`，2026-09-27）读到
  // `B.PolygonLayer` / `B.PolylineLayer` 在 `BMap.Map` 刚就绪时**已经是 `function`**
  // ⇒ 随主包注入，不存在「等异步注入」的时机问题。
  "layer.polygon": {
    id: "layer.polygon",
    family: "layer",
    description:
      "批量面图层（PolygonLayer，官方 4.0.5 新增）；官方指定的 FillLayer 替代。" +
      "样式走整袋 setOptions（不是 setStyleOptions），无 doOnceDraw。" +
      "由 PolygonLayer 组件落地。官方声明了 hitTest 但 live 实测运行时没有 ⇒ 不开面；" +
      "setOpacity 虽运行时在位且 getOpacity 读得回（零信息量：setter 与 getter 共用状态），" +
      "但像素读数证明**它不驱动渲染**（五态全同值，而同一次运行里 fillOpacity / setVisible " +
      "都能归零）⇒ **刻意不登记**；对照同族的 PolylineLayer，setOpacity 在那里是经" +
      "运行时豁免登记的，本族没有——同族不同面。" +
      "本族的选项表里也**没有** opacity 这一项。逐条依据见 " +
      "docs/zh-CN/contributing/166-visualization-alignment-audit.md",
    rawMembers: ["PolygonLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  "layer.polyline": {
    id: "layer.polyline",
    family: "layer",
    description:
      "批量折线图层（PolylineLayer，官方 4.0.5 新增）；官方指定的 LineLayer 替代。" +
      "样式走整袋 setOptions（不是 setStyleOptions），无 doOnceDraw。" +
      "由 PolylineLayer 组件落地。官方声明了 hitTest 但 live 实测运行时没有 ⇒ 不开面；" +
      "setOpacity 虽未被官方声明，但 live 像素读数证明**它可观测地生效**" +
      "（4229 ⇄ 0，可逆且重复一致）⇒ 开面，与同族的 PolygonLayer 处置相反。" +
      "逐条依据见 docs/zh-CN/contributing/166-visualization-alignment-audit.md",
    rawMembers: ["PolylineLayer"],
    status: "experimental",
    runtimeOnly: false,
  },
  // #166 第二刀：`visualization/TextLayer`（4.0.5 新增的批量文字标注）。
  //
  // `status: "experimental"` 与 `layer.polygon` / `layer.polyline` 同判据：「4.0.5 才第一次
  // 出现在类型包里、接口面可能变」。
  // `runtimeOnly: false`：live 探针 case 3e 的 `injectionTiming` 读到
  // `TextLayerAtMapReady === "function"` ⇒ 随主包注入，与扩展 API 那四类相反。
  //
  // ⚠️ **本票的另一半发现**：`BarLayer` / `FlyLineLayer` / `GeoJSONSource` 在这份产物里
  // **完全不存在**（探针 case 15/16：8s 与再 25s 两次复读都是 `undefined`，且扫遍
  // `BMap` 全部 294 个自有属性也没有任何别名）。它们因此**不建能力槽位**——
  // 官方声明了、运行时没发，登记进去只会让 `supports()` 对一个永远不会来的能力说真话。
  // 依据见 `docs/zh-CN/contributing/166-visualization-alignment-audit.md`。
  "layer.text": {
    id: "layer.text",
    family: "layer",
    description:
      "批量文字标注图层（TextLayer，官方 4.0.5 新增）；geometry 支持 Point / MultiPoint。" +
      "样式走整袋 setOptions（不是 setStyleOptions），无 doOnceDraw。由 TextLayer 组件落地。" +
      "它是 visualization 家族里唯一声明与运行时完全对齐的类：hitTest 与 setOpacity 都在" +
      "（PolygonLayer 声明有 hitTest 运行时无、setOpacity 运行时在不渲染；" +
      "PolylineLayer 则与它相反）。" +
      "逐条依据见 docs/zh-CN/contributing/166-visualization-alignment-audit.md",
    rawMembers: ["TextLayer"],
    status: "experimental",
    runtimeOnly: false,
  },

  // ------------------------------------------------------------ Service
  "service.local-search": {
    id: "service.local-search",
    family: "service",
    description: "本地检索（LocalSearch）",
    rawMembers: ["LocalSearch"],
    status: "native",
    runtimeOnly: false,
  },
  "service.autocomplete": {
    id: "service.autocomplete",
    family: "service",
    description:
      "输入提示（Autocomplete）：构造、输入框绑定与 `onSearchComplete` 转发都是原生的。" +
      "本库**不**提供程序化检索（原 `suggest()` 的回包归属靠未证实的 keyword / FIFO 推断，" +
      "已删除；需要程序化建议时改用 `LocalSearch` 或官方 UI Kit）",
    rawMembers: ["Autocomplete"],
    // #104：原先标 `experimental` 的唯一理由是程序化 `suggest()` 的归属假设；该调用面已删除，
    // 剩下的构造 / 绑定 / 转发都有官方声明支撑，因此回到 `native`。
    status: "native",
    runtimeOnly: false,
  },
  "service.driving-route": {
    id: "service.driving-route",
    family: "service",
    description: "驾车路线规划（DrivingRoute）",
    rawMembers: ["DrivingRoute"],
    status: "native",
    runtimeOnly: false,
  },
  "service.walking-route": {
    id: "service.walking-route",
    family: "service",
    description: "步行路线规划（WalkingRoute）",
    rawMembers: ["WalkingRoute"],
    status: "native",
    runtimeOnly: false,
  },
  "service.riding-route": {
    id: "service.riding-route",
    family: "service",
    description: "骑行路线规划（RidingRoute）",
    rawMembers: ["RidingRoute"],
    status: "native",
    runtimeOnly: false,
  },
  "service.transit-route": {
    id: "service.transit-route",
    family: "service",
    description: "公交路线规划（TransitRoute）",
    rawMembers: ["TransitRoute"],
    status: "native",
    runtimeOnly: false,
  },
  "service.geocoder": {
    id: "service.geocoder",
    family: "service",
    description: "地理编码 / 逆地理编码（Geocoder）",
    rawMembers: ["Geocoder"],
    status: "native",
    runtimeOnly: false,
  },
  "service.geolocation": {
    id: "service.geolocation",
    family: "service",
    description: "浏览器定位（Geolocation）",
    rawMembers: ["Geolocation"],
    status: "native",
    runtimeOnly: false,
  },
  "service.local-city": {
    id: "service.local-city",
    family: "service",
    description: "IP 定位城市（LocalCity）",
    rawMembers: ["LocalCity"],
    status: "native",
    runtimeOnly: false,
  },
  "service.boundary": {
    id: "service.boundary",
    family: "service",
    description: "行政区边界（Boundary）",
    rawMembers: ["Boundary"],
    status: "native",
    runtimeOnly: false,
  },
  "service.convertor": {
    id: "service.convertor",
    family: "service",
    description: "坐标转换（Convertor）",
    rawMembers: ["Convertor"],
    status: "native",
    runtimeOnly: false,
  },
  "service.track-animation": {
    id: "service.track-animation",
    family: "service",
    description:
      "轨迹动画（BMapGLLib 插件）；结论 `native`：**4.0 的对应能力是原生图层 `layer.track-line`**" +
      "（组件 `<TrackLineLayer>`），本库不再为这个 legacy 插件提供封装，播放命令面已落地在" +
      " `<TrackLineLayer>` 的 `playback` expose 上。" +
      "脚本自身引用面在 4.0.5 声明里没有缺口，且**最小运行时路径已验证**" +
      "（真实 4.0 上构造 + `start()` + 视角跟随 + `pause()` / `continue()` + 播放到结尾跑通）；" +
      "依据与复现见 plugin-compat-inventory",
    status: "unsupported",
    runtimeOnly: true,
  },

  // ----------------------------------------------------------- Panorama
  "panorama.viewer": {
    id: "panorama.viewer",
    family: "panorama",
    description: "全景查看器（Panorama）",
    rawMembers: ["Panorama"],
    status: "native",
    runtimeOnly: false,
  },
  "panorama.service": {
    id: "panorama.service",
    family: "panorama",
    description: "全景服务（PanoramaService）",
    rawMembers: ["PanoramaService"],
    status: "native",
    runtimeOnly: false,
  },
  "panorama.label": {
    id: "panorama.label",
    family: "panorama",
    description:
      "全景标注（PanoramaLabel）。由 `<PanoramaLabel>` 消费，因此状态由 experimental 提升为 " +
      "native：本能力不再是「只登记、没落地」的槽位。**组件 API 的稳定级别是另一件事**" +
      "（Panorama 属 post-stable，见 `docs/zh-CN/components/panorama/index.md` 的范围表）",
    rawMembers: ["PanoramaLabel"],
    status: "native",
    runtimeOnly: false,
  },
};

export const CAPABILITY_IDS = Object.keys(CAPABILITY_CATALOG) as readonly Capability[];

export const CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  "map",
  "overlay",
  "layer",
  "service",
  "panorama",
];

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "native",
  "extended",
  "experimental",
  "unsupported",
];
