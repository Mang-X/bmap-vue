/**
 * `<Panorama>.clearOverlays()` 与 `<PanoramaLabel>` 的**归属**（#174 评审 P1-2）
 *
 * ## 缺陷本身
 *
 * `<PanoramaLabel>` 在挂载 / 重建时调 `addLabel()`，之后的 prop 变化**只**对**它自己持有的
 * 那个句柄**调 setter**。父级一旦跑 `clearOverlays()`，SDK 侧那个标注就没了，而子组件
 * **仍然认为它挂着**——于是它后续的 prop 变化全部打在**一个已经不在画面上的标注**上。
 * 表现是「声明存在、画面不存在」，直到某次重建 / 重挂载把它救回来。
 *
 * ## 为什么选「**协调**」而不是「**限制**」
 *
 * 官方 `Panorama` 的覆盖物面**只有三个方法**（`panorama/Panorama.d.ts:87` / `:92` / `:115`）：
 * `addOverlay` / `removeOverlay` / `clearOverlays`——**没有任何枚举接口**（没有 `getOverlays()`
 * 或等价物）。因此「只清掉本库管不到的、放过本库管理的」在官方面上**无法实现**：
 * 判不出哪个是「管不到的」，也就没有可写的选择性清空。
 *
 * 能写的只有两条：① 清完把本库管理的标注**重新挂回去**（协调）；② 干脆不让业务调
 * `clearOverlays`。② 会砍掉 #171 item I 补这条命令时**唯一**的正当理由——测试文件头记着
 * 「`clearOverlays` 补的正是『逐个摘除』做不到的那条路」。⇒ 选 ①。
 *
 * ## 对调用方的语义（这条是契约，不是实现细节）
 *
 * `clearOverlays()` 清掉**本库不管理的**覆盖物（经 `advanced` 逃生口或直接用 SDK 挂上去的），
 * 并把**当前挂载着的 `<PanoramaLabel>`** 重新挂回查看器。重新挂回的是**同一个句柄**，
 * 因此标注的业务内容（`content` / `position` / `altitude`）保持不变，后续 prop 变化照常生效。
 *
 * 换句话说：它清的是「**本库管不到的那部分**」，不是「屏幕上的一切」。要连 `<PanoramaLabel>`
 * 一起清掉，正确做法是**卸载那些组件**——它们的释放路径是各自的 `removeLabel()`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
import PanoramaLabel from "../../packages/bmap-vue/src/components/panorama/PanoramaLabel.vue";
import { createFakeV4Harness, type FakeV4Harness } from "../../packages/test-utils";

type AnyRecord = Record<string, any>;

let harness: FakeV4Harness;
let fake: ReturnType<typeof createFakeV4Harness>["fake"];

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

interface ViewerView {
  overlays: unknown[];
  callLog: string[];
}

function lastViewer(): ViewerView {
  const viewer = fake.createdPanoramas.at(-1);
  if (!viewer) throw new Error("还没有创建查看器");
  return viewer as unknown as ViewerView;
}

function lastLabel(): AnyRecord {
  const label = fake.createdPanoramaLabels?.at(-1);
  if (!label) throw new Error("还没有创建标注");
  return label as unknown as AnyRecord;
}

/** 挂一个 `<Panorama>` + 若干 `<PanoramaLabel>`；返回可改 props 的入口与命令面。 */
async function mountPanorama(labels: () => unknown) {
  const labelProps = ref<Record<string, unknown>>({ content: "A", position: POINT });
  const Root = defineComponent({
    setup: () => () =>
      h(Map, { provider: harness.provider() }, () => [
        h(Panorama, { point: POINT }, () => [
          h(PanoramaLabel, labelProps.value as never),
        ]),
      ]),
  });
  const wrapper = mount(Root, { attachTo: harness.container() });
  await settle();
  await settle();
  const setLabelProps = async (patch: Record<string, unknown>) => {
    labelProps.value = { ...labelProps.value, ...patch };
    await settle();
  };
  const clearOverlays = (): void => {
    (wrapper.findComponent(Panorama).vm as unknown as AnyRecord).clearOverlays();
  };
  return { wrapper, setLabelProps, clearOverlays, labelProps };
}

