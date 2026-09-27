/**
 * `<Marker>` / `<Label>` / `<MarkerCluster>` 补齐项的**运行时**门禁（issue #165 第三批）
 *
 * 声明面（哪些键该收、哪些键必须收不下）由
 * `tests/type-contracts/marker-label-cluster-options.type-test.ts` 钉住；本文件钉的是
 * **可观察效果**：选项真的到达 SDK、`mutable` 真的就地调 setter 而不换实例、
 * `recreate` 真的换实例、以及构造期项「未给 ⇒ 键不进 options」。
 *
 * ## live 读数（真实 AK + headless Chrome，2026-09-27；本页结论全部由它支撑）
 *
 * ### ⚠️ 取样时机是本文件的第一课（#165 已因此翻车三次）
 *
 * 官方 4.0 的成员面是**逐步补齐**的。同一个 `BMap.Marker.prototype`：
 *
 * | 取样时刻 | `setAnchor` 在原型链哪一层 |
 * | --- | --- |
 * | 官方 loader 的 callback 刚触发（未 settle） | **-1（整条链都没有）** |
 * | 建图后 **4s** | **layer 1**，`instSetAnchor: "function"`，真调一次不抛、`getAnchor()` 读回 `8` |
 *
 * ⇒ **在 settle 之前读到 `absent` 只能说明「还没到」，不能说明「不存在」**。
 * 同一个探针里 `Label#setWidth` 在 settle 之后**仍然**是 layer = -1（真调抛
 * `setWidth is not a function`）——那才是真的不存在。两者必须靠「settle 之后再读」分开。
 *
 * 因此本文件**不**把「原型链上有没有」当成判据，而是**只断言可观察效果**：
 * `recreate` 项必须换实例、**旧实例上不得出现猜出来的 setter**；`mutable` 项必须不换实例、
 * 且新值真的被调到了存活实例上。判据细节见 `driver/types/overlays.ts` 的
 * `PATH_CTOR_LINE_JOINT`（「在位且调得动」≠「可观察地生效」）。
 *
 * ### 逐条读数与分类
 *
 * | 选项 | 官方声明行 | 分类 | 依据 |
 * | --- | --- | --- | --- |
 * | `MarkerOptions.label` | `overlay/MarkerOptions.d.ts:74` | **`mutable`** | `Marker.d.ts:110/:115` 声明 `setLabel` / `getLabel`；live：原型链 layer 1、真调不抛、`getLabel().getContent()` 从 `"hello"` 变 `"second"` ⇒ 可观察地生效 |
 * | `MarkerOptions.autoFollowHeadingChanged` | `:87` | **`recreate`** | `Marker.d.ts` 成员表**无**对应 setter；live：`setAutoFollowHeadingChanged` 整条链 layer = **-1**、实例 `typeof` = `undefined` |
 * | `MarkerOptions.startAnimation` | `:91` | **`recreate`** | 同上；live：`setStartAnimation` layer = **-1** |
 * | `LabelOptions.anchor` | `overlay/LabelOptions.d.ts:19` | **`mutable`** | `Label.d.ts` 声明 `setAnchor` / `getAnchor`；live **可观察地生效**：同一经纬度上默认 / `anchor:8` / `anchor:2` 三个 Label 的 DOM 分别是 `(top 90, left 263)` / `(69, 217)` / `(69, 263)`，对 `anchor:8` 那个调 `setAnchor(0)` 之后**移回 `(90, 263)`** |
 * | `LabelOptions.width` | `:29` | **`recreate`** | `Label.d.ts` 成员表**无** `setWidth`；live：settle 后整条链 layer = **-1**、真调抛。构造期**确实生效**（不给 = DOM `14px` 按内容自适应；给 `77` = `77px`）⇒ 构造期可用，不是「不可实现」 |
 * | `ClusterLayerOptions.tileSize` | `visualization/ClusterLayer.d.ts:73` | **`recreate`** | 无逐字段 setter；live **可观察地生效**：同样 `clusterRadius: 300`、只把 `tileSize` 从 256 改成 1024，簇数 **1 → 2**（官方「参与半径归一化」）⇒ 键本身有效，只是没有逐字段更新入口 |
 * | `ClusterLayerOptions.fitViewMargin` | `:88` | **`recreate`** | live：`setOptions` 后 `getOptions()` 读回 `[7,8,9,10]`（默认 `[12,12,12,12]`）⇒ 整袋入口采纳，但**不是**逐字段入口 |
 * | `ClusterLayerOptions.updateRealTime` | `:93` | **`recreate`** | live：`setOptions` 后读回 `false → true`（同上一条） |
 * | `ClusterLayerOptions.waitTime` | `:98` | **`recreate`** | live：`setOptions({ waitTime: 222 })` 后读回 `222`（默认 `300`） |
 * | `ClusterLayerOptions.clusterIcon` | `:114` | **`recreate`** | live：构造传入后 `getOptions().clusterIcon` 键在位 |
 * | `ClusterLayerOptions.clusterIconSize` | `:117` | **`recreate`** | live：构造传入后 `getOptions().clusterIconSize({})` 返回 `[33,44]`（回调**真的被留着**，不是被吞掉） |
 *
 * ### 为什么 `ClusterLayer` 的六项**全部**是 `recreate`（尽管 `setOptions` 存在且有效）
 *
 * live 实测：`setOptions({ clusterRadius: 20 → 300 })` 之后，同一实例的 `change` 事件簇数
 * 从 3 变成 1，**不必**再调 `redraw()`。看起来够格叫 `mutable`，但本库**不**这么判，三条理由：
 *
 * 1. `setOptions` 是**整袋**入口，官方专页对它的描述是「批量更新配置/样式」——
 *    它**不是**为「只改其中一个键」设计的公开逐字段通道；
 * 2. 更关键：它**顺带覆盖样式**。本库的 `setStyle` 落到 `setOptions`
 *    （`driver/jsapi-v4/native-layers.ts` 的 `styleMember`），而 `setStyle` 是**整袋替换**
 *    ——两者共用一个成员，认成 `mutable` 会让「聚合参数」与「样式」两条通道互相踩。
 * 3. 与本票已落地的 21 个图形族构造期选项**同一口径**（`PATH_CTOR_*`）：判据是
 *    「有没有**公开的逐字段更新入口**」，`setOptions` 不满足。
 *
 * 因此这六项与同族的 `clusterRadius` / `clusterMinPoints` / `clusterMinZoom` /
 * `clusterMaxZoom` / `fitViewOnClick` / `singleStyle` 保持一致——**一致本身就是判据**：
 * 一个族里出现两种策略、而差异只源于「本库碰巧有个同名 prop」，才是需要解释的异常。
 * （下方「反向守卫」那条用例正是钉这一点。）
 *
 * ### 明确**不加**的三类（各带一条带理由的用例，见文件末尾）
 *
 * - `minZoom` / `maxZoom`：官方 `ClusterLayerOptions` **确实**声明了它们，但官方
 *   `ClusterLayer` 上**没有** `setZoomRange` / `setMinZoom` / `setMaxZoom`
 *   （live：整条原型链 layer = **-1**）⇒ 收下就是「改 prop 悄悄不生效」。
 *   与 `<PointLayer>` / `<HeatmapLayer>` 早已有的同一裁决一致。
 * - `enablePicked` / `mouseStyleChange` / `pickTolerance`：拾取面是 native 引擎的**内部决策**
 *   （`enablePicked: true` 硬编码，理由见 `nativeClusterEngine.ts` 文件头）。
 * - `<HeatmapLayer>` 的六个键：**刻意收窄，本票不动**——理由已重新核过一次（文件末尾）。
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import Label from "../../packages/bmap-vue/src/components/overlays/Label.vue";
import MarkerCluster from "../../packages/bmap-vue/src/components/data/MarkerCluster.vue";
import { MARKER_FIELDS } from "../../packages/bmap-vue/src/components/overlays/markerSpec";
import { LABEL_FIELDS } from "../../packages/bmap-vue/src/components/overlays/labelSpec";
import { overlayPropertyPolicy } from "../../packages/bmap-vue/src/driver/types/overlays";
import { createFakeV4Harness, FakeV4ClusterLayer } from "../../packages/test-utils";
import type { FakeBMapV4, FakeV4Harness } from "../../packages/test-utils";

type AnyRecord = Record<string, any>;

const SRC_ROOT = resolve(import.meta.dirname, "../../packages/bmap-vue/src");
/** 读 `packages/bmap-vue/src` 下的一份源文件（几条「刻意不加 / 刻意不动」的断言需要看源码）。 */
const readSource = (relative: string): string => readFileSync(resolve(SRC_ROOT, relative), "utf8");

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

