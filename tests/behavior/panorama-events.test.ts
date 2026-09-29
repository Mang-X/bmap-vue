/**
 * `Panorama` 的事件面裁决与门禁（issue #168 item 3）
 *
 * 官方 `panorama/PanoramaEvent.d.ts` 的 `PanoramaEventMap` 共 **23** 个事件，本库此前只
 * 派发 **8** 个（`dataload` / `pano_error` / `position_changed` / `pov_changed` /
 * `zoom_changed` / `id_changed` / `scene_type_changed` / `links_changed`）。
 *
 * ## 这是**裁决**，不是补齐清单
 *
 * 官方有、本库没有，不等于「漏了」——也可能等于「官方声明了但消费方拿不到值」或
 * 「载荷是 raw DOM 事件」。逐条的裁决与理由见本文件每个 `describe` 的头注释，
 * 以及 `docs/zh-CN/contributing/168-remaining-surface.md`。
 *
 * ## 官方 23 个事件的裁决总表
 *
 * | 官方事件 | 裁决 | 一句话理由 |
 * | --- | --- | --- |
 * | `position_changed` `pov_changed` `zoom_changed` `id_changed` `scene_type_changed` `links_changed` `dataload` `pano_error` | **已有** | #41 / #165 落地 |
 * | `click` `dblclick` `touchstart` `touchend` | **加** | 全景是画布，**没有别的点击入口**——这是它与 `<Map>` 的根本差别（地图上想点一个覆盖物可以用别的组件表达，全景上不行）。载荷经**收窄投影**成坐标 + 按钮号，不交出 raw `MouseEvent` |
 * | `link_click` | **加** | 带 `id: string`（**可消费**），且它是「导航到相邻全景」的唯一可编程入口 |
 * | `clickonroad` | **加** | 同 `link_click` 的场景（点道路），载荷只有 `type`/`target`/`currentTarget` ⇒ 投影出**事件类型字符串** |
 * | `pov_changed_end` | **加** | 官方 `*_changed` 不带值，但**回读 `getPov()` 有值** ⇒ 沿用现有「回读补载荷」手法（与 6 个 `*_changed` 同一手法） |
 * | `scene_change_end` | **加** | 同上，回读 `getSceneType()` |
 * | `size_changed` | **加** | 同上，回读 `getVisible()` 之外的容器尺寸不可得，但**事件本身是「容器变了」的唯一通知** ⇒ 投影成 `null` 载荷（不编尺寸） |
 * | `overlay_add` `overlay_remove` `overlays_clear` | **加** | 这是「`<PanoramaLabel>` 什么时候真的挂上/摘掉了」的**唯一**通知；本库的标注由子组件管理，没有别的观察面 |
 * | `destroy` | **不加** | 官方有声明，但本库 `dispose()` 的顺序是「**先解绑业务监听、再 `driver.destroy()`**」（ADR 2026-09-11 §6：SDK 在 destroy 期间**同步**派发时，回调不得打到已拆解状态上）。要听见它就得倒顺序 ⇒ 拿一个真实正确性风险换一句收尾信号，不划算。清理用 `onUnmounted` |
 * | `links_visible_changed` | **加**（#165 TASK 7 更正）| 载荷 `{value: boolean}` 是官方**声明过且自足**的（不需要回读 getter）⇒ 「道路指示现在亮不亮」是可核对的一条消费路径。原判「不加」，理由见文末「两处更正」 |
 * | `visible_poi_type_changed` | **加** | 载荷 `{visiblePOIType}` 可消费，且 `setPanoramaPoiType()` 是本库已暴露的写入口 ⇒ 写完能确认落没落 |
 * | `touchmove` | **不存在** | issue 点名了它，但**官方 `PanoramaEventMap` 里没有**（只有 `touchstart` / `touchend`）。按「d.ts 定存在与否」不暴露 |
 *
 * ## 两处本表已被 #165 后续更正
 *
 * 1. **`links_visible_changed` 由「不加」改为「加」**（TASK 7 → `linksVisibleChanged`）。
 *    原判理由是「由官方自带控件（`linksControl`）的显隐驱动，而本库不镜像那个控件的内部
 *    UI 状态（官方没有给读回入口）」——**「没有读回入口」与「该不该暴露」无关**：
 *    官方载荷 `{ value: boolean }` 是**自足**的（不需要回读任何 getter），这与同族另外
 *    两条「不带值、要回读」的事件判据完全相反。原判把「本库不镜像它」当成了「它没有可消费
 *    的内容」，那是两件事。
 * 2. **对外事件名有了 SDK 拼写别名**（TASK 6）。本文件此前只订阅 camelCase；现在
 *    `link_click` / `links_changed` / … 这些官方键**同样能绑上**。判据与逐条理由见
 *    `core/panorama/panoramaEventCatalog.ts`，门禁用例在
 *    `tests/behavior/panorama-event-aliases.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
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

function lastViewer(): AnyRecord {
  const viewer = fake.createdPanoramas.at(-1);
  if (!viewer) throw new Error("还没有创建查看器");
  return viewer as unknown as AnyRecord;
}

/** 挂一个 `<Panorama>`，返回 wrapper 与「派发过的事件名 → 载荷」账本。 */
async function mountPanorama(props: Record<string, unknown> = {}) {
  const seen: Array<{ name: string; payload: unknown }> = [];
  const listeners = onProps(EVENT_UNDER_TEST, seen);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(Panorama, { point: POINT, ...props, ...listeners }),
        ]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return { wrapper, seen, names: () => seen.map((entry) => entry.name) };
}

