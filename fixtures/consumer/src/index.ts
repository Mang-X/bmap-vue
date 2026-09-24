// v3 tarball 消费 smoke:按需导入 + app.use 全量安装 + 类型解析
import { h, shallowRef } from 'vue'
import {
  createBMapPlugin,
  Map,
  Marker,
  InfoWindow,
  Circle,
  Polyline,
  useMap,
  useMapContext,
  Vue3BaiduMapGlResolver,
  type BMapProviderLike,
  type MapProps,
  type MarkerIconName,
} from 'bmap-vue'
// v4 Provider 家族从 `./core` 暴露（#17）。M3A3-REMOVE-LEGACY（#26）之后根入口**不再**导出
// 任何 Provider factory（原先那三个是 legacy 的 `baiduCdnProvider` 家族），这里改成 v4 家族。
import {
  baiduJsapiV4Provider,
  createLoadedJsapiV4,
  existingGlobalV4Provider,
  customScriptV4Provider,
} from 'bmap-vue/core'
// UI Kit 子入口（#73）：消费方**不安装** `@baidumap/jsapi-ui-kit` 也必须能拿到类型
// —— 公共声明自持（纯数据 DTO），不引用上游类型包。
import {
  PlaceAutocomplete,
  PlaceDetail,
  PlaceSearch,
  RoutePlan,
  RoutePlanDrivingPolicy,
  loadUiKit,
  useUiKitWidget,
  UI_KIT_STYLE_PATH,
  type PlaceAutocompleteProps,
  type PlaceDetailProps,
  type PlaceSearchProps,
  type RoutePlanProps,
  type PlaceDetailDTO,
  type PlaceHighlightChangeDTO,
  type PlacePoiDTO,
  type PlaceSuggestionDTO,
  type RoutePlanResultDTO,
  type UiKitModule,
  type UiKitWidgetStatus,
} from 'bmap-vue/ui-kit'

const center = shallowRef({ lng: 116.4, lat: 39.9 })

// 类型 smoke
const props: MapProps = { zoom: 12, center: { lng: 116.4, lat: 39.9 } }
// Provider 的公共形状是**结构化**的 `BMapProviderLike`（#26 删掉了宽松的
// `AnyBMapProviderLike` / `LooseBMapProviderLike`）。
const provider: BMapProviderLike = baiduJsapiV4Provider()

// 按需导入组件
export const App = {
  components: { Map, Marker, InfoWindow, Circle, Polyline },
  setup() {
    return { center, props, provider }
  },
}

// app.use 全量安装
export const plugin = createBMapPlugin({ ak: 'test-ak' })

// 迁移影响回归（PR #58 评审 P1；#26 更新）：三种内置 v4 Provider 必须能直接传给 createBMapPlugin
// ——结构化 `BMapProviderLike` 契约，不能在类型层被别的形状挡住。
export const pluginWithV4Cdn = createBMapPlugin({ provider: baiduJsapiV4Provider() })
export const pluginWithV4Existing = createBMapPlugin({ provider: existingGlobalV4Provider() })
export const pluginWithV4Custom = createBMapPlugin({
  provider: customScriptV4Provider('/offline/getApiScripts.js'),
})

// resolver
export const resolver = Vue3BaiduMapGlResolver()

// composable 类型 smoke
export type { MapProps }
export const useMapRef = useMap
export { useMapContext }

// UI Kit 子入口类型 smoke（#73）：props 类型、事件 DTO 与样式路径都必须可用
const autocompleteProps: PlaceAutocompleteProps = { location: '北京', citylimit: true }
const searchProps: PlaceSearchProps = { pageCapacity: 10 }
export const uiKitSmoke = {
  components: [PlaceAutocomplete, PlaceSearch],
  loader: loadUiKit,
  stylePath: UI_KIT_STYLE_PATH,
  autocompleteProps,
  searchProps,
}
export type { PlacePoiDTO, PlaceSuggestionDTO }

// exposed API 类型 smoke（#73 评审第 2 项）：公开动作与 `status` 在消费者侧必须直接可用。//
// ⚠️ 这条 smoke 的**边界**：`InstanceType<typeof Comp>` 会把 `defineExpose` 的 ref 解包
// （Vue 的公开实例类型本来就这样），所以它**判定不了**「声明里写的是 `Ref` 还是取值」——
// 那条由 `tests/behavior/v3-ui-kit-entry.test.ts` 直接读 `dist/ui-kit.d.ts` 锁定。
const autocompleteInstance = null as unknown as InstanceType<typeof PlaceAutocomplete>
const searchInstance = null as unknown as InstanceType<typeof PlaceSearch>
const searchStatus: UiKitWidgetStatus = searchInstance.status
const autocompleteStatus: UiKitWidgetStatus = autocompleteInstance.status
const searchCall: (keyword: string, option?: { city?: string }) => Promise<void> = searchInstance.search
const paginate: () => Promise<void> = searchInstance.nextPage
const suggestSearch: (keyword: string) => Promise<void> = autocompleteInstance.search
// `highlight` 载荷是变更对（评审第 1 项）
const highlightChange: PlaceHighlightChangeDTO = {
  from: null,
  to: {
    index: 0,
    value: { name: '百度大厦', province: '', city: '', district: '', business: '', address: '' },
  },
}
export const exposedApiSmoke = {
  searchStatus,
  autocompleteStatus,
  searchCall,
  paginate,
  suggestSearch,
  highlightChange,
}

