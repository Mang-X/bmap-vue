/**
 * BPointLayer 批量点层验证
 *
 * 从 BMapGL Fake 迁到 Fake v4：每个 item 一个普通 Marker（挂在 `map.overlays`），
 * 计数口径从 `stats.overlaysCreated/Removed` 换成 `harness.attached('overlay')`
 * 与 `activity.overlaysAttached/overlaysDetached`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPointLayer from '../../packages/baidu-map-gl-vue/src/components/data/BPointLayer.vue'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

interface Pt { id: string; lng: number; lat: number }

function mountLayer(data: ref<readonly Pt[]>) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BPointLayer },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BPointLayer, {
              data: data.value,
              'item-key': 'id',
              getPosition: (i: Pt) => ({ lng: i.lng, lat: i.lat }),
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, data }
}

describe('BPointLayer v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a batch of points without per-point Vue components', async () => {
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
      { id: 'c', lng: 3, lat: 3 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    // 3 个 marker 被加入地图,但仅 1 个 Vue 组件(BPointLayer)
    expect(harness.attached('overlay')).toBe(3)
    wrapper.unmount()
    await nextTick()
  })

  it('diffs to add/remove points on data change', async () => {
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    expect(harness.attached('overlay')).toBe(2)

    data.value = [{ id: 'a', lng: 1, lat: 1 }, { id: 'c', lng: 3, lat: 3 }] as readonly Pt[]
    await nextTick()
    // 累计口径：原有 stats.overlaysCreated/Removed 的对应读数（新增 c、移除 b）
    const { activity } = fake.diagnostics.snapshot()
    expect(activity.overlaysAttached).toBe(3) // added c
    expect(activity.overlaysDetached).toBe(1) // removed b
    expect(harness.attached('overlay')).toBe(2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases all markers on unmount', async () => {
    const data = ref<readonly Pt[]>([
      { id: 'a', lng: 1, lat: 1 },
      { id: 'b', lng: 2, lat: 2 },
    ] as readonly Pt[])
    const { wrapper } = mountLayer(data)
    await flushPromises()
    expect(harness.attached('overlay')).toBe(2)
    wrapper.unmount()
    await nextTick()
    // 移除标记已通过 removeOverlay 释放（原有 listeners 归零的对应读数：泄漏门禁）
    expect(harness.attached('overlay')).toBe(0)
    harness.assertIdle('BPointLayer 卸载')
  })
})
