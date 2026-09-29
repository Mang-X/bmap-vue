/**
 * `<Panorama>` 事件名的**双拼写**与 `linksVisibleChanged`（issue #165 TASK 6 / 7）
 *
 * ## 为什么需要别名
 *
 * 事件名是**公共契约**，而用户拿到事件名的来源有**两份且拼写不同**：
 *
 * | 来源 | 拼写 |
 * | --- | --- |
 * | JSAPI 声明 `panorama/PanoramaEvent.d.ts` 的 `PanoramaEventMap` 键 | snake_case（`link_click`） |
 * | 官方 React 参考 `src/components/Panorama/index.tsx` 的 `on*` props | camelCase（`onLinkClick`） |
 *
 * 用户从任一份文档抄到名字都可能写进模板。`<Map>` 早已为这件事留了机制：
 * `core/events/eventCatalog.ts` 的 `MAP_EVENT_EMIT_ALIASES` 让 `sdk !== vue` 的条目
 * **同时**发两个名字。本文件把同一条口径落到 `<Panorama>` 上。
 *
 * ## 为什么不复用 `MAP_EVENT_EMIT_ALIASES` 本身
 *
 * 那张表的形状是 `public → [SDK 拼写]`，但它的**内容**是 map 专属的：表项由
 * `MAP_EVENT_CATALOG` 派生，而那张 Catalog 的名字规则是
 * `vue = sdk.replace(/_/g, "-")`（**kebab**）。`<Panorama>` 的对外名是 **camelCase** 且
 * **早已发布**（`positionChange` / `linksChange` / …）。把 `<Panorama>` 塞进去要付三笔账：
 *
 * 1. 得在 map 的 Catalog 里塞进一批**不符合 kebab 规则**的条目（`linkClick` 不是
 *    `link_click` 的 kebab 形式），并让 `toVueEventName()` / `resolveMapEventName()`
 *    的「任一种拼写都归一」索引把这批 camelCase 名收进去——那等于给 map 事件的名字口径
 *    加一个**只为 panorama 服务的例外**，而那张表是 map 事件的单一事实源。
 * 2. 借用 `MapEventEmits` 这个**显式键接口**。它的载荷是 `MapEventPayload` /
 *    `MapPointerEvent` / …，与 panorama 的 `Point | null` / `PanoramaLink[]` /
 *    `PanoramaPov | null` 完全不同；把 panorama 的键塞进去会得到一个「名字是两种、
 *    载荷各按各的」的混合接口，类型门禁（`EmitPayloadMismatches`）随即失去意义。
 * 3. 触碰 `useOverlaySpec` / `OverlayKind` 的**封闭 kind 集**与「矩阵驱动的绑定」这两条前提
 *    ——`<Panorama>` **不是**覆盖物（它是独立容器上的查看器，见 `core/panorama/index.ts`），
 *    加进去会让那两条前提失效。本文件末尾有反证用例钉住这一点。
 *
 * 因此本文件引入的是**等价物**：`core/panorama/panoramaEventCatalog.ts` 的
 * `PANORAMA_EVENT_EMIT_ALIASES`，形状与语义（`public → [SDK 拼写]`，两个名字都发）与 map
 * 那张逐字同源，但**表的内容是 panorama 自己的**。
 * **组件里没有第二份兼容代码**（同 issue #28 对 map 的要求）。
 *
 * ## 不做 1:1 的两条：`load` / `error`
 *
 * `dataload → load`、`pano_error → error` 是**改名**而不是拼写差异：官方那条事件在
 * Vue 侧叫 `load`，用户从 SDK 文档抄来的 `dataload` 并不是「同一个名字的另一种写法」。
 * 发两个名字会让「监听 `dataload`」在官方语义之外多出一条**从未被官方承诺**的路径；
 * `pano_error` 还要额外说明它与本库通用的 `error` 出口的关系。理由逐条写在
 * `PANORAMA_EVENT_RENAMED` 上，由本文件的负向用例钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
import { createFakeV4Harness, type FakeBMapV4, type FakeV4Harness } from "../../packages/test-utils";
import {
  PANORAMA_EVENT_EMIT_ALIASES,
  PANORAMA_EVENT_RENAMED,
} from "../../packages/bmap-vue/src/core/panorama/panoramaEventCatalog";
import { OVERLAY_EVENT_MATRIX, OVERLAY_KINDS_WITHOUT_EVENT_MATRIX } from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";

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

function lastViewer(): AnyRecord {
  const viewer = fake.createdPanoramas.at(-1);
  if (!viewer) throw new Error("还没有创建查看器");
  return viewer as unknown as AnyRecord;
}

/** `eventName` → `onEventName` 形式的监听 prop（Vue 模板事件的 `h()` 写法）。 */
function listenerProps(
  eventNames: readonly string[],
  record: (name: string) => (payload: unknown) => void,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const name of eventNames) {
    props[`on${name[0]!.toUpperCase()}${name.slice(1)}`] = record(name);
  }
  return props;
}