describe("#174 P1-2：clearOverlays 之后 <PanoramaLabel> 仍然在画面上且是当前的", () => {
  it("清空后标注被重新挂回（不被 SDK 悄悄丢掉）", async () => {
    const { wrapper, clearOverlays } = await mountPanorama();
    const viewer = lastViewer();
    expect(viewer.overlays, "挂载后标注在画面上").toHaveLength(1);
    const handle = viewer.overlays[0];

    clearOverlays();

    expect(viewer.overlays, "清空之后标注必须还在（重新挂回的是同一个句柄）").toHaveLength(1);
    expect(viewer.overlays[0], "重新挂回的是同一个句柄，不是新建一个").toBe(handle);

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 之后卸载");
  });

  it("清空后再改 label 的 props：画面上的标注**既在、又是最新的**", async () => {
    const { wrapper, clearOverlays, setLabelProps } = await mountPanorama();
    const viewer = lastViewer();

    clearOverlays();

    // ⚠️ 断言的是「SDK 手上那个标注的内容」，不是「setter 被调用过」：
    // 「调用发生」与「画面上那一行字真的变了」是两件事，缺陷就藏在两者之间。
    await setLabelProps({ content: "B" });
    await settle();

    expect(viewer.overlays, "改完 props 之后标注仍然挂在查看器上").toHaveLength(1);
    expect(
      lastLabel().content,
      "SDK 手上那个标注的内容确实是新值（不是『声明变了、画面没变』）",
    ).toBe("B");

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 之后改 label props");
  });

  it("清空后改 altitude / position 同样落地", async () => {
    const { wrapper, clearOverlays, setLabelProps } = await mountPanorama();
    const viewer = lastViewer();
    clearOverlays();

    await setLabelProps({ altitude: 9, position: { lng: 116.5, lat: 39.99 } });
    await settle();

    expect(viewer.overlays).toHaveLength(1);
    expect(lastLabel().altitude).toBe(9);
    expect(lastLabel().position).toEqual({ lng: 116.5, lat: 39.99 });

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 之后改 label 位置");
  });

  it("清空**不**吞掉本库不管理的覆盖物（业务经逃生口挂的那些照清）", async () => {
    const { wrapper, clearOverlays } = await mountPanorama();
    const viewer = lastViewer();
    // 模拟业务自己经 raw SDK 挂上去的一个覆盖物：它不受任何组件管理
    viewer.overlays.push({ foreign: true });
    expect(viewer.overlays).toHaveLength(2);

    clearOverlays();

    expect(
      viewer.overlays.some((entry) => (entry as { foreign?: boolean }).foreign === true),
      "本库管不到的覆盖物必须被清掉——否则这条命令对业务毫无用处",
    ).toBe(false);
    expect(viewer.overlays, "本库管理的标注重新挂回").toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 清掉外来覆盖物");
  });

  it("连续两次 clearOverlays 不叠加标注（重新挂回不会重复挂）", async () => {
    const { wrapper, clearOverlays } = await mountPanorama();
    const viewer = lastViewer();

    clearOverlays();
    clearOverlays();

    expect(viewer.overlays, "清两次仍然只有一个标注").toHaveLength(1);

    wrapper.unmount();
    await settle();
    harness.assertIdle("两次 clearOverlays");
  });

  it("重新挂回失败时显式抛错并说清挂回去了几个（不静默留下分叉）", async () => {
    const { wrapper, clearOverlays } = await mountPanorama();
    const viewer = lastViewer();
    // 挂载已经消费过一次 addOverlay；下一次失败落在 clearOverlays 的重新挂回上
    viewer.failNextAddOverlay = new Error("addOverlay exploded");

    expect(() => clearOverlays()).toThrowError(/0 \/ 1/);
    expect(
      viewer.overlays,
      "挂回失败的那个标注确实不在画面上（这就是必须报错的原因）",
    ).toHaveLength(0);

    wrapper.unmount();
    await settle();
  });

  it("卸载 `<PanoramaLabel>` 之后 clearOverlays 不再把它挂回来", async () => {
    const show = ref(true);
    const Root = defineComponent({
      setup: () => () =>
        h(Map, { provider: harness.provider() }, () => [
          h(Panorama, { point: POINT }, () => [
            show.value ? h(PanoramaLabel, { content: "A", position: POINT }) : null,
          ]),
        ]),
    });
    const wrapper = mount(Root, { attachTo: harness.container() });
    await settle();
    await settle();
    const viewer = lastViewer();
    expect(viewer.overlays).toHaveLength(1);

    show.value = false;
    await settle();
    expect(viewer.overlays, "组件卸载后标注已被摘除").toHaveLength(0);

    (wrapper.findComponent(Panorama).vm as unknown as AnyRecord).clearOverlays();

    expect(viewer.overlays, "已经卸载的标注不得被重新挂回（否则它永远摘不掉）").toHaveLength(0);

    wrapper.unmount();
    await settle();
    harness.assertIdle("卸载后 clearOverlays");
  });
});
