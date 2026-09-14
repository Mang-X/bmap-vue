/**
 * BZoom/BScale 迁移验证
 *
 * #26 之后组件默认路径直接走 v4 Driver。Fake v4 的 `map.controls` 是**数组**（BMapGL fake 里是
 * `Set`），因此 `.size` → `.length`；其余观察点（挂了几个、visible=false 摘掉）完全一致。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BZoom from '../../packages/baidu-map-gl-vue/src/components/controls/BZoom.vue'
import BScale from '../../packages/baidu-map-gl-vue/src/components/controls/BScale.vue'
import BCityList from '../../packages/baidu-map-gl-vue/src/components/controls/BCityList.vue'
import BLocation from '../../packages/baidu-map-gl-vue/src/components/controls/BLocation.vue'
import BNavigation3d from '../../packages/baidu-map-gl-vue/src/components/controls/BNavigation3d.vue'
import BCopyright from '../../packages/baidu-map-gl-vue/src/components/controls/BCopyright.vue'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

/** 当前（最后一张）地图 —— 控件数一律以它为准。 */
function currentMap() {
  return fake.createdMaps.at(-1)!
}

function mountControl(comp: any, props: Record<string, unknown> = {}) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, Comp: comp },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(comp, props)]),
    }),
    { attachTo: el },
  )
  return { wrapper }
}

describe('Control v3', () => {
  beforeEach(() => harness.reset())

  it('BZoom adds a zoom control to the map', async () => {
    const { wrapper } = mountControl(BZoom)
    await flushPromises()
    // fake Map.addControl 已实现（记录在 maps 的 controls 数组里）
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BScale adds control and toggles visible', async () => {
    const visible = ref(true)
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BScale },
        setup: () => () => h(BMap, { provider: provider() }, () => [h(BScale, { visible: visible.value })]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    visible.value = false
    await nextTick()
    expect(map.controls).toHaveLength(0)
    wrapper.unmount()
    await nextTick()
  })

  it('BCityList adds a city-list control', async () => {
    const { wrapper } = mountControl(BCityList, { expand: true })
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BLocation adds a location control', async () => {
    const { wrapper } = mountControl(BLocation)
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BNavigation3d adds a navigation control', async () => {
    const { wrapper } = mountControl(BNavigation3d)
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BCopyright adds a copyright control with slot content', async () => {
    const el = host()
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [
          h(BCopyright, {}, () => h('span', { class: 'copyright-content' }, 'custom copyright')),
        ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    const control = map.controls[0] as { copyrights?: { content: string }[] }
    expect(control.copyrights).toHaveLength(1)
    expect(control.copyrights?.[0]?.content).toContain('custom copyright')
    expect(wrapper.text()).toContain('custom copyright')
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BCopyright toggles visibility without re-adding the control', async () => {
    const visible = ref(true)
    const el = host()
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [
          h(BCopyright, { visible: visible.value }, () => 'custom copyright'),
        ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = currentMap()
    const control = map.controls[0] as { copyrights?: unknown[] }
    expect(control.copyrights).toHaveLength(1)
    visible.value = false
    await nextTick()
    expect(map.controls).toHaveLength(1)
    expect(control.copyrights).toHaveLength(0)
    visible.value = true
    await nextTick()
    expect(map.controls).toHaveLength(1)
    expect(control.copyrights).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
  })
})
