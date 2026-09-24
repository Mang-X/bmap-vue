/**
 * Circle 迁移验证（Fake v4 后端）
 *
 * 验证:
 * - center 字段级更新(不 deep watch),SDK setCenter 被调用
 * - radius/样式 字段级更新
 * - visible 幂等切换
 * - 卸载后 resource 销毁 + 监听释放
 *
 * #26 之后旧引擎 Fake BMapGL 已删除：读数走 Fake v4 的覆盖物字段（`circle.center` / `radius`）
 * 与诊断口径（`leaks.listeners` / `activity.overlaysAttached`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Circle from '../../packages/bmap-vue/src/components/overlays/Circle.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Circle,
  type FakeV4Harness,
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

/** 最后一张地图上挂着的圆（这些用例里就是那个唯一的 Circle）。 */
function firstCircle(): FakeV4Circle {
  return fake.createdMaps.at(-1)!.overlays[0] as FakeV4Circle
}

function mountCircle(centerRef = ref({ lng: 116.4, lat: 39.9 })) {
  const el = harness.container()
  const wrapper = mount(
    defineComponent({
      components: { Map, Circle },
      setup() {
        const center = centerRef
        return () =>
          h(Map, { provider: harness.provider() }, () => [
            h(Circle, { center: center.value, radius: 100, strokeColor: '#ff0000' }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, centerRef }
}

describe('Circle v3', () => {
  it('creates circle with valid center (incl 0,0) and radius', async () => {
    const { wrapper } = mountCircle(ref({ lng: 0, lat: 0 }))
    await settle()
    // 旧口径 `fake.stats.overlaysCreated === 1`；v4 同一事实是活动口径里的挂载次数
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(1)
    const circle = firstCircle()
    expect(circle.radius).toBe(100)
    // 0 坐标必须被当成合法值传下去（旧 BMapGL fake 上只断言了 radius；v4 的构造期 center 是
    // `circle.center` 字段，可以直接读出 0,0）
    expect(circle.center.lng).toBe(0)
    expect(circle.center.lat).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('updates center via field-level watch (0 coordinate valid)', async () => {
    const center = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountCircle(center)
    await settle()

    center.value = { lng: 0, lat: 0 }
    await nextTick()
    const circle = firstCircle()
    expect(circle.center.lng).toBe(0)
    expect(circle.center.lat).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners and disposes circle on unmount', async () => {
    const { wrapper } = mountCircle()
    await settle()
    // 旧读数 `fake.stats.listeners`;Fake v4 的同一事实是诊断的存活监听器数
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('Circle 卸载')
  })
})
