/**
 * Playground:多场景演示(方案 §15.2 / M7-05)
 *
 * 覆盖 v3 组件全家族。两档模式（见 `./providers`，M3A3-04 / issue #25；#26 收敛为两档）：
 * 配了 `VITE_BMAP_AK` 走默认官方 Loader 的真实 v4；否则默认走 **Fake v4**
 * （`existingGlobalV4Provider()` 复用注入的 Fake v4 全局，组件仍然在 v4 Driver 上）。
 * 原先的 `VITE_BMAP_MODE=legacy-fake` 对照档随旧引擎删除（#26）。
 *
 * 两档都不给 `<BMap>` 传 `provider` —— 解析始终落在 `app.use` 的默认 definition 上，
 * 因此「默认 Provider 安装入口」本身也被 playground 覆盖到。
 */
import { createApp, h, ref, shallowRef, defineComponent, computed } from 'vue'
import {
  BMap,
  BMarker,
  BMarker3d,
  BMarkerCluster,
  BCircle,
  BPolyline,
  BPolygon,
  BRectangle,
  BLabel,
  BInfoWindow,
  BPrism,
  BGroundOverlay,
  BContextMenu,
  BBezierCurve,
  BMapMask,
  BPointLayer,
  BZoom,
  BScale,
  BCityList,
  BLocation,
  BNavigation3d,
  BCopyright,
  BControl,
  BPanoramaControl,
  BDistrictLayer,
  BPanoramaCoverageLayer,
  BAutoComplete,
} from 'baidu-map-gl-vue'
import { bootPlayground, type PlaygroundEnvLike } from '@test-utils'

const viteEnv = ((import.meta as unknown as { env?: PlaygroundEnvLike }).env ?? {}) as PlaygroundEnvLike
const boot = bootPlayground(viteEnv)
const mode = boot.label
const plugin = boot.plugin
const center = { lng: 116.404, lat: 39.915 }
const centerRef = ref(center)

const baseMapProps = (extra: Record<string, unknown> = {}) => ({
  center: centerRef.value,
  zoom: 14,
  style: { width: '100%', height: '440px' },
  ...extra,
})

function demoPoints() {
  return [
    { id: '1', lng: 116.4, lat: 39.91 },
    { id: '2', lng: 116.42, lat: 39.92 },
    { id: '3', lng: 116.44, lat: 39.93 },
    { id: '4', lng: 116.38, lat: 39.94 },
    { id: '5', lng: 116.46, lat: 39.89 },
  ]
}

type SceneDef = {
  id: string
  title: string
  render: () => () => unknown
}

/** 基础场景:Marker + InfoWindow + 形状 */
function basicScene(): () => unknown {
  const open = ref(false)
  return () => h(BMap, baseMapProps(), () => [
    h(BMarker, { position: centerRef.value, onClick: () => (open.value = true) }),
    h(BCircle, { center: centerRef.value, radius: 800, strokeColor: '#ff0000' }),
    h(BPolyline, { path: [{ lng: 116.35, lat: 39.87 }, { lng: 116.5, lat: 39.96 }], strokeColor: '#00ff00' }),
    h(BPolygon, { path: [{ lng: 116.36, lat: 39.88 }, { lng: 116.45, lat: 39.88 }, { lng: 116.42, lat: 39.95 }], fillColor: 'rgba(0,0,255,0.2)' }),
    // M5-VECTORS / #31：v4 新增的矩形（对角两点）
    h(BRectangle, { bounds: { southwest: { lng: 116.3, lat: 39.85 }, northeast: { lng: 116.34, lat: 39.88 } }, strokeColor: '#1677ff' }),
    h(BInfoWindow, { position: centerRef.value, open: open.value, title: '北京' }),
    h(BZoom),
  ])
}

/** 3D + 标注 + 右键菜单 */
function marker3dScene(): () => unknown {
  return () =>
    h(BMap, baseMapProps(), () => [
      h(BMarker3d, { position: centerRef.value, height: 1200, size: 30, fillColor: '#ff6600' }),
      h(BLabel, { content: '3D 标注', position: centerRef.value, offset: { x: 0, y: -30 } }),
      h(BContextMenu, {}, () => [h('div', { style: 'padding:8px' }, '右键菜单内容')]),
      h(BScale),
    ])
}

