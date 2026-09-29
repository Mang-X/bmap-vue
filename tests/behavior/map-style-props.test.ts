/**
 * #165 Class 2 / H：`<Map>` 的 `mapStyleId` / `mapStyleJson` 两个 prop。
 *
 * 官方 `setMapStyle(config: MapStyleConfig)` 声明三个成员：`styleId?: string` /
 * `styleJson?: object[]` / `merge?: boolean`（`core/MapStyleConfig.d.ts`）。
 * 本库此前有两个问题叠在一起：
 *
 * 1. **形状错位**：`mapStyleJson?: Record<string, unknown>`（单数对象），官方是 **`object[]`**；
 * 2. **静默丢弃**：两个 prop 都给时走 `if / else if`，**先到的那条赢、另一条无声消失**
 *    —— 正是 AGENTS.md「接收后忽略属于假支持」的那一类。
 *
 * live 实测（`docs/zh-CN/contributing/165-runtime-verification.md`）：官方运行时对
 * `styleJson` 给**数组**和给**对象**都接受（两次都拿到 `customNN` 样式 id），但
 * `styleId` 与 `styleJson` 同时给时**结果取决于 SDK 内部的合并顺序**——那不是本库能
 * 复现的语义，因此**在组件层判掉**并显式失败，而不是猜一个赢家。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { createFakeV4Harness, type FakeBMapV4, type FakeV4Harness } from '../../packages/test-utils'

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

/** 挂一张图并等就绪，返回 Fake 上的 `mapStyle` 字段（`null` = 没下发过样式）。 */
async function mountAndReadMapStyle(props: Record<string, unknown>) {
  const host = harness.container()
  const wrapper = mount(Map, { attachTo: host, props: { provider: harness.provider(), ...props } })
  await settle()
  const created = fake.createdMaps[0]
  const style = created?.mapStyle ?? null
  wrapper.unmount()
  await settle()
  return style
}

describe('<Map> 的 mapStyle props（#165 Class 2 / H）', () => {
  it('只给 mapStyleId 时下发的就是 { styleId }', async () => {
    expect(await mountAndReadMapStyle({ mapStyleId: 'a1' })).toEqual({ styleId: 'a1' })
  })

  it('mapStyleJson 按官方形状下发：styleJson 是**数组**（`MapStyleConfig.styleJson?: object[]`）', async () => {
    const styleJson = [{ featureType: 'water', stylers: [{ color: '#0040a0' }] }]
    expect(await mountAndReadMapStyle({ mapStyleJson: styleJson })).toEqual({ styleJson })
  })

  it('两个 prop 同时给 ⇒ 显式失败，**不**静默丢一个', async () => {
    // 静默丢弃的判据：SDK 侧拿到的配置**不能**是「只含其中一个键」——
    // 组件层必须先把这两者判掉，因此压根不该有样式下发。
    expect(
      await mountAndReadMapStyle({ mapStyleId: 'a1', mapStyleJson: [{ featureType: 'water' }] }),
      'mapStyleId / mapStyleJson 都被接受却只下发一个 = 静默丢弃',
    ).toBeNull()
  })
})
