/**
 * BCustomOverlay：detached 宿主、slot 所有权与事件（M5-CUSTOM-MENU / issue #33）
 *
 * 字段级的 create / mutable / recreate / visible / 事件面**不在这里**：那五条由
 * `v3-overlay-suite.test.ts` 的表驱动用例统一覆盖（`BCustomOverlay` 已登记进 `CASES` /
 * `DECLARATIONS` / `EMITS_CASES`）。本文件只补这张表测不到的两件事：
 *
 * 1. **宿主所有权**：SDK 搬的是我们创建的宿主元素，slot 子树由 Vue 拥有；跨重建复用同一个宿主，
 *    卸载后宿主不残留在容器里（issue 的风险章点名的 Teleport host 残留）。
 * 2. **`setPoint` 的第二参数是真的**：移动不重建业务 DOM 工厂（真实 4.0 实测的语义）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import BMap from "../../packages/bmap-vue/src/components/map/BMap.vue";
import BCustomOverlay from "../../packages/bmap-vue/src/components/overlays/BCustomOverlay.vue";
import type { FakeBMapV4 } from "../../packages/test-utils";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness, fake } = createFakeV4Harness();

/** 被 SDK 搬运的那块宿主（开放的 DOM 契约）。 */
function overlayHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-bmap-custom-overlay]");
}

function currentOverlay(): Record<string, unknown> {
  const overlays = fake.createdOverlays as unknown as Array<Record<string, unknown>>;
  const raw = overlays[overlays.length - 1];
  if (!raw) throw new Error("还没有创建 CustomOverlay 实例");
  return raw;
}

async function mountOverlay(props: Record<string, unknown>, slot?: () => unknown) {
  const state = ref(props);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(BMap, { provider: harness.provider() }, () =>
          h(BCustomOverlay as never, state.value as never, slot ? { default: slot } : undefined),
        ),
    }),
    { attachTo: harness.container() },
  );
  await flushPromises();
  await flushPromises();
  await nextTick();
  return { wrapper, state };
}

