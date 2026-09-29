/**
 * 图形类覆盖物**构造期**选项的落地门禁（issue #165 图形族补齐）
 *
 * 逐条按 `@baidumap/jsapi-v4-types@4.0.5` 的 `overlay/{Polyline,Polygon,Circle,BezierCurve,Rectangle}Options.d.ts`
 * 核对，每个类的官方选项与本库覆盖的对照见本文件头的表。
 *
 * ## 21 个缺口的分类结论：**全部**是 `recreate`（构造期）
 *
 * 判据不是「官方只在 options 里声明了它」，而是**逐个核对实例成员表**后确认**没有**对应 setter：
 *
 * | 类 | 实例成员表（`overlay/<Class>.d.ts` 逐条） | 缺口 |
 * | --- | --- | --- |
 * | `Polyline` | `setPath` / `getPath` / `set|getStrokeColor|Opacity|Weight|Style` / `getBounds` / `enableEditing` / `setZIndex` / `enableMassClear` / `setPositionAt` / `getMap` | `strokeLineCap` `strokeLineJoin` `enableClicking` `geodesic` `linkRight` `clip` `coordType` `icons` `strokeTexture` `dashArray` |
 * | `Polygon` | 上列 + `set|getFillColor|Opacity` / `setPositionAt(index, point, deep)` | `strokeLineCap` `strokeLineJoin` `enableClicking` `linkRight` `coordType` `dashArray` |
 * | `Circle` | `set|getCenter` / `set|getRadius` / 描边填充四件套 / `getBounds` / `enableEditing` / `setZIndex` / `enableMassClear` / `getMap` | `coordType` `dashArray` |
 * | `BezierCurve` | `set|getPath` / `set|getControlPoints` / 描边四件套 / `getBounds` / `setZIndex` / `enableMassClear` / `getMap` | `enableClicking` `dashArray` |
 *
 * ⚠️ 同一个名字**跨类**的读法不一样，判据必须**逐类**取：
 * `zIndex` 在六个图形类上都有 `setZIndex` ⇒ `options`；`dashArray` 在四个类上**一个 setter 都没有**。
 * 把「`PATH_STYLE` 里是这个策略」读成「整族都是这个策略」正是本文件要拦的错误。
 *
 * ## 唯一一条「声明与运行时不一致」的：`strokeLineCap` / `strokeLineJoin`
 *
 * 其余 19 项是**声明里就没有、运行时整条原型链上也没有**（live 读数：layer = -1），
 * 判据干净。这两项不同：官方 4.0.5 的**类型声明里没有**它们，但**运行时原型链 layer 2 上有**、
 * 且**真调一次不抛**。之所以仍然判成 `recreate`，是因为 live 实测**调完没有任何可观察的变化**
 * （`getStrokeStyle()` 读回不变）——认成 `mutable` 就是「调用成功但画面不变」的**静默假支持**。
 * 完整读数与推理见本文件最后一个 describe。
 *
 * ## 为什么 `enableClicking` 已是既成事实却仍在本文件里点名
 *
 * `<Rectangle>` / `<Circle>` / `<GroundOverlay>` / `<Marker>` / `<Label>` / `<Prism>` / `<BezierCurve>`
 * 早就在描述符里登记了 `enableClicking: recreate`——但 `<Polyline>` / `<Polygon>` 的**组件面**没有出口。
 * 描述符有键、组件没暴露 ⇒ 更新一次都不会被触发。本文件因此**逐个组件**断言它真的到了 SDK。
 *
 * ## 「键缺席」为什么也要断言
 *
 * Driver 的 `projectOptions` 跳过 `undefined`（`driver/jsapi-v4/overlays.ts`），
 * 而 `setOptions` 对**未声明的键**会告警。因此「未给 ⇒ 键不在构造选项里」不是洁癖：
 * 它是「官方默认（本库不重复表达）」与「用户显式关掉」**可区分**的唯一保证。
 * 官方 `@default` 默认为 `true` 的几项（`enableClicking` / `linkRight` / `clip`）尤其要命：
 * 补成 `false` 与官方默认**相反**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Polyline from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import Polygon from "../../packages/bmap-vue/src/components/overlays/Polygon.vue";
import Circle from "../../packages/bmap-vue/src/components/overlays/Circle.vue";
import BezierCurve from "../../packages/bmap-vue/src/components/overlays/BezierCurve.vue";
import { POLYLINE_FIELDS } from "../../packages/bmap-vue/src/components/overlays/polylineSpec";
import { POLYGON_FIELDS } from "../../packages/bmap-vue/src/components/overlays/polygonSpec";
import { CIRCLE_FIELDS } from "../../packages/bmap-vue/src/components/overlays/circleSpec";
import { BEZIER_CURVE_FIELDS } from "../../packages/bmap-vue/src/components/overlays/bezierCurveSpec";
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
const POINTS = [
  { lng: 116.4, lat: 39.9 },
  { lng: 116.5, lat: 40.0 },
];
const TRIANGLE = [
  { lng: 116.4, lat: 39.9 },
  { lng: 116.5, lat: 40.0 },
  { lng: 116.45, lat: 39.95 },
];
const BOUNDS = { southwest: { lng: 116.4, lat: 39.9 }, northeast: { lng: 116.5, lat: 40.0 } };
const CONTROL_POINTS = [[{ lng: 116.42, lat: 39.95 }]];

/** 每个组件的最小必需 props（缺了构造期就抛，测不到选项）。 */
const MINIMAL: Record<string, Record<string, unknown>> = {
  Polyline: { points: POINTS },
  Polygon: { points: TRIANGLE },
  Circle: { center: POINT, radius: 1000 },
  Rectangle: { bounds: BOUNDS },
  BezierCurve: { points: POINTS, controlPoints: CONTROL_POINTS },
};

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