const POINT = { lng: 116.404, lat: 39.915 };

function mountWith(component: unknown, props: () => Record<string, unknown>) {
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [h(component as never, props())]),
    }),
    { attachTo: harness.container() },
  );
  return wrapper;
}

/** 挂载（静态 props）并等到资源真的建出来。 */
async function mountOverlay(component: unknown, props: Record<string, unknown>) {
  const wrapper = mountWith(component, () => props);
  await settle();
  await settle();
  return wrapper;
}

/** 挂载并把 props 收进一个 ref，返回改 props 的句柄。 */
async function mountMutable(component: unknown, props: Record<string, unknown>) {
  // ⚠️ ref **必须逐次新建**（不能是模块级共享的那一个）：上一次用例的 wrapper 只要还挂在
  // DOM 上，就会跟着下一次 `current.value = …` 一起重渲染，于是它会收到**别的组件**的 props
  // （实测表现为 Vue 报 `<Marker content=… anchor=…>` 这种自相矛盾的 extraneous 属性）。
  const current = ref<Record<string, unknown>>(props);
  const wrapper = mountWith(component, () => current.value);
  await settle();
  await settle();
  return {
    wrapper,
    async set(next: Record<string, unknown>): Promise<void> {
      current.value = next;
      await settle();
      await settle();
    },
  };
}

