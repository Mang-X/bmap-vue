/**
 * M4: BMarker 动态更新与幂等可见性（Fake v4 后端）
 *
 * 验证关键修复:
 * - position 变化用字段级 watch(不等同于 deep watch),更新 SDK position
 * - visible 切换幂等,不重复 add 同一 Overlay
 * - 卸载后 SDK 监听与 watcher 全部释放
 *
 * #26 之后旧引擎 Fake BMapGL 已删除：读数走 Fake v4 的覆盖物字段（`marker.position` /
 * `marker.visible`）与诊断口径（`leaks.listeners` / `activity.overlays*`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import BMarker from '../../packages/bmap-vue/src/components/overlays/BMarker.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Marker,
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

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount()
  await settle()
}

/** 最后一张地图上挂着的第一个覆盖物（这些用例里就是那个 Marker）。 */
function firstOverlay(): FakeV4Marker {
  return fake.createdMaps.at(-1)!.overlays[0] as FakeV4Marker
}

describe('BMarker field-level updates', () => {
  it('updates marker position when lng/lat change', async () => {
    const el = harness.container()
    const position = ref({ lng: 116.4, lat: 39.9 })
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BMarker, { position: position.value }),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    // 从 fake 记录的地图实例读取 created overlay(marker)
    const marker = firstOverlay()
    expect(marker?.position?.lng).toBe(116.4)
    position.value = { lng: 200, lat: 50 }
    await nextTick()
    // marker 的 position 更新为 (200,50)
    expect(marker.position?.lng).toBe(200)
    await unmountAndSettle(wrapper)
  })

  it('toggles visible without duplicate addOverlay calls', async () => {
    const el = harness.container()
    const visible = ref(true)
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, visible: visible.value }),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    const marker = firstOverlay()
    const created = fake.diagnostics.snapshot().activity.overlaysAttached
    expect(created).toBe(1)

    visible.value = false
    await nextTick()
    // 旧 BMapGL fake 上 visible=false 走 addOverlay/removeOverlay（`overlaysRemoved === 1`）；
    // v4 Driver 优先走 `Overlay#hide()`（不破坏 overlay 归属），因此「摘掉」这条在 v4 上不存在——
    // 最接近的可观察事实是：同一个 Overlay 实例被 hide（`visible === false`），且没有走 remove 记账。
    expect(marker.visible).toBe(false)
    expect(fake.diagnostics.snapshot().activity.overlaysDetached).toBe(0)

    // 再次切换回可见:仍是同一个实例,不得重复 add
    visible.value = true
    await nextTick()
    expect(marker.visible).toBe(true)
    expect(
      fake.diagnostics.snapshot().activity.overlaysAttached,
      '“再可见”不得重复 add 同一 Overlay',
    ).toBe(1)
    expect(fake.createdMaps.at(-1)!.overlays).toEqual([marker])

    await unmountAndSettle(wrapper)
    harness.assertIdle('BMarker visible 切换后卸载')
  })

  it('releases all listeners and watchers on unmount', async () => {
    const el = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    // 旧读数 `fake.stats.listeners`;Fake v4 的同一事实是诊断的存活监听器数
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    await unmountAndSettle(wrapper)
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('BMarker 卸载')
  })
})
