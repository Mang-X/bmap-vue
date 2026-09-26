/**
 * 控件事件面的门禁（issue #165 Class 3 / TASK 3 + 4）
 *
 * 逐条 d.ts 出处见各 describe 的文件头注释。三条判据与 `overlay-expose.test.ts` 同一套：
 * 事件**真的被 SDK 派发时到达**、**释放后解绑**、**载荷是官方声明的领域形状**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import CityListControl from "../../packages/bmap-vue/src/components/controls/CityListControl.vue";
import LocationControl from "../../packages/bmap-vue/src/components/controls/LocationControl.vue";
import OverviewMapControl from "../../packages/bmap-vue/src/components/controls/OverviewMapControl.vue";
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

function lastControl(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const list = (map?.controls ?? []) as AnyRecord[];
  const raw = list[list.length - 1];
  if (!raw) throw new Error("地图上没有控件");
  return raw;
}

async function mountControl(
  component: unknown,
  props: Record<string, unknown> = {},
  on?: Record<string, unknown>,
) {
  const Host = defineComponent({
    setup: () => () =>
      h(MapComponent, { provider: harness.provider() }, () => [
        h(component as never, { ...props, ...on } as never),
      ]),
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper };
}

describe("<OverviewMapControl> 事件面（官方 3 个，此前 0 个）", () => {
  // 逐条：control/OverviewMapControl.d.ts 的 OverviewMapControlEventMap
  it("viewchanged / viewchanging / resize 三个都转发（viewchanged 带 isOpen）", async () => {
    const seen = ref<Record<string, unknown>>({});
    const { wrapper } = await mountControl(
      OverviewMapControl,
      {},
      {
        onViewchanged: (e: unknown) => (seen.value.viewchanged = e),
        onViewchanging: (e: unknown) => (seen.value.viewchanging = e),
        onResize: (e: unknown) => (seen.value.resize = e),
      },
    );
    const control = lastControl();

    // viewchanged 是**唯一**能观察这个控件自身开合状态的方式：
    // 官方 isOpen() 只能轮询，而 isOpen prop 是构造期的（官方没有 setOpen）
    control.emit("viewchanged", { type: "viewchanged", target: control, isOpen: true });
    control.emit("viewchanging", { type: "viewchanging", target: control });
    control.emit("resize", { type: "resize", target: control });
    await nextTick();

    expect(seen.value.viewchanged).toMatchObject({ isOpen: true });
    expect(seen.value.viewchanging).toMatchObject({ type: "viewchanging" });
    expect(seen.value.resize).toMatchObject({ type: "resize" });

    wrapper.unmount();
    await settle();
    harness.assertIdle("OverviewMapControl 事件");
  });
});

describe("<CityListControl> 事件面（官方 6 个构造回调，此前 0 条）", () => {
  it("changeBefore / changeAfter / changeSuccess / open / close 都转发", async () => {
    const seen = ref<Record<string, unknown>>({});
    const { wrapper } = await mountControl(
      CityListControl,
      {},
      {
        onChangeBefore: () => (seen.value.before = true),
        onChangeAfter: () => (seen.value.after = true),
        onChangeSuccess: (r: unknown) => (seen.value.success = r),
        onOpen: () => (seen.value.open = true),
        onClose: () => (seen.value.close = true),
      },
    );
    const control = lastControl();

    control.emit("changeBefore");
    control.emit("changeSuccess", { city: "北京", code: "110000", point: "" });
    control.emit("changeAfter");
    control.emit("open");
    control.emit("close");
    await nextTick();

    expect(seen.value.before).toBe(true);
    expect(seen.value.after).toBe(true);
    // changeSuccess 是唯一带载荷的（官方 onChangeSuccess(poi)），其余四个官方声明就是无参的
    expect(seen.value.success).toMatchObject({ city: "北京", code: "110000" });
    expect(seen.value.open).toBe(true);
    expect(seen.value.close).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("CityListControl 事件");
  });
});

describe("<LocationControl> 选项（官方 GeolocationControlOptions 8 个，此前 0 个）", () => {
  it("八个选项进构造 options（locationIcon 收描述而不是 raw BMap.Icon）", async () => {
    const { wrapper } = await mountControl(LocationControl, {
      showAddressBar: true,
      enableAutoLocation: true,
      locationIcon: "simple_red",
      watchPosition: true,
      useCompass: true,
      autoZoom: true,
      autoViewport: true,
    });
    const control = lastControl();

    expect(control.options).toMatchObject({
      showAddressBar: true,
      enableAutoLocation: true,
      watchPosition: true,
      useCompass: true,
      autoZoom: true,
      autoViewport: true,
    });
    // 收的是**图标描述**（字符串），不是 raw BMap.Icon 实例（AGENTS.md 的 raw SDK 边界）
    expect(control.options.locationIcon).toBe("simple_red");

    wrapper.unmount();
    await settle();
    harness.assertIdle("LocationControl 选项");
  });
});
