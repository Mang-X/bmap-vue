/**
 * 覆盖物 `defineExpose` 命令面门禁（issue #165 Class 3 / TASK 2）
 *
 * ## 这条用例在钉什么
 *
 * `grep -n defineExpose src/components/overlays/*.vue src/components/controls/*.vue` 在
 * #165 之前返回 **0 命中**：27 个组件一个命令面都没有。于是官方这一整族公开方法在本库
 * **没有任何调用路径**：
 *
 * | 官方声明 | 出处 |
 * | --- | --- |
 * | `setLabel(label: Label): void` / `getLabel(): Label` | `overlay/Marker.d.ts` |
 * | `setRotationOrigin(angle: number): void` | `overlay/Marker.d.ts`（"正北方向顺时针旋转角度，取值范围 [0, 360]"） |
 * | `setRank(rank: number): void` / `getRank(): number` | `overlay/Marker.d.ts`（"数值越高，权重越高"） |
 * | `closePlaceDetail(): void` | `overlay/Marker.d.ts` |
 * | `setPositionAt(index: number, point: Point): void` | `overlay/Polyline.d.ts` |
 * | `setPositionAt(index: number, point: Point, deep?: number): void` | `overlay/Polygon.d.ts` |
 * | `getTitle()` / `getContent()` / `isOpen()` / `getOffset()` / `maximize()` / `restore()` | `overlay/InfoWindow.d.ts` |
 * | `getItem(index)` / `removeItem(item)` / `removeSeparator(index)` / `getDom()` / `show()` / `hide()` | `context-menu/ContextMenu.d.ts` |
 * | `setText(text: string): void` / `enable(): void` | `context-menu/MenuItem.d.ts` |
 * | `show(): void` / `hide(): void` | `panorama/PanoramaLabel.d.ts` |
 *
 * ## 三条硬判据（每条都有用例，不是注释）
 *
 * 1. **可观察效果**：调了命令 ⇒ **SDK 入口真的被调用**（Fake 的 `callLog` 是证据）。
 *    只断言「方法存在」会让一个空壳实现也绿。
 * 2. **释放后显式失败**：`BMAP_RESOURCE_DISPOSED`，**不是**静默 no-op、不是 `undefined`。
 *    依据：`core/overlays/overlayCommands.ts` 文件头第 2 条——静默会让调用方把
 *    「资源已释放」误判成「SDK 说没有」。
 * 3. **不交出 raw SDK 对象**：官方的 `ContextMenu#getItem(): MenuItem` 返回 raw 实例，
 *    `#removeItem(item)` 收 raw 实例。本库改按**序号**（`getItem(index)` 返回本库自己的
 *    条目模型，`removeItem(index)` 收序号）——官方 `MenuItem` 上**没有任何 getter**
 *    （`context-menu/MenuItem.d.ts` 只有 `setText` / `enable` / `disable`），
 *    所以「读回」只可能来自本库模型。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Circle from "../../packages/bmap-vue/src/components/overlays/Circle.vue";
import Marker from "../../packages/bmap-vue/src/components/overlays/Marker.vue";
import Polygon from "../../packages/bmap-vue/src/components/overlays/Polygon.vue";
import Polyline from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import Rectangle from "../../packages/bmap-vue/src/components/overlays/Rectangle.vue";
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

function currentOverlay(): AnyRecord {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  const raw = (map?.overlays as unknown as AnyRecord[])?.[0];
  if (!raw) throw new Error("地图上还没有覆盖物");
  return raw;
}

const PATH = [
  { lng: 116.4, lat: 39.9 },
  { lng: 116.5, lat: 40 },
];
const BOUNDS = {
  southwest: { lng: 116.3, lat: 39.8 },
  northeast: { lng: 116.5, lat: 40 },
};

type Exposed = Record<string, (...args: never[]) => unknown>;

/** 挂 `<Map><Child/></Map>` 并把 `<Child>` 的 expose 取出来。 */
async function mountExposed(component: unknown, props: Record<string, unknown> = {}) {
  const exposed = ref<Exposed | null>(null);
  const Host = defineComponent({
    setup() {
      return () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(component as never, { ...props, ref: (v: unknown) => (exposed.value = v as Exposed) }),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: harness.container() });
  await settle();
  await settle();
  return { wrapper, exposed, vm: exposed.value! };
}

/* ------------------------------------------------------------------------- Marker */

describe("<Marker> 命令面", () => {
  const props = { position: PATH[0]! };

  it("getRank / setRank / setRotationOrigin：SDK 入口真的被调用，且读回与写入一致", async () => {
    const { wrapper, vm } = await mountExposed(Marker, props);
    const raw = currentOverlay();
    raw.callLog.length = 0;

    vm.setRank!(7 as never);
    expect(raw.callLog, "setRank 必须落到 SDK").toContain("setRank");
    expect(vm.getRank!() as never).toBe(7);

    vm.setRotationOrigin!(90 as never);
    expect(raw.callLog, "setRotationOrigin 必须落到 SDK").toContain("setRotationOrigin");
    expect(raw.rotationOrigin).toBe(90);

    wrapper.unmount();
    await settle();
    harness.assertIdle("Marker 命令面");
  });

  it("getTitle / getOffset / getRotation / getPosition 返回领域值（不是 raw SDK 对象）", async () => {
    const { wrapper, vm } = await mountExposed(Marker, { ...props, title: "天安门" });
    expect(vm.getTitle!() as never).toBe("天安门");
    // raw `BMap.Size` 是 `{width, height}`；领域 Pixel 是 `{x, y}`
    const offset = vm.getOffset!() as unknown as AnyRecord;
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.width, "不得把 raw BMap.Size 直接交出去").toBeUndefined();
    expect(vm.getPosition!() as never).toEqual({ lng: 116.4, lat: 39.9 });

    wrapper.unmount();
    await settle();
  });

  it("closePlaceDetail：落到 SDK（无参命令不需要任何 raw 对象）", async () => {
    const { wrapper, vm } = await mountExposed(Marker, props);
    const raw = currentOverlay();
    raw.callLog.length = 0;
    vm.closePlaceDetail!();
    expect(raw.callLog).toContain("closePlaceDetail");

    wrapper.unmount();
    await settle();
  });

  it("释放后调用 → 显式抛 BMAP_RESOURCE_DISPOSED，绝不静默 no-op", async () => {
    const { wrapper, vm } = await mountExposed(Marker, props);
    wrapper.unmount();
    await settle();

    for (const command of ["getRank", "getTitle", "getPosition"] as const) {
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

/* ----------------------------------------------------------------- setPositionAt */

describe("setPositionAt（Polyline / Polygon）", () => {
  it("Polyline：只两个参数，落到 SDK", async () => {
    const { wrapper, vm } = await mountExposed(Polyline, { points: PATH });
    const raw = currentOverlay();
    raw.callLog.length = 0;
    vm.setPositionAt!(0, { lng: 117, lat: 40 } as never);
    expect(raw.callLog).toContain("setPositionAt");
    // Polyline 的官方签名只有两个参数 ⇒ `deep` 不得被"补"进去
    expect(raw.positionAtArgs).toHaveLength(2);
    expect(raw.path[0]).toMatchObject({ lng: 117, lat: 40 });

    wrapper.unmount();
    await settle();
  });

  it("Polygon：deep 参数被原样透传为第三个位置参数（官方 Polygon 才有这个参数）", async () => {
    const { wrapper, vm } = await mountExposed(Polygon, { points: PATH });
    const raw = currentOverlay();
    raw.callLog.length = 0;

    vm.setPositionAt!(0, { lng: 117, lat: 40 } as never, { deep: 1 } as never);
    expect(raw.callLog).toContain("setPositionAt");
    // 关键断言是**参数个数**：deep 必须真的落到 SDK 的第三个位置参数上，
    // 而不是被本库当未知参数丢掉。
    expect(raw.positionAtArgs, "deep 必须原样传给官方 setPositionAt").toEqual([
      0,
      expect.objectContaining({ lng: 117, lat: 40 }),
      1,
    ]);

    wrapper.unmount();
    await settle();
  });

  it("Polyline 传 deep → BMAP_INVALID_ARGUMENT（官方签名只有两个参数，不静默吞）", async () => {
    const { wrapper, vm } = await mountExposed(Polyline, { points: PATH });
    let thrown: unknown = null;
    try {
      vm.setPositionAt!(0, { lng: 117, lat: 40 } as never, { deep: 1 } as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BMapError);
    expect((thrown as BMapError).code).toBe("BMAP_INVALID_ARGUMENT");
    wrapper.unmount();
    await settle();
  });
});

/* ---------------------------------------------------------------------- 读回族 */

describe("图形族读回（Circle / Polygon / Rectangle）", () => {
  it("Circle：getCenter / getRadius / getBounds / 描边填充读回，返回领域值", async () => {
    const { wrapper, vm } = await mountExposed(Circle, {
      center: PATH[0],
      radius: 100,
      strokeColor: "#123456",
      fillColor: "#654321",
    });
    expect(vm.getCenter!() as never).toEqual({ lng: 116.4, lat: 39.9 });
    expect(vm.getRadius!() as never).toBe(100);
    expect(vm.getStrokeColor!() as never).toBe("#123456");
    expect(vm.getFillColor!() as never).toBe("#654321");
    // `getBounds()` 的 raw 是 BMap.Bounds（sw/ne 是 BMap.Point）；领域值必须已投影
    const bounds = vm.getBounds!() as unknown as AnyRecord;
    expect(bounds.southwest).toMatchObject({ lng: expect.any(Number) });

    wrapper.unmount();
    await settle();
  });

  it("Rectangle / Polygon：getBounds + 填充读回", async () => {
    const rect = await mountExposed(Rectangle, { bounds: BOUNDS });
    expect((rect.vm.getBounds!() as never) as AnyRecord).toMatchObject({
      southwest: { lng: 116.3, lat: 39.8 },
    });
    rect.wrapper.unmount();
    await settle();

    const poly = await mountExposed(Polygon, { points: PATH, fillColor: "#00ff00" });
    expect(poly.vm.getFillColor!() as never).toBe("#00ff00");
    poly.wrapper.unmount();
    await settle();
  });

  it("释放后读回 → BMAP_RESOURCE_DISPOSED（不是 undefined）", async () => {
    const { wrapper, vm } = await mountExposed(Circle, { center: PATH[0], radius: 100 });
    wrapper.unmount();
    await settle();
    let thrown: unknown = null;
    try {
      vm.getRadius!() as never;
    } catch (error) {
      thrown = error;
    }
    expect((thrown as BMapError)?.code).toBe("BMAP_RESOURCE_DISPOSED");
  });
});

/* ---------------------------------------------------------------- 刻意不做的一组 */

describe("刻意不做（逐条有依据，不是遗漏）", () => {
  it("Polyline 不暴露 getFillColor / getFillOpacity（官方 Polyline 没有填充）", async () => {
    const { wrapper, vm } = await mountExposed(Polyline, { points: PATH });
    let thrown: unknown = null;
    try {
      vm.getFillColor!() as never;
    } catch (error) {
      thrown = error;
    }
    expect((thrown as BMapError)?.code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    wrapper.unmount();
    await settle();
  });

  it("Marker 不暴露 openPlaceDetail：入参是 raw BMap.PlaceDetail，本库没有这个 Driver 资源", async () => {
    const { wrapper, vm } = await mountExposed(Marker, { position: PATH[0] });
    // 收一个 `any` 形参等于 AGENTS.md 说的「收下但没人读的假支持」——刻意不给。
    expect(Object.keys(vm)).not.toContain("openPlaceDetail");
    expect(Object.keys(vm)).toContain("closePlaceDetail");
    wrapper.unmount();
    await settle();
  });
});
