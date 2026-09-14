/**
 * useBMapGeolocation 验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import { useBMapGeolocation } from '../../packages/baidu-map-gl-vue/src/composables/useBMapGeolocation'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

describe('useBMapGeolocation', () => {
  beforeEach(() => harness.reset())

  it('locates after map ready and returns a point (as BMap child)', async () => {
    const el = host()
    const located = ref<{ lng: number; lat: number } | null>(null)
    const Child = defineComponent({
      setup() {
        const geo = useBMapGeolocation()
        onMounted(async () => {
          await geo.locate()
          if (geo.data.value) {
            located.value = geo.data.value.point
          }
        })
        return () => h('div', 'geo')
      },
    })
    const wrapper = mount(
      defineComponent({
        components: { BMap, Child },
        setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    await nextTick()
    // 原来是 fake BMapGL 的 116.4；Fake v4 的 Geolocation 回包是 116.404（FakeV4Geolocation.result）
    expect(located.value?.lng).toBe(116.404)
    wrapper.unmount()
    await nextTick()
  })
})
