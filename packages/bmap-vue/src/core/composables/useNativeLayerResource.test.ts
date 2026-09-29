/**
 * useNativeLayerResource —— `unknown` 期间「一个字都不写」的直接单测（#113 欠账）
 *
 * 组件级的 props 变化会**先**走替换 / 收敛路径，`applyFields` / `applyData` 的 unknown 门在组件面
 * 不可达（#112 登记的欠账）。这里直接驱动共享内核（不挂载任何数据组件），断言口径只取
 * SDK 可观察调用 / 最终资源归属 / 泄漏门禁——不读 `mountState`、分支数量或内部字段。
 *
 * ## 为什么用 `heatmap` + 单一 `ref` 驱动
 *
 * - `heatmap` 在 Driver 的表里**没有** `setVisible`（`supports("heatmap","setVisible") === false`），
 *   因此 `visible:false` 走「摘掉实例」而不是字段 setter —— 正是 `syncMounted` 会调用 `detach` 的那条路。
 * - 内核的 `watch` 是 `flush: "sync"`：逐字段 mutate 会触发多次 `sync()`（第一次进入 unknown 后，
 *   后续每次都会先收敛重建），窗口就被冲掉了。因此这里让所有 props 从**同一个 `ref`** 派生，
 *   一次赋值 ⇒ 一次 `sync()` ⇒ 失败的 `detach` 与待写入的字段落在同一次收敛里。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide, shallowRef } from "vue";
import { createFakeV4Client, type FakeV4Heatmap } from "../../../../test-utils";
import { mapContextKey, type MapContext } from "../context/types";
import { createLayerRegistry } from "../layers/LayerRegistry";
import { useNativeLayerResource, type NativeLayerResourceHooks } from "./useNativeLayerResource";

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

interface LayerProps {
  readonly visible?: boolean;
  readonly style?: Record<string, unknown>;
  readonly data?: object | null;
  readonly dataVersion?: number;
}

interface Frame {
  visible: boolean;
  style: Record<string, unknown>;
  data: object | null;
  dataVersion: number;
}

const FEATURES = { type: "FeatureCollection", features: [{ type: "Feature" }] };
const FEATURES_NEXT = { type: "FeatureCollection", features: [{ type: "Feature" }, { type: "Feature" }] };

describe("useNativeLayerResource：unknown 期间不写 [#113]", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("摘除失败进入 unknown ⇒ 同一次收敛里的字段 / 数据都一个字都不写（旧句柄状态不变）", async () => {
    const { client, fake } = await createFakeV4Client();
    const map = client.driver.map.create(sizedContainer());
    const rawMap = fake.createdMaps[fake.createdMaps.length - 1]!;
    const registry = createLayerRegistry();
    const events = { emit: vi.fn() };
    const mapCtx = {
      whenReady: async () => ({ client, map }),
      events,
      layers: registry,
    } as unknown as MapContext;

    // `shallowRef`：每次整体替换，读到的就是原始对象（`ref` 的深代理会让 `toBe` 失去身份可比性）
    const frame = shallowRef<Frame>({
      visible: true,
      style: { radius: 2 },
      data: FEATURES,
      dataVersion: 1,
    });
    const props: LayerProps = {
      get visible() {
        return frame.value.visible;
      },
      get style() {
        return frame.value.style;
      },
      get data() {
        return frame.value.data;
      },
      get dataVersion() {
        return frame.value.dataVersion;
      },
    };
    const hooks: NativeLayerResourceHooks<LayerProps> = {
      component: "HeatmapLayer",
      kind: "heatmap",
      ctorOptions: () => ({}),
      /**
       * ⚠️ 重建指纹刻意跟随 `dataVersion`。
       *
       * 4.0.5 之前这条用例是靠 `visible: false` 触发摘除的（`heatmap` 当时没有 `setVisible`，
       * 隐藏走 detach）。4.0.5 声明了 `Heatmap.setVisible`（`visualization/Heatmap.d.ts:153`），
       * `visible` 改走同实例的 setter、**不再摘除**——于是「摘除失败 → unknown」这条路径
       * 用 `visible` 触发不到。指纹是**唯一**能让内核走「先摘后建」判据的入口
       * （`sync` 里先看 `mountState === "unknown"` / `rebuildKey` / `needsRemountRebuild`），
       * 因此这里让它跟着一个构造期字段变，用它来触发摘除。本用例要验的
       * **不是**「什么触发重建」，而是「摘除失败进入 unknown 后那次收敛一个字都不写」——
       * 触发方式换成哪条重建路径都不影响结论。
       */
      rebuildKey: (p) => `heatmap|${String(p.dataVersion)}`,
      style: (p) => p.style,
      data: {
        key: (p) => String(p.dataVersion),
        state: (p) => (p.data === undefined ? "absent" : p.data === null ? "empty" : "value"),
        value: (p) => p.data,
      },
    };

    const Consumer = defineComponent({
      setup() {
        useNativeLayerResource(props, hooks);
        return () => h("div");
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provide(mapContextKey, mapCtx);
          return () => h(Consumer);
        },
      }),
    );
    // 先登记清理：任何断言失败也不会把 Fake 资源泄漏给后续用例
    cleanup = () => {
      wrapper.unmount();
      client.driver.map.destroy(map);
      fake.diagnostics.assertNoLeaks("useNativeLayerResource");
    };
    await flushPromises();

    const layer = fake.createdNativeLayers[0]! as FakeV4Heatmap;
    expect(layer.callLog, "首份数据到达 SDK").toContain("setData");
    expect(layer.callLog, "首次样式写入").toContain("setOptions");

    // 正对照：unknown 之前，样式变化确实会写（证明下面的「不写」不是因为路径断了）
    frame.value = { ...frame.value, style: { radius: 3 } };
    expect(layer.callLog.filter((entry) => entry === "setOptions")).toHaveLength(2);

    // 摘除失败（摘之前抛 ⇒ 实例可能仍在图上）+ 同一次收敛里还带了样式 / 数据变化
    rawMap.failNextRemoveLayer = new Error("removeLayer boom");
    const frozen = [...layer.callLog];
    frame.value = {
      visible: true,
      style: { radius: 5 },
      data: FEATURES_NEXT,
      dataVersion: 2, // ← 重建指纹变了 ⇒ 走 recreate ⇒ 先摘（这次摘除会失败）
    };

    expect(
      layer.callLog,
      "unknown 期间 applyFields / applyData 一个字都不写（无 setOptions / setData）",
    ).toEqual(frozen);
    expect(layer.getData(), "数据未被替换").toBe(FEATURES);
    expect(events.emit, "失败经统一错误出口上报").toHaveBeenCalledWith(
      "resource:error",
      expect.objectContaining({ component: "HeatmapLayer" }),
    );
  });
});
