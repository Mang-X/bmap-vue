/**
 * `Panorama.capture()` / `Panorama.clearOverlays()` 的落地门禁（issue #171 item I）
 *
 * ## 这条用例在补什么
 *
 * `driver/types/panorama.ts` 的文件头曾把 `capture()` / `clearOverlays()` 列为
 * **刻意不加**的官方成员，理由是「当前没有组件或 composable 会调用它们」。
 * 官方 React 参考实现（`/tmp/ref2/src/components/Panorama/PanoramaRef.ts`）两条都暴露，
 * 而 2026-09 的 live probe 确认**运行时真的可用**（`capture()` 返回了 1,639 字节的 data URL，
 * `clearOverlays()` 不抛错）。因此那条理由现在**不成立**：`clearOverlays` 还有一个本库
 * 造不出来的真实场景——`<PanoramaLabel>` 的归属是「谁挂谁摘」，「一次清掉全部」只能走
 * 官方这条入口。
 *
 * ## 三条口径
 *
 * 1. **`capture()` 是读命令，返回 `string | null`**。官方声明是 `string | undefined`
 *    （「当前渲染器不支持截图时返回 undefined」），Driver 把它归一成 `null`，与本库读取面
 *    其它成员的 `null = 读不到` 口径一致（`getPosition` / `getPov` / `getId` …）。
 *    **但未就绪不是 `null`**：未就绪 / 已释放时**显式抛 `BMAP_RESOURCE_DISPOSED`**
 *    （见 `Panorama.vue` 的注释）——静默返回 `null` 会让调用方把「组件已卸载」误判成
 *    「这个渲染器不支持截图」，而这两件事要采取的行动完全不同。
 * 2. **`clearOverlays()` 是写命令，未就绪时显式失败**（绝不静默 no-op：清不掉却报告成功
 *    会让「重新开始布置标注」的流程静默画出叠加在一起的旧标注）。
 * 3. **不镜像**：两条都不进组件状态、不做命令 ⇄ props 同步。`options` 才是主模型。
 *
 * ## Fake 的两处补充（只补这两处，不扩面）
 *
 * - `FakeV4Panorama#capture` **此前没有**（Fake 有 `clearOverlays`，但那是 #41 为标注
 *   释放路径预置的，没有测试消费）；`screenshot` 字段建模官方「不支持截图 → undefined」那条
 *   路径，`failNextCapture` 建模抛错路径。
 * - `FakeV4PanoramaService#byId` 的 **`links` 缺口仍然开着**：官方 `PanoramaData` 声明
 *   `links: PanoramaLink[]`（非可选），而 Fake 的回包只给了 `id` / `description` / `position`。
 *   后果是「检索结果里带 links」这条路径**测不到**——而 `PanoramaDataInfo` 刻意**不**透出
 *   `links`（`tiles` 才是真的渲染内部，见 `driver/jsapi-v4/panorama.ts` 的注释）。
 *   本票把 `byId` / `byLocation` 的回包补上 `links`，并由 Driver 单测钉住「`links` 被丢弃」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";
import PanoramaLabel from "../../packages/bmap-vue/src/components/panorama/PanoramaLabel.vue";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import { createJsapiV4EventDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4PanoramaDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/panorama";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";
import type { PanoramaViewerDriver } from "../../packages/bmap-vue/src/driver/types/panorama";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import { createFakeV4Harness, type FakeV4Harness } from "../../packages/test-utils";

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

function lastLabelCount(): number {
  return fake.diagnostics.snapshot().leaks.panoramaLabels;
}

async function mountPanorama(props: Record<string, unknown> = {}, slots?: () => unknown) {
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(Panorama, { point: POINT, ...props }, slots ? (slots as never) : undefined),
        ]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return wrapper;
}

/**
 * 挂载并抓住组件 ref（命令面只能从 ref 进）。
 *
 * ⚠️ **卸载后 Vue 会把模板 ref 回调成 `null`**，因此这里抓的是**那个 expose 对象本身**
 * （不是 `ref` 容器）——「组件已卸载之后命令会怎样」正是用例要断言的行为，用
 * `wrapper.findComponent().vm` 会在卸载后随组件一起变 `null`，测不到东西。
 */