/**
 * 本文件覆盖的官方事件 → 期望的 Vue 事件名。
 *
 * ## ⚠️ 命名：**本组件用 camelCase，而全库规则是 kebab-case**（这是一处**已存在**的偏差）
 *
 * `core/events/eventCatalog.ts` 的 `toVueEventName` 把 `_` 换成 `-`，地图事件与覆盖物事件
 * 全部走它。但 `<Panorama>` 早已发布的 8 条事件是 **camelCase**（`positionChange` /
 * `linksChange` / …）——它们**不是**由 `toVueEventName` 派生的，是手写的。
 *
 * 这次的选择：**新增事件沿用本组件既有的 camelCase**，而不是改成 kebab-case。理由：
 * - 在**同一个组件**里混两套命名（8 条 camelCase + 14 条 kebab-case）是最坏的一种分叉，
 *   用户在模板里写 `@linkClick` 还是 `@link-click` 没有可推断的规则；
 * - 改那 8 条的名字是**破坏性变更**（`1.0.0-rc.0` 已发布它们），而「统一命名」该不该
 *   配一次改名是**父决策**，不是本 ticket 能单方面做的。
 *
 * 因此这里**如实记录偏差**并用一条断言钉住「本组件内部一致」，把改名留给显式决策。
 * 依据与后续建议见 `docs/zh-CN/contributing/168-remaining-surface.md`。
 */
const EVENT_UNDER_TEST = {
  click: "click",
  dblclick: "dblclick",
  touchstart: "touchstart",
  touchend: "touchend",
  clickonroad: "clickonroad",
  link_click: "linkClick",
  pov_changed_end: "povChangedEnd",
  scene_change_end: "sceneChangeEnd",
  size_changed: "sizeChanged",
  overlay_add: "overlayAdd",
  overlay_remove: "overlayRemove",
  overlays_clear: "overlaysClear",
  visible_poi_type_changed: "visiblePoiTypeChanged",
} as const;

/**
 * 已有的 8 条（#41 / #165）——只为「不回归」那一组而订阅，键值与上面同样是 SDK 名 → Vue 名。
 *
 * `load` / `error` 刻意**不在**这张表里：它们的 Vue 名与官方名不同（`dataload` → `load`、
 * `pano_error` → `error`），单独在回归用例里显式挂，避免「一张表管全部」把这种改名藏起来。
 */
const PRE_EXISTING_EVENTS = {
  position_changed: "positionChange",
  pov_changed: "povChange",
  zoom_changed: "zoomChange",
  id_changed: "idChange",
  scene_type_changed: "sceneTypeChange",
  links_changed: "linksChange",
} as const;

