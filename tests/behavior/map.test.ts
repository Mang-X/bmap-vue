/**
 * M3: Map/Marker/InfoWindow 行为门禁（Fake v4 后端）
 *
 * 用 Fake Map v4（`createFakeV4Harness`）挂载组件,验证:
 * - Map 创建 runtime,SDK 加载后地图就绪
 * - Map expose whenReady/map 实例
 * - Marker 创建并 addOverlay
 * - InfoWindow 经**地图级** openInfoWindow 打开(v4 的气泡不是普通覆盖物)
 * - 卸载后 Overlay/Map 资源归零
 *
 * M3A3-REMOVE-LEGACY（#26）之后旧引擎的 Fake BMapGL 已删除：Provider 必须是**结构化**的
 * `{ engine, version, namespace }`，读数走 Fake v4 的诊断口径（`harness.assertIdle()` /
 * `diagnostics.snapshot()`），不再有那一组累计创建计数器。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import Marker from '../../packages/bmap-vue/src/components/overlays/Marker.vue'
import InfoWindow from '../../packages/bmap-vue/src/components/overlays/InfoWindow.vue'
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
} from '../../packages/test-utils'

let harness: FakeV4Harness
let fake: FakeBMapV4

beforeEach(() => {
  ;({ harness, fake } = createFakeV4Harness())
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** 挂载/卸载后统一等一轮微任务 + 一次刷新（覆盖 onMounted 里的 whenReady 续体）。 */
async function settle() {
  await flushPromises()
  await nextTick()
}

describe('Map runtime', () => {
  it('creates map via provider and exposes map instance', async () => {
    const host = harness.container()
    const wrapper = mount(Map, {
      attachTo: host,
      props: { provider: harness.provider() },
    })
    await settle()
    const vm = wrapper.vm as any
    expect(vm.getMapInstance()).toBeTruthy()
    // v4 的创建实例账在 `fake.createdMaps`，存活账在诊断的 `leaks.maps`
    expect(fake.createdMaps).toHaveLength(1)
    expect(fake.diagnostics.snapshot().leaks.maps).toBe(1)
    wrapper.unmount()
  })

  it('creates a Marker overlay inside Map', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { Map, Marker },
        setup() {
          const provider = harness.provider()
          return () =>
            h(Map, { provider }, () => [h(Marker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await settle()
    // 创建实例数在 `fake.createdMaps`，存活数在诊断的 `leaks.maps`
    expect(harness.attached('overlay')).toBe(1)
    expect(fake.createdMaps).toHaveLength(1)
    wrapper.unmount()
  })

  it('destroys map and marker on unmount without leakage', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { Map, Marker },
        setup() {
          const provider = harness.provider()
          return () =>
            h(Map, { provider }, () => [h(Marker, { position: { lng: 116.4, lat: 39.9 } })])
        },
      }),
      { attachTo: host },
    )
    await settle()
    expect(harness.attached('overlay')).toBe(1)
    expect(fake.diagnostics.snapshot().leaks.maps).toBe(1)

    wrapper.unmount()
    await settle()
    // 旧 BMapGL fake 里 `map.destroy()` 不自动清 overlay，因此当时只断言 maps / listeners 归零；
    // v4 Driver 的释放路径是「先 removeOverlay 再 map.destroy」，所以整张账（含 overlay）都该归零，
    // 这里用统一门禁一次覆盖。
    harness.assertIdle('Map 卸载')
  })

  it('creates InfoWindow and opens via openInfoWindow', async () => {
    const host = harness.container()
    const wrapper = mount(
      defineComponent({
        components: { Map, InfoWindow },
        setup() {
          const provider = harness.provider()
          return () =>
            h(Map, { provider }, () => [
              h(InfoWindow, { position: { lng: 116.4, lat: 39.9 }, title: 'title', open: true }),
            ])
        },
      }),
      { attachTo: host },
    )
    await settle()
    // 气泡走**地图级**专用入口（map.openInfoWindow），不占 addOverlay 的账：
    // R25-C / #72 之前组件走 `overlays.add(map, infoWindow)`，在 v4 上必抛 BMAP_INVALID_ARGUMENT。
    // 旧 BMapGL fake 用 `map.openInfoWindows`（Set）记账；v4 一张图只有一个气泡，
    // 读法是 `map.infoWindow`（`isOpen()` 是官方公开状态入口）。
    const map = fake.createdMaps.at(-1)!
    expect(map.infoWindow?.isOpen()).toBe(true)
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(0)
    wrapper.unmount()
  })
})

describe("Map：preserveDrawingBuffer 显式 opt-in（#165）", () => {
  // 官方 `Map#getScreenshot` 的前提条件在 `core/Map.d.ts:1022` 的**散文**里（`MapOptions`
  // 声明里没有这个键）。2026-09-26 live 实测：同一张图，不带该选项时 `getScreenshot()`
  // 返回 3,830 字节**空画布**，带上则 119,074 字节真实内容——见
  // `docs/zh-CN/contributing/165-runtime-verification.md`。
  //
  // 因此它必须能通过组件传下去；但**默认不开启**（常驻一块画布内存是库不该替用户做的
  // 取舍，官方 React 参考的惯例同样是「能力进目录 + 显式 opt-in」）。

  afterEach(() => harness.reset());

  const mountMap = async (props: Record<string, unknown>) => {
    const host = harness.container();
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(Map, { provider: harness.provider(), ...props }),
      }),
      { attachTo: host },
    );
    await flushPromises();
    return wrapper;
  };

  it("默认不传该键（不替使用者常驻画布内存）", async () => {
    const wrapper = await mountMap({});
    expect(fake.createdMaps).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(fake.createdMaps[0]!.options, "preserveDrawingBuffer"),
      "默认不该把 preserveDrawingBuffer 塞进建图选项（实况：" + JSON.stringify(fake.createdMaps[0]!.options) + "）",
    ).toBe(false);
    wrapper.unmount();
    await nextTick();
  });

  it("显式开启时透传到建图选项", async () => {
    const wrapper = await mountMap({ preserveDrawingBuffer: true });
    expect(fake.createdMaps).toHaveLength(1);
    expect(fake.createdMaps[0]!.options.preserveDrawingBuffer).toBe(true);
    wrapper.unmount();
    await nextTick();
  });

  it("显式关闭与不传是两回事：关闭会真的把 false 递下去", async () => {
    // Vue 对缺省 `Boolean` 有「转成 false」的陷阱，因此这里用显式 `undefined` 语义
    // 区分「不表态」与「表态为 false」——见 Map.vue 的条件展开。
    const wrapper = await mountMap({ preserveDrawingBuffer: false });
    expect(fake.createdMaps[0]!.options.preserveDrawingBuffer).toBe(false);
    wrapper.unmount();
    await nextTick();
  });
});