/** 挂载并把 props 收进一个 ref，返回改 props 的句柄。 */
async function mountMutable(component: unknown, props: Record<string, unknown>) {
  const current = ref<Record<string, unknown>>(props);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [h(component as never, current.value)]),
    }),
    { attachTo: harness.container() },
  );
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

/* ------------------------------------------------------- 21 个缺口的逐条分类 */

/**
 * ⚠️ **反向守卫**：这 21 项**全部**是 `recreate`。
 *
 * 逐条依据见本文件头的实例成员表。特别点名三个容易被误判成 `mutable` 的：
 *
 * - `dashArray`：四个类上**一个** setter 都没有（连 `setDash` 也没有）；
 * - `strokeLineCap` / `strokeLineJoin`：官方**没有** `setLineCap` / `setLineJoin`，
 *   名字相近不等于方法存在；
 * - `coordType`：它改变的是**坐标解读**（构造时按哪种坐标系解析输入点），
 *   构造之后改它没有意义——官方也没有 `setCoordType`。
 *
 * 把其中任何一项改成 `options`，更新会落到「按 `set<Key>` 推导的逃生口」上，
 * 静默变成「改了没反应」——`overlay-update-policy.test.ts` 就是钉这一类误判的。
 */
describe("图形族 21 个官方选项的策略全部是 recreate（实例上没有对应 setter）", () => {
  const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
    [
      "Polyline",
      POLYLINE_FIELDS as Record<string, unknown>,
      [
        "strokeLineCap", "strokeLineJoin", "enableClicking", "geodesic", "linkRight",
        "clip", "coordType", "icons", "strokeTexture", "dashArray",
      ],
    ],
    [
      "Polygon",
      POLYGON_FIELDS as Record<string, unknown>,
      ["strokeLineCap", "strokeLineJoin", "enableClicking", "linkRight", "coordType", "dashArray"],
    ],
    ["Circle", CIRCLE_FIELDS as Record<string, unknown>, ["coordType", "dashArray"]],
    ["BezierCurve", BEZIER_CURVE_FIELDS as Record<string, unknown>, ["enableClicking", "dashArray"]],
  ];

  it.each(CASES)("%s：%j 全部声明为 recreate", (_name, fields, keys) => {
    for (const key of keys) {
      expect(fields[key], `${key} 必须在 spec 里声明策略`).toBeDefined();
      expect(fields[key], `${key} 必须是 recreate（官方没有对应 setter）`).toBe("recreate");
    }
  });
});

/* ------------------------------------------------------------------ Polyline */

