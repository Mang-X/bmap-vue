/**
 * GroundOverlay 行为验证（M5-VECTORS / #31 迁移后）
 *
 * 三个读数口径：
 * - 构造选项记在 Fake 的 `options` 上（实例字段只由 setter 写），因此读 `go.options.*`；
 * - `bounds` 是实例字段，直接读；
 * - 监听 / 资源的释放用 `harness.assertIdle()`（泄漏门禁覆盖「监听 + 资源」两个口径）。
 *
 * 旧 prop 名（`startPoint` + `endPoint`）的兼容读法已随 #136 的集中弃用层删除，`bounds`
 * 因此是**唯一**几何入口、也是必填 prop。必填性本身由 `tests/type-contracts/` 下的
 * 类型契约钉住（那里才是会被 tsc 真正编译的地方）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import GroundOverlay from '../../packages/bmap-vue/src/components/overlays/GroundOverlay.vue'
import { createFakeV4Harness, type FakeV4GroundOverlay } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

type Bounds = { southwest: { lng: number; lat: number }; northeast: { lng: number; lat: number } }

const initialBounds: Bounds = {
  southwest: { lng: 116.4, lat: 39.9 },
  northeast: { lng: 116.5, lat: 40.9 },
}

function mountOverlay(
  bounds = ref<Bounds>(initialBounds),
  overrides: Record<string, unknown> = {},
) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { Map, GroundOverlay },
      setup() {
        return () =>
          h(Map, { provider: provider() }, () => [
            h(GroundOverlay, {
              type: 'image',
              url: 'a.png',
              bounds: bounds.value,
              opacity: 0.5,
              ...overrides,
            }),
          ])
      },
    }),
    { attachTo: el },
  )
  return { wrapper, bounds }
}

/** 当前地图上挂着的 GroundOverlay。 */
function currentGroundOverlay(): FakeV4GroundOverlay {
  return fake.createdMaps[fake.createdMaps.length - 1]!.overlays[0] as FakeV4GroundOverlay
}

describe('GroundOverlay', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('creates ground overlay with bounds and opacity', async () => {
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(harness.attached('overlay')).toBe(1)
    const go = currentGroundOverlay()
    expect(go.options.opacity).toBe(0.5)
    expect(go.options.url).toBe('a.png')
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(116.45, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('updates bounds via field-level update（不重建实例）', async () => {
    const bounds = ref<Bounds>(initialBounds)
    const { wrapper } = mountOverlay(bounds)
    await flushPromises()
    const go = currentGroundOverlay()
    const created = fake.createdOverlays.length

    bounds.value = {
      southwest: { lng: 100, lat: 30 },
      northeast: { lng: 116.5, lat: 40.9 },
    }
    await nextTick()

    // 字段级更新：同一个实例、恰好一条 setBounds
    expect(fake.createdOverlays.length).toBe(created)
    expect(currentGroundOverlay()).toBe(go)
    expect(go.bounds.getCenter()!.lng).toBeCloseTo(108.25, 2)
    wrapper.unmount()
    await nextTick()
  })

  it('#138：改 recreate 字段后重建，新实例用的是**更新后**的构造值（不是 setup 快照）', async () => {
    // `type` 是构造期字段（实例上没有 `setType`）⇒ 变更必须重建。断言的重点不在
    // 「重建了几次」，而在**新一代的构造选项**：`lifecycleProps` 若是 setup 时的一次性快照，
    // 实例虽然重建了，`options.type` 仍会是旧值（#138 评审 P1）。
    const type = ref<'image' | 'canvas'>('image')
    const el = host()
    const wrapper = mount(
      defineComponent({
        components: { Map, GroundOverlay },
        setup() {
          return () =>
            h(Map, { provider: provider() }, () => [
              h(GroundOverlay, {
                type: type.value,
                url: 'a.png',
                bounds: initialBounds,
                autoCenter: false,
              }),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    const created = fake.createdOverlays.length
    expect(currentGroundOverlay().options.type).toBe('image')

    type.value = 'canvas'
    await flushPromises()

    expect(fake.createdOverlays.length, '构造期字段变更 ⇒ 恰好重建一次').toBe(created + 1)
    const fresh = currentGroundOverlay()
    // 新实例的构造值必须来自**当前** prop，而不是 setup 时的物化快照
    expect(fresh.options.type, '新一代的 ctor options 必须用更新后的值').toBe('canvas')

    wrapper.unmount()
    await nextTick()
    harness.assertIdle('GroundOverlay recreate')
  })

  it('#138：重建后 url 惰性工厂仍然是「一代一次」，不是每代两次', async () => {
    // `materializeLifecycleProps` 按代物化（#138 评审 P1 修复），因此必须钉住
    // 「同一代里 `create` 与 `mount` 共用一份快照」——否则惰性工厂每代求值两次，
    // 交给 SDK 的 canvas 与校验过的 canvas 会变成两个实例（PR #103 评审 2 的契约）。
    let calls = 0;
    const factory = (): string => {
      calls += 1;
      return `canvas-${calls}.png`;
    };
    const type = ref<'image' | 'canvas'>('image');
    const el = host();
    const wrapper = mount(
      defineComponent({
        components: { Map, GroundOverlay },
        setup() {
          return () =>
            h(Map, { provider: provider() }, () => [
              h(GroundOverlay, {
                type: type.value,
                url: factory,
                bounds: initialBounds,
                autoCenter: false,
              } as never),
            ])
        },
      }),
      { attachTo: el },
    )
    await flushPromises()
    expect(calls, '首次创建：一代一次').toBe(1)
    expect(currentGroundOverlay().options.url).toBe('canvas-1.png')

    // 账本是跨用例累计的（`harness.reset()` 只重置诊断计数），因此用相对读数
    const beforeRebuild = fake.createdOverlays.length
    type.value = 'canvas'
    await flushPromises()
    expect(fake.createdOverlays.length).toBe(beforeRebuild + 1)
    // 第二代重新求值一次（**不是**两次：create 一次、mount 再一次）
    expect(calls, '重建：新一代恰好再求值一次').toBe(2)
    expect(currentGroundOverlay().options.url, '新一代用的是新一代求值的来源').toBe('canvas-2.png')

    wrapper.unmount()
    await nextTick()
    harness.assertIdle('GroundOverlay 重建后 url 工厂')
  })

  it('releases listeners on unmount', async () => {
    const { wrapper } = mountOverlay()
    await flushPromises()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    harness.assertIdle('GroundOverlay 卸载')
  })
})
