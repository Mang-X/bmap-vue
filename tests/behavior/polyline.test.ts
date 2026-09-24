/**
 * Polyline 行为门禁（Fake v4 后端）
 *
 * #26 之后旧引擎 Fake BMapGL 已删除：v4 的路径字段是 `polyline.path`（旧 BMapGL fake 是
 * `points`），构造期样式由 Driver 经构造 options 传给 SDK，因此样式读 `polyline.options.*`
 * （Fake v4 只如实记录「传进去了什么」，字段级 setter 才会写实例字段）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Polyline from '../../packages/bmap-vue/src/components/overlays/Polyline.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Polyline,
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

/** 最后一张地图上挂着的折线（这些用例里就是那个唯一的 Polyline）。 */
function firstLine(): FakeV4Polyline {
  return fake.createdMaps.at(-1)!.overlays[0] as FakeV4Polyline
}

function mountPolyline(pathRef = ref([{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.95 }])) {
  const el = harness.container()
  const wrapper = mount(
    defineComponent({
      components: { Map, Polyline },
      setup() {
        const path = pathRef
        return () =>
          h(Map, { provider: harness.provider() }, () => [
            h(Polyline, { path: path.value, strokeColor: '#00ff00', strokeWeight: 3 }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, pathRef }
}

describe('Polyline', () => {
  it('creates polyline with path points and stroke options', async () => {
    const { wrapper } = mountPolyline()
    await settle()
    // 旧口径顶层计数器 `overlaysCreated === 1`；v4 同一事实是活动口径里的挂载次数
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(1)
    const line = firstLine()
    expect(line.path.length).toBe(2)
    // 旧 BMapGL fake 上构造期样式直接落在实例字段上；v4 的 Fake 把构造 options 原样记在
    // `options` 里（`setStrokeColor` 之类才会写 `line.strokeColor`）
    expect(line.options.strokeColor).toBe('#00ff00')
    expect(line.options.strokeWeight).toBe(3)
    wrapper.unmount()
    await nextTick()
  })

  it('updates path via root-reference replacement', async () => {
    const path = ref([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
    const { wrapper } = mountPolyline(path)
    await settle()
    const line = firstLine()
    expect(line.path.length).toBe(2)

    path.value = [{ lng: 10, lat: 10 }]
    await nextTick()
    expect(line.path.length).toBe(1)
    expect(line.path[0]!.lng).toBe(10)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountPolyline()
    await settle()
    // 旧读数顶层计数器 `listeners`;Fake v4 的同一事实是诊断的存活监听器数
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('Polyline 卸载')
  })
})
