/**
 * `Panorama.links` 的落地门禁（issue #165 Class 3 / TASK 5）
 *
 * ## 这条用例在钉一个「自相矛盾」的缺口
 *
 * `driver/jsapi-v4/panorama.ts` 的旧注释写「`tiles` / `links` 是渲染细节，不透出」，
 * 理由是**没有消费者**。但事实是：
 *
 * - `<Panorama>` **已经**声明并派发了 `linksChange`（`Panorama.vue`）——消费者存在；
 * - 官方的 React 参考实现暴露了 `getLinks()`；
 * - 官方 `panorama/Panorama.d.ts` 声明了 `getLinks(): PanoramaLink[]`。
 *
 * 也就是说：**消费者有、数据路径没有**。#165 的判据是「补齐缺失的官方能力」，
 * 这一条正好落在里面。而同一句注释里的 `tiles` 是**真的**渲染内部（官方
 * `PanoramaTileData` 是瓦片贴图，不是业务可消费的数据），**保持丢弃**。
 *
 * ## 投影而非透传
 *
 * 官方 `PanoramaLink` 的八个成员**全是可选**（`description?` / `heading?` / `id?` /
 * `dir?` / `refinedDir?` / `x?` / `y?` / `roadWidth?`，见 `panorama/PanoramaLink.d.ts`）。
 * 投影因此是「**逐字段按类型收窄，取不到就置 undefined**」——不编默认值
 * （`heading ?? 0` 会把「上游没给方位」与「正北」混成同一个数）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
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

const POINT = { lng: 116.404, lat: 39.915 };

function lastViewer(): AnyRecord {
  const viewer = fake.createdPanoramas.at(-1);
  if (!viewer) throw new Error("还没有创建查看器");
  return viewer as unknown as AnyRecord;
}

async function mountPanorama(props: Record<string, unknown> = {}, on?: Record<string, unknown>) {
  const wrapper = mount(
    defineComponent({
      setup: () => () => h(MapComponent, { provider: harness.provider() }, () => [h(Panorama, { point: POINT, ...props, ...on })]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return wrapper;
}

describe("Panorama.getLinks / linksChange 载荷（TASK 5）", () => {
  it("linksChange 带上真实的 PanoramaLink[] 载荷（此前是**空载荷**）", async () => {
    const seen = ref<unknown>(undefined);
    const wrapper = await mountPanorama(
      {},
      { onLinksChange: (links: unknown) => (seen.value = links) },
    );
    const viewer = lastViewer();

    // 官方 `PanoramaLink` 的八个成员全是可选的
    viewer.links = [
      {
        description: "天安门广场",
        heading: 92,
        id: "pano-2",
        dir: 45,
        refinedDir: 47,
        x: 1,
        y: 2,
        roadWidth: 12,
      },
    ];
    viewer.emit("links_changed");
    await nextTick();

    expect(seen.value, "linksChange 必须带上面包链接的载荷").toEqual([
      {
        description: "天安门广场",
        heading: 92,
        id: "pano-2",
        dir: 45,
        refinedDir: 47,
        x: 1,
        y: 2,
        roadWidth: 12,
      },
    ]);

    wrapper.unmount();
    await settle();
  });

  it("缺字段不编默认值（`heading ?? 0` 会把「没给方位」与「正北」混成同一个数）", async () => {
    const seen = ref<AnyRecord[]>([]);
    const wrapper = await mountPanorama(
      {},
      { onLinksChange: (links: unknown) => (seen.value = links as AnyRecord[]) },
    );
    const viewer = lastViewer();

    viewer.links = [{ id: "pano-3" }, { id: "pano-4", heading: 0 }];
    viewer.emit("links_changed");
    await nextTick();

    expect(seen.value[0]).toEqual({ id: "pano-3" });
    expect(seen.value[0]!.heading, "缺字段不得被补成 0").toBeUndefined();
    // 真给 0 与「没给」必须在投影后仍可区分
    expect(seen.value[1]!.heading).toBe(0);

    wrapper.unmount();
    await settle();
  });

  it("官方没有 getLinks / 拿不到时给空数组（不是 undefined、不抛错）", async () => {
    const seen = ref<unknown>(undefined);
    const wrapper = await mountPanorama(
      {},
      { onLinksChange: (links: unknown) => (seen.value = links) },
    );
    const viewer = lastViewer();
    viewer.links = undefined;
    viewer.emit("links_changed");
    await nextTick();
    expect(seen.value).toEqual([]);

    wrapper.unmount();
    await settle();
  });

  it("expose 的 getLinks() 可按需读回（官方 React 参考实现也暴露它）", async () => {
    const vm = ref<AnyRecord | null>(null);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(Panorama, { point: POINT, ref: (v: unknown) => (vm.value = v as AnyRecord) }),
          ]),
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();

    lastViewer().links = [{ id: "pano-5", heading: 12 }];
    expect(vm.value!.getLinks()).toEqual([{ id: "pano-5", heading: 12 }]);

    wrapper.unmount();
    await settle();
  });
});
