/**
 * M5-SPEC-MARKER（issue #30）：`OverlaySpec` 声明面 + BMarker 生命周期
 *
 * issue #30 的五条测试要求逐条落在本文件：
 *
 * | 要求 | 用例 |
 * | --- | --- |
 * | 初始 `visible=false`、draggable、rotation、zIndex | `初始状态（构造期属性一次到位）` |
 * | mutable 更新不重建，ctor-only 更新释放旧实例后重建 | `mutable 属性…` / `构造期属性…` |
 * | drag-end 双向同步和回环抑制 | `drag-end 双向同步…` |
 * | Target 切换与 Registry 计数 | `Target 与 Registry` |
 * | 100 次重建后 listener/cache/ref 资源稳定 | `100 次重建…` |
 *
 * 另加两组「声明面自己会红」的检查：`MARKER_FIELDS` 必须**恰好覆盖** `BMarkerProps`，且声明为
 * `options` / `recreate` 的字段在 Driver 属性描述符里必须真的是对应分类——「每个公开属性都有明确
 * 更新策略」因此是一条可执行的门禁，而不是文档承诺。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, watchEffect } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import {
  MARKER_DESCRIPTOR_KEYS,
  MARKER_FIELDS,
  createMarkerSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/markerSpec";
import { assertOverlayFieldDeclarations } from "../../packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec";
import type { OverlaySpec } from "../../packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec";
import { useRequiredMapContext } from "../../packages/baidu-map-gl-vue/src/core/context/inject";
import { useParentOverlayHandle } from "../../packages/baidu-map-gl-vue/src/core/context/target";
import type { MapContext } from "../../packages/baidu-map-gl-vue/src/core/context/types";
import { OVERLAY_DESCRIPTORS, overlayPropertySpec } from "../../packages/baidu-map-gl-vue/src/driver/types/overlays";
import type { SdkHandle } from "../../packages/baidu-map-gl-vue/src/driver/types/handles";
import type { BMarkerProps } from "../../packages/baidu-map-gl-vue/src/types/components";
import { createFakeV4Harness, type FakeBMapV4, type FakeV4Harness, type FakeV4Marker } from "../../packages/test-utils";

let harness: FakeV4Harness;
let fake: FakeBMapV4;

beforeEach(() => {
  ({ harness, fake } = createFakeV4Harness());
  probeContext.value = null;
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function settle() {
  await flushPromises();
  await nextTick();
}

function lastMap() {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  if (!map) throw new Error("用例必须先创建地图（<BMap>）");
  return map;
}

/** 当前地图上挂着的覆盖物（raw 实例）。 */
function overlays(): FakeV4Marker[] {
  return lastMap().overlays as unknown as FakeV4Marker[];
}

function currentMarker(): FakeV4Marker {
  const marker = overlays()[0];
  if (!marker) throw new Error("地图上还没有 Marker");
  return marker;
}

function listenerLeaks(): number {
  return fake.diagnostics.snapshot().leaks.listeners;
}

/** 取当前注册表（经公开 `MapContext.overlays`；组件里用的就是同一个对象）。 */
function registry() {
  const ctx = probeContext.value;
  if (!ctx) throw new Error("探针还没拿到 MapContext");
  return ctx.overlays;
}

const probeContext: { value: MapContext | null } = { value: null };

/** 探针：读一次 MapContext（`overlays` 注册表挂在它上面）。 */
const ContextProbe = defineComponent({
  setup() {
    probeContext.value = useRequiredMapContext();
    return () => null;
  },
});

/** 子组件视角的挂载目标（`TargetContext.target`），记录它最后一次看到的句柄。 */
const targetSeen: { value: SdkHandle<string> | null } = { value: null };
const TargetProbe = defineComponent({
  setup() {
    const target = useParentOverlayHandle();
    watchEffect(() => {
      targetSeen.value = target.value;
    });
    return () => null;
  },
});

/** 挂一个 `<BMap>`，把 BMarker（+ 可选子节点）放进去。 */
function hostWith(
  markerProps: () => BMarkerProps,
  options: { probe?: boolean; targetProbe?: boolean } = {},
) {
  return defineComponent({
    components: { BMap, BMarker },
    setup() {
      return () =>
        h(BMap, { provider: harness.provider() }, () => [
          ...(options.probe ? [h(ContextProbe)] : []),
          h(BMarker, markerProps(), () =>
            options.targetProbe ? [h(TargetProbe)] : [],
          ),
        ]);
    },
  });
}

