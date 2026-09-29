/**
 * 控件**命令面**的行为门禁（issue #168 item 1）
 *
 * #168 之前，控件组件的官方命令成员**一个都没有用户可见的调用路径**：
 * `grep defineExpose` 在 `components/controls/**` 上 0 命中。改 prop 只能表达「受控写入」，
 * 而 `GeolocationControl#location()` / `CityListControl#toggle()` / `getCityName()` 是
 * **动作**与**读回**——没有 prop 可表达，组件也永远不会替调用方读一次。
 *
 * 本文件与 `overlay-expose*.test.ts` 同一套判据：
 * 1. **可观察效果**：SDK 入口真的被调用（Fake 的 `callLog` + 状态读数）；
 * 2. **释放后显式失败**（`BMAP_RESOURCE_DISPOSED`），不是 `undefined`、不是静默 no-op；
 * 3. **不交出 raw SDK 对象**（`getTriggerDom` 的取舍见 describe 的注释）。
 *
 * ## 逐条 d.ts 出处
 *
 * | 暴露 | 官方声明（`@baidumap/jsapi-v4-types@4.0.4`） |
 * | --- | --- |
 * | `location()` | `control/GeolocationControl.d.ts` `location(): void` |
 * | `startLocation()` | 同上 `startLocation(): void` |
 * | `stopLocationTrace()` | 同上 `stopLocationTrace(): void` |
 * | `getAddressComponent()` | 同上 `getAddressComponent(): AddressComponent \| null` |
 * | `toggle()` | `control/CityListControl.d.ts` `toggle(): void` |
 * | `getCityName()` | 同上 `getCityName(): string` |
 *
 * ⚠️ **issue 点名的 `startLocationTrace()` 不存在**。官方只声明 `startLocation()`（开始定位）
 * 与 `stopLocationTrace()`（停止跟踪）——两者不对称，但这就是上游的形状。live AK 读数进一步
 * 确认：`startLocation` `callable: true` 而 `startLocationTrace` `callable: false`
 * （`scripts/probe-runtime-members.mts` probe 14，读数见
 * `docs/zh-CN/contributing/168-remaining-surface.md`）。因此暴露的是 `startLocation`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import LocationControl from "../../packages/bmap-vue/src/components/controls/LocationControl.vue";
import CityListControl from "../../packages/bmap-vue/src/components/controls/CityListControl.vue";
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
async function mountExposed(component: unknown, props: Record<string, unknown> = {}) {
  const exposed = ref<Exposed | null>(null);
  const Host = defineComponent({
    setup() {
      return () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(component as never, {
            ...props,
            ref: (v: unknown) => (exposed.value = v as Exposed),
          }),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper, vm: exposed.value! };
}

function lastControl(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const controls = (map?.controls ?? []) as AnyRecord[];
  const raw = controls[controls.length - 1];
  if (!raw) throw new Error("地图上没有控件");
  return raw;
}

/* ------------------------------------------------------------------ LocationControl */

describe("<LocationControl> 命令面（官方 control/GeolocationControl.d.ts）", () => {
  it("location / startLocation / stopLocationTrace：动作落到 SDK", async () => {
    const { wrapper, vm } = await mountExposed(LocationControl, {});
    const raw = lastControl();
    raw.callLog.length = 0;

    vm.location!();
    vm.startLocation!();
    vm.stopLocationTrace!();

    expect(raw.callLog).toEqual(["location", "startLocation", "stopLocationTrace"]);
    wrapper.unmount();
    await settle();
  });

  it("getAddressComponent：读回领域投影，五个成员全可选且不补默认值", async () => {
    const { wrapper, vm } = await mountExposed(LocationControl, {});
    const raw = lastControl();

    // 官方声明 `AddressComponent | null`：尚未定位就是 `null`，不是空对象
    raw.address = null;
    expect(vm.getAddressComponent!() as never).toBeNull();

    // 官方五个成员全是可选的：只给 `city` 时，其余**留在 undefined**（不补空串）
    raw.address = { city: "北京市", district: 123 };
    const address = vm.getAddressComponent!() as unknown as AnyRecord;
    expect(address).toEqual({ city: "北京市" });
    expect("district" in address, "非字符串成员不得被投影进来").toBe(false);
    expect(address.streetNumber, "上游没给的成员不得补默认值").toBeUndefined();

    wrapper.unmount();
    await settle();
  });

  it("释放后 → BMAP_RESOURCE_DISPOSED（不是 undefined / 不是静默 no-op）", async () => {
    const { wrapper, vm } = await mountExposed(LocationControl, {});
    wrapper.unmount();
    await settle();

    for (const command of ["location", "startLocation", "stopLocationTrace", "getAddressComponent"]) {
      expect(() => vm[command]!(), `${command} 在释放后必须显式失败`).toThrowError(BMapError);
    }
    // 错误码在 `code` 上（消息是中文诊断，断言消息文本会与措辞耦合）
    try {
      vm.location!();
      expect.unreachable("释放后的 location() 必须抛错");
    } catch (error) {
      expect((error as BMapError).code).toBe("BMAP_RESOURCE_DISPOSED");
    }
  });

  it("harness.assertIdle：命令面不留下在飞的监听", async () => {
    const { wrapper, vm } = await mountExposed(LocationControl, {});
    vm.location!();
    vm.startLocation!();
    wrapper.unmount();
    await settle();
    harness.assertIdle("LocationControl 命令面");
  });
});