// 四个标准 UI 都要能被消费方按需导入（#75 补齐详情 / 路线）。
const detailProps: PlaceDetailProps = { uid: 'poi-uid', display: { comment: false } }
// 驾车策略是自持的常量表（值 + 类型同名，与 TS 枚举同形）：消费者不该写魔法数字。
const routePlanProps: RoutePlanProps = {
  drivingOptions: { policy: RoutePlanDrivingPolicy.AVOID_CONGESTION, alternatives: 2 },
}
export const uiKitFourComponents = {
  components: [PlaceAutocomplete, PlaceSearch, PlaceDetail, RoutePlan],
  detailProps,
  routePlanProps,
  drivingPolicy: RoutePlanDrivingPolicy.AVOID_CONGESTION,
}

// 详情 / 路线的事件载荷同样是纯数据 DTO（不引用上游类型包）。
const detailPayload: PlaceDetailDTO = {
  title: '百度大厦',
  address: '上地十街 10 号',
  point: { lng: 116.307, lat: 40.056 },
}
const routeResult: RoutePlanResultDTO = {
  type: 'driving',
  start: { title: '起点', location: { lng: 116.404, lat: 39.915 } },
  end: { title: '终点', location: { lng: 116.305, lat: 39.982 } },
  plans: [
    {
      distance: 1234,
      distanceText: '1.2公里',
      duration: 300,
      durationText: '5分钟',
      segments: [
        {
          type: 'drive',
          distance: 1234,
          distanceText: '1.2公里',
          description: '沿上地十街行驶',
          location: { lng: 116.404, lat: 39.915 },
        },
      ],
    },
  ],
}
export const detailRoutePayloadSmoke = { detailPayload, routeResult }

// `RoutePlan` 的公开动作（Promise 面）与 `PlaceDetail` 的 uid 镜像。
const detailInstance = null as unknown as InstanceType<typeof PlaceDetail>
const routePlanInstance = null as unknown as InstanceType<typeof RoutePlan>
const setPlaceCall: (uidOrPoi: string | object) => Promise<void> = detailInstance.setPlace
const routeSearch: (options: {
  start: { lng: number; lat: number } | string
  end: { lng: number; lat: number } | string
}) => Promise<RoutePlanResultDTO> = routePlanInstance.search
export const detailRouteApiSmoke = { setPlaceCall, routeSearch }

// 公共 API 兼容性 smoke（PR #82 评审 P1）：`useUiKitWidget` 与 `UiKitModule` 从 #73 起就是公开导出，
// 所以「老写法必须仍然能编译」要在**真实消费方**这一侧也钉一遍（`v3` CI job 用 tarball 跑 vue-tsc）。
// 1) 老调用不传 `constructorOptions`（它必须是可选的，且缺省时不改变已有语义）；

const legacyHost = shallowRef<HTMLElement | null>(null)
export const legacyBridgeUsage = useUiKitWidget({
  component: 'LegacyConsumer',
  host: legacyHost,
  buildOptions: () => ({ pageCapacity: 10 }),
  create: (_module, _host, _options) => ({ on() {}, off() {}, destroy() {} }),
})

// 2) `loadUiKit()` 的返回值仍可按名字索引（索引签名是公开逃生口）。
declare const uiKitModule: UiKitModule
declare const upstreamExportName: string
export const escapeHatch: unknown = uiKitModule[upstreamExportName]

// 文档里那段「自研加载器怎么写 Provider」（`docs/zh-CN/guide/config.md`）的**可执行对照**：
// 消费方只有 tarball + vue，也必须能原样编译。文档给一段抄不起来的片断，就等于写了一条
// 跑不起来的命令——所以这里逐字对齐那段示例（含 `createLoadedJsapiV4` 与全局命名空间的字符串键写法）。
// 证据由 `scripts/verify-package.mts` 与本仓库 `v3` CI job 的 tarball `vue-tsc` 提供。
export const customProviderSmoke: BMapProviderLike = {
  id: 'my-loader',
  getCacheKey: () => 'my-loader',
  load: async () =>
    createLoadedJsapiV4({
      providerId: 'custom-script-v4',
      mode: 'load',
      version: '4.0',
      versionSource: 'declared',
      options: { ak: 'YOUR_AK' },
      fingerprint: 'my-loader',
      // 你的加载器把命名空间放在哪就读哪；这里用「字符串键」写法，
      // 因此**不依赖**官方类型包对全局 `BMap` 的声明
      namespace: (globalThis as { BMap?: unknown }).BMap,
    }),
}


