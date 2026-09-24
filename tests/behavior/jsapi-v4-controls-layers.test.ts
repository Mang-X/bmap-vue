/**
 * v4 Control / Layer facet 行为验证（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 这一层验证三件事：
 * 1. **同一套 Control / Layer facet 契约**在 v4 与 webgl-v1 上都能通过——本文件让 v4 的
 *    两个 facet 直接跑 `runControlFacetContract` / `runLayerFacetContract`，与
 *    `tests/behavior/v4-driver-contract.test.ts` 的 webgl-v1 harness 共用同一批断言
 *    （契约的单一事实源在 `packages/test-utils/driver-contract.ts`）；
 * 2. v4 特有的行为：`map.addLayer/removeLayer` 的统一入口、挂载计数、版权项 `bounds` 回读；
 * 3. 「**先摘子资源、再销毁 Map**」这条跨 Facet 不变式在控件 / 图层上同样成立
 *    （`destroyedWithControls` / `destroyedWithLayers`）。
 *
 * 组装方式与 #20/#21 一致：v4 的 Facet 装配（`createJsapiV4Driver`）属 #23/#25，
 * 本 issue 只在测试里手工组合 Control / Layer facet 与它们的依赖。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import {
  layerFacetOptions,
  runControlFacetContract,
  runLayerFacetContract,
  type ControlFacetHarness,
  type LayerFacetHarness,
} from "../../packages/test-utils/driver-contract";
import { CAPABILITY_CATALOG } from "../../packages/bmap-vue/src/driver/capability/catalog";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import type { Capability } from "../../packages/bmap-vue/src/driver/capability/catalog";
import type { ControlHandle, LayerHandle, SdkHandle } from "../../packages/bmap-vue/src/driver/types/handles";
import type { LayerKind } from "../../packages/bmap-vue/src/driver/types/layers";
import { createJsapiV4ControlDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/controls";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4LayerDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/layers";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";

let fake: FakeBMapV4;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;
let controls: ReturnType<typeof createJsapiV4ControlDriver>;
let layers: ReturnType<typeof createJsapiV4LayerDriver>;
let capabilities: ReturnType<typeof createCapabilityRegistry>;
let rawMaps: InstanceType<FakeBMapV4["namespace"]["Map"]>[];

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 采纳一个 raw map 并记录它，供「先摘子资源」不变式断言使用。 */
function adoptMap(): SdkHandle<"map"> {
  const raw = new fake.namespace.Map(sizedContainer());
  rawMaps.push(raw);
  return registry.adopt("map", raw);
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  rawMaps = [];
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  controls = createJsapiV4ControlDriver({ rawSdk: fake.namespace, geometry, registry });
  layers = createJsapiV4LayerDriver({ rawSdk: fake.namespace, capabilities, registry });
});

function createControlHarness(): ControlFacetHarness {
  return {
    driver: () => ({ controls }),
    mapHandle: () => adoptMap(),
    attachedCount: () => rawMaps[rawMaps.length - 1].controls.length,
  };
}

function createLayerHarness(): LayerFacetHarness {
  return {
    driver: () => ({ layers }),
    mapHandle: () => adoptMap(),
    attachedCount: () => rawMaps[rawMaps.length - 1].layers.length,
  };
}

runControlFacetContract(createControlHarness);
runLayerFacetContract(createLayerHarness);

const rawOf = (handle: ControlHandle | LayerHandle) => handle.raw as Record<string, unknown>;

describe("v4 Control / Layer facet 释放顺序（跨 Facet 不变式）", () => {
  it("先摘子资源再销毁地图：destroyedWithControls / destroyedWithLayers 为 0", () => {
    const target = { kind: "map" as const, handle: adoptMap() };
    const control = controls.create("zoom");
    const layer = layers.create("tile");
    controls.add(target, control);
    layers.add(target, layer);

    controls.remove(target, control);
    layers.remove(target, layer);
    rawMaps[0].destroy();

    expect(rawMaps[0].destroyedWithControls).toBe(0);
    expect(rawMaps[0].destroyedWithLayers).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    const target = { kind: "map" as const, handle: adoptMap() };
    controls.add(target, controls.create("zoom"));
    layers.add(target, layers.create("tile"));
    rawMaps[0].destroy();

    expect(rawMaps[0].destroyedWithControls).toBe(1);
    expect(rawMaps[0].destroyedWithLayers).toBe(1);
  });
});

describe("v4 Control / Layer facet 与 Capability Catalog 一致", () => {
  /**
   * issue #22 的「验收标准」：Catalog 声明的能力必须与 Driver 实际支持的 kind 一致。
   *
   * M7-LAYERS（#40）把它扩到**全部十种** kind（原本只有 #22 的三种）。
   */
  const KIND_CAPABILITIES: readonly [LayerKind, Capability][] = [
    ["district", "layer.district"],
    ["panorama-coverage", "layer.panorama-coverage"],
    ["tile", "layer.tile"],
    ["traffic", "layer.traffic"],
    ["geojson", "layer.geojson"],
    ["dom", "layer.dom"],
    ["xyz", "layer.xyz"],
    ["wms", "layer.wms"],
    ["wmts", "layer.wmts"],
    ["raster", "layer.raster"],
  ];

  it.each(KIND_CAPABILITIES)("%s ↔ %s：能力可用且 rawMembers 真的存在", (kind, capability) => {
    expect(capabilities.supports(capability)).toBe(true);

    const members = CAPABILITY_CATALOG[capability].rawMembers ?? [];
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(
        typeof (fake.namespace as unknown as Record<string, unknown>)[member],
        `能力 ${capability} 声明的 rawMember ${member} 在 Fake 命名空间里不存在`,
      ).toBe("function");
    }

    // 能力可用 → 该 kind 真的能创建并挂载
    const layer = layers.create(kind, layerFacetOptions(kind));
    layers.add({ kind: "map", handle: adoptMap() }, layer);
    expect(rawMaps[rawMaps.length - 1].layers).toHaveLength(1);
  });
});

describe("v4 Control / Layer facet 与 webgl-v1 的已知差异", () => {
  it("copyright 的 listCopyrights 回读 bounds（v1 只回读 id/content）", () => {
    const control = controls.create("copyright");
    const bounds = { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } };
    controls.addCopyright(control, { id: 1, content: "a", bounds });

    // `CopyrightControl` 的更新路径会带着旧 bounds 重新 addCopyright：丢掉它会让「内容变了但适用范围变回全局」
    expect(controls.listCopyrights(control)).toEqual([{ id: 1, content: "a", bounds }]);
    expect(rawOf(control).callLog).toContain("addCopyright");
  });
});
