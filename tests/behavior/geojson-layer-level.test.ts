/**
 * #165 收口：`<GeoJSONLayer>.level` 的就地更新口径。
 *
 * ## 为什么单独一个文件（而不是并进 descriptor 的通用断言）
 *
 * `level` 曾经是本库 descriptor 里**没有写理由的缺席**：`layer/GeoJSONLayer.d.ts` 声明了
 * `setLevel(z: number): void`，而 `LAYER_DESCRIPTORS.geojson.mutable` 是空的，
 * 于是组件的 `level` prop 变化一律走**重建**。按本票的判据（「没有写下理由」是缺席的签名，
 * 不是决策），这一条必须先有读数、再有裁决。
 *
 * ## 读数（live AK，headless Chrome，`scripts/probe-165-level-effect.mts`）
 *
 * `BMap.version === "gl"`，4.0.5，`GeoJSONLayer` + 三个要素（两块面、一条线）挂在
 * 中心 116.404,39.915 / zoom 14 上：
 *
 * | 调用 | `getLevel()` | 每个要素的 `zIndex` |
 * | --- | --- | --- |
 * | 构造 `{ level: -77 }` | `-77` | `-77` |
 * | 基线（不给 `level`） | `-99` | `-99` |
 * | `setLevel(-50)` | `-99 → -50` | `-99 → -50`（**三个要素全部**） |
 * | `setLevel(-99)` | `-50 → -99` | `-50 → -99` |
 * | `setLevel(0)` / `setLevel(2000)` / `setLevel(1.5)` | 各自取值 | 各自取值 |
 *
 * ⇒ **可观测地生效**：不是只改了图层自己的内部字段，而是**逐个透传给解析出的覆盖物的
 * `setZIndex`**（官方 skill `references/data-layers.md`「层级值原样透传给每个解析出的覆盖物
 * 的 `setZIndex`」正是这条读数的书面版）。取值域**没有**观察到裁剪（正数 / 大数 / 小数都照收），
 * 官方注释的「负数越大层级越高」是**语义**描述、不是取值约束。
 *
 * 判据：`isMutableOption("geojson", "level")` 为真 ⇒ 内核走 `setLevel` 就地更新，
 * **不重建**。这与 `minZoom` / `maxZoom` 相反——那两个在运行时**没有** setter
 * （同一支探针读到 `hasSetMinZoom=false` / `hasSetMaxZoom=false`），仍归构造期。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import { createCapabilityRegistry } from "../../packages/bmap-vue/src/driver/capability/registry";
import { createJsapiV4LayerDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/layers";
import { createJsapiV4HandleRegistry } from "../../packages/bmap-vue/src/driver/jsapi-v4/registry";
import type { LayerHandle, SdkHandle } from "../../packages/bmap-vue/src/driver/types/handles";
import type { OverlayTarget } from "../../packages/bmap-vue/src/driver/types/overlays";

let fake: FakeBMapV4;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;
let layers: ReturnType<typeof createJsapiV4LayerDriver>;

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

function mapTarget(): OverlayTarget {
  const raw = new fake.namespace.Map(sizedContainer());
  return { kind: "map", handle: registry.adopt("map", raw) as SdkHandle };
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  layers = createJsapiV4LayerDriver({ rawSdk: fake.namespace, capabilities, registry });
});

describe("<GeoJSONLayer>.level 的就地更新口径（#165）", () => {
  it("descriptor 把 level 声明为可就地更新（依据 live 读数：setLevel 透传到每个要素的 zIndex）", () => {
    expect(layers.isMutableOption("geojson", "level")).toBe(true);
  });

  it("level 变化时调 setLevel 一次，且**不重建**图层", () => {
    const target = mapTarget();
    const handle = layers.create("geojson", {
      layerName: "geojson-level",
      data: { type: "FeatureCollection", features: [] },
    }) as LayerHandle;
    layers.add(target, handle);

    const before = registry.resolve<{ callLog: string[]; level: number }>(handle);
    const callLogBefore = before.callLog.length;
    const instanceBefore = before;

    layers.setOptions(handle, { level: -50 });

    const after = registry.resolve<{ callLog: string[]; level: number }>(handle);
    // 同一个实例（没有重建）
    expect(after).toBe(instanceBefore);
    // 走的是 setLevel 入口
    expect(after.callLog.slice(callLogBefore)).toContain("setLevel");
    expect(after.level).toBe(-50);

    layers.remove(target, handle);
  });

  it("minZoom / maxZoom 仍然**不是**就地更新（运行时没有 setter，归构造期→重建）", () => {
    expect(layers.isMutableOption("geojson", "minZoom")).toBe(false);
    expect(layers.isMutableOption("geojson", "maxZoom")).toBe(false);
  });

  it("descriptor 的注释写下了这条读数（不是无理由的缺席）", async () => {
    // ⚠️ 不能用 import.meta.url：vitest 的 import.meta.url 不是 file: 协议，
    // fileURLToPath 会直接抛 "The URL must be of scheme file"。
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "packages/bmap-vue/src/driver/jsapi-v4/layers.ts"),
      "utf8",
    );
    const entry = /\n  geojson: \{[\s\S]*?\n  \},/.exec(source)?.[0] ?? "";
    expect(entry).not.toBe("");
    // 缺席过的成员名 + 读数来源（探针脚本名）必须都出现在这段注释里，
    // 否则下一个读者还会把它当成「忘了写」而不是「裁决过」。
    expect(entry).toContain("setLevel");
    expect(entry).toContain("probe-165-level-effect.mts");
  });
});

/**
 * #165 Item 1：`FeatureLayer` 的**不封装**裁决。
 *
 * 这一条测的是「我们**没有**声称它」——把非行动（non-action）钉成断言，
 * 否则下一个读者看到「官方 React 参考有 `FeatureLayer` 组件」就会以为这是遗漏，
 * 去补一个永远构造不出来的组件。
 *
 * 依据：`scripts/probe-165-feature-layer.mts` 的 live 读数（4.0.5，补齐等待 settled 后
 * 仍然缺席）——`typeof BMap.FeatureLayer === "undefined"`、`new` 抛 `is not a constructor`；
 * 且官方 **Vue** 参考 `vue-bmap` master `ffc6dad` 根本没有这个组件，
 * 官方 **React** 参考 `react-bmap` master `fde5bbd` 自己的 `capabilityMatrix.ts` 里也没有它
 * ⇒ 它的 `createFeatureLayer` 在参考实现内部就是死代码（`createLayerFactory` 首行
 * `if (!capabilities.has(cap)) return null`）。
 */
