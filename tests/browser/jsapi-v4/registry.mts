/**
 * v4 浏览器 smoke 的检查登记表（零依赖）
 *
 * 这里是「哪些检查在哪些档里跑、哪些算 required」的**单一事实源**。页面（`main.ts`）按登记
 * 表执行并上报；orchestrator 按登记表判定（见 `report.mts` 的 `evaluateSmokeReport`）；
 * 单测（`tests/behavior/v3-v4-smoke-gate.test.ts`）按登记表做一致性校验。
 *
 * 三条口径（R25-E / issue #74）：
 *
 * 1. **档内不适用的检查不登记，而不是登记成 `skipped`。** `skipped` 的语义是「登记了却没跑」，
 *    它会阻止放行；fixture 档里根本不需要发网络请求，就不该出现在 fixture 的列表里。
 * 2. **required 只接受 `pass`。** 任何 `blocked` / `skipped` / `expected-failure` 都不算通过
 *    （见 `report.mts` 的门禁规则）。
 * 3. **跨域未归因错误默认不放行。** `UNATTRIBUTED_WHITELIST` 缺省为空；要放行必须登记一条
 *    带齐 `reason` / `version` / `owner` / `tracking` / `expires` 的条目，且它只把结论抬到
 *    `blocked`——仍然不可放行，只是把「库回归」与「上游噪声」区分开。
 */
import type { SmokeMode, UnattributedWhitelistEntry } from "./report.mts";

export interface SmokeCheckSpec {
  id: string;
  /** 人类可读名字，进入报告便于评审按 issue 的验收清单逐条对照。 */
  name: string;
}

const SPECS: Record<string, SmokeCheckSpec> = {
  "provider-default-delegation": {
    id: "provider-default-delegation",
    name: "默认入口（只给 ak）真的注入了官方 jsapi-loader 的入口 script，且 URL 为 v=4.0",
  },
  "fixture-namespace-reused": {
    id: "fixture-namespace-reused",
    name: "fixture 档复用注入的 v4 命名空间（existingGlobalV4Provider），且零官方入口 script",
  },
  "map-ready": { id: "map-ready", name: "<BMap> 就绪并拿到 MapHandle、容器里有 SDK DOM" },
  "map-view-round-trip": {
    id: "map-view-round-trip",
    name: "视野读写往返：getCenter/getZoom 与传入的 center/zoom 一致",
  },
  "overlay-marker": { id: "overlay-marker", name: "<BMarker> 挂载后覆盖物计数真的增长" },
  "overlay-polyline": { id: "overlay-polyline", name: "<BPolyline> 挂载后覆盖物计数真的增长" },
  "overlay-rectangle": {
    id: "overlay-rectangle",
    name: "<BRectangle>（v4 新增）挂载后覆盖物计数增长，且 getBounds() 读回的就是传入的对角两点",
  },
  "control-zoom": { id: "control-zoom", name: "基础控件 <BZoom> 真的挂上（账本计数或容器 DOM 增量）" },
  "controls-stable-set": {
    id: "controls-stable-set",
    name: "#41 新增的 Stable 控件（<BNavigation> / <BMapType> / <BOverview>）真的挂上，且改 anchor 后即时下发",
  },
  "panorama-viewer": {
    id: "panorama-viewer",
    name: "<BPanorama> 建出查看器并接受受控写入（只登记在 fixture 档：live 需要真实全景场景）",
  },
  "layer-district": {
    id: "layer-district",
    name: "基础图层 <BDistrictLayer> 真的挂上（账本计数或容器 DOM 增量）",
  },
  "layer-tile": {
    id: "layer-tile",
    name: "瓦片图层 <BTileLayer> 真的挂上（拦截真实 Map.addLayer 的调用，且无 console.error）",
  },
  "layer-traffic": {
    id: "layer-traffic",
    name: "路况图层 <BTrafficLayer> 真的挂上（拦截真实 Map.addLayer 的调用，且无 console.error）",
  },
  "layer-geojson": {
    id: "layer-geojson",
    name: "GeoJSON 图层 <BGeoJSONLayer> 真的挂上、`setData` 被 SDK 接受（拦截真实 Map.addLayer，且无 console.error）",
  },
  "infowindow-visible": {
    id: "infowindow-visible",
    name: "<BInfoWindow>：detached host 被 SDK 搬进自己的容器、内容可见；关闭后地图无当前气泡且宿主不残留（#32 / #72 可见性回归）",
  },
  "infowindow-close-button-pair": {
    id: "infowindow-close-button-pair",
    name: "<BInfoWindow>：点关闭按钮时 `close` 恰好一次、`clickclose` 至少一次，且本库收敛为关（只登记在 live 档——它验的是真实 SDK 的事件与 DOM）",
  },
  "service-geocode": { id: "service-geocode", name: "headless 地理编码拿到真实回包" },
  "ui-kit-autocomplete-search": {
    id: "ui-kit-autocomplete-search",
    name: "BPlaceAutocomplete：ready、检索写入输入框、官方 UI Kit 渲染出输入框、卸载后宿主子树撤走",
  },
  "ui-kit-placesearch-load": {
    id: "ui-kit-placesearch-load",
    name: "BPlaceSearch：ready、检索结算、`load` 事件带回 POI、宿主由 UI Kit 渲染出结果 DOM、卸载后撤走",
  },
  "ui-kit-placedetail-load": {
    id: "ui-kit-placedetail-load",
    name: "BPlaceDetail：用真实检索到的 uid 打开、`load` 事件带回详情、宿主由 UI Kit 渲染、卸载后撤走",
  },
  "ui-kit-routeplan-search": {
    id: "ui-kit-routeplan-search",
    name: "BRoutePlan：驾车检索返回方案、`result` 事件与返回值同源、面板由 UI Kit 渲染、卸载后撤走",
  },
  "second-provider-reuses-sdk": {
    id: "second-provider-reuses-sdk",
    name: "第二个入口复用已就绪的 SDK，不重复注入入口 script",
  },
  "unmount-release": {
    id: "unmount-release",
    name: "卸载后本库资源与监听全部释放、句柄作废，且不改写官方全局",
  },
  "remount-after-unmount": { id: "remount-after-unmount", name: "卸载后重挂载仍然可用" },
  "map-container-gate": {
    id: "map-container-gate",
    name: "容器门禁与精简命令面（#29）：零尺寸（display:none）不建图 → 展开后建图一次，且 get/set/supports/suspend 在真实 SDK 上生效",
  },
};

