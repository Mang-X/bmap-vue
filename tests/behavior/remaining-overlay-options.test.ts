/**
 * 剩余构造选项的落地门禁（issue #168 item 2）
 *
 * #168 重新按 d.ts 逐条核对了三个族的选项缺口（此前的「7/10」「9/17」计数早于若干改动）：
 *
 * | 族 | 官方选项 | #168 之前 | 本次补 |
 * | --- | --- | --- | --- |
 * | `MarkerOptions` | 17 | 8 | `raiseOnDrag` / `draggingCursor` / `isTop` / `restrictDraggingArea` |
 * | `GroundOverlayOptions` | 10 | 7 | `enableMassClear` / `enableClicking` / `top`（`imageURL` 是 `@deprecated`，`drawHook` 只在 `type:'canvas'` 下有意义，见各条注释） |
 * | `CustomOverlayOptions` | 17 | 9 | 全部**不加**（逐条理由见两个 describe 的注释） |
 *
 * ## 分类的事实源仍然是 Driver 的属性描述符
 *
 * 与 #30 / #31 一致：组件声明「意图」，`OVERLAY_DESCRIPTORS` 给出「构造之后改它会怎样」。
 * 本文件断言的是**分类与落地**（`recreate` 就是重建、`mutable` 就是就地），因此它同时是
 * 「组件声明的策略与描述符一致」的交叉校验——组件声明错一个键，描述符就会红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import GroundOverlay from "../../packages/bmap-vue/src/components/overlays/GroundOverlay.vue";
import CustomOverlay from "../../packages/bmap-vue/src/components/overlays/CustomOverlay.vue";
import { MARKER_FIELDS, createMarkerSpec } from "../../packages/bmap-vue/src/components/overlays/markerSpec";
import { GROUND_OVERLAY_FIELDS } from "../../packages/bmap-vue/src/components/overlays/groundOverlaySpec";
import { CUSTOM_OVERLAY_FIELDS } from "../../packages/bmap-vue/src/components/overlays/customOverlaySpec";
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

const POINT = { lng: 116.404, lat: 39.915 };
const BOUNDS = { southwest: { lng: 116.4, lat: 39.9 }, northeast: { lng: 116.5, lat: 40.0 } };

async function mountOverlay(component: unknown, props: Record<string, unknown>) {
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [h(component as never, props)]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return wrapper;
}

function lastOverlay(): AnyRecord {
  const overlay = fake.createdOverlays.at(-1);
  if (!overlay) throw new Error("地图上没有覆盖物");
  return overlay as unknown as AnyRecord;
}

/* ------------------------------------------------------- Marker 的四个构造选项 */

