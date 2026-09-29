/**
 * 命令面（第二批）的行为门禁（issue #165 Class 3 / TASK 2c / 2d / 2e / 2f / 2h）
 *
 * 与 `overlay-expose.test.ts`（第一批：Marker / 图形族）同一套判据：
 * **可观察效果**（SDK 入口真的被调用）+ **释放后显式失败**（不静默 no-op）+
 * **不交出 raw SDK 对象**。逐条 d.ts 出处写在每个 describe 的文件头注释里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import ContextMenu from "../../packages/bmap-vue/src/components/overlays/ContextMenu.vue";
import InfoWindow from "../../packages/bmap-vue/src/components/overlays/InfoWindow.vue";
import ScaleControl from "../../packages/bmap-vue/src/components/controls/ScaleControl.vue";
import { BMapError } from "../../packages/bmap-vue/src/core/errors/BMapError";
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

type Exposed = Record<string, (...args: never[]) => unknown>;

/** 挂 `<Map><Child/></Map>` 并把 `<Child>` 的 expose 取出来。 */
async function mountExposed(
  component: unknown,
  props: Record<string, unknown> = {},
  extra?: () => unknown,
) {
  const exposed = ref<Exposed | null>(null);
  const Host = defineComponent({
    setup() {
      return () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          ...(extra ? [extra() as never] : []),
          h(component as never, { ...props, ref: (v: unknown) => (exposed.value = v as Exposed) }),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper, vm: exposed.value! };
}

function lastCreatedMenu(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const menus = (map?.contextMenus ?? []) as AnyRecord[];
  const raw = menus[menus.length - 1];
  if (!raw) throw new Error("地图上没有右键菜单");
  return raw;
}

function lastCreatedControl(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const controls = (map?.controls ?? []) as AnyRecord[];
  const raw = controls[controls.length - 1];
  if (!raw) throw new Error("地图上没有控件");
  return raw;
}

/* --------------------------------------------------------------------- InfoWindow */

describe("<InfoWindow> 命令面（官方 overlay/InfoWindow.d.ts）", () => {
  const props = { position: { lng: 116.4, lat: 39.9 }, title: "天安门", open: true };

  it("getTitle / getContent / isOpen / getOffset：读回到 SDK 当前值", async () => {
    const { wrapper, vm } = await mountExposed(InfoWindow, props);
    const raw = (fake.createdOverlays as AnyRecord[])[0];

    expect(vm.getTitle!() as never).toBe("天安门");
    // `getContent()` 返回的是 host 元素（本库的内容是 Vue slot，官方看到的就是那个 host）
    expect(vm.getContent!() as never).toBe(raw.content);
    expect(vm.isOpen!() as never).toBe(true);
    // raw `BMap.Size` 是 `{width, height}`；领域 Pixel 是 `{x, y}`
    const offset = vm.getOffset!() as unknown as AnyRecord;
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.width, "不得把 raw BMap.Size 直接交出去").toBeUndefined();

    wrapper.unmount();
    await settle();
    harness.assertIdle("InfoWindow 命令面");
  });

  it("maximize / restore：动作落到 SDK（enableMaximize 只「允许」，不触发）", async () => {
    const { wrapper, vm } = await mountExposed(InfoWindow, { ...props, enableMaximize: true });
    const raw = (fake.createdOverlays as AnyRecord[])[0];
    raw.callLog.length = 0;

    vm.maximize!();
    expect(raw.callLog).toContain("maximize");
    expect(raw.maximized).toBe(true);

    vm.restore!();
    expect(raw.callLog).toContain("restore");
    expect(raw.maximized).toBe(false);

    wrapper.unmount();
    await settle();
  });

  it("释放后 → BMAP_RESOURCE_DISPOSED（不是 undefined / 不是静默 no-op）", async () => {
    const { wrapper, vm } = await mountExposed(InfoWindow, props);
    wrapper.unmount();
    await settle();

    for (const command of ["getTitle", "isOpen", "getOffset"] as const) {
      let thrown: unknown = null;
      try {
        vm[command]!() as never;
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${command} 释放后必须显式失败`).toBeInstanceOf(BMapError);
      expect((thrown as BMapError).code).toBe("BMAP_RESOURCE_DISPOSED");
    }
  });
});

/* -------------------------------------------------------------------- ContextMenu */

describe("<ContextMenu> 命令面（官方 context-menu/ContextMenu.d.ts）", () => {
  const items = [
    { text: "标记此处" },
    "-",
    { text: "删除", disabled: true },
  ];

  it("getItem(index)：返回**本库条目模型**，不是 raw MenuItem", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });

    const first = vm.getItem!(0 as never) as unknown as AnyRecord;
    expect(first.text).toBe("标记此处");
    expect(first.disabled).toBe(false);
    expect(first.index).toBe(0);
    // raw SDK 对象绝不能出现在调用方手里（AGENTS.md 的边界规则）
    expect(first.constructor?.name, "不得交出 raw BMap.MenuItem").not.toBe("FakeV4MenuItem");
    expect(typeof first.callback).toBe("undefined");

    // 分隔线没有「菜单项」可言
    expect(vm.getItem!(1 as never) as never).toBeNull();
    // 越界返回 null（官方 getItem 在越界时也没有可返回的对象）
    expect(vm.getItem!(99 as never) as never).toBeNull();

    wrapper.unmount();
    await settle();
    harness.assertIdle("ContextMenu getItem");
  });

  it("removeItem / removeSeparator：按序号落到 SDK，并同步菜单结构", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });
    const raw = lastCreatedMenu();
    raw.callLog.length = 0;

    expect(vm.removeItem!(0 as never) as never).toBe(true);
    expect(raw.callLog).toContain("removeItem");
    expect(raw.items).toHaveLength(2);

    expect(vm.removeSeparator!(0 as never) as never).toBe(true);
    expect(raw.callLog).toContain("removeSeparator");
    expect(raw.items).toHaveLength(1);

    // 不成立时返回 false（是「有没有这条」的查询，不是「资源已释放」）
    expect(vm.removeItem!(99 as never) as never).toBe(false);
    expect(vm.removeSeparator!(0 as never) as never).toBe(false);

    wrapper.unmount();
    await settle();
    harness.assertIdle("ContextMenu removeItem");
  });

  it("getDom / show / hide：落到 SDK（弹层语义，不是 visible）", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });
    const raw = lastCreatedMenu();
    raw.callLog.length = 0;

    expect(vm.getDom!() as never).toBe(raw.getDom());
    vm.show!();
    expect(raw.callLog).toContain("show");
    vm.hide!();
    expect(raw.callLog).toContain("hide");

    wrapper.unmount();
    await settle();
  });

  it("setItemText：官方 MenuItem#setText 落到 SDK，且本库读回模型同步", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });
    const raw = lastCreatedMenu();

    vm.setItemText!(0 as never, "改过的文字" as never);
    expect(raw.items[0].text).toBe("改过的文字");
    // 读回必须与 SDK 一致（否则「改了但 getItem 读到旧值」是一处必然分叉）
    expect((vm.getItem!(0 as never) as unknown as AnyRecord).text).toBe("改过的文字");

    wrapper.unmount();
    await settle();
  });

  it("setItemEnabled(false→true)：官方 MenuItem#enable 此前永久不可达", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });
    const raw = lastCreatedMenu();
    const created = fake.createdOverlays.length;

    expect(raw.items[2].disabled).toBe(true);
    raw.callLog.length = 0;

    vm.setItemEnabled!(2 as never, true as never);
    // 关键：enable() 真的落到了 SDK 的 MenuItem 上
    expect(raw.items[2].disabled).toBe(false);
    expect(raw.items[2].enable).toBeDefined();
    // 而且**不**重建菜单（此前只有重建这一条路）
    expect(fake.createdOverlays.length).toBe(created);

    wrapper.unmount();
    await settle();
    harness.assertIdle("ContextMenu setItemEnabled");
  });

  it("释放后 → BMAP_RESOURCE_DISPOSED", async () => {
    const { wrapper, vm } = await mountExposed(ContextMenu, { items });
    wrapper.unmount();
    await settle();

    for (const command of ["getDom", "show", "hide"] as const) {
      let thrown: unknown = null;
      try {
        vm[command]!() as never;
      } catch (error) {
        thrown = error;
      }
      expect((thrown as BMapError)?.code, `${command} 释放后必须显式失败`).toBe(
        "BMAP_RESOURCE_DISPOSED",
      );
    }
  });
});

/* ------------------------------------------------------------------ ScaleControl */

describe("<ScaleControl>.unit（官方 control/ScaleControl.d.ts: setUnit(unit: LengthUnit): void）", () => {
  it("unit 变化 → 就地 setUnit，不重建控件（Driver 早就登记成 mutable）", async () => {
    const state = ref<Record<string, unknown>>({ unit: "metric" });
    const Host = defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(ScaleControl, state.value as never),
        ]),
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = lastCreatedControl();
    const created = fake.createdControls.length;
    raw.callLog.length = 0;

    state.value = { unit: "us" };
    await settle();

    expect(raw.callLog, "unit 必须经 setUnit 就地更新").toContain("setUnit");
    expect(raw.unit).toBe("us");
    expect(fake.createdControls.length, "unit 变化不得重建控件").toBe(created);

    wrapper.unmount();
    await settle();
    harness.assertIdle("ScaleControl.unit");
  });
});

/* ------------------------------------------------- InfoWindow 的 8 个缺失构造选项 */

describe("<InfoWindow> 补齐的 8 个官方构造选项（TASK 3）", () => {
  it("maxWidth / maxContent 是 props（Driver 早已登记成 mutable），变化走就地 setter", async () => {
    const state = ref<Record<string, unknown>>({
      position: { lng: 116.4, lat: 39.9 },
      maxWidth: 300,
    });
    const Host = defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [h(InfoWindow, state.value as never)]),
    });
    const wrapper = mount(Host, { attachTo: harness.container() });
    await settle();
    await settle();

    const raw = (fake.createdOverlays as AnyRecord[])[0];
    expect(raw.options.maxWidth).toBe(300);
    const created = fake.createdOverlays.length;
    raw.callLog.length = 0;

    state.value = { ...state.value, maxWidth: 420, maxContent: "全部内容" };
    await settle();

    // 就地 setter，**不重建**（maxWidth / maxContent 在描述符里是 `mutable`）
    expect(fake.createdOverlays.length).toBe(created);
    expect(raw.callLog).toContain("setMaxWidth");
    expect(raw.callLog).toContain("setMaxContent");

    wrapper.unmount();
    await settle();
  });

  it("margin / collisions / onClosing / enableSearchTool / headerContent / enableContentScroll 进 ctor options", async () => {
    const { wrapper } = await mountExposed(InfoWindow, {
      position: { lng: 116.4, lat: 39.9 },
      margin: [10, 10, 10, 10],
      collisions: [5, 5, 5, 5],
      onClosing: () => {},
      enableSearchTool: true,
      headerContent: "<b>标题</b>",
      enableContentScroll: true,
    });
    const raw = (fake.createdOverlays as AnyRecord[])[0];
    expect(raw.options).toMatchObject({
      margin: [10, 10, 10, 10],
      collisions: [5, 5, 5, 5],
      enableSearchTool: true,
      headerContent: "<b>标题</b>",
      enableContentScroll: true,
    });
    expect(typeof raw.options.onClosing).toBe("function");

    wrapper.unmount();
    await settle();
    harness.assertIdle("InfoWindow 构造选项");
  });
});
