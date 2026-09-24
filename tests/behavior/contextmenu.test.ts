/**
 * ContextMenu / MenuItem / MenuSeparator（M5-CUSTOM-MENU / issue #33）
 *
 * 本文件同时是**行为契约**与**声明面门禁**：issue 的「测试要求」逐条落在这里
 * （数据/声明式一致、target 切换、动态 items/disabled/separator/select payload、SSR），外加两组
 * 交叉核对（props ↔ 声明表 ↔ Driver 描述符、emits ↔ 事件矩阵）。
 *
 * ## 与 #33 之前的口径差异（**行为变更**，不是修 bug 之外的副作用）
 *
 * 上一版（一份已随 webgl-v1 删除的 ContextMenu 套件）把「v4 拒绝把菜单挂到父 Marker」写成了期望行为，理由是
 * 「4.0 的 ContextMenu 一律经 `map.addContextMenu` 挂在 Map 上，没有 Marker 级入口」。
 * 真实 AK 实测**推翻**了这条假设：`Marker#addContextMenu` / `#removeContextMenu` 在 4.0 运行时
 * 存在且可用（类型包只在 `Map` 上声明它们）。因此本版把「挂到父标注」恢复成**真的能挂**，
 * 读数与依据见 ADR `2026-09-19-custom-overlay-and-context-menu`。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import Polyline from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import ContextMenu from "../../packages/bmap-vue/src/components/overlays/ContextMenu.vue";
import MenuItem from "../../packages/bmap-vue/src/components/overlays/MenuItem.vue";
import MenuSeparator from "../../packages/bmap-vue/src/components/overlays/MenuSeparator.vue";
import { useMapContext } from "../../packages/bmap-vue/src/composables/useMap";
import { overlayEventsOf } from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";
import { CONTEXT_MENU_FIELDS } from "../../packages/bmap-vue/src/core/overlays/ContextMenuSpec";
import { overlayPropertySpec } from "../../packages/bmap-vue/src/driver/types/overlays";
import type { ContextMenuSelectPayload } from "../../packages/bmap-vue/src/types/components";
import { createFakeV4Harness, FakeV4ContextMenu } from "../../packages/test-utils";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const TYPES_FILE = resolve(REPO_ROOT, "packages/bmap-vue/src/types/components.ts");

/**
 * 从 `types/components.ts` 解析某个 props 接口的键（与 `overlay-suite.test.ts` 同一手法）。
 *
 * 为什么必须解析而不是写字面量：写死就成了「字面量自比」——新增一个 prop 时断言不会红，
 * 门禁变成装饰。
 */
function readPropsKeys(interfaceName: string): string[] {
  const source = readFileSync(TYPES_FILE, "utf8");
  const match = new RegExp(`export interface ${interfaceName}([^{]*)\\{(?:[\\s\\S]*?)\\n\\}`).exec(
    source,
  );
  if (!match) throw new Error(`types/components.ts 里找不到 ${interfaceName}`);
  return [...match[0].matchAll(/^\s{2}(\w+)\??:/gm)].map((entry) => entry[1]!);
}

/**
 * 一个**不提供 `TargetContext`** 的宿主组件：模拟 `MapMask` / `Marker3D` 这类没有实现目标契约的
 * 覆盖物（合并 #105 之后 `overlayContextKey` 已被 #104 审计整条删除，因此没有 key 可以模拟）。
 *
 * 用途：证明「没有可依据的目标时**不猜**」——菜单落到 `Map` 自己的地图 target 上。
 */
const PlainHost = defineComponent({
  name: "PlainHost",
  setup(_props, { slots }) {
    return () => slots.default?.() ?? null;
  },
});

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();

/** 本用例期间创建的 ContextMenu 实例（`reset()` 不清 `created*` 账本，因此要与基线相减）。 */
function createdMenus(): FakeV4ContextMenu[] {
  return fake.createdOverlays.filter((o): o is FakeV4ContextMenu => o instanceof FakeV4ContextMenu);
}

function lastMenu(): FakeV4ContextMenu {
  const menus = createdMenus();
  const menu = menus[menus.length - 1];
  if (!menu) throw new Error("还没有创建任何 ContextMenu 实例");
  return menu;
}

/** 菜单项的领域读数：文本 + 分隔线（`-`）。 */
function itemTexts(menu: FakeV4ContextMenu): string[] {
  return menu.items.map((item) => (typeof item === "string" ? "-" : item.text));
}

