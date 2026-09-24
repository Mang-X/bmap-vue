/**
 * useGeolocation 验证
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { useGeolocation } from '../../packages/bmap-vue/src/composables/useGeolocation'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

describe('useGeolocation', () => {
  beforeEach(() => harness.reset())

  it('locates after map ready and returns a point (as Map child)', async () => {
    const el = host()
    const located = ref<{ lng: number; lat: number } | null>(null)
    const Child = defineComponent({
      setup() {
        const geo = useGeolocation()
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
        components: { Map, Child },
        setup: () => () => h(Map, { provider: provider() }, () => [h(Child)]),
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
