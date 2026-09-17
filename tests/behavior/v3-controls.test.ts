/**
 * 控件层统一 spec 门禁与动态更新（M7-CONTROL-PANORAMA / issue #41）
 *
 * 本文件回答三个问题，且**每个 Stable 控件都要过同一批断言**（下面的 `STABLE_CONTROLS` 表）：
 *
 * 1. 「所有 Stable 控件通过统一 spec」——不是靠读源码，而是靠**同一批行为断言在 10 个控件上
 *    各跑一遍**：挂载、显隐、anchor/offset 动态更新、卸载归零。哪个组件自己写了一套，就会在
 *    对应那一条上红；
 * 2. 「位置、offset、visible 动态更新」——`anchor` / `offset` 此前只在构造期生效，本文件把
 *    「改 props → SDK 侧真的变了」变成断言（`getAnchor()` / `getOffset()`）；
 * 3. 「控件创建 / 更新 / 重建 / 移除」——`recreate` 类选项（`BMapType.type`、`BOverview.isOpen`）
 *    变化时**重建控件**；`mutable` 类选项（`BNavigation.type`、`BMapType.showStreetLayer`、
 *    `BOverview.size`、`BCityList.expand`）**就地更新、不重建**。
 *
 * 显隐语义（issue 的「统一 visible」）在 #41 定型为 SDK 基类的 `show()` / `hide()`：控件始终
 * 挂载，只切换可见性。`BCopyright` 是唯一例外（共享实例 + 版权项级显隐），单独一节覆盖。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref, type Component } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BZoom from "../../packages/baidu-map-gl-vue/src/components/controls/BZoom.vue";
import BScale from "../../packages/baidu-map-gl-vue/src/components/controls/BScale.vue";
import BNavigation from "../../packages/baidu-map-gl-vue/src/components/controls/BNavigation.vue";
import BNavigation3d from "../../packages/baidu-map-gl-vue/src/components/controls/BNavigation3d.vue";
import BCityList from "../../packages/baidu-map-gl-vue/src/components/controls/BCityList.vue";
import BLocation from "../../packages/baidu-map-gl-vue/src/components/controls/BLocation.vue";
import BMapType from "../../packages/baidu-map-gl-vue/src/components/controls/BMapType.vue";
import BOverview from "../../packages/baidu-map-gl-vue/src/components/controls/BOverview.vue";
import BPanoramaControl from "../../packages/baidu-map-gl-vue/src/components/controls/BPanoramaControl.vue";
import BControl from "../../packages/baidu-map-gl-vue/src/components/controls/BControl.vue";
import BCopyright from "../../packages/baidu-map-gl-vue/src/components/controls/BCopyright.vue";
import { useControlResource } from "../../packages/baidu-map-gl-vue/src/core/controls";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();
const host = () => harness.container();

/** 当前（最后一张）地图 —— 控件数一律以它为准。 */
function currentMap() {
  return fake.createdMaps.at(-1)!;
}

/** 挂在最后一张地图上的控件（`callLog` 是「发生过什么」的活动口径）。 */
function controlsOnMap() {
  return currentMap().controls as unknown as Array<{
    callLog: string[];
    isVisible(): boolean;
    getAnchor(): unknown;
    getOffset(): { width: number; height: number } | null;
    defaultOffset: { width: number; height: number } | null;
  }>;
}

/**
 * 控件当前的偏移量读数。
 *
 * 自定义控件（`BControl`）的构造期偏移走官方自定义控件契约里的 `defaultOffset`
 * （`initialize()` 之前就要求存在），`getOffset()` 在运行期写入之前是 `null`；内置控件的
 * 构造期偏移则由构造选项直接落到 `offset`。两条路径对使用者是同一件事，读数时合并。
 */
function offsetOf(control: ReturnType<typeof controlsOnMap>[number]) {
  return control.getOffset() ?? control.defaultOffset;
}

/** 最近一次创建的控件（含已经卸载的），用于「重建」断言。 */
function lastCreatedControl(): { options: Record<string, unknown> } & Record<string, never> {
  return fake.createdControls.at(-1) as never;
}

