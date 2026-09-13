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
  baiduCdnProvider,
  type BMapProvider,
  type BMapProps,
} from 'baidu-map-gl-vue'
// v4 Provider 家族从 `./core` 暴露（#17）：默认 cutover（#25）之前不提升到根入口
import {
  baiduJsapiV4Provider,
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
  type UiKitWidgetStatus,
} from 'baidu-map-gl-vue/ui-kit'

const center = shallowRef({ lng: 116.4, lat: 39.9 })

// 类型 smoke
const props: BMapProps = { zoom: 12, center: { lng: 116.4, lat: 39.9 } }
const provider: BMapProvider = baiduCdnProvider()

// 按需导入组件
export const App = {
  components: { BMap, BMarker, BInfoWindow, BCircle, BPolyline },
  setup() {
    return { center, props, provider }
  },
}

// app.use 全量安装
export const plugin = createBMapPlugin({ ak: 'test-ak' })

// 迁移影响回归（PR #58 评审 P1）：三种内置 v4 Provider 必须能直接传给 createBMapPlugin
// ——跨引擎的 AnyBMapProviderLike 契约，不能在类型层被 legacy 专用类型挡住。
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

// exposed API 类型 smoke（#73 评审第 2 项）：公开动作与 `status` 在消费者侧必须直接可用。
//
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
