/**
 * BMapDriver —— 全部 Facet 的聚合接口
 *
 * 组件与业务 composable 只依赖该稳定领域接口，不依赖 SDK 全局命名空间。
 *
 * M3A3-REMOVE-LEGACY（issue #26）：旧引擎（`webgl-v1`，全局 `BMapGL`）随
 * `src/driver/webgl-v1` 一并删除，因此 `BMapEngine` 只剩 `jsapi-v4` 一个取值。
 * 保留成类型（而不是到处写字符串字面量）是为了让「engine 身份」在 Capability Catalog /
 * 诊断 / Ability Explanation 里有统一落点；它仍是**内部实现细节**，面向使用者的公共 API
 * 不得泄漏 engine 枚举语义以外的 SDK 细节。
 *
 * v4 **独有的** Facet 仍只挂在 `JsapiV4Driver` 上：共享契约 `BMapDriver` 保持最小，
 * 这样面向组件的最小依赖面（map / overlays / controls / layers / services / panorama /
 * events / capabilities）与 v4 专有面（调用面 services / viewer panorama / nativeLayers）
 * 在类型上继续分得开。
 */
import type { CapabilityRegistry } from "../capability/registry";
import type { ControlDriver } from "./controls";
import type { EventDriver } from "./events";
import type { GeometryDriver } from "./geometry";
import type { LayerDriver } from "./layers";
import type { MapDriver } from "./map";
import type { NativeLayerDriver } from "./native-layers";
import type { OverlayDriver } from "./overlays";
import type { PanoramaDriver, PanoramaViewerDriver } from "./panorama";
import type { JsapiV4ServiceDriver, ServiceDriver } from "./services";

export type BMapEngine = "jsapi-v4";

export interface BMapDriver {
  readonly engine: BMapEngine;
  readonly version: string;
  readonly rawSdk: unknown;
  readonly capabilities: CapabilityRegistry;

  readonly geometry: GeometryDriver;
  readonly map: MapDriver;
  readonly overlays: OverlayDriver;
  readonly controls: ControlDriver;
  readonly layers: LayerDriver;
  readonly services: ServiceDriver;
  readonly panorama: PanoramaDriver;
  readonly events: EventDriver;

  /**
   * 句柄**现在**还能不能用：属于本 Driver 的 Client **且**其 raw 对象尚未被销毁。
   *
   * 与「跨 Client 混用被拒绝」互补：`owns` 只管归属，回答不了「这张地图是不是已经卸载/销毁」。
   * 持有句柄的一方（例如把某个 `MapHandle` 存下来、稍后重建服务实例时准备复用）需要后者，
   * 否则会把一个**已销毁**的对象交给新实例。销毁是不可逆的：`destroy()` 完成后本入口恒 `false`。
   */
  isHandleLive(handle: unknown): boolean;
}

/**
 * JSAPI 4.0 Driver：共享契约 + v4 独有的三个面。
 *
 * - `services`：在创建面之上多出**归一化调用面**（callback → `ServiceCall<ServiceResult>`）；
 * - `panorama`：从 `{ supported }` 扩展出 viewer / service 的 Handle 与生命周期；
 * - `nativeLayers`：原生批量数据图层（8 种 kind）。
 *
 * 三者都是 `BMapDriver` 对应成员的**子类型**，因此 `JsapiV4Driver` 可以直接用在任何
 * 期望 `BMapDriver` 的位置（`createBMapClient` 的注入点）。
 */
export interface JsapiV4Driver extends BMapDriver {
  readonly services: JsapiV4ServiceDriver;
  readonly panorama: PanoramaViewerDriver;
  readonly nativeLayers: NativeLayerDriver;
}