/**
 * 每个 Stable 控件一行。
 *
 * - `ctor`：它在 Fake 命名空间里的构造器名。`location` 的领域名对应 Fake 里的
 *   `GeolocationControl`（4.0 的写法）。
 * - `anchorMode`：**anchor 的落地方式**。10 个控件就地 `setAnchor()`；`BCopyright` 是
 *   构造期项（实例按停靠位置共享 ⇒ anchor 是它的 identity），变化时重建并完成共享组迁移。
 * - `visibleMode`：**显隐的落地方式**。10 个控件走 SDK 基类的 `show()` / `hide()`；
 *   `BCopyright` 是唯一例外——它的实例按 anchor **共享**（文档承诺「多个相同位置版权控件会自动
 *   排列」），隐藏整个控件会连带隐藏兄弟组件的内容，因此它的「可见」落在**版权项**的登记 /
 *   摘除上。例外在这里显式命名，而不是把它整行排除在门禁之外：`anchor` / `offset` /
 *   卸载归零 / 挂载这几条对它同样适用，排除掉就等于「11 个 Stable 控件里只有 10 个过了统一 spec」。
 */
const STABLE_CONTROLS: ReadonlyArray<{
  name: string;
  component: Component;
  ctor: string;
  visibleMode: "control" | "entries";
  anchorMode?: "setAnchor" | "recreate";
  props?: Record<string, unknown>;
  slots?: Record<string, () => unknown>;
}> = [
  { name: "BZoom", component: BZoom, ctor: "ZoomControl", visibleMode: "control" },
  { name: "BScale", component: BScale, ctor: "ScaleControl", visibleMode: "control" },
  { name: "BNavigation", component: BNavigation, ctor: "NavigationControl", visibleMode: "control" },
  { name: "BNavigation3d", component: BNavigation3d, ctor: "NavigationControl3D", visibleMode: "control" },
  { name: "BCityList", component: BCityList, ctor: "CityListControl", visibleMode: "control" },
  { name: "BLocation", component: BLocation, ctor: "GeolocationControl", visibleMode: "control" },
  { name: "BMapType", component: BMapType, ctor: "MapTypeControl", visibleMode: "control" },
  { name: "BOverview", component: BOverview, ctor: "OverviewMapControl", visibleMode: "control" },
  { name: "BPanoramaControl", component: BPanoramaControl, ctor: "PanoramaControl", visibleMode: "control" },
  { name: "BControl", component: BControl, ctor: "Control", visibleMode: "control" },
  {
    name: "BCopyright",
    component: BCopyright,
    ctor: "CopyrightControl",
    visibleMode: "entries",
    anchorMode: "recreate",
    // 用 TOP_LEFT 与别处的 BOTTOM_RIGHT 用例错开：版权控件的实例按 anchor **模块级共享**
    // （`copyrightControlPosCache`），撞同一个 anchor 会读到上一个用例留下的实例。
    props: { anchor: "BMAP_ANCHOR_TOP_LEFT" },
    slots: { default: () => "no-1" },
  },
];

/** 用响应式 props 挂一个控件到 `<BMap>` 子树里。 */
function mountControl(
  component: Component,
  initial: Record<string, unknown> = {},
  slots: Record<string, () => unknown> = {},
) {
  const reactiveProps = ref<Record<string, unknown>>({ ...initial });
  const wrapper = mount(
    defineComponent({
      setup: () => () => h(BMap, { provider: provider() }, () => [h(component, reactiveProps.value, slots as never)]),
    }),
    { attachTo: host() },
  );
  return {
    wrapper,
    async setProps(patch: Record<string, unknown>) {
      reactiveProps.value = { ...reactiveProps.value, ...patch };
      await nextTick();
      await nextTick();
    },
  };
}

