/**
 * 覆盖物套件行为门禁（M5-VECTORS / issue #31）
 *
 * issue #31 的五条测试要求逐条落在本文件：
 *
 * | 要求 | 用例 / 分组 |
 * | --- | --- |
 * | 每个组件 create/update/recreate/remove 行为测试 | `<组件>` 六条（表驱动，覆盖八个覆盖物） |
 * | path 大数组根引用与版本更新 | `path 大数组：根引用 + 版本令牌` |
 * | 编辑事件与 listener 清理 | `事件面来自矩阵` / `编辑能力边界与卸载路径` |
 * | Volar/consumer 类型测试 | `fixtures/consumer/src/index.ts`（由 `verify:package` 的 vue-tsc 跑） |
 *
 * 另外三条**声明面自己会红**的检查（防止「迁移完了但声明是空转」）：
 *
 * 1. `fields` 的键集与 `types/components.ts` 的 props 接口**双向相等**；
 * 2. 每个字段的策略与 Driver 描述符的分类**逐项一致**（options/position↔mutable、
 *    recreate↔recreate、visibility/version↔不在描述符里）；
 * 3. 每个 SFC 的 `defineEmits` 键集与它 kind 的**事件矩阵**相等，且每个键的载荷注解与
 *    矩阵的载荷档对应（SFC 编译器解析不了 `keyof typeof <大对象>`，因此这一侧必须显式写名字，
 *    用门禁而不是 mapped type 防漂移）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Label from "../../packages/bmap-vue/src/components/overlays/Label.vue";
import Polyline from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import Polygon from "../../packages/bmap-vue/src/components/overlays/Polygon.vue";
import Rectangle from "../../packages/bmap-vue/src/components/overlays/Rectangle.vue";
import Circle from "../../packages/bmap-vue/src/components/overlays/Circle.vue";
import BezierCurve from "../../packages/bmap-vue/src/components/overlays/BezierCurve.vue";
import Prism from "../../packages/bmap-vue/src/components/overlays/Prism.vue";
import GroundOverlay from "../../packages/bmap-vue/src/components/overlays/GroundOverlay.vue";
import CustomOverlay from "../../packages/bmap-vue/src/components/overlays/CustomOverlay.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import {
  LABEL_FIELDS,
  LABEL_DESCRIPTOR_KEYS,
  createLabelSpec,
} from "../../packages/bmap-vue/src/components/overlays/labelSpec";
import {
  POLYLINE_FIELDS,
  POLYLINE_DESCRIPTOR_KEYS,
  POLYLINE_WATCH_SOURCES,
  createPolylineSpec,
} from "../../packages/bmap-vue/src/components/overlays/polylineSpec";
import {
  POLYGON_FIELDS,
  POLYGON_DESCRIPTOR_KEYS,
  createPolygonSpec,
} from "../../packages/bmap-vue/src/components/overlays/polygonSpec";
import {
  RECTANGLE_FIELDS,
  RECTANGLE_DESCRIPTOR_KEYS,
  createRectangleSpec,
} from "../../packages/bmap-vue/src/components/overlays/rectangleSpec";
import {
  CIRCLE_FIELDS,
  CIRCLE_DESCRIPTOR_KEYS,
  createCircleSpec,
} from "../../packages/bmap-vue/src/components/overlays/circleSpec";
import {
  BEZIER_CURVE_FIELDS,
  BEZIER_CURVE_DESCRIPTOR_KEYS,
  BEZIER_CURVE_WATCH_SOURCES,
  createBezierCurveSpec,
} from "../../packages/bmap-vue/src/components/overlays/bezierCurveSpec";
import {
  PRISM_FIELDS,
  PRISM_DESCRIPTOR_KEYS,
  createPrismSpec,
} from "../../packages/bmap-vue/src/components/overlays/prismSpec";
import {
  GROUND_OVERLAY_FIELDS,
  GROUND_OVERLAY_DESCRIPTOR_KEYS,
  GROUND_OVERLAY_WATCH_SOURCES,
  createGroundOverlaySpec,
} from "../../packages/bmap-vue/src/components/overlays/groundOverlaySpec";
import {
  MARKER_DESCRIPTOR_KEYS,
  MARKER_FIELDS,
  createMarkerSpec,
} from "../../packages/bmap-vue/src/components/overlays/markerSpec";
import {
  CUSTOM_OVERLAY_DESCRIPTOR_KEYS,
  CUSTOM_OVERLAY_FIELDS,
  createCustomOverlaySpec,
} from "../../packages/bmap-vue/src/components/overlays/customOverlaySpec";
import { assertOverlayFieldDeclarations } from "../../packages/bmap-vue/src/core/overlays/OverlaySpec";
import { useOverlaySpec } from "../../packages/bmap-vue/src/core/composables/useOverlaySpec";
import type {
  OverlayFieldUpdate,
  OverlaySpec,
} from "../../packages/bmap-vue/src/core/overlays/OverlaySpec";
import { overlayEventsOf } from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";
import {
  OVERLAY_DESCRIPTORS,
  overlayPropertySpec,
  type OverlayKind,
} from "../../packages/bmap-vue/src/driver/types/overlays";
import { createFakeV4Harness, type FakeV4Harness, type FakeBMapV4 } from "../../packages/test-utils";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const TYPES_FILE = resolve(REPO_ROOT, "packages/bmap-vue/src/types/components.ts");
const OVERLAY_DIR = resolve(REPO_ROOT, "packages/bmap-vue/src/components/overlays");
const GENERATED_EMITS_FILE = resolve(
  REPO_ROOT,
  "packages/bmap-vue/src/core/overlays/overlayEventEmits.generated.ts",
);
const POINT = { lng: 116.4, lat: 39.9 };

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

async function settle() {
  await flushPromises();
  await nextTick();
}

/** 当前地图上挂着的覆盖物（raw 实例）。 */
function attachedOverlays(): AnyRecord[] {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  if (!map) throw new Error("用例必须先创建地图（<Map>）");
  return map.overlays as unknown as AnyRecord[];
}

function currentOverlay(): AnyRecord {
  const raw = attachedOverlays()[0];
  if (!raw) throw new Error("地图上还没有覆盖物");
  return raw;
}

/* ------------------------------------------------------------------ 行为用例表 */

