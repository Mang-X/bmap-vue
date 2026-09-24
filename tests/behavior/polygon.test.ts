/**
 * Polygon 行为门禁（Fake v4 后端）
 *
 * #26 之后旧引擎 Fake BMapGL 已删除：v4 的路径字段是 `polygon.path`（旧 BMapGL fake 是
 * `points`），构造期样式由 Driver 经构造 options 传给 SDK，因此样式读 `polygon.options.*`
 * （Fake v4 只如实记录「传进去了什么」，字段级 setter 才会写实例字段）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Polygon from '../../packages/bmap-vue/src/components/overlays/Polygon.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Polygon,
} from '../../packages/test-utils'

let harness: FakeV4Harness
let fake: FakeBMapV4

beforeEach(() => {
  ;({ harness, fake } = createFakeV4Harness())
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function settle() {
  await flushPromises()
  await nextTick()
}

/** 最后一张地图上挂着的多边形（这些用例里就是那个唯一的 Polygon）。 */
function firstPolygon(): FakeV4Polygon {
  return fake.createdMaps.at(-1)!.overlays[0] as FakeV4Polygon
}

function mountPolygon(
  path = ref([{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.9 }, { lng: 116.5, lat: 39.95 }]),
) {
  const el = harness.container()
  const wrapper = mount(
    defineComponent({
      components: { Map, Polygon },
      setup() {
        return () =>
          h(Map, { provider: harness.provider() }, () => [
            h(Polygon, { path: path.value, fillColor: '#00ff00', fillOpacity: 0.3 }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, path }
}

describe('Polygon', () => {
  it('creates polygon with path points and fill options', async () => {
    const { wrapper } = mountPolygon()
    await settle()
    // 旧口径顶层计数器 `overlaysCreated === 1`；v4 同一事实是活动口径里的挂载次数
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(1)
    const poly = firstPolygon()
    expect(poly.path.length).toBe(3)
    // 旧 BMapGL fake 上构造期样式直接落在实例字段上；v4 的 Fake 把构造 options 原样记在
    // `options` 里（`setFillColor` 之类才会写 `poly.fillColor`）
    expect(poly.options.fillColor).toBe('#00ff00')
    expect(poly.options.fillOpacity).toBe(0.3)
    wrapper.unmount()
    await nextTick()
  })

  it('updates path via root-reference replacement', async () => {
    const path = ref([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
    const { wrapper } = mountPolygon(path)
    await settle()
    const poly = firstPolygon()
    expect(poly.path.length).toBe(2)

    path.value = [{ lng: 10, lat: 10 }]
    await nextTick()
    expect(poly.path.length).toBe(1)
    expect(poly.path[0]!.lng).toBe(10)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountPolygon()
    await settle()
    // 旧读数顶层计数器 `listeners`;Fake v4 的同一事实是诊断的存活监听器数
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('Polygon 卸载')
  })
})
