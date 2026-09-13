/**
 * M4: BInfoWindow 状态机与资源释放
 *
 * 验证:
 * - open= true → 打开(infoWindow 可读)
 * - open→false → 关闭
 * - SDK close 事件回写 update:open
 * - 卸载后无残留 listener
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BInfoWindow from '../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue'
import { getFakeBMapGl, resetLifecycleState } from '../../packages/test-utils'

const fake = getFakeBMapGl()
function provider() {
  return {
    load: async () => {
      ;(window as any).BMapGL = fake
      return fake
    },
  }
}
function host() {
  const el = document.createElement('div')
  el.style.width = '200px'
  el.style.height = '200px'
  document.body.appendChild(el)
  return el
}

describe('BInfoWindow state machine', () => {
  beforeEach(() => resetLifecycleState())

  /** 当前地图上处于「打开」状态的气泡数（活状态以 SDK 对象的 `isOpen()` 为准）。 */
  function openCount(): number {
    const map = fake.createdMaps[fake.createdMaps.length - 1] as
      | { openInfoWindows: Set<{ isOpen?: () => boolean }> }
      | undefined
    return [...(map?.openInfoWindows ?? [])].filter(
      (infoWindow) => infoWindow.isOpen?.() !== false,
    ).length
  }

  it('opens and closes via open prop, respecting state machine', async () => {
    fake.stats.reset()
    const el = host()
    const open = ref(true)
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: open.value, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    // 气泡是**地图级** API：打开经 map.openInfoWindow(win, point)，不进 addOverlay 的账
    // （R25-C / #72 之前组件走 `overlays.add(map, infoWindow)`，在 v4 上必抛 BMAP_INVALID_ARGUMENT）
    expect(openCount()).toBe(1)
    expect(fake.stats.overlaysCreated).toBe(0)

    // 关闭：走地图级 close（legacy 落在实例的 hide()），活状态回到 0
    open.value = false
    await nextTick()
    await flushPromises()
    expect(openCount()).toBe(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.stats.listeners).toBe(0)
  })

  it('SDK close event writes update:open false', async () => {
    fake.stats.reset()
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BInfoWindow },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BInfoWindow, { position: { lng: 116.4, lat: 39.9 }, open: true, title: 't' }),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    // 从 fake 找到 infoWindow 并触发 close
    const map = fake.createdMaps[fake.createdMaps.length - 1]
    const iw = [...(map.openInfoWindows as Set<{ emit?: (t: string, e: unknown) => void }>)][0]
    if (iw && (iw as any).emit) {
      ;(iw as any).emit('close', { type: 'close' })
    }
    await nextTick()
    // 子组件 BInfoWindow 应发出 update:open false
    const iwComp = wrapper.findComponent(BInfoWindow) as unknown as { emitted: (n: string) => unknown }
    const updates = iwComp.emitted('update:open')
    expect(updates).toBeTruthy()
    wrapper.unmount()
    await nextTick()
  })
})
