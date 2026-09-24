/**
 * issue #138：覆盖物的 **baseline restore**（撤回）策略。
 *
 * ## 背景
 *
 * 覆盖物的可选属性从「有值」变回「未表态」（`undefined`）时，SDK 侧必须回到**它自己的默认值**。
 * 4.0.4 没有给任何覆盖物属性提供 `unset` / 恢复默认的入口，因此落点只有一个：**重建实例**
 * （构造期不传该键 ⇒ SDK 用自己的默认）。见 ADR
 * `2026-09-24-overlay-infowindow-vue-native-convergence` §5 里「另外三条路为什么都不成立」的取证。
 *
 * ## 这个文件钉住的四件事
 *
 * | # | 口径 | 为什么它是会红的而不是同义反复 |
 * | --- | --- | --- |
 * | 1 | **逐字段表**覆盖所有可写字段，且每个都写明依据 | 新增一个属性却没写依据 ⇒ 差集非空即断言失败 |
 * | 2 | 「有值 → `undefined`」⇒ **恰好一次重建**，新实例该键的命令日志为空 | 用 SDK 自己的默认，而不是猜一个默认值写进去 |
 * | 3 | 「有值 → 有值」**不重建**；「从未给值 → `undefined`」**不重建** | 后者是「可能已写入」记账的判据所在：没给过值就没有要撤回的东西 |
 * | 4 | 部分成功的 `setOptions`（前面几个 setter 成功、后面抛错）**之后**撤回仍要重建 | 判据必须是「**可能**已写入」而不是「成功写入过」 |
 *
 * ## 为什么用例直接用 `useOverlaySpec` 而不挂 SFC
 *
 * `Marker.vue` / `Label.vue` 的 `withDefaults` 给 `offset` / `title` / `enableDragging` 填了
 * **非 `undefined`** 的缺省值——在这些 SFC 上「变回 `undefined`」根本到不了内核（Vue 会先
 * 换成缺省值）。要测内核的撤回判据，就得让 props 真的可以是 `undefined`，因此这里声明一张
 * 自用的 `OverlaySpec`。**组件侧那层另有一条用例**（`zIndex`：它没有 `withDefaults` 缺省，
 * 因此在真实 SFC 上就能走到撤回路径）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import { useOverlaySpec } from "../../packages/bmap-vue/src/core/composables/useOverlaySpec";
import type { OverlaySpec } from "../../packages/bmap-vue/src/core/overlays/OverlaySpec";
import {
  OVERLAY_DESCRIPTORS,
  OVERLAY_REVERT_RATIONALE,
  overlayPropertyPolicy,
  overlayPropertyRevert,
  type OverlayKind,
} from "../../packages/bmap-vue/src/driver/types/overlays";
import type { MarkerHandle } from "../../packages/bmap-vue/src/driver/types/handles";
import {
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Marker,
} from "../../packages/test-utils";

let harness: FakeV4Harness;
let fake: FakeBMapV4;

beforeEach(() => {
  ({ harness, fake } = createFakeV4Harness());
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

/** 地图上挂着的覆盖物（raw 实例，按挂载顺序）。 */
function overlays(): FakeV4Marker[] {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  if (!map) throw new Error("用例必须先创建地图（<Map>）");
  return map.overlays as unknown as FakeV4Marker[];
}

function currentOverlay(): FakeV4Marker {
  const found = overlays().at(-1);
  if (!found) throw new Error("地图上还没有覆盖物");
  return found;
}

function constructedCount(): number {
  return fake.createdOverlays.length;
}

/* ------------------------------------------------------- 1. 逐字段依据表 */

describe("撤回依据表：每个可写字段都写明了落点与理由", () => {
  /** 描述符覆盖的全部 kind（每个 kind 的每个属性都要有依据）。 */
  const ALL_KINDS = Object.keys(OVERLAY_DESCRIPTORS) as OverlayKind[];

  it("每个可写字段的撤回落点都是 rebuild（唯一可选值），且逐字段都登记了依据", () => {
    const rationale = OVERLAY_REVERT_RATIONALE as Record<string, string>;
    for (const kind of ALL_KINDS) {
      for (const spec of OVERLAY_DESCRIPTORS[kind].properties) {
        if (spec.policy === "unsupported") continue;
        expect(
          overlayPropertyRevert(kind, spec.name),
          `${kind}.${spec.name} 的撤回落点`,
        ).toBe("rebuild");
        // 依据表必须**逐字段**给出理由。键用属性名（跨 kind 共享同一份理由），
        // 查不到就是「这个字段为什么只能重建」没有落地。
        expect(
          rationale[spec.name],
          `${kind}.${spec.name} 在 OVERLAY_REVERT_RATIONALE 里没有依据`,
        ).toBeTruthy();
      }
    }
  });

  it("依据表的每条理由都非空：一条空串等于「没写」", () => {
    for (const [key, reason] of Object.entries(OVERLAY_REVERT_RATIONALE)) {
      expect(reason.trim(), `${key} 的依据是空串`).not.toBe("");
    }
  });

  it("`revert` 是**正交**于 `policy` 的一维：没有把 mutable 降级成 recreate", () => {
    // 值变化（5 → 7）仍按 `mutable` 就地写；只有「值消失」才升级为重建。
    // 若有人把 `revert` 混进 `policy`，这里会看到 zIndex 的 policy 变成 recreate。
    expect(overlayPropertyPolicy("marker", "zIndex")).toBe("mutable");
    expect(overlayPropertyPolicy("marker", "rotation")).toBe("mutable");
    expect(overlayPropertyPolicy("marker", "enableDragging")).toBe("mutable");
    // 构造期属性本来就是重建，写不写 `revert` 都是 rebuild
    expect(overlayPropertyPolicy("marker", "enableClicking")).toBe("recreate");
  });

  it("未知键查不到 ⇒ 显式不支持（不猜落点）", () => {
    expect(overlayPropertyRevert("marker", "noSuchKey")).toBeUndefined();
  });
});

