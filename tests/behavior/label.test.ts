/**
 * Label 行为门禁（Fake v4 后端）
 *
 * #26 之后旧引擎 Fake BMapGL 已删除。两处形状差异：
 * - 样式：旧 BMapGL 的 Label 是单数 `setStyle`（fake 直接写 `label.style`）；v4 是复数
 *   `setStyles`，构造键为 `styles`，且组件把首帧样式经**构造 options** 传入，
 *   因此首帧样式读 `label.options.styles`（字段级 `setStyles` 才会写 `label.styles`）。
 * - 位置：v4 的 Label 把构造期位置写在 options 里（`label.options.position`），
 *   而字段级更新走 `setPosition` 并落到 `label.position`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Label from '../../packages/bmap-vue/src/components/overlays/Label.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Label,
} from '../../packages/test-utils'

let harness: FakeV4Harness
let fake: FakeBMapV4

beforeEach(() => {
  ;({ harness, fake } = createFakeV4Harness())
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function settle() {
  await flushPromises()
  await nextTick()
}

/** 最后一张地图上挂着的标注（这些用例里就是那个唯一的 Label）。 */
function firstLabel(): FakeV4Label {
  return fake.createdMaps.at(-1)!.overlays[0] as FakeV4Label
}

function mountLabel(position = ref({ lng: 116.4, lat: 39.9 })) {
  const el = harness.container()
  const wrapper = mount(
    defineComponent({
      components: { Map, Label },
      setup() {
        return () =>
          h(Map, { provider: harness.provider() }, () => [
            h(Label, { content: 'hello', position: position.value, style: { color: 'red' } }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, position }
}

describe('Label', () => {
  it('creates label with content, position and style', async () => {
    const { wrapper } = mountLabel()
    await settle()
    // 旧口径顶层计数器 `overlaysCreated === 1`；v4 同一事实是活动口径里的挂载次数
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(1)
    const label = firstLabel()
    // content 与旧口径同名同义（构造期第一个位置参数）
    expect(label.content).toBe('hello')
    // 旧断言是 `label.style.color === 'red'`；v4 上承载首帧样式的是构造 options 的 `styles`
    expect((label.options.styles as { color: string } | undefined)?.color).toBe('red')
    wrapper.unmount()
    await nextTick()
  })

  it('updates content and position via field-level watch', async () => {
    const position = ref({ lng: 116.4, lat: 39.9 })
    const { wrapper } = mountLabel(position)
    await settle()

    position.value = { lng: 0, lat: 0 }
    await nextTick()
    const label = firstLabel()
    expect(label.position!.lng).toBe(0)
    expect(label.position!.lat).toBe(0)
    wrapper.unmount()
    await nextTick()
  })

  it('releases listeners and label on unmount', async () => {
    const { wrapper } = mountLabel()
    await settle()
    // 旧读数顶层计数器 `listeners`;Fake v4 的同一事实是诊断的存活监听器数
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('Label 卸载')
  })
})
