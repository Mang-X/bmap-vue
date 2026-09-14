/**
 * useBMapGeocodeDetail 验证(含真 Driver 全链路)
 *
 * #26 之后组件默认路径直接走 v4 Driver，服务读法以 `packages/test-utils/fake-bmap-v4/services.ts`
 * 的 `FakeV4Geocoder.locationResult` 为准。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import { useBMapGeocodeDetail } from '../../packages/baidu-map-gl-vue/src/composables/useBMapGeocodeDetail'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountWithChild(child: (geo: ReturnType<typeof useBMapGeocodeDetail>) => Promise<void> | void) {
  const el = host()
  const Child = defineComponent({
    setup() {
      const geo = useBMapGeocodeDetail()
      const run = () => child(geo)
      onMounted(async () => {
        await run()
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
  return { wrapper }
}

describe('useBMapGeocodeDetail', () => {
  beforeEach(() => harness.reset())

  it('resolves address detail for a point via driver-converted Point', async () => {
    let result: any = null
    const { wrapper } = mountWithChild(async (geo) => {
      // #38 起动作恒 resolve 成 ServiceResult
      result = await geo.get({ lng: 116.404, lat: 39.915 })
    })
    await flushPromises()
    await nextTick()
    expect(result.status).toBe('success')
    // Fake v4 Geocoder.getLocation 的默认回包地址
    expect(result.data?.address).toBe('北京市东城区天安门')
    expect(result.data?.point).toEqual({ lng: 116.404, lat: 39.915 })
    wrapper.unmount()
    await nextTick()
  })

  it('getBatch returns per-item details', async () => {
    let results: any = null
    const { wrapper } = mountWithChild(async (geo) => {
      results = await geo.getBatch([
        { lng: 116.404, lat: 39.915 },
        { lng: 121.5, lat: 31.2 },
      ])
    })
    await flushPromises()
    await nextTick()
    expect(results).toHaveLength(2)
    expect(results[0].detail?.address).toBe('北京市东城区天安门')
    expect(results[0].point).toEqual({ lng: 116.404, lat: 39.915 })
    wrapper.unmount()
    await nextTick()
  })

  it('exposes error ref (not throw) on invalid input', async () => {
    const { wrapper } = mountWithChild(async (geo) => {
      const result = await geo.get({ lng: 'x', lat: 1 } as any)
      expect(result.status).toBe('failed')
      expect(geo.status.value).toBe('failed')
      // Driver 的归一化调用面用 BMAP_INVALID_ARGUMENT 表达「参数非法」（不抛错）
      expect(geo.error.value).toMatchObject({ code: 'BMAP_INVALID_ARGUMENT' })
    })
    await flushPromises()
    await nextTick()
    wrapper.unmount()
    await nextTick()
  })
})
