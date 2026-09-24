/**
 * BGroundOverlay 行为验证（M5-VECTORS / #31 迁移后）
 *
 * 三个读数口径：
 * - 构造选项记在 Fake 的 `options` 上（实例字段只由 setter 写），因此读 `go.options.*`；
 * - `bounds` 是实例字段，直接读；
 * - 监听 / 资源的释放用 `harness.assertIdle()`（泄漏门禁覆盖「监听 + 资源」两个口径）。
 *
 * 旧 prop 名（`startPoint` + `endPoint`）的行为在 `v3-overlay-suite.test.ts` 的「集中弃用层」
 * 一组里覆盖（新 API 优先 + 同实例只警告一次）；本文件只走**正典** `bounds`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import BGroundOverlay from '../../packages/bmap-vue/src/components/overlays/BGroundOverlay.vue'
import { createFakeV4Harness, type FakeV4GroundOverlay } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

type Bounds = { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } }

const initialBounds: Bounds = {
  southwest: { lng: 116.4, lat: 39.9 },
  northeast: { lng: 116.5, lat: 40.9 },
}

function mountOverlay(bounds = ref<Bounds>(initialBounds)) {
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
              bounds: bounds.value,
              opacity: 0.5,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, bounds }
}

/** 当前地图上挂着的 GroundOverlay。 */
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
    expect(go.options.opacity).toBe(0.5)
    expect(go.options.url).toBe('a.png')
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(116.45, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('updates bounds via field-level update（不重建实例）', async () => {
    const bounds = ref<Bounds>(initialBounds)
    const { wrapper } = mountOverlay(bounds)
    await flushPromises()
    const go = currentGroundOverlay()
    const created = fake.createdOverlays.length

    bounds.value = {
      southwest: { lng: 100, lat: 30 },
      northeast: { lng: 116.5, lat: 40.9 },
    }
    await nextTick()

    // 字段级更新：同一个实例、恰好一条 setBounds
    expect(fake.createdOverlays.length).toBe(created)
    expect(currentGroundOverlay()).toBe(go)
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(108.25, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    harness.assertIdle('BGroundOverlay 卸载')
  })
})
