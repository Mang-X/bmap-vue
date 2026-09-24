/**
 * Marker 图标：descriptor → `BMap.Icon` 的**两条路径**与有界缓存（M5-SPEC-MARKER / #30）
 *
 * 外部评审 P2 之后，图标构造分成两条路径，本文件把这条边界锁住：
 *
 * | 路径 | 使用者 | 是否共享实例 |
 * | --- | --- | --- |
 * | `driver.overlays.buildIcon()`（**公共**） | `useBMapMarkerIcons()` 等业务代码 | **不共享**：每次调用新建，调用方拿到的是自己的可变对象 |
 * | Marker 的构造 / `setIcon`（**库内部**） | `<BMarker icon=...>` | **共享**：同 descriptor 命中同一个有界 LRU 缓存 |
 *
 * 为什么公共路径必须新建：`BMap.Icon` 有 `setImageUrl` / `setSize` / `setAnchor` 等可变面，而
 * `useBMapMarkerIcons()` 把结果直接交给调用方——公共 API 交出缓存持有的共享对象，会让一个消费者
 * 的修改污染同一 Client 下所有地图后续拿到的图标。
 *
 * 验收标准里的「重复配置命中 cache 且有上限」由 Marker 路径的用例覆盖：
 * - **命中**：同 descriptor 的两个 Marker 拿到**同一个** raw Icon（不是「看起来一样」）；
 * - **有界**：连换 200+ 个不同 descriptor 之后，最早那个被淘汰（再取会新建，而不是永远命中）。
 *
 * 走**默认路径**装 Client / 组件（`createFakeV4Client` / `createFakeV4Harness`），因此这里测到的
 * 就是 `<BMarker icon=...>` 实际会走的那条链。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import BMap from "../../packages/bmap-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/bmap-vue/src/components/overlays/BMarker.vue";
import {
  createFakeBMapV4,
  createFakeV4Client,
  createFakeV4Harness,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Icon,
  type FakeV4Marker,
} from "../../packages/test-utils";
import type { MarkerIconInput } from "../../packages/bmap-vue/src/driver/types/overlays";
import type { BMarkerProps } from "../../packages/bmap-vue/src/types/components";
import { DEFAULT_ICON_CACHE_SIZE } from "../../packages/bmap-vue/src/core/icons/iconCache";

async function iconBuilder() {
  const fake = createFakeBMapV4();
  const { client } = await createFakeV4Client(fake);
  return {
    fake,
    build: (input: MarkerIconInput): FakeV4Icon =>
      client.driver.overlays.buildIcon(input) as FakeV4Icon,
  };
}

const custom = (imageUrl: string): MarkerIconInput => ({
  imageUrl,
  size: { width: 10, height: 20 },
});

const descriptor = (index: number): BMarkerProps["icon"] => ({
  imageUrl: `https://example.com/sprite-${index}.png`,
  size: { width: 10, height: 10 },
});

describe("公共 buildIcon：不交出共享对象（P2 的隔离契约）", () => {
  it("同一份配置每次调用都返回**新的** Icon（调用方可以安全地持有 / 修改）", async () => {
    const { build } = await iconBuilder();
    const first = build(custom("https://example.com/a.png"));
    const second = build(custom("https://example.com/a.png"));
    const third = build(custom("https://example.com/a.png"));

    expect(second).not.toBe(first);
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
    // 但内容（投影出来的构造参数）必须一致
    expect(second.imageOffset).toEqual(first.imageOffset);
    expect(second.size).toEqual(first.size);

    // 消费者修改自己那份不影响下一次调用（缓存不会把这份还回去）
    second.image = "mutated-by-consumer";
    expect(build(custom("https://example.com/a.png")).image).toBe(
      "https://example.com/a.png",
    );
  });

  it("内置名解析到各自的雪碧图格子（20 个名字不再回落 simple_red）", async () => {
    const { build } = await iconBuilder();
    const red5 = build("red5");
    const simpleRed = build("simple_red");
    expect(red5.imageOffset).toMatchObject({ width: 76, height: 0 });
    expect(red5.size).toMatchObject({ width: 19, height: 19 });
    expect(red5.imageSize).toMatchObject({ width: 300, height: 300 });
    expect(simpleRed.imageOffset).toMatchObject({ width: 227, height: 189 });

    // start / end 走内联 SVG（历史行为），并带自己的锚点
    const start = build("start");
    expect(start.imageUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(start.anchor).toMatchObject({ width: 12, height: 16 });
  });

  it("未知内置名按兜底图标渲染（只可能来自 JS / any 调用方）", async () => {
    const { build } = await iconBuilder();
    expect(build("no_such_icon" as MarkerIconInput).imageUrl).toBe(
      build("simple_red").imageUrl,
    );
  });
});

describe("Marker 路径：同 descriptor 命中缓存，且有上限", () => {
  let harness: FakeV4Harness;
  let fake: FakeBMapV4;

  beforeEach(() => {
    ({ harness, fake } = createFakeV4Harness());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function settle() {
    await flushPromises();
    await nextTick();
  }

  function markers(): FakeV4Marker[] {
    return fake.createdMaps[fake.createdMaps.length - 1]!.overlays as unknown as FakeV4Marker[];
  }

  it("两个 Marker 用同一份图标配置时共用同一个 BMap.Icon 实例", async () => {
    const icon: BMarkerProps["icon"] = {
      imageUrl: "https://example.com/shared.png",
      size: { width: 12, height: 12 },
    };
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, icon }),
              h(BMarker, { position: { lng: 116.5, lat: 39.95 }, icon }),
              h(BMarker, { position: { lng: 116.6, lat: 39.96 }, icon: descriptor(1) }),
            ]);
        },
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();

    const [first, second, third] = markers();
    expect(markers()).toHaveLength(3);
    // 同配置 ⇒ 同一个实例（缓存命中）；不同配置 ⇒ 各自新建
    expect(second!.icon).toBe(first!.icon);
    expect(third!.icon).not.toBe(first!.icon);

    wrapper.unmount();
    await settle();
    harness.assertIdle("图标缓存命中");
  });

  it("写满上限后最久未用的条目被淘汰（缓存不是无界的）", async () => {
    const icon = ref<BMarkerProps["icon"]>(descriptor(0));
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, icon: icon.value }),
            ]);
        },
      }),
      { attachTo: harness.container() },
    );
    await settle();

    const oldest = markers()[0]!.icon;
    expect(oldest).not.toBeNull();

    // 依次换入 DEFAULT_ICON_CACHE_SIZE 个**不同**的 descriptor：
    // 插入总数 = 1（建实例时）+ N ⇒ 必然超过上限，最早那条被淘汰
    for (let i = 1; i <= DEFAULT_ICON_CACHE_SIZE; i++) {
      icon.value = descriptor(i);
      await settle();
    }

    icon.value = descriptor(0);
    await settle();
    const rebuilt = markers()[0]!.icon;
    // 已淘汰 ⇒ 不是当初那个实例（若缓存无界，这里会命中同一个，用例会红）
    expect(rebuilt).not.toBe(oldest);

    // 再取一次仍然命中刚建的那一份（缓存本身工作正常）
    icon.value = descriptor(1);
    await settle();
    icon.value = descriptor(0);
    await settle();
    expect(markers()[0]!.icon).toBe(rebuilt);

    wrapper.unmount();
    await settle();
    harness.assertIdle("图标缓存上限");
  });
});