/**
 * `<Polyline>` 一次补上**十个**官方选项（4.0.5 的 `PolylineOptions` 共 17 个，此前覆盖 7 个）。
 *
 * 逐条分类：
 * | 选项 | 官方 `@default` | 分类依据 |
 * | --- | --- | --- |
 * | `strokeLineCap` / `strokeLineJoin` | `'round'` | **live 读数**：原型链 layer 2 上**有**同名 setter、调得动，但**调完无可观察效果**（`getStrokeStyle()` 不变）且官方**没有**读回 ⇒ 仍是 `recreate`（`mutateBy` = 静默假支持） |
 * | `enableClicking` | `true` | 无成对开关（与 `<Rectangle>` / `<Circle>` 的既有口径一致） |
 * | `geodesic` | `false` | 无 `setGeodesic`；且它决定**两点之间怎么连**（路径本身） |
 * | `linkRight` | `false` | 无 `setLinkRight` |
 * | `clip` | `true` | 无 `setClip`；官方原文「绘制跨经度 180 度的折线时可设为 false 以优化效果」 |
 * | `coordType` | 未设置时用全局 `BMap.coordType` | 无 `setCoordType`；它决定**输入点怎么解读**，只在构造时有意义 |
 * | `icons` | 无 | 无 `setIcons`；且官方 `IconSequence` **已 `@deprecated`**（4.0 起请用 `strokeTexture`） |
 * | `strokeTexture` | 无 | 无 `setStrokeTexture`；官方注明「仅 WebGL 渲染模式支持」 |
 * | `dashArray` | 实线与间隙均为线宽 2 倍 | 无 `setDashArray` / `setDash` |
 */
describe("<Polyline> 的十个构造选项（官方 overlay/PolylineOptions.d.ts:28-93）", () => {
  const ALL = {
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    enableClicking: false,
    geodesic: true,
    linkRight: true,
    clip: false,
    coordType: "BMAP_COORD_GCJ02",
    dashArray: [8, 4],
  } as const;

  it("十个选项都被 create 原样交给 SDK 的构造 options", async () => {
    const wrapper = await mountOverlay(Polyline, { points: POINTS, ...ALL });
    const options = lastOverlay().options;
    for (const [key, value] of Object.entries(ALL)) {
      expect(options[key], `${key} 必须到达构造 options`).toEqual(value);
    }
    wrapper.unmount();
    await settle();
    harness.assertIdle("Polyline 十个构造选项");
  });

  /**
   * ⚠️ **Vue Boolean-absent 陷阱**（本 ticket 已踩三次）。
   *
   * 官方 `@default` 是 `true` 的三项：`enableClicking` / `linkRight` / `clip`。
   * `Boolean` 类型 prop 在**未给**时运行时值是 `false`——与官方默认**相反**。
   * 因此 `withDefaults` 必须给显式 `undefined`（**不是** `true`）：`undefined` 让该键
   * **不进入**构造选项，SDK 沿用它自己的 `true` 默认。
   */
  it("⚠️ 官方默认 true 的 enableClicking / linkRight / clip 未给时键**不得**出现", async () => {
    const wrapper = await mountOverlay(Polyline, { points: POINTS });
    const options = lastOverlay().options;
    for (const key of ["enableClicking", "linkRight", "clip"]) {
      // 判据是**键不存在**（不是「值为 undefined」）：Driver 的 projectOptions 会跳过
      // `undefined`，但「值被 Vue 编成 false」会带着 `false` 真的进 options。
      expect(Object.prototype.hasOwnProperty.call(options, key), `${key} 未给时不得进 options`).toBe(
        false,
      );
    }
    // 官方默认 false 的两项同理：不得被补成 true。
    for (const key of ["geodesic"]) {
      expect(Object.prototype.hasOwnProperty.call(options, key), `${key} 未给时不得进 options`).toBe(
        false,
      );
    }
    wrapper.unmount();
    await settle();
  });

  it("任一项变化 → 重建实例（recreate 的可观察效果）", async () => {
    const { wrapper, set } = await mountMutable(Polyline, { points: POINTS, dashArray: [8, 4] });
    const before = fake.createdOverlays.length;

    await set({ points: POINTS, dashArray: [2, 2] });

    expect(fake.createdOverlays.length, "recreate 类选项变化必须重建实例").toBe(before + 1);
    expect(lastOverlay().options.dashArray).toEqual([2, 2]);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Polyline 重建");
  });
});

/* ------------------------------------------------------------------- Polygon */

