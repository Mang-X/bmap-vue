/**
 * M4: BInfoWindow 状态机与资源释放（Fake v4 后端）
 *
 * 验证:
 * - open= true → 打开(infoWindow 可读)
 * - open→false → 关闭
 * - SDK close 事件回写 update:open
 * - 卸载后无残留 listener
 *
 * 读数口径：v4 一张地图同时只有一个气泡，官方状态入口是 `map.infoWindow` / `infoWindow.isOpen()`
 * （旧 BMapGL fake 是 `map.openInfoWindows` 这个 Set）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BInfoWindow from '../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue'
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

async function settle() {
  await flushPromises()
  await nextTick()
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount()
  await settle()
}

describe('BInfoWindow state machine', () => {
  /** 当前地图上处于「打开」状态的气泡数（活状态以 SDK 对象的 `isOpen()` 为准）。 */
  function openCount(): number {
    const map = fake.createdMaps.at(-1)
    // 用 `=== true` 而不是「不等于 false」：缺 `isOpen()` 的对象不算打开，否则「读错了来源」
    // 会被静默当成「打开着」，门禁变成空转
    return map?.infoWindow?.isOpen() === true ? 1 : 0
  }

  it('opens and closes via open prop, respecting state machine', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: open.value, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    // 气泡是**地图级** API：打开经 map.openInfoWindow(win, point)，不进 addOverlay 的账
    // （R25-C / #72 之前组件走 `overlays.add(map, infoWindow)`，在 v4 上必抛 BMAP_INVALID_ARGUMENT）
    expect(openCount()).toBe(1)
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(0)

    // 关闭：走地图级 close（legacy 落在实例的 hide()），活状态回到 0
    open.value = false
    await settle()
    expect(openCount()).toBe(0)
    await unmountAndSettle(wrapper)
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('BInfoWindow 关闭后卸载')
  })

  it('SDK close event writes update:open false', async () => {
    const el = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: true, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    // 从 fake 找到 infoWindow 并触发 close（真实 SDK 由渲染链派发，Fake 由测试自行 emit）
    const iw = fake.createdMaps.at(-1)!.infoWindow
    expect(iw, '对照组：气泡必须已经打开').toBeTruthy()
    iw!.emit('close', { type: 'close' })
    await nextTick()
    // 子组件 BInfoWindow 应发出 update:open false
    const iwComp = wrapper.findComponent(BInfoWindow) as unknown as {
      emitted: (n: string) => unknown
    }
    const updates = iwComp.emitted('update:open') as unknown[][] | undefined
    expect(updates).toBeTruthy()
    expect(updates).toContainEqual([false])
    await unmountAndSettle(wrapper)
  })
})
