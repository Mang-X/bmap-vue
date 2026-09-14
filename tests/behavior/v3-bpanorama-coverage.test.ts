/**
 * BPanoramaCoverageLayer 迁移验证
 *
 * BMapGL 上该图层经 `map.addTileLayer / removeTileLayer` 专用入口管理；v4 上所有图层
 * 走**统一**的 `map.addLayer / removeLayer`（专用入口已 deprecated），因此读数改为
 * 统一入口的 callLog 与 `harness.attached('layer')`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BPanoramaCoverageLayer from '../../packages/baidu-map-gl-vue/src/components/layers/BPanoramaCoverageLayer.vue'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

describe('BPanoramaCoverageLayer v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('adds and removes a panorama coverage layer', async () => {
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { BMap, BPanoramaCoverageLayer },
        setup: () => () => h(BMap, { provider: provider() }, () => [h(BPanoramaCoverageLayer)]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const map = fake.createdMaps[fake.createdMaps.length - 1]!
    // 原来是 map.addTileLayer（BMapGL 的专用入口）；v4 上经统一的 map.addLayer 挂载
    expect(map.callLog).toContain('addLayer')
    expect(harness.attached('layer')).toBe(1)
    wrapper.unmount()
    await nextTick()
    // 原来是 map.removeTileLayer；v4 上是统一的 map.removeLayer
    expect(map.callLog).toContain('removeLayer')
    expect(harness.attached('layer')).toBe(0)
  })
})
