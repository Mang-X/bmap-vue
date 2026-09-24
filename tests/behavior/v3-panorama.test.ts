/**
 * 全景查看器 / 标注 / 检索（M7-CONTROL-PANORAMA / issue #41）
 *
 * 三块覆盖，对应 issue 的「测试要求」：
 *
 * | 要求 | 落在哪一节 |
 * | --- | --- |
 * | Panorama viewer/service lifecycle | 「viewer 生命周期」+「usePanoramaService」 |
 * | 真实 v4 常用控件 smoke | `tests/browser/jsapi-v4/main.ts` 的 `panorama-viewer` 检查（本文件是
 *   Fake 档的同名语义） |
 *
 * 以及一份**Context 隔离**的证据：`<Panorama>` 只需要 Client，不需要地图实例，因此它能长在
 * `<BMapProvider>` 子树里；而「Panorama 内部 Map 不是普通 MapContext」这条非目标也因此可断言
 * ——`<PanoramaLabel>` 只认 `PanoramaContext`，脱离 `<Panorama>` 会明确失败。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted, reactive, ref, type Component } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
import PanoramaLabel from "../../packages/bmap-vue/src/components/panorama/PanoramaLabel.vue";
import { usePanoramaService } from "../../packages/bmap-vue/src/composables/usePanoramaService";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();
const host = () => harness.container();

const POINT = { lng: 116.404, lat: 39.915 };

/** 最近一次创建的查看器（含已被销毁的）。 */
const lastViewer = () => fake.createdPanoramas.at(-1)!;
const lastLabel = () => fake.createdPanoramaLabels.at(-1)!;
const leaks = () => fake.diagnostics.snapshot().leaks;

/**
 * 实例账本（`createdXxx`）**不受 `harness.reset()` 影响**——它只重置诊断计数。
 * 因此所有「创建了几个」的断言都用增量，而不是绝对值（否则会读到上一个用例留下的实例）。
 */
function baseline() {
  return {
    panoramas: fake.createdPanoramas.length,
    labels: fake.createdPanoramaLabels.length,
    services: fake.createdPanoramaServices.length,
    maps: fake.createdMaps.length,
  };
}

function mountIn(
  hostComponent: Component,
  slots: () => unknown,
  hostProps: Record<string, unknown> = {},
) {
  return mount(
    defineComponent({
      setup: () => () => h(hostComponent, { provider: provider(), ...hostProps }, slots as never),
    }),
    { attachTo: host() },
  );
}

describe("Panorama：查看器生命周期", () => {
  beforeEach(() => harness.reset());

  it("挂载创建一个查看器，卸载后实例被销毁且无泄漏", async () => {
    const before = baseline();
    const wrapper = mountIn(Map, () => [h(Panorama, { point: POINT })]);
    await flushPromises();
    await nextTick();

    const viewer = lastViewer();
    expect(fake.createdPanoramas.length).toBe(before.panoramas + 1);
    expect(viewer.callLog).toContain("setPosition");
    expect(viewer.position).toEqual(POINT);
    expect(leaks().panoramas).toBe(1);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(viewer.destroyCalls).toBe(1);
    expect(leaks().panoramas).toBe(0);
    harness.assertIdle("Panorama 卸载");
  });

  it("在 <BMapProvider> 子树里同样可用（全景只需要 Client，不需要地图实例）", async () => {
    const before = baseline();
    const wrapper = mountIn(BMapProvider, () => [h(Panorama, { id: "pano-1" })]);
    await flushPromises();
    await nextTick();

    const viewer = lastViewer();
    expect(fake.createdPanoramas.length).toBe(before.panoramas + 1);
    expect(viewer.callLog).toContain("setId:pano-1");
    expect(viewer.getId()).toBe("pano-1");
    // 整棵树里没有地图：`<Map>` 没有参与
    expect(fake.createdMaps.length).toBe(before.maps);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(leaks().panoramas).toBe(0);
  });

  it("查看器容器就是本组件渲染出的宿主 DOM", async () => {
    const wrapper = mountIn(Map, () => [h(Panorama, { point: POINT })]);
    await flushPromises();
    await nextTick();
    const container = lastViewer().container as HTMLElement;
    // 容器是**本组件渲染出的宿主 div**：在组件树里、是 `<Map>` 容器的后代，
    // 但不是地图容器本身（用 class 区分，比按顺序取第几个 div 稳）
    expect(container.tagName).toBe("DIV");
    expect(container.className).not.toContain("bmap-container");
    expect((wrapper.element as HTMLElement).contains(container)).toBe(true);
    expect(wrapper.findAllComponents(Panorama)).toHaveLength(1);
    wrapper.unmount();
    await nextTick();
  });
});