interface OverlayCase {
  readonly name: string;
  readonly kind: OverlayKind;
  readonly component: unknown;
  readonly fields: Record<string, OverlayFieldUpdate>;
  readonly props: Record<string, unknown>;
  /** 就地更新的 prop → 预期被调用的 SDK setter 名。 */
  readonly mutable: ReadonlyArray<{ prop: string; next: unknown; setter: string }>;
  /** 构造期（recreate）prop → 变化后的值。 */
  readonly recreate: ReadonlyArray<{ prop: string; next: unknown }>;
  /** 创建时应当出现在 ctor options 里的键。 */
  readonly ctorExpect?: Record<string, unknown>;
  /** 创建后实例状态（Fake 建模的字段）。 */
  readonly stateExpect?: Record<string, unknown>;
}

const CASES: readonly OverlayCase[] = [
  {
    name: "Marker",
    kind: "marker",
    component: Marker,
    fields: MARKER_FIELDS,
    props: { position: POINT, title: "标记", rotation: 30, zIndex: 3 },
    mutable: [
      { prop: "title", next: "改过的标题", setter: "setTitle" },
      { prop: "rotation", next: 60, setter: "setRotation" },
      { prop: "position", next: { lng: 117, lat: 40 }, setter: "setPosition" },
    ],
    recreate: [{ prop: "enableClicking", next: false }],
    ctorExpect: {
      // `position` 是构造期**第一个位置参数**（描述符 `ctorKey: null`），因此不在 ctor options 里；
      // 它由下面的 stateExpect 覆盖（Fake 把位置参数落进实例字段）
      title: "标记",
      rotation: 30,
      zIndex: 3,
    },
    stateExpect: { title: "标记", rotation: 30, position: { lng: 116.4, lat: 39.9 } },
  },
  {
    name: "Label",
    kind: "label",
    component: Label,
    fields: LABEL_FIELDS,
    props: {
      content: "文本",
      position: POINT,
      style: { color: "#fff" },
      offset: { x: 1, y: 2 },
      zIndex: 3,
    },
    mutable: [
      { prop: "content", next: "改过的文本", setter: "setContent" },
      { prop: "zIndex", next: 9, setter: "setZIndex" },
      { prop: "style", next: { color: "#f00" }, setter: "setStyles" },
      // 位置字段走 `setPosition` 专用入口（描述符的语义键），不是普通 setOptions
      { prop: "position", next: { lng: 117, lat: 40 }, setter: "setPosition" },
    ],
    recreate: [],
    ctorExpect: {
      position: { lng: 116.4, lat: 39.9 },
      styles: { color: "#fff" },
      offset: { width: 1, height: 2 },
    },
    stateExpect: { content: "文本" },
  },
  {
    name: "Polyline",
    kind: "polyline",
    component: Polyline,
    fields: POLYLINE_FIELDS,
    props: {
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.5, lat: 40 },
      ],
      strokeColor: "#123456",
    },
    mutable: [
      { prop: "strokeColor", next: "#654321", setter: "setStrokeColor" },
      { prop: "enableEditing", next: true, setter: "enableEditing" },
    ],
    recreate: [],
    ctorExpect: { strokeColor: "#123456" },
  },
  {
    name: "Polygon",
    kind: "polygon",
    component: Polygon,
    fields: POLYGON_FIELDS,
    props: {
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.5, lat: 40 },
      ],
      fillColor: "#00ff00",
    },
    mutable: [
      { prop: "fillColor", next: "#ff0000", setter: "setFillColor" },
      { prop: "enableEditing", next: true, setter: "enableEditing" },
    ],
    recreate: [{ prop: "isBoundary", next: true }],
    ctorExpect: { fillColor: "#00ff00" },
  },
  {
    name: "Rectangle",
    kind: "rectangle",
    component: Rectangle,
    fields: RECTANGLE_FIELDS,
    props: {
      bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
      strokeWeight: 3,
    },
    mutable: [
      { prop: "strokeWeight", next: 5, setter: "setStrokeWeight" },
      { prop: "enableEditing", next: true, setter: "enableEditing" },
    ],
    recreate: [{ prop: "enableClicking", next: false }],
    ctorExpect: { strokeWeight: 3, enableClicking: true },
  },
  {
    name: "Circle",
    kind: "circle",
    component: Circle,
    fields: CIRCLE_FIELDS,
    props: { center: POINT, radius: 100, fillOpacity: 0.3 },
    mutable: [
      { prop: "radius", next: 200, setter: "setRadius" },
      { prop: "fillOpacity", next: 0.8, setter: "setFillOpacity" },
      // 圆心是位置字段：`setPosition` 由 Driver 按 `POSITION_KEY.circle` 映射到 `setCenter`
      { prop: "center", next: { lng: 117, lat: 40 }, setter: "setCenter" },
    ],
    recreate: [{ prop: "enableClicking", next: false }],
    stateExpect: { radius: 100 },
  },
  {
    name: "BezierCurve",
    kind: "bezier-curve",
    component: BezierCurve,
    fields: BEZIER_CURVE_FIELDS,
    props: {
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.6, lat: 40.1 },
      ],
      controlPoints: [
        [
          { lng: 116.45, lat: 40.05 },
          { lng: 116.55, lat: 39.95 },
        ],
      ],
      strokeOpacity: 0.4,
    },
    mutable: [{ prop: "strokeOpacity", next: 0.9, setter: "setStrokeOpacity" }],
    recreate: [],
  },
  {
    name: "Prism",
    kind: "prism",
    component: Prism,
    fields: PRISM_FIELDS,
    props: {
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.5, lat: 40 },
      ],
      altitude: 120,
      topFillOpacity: 0.4,
    },
    mutable: [
      { prop: "altitude", next: 240, setter: "setAltitude" },
      { prop: "topFillOpacity", next: 0.9, setter: "setTopFillOpacity" },
    ],
    recreate: [{ prop: "isBoundary", next: true }],
    stateExpect: { altitude: 120 },
  },
  {
    name: "GroundOverlay",
    kind: "ground-overlay",
    component: GroundOverlay,
    fields: GROUND_OVERLAY_FIELDS,
    props: {
      type: "image",
      url: "a.png",
      bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
      opacity: 0.5,
    },
    mutable: [{ prop: "opacity", next: 0.9, setter: "setOpacity" }],
    recreate: [{ prop: "type", next: "canvas" }],
    ctorExpect: { opacity: 0.5, url: "a.png", type: "image" },
  },
  {
    name: "CustomOverlay",
    kind: "custom-overlay",
    component: CustomOverlay,
    fields: CUSTOM_OVERLAY_FIELDS,
    props: {
      position: POINT,
      rotation: 30,
      properties: { id: "store-1" },
      zIndex: 3,
    },
    mutable: [
      { prop: "rotation", next: 60, setter: "setRotation" },
      { prop: "properties", next: { id: "store-2" }, setter: "setProperties" },
      // 位置字段走 Driver 的专用入口，落到 `setPoint(point, true)`——第二参数是**语义的一部分**
      // （省略会重新调用业务 DOM 工厂、把 slot 里已渲染的节点换掉），因此这里连参数一起断言
      { prop: "position", next: { lng: 117, lat: 40 }, setter: "setPoint:noReCreate" },
    ],
    recreate: [{ prop: "offset", next: { x: 2, y: 3 } }],
    ctorExpect: { rotationInit: 30, properties: { id: "store-1" }, zIndex: 3 },
    stateExpect: { rotation: 30, properties: { id: "store-1" } },
  },
];

