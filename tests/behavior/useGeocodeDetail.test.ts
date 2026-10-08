/**
 * useGeocodeDetail 验证(含真 Driver 全链路)
 *
 * #26 之后组件默认路径直接走 v4 Driver，服务读法以 `packages/test-utils/fake-bmap-v4/services.ts`
 * 的 `FakeV4Geocoder.locationResult` 为准。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { useGeocodeDetail } from '../../packages/bmap-vue/src/composables/useGeocodeDetail'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

/** 最近一次 `Geocoder#getLocation` 收到的 options（假 SDK 按调用逐条记账）。 */
function lastGetLocationOptions(): Record<string, unknown> {
  const geocoder = fake.createdGeocoders.at(-1)
  expect(geocoder, '没有建出 Geocoder 实例').toBeTruthy()
  const entry = geocoder!.callLog.filter((line) => line.startsWith('getLocation:')).at(-1)
  expect(entry, '没有调用过 getLocation').toBeTruthy()
  return JSON.parse(entry!.slice('getLocation:'.length)) as Record<string, unknown>
}

function mountWithChild(child: (geo: ReturnType<typeof useGeocodeDetail>) => Promise<void> | void) {
  const el = host()
  const Child = defineComponent({
    setup() {
      const geo = useGeocodeDetail()
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
  return { wrapper }
}

describe('useGeocodeDetail', () => {
  beforeEach(() => harness.reset())

  it('resolves address detail for a point via driver-converted Point', async () => {
    let result: any = null
    const { wrapper } = mountWithChild(async (geo) => {
      // #38 起动作恒 resolve 成 ServiceResult
      result = await geo.getLocation({ lng: 116.404, lat: 39.915 })
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

  it('data is the single result accessor and the action is named getLocation', async () => {
    let outcome: { address: string | undefined; keys: string[] } | null = null
    const { wrapper } = mountWithChild(async (geo) => {
      await geo.getLocation({ lng: 116.404, lat: 39.915 })
      await nextTick()
      outcome = { address: geo.data.value?.address, keys: Object.keys(geo).sort() }
    })
    await flushPromises()
    await nextTick()
    expect(outcome!.address).toBe('北京市东城区天安门')
    // 与 useGeocoder 同口径：结果只有 `data`（旧的 `result` 别名已删），动作名对齐官方
    expect(outcome!.keys).not.toContain('result')
    expect(outcome!.keys).toContain('getLocation')
    expect(outcome!.keys).not.toContain('get')
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

  it('forwards official LocationOptions (poiRadius / numPois) to the SDK', async () => {
    // #165 审计项：Driver 一直支持这两个字段，此前 composable 把它们丢掉了
    // ⇒ 调用方拿不到官方的「附近 POI 半径 / 个数」调节入口。
    const { wrapper } = mountWithChild(async (geo) => {
      await geo.getLocation({ lng: 116.404, lat: 39.915 }, { poiRadius: 500, numPois: 3 })
    })
    await flushPromises()
    await nextTick()
    expect(lastGetLocationOptions()).toEqual({ poiRadius: 500, numPois: 3 })
    wrapper.unmount()
    await nextTick()
  })

  it('does not invent options the caller did not pass', async () => {
    const { wrapper } = mountWithChild(async (geo) => {
      await geo.getLocation({ lng: 116.404, lat: 39.915 })
    })
    await flushPromises()
    await nextTick()
    // 逐字段透传（不展开 `...options`）：没传就是空对象，不塞进 `undefined` 之外的键。
    expect(lastGetLocationOptions()).toEqual({})
    wrapper.unmount()
    await nextTick()
  })

  it('applies the same options to every item in getBatch', async () => {
    const { wrapper } = mountWithChild(async (geo) => {
      await geo.getBatch(
        [
          { lng: 116.404, lat: 39.915 },
          { lng: 121.5, lat: 31.2 },
        ],
        { poiRadius: 200 },
      )
    })
    await flushPromises()
    await nextTick()
    const entries = fake
      .createdGeocoders.at(-1)!
      .callLog.filter((line) => line.startsWith('getLocation:'))
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(JSON.parse(entry.slice('getLocation:'.length))).toEqual({ poiRadius: 200 })
    }
    wrapper.unmount()
    await nextTick()
  })

  it('exposes error ref (not throw) on invalid input', async () => {
    const { wrapper } = mountWithChild(async (geo) => {
      const result = await geo.getLocation({ lng: 'x', lat: 1 } as any)
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