describe("Panorama：受控写入", () => {
  beforeEach(() => harness.reset());

  it("point / pov / zoom / visible 变化都会下发", async () => {
    const props = ref<Record<string, unknown>>({ point: POINT, visible: true });
    const wrapper = mountIn(Map, () => [h(Panorama, props.value)]);
    await flushPromises();
    await nextTick();
    const viewer = lastViewer();

    props.value = { ...props.value, point: { lng: 121.47, lat: 31.23 } };
    await nextTick();
    await nextTick();
    expect(viewer.position).toEqual({ lng: 121.47, lat: 31.23 });

    props.value = { ...props.value, pov: { heading: 90, pitch: -10 } };
    await nextTick();
    await nextTick();
    expect(viewer.pov).toMatchObject({ heading: 90, pitch: -10 });

    props.value = { ...props.value, zoom: 3 };
    await nextTick();
    await nextTick();
    expect(viewer.getZoom()).toBe(3);

    props.value = { ...props.value, visible: false };
    await nextTick();
    await nextTick();
    expect(viewer.getVisible()).toBe(false);

    wrapper.unmount();
    await nextTick();
  });

  it("scrollWheelZoom 走成对的 enable / disable，poiType 走 setPanoramaPOIType", async () => {
    const props = ref<Record<string, unknown>>({ point: POINT });
    const wrapper = mountIn(Map, () => [h(Panorama, props.value)]);
    await flushPromises();
    await nextTick();
    const viewer = lastViewer();

    props.value = { ...props.value, scrollWheelZoom: true };
    await nextTick();
    await nextTick();
    expect(viewer.scrollWheelZoom).toBe(true);

    props.value = { ...props.value, scrollWheelZoom: false };
    await nextTick();
    await nextTick();
    expect(viewer.scrollWheelZoom).toBe(false);

    props.value = { ...props.value, poiType: "catering" };
    await nextTick();
    await nextTick();
    expect(viewer.poiType).toBe("catering");

    wrapper.unmount();
    await nextTick();
  });

  it("options 构造期给一次，变化时经 setOptions 整体写回", async () => {
    const props = ref<Record<string, unknown>>({
      point: POINT,
      options: { navigationControl: false },
    });
    const wrapper = mountIn(Map, () => [h(Panorama, props.value)]);
    await flushPromises();
    await nextTick();
    const viewer = lastViewer();
    // 构造期已经收到
    expect(viewer.options).toMatchObject({ navigationControl: false });

    props.value = { ...props.value, options: { navigationControl: true, linksControl: false } };
    await nextTick();
    await nextTick();
    expect(viewer.callLog).toContain("setOptions");
    expect(viewer.options).toMatchObject({ navigationControl: true, linksControl: false });

    wrapper.unmount();
    await nextTick();
  });
});

describe("Panorama：事件回报（*_changed 的载荷来自回读 getter）", () => {
  beforeEach(() => harness.reset());

  it("position_changed / zoom_changed / id_changed / scene_type_changed / links_changed / dataload / pano_error", async () => {
    const seen = ref<Record<string, unknown>>({});
    const Probe = defineComponent({
      setup() {
        return () =>
          h(Panorama, {
            point: POINT,
            onPositionChange: (position: unknown) => (seen.value.position = position),
            onZoomChange: (zoom: unknown) => (seen.value.zoom = zoom),
            onIdChange: (id: unknown) => (seen.value.id = id),
            onSceneTypeChange: (sceneType: unknown) => (seen.value.sceneType = sceneType),
            onLinksChange: () => (seen.value.links = true),
            onLoad: (event: unknown) => (seen.value.load = event),
            onError: (event: unknown) => (seen.value.error = event),
          });
      },
    });
    const wrapper = mountIn(Map, () => [h(Probe)]);
    await flushPromises();
    await nextTick();
    const viewer = lastViewer();

    // SDK 内部状态变化 + 派发事件（与真实 SDK 一样：事件不带值，组件回读）
    viewer.position = { lng: 116.5, lat: 40.0 };
    viewer.emit("position_changed");
    viewer.zoom = 4;
    viewer.emit("zoom_changed");
    viewer.id = "pano-9";
    viewer.emit("id_changed", "pano-9");
    viewer.sceneType = "inter";
    viewer.emit("scene_type_changed");
    viewer.emit("links_changed");
    viewer.emit("dataload", { data: { id: "pano-9" } });
    viewer.emit("pano_error", { reason: "boom" });
    await nextTick();

    expect(seen.value.position).toEqual({ lng: 116.5, lat: 40.0 });
    expect(seen.value.zoom).toBe(4);
    expect(seen.value.id).toBe("pano-9");
    expect(seen.value.sceneType).toBe("inter");
    expect(seen.value.links).toBe(true);
    expect(seen.value.load).toMatchObject({ data: { id: "pano-9" } });
    expect(seen.value.error).toMatchObject({ reason: "boom" });

    wrapper.unmount();
    await nextTick();
  });
});

