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
 * | 旧 alias 只警告一次且新 API 优先 | `集中弃用层` |
 * | Volar/consumer 类型测试 | `fixtures/v3-consumer/src/index.ts`（由 `verify:package` 的 vue-tsc 跑） |
 *
 * 另外三条**声明面自己会红**的检查（防止「迁移完了但声明是空转」）：
 *
 * 1. `fields` 的键集与 `types/components.ts` 的 props 接口**双向相等**；
 * 2. 每个字段的策略与 Driver 描述符的分类**逐项一致**（options/position↔mutable、
 *    recreate↔recreate、visibility/version/alias↔不在描述符里）；
 * 3. 每个 SFC 的 `defineEmits` 键集与它 kind 的**事件矩阵**相等，且每个键的载荷注解与
 *    矩阵的载荷档对应（SFC 编译器解析不了 `keyof typeof <大对象>`，因此这一侧必须显式写名字，
 *    用门禁而不是 mapped type 防漂移）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BLabel from "../../packages/baidu-map-gl-vue/src/components/overlays/BLabel.vue";
import BPolyline from "../../packages/baidu-map-gl-vue/src/components/overlays/BPolyline.vue";
import BPolygon from "../../packages/baidu-map-gl-vue/src/components/overlays/BPolygon.vue";
import BRectangle from "../../packages/baidu-map-gl-vue/src/components/overlays/BRectangle.vue";
import BCircle from "../../packages/baidu-map-gl-vue/src/components/overlays/BCircle.vue";
import BBezierCurve from "../../packages/baidu-map-gl-vue/src/components/overlays/BBezierCurve.vue";
import BPrism from "../../packages/baidu-map-gl-vue/src/components/overlays/BPrism.vue";
import BGroundOverlay from "../../packages/baidu-map-gl-vue/src/components/overlays/BGroundOverlay.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import {
  LABEL_FIELDS,
  LABEL_DESCRIPTOR_KEYS,
  createLabelSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/labelSpec";
