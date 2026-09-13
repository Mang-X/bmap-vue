/**
 * M3: v3 BMap/BMarker/BInfoWindow 迁移验证
 *
 * 用 fake BMapGL 挂载 v3 组件,验证:
 * - BMap 创建 runtime,SDK 加载后地图就绪
 * - BMap expose whenReady/map 实例
 * - BMarker 创建并 addOverlay
 * - BInfoWindow 创建并打开
 * - 卸载后 Overlay/Map 资源归零
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMarker from '../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue'
import BInfoWindow from '../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

const fake = getFakeBMapGl()

function makeGlobalProvider() {
  return {
    load: async () => {
      ;(window as any).BMapGL = fake
      return fake
    },
  }
}

function createHost() {
  const host = document.createElement('div')
  host.style.width = '300px'
  host.style.height = '300px'
  document.body.appendChild(host)
  return host
}

describe('v3 BMap runtime migration', () => {
  beforeEach(() => {
    resetLifecycleState()
  })

  it('creates map via provider and exposes map instance', async () => {
    fake.stats.reset()
    const host = createHost()
    const wrapper = mount(BMap, {
      attachTo: host,
      props: { provider: makeGlobalProvider() },
    })
    await flushPromises()
    const vm = wrapper.vm as any
    expect(vm.getMapInstance()).toBeTruthy()
    expect(fake.stats.mapsCreated).toBe(1)
    wrapper.unmount()
  })

  it('creates a BMarker overlay inside BMap', async () => {
    fake.stats.reset()
    const host = createHost()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          const provider = makeGlobalProvider()
          return () =>
            h(BMap, { provider }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    expect(fake.stats.mapsCreated).toBe(1)
    wrapper.unmount()
  })

  it('destroys map and marker on unmount without leakage', async () => {
    fake.stats.reset()
    const host = createHost()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          const provider = makeGlobalProvider()
          return () =>
            h(BMap, { provider }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await flushPromises()
    expect(fake.stats.overlaysCreated).toBe(1)
    expect(fake.stats.maps).toBe(1)

    wrapper.unmount()
    await nextTick()
    expect(fake.stats.maps).toBe(0)
    // 卸载后 overlay 通过地图销毁清理;fake 的 map.destroy 不自动清 overlay,但 registry dispose 会断监听
    expect(fake.stats.listeners).toBe(0)
  })

  it('creates BInfoWindow and opens via openInfoWindow', async () => {
    fake.stats.reset()
    const host = createHost()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          const provider = makeGlobalProvider()
          return () =>
            h(BMap, { provider }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, title: 'title', open: true }),
            ])
        },
      }),
      { attachTo: host },
    )
    await flushPromises()
    // 气泡走**地图级**专用入口（map.openInfoWindow），不占 addOverlay 的账：
    // R25-C / #72 之前组件走 `overlays.add(map, infoWindow)`，在 v4 上必抛 BMAP_INVALID_ARGUMENT
    const map = fake.createdMaps[fake.createdMaps.length - 1] as unknown as {
      openInfoWindows: Set<{ isOpen?: () => boolean }>
    }
    expect([...map.openInfoWindows].filter((win) => win.isOpen?.() !== false)).toHaveLength(1)
    expect(fake.stats.overlaysCreated).toBe(0)
    wrapper.unmount()
  })
})