/** 大数据:点层 + 聚合 */
function bulkScene(): () => unknown {
  const pts = shallowRef(demoPoints())
  return () =>
    h(BMap, baseMapProps(), () => [
      h(BPointLayer, {
        data: pts.value,
        itemKey: 'id',
        getPosition: (p: { lng: number; lat: number }) => ({ lng: p.lng, lat: p.lat }),
      }),
      h(BMarkerCluster, {
        data: pts.value,
        itemKey: 'id',
        getPosition: (p: { lng: number; lat: number }) => ({ lng: p.lng, lat: p.lat }),
      }),
    ])
}

/** Controls 全家族 */
function controlsScene(): () => unknown {
  return () =>
    h(BMap, baseMapProps(), () => [
      h(BZoom),
      h(BScale),
      h(BCityList, { expand: true }),
      h(BLocation),
      h(BNavigation3d),
      h(BCopyright, {}, () => [h('div', { style: 'font-size:12px' }, '© 2026 demo')]),
      h(BPanoramaControl),
      h(BControl, {}, () => [h('button', { style: 'padding:4px 8px' }, '自定义控件')]),
    ])
}

/** Layers */
function layersScene(): () => unknown {
  return () =>
    h(BMap, baseMapProps(), () => [
      h(BDistrictLayer, { name: '北京市', strokeColor: '#ff0000' }),
      h(BPanoramaCoverageLayer),
    ])
}

/** 特殊覆盖物 */
function specialScene(): () => unknown {
  return () =>
    h(BMap, baseMapProps({ tilt: 45, heading: 30 }), () => [
      h(BPrism, { path: [{ lng: 116.38, lat: 39.9 }, { lng: 116.42, lat: 39.9 }, { lng: 116.4, lat: 39.93 }], altitude: 200, topFillColor: '#00ccff' }),
      h(BGroundOverlay, { bounds: { sw: { lng: 116.36, lat: 39.87 }, ne: { lng: 116.44, lat: 39.95 } }, url: 'https://picsum.photos/200' }),
      h(BBezierCurve, {
        path: [{ lng: 116.37, lat: 39.88 }, { lng: 116.47, lat: 39.93 }],
        controlPoints: [[{ lng: 116.41, lat: 39.9 }]],
        strokeColor: '#aa00ff',
      }),
      h(BMapMask, { path: [{ lng: 116.35, lat: 39.86 }, { lng: 116.48, lat: 39.86 }, { lng: 116.46, lat: 39.97 }] }),
    ])
}

/** Autocomplete */
function autocompleteScene(): () => unknown {
  return () =>
    h(BMap, baseMapProps(), () => [
      h(BAutoComplete, { location: '北京市', types: ['city'], onSearchComplete: (e: unknown) => console.log('searchComplete', e) }),
    ])
}

const scenes: SceneDef[] = [
  { id: 'basic', title: '基础', render: basicScene },
  { id: 'marker3d', title: 'Marker3d', render: marker3dScene },
  { id: 'bulk', title: '大数据', render: bulkScene },
  { id: 'controls', title: 'Controls', render: controlsScene },
  { id: 'layers', title: 'Layers', render: layersScene },
  { id: 'special', title: '特殊覆盖物', render: specialScene },
  { id: 'autocomplete', title: '搜索', render: autocompleteScene },
]

const App = defineComponent({
  setup() {
    const active = ref<string>(scenes[0]!.id)
    const current = computed(() => scenes.find((s) => s.id === active.value)!)
    return () => [
      h('div', { style: 'font-family:system-ui;padding:12px;background:#f5f5f5;border-bottom:1px solid #ddd' }, [
        h('h3', { style: 'margin:0 0 8px' }, `baidu-map-gl-vue v3 playground（${mode}）`),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          ...scenes.map((s) =>
            h('button', {
              style: `padding:6px 12px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:${s.id === active.value ? '#1677ff' : '#fff'};color:${s.id === active.value ? '#fff' : '#333'}`,
              onClick: () => (active.value = s.id),
            }, s.title),
          ),
        ]),
      ]),
      // 场景切换时重建(key 强制重挂)
      h('div', { key: current.value.id, style: 'padding:12px' }, [current.value.render()()]),
    ]
  },
})

const app = createApp(App)
app.use(plugin)
app.mount('#app')
