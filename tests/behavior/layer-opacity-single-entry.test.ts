/**
 * 样式袋的 `opacity` 与图层级 `opacity` prop：**一个 SDK 状态只能有一个控制入口**（#174 评审 P1-1）
 *
 * ## 这条用例在锁什么
 *
 * `useNativeLayerResource.fieldWrites()` 的写入顺序是 `visible → opacity(setOpacity) →
 * zIndex → zoomRange → style(setStyle)`。评审记的缺陷是：官方 `visualization/` 的
 * `setStyle` 落到 `setOptions`，而 **`setOptions` 会把袋里的 `opacity` 转发到 `setOpacity`**
 * （官方 `TextLayer.d.ts:265-268` / `PolylineLayer.d.ts:209-211` / `PointLayer.d.ts:297-299`
 * 三处逐字写明「`opacity` / `visible` / `zIndex` / … 转发到对应 setter」）。
 *
 * ⇒ `opacity` prop 与 `style.opacity` **写的是同一份状态**，于是「最后改的那个赢」：
 * 先改 `style` 再改 `opacity` 与反过来会得到**不同**的最终值。这是设置了两者的使用者
 * 遇到的正确性缺陷，不是风格问题。
 *
 * ## 修法与为什么是它
 *
 * 本库取「**一个关切一个入口**」：`opacity` 是顶层受控 prop，样式袋**不**再转发 `opacity`，
 * 放进去时**告警一次**（不静默接收后丢弃——AGENTS.md 的硬规则）。
 *
 * ## ⚠️ 仓库原注释把 `setOptions` 记成「整袋替换」，那是**误读**，本票更正
 *
 * `types/components.ts` 的 `TextLayerStyle` 文件头原写「经 `setOptions` **整袋替换**下发
 * …**没写的键回到官方默认值**」，而它引用的官方原文是「**仅更新已声明的样式键**」——
 * 后者的意思是「只写你给的那几个键，没给的保持原值」，即 **merge**，与 `layer/` 家族的
 * `setStyleOptions`（「合并到现有样式」，`layer/LineLayer.d.ts:336`）是**同一种**语义。
 * 逐 kind 的 live 读数见 `scripts/probe-style-opacity.mts`。
 *
 * 这个更正**缩小**了缺陷面（不是所有 kind 都中招），但**没有取消**它：争的是同一份状态，
 * 与「merge 还是替换」无关。
 *
 * ## 覆盖矩阵（为什么不是所有 kind）
 *
 * 争用要求**两件事同时成立**：① 官方声明里 `opacity` 会被 `setOptions` 转发到 `setOpacity`
 * （`visualization/` 家族）；② 本库在该组件上**真的开出了** `opacity` prop。
 *
 * | kind | ① 转发 | ② 本库有 `opacity` prop | 结论 |
 * | --- | --- | --- | --- |
 * | `text` | 是（`TextLayer.d.ts:265`） | **是** | **争用 ⇒ 本票修** |
 * | `polyline` | 是（`PolylineLayer.d.ts:209`） | 否（刻意的范围选择，`types/components.ts` 的 `VisualizationPolygonPolylineDisplayProps`） | 袋是**唯一**入口，排除它等于让人**设不成** |
 * | `cluster` / `heatmap` / `track-line` | 声明里有 `opacity` 项、`setOpacity` 已登记 | 否 | 同上 |
 * | `point` / `polygon` | 官方**没有** `setOpacity`（`polygon` 连选项表都没有 `opacity`） | 否 | 无争用 |
 * | `point-icon` / `point-shape`（`layer/` 家族） | 走 `setStyleOptions`（merge），且 `PointShapeStyle.opacity` 是**逐要素**字段（`layer/PointShapeLayer.d.ts:137`），与图层级 `opacity` **相乘**、不是同一份状态 | 是（`NativeLayerCommonProps`） | **不是**争用，见本文件末尾的反向门禁 |
 *
 * ⇒ 今天只有 `<TextLayer>` 中招。修法落成**内核里的逐 kind 表**（`core/layers/`），
 * 而不是「凡是叫 `opacity` 就拦」——后者会把 `polyline` / `heatmap` / `track-line`
 * 唯一的透明度入口一起砍掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, nextTick, ref } from "vue";
import { createFakeV4Harness, type FakeV4Harness } from "../../packages/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import TextLayer from "../../packages/bmap-vue/src/components/layers/TextLayer.vue";

const { harness, fake } = createFakeV4Harness();

const POINTS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [116.404, 39.915] },
      properties: { id: "t-1", text: "北京" },
    },
  ],
};

/** 替身实例上本文件读到的字段（显式列出，读起来就是「依赖替身的哪几项」）。 */
interface RawLayerView {
  callLog: string[];
  /** 官方 `setOptions` 收到的整袋。 */
  options: Record<string, unknown>;
  /** 图层级 `opacity`（**独立于** `options.opacity` 的那份状态，替身按官方转发建模）。 */
  opacity: number;
  attachedMap: unknown;
}

