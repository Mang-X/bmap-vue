/**
 * BDistrictLayer 迁移验证
 *
 * 从 BMapGL Fake 迁到 Fake v4：图层在 BMapGL 上混在 `map.overlays` 里计数
 * （`stats.overlaysCreated/Removed`），v4 上所有图层走**统一**的 `map.layers`
 * 与 `map.addLayer/removeLayer`，因此读数改为 `harness.attached('layer')` 与
 * `activity.layersAttached/layersDetached`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import BDistrictLayer from '../../packages/bmap-vue/src/components/layers/BDistrictLayer.vue'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountLayer(visible = ref(true)) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap, BDistrictLayer },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(BDistrictLayer, { name: '北京市', visible: visible.value })]),
    }),
    { attachTo: el },
  )
  return { wrapper, visible }
}

describe('BDistrictLayer v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('adds a district layer to the map', async () => {
    const { wrapper } = mountLayer()
    await flushPromises()
    expect(harness.attached('layer')).toBe(1)
    wrapper.unmount()
    await nextTick()
    expect(harness.attached('layer')).toBe(0)
  })

  it('toggles visible add/remove idempotently', async () => {
    const { wrapper, visible } = mountLayer()
    await flushPromises()
    expect(harness.attached('layer')).toBe(1)
    visible.value = false
    await nextTick()
    expect(harness.attached('layer')).toBe(0)
    visible.value = true
    await nextTick()
    expect(harness.attached('layer')).toBe(1)
    // 累计口径：原有 stats.overlaysCreated/Removed 的对应读数（挂载 2 次、摘除 1 次）
    const { activity } = fake.diagnostics.snapshot()
    expect(activity.layersAttached).toBe(2)
    expect(activity.layersDetached).toBe(1)
    wrapper.unmount()
    await nextTick()
  })
})