async function mountMarker(
  markerProps: () => BMarkerProps,
  options: { probe?: boolean; targetProbe?: boolean } = {},
) {
  const wrapper = mount(hostWith(markerProps, options), { attachTo: harness.container() });
  await settle();
  await settle();
  return wrapper;
}

/* ---------------------------------------------------------------------- 声明面 */

describe("OverlaySpec 声明面与 Driver 描述符一致", () => {
  it("fields 恰好覆盖 BMarkerProps 的全部键", () => {
    // 类型层：漏一个 prop 时 `OverlayFieldMap` 就赋不上值（编译期），这里再逐项点名一次
    expect(Object.keys(MARKER_FIELDS).sort()).toEqual(
      [
        "position", "offset", "zIndex", "visible", "title",
        "enableDragging", "enableClicking", "rotation", "icon",
      ].sort(),
    );
    // 反向：声明里不能有 props 上不存在的键
    const declared = Object.keys(MARKER_FIELDS) as Array<keyof BMarkerProps>;
    expect(declared).toHaveLength(9);
  });

  it("声明为 options / recreate / position 的字段与描述符分类逐项一致", () => {
    const descriptor = OVERLAY_DESCRIPTORS.marker;
    for (const [prop, update] of Object.entries(MARKER_FIELDS)) {
      const declaredKey = MARKER_DESCRIPTOR_KEYS[prop as keyof BMarkerProps];
      const descriptorKey = declaredKey === undefined ? prop : declaredKey;
      const spec = descriptorKey === null ? undefined : overlayPropertySpec("marker", descriptorKey);
      if (update === "visibility") {
        // 显隐不是 SDK 属性：描述符里必须**没有**这个键
        expect(spec, `${prop} 不该出现在描述符里`).toBeUndefined();
        continue;
      }
      expect(spec, `${prop} 在描述符里找不到对应键`).toBeDefined();
      if (update === "options" || update === "position") {
        expect(spec!.policy, `${prop} 声明为就地更新`).toBe("mutable");
      } else {
        expect(spec!.policy, `${prop} 声明为构造期属性`).toBe("recreate");
      }
    }
    // 正证守卫：描述符里确实有这两个分类，否则上面的断言可能只是「什么都没检查」
    expect(overlayPropertySpec("marker", "icon")?.policy).toBe("mutable");
    expect(overlayPropertySpec("marker", "enableClicking")?.policy).toBe("recreate");
  });

  it("声明自相矛盾时构造期自检抛错（自检不是空转）", () => {
    const deps = { emit: () => {}, position: () => null };
    expect(() => assertOverlayFieldDeclarations(createMarkerSpec(deps))).not.toThrow();

    const contradictory = {
      ...createMarkerSpec(deps),
      type: "contradictory",
      fields: { icon: "options", visible: "visibility" },
      descriptorKeys: { icon: null, visible: "visible" },
    } as unknown as OverlaySpec<BMarkerProps, unknown>;
    expect(() => assertOverlayFieldDeclarations(contradictory)).toThrow(/不经描述符/);

    // 第二个用例：显隐字段没写成「不经描述符」——它会被当成 SDK 属性下发
    const wrongVisibility = {
      ...createMarkerSpec(deps),
      type: "wrong-visibility",
      fields: { icon: "options", visible: "visibility" },
      descriptorKeys: {},
    } as unknown as OverlaySpec<BMarkerProps, unknown>;
    expect(() => assertOverlayFieldDeclarations(wrongVisibility)).toThrow(/不进属性描述符/);

    // 第三个用例：多个 position 字段——第二个会被静默忽略，宁可起不来
    const twoPositions = {
      ...createMarkerSpec(deps),
      type: "two-positions",
      fields: { position: "position", offset: "position", visible: "visibility" },
      descriptorKeys: { position: "position", offset: "offset", visible: null },
    } as unknown as OverlaySpec<BMarkerProps, unknown>;
    expect(() => assertOverlayFieldDeclarations(twoPositions)).toThrow(/多个 position 字段/);
  });
});

/* ---------------------------------------------------------------- 初始状态 */