describe("<Polygon> 的六个构造选项（官方 overlay/PolygonOptions.d.ts:36-69）", () => {
  const ALL = {
    strokeLineCap: "square",
    strokeLineJoin: "bevel",
    enableClicking: false,
    linkRight: true,
    coordType: "BMAP_COORD_WGS84",
    dashArray: [6, 2],
  } as const;

  it("六个选项都被 create 原样交给 SDK 的构造 options", async () => {
    const wrapper = await mountOverlay(Polygon, { points: TRIANGLE, ...ALL });
    const options = lastOverlay().options;
    for (const [key, value] of Object.entries(ALL)) {
      expect(options[key], `${key} 必须到达构造 options`).toEqual(value);
    }
    wrapper.unmount();
    await settle();
    harness.assertIdle("Polygon 六个构造选项");
  });

  it("⚠️ 官方默认 true 的 enableClicking / linkRight 未给时键不得出现", async () => {
    const wrapper = await mountOverlay(Polygon, { points: TRIANGLE });
    const options = lastOverlay().options;
    for (const key of ["enableClicking", "linkRight"]) {
      expect(Object.prototype.hasOwnProperty.call(options, key), `${key} 未给时不得进 options`).toBe(
        false,
      );
    }
    wrapper.unmount();
    await settle();
  });

  it("strokeLineCap 变化 → 重建实例（不得静默走 setLineCap 逃生口）", async () => {
    const { wrapper, set } = await mountMutable(Polygon, {
      points: TRIANGLE,
      strokeLineCap: "round",
    });
    const before = fake.createdOverlays.length;
    const beforeOverlay = lastOverlay();

    await set({ points: TRIANGLE, strokeLineCap: "butt" });

    expect(fake.createdOverlays.length, "recreate 类选项变化必须重建实例").toBe(before + 1);
    // ⚠️ 旧实例上**不得**出现任何 setter 调用：官方没有 setLineCap，走逃生口会静默「改了没反应」。
    expect(
      beforeOverlay.callLog.filter((entry: string) => /linecap|linejoin|dash/i.test(entry)),
      "旧实例不得收到猜出来的 setter",
    ).toEqual([]);
    expect(lastOverlay().options.strokeLineCap).toBe("butt");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Polygon strokeLineCap 重建");
  });
});

/* -------------------------------------------------------------------- Circle */