/** 挂 `on<EventName>` 形式的监听 prop（Vue 模板事件的 `h()` 写法）。 */
function onProps(
  names: Record<string, string>,
  seen: Array<{ name: string; payload: unknown }>,
): Record<string, (payload: unknown) => void> {
  const props: Record<string, (payload: unknown) => void> = {};
  for (const vueName of Object.values(names)) {
    props[`on${vueName[0]!.toUpperCase()}${vueName.slice(1)}`] = (payload: unknown) =>
      seen.push({ name: vueName, payload });
  }
  return props;
}

/* ------------------------------------------------------------------- 指针事件 */

describe("Panorama 指针事件（官方 click / dblclick / touchstart / touchend）", () => {
  it("四个事件都派发，载荷经**收窄投影**（不交出 raw MouseEvent）", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    for (const sdkName of ["click", "dblclick", "touchstart", "touchend"]) {
      viewer.emit(sdkName, { clientX: 12, clientY: 34, button: 0 });
    }
    await settle();

    expect(names()).toEqual(["click", "dblclick", "touchstart", "touchend"]);

    const payload = seen[0]!.payload as AnyRecord;
    // 投影：只保留**领域**坐标（官方 MouseEvent 里的 clientX/clientY 是像素偏移，
    // 与地图的 `{lng, lat}` 不是一回事，因此**不**投影成 Point——见下面的断言）
    expect(payload.type).toBe("click");
    expect(payload.clientX, "raw MouseEvent 成员不得原样透出").toBeUndefined();
    expect(payload.clientY, "raw MouseEvent 成员不得原样透出").toBeUndefined();
    // 底座事件对象（官方 `type`）保留：`target` / `currentTarget` 是 raw `Panorama`，不投影
    expect(payload.target, "不得交出 raw Panorama 实例").toBeUndefined();
    expect(payload.currentTarget, "不得交出 raw Panorama 实例").toBeUndefined();

    wrapper.unmount();
    await settle();
    harness.assertIdle("Panorama 指针事件");
  });

  it("载荷不是官方事件对象本身（原样转发会泄漏 raw SDK 对象）", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();
    const raw = { type: "click", clientX: 1, clientY: 2, target: {}, currentTarget: {} };

    viewer.emit("click", raw);
    await settle();

    expect(seen[0]!.payload).not.toBe(raw);
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------------------- link_click / 道路 */

describe("Panorama link_click / clickonroad（官方 PanoramaEventMap）", () => {
  it("link_click：投影出官方声明的 id 字段", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("link_click", { id: "pano-9", description: "天安门广场" });
    await settle();

    expect(names()).toContain("linkClick");
    const payload = seen.find((entry) => entry.name === "linkClick")!.payload as AnyRecord;
    expect(payload.id).toBe("pano-9");
    expect(payload.target, "不得交出 raw Panorama 实例").toBeUndefined();

    wrapper.unmount();
    await settle();
  });

  it("link_click：官方没给 id 时载荷为 null（不编一个空串 id）", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("link_click", { description: "无名道路" });
    await settle();

    const payload = seen.find((entry) => entry.name === "linkClick")!.payload as AnyRecord;
    expect(payload.id).toBeUndefined();

    wrapper.unmount();
    await settle();
  });

  it("clickonroad：投影成事件类型字符串", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("clickonroad", { type: "clickonroad" });
    await settle();

    expect(names()).toContain("clickonroad");
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------------- 回读补载荷的三个 *_end */

describe("Panorama 的 *_end 事件（官方载荷无值，按现有回读手法补齐）", () => {
  it("pov_changed_end：回读 getPov() 补载荷", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();

    viewer.pov = { heading: 123, pitch: -10 };
    viewer.emit("pov_changed_end", { type: "pov_changed_end" });
    await settle();

    const payload = seen.find((entry) => entry.name === "povChangedEnd")!.payload as AnyRecord;
    expect(payload.heading).toBe(123);
    expect(payload.pitch).toBe(-10);

    wrapper.unmount();
    await settle();
  });

  it("scene_change_end：回读 getSceneType() 补载荷", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();

    viewer.sceneType = "inter";
    viewer.emit("scene_change_end", { type: "scene_change_end" });
    await settle();

    const payload = seen.find((entry) => entry.name === "sceneChangeEnd")!.payload;
    expect(payload).toBe("inter");

    wrapper.unmount();
    await settle();
  });

  it("size_changed：只报「变了」，**不编尺寸**（容器尺寸无官方读回入口）", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("size_changed", { type: "size_changed" });
    await settle();

    expect(names()).toContain("sizeChanged");
    // 官方 `PanoramaBaseEvent` 里没有尺寸字段，SDK 也没有 getSize()/getContainerSize()。
    // 因此**不**给载荷：编一个 `{width:0,height:0}` 会让「尺寸未知」变成「尺寸为零」。
    expect(seen.find((entry) => entry.name === "sizeChanged")!.payload).toBeUndefined();

    wrapper.unmount();
    await settle();
  });
});

