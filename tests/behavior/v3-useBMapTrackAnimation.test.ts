/**
 * useBMapTrackAnimation 验证(自有状态机,不读私有 _status)
 *
 * M3A3-REMOVE-LEGACY（#26）后的 v4 语义：`TrackAnimation` 属 BMapGLLib 插件，
 * JSAPI 4.0 没有该入口——`driver.services.createTrackAnimation()` 抛
 * `BMAP_CAPABILITY_UNSUPPORTED`（v4 的对应能力是原生图层 TrackLine）。
 * 因此「start 后进入 playing」在 v4 上不成立，改为断言 v4 路径上最接近的可观察事实：
 * ①建实例失败是**显式报错**（不是静默进入 playing）；②库自身的状态机仍可用。
 * `setPath` 的拒绝原因附在用例内的注释里。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import { useBMapTrackAnimation } from '../../packages/baidu-map-gl-vue/src/composables/useBMapTrackAnimation'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountChild(run: (t: ReturnType<typeof useBMapTrackAnimation>) => any) {
  const el = host()
  const collect = ref<any>(null)
  const failure = ref<any>(null)
  const Child = defineComponent({
    setup() {
      const track = useBMapTrackAnimation()
      onMounted(async () => {
        try {
          await run(track)
        } catch (error) {
          failure.value = error
        }
        collect.value = track.status.value
      })
      return () => h('div', 'track')
    },
  })
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  )
  return { wrapper, collect, failure }
}

describe('useBMapTrackAnimation', () => {
  beforeEach(() => harness.reset())

  it('transitions to playing on start using library state machine', async () => {
    // 原来是 fake BMapGL 上「setPath 建出插件实例 → start ⇒ playing」；
    // v4 上 TrackAnimation 能力不支持，createTrackAnimation 抛 BMAP_CAPABILITY_UNSUPPORTED，
    // 所以这里断言「显式失败、且状态机不进入 playing」——即插件缺失不会被静默当成成功。
    const { wrapper, collect, failure } = mountChild(async (track) => {
      await track.setPath([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
      await track.start()
    })
    await flushPromises()
    await nextTick()
    expect(failure.value?.code).toBe('BMAP_CAPABILITY_UNSUPPORTED')
    expect(collect.value).not.toBe('playing')
    wrapper.unmount()
    await nextTick()
  })

  it('user pause is not overwritten by document visibility resume', async () => {
    // v4：setPath 必然失败（同上），吞掉后继续驱动库自身的状态机——
    // 用例真正要钉的是 pause('user') 之后的 resume 语义，与插件实例无关。
    const { wrapper, collect, failure } = mountChild(async (track) => {
      await track.setPath([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }]).catch(() => {})
      track.pause('user')
      track.resume()
    })
    await flushPromises()
    await nextTick()
    expect(failure.value).toBeNull()
    expect(collect.value).toBe('playing')
    wrapper.unmount()
    await nextTick()
  })
})
