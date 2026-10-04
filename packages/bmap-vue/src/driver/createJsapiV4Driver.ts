/**
 * JSAPI 4.0 Facet Driver 工厂（默认注入点）
 *
 * M3A1-CLIENT（issue #18）在这里落默认 driver 工厂：`createBMapClient` 缺省注入本函数，
 * 因此默认路径只接受 `LoadedJsapiV4`。
 *
 * 文件刻意放在 `driver/` 根而不是 `driver/jsapi-v4/`：后者是**类型边界目录**（官方声明
 * augmentation），按 ADR 2026-09-10-bmap-raw-sdk-boundary 不得进入发布声明产物
 * （见 `scripts/check-public-dts.mts` 的 boundary-file-published 规则）。本文件因此只
 * 从 `driver/jsapi-v4/**` 取**运行时实现**，返回类型一律来自 `driver/types/**`——
 * 这样装配点不会把边界目录拖进公共 `.d.ts`。
 *
 * M3A2-SERVICES-NATIVE（issue #23）补齐最后三个面（Service / Panorama / Native Layer）
 * 并做**真正装配**：`#19`~`#22` 交付的 Map / Overlay / Control / Layer 与本次的三个面
 * 在这里合成一个 `JsapiV4Driver`。因此「v4 默认路径明确失败」的迁移期行为结束——用 v4
 * Provider 的组件路径从此可用（`client/migration.ts` 的 `migrationDriverFactory` 按 engine
 * 分派到本函数）；**默认 Provider / Playground / Docs 的切换仍是 M3A.3（#25）**。
 */
import { createCapabilityRegistry } from "./capability/registry";
import type { Capability } from "./capability/catalog";
import type { UnsupportedBehavior } from "./capability/unsupported";
import { createJsapiV4ControlDriver } from "./jsapi-v4/controls";
import { createJsapiV4EventDriver } from "./jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "./jsapi-v4/geometry";
import { createJsapiV4LayerDriver } from "./jsapi-v4/layers";
import { createJsapiV4MapDriver } from "./jsapi-v4/map";
import { createJsapiV4NativeLayerDriver } from "./jsapi-v4/native-layers";
import { createJsapiV4OverlayDriver } from "./jsapi-v4/overlays";
import { createJsapiV4PanoramaDriver } from "./jsapi-v4/panorama";
import { createJsapiV4HandleRegistry } from "./jsapi-v4/registry";
import { createJsapiV4ServiceDriver } from "./jsapi-v4/services";
import { assertJsapiV4Namespace } from "./jsapi-v4/internal";
import type { JsapiV4Driver } from "./types/bmap";

export interface CreateJsapiV4DriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  /** `LoadedJsapiV4.version`（Provider 声明的 SDK 运行时版本）。 */
  version: string;
  unsupported: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

export function createJsapiV4Driver(input: CreateJsapiV4DriverInput): JsapiV4Driver {
  const { rawSdk, version, unsupported, capabilityOverrides } = input;

  // 命名空间形状在这里先校验一次：各 Facet 都会各自断言，先校验能给出唯一、清晰的失败点，
  // 而不是让「第一个碰巧需要 Map 的 Facet」决定报错信息。
  assertJsapiV4Namespace(rawSdk);

  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version,
    rawSdk,
    unsupported,
    overrides: capabilityOverrides,
  });
  // 每个 Client 一份 Handle Registry：句柄所有权因此是「Client 级」的，
  // 跨 Client 混用会在边界抛 BMAP_HANDLE_FOREIGN（见 jsapi-v4/registry.ts）。
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(rawSdk);
  const events = createJsapiV4EventDriver({ registry, geometry });

  // 顺序是显式契约而不是巧合：Map 需要 events（destroy 要释放 target 订阅），
  // 其余 Facet 相互独立。装配点刻意只写一遍依赖关系，避免「谁先建」散落在各 Facet。
  const driver: JsapiV4Driver = {
    engine: "jsapi-v4",
    version,
    rawSdk,
    capabilities,
    geometry,
    events,
    map: createJsapiV4MapDriver({ rawSdk, geometry, capabilities, registry, events }),
    overlays: createJsapiV4OverlayDriver({ rawSdk, geometry, capabilities, registry }),
    controls: createJsapiV4ControlDriver({ rawSdk, geometry, registry }),
    layers: createJsapiV4LayerDriver({ rawSdk, capabilities, registry }),
    services: createJsapiV4ServiceDriver({ rawSdk, geometry, capabilities, registry, events }),
    panorama: createJsapiV4PanoramaDriver({ rawSdk, geometry, capabilities, registry, events }),
    nativeLayers: createJsapiV4NativeLayerDriver({ rawSdk, capabilities, registry }),
  };

  return driver;
}