function lastOverlay(): AnyRecord {
  const overlay = fake.createdOverlays.at(-1);
  if (!overlay) throw new Error("地图上没有覆盖物");
  return overlay as unknown as AnyRecord;
}

function lastCluster(): FakeV4ClusterLayer {
  const found = (fake.createdNativeLayers as unknown[])
    .filter((l): l is FakeV4ClusterLayer => l instanceof FakeV4ClusterLayer)
    .at(-1);
  if (!found) throw new Error("地图上没有 ClusterLayer");
  return found;
}

/* ============================================================== <Marker> 三个新选项 */

/**
 * `<Marker>` 补三个官方已声明、此前未暴露的 `MarkerOptions` 键。
 *
 * 分类**不是**「三个都是 recreate」：`label` 有成对的 `setLabel` / `getLabel`
 * （`overlay/Marker.d.ts:110` / `:115`），live 读数下可观察地生效 ⇒ `mutable`；
 * 另两个在成员表与整条运行时原型链上都**没有**对应入口 ⇒ `recreate`。
 */
describe("<Marker> 的 label / autoFollowHeadingChanged / startAnimation", () => {
  it("分类：label 是 mutable，另两个是 recreate（描述符与 spec 两处都要一致）", () => {
    // 描述符（Driver 侧的事实源）
    expect(overlayPropertyPolicy("marker", "label")).toBe("mutable");
    expect(overlayPropertyPolicy("marker", "autoFollowHeadingChanged")).toBe("recreate");
    expect(overlayPropertyPolicy("marker", "startAnimation")).toBe("recreate");
    // 组件声明（`OverlayFieldMap` 的 `-?` 已保证键集完整，这里钉策略本身）
    expect(MARKER_FIELDS.label).toBe("options");
    expect(MARKER_FIELDS.autoFollowHeadingChanged).toBe("recreate");
    expect(MARKER_FIELDS.startAnimation).toBe("recreate");
  });

  it("构造期透传：三个键都被 create 交给 SDK 的 options", async () => {
    const wrapper = await mountOverlay(Marker, {
      position: POINT,
      label: { content: "hi", position: POINT, offset: { x: 8, y: -12 } },
      autoFollowHeadingChanged: true,
      startAnimation: "grow",
    });
    const options = lastOverlay().options;
    // `label` 在官方 `MarkerOptions` 里是一个 **BMap.Label 实例**；本库组件面**不构造 SDK
    // 对象**，因此 `label` prop 收的是**本库领域形状**（与 `<Label>` 的 props 同构），
    // Driver 在边界内把它变成 SDK 的 `BMap.Label`。判据是「值到达了」，不是「同一个对象」。
    expect(options.label).toBeDefined();
    expect(options.autoFollowHeadingChanged).toBe(true);
    expect(options.startAnimation).toBe("grow");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker 三个新构造选项");
  });

  /**
   * ⚠️ **Vue Boolean-absent 陷阱**（本 ticket 已踩三次）：`autoFollowHeadingChanged` 的官方
   * `@default` 是 `false`（`overlay/MarkerOptions.d.ts:88`）。`Boolean` prop 未给时运行时是
   * `false`——与官方默认**值上一致**但**来源不同**。`withDefaults` 必须写显式 `undefined`，
   * 否则父级传 `:auto-follow-heading-changed="undefined"` 会触发一次**内容完全没变**的重建。
   */
  it("⚠️ 官方默认 false 的 autoFollowHeadingChanged 未给时键不得进 options", async () => {
    const wrapper = await mountOverlay(Marker, { position: POINT });
    const options = lastOverlay().options;
    for (const key of ["autoFollowHeadingChanged", "startAnimation", "label"]) {
      expect(
        Object.prototype.hasOwnProperty.call(options, key),
        `${key} 未给时不得进 options`,
      ).toBe(false);
    }
    wrapper.unmount();
    await settle();
  });

  /** `label` 是 `mutable`：改它**不换实例**，而是真的调 `setLabel` 落到存活实例上。 */
  it("label 是 mutable：改它就地调 setLabel，旧 Marker 实例存活", async () => {
    const { wrapper, set } = await mountMutable(Marker, {
      position: POINT,
      label: { content: "first", position: POINT },
    });
    const before = lastOverlay();
    const countBefore = fake.createdOverlays.length;

    await set({ position: POINT, label: { content: "second", position: POINT } });

    expect(fake.createdOverlays.length, "mutable 不得换实例").toBe(countBefore);
    expect(lastOverlay(), "必须还是同一个实例").toBe(before);
    // 观察的是「setLabel 真的被调到」而不是「options 里被改了」——后者只是静态读数，
    // 前者才是「就地更新生效」的证据。
    expect(lastOverlay().callLog).toContain("setLabel");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker label 就地更新");
  });

  it("recreate：autoFollowHeadingChanged 变化 → 换实例（旧实例上不得出现猜出来的 setter）", async () => {
    const { wrapper, set } = await mountMutable(Marker, {
      position: POINT,
      autoFollowHeadingChanged: false,
    });
    const before = lastOverlay();
    const countBefore = fake.createdOverlays.length;

    await set({ position: POINT, autoFollowHeadingChanged: true });

    expect(fake.createdOverlays.length, "recreate 类选项变化必须换实例").toBe(countBefore + 1);
    // 官方 `Marker` 实例上没有 `setAutoFollowHeadingChanged`（live：settle 后整条原型链
    // layer = -1）。认成 `mutable` 会让更新落到「按名字推导的 set<Key> 逃生口」上
    // ⇒ 静默「改了没反应」。
    expect(
      before.callLog.filter((entry: string) => /autoFollow|startAnimation/i.test(entry)),
      "旧实例不得收到猜出来的 setter",
    ).toEqual([]);
    expect(lastOverlay().options.autoFollowHeadingChanged).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker autoFollowHeadingChanged 重建");
  });

  it("recreate：startAnimation 变化 → 换实例", async () => {
    const { wrapper, set } = await mountMutable(Marker, {
      position: POINT,
      startAnimation: "grow",
    });
    const countBefore = fake.createdOverlays.length;

    await set({ position: POINT, startAnimation: "shrink" });

    expect(fake.createdOverlays.length, "recreate 类选项变化必须换实例").toBe(countBefore + 1);
    expect(lastOverlay().options.startAnimation).toBe("shrink");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker startAnimation 重建");
  });
});

