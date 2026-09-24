/**
 * M3: v3 BMap/BMarker/BInfoWindow 迁移验证（Fake v4 后端）
 *
 * 用 Fake BMap v4（`createFakeV4Harness`）挂载 v3 组件,验证:
 * - BMap 创建 runtime,SDK 加载后地图就绪
 * - BMap expose whenReady/map 实例
 * - BMarker 创建并 addOverlay
 * - BInfoWindow 经**地图级** openInfoWindow 打开(v4 的气泡不是普通覆盖物)
 * - 卸载后 Overlay/Map 资源归零
 *
 * M3A3-REMOVE-LEGACY（#26）之后旧引擎的 Fake BMapGL 已删除：Provider 必须是**结构化**的
 * `{ engine, version, namespace }`，读数走 Fake v4 的诊断口径（`harness.assertIdle()` /
 * `diagnostics.snapshot()`），不再有 `fake.stats.mapsCreated` 那一组计数器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import BMarker from '../../packages/bmap-vue/src/components/overlays/BMarker.vue'
import BInfoWindow from '../../packages/bmap-vue/src/components/overlays/BInfoWindow.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
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

/** 挂载/卸载后统一等一轮微任务 + 一次刷新（覆盖 onMounted 里的 whenReady 续体）。 */
async function settle() {
  await flushPromises()
  await nextTick()
}

describe('v3 BMap runtime migration', () => {
  it('creates map via provider and exposes map instance', async () => {
    const host = harness.container()
    const wrapper = mount(BMap, {
      attachTo: host,
      props: { provider: harness.provider() },
    })
    await settle()
    const vm = wrapper.vm as any
    expect(vm.getMapInstance()).toBeTruthy()
    // 旧口径 `fake.stats.mapsCreated === 1`；v4 的创建实例账在 `fake.createdMaps`，
    // 存活账在诊断的 `leaks.maps`
    expect(fake.createdMaps).toHaveLength(1)
    expect(fake.diagnostics.snapshot().leaks.maps).toBe(1)
    wrapper.unmount()
  })

  it('creates a BMarker overlay inside BMap', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          const provider = harness.provider()
          return () =>
            h(BMap, { provider }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await settle()
    // 旧口径 `fake.stats.overlaysCreated === 1` / `mapsCreated === 1`
    expect(harness.attached('overlay')).toBe(1)
    expect(fake.createdMaps).toHaveLength(1)
    wrapper.unmount()
  })

  it('destroys map and marker on unmount without leakage', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          const provider = harness.provider()
          return () =>
            h(BMap, { provider }, () => [h(BMarker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await settle()
    expect(harness.attached('overlay')).toBe(1)
    expect(fake.diagnostics.snapshot().leaks.maps).toBe(1)

    wrapper.unmount()
    await settle()
    // 旧 BMapGL fake 里 `map.destroy()` 不自动清 overlay，因此当时只断言 maps / listeners 归零；
    // v4 Driver 的释放路径是「先 removeOverlay 再 map.destroy」，所以整张账（含 overlay）都该归零，
    // 这里用统一门禁一次覆盖。
    harness.assertIdle('v3 BMap 卸载')
  })

  it('creates BInfoWindow and opens via openInfoWindow', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          const provider = harness.provider()
          return () =>
            h(BMap, { provider }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, title: 'title', open: true }),
            ])
        },
      }),
      { attachTo: host },
    )
    await settle()
    // 气泡走**地图级**专用入口（map.openInfoWindow），不占 addOverlay 的账：
    // R25-C / #72 之前组件走 `overlays.add(map, infoWindow)`，在 v4 上必抛 BMAP_INVALID_ARGUMENT。
    // 旧 BMapGL fake 用 `map.openInfoWindows`（Set）记账；v4 一张图只有一个气泡，
    // 读法是 `map.infoWindow`（`isOpen()` 是官方公开状态入口）。
    const map = fake.createdMaps.at(-1)!
    expect(map.infoWindow?.isOpen()).toBe(true)
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(0)
    wrapper.unmount()
  })
})
