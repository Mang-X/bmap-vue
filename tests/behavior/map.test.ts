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

describe("Map：五条视野命令的 options 从 expose 透到 SDK（#171 / #165 裁决 F）", () => {
  // 这一层锁的是**接线**：`MapExpose` 上那五个命令的 `options` 是否真的走到了 SDK。
  // Driver 侧的投影（哪些键递、哪些键不递、空对象不下发）由
  // `packages/bmap-vue/src/driver/jsapi-v4/map.test.ts` 覆盖，不在这里重复。
  afterEach(() => harness.reset());

  /**
   * 挂一张真图并返回 `{ vm, raw }`（`vm` 是冻结的 `MapExpose`）。
   *
   * `raw` 取**最后一张**而不是 `[0]`：下面的用例会在同一个 fake 上连挂多张图，
   * `createdMaps[0]` 是最早那张，读数会指错对象。
   */
  const mountMap = async () => {
    const wrapper = mount(Map, {
      attachTo: harness.container(),
      props: { provider: harness.provider() },
    });
    await settle();
    return { wrapper, vm: wrapper.vm as any, raw: fake.createdMaps.at(-1)! };
  };

  /** 官方成员名 → `MapExpose` 上的调用入口（用领域语言，不碰内部字段名）。 */
  const EXPOSED_COMMANDS = [
    { method: "setCenter", call: (vm: any, o?: object) => vm.setCenter({ lng: 5, lat: 6 }, o) },
    { method: "setZoom", call: (vm: any, o?: object) => vm.setZoom(7, o) },
    { method: "setHeading", call: (vm: any, o?: object) => vm.setHeading(8, o) },
    { method: "setTilt", call: (vm: any, o?: object) => vm.setTilt(9, o) },
    { method: "panTo", call: (vm: any, o?: object) => vm.panTo({ lng: 5, lat: 6 }, o) },
  ] as const;

  it("options 的 callback 从 expose 递到 SDK 并交付恰好一次", async () => {
    for (const { method, call } of EXPOSED_COMMANDS) {
      const { wrapper, vm, raw } = await mountMap();
      let calls = 0;

      call(vm, {
        noAnimation: true,
        callback: () => {
          calls++;
        },
      });

      expect({ method, calls }).toEqual({ method, calls: 1 });
      expect(raw.callbackDeliveries[method]).toBe(1);
      wrapper.unmount();
      await settle();
    }
  });

  it("不传 options 时不下发空对象（而不是把 `{}` 递给 SDK）", async () => {
    for (const { method, call } of EXPOSED_COMMANDS) {
      const { wrapper, vm, raw } = await mountMap();

      call(vm);

      expect({ method, options: raw.lastCommandOptions[method] }).toEqual({
        method,
        options: null,
      });
      wrapper.unmount();
      await settle();
    }
  });

  it("setZoom 的 zoomCenter 经 expose 递下去且转成 raw Point", async () => {
    const { wrapper, vm, raw } = await mountMap();

    vm.setZoom(12, { zoomCenter: { lng: 121.5, lat: 31.2 }, noAnimation: true });

    const options = raw.lastCommandOptions.setZoom!;
    const zoomCenter = options.zoomCenter as { lng: number; lat: number };
    expect({ lng: zoomCenter.lng, lat: zoomCenter.lat }).toEqual({ lng: 121.5, lat: 31.2 });
    expect(zoomCenter).toBeInstanceOf(fake.namespace.Point);
    expect(options.noAnimation).toBe(true);
    wrapper.unmount();
    await settle();
  });

  it("`<Map>` 没有 noAnimation prop：动画开关是逐调用的，不是组件级的", async () => {
    // 官方**没有** `MapOptions.noAnimation`（#165 Class 5 据此删掉了 `MapProps.noAnimation`）。
    // 它只作为逐调用选项存在——把它做成 prop 会让一个开关决定之后所有命令的动画。
    // 这里从**两个方向**锁住：props 声明里没有它，建图选项里也不会因为它多出任何键。
    const { wrapper, vm, raw } = await mountMap();

    expect("noAnimation" in (Map as any).props).toBe(false);
    // 把一个不存在的 prop 递下去：Vue 会把它落到 attrs 上，不会进建图选项
    const wrapper2 = mount(Map, {
      attachTo: harness.container(),
      props: { provider: harness.provider(), noAnimation: true } as any,
    });
    await settle();
    const second = fake.createdMaps.at(-1)!;
    expect(
      Object.prototype.hasOwnProperty.call(second.options, "noAnimation"),
      "noAnimation 不该出现在建图 options 里（实况：" + JSON.stringify(second.options) + "）",
    ).toBe(false);

    // 但逐调用选项照常可用
    vm.setZoom(3, { noAnimation: true });
    expect(raw.lastCommandOptions.setZoom).toEqual({ noAnimation: true });

    wrapper.unmount();
    wrapper2.unmount();
    await settle();
  });
});

