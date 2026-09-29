/**
 * `zIndex` 落地门禁（issue #165 Class 3 / TASK 0 + TASK 1）
 *
 * ## 这条用例在钉什么
 *
 * **分类层早就准备好了，组件面没有出口**：`driver/types/overlays.ts` 的 `PATH_STYLE` / `prism` /
 * `ground-overlay` / `bezier-curve` / `label` / `marker` 六处都把 `zIndex` 登记成
 * `mutateBy("setZIndex")`（官方 `setZIndex(zIndex: number): void` 在 9 个类上都有声明），
 * 而 `types/components.ts` 的 `PathStrokeProps` / `PathFillProps` / `PathShapeProps` /
 * `PathEditableProps` 四个共享底座**都没有 `zIndex`**——于是「就地更新」这条路径在整个图形族
 * 上一次都没被走到过。
 *
 * `CustomOverlay` 是唯一的例外，而且它**错**：官方 `CustomOverlayOptions.zIndex` 是构造选项，
 * 但 `CustomOverlay` **没有** `setZIndex`（`overlay/CustomOverlay.d.ts` 只声明了 `setPoint` /
 * `setRotation` / `setRotationOrigin` / `setProperties` + 三个 getter）——本库把它分类成
 * `recreate` 是**对的**，不要在这里"修"它。逐条依据见 `OVERLAY_REVERT_RATIONALE.zIndex`。
 *
 * 因此本文件只断言「官方**确实**有 `setZIndex` 的那 7 个图形类」，外加一个**反向守卫**：
 * 没有 `setZIndex` 的 `CustomOverlay` **不得**被误改成 `mutable`（那是把「有分类」误读成
 * 「有入口」——正是本 issue 要消灭的那类假支持）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import BezierCurve from "../../packages/bmap-vue/src/components/overlays/BezierCurve.vue";
import Circle from "../../packages/bmap-vue/src/components/overlays/Circle.vue";
import CustomOverlay from "../../packages/bmap-vue/src/components/overlays/CustomOverlay.vue";
import GroundOverlay from "../../packages/bmap-vue/src/components/overlays/GroundOverlay.vue";
import Label from "../../packages/bmap-vue/src/components/overlays/Label.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import Polygon from "../../packages/bmap-vue/src/components/overlays/Polygon.vue";
import Polyline from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import Prism from "../../packages/bmap-vue/src/components/overlays/Prism.vue";
import Rectangle from "../../packages/bmap-vue/src/components/overlays/Rectangle.vue";
import { overlayPropertySpec } from "../../packages/bmap-vue/src/driver/types/overlays";
import { createFakeV4Harness, type FakeBMapV4, type FakeV4Harness } from "../../packages/test-utils";

type AnyRecord = Record<string, any>;

let harness: FakeV4Harness;
let fake: FakeBMapV4;

beforeEach(() => {
  ({ harness, fake } = createFakeV4Harness());
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

function currentOverlay(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const raw = (map?.overlays as unknown as AnyRecord[])?.[0];
  if (!raw) throw new Error("地图上还没有覆盖物");
  return raw;
}

const PATH = [
  { lng: 116.4, lat: 39.9 },
  { lng: 116.5, lat: 40 },
];

const BOUNDS = {
  southwest: { lng: 116.3, lat: 39.8 },
  northeast: { lng: 116.5, lat: 40 },
};

interface ZIndexCase {
  readonly name: string;
  readonly component: unknown;
  readonly props: Record<string, unknown>;
}

const CASES: readonly ZIndexCase[] = [
  { name: "Polyline", component: Polyline, props: { points: PATH } },
  { name: "Polygon", component: Polygon, props: { points: PATH } },
  { name: "Rectangle", component: Rectangle, props: { bounds: BOUNDS } },
  { name: "Circle", component: Circle, props: { center: PATH[0], radius: 100 } },
  {
    name: "BezierCurve",
    component: BezierCurve,
    props: { points: PATH, controlPoints: [[{ lng: 116.45, lat: 39.95 }]] },
  },
  { name: "Prism", component: Prism, props: { points: PATH, altitude: 100 } },
  {
    name: "GroundOverlay",
    component: GroundOverlay,
    props: { type: "image", url: "a.png", bounds: BOUNDS },
  },
  { name: "Marker", component: Marker, props: { position: PATH[0] } },
  { name: "Label", component: Label, props: { content: "文本", position: PATH[0] } },
];

async function mountCase(testCase: ZIndexCase) {
  const state = ref<Record<string, unknown>>({ ...testCase.props });
  const Host = defineComponent({
    setup() {
      return () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(testCase.component as never, state.value as never),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper, state };
}

for (const testCase of CASES) {
  describe(`${testCase.name}.zIndex`, () => {
    it("构造期落进 ctor options（值直接可读回）", async () => {
      const { wrapper, state } = await mountCase(testCase);
      state.value.zIndex = 7;
      await settle();
      // 构造期那次已经带上了 zIndex 的话，实例字段上应能读到
      expect(currentOverlay().options.zIndex ?? currentOverlay().zIndex).toBeDefined();
      wrapper.unmount();
      await settle();
    });

    it("值变化 → 就地 setZIndex，不重建实例", async () => {
      const { wrapper, state } = await mountCase(testCase);
      const raw = currentOverlay();
      const created = fake.createdOverlays.length;
      raw.callLog.length = 0;

      state.value.zIndex = 42;
      await settle();

      expect(fake.createdOverlays.length, "zIndex 变化不得重建实例").toBe(created);
      expect(raw.callLog, "zIndex 应经 setZIndex 就地更新").toContain("setZIndex");
      expect(raw.zIndex).toBe(42);

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name}.zIndex 卸载`);
    });

    it("撤回（42 → undefined）→ 重建（官方无 getZIndex，无 baseline 可恢复）", async () => {
      const { wrapper, state } = await mountCase(testCase);
      state.value.zIndex = 42;
      await settle();
      const created = fake.createdOverlays.length;

      state.value.zIndex = undefined;
      await settle();

      expect(
        fake.createdOverlays.length,
        "zIndex 撤回必须重建：8 个类有 setZIndex、0 个有 getZIndex",
      ).toBe(created + 1);

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name}.zIndex 撤回`);
    });
  });
}

describe("CustomOverlay.zIndex 保持 recreate（官方没有 setZIndex）", () => {
  it("描述符仍是 recreate，理由是官方 CustomOverlay 没有 setZIndex", () => {
    const spec = overlayPropertySpec("custom-overlay", "zIndex");
    expect(spec?.policy).toBe("recreate");
  });

  it("组件面不把 zIndex 当作可就地更新的字段", async () => {
    const { wrapper, state } = await mountCase({
      name: "CustomOverlay",
      component: CustomOverlay,
      props: { position: PATH[0] },
    });
    const raw = currentOverlay();
    const created = fake.createdOverlays.length;
    raw.callLog.length = 0;

    state.value.zIndex = 42;
    await settle();

    // 构造期属性：变化即重建，且**不**产生 setZIndex 调用（官方没有这个成员）
    expect(raw.callLog).not.toContain("setZIndex");
    expect(fake.createdOverlays.length).toBe(created + 1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("CustomOverlay.zIndex");
  });
});
