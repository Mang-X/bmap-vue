/**
 * nativeClusterEngine —— 失败恢复的直接单测（#113 欠账；不经过组件挂载）
 *
 * 组件级的 props 变化会**先**走替换 / 收敛路径，`unknown` 期间「一个字都不写」的窗口在组件面
 * 不可达（#108 / #112 已登记）。这里直接驱动引擎，断言口径只取 issue #113 允许的那几样：
 * **SDK 可观察调用 / 最终资源归属 / 公开方法行为 / 泄漏门禁**——不读 `detachUnknown` 字段、
 * 分支数量或状态结构。
 *
 * 设备无关：`createFakeV4Client()` 交出真实默认路径的 Client，`client.driver.map.create()` 建一张
 * 地图（与 `useMapEvent.test.ts` 同一配方），无需挂载 `<Map>`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeV4Client, type FakeBMapV4, type FakeV4ClusterLayer } from "../../../../test-utils";
import { createLayerRegistry, type LayerRegistry } from "../../core/layers/LayerRegistry";
import { createNativeClusterEngine, type NativeClusterEngineProps } from "./nativeClusterEngine";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";

interface Station {
  id: string;
  lng: number;
  lat: number;
}

/** `NativeClusterEngineProps` 的字段是只读的；测试要就地改 props 来驱动 props 变化。 */
type MutableProps = {
  -readonly [K in keyof NativeClusterEngineProps<Station>]: NativeClusterEngineProps<Station>[K];
};

/** 从引擎下发的 FeatureCollection 载荷里读出业务项 id（`idKey="id"`），用于「数据确实到了哪一侧」。 */
function featureIds(layer: FakeV4ClusterLayer): unknown[] {
  const data = layer.getData() as { features?: Array<{ properties?: Record<string, unknown> }> } | null;
  return (data?.features ?? []).map((feature) => feature.properties?.id);
}

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

function propsOf(overrides: Partial<MutableProps> = {}): MutableProps {
  return {
    data: [{ id: "a", lng: 116.4, lat: 39.9 }],
    itemKey: "id",
    getPosition: (item: Station) => ({ lng: item.lng, lat: item.lat }),
    visible: true,
    clusterRadius: 60,
    ...overrides,
  };
}

interface Fixture {
  client: BMapClient;
  fake: FakeBMapV4;
  map: MapHandle;
  registry: LayerRegistry;
  rawMap: FakeBMapV4["createdMaps"][number];
  engine: ReturnType<typeof createNativeClusterEngine<Station>>;
  props: MutableProps;
}

let fixture: Fixture | null = null;

async function createFixture(props: MutableProps): Promise<Fixture> {
  const { client, fake } = await createFakeV4Client();
  const map = client.driver.map.create(sizedContainer());
  const registry = createLayerRegistry();
  const rawMap = fake.createdMaps.at(-1)!;
  const engine = createNativeClusterEngine<Station>(
    {
      ready: { client, map },
      registry,
      label: "MarkerCluster",
      onProblem: vi.fn(),
      onClusterClick: vi.fn(),
      onItemClick: vi.fn(),
      onChange: vi.fn(),
    },
    props,
  );
  fixture = { client, fake, map, registry, rawMap, engine, props };
  return fixture;
}

/** 卸载路径 + 地图销毁，并过泄漏门禁（引擎用的是组件默认那条资源路径）。 */
function teardown(current: Fixture): void {
  current.engine.dispose();
  current.client.driver.map.destroy(current.map);
  current.fake.diagnostics.assertNoLeaks("nativeClusterEngine");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (fixture) {
    teardown(fixture);
    fixture = null;
  }
});

