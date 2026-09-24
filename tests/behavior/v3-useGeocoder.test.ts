/**
 * useGeocoder 验证
 *
 * #26 之后组件默认路径直接走 v4 Driver，服务读法以 `packages/test-utils/fake-bmap-v4/services.ts`
 * 的 `FakeV4Geocoder` 为准（回包是**领域化的 `{ lng, lat }`**，默认 `{ lng: 116.404, lat: 39.915 }`）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { useGeocoder } from '../../packages/bmap-vue/src/composables/useGeocoder'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountWithChild(child: (geo: ReturnType<typeof useGeocoder>) => Promise<void> | void) {
  const el = host()
  const collect = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const geo = useGeocoder()
      const run = () => child(geo)
      onMounted(async () => {
        await run()
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
  return { wrapper, collect }
}

describe('useGeocoder', () => {
  beforeEach(() => harness.reset())

  it('geocodes a single address to point', async () => {
    const { wrapper, collect } = mountWithChild(async (geo) => {
      // #38 起动作恒 resolve 成 ServiceResult（失败/超时/取消都在返回值里）
      const result = await geo.get('北京', '北京市')
      collect.value = result
    })
    await flushPromises()
    await nextTick()
    // Fake v4 Geocoder.getPoint 的默认回包（不做任何坐标偏移）
    expect(collect.value?.status).toBe('success')
    expect(collect.value?.data?.lng).toBe(116.404)
    expect(fake.createdGeocoders.length).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
  })

  it('getBatch returns per-item results', async () => {
    const { wrapper, collect } = mountWithChild(async (geo) => {
      const results = await geo.getBatch(['北京', '上海'], 'x')
      collect.value = results
    })
    await flushPromises()
    await nextTick()
    expect(collect.value).toHaveLength(2)
    expect(collect.value[0].point?.lng).toBe(116.404)
    expect(collect.value[1].point?.lng).toBe(116.404)
    wrapper.unmount()
    await nextTick()
  })
})