/* ----------------------------------------------------------------- 覆盖物生命周期 */

describe("Panorama 覆盖物事件（官方 overlay_add / overlay_remove / overlays_clear）", () => {
  it("三个事件都派发，载荷是**标注描述**而不是 raw PanoramaLabel", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("overlay_add", { getContent: () => "站点 A", content: "站点 A" });
    viewer.emit("overlay_remove", { getContent: () => "站点 A", content: "站点 A" });
    viewer.emit("overlays_clear", { type: "overlays_clear" });
    await settle();

    expect(names()).toEqual(["overlayAdd", "overlayRemove", "overlaysClear"]);
    // 载荷是**空**（`: []` 形式）⇒ 监听回调收到的第一个实参是 `undefined`。
    // 关键是它**不是** raw `PanoramaLabel`：官方那两个事件的载荷正是 raw 标注实例。
    const add = seen[0]!.payload as AnyRecord | undefined;
    expect(add?.getContent, "raw PanoramaLabel 的方法不得透出").toBeUndefined();
    expect(add?.content, "raw PanoramaLabel 的字段不得透出").toBeUndefined();

    wrapper.unmount();
    await settle();
    harness.assertIdle("Panorama 覆盖物事件");
  });
});

/* ------------------------------------------------------------------- visible_poi */

