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
  BPlaceSearch,
  loadUiKit,
  UI_KIT_STYLE_PATH,
  type BPlaceAutocompleteProps,
  type BPlaceSearchProps,
  type PlacePoiDTO,
  type PlaceSuggestionDTO,
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