async function mountWithExpose() {
  let exposed: AnyRecord | null = null;
  const wrapper = await mountPanoramaWithRef(
    (value: unknown) => {
      // 卸载时 Vue 回调 `null`；只在拿到真对象时记录，保留卸载前那一份
      if (value) exposed = value as AnyRecord;
    },
    {},
  );
  return { wrapper, expose: () => exposed! };
}

async function mountPanoramaWithRef(
  setRef: (value: unknown) => void,
  props: Record<string, unknown>,
  slots?: () => unknown,
) {
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          h(Panorama, { point: POINT, ...props, ref: setRef }, slots as never),
        ]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return wrapper;
}

// ---------------------------------------------------------------- Driver 层
describe("v4 Panorama Facet：capture / clearOverlays", () => {
  let driverFake: FakeBMapV4;
  let registry: ReturnType<typeof createJsapiV4HandleRegistry>;
  let panorama: PanoramaViewerDriver;

  beforeEach(() => {
    driverFake = createFakeBMapV4();
    registry = createJsapiV4HandleRegistry();
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: driverFake.namespace.VERSION,
      rawSdk: driverFake.namespace,
      unsupported: "throw",
    });
    const geometry = createJsapiV4GeometryDriver(driverFake.namespace);
    panorama = createJsapiV4PanoramaDriver({
      rawSdk: driverFake.namespace,
      geometry,
      capabilities,
      registry,
      events: createJsapiV4EventDriver({ registry, geometry }),
    });
  });

  /** 造一个查看器，返回 Driver 句柄与 Fake raw（供按字段注入故障 / 读 callLog）。 */
  function newViewer(): { handle: ReturnType<PanoramaViewerDriver["create"]>; raw: AnyRecord } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = panorama.create(container);
    return { handle, raw: driverFake.createdPanoramas.at(-1) as unknown as AnyRecord };
  }

  it("capture 把选项透传给官方单参调用，并原样交回字符串", () => {
    const { handle, raw } = newViewer();
    raw.screenshot = "data:image/png;base64,AAAA";

    expect(panorama.capture(handle)).toBe("data:image/png;base64,AAAA");
    expect(raw.callLog).toContain("capture:args=0");

    expect(panorama.capture(handle, { quality: 0.8, type: "image/jpeg" })).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(raw.callLog).toContain("capture:args=1:quality=0.8,type=image/jpeg");
  });

  it("官方给 undefined（渲染器不支持截图）时归一成 null", () => {
    const { handle, raw } = newViewer();
    raw.screenshot = undefined;
    expect(panorama.capture(handle)).toBeNull();
  });

  it("SDK 调用抛错时上抛 BMapError（不降级成 null）", () => {
    const { handle, raw } = newViewer();
    raw.failNextCapture = new Error("capture exploded");
    expect(() => panorama.capture(handle)).toThrowError(/capture exploded/);
  });

  it("clearOverlays 打到官方入口", () => {
    const { handle, raw } = newViewer();
    panorama.clearOverlays(handle);
    expect(raw.callLog).toContain("clearOverlays");
  });

  it("检索回包里的 links 被丢弃（官方 PanoramaData.links 非可选；tiles 同样不透出）", async () => {
    const service = panorama.createService();
    const raw = driverFake.createdPanoramaServices.at(-1) as unknown as AnyRecord;
    expect(raw.byId.links, "Fake 的检索回包必须真的带 links，否则这条丢弃断言是空的").toEqual([
      { id: "pano-2", heading: 45, description: "天安门广场" },
    ]);

    const result = await panorama.findById(service, "pano-1").result;
    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      id: "pano-1",
      description: "天安门全景",
      position: { lng: 116.404, lat: 39.915 },
    });
  });
});