async function mountCase(testCase: OverlayCase) {
  const state = ref<Record<string, unknown>>({ ...testCase.props });
  const Host = defineComponent({
    components: { Map: MapComponent, [testCase.name]: testCase.component as never },
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
  describe(`${testCase.name}（${testCase.kind}）`, () => {
    it("create：构造期属性一次到位，挂到地图上", async () => {
      const { wrapper } = await mountCase(testCase);
      expect(fake.createdOverlays.length).toBe(1);
      expect(harness.attached("overlay")).toBe(1);

      const raw = currentOverlay();
      for (const [key, value] of Object.entries(testCase.ctorExpect ?? {})) {
        expect(raw.options[key], `ctor options.${key}`).toMatchObject(value as object);
      }
      for (const [key, value] of Object.entries(testCase.stateExpect ?? {})) {
        expect(raw[key], `实例状态 ${key}`).toEqual(value);
      }

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name} 卸载`);
    });

    it("mutable：就地更新（不重建、只下发对应 setter）", async () => {
      const { wrapper, state } = await mountCase(testCase);
      const raw = currentOverlay();
      const created = fake.createdOverlays.length;
      raw.callLog.length = 0;

      for (const entry of testCase.mutable) state.value[entry.prop] = entry.next;
      await settle();

      expect(fake.createdOverlays.length, "就地更新不得重建实例").toBe(created);
      expect(harness.attached("overlay")).toBe(1);
      for (const entry of testCase.mutable) {
        expect(raw.callLog, `${entry.prop} 应经 ${entry.setter}`).toContain(entry.setter);
      }

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name} mutable`);
    });

    it("recreate：构造期属性变化 → 恰好重建一次（旧实例监听归零）", async () => {
      if (testCase.recreate.length === 0) {
        // 表驱动的**显式**跳过：这些组件当前确实没有构造期 prop（声明面在下一组单独核对，
        // 因此「没有 recreate 字段」与「忘了测」在这里是可区分的）
        expect(Object.values(testCase.fields).filter((v) => v === "recreate")).toEqual([]);
        return;
      }
      const { wrapper, state } = await mountCase(testCase);
      const old = currentOverlay();
      const created = fake.createdOverlays.length;
      expect(old.getListenerCount()).toBeGreaterThan(0);

      for (const entry of testCase.recreate) state.value[entry.prop] = entry.next;
      await settle();

      const fresh = currentOverlay();
      expect(fake.createdOverlays.length).toBe(created + 1);
      expect(fresh).not.toBe(old);
      expect(harness.attached("overlay"), "重建后地图上仍只有一个").toBe(1);
      expect(old.getListenerCount()).toBe(0);

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name} recreate`);
    });

    it("visible：切显隐不重建、不重新挂载（show/hide 而不是 add/remove）", async () => {
      const { wrapper, state } = await mountCase(testCase);
      const raw = currentOverlay();
      const created = fake.createdOverlays.length;

      state.value.visible = false;
      await settle();
      expect(raw.visible).toBe(false);
      expect(harness.attached("overlay"), "隐藏不等于摘掉").toBe(1);

      state.value.visible = true;
      await settle();
      expect(raw.visible).toBe(true);
      expect(fake.createdOverlays.length).toBe(created);

      wrapper.unmount();
      await settle();
      harness.assertIdle(`${testCase.name} visible`);
    });

    it("事件面来自矩阵：订阅名与矩阵的 SDK 名逐项相等，卸载后全部解绑", async () => {
      const { wrapper } = await mountCase(testCase);
      const raw = currentOverlay();
      const expected = overlayEventsOf(testCase.kind).map((event) => event.sdk);
      expect(expected.length).toBeGreaterThan(0);
      expect([...raw.getListenerTypes()].sort()).toEqual([...expected].sort());

      wrapper.unmount();
      await settle();
      expect(raw.getListenerCount()).toBe(0);
    });
  });
}

/* ------------------------------------------------------------- 声明面 ↔ 描述符 */

/**
 * 从 `types/components.ts` 解析某个 props 接口的键（与 #41 的 props 分类门禁同一手法）。
 *
 * **必须沿 `extends` 链合并**：图形类的 props 是「四个共享接口 + 自己那几个」拼出来的
 * （`PathStrokeProps` / `PathFillProps` / `PathShapeProps` / `PathEditableProps`），
 * 只看接口自己的正文会得到「声明了 2 个字段」的假读数，让这条门禁退化成空转。
 */
function readPropsKeys(interfaceName: string): string[] {
  const source = readFileSync(TYPES_FILE, "utf8");
  const declared = new Map<string, { extends: string[]; keys: string[] }>();
  for (const match of source.matchAll(/export interface (\w+)Props([^{]*)\{([\s\S]*?)\n\}/g)) {
    const name = `${match[1]}Props`;
    const parents = [...match[2]!.matchAll(/(\w+Props)/g)].map((entry) => entry[1]!);
    const keys = [...match[3]!.matchAll(/^\s{2}(\w+)\??:/gm)].map((entry) => entry[1]!);
    declared.set(name, { extends: parents, keys });
  }
  if (!declared.has(interfaceName)) throw new Error(`types/components.ts 里找不到 ${interfaceName}`);

  const collect = (name: string, seen = new Set<string>()): string[] => {
    if (seen.has(name)) return [];
    seen.add(name);
    const entry = declared.get(name);
    if (!entry) return [];
    return [...entry.keys, ...entry.extends.flatMap((parent) => collect(parent, seen))];
  };

  const keys = [...new Set(collect(interfaceName))];
  // 解析守卫：解析器失效时必须红，而不是让「两个空集合相等」通过
  expect(keys.length, `${interfaceName} 的成员解析结果为空`).toBeGreaterThan(2);
  expect(declared.size, "解析到的 props 接口太少，解析方式可能已失效").toBeGreaterThan(8);
  return keys;
}

interface DeclarationCase {
  readonly name: string;
  readonly kind: OverlayKind;
  readonly propsInterface: string;
  readonly fields: Record<string, OverlayFieldUpdate>;
  readonly descriptorKeys: Record<string, string | null>;
  readonly spec: () => OverlaySpec<never, never>;
}

const DECLARATIONS: readonly DeclarationCase[] = [
  {
    name: "Marker",
    kind: "marker",
    propsInterface: "MarkerProps",
    fields: MARKER_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: MARKER_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createMarkerSpec as never,
  },
  {
    name: "Label",
    kind: "label",
    propsInterface: "LabelProps",
    fields: LABEL_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: LABEL_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createLabelSpec as never,
  },
  {
    name: "Polyline",
    kind: "polyline",
    propsInterface: "PolylineProps",
    fields: POLYLINE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: POLYLINE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPolylineSpec as never,
  },
  {
    name: "Polygon",
    kind: "polygon",
    propsInterface: "PolygonProps",
    fields: POLYGON_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: POLYGON_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPolygonSpec as never,
  },
  {
    name: "Rectangle",
    kind: "rectangle",
    propsInterface: "RectangleProps",
    fields: RECTANGLE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: RECTANGLE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createRectangleSpec as never,
  },
  {
    name: "Circle",
    kind: "circle",
    propsInterface: "CircleProps",
    fields: CIRCLE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: CIRCLE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createCircleSpec as never,
  },
  {
    name: "BezierCurve",
    kind: "bezier-curve",
    propsInterface: "BezierCurveProps",
    fields: BEZIER_CURVE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: BEZIER_CURVE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createBezierCurveSpec as never,
  },
  {
    name: "Prism",
    kind: "prism",
    propsInterface: "PrismProps",
    fields: PRISM_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: PRISM_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPrismSpec as never,
  },
  {
    name: "GroundOverlay",
    kind: "ground-overlay",
    propsInterface: "GroundOverlayProps",
    fields: GROUND_OVERLAY_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: GROUND_OVERLAY_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createGroundOverlaySpec as never,
  },
  {
    name: "CustomOverlay",
    kind: "custom-overlay",
    propsInterface: "CustomOverlayProps",
    fields: CUSTOM_OVERLAY_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: CUSTOM_OVERLAY_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    // spec 工厂要一个 `ensureHost` 依赖，但本组用例只做**声明面**核对（不调 `create`），
    // 因此用 `undefined` 也能构造（依赖只在 create 里被读）——与行为用例的分工见 `CASES`。
    spec: createCustomOverlaySpec as never,
  },
];

function descriptorKeyOf(testCase: DeclarationCase, prop: string): string | null {
  const declared = testCase.descriptorKeys[prop];
  return declared === undefined ? prop : declared;
}

describe("#31 声明面：fields 覆盖 props，且分类与描述符逐项一致", () => {
  it.each(DECLARATIONS)("$name：fields 的键集与 props 接口双向相等", (testCase) => {
    const propsKeys = readPropsKeys(testCase.propsInterface).sort();
    expect(Object.keys(testCase.fields).sort()).toEqual(propsKeys);
  });

  it.each(DECLARATIONS)("$name：每个字段的策略与描述符一致", (testCase) => {
    for (const [prop, update] of Object.entries(testCase.fields)) {
      const descriptorKey = descriptorKeyOf(testCase, prop);
      const spec = descriptorKey === null ? undefined : overlayPropertySpec(testCase.kind, descriptorKey);
      if (update === "visibility" || update === "version") {
        expect(descriptorKey, `${prop} 是组件侧语义，必须不经描述符`).toBeNull();
        expect(spec, `${prop} 不该出现在描述符里`).toBeUndefined();
        continue;
      }
      expect(spec, `${testCase.name}.${prop} 在描述符里找不到 ${String(descriptorKey)}`).toBeDefined();
      if (update === "options" || update === "position") {
        expect(spec!.policy, `${prop} 声明为就地更新`).toBe("mutable");
      } else {
        expect(spec!.policy, `${prop} 声明为构造期属性`).toBe("recreate");
      }
    }
    // 正证守卫：这个 kind 的描述符**两个方向都非空**（否则上面的循环可能在空集合上跑，什么都没检查到）。
    //
    // 此前这里点名断言 `enableMassClear` 是 `mutable`，那是拿一个**具体键**当「描述符非空」的哨兵；
    // `custom-overlay` 的 `enableMassClear` 恰好是 `recreate`（官方说明该开关当前不生效），
    // 于是哨兵失效而描述符本身完全正常。判据改成「两类策略都真的存在」——它与守卫声称的目的
    // 一一对应，也不再把某个键的语义绑进这条门禁。
    const policies = OVERLAY_DESCRIPTORS[testCase.kind].properties.map((spec) => spec.policy);
    expect(policies, `${testCase.name} 的描述符为空`).not.toHaveLength(0);
    expect(policies, `${testCase.name} 的描述符里没有 mutable 条目`).toContain("mutable");
    expect(policies, `${testCase.name} 的描述符里没有 recreate 条目`).toContain("recreate");
  });

  it.each(DECLARATIONS)("$name：构造期自检通过（版本令牌配对）", (testCase) => {
    const spec = testCase.spec();
    expect(() => assertOverlayFieldDeclarations(spec as never)).not.toThrow();
  });

  it.each(DECLARATIONS)("$name：行为用例覆盖了声明过的每一种策略", (testCase) => {
    const behavior = CASES.find((entry) => entry.kind === testCase.kind);
    expect(behavior, `${testCase.name} 不在行为用例表里`).toBeDefined();
    const covered = new Set<OverlayFieldUpdate>(["visibility"]);
    for (const entry of behavior!.mutable) covered.add(testCase.fields[entry.prop]!);
    for (const entry of behavior!.recreate) covered.add(testCase.fields[entry.prop]!);
    const uncovered = [...new Set(Object.values(testCase.fields))].filter(
      (policy) => !covered.has(policy) && policy !== "version",
    );
    expect(uncovered, `${testCase.name} 有策略没被行为用例覆盖`).toEqual([]);
  });
});

/* ---------------------------------------------------------- 事件面 ↔ SFC emits */

/**
 * #138：SFC 的 `defineEmits` 不再手抄键名，而是 `defineEmits<MarkerEmits>()` 直接消费
 * `core/overlays/overlayEventEmits.generated.ts`（由 `scripts/generate-overlay-emits.mts`
 * 从事件矩阵 + 弃用别名表 + 非 SDK 事件表 join 出来）。
 *
 * 因此这一段不再是「刮 SFC 源码比对矩阵」——生成器已经做了 join，测试改查**两件类型层看不到的事**：
 *
 * 1. 生成器自带的 SFC 核对（`assertSfcUsesGenerated`：每个 kind 的 SFC 真的用了对应的生成接口）
 *    加上 `pnpm generate:overlay-emits:check`（产物 == 三处事实源的 join 结果）；本文件逐 kind
 *    再点一次「键集 = 矩阵 ∪ 别名 ∪ 非 SDK 表」，让 `EMITS_CASES` 继续是那张人可读的对照表；
 * 2. `overlayEmitsOf` / `overlayEmitsPayloadOf` 这两个**测试侧的探针**——它们读的是生成器输入的
 *    同一张矩阵，但换成 `defineEmits` 的键序与载荷口径（SFC 实际绑定的就是这份 interface）。
 */
const PAYLOAD_TYPE_BY_KIND: Record<string, string> = {
  pointer: "OverlayPointerEvent",
  "partial-pointer": "OverlayPartialPointerEvent",
  base: "OverlayEventPayload",
};

interface EmitsCase {
  readonly file: string;
  readonly kind: OverlayKind;
  /** 矩阵之外的 emit（只有 v-model 回写）。 */
  readonly extra?: readonly string[];
}

const EMITS_CASES: readonly EmitsCase[] = [
  { file: "Marker.vue", kind: "marker", extra: ["update:position"] },
  { file: "Label.vue", kind: "label" },
  { file: "Polyline.vue", kind: "polyline" },
  { file: "Polygon.vue", kind: "polygon" },
  { file: "Rectangle.vue", kind: "rectangle" },
  { file: "Circle.vue", kind: "circle" },
  { file: "BezierCurve.vue", kind: "bezier-curve" },
  { file: "Prism.vue", kind: "prism" },
  { file: "GroundOverlay.vue", kind: "ground-overlay" },
  { file: "CustomOverlay.vue", kind: "custom-overlay" },
  { file: "ContextMenu.vue", kind: "context-menu", extra: ["select"] },
  { file: "InfoWindow.vue", kind: "info-window", extra: ["update:open", "rebuild", "destroy"] },
];

/**
 * 该 kind 的 SFC 实际绑定的键集（`defineEmits` 消费的那份生成 interface 的口径）。
 *
 * 与 `overlayEventsOf` 的差别只有一处，且是**已登记的显式限制**：`<InfoWindow>` 不转发官方
 * `resize`（尺寸由 `width` / `height` prop 驱动重绘，官方事件在本库只被观察、不驱动状态，
 * 理由见 `core/composables/useInfoWindow.ts` 的 `FORWARDED_SDK_EVENTS`）。这里按真实绑定面排除它，
 * 不是悄悄少一个。
 */
function overlayEmitsOf(kind: OverlayKind): readonly string[] {
  const excluded = kind === "info-window" ? new Set(["resize"]) : new Set<string>();
  return overlayEventsOf(kind)
    .filter((event) => !excluded.has(event.vue))
    .map((event) => event.vue);
}

/**
 * `<InfoWindow>` 原样转发（不经归一化）的那几个事件——它们的载荷**不按矩阵的档**声明，
 * 覆写逐条登记在 `scripts/generate-overlay-emits.mts` 的 `PAYLOAD_OVERRIDES_BY_KIND`
 * （理由：上游不给 `open` / `close` 事件对象；`clickclose` / `maximize` / `restore`
 * 转发的是上游内部结构，调用方按 `unknown` 收）。这里的键集与那张覆写表逐条对齐。
 */
const INFO_WINDOW_FORWARDED_PAYLOADS: Record<string, string | undefined> = {
  open: undefined,
  close: undefined,
  clickclose: "unknown",
  maximize: "unknown",
  restore: "unknown",
};

/**
 * 该 (kind, 事件名) 是否走「原样转发、载荷不按矩阵档」这条路。
 *
 * **必须带 kind 一起判**：`open` / `close` 同时存在于 `context-menu`（那里走 `useContextMenu`
 * 的矩阵绑定，载荷**确实**是 `OverlayPartialPointerEvent`）。只按事件名判会把 ContextMenu
 * 误判成覆写——这正是这张表存在的意义：偏离是 per-(kind, name) 的，不是 per-name 的。
 */
function isForwardedOverride(kind: OverlayKind, vue: string): boolean {
  return kind === "info-window" && Object.hasOwn(INFO_WINDOW_FORWARDED_PAYLOADS, vue);
}

/** kind → 生成 interface 名（与 `scripts/generate-overlay-emits.mts` 的 `emitsNameOf` 同一条规则）。 */
function emitsTypeNameOf(kind: OverlayKind): string {
  const pascal = kind
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Emits`;
}

/**
 * 解析磁盘上的生成物：`<Kind>Emits` → `{ 事件名: 载荷类型名 }`（无载荷记 `""`）。
 *
 * 这是本门禁能成立的**唯一**依据：`defineEmits` 的类型实参是纯类型，运行时读不到泛型实参，
 * 因此「声明了哪些键、各自什么载荷」只能从生成物文本上读。生成器自身另有 SFC 核对
 * （`assertSfcUsesGenerated`，查的是 SFC 引用了哪个 interface），两边合起来才是完整门禁。
 */
function readGeneratedEmits(): Record<string, Record<string, string>> {
  const source = readFileSync(GENERATED_EMITS_FILE, "utf8");
  const result: Record<string, Record<string, string>> = {};
  for (const block of source.matchAll(/export interface (\w+Emits) \{([\s\S]*?)\n\}/g)) {
    const entries: Record<string, string> = {};
    for (const line of block[2]!.split("\n")) {
      const match = /^ {2}("?[\w:$?-]+"?): \[(?:event: (.+))?\];$/.exec(line);
      if (match) entries[match[1]!.replace(/^"|"$/g, "")] = match[2] ?? "";
    }
    expect(Object.keys(entries).length, `${block[1]} 解析到 0 个条目（格式变了？）`).toBeGreaterThan(0);
    result[block[1]!] = entries;
  }
  return result;
}

describe("#31/#138 SFC emits ↔ 事件矩阵", () => {
  it.each(EMITS_CASES)("$file：SFC 真的消费了生成的 <Kind>Emits（而不是又手抄一遍）", (testCase) => {
    const source = readFileSync(resolve(OVERLAY_DIR, testCase.file), "utf8");
    const pascal = testCase.kind
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join("");
    const emitsName = `${pascal}Emits`;
    expect(source, `${testCase.file} 没有 import ${emitsName}`).toContain(emitsName);
    expect(
      source,
      `${testCase.file} 的 defineEmits 泛型实参不是 ${emitsName}（SFC 编译器解析不了 mapped type，` +
        "键名只能由生成器写死，见 ADR #138 决策 ⑥）",
    ).toMatch(new RegExp(`defineEmits<\\s*${emitsName}\\s*>`));
  });

  it.each(EMITS_CASES)("$file：键集 = 矩阵 ∪ 显式额外项", (testCase) => {
    const declared = Object.keys(readGeneratedEmits()[emitsTypeNameOf(testCase.kind)]!).sort();
    const expected = [
      ...overlayEmitsOf(testCase.kind),
      ...(testCase.extra ?? []),
    ].sort();
    expect(declared).toEqual(expected);

    // 额外项必须有出处，且**逐个点名**它属于哪一类。剩余两类互斥且都要登记在案：
    // ① v-model 回写 / 生命周期事件（生成脚本的 `NON_SDK_EVENTS`，附派发点）；
    // ② 本库自己定义的事件（ContextMenu 的 `select`）。
    // 集中弃用层随 #136 删除后，「历史事件别名」这一类**已不再存在**——生成器里也没有对应来源了。
    // （生成器侧已经逐条核对过派发点，这里再点一次「额外项不是随手加的」。）
    for (const extra of testCase.extra ?? []) {
      if (extra === "select") {
        expect(
          testCase.kind,
          "select 是 ContextMenu 的本库事件（菜单项被选中），不是 SDK 事件",
        ).toBe("context-menu");
        continue;
      }
      expect(
        extra.startsWith("update:") || extra === "rebuild" || extra === "destroy",
        `${extra} 既不是 v-model 回写 / 生命周期事件，也不是登记过的本库事件`,
      ).toBe(true);
    }
  });

  it.each(EMITS_CASES)("$file：生成 interface 的每个 SDK 键的载荷与矩阵的载荷档一致", (testCase) => {
    // 读**磁盘上的生成物**——那才是 `defineEmits` 真正消费的类型。重新推导一遍等于
    // 证明 `PAYLOAD_TYPE_BY_KIND` 自己等于自己，没有门禁价值。
    const declared = readGeneratedEmits()[emitsTypeNameOf(testCase.kind)];
    expect(declared, `${emitsTypeNameOf(testCase.kind)} 不在生成物里`).toBeDefined();
    const bound = new Set(overlayEmitsOf(testCase.kind));
    for (const event of overlayEventsOf(testCase.kind)) {
      // 排除项（info-window.resize）没有派发点，不进声明。
      if (!bound.has(event.vue)) continue;
      const overridden = isForwardedOverride(testCase.kind, event.vue);
      const expected = overridden
        ? INFO_WINDOW_FORWARDED_PAYLOADS[event.vue]
        : PAYLOAD_TYPE_BY_KIND[event.payload];
      expect(declared![event.vue], `${testCase.file} 的 ${event.vue}`).toBe(expected ?? "");
    }
  });

  it.each(EMITS_CASES)("$file：生成 interface 只比矩阵多出 EMITS_CASES 登记的额外项", (testCase) => {
    const declared = Object.keys(readGeneratedEmits()[emitsTypeNameOf(testCase.kind)]!).sort();
    const expected = [
      ...overlayEmitsOf(testCase.kind),
      ...(testCase.extra ?? []),
    ].sort();
    expect(declared, `${testCase.file} 的生成 interface 键集与矩阵 ∪ 额外项不符`).toEqual(expected);
  });

  it("info-window：原样转发的 5 个事件按覆写表声明载荷（不按矩阵档）", () => {
    // 这些事件的载荷是**未经归一化的上游回调参数**：`open` / `close` 上游不给事件对象
    // （声明成 `[]`），`clickclose` / `maximize` / `restore` 转发的是上游内部结构
    // （调用方按 `unknown` 收）。矩阵说它们是 `base` 档，但本组件不走那层归一化。
    for (const [name, payload] of Object.entries(INFO_WINDOW_FORWARDED_PAYLOADS)) {
      const defined = overlayEventsOf("info-window").find((event) => event.vue === name);
      expect(defined, `${name} 应在 info-window 的事件矩阵里`).toBeDefined();
      expect(defined!.payload, `${name} 在矩阵里应是 base 档（被覆写的正是这一档）`).toBe("base");
      // payload === undefined ⇔ 声明成 `open: []`；否则是 `unknown`
      expect(payload === undefined || payload === "unknown").toBe(true);
    }
  });

  it("info-window：官方 resize 不进声明（无派发点，绑定它只会得到一个永不触发的 handler）", () => {
    expect(overlayEmitsOf("info-window")).not.toContain("resize");
    // 矩阵里确实有它——排除是显式决定，不是「上游没有」
    expect(overlayEventsOf("info-window").map((event) => event.vue)).toContain("resize");
  });
});


/* ------------------------------------------------- path 大数组：根引用 + 版本 */

describe("#31 path 大数组：根引用 + 版本令牌（不做内容指纹）", () => {
  it.each([
    { name: "Polyline", component: Polyline, label: "Polyline" },
    { name: "Polygon", component: Polygon, label: "Polygon" },
  ])("$label：换根引用 → 一条 setPath；原地改数组 → 不发命令（版本令牌才触发）", async (testCase) => {
    const path = ref([
      { lng: 116.4, lat: 39.9 },
      { lng: 116.5, lat: 40 },
    ]);
    const version = ref(0);
    const Host = defineComponent({
      components: { Map: MapComponent, [testCase.name]: testCase.component as never },
      setup() {
        return () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(testCase.component as never, {
              path: path.value,
              pathVersion: version.value,
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = currentOverlay();
    const setPathCalls = () => raw.callLog.filter((call: string) => call === "setPath").length;
    raw.callLog.length = 0;

    // 1) 换根引用：下发一次
    path.value = [
      { lng: 117, lat: 40 },
      { lng: 117.1, lat: 40.1 },
    ];
    await settle();
    expect(setPathCalls()).toBe(1);

    // 2) **原地改数组**：不换引用 ⇒ 一条命令都不发（「不做内容指纹」的可观察后果）
    raw.callLog.length = 0;
    path.value.push({ lng: 117.2, lat: 40.2 });
    await settle();
    expect(setPathCalls()).toBe(0);

    // 3) 递增版本令牌：强制重发（原地修改的逃生口）
    version.value += 1;
    await settle();
    expect(setPathCalls()).toBe(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle(`${testCase.label} path 版本`);
  });

  it("BezierCurve：path 与 controlPoints 各有自己的版本令牌", async () => {
    const path = ref([
      { lng: 116.4, lat: 39.9 },
      { lng: 116.6, lat: 40.1 },
    ]);
    const controlPoints = ref([
      [
        { lng: 116.45, lat: 40.05 },
        { lng: 116.55, lat: 39.95 },
      ],
    ]);
    const pathVersion = ref(0);
    const controlPointsVersion = ref(0);
    const Host = defineComponent({
      components: { Map: MapComponent, BezierCurve },
      setup() {
        return () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(BezierCurve, {
              path: path.value,
              controlPoints: controlPoints.value,
              pathVersion: pathVersion.value,
              controlPointsVersion: controlPointsVersion.value,
            }),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = currentOverlay();
    raw.callLog.length = 0;

    pathVersion.value += 1;
    await settle();
    expect(raw.callLog).toContain("setPath");
    expect(raw.callLog).not.toContain("setControlPoints");

    raw.callLog.length = 0;
    controlPointsVersion.value += 1;
    await settle();
    expect(raw.callLog).toContain("setControlPoints");
    expect(raw.callLog).not.toContain("setPath");

    wrapper.unmount();
    await settle();
    harness.assertIdle("BezierCurve 两个版本令牌");
  });

  it("声明面：versioned 的字段都配了版本令牌；Prism 的 path 明确不用（小数组）", () => {
    expect(POLYLINE_WATCH_SOURCES.path).toEqual({ source: "versioned", versionProp: "pathVersion" });
    expect(BEZIER_CURVE_WATCH_SOURCES).toEqual({
      path: { source: "versioned", versionProp: "pathVersion" },
      controlPoints: { source: "versioned", versionProp: "controlPointsVersion" },
    });
    expect(Object.keys(GROUND_OVERLAY_WATCH_SOURCES)).toEqual(["url"]);
    expect(PRISM_FIELDS.path).toBe("options");
    expect(PRISM_DESCRIPTOR_KEYS.path).toBe("path");
  });
});

/* ------------------------------------------------- 编辑能力边界与卸载路径 */

describe("#31 编辑能力边界与卸载路径", () => {
  it("可编辑的四个图形有编辑六件套，Prism / BezierCurve 一个都没有", () => {
    const editable = overlayEventsOf("polyline")
      .filter((event) => event.requiresEditing)
      .map((event) => event.sdk);
    expect(editable).toEqual([
      "editstart",
      "editend",
      "linevertexdragstart",
      "linevertexdragging",
      "linevertexdragend",
      "linevertexdel",
    ]);
    for (const kind of ["polygon", "rectangle", "circle"] as const) {
      expect(overlayEventsOf(kind).filter((event) => event.requiresEditing)).toHaveLength(6);
    }
    for (const kind of ["prism", "bezier-curve", "label", "ground-overlay"] as const) {
      expect(overlayEventsOf(kind).filter((event) => event.requiresEditing)).toEqual([]);
    }
  });

  it("卸载过程中 SDK 派发的 remove 事件不再回放给调用方", async () => {
    const removed: unknown[] = [];
    const Host = defineComponent({
      components: { Map: MapComponent, Polyline },
      setup() {
        return () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(Polyline, {
              path: [
                { lng: 116.4, lat: 39.9 },
                { lng: 116.5, lat: 40 },
              ],
              onRemove: (event: unknown) => removed.push(event),
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = currentOverlay();
    // 真实 SDK 的 `removeOverlay` 会派发 `remove`，而摘除发生在监听解绑**之前**
    const map = fake.createdMaps[fake.createdMaps.length - 1] as unknown as AnyRecord;
    const original = map.removeOverlay.bind(map);
    map.removeOverlay = (overlay: unknown) => {
      original(overlay);
      (overlay as { emit?: (type: string, payload?: object) => void }).emit?.("remove");
    };

    // 先证明这条路径「本来会」冒泡：挂在图上时手动派发一次
    raw.emit("remove");
    await settle();
    expect(removed).toHaveLength(1);

    wrapper.unmount();
    await settle();
    expect(removed, "卸载路径不得回放 SDK 事件").toHaveLength(1);
    expect(raw.getListenerCount()).toBe(0);
  });
});

/* ------------------------------------------------------- 内核观察面与告警器（单元） */

describe("#31 内核的观察面：useOverlaySpec 报告的 events", () => {
  /** 探针：直接调用内核并把它报告的 `events` 暴露出来（组件的 ref 拿不到这个返回值）。 */
  const seen: { events: readonly string[] } = { events: [] };

  function probeHost(spec: OverlaySpec<Record<string, unknown>, unknown>) {
    const state = ref<Record<string, unknown>>({
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.5, lat: 40 },
      ],
    });
    const Probe = defineComponent({
      setup() {
        const result = useOverlaySpec(state.value as never, spec as never, { emit: () => {} });
        seen.events = result.events;
        return () => null;
      },
    });
    return defineComponent({
      components: { Map: MapComponent, Probe },
      setup() {
        return () => h(MapComponent, { provider: harness.provider() }, () => [h(Probe)]);
      },
    });
  }

  /** 最小可用的图形 spec（只声明 path，用于验证「事件面来自矩阵」）。 */
  const polygonProbeSpec: OverlaySpec<Record<string, unknown>, unknown> = {
    type: "polygon",
    kind: "polygon",
    fields: { path: "options", pathVersion: "version", visible: "visibility" },
    descriptorKeys: { path: "path", pathVersion: null, visible: null },
    watchSources: { path: { source: "versioned", versionProp: "pathVersion" } },
    create: (context, p) =>
      context.client.driver.overlays.createPolygon(
        p.path as { lng: number; lat: number }[],
        {},
      ),
  };

  it("有 kind 的 spec：报告的 events 恰好是矩阵的 SDK 名", async () => {
    const wrapper = mount(probeHost(polygonProbeSpec), { attachTo: harness.container() });
    await settle();
    await settle();
    expect(seen.events).toEqual(overlayEventsOf("polygon").map((event) => event.sdk));
    wrapper.unmount();
    await settle();
    harness.assertIdle("内核观察面");
  });

  it("没有 kind 的 spec：只报告自己声明的事件（没有「按名字猜 kind」的回落）", async () => {
    const kindlessSpec = {
      ...polygonProbeSpec,
      kind: undefined,
      type: "custom-probe",
      events: [{ sdk: "click", emit: "click" }],
    } as unknown as OverlaySpec<Record<string, unknown>, unknown>;
    const wrapper = mount(probeHost(kindlessSpec), { attachTo: harness.container() });
    await settle();
    await settle();
    // 明确**不**按 `type` 猜：猜会让「声明了 emit 却永不触发」变成静默失败
    expect(seen.events).toEqual(["click"]);
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------- 评审 PR #103 的回归用例（先红后绿） */

describe("[评审 1] afterMount 的时序与回滚", () => {
  /** 门闸：让 `create()` 停在窗口里，便于制造「过期一代」。 */
  function gatedProbeHost(options: { afterMountThrows?: boolean } = {}) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const afterMountCalls: number[] = [];
    const spec: OverlaySpec<Record<string, unknown>, unknown> = {
      type: "probe-after-mount",
      kind: "polygon",
      fields: { path: "options", visible: "visibility" },
      descriptorKeys: { path: "path", visible: null },
      create: async (context, p) => {
        await gate;
        return context.client.driver.overlays.createPolygon(p.path as { lng: number; lat: number }[], {});
      },
      afterMount: () => {
        afterMountCalls.push(afterMountCalls.length);
        if (options.afterMountThrows) throw new Error("afterMount-boom");
      },
    };
    const state = ref<Record<string, unknown>>({
      path: [
        { lng: 116.4, lat: 39.9 },
        { lng: 116.5, lat: 40 },
      ],
    });
    const Probe = defineComponent({
      setup() {
        useOverlaySpec(state.value as never, spec as never, { emit: () => {} });
        return () => null;
      },
    });
    const Host = defineComponent({
      components: { Map: MapComponent, Probe },
      setup() {
        return () => h(MapComponent, { provider: harness.provider() }, () => [h(Probe)]);
      },
    });
    return { Host, release, afterMountCalls };
  }

  it("create 的 continuation 之前立刻卸载：过期一代不得执行 afterMount", async () => {
    const { Host, release, afterMountCalls } = gatedProbeHost();
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    expect(afterMountCalls).toEqual([]);

    // 卸载发生在 create 的窗口里 ⇒ 这一代是「过期一代」
    wrapper.unmount();
    await settle();
    release();
    await settle();
    await settle();

    expect(afterMountCalls, "过期一代不得有组件侧副作用").toEqual([]);
    harness.assertIdle("[评审 1] 过期一代");
  });

  it("正常路径仍然执行一次（对照：守卫没有把功能关掉）", async () => {
    const { Host, release, afterMountCalls } = gatedProbeHost();
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    release();
    await settle();
    await settle();
    expect(afterMountCalls).toHaveLength(1);
    wrapper.unmount();
    await settle();
    harness.assertIdle("[评审 1] 正常路径");
  });

  it("afterMount 抛错：已经 add 的覆盖物必须被撤掉（不留在图上、不进注册表）", async () => {
    const { Host, release } = gatedProbeHost({ afterMountThrows: true });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    release();
    await settle();
    await settle();

    expect(harness.attached("overlay"), "抛错后不得留在地图上").toBe(0);
    expect(fake.createdMaps[fake.createdMaps.length - 1]!.overlays).toHaveLength(0);

    wrapper.unmount();
    await settle();
    harness.assertIdle("[评审 1] afterMount 抛错");
  });
});

describe("[评审 2] GroundOverlay 的 url 惰性工厂只求值一次", () => {
  it("一次 create 只调用一次工厂（校验用的对象就是交给 SDK 的那个）", async () => {
    let calls = 0;
    const factory = () => {
      calls += 1;
      return `canvas-${calls}.png`;
    };
    const Host = defineComponent({
      components: { Map: MapComponent, GroundOverlay },
      setup() {
        return () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(GroundOverlay, {
              type: "image",
              url: factory,
              bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    expect(calls, "工厂在一次创建里只应求值一次").toBe(1);
    const raw = currentOverlay();
    expect(raw.options.url).toBe("canvas-1.png");

    wrapper.unmount();
    await settle();
    harness.assertIdle("[评审 2] url 工厂");
  });
});

describe("[评审 4] remove 事件的可观察时机（文档与用例一起对齐）", () => {
  it("外部摘除会到达组件；切隐藏不会（hide 不派发 remove）", async () => {
    const removed: unknown[] = [];
    const visible = ref(true);
    const Host = defineComponent({
      components: { Map: MapComponent, BezierCurve },
      setup() {
        return () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(BezierCurve, {
              path: [
                { lng: 116.4, lat: 39.9 },
                { lng: 116.6, lat: 40.1 },
              ],
              controlPoints: [
                [
                  { lng: 116.45, lat: 40.05 },
                  { lng: 116.55, lat: 39.95 },
                ],
              ],
              visible: visible.value,
              onRemove: (event: unknown) => removed.push(event),
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    // 1) 外部摘除（map.removeOverlay / clearOverlays）→ 组件收到
    currentOverlay().emit("remove");
    await settle();
    expect(removed).toHaveLength(1);

    // 2) 切隐藏：走 show/hide，SDK 不派发 remove ⇒ 组件也不会凭空收到
    visible.value = false;
    await settle();
    expect(removed, "隐藏不等于被移除").toHaveLength(1);
    expect(harness.attached("overlay"), "隐藏不摘挂载").toBe(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("[评审 4] remove 时机");
  });
});

/* ------------------------------------------------------------ 能力目录一致性 */

describe("#31 覆盖物种类与能力目录", () => {
  it("九个迁移过的 kind 都有描述符与能力 id", () => {
    for (const kind of [...CASES.map((entry) => entry.kind), "marker" as OverlayKind]) {
      const descriptor = OVERLAY_DESCRIPTORS[kind];
      expect(descriptor, `${kind} 没有描述符`).toBeDefined();
      expect(descriptor.capability, `${kind} 没有登记能力`).toBeTruthy();
    }
  });
});