describe("#165：FeatureLayer 的处置是「不封装」（live 读数裁决）", () => {
  it("Fake 命名空间里**没有** FeatureLayer（能力项不得凭空登记）", () => {
    const ns = fake.namespace as unknown as Record<string, unknown>;
    expect("FeatureLayer" in ns).toBe(false);
  });

  it("能力目录里**没有**任何 feature 相关的图层能力项", async () => {
    const { CAPABILITY_CATALOG } = await import(
      "../../packages/bmap-vue/src/driver/capability/catalog"
    );
    const ids = Object.keys(CAPABILITY_CATALOG as Record<string, unknown>);
    expect(ids.some((id) => /feature/i.test(id))).toBe(false);
  });

  it("能力目录写下了这条裁决与读数来源（不是无理由的缺席）", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "packages/bmap-vue/src/driver/capability/catalog.ts"),
      "utf8",
    );
    // 注释必须点名被否决的类、读数来源（探针脚本）与「为什么不登记」，
    // 三者缺一，下一个读者就会把它当成待办而不是已裁决。
    expect(source).toContain("FeatureLayer");
    expect(source).toContain("probe-165-feature-layer.mts");
    expect(source).toMatch(/不要.*增加能力项|不封装|只留注释/);
  });

  it("同一条注释也记下 NormalLayer 的相反事实（运行时在、类型包不在）", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "packages/bmap-vue/src/driver/capability/catalog.ts"),
      "utf8",
    );
    // 两条裁决方向相反，理由各不相同；不写下「类型包没有 ≠ 运行时没有」这条口径，
    // 读者会拿其中一条去反推另一条。
    expect(source).toContain("NormalLayer");
    expect(source).toMatch(/不等于/);
  });
});