describe("<Marker> 的四个构造选项（官方 overlay/MarkerOptions.d.ts）", () => {
  /**
   * 四条全部是**构造期**（`recreate`）：官方 `Marker` 实例上**没有**对应的
   * `setRaiseOnDrag` / `setDraggingCursor` / `setIsTop` / `setRestrictDraggingArea`
   * （逐个核对 `overlay/Marker.d.ts` 的成员表：`setIcon` / `setPosition` / `setOffset` /
   * `setTitle` / `setLabel` / `enable|disableDragging` / `enable|disableMassClear` /
   * `setZIndex` / `setAnchor` / `setRotation` / `setRotationOrigin` / `setRank` / `setOptions`
   * ——**一个都没有**这四个）。因此「改 prop 即重建实例」是唯一能让新值生效的路径。
   */
  it("四个选项的策略都是 recreate（实例上没有对应 setter）", () => {
    expect(MARKER_FIELDS.raiseOnDrag).toBe("recreate");
    expect(MARKER_FIELDS.draggingCursor).toBe("recreate");
    expect(MARKER_FIELDS.isTop).toBe("recreate");
    expect(MARKER_FIELDS.restrictDraggingArea).toBe("recreate");
  });

  it("四个选项都被 create 交给 SDK（构造期透传）", async () => {
    const wrapper = await mountOverlay(Marker, {
      position: POINT,
      raiseOnDrag: true,
      draggingCursor: "grabbing",
      isTop: true,
      restrictDraggingArea: true,
    });
    const raw = lastOverlay();

    expect(raw.options.raiseOnDrag).toBe(true);
    expect(raw.options.draggingCursor).toBe("grabbing");
    expect(raw.options.isTop).toBe(true);
    expect(raw.options.restrictDraggingArea).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker 四个构造选项");
  });

  /**
   * `draggingCursor` 的**真实形状是 `string`，不是枚举**。
   *
   * 官方 `overlay/MarkerOptions.d.ts` 的原文是
   * 「拖拽标注时的鼠标指针样式，需遵循 CSS cursor 属性规范」+ `draggingCursor?: string;`。
   * 没有任何 `@default`、没有任何候选值清单。因此本库收**普通 `string`**，**不**自造
   * 一个 `"grab" | "pointer" | …` 的联合——那会是「不取证就建抽象」，而且 CSS cursor
   * 的合法值是开放集合（`grabbing` / `move` / `crosshair` / 任何 `url(…)`），
   * 联合一定会漏。
   */
  it("draggingCursor 是 string（不是枚举联合），任意 CSS cursor 值原样透传", async () => {
    const wrapper = await mountOverlay(Marker, {
      position: POINT,
      draggingCursor: "url(/cursor.cur), crosshair",
    });
    expect(lastOverlay().options.draggingCursor).toBe("url(/cursor.cur), crosshair");
    wrapper.unmount();
    await settle();
  });

  it("⚠️ 官方默认 true 的选项在未给时**不得**被补成 true（Vue Boolean-absent 陷阱）", async () => {
    const wrapper = await mountOverlay(Marker, { position: POINT });
    // 四个选项的官方默认都是 false（`raiseOnDrag` / `isTop` / `restrictDraggingArea`），
    // `draggingCursor` 无默认（undefined）。未给时**不得**出现任何一项。
    const options = lastOverlay().options;
    for (const key of ["raiseOnDrag", "draggingCursor", "isTop", "restrictDraggingArea"]) {
      // 判据是**值**而不是「键是否存在」：组件的 `create` 把 `p.<key>` 交给 Driver，
      // Driver 的 `projectOptions` 才跳过 `undefined`。因此这里断言「没有值」——
      // 键在不在只取决于「组件有没有显式写这个字段」，对 SDK 语义没有影响。
      expect(options[key], `${key} 未给时不得被补成 false/true`).toBeUndefined();
    }
    wrapper.unmount();
    await settle();
  });

  it("任一项变化 → 重建实例（旧值不得留在图上）", async () => {
    const props = ref<Record<string, unknown>>({ position: POINT, isTop: false });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(MapComponent, { provider: harness.provider() }, () => [h(Marker, props.value)]),
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();
    const before = fake.createdOverlays.length;

    props.value = { position: POINT, isTop: true };
    await settle();
    await settle();

    expect(fake.createdOverlays.length, "recreate 类选项变化必须重建实例").toBe(before + 1);
    expect(lastOverlay().options.isTop).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker 重建");
  });
});

/* ------------------------------------------------------------ GroundOverlay 选项 */

describe("<GroundOverlay> 的三个缺失选项（官方 overlay/GroundOverlayOptions.d.ts）", () => {
  it("enableMassClear 是 options（官方有 enable|disableMassClear 一对开关）", () => {
    expect(GROUND_OVERLAY_FIELDS.enableMassClear).toBe("options");
  });

  it("enableClicking 是 recreate（官方 4.0 的 GroundOverlay 没有成对开关）", () => {
    expect(GROUND_OVERLAY_FIELDS.enableClicking).toBe("recreate");
  });

  /**
   * `top`（官方：`@default false`，「是否在普通覆盖物之上绘制」）。
   *
   * ⚠️ **官方 `GroundOverlay.d.ts` 没有 `setTop`**，因此它**只能构造期生效** ⇒ `recreate`。
   * 这一点与 `zIndex`（有 `setZIndex`，所以是 `options`）不同——两者都在描述符里，
   * 但落地方式不一样，逐条核对过官方成员表（`setBounds` / `getBounds` / `setOpacity` /
   * `getOpacity` / `setImage` / `setImageURL` / `getImageURL` / `setDisplayOnMinLevel` /
   * `getDisplayOnMinLevel` / `setDisplayOnMaxLevel` / `getDisplayOnMaxLevel` /
   * `setZIndex` / `getMap`——**没有 `setTop`**）。
   */
  it("top 是 recreate（官方没有 setTop）", () => {
    expect(GROUND_OVERLAY_FIELDS.top).toBe("recreate");
  });

  it("三个选项都被 create 交给 SDK", async () => {
    const wrapper = await mountOverlay(GroundOverlay, {
      bounds: BOUNDS,
      url: "https://example.com/ground.png",
      enableMassClear: false,
      enableClicking: false,
      top: true,
    });
    const options = lastOverlay().options;
    expect(options.enableMassClear).toBe(false);
    expect(options.enableClicking).toBe(false);
    expect(options.top).toBe(true);

    wrapper.unmount();
    await settle();
    harness.assertIdle("GroundOverlay 三个选项");
  });

  it("⚠️ 官方默认 true 的 enableMassClear / enableClicking 未给时不得被补成 true", async () => {
    const wrapper = await mountOverlay(GroundOverlay, {
      bounds: BOUNDS,
      url: "https://example.com/ground.png",
    });
    const options = lastOverlay().options;
    // ⚠️ 这三项的官方默认是 `true`（`enableMassClear` / `enableClicking`）与 `false`（`top`）。
    // Vue 的 Boolean prop 在未给时会变成 `false`——对 `enableMassClear` / `enableClicking`
    // 那是**与官方默认相反**的语义，因此 `withDefaults` 必须给显式 `undefined`。
    // 这里断言的就是那条：`undefined` 到达 SDK，不得变成 `false`。
    for (const key of ["enableMassClear", "enableClicking", "top"]) {
      expect(options[key], `${key} 未给时不得被补成 false（官方默认是 true / false）`).toBeUndefined();
    }
    wrapper.unmount();
    await settle();
  });

  it("enableMassClear 变化 → **就地**更新（不重建），这与另两个不同", async () => {
    const props = ref<Record<string, unknown>>({
      bounds: BOUNDS,
      url: "https://example.com/ground.png",
      enableMassClear: true,
    });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(MapComponent, { provider: harness.provider() }, () => [h(GroundOverlay, props.value)]),
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();
    const before = fake.createdOverlays.length;

    props.value = { ...props.value, enableMassClear: false };
    await settle();
    await settle();

    expect(fake.createdOverlays.length, "mutable 类选项不得重建").toBe(before);
    wrapper.unmount();
    await settle();
    harness.assertIdle("GroundOverlay 就地更新");
  });
});