/* ------------------------------------------------------------------ CityListControl */

describe("<CityListControl> 命令面（官方 control/CityListControl.d.ts）", () => {
  it("toggle：动作落到 SDK（与 open/close 同一条官方成员）", async () => {
    const { wrapper, vm } = await mountExposed(CityListControl, {});
    const raw = lastControl();
    raw.callLog.length = 0;

    vm.toggle!();
    expect(raw.callLog).toContain("toggle");
    expect(raw.expanded, "官方 toggle 是「切换展开态」").toBe(true);

    vm.toggle!();
    expect(raw.expanded).toBe(false);

    wrapper.unmount();
    await settle();
  });

  it("getCityName：读回到 SDK 当前值", async () => {
    const { wrapper, vm } = await mountExposed(CityListControl, {});
    const raw = lastControl();

    raw.cityName = "北京市";
    expect(vm.getCityName!() as never).toBe("北京市");

    wrapper.unmount();
    await settle();
  });

  /**
   * `getTriggerDom(): HTMLElement | undefined` —— **刻意不暴露**。
   *
   * 官方确实声明了它（`control/CityListControl.d.ts`），但返回值是**原生 DOM 元素**：
   * 交出去等于把 SDK 内部渲染结构（那个按钮的 class、子节点、事件绑定）变成公共契约——
   * 调用方一 `appendChild` / `addEventListener` 就会与 SDK 的事件系统打架，而本库既无法
   * 约束这种用法，也无法在控件重建时替它善后。AGENTS.md 的 raw SDK 边界只覆盖
   * `driver/**` / `client/**` / `core/loader/**` / `plugins/**`，控件组件是**禁区**。
   *
   * 「收窄成领域投影」在这里**不成立**：一个 `HTMLElement` 没有任何可投影的领域值——
   * 它的全部意义就是那个节点本身。要保留用法需求，官方已有 `./advanced` 的 `unwrapRaw()`
   * 逃生口（明确的 raw 面，不是组件面）。
   *
   * 因此断言的是「**它没有出现在命令面上**」——把 no-expose 变成会红的一条，
   * 而不是只在注释里说一句。
   */
  it("getTriggerDom：刻意不暴露（返回 raw HTMLElement，窄化投影不成立）", async () => {
    const { wrapper, vm } = await mountExposed(CityListControl, {});
    expect(vm.getTriggerDom, "不得把 raw HTMLElement 交出控件组件的命令面").toBeUndefined();
    wrapper.unmount();
    await settle();
  });

  it("释放后 → BMAP_RESOURCE_DISPOSED（不是 undefined / 不是静默 no-op）", async () => {
    const { wrapper, vm } = await mountExposed(CityListControl, {});
    wrapper.unmount();
    await settle();

    for (const command of ["toggle", "getCityName"]) {
      expect(() => vm[command]!(), `${command} 在释放后必须显式失败`).toThrowError(BMapError);
    }
  });

  it("harness.assertIdle：命令面不留下在飞的监听", async () => {
    const { wrapper, vm } = await mountExposed(CityListControl, {});
    vm.toggle!();
    wrapper.unmount();
    await settle();
    harness.assertIdle("CityListControl 命令面");
  });
});
