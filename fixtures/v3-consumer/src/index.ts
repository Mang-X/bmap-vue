// v3 tarball 消费 smoke:按需导入 + app.use 全量安装 + 类型解析
import { shallowRef } from 'vue'
import {
  createBMapPlugin,
  BMap,
  BMarker,
  BInfoWindow,
  BCircle,
  BPolyline,
  useBMap,
  Vue3BaiduMapGlResolver,
  type BMapProviderLike,
  type BMapProps,
  type MarkerIconName,
} from 'baidu-map-gl-vue'
// v4 Provider 家族从 `./core` 暴露（#17）。M3A3-REMOVE-LEGACY（#26）之后根入口**不再**导出
// 任何 Provider factory（原先那三个是 legacy 的 `baiduCdnProvider` 家族），这里改成 v4 家族。
import {
  baiduJsapiV4Provider,
  createLoadedJsapiV4,
  existingGlobalV4Provider,
  customScriptV4Provider,
} from 'baidu-map-gl-vue/core'
// UI Kit 子入口（#73）：消费方**不安装** `@baidumap/jsapi-ui-kit` 也必须能拿到类型
// —— 公共声明自持（纯数据 DTO），不引用上游类型包。
import {
  BPlaceAutocomplete,
  BPlaceDetail,
  BPlaceSearch,
  BRoutePlan,
  RoutePlanDrivingPolicy,
  loadUiKit,
  useUiKitWidget,
  UI_KIT_STYLE_PATH,
  type BPlaceAutocompleteProps,
  type BPlaceDetailProps,
  type BPlaceSearchProps,
  type BRoutePlanProps,
  type PlaceDetailDTO,
  type PlaceHighlightChangeDTO,
  type PlacePoiDTO,
  type PlaceSuggestionDTO,
  type RoutePlanResultDTO,
  type UiKitModule,
  type UiKitWidgetStatus,
} from 'baidu-map-gl-vue/ui-kit'

const center = shallowRef({ lng: 116.4, lat: 39.9 })

// 类型 smoke
const props: BMapProps = { zoom: 12, center: { lng: 116.4, lat: 39.9 } }
// Provider 的公共形状是**结构化**的 `BMapProviderLike`（#26 删掉了宽松的
// `AnyBMapProviderLike` / `LooseBMapProviderLike`）。
const provider: BMapProviderLike = baiduJsapiV4Provider()