/** 收集 `<Map>` 上下文里的 `resource:error`（组件侧的显式失败通道）。 */
const resourceErrors: Array<{ code?: string; message?: string }> = [];
const ErrorProbe = defineComponent({
  setup() {
    const ctx = useMapContext();
    ctx.events.on("resource:error", (payload: { error?: { code?: string; message?: string } }) => {
      resourceErrors.push({ code: payload?.error?.code, message: payload?.error?.message });
    });
    return () => null;
  },
});

async function mountTree(children: () => unknown, host: HTMLElement) {
  const wrapper = mount(
    defineComponent({
      components: { Map },
      setup: () => () => h(Map, { provider: provider() }, { default: () => [h(ErrorProbe), children()] }),
    }),
    { attachTo: host },
  );
  await flushPromises();
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe("ContextMenu", () => {
  beforeEach(() => {
    harness.reset();
    resourceErrors.length = 0;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------ 数据 API */

  it("数据 API：菜单挂到地图上，分隔线与 disabled 都落地", async () => {
    const el = harness.container();
    const items = [
      { text: "放大", callback: () => {} },
      "-",
      { text: "删除", callback: () => {}, disabled: true },
    ];
    const wrapper = await mountTree(
      () => h(ContextMenu, { items, width: 160 }),
      el,
    );

    expect(harness.attached("context-menu")).toBe(1);
    const menu = lastMenu();
    expect(itemTexts(menu)).toEqual(["放大", "-", "删除"]);
    expect(menu.items[2]).toMatchObject({ disabled: true });
    expect((menu.items[0] as { options: { width?: number } }).options).toMatchObject({ width: 160 });

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 数据 API");
  });

  /* -------------------------------------------------- 数据 / 声明式一致性 */

  it("声明式 API 与数据 API 产出**完全相同**的菜单", async () => {
    const el = harness.container();
    const items = [
      { text: "放大", callback: () => {} },
      "-",
      { text: "删除", callback: () => {}, disabled: true },
    ];
    const wrapper = await mountTree(
      () => [
        h(ContextMenu, { items, width: 160 }),
        h(ContextMenu, { width: 160 }, () => [
          h(MenuItem, { text: "放大" }),
          h(MenuSeparator),
          h(MenuItem, { text: "删除", disabled: true }),
        ]),
      ],
      el,
    );

    const menus = createdMenus();
    const fromData = menus[menus.length - 2]!;
    const fromChildren = menus[menus.length - 1]!;
    expect(itemTexts(fromChildren)).toEqual(itemTexts(fromData));
    expect((fromChildren.items[2] as { disabled: boolean }).disabled).toBe(true);
    expect((fromChildren.items[0] as { options: { width?: number } }).options).toMatchObject({
      width: 160,
    });

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 两写法");
  });

  it("声明式：动态显隐的项回到模板里的位置（按渲染顺序，不是注册顺序）", async () => {
    const el = harness.container();
    const show = ref(false);
    const wrapper = await mountTree(
      () =>
        h(ContextMenu, null, () => [
          h(MenuItem, { text: "a" }),
          show.value ? h(MenuItem, { text: "b" }) : null,
          h(MenuItem, { text: "c" }),
        ]),
      el,
    );
    expect(itemTexts(lastMenu())).toEqual(["a", "c"]);

    show.value = true;
    await nextTick();
    await flushPromises();
    await nextTick();
    // 关键：新挂上的项在 a 与 c **之间**（按注册顺序会跑到末尾）
    expect(itemTexts(lastMenu())).toEqual(["a", "b", "c"]);

    show.value = false;
    await nextTick();
    await flushPromises();
    await nextTick();
    expect(itemTexts(lastMenu())).toEqual(["a", "c"]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 动态项");
  });

  /* ------------------------------------------------------------- target */

  it("写在 <Marker> 里：菜单挂到该标注上（而不是地图上）", async () => {
    const el = harness.container();
    const wrapper = await mountTree(
      () =>
        h(Marker, { position: { lng: 116.4, lat: 39.9 } }, () =>
          h(ContextMenu, { items: [{ text: "标记此处", callback: () => {} }] }),
        ),
      el,
    );

    expect(harness.attached("context-menu")).toBe(0);
    expect(harness.menusOnOverlay(-1)).toBe(1);

    wrapper.unmount();
    await nextTick();
    // 卸载后从标注上摘掉（否则 SDK 侧会留着指向已释放实例的菜单）
    expect(harness.menusOnOverlay(-1)).toBe(0);
    harness.assertIdle("ContextMenu marker 目标");
  });

  it("target 切换：标注卸载再挂载后，菜单只挂在新实例上、任何时刻都不重复", async () => {
    const el = harness.container();
    const showMarker = ref(true);
    const wrapper = await mountTree(
      () =>
        showMarker.value
          ? h(Marker, { position: { lng: 116.4, lat: 39.9 } }, () =>
              h(ContextMenu, { items: [{ text: "x", callback: () => {} }] }),
            )
          : null,
      el,
    );
    expect(harness.menusOnOverlay(-1)).toBe(1);

    showMarker.value = false;
    await nextTick();
    await flushPromises();
    await nextTick();
    expect(harness.menusOnOverlay(-1)).toBe(0);
    expect(harness.attached("context-menu")).toBe(0);

    showMarker.value = true;
    await nextTick();
    await flushPromises();
    await nextTick();
    // 新实例上恰好一个；且从未回退挂到地图上
    expect(harness.menusOnOverlay(-1)).toBe(1);
    expect(harness.attached("context-menu")).toBe(0);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu target 切换");
  });

  it("target 不支持（旧层/普通覆盖物）时显式失败，且**不回退**挂到地图上", async () => {
    const el = harness.container();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountTree(
      () =>
        h(
          Polyline,
          { path: [{ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 40 }] },
          () => h(ContextMenu, { items: [{ text: "x", callback: () => {} }] }),
        ),
      el,
    );

    expect(harness.attached("context-menu")).toBe(0);
    const codes = resourceErrors.map((entry) => entry.code);
    expect(codes).toContain("BMAP_CAPABILITY_UNSUPPORTED");
    expect(resourceErrors.some((entry) => entry.message?.includes("polyline") || entry.message?.includes("overlay"))).toBe(true);
    expect(warn).toHaveBeenCalled();

    wrapper.unmount();
    await nextTick();
  });

  it("visible=false 时不挂载；恢复后挂上", async () => {
    const el = harness.container();
    const visible = ref(false);
    const wrapper = await mountTree(
      () => h(ContextMenu, { items: [{ text: "x", callback: () => {} }], visible: visible.value }),
      el,
    );
    expect(harness.attached("context-menu")).toBe(0);

    visible.value = true;
    await nextTick();
    await flushPromises();
    expect(harness.attached("context-menu")).toBe(1);

    visible.value = false;
    await nextTick();
    await flushPromises();
    expect(harness.attached("context-menu")).toBe(0);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu visible");
  });

  /* ------------------------------------- 复审（PR #107 第一轮）4 条阻塞项的回归 */

  it("[复审 1] 临时摘挂不屏蔽事件：visible true→false→true 之后 open/close 仍能转发", async () => {
    const el = harness.container();
    const seen: string[] = [];
    const visible = ref(true);
    const wrapper = await mountTree(
      () =>
        h(ContextMenu, {
          items: [{ text: "x", callback: () => {} }],
          visible: visible.value,
          onOpen: () => seen.push("open"),
          onClose: () => seen.push("close"),
        }),
      el,
    );
    lastMenu().emit("open");
    expect(seen).toEqual(["open"]);

    // 临时摘掉再挂回来：**同一个菜单实例**（`items` 没变，不重建）
    visible.value = false;
    await nextTick();
    await flushPromises();
    expect(harness.attached("context-menu")).toBe(0);
    visible.value = true;
    await nextTick();
    await flushPromises();
    expect(harness.attached("context-menu")).toBe(1);

    seen.length = 0;
    lastMenu().emit("open");
    lastMenu().emit("close");
    expect(seen, "重新挂载后事件必须照常转发（临时摘挂不得永久屏蔽）").toEqual(["open", "close"]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 临时摘挂");
  });

  it("[复审 1] target 迁移后同一菜单实例的事件仍能转发（marker 重建 ⇒ 换目标）", async () => {
    const el = harness.container();
    const seen: string[] = [];
    const enableClicking = ref(true);
    const wrapper = await mountTree(
      () =>
        h(Marker, { position: { lng: 116.4, lat: 39.9 }, enableClicking: enableClicking.value }, () =>
          h(ContextMenu, { items: [{ text: "x", callback: () => {} }], onOpen: () => seen.push("open") }),
        ),
      el,
    );
    const firstMenu = lastMenu();
    lastMenu().emit("open");
    expect(seen).toEqual(["open"]);

    // 标注重建（构造期属性变化）⇒ 菜单从旧标注摘到新标注；菜单本身**不重建**
    enableClicking.value = false;
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(lastMenu(), "前提：菜单实例跨 target 迁移保持不变").toBe(firstMenu);
    expect(harness.menusOnOverlay(-1), "菜单挂在新标注上").toBe(1);

    seen.length = 0;
    lastMenu().emit("open");
    expect(seen, "迁移到新目标后事件必须照常转发").toEqual(["open"]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu target 迁移事件");
  });

  /**
   * 反向守卫：**永久释放**路径上 SDK 在摘除窗口里派发的事件不得回放。
   *
   * 时序是**注入**的（真实 4.0 的 `removeContextMenu` 内部是否同步派发 `close` 未取证），
   * 用途是让「只有最终释放才立标记」这条判据有判别力 —— 去掉它这条用例必须变红。
   * 自检：注入次数也要断言，否则「spy 没被调用」会让这条用例恒真（假绿）。
   */
  it("[复审 1] 实例被 replace 释放时，摘除窗口里的 SDK 事件不回放", async () => {
    const el = harness.container();
    const seen: string[] = [];
    const items = ref([{ text: "x", callback: () => {} }]);
    const wrapper = await mountTree(
      () =>
        h(ContextMenu, { items: items.value, onClose: () => seen.push("close"), onOpen: () => seen.push("open") }),
      el,
    );
    const ready = await (wrapper.findComponent(Map).vm as unknown as {
      whenReady(): Promise<{ client: { driver: { overlays: Record<string, unknown> } } }>;
    }).whenReady();
    const overlays = ready.client.driver.overlays as {
      detachContextMenu(target: { kind: string; handle: unknown }, menu: unknown): void;
    };
    const detach = overlays.detachContextMenu.bind(overlays);
    let injections = 0;
    let listenersAtInjection = 0;
    vi.spyOn(overlays, "detachContextMenu").mockImplementation((target, menu) => {
      detach(target, menu);
      injections += 1;
      // 注入时序：SDK 在摘除窗口里同步派发（此时业务监听还没解绑）。
      // ⚠️ 必须对 **raw 实例**派发：传进来的是句柄，句柄上没有 `emit` —— 第一版写 `menu.emit?.()`
      // 是个恒 no-op，于是这条用例在「去掉标记」的实现下也绿（假绿，靠反证 M1b 才发现）。
      const raw = (menu as { raw?: { emit?: (type: string) => void; getListenerCount?: () => number } }).raw;
      listenersAtInjection = Math.max(listenersAtInjection, raw?.getListenerCount?.() ?? 0);
      raw?.emit?.("close");
    });

    items.value = [{ text: "y", callback: () => {} }];
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(injections, "自检：注入的摘除窗口必须真的发生过").toBeGreaterThan(0);
    expect(
      listenersAtInjection,
      "自检：注入那一刻监听必须还活着，否则「没有回放」是空断言",
    ).toBeGreaterThan(0);
    expect(seen, "释放窗口里的事件不该回放给调用方").toEqual([]);

    wrapper.unmount();
    await nextTick();
  });

  it("[复审 2] 只换 callback：不重建菜单，但必须调用新的那个", async () => {
    const el = harness.container();
    const called: string[] = [];
    const items = ref([{ text: "x", callback: () => called.push("cbA") }]);
    const wrapper = await mountTree(() => h(ContextMenu, { items: items.value }), el);
    const menusBase = createdMenus().length;

    items.value = [{ text: "x", callback: () => called.push("cbB") }];
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(createdMenus().length - menusBase, "callback 不进指纹 ⇒ 不重建").toBe(0);
    (lastMenu().items[0] as { callback: (p: unknown, x: unknown) => void }).callback(
      { lng: 116.4, lat: 39.9 },
      { x: 1, y: 2 },
    );
    expect(called, "必须调用最新的 callback").toEqual(["cbB"]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu callback-only");
  });

  it("[复审 3] id 一路下发到 SDK：数据 API 与声明式都落地", async () => {
    const el = harness.container();
    const wrapper = await mountTree(
      () => [
        h(ContextMenu, { items: [{ text: "数据项", callback: () => {}, id: "item-from-data" }] }),
        h(ContextMenu, null, () => [h(MenuItem, { text: "声明项", id: "item-from-children" })]),
      ],
      el,
    );

    const menus = createdMenus();
    const fromData = menus[menus.length - 2]!;
    const fromChildren = menus[menus.length - 1]!;
    expect((fromData.items[0] as { options: { id?: string } }).options).toMatchObject({
      id: "item-from-data",
    });
    expect((fromChildren.items[0] as { options: { id?: string } }).options).toMatchObject({
      id: "item-from-children",
    });

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu id");
  });

  it("[复审 4] width 默认 100（与文档一致），不传时菜单项也拿到 100", async () => {
    const el = harness.container();
    const wrapper = await mountTree(
      () => h(ContextMenu, { items: [{ text: "x", callback: () => {} }] }),
      el,
    );
    expect((lastMenu().items[0] as { options: { width?: number } }).options).toMatchObject({
      width: 100,
    });

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu width 默认值");
  });

  /* ------------------------------------------------------- 事件与载荷 */

  it("open / close 是 SDK 事件：原样转发，不产生任何受控状态", async () => {
    const el = harness.container();
    const seen: string[] = [];
    const wrapper = await mountTree(
      () =>
        h(ContextMenu, {
          items: [{ text: "x", callback: () => {} }],
          onOpen: () => seen.push("open"),
          onClose: () => seen.push("close"),
        }),
      el,
    );

    lastMenu().emit("open");
    lastMenu().emit("close");
    expect(seen).toEqual(["open", "close"]);

    // 事件之后**没有**任何回写：组件不因「收到 close」而改变挂载状态
    expect(harness.attached("context-menu")).toBe(1);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu open/close");
  });

  it("select 载荷：两种写法给出同形载荷（item / index / point / pixel / map / target）", async () => {
    const el = harness.container();
    const fromData: ContextMenuSelectPayload[] = [];
    const fromChildren: ContextMenuSelectPayload[] = [];
    const itemSelects: ContextMenuSelectPayload[] = [];
    const wrapper = await mountTree(
      () => [
        h(ContextMenu, {
          items: [{ text: "定位", callback: (payload: ContextMenuSelectPayload) => fromData.push(payload) }],
          onSelect: (payload: ContextMenuSelectPayload) => fromData.push(payload),
        }),
        h(ContextMenu, { onSelect: (payload: ContextMenuSelectPayload) => fromChildren.push(payload) }, () => [
          h(MenuItem, {
            text: "定位",
            onSelect: (payload: ContextMenuSelectPayload) => itemSelects.push(payload),
          }),
        ]),
      ],
      el,
    );

    const menus = createdMenus();
    const dataMenu = menus[menus.length - 2]!;
    const childMenu = menus[menus.length - 1]!;
    const point = { lng: 116.404, lat: 39.915 };
    const pixel = { x: 12, y: 34 };
    (dataMenu.items[0] as { callback: (p: unknown, x: unknown) => void }).callback(point, pixel);
    (childMenu.items[0] as { callback: (p: unknown, x: unknown) => void }).callback(point, pixel);

    // 数据 API：callback 与组件 select 各一次
    expect(fromData.map((entry) => entry.index)).toEqual([0, 0]);
    // 声明式：子组件 select 与组件 select 各一次
    expect(fromChildren).toHaveLength(1);
    expect(itemSelects).toHaveLength(1);

    const payload = fromChildren[0]!;
    expect(payload.item.text).toBe("定位");
    expect(payload.index).toBe(0);
    expect(payload.point).toEqual(point);
    expect(payload.pixel).toEqual(pixel);
    expect(payload.map).toBeTruthy();
    // 挂了目标才给目标句柄（两个菜单都挂在地图上）
    expect(payload.target).toBeTruthy();
    expect(itemSelects[0]).toEqual(payload);
    // 两种写法的载荷形状一致（除 map/target 的实例身份）
    expect(Object.keys(payload).sort()).toEqual(Object.keys(fromData[0]!).sort());

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu select");
  });

  /* ------------------------------------------------------------- 卸载 */

  it("items 变化时重建菜单，旧实例的监听与资源都归还（不累积）", async () => {
    const el = harness.container();
    const items = ref([{ text: "a", callback: () => {} }]);
    const wrapper = await mountTree(() => h(ContextMenu, { items: items.value }), el);
    const baseline = fake.diagnostics.snapshot().leaks.listeners;
    // `created*` 账本跨用例累积（`harness.reset()` 只重置诊断计数），因此扣基线再比
    const menusBase = createdMenus().length;
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      items.value = [{ text: `item-${i}`, callback: () => {} }];
      await nextTick();
      await flushPromises();
      await nextTick();
      expect(itemTexts(lastMenu())).toEqual([`item-${i}`]);
      // 每次变化恰好重建一次（旧实例交给 scope 释放）；`menusBase` 是挂载之后的基线
      expect(createdMenus().length - menusBase).toBe(i + 1);
    }
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(baseline);
    expect(harness.attached("context-menu")).toBe(1);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 重建");
  });

  /**
   * `width` 是 `MenuItemOptions.width`（**每项的构造期选项**，`ContextMenu` 实例上没有宽度 setter）
   * ⇒ 变化必须重建菜单。
   *
   * 这条用例的价值是挡住「收了参数但忽略」：第一版实现只声明了「`width` → 重建菜单」，
   * 却没挂 watcher，于是调用方改 `width` 什么都不发生（自审 Standards 轴抓到的硬违规）。
   */
  it("width 变化重建菜单，新的菜单项带上新宽度", async () => {
    const el = harness.container();
    const width = ref(120);
    const wrapper = await mountTree(
      () => h(ContextMenu, { items: [{ text: "a", callback: () => {} }], width: width.value }),
      el,
    );
    const menusBase = createdMenus().length;
    expect((lastMenu().items[0] as { options: { width?: number } }).options).toMatchObject({
      width: 120,
    });

    width.value = 200;
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(createdMenus().length - menusBase, "width 变化要重建菜单").toBe(1);
    expect((lastMenu().items[0] as { options: { width?: number } }).options).toMatchObject({
      width: 200,
    });
    expect(harness.attached("context-menu"), "重建后仍然只有一个").toBe(1);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu width");
  });

  /* ---------------------------------------------------------- SSR / 声明面 */

  it("SSR 渲染不炸，且不渲染任何菜单占位（宿主在服务端不存在）", async () => {
    const app = defineComponent({
      setup: () => () =>
        h(Map, { provider: provider() }, () => [
          h(ContextMenu, null, () => [h(MenuItem, { text: "a" }), h(MenuSeparator)]),
        ]),
    });
    const html = await renderToString(h(app) as never);
    expect(html).not.toContain("data-bmap-menu-key");
  });

  it("声明面：CONTEXT_MENU_FIELDS 覆盖 ContextMenuProps（从类型文件解析，不写字面量）", () => {
    // 键集**从 `types/components.ts` 解析**：写死字面量就成了「字面量自比」，
    // 新增 prop 不会红，这条门禁等于没有（自审 Standards 轴抓到的硬违规）。
    const propsKeys = readPropsKeys("ContextMenuProps").sort();
    expect(propsKeys.length, "ContextMenuProps 的成员解析结果为空").toBeGreaterThan(2);
    expect(Object.keys(CONTEXT_MENU_FIELDS).sort()).toEqual(propsKeys);
    // 重建类字段在描述符里必须是「没有字段级入口」（unsupported）——那正是「重建」的理由
    for (const key of ["items", "width"]) {
      expect(overlayPropertySpec("context-menu", key)?.policy, key).toBe("unsupported");
    }
  });

  it("emits ↔ 事件矩阵：open/close 来自矩阵，select 是显式登记的本库事件", () => {
    const sfc = ContextMenu as unknown as { emits?: string[] };
    // SDK 事件面 == 矩阵（双向）
    expect(overlayEventsOf("context-menu").map((event) => event.vue)).toEqual(["open", "close"]);
    // `select` 不是 SDK 事件：它是本库在 MenuItem 回调里派发的，因此不在这张矩阵里
    expect(overlayEventsOf("context-menu").map((event) => event.vue)).not.toContain("select");
    expect(sfc.emits ? sfc.emits.sort() : null).toEqual(["close", "open", "select"]);
  });

  it("不提供 TargetContext 的组件下的菜单等价于「挂在地图级」（没有可依据的目标就不猜）", async () => {
    const el = harness.container();
    const wrapper = await mountTree(
      () => h(PlainHost, {}, () => h(ContextMenu, { items: [{ text: "x", callback: () => {} }] })),
      el,
    );

    // `Map` 自己 provide 了地图 target，因此这类组件不会成为目标：菜单落到地图上
    // （与「直接写在 <Map> 下」同义）。合并 #105 之前这里靠 `overlayContextKey` 判「旧层覆盖物」
    // 并显式报错，而 #104 审计把那个 key 整条删了 —— 没有契约可依据时就不猜。
    expect(harness.attached("context-menu")).toBe(1);
    expect(resourceErrors).toEqual([]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("ContextMenu 无 TargetContext 宿主");
  });
});