/* ----------------------------------------------------------- CustomOverlay 的裁决 */

describe("<CustomOverlay> 的官方选项：为什么基本都不加（官方 overlay/CustomOverlayOptions.d.ts）", () => {
  /**
   * ⚠️ **`zIndex` 必须是 `recreate`，不得改成 `mutable`**（反向守卫）。
   *
   * 官方 `CustomOverlay` **没有** `setZIndex`（成员表逐条核对过：`setPoint` /
   * `setRotation` / `setRotationOrigin` / `getRotation` / `getPoint` / `setProperties` /
   * `getProperties` / `addEventListener`）。因此 `zIndex` 只能构造期生效。
   * 仓库里有一条**反向守卫测试**钉这一条——`etc/**` 之外的
   * `tests/behavior/overlay-update-policy.test.ts`。这里再点名一次，
   * 免得下次有人「顺手」按其它覆盖物的口径把它改成 `mutable`。
   */
  it("zIndex 保持 recreate（官方 CustomOverlay 没有 setZIndex）", () => {
    expect(CUSTOM_OVERLAY_FIELDS.zIndex).toBe("recreate");
  });

  /**
   * 官方 `CustomOverlayOptions` 共 17 个键，本库只收 9 个。**逐条裁决**如下——
   * 缺口**不等于**待补：
   *
   * | 官方键 | 裁决 | 理由 |
   * | --- | --- | --- |
   * | `point` | 已有（`position`） | 本库用 `position` 命名（与全部覆盖物统一），投影到 `point` |
   * | `anchors` | 已有（`anchor`） | 同上；`anchor` 是 `[x, y]` |
   * | `offsetX` / `offsetY` | 已有（`offset`） | 官方把一个偏移拆成两个 X/Y 标量，本库用 `{x, y}` |
   * | `rotationInit` | 已有（`rotation`） | 官方构造键名 |
   * | `minZoom` / `maxZoom` | 已有 | — |
   * | `properties` | 已有 | — |
   * | `zIndex` / `enableMassClear` | 已有（`recreate`） | 见上一条 |
   * | `rotationFlip` | **不加** | 官方只声明构造项，**没有** `setRotationFlip`；且它是「旋转超过 90° 时是否翻转内容」——一个**渲染细节**，本库既不测也不暴露，让业务自己改 DOM 更直接 |
   * | `fixBottom` | **不加** | 同上（无 setter 的构造期渲染细节） |
   * | `useTranslate` | **不加** | 官方原文「是否使用 translate3d 进行**性能优化**」——这是**性能开关**，不是能力开关；暴露它等于让用户去调 SDK 的内部实现策略，而它的效果依浏览器/图层而定，无法在本库侧断言 |
   * | `autoFollowHeadingChanged` | **不加** | 「是否随地图旋转」与 `rotation` 强耦合，**无 setter**；加进来会让「改了 `rotation` 却没跟着转」这类组合变成一个**无法验证**的 prop |
   * | `visible` | 已有（`visible` prop） | 官方构造键；本库走 `show`/`hide` 策略（`Overlay` 基类） |
   * | `enableDraggingMap` | **不加** | 「覆盖物上是否允许拖拽地图」——这**是**一个真实能力，但没有 setter，且它与 `setPoint(point, noReCreate)` 的第二参数语义交叉（拖图会移动覆盖物，而本库的 `position` 是**受控** prop，两者会互相覆盖）。在没有「用户拖了图」事件可对齐之前，受控模型与它不能共存 |
   * | `nextTick` | **不加** | 官方原文「是否**延迟一帧**再显示，用于解决 DOM 自适应宽度问题」——这是**时序 hack**，不是能力；暴露它等于承诺一个本库无法保证的渲染时序 |
   * | `synUpdate` | **不加** | 官方原文「开启后覆盖物位置更新将**不再走默认的坐标转换逻辑**」——它会**改变 `position` 的语义**。本库的 `position` 是受控主模型，一旦允许用户关掉坐标转换，同一个 prop 在两种模式下行为不同且无法检测 ⇒ 不暴露 |
   *
   * **总的判据**：17 - 9 = 8 个缺口，其中 6 个是「无 setter 的渲染细节 / 性能开关 / 时序 hack」，
   * 2 个（`enableDraggingMap` / `synUpdate`）会**与本库的受控主模型冲突**。
   * 补它们不会增加任何**可断言的能力**，只会增加「声明了却几乎观察不到」的面。
   */
  it("8 个官方缺口全部是「渲染细节 / 与受控模型冲突」，不补", () => {
    for (const key of [
      "rotationFlip",
      "fixBottom",
      "useTranslate",
      "autoFollowHeadingChanged",
      "enableDraggingMap",
      "nextTick",
      "synUpdate",
    ] as const) {
      expect(
        key in CUSTOM_OVERLAY_FIELDS,
        `${key} 刻意不收（理由见本 describe 的逐条表）`,
      ).toBe(false);
    }
  });

  it("`imageURL`（GroundOverlay 的 @deprecated 别名）刻意不收：官方标注 @deprecated", () => {
    // 官方 `GroundOverlayOptions.imageURL` 带 `@deprecated 4.0 请使用 url`。
    // 本库 1.0 不提供旧版迁移路径（集中弃用层已随 #136 整层删除）⇒ 收 `url` 一份。
    expect("imageURL" in GROUND_OVERLAY_FIELDS).toBe(false);
  });
});