describe("控件统一 spec：每个 Stable 控件同一批断言", () => {
  beforeEach(() => harness.reset());

  describe.each(STABLE_CONTROLS)(
    "$name",
    ({ component, ctor, props, slots, visibleMode, anchorMode = "setAnchor" }) => {
    it("挂载后在地图上出现且构造器种类正确，卸载后归零", async () => {
      const { wrapper } = mountControl(component, props, slots);
      await flushPromises();
      const controls = controlsOnMap();
      expect(controls).toHaveLength(1);
      const Ctor = (fake.namespace as unknown as Record<string, new () => unknown>)[ctor]!;
      expect(controls[0]).toBeInstanceOf(Ctor);

      wrapper.unmount();
      await nextTick();
      await flushPromises();
      expect(controlsOnMap()).toHaveLength(0);
    });

    it("anchor / offset 随 props 即时下发，且 anchor 变化不吞掉 offset", async () => {
      const { wrapper, setProps } = mountControl(
        component,
        { ...props, offset: { x: 7, y: 9 } },
        slots,
      );
      await flushPromises();
      let control = controlsOnMap()[0]!;
      expect(offsetOf(control)).toEqual({ width: 7, height: 9 });

      const created = fake.createdControls.length;
      await setProps({ anchor: "BMAP_ANCHOR_TOP_RIGHT" });
      await flushPromises();
      // `BMAP_ANCHOR_TOP_RIGHT` 在 Driver 的常量表里是 1
      if (anchorMode === "setAnchor") {
        expect(control.getAnchor()).toBe(1);
        // 真实 4.0 的 `setAnchor()` 会把偏移重置回控件默认值 —— 统一 adapter 因此按
        // `anchor → offset` 的顺序成对写；这一条正是那条不变量的断言。
        expect(control.getOffset()).toEqual({ width: 7, height: 9 });
        expect(fake.createdControls.length).toBe(created);
      } else {
        // 共享实例的 anchor 是 identity 的一部分：变化即重建（旧实例退出共享组）
        expect(fake.createdControls.length).toBe(created + 1);
        control = controlsOnMap()[0]!;
        expect(control.getAnchor()).toBe(1);
      }

      await setProps({ offset: { x: 21, y: 22 } });
      expect(control.getOffset()).toEqual({ width: 21, height: 22 });
      wrapper.unmount();
      await nextTick();
    });

    it("visible 按 spec 声明的方式生效，且控件不因此被摘下来", async () => {
      const { wrapper, setProps } = mountControl(component, props, slots);
      await flushPromises();
      const control = controlsOnMap()[0]!;

      await setProps({ visible: false });
      if (visibleMode === "control") {
        expect(control.callLog).toContain("hide");
        expect(control.isVisible()).toBe(false);
      } else {
        // `BCopyright`：整个控件**不**隐藏（兄弟组件还在用），只摘掉本组件那一条版权项
        expect(control.callLog).toContain("removeCopyright");
        expect(control.isVisible()).toBe(true);
        expect((control as unknown as { copyrights: unknown[] }).copyrights).toHaveLength(0);
      }
      // 两种方式都**不**摘挂载，控件内部状态与 DOM 都保留
      expect(controlsOnMap()).toHaveLength(1);

      await setProps({ visible: true });
      if (visibleMode === "control") {
        expect(control.callLog).toContain("show");
        expect(control.isVisible()).toBe(true);
      } else {
        expect((control as unknown as { copyrights: unknown[] }).copyrights).toHaveLength(1);
      }
      wrapper.unmount();
      await nextTick();
      expect(controlsOnMap()).toHaveLength(0);
    });

    it("同一个值重设不产生重建（内联字面量的新引用不得被当成选项变化）", async () => {
      const anchor = (props?.anchor as string | undefined) ?? "BMAP_ANCHOR_BOTTOM_RIGHT";
      const { wrapper, setProps } = mountControl(component, { ...props, anchor });
      await flushPromises();
      const created = fake.createdControls.length;

      await setProps({ anchor });
      await setProps({ anchor });
      expect(fake.createdControls.length).toBe(created);
      wrapper.unmount();
      await nextTick();
    });
  });
});

describe("Map 卸载时控件被清理", () => {
  beforeEach(() => harness.reset());

  it("多控件随地图一起卸载：地图上的控件归零、fake 诊断无泄漏", async () => {
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BZoom, {}),
            h(BScale, {}),
            h(BNavigation, {}),
            h(BMapType, {}),
            h(BOverview, {}),
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    expect(controlsOnMap()).toHaveLength(5);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(controlsOnMap()).toHaveLength(0);
    harness.assertIdle("控件随地图卸载");
  });
});