describe("初始状态（构造期属性一次到位）", () => {
  it("visible=false 时不挂到地图；其余属性在创建时就已应用", async () => {
    const visible = ref(false);
    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      visible: visible.value,
      enableDragging: true,
      enableClicking: false,
      rotation: 45,
      zIndex: 9,
      title: "天安门",
      offset: { x: 3, y: -4 },
      icon: { imageUrl: "https://example.com/a.png", size: { width: 20, height: 30 } },
    }));

    // 实例已创建（构造期属性都已交给 SDK），但**没有**挂到地图上
    expect(fake.createdOverlays.length).toBe(1);
    expect(harness.attached("overlay")).toBe(0);
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(0);

    const marker = fake.createdOverlays[0] as unknown as FakeV4Marker;
    expect(marker.dragging).toBe(true);
    expect(marker.rotation).toBe(45);
    expect(marker.zIndex).toBe(9);
    expect(marker.title).toBe("天安门");
    expect(marker.offset).not.toBeNull();
    expect(marker.icon).not.toBeNull();

    // 转为可见：这次才挂到地图（此前 show() 会作用在一个没挂载的实例上，等于永远不显示）
    visible.value = true;
    await settle();
    expect(harness.attached("overlay")).toBe(1);
    expect(currentMarker()).toBe(marker);
    expect(marker.visible).toBe(true);

    // 再切回不可见：优先 show/hide（不破坏覆盖物归属），不产生 remove
    visible.value = false;
    await settle();
    expect(marker.visible).toBe(false);
    expect(harness.attached("overlay")).toBe(1);
    expect(fake.diagnostics.snapshot().activity.overlaysDetached).toBe(0);

    wrapper.unmount();
    await settle();
    harness.assertIdle("初始 visible=false");
  });

  it("缺省值：visible=true / enableDragging=false 与 props 默认值一致", async () => {
    const wrapper = await mountMarker(() => ({ position: { lng: 116.4, lat: 39.9 } }));
    expect(harness.attached("overlay")).toBe(1);
    expect(currentMarker().dragging).toBe(false);
    expect(currentMarker().rotation).toBeNull();
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------------- mutable / recreate */

describe("mutable 就地更新，构造期属性重建", () => {
  it("全部 mutable 属性：实例不变、无新构造、只下发对应 setter", async () => {
    const rotate = ref(0);
    const zIndex = ref<number | undefined>(undefined);
    const title = ref("a");
    const offset = ref({ x: 0, y: 0 });
    const dragging = ref(false);
    const icon = ref<BMarkerProps["icon"]>({
      imageUrl: "https://example.com/a.png",
      size: { width: 10, height: 10 },
    });

    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      rotation: rotate.value,
      zIndex: zIndex.value,
      title: title.value,
      offset: offset.value,
      enableDragging: dragging.value,
      icon: icon.value,
    }));

    const first = currentMarker();
    const constructed = fake.createdOverlays.length;
    first.callLog.length = 0;

    rotate.value = 30;
    zIndex.value = 5;
    title.value = "b";
    offset.value = { x: 2, y: 2 };
    dragging.value = true;
    icon.value = { imageUrl: "https://example.com/b.png", size: { width: 10, height: 10 } };
    await settle();

    // 同一个实例、没有新的构造、也没有重复挂载
    expect(currentMarker()).toBe(first);
    expect(fake.createdOverlays.length).toBe(constructed);
    expect(harness.attached("overlay")).toBe(1);
    // 六个字段各自的 setter 都被调用过（一次批量更新，不是重建）
    expect(first.callLog).toEqual(
      expect.arrayContaining(["setRotation", "setZIndex", "setTitle", "setOffset", "enableDragging", "setIcon"]),
    );
    expect(first.rotation).toBe(30);
    expect(first.zIndex).toBe(5);
    expect(first.title).toBe("b");
    expect(first.dragging).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("mutable 批量更新");
  });

  it("构造期属性变化：恰好重建一次，旧实例的监听归零", async () => {
    const enableClicking = ref(true);
    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      enableClicking: enableClicking.value,
      zIndex: 3,
    }));

    const oldMarker = currentMarker();
    const constructed = fake.createdOverlays.length;
    const baseline = listenerLeaks();
    expect(oldMarker.getListenerCount()).toBeGreaterThan(0);

    enableClicking.value = false;
    await settle();

    const newMarker = currentMarker();
    expect(newMarker).not.toBe(oldMarker);
    expect(fake.createdOverlays.length).toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    // 旧实例的 child scope 归零，新实例继承了构造期属性
    expect(oldMarker.getListenerCount()).toBe(0);
    expect(listenerLeaks()).toBe(baseline);
    expect(newMarker.zIndex).toBe(3);

    wrapper.unmount();
    await settle();
    expect(listenerLeaks()).toBe(0);
    harness.assertIdle("构造期属性重建");
  });

  it("同一轮里同时改构造期与就地属性：只重建一次，且就地值落在最终实例上", async () => {
    const enableClicking = ref(true);
    const zIndex = ref(1);
    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      enableClicking: enableClicking.value,
      zIndex: zIndex.value,
    }));

    const constructed = fake.createdOverlays.length;
    // 同一个 tick 里改两个字段：队列必须把它们合并成**一批**，先重建再就地更新，
    // 否则就地值会写进一个马上被移除的中间实例（PR #61 的收敛点）
    enableClicking.value = false;
    zIndex.value = 7;
    await settle();

    expect(fake.createdOverlays.length).toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentMarker().zIndex).toBe(7);

    wrapper.unmount();
    await settle();
    harness.assertIdle("构造期 + 就地属性同批更新");
  });

  it("快速连续两次重建：地图上恰好一个实例，不重复挂载", async () => {
    const enableClicking = ref(true);
    const zIndex = ref(0);
    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      enableClicking: enableClicking.value,
      zIndex: zIndex.value,
    }));

    // 不等待：两次 replace 同时在飞（`useSdkResource` 的过期分支会把上一代先挂上再摘掉）
    enableClicking.value = false;
    zIndex.value = 1;
    await nextTick();
    enableClicking.value = true;
    zIndex.value = 2;
    await settle();
    await settle();

    expect(harness.attached("overlay")).toBe(1);
    expect(overlays()).toHaveLength(1);
    expect(currentMarker().zIndex).toBe(2);

    wrapper.unmount();
    await settle();
    harness.assertIdle("连续两次重建");
  });

  it("SDK 没有 show/hide 时退回 add/remove（显隐的兜底路径）", async () => {
    const visible = ref(true);
    const wrapper = await mountMarker(() => ({
      position: { lng: 116.4, lat: 39.9 },
      visible: visible.value,
    }));

    const marker = currentMarker();
    // 模拟「该 SDK 的覆盖物没有继承 Overlay#show/hide」：实例上屏蔽这两个成员
    (marker as { show?: unknown }).show = undefined;
    (marker as { hide?: unknown }).hide = undefined;

    visible.value = false;
    await settle();
    expect(harness.attached("overlay")).toBe(0);
    expect(fake.diagnostics.snapshot().activity.overlaysDetached).toBe(1);

    // 兜底路径下「再可见」必须重新 add（实例身份不变）
    visible.value = true;
    await settle();
    expect(harness.attached("overlay")).toBe(1);
    expect(currentMarker()).toBe(marker);

    wrapper.unmount();
    await settle();
    harness.assertIdle("显隐兜底路径");
  });
});