// 服务类 composable 的**消费方编译 smoke**（#38）：这段代码只依赖 tarball 的公共类型，
// 用来钉住「动作恒 resolve 成 `ServiceResult`」与「状态是只读 shallow ref」这两条公开契约。
// 证据由本仓库 `v3` CI job 的 tarball `vue-tsc` 提供（`scripts/verify-package.mts`）。
import { useLocalSearch, useGeocoder, type ServiceResult, type LocalSearchResult } from 'bmap-vue'
import type { BMapServiceStatus } from 'bmap-vue'

declare const searchHook: ReturnType<typeof useLocalSearch>
declare const geocoderHook: ReturnType<typeof useGeocoder>

const searchOnce: Promise<ServiceResult<LocalSearchResult[]>> = searchHook.search('餐厅')
const searchNearbyOnce: Promise<ServiceResult<LocalSearchResult[]>> = searchHook.searchNearby(
  '银行',
  { lng: 116.404, lat: 39.915 },
  2000,
)
const searchInBoundsOnce: Promise<ServiceResult<LocalSearchResult[]>> = searchHook.searchInBounds('超市', {
  southwest: { lng: 116.2, lat: 39.8 },
  northeast: { lng: 116.6, lat: 40 },
})
const gotoPageOnce: Promise<ServiceResult<LocalSearchResult[]>> = searchHook.gotoPage(1)
const clearOnce: void = searchHook.clear()
const taskStatus: BMapServiceStatus = searchHook.status.value
const taskSupported: boolean = searchHook.supported.value
const geocodeOnce: ReturnType<typeof geocoderHook.get> = geocoderHook.get('北京市', '北京市')

export const serviceComposableSmoke = {
  searchOnce,
  searchNearbyOnce,
  searchInBoundsOnce,
  gotoPageOnce,
  clearOnce,
  taskStatus,
  taskSupported,
  geocodeOnce,
}

// 路线服务（M7-ROUTES / #39）的消费方编译 smoke：与上一段同样的目的——这段代码只依赖 tarball 的
// 公共类型，证据由 `scripts/verify-package.mts` 里的 `vue-tsc --noEmit` 提供。这里额外钉住三件事：
// ① 驾车端点**不接受字符串**（官方签名里没有 `string`）；② 结果**不退化成 `any`**；
// ③ 公交的分段是判别联合（`kind` 收窄能真的收窄 `leg` / `title`）。
import {
  DrivingPolicy,
  IntercityPolicy,
  TransitPolicy,
  TransitVehiclePolicy,
  useDrivingRoute,
  useRidingRoute,
  useTransitRoute,
  useWalkingRoute,
  type DrivingRouteResult,
  type RidingRouteResult,
  type TransitRouteResult,
  type WalkingRouteResult,
} from 'bmap-vue'

declare const drivingRoute: ReturnType<typeof useDrivingRoute>
declare const walkingRoute: ReturnType<typeof useWalkingRoute>
declare const ridingRoute: ReturnType<typeof useRidingRoute>
declare const transitRoute: ReturnType<typeof useTransitRoute>

const driveOnce: Promise<ServiceResult<DrivingRouteResult>> = drivingRoute.search(
  { lng: 116.391, lat: 39.91 },
  // POI 引用端点：uid 定位、point 兜底、name 作标题
  { uid: 'poi-1', point: { lng: 116.431, lat: 39.931 }, name: '终点' },
  { waypoints: [{ lng: 116.41, lat: 39.92 }] },
)
const walkOnce: Promise<ServiceResult<WalkingRouteResult>> = walkingRoute.search('天安门', '王府井')
const rideOnce: Promise<ServiceResult<RidingRouteResult>> = ridingRoute.search('北京大学', '清华大学')
const transitOnce: Promise<ServiceResult<TransitRouteResult>> = transitRoute.search('天安门', '北京西站')

// ② 结果不是 `any`：`description` 是 `string | null`，当 number 用必须编译失败。
// @ts-expect-error 路线结果不退化为 any
const notAny: number = drivingRoute.data.value?.plans[0]?.legs[0]?.steps[0]?.description

// ③ 公交分段是判别联合：`kind === 'line'` 之后才有 `title`，`'walk'` 之后才有 `leg`。
const firstSegment = transitRoute.data.value?.plans[0]?.segments[0]
const segmentKind: 'line' | 'walk' | undefined = firstSegment?.kind
const lineTitle: string | undefined = firstSegment?.kind === 'line' ? firstSegment.title : undefined
const walkLegPath: number | undefined =
  firstSegment?.kind === 'walk' ? firstSegment.leg.path.length : undefined

