/**
 * Fake Map v4 上的**全量** Driver Contract（M3A3-FAKE-DUAL / issue #24）
 *
 * 与 `jsapi-v4-*.test.ts` 的分工：那些文件把契约跑在**手工组合的 facet** 或装配后的
 * `createJsapiV4Driver` 上；这里跑的是 `runMapDriverContract` —— 需要 `BMapClient` 的那一层，
 * 也就是组件默认路径真正会拿到的对象（Provider 归一 → 默认 Driver 工厂 → Client 组装）。
 *
 * issue #24 的验收标准之一是「Fake v4 能支撑普通 PR 的全部行为测试」：那意味着共享契约必须
 * 在 Fake v4 上**全通过**，而不是只在 webgl-v1 上通过（此前只有后者，见
 * `tests/behavior/v4-driver-contract.test.ts`）。契约里凡是两个引擎都必须满足的部分
 * （Map / Overlay / Control / Layer 的构造-挂载-更新-摘除、非 Map 目标必须失败、
 * 属性分类一致）都在这一份里得到验证。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeV4Client } from "../../packages/test-utils";
import {
  runMapDriverContract,
  type DriverHarness,
} from "../../packages/test-utils/driver-contract";
import type { FakeBMapV4, FakeV4Map } from "../../packages/test-utils";
import type { BMapClient } from "../../packages/bmap-vue/src/client/types";
import type { OverlayTarget } from "../../packages/bmap-vue/src/driver/types/overlays";

let fake: FakeBMapV4;
let client: BMapClient;

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  return el;
}

function createHarness(): DriverHarness {
  return {
    client: () => client,
    container: () => sizedContainer(),
  };
}

beforeEach(async () => {
  const created = await createFakeV4Client();
  fake = created.fake;
  client = created.client;
});

runMapDriverContract(createHarness);

describe("v4 client 路径的契约前提（#24）", () => {
  it("契约跑的是默认路径装出来的 v4 Client，不是手搓的 Driver", () => {
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver.engine).toBe("jsapi-v4");
    expect(client.sdkVersion).toBe("4.0");
    // Provider 归一之后版本来自结构化加载结果，而不是 Driver 自己探测
    expect(client.rawSdk).toBe(fake.namespace);
  });

  it("v4 独有 facet 也在同一个 Client 上（契约之外的回归面）", () => {
    expect(client.driver.capabilities.supports("service.geocoder")).toBe(true);
    expect(client.driver.capabilities.supports("panorama.viewer")).toBe(true);
    expect(client.driver.capabilities.supports("layer.heatmap")).toBe(true);
  });

  it("完整的创建-挂载-摘除-销毁循环之后诊断归零（Fake v4 自身也被契约覆盖）", () => {
    fake.diagnostics.reset();
    const map = client.driver.map.create(sizedContainer());
    const target: OverlayTarget = { kind: "map", handle: map };

    // 每个 facet 各挂一个，再摘掉：诊断必须逐项回到 0，而不是只看总量
    const marker = client.driver.overlays.createMarker({ lng: 116.4, lat: 39.9 });
    const control = client.driver.controls.create("zoom");
    const layer = client.driver.layers.create("tile");
    client.driver.overlays.add(target, marker);
    client.driver.controls.add(target, control);
    client.driver.layers.add(target, layer);

    expect(fake.diagnostics.snapshot().leaks).toMatchObject({
      maps: 1,
      overlays: 1,
      controls: 1,
      layers: 1,
    });

    client.driver.overlays.remove(target, marker);
    client.driver.controls.remove(target, control);
    client.driver.layers.remove(target, layer);
    client.driver.map.destroy(map);

    fake.diagnostics.assertNoLeaks("v4 client 循环");
    const activity = fake.diagnostics.snapshot().activity;
    expect(activity).toMatchObject({
      mapsCreated: 1,
      overlaysAttached: 1,
      overlaysDetached: 1,
      controlsAttached: 1,
      controlsDetached: 1,
      layersAttached: 1,
      layersDetached: 1,
    });
  });

  it("漏摘图层就销毁地图时门禁必须报出来（证明上面那条不是空转）", () => {
    fake.diagnostics.reset();
    const map = client.driver.map.create(sizedContainer());
    const target: OverlayTarget = { kind: "map", handle: map };
    client.driver.layers.add(target, client.driver.layers.create("district", { name: "北京市" }));

    client.driver.map.destroy(map);
    expect(() => fake.diagnostics.assertNoLeaks("漏摘")).toThrow(/layers=1/);
    // Fake 自己的跨 facet 记账与诊断口径一致（destroyedWithLayers 是 #22 引入的那条不变式）
    expect((map.raw as FakeV4Map).destroyedWithLayers).toBe(1);
  });
});
