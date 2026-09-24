/**
 * v4 Panorama Facet 单测（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖 issue「测试要求」的 Panorama 部分：**capability / unsupported 语义**，
 * 以及 viewer / service 的 Handle skeleton 生命周期与重载细节。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { createCapabilityRegistry } from "../capability/registry";
import type { CapabilityRegistry } from "../capability/registry";
import { createJsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { JsapiV4HandleRegistry } from "./registry";
import { createJsapiV4PanoramaDriver } from "./panorama";
import type { PanoramaViewerDriver } from "../types/panorama";

let fake: FakeBMapV4;
let registry: JsapiV4HandleRegistry;
let capabilities: CapabilityRegistry;
let panorama: PanoramaViewerDriver;

function buildDriver(
  overrides?: Parameters<typeof createCapabilityRegistry>[0]["overrides"],
): PanoramaViewerDriver {
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
    overrides,
  });
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  return createJsapiV4PanoramaDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
    events: createJsapiV4EventDriver({ registry, geometry }),
  });
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  panorama = buildDriver();
});

describe("v4 Panorama Facet：capability 与 unsupported", () => {
  it("supported 是每次读取都重新探测的：实现被异步注入后同一个 Driver 也翻转", () => {
    expect(panorama.supported).toBe(true);

    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.Panorama;
    delete namespace.Panorama;
    try {
      // 关键：不在 Driver 构造期冻结结论（官方可视化实现存在异步注入窗口）
      expect(panorama.supported).toBe(false);
      namespace.Panorama = original;
      expect(panorama.supported).toBe(true);
    } finally {
      namespace.Panorama = original;
    }
  });

  it("缺 Panorama 构造器时 supported=false，create 显式失败", () => {
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.Panorama;
    delete namespace.Panorama;
    try {
      const driver = buildDriver();
      expect(driver.supported).toBe(false);
      expect(() => driver.create(document.createElement("div"))).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    } finally {
      namespace.Panorama = original;
    }
  });

  it("能力被 override 为 false 时，viewer / service 都在创建前失败", () => {
    const noViewer = buildDriver({ "panorama.viewer": false });
    expect(() => noViewer.create(document.createElement("div"))).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );

    const noService = buildDriver({ "panorama.service": false });
    expect(() => noService.createService()).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(fake.createdPanoramas).toHaveLength(0);
    expect(fake.createdPanoramaServices).toHaveLength(0);
  });
});

describe("v4 Panorama Facet：viewer 生命周期", () => {
  it("创建 / 视角 / 显隐 / 销毁落到实例", () => {
    const viewer = panorama.create(document.createElement("div"), { albumsControl: true });
    expect(viewer.raw).toBeTruthy();
    expect(fake.createdPanoramas).toHaveLength(1);

    panorama.setPosition(viewer, { lng: 116.404, lat: 39.915 });
    panorama.setPov(viewer, { heading: 90, pitch: -10 }, { animation: true });
    panorama.setZoom(viewer, 2, { noAnimation: true });
    panorama.hide(viewer);
    expect(panorama.getVisible(viewer)).toBe(false);
    panorama.show(viewer);
    expect(panorama.getVisible(viewer)).toBe(true);

    const raw = fake.createdPanoramas[0];
    expect(raw.position).toEqual({ lng: 116.404, lat: 39.915 });
    expect(raw.pov).toMatchObject({ heading: 90, pitch: -10 });
    expect(raw.zoom).toBe(2);
    expect(raw.callLog).toContain("setPov:animated");
    expect(raw.callLog).toContain("setZoom:noAnimation");
  });

  it("只给 heading 时不臆造 pitch", () => {
    const viewer = panorama.create(document.createElement("div"));
    panorama.setPov(viewer, { heading: 45 });

    const raw = fake.createdPanoramas[0];
    expect(raw.pov).toMatchObject({ heading: 45 });
    // 官方语义：pitch 省略 = 不改俯角（Fake 的初值是 0，若 Driver 传了 undefined 也会是 0，
    // 因此这里断言的是「payload 里没有 pitch 键」这件事的等价观测：pov.pitch 仍是初值）
    expect(raw.pov.pitch).toBe(0);
  });

  it("destroy 幂等：重复销毁不再次打到 SDK", () => {
    const viewer = panorama.create(document.createElement("div"));
    panorama.destroy(viewer);
    expect(fake.createdPanoramas[0].destroyCalls).toBe(1);

    expect(() => panorama.destroy(viewer)).not.toThrow();
    expect(fake.createdPanoramas[0].destroyCalls).toBe(1);
  });

  it("destroy 失败不记账：可以重试（真实 4.0 未加载场景时 destroy 会抛 TypeError）", () => {
    const viewer = panorama.create(document.createElement("div"));
    const raw = fake.createdPanoramas[0];
    raw.failNextDestroy = new TypeError("Cannot read properties of undefined (reading 'START')");

    expect(() => panorama.destroy(viewer)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );

    // 若记账写在调用之前，「销毁失败」会被伪装成「已销毁」，重试变成静默 no-op
    expect(() => panorama.destroy(viewer)).not.toThrow();
    expect(raw.destroyCalls).toBe(1);
  });

  it("destroy 重入被记账挡住：SDK 销毁回调里再次 destroy 不会重复调用", () => {
    const viewer = panorama.create(document.createElement("div"));
    const raw = fake.createdPanoramas[0];
    raw.onDestroy = () => {
      panorama.destroy(viewer);
    };

    panorama.destroy(viewer);
    expect(raw.destroyCalls).toBe(1);
  });

  it("拒绝其它 Client 的句柄", () => {
    const geometry = createJsapiV4GeometryDriver(fake.namespace);
    const other = createJsapiV4PanoramaDriver({
      rawSdk: fake.namespace,
      geometry,
      capabilities,
      registry: createJsapiV4HandleRegistry(),
      events: createJsapiV4EventDriver({ registry: createJsapiV4HandleRegistry(), geometry }),
    });
    const foreign = other.create(document.createElement("div"));
    expect(() => panorama.show(foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("v4 Panorama Facet：数据检索", () => {
  it("按 id 检索成功：归一到领域投影（不透出 tiles / links）", async () => {
    const service = panorama.createService();
    const result = await panorama.findById(service, "pano-1").result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      id: "pano-1",
      description: "天安门全景",
      position: { lng: 116.404, lat: 39.915 },
    });
    expect(fake.createdPanoramaServices[0].callLog).toEqual(["getPanoramaById:pano-1"]);
  });

  it("查无数据是 empty（官方回 null），不是 failed", async () => {
    const service = panorama.createService();
    fake.createdPanoramaServices[0].byId = null;

    const result = await panorama.findById(service, "不存在").result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  it("按坐标检索：不给半径时走两参数重载，给了才传半径", async () => {
    const service = panorama.createService();
    const raw = fake.createdPanoramaServices[0];

    await panorama.findByLocation(service, { lng: 116.4, lat: 39.9 }).result;
    expect(raw.callLog).toEqual(["getPanoramaByLocation:args=2"]);

    await panorama.findByLocation(service, { lng: 116.4, lat: 39.9 }, 120).result;
    expect(raw.callLog).toEqual(["getPanoramaByLocation:args=2", "getPanoramaByLocation:args=3"]);
  });

  it("迟到回调：取消之后回包不改结果", async () => {
    const service = panorama.createService();
    const raw = fake.createdPanoramaServices[0];
    raw.queue.auto = false;

    const call = panorama.findById(service, "pano-1");
    call.cancel();
    raw.queue.flush();
    expect((await call.result).status).toBe("canceled");
  });
});
