/**
 * `<Map>` 不得为**调用方没传**的布尔 prop 发告警（回归）
 *
 * ## 这个用例在防什么
 *
 * Vue 对 `Boolean` 类型的 prop 有「缺失即 `false`」的强制转换：调用方**没传**
 * `enableTraffic` / `restrictCenter`，`props` 上拿到的却是 `false` 而不是 `undefined`。
 *
 * 于是两处 `!== undefined` 守卫失效：
 * - `syncEnableProps` 对**每张地图**都调一次 `setTraffic`，而 4.0 的路况已经是
 *   `TrafficLayer`，Driver 会「显式告警一次，本次调用被忽略」；
 * - `mapOptions` 无条件带上 `restrictCenter: false`，Driver 判定它在 4.0 无对应构造项，
 *   丢弃并告警。
 *
 * 结果：**50 个有示例的页面，每一页的控制台都刷这两条**。它们与「用户是否配置错了」
 * 无关——用户什么都没配。
 *
 * ## 为什么这类 bug 需要回归钉住
 *
 * 它不抛错、不影响渲染、测试全绿，只在浏览器控制台出现；而控制台没人看。
 * 一条「不相关时不要告警」的断言能把它挡住——这正是本用例的判据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import { createLoadedJsapiV4 } from "../../packages/bmap-vue/src/core/loader/providers";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";

let fake: FakeBMapV4;

function provider() {
  return {
    load: async () =>
      createLoadedJsapiV4({
        providerId: "custom-script-v4",
        mode: "load",
        version: fake.namespace.VERSION,
        versionSource: "global",
        options: { ak: "fake-ak" },
        fingerprint: "map-props-no-spurious-warn",
        namespace: fake.namespace,
        loadedAt: 0,
      }),
  };
}

function container(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 挂一张 `<Map>`，props 原样透传（用于「传了 / 没传」的对照）。 */
async function mountMap(props: Record<string, unknown>) {
  const Root = defineComponent({
    setup: () => () => h(Map, { provider: provider(), ...props }),
  });
  const wrapper = mount(Root, { attachTo: container() });
  await flushPromises();
  await nextTick();
  return wrapper;
}

/** 只取本库自己发的告警（`[bmap-vue]` 前缀），排除 Fake 与第三方噪声。 */
function libraryWarnings(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith("[bmap-vue]"));
}

beforeEach(() => {
  fake = createFakeBMapV4();
  fake.diagnostics.reset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<Map> 不会为未传的 prop 发告警", () => {
  it("什么都不传时没有 [bmap-vue] 告警", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountMap({});
    expect(libraryWarnings(warn), `不该有任何告警，却有：\n${libraryWarnings(warn).join("\n")}`).toEqual(
      [],
    );
    wrapper.unmount();
    await flushPromises();
  });

  it("未传 enableTraffic 时不调用 setTraffic（否则 4.0 上路况永远被忽略）", async () => {
    // 用「告警条数」当观测点而不是诊断读数：`setTraffic` 的契约就是
    // 「显式告警一次并忽略」，所以它被调用过 = 有一条告警。没有告警即证明没调用。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountMap({});
    expect(libraryWarnings(warn).filter((m) => m.includes("setTraffic"))).toEqual([]);
    wrapper.unmount();
    await flushPromises();
  });

  it("**显式**传 enableTraffic 时才走 setTraffic（正向：守卫没有把功能一并关掉）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountMap({ enableTraffic: true });
    // 显式传 true 时 Driver 会按契约告警「本次调用被忽略」——这才是应有的行为。
    expect(libraryWarnings(warn).some((m) => m.includes("setTraffic"))).toBe(true);
    wrapper.unmount();
    await flushPromises();
  });

  it("显式传 :enable-traffic=\"false\" 也算传了（区分「传 false」与「没传」）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountMap({ enableTraffic: false });
    // 传了 false 也是「用户配置过」，Driver 会照契约结算一次。
    expect(libraryWarnings(warn).some((m) => m.includes("setTraffic"))).toBe(true);
    wrapper.unmount();
    await flushPromises();
  });

  it("未传 restrictCenter / backgroundColor 时不报「无对应构造项」", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountMap({});
    const dropped = libraryWarnings(warn).filter((m) => m.includes("无对应构造项"));
    expect(dropped, `不该报「已丢弃」：\n${dropped.join("\n")}`).toEqual([]);
    wrapper.unmount();
    await flushPromises();
  });
});
