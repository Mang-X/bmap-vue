/**
 * useBMapConvertor 验证
 *
 * #26 之后组件默认路径直接走 v4 Driver，服务读法以 `packages/test-utils/fake-bmap-v4/services.ts`
 * 的 `FakeV4Convertor` 为准（回包是官方的 `{ status, points }` 载荷）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import { useBMapConvertor, CoordinatesFromType, CoordinatesToType } from '../../packages/bmap-vue/src/composables/useBMapConvertor'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountChild(run: (c: ReturnType<typeof useBMapConvertor>) => any) {
  const el = host()
  const collect = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const conv = useBMapConvertor()
      const exec = () => run(conv)
      onMounted(async () => {
        await exec()
      })
      return () => h('div', 'conv')
    },
  })
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  )
  return { wrapper, collect }
}

describe('useBMapConvertor', () => {
  beforeEach(() => harness.reset())

  it('converts coordinates and returns points', async () => {
    const { wrapper, collect } = mountChild(async (conv) => {
      // #38 起动作恒 resolve 成 ServiceResult（失败/超时/取消都在返回值里）
      const r = await conv.convert([{ lng: 116.4, lat: 39.9 }], CoordinatesFromType.COORDINATES_WGS84, CoordinatesToType.COORDINATES_BD09)
      collect.value = r
    })
    await flushPromises()
    await nextTick()
    expect(collect.value.status).toBe('success')
    expect(collect.value.data).toHaveLength(1)
    // Fake v4 Convertor.translate 的默认回包（不做任何坐标偏移，坐标原样返回）
    expect(collect.value.data[0].lng).toBe(116.404)
    expect(collect.value.data[0].lat).toBe(39.915)
    expect(collect.value.sdkStatus).toBe(0)
    expect(fake.createdConvertors.length).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
  })

  it('records structured error status when points missing', async () => {
    const { wrapper, collect } = mountChild(async (conv) => {
      await conv.convert([], CoordinatesFromType.COORDINATES_WGS84, CoordinatesToType.COORDINATES_BD09)
      collect.value = { status: conv.status.value, code: (conv.error.value as any)?.code }
    })
    await flushPromises()
    await nextTick()
    // 空 points 在 Driver 的归一化调用面就被拦下（引擎无关），不是 SDK 回包失败
    expect(collect.value.status).toBe('failed')
    expect(collect.value.code).toBe('BMAP_INVALID_ARGUMENT')
    wrapper.unmount()
    await nextTick()
  })
})