describe("nativeClusterEngine：挂载与 SDK 可观察调用", () => {
  it("mount ⇒ 创建 cluster 图层、挂到地图、下发首份数据（归属收敛在账本）", async () => {
    const f = await createFixture(propsOf());
    f.engine.mount();

    expect(f.fake.createdNativeLayers, "一个原生实例").toHaveLength(1);
    const layer = f.fake.createdNativeLayers[0]!;
    expect(layer.callLog, "首份数据到达 SDK").toContain("setData");
    expect(f.rawMap.layers, "挂在图上").toHaveLength(1);
    expect(f.registry.size, "账本持有 1 个图层").toBe(1);
  });
});

describe("nativeClusterEngine：unknown 期间一个字都不写 [#113]", () => {
  it("摘除失败 ⇒ 旧句柄不再接受任何写入；数据变化走重建收敛而不是写进未知句柄", async () => {
    const f = await createFixture(propsOf());
    f.engine.mount();
    const old = f.fake.createdNativeLayers[0]! as FakeV4ClusterLayer;

    // 构造期项变化触发重建；摘除在**摘之前**抛 ⇒ 资源可能仍在图上（unknown）
    f.rawMap.failNextRemoveLayer = new Error("removeLayer boom");
    f.props.clusterRadius = 80;
    expect(() => f.engine.sync(), "严格摘除失败必须交给调用方").toThrowError(/removeLayer boom/);
    const frozen = [...old.callLog];

    // unknown 期间：显隐不写旧句柄
    f.props.visible = false;
    f.engine.setVisible();
    expect(old.callLog, "unknown 期间一个字都不写").toEqual(frozen);
    expect(old.getVisible(), "旧句柄状态不变").toBe(true);

    // 数据变化 + sync ⇒ detachUnknown 优先收敛：重建一个新实例承载新数据，
    // 而不是把新数据 setData 进那个可能已经不在图上的旧句柄
    f.props.data = [{ id: "b", lng: 116.5, lat: 39.91 }];
    f.engine.sync();
    expect(f.fake.createdNativeLayers, "换新实例收敛").toHaveLength(2);
    const fresh = f.fake.createdNativeLayers.at(-1)! as FakeV4ClusterLayer;
    expect(fresh.callLog).toContain("setData");
    expect(featureIds(fresh), "新业务项 b 确实落在新实例上").toEqual(["b"]);
    expect(featureIds(old), "旧数据 a 没有被新数据覆盖").toEqual(["a"]);
    expect(old.callLog, "旧句柄自失败之后没有再被写过").toEqual(frozen);
    expect(f.registry.size, "账本仍只有一个存活实例").toBe(1);
  });

  it("unknown 优先于构造指纹：参数改回原值也必须收敛（不被指纹冻住）", async () => {
    const f = await createFixture(propsOf());
    f.engine.mount();

    f.rawMap.failNextRemoveLayer = new Error("removeLayer boom");
    f.props.clusterRadius = 80;
    expect(() => f.engine.sync()).toThrowError(/removeLayer boom/);

    // 改回原值：指纹重新等于已创建实例 —— 若 unknown 不优先，这里会失去所有收敛动作
    f.props.clusterRadius = 60;
    f.engine.sync();
    expect(f.fake.createdNativeLayers, "仍然重建以把未知推回确定").toHaveLength(2);
    expect(f.registry.size).toBe(1);
    expect(f.rawMap.layers, "旧实例被摘掉、只剩新实例").toHaveLength(1);
  });
});

describe("nativeClusterEngine：detach 失败保留所有权，成功后销账 [#113]", () => {
  it("换引擎的 detach 失败 ⇒ 保留实例与账本；再 detach 成功 ⇒ 销账", async () => {
    const f = await createFixture(propsOf());
    f.engine.mount();
    f.rawMap.failNextRemoveLayer = new Error("removeLayer boom");

    expect(() => f.engine.detach()).toThrowError(/removeLayer boom/);
    expect(f.registry.size, "未确认摘除 ⇒ 所有权保留").toBe(1);

    // 受控地再摘一次（成功即确定已摘除）
    f.engine.detach();
    expect(f.registry.size, "成功后销账").toBe(0);
    expect(f.rawMap.layers).toHaveLength(0);
  });
});
