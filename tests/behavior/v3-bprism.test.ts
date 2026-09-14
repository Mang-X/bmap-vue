/**
 * BPrism 迁移验证
 *
 * 从 BMapGL Fake 迁到 Fake v4：Prism 仍是普通覆盖物（`map.overlays`），因此计数口径
 * 基本不变；但 Fake v4 把 `topFillColor` 这类构造 option 记在实例的 `options` 上
 * （实例字段是 setter 的落点，构造期不预置），读数要跟着换。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPrism from '../../packages/baidu-map-gl-vue/src/components/overlays/BPrism.vue'
import { createFakeV4Harness, type FakeV4Prism } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountPrism(altitude = ref(100)) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BPrism },
      setup() {
        return () =>
          h(BMap, { provider: provider() }, () => [
            h(BPrism, {
              path: [{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.9 }],
              altitude: altitude.value,
              topFillColor: '#ff0000',
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, altitude }
}

/** 当前地图上挂着的 Prism（BMapGL 的 `[...map.overlays][0]` 对应 v4 的数组下标）。 */
function currentPrism(): FakeV4Prism {
  return fake.createdMaps[fake.createdMaps.length - 1]!.overlays[0] as FakeV4Prism
}

describe('BPrism v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('creates prism with path, altitude and colors', async () => {
    const { wrapper } = mountPrism()
    await flushPromises()
    expect(harness.attached('overlay')).toBe(1)
    const prism = currentPrism()
    expect(prism.path.length).toBe(2)
    expect(prism.altitude).toBe(100)
    // 原来是 prism.topFillColor（BMapGL fake 把它做成实例字段）；v4 上构造 option 记在
    // `options` 上（topFillColor 的实例字段只由 setTopFillColor 写），语义等价
    expect(prism.options.topFillColor).toBe('#ff0000')
    wrapper.unmount()
    await nextTick()
  })

  it('updates altitude via field-level watch', async () => {
    const altitude = ref(100)
    const { wrapper } = mountPrism(altitude)
    await flushPromises()
    const prism = currentPrism()
    altitude.value = 200
    await nextTick()
    expect(prism.altitude).toBe(200)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountPrism()
    await flushPromises()
    // 原口径是 fake.stats.listeners > 0；v4 的对应实时读数是 leaks.listeners
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    // 原口径是 fake.stats.listeners === 0；v4 用泄漏门禁一次覆盖「监听 + 资源」
    harness.assertIdle('BPrism 卸载')
  })
})