// ① 驾车端点不接受字符串地名（官方 `DrivingRoute#search` 的签名里没有 `string`）。
// @ts-expect-error 驾车端点只接受 Point 或 POI 引用
const driveByKeyword: ReturnType<typeof drivingRoute.search> = drivingRoute.search('天安门', '王府井')

const routePolicies: number[] = [
  DrivingPolicy.AVOID_CONGESTION,
  TransitPolicy.LEAST_TIME,
  IntercityPolicy.CHEAP_PRICE,
  TransitVehiclePolicy.TRAIN,
]

export const routeComposableSmoke = {
  driveOnce,
  walkOnce,
  rideOnce,
  transitOnce,
  notAny,
  segmentKind,
  lineTitle,
  walkLegPath,
  driveByKeyword,
  routePolicies,
}

// `<Map>` 的组件级命令面（M4-HANDLE-UX / #29）在**消费方**这一侧的编译 smoke。
//
// 这段代码只依赖 tarball 的公共类型，证据由 `scripts/verify-package.mts` 与 `v3` CI job 的
// tarball `vue-tsc` 提供（本仓库的 `tests/**` 不在任何 typecheck 门禁里，所以「类型层被拒」
// 这类承诺必须钉在消费方）。它钉住四件事：
//
// ① 组件实例类型与冻结的 `MapExpose` **互相可赋值**（少一个成员就编译失败）；
// ② `resetCenter` 已从 expose 移除（`@ts-expect-error` 是双向的：留着它就变成「多余指令」而报错）；
// ③ 读命令的返回值不退化成 `any`（同样用 `@ts-expect-error` 反证）；
// ④ 写命令的参数类型没有被放宽（传字符串地名必须编译失败）。
import {
  MAP_SUSPEND_REASONS,
  type MapExpose,
  type MapCommands,
  type MapReadyContext,
  type MapSuspendReason,
} from 'bmap-vue'

// ① 组件实例 → 契约：`defineExpose()` 推导出的实例类型必须覆盖 `MapExpose` 的每一个成员。
const bmapApi: MapExpose = null as unknown as InstanceType<typeof Map>
// ① 反向：`MapExpose` 的成员在实例上都能取到（漏一个时上面那行就会报错）
const commandSurface: MapCommands = bmapApi
export const mapExposeSmoke = { bmapApi, commandSurface }

const centerOrNull: { lng: number; lat: number } | null = bmapApi.getCenter()
const zoomOrNull: number | null = bmapApi.getZoom()
const boundsOrNull: ReturnType<typeof bmapApi.getBounds> = bmapApi.getBounds()
const sizeOrNull: ReturnType<typeof bmapApi.getSize> = bmapApi.getSize()
const supported: boolean = bmapApi.supports('map.zoom')
const containerReady: boolean = bmapApi.isContainerReady()
const suspended: boolean = bmapApi.isSuspended()
const reasons: readonly string[] = bmapApi.suspendReasons()
const reducedMotion: boolean = bmapApi.prefersReducedMotion()
bmapApi.setCenter({ lng: 116.404, lat: 39.915 })
bmapApi.setZoom(14)
bmapApi.setHeading(30)
bmapApi.setTilt(20)
bmapApi.panTo({ lng: 116.404, lat: 39.915 })
bmapApi.panBy({ x: 0, y: -100 })
bmapApi.fitBounds({ southwest: { lng: 116, lat: 39 }, northeast: { lng: 117, lat: 40 } })
bmapApi.checkResize()
bmapApi.resetView()
bmapApi.setDragging(false)
const offscreen: MapSuspendReason = MAP_SUSPEND_REASONS.offscreen
bmapApi.suspend(offscreen)
bmapApi.resume(MAP_SUSPEND_REASONS.offscreen)
const readyOnce: Promise<MapReadyContext> = bmapApi.whenReady()
const retriedOnce: Promise<MapReadyContext> = bmapApi.retry()
const mapOrNull: ReturnType<typeof bmapApi.getMapInstance> = bmapApi.getMapInstance()

// ③ 读命令不退化成 `any`：把结果当字符串用必须编译失败。
// @ts-expect-error `getCenter()` 是 `Point | null`，不是 any
const badCenter: string = bmapApi.getCenter()
// ③ 能力查询也不是 any。
// @ts-expect-error `supports()` 返回 boolean
const badCapability: string = bmapApi.supports('map.zoom')
// ④ 写命令的参数类型没有被放宽：字符串地名不是 `Point`（字符串兼容只在 props 上）。
// @ts-expect-error `setCenter` 只接受点对象
bmapApi.setCenter('北京市')
// ② 废弃别名已移除。若 `resetCenter` 重新出现，下面这条指令会变成「未使用的 @ts-expect-error」。
// @ts-expect-error `resetCenter` 已从 MapExpose 移除（改用 resetView）
bmapApi.resetCenter()