/* ------------------------------------------------------------- drag-end */

describe("drag-end 双向同步与回环抑制", () => {
  it("SDK 拖拽结束 → 回写模型并 emit；父级回写同值不重复下发命令", async () => {
    const position = ref({ lng: 116.4, lat: 39.9 });
    const wrapper = await mountMarker(() => ({
      position: position.value,
      enableDragging: true,
    }));

    const marker = currentMarker();
    marker.callLog.length = 0;

    // 1) 用户在 SDK 侧拖拽结束
    marker.emit("dragend", { point: { lng: 117.5, lat: 40.5 } });
    await settle();

    expect(wrapper.findComponent(BMarker).emitted("update:position")).toEqual([
      [{ lng: 117.5, lat: 40.5 }],
    ]);
    // 两个历史拼写都发（`dragend` 与 kebab 别名）
    expect(wrapper.findComponent(BMarker).emitted("dragend")).toHaveLength(1);
    expect(wrapper.findComponent(BMarker).emitted("drag-end")).toHaveLength(1);

    // 2) 父级按 v-model 回写同一个值 ⇒ 回环抑制：一条命令都不该发
    position.value = { lng: 117.5, lat: 40.5 };
    await settle();
    expect(marker.callLog).not.toContain("setPosition");

    // 3) SDK 重复派发同一位置：模型判等为「没变化」，不产生第二条 update
    marker.emit("dragend", { point: { lng: 117.5, lat: 40.5 } });
    await settle();
    expect(wrapper.findComponent(BMarker).emitted("update:position")).toHaveLength(1);

    // 4) 父级真的改了位置：照常写入 SDK
    position.value = { lng: 118, lat: 41 };
    await settle();
    expect(marker.callLog).toContain("setPosition");
    expect(marker.position.lng).toBe(118);

    // 5) 拖到「刚刚命令写入的那个位置」：与 SDK 一致 ⇒ 不重复 emit
    marker.emit("dragend", { point: { lng: 118, lat: 41 } });
    await settle();
    expect(wrapper.findComponent(BMarker).emitted("update:position")).toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("drag-end 往返");
  });

  it("位置更新不重建实例", async () => {
    const position = ref({ lng: 116.4, lat: 39.9 });
    const wrapper = await mountMarker(() => ({ position: position.value }));
    const marker = currentMarker();
    const constructed = fake.createdOverlays.length;

    position.value = { lng: 116.5, lat: 39.95 };
    await settle();

    expect(currentMarker()).toBe(marker);
    expect(fake.createdOverlays.length).toBe(constructed);
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------------ Target 与 Registry */

describe("Target 与 Registry", () => {
  it("注册表按类型记账，重建后仍是同一个类型且只有一条记录", async () => {
    const enableClicking = ref(true);
    const wrapper = await mountMarker(
      () => ({ position: { lng: 116.4, lat: 39.9 }, enableClicking: enableClicking.value }),
      { probe: true },
    );

    expect(registry().size).toBe(1);
    expect(registry().getByType("marker")).toHaveLength(1);
    const firstId = registry().getByType("marker")[0]!.id;

    enableClicking.value = false;
    await settle();

    // 旧记录随实例 scope 一起摘除，新实例重新登记 ⇒ 计数恒为 1、id 换新
    expect(registry().size).toBe(1);
    expect(registry().getByType("marker")[0]!.id).not.toBe(firstId);
    expect(registry().getByType("marker")[0]!.type).toBe("marker");

    wrapper.unmount();
    await settle();
    expect(registry().size).toBe(0);
  });

  it("子组件看到的目标随 Marker 重建切换到新句柄", async () => {
    const enableClicking = ref(true);
    const wrapper = await mountMarker(
      () => ({ position: { lng: 116.4, lat: 39.9 }, enableClicking: enableClicking.value }),
      { probe: true, targetProbe: true },
    );

    const firstHandle = registry().getByType("marker")[0]!.instance as SdkHandle<string>;
    expect(targetSeen.value).toBe(firstHandle);

    enableClicking.value = false;
    await settle();

    const secondHandle = registry().getByType("marker")[0]!.instance as SdkHandle<string>;
    expect(secondHandle).not.toBe(firstHandle);
    expect(targetSeen.value).toBe(secondHandle);

    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------- 100 次重建的资源稳定 */

describe("100 次重建后资源稳定", () => {
  it("listener / 图标缓存 / 注册表 / 实例数都不会随重建增长", async () => {
    const enableClicking = ref(true);
    const wrapper = await mountMarker(
      () => ({
        position: { lng: 116.4, lat: 39.9 },
        enableClicking: enableClicking.value,
        icon: "simple_red",
      }),
      { probe: true },
    );

    const baselineListeners = listenerLeaks();
    const firstIcon = currentMarker().icon;
    expect(baselineListeners).toBeGreaterThan(0);

    for (let i = 0; i < 100; i++) {
      // 初始是 true，因此 `=== 1` 保证每一次迭代都真的翻转（100 次都触发重建）
      enableClicking.value = i % 2 === 1;
      await settle();
    }

    expect(fake.createdOverlays.length).toBe(101);
    expect(harness.attached("overlay")).toBe(1);
    expect(registry().size).toBe(1);
    // 监听器回到单实例基线（旧实例的 child scope 每次都释放干净）
    expect(listenerLeaks()).toBe(baselineListeners);
    // 图标缓存命中：重建不重复构造 Icon，读的是同一份缓存实例
    expect(currentMarker().icon).toBe(firstIcon);
    // 注册表里的句柄指向**当前存活**的实例（内部 ref 没有攥着已移除的旧实例）
    expect((registry().getByType("marker")[0]!.instance as { raw: unknown }).raw).toBe(
      currentMarker(),
    );

    wrapper.unmount();
    await settle();
    expect(listenerLeaks()).toBe(0);
    expect(registry().size).toBe(0);
    harness.assertIdle("100 次重建");
  });
});

/* ------------------------------------------------------------------------------ */