/** 挂一个 `<Panorama>`，订阅给定的那些事件名（同时订阅 camelCase 与 SDK 拼写）。 */
async function mountListening(eventNames: readonly string[]) {
  const seen: Array<{ name: string; payload: unknown }> = [];
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(Panorama, {
            point: POINT,
            ...listenerProps(
              eventNames,
              (name) => (payload: unknown) => seen.push({ name, payload }),
            ),
          }),
        ]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return { wrapper, seen, names: () => seen.map((entry) => entry.name) };
}

/**
 * 每一对别名的 fixture：SDK 事件名 + 派发载荷 + 期望的**两个**对外名（camelCase / SDK）。
 *
 * 载荷刻意覆盖三条不同的投影路径（带 `_` 的走「原样投递 + 收窄投影」、不带 `_` 的走
 * 交互投影、其余走「回读 getter 补值」），因此这组用例同时钉住「别名不改变载荷」。
 */
const ALIAS_FIXTURES: ReadonlyArray<{
  sdk: string;
  publicName: string;
  emit: Record<string, unknown>;
  /** 派发前先摆好替身状态（回读型事件需要一个可读回的值）。 */
  before?: (viewer: AnyRecord) => void;
  expected: (payload: unknown) => boolean;
}> = [
  {
    sdk: "link_click",
    publicName: "linkClick",
    emit: { id: "pano-9" },
    expected: (payload) => (payload as AnyRecord)?.id === "pano-9",
  },
  {
    sdk: "pov_changed_end",
    publicName: "povChangedEnd",
    emit: {},
    // 回读 `getPov()`：替身默认 `{heading: 0, pitch: 0}`
    expected: (payload) => (payload as AnyRecord)?.heading === 0,
  },
  {
    sdk: "scene_change_end",
    publicName: "sceneChangeEnd",
    emit: {},
    // 回读 `getSceneType()`：替身默认 `'street'`
    expected: (payload) => payload === "street",
  },
  {
    sdk: "size_changed",
    publicName: "sizeChanged",
    emit: {},
    // 无载荷：官方没有尺寸字段也没有读回入口（`sizeChanged` 的既有口径）
    expected: (payload) => payload === undefined,
  },
  {
    sdk: "overlay_add",
    publicName: "overlayAdd",
    emit: {},
    expected: (payload) => payload === undefined,
  },
  {
    sdk: "overlay_remove",
    publicName: "overlayRemove",
    emit: {},
    expected: (payload) => payload === undefined,
  },
  {
    sdk: "overlays_clear",
    publicName: "overlaysClear",
    emit: {},
    expected: (payload) => payload === undefined,
  },
  {
    sdk: "visible_poi_type_changed",
    publicName: "visiblePoiTypeChanged",
    emit: { visiblePOIType: "hotel" },
    expected: (payload) => payload === "hotel",
  },
  {
    sdk: "position_changed",
    publicName: "positionChange",
    emit: {},
    expected: (payload) => (payload as AnyRecord)?.lng === POINT.lng,
  },
  {
    sdk: "pov_changed",
    publicName: "povChange",
    emit: {},
    expected: (payload) => (payload as AnyRecord)?.heading === 0,
  },
  {
    sdk: "zoom_changed",
    publicName: "zoomChange",
    emit: {},
    expected: (payload) => payload === 1,
  },
  {
    sdk: "scene_type_changed",
    publicName: "sceneTypeChange",
    emit: {},
    expected: (payload) => payload === "street",
  },
  {
    sdk: "id_changed",
    publicName: "idChange",
    emit: {},
    // 官方 `id_changed` 的载荷**是一个字符串**（不是底座事件对象）——本库同样回读 `getId()`
    expected: (payload) => payload === "pano-7",
    // 官方那个裸字符串载荷会进替身；组件忽略它并回读，因此这里要先把状态摆好
    before: (viewer) => {
      viewer.id = "pano-7";
    },
  },
  {
    sdk: "links_changed",
    publicName: "linksChange",
    emit: {},
    // 回读 `getLinks()`：替身默认 `[]`
    expected: (payload) => Array.isArray(payload) && (payload as unknown[]).length === 0,
  },
  {
    sdk: "links_visible_changed",
    publicName: "linksVisibleChanged",
    emit: { value: true },
    expected: (payload) => payload === true,
  },
];