export const mapExposeApiSmoke = {
  centerOrNull,
  zoomOrNull,
  boundsOrNull,
  sizeOrNull,
  supported,
  containerReady,
  suspended,
  reasons,
  reducedMotion,
  offscreen,
  readyOnce,
  retriedOnce,
  mapOrNull,
  badCenter,
  badCapability,
}

// `./composables` 子入口的消费方 smoke（外部评审 P1）。
//
// `MarkerIconName` **原先定义在 `composables/useMarkerIcons.ts` 里**，而 `composables/index.ts`
// 是 `export *` ⇒ 它一直是这个子入口的既有公共 API。把定义收进 `types/components` 之后如果忘了
// 在这里 re-export，`import type { MarkerIconName } from 'bmap-vue/composables'` 会直接
// 编译失败——而当时的 smoke 只 import 根入口，刚好覆盖不到这个回归。这条补上：
// 既验证名字在（类型 + 值导出），也验证「未知名字编译失败」。
import { useMarkerIcons, useControllableState } from 'bmap-vue/composables'
import type { MarkerIconName as ComposableMarkerIconName } from 'bmap-vue/composables'

const composablesMarkerIconName: ComposableMarkerIconName = 'simple_blue'
// @ts-expect-error 不在内置名清单里的字符串必须编译失败
const unknownComposablesMarkerIconName: ComposableMarkerIconName = 'ghost_icon'
export const composablesSubpathSmoke = {
  useMarkerIcons,
  useControllableState,
  composablesMarkerIconName,
  unknownComposablesMarkerIconName,
}

// Marker 的图标名是**封闭**联合，且派生自内置图标表（M5-SPEC-MARKER / #30）：
// 「类型里有、实际渲染不出来」在结构上不可能。下面两条是这条承诺的**门禁** ——
// 本文件由 `scripts/verify-package.mts` 的 `vue-tsc` 编译（CI 会跑），
// 而 `src/**/*.test.ts` 里的类型断言**不在任何门禁的编译范围**里
// （`packages/bmap-vue/tsconfig.build.json` 排除了它们），因此类型层承诺必须落在这里。
const markerIconName: MarkerIconName = 'red5'
// @ts-expect-error 不在内置名清单里的字符串必须编译失败
const unknownMarkerIconName: MarkerIconName = 'ghost_icon'
export const markerIconNameSmoke = { markerIconName, unknownMarkerIconName }

// raw 逃生口（`./advanced`）在**产物层**的消费方 smoke（#29 评审补充）。
//
// 此前的「raw 只在 `./advanced`」只在**源码级**被锁（`tests/behavior/v3-entry.test.ts` 的成对断言 +
// `check:public-dts`），没有任何代码消费那个子路径 ⇒ 打包产物里「它还在不在、类型能不能用」没人验。
// 这几行补上：`createHandle` / `unwrapRaw` / `HANDLE_BRAND` 三个名字在 tarball 层必须可用且可类型化。
import { HANDLE_BRAND, createHandle, unwrapRaw } from 'bmap-vue/advanced'

const advancedProbe = createHandle('probe', { ok: true })
const advancedProbeRaw: { ok: boolean } = unwrapRaw(advancedProbe)
const advancedProbeBrand: string = advancedProbe[HANDLE_BRAND]
export const advancedSubpathSmoke = { advancedProbeRaw, advancedProbeBrand }

/* ==================== 覆盖物统一 spec / 事件矩阵 / 集中弃用层（M5-VECTORS / #31） ====================
 *
 * 这一段的每条断言都对应 #31 的一条公开承诺，而且都必须落在**消费方**上下文里：
 * 本文件由 `scripts/verify-package.mts` 的 `vue-tsc` 对着 tarball 编译（CI 跑），
 * 而组件库源码里的测试文件与仓库根 tests 目录都不在任何 typecheck 门禁的编译范围内
 * （`packages/bmap-vue/tsconfig.build.json` 排除了前者，后者从来没被编译过）。
 */
import {
  Rectangle,
  Polygon,
  GroundOverlay,
  OVERLAY_EVENT_MATRIX,
  OVERLAY_PROP_ALIASES,
  DEPRECATED_PROP_ALIAS_CODE,
  describeDeprecation,
  overlayEventOf,
  overlayEventsOf,
  propAliasesOf,
  type GroundOverlayProps,
  type PolygonProps,
  type RectangleProps,
  type OverlayEventPayload,
  type OverlayFieldMap,
  type OverlayFieldWatch,
  type OverlayKind,
  type OverlayPartialPointerEvent,
  type OverlayPointerEvent,
} from 'bmap-vue'

// 1) 新组件 Rectangle 的 props（对角两点定义）
const rectangleProps: RectangleProps = {
  bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
  strokeStyle: 'dashed',
  enableEditing: true,
}
// @ts-expect-error strokeStyle 只接受 solid / dashed / dotted
const invalidRectangleProps: RectangleProps = { ...rectangleProps, strokeStyle: 'wavy' }