describe("BCustomOverlay 的宿主与 slot", () => {
  beforeEach(() => harness.reset());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("slot 渲染进 detached 宿主，宿主由 SDK 搬走（不落在地图容器顶层）", async () => {
    const { wrapper } = await mountOverlay({ position: { lng: 116.404, lat: 39.915 } }, () =>
      h("div", { class: "card" }, "自定义内容"),
    );

    const host = overlayHost();
    expect(host, "找不到宿主元素（data-bmap-custom-overlay）").toBeTruthy();
    expect(host!.textContent).toContain("自定义内容");
    // 宿主由 SDK 接管：它不该还停在地图容器的顶层（那是本库创建它时的位置）
    expect(host!.parentElement).not.toBe(harness.container());
    // 但它在文档里（被 SDK 搬进了自己的容器）
    expect(host!.isConnected).toBe(true);

    wrapper.unmount();
    await nextTick();
    expect(overlayHost(), "卸载后宿主不该继续留在地图容器里").toBeNull();
    harness.assertIdle("BCustomOverlay 卸载");
  });

  it("posiiton 变化走 setPoint(point, true)：业务 DOM 工厂**不被重新调用**", async () => {
    const { wrapper, state } = await mountOverlay({ position: { lng: 116.404, lat: 39.915 } }, () =>
      h("div", "稳定的内容"),
    );
    const host = overlayHost();
    const raw = currentOverlay() as unknown as { domCreateCalls: number };
    const before = raw.domCreateCalls;

    state.value.position = { lng: 116.42, lat: 39.93 };
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(raw.domCreateCalls, "移动位置不得重建业务 DOM").toBe(before);
    // slot 子树仍然是同一份（宿主元素身份不变 ⇒ Teleport 目标没有换）
    expect(overlayHost()).toBe(host);
    expect(host!.textContent).toContain("稳定的内容");

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("BCustomOverlay setPoint");
  });

  it("构造期属性（anchor）变化：重建实例但**复用同一个宿主**——slot 子树不被重建", async () => {
    const { wrapper, state } = await mountOverlay(
      { position: { lng: 116.404, lat: 39.915 }, anchor: { x: 0.5, y: 1 } },
      () => h("div", { class: "keep" }, "保留我"),
    );
    const host = overlayHost();
    const created = (fake.createdOverlays as unknown[]).length;

    state.value.anchor = { x: 0.5, y: 0 };
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect((fake.createdOverlays as unknown[]).length, "构造期属性变化 → 重建一次").toBe(created + 1);
    expect(overlayHost(), "重建后仍是同一个宿主元素").toBe(host);
    expect(host!.querySelector(".keep")?.textContent).toBe("保留我");
    expect(harness.attached("overlay"), "地图上始终只有一个").toBe(1);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("BCustomOverlay 重建");
  });

  it("事件来自事件矩阵：SDK 派发 click / mouseover / mouseout 时组件原样转发", async () => {
    const seen: string[] = [];
    const { wrapper } = await mountOverlay(
      {
        position: { lng: 116.404, lat: 39.915 },
        onClick: () => seen.push("click"),
        onMouseover: () => seen.push("mouseover"),
        onMouseout: () => seen.push("mouseout"),
      },
      () => h("div", "内容"),
    );

    const raw = currentOverlay() as unknown as { emit: (type: string) => void };
    raw.emit("click");
    raw.emit("mouseover");
    raw.emit("mouseout");
    expect(seen).toEqual(["click", "mouseover", "mouseout"]);

    wrapper.unmount();
    await nextTick();
    harness.assertIdle("BCustomOverlay 事件");
  });

  it("$attrs 落在宿主内部的包装节点上（根是 Teleport，绑不上去）", async () => {
    const { wrapper } = await mountOverlay(
      { position: { lng: 116.404, lat: 39.915 }, class: "outer-class" },
      () => h("span", "内容"),
    );
    const host = overlayHost();
    expect(host!.querySelector(".outer-class")).toBeTruthy();
    expect(host!.classList.contains("outer-class"), "宿主本身不承载业务 class").toBe(false);

    wrapper.unmount();
    await nextTick();
  });

  it("卸载后宿主不残留在文档里（风险章的 Teleport host 残留）", async () => {
    const { wrapper } = await mountOverlay({ position: { lng: 116.404, lat: 39.915 } }, () =>
      h("div", "内容"),
    );
    expect(overlayHost(), "挂载期间宿主应当被 SDK 接管（在文档里）").toBeTruthy();

    wrapper.unmount();
    await nextTick();
    await flushPromises();
    expect(overlayHost(), "卸载后宿主不该继续留在文档里").toBeNull();
    expect(harness.container().querySelector("[data-bmap-custom-overlay]")).toBeNull();
    harness.assertIdle("BCustomOverlay 卸载残留");
  });

  it("SSR 渲染不炸（宿主在服务端不存在，slot 不渲染）", async () => {
    // 说明：本用例跑在 happy-dom 下（有 `document`），因此这里验证的是「渲染不抛错」；
    // 「服务端不创建宿主」由 `useCustomOverlay.ensureHost` 只在 create（onMounted 之后）执行保证。
    const app = defineComponent({
      setup: () => () =>
        h(BMap, { provider: harness.provider() }, () =>
          h(BCustomOverlay as never, { position: { lng: 116.4, lat: 39.9 } }, () => h("div", "x")),
        ),
    });
    await expect(renderToString(h(app) as never)).resolves.toBeTypeOf("string");
    expect(harness.container().querySelector("[data-bmap-custom-overlay]")).toBeNull();
  });

  it("Fake 保真守卫：CustomOverlay 的构造选项真的落进实例状态", () => {
    // 夹具比真实宽容会掩盖缺陷（M5-SPEC-MARKER 的教训）：这里直接断言 Fake 侧的可读性，
    // 若哪天 Fake 退回「只存 options、不落实例字段」，上面几条读数会静默失去区分力，而这条会红。
    const fakeNamespace = (fake as unknown as { namespace: FakeBMapV4["namespace"] }).namespace;
    const div = document.createElement("div");
    const overlay = new fakeNamespace.CustomOverlay(() => div, {
      point: new fakeNamespace.Point(116.4, 39.9),
      rotationInit: 45,
      properties: { id: "x" },
    }) as unknown as { rotation: number | null; properties: unknown; point: unknown };
    expect(overlay.rotation).toBe(45);
    expect(overlay.properties).toEqual({ id: "x" });
    expect(overlay.point).toMatchObject({ lng: 116.4, lat: 39.9 });
  });
});
