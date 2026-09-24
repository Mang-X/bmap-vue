/**
 * v4 PanoramaDriver（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 交付全景的 **Handle skeleton 与 capability**：查看器（`BMap.Panorama`）的生命周期与视角、
 * 数据检索（`BMap.PanoramaService`）的 callback → `ServiceCall` 归一。标签、相册、POI 类型
 * 这些声明式能力属 M7（#41）。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - `supported` 是**每次读取都重新探测**的 getter，而不是构造期定死的布尔：4.0 的可视化实现
 *   存在异步注入的窗口（issue 风险条目「加载后就绪」），把结论冻结在构造期会让「先建 Driver、
 *   后注入实现」这条正常顺序失败；
 * - `findById` / `findByLocation` 只有一个调用入口，查不到时回调参数是 `null`——因此
 *   「查无数据」是 `empty`，「调用抛错」是 `failed`，两者不混为一谈；
 * - `destroy()` 幂等：Driver 自己记账，重复销毁直接短路（`Panorama#destroy` 的重复调用
 *   在真实运行时没有保证）；
 * - 与 Map / Layer 不同，**Panorama 不挂到 Map 上**（它的容器是独立 DOM），因此本 Facet
 *   没有 `add/remove`，也没有挂在 Map 上的资源需要摘。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import { createServiceCall } from "../normalize/serviceCall";
import { toPlainPoint } from "../normalize/results";
import type { GeometryDriver, Point } from "../types/geometry";
import type {
  PanoramaDataInfo,
  PanoramaHandle,
  PanoramaLabelHandle,
  PanoramaLabelOptions,
  PanoramaOptions,
  PanoramaPoiType,
  PanoramaPov,
  PanoramaSceneType,
  PanoramaServiceHandle,
  PanoramaSwitchOptions,
  PanoramaViewerDriver,
} from "../types/panorama";
import {
  assertJsapiV4Namespace,
  callRequired,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4EventDriver } from "./events";
import type { JsapiV4HandleRegistry } from "./registry";

export interface CreateJsapiV4PanoramaDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
  /** 同 Client 的 v4 EventDriver：`destroy` 需要它的 target 释放入口。 */
  events: JsapiV4EventDriver;
}

/** 全景归一化调用用到的 Catalog 能力（能力清单是单一事实源）。 */
const PANORAMA_CAPABILITIES = {
  viewer: "panorama.viewer",
  service: "panorama.service",
} as const satisfies Record<string, Capability>;

/** 官方 `PanoramaData` → 领域投影（`tiles` / `links` 是渲染细节，不透出）。 */
function toDataInfo(raw: unknown): PanoramaDataInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as {
    id?: unknown;
    description?: unknown;
    position?: { lng: number; lat: number } | null;
  };
  if (typeof data.id !== "string" || data.id.length === 0) return null;
  return {
    id: data.id,
    description: typeof data.description === "string" ? data.description : "",
    position: data.position ? toPlainPoint(data.position) : null,
  };
}

/** 全景场景类型（官方是 `'street' | 'inter'` 两个字符串字面量）。 */
function toSceneType(raw: unknown): PanoramaSceneType | null {
  return raw === "street" || raw === "inter" ? raw : null;
}

/** 读取面的公共部分：非空对象投影，否则 `null`。 */
function readPoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as { lng?: unknown; lat?: unknown };
  if (typeof point.lng !== "number" || typeof point.lat !== "number") return null;
  return toPlainPoint({ lng: point.lng, lat: point.lat });
}

function readPov(raw: unknown): PanoramaPov | null {
  if (!raw || typeof raw !== "object") return null;
  const pov = raw as { heading?: unknown; pitch?: unknown };
  if (typeof pov.heading !== "number") return null;
  return typeof pov.pitch === "number"
    ? { heading: pov.heading, pitch: pov.pitch }
    : { heading: pov.heading };
}