describe("Map：交互开关的「未传」不表态（#179）", () => {
  // `syncEnableProps` 用 `!== undefined` 表达「不表态，交给 SDK 用它自己声明的默认值」。
  // 但 Vue 会把**缺省 `Boolean` prop** 的「没传」强转成 `false`——没在 `withDefaults` 里
  // 显式钉 `undefined`，守卫就永不命中，每个未传的开关都被逐个 `disable*()`。
  // 官方 `core/MapOptions.d.ts` 声明 `@default true` 的 `enableDblclickZoom` /
  // `enablePinchZoom` 因此被静默关掉：用户什么都不写，双指缩放与双击缩放就没了。
  //
  // 这一层断言**领域读数**（开关现在是什么状态 / 下发了多少次调用），不碰字段名以外的东西。
  afterEach(() => harness.reset());

  const mountMap = async (props: Record<string, unknown>) => {
    const host = harness.container();
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(Map, { provider: harness.provider(), ...props }),
      }),
      { attachTo: host },
    );
    await settle();
    return wrapper;
  };

  it("什么都不传：只有两个显式库默认被下发，其余六项一次都没写", async () => {
    // 结论直接落在 harness 的领域读数上，**不**手列任何 SDK 方法名：
    // `interactionWrites()` 的键由 `FAKE_V4_INTERACTIONS` 那份**封闭**词表归并而来
    // （见 harness 的 `interactionNameOf`），所以「不传」时出现的键**必然且仅**是
    // `withDefaults` 里显式给了默认值的那两项。新增第 7 项交互 prop 时这个断言自动跟上，
    // 不需要在这里重抄第三遍名单。
    const wrapper = await mountMap({});
    expect(harness.interactionWrites()).toEqual({
      // `enableDragging: true` / `enableWheelZoom: false` 是**有意**的库默认决策。
      // ⚠️ 键是官方**实例方法名**，不是 prop 名（#165 Class 1 改的是构造期 prop，
      // 落地走的仍是 `enableScrollWheelZoom()`）——见本文件上方那条既有注释。
      enableDragging: 1,
      enableScrollWheelZoom: 1,
    });
    wrapper.unmount();
    await settle();
  });

  it("「没传」时开关状态保持 SDK 自己的默认（不被逐个 disable*()）", async () => {
    // 与上一条分工：那条数**次数**，这条读**状态**——两者一起才能区分
    // 「没下发」与「下发了但值恰好一样」。
    const wrapper = await mountMap({});
    // 正证守卫：`dragging` / `scrollWheelZoom` 有显式默认值，必然在状态里出现。
    expect(harness.interactions()).toEqual({ dragging: true, scrollWheelZoom: false });
    wrapper.unmount();
    await settle();
  });

  it("显式传 false 仍会被 disable*()——「没传」与「传 false」现在分得开了", async () => {
    const wrapper = await mountMap({ enableDblclickZoom: false, enablePinchZoom: false });
    expect(harness.interactions()).toMatchObject({ doubleClickZoom: false, pinchToZoom: false });
    expect(harness.interactionWrites().enableDoubleClickZoom).toBe(1);
    wrapper.unmount();
    await settle();
  });

  it("显式传 true 会真的 enable*()（正证：链路确实接上了，不是「什么都没发生」）", async () => {
    const wrapper = await mountMap({ enableDblclickZoom: true, enablePinchZoom: true });
    expect(harness.interactions()).toMatchObject({ doubleClickZoom: true, pinchToZoom: true });
    expect(harness.interactionWrites()).toMatchObject({ enableDoubleClickZoom: 1, enablePinchToZoom: 1 });
    wrapper.unmount();
    await settle();
  });
});