describe("<Circle> 的两个构造选项（官方 overlay/CircleOptions.d.ts:50,54）", () => {
  it("coordType / dashArray 被 create 原样交给 SDK", async () => {
    const wrapper = await mountOverlay(Circle, {
      center: POINT,
      radius: 1000,
      coordType: "BMAP_COORD_BD09",
      dashArray: [4, 4],
    });
    const options = lastOverlay().options;
    expect(options.coordType).toBe("BMAP_COORD_BD09");
    expect(options.dashArray).toEqual([4, 4]);
    wrapper.unmount();
    await settle();
    harness.assertIdle("Circle 两个构造选项");
  });

  it("未给时两个键都不出现（官方无默认值，靠 SDK 自己取）", async () => {
    const wrapper = await mountOverlay(Circle, { center: POINT, radius: 1000 });
    const options = lastOverlay().options;
    expect(Object.prototype.hasOwnProperty.call(options, "coordType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(options, "dashArray")).toBe(false);
    wrapper.unmount();
    await settle();
  });

  it("dashArray 变化 → 重建实例", async () => {
    const { wrapper, set } = await mountMutable(Circle, {
      center: POINT,
      radius: 1000,
      dashArray: [2, 2],
    });
    const before = fake.createdOverlays.length;
    await set({ center: POINT, radius: 1000, dashArray: [9, 9] });
    expect(fake.createdOverlays.length).toBe(before + 1);
    expect(lastOverlay().options.dashArray).toEqual([9, 9]);
    wrapper.unmount();
    await settle();
    harness.assertIdle("Circle dashArray 重建");
  });
});

/* --------------------------------------------------------------- BezierCurve */

describe("<BezierCurve> 的两个构造选项（官方 overlay/BezierCurveOptions.d.ts:36,41）", () => {
  it("enableClicking / dashArray 被 create 原样交给 SDK", async () => {
    const wrapper = await mountOverlay(BezierCurve, {
      points: POINTS,
      controlPoints: CONTROL_POINTS,
      enableClicking: false,
      dashArray: [3, 3],
    });
    const options = lastOverlay().options;
    expect(options.enableClicking).toBe(false);
    expect(options.dashArray).toEqual([3, 3]);
    wrapper.unmount();
    await settle();
    harness.assertIdle("BezierCurve 两个构造选项");
  });

  it("⚠️ 官方默认 true 的 enableClicking 未给时键不得出现", async () => {
    const wrapper = await mountOverlay(BezierCurve, {
      points: POINTS,
      controlPoints: CONTROL_POINTS,
    });
    expect(Object.prototype.hasOwnProperty.call(lastOverlay().options, "enableClicking")).toBe(false);
    wrapper.unmount();
    await settle();
  });
});

/* ---------------------------------------------------------------- 反向守卫 */

/**
 * ⚠️ **跨类的策略必须逐类取**——本组钉的就是「拿一族读另一族」这个误判。
 *
 * `zIndex` 在六个图形类上都有 `setZIndex`（`options`），而 `dashArray` 在四个类上
 * **一个 setter 都没有**（`recreate`）。两者在同一个 `PathShapeProps` 底座上共存，
 * 所以「它们都在共享接口里」不推出「它们策略相同」。
 */
describe("反向守卫：跨类的同名字段策略**不**共享", () => {
  it("zIndex 是 options（官方六类都有 setZIndex）而 dashArray 是 recreate（都没有）", () => {
    expect(POLYLINE_FIELDS.zIndex, "zIndex 有 setZIndex").toBe("options");
    expect(POLYLINE_FIELDS.dashArray, "dashArray 没有 setter").toBe("recreate");
  });

  it("strokeStyle 是 options（官方六类都有 setStrokeStyle）而 strokeLineCap 是 recreate", () => {
    expect(POLYLINE_FIELDS.strokeStyle, "strokeStyle 有 setStrokeStyle").toBe("options");
    expect(POLYLINE_FIELDS.strokeLineCap, "live 读数：无可观察效果").toBe("recreate");
  });

  it("enableMassClear 是 options（成对开关）而 enableClicking 是 recreate（无开关）", () => {
    for (const fields of [POLYLINE_FIELDS, POLYGON_FIELDS, CIRCLE_FIELDS, BEZIER_CURVE_FIELDS]) {
      expect(fields.enableMassClear, "官方有 enable|disableMassClear 一对").toBe("options");
      expect(fields.enableClicking, "官方没有 enable|disableClicking 一对").toBe("recreate");
    }
  });
});

/* ------------------------------------------- live 读数带来的那一条最容易误判的分类 */

/**
 * ## `strokeLineCap` / `strokeLineJoin`：**「在位且调得动」不等于「有效」**
 *
 * 这一条单独立组，因为它是本轮 21 个选项里**唯一一个**「声明与运行时不一致」的，
 * 也是最容易被下一次「顺手改成 `mutable`」推翻的。
 *
 * **live 读数**（headless Chrome + live AK，2026-09-27；脚本 `/tmp/probe-mini.mts`，
 * 报告 `/tmp/mini.json`）——`Polyline` 的原型链是 7 层（自有成员数 8 / 9 / 38 / 27 / 11 / 12 / 12）：
 *
 * | 成员 | 原型链归属 | 真调一次 | 官方类型声明 |
 * | --- | --- | --- | --- |
 * | `setStrokeLineCap` | layer 2（与 `setStrokeColor` / `setStrokeWeight` / `setStrokeStyle` **同一层**） | **不抛**，返回 `undefined` | ❌ **没有** |
 * | `setStrokeLineJoin` | layer 2（同上） | **不抛**，返回 `undefined` | ❌ **没有** |
 * | `setLineCap` / `setLineJoin` | **-1**（整条链都没有） | — | ❌ 没有 |
 * | `setDashArray` / `setDash` / `setCoordType` / `setEnableClicking` / `setGeodesic` / `setLinkRight` / `setClip` / `setIcons` / `setStrokeTexture` | **-1** | — | ❌ 没有 |
 * | `setStrokeColor` / `setStrokeWeight` / `setStrokeStyle`（对照项） | layer 2 | — | ✅ 有 |
 * | `setZIndex`（对照项） | layer 3 | — | ✅ 有 |
 * | `setPath`（对照项） | layer 0（自有） | — | ✅ 有 |
 *
 * **关键的那一步**：调完 `setStrokeLineCap("square")` + `setStrokeLineJoin("bevel")` 之后，
 * `getStrokeStyle()` 读回**仍然是 `"solid"`**（调用前也是 `"solid"`）——**没有任何可观察的变化**。
 *
 * 因此分类是 `recreate` 而不是 `mutateBy("setStrokeLineCap")`：认成 `mutable` 会让更新
 * 「成功」（不抛、进了 callLog）却**画面不变**——那是**静默假支持**，
 * 比 `recreate` 的「改它就重建」糟糕得多（后者至少保证回到官方默认）。
 *
 * ## 为什么这条断言要用 `callLog` 而不是断言「重建了」
 *
 * Fake 的 `callLog` 记的是「哪个 setter 被调用过」。本条要拦的正是
 * 「某个 getter 名被当成了 setter 调下去」——所以判据是**旧实例上不出现**它。
 * 重建本身由上面 `strokeLineCap 变化 → 重建实例` 那条钉住。
 */
describe("live 读数：strokeLineCap / strokeLineJoin 在原型链上但**无可观察效果** ⇒ 仍是 recreate", () => {
  it("改 strokeLineCap 时**不得**对旧实例调 setStrokeLineCap（只能重建）", async () => {
    const { wrapper, set } = await mountMutable(Polyline, {
      points: POINTS,
      strokeLineCap: "round",
    });
    const before = fake.createdOverlays.length;
    const beforeOverlay = lastOverlay();

    await set({ points: POINTS, strokeLineCap: "square" });

    expect(fake.createdOverlays.length, "recreate 类选项变化必须重建实例").toBe(before + 1);
    expect(
      beforeOverlay.callLog,
      "旧实例上不得出现 setStrokeLineCap —— live 读数证明它调得动但**没有效果**，" +
        "认成 mutable 就是静默假支持",
    ).not.toContain("setStrokeLineCap");
    expect(lastOverlay().options.strokeLineCap).toBe("square");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Polyline strokeLineCap 重建（live 读数口径）");
  });

  it("改 strokeLineJoin 时**不得**对旧实例调 setStrokeLineJoin", async () => {
    const { wrapper, set } = await mountMutable(Polygon, {
      points: TRIANGLE,
      strokeLineJoin: "round",
    });
    const before = fake.createdOverlays.length;
    const beforeOverlay = lastOverlay();

    await set({ points: TRIANGLE, strokeLineJoin: "miter" });

    expect(fake.createdOverlays.length).toBe(before + 1);
    expect(beforeOverlay.callLog).not.toContain("setStrokeLineJoin");
    expect(lastOverlay().options.strokeLineJoin).toBe("miter");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Polygon strokeLineJoin 重建（live 读数口径）");
  });

  /**
   * 对照守卫：**确实**有效的 setter **必须**被调用。
   *
   * 上一条钉「不要调」，这一条钉「该调的仍在调」——两条合起来才说明
   * 「recreate」是**逐条判断**的结果，而不是把构造期选项整体一刀切。
   * （这正是 live 读数暴露的风险：知道 `setStrokeLineCap` 在位之后，很容易顺手把
   * 同层的 `setStrokeColor` 也改掉。）
   */
  it("对照：同在 layer 2 的 setStrokeColor 仍是 options（改它**要**调 setter，不重建）", async () => {
    const { wrapper, set } = await mountMutable(Polyline, {
      points: POINTS,
      strokeColor: "#111111",
      strokeLineCap: "round",
    });
    const before = fake.createdOverlays.length;
    const beforeOverlay = lastOverlay();

    await set({ points: POINTS, strokeColor: "#222222", strokeLineCap: "round" });

    expect(
      fake.createdOverlays.length,
      "只改 strokeColor（mutable）不得重建",
    ).toBe(before);
    expect(beforeOverlay.callLog).toContain("setStrokeColor");
    expect(beforeOverlay.callLog, "同层但无效的 setter 仍然不得调").not.toContain("setStrokeLineCap");

    wrapper.unmount();
    await settle();
    harness.assertIdle("Polyline setStrokeColor 对照");
  });
});