describe("选项更新：live 就地写、recreate 重建", () => {
  beforeEach(() => harness.reset());

  it("BMapType.showStreetLayer 就地下发（官方唯一字段级 setter，成员名不是 set<Key> 形状）", async () => {
    const { wrapper, setProps } = mountControl(BMapType);
    await flushPromises();
    const created = fake.createdControls.length;
    const control = lastCreatedControl() as unknown as {
      callLog: string[];
      streetLayer: boolean | null;
    };

    await setProps({ showStreetLayer: false });
    expect(control.callLog).toContain("showStreetLayer:off");
    expect(control.streetLayer).toBe(false);
    expect(fake.createdControls.length).toBe(created);
    wrapper.unmount();
    await nextTick();
  });

  it("BMapType.type 只有构造期生效 ⇒ 重建控件，新实例带上新值", async () => {
    const { wrapper, setProps } = mountControl(BMapType);
    await flushPromises();
    const created = fake.createdControls.length;
    const first = lastCreatedControl();

    await setProps({ type: "BMAP_MAPTYPE_CONTROL_DROPDOWN" });
    await flushPromises();
    expect(fake.createdControls.length).toBe(created + 1);
    const second = lastCreatedControl();
    expect(second).not.toBe(first);
    expect(second.options.type).toBe("BMAP_MAPTYPE_CONTROL_DROPDOWN");
    // 重建是原子的：地图上仍然只有一个控件
    expect(controlsOnMap()).toHaveLength(1);
    wrapper.unmount();
    await nextTick();
  });

  it("BOverview.size 走 setSize 就地更新；isOpen 走重建（官方只有 changeView 的切换语义）", async () => {
    const { wrapper, setProps } = mountControl(BOverview, { size: { x: 150, y: 150 } });
    await flushPromises();
    const created = fake.createdControls.length;
    const control = lastCreatedControl() as unknown as {
      callLog: string[];
      size: { width: number; height: number } | null;
    };
    expect(control.size).toEqual({ width: 150, height: 150 });

    await setProps({ size: { x: 200, y: 210 } });
    expect(control.callLog).toContain("setSize");
    expect(control.size).toEqual({ width: 200, height: 210 });
    expect(fake.createdControls.length).toBe(created);

    await setProps({ isOpen: true });
    await flushPromises();
    expect(fake.createdControls.length).toBe(created + 1);
    expect(lastCreatedControl().options.isOpen).toBe(true);
    wrapper.unmount();
    await nextTick();
  });

  it("BNavigation.type 走 setType 就地更新（真实 4.0 要求控件已挂载 ⇒ create → add → setOptions）", async () => {
    const { wrapper, setProps } = mountControl(BNavigation);
    await flushPromises();
    const created = fake.createdControls.length;
    const control = lastCreatedControl() as unknown as {
      callLog: string[];
      type: unknown;
      attachedMap: unknown;
    };

    await setProps({ type: "BMAP_NAVIGATION_CONTROL_SMALL" });
    // `setType` 在未挂载时会抛错（Fake 建模了这条真实约束）——能走到这里说明顺序正确
    expect(control.callLog).toContain("setType");
    expect(control.type).toBe("BMAP_NAVIGATION_CONTROL_SMALL");
    expect(control.attachedMap).toBeTruthy();
    expect(fake.createdControls.length).toBe(created);
    wrapper.unmount();
    await nextTick();
  });

  it("BCityList.expand 走 open() / close()（成对动作，没有幂等 setter）", async () => {
    const { wrapper, setProps } = mountControl(BCityList, { expand: false });
    await flushPromises();
    const created = fake.createdControls.length;
    const control = lastCreatedControl() as unknown as {
      callLog: string[];
      expanded: boolean;
    };

    await setProps({ expand: true });
    expect(control.callLog).toContain("open");
    expect(control.expanded).toBe(true);

    await setProps({ expand: false });
    expect(control.callLog).toContain("close");
    expect(control.expanded).toBe(false);
    expect(fake.createdControls.length).toBe(created);
    wrapper.unmount();
    await nextTick();
  });
});

