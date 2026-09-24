/**
 * BPanoramaControl / BBezierCurve / BMapMask / BMarker3d 迁移验证
 *
 * #26 之后组件默认路径直接走 v4 Driver。两处与 BMapGL 时代的读法差异：
 *
 * 1. `map.overlays` / `map.controls` 在 Fake v4 里是**数组**（BMapGL fake 里是 `Set`），
 *    覆盖物的点集字段是 `path`（BMapGL 的 fake 叫 `points`）；
 * 2. `BMapMask` / `BMarker3d` 依赖的 `BMap.MapMask` / `BMap.Marker3D` **不在** Fake v4 的
 *    命名空间里（4.0.4 类型包也没有类声明，真实运行时才异步注入）。因此这两条用例在 v4 上
 *    的可观察事实是**显式失败**（`BMAP_CAPABILITY_UNSUPPORTED` 经 `resource:error` 交出），
 *    而不是静默降级成一个假的覆盖物。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/bmap-vue/src/components/map/BMap.vue'
import BPanoramaControl from '../../packages/bmap-vue/src/components/controls/BPanoramaControl.vue'
import BControl from '../../packages/bmap-vue/src/components/controls/BControl.vue'
import BBezierCurve from '../../packages/bmap-vue/src/components/overlays/BBezierCurve.vue'
import BMapMask from '../../packages/bmap-vue/src/components/overlays/BMapMask.vue'
import BMarker3d from '../../packages/bmap-vue/src/components/overlays/BMarker3d.vue'
import { useRequiredMapContext } from '../../packages/bmap-vue/src/core/context/inject'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

/** 当前（最后一张）地图 —— 覆盖物/控件读数一律以它为准。 */
function currentMap() {
  return fake.createdMaps.at(-1)!
}

/** 订阅组件树里的 `resource:error`（组件把创建失败经这条通道交出来）。 */
function errorProbe() {
  const errors: Array<{ code?: string; message?: string }> = []
  const Probe = defineComponent({
    setup() {
      const ctx = useRequiredMapContext()
      ctx.events.on('resource:error', (payload) => {
        errors.push((payload as { error?: { code?: string; message?: string } }).error ?? {})
      })
      return () => h('i')
    },
  })
  return { errors, Probe }
}

function mountInMap(children: () => any[], props: Record<string, unknown> = {}) {
  const el = host()
  const wrapper = mount(
    defineComponent({
      components: { BMap },
      setup: () => () => h(BMap, { provider: provider(), ...props }, children),
    }),
    { attachTo: el },
  )
  return wrapper
}

describe('BMap extra overlays/controls v3', () => {
  beforeEach(() => harness.reset())

  it('BPanoramaControl adds a panorama control and toggles visible', async () => {
    const wrapper = mountInMap(() => [h(BPanoramaControl, { visible: true })])
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BControl creates a custom control with slot DOM', async () => {
    const wrapper = mountInMap(() => [
      h(BControl, { anchor: 'BMAP_ANCHOR_TOP_LEFT' }, () => [h('div', { class: 'my-control' }, 'hello')]),
    ])
    await flushPromises()
    const map = currentMap()
    expect(map.controls).toHaveLength(1)
    const control = map.controls[0] as any
    // 原来是 `expect(control.defaultAnchor).toBeTruthy()`；v4 上锚点常量被归一成 4.0 的数值
    // （`BMAP_ANCHOR_TOP_LEFT` → 0），因此 0 才是「确实落上了 TOP_LEFT」的可观察事实。
    expect(control.defaultAnchor).toBe(0)
    expect(control.attachedMap).toBe(map)
    // slot DOM 真的被挂进了地图容器（自定义控件契约：addControl → initialize → render(container)）
    const slotEl = document.querySelector('.my-control') as HTMLElement
    expect(slotEl, 'BControl 必须把 slot DOM 挂出去').toBeTruthy()
    expect(map.container.contains(slotEl)).toBe(true)
    wrapper.unmount()
    await nextTick()
    expect(map.controls).toHaveLength(0)
  })

  it('BBezierCurve creates bezier with path/controlPoints and updates', async () => {
    const path = ref([{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }])
    const cps = ref([[{ lng: 1.5, lat: 1.2 }], [{ lng: 2.5, lat: 2.2 }]])
    const wrapper = mountInMap(() => [
      h(BBezierCurve, { path: path.value, controlPoints: cps.value, strokeColor: '#112233' }),
    ])
    await flushPromises()
    const map = currentMap()
    expect(harness.attached('overlay')).toBe(1)
    const bezier = map.overlays[0] as any
    // 原来是 `bezier.points`；Fake v4 的带路径图形用官方的 `path` 字段承载点集
    expect(bezier.path).toHaveLength(2)
    expect(bezier.controlPoints).toHaveLength(2)
    expect(bezier.options.strokeColor).toBe('#112233')

    path.value = [{ lng: 10, lat: 10 }]
    await nextTick()
    expect(bezier.path).toHaveLength(1)
    expect(bezier.path[0].lng).toBe(10)
    wrapper.unmount()
    await nextTick()
  })

  it('BBezierCurve releases listeners on unmount', async () => {
    const wrapper = mountInMap(() => [
      h(BBezierCurve, {
        path: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }],
        controlPoints: [[{ lng: 1.5, lat: 1.2 }]],
      }),
    ])
    await flushPromises()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0)
    wrapper.unmount()
    await nextTick()
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('BBezierCurve 卸载')
  })

  it('BMapMask 在 v4 上是显式失败（Fake v4 的命名空间没有 MapMask）', async () => {
    const { errors, Probe } = errorProbe()
    const wrapper = mountInMap(() => [
      h(BMapMask, { path: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }, { lng: 3, lat: 3 }], showRegion: 'outside' }),
      h(Probe),
    ])
    await flushPromises()
    // 原来是：`fake.stats.overlaysCreated` 为 1 且 mask 的 points/options 落在覆盖物上。
    // v4 上 `MapMask` 不在 Fake 命名空间里（真实运行时才注入），因此组件走显式失败路径：
    // 报 `BMAP_CAPABILITY_UNSUPPORTED`，且**不留下半成品覆盖物**（不静默降级）。
    expect(errors.map((e) => e.code)).toEqual(['BMAP_CAPABILITY_UNSUPPORTED'])
    expect(errors[0]?.message).toContain('MapMask')
    expect(currentMap().overlays).toHaveLength(0)
    wrapper.unmount()
    await nextTick()
    harness.assertIdle('BMapMask 显式失败')
  })

  it('BMarker3d 在 v4 上是显式失败（Fake v4 的命名空间没有 Marker3D）', async () => {
    const { errors, Probe } = errorProbe()
    const pos = ref({ lng: 116.4, lat: 39.9 })
    const wrapper = mountInMap(() => [
      h(BMarker3d, { position: pos.value, height: 1000, size: 20, fillColor: '#00ff00' }),
      h(Probe),
    ])
    await flushPromises()
    // 原来是：marker3d 的 position/height/options 落在覆盖物上并随 position 更新。
    // v4 上 `Marker3D` 同样不在 Fake 命名空间里 → 显式失败，且不挂任何覆盖物。
    expect(errors.map((e) => e.code)).toEqual(['BMAP_CAPABILITY_UNSUPPORTED'])
    expect(errors[0]?.message).toContain('Marker3D')
    expect(currentMap().overlays).toHaveLength(0)

    pos.value = { lng: 120, lat: 30 }
    await nextTick()
    expect(currentMap().overlays).toHaveLength(0)
    wrapper.unmount()
    await nextTick()
    harness.assertIdle('BMarker3d 显式失败')
  })
})