// 2) 旧 prop 别名仍然可编译（弃用但未移除）：`startPoint` + `endPoint` 与正典 `bounds` 二选一
const legacyGroundOverlayProps: GroundOverlayProps = {
  type: 'image',
  url: 'a.png',
  startPoint: { lng: 116.3, lat: 39.8 },
  endPoint: { lng: 116.5, lat: 40 },
}
const canonicalGroundOverlayProps: GroundOverlayProps = {
  type: 'canvas',
  url: () => document.createElement('canvas'),
  bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
}

// 3) 事件载荷的三档在消费方侧可见：
//    - `click`（pointer）：`point` 必填；
//    - `mouseout`（图形族 partial-pointer）：`point` 可缺——上游 `GraphMouseOutEvent` 就是这么声明的，
//      本库**不**用 `(0,0)` 兜底，因此调用方必须自己判空。
const polygonClick = h(Polygon, {
  path: [{ lng: 116.4, lat: 39.9 }],
  onClick: (event: OverlayPointerEvent) => {
    const lng: number = event.point.lng
    void lng
  },
})
const polygonMouseout = h(Polygon, {
  path: [{ lng: 116.4, lat: 39.9 }],
  onMouseout: (event: OverlayPartialPointerEvent) => {
    const lng: number | undefined = event.point?.lng
    void lng
  },
})
const groundOverlayClick = h(GroundOverlay, {
  ...canonicalGroundOverlayProps,
  onClick: (event: OverlayEventPayload) => void event.type,
})

// 4) 事件矩阵与弃用表是公开的读数面（自定义覆盖物与工具链要用）
const polygonEventNames: string[] = overlayEventsOf('polygon').map((event) => event.sdk)
const polygonMouseoutPayload: string | undefined = overlayEventOf('polygon', 'mouseout')?.payload
const rectangleUpstream: string = OVERLAY_EVENT_MATRIX.rectangle.upstream
const overlayKinds: OverlayKind[] = ['marker', 'label', 'polyline', 'polygon', 'rectangle', 'circle']
const propAliases = propAliasesOf('ground-overlay')
const propAliasNotice = describeDeprecation(OVERLAY_PROP_ALIASES[0]!)
const propAliasNoticeText: string = propAliasNotice.message
const propAliasNoticeCode: string = propAliasNotice.code
const deprecatedCode: string = DEPRECATED_PROP_ALIAS_CODE

// 5) 字段策略与 watch 源是公开类型（自定义覆盖物的声明面）
const customPolygonFields: OverlayFieldMap<PolygonProps> = {
  path: 'options',
  pathVersion: 'version',
  isBoundary: 'recreate',
  strokeColor: 'options',
  strokeWeight: 'options',
  strokeOpacity: 'options',
  strokeStyle: 'options',
  fillColor: 'options',
  fillOpacity: 'options',
  enableMassClear: 'options',
  enableEditing: 'options',
  visible: 'visibility',
}
const customWatchSource: OverlayFieldWatch = { source: 'versioned', versionProp: 'pathVersion' }

export const overlaySpecSmoke = {
  rectangleProps,
  invalidRectangleProps,
  legacyGroundOverlayProps,
  canonicalGroundOverlayProps,
  polygonClick,
  polygonMouseout,
  groundOverlayClick,
  polygonEventNames,
  polygonMouseoutPayload,
  rectangleUpstream,
  overlayKinds,
  propAliases,
  propAliasNoticeText,
  propAliasNoticeCode,
  deprecatedCode,
  customPolygonFields,
  customWatchSource,
  rectangleComponent: Rectangle,
}

// 数据组件（M6 / #34）的**消费方编译 smoke**。
//
// 分工说明（实测过一次，值得写下来）：泛型在**模板**里完整保留，但在 `h()` 编程式构造里
// **推不出** `Item` —— vue-tsc 为泛型 SFC 生成的 props 是
// `NonNullable<Awaited<typeof __VLS_setup>>["props"]`，TS 无法从这种形状反推类型参数
// （带/不带 `withDefaults` 都一样，已实测）。所以：
//
// - **推断**（`Item` 不退化成 `unknown` / `any`）由 `src/data-components.vue` 的模板用法钉住；
// - **公开 props 类型本身**在这里钉住（可具名使用 + 约束真的在起作用）。
import {
  MarkerList,
  type MarkerListProps,
  type PointIconLayerProps,
  type PointLayerProps,
  type PointCollectionProps,
} from 'bmap-vue'

interface Station {
  id: string
  lng: number
  lat: number
  name?: string
}

const stations: Station[] = [
  { id: 'a', lng: 116.404, lat: 39.915, name: '百度大厦' },
  { id: 'b', lng: 116.41, lat: 39.92 },
]