describe("BCopyright：共享实例 + 版权项级显隐", () => {
  beforeEach(() => harness.reset());

  it("同 anchor 的两个组件共用一个控件，各自登记一条版权项", async () => {
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BCopyright, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" }, { default: () => "no-1" }),
            h(BCopyright, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" }, { default: () => "no-2" }),
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const controls = controlsOnMap();
    expect(controls).toHaveLength(1);
    expect((controls[0] as unknown as { copyrights: unknown[] }).copyrights).toHaveLength(2);
    wrapper.unmount();
    await nextTick();
  });

  it("visible 只影响本组件那一条版权项，兄弟组件的内容留在同一个控件上", async () => {
    const first = ref(true);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(
              BCopyright,
              { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT", visible: first.value },
              { default: () => "no-1" },
            ),
            h(BCopyright, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" }, { default: () => "no-2" }),
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const control = controlsOnMap()[0] as unknown as { copyrights: { content: string }[] };
    expect(control.copyrights).toHaveLength(2);

    first.value = false;
    await nextTick();
    await nextTick();
    expect(control.copyrights).toHaveLength(1);
    expect(control.copyrights[0]!.content).toContain("no-2");
    // 控件本身没有被摘掉（兄弟组件还在用）
    expect(controlsOnMap()).toHaveLength(1);

    first.value = true;
    await nextTick();
    await nextTick();
    expect(control.copyrights).toHaveLength(2);
    wrapper.unmount();
    await nextTick();
  });
});

/* -------------------------------------------------------------------------- */
/* 评审第 1 轮（commit e54d6fe）复现：#95 review 的四条                          */
/* -------------------------------------------------------------------------- */

describe("评审复现：动态改 anchor 不得污染版权控件的共享缓存", () => {
  beforeEach(() => harness.reset());

  it("A 从 TOP_LEFT 移到 BOTTOM_RIGHT 后应与 B 共用同一个控件，且卸载不得删掉 B 的缓存项", async () => {
    const anchorA = ref("BMAP_ANCHOR_TOP_LEFT");
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BCopyright, { anchor: anchorA.value }, { default: () => "A" }),
            h(BCopyright, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" }, { default: () => "B" }),
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();

    // 起点：两个 anchor 各一个控件
    expect(controlsOnMap()).toHaveLength(2);
    const shared = controlsOnMap()[1] as unknown as { copyrights: { content: string }[] };
    expect(shared.copyrights).toHaveLength(1);

    // A 移到 BOTTOM_RIGHT：正确语义是「离开旧共享组、加入目标共享组」
    anchorA.value = "BMAP_ANCHOR_BOTTOM_RIGHT";
    await nextTick();
    await flushPromises();
    expect(controlsOnMap()).toHaveLength(1);
    expect(shared.copyrights).toHaveLength(2);

    // A 卸载：共享控件仍被 B 使用 ⇒ 必须留在图上，且它的缓存项不得被删掉
    anchorA.value = "BMAP_ANCHOR_BOTTOM_RIGHT";
    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(controlsOnMap()).toHaveLength(0);
    harness.assertIdle("版权控件共享缓存");
  });

  it("移动后同 anchor 再挂第三个实例仍应复用同一个控件（缓存项没被误删）", async () => {
    const anchorA = ref("BMAP_ANCHOR_TOP_LEFT");
    const showOthers = ref(false);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(BCopyright, { anchor: anchorA.value }, { default: () => "A" }),
            showOthers.value
              ? h(BCopyright, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" }, { default: () => "B" })
              : null,
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    anchorA.value = "BMAP_ANCHOR_BOTTOM_RIGHT";
    showOthers.value = true;
    await nextTick();
    await flushPromises();

    const shared = controlsOnMap().at(-1) as unknown as { copyrights: unknown[] };
    expect(controlsOnMap()).toHaveLength(1);
    expect(shared.copyrights).toHaveLength(2);

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(controlsOnMap()).toHaveLength(0);
  });
});

describe("评审复现：option 从有值变回 undefined", () => {
  beforeEach(() => harness.reset());

  it("live option 变回 undefined 时必须回到构造期默认（不能永久停在旧值）", async () => {
    const { wrapper, setProps } = mountControl(BNavigation);
    await flushPromises();
    await setProps({ type: "BMAP_NAVIGATION_CONTROL_SMALL" });
    expect((lastCreatedControl() as unknown as { type: unknown }).type).toBe(
      "BMAP_NAVIGATION_CONTROL_SMALL",
    );

    const created = fake.createdControls.length;
    await setProps({ type: undefined });
    await flushPromises();
    // 期望：重建一次，让构造期重新采用默认值
    expect(fake.createdControls.length).toBe(created + 1);
    expect(lastCreatedControl().options.type).toBeUndefined();

    wrapper.unmount();
    await nextTick();
  });
});

/* -------------------------------------------------------------------------- */
/* 评审第 2 轮（commit 67b5a31）复现：嵌套 option 的**原地修改**                */
/* -------------------------------------------------------------------------- */

describe("评审复现：父级对嵌套 option 做原地修改（同一对象改字段 / push）", () => {
  beforeEach(() => harness.reset());

  function mountWithProps(node: (props: Record<string, unknown>) => unknown) {
    const shared = reactive<Record<string, unknown>>({});
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [node(shared) as never]),
      }),
      { attachTo: host() },
    );
    return { wrapper, shared };
  }

  it("BZoom：同一 offset 对象原地改 x/y 必须下发 setOffset", async () => {
    const shared = reactive({ offset: { x: 7, y: 9 } });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [h(BZoom, { offset: shared.offset })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const control = controlsOnMap()[0]!;
    expect(offsetOf(control)).toEqual({ width: 7, height: 9 });

    // 原地修改**同一个**对象（不是换引用）：watch 源能感知，diff 也必须能
    shared.offset.x = 21;
    shared.offset.y = 22;
    await nextTick();
    await nextTick();
    expect(control.getOffset()).toEqual({ width: 21, height: 22 });

    wrapper.unmount();
    await nextTick();
  });

  it("BOverview：同一 size 对象原地修改必须下发 setSize，且不重建", async () => {
    const shared = reactive({ size: { x: 150, y: 150 } });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [h(BOverview, { size: shared.size })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;
    const control = fake.createdControls.at(-1) as unknown as {
      callLog: string[];
      size: { width: number; height: number } | null;
    };
    expect(control.size).toEqual({ width: 150, height: 150 });

    shared.size.x = 200;
    shared.size.y = 210;
    await nextTick();
    await nextTick();
    expect(control.callLog).toContain("setSize");
    expect(control.size).toEqual({ width: 200, height: 210 });
    expect(fake.createdControls.length).toBe(created);

    wrapper.unmount();
    await nextTick();
  });

  it("BMapType：同一 mapTypes 数组原地 push 必须重建（构造期项）", async () => {
    const shared = reactive({ mapTypes: [1, 2] });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [h(BMapType, { mapTypes: shared.mapTypes })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;

    shared.mapTypes.push(3);
    await nextTick();
    await flushPromises();
    expect(fake.createdControls.length).toBe(created + 1);
    expect(lastCreatedControl().options.mapTypes).toEqual([1, 2, 3]);

    wrapper.unmount();
    await nextTick();
  });
});

describe("统一 adapter：就地写做不到时的两种反应（重建 / 有据可查的忽略）", () => {
  beforeEach(() => harness.reset());

  it("未命中分类表、但构造期会收到该键 ⇒ `recreate` ⇒ 重建", async () => {
    // 自定义 spec：`nope` 不在任何分类表里、实例上也没有 `setNope`。Driver 现在把它判成
    // `recreate`（4.0 的构造选项**原样透传**，构造期仍可能生效），因此适配器必须重建——
    // 而不是当成 `unsupported` 既不写也不重建地丢掉。
    // 这条路径内置组件走不到（反向门禁要求组件选项都有落地方式），但适配器是公共抽象。
    const Probe = defineComponent({
      props: { nope: { type: Number, required: true } },
      setup(p) {
        useControlResource(p as never, {
          kind: "zoom",
          options: (x: { nope: number }) => ({ offset: { x: 7, y: 9 }, nope: x.nope }),
        });
        return () => null;
      },
    });
    const value = ref(1);
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [h(Probe, { nope: value.value })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;

    value.value = 2;
    await nextTick();
    await flushPromises();

    expect(fake.createdControls.length).toBe(created + 1);
    expect(lastCreatedControl().options.nope).toBe(2);

    wrapper.unmount();
    await nextTick();
  });

  it("Driver 报 `unsupported`（连构造期也没入口）⇒ **不**重建，但会告警一次（不是静默丢弃）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Probe = defineComponent({
      props: { nope: { type: Number, required: true } },
      setup(p) {
        useControlResource(p as never, {
          // `custom` 是唯一「构造期也到不了」的种类：createCustomControl 只接收 anchor/offset/render
          kind: "custom",
          options: (x: { nope: number }) => ({ offset: { x: 7, y: 9 }, nope: x.nope }),
          render: () => () => document.createElement("div"),
        });
        return () => null;
      },
    });
    const value = ref(1);
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [h(Probe, { nope: value.value })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;
    warn.mockClear();

    value.value = 2;
    await nextTick();
    await flushPromises();

    // 三态契约：`unsupported` = 重建同样不会生效 ⇒ 不做无效重建（否则每次变化都销毁重建控件）
    expect(fake.createdControls.length).toBe(created);
    // 但它必须可见：适配器为这类键告警一次
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("没有入口")),
      "unsupported 的键应当告警一次",
    ).toBe(true);

    warn.mockRestore();
    wrapper.unmount();
    await nextTick();
  });

  it("`unsupported` 的键变回 `undefined` ⇒ 同样**不**重建，且仍然告警一次", async () => {
    // 「有值 → 没有值」的通则（语义是「回到 SDK 默认」，只能靠构造期）**不能覆盖到 `unsupported` 上**：
    // 按三态定义它连构造期也没有入口，重建同样不生效。把通则套上去会同时违反两条契约——
    // 一次无效重建，且因为提前 `return` 连告警都被跳过（#95 评审第 4 轮 P2）。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Probe = defineComponent({
      props: { nope: { type: Number, default: undefined } },
      setup(p) {
        useControlResource(p as never, {
          kind: "custom",
          options: (x: { nope?: number }) => ({ offset: { x: 7, y: 9 }, nope: x.nope }),
          render: () => () => document.createElement("div"),
        });
        return () => null;
      },
    });
    const value = ref<number | undefined>(1);
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(BMap, { provider: provider() }, () => [h(Probe, { nope: value.value })]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;
    warn.mockClear();

    value.value = undefined;
    await nextTick();
    await flushPromises();

    expect(
      fake.createdControls.length,
      "`unsupported` 变 undefined 不得触发无效重建",
    ).toBe(created);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("没有入口")),
      "`unsupported` 变 undefined 仍必须告警一次（不能因为走了重建分支就被静默跳过）",
    ).toBe(true);

    warn.mockRestore();
    wrapper.unmount();
    await nextTick();
  });

  it("`unsupported` 与「需要重建的键」同 tick 变化 ⇒ 允许重建，但 `unsupported` 仍必须告警", async () => {
    // 同批里有一个正当的重建理由（这里用 `offset` 有值 → undefined）时，`unsupported` 的键
    // 不能被这次重建「顺带吞掉」——它的变化同样被忽略了，调用方同样有权知道。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Probe = defineComponent({
      props: {
        nope: { type: Number, default: 1 },
        shift: { type: Boolean, default: false },
      },
      setup(p) {
        useControlResource(p as never, {
          kind: "custom",
          options: (x: { nope: number; shift: boolean }) => ({
            offset: x.shift ? undefined : { x: 7, y: 9 },
            nope: x.nope,
          }),
          render: () => () => document.createElement("div"),
        });
        return () => null;
      },
    });
    const state = reactive({ shift: false, nope: 1 });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: provider() }, () => [
            h(Probe, { nope: state.nope, shift: state.shift }),
          ]),
      }),
      { attachTo: host() },
    );
    await flushPromises();
    const created = fake.createdControls.length;
    warn.mockClear();

    // 同一 tick：`offset` 变 undefined（重建理由）+ `nope` 变化（`unsupported`）
    state.shift = true;
    state.nope = 2;
    await nextTick();
    await flushPromises();

    expect(
      fake.createdControls.length,
      "`offset` 变 undefined 是正当的重建理由，应当重建",
    ).toBe(created + 1);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("没有入口")),
      "同批的重建不能把 `unsupported` 的告警吞掉",
    ).toBe(true);

    warn.mockRestore();
    wrapper.unmount();
    await nextTick();
  });
});
