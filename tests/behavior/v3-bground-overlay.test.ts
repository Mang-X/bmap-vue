/**
 * BGroundOverlay 迁移验证
 *
 * 从 BMapGL Fake 迁到 Fake v4：GroundOverlay 仍是普通覆盖物（`map.overlays`），但
 * Fake v4 只在构造 `options` 上记录 `opacity` / `url`（实例字段是 setter 的落点，
 * 构造期不预置），读数要跟着换。bounds 仍是实例字段，可直接读。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BGroundOverlay from '../../packages/baidu-map-gl-vue/src/components/overlays/BGroundOverlay.vue'
import { createFakeV4Harness, type FakeV4GroundOverlay } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountOverlay(startPoint = ref({ lng: 116.4, lat: 39.9 })) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BGroundOverlay },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BGroundOverlay, {
              type: 'image',
              url: 'a.png',
              startPoint: startPoint.value,
              endPoint: { lng: 116.5, lat: 40.9 },
              opacity: 0.5,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, startPoint }
}

/** 当前地图上挂着的 GroundOverlay（BMapGL 的 `[...map.overlays][0]` 对应 v4 的数组下标）。 */
function currentGroundOverlay(): FakeV4GroundOverlay {
  return fake.createdMaps[fake.createdMaps.length - 1]!.overlays[0] as FakeV4GroundOverlay
}

describe('BGroundOverlay v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('creates ground overlay with bounds and opacity', async () => {
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(harness.attached('overlay')).toBe(1)
    const go = currentGroundOverlay()
    // 原来是 go.opacity / go.url（BMapGL fake 把构造 option 落到实例字段）；
    // v4 上构造 option 记在 `options` 上，实例字段只由 setOpacity/setImage 写 → 读 options
    expect(go.options.opacity).toBe(0.5)
    expect(go.options.url).toBe('a.png')
    // bounds center = midpoint
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(116.45, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('updates bounds via field-level watch on start/end points', async () => {
    const startPoint = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountOverlay(startPoint)
    await flushPromises()
    const go = currentGroundOverlay()
    startPoint.value = { lng: 100, lat: 30 }
    await nextTick()
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(108.25, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountOverlay()
    await flushPromises()
    // 原口径是 fake.stats.listeners > 0；v4 的对应实时读数是 leaks.listeners
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    // 原口径是 fake.stats.listeners === 0；v4 用泄漏门禁一次覆盖「监听 + 资源」
    harness.assertIdle('BGroundOverlay 卸载')
  })
})