// 泛型 props 类型可直接具名使用，且 `Item` 参与约束（不是 `any`）。
const listProps: MarkerListProps<Station> = {
  data: stations,
  itemKey: 'id',
  getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
}
const badListProps: MarkerListProps<Station> = {
  // @ts-expect-error `Item` 是 Station：缺 id / 坐标的项不能被接受
  data: [{ name: '缺字段' }],
  itemKey: 'id',
  getPosition: () => null,
}
// @ts-expect-error `itemKey` 必须是 `Item` 的键（`'nope'` 不存在）
const badItemKey: MarkerListProps<Station> = { ...listProps, itemKey: 'nope' }

// `PointCollection` 的样式面只到「官方真的支持的那几个字段」，取值也是官方的枚举数字。
const collectionProps: PointCollectionProps<Station> = {
  data: stations,
  itemKey: 'id',
  getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
  shape: 7,
}
// @ts-expect-error `shape` 是官方 `PointShapeLayer.ShapeType` 的数字取值
const badShape: PointCollectionProps<Station> = { ...collectionProps, shape: 'circle' }

// 图标层：样式字段名与形状层**不同**（官方 `PointIconStyle`），`isFlat` / `isFixed` 是构造期项。
const iconProps: PointIconLayerProps<Station> = {
  data: stations,
  itemKey: 'id',
  getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
  icon: 'https://example.com/pin.png',
  width: 32,
  height: 32,
  isFlat: true,
}
// @ts-expect-error 图标层的样式里没有 `shape`（那是形状层的字段）
const badIcon: PointIconLayerProps<Station> = { ...iconProps, shape: 0 }

// 扩展 API 点层：选项是**扁平**的（`fillColor` 而不是 `color`）。
const extensionPointProps: PointLayerProps<Station> = {
  data: stations,
  itemKey: 'id',
  getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
  shape: 'circle',
  size: 18,
  fillColor: '#1677ff',
}
// @ts-expect-error 扁平选项里没有 `style` 袋（那是形状层 / 图标层的写法）
const badFlat: PointLayerProps<Station> = { ...extensionPointProps, style: { size: 18 } }

export const dataComponentPropsSmoke = {
  listProps,
  badListProps,
  badItemKey,
  collectionProps,
  badShape,
  iconProps,
  badIcon,
  extensionPointProps,
  badFlat,
}

// `h()` 编程式构造**推不出** `Item` —— 这条限制用双向断言钉住，而不是写在文档里。
//
// 依据（2026-09-18 实测）：vue-tsc 为泛型 SFC 生成的 props 是
// `NonNullable<Awaited<typeof __VLS_setup>>["props"]`，TS 无法从这种形状反推类型参数
// （带 / 不带 `withDefaults` 都一样）。于是 `h()` 调用里 `itemKey` 会落成
// `(item: unknown) => PropertyKey`，传字符串属性名直接编译失败。
//
// 模板用法**不受影响**（见 `src/data-components.vue`）。如果哪天上游修好了推断，下面这条指令会变成
// 「未使用的 @ts-expect-error」而报错 —— 那时请更新这条断言与 `docs/zh-CN/components/data.md`。
//
// ⚠️ 写法上踩过两次，都记在这里：
// 1. 指令必须贴在**实际报错的那一行**。vue-tsc 把 overload 不匹配报在某个属性上（实测是最后一个
//    与签名冲突的属性），所以把 props 先收成一个变量、让 `h(...)` 调用成为唯一的报错行，
//    断言才不会随属性顺序漂移；
// 2. 早期版本的 `MarkerList` **忘了导入**，于是指令吞掉的是 `Cannot find name` 而不是「推不出
//    `Item`」—— 断言看起来通过、实际是空的。现在导入齐了，去掉指令会得到这样的报错原文：
//    `TS2769: No overload matches this call … Types of property 'itemKey' are incompatible`
//    （展开里能看到它期望的 `itemKey: (item: unknown) => PropertyKey`）。
const programmaticProps = {
  data: stations,
  itemKey: 'id',
  getPosition: (item: { lng: number; lat: number }) => ({ lng: item.lng, lat: item.lat }),
}
// @ts-expect-error `h()` 推不出 `Item`（模板用法可以；需要显式类型时用 MarkerListProps<Station>）
export const programmaticGenericLimit = h(MarkerList, programmaticProps)

// ---------------------------------------------------------------------------
// M5-CUSTOM-MENU / #33：`<CustomOverlay>` 与声明式菜单的**公共类型面**（消费方视角）
//
// 这一节是「新公开面能不能被消费者正确消费」的真门禁（`verify:package` 里的 vue-tsc 跑它）：
// 测试文件里的类型断言不在任何 typecheck 门禁的编译范围里，放在这里才有落点。
// ---------------------------------------------------------------------------
import {
  CustomOverlay,
  ContextMenu,
  MenuItem,
  MenuSeparator,
  type CustomOverlayProps,
  type ContextMenuProps,
  type MenuItemProps,
  type ContextMenuItem,
  type ContextMenuSeparator,
  type ContextMenuSelectPayload,
  type MapHandle,
} from 'bmap-vue'