const fixtureChecks: string[] = [
  "fixture-namespace-reused",
  "map-ready",
  "map-view-round-trip",
  "overlay-marker",
  "overlay-polyline",
  "overlay-rectangle",
  "control-zoom",
  "controls-stable-set",
  "panorama-viewer",
  "layer-district",
  "layer-tile",
  "layer-traffic",
  "layer-geojson",
  "infowindow-visible",
  "unmount-release",
  "remount-after-unmount",
  "map-container-gate",
];

const liveChecks: string[] = [
  "provider-default-delegation",
  "map-ready",
  "map-view-round-trip",
  "overlay-marker",
  "overlay-polyline",
  "overlay-rectangle",
  "control-zoom",
  "controls-stable-set",
  "layer-district",
  "layer-tile",
  "layer-traffic",
  "layer-geojson",
  "infowindow-visible",
  "infowindow-close-button-pair",
  "service-geocode",
  "ui-kit-autocomplete-search",
  "ui-kit-placesearch-load",
  "ui-kit-placedetail-load",
  "ui-kit-routeplan-search",
  "second-provider-reuses-sdk",
  "unmount-release",
  "remount-after-unmount",
  "map-container-gate",
];

/**
 * 分档登记。`checks` 是**本档要跑的**全部检查（顺序即执行顺序），`required` 是其中必须为
 * `pass` 的那些——`required ⊆ checks` 由单测锁定。
 */
export const SMOKE_CHECKS: Record<SmokeMode, { checks: SmokeCheckSpec[]; required: string[] }> = {
  fixture: {
    checks: fixtureChecks.map((id) => SPECS[id]!),
    required: fixtureChecks,
  },
  live: {
    checks: liveChecks.map((id) => SPECS[id]!),
    // `unmount-release` / `remount-after-unmount` 排在服务与 UI Kit 之后：它们会拆掉地图，
    // 放在前面会让后面的检查失去前置。
    required: liveChecks,
  },
};

/**
 * 未归因（跨域脚本）异常白名单。
 *
 * **缺省为空**：跨域来源不构成豁免，任何未归因错误都会让本轮变成 `fail`。要把某条确认为
 * 「上游噪声、与本库无关」，就在这里登记——五个字段缺一不可，过期后自动重新变红。
 */
export const UNATTRIBUTED_WHITELIST: UnattributedWhitelistEntry[] = [];

export function checkSpec(id: string): SmokeCheckSpec | undefined {
  return SPECS[id];
}

export function requiredChecks(mode: SmokeMode): string[] {
  return [...SMOKE_CHECKS[mode].required];
}

/** 全部登记项（含只属于另一档的），文档与一致性校验用。 */
export function allCheckSpecs(): SmokeCheckSpec[] {
  return Object.values(SPECS);
}