/** 本组 fixture 的 SDK 键里有下划线的那批（= 真正需要别名的）。 */
const UNDERSCORED_SDK_NAMES = ALIAS_FIXTURES.map((entry) => entry.sdk).filter((name) =>
  name.includes("_"),
);

describe("<Panorama> 的 SDK 拼写别名（双发）", () => {
  it.each(ALIAS_FIXTURES)("$sdk 同时发出 $publicName 与 $sdk（载荷相同）", async (fixture) => {
    const { sdk, publicName, emit, before, expected } = fixture;
    // 两个名字都订阅：只发一个的话，另一条会缺席，顺序断言立刻红
    const { wrapper, seen, names } = await mountListening([publicName, sdk]);

    before?.(lastViewer());
    lastViewer().emit(sdk, emit);
    await settle();

    expect(names()).toEqual([publicName, sdk]);
    for (const entry of seen) {
      expect(expected(entry.payload), `${entry.name} 的载荷应与规范名一致`).toBe(true);
    }

    wrapper.unmount();
    await settle();
    harness.assertIdle("Panorama 事件别名双发");
  });

  it("只订阅 camelCase 时 SDK 事件仍然驱动它（别名不改变主路径）", async () => {
    const { wrapper, seen, names } = await mountListening(["linkClick"]);

    lastViewer().emit("link_click", { id: "pano-1" });
    await settle();

    expect(names()).toEqual(["linkClick"]);
    expect((seen[0]!.payload as AnyRecord).id).toBe("pano-1");
    wrapper.unmount();
    await settle();
  });

  it("不带分隔符的官方事件（clickonroad）不需要别名——它与对外名逐字相同", async () => {
    const { wrapper, names } = await mountListening(["clickonroad"]);

    lastViewer().emit("clickonroad", { type: "clickonroad" });
    await settle();

    // 逐字相同 ⇒ 不该发两次（否则监听回调会被调用两遍）
    expect(names()).toEqual(["clickonroad"]);
    wrapper.unmount();
    await settle();
  });

  it("别名订阅随组件卸载全部归零（新增的订阅不得留下在飞的监听）", async () => {
    const { wrapper } = await mountListening(
      Object.values(PANORAMA_EVENT_EMIT_ALIASES).flat(),
    );
    const viewer = lastViewer();
    const before = viewer.getListenerCount();
    expect(before, "挂载后每条 SDK 事件都恰好一个监听").toBeGreaterThan(14);

    wrapper.unmount();
    await settle();

    expect(viewer.getListenerCount(), "卸载后不得残留监听").toBe(0);
    harness.assertIdle("Panorama 别名卸载");
  });
});

describe("<Panorama> 的 linksVisibleChanged（官方 links_visible_changed: { value: boolean }）", () => {
  it("派发裸 boolean（不交出官方那个 { value } 包装对象）", async () => {
    // 两个名字都订阅：SDK 拼写也要能用
    const { wrapper, seen, names } = await mountListening([
      "linksVisibleChanged",
      "links_visible_changed",
    ]);

    // 走替身的**真实驱动路径**（`setLinksVisible`），不是手动 `emit`——
    // 后者会绕开「谁触发它」这个问题，而那正是本票要回答的
    lastViewer().setLinksVisible(false);
    lastViewer().setLinksVisible(true);
    await settle();

    expect(names()).toEqual([
      "linksVisibleChanged",
      "links_visible_changed",
      "linksVisibleChanged",
      "links_visible_changed",
    ]);
    // 与 `visiblePoiTypeChanged` 同一手法：官方包装对象是 SDK 的形状，裸值才是领域形状。
    // 每次 SDK 事件的两个名字**载荷相同** ⇒ 序列是 `[false, false, true, true]`。
    expect(seen.map((entry) => entry.payload)).toEqual([false, false, true, true]);
    wrapper.unmount();
    await settle();
    harness.assertIdle("Panorama linksVisibleChanged");
  });

  it("值没变时不派发（官方这条是「状态变化后触发」）", async () => {
    const { wrapper, names } = await mountListening(["linksVisibleChanged"]);

    // 替身初值是 `true`；重复设成同一个值不得派发
    lastViewer().setLinksVisible(true);
    await settle();
    expect(names(), "值未变化 ⇒ 没有事件").toEqual([]);

    lastViewer().setLinksVisible(false);
    await settle();
    expect(names()).toEqual(["linksVisibleChanged"]);

    wrapper.unmount();
    await settle();
  });

  it("官方没给 value / 给了非 boolean ⇒ false（不塞一个让类型说谎的值）", async () => {
    const { wrapper, seen } = await mountListening(["linksVisibleChanged"]);

    // 绕过替身的类型检查，直接派发形状不对的载荷（真实 SDK 上不保证形状）
    lastViewer().emit("links_visible_changed", {});
    lastViewer().emit("links_visible_changed", { value: "yes" });
    await settle();

    expect(seen.map((entry) => entry.payload), "载荷类型是 boolean").toEqual([false, false]);
    wrapper.unmount();
    await settle();
  });

  it("与 linksChanged 是**两件事**（载荷形状不得互换）", async () => {
    const { wrapper, seen, names } = await mountListening(["linksChange", "linksVisibleChanged"]);

    lastViewer().links = [{ id: "pano-3", description: "天安门广场" }];
    lastViewer().emit("links_changed", {});
    lastViewer().emit("links_visible_changed", { value: true });
    await settle();

    // 列表变化 ⇒ `PanoramaLink[]`；显隐变化 ⇒ `boolean`
    expect(names()).toEqual(["linksChange", "linksVisibleChanged"]);
    expect(Array.isArray(seen[0]!.payload), "linksChange 带链接数组").toBe(true);
    expect(seen[1]!.payload).toBe(true);
    wrapper.unmount();
    await settle();
  });
});