describe("PanoramaLabel：标注生命周期", () => {
  beforeEach(() => harness.reset());

  it("挂载后挂到查看器上，卸载后摘除（标注泄漏归零）", async () => {
    const before = baseline();
    const wrapper = mountIn(Map, () => [
      h(Panorama, { point: POINT }, () => [
        h(PanoramaLabel, { content: "标签", position: POINT, altitude: 5 }),
      ]),
    ]);
    await flushPromises();
    await nextTick();

    const label = lastLabel();
    expect(fake.createdPanoramaLabels.length).toBe(before.labels + 1);
    expect(label.getContent()).toBe("标签");
    expect(label.getAltitude()).toBe(5);
    expect(lastViewer().overlays).toHaveLength(1);
    expect(leaks().panoramaLabels).toBe(1);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    // 子组件先摘自己（父的 onUnmounted 晚于子树），再由父销毁查看器
    expect(lastViewer().overlays).toHaveLength(0);
    expect(leaks().panoramaLabels).toBe(0);
    harness.assertIdle("PanoramaLabel 卸载");
  });

  it("content / position / altitude 有 setter ⇒ 就地更新", async () => {
    const before = baseline();
    const props = ref<Record<string, unknown>>({
      content: "第一版",
      position: POINT,
      altitude: 2,
    });
    const wrapper = mountIn(Map, () => [
      h(Panorama, { point: POINT }, () => [h(PanoramaLabel, props.value)]),
    ]);
    await flushPromises();
    await nextTick();
    const label = lastLabel();

    props.value = { content: "第二版", position: { lng: 1, lat: 2 }, altitude: 9 };
    await nextTick();
    await nextTick();
    expect(label.callLog).toContain("setContent");
    expect(label.callLog).toContain("setPosition");
    expect(label.callLog).toContain("setAltitude");
    expect(label.getContent()).toBe("第二版");
    expect(label.position).toEqual({ lng: 1, lat: 2 });
    expect(label.getAltitude()).toBe(9);
    // 就地更新 ⇒ 没有重建
    expect(fake.createdPanoramaLabels.length).toBe(before.labels + 1);

    wrapper.unmount();
    await nextTick();
  });

  it("displayDistance 只有构造期 ⇒ 重建标注并把新值交给构造期", async () => {
    const before = baseline();
    const props = ref<Record<string, unknown>>({ content: "标签", position: POINT });
    const wrapper = mountIn(Map, () => [
      h(Panorama, { point: POINT }, () => [h(PanoramaLabel, props.value)]),
    ]);
    await flushPromises();
    await nextTick();
    const first = lastLabel();

    props.value = { ...props.value, displayDistance: false };
    await nextTick();
    await flushPromises();
    expect(fake.createdPanoramaLabels.length).toBe(before.labels + 2);
    const second = lastLabel();
    expect(second).not.toBe(first);
    expect(second.options.displayDistance).toBe(false);
    // 重建是原子的：旧标注已经摘掉、新标注挂上，总数仍是 1
    expect(lastViewer().overlays).toHaveLength(1);
    expect(leaks().panoramaLabels).toBe(1);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(leaks().panoramaLabels).toBe(0);
  });

  it("脱离 <Panorama> 时明确失败（不把全景内部容器当成普通 MapContext）", () => {
    // 失败发生在 `setup`（inject 拿不到 PanoramaContext），Vue 在测试环境会把它抛出来
    expect(() =>
      mount(
        defineComponent({
          setup: () => () => h(Map, { provider: provider() }, () => [h(PanoramaLabel, {})]),
        }),
        { attachTo: host() },
      ),
    ).toThrow(/Panorama/);
  });
});