export function createJsapiV4PanoramaDriver(
  input: CreateJsapiV4PanoramaDriverInput,
): PanoramaViewerDriver {
  const { rawSdk, geometry, capabilities, registry, events } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /**
   * 销毁的两个状态（PR #63 二轮复审 P2-3 之后）。
   *
   * 一个 `destroyed` 布尔同时表达「不要再做任何事」和「已经清干净了」会同时踩两个坑：
   * - 把它当重入保护用，就得在调 SDK **之前**写 —— 于是销毁失败也被记成「已销毁」，重试入口消失；
   * - 把它当完成标记用，就得在调 SDK **之后**写 —— 于是 teardown 期间的重入会真的销毁两次。
   *
   * 因此拆成 `disposing`（在飞，重入短路）与 `destroyed`（SDK 对象已销毁，重试时跳过这一步）。
   *
   * **订阅释放不记账**：`events.release()` 在没有分组时本来就是 no-op，而「曾经释放过」这个
   * 记忆是错的——SDK 销毁失败后查看器并没有销毁，业务可以重新订阅（等待就绪 / 恢复），
   * 此时不该因为上一轮释放过就跳过释放，否则新订阅会随查看器一起泄漏。所以每次销毁尝试都
   * 先释放当前订阅。
   */
  const disposing = new WeakSet<object>();
  const destroyed = new WeakSet<object>();

  const viewerOf = (viewer: PanoramaHandle): Record<string, unknown> =>
    registry.resolve<Record<string, unknown>>(viewer);

  /**
   * 查看器 / 标注上的 SDK 事件订阅（**原样投递**，见 `PanoramaViewerDriver.on` 的注释）。
   *
   * 记账用 `WeakMap`：不因为「某个查看器订阅过」而长期持有已销毁的 raw 对象。`destroy` 会
   * 显式释放该 target 上剩下的订阅（业务侧的 disposer 通常已经释放过，这里是兜底）。
   */
  const subscriptions = new WeakMap<object, Array<{ type: string; listener: (e: unknown) => void }>>();

  const serviceOf = (service: PanoramaServiceHandle): Record<string, unknown> =>
    registry.resolve<Record<string, unknown>>(service);

  const labelOf = (label: PanoramaLabelHandle): Record<string, unknown> =>
    registry.resolve<Record<string, unknown>>(label);

  /**
   * 事件订阅的公共部分（查看器与标注共用）：官方两个类的 `addEventListener` 形状一致。
   *
   * 成员缺失时**显式失败**（`callRequired` 的语义），不做静默忽略：`PanoramaLabel` 的
   * `click` 与查看器的事件面都是官方声明的成员，缺了就说明运行时与本库的假设不符。
   */
  const subscribe = (
    raw: Record<string, unknown>,
    type: string,
    listener: (event: unknown) => void,
  ): (() => void) => {
    callRequired(raw, "addEventListener", type, listener);
    let entries = subscriptions.get(raw);
    if (!entries) {
      entries = [];
      subscriptions.set(raw, entries);
    }
    const entry = { type, listener };
    entries.push(entry);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const list = subscriptions.get(raw);
      if (list) {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
      }
      callRequired(raw, "removeEventListener", type, listener);
    };
  };

  /** 释放该 target 上剩下的订阅（`destroy` 的兜底；业务侧 disposer 通常已经释放过）。 */
  const releaseSubscriptions = (raw: Record<string, unknown>): void => {
    const entries = subscriptions.get(raw);
    subscriptions.delete(raw);
    if (!entries) return;
    const remove = readNamespaceMember(raw, "removeEventListener");
    if (typeof remove !== "function") return;
    for (const entry of entries) {
      try {
        (remove as (...a: unknown[]) => unknown).call(raw, entry.type, entry.listener);
      } catch {
        /* 兜底释放失败不阻断销毁：SDK 对象随后就被销毁了 */
      }
    }
  };

  /**
   * 全景数据检索的公共部分：`getPanoramaById` / `getPanoramaByLocation` 都是
   * 「一个 point/id + 一个 callback（`PanoramaData | null`）」。
   */
  const retrieve = (
    raw: Record<string, unknown>,
    method: string,
    label: string,
    args: readonly unknown[],
  ): ReturnType<PanoramaViewerDriver["findById"]> =>
    createServiceCall<PanoramaDataInfo>(
      (settle) => {
        callRequired(raw, method, ...args, (data: unknown) => {
          const info = toDataInfo(data);
          if (!info) {
            // 官方：查不到数据时回调参数为 null（不是错误）
            settle.empty();
            return;
          }
          settle.success(info);
        });
      },
      { label },
    );

  return {
    /**
     * 全景能力是否可用：**每次读取都重新探测**（可视化实现可能异步注入，见文件头）。
     */
    get supported() {
      return typeof readNamespaceMember(namespace, "Panorama") === "function";
    },

    create(container, options = {}) {
      capabilities.require(PANORAMA_CAPABILITIES.viewer);
      const Panorama = namespaceCtor(namespace, "Panorama");
      return registry.adopt("panorama", sdkCall("Panorama", () => new Panorama(container, options)));
    },
    destroy(viewer) {
      const raw = viewerOf(viewer);
      // 已完成 / 正在清理：直接短路（重入保护，避免同一个底层对象被销毁两次）
      if (destroyed.has(raw) || disposing.has(raw)) return;
      disposing.add(raw);

      const failures: unknown[] = [];
      try {
        // 顺序与 Map Facet 一致：**先解绑 Driver 侧的业务事件，再销毁 SDK 对象**。
        // EventDriver 的 groups 是强引用（Map<rawTarget, …>），不主动 release 就会长期持有
        // 已销毁的 raw 对象与业务回调；解绑失败**不阻断** SDK 销毁（`events.release` 的契约
        // 是「其余项已尽力释放」），但两者都要汇总抛出，由调用方决定是否重试。
        //
        // 每次尝试都释放（不记账「曾经释放过」）：上一次尝试可能只失败在 SDK 销毁那一步，
        // 而期间业务可能又订阅了；`release()` 无分组时是 no-op，重复调用没有代价。
        events.release(viewer);
      } catch (error) {
        failures.push(error);
      }
      // 本 Facet 自己的订阅（`on()`）与 EventDriver 的是两套记账，必须分别释放
      releaseSubscriptions(raw);
      try {
        sdkCall("Panorama.destroy", () => callRequired(raw, "destroy"));
        destroyed.add(raw);
      } catch (error) {
        failures.push(error);
      } finally {
        disposing.delete(raw);
      }

      if (failures.length > 0) {
        const details = failures
          .map((failure) => (failure as Error)?.message ?? String(failure))
          .join("; ");
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `全景销毁时有 ${failures.length} 项未完成（其余步骤已尽力执行；` +
            `再次 destroy 只会补做未完成的那一步）: ${details}`,
          { cause: failures[0], engine: "jsapi-v4" },
        );
      }
    },

    // ------------------------------------------------------------- 事件订阅
    on(target, type: string, listener: (event: unknown) => void) {
      return subscribe(registry.resolve<Record<string, unknown>>(target), type, listener);
    },

    // ------------------------------------------------------------- 读取面
    //
    // 事件载荷来源：官方 `position_changed` / `pov_changed` / `zoom_changed` /
    // `scene_type_changed` 的载荷只有 `{type, target, currentTarget}`，业务要的是**值**，
    // 因此组件在事件回调里回读这几个 getter。这也解释了为什么读取面必须存在而不是「留给
    // 调用方自己 unwrap raw」。
    getPosition(viewer) {
      return readPoint(callRequired(viewerOf(viewer), "getPosition"));
    },

    getPov(viewer) {
      return readPov(callRequired(viewerOf(viewer), "getPov"));
    },

    getZoom(viewer) {
      const zoom = callRequired(viewerOf(viewer), "getZoom");
      return typeof zoom === "number" ? zoom : null;
    },

    getId(viewer) {
      const id = callRequired(viewerOf(viewer), "getId");
      return typeof id === "string" && id.length > 0 ? id : null;
    },

    getSceneType(viewer) {
      return toSceneType(callRequired(viewerOf(viewer), "getSceneType"));
    },

    // ------------------------------------------------------------- 写入面
    setId(viewer, id: string, options?: PanoramaSwitchOptions) {
      // 官方有两个重载（`setId(id, options?)` 与 `setId(id, sceneType, options?)`）。
      // 本库只暴露 id 形态：场景类型由 SDK 从数据里判定，让调用方显式指定需要一份
      // 「id 与类型的对应关系」——那是 SDK 的领域知识，转述只会成为第二份真相。
      if (options) callRequired(viewerOf(viewer), "setId", id, options);
      else callRequired(viewerOf(viewer), "setId", id);
    },

    setPosition(viewer, position: Point) {
      callRequired(viewerOf(viewer), "setPosition", geometry.toRawPoint(position));
    },

    setPov(viewer, pov: PanoramaPov, options) {
      // 官方：可以只设 heading；显式给 pitch 时必须同时给 heading（调用方负责语义）
      const payload =
        typeof pov.pitch === "number"
          ? { heading: pov.heading, pitch: pov.pitch }
          : { heading: pov.heading };
      if (options) callRequired(viewerOf(viewer), "setPov", payload, options);
      else callRequired(viewerOf(viewer), "setPov", payload);
    },

    setZoom(viewer, zoom: number, options) {
      if (options) callRequired(viewerOf(viewer), "setZoom", zoom, options);
      else callRequired(viewerOf(viewer), "setZoom", zoom);
    },

    setOptions(viewer, options: PanoramaOptions) {
      callRequired(viewerOf(viewer), "setOptions", options);
    },

    setPanoramaPoiType(viewer, poiType: PanoramaPoiType) {
      callRequired(viewerOf(viewer), "setPanoramaPOIType", poiType);
    },

    enableScrollWheelZoom(viewer) {
      callRequired(viewerOf(viewer), "enableScrollWheelZoom");
    },

    disableScrollWheelZoom(viewer) {
      callRequired(viewerOf(viewer), "disableScrollWheelZoom");
    },

    show(viewer) {
      callRequired(viewerOf(viewer), "show");
    },

    hide(viewer) {
      callRequired(viewerOf(viewer), "hide");
    },

    getVisible(viewer) {
      return Boolean(callRequired(viewerOf(viewer), "getVisible"));
    },

    // ----------------------------------------------------------- 标注覆盖物
    //
    // 标注**不是** Control / Overlay 家族的成员：它只存在于某个查看器内部
    // （`Panorama#addOverlay` / `removeOverlay`），因此这里不引入 add/remove 之外的
    // 生命周期记账——所有权由「谁创建谁摘除」表达（`PanoramaLabel` 在实例 scope 里摘除）。
    createLabel(content: string, options?: PanoramaLabelOptions) {
      const Label = namespaceCtor(namespace, "PanoramaLabel");
      return registry.adopt(
        "panorama:label",
        sdkCall("PanoramaLabel", () => new Label(content, options ?? {})),
      );
    },

    addLabel(viewer, label) {
      callRequired(viewerOf(viewer), "addOverlay", labelOf(label));
    },

    removeLabel(viewer, label) {
      callRequired(viewerOf(viewer), "removeOverlay", labelOf(label));
    },

    setLabelPosition(label, position: Point) {
      callRequired(labelOf(label), "setPosition", geometry.toRawPoint(position));
    },

    setLabelContent(label, content: string) {
      callRequired(labelOf(label), "setContent", content);
    },

    setLabelAltitude(label, altitude: number) {
      callRequired(labelOf(label), "setAltitude", altitude);
    },

    createService() {
      capabilities.require(PANORAMA_CAPABILITIES.service);
      const PanoramaService = namespaceCtor(namespace, "PanoramaService");
      return registry.adopt(
        "service:panorama",
        sdkCall("PanoramaService", () => new PanoramaService()),
      );
    },

    findById(service, id: string) {
      return retrieve(serviceOf(service), "getPanoramaById", "PanoramaService.getPanoramaById", [
        id,
      ]);
    },

    findByLocation(service, position: Point, radius?: number) {
      const raw = serviceOf(service);
      // 官方的重载是 (point, cb) 与 (point, radius, cb)——半径不是可选参数占位，
      // 因此不给半径时必须省略它，而不是传 undefined。
      if (typeof radius === "number") {
        return retrieve(raw, "getPanoramaByLocation", "PanoramaService.getPanoramaByLocation", [
          geometry.toRawPoint(position),
          radius,
        ]);
      }
      return retrieve(raw, "getPanoramaByLocation", "PanoramaService.getPanoramaByLocation", [
        geometry.toRawPoint(position),
      ]);
    },
  };
}