/* ------------------------------------------------ 2/3/4. 运行时行为（走内核） */

/** 自用 spec 的 props：全部**没有** `withDefaults` 缺省，因此真的可以是 `undefined`。 */
type ProbeProps = {
  position: { lng: number; lat: number };
  zIndex?: number;
  rotation?: number;
  title?: string;
  offset?: { x: number; y: number };
  enableDragging?: boolean;
};

function probeSpec(): OverlaySpec<ProbeProps, MarkerHandle> {
  return {
    type: "marker",
    kind: "marker",
    targetKind: "marker",
    fields: {
      position: "position",
      zIndex: "options",
      rotation: "options",
      title: "options",
      offset: "options",
      enableDragging: "options",
    },
    create: (context, p) =>
      context.client.driver.overlays.createMarker(p.position, {
        zIndex: p.zIndex,
        rotation: p.rotation,
        title: p.title,
        offset: p.offset,
        enableDragging: p.enableDragging,
      }),
  };
}

/** 挂一个 `<Map>` + 一个走 `useOverlaySpec` 的探针（props 是 reactive，测试直接改它）。 */
async function mountProbe(initial: Partial<ProbeProps>) {
  const state = reactive<ProbeProps>({
    position: { lng: 116.4, lat: 39.9 },
    ...initial,
  });
  const spec = probeSpec();
  const Probe = defineComponent({
    setup() {
      useOverlaySpec(state, spec, { emit: () => {} });
      return () => null;
    },
  });
  const Host = defineComponent({
    components: { Map, Probe },
    setup() {
      return () => h(Map, { provider: harness.provider() }, () => [h(Probe)]);
    },
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper, state };
}

async function mountMarkerSfc(initial: Record<string, unknown>) {
  const state = reactive<Record<string, unknown>>({ ...initial });
  const wrapper = mount(
    defineComponent({
      components: { Map, Marker },
      setup() {
        return () =>
          h(Map, { provider: harness.provider() }, () => [
            h(Marker, { position: { lng: 116.4, lat: 39.9 }, ...state }),
          ]);
      },
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return { wrapper, state };
}

async function unmountAndSettle(wrapper: { unmount(): void }): Promise<void> {
  wrapper.unmount();
  await settle();
}

describe("有值 → undefined：恰好一次重建，新实例用 SDK 自己的默认值", () => {
  it("zIndex：撤回落点最典型（8 个类有 setter、0 个类有 getter）", async () => {
    const { wrapper, state } = await mountProbe({ zIndex: 5 });
    const doomed = currentOverlay();
    const constructed = constructedCount();
    doomed.callLog.length = 0;

    state.zIndex = undefined;
    await settle();

    expect(constructedCount(), "SDK 没有 unset 入口 ⇒ 只能重建以回到默认").toBe(constructed + 1);
    expect(harness.attached("overlay"), "地图上恰好一个").toBe(1);
    expect(doomed.callLog, "被丢弃的那一代不该收到任何 setter").toEqual([]);
    const fresh = currentOverlay();
    expect(fresh.callLog, "新实例不再写 zIndex（用 SDK 自己的默认）").toEqual([]);
    expect(fresh.zIndex, "SDK 默认不是 undefined，而是它自己的值").not.toBe(5);

    await unmountAndSettle(wrapper);
    harness.assertIdle("zIndex 撤回");
  });

  it("offset（对外是 Pixel 形态，描述符的 value 档是 size）：同样是重建", async () => {
    const { wrapper, state } = await mountProbe({ offset: { x: 3, y: 4 } });
    const constructed = constructedCount();

    state.offset = undefined;
    await settle();

    expect(constructedCount()).toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentOverlay().callLog, "新实例不再写 offset").toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("offset 撤回");
  });

  it("enableDragging（成对开关，无公开读回）：撤回重建；反向 true → false 仍就地", async () => {
    const { wrapper, state } = await mountProbe({ enableDragging: true });
    const first = currentOverlay();
    const constructed = constructedCount();

    // 值变化（true → false）：成对开关**就地** disable，不重建
    first.callLog.length = 0;
    state.enableDragging = false;
    await settle();
    expect(constructedCount(), "值变化不该重建").toBe(constructed);
    expect(currentOverlay()).toBe(first);
    expect(first.callLog).toEqual(["disableDragging"]);

    // 值消失（false → undefined）：无 unset 入口 ⇒ 重建
    state.enableDragging = undefined;
    await settle();
    expect(constructedCount()).toBe(constructed + 1);
    expect(currentOverlay().callLog, "新实例不再碰 enableDragging").toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("enableDragging 撤回");
  });

  it("真实 SFC 上 `zIndex` 也能走到撤回路径（它没有 withDefaults 缺省）", async () => {
    const { wrapper, state } = await mountMarkerSfc({ zIndex: 5 });
    const constructed = constructedCount();

    state.zIndex = undefined;
    await settle();

    expect(constructedCount(), "组件侧与内核是同一条路径").toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentOverlay().callLog).toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("SFC 的 zIndex 撤回");
  });
});

describe("反向：不该重建的两种情况都不重建", () => {
  it("有值 → 有值：纯值变化**不**重建（revert 不降级 policy）", async () => {
    const { wrapper, state } = await mountProbe({ zIndex: 5 });
    const first = currentOverlay();
    const constructed = constructedCount();
    first.callLog.length = 0;

    state.zIndex = 7;
    await settle();

    expect(constructedCount(), "5 → 7 完全可就地写").toBe(constructed);
    expect(currentOverlay()).toBe(first);
    expect(first.callLog).toEqual(["setZIndex"]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("zIndex 值变化");
  });

  it("从未给值 → undefined：**不**重建（没有「要撤回的东西」）", async () => {
    const { wrapper, state } = await mountProbe({});
    const constructed = constructedCount();
    const first = currentOverlay();

    state.zIndex = undefined;
    await settle();

    expect(constructedCount(), "从没给过值 ⇒ 没有可撤回的基线").toBe(constructed);
    expect(currentOverlay()).toBe(first);
    expect(first.callLog).toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("zIndex 从未给值");
  });

  it("多个字段同时撤回：一批里只要有一个需要重建就**只重建一次**", async () => {
    const { wrapper, state } = await mountProbe({ zIndex: 5, offset: { x: 1, y: 1 } });
    const constructed = constructedCount();

    state.zIndex = undefined;
    state.offset = undefined;
    await settle();

    expect(constructedCount(), "同批两个字段只重建一次").toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentOverlay().callLog).toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("同批撤回");
  });

  it("反复给值/撤回：每轮各一次重建（记账不被污染）", async () => {
    const { wrapper, state } = await mountProbe({});
    const constructed = constructedCount();

    for (const value of [1, undefined, 2, undefined]) {
      state.zIndex = value;
      await settle();
    }

    expect(constructedCount(), "两轮给值 + 两轮撤回 = 两次重建").toBe(constructed + 2);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentOverlay().callLog).toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("反复撤回");
  });
});

describe("「可能已写入」而非「成功写入过」", () => {
  it("部分成功的 setOptions 之后撤回：仍要重建（否则 SDK 永久保留旧值）", async () => {
    // `setOptions` 是逐 setter 调用：第一个键写成功、第二个键抛错时，第一个键**已经**
    // 真的改了 SDK。按「成功写入过」记账，那个键此后会被记成「从没写过」，
    // 撤回时不重建 ⇒ SDK 永久留着旧值。这是永久分叉，不是细节。
    const { wrapper, state } = await mountProbe({});
    const constructed = constructedCount();
    const overlay = currentOverlay();
    overlay.callLog.length = 0;

    // 让 setTitle 抛错。批里两个键，`title` 必须排在 `zIndex` **之后**
    // （Driver 按 `Object.entries` 的插入序逐键调用）。
    (overlay as unknown as { setTitle: (v: string) => void }).setTitle = () => {
      throw new Error("setTitle failed");
    };

    state.zIndex = 5;
    state.title = "b";
    await settle();
    expect(overlay.callLog, "zIndex 的 setter 真的被调用过").toContain("setZIndex");
    expect(constructedCount(), "这次 setOptions 整体失败了，不重建").toBe(constructed);

    // 现在把 zIndex 撤回去：尽管那一批「整体失败」，zIndex 已经进过 SDK
    state.zIndex = undefined;
    await settle();

    expect(constructedCount(), "部分成功的那一笔也必须能被撤回").toBe(constructed + 1);
    expect(harness.attached("overlay")).toBe(1);
    expect(currentOverlay().callLog, "新实例回到 SDK 默认").toEqual([]);

    await unmountAndSettle(wrapper);
    harness.assertIdle("部分成功后撤回");
  });
});