describe("别名表的判据（哪些是别名 / 哪些是改名 / 哪些不进任何表）", () => {
  it("别名表恰好覆盖全部带 `_` 的 SDK 事件键（双向取差集）", () => {
    const aliased = Object.values(PANORAMA_EVENT_EMIT_ALIASES).flat();
    expect([...UNDERSCORED_SDK_NAMES].filter((name) => !aliased.includes(name))).toEqual([]);
    expect(aliased.filter((name) => !UNDERSCORED_SDK_NAMES.includes(name))).toEqual([]);
  });

  it("别名不得与对外名逐字相同（相同拼写不需要别名）", () => {
    for (const [publicName, aliases] of Object.entries(PANORAMA_EVENT_EMIT_ALIASES)) {
      for (const alias of aliases) {
        expect(alias, `${publicName} 的别名不得与它逐字相同`).not.toBe(publicName);
      }
    }
  });

  it("别名的 SDK 拼写必须是**官方声明的** `PanoramaEventMap` 键（不臆造）", async () => {
    const { readFileSync, existsSync, realpathSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const root = resolve(import.meta.dirname, "../..");
    const dir = ["packages/bmap-vue/node_modules", "node_modules"]
      .map((prefix) => resolve(root, prefix, "@baidumap/jsapi-v4-types"))
      .find((candidate) => existsSync(join(candidate, "package.json")));
    expect(dir, "未找到已安装的 @baidumap/jsapi-v4-types（先跑 pnpm install）").toBeDefined();
    const file = join(realpathSync(dir!), "panorama/PanoramaEvent.d.ts");
    const text = readFileSync(file, "utf8");
    const block = text.slice(text.indexOf("interface PanoramaEventMap"));
    for (const alias of Object.values(PANORAMA_EVENT_EMIT_ALIASES).flat()) {
      expect(block, `${alias} 必须在官方 PanoramaEventMap 里声明`).toContain(`${alias}:`);
    }
  });

  it("`load` / `error` 是**改名**不是别名：表里没有它们的 SDK 拼写", () => {
    // 改名意味着「SDK 拼写不作为别名发」——否则会凭空多出一条官方没承诺的事件名。
    for (const { publicName, sdk } of PANORAMA_EVENT_RENAMED) {
      expect(PANORAMA_EVENT_EMIT_ALIASES[publicName], `${publicName} 不得有别名`).toBeUndefined();
      for (const aliases of Object.values(PANORAMA_EVENT_EMIT_ALIASES)) {
        expect(aliases, `${sdk} 不得作为任何事件的别名`).not.toContain(sdk);
      }
    }
  });

  it("全景**不是**覆盖物：别名机制没有破坏 OverlayKind 的封闭集与矩阵绑定", () => {
    // 反证：本票刻意**不**把 `<Panorama>` 塞进 `useOverlaySpec` / `OverlayKind`——
    // 那会破坏「kind 集封闭」与「矩阵驱动的绑定」两条前提（见文件头第 3 条）。
    expect(Object.keys(OVERLAY_EVENT_MATRIX)).not.toContain("panorama");
    expect(Object.keys(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX)).not.toContain("panorama");
    expect(Object.keys(PANORAMA_EVENT_EMIT_ALIASES)).not.toContain("panorama");
  });
});