const overlayProps: CustomOverlayProps = {
  position: { lng: 116.404, lat: 39.915 },
  offset: { x: 0, y: -12 },
  anchor: { x: 0.5, y: 1 },
  rotation: 30,
  zIndex: 3,
  properties: { id: 'store-1' },
  visible: true,
  enableMassClear: true,
}
// @ts-expect-error `position` 是必填：DOM 覆盖物没有位置就没有可解释的语义
const badOverlayProps: CustomOverlayProps = { rotation: 30 }
export const customOverlayPropsSmoke = { overlayProps, badOverlayProps }

// 数据 API 的条目：`"-"` 是分隔线（`ContextMenuSeparator`），两者可以混在一个数组里
const menuItems: (ContextMenuItem | ContextMenuSeparator)[] = [
  {
    text: '标记此处',
    callback: ({ item, index, point, pixel, map, target }: ContextMenuSelectPayload) => {
      // 载荷字段逐个消费一次：字段改名 / 变可选都会在这里报错
      void item.text
      void index
      void point?.lng
      void pixel?.x
      const zoomable = map as MapHandle & { raw: { zoomIn(): void } }
      void zoomable
      void target
    },
    disabled: false,
    width: 120,
    id: 'mark-here',
  },
  '-',
]
const menuProps: ContextMenuProps = { items: menuItems, width: 160, visible: true }
// @ts-expect-error 旧的 `menuItems` 名字**仍可编译**，但类型上必须同时给出 `items` 的形状约束
const badMenuProps: ContextMenuProps = { items: [{ text: 'x', callback: 42 }] }
export const contextMenuPropsSmoke = { menuProps, badMenuProps }

const menuItemProps: MenuItemProps = { text: '删除', disabled: true, width: 120, id: 'del' }
// @ts-expect-error `text` 是必填
const badMenuItemProps: MenuItemProps = { disabled: true }
export const menuItemPropsSmoke = { menuItemProps, badMenuItemProps }

// 四个新组件都在根入口（`CustomOverlay` / `ContextMenu` 已存在，`MenuItem` / `MenuSeparator` 是新增）
export const menuComponentSmoke = [CustomOverlay, ContextMenu, MenuItem, MenuSeparator].length

// ---------------------------------------------------------------------------
// #109 MVTLayer：公开契约锁（PR #133 评审 P1/P2）
//
// `@ts-expect-error` 是**双向**的：类型一旦被放宽，下面这些会变成「未使用的指令」而报错。
// 由 `verify:package` 的 `vue-tsc --noEmit` 对 tarball 产物跑（public-dts 契约面）。
// ---------------------------------------------------------------------------
import type {
  FeatureStateApi,
  MVTLayerProps,
  MVTLayerEntity,
  MVTLayerMouseEvent,
  MVTLayerMouseMoveEvent,
  MVTLayerPickEvent,
} from 'bmap-vue'
import { MVTLayer, mvtFeatureStateKey } from 'bmap-vue'

// P1：MVT feature-state 键域 = string-only（`keyDomain: "string"` ⇒ `FeatureStateApi<"string">`）
declare const mvtState: FeatureStateApi<'string'>
mvtState.update(mvtFeatureStateKey('lines', 42), { selected: true })
// @ts-expect-error MVT 键必须是 string 复合键（`layerName_id`），number 必须编译失败
mvtState.update(1, { selected: true })
// @ts-expect-error number[] 同样必须编译失败
mvtState.remove([1, 2])

// 默认键域（#36 NativeLayer）仍是 `string | number`——不能顺手收窄
declare const nativeState: FeatureStateApi
nativeState.update(1, { selected: true })

// P2a：mousemove.value 官方**必有** `Entity[]`（不能 alias 到 PickEvent 的可选）
declare const mvtMove: MVTLayerMouseMoveEvent
const mvtMoveValue: MVTLayerEntity[] = mvtMove.value
// @ts-expect-error MouseMove 的 value 是必填：缺 value 的对象不能赋给它
const badMvtMove: MVTLayerMouseMoveEvent = { type: 'mousemove' }

// P2b：Pick 的 value **可选**（未命中时 SDK 可能不带）
declare const mvtPick: MVTLayerPickEvent
const mvtPickValue: MVTLayerEntity[] | undefined = mvtPick.value

// P2c：mouseout 载荷 = MouseEvent（pixel / latLng），不是 BaseEvent 也不是 PickEvent
const onMvtOut: NonNullable<MVTLayerProps['onmouseout']> = (e) => {
  void e.pixel?.x
  void e.latLng?.lng
}
declare const mvtOut: MVTLayerMouseEvent
void mvtOut.pixel?.x

export const mvtContractSmoke = {
  mvtState,
  nativeState,
  mvtMoveValue,
  badMvtMove,
  mvtPickValue,
  onMvtOut,
  MVTLayer,
}
