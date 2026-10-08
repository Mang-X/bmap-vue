/**
 * useAreaBoundary 验证（含真 Driver 全链路）
 *
 * 官方的 `Boundary` 有**两个**成员：`get(name, cb)`（联网按行政区名查）与
 * `parsebdStr(str, cb)`（本地解析混淆坐标串）。两者回包同形（`BoundaryResult`），
 * 本 composable 把两条路径都接到同一份 `data` / `boundaries` 上。
 *
 * 假 SDK 的 `FakeV4Boundary` 按调用逐条记账，因此能断言**真的调到了哪个成员、带什么参数**，
 * 而不是只看返回值（那样两个成员可以互相顶替）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { useAreaBoundary } from '../../packages/bmap-vue/src/composables/useAreaBoundary'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

function mountWithChild(
  child: (boundary: ReturnType<typeof useAreaBoundary>) => Promise<void> | void,
) {
  const el = host()
  const Child = defineComponent({
    setup() {
      const boundary = useAreaBoundary()
      onMounted(async () => {
        await child(boundary)
      })
      return () => h('div', 'boundary')
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

/** 最近一次 Boundary 实例收到的调用流水。 */
function boundaryCallLog(): string[] {
  const boundary = fake.createdBoundaries.at(-1)
  expect(boundary, '没有建出 Boundary 实例').toBeTruthy()
  return boundary!.callLog
}

describe('useAreaBoundary', () => {
  beforeEach(() => harness.reset())

  it('get(area) 走官方 Boundary#get，并把官方点串原样给出', async () => {
    let result: any = null
    const { wrapper } = mountWithChild(async (boundary) => {
      result = await boundary.get('北京市')
    })
    await flushPromises()
    await nextTick()

    expect(result.status).toBe('success')
    // 官方点串形态是公开契约的一部分（isBoundary 直接吃它），不做归一
    expect(result.data).toEqual(['116.30,39.90;116.31,39.91;116.30,39.90'])
    expect(boundaryCallLog()).toEqual(['get:北京市'])
    wrapper.unmount()
    await nextTick()
  })

  it('parsebdStr(str) 走官方 Boundary#parsebdStr，参数与结果都落到同一份 data', async () => {
    let result: any = null
    let live: string[] | undefined
    const { wrapper } = mountWithChild(async (boundary) => {
      result = await boundary.parsebdStr('obfuscated@bd09')
      await nextTick()
      live = boundary.boundaries.value
    })
    await flushPromises()
    await nextTick()

    expect(result.status).toBe('success')
    expect(boundaryCallLog()).toEqual(['parsebdStr:obfuscated@bd09'])
    // 两个成员回包同形，因此共用 data / boundaries
    expect(result.data).toEqual(['116.30,39.90;116.31,39.91;116.30,39.90'])
    expect(live).toEqual(['116.30,39.90;116.31,39.91;116.30,39.90'])
    wrapper.unmount()
    await nextTick()
  })

  it('parsebdStr 没有结果时结算为 empty（不伪装成 failed）', async () => {
    let result: any = null
    const { wrapper } = mountWithChild(async (boundary) => {
      // 触发实例创建后把回包设成空数组：官方 `BoundaryResult` 在、但 boundaries 为空 = 查无结果
      await boundary.get('warmup')
      fake.createdBoundaries.at(-1)!.boundaries = []
      result = await boundary.parsebdStr('empty-ring')
    })
    await flushPromises()
    await nextTick()

    expect(result.status).toBe('empty')
    expect(result.data).toBeNull()
    expect(boundaryCallLog()).toContain('parsebdStr:empty-ring')
    wrapper.unmount()
    await nextTick()
  })

  it('接口只暴露官方两个成员名，没有 `get` 之外的别名', async () => {
    let keys: string[] = []
    const { wrapper } = mountWithChild(async (boundary) => {
      keys = Object.keys(boundary).sort()
    })
    await flushPromises()
    await nextTick()

    expect(keys).toContain('get')
    expect(keys).toContain('parsebdStr')
    // 官方 `Boundary` 只有 get / parsebdStr 两个动作成员，不额外造别名
    expect(keys).not.toContain('parse')
    wrapper.unmount()
    await nextTick()
  })
})