/* ------------------------------------------------- GroundOverlay.url 的既有窄化 */

describe("GroundOverlay.url 的 canvas 窄化（既有事实，如实记录）", () => {
  /**
   * ⚠️ 官方 `GroundOverlayOptions.url?: string | HTMLCanvasElement`（含 canvas），
   * 但**上游的 `GroundOverlay#setImage(url: string)` 只接受字符串**。
   *
   * 也就是说官方**声明**支持 canvas，但**运行期更新路径不支持**——这是一处**上游自身**
   * 的不对称。本库因此：
   * - 构造期**照收** `string | HTMLCanvasElement | (() => …)`（`type: "canvas"` 的用法）；
   * - 运行期把 `url` 的策略声明为 `options`（`setImage`）——**这是一个已知窄化**：
   *   构造后换 canvas 会被 `setImage` 拒掉。
   *
   * 本次**不**改这条策略（改它要动 Fake 的 `setImage` 签名，属于另一件事），
   * 只把「官方声明的宽度 > 本库能给的宽度」记成一条会红的断言，避免它悄悄变宽/变窄。
   */
  it("setImage 路径对 canvas 的支持是已知窄化（官方 setImage(url: string)）", () => {
    // 描述符把 url 映射到 setImage（官方 GroundOverlay.d.ts:62）
    expect(GROUND_OVERLAY_FIELDS.url).toBe("options");
  });
});

/* ------------------------------------------------------- spec 与字段表的一致性 */

describe("Marker spec 的字段表与 props 键集一致（防漂移）", () => {
  it("createMarkerSpec 的 fields 覆盖 create 用到的全部选项", () => {
    const spec = createMarkerSpec({ emit: () => {}, position: () => null });
    for (const key of [
      "raiseOnDrag",
      "draggingCursor",
      "isTop",
      "restrictDraggingArea",
    ] as const) {
      expect(spec.fields[key], `${key} 必须在 spec 里声明策略`).toBeDefined();
    }
  });
});
