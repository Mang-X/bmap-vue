/**
 * BMarkerCluster 聚合组件验证
 *
 * 从 BMapGL Fake 迁到 Fake v4：簇 marker 仍是普通 Marker（挂在 `map.overlays`），
 * 计数口径从 `stats.overlaysCreated` 换成 `harness.attached('overlay')`，
 * 「监听归零」换成泄漏门禁 `harness.assertIdle()`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMarkerCluster from '../../packages/baidu-map-gl-vue/src/components/data/BMarkerCluster.vue'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

interface Pt { id: string; lng: number; lat: number }

function mountCluster(data: ref<readonly Pt[]>) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BMarkerCluster },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BMarkerCluster, {
              data: data.value,
              'item-key': 'id',
              getPosition: (i: Pt) => ({ lng: i.lng, lat: i.lat }),
              minClusterSize: 3,
              // 显式聚合 zoom:Runtime 在 ready 前已完成 initializeView,
              // 不依赖 map zoom 读取时序,避免 ready 竞态导致聚合结果漂移
              zoom: 8,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, data }
}

const pts: readonly Pt[] = [
  { id: 'a', lng: 116.40, lat: 39.90 },
  { id: 'b', lng: 116.41, lat: 39.91 },
  { id: 'c', lng: 116.42, lat: 39.92 },
  { id: 'd', lng: 121.50, lat: 31.20 },
] as readonly Pt[]

describe('BMarkerCluster v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('clusters nearby points and keeps far point separate', async () => {
    const data = ref<readonly Pt[]>(pts)
    const { wrapper } = mountCluster(data)
    await flushPromises()
    // 北京 3 点聚为 1 个簇 marker + 上海 1 点单独 = 2 个视觉 marker
    expect(harness.attached('overlay')).toBe(2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases all markers and listeners on unmount', async () => {
    const data = ref<readonly Pt[]>(pts)
    const { wrapper } = mountCluster(data)
    await flushPromises()
    expect(harness.attached('overlay')).toBe(2)
    // 原口径是 fake.stats.listeners > 0；v4 的对应实时读数是 leaks.listeners
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    // 原口径是 fake.stats.listeners === 0；v4 用泄漏门禁一次覆盖「监听 + 资源」
    harness.assertIdle('BMarkerCluster 卸载')
  })
})