describe("usePanoramaService：检索状态层", () => {
  beforeEach(() => harness.reset());

  function mountConsumer(run: (service: ReturnType<typeof usePanoramaService>) => void) {
    const Child = defineComponent({
      setup() {
        const service = usePanoramaService();
        onMounted(() => run(service));
        return () => h("div");
      },
    });
    return mount(
      defineComponent({
        setup: () => () => h(BMapProvider, { provider: provider() }, () => [h(Child)]),
      }),
      { attachTo: host() },
    );
  }

  it("findById 拿到回包（不需要地图实例，也不需要 <Panorama>）", async () => {
    const before = baseline();
    let data: unknown = null;
    let status = "";
    const wrapper = mountConsumer((service) => {
      void service.findById("pano-1").then((result) => {
        data = result.data;
        status = result.status;
      });
    });
    await flushPromises();
    await flushPromises();
    expect(status).toBe("success");
    expect(data).toEqual({
      id: "pano-1",
      description: "天安门全景",
      position: { lng: 116.404, lat: 39.915 },
    });
    expect(fake.createdMaps.length).toBe(before.maps);

    wrapper.unmount();
    await nextTick();
  });

  it("findByLocation：省略半径走两参重载，给半径走三参重载", async () => {
    const before = baseline();
    const statuses: string[] = [];
    const wrapper = mountConsumer((api) => {
      // **顺序**调用：并发下的取代语义属于 `useServiceTask` 的契约（已有专门用例），
      // 这一条要验的是「两种重载形态都真的打到了 SDK」。
      void api
        .findByLocation({ lng: 116.4, lat: 39.9 })
        .then((r) => statuses.push(r.status))
        .then(() => api.findByLocation({ lng: 116.4, lat: 39.9 }, 200))
        .then((r) => statuses.push(r.status));
    });
    await flushPromises();
    await flushPromises();
    expect(statuses).toEqual(["success", "success"]);
    // 两个调用共用同一个服务实例（`useServiceTask` 的实例缓存）
    expect(fake.createdPanoramaServices.length).toBe(before.services + 1);
    const callLog = fake.createdPanoramaServices.at(-1)!.callLog;
    expect(callLog).toContain("getPanoramaByLocation:args=2");
    expect(callLog).toContain("getPanoramaByLocation:args=3");
    wrapper.unmount();
    await nextTick();
  });

  it("查不到全景是 empty 而不是 failed（官方回调参数为 null）", async () => {
    let status = "";
    const wrapper = mountConsumer((api) => {
      // 先建实例，再把回包改成「查不到」
      void api.findById("pano-1").then(() => {
        fake.createdPanoramaServices.at(-1)!.byId = null;
        void api.findById("missing").then((result) => (status = result.status));
      });
    });
    await flushPromises();
    await flushPromises();
    expect(status).toBe("empty");
    wrapper.unmount();
    await nextTick();
  });

  it("cancel 之后迟到的回包不再写状态", async () => {
    let statusAfterCancel = "";
    const wrapper = mountConsumer((api) => {
      const first = api.findById("pano-1");
      api.cancel();
      void first.then((result) => (statusAfterCancel = result.status));
    });
    await flushPromises();
    await flushPromises();
    expect(statusAfterCancel).toBe("canceled");
    wrapper.unmount();
    await nextTick();
  });
});

describe("评审复现：options 在 viewer 异步 ready 前变化", () => {
  beforeEach(() => harness.reset());

  it("ready 之前改 options 必须在 ready 后收敛（不能永久停在构造期那份）", async () => {
    const before = baseline();
    const deferred = harness.deferredProvider();
    const props = ref<Record<string, unknown>>({ point: POINT });
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(Map, { provider: deferred }, () => [h(Panorama, props.value)]),
      }),
      { attachTo: host() },
    );
    // Client 还没就绪：viewer 尚未创建，此刻改 options 走的是「active 为 null」的分支
    await nextTick();
    props.value = { point: POINT, options: { albumsControl: true } };
    await nextTick();
    expect(fake.createdPanoramas.length).toBe(before.panoramas);

    harness.releaseProvider();
    await flushPromises();
    await nextTick();
    await flushPromises();

    // 期望：ready 后用**当前** props.options 收敛
    expect(lastViewer().options).toMatchObject({ albumsControl: true });

    wrapper.unmount();
    await nextTick();
  });
});

describe("Fake 保真：查看器的构造选项在**构造期**读入（#95 评审第 2 轮）", () => {
  beforeEach(() => harness.reset());

  /**
   * 真实 4.0 在构造期把 `PanoramaOptions` 读进查看器内部状态；之后父级改自己那份对象不会影响查看器。
   *
   * Fake 若直接持有调用方的引用，就会比真实**宽容**：任何「组件到底有没有把新值重新下发」的断言
   * 都可以被父级对同一对象的原地修改『蒙对』——第 2 轮审查的原地修改变体正是在这里被藏住的。
   * 因此这条用例钉住 Fake 的保真度（去掉 `{ ...options }` 拷贝它会立刻变红）。
   */
  it("构造之后原地修改调用方那份 options，不会改变查看器", () => {
    const options: Record<string, unknown> = { navigationControl: true };
    const viewer = new fake.namespace.Panorama(document.createElement("div"), options);

    options.albumsControl = true;
    expect(viewer.options).not.toHaveProperty("albumsControl");
    expect(viewer.options).toMatchObject({ navigationControl: true });
  });
});