// ---------------------------------------------------------------- 组件层
describe("Panorama.capture()：读命令，未就绪显式失败", () => {
  it("返回 Fake 的 data URL 字符串；不给选项时走官方单参重载", async () => {
    const { wrapper, expose } = await mountWithExpose();
    const viewer = lastViewer();

    viewer.screenshot = "data:image/png;base64,AAAA";
    expect(expose().capture()).toBe("data:image/png;base64,AAAA");
    // 官方 `capture(options?)` 的 options 是可选的：不给就不该把 undefined 塞进去
    expect(viewer.callLog).toContain("capture:args=0");

    expect(expose().capture({ quality: 0.8, type: "image/jpeg" })).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(viewer.callLog).toContain("capture:args=1:quality=0.8,type=image/jpeg");

    wrapper.unmount();
    await settle();
    harness.assertIdle("capture 之后卸载");
  });

  it("官方返回 undefined（不支持截图）时给 null，不抛错", async () => {
    const { wrapper, expose } = await mountWithExpose();
    lastViewer().screenshot = undefined;
    expect(expose().capture()).toBeNull();

    wrapper.unmount();
    await settle();
  });

  it("SDK 抛错时上抛（null 的含义是「读不到」，不是「调用炸了」）", async () => {
    const { wrapper, expose } = await mountWithExpose();
    lastViewer().failNextCapture = new Error("capture exploded");
    expect(() => expose().capture()).toThrowError(/capture exploded/);

    wrapper.unmount();
    await settle();
  });

  it("已卸载后显式抛错（不是 null、不是静默 no-op）", async () => {
    const { wrapper, expose } = await mountWithExpose();
    wrapper.unmount();
    await settle();

    expect(() => expose().capture()).toThrowError(expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }));
  });
});

describe("Panorama.clearOverlays()：写命令，未就绪显式失败", () => {
  it("打到官方入口，并让标注的挂载账仍然平衡", async () => {
    const wrapper = await mountPanorama({}, () => [
      h(PanoramaLabel, { content: "A", position: POINT }),
      h(PanoramaLabel, { content: "B", position: POINT }),
    ]);
    const viewer = lastViewer();
    expect(viewer.overlays).toHaveLength(2);
    expect(lastLabelCount()).toBe(2);

    (wrapper.findComponent(Panorama).vm as unknown as AnyRecord).clearOverlays();

    expect(viewer.callLog).toContain("clearOverlays");
    // ⚠️ **不再是** `[]`（#174 P1-2）：官方那条命令清掉的是**全部**覆盖物，而官方没有枚举接口，
    // 所以本库管理的标注由 `clearOverlays` **按名册重新挂回**——挂的是**同一个句柄**，
    // 因此标注的归属不与画面分叉（清掉之后子组件仍「以为」自己挂着，后续 prop 变化就会
    // 打进一个不在画面上的句柄）。逐条取舍与对外语义见
    // `panorama-clear-overlays-labels.test.ts` 的文件头。
    expect(viewer.overlays, "本库管理的标注被重新挂回").toHaveLength(2);
    // 挂载账是**按次数**销的：清一次销两个、挂回两次又记两个 ⇒ 净账不变。
    expect(lastLabelCount(), "重新挂回之后挂载账仍然平衡").toBe(2);

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 之后卸载");
  });

  it("清空**不**代替摘除路径：卸载后仍然归零（不重复销账、不漏销账）", async () => {
    const wrapper = await mountPanorama({}, () => [
      h(PanoramaLabel, { content: "A", position: POINT }),
    ]);
    (wrapper.findComponent(Panorama).vm as unknown as AnyRecord).clearOverlays();

    wrapper.unmount();
    await settle();
    harness.assertIdle("clearOverlays 之后卸载");
  });

  it("已卸载后显式抛错（清不掉却报告成功会让标注静默叠加）", async () => {
    const { wrapper, expose } = await mountWithExpose();
    const viewer = lastViewer();
    wrapper.unmount();
    await settle();

    expect(() => expose().clearOverlays()).toThrowError(expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }));
    expect(viewer.callLog.filter((entry: string) => entry === "clearOverlays")).toHaveLength(0);
  });
});