// 按需导入组件
export const App = {
  components: { BMap, BMarker, BInfoWindow, BCircle, BPolyline },
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
export type { BMapProps }
export const useBMapRef = useBMap

// UI Kit 子入口类型 smoke（#73）：props 类型、事件 DTO 与样式路径都必须可用
const autocompleteProps: BPlaceAutocompleteProps = { location: '北京', citylimit: true }
const searchProps: BPlaceSearchProps = { pageCapacity: 10 }
export const uiKitSmoke = {
  components: [BPlaceAutocomplete, BPlaceSearch],
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
const autocompleteInstance = null as unknown as InstanceType<typeof BPlaceAutocomplete>
const searchInstance = null as unknown as InstanceType<typeof BPlaceSearch>
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
const detailProps: BPlaceDetailProps = { uid: 'poi-uid', display: { comment: false } }
// 驾车策略是自持的常量表（值 + 类型同名，与 TS 枚举同形）：消费者不该写魔法数字。
const routePlanProps: BRoutePlanProps = {
  drivingOptions: { policy: RoutePlanDrivingPolicy.AVOID_CONGESTION, alternatives: 2 },
}
export const uiKitFourComponents = {
  components: [BPlaceAutocomplete, BPlaceSearch, BPlaceDetail, BRoutePlan],
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

// `BRoutePlan` 的公开动作（Promise 面）与 `BPlaceDetail` 的 uid 镜像。
const detailInstance = null as unknown as InstanceType<typeof BPlaceDetail>
const routePlanInstance = null as unknown as InstanceType<typeof BRoutePlan>
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
import { useBMapLocalSearch, useBMapGeocoder, type ServiceResult, type LocalSearchResult } from 'baidu-map-gl-vue'
import type { BMapServiceStatus } from 'baidu-map-gl-vue'

declare const searchHook: ReturnType<typeof useBMapLocalSearch>
declare const geocoderHook: ReturnType<typeof useBMapGeocoder>

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
  useBMapDrivingRoute,
  useBMapRidingRoute,
  useBMapTransitRoute,
  useBMapWalkingRoute,
  type DrivingRouteResult,
  type RidingRouteResult,
  type TransitRouteResult,
  type WalkingRouteResult,
} from 'baidu-map-gl-vue'

declare const drivingRoute: ReturnType<typeof useBMapDrivingRoute>
declare const walkingRoute: ReturnType<typeof useBMapWalkingRoute>
declare const ridingRoute: ReturnType<typeof useBMapRidingRoute>
declare const transitRoute: ReturnType<typeof useBMapTransitRoute>

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

// `<BMap>` 的组件级命令面（M4-HANDLE-UX / #29）在**消费方**这一侧的编译 smoke。
//
// 这段代码只依赖 tarball 的公共类型，证据由 `scripts/verify-package.mts` 与 `v3` CI job 的
// tarball `vue-tsc` 提供（本仓库的 `tests/**` 不在任何 typecheck 门禁里，所以「类型层被拒」
// 这类承诺必须钉在消费方）。它钉住四件事：
//
// ① 组件实例类型与冻结的 `BMapExpose` **互相可赋值**（少一个成员就编译失败）；
// ② `resetCenter` 已从 expose 移除（`@ts-expect-error` 是双向的：留着它就变成「多余指令」而报错）；
// ③ 读命令的返回值不退化成 `any`（同样用 `@ts-expect-error` 反证）；
// ④ 写命令的参数类型没有被放宽（传字符串地名必须编译失败）。
import {
  MAP_SUSPEND_REASONS,
  type BMapExpose,
  type MapCommands,
  type MapReadyContext,
  type MapSuspendReason,
} from 'baidu-map-gl-vue'

// ① 组件实例 → 契约：`defineExpose()` 推导出的实例类型必须覆盖 `BMapExpose` 的每一个成员。
const bmapApi: BMapExpose = null as unknown as InstanceType<typeof BMap>
// ① 反向：`BMapExpose` 的成员在实例上都能取到（漏一个时上面那行就会报错）
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
// @ts-expect-error `resetCenter` 已从 BMapExpose 移除（改用 resetView）
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

// BMarker 的图标名是**封闭**联合，且派生自内置图标表（M5-SPEC-MARKER / #30）：
// 「类型里有、实际渲染不出来」在结构上不可能。下面两条是这条承诺的**门禁** ——
// 本文件由 `scripts/verify-package.mts` 的 `vue-tsc` 编译（CI 会跑），
// 而 `src/**/*.test.ts` 里的类型断言**不在任何门禁的编译范围**里
// （`packages/baidu-map-gl-vue/tsconfig.build.json` 排除了它们），因此类型层承诺必须落在这里。
const markerIconName: MarkerIconName = 'red5'
// @ts-expect-error 不在内置名清单里的字符串必须编译失败
const unknownMarkerIconName: MarkerIconName = 'ghost_icon'
export const markerIconNameSmoke = { markerIconName, unknownMarkerIconName }

// raw 逃生口（`./advanced`）在**产物层**的消费方 smoke（#29 评审补充）。
//
// 此前的「raw 只在 `./advanced`」只在**源码级**被锁（`tests/behavior/v3-entry.test.ts` 的成对断言 +
// `check:public-dts`），没有任何代码消费那个子路径 ⇒ 打包产物里「它还在不在、类型能不能用」没人验。
// 这几行补上：`createHandle` / `unwrapRaw` / `HANDLE_BRAND` 三个名字在 tarball 层必须可用且可类型化。
import { HANDLE_BRAND, createHandle, unwrapRaw } from 'baidu-map-gl-vue/advanced'

const advancedProbe = createHandle('probe', { ok: true })
const advancedProbeRaw: { ok: boolean } = unwrapRaw(advancedProbe)
const advancedProbeBrand: string = advancedProbe[HANDLE_BRAND]
export const advancedSubpathSmoke = { advancedProbeRaw, advancedProbeBrand }
