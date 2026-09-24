/**
 * Autocomplete 迁移验证
 *
 * #26 之后组件默认路径直接走 v4 Driver。BMapGL 时代的 fake Autocomplete **构造时就回调**
 * `onSearchComplete`；v4 的 `Autocomplete` 是**事件式**服务（`packages/test-utils/fake-bmap-v4/
 * services.ts` 的 `FakeV4Autocomplete`）：构造不回调，只有 `search(keyword)` 才把
 * `FakeV4AutocompleteResult` 经 `options.onSearchComplete` 送回来。因此「发出检索回包」这条
 * 用例改为**显式触发一次 search**——观察点仍是「组件把同一条回调转成 searchComplete 事件」。
 *
 * `location` 的同步在 v4 上收在 Driver 的公开入口 `setAutocompleteOptions`
 * （组件不再碰 raw setter），落点是 `FakeV4Autocomplete#setLocation`。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Autocomplete from '../../packages/bmap-vue/src/components/autocomplete/Autocomplete.vue'
import { createFakeV4Harness, FakeV4AutocompleteResult } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

describe('Autocomplete v3', () => {
  beforeEach(() => harness.reset())

  it('creates autocomplete bound to input and emits searchComplete', async () => {
    const el = host()
    let gotResult: unknown = null
    const wrapper = mount(
      defineComponent({
        components: { Map, Autocomplete },
        setup: () => () =>
          h(Map, { provider: provider() }, () => [
            h(Autocomplete, {
              location: '北京市',
              types: ['city'],
              onSearchComplete: (e: unknown) => {
                gotResult = e
              },
            }),
          ]),
      }),
      { attachTo: el },
    )
    await flushPromises()

    // 实例真的建起来了，而且绑的就是组件渲染出来的那个输入框（BMapGL 上构造即回调，v4 上不回调）
    const raw = fake.createdAutocompletes.at(-1)!
    const input = document.querySelector('.b-auto-complete-input') as HTMLInputElement
    expect(input, '组件必须渲染出输入框').toBeTruthy()
    expect(raw.options.input, 'Autocomplete 必须绑在组件的输入框上').toBe(input)
    expect(raw.options.location, '构造期 location 落到 options').toBe('北京市')
    expect(raw.callLog).toContain('construct')
    expect(gotResult, 'v4：构造不回调，此时还没有检索结果').toBeNull()

    // v4 上检索是显式的：search() 的回包经 options.onSearchComplete → 组件 emit searchComplete
    raw.search('北京市')
    await flushPromises()
    expect(gotResult).toBeInstanceOf(FakeV4AutocompleteResult)
    expect((gotResult as FakeV4AutocompleteResult).getNumPois()).toBe(1)

    wrapper.unmount()
    await nextTick()
  })

  it('updates location when prop changes', async () => {
    const el = host()
    const location = ref('北京市')
    const wrapper = mount(
      defineComponent({
        components: { Map, Autocomplete },
        setup: () => () =>
          h(Map, { provider: provider() }, () => [
            h(Autocomplete, { location: location.value, types: ['city'] }),
          ]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    const raw = fake.createdAutocompletes.at(-1)!
    expect(raw.options.location, '对照组：构造期值已生效').toBe('北京市')

    location.value = '上海市'
    await nextTick()
    await flushPromises()
    // 更新经 Driver 的公开入口 setAutocompleteOptions 落到官方 setLocation
    expect(raw.callLog).toContain('setLocation:上海市')
    expect(raw.options.location).toBe('上海市')

    wrapper.unmount()
    await nextTick()
  })
})