/* ================================================================== <Label> 两个新键 */

/**
 * `<Label>` 补 `anchor` 与 `width`。
 *
 * `anchor` 是**遗漏**而不是收窄：描述符里**早就**登记了 `mutateBy("setAnchor", { ctorKey:
 * "anchor" })`（`driver/types/overlays.ts`），组件却**从不暴露**它 ⇒ 那条更新路径一次都
 * 没被触发过。live 读数判定它是 `mutable`（`setAnchor` 在原型链 layer 1，且**可观察地生效**）。
 */
describe("<Label> 的 anchor / width", () => {
  it("分类：anchor 是 mutable（描述符早有），width 是 recreate", () => {
    expect(overlayPropertyPolicy("label", "anchor")).toBe("mutable");
    expect(overlayPropertyPolicy("label", "width")).toBe("recreate");
    expect(LABEL_FIELDS.anchor).toBe("options");
    expect(LABEL_FIELDS.width).toBe("recreate");
  });

  it("anchor 用官方常量名传给 SDK（值换算在 Driver 边界内）", async () => {
    const wrapper = await mountOverlay(Label, {
      content: "hi",
      position: POINT,
      anchor: "BMAP_ANCHOR_BOTTOM_CENTER",
    });
    // 领域侧是**常量名**（与 `<ZoomControl>` 等控件同一口径：`ControlAnchor` 是
    // `BMAP_ANCHOR_*` 九个常量的联合，不是裸数字）；Driver 边界内换成官方数值。
    // live 读数确认 `window.BMAP_ANCHOR_BOTTOM_CENTER === 8`，`BMap` 命名空间上同值。
    expect(lastOverlay().options.anchor).toBe(8);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Label anchor 构造");
  });

  it("anchor 是 mutable：改它就地调 setAnchor，不换实例，且参数是官方数值", async () => {
    const { wrapper, set } = await mountMutable(Label, {
      content: "hi",
      position: POINT,
      anchor: "BMAP_ANCHOR_BOTTOM_CENTER",
    });
    const before = lastOverlay();
    const countBefore = fake.createdOverlays.length;

    await set({ content: "hi", position: POINT, anchor: "BMAP_ANCHOR_TOP_RIGHT" });

    expect(fake.createdOverlays.length, "mutable 不得换实例").toBe(countBefore);
    expect(lastOverlay()).toBe(before);
    expect(lastOverlay().callLog).toContain("setAnchor");
    // 官方 `Label#setAnchor(anchor: ControlAnchor)` 收的是数值（`BMAP_ANCHOR_TOP_RIGHT === 1`）
    expect(lastOverlay().anchor).toBe(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Label anchor 就地更新");
  });

  it("width 是 recreate：构造期透传，变化 → 换实例", async () => {
    const { wrapper, set } = await mountMutable(Label, {
      content: "hi",
      position: POINT,
      width: 77,
    });
    expect(lastOverlay().options.width).toBe(77);
    const before = lastOverlay();
    const countBefore = fake.createdOverlays.length;

    await set({ content: "hi", position: POINT, width: 120 });

    expect(fake.createdOverlays.length, "官方 Label 没有 setWidth ⇒ 只能换实例").toBe(countBefore + 1);
    // live：settle 之后整条原型链 layer = -1，真调抛 `setWidth is not a function`
    // ⇒ 认成 `mutable` 就是「调用一个不存在的方法」。
    expect(
      before.callLog.filter((entry: string) => /width/i.test(entry)),
      "旧实例不得收到猜出来的 setWidth",
    ).toEqual([]);
    expect(lastOverlay().options.width).toBe(120);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Label width 重建");
  });

  it("⚠️ width 未给时键不得进 options（官方默认 0 = 按内容自适应）", async () => {
    const wrapper = await mountOverlay(Label, { content: "hi", position: POINT });
    expect(
      Object.prototype.hasOwnProperty.call(lastOverlay().options, "width"),
      "width 未给时不得进 options（补成 0 会与「未表态」混同）",
    ).toBe(false);
    wrapper.unmount();
    await settle();
  });

  /**
   * ⚠️ 归一化「拒绝」的值**整个键不得出现**（类型被绕过时的兜底）。
   *
   * `anchorFor` 对不认识的常量名告警并给 `undefined`。若把它当成「值是 undefined」塞进构造
   * options，官方就会读到「用户显式要求了一个无意义的锚点」——那与「沿用默认」不是一回事。
   * 与控件 Driver 的 `if (anchor !== undefined)` 同款守卫（两条路径共用同一张 `ANCHOR_VALUES`）。
   *
   * 正常类型下这个分支**不可达**（`OverlayAnchor` 是九元封闭联合），所以这里用 `as never`
   * 绕过去——测的是「万一有人从 JS 传进来一个不认的字符串，会发生什么」。
   */
  it("不认识的锚点名：告警一次，且键整个不进 options（不塞 undefined）", async () => {
    const wrapper = await mountOverlay(Label, {
      content: "hi",
      position: POINT,
      anchor: "NOT_A_REAL_ANCHOR" as never,
    });
    const options = lastOverlay().options;
    expect(
      Object.prototype.hasOwnProperty.call(options, "anchor"),
      "被拒绝的键不得以 undefined 的形式出现",
    ).toBe(false);
    expect(lastOverlay().anchor, "实例应沿用 SDK 自身默认锚点（未被写入）").toBeNull();
    wrapper.unmount();
    await settle();
  });
});

/* ========================================================== <MarkerCluster> 六个新选项 */

interface Item {
  id: string;
  lng: number;
  lat: number;
}

const ITEMS: Item[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p-${i}`,
  lng: 116.4 + i * 0.01,
  lat: 39.9 + i * 0.01,
}));

const CLUSTER_PROPS = {
  data: ITEMS,
  itemKey: "id" as const,
  getPosition: (item: Item) => ({ lng: item.lng, lat: item.lat }),
};

const SIX_NEW_KEYS = [
  "tileSize",
  "fitViewMargin",
  "updateRealTime",
  "waitTime",
  "clusterIcon",
  "clusterIconSize",
] as const;

/**
 * `<MarkerCluster>`（`engine: "native"`）补齐官方 `ClusterLayerOptions` 的六个选项。
 *
 * 这六个此前**没有**书面理由被省略，而它们同族的另外六个就在同一个 props 接口里 ⇒ 遗漏。
 * 全部按**构造期**落地（理由见本文件头「为什么六项全部是 recreate」）。
 */
describe("<MarkerCluster> 的 tileSize / fitViewMargin / updateRealTime / waitTime / clusterIcon / clusterIconSize", () => {
  it("六个选项都被 create 原样交给 SDK 的构造 options（engine: native）", async () => {
    const clusterIcon = () => "https://example.invalid/cluster.png";
    const clusterIconSize = () => [40, 41] as [number, number];
    const wrapper = await mountOverlay(MarkerCluster, {
      ...CLUSTER_PROPS,
      tileSize: 512,
      fitViewMargin: [3, 4, 5, 6],
      updateRealTime: true,
      waitTime: 111,
      clusterIcon,
      clusterIconSize,
    });
    const options = lastCluster().options;
    expect(options.tileSize).toBe(512);
    expect(options.fitViewMargin).toEqual([3, 4, 5, 6]);
    expect(options.updateRealTime).toBe(true);
    expect(options.waitTime).toBe(111);
    // 函数型原样透传：live 读数确认 SDK 真的**留着**这个回调
    //（`getOptions().clusterIconSize({})` 返回构造时闭包里的 `[33,44]`）⇒ 不是被吞掉的空 prop。
    expect(options.clusterIcon).toBe(clusterIcon);
    expect(options.clusterIconSize).toBe(clusterIconSize);

    wrapper.unmount();
    await settle();
    harness.assertIdle("MarkerCluster 六个新选项");
  });

  it("⚠️ 未给的键不得进 options（官方默认值由 SDK 自己决定，本库不猜）", async () => {
    const wrapper = await mountOverlay(MarkerCluster, CLUSTER_PROPS);
    const options = lastCluster().options;
    for (const key of SIX_NEW_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(options, key),
        `${key} 未给时不得进 options`,
      ).toBe(false);
    }
    wrapper.unmount();
    await settle();
  });

  it("任一项变化 → 换 ClusterLayer 实例（旧实例被摘、记账归零）", async () => {
    const { wrapper, set } = await mountMutable(MarkerCluster, { ...CLUSTER_PROPS, tileSize: 256 });
    const before = lastCluster();
    const countBefore = fake.createdNativeLayers.length;

    await set({ ...CLUSTER_PROPS, tileSize: 1024 });

    expect(fake.createdNativeLayers.length, "构造期选项变化必须换实例").toBe(countBefore + 1);
    expect(lastCluster()).not.toBe(before);
    expect(lastCluster().options.tileSize).toBe(1024);

    wrapper.unmount();
    await settle();
    harness.assertIdle("MarkerCluster tileSize 重建");
  });

  /**
   * ⚠️ **反向守卫**：这六项**必须**留在 `recreate`。
   *
   * 官方 `ClusterLayer` 有公开的 `setOptions`，live 实测改聚合参数**确实**会重算
   * （`clusterRadius` 20 → 300 后 `change` 事件的簇数 3 → 1，不必再 `redraw()`）。
   * 若把某一项改成「就地更新」，更新会落到 `setOptions` 上——而 `setStyle` **也**落到
   * `setOptions`（整袋替换），两条通道会互相踩。
   *
   * 判据在此写成**可观察的**而不是读源码：认成 `mutable` 时旧实例的 `callLog` 里会多出
   * `setOptions`；留在 `recreate` 时它必须只被摘掉、一次 SDK 写入都不该有。
   */
  it.each(SIX_NEW_KEYS)("%s 变化时旧实例不得收到 setOptions（反证：它没被认成 mutable）", async (key) => {
    const initial: Record<string, unknown> = { ...CLUSTER_PROPS };
    initial[key] = key === "fitViewMargin" ? [1, 2, 3, 4] : key.endsWith("Icon") || key === "clusterIconSize" ? () => [1, 1] : 1;
    const next: Record<string, unknown> = { ...CLUSTER_PROPS };
    next[key] = key === "fitViewMargin" ? [9, 9, 9, 9] : key.endsWith("Icon") || key === "clusterIconSize" ? () => [2, 2] : 2;

    const { wrapper, set } = await mountMutable(MarkerCluster, initial);
    const before = lastCluster();
    await set(next);

    expect(
      before.callLog.filter((entry: string) => entry === "setOptions"),
      `${key} 若被认成 mutable，旧实例会收到 setOptions（= 与 setStyle 抢同一个成员）`,
    ).toEqual([]);
    expect(lastCluster(), `${key} 变化必须换实例`).not.toBe(before);

    wrapper.unmount();
    await settle();
  });

  it("engine: 'markers' 下这六项不生效（与既有同族选项同一口径：不偷偷切路径）", async () => {
    const { wrapper, set } = await mountMutable(MarkerCluster, {
      ...CLUSTER_PROPS,
      engine: "markers",
      tileSize: 512,
    });
    const countBefore = fake.createdNativeLayers.length;
    await set({ ...CLUSTER_PROPS, engine: "markers", tileSize: 1024 });
    // markers 引擎是 Marker 网格聚合，它**不读** tileSize ⇒ 不得换图层实例。
    expect(fake.createdNativeLayers.length, "markers 引擎不读这些选项，不得重建图层").toBe(countBefore);
    wrapper.unmount();
    await settle();
  });
});

/* ============================================== 刻意不加 / 刻意不动：逐条理由锁死 */

/**
 * 官方 `ClusterLayerOptions` 里**声明了、本库刻意不加**的 `minZoom` / `maxZoom`。
 *
 * 写成用例而不是注释，是为了让「加上去」这个动作必须先删掉一条带理由的断言——
 * 这正是「不改」也需要门禁的原因。判据读的是引擎源码：这两项若被收进 props，
 * `constructorOptions` / `instanceFingerprint` 一定会开始读 `props.minZoom`。
 */
describe("刻意不加：官方声明了但没有公开更新入口的 minZoom / maxZoom", () => {
  it("引擎不读 props.minZoom / props.maxZoom（官方没有 setZoomRange / setMinZoom / setMaxZoom）", () => {
    const source = readSource("components/data/nativeClusterEngine.ts");
    // live（settle 之后）：三者都**不在** `BMap.ClusterLayer.prototype` 的任何一层（layer = -1）
    expect(source).not.toMatch(/props\.minZoom\b/);
    expect(source).not.toMatch(/props\.maxZoom\b/);
  });

  it("声明面同样不加（类型层由 type-test 的 @ts-expect-error 钉住）", () => {
    const source = readSource("types/components.ts");
    const start = source.indexOf("export interface MarkerClusterProps<Item>");
    expect(start, "必须找得到 MarkerClusterProps 的声明点").toBeGreaterThan(-1);
    // 切到**下一个**顶层声明为止（固定长度窗口会溢出到相邻接口，把别的接口的键算进来）
    const rest = source.slice(start + "export interface MarkerClusterProps<Item>".length);
    const next = rest.search(/^export (?:interface|type) /m);
    const block = rest.slice(0, next === -1 ? rest.length : next);
    expect(block, "该块必须找得到").not.toBe("");
    expect(block).not.toMatch(/^\s*minZoom\??:/m);
    expect(block).not.toMatch(/^\s*maxZoom\??:/m);
  });
});

/**
 * 拾取面（`enablePicked` / `mouseStyleChange` / `pickTolerance`）**仍然**是 native 引擎的
 * 内部决策——本票补六个聚合/交互选项**没有**改变这条。
 *
 * `enablePicked: true` 的原始理由（`nativeClusterEngine.ts` 文件头）：`cluster-click` /
 * `item-click` 是这个组件的**核心交互**，而官方扩展专页把 `enablePicked` 写在示例里；
 * 本库没有「关掉拾取」的消费者，因此不暴露成 prop（收下一个不知道会不会生效的开关
 * 属于假支持）。
 *
 * 2026-09-27 的 live 读数**没有**推翻它：官方 `ClusterLayerOptions.enablePicked` 的
 * `@default` 就是 `true`（`:103`），且 Driver 对 `cluster` 登记了 `setEnablePicked`
 * （live：原型链 layer 0）——「有 setter」成立，但**没有消费者**仍是加 prop 的充分否决
 * 理由（#104：没有消费者的扩展面一律不加；「关掉拾取」会让 `cluster-click` 永远不触发，
 * 那不是能力，是自断交互）。
 */
describe("enablePicked 的硬编码仍然成立（补六个选项没有改变这条决策）", () => {
  it("构造选项仍是 enablePicked: true，且没有暴露成 prop", async () => {
    const wrapper = await mountOverlay(MarkerCluster, CLUSTER_PROPS);
    expect(lastCluster().options.enablePicked).toBe(true);

    const source = readSource("components/data/nativeClusterEngine.ts");
    expect(source, "硬编码仍在").toMatch(/enablePicked: true/);
    expect(source, "本票刻意不把它变成 prop").not.toMatch(/props\.enablePicked\b/);

    wrapper.unmount();
    await settle();
  });
});

/**
 * `<HeatmapLayer>` 的**窄口径复核**（本票**不动**它，但必须写下「为什么现在仍然成立」）。
 *
 * 此前记录的理由是「官方扩展 API 只公开整袋 `setOptions`，且没有可核对的声明」。
 * 4.0.5 已经**补上了类声明**（`visualization/Heatmap.d.ts`），因此那条理由的**前半句已经
 * 失效**——声明现在可核对了。于是必须重新回答一次。
 *
 * live 读数（2026-09-27，settle 之后）给出的答案是：官方 `Heatmap` 的成员表里，为这六个键
 * 声明了字段级 setter 的**只有两个**——`setGradient(gradient)` 与
 * **`setRadius(radius)`**（注意 setter 名是 `setRadius` 而构造键叫 **`size`**，名字对不上：
 * 按名字推导的逃生口会直接打空）；而 `size` / `unit` / `min` / `max` / `weightField` 五个
 * **在整条运行时原型链上都不在**（layer = -1）。
 *
 * 本组件的 `style` prop 已经是官方的**整袋透传口**（`setOptions`），六个键都能从那里到达；
 * 再开六个逐项 prop 会让「同一个值有两条通道」——而这与 `<Label>.width` 那种
 * 「只有一条路、必须开」的情形不是一回事（`width` 没有任何其它入口）。因此**维持窄口径**，
 * 理由从「无可核对的声明」升级为「**没有可复核的逐字段入口**，且已有整袋口」。
 */
describe("<HeatmapLayer> 的窄口径仍然成立（理由已从「无声明」换成「无可复核的逐字段入口」）", () => {
  it("HeatmapLayerProps 仍只有 data / style / visible 三个 prop", () => {
    const source = readSource("types/components.ts");
    const block = source.slice(
      source.indexOf("export interface HeatmapLayerProps"),
      source.indexOf("export interface TrackLineLayerProps"),
    );
    expect(block, "该块必须找得到").not.toBe("");
    for (const key of ["gradient", "size", "unit", "min", "max", "weightField"]) {
      expect(block, `HeatmapLayerProps 不应有 ${key}`).not.toMatch(new RegExp(`^\\s*${key}\\??:`, "m"));
    }
  });

  /**
   * 本票的判据依赖一条**上游事实**：官方为这六个键提供的字段级 setter 恰好两个，
   * 且其中一个的 setter 名与构造键名**不同**。把它断言在官方类型包上，上游改声明时
   * 这里会先翻红（而不是等到某次「本该生效却没生效」的现场）。
   */
  it("官方 Heatmap 只为 gradient 与 radius 声明了字段级 setter（且 radius 的 setter 名是 setRadius、构造键名是 size）", () => {
    const official = readOfficialHeatmapDeclaration();
    expect(official, "官方 Heatmap.d.ts 必须找得到").not.toBe("");
    // 声明了字段级 setter 的两个
    expect(official).toMatch(/setGradient\(gradient:/);
    expect(official).toMatch(/setRadius\(radius: number\)/);
    // 构造期键一个不少，但它们**没有**对应的字段级 setter
    // （注意 `size` 的 setter 官方叫 `setRadius`，因此这里查的是「按构造键名推导」的名字）
    for (const key of ["size", "unit", "min", "max", "weightField"]) {
      const derived = `set${key[0]!.toUpperCase()}${key.slice(1)}`;
      expect(
        official,
        `官方 Heatmap 不应声明 ${derived}（本票的窄口径判据依赖「它没有」这一事实）`,
      ).not.toMatch(new RegExp(`${derived}\\s*\\(`));
    }
  });
});

/** 从类型包里取官方 `visualization/Heatmap.d.ts`（pnpm store 的目录名带 hash，故按 glob 找）。 */
function readOfficialHeatmapDeclaration(): string {
  const base = resolve(SRC_ROOT, "../../../node_modules/.pnpm");
  const matches = globSync(
    "@baidumap+jsapi-v4-types@*/node_modules/@baidumap/jsapi-v4-types/visualization/Heatmap.d.ts",
    { cwd: base },
  );
  const first = matches[0];
  if (!first) throw new Error("找不到官方 @baidumap/jsapi-v4-types 的 Heatmap.d.ts");
  return readFileSync(resolve(base, first), "utf8");
}