import {
  POLYLINE_FIELDS,
  POLYLINE_DESCRIPTOR_KEYS,
  POLYLINE_WATCH_SOURCES,
  createPolylineSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/polylineSpec";
import {
  POLYGON_FIELDS,
  POLYGON_DESCRIPTOR_KEYS,
  createPolygonSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/polygonSpec";
import {
  RECTANGLE_FIELDS,
  RECTANGLE_DESCRIPTOR_KEYS,
  createRectangleSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/rectangleSpec";
import {
  CIRCLE_FIELDS,
  CIRCLE_DESCRIPTOR_KEYS,
  createCircleSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/circleSpec";
import {
  BEZIER_CURVE_FIELDS,
  BEZIER_CURVE_DESCRIPTOR_KEYS,
  BEZIER_CURVE_WATCH_SOURCES,
  createBezierCurveSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/bezierCurveSpec";
import {
  PRISM_FIELDS,
  PRISM_DESCRIPTOR_KEYS,
  createPrismSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/prismSpec";
import {
  GROUND_OVERLAY_FIELDS,
  GROUND_OVERLAY_DESCRIPTOR_KEYS,
  GROUND_OVERLAY_WATCH_SOURCES,
  createGroundOverlaySpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/groundOverlaySpec";
import {
  MARKER_DESCRIPTOR_KEYS,
  MARKER_FIELDS,
  createMarkerSpec,
} from "../../packages/baidu-map-gl-vue/src/components/overlays/markerSpec";
import { assertOverlayFieldDeclarations } from "../../packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec";
import { useOverlaySpec } from "../../packages/baidu-map-gl-vue/src/core/composables/useOverlaySpec";
import type {
  OverlayFieldUpdate,
  OverlaySpec,
} from "../../packages/baidu-map-gl-vue/src/core/overlays/OverlaySpec";
import { overlayEventsOf } from "../../packages/baidu-map-gl-vue/src/core/overlays/overlayEventCatalog";
import {
  DEPRECATED_EVENT_ALIAS_CODE,
  DEPRECATED_PROP_ALIAS_CODE,
  OVERLAY_EVENT_ALIASES,
  OVERLAY_PROP_ALIASES,
  createDeprecationWarner,
  propAliasesOf,
} from "../../packages/baidu-map-gl-vue/src/core/deprecations";
import {
  OVERLAY_DESCRIPTORS,
  overlayPropertySpec,
  type OverlayKind,
} from "../../packages/baidu-map-gl-vue/src/driver/types/overlays";
import { createFakeV4Harness, type FakeV4Harness, type FakeBMapV4 } from "../../packages/test-utils";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const TYPES_FILE = resolve(REPO_ROOT, "packages/baidu-map-gl-vue/src/types/components.ts");
const OVERLAY_DIR = resolve(REPO_ROOT, "packages/baidu-map-gl-vue/src/components/overlays");
const POINT = { lng: 116.4, lat: 39.9 };

type AnyRecord = Record<string, any>;

let harness: FakeV4Harness;
let fake: FakeBMapV4;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ({ harness, fake } = createFakeV4Harness());
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
  if (!map) throw new Error("用例必须先创建地图（<BMap>）");
  return map.overlays as unknown as AnyRecord[];
}

function currentOverlay(): AnyRecord {
  const raw = attachedOverlays()[0];
  if (!raw) throw new Error("地图上还没有覆盖物");
  return raw;
}

/** 含指定弃用 code 的告警（code 在 context 里，文案按迁移文档保持「旧名 → 新名」）。 */
function warningsWithCode(code: string): unknown[][] {
  return warn.mock.calls.filter((call: unknown[]) =>
    call.some((arg: unknown) => {
      if (typeof arg === "string") return arg.includes(code);
      if (arg && typeof arg === "object") return JSON.stringify(arg).includes(code);
      return false;
    }),
  );
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
    name: "BMarker",
    kind: "marker",
    component: BMarker,
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
    name: "BLabel",
    kind: "label",
    component: BLabel,
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
    name: "BPolyline",
    kind: "polyline",
    component: BPolyline,
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
    name: "BPolygon",
    kind: "polygon",
    component: BPolygon,
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
    name: "BRectangle",
    kind: "rectangle",
    component: BRectangle,
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
    name: "BCircle",
    kind: "circle",
    component: BCircle,
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
    name: "BBezierCurve",
    kind: "bezier-curve",
    component: BBezierCurve,
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
    name: "BPrism",
    kind: "prism",
    component: BPrism,
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
    name: "BGroundOverlay",
    kind: "ground-overlay",
    component: BGroundOverlay,
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
];

async function mountCase(testCase: OverlayCase) {
  const state = ref<Record<string, unknown>>({ ...testCase.props });
  const Host = defineComponent({
    components: { BMap, [testCase.name]: testCase.component as never },
    setup() {
      return () =>
        h(BMap, { provider: harness.provider() }, () => [
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
    name: "BMarker",
    kind: "marker",
    propsInterface: "BMarkerProps",
    fields: MARKER_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: MARKER_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createMarkerSpec as never,
  },
  {
    name: "BLabel",
    kind: "label",
    propsInterface: "BLabelProps",
    fields: LABEL_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: LABEL_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createLabelSpec as never,
  },
  {
    name: "BPolyline",
    kind: "polyline",
    propsInterface: "BPolylineProps",
    fields: POLYLINE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: POLYLINE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPolylineSpec as never,
  },
  {
    name: "BPolygon",
    kind: "polygon",
    propsInterface: "BPolygonProps",
    fields: POLYGON_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: POLYGON_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPolygonSpec as never,
  },
  {
    name: "BRectangle",
    kind: "rectangle",
    propsInterface: "BRectangleProps",
    fields: RECTANGLE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: RECTANGLE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createRectangleSpec as never,
  },
  {
    name: "BCircle",
    kind: "circle",
    propsInterface: "BCircleProps",
    fields: CIRCLE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: CIRCLE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createCircleSpec as never,
  },
  {
    name: "BBezierCurve",
    kind: "bezier-curve",
    propsInterface: "BBezierCurveProps",
    fields: BEZIER_CURVE_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: BEZIER_CURVE_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createBezierCurveSpec as never,
  },
  {
    name: "BPrism",
    kind: "prism",
    propsInterface: "BPrismProps",
    fields: PRISM_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: PRISM_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createPrismSpec as never,
  },
  {
    name: "BGroundOverlay",
    kind: "ground-overlay",
    propsInterface: "BGroundOverlayProps",
    fields: GROUND_OVERLAY_FIELDS as Record<string, OverlayFieldUpdate>,
    descriptorKeys: GROUND_OVERLAY_DESCRIPTOR_KEYS as unknown as Record<string, string | null>,
    spec: createGroundOverlaySpec as never,
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
      if (update === "visibility" || update === "version" || update === "alias") {
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
    // 正证守卫：这个 kind 的描述符里确实有 mutable 条目（否则上面的循环可能什么都没检查到）
    expect(overlayPropertySpec(testCase.kind, "enableMassClear")?.policy).toBe("mutable");
  });

  it.each(DECLARATIONS)("$name：构造期自检通过（含别名登记与版本令牌配对）", (testCase) => {
    const spec = testCase.spec();
    expect(() =>
      assertOverlayFieldDeclarations(spec as never, {
        propAliases: propAliasesOf(testCase.kind),
      }),
    ).not.toThrow();
  });

  it.each(DECLARATIONS)("$name：行为用例覆盖了声明过的每一种策略", (testCase) => {
    const behavior = CASES.find((entry) => entry.kind === testCase.kind);
    expect(behavior, `${testCase.name} 不在行为用例表里`).toBeDefined();
    const covered = new Set<OverlayFieldUpdate>(["visibility"]);
    for (const entry of behavior!.mutable) covered.add(testCase.fields[entry.prop]!);
    for (const entry of behavior!.recreate) covered.add(testCase.fields[entry.prop]!);
    const uncovered = [...new Set(Object.values(testCase.fields))].filter(
      (policy) => !covered.has(policy) && policy !== "alias" && policy !== "version",
    );
    expect(uncovered, `${testCase.name} 有策略没被行为用例覆盖`).toEqual([]);
  });
});

/* ---------------------------------------------------------- 事件面 ↔ SFC emits */

/** 载荷档 → 公共载荷类型名（`driver/types/events.ts`）。 */
const PAYLOAD_TYPE_BY_KIND: Record<string, string> = {
  pointer: "OverlayPointerEvent",
  "partial-pointer": "OverlayPartialPointerEvent",
  base: "OverlayEventPayload",
};

interface EmitsCase {
  readonly file: string;
  readonly kind: OverlayKind;
  /** 矩阵之外的 emit（历史别名 / v-model 回写）。 */
  readonly extra?: readonly string[];
}

const EMITS_CASES: readonly EmitsCase[] = [
  { file: "BMarker.vue", kind: "marker", extra: ["drag-end", "update:position"] },
  { file: "BLabel.vue", kind: "label" },
  { file: "BPolyline.vue", kind: "polyline" },
  { file: "BPolygon.vue", kind: "polygon" },
  { file: "BRectangle.vue", kind: "rectangle" },
  { file: "BCircle.vue", kind: "circle" },
  { file: "BBezierCurve.vue", kind: "bezier-curve" },
  { file: "BPrism.vue", kind: "prism" },
  { file: "BGroundOverlay.vue", kind: "ground-overlay" },
];

/** 解析 SFC 的 `defineEmits<{ … }>()` 块：键 + 载荷注解。 */
function readEmits(file: string): Map<string, string> {
  const source = readFileSync(resolve(OVERLAY_DIR, file), "utf8");
  const start = source.indexOf("defineEmits<{");
  if (start < 0) throw new Error(`${file} 里找不到 defineEmits<{…}>`);
  const body = source.slice(start, source.indexOf("}>()", start));
  const entries = new Map<string, string>();
  for (const match of body.matchAll(/^\s{2}(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*\[([^\]]*)\]/gm)) {
    const name = match[1] ?? match[2] ?? match[3]!;
    const annotation = match[4]!.trim();
    const type = /:\s*([A-Za-z_$][\w$]*)/.exec(annotation)?.[1] ?? "";
    entries.set(name, type);
  }
  expect(entries.size, `${file} 的 defineEmits 解析结果为空`).toBeGreaterThan(3);
  return entries;
}

describe("#31 SFC emits ↔ 事件矩阵", () => {
  it.each(EMITS_CASES)("$file：键集 = 矩阵 ∪ 显式额外项", (testCase) => {
    const emits = readEmits(testCase.file);
    const expected = [
      ...overlayEventsOf(testCase.kind).map((event) => event.vue),
      ...(testCase.extra ?? []),
    ];
    expect([...emits.keys()].sort()).toEqual([...expected].sort());

    // 额外项必须有出处：v-model 回写，或集中弃用层登记过的历史别名
    for (const extra of testCase.extra ?? []) {
      if (extra.startsWith("update:")) continue;
      const registered = OVERLAY_EVENT_ALIASES.some(
        (alias) => alias.kind === testCase.kind && alias.alias === extra,
      );
      expect(registered, `${extra} 既不是 v-model 回写，也没有登记进弃用别名表`).toBe(true);
    }
  });

  it.each(EMITS_CASES)("$file：每个键的载荷注解与矩阵的载荷档一致", (testCase) => {
    const emits = readEmits(testCase.file);
    for (const event of overlayEventsOf(testCase.kind)) {
      const expected = PAYLOAD_TYPE_BY_KIND[event.payload]!;
      expect(emits.get(event.vue), `${testCase.file} 的 ${event.vue}`).toBe(expected);
    }
  });
});

/* ------------------------------------------------- path 大数组：根引用 + 版本 */

describe("#31 path 大数组：根引用 + 版本令牌（不做内容指纹）", () => {
  it.each([
    { name: "BPolyline", component: BPolyline, label: "BPolyline" },
    { name: "BPolygon", component: BPolygon, label: "BPolygon" },
  ])("$label：换根引用 → 一条 setPath；原地改数组 → 不发命令（版本令牌才触发）", async (testCase) => {
    const path = ref([
      { lng: 116.4, lat: 39.9 },
      { lng: 116.5, lat: 40 },
    ]);
    const version = ref(0);
    const Host = defineComponent({
      components: { BMap, [testCase.name]: testCase.component as never },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
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

  it("BBezierCurve：path 与 controlPoints 各有自己的版本令牌", async () => {
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
      components: { BMap, BBezierCurve },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BBezierCurve, {
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
    harness.assertIdle("BBezierCurve 两个版本令牌");
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
      components: { BMap, BPolyline },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BPolyline, {
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

/* ----------------------------------------------------------------- 集中弃用层 */

describe("#31 集中弃用层：旧别名只警告一次且新 API 优先", () => {
  it("prop 别名：只给 startPoint + endPoint 时按旧名建实例，并警告一次", async () => {
    const Host = defineComponent({
      components: { BMap, BGroundOverlay },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BGroundOverlay, {
              type: "image",
              url: "a.png",
              startPoint: { lng: 116.3, lat: 39.8 },
              endPoint: { lng: 116.5, lat: 40 },
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = currentOverlay();
    expect(raw.bounds.getCenter().lng).toBeCloseTo(116.4, 6);
    expect(warningsWithCode(DEPRECATED_PROP_ALIAS_CODE)).toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("BGroundOverlay 旧别名");
  });

  it("prop 别名：正典 bounds 有值时旧名完全不参与（连告警都不发）", async () => {
    const Host = defineComponent({
      components: { BMap, BGroundOverlay },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BGroundOverlay, {
              type: "image",
              url: "a.png",
              bounds: { southwest: { lng: 100, lat: 30 }, northeast: { lng: 110, lat: 40 } },
              startPoint: { lng: 116.3, lat: 39.8 },
              endPoint: { lng: 116.5, lat: 40 },
            } as never),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = currentOverlay();
    expect(raw.bounds.getCenter().lng).toBeCloseTo(105, 6);
    expect(warningsWithCode(DEPRECATED_PROP_ALIAS_CODE)).toEqual([]);

    wrapper.unmount();
    await settle();
  });

  it("事件别名：父级绑了旧名字时才双发 + 告警一次（同实例一次）", async () => {
    // 前置条件在 PR #103 评审 3 之后成为契约的一部分：**只有父级真的绑了旧名字**才会收到
    // 迁移提示（「SDK 派发过某事件」≠「调用方用了弃用名」）。因此本用例显式绑上 `@drag-end`。
    const legacy: unknown[] = [];
    const Host = defineComponent({
      components: { BMap, BMarker },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BMarker, {
              position: POINT,
              enableDragging: true,
              "onDrag-end": (event: unknown) => legacy.push(event),
            }),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const marker = currentOverlay() as AnyRecord;
    const child = wrapper.findComponent(BMarker);

    marker.emit("dragend", { point: { lng: 117, lat: 40 } });
    await settle();
    marker.emit("dragend", { point: { lng: 118, lat: 41 } });
    await settle();

    expect(child.emitted("dragend")).toHaveLength(2);
    expect(child.emitted("drag-end")).toHaveLength(2);
    expect(legacy, "旧名字的监听器收到同载荷").toHaveLength(2);
    // 两次派发、两条别名，但**只警告一次**（同实例一次）
    expect(warningsWithCode(DEPRECATED_EVENT_ALIAS_CODE)).toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("BMarker 事件别名");
  });

  it("弃用表自身：code 稳定、正典名在矩阵里、旧名不在描述符/矩阵里", () => {
    for (const alias of OVERLAY_PROP_ALIASES) {
      expect(alias.code).toBe(DEPRECATED_PROP_ALIAS_CODE);
      expect(
        overlayPropertySpec(alias.kind, alias.canonical),
        `${alias.kind}.${alias.canonical} 必须在描述符里`,
      ).toBeDefined();
      for (const deprecated of alias.deprecated) {
        expect(
          overlayPropertySpec(alias.kind, deprecated),
          `${alias.kind}.${deprecated} 是旧名，不应出现在描述符里`,
        ).toBeUndefined();
      }
    }
    for (const alias of OVERLAY_EVENT_ALIASES) {
      expect(alias.code).toBe(DEPRECATED_EVENT_ALIAS_CODE);
      const names = overlayEventsOf(alias.kind).map((event) => event.vue);
      expect(names, `正典事件 ${alias.canonical} 必须在矩阵里`).toContain(alias.canonical);
      expect(names, `${alias.alias} 是历史名，不应在矩阵里`).not.toContain(alias.alias);
    }
    // 正证守卫：两张表都非空（否则上面的循环什么都没检查）
    expect(OVERLAY_PROP_ALIASES.length).toBeGreaterThan(0);
    expect(OVERLAY_EVENT_ALIASES.length).toBeGreaterThan(0);
    expect(propAliasesOf("ground-overlay")).toHaveLength(1);
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
      components: { BMap, Probe },
      setup() {
        return () => h(BMap, { provider: harness.provider() }, () => [h(Probe)]);
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

describe("#31 弃用告警器：同 code 只输出一次", () => {
  it("同一 code 重复告警只输出一次，不同 code 各一次", () => {
    const warner = createDeprecationWarner("probe");
    const first = { code: DEPRECATED_PROP_ALIAS_CODE, message: "a" };
    const second = { code: DEPRECATED_EVENT_ALIAS_CODE, message: "b" };
    warner.warn(first);
    warner.warn(first);
    warner.warn(second);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warner.warned).toEqual([DEPRECATED_PROP_ALIAS_CODE, DEPRECATED_EVENT_ALIAS_CODE]);
    // 正证守卫：告警内容确实带着 code 与组件名（脱敏/文案之外的可检索性）
    expect(JSON.stringify(warn.mock.calls[0]![1])).toContain(DEPRECATED_PROP_ALIAS_CODE);
    expect(JSON.stringify(warn.mock.calls[0]![1])).toContain("probe");
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
      components: { BMap, Probe },
      setup() {
        return () => h(BMap, { provider: harness.provider() }, () => [h(Probe)]);
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

describe("[评审 2] BGroundOverlay 的 url 惰性工厂只求值一次", () => {
  it("一次 create 只调用一次工厂（校验用的对象就是交给 SDK 的那个）", async () => {
    let calls = 0;
    const factory = () => {
      calls += 1;
      return `canvas-${calls}.png`;
    };
    const Host = defineComponent({
      components: { BMap, BGroundOverlay },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BGroundOverlay, {
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

describe("[评审 3] 弃用事件告警只在实例上真的绑了旧名字时发", () => {
  function markerHost(listeners: Record<string, unknown>) {
    return defineComponent({
      components: { BMap, BMarker },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BMarker, { position: POINT, enableDragging: true, ...listeners }),
          ]);
      },
    });
  }

  it("只监听规范名 @dragend：不发弃用告警（也没有误报）", async () => {
    const wrapper = mount(markerHost({ onDragend: () => {} }), { attachTo: harness.container() });
    await settle();
    await settle();
    const marker = currentOverlay();
    marker.emit("dragend", { point: { lng: 117, lat: 40 } });
    await settle();
    expect(warningsWithCode(DEPRECATED_EVENT_ALIAS_CODE), "只用了新名字时不得提示迁移").toEqual([]);
    wrapper.unmount();
    await settle();
  });

  it("完全不监听 Marker 事件：拖拽也不发弃用告警", async () => {
    const wrapper = mount(markerHost({}), { attachTo: harness.container() });
    await settle();
    await settle();
    currentOverlay().emit("dragend", { point: { lng: 117, lat: 40 } });
    await settle();
    expect(warningsWithCode(DEPRECATED_EVENT_ALIAS_CODE)).toEqual([]);
    wrapper.unmount();
    await settle();
  });

  it.each(["onDrag-end", "onDragEnd"])("真的绑了旧名字（%s）：各发一次且只告警一次", async (key) => {
    const legacy: unknown[] = [];
    const wrapper = mount(markerHost({ [key]: (event: unknown) => legacy.push(event) }), {
      attachTo: harness.container(),
    });
    await settle();
    await settle();
    const marker = currentOverlay();
    const child = wrapper.findComponent(BMarker);

    marker.emit("dragend", { point: { lng: 117, lat: 40 } });
    await settle();
    marker.emit("dragend", { point: { lng: 118, lat: 41 } });
    await settle();

    expect(legacy, "旧名字的监听器必须收到载荷").toHaveLength(2);
    expect(child.emitted("dragend")).toHaveLength(2);
    expect(warningsWithCode(DEPRECATED_EVENT_ALIAS_CODE)).toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("[评审 3] 旧名字监听器");
  });
});

describe("[评审 4] remove 事件的可观察时机（文档与用例一起对齐）", () => {
  it("外部摘除会到达组件；切隐藏不会（hide 不派发 remove）", async () => {
    const removed: unknown[] = [];
    const visible = ref(true);
    const Host = defineComponent({
      components: { BMap, BBezierCurve },
      setup() {
        return () =>
          h(BMap, { provider: harness.provider() }, () => [
            h(BBezierCurve, {
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