describe("Panorama visible_poi_type_changed（官方 { visiblePOIType }）", () => {
  it("投影成本库的 POI 字面量（不交出 raw POI 常量对象）", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("visible_poi_type_changed", { visiblePOIType: "hotel" });
    await settle();

    expect(names()).toContain("visiblePoiTypeChanged");
    // 载荷是**字面量本身**，不是官方那个 `{visiblePOIType}` 包装对象：
    // 官方字段的类型是 raw POI 常量，本库投影成 `PanoramaPoiType` 字符串联合。
    const payload = seen.find((entry) => entry.name === "visiblePoiTypeChanged")!.payload;
    expect(payload).toBe("hotel");

    wrapper.unmount();
    await settle();
  });

  it("上游给了联合之外的取值 → null（不塞一个让类型说谎的字符串）", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("visible_poi_type_changed", { visiblePOIType: "不存在的类型" });
    await settle();

    expect(seen.find((entry) => entry.name === "visiblePoiTypeChanged")!.payload).toBeNull();

    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------------------ 刻意不暴露：destroy */

describe("Panorama 刻意不暴露的 destroy（官方有声明）", () => {
  it("不订阅 destroy：释放顺序（先解绑后销毁）是已定的安全属性", async () => {
    const { wrapper, seen, names } = await mountPanorama();
    const viewer = lastViewer();

    // 替身**不**派发 destroy（真实 SDK 会，但本库在解绑之后才调 destroy，因此收不到）。
    // 这里断言的是「即便上游派发了，本库也没有对外这条事件」。
    viewer.emit("destroy", { type: "destroy" });
    await settle();
    expect(names()).not.toContain("destroy");

    // 卸载时也**不得**有任何 destroy 类事件打到业务回调上——那正是要避免的形状
    wrapper.unmount();
    await settle();
    expect(seen.some((entry) => entry.name === "destroy")).toBe(false);
  });
});

/* ---------------------------------------------------------- 刻意不暴露的事件 */

describe("Panorama 刻意不暴露的事件", () => {
  it("touchmove：官方 PanoramaEventMap 里**没有**这个事件 ⇒ 不声明", async () => {
    const { wrapper, seen } = await mountPanorama();
    const viewer = lastViewer();

    // 即便运行时派发了这个名字，本库也没有对应订阅 ⇒ 不会有任何对外事件
    viewer.emit("touchmove", {});
    await settle();

    expect(seen.some((entry) => entry.name === "touchmove")).toBe(false);
    wrapper.unmount();
    await settle();
  });
});

/* ------------------------------------------------- 命名规范与 8 条既有事件不回归 */

describe("Panorama 事件命名与既有事件不回归", () => {
  it("本组件内部命名一致：对外名不得含下划线（camelCase）", async () => {
    // 钉住「同一个组件内只有一套命名」这条不变量——**不**钉 kebab-case：
    // 本组件已发布的 8 条是 camelCase，改名是破坏性变更，见文件头的偏差说明。
    const { wrapper, names } = await mountPanorama();
    const viewer = lastViewer();

    viewer.emit("link_click", { id: "x" });
    viewer.emit("pov_changed_end", {});
    await settle();

    expect(names()).toEqual(["linkClick", "povChangedEnd"]);
    for (const name of names()) {
      expect(name, `${name} 不得含下划线（本组件对外名是 camelCase）`).not.toMatch(/_/);
    }
    wrapper.unmount();
    await settle();
  });

  it("既有 8 条事件仍全部派发（本次新增不得挤掉旧的）", async () => {
    // 这一组**只**订阅既有事件（`load` / `error` 的 Vue 名与 SDK 名不同，单独挂），
    // 这样「新增的 13 条把旧的挤掉了」会表现为「旧的一条都没收到」而不是「顺序变了」。
    const seen: Array<{ name: string; payload: unknown }> = [];
    const listeners = {
      ...onProps(PRE_EXISTING_EVENTS, seen),
      onLoad: (payload: unknown) => seen.push({ name: "load", payload }),
      onError: (payload: unknown) => seen.push({ name: "error", payload }),
    };
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(Panorama, { point: POINT, ...listeners }),
          ]),
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();
    const viewer = lastViewer();

    viewer.position = POINT;
    viewer.emit("position_changed", {});
    viewer.emit("pov_changed", {});
    viewer.emit("zoom_changed", {});
    viewer.emit("id_changed", {});
    viewer.emit("scene_type_changed", {});
    viewer.emit("links_changed", {});
    viewer.emit("dataload", { data: {} });
    viewer.emit("pano_error", { data: {} });
    await settle();

    expect(seen.map((entry) => entry.name)).toEqual([
      "positionChange",
      "povChange",
      "zoomChange",
      "idChange",
      "sceneTypeChange",
      "linksChange",
      "load",
      "error",
    ]);
    wrapper.unmount();
    await settle();
  });

  it("卸载后监听全部归零（新增的 13 条不得留下在飞的监听）", async () => {
    const { wrapper } = await mountPanorama();
    const viewer = lastViewer();
    // 8 条既有 + 13 条 #168 新增 + 1 条 `links_visible_changed`（#165 TASK 7）
    // + 0（destroy 刻意不订阅）= 22
    //
    // ⚠️ **订阅条数不因别名而变**：#165 TASK 6 的别名是「同一个 SDK 订阅发两个名字」，
    // 不是加一条订阅。因此这里仍是 22 而不是 44——双发发生在 emit 侧。
    expect(viewer.getListenerCount(), "挂载后 22 条订阅都在").toBe(22);

    wrapper.unmount();
    await settle();
    expect(viewer.getListenerCount(), "卸载后不得残留监听").toBe(0);
    harness.assertIdle("Panorama 新增事件");
  });
});