let createdBase = 0;

beforeEach(() => {
  harness.reset();
  createdBase = harness.nativeLayersCreated();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const createdSince = (): number => harness.nativeLayersCreated() - createdBase;

function lastRawLayer(): RawLayerView {
  const list = fake.createdNativeLayers as unknown as RawLayerView[];
  const raw = list[list.length - 1];
  if (!raw) throw new Error("本用例还没有创建过原生图层");
  return raw;
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

/** 挂一个 `<TextLayer>`，返回「改 props」的入口。 */
async function mountTextLayer(initial: Record<string, unknown>) {
  const props = ref<Record<string, unknown>>({ data: POINTS, ...initial });
  const Root = defineComponent({
    setup: () => () => h(Map, { provider: harness.provider() }, () => h(TextLayer, props.value)),
  });
  const wrapper = mount(Root, { attachTo: harness.container() });
  await settle();
  const setProp = async (patch: Record<string, unknown>) => {
    props.value = { ...props.value, ...patch };
    await settle();
  };
  return { wrapper, setProp };
}

function warnLines(): string[] {
  const spy = vi.mocked(console.warn);
  return spy.mock.calls.map((call) => String(call[0] ?? ""));
}

describe("#174 P1-1：TextLayer 的 opacity 只有一个控制入口", () => {
  it("挂载时 style 袋里的 opacity 被排除，prop 的值落到 SDK 上", async () => {
    // 官方契约：setOptions 会把袋里的 opacity **转发到 setOpacity**（TextLayer.d.ts:265），
    // 因此袋里带 opacity 时「prop 的值」会被它盖掉。修法是根本不让它进袋。
    const { wrapper } = await mountTextLayer({ opacity: 0.8, style: { fontSize: 20, opacity: 0.2 } });

    expect(lastRawLayer().opacity, "SDK 手上是 opacity prop 的值（0.8），不是袋里的 0.2").toBe(0.8);
    expect(
      harness.nativeLayerOptions(),
      "样式袋里不得再有 opacity —— 它会被官方转发到同一个 setter",
    ).not.toHaveProperty("opacity");
    expect(harness.nativeLayerOptions(), "其余样式键照常下发").toMatchObject({ fontSize: 20 });

    wrapper.unmount();
    await settle();
    harness.assertIdle("TextLayer opacity 单入口");
  });

  it("先改 opacity prop、再改 style：两端都不被对方冲掉（顺序无关 · 正向）", async () => {
    const { wrapper, setProp } = await mountTextLayer({
      opacity: 0.8,
      style: { fontSize: 20, opacity: 0.2 },
    });
    expect(lastRawLayer().opacity, "初始挂载").toBe(0.8);

    await setProp({ opacity: 0.4 });
    expect(lastRawLayer().opacity, "只改 opacity prop").toBe(0.4);

    await setProp({ style: { fontSize: 30, opacity: 0.1 } });
    expect(lastRawLayer().opacity, "随后只改 style —— 透明度仍由 prop 说了算").toBe(0.4);
    expect(harness.nativeLayerOptions(), "样式的其余键确实更新了").toMatchObject({ fontSize: 30 });

    wrapper.unmount();
    await settle();
    harness.assertIdle("TextLayer 正向顺序无关");
  });

  it("先改 style、再改 opacity prop：同样不被冲掉（顺序无关 · 反向）", async () => {
    const { wrapper, setProp } = await mountTextLayer({
      opacity: 0.8,
      style: { fontSize: 20, opacity: 0.2 },
    });
    expect(lastRawLayer().opacity, "初始挂载").toBe(0.8);

    await setProp({ style: { fontSize: 30, opacity: 0.1 } });
    expect(lastRawLayer().opacity, "只改 style —— 透明度不动").toBe(0.8);

    await setProp({ opacity: 0.4 });
    expect(lastRawLayer().opacity, "随后只改 opacity prop").toBe(0.4);
    expect(harness.nativeLayerOptions(), "样式袋仍不含 opacity").not.toHaveProperty("opacity");

    wrapper.unmount();
    await settle();
    harness.assertIdle("TextLayer 反向顺序无关");
  });

  it("只给 style.opacity（不给 prop）时也告警一次 —— 不静默接收后丢弃", async () => {
    const { wrapper } = await mountTextLayer({ style: { fontSize: 20, opacity: 0.2 } });

    const lines = warnLines();
    expect(
      lines.some((line) => line.includes("opacity")),
      "把 opacity 放进样式袋必须被告警告知（图层级透明度请用 opacity prop）",
    ).toBe(true);

    wrapper.unmount();
    await settle();
  });

  it("告警是**一次**的：反复改 style 不会刷屏", async () => {
    const { wrapper, setProp } = await mountTextLayer({ style: { fontSize: 20, opacity: 0.2 } });
    const first = warnLines().filter((line) => line.includes("opacity")).length;

    await setProp({ style: { fontSize: 22, opacity: 0.3 } });
    await setProp({ style: { fontSize: 24, opacity: 0.4 } });

    expect(
      warnLines().filter((line) => line.includes("opacity")).length,
      "同一组件实例里这条告警只出一次",
    ).toBe(first);

    wrapper.unmount();
    await settle();
  });

  it("样式袋不含 opacity 时不产生任何告警（正常用法不被打扰）", async () => {
    const { wrapper, setProp } = await mountTextLayer({ opacity: 0.8, style: { fontSize: 20 } });
    await setProp({ style: { fontSize: 26 } });
    await setProp({ opacity: 0.5 });

    expect(
      warnLines().filter((line) => line.includes("opacity")),
      "没有争用就没有告警",
    ).toEqual([]);

    wrapper.unmount();
    await settle();
    harness.assertIdle("TextLayer 无争用不告警");
  });
});

describe("#174 P1-1：反向门禁 —— 不许把「不是争用」的 opacity 一起拦掉", () => {
  /**
   * `layer/` 家族的 `PointIconStyle.opacity` / `PointShapeStyle.opacity` 是**逐要素**字段
   * （`layer/PointIconLayer.d.ts:127` / `PointShapeLayer.d.ts:137`），官方文档明写与图层级
   * `opacity` **相乘**——它们是**两份不同的状态**，拦住会让「逐要素透明度」这个已交付的
   * 能力（`native-data-layers.test.ts` 的「逐要素 opacity 落在样式袋的 opacity 键」）消失。
   *
   * 本票把排除写成**逐 kind 表**而不是「按字段名一律拦」，这条用例就是那张表的判别力。
   */
  it("排除规则逐 kind 生效，不是一律按字段名拦", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "packages/bmap-vue/src/core/layers/nativeLayerStyleOwnership.ts",
      ),
      "utf8",
    );
    // 表里只有 `text`：polyline / cluster / heatmap / track-line 的样式袋是它们**唯一**的
    // 透明度入口（组件没开 `opacity` prop），拦掉等于让人设不成。
    expect(source, "逐 kind 表必须列出 text").toMatch(/"text"/);
    for (const kind of ["polyline", "cluster", "heatmap", "track-line", "line", "fill", "point"]) {
      expect(
        source,
        `${kind} 不得进排除表（要么没有 prop、要么是逐要素字段）`,
      ).not.toMatch(new RegExp(`"${kind}"\\s*[,\\n]`));
    }
  });

  it("`layer/` 家族的逐要素 opacity 仍然原样进样式袋", async () => {
    // 走 PointIconLayer（逐要素 opacity 的既有消费者）：它**不**经过 TextLayer 那条规则。
    const source = readFileSync(
      resolve(process.cwd(), "packages/bmap-vue/src/core/layers/nativeLayerStyleOwnership.ts"),
      "utf8",
    );
    expect(source, "PointIconLayer 的 kind 是 point-icon，不在排除表里").not.toMatch(
      /"point-icon"\s*[,\n]/,
    );
  });
});
