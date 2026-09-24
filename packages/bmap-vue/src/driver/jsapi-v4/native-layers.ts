/**
 * v4 NativeLayerDriver（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 八个原生数据图层的**底层接口**：数据（`setData` / `clearData`）、样式、要素状态、
 * 显隐与层级、拾取，以及挂载记账。Vue 组件与数据适配层由 M6（#35 / #36）在它之上实现。
 *
 * 行为依据（官方 4.0 专页 + `@baidumap/jsapi-v4-types@4.0.4`）：
 *
 * - **四类「专页」批量图层**（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）
 *   在 4.0.4 有类声明，且共享同一套方法面：`setData`/`getData`、`updateState`/`removeState`/
 *   `clearState`/`replaceAllState`/`getAllState`、`setStyleOptions`（改完要 `doOnceDraw()`）、
 *   `setVisible`、`setOpacity`、`setZIndex`（及 `setMinZoom`/`setMaxZoom`）、`setBaseOptions`
 *   （`enablePicked` 在这里合并）、`getPickedItem`。它们的构造选项里 `enablePicked` 默认 false，
 *   因此**拾取是显式开关**。
 *   ⚠️ **这一族没有 `clearData`**（#106 评审修正，依据见 `DECLARED_LAYER_OPERATIONS` 的注释）：
 *   「清空数据」由实例生命周期表达，不靠一个不存在的入口。
 * - **四个扩展 API**（`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`）在 4.0 运行时
 *   公开但**没有类声明**，且官方明确「首次加载时可视化实现是异步注入的」。因此：
 *   构造器按结构探测，且**在 `create()` 调用时刻判断**——不在 Driver 构造期冻结结论，
 *   注入完成后重新 `create()` 就能成功（issue 风险条目「加载后就绪」）。它们各自只公开
 *   自己那几个方法（`setOptions` / `setEnablePicked` / `hitTest` / `redraw` / 播放控制…），
 *   所以 `supports()` 会如实地对多数操作回答 `false`。
 * - **不支持的操作显式失败**：`BMAP_CAPABILITY_UNSUPPORTED`，不静默 no-op。
 * - **层级方法要求先挂载**：官方明确「层级调整实现会访问已关联的 Map 与图层管理器」，
 *   所以调用顺序是 `create → add → setZIndex`；错误经 `sdkCall` 归一，不吞错。
 * - **`setStyle` 是 merge**（官方 `setStyleOptions` 合并到现有样式），因此这里不做「替换语义」。
 *   四类专页图层在更新样式后**不**自动重绘（官方：需 `doOnceDraw()`），本 Driver 因此
 *   显式调用 `doOnceDraw()`——「样式改了但画面没变」是最容易被当成 SDK bug 的坑。
 */
import { BMapError } from "../../core/errors/BMapError";
import {
  isValidTrackLineProcess,
  isValidTrackLineSpeed,
} from "../../core/layers/trackLinePlayback";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import type { Pixel } from "../types/geometry";
import { HANDLE_BRAND } from "../types/handles";
import type {
  NativeLayerData,
  NativeLayerDriver,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
  NativeLayerPick,
  NativeLayerZoomRange,
} from "../types/native-layers";
import {
  assertJsapiV4Namespace,
  callRequired,
  createMapTargetResolver,
  createMountTracker,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  requireRuntimeCtor,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 四类专页图层共享的操作面。
 *
 * ⚠️ **没有 `clearData`**（#106 评审修正）。两条一手来源都指向「这一族没有公开的清空入口」：
 *
 * - 上游声明 `@baidumap/jsapi-v4-types@4.0.4` 的 `PointIconLayer` / `PointShapeLayer` /
 *   `LineLayer` / `FillLayer` **只有** `setData(data)` 与 `getData()`（只有 `GeoJSONLayer` 有
 *   `clearData()`、`DOMLayer` 有 `removeAllOverlays()`）；
 * - 仓库内的官方参考 `.agents/skills/bmap-jsapi-v4/references/visualization-layers.md` 把这一族的
 *   数据面写成 `setData/getData`，资源清理写的是「解绑事件 → `map.removeLayer(layer)`」。
 *
 * 它原先出现在这里是因为 `2026-09-12` 的 ADR 决策 3 把「共享同一套方法面」写宽了（该表已被同一份
 * 证据更正）。「清空数据」在这一族里因此由**实例生命周期**表达（换一个没有数据的实例）——见 ADR
 * `2026-09-19-native-data-layer-components.md` 决策 8。
 *
 * 这张表与官方声明的逐条对应由 `native-layers.test.ts` 的「操作面 ↔ 官方声明」用例**机器核对**，
 * 不允许凭印象增减。
 */
const DECLARED_LAYER_OPERATIONS = [
  "setData",
  "setStyle",
  "setVisible",
  "setOpacity",
  "setZIndex",
  "setZoomRange",
  "updateState",
  "removeState",
  "clearState",
  "replaceState",
  "getState",
  "setEnablePicked",
] as const satisfies readonly NativeLayerOperation[];

/**
 * 走 `invoke()` 通用分流的操作。
 *
 * `updateState`（参数固定为 keys/state/append）、`getState`（**有返回值**）与 `hitTest`
 * （有返回值）各自单独实现——把它们塞进同一个 `switch` 会让「payload 是数组还是对象」
 * 这类细节散在调用点，也会让 `never` 完备性检查失去意义。
 */
type DispatchedOperation = Exclude<
  NativeLayerOperation,
  "updateState" | "getState" | "hitTest"
>;

interface NativeLayerDescriptor {
  /** 4.0 构造器名（文件末尾的断言把 `declared: true` 的那些钉在官方 `BMap` 命名空间上）。 */
  ctor: string;
  /** `@baidumap/jsapi-v4-types@4.0.4` 是否声明了该类（决定「用哪个构造入口」与「支持面」）。 */
  declared: boolean;
  /** 该 kind 真正有的归一化操作。 */
  operations: readonly NativeLayerOperation[];
}

/**
 * 每种图层一条记录。
 *
 * `declared` 同时决定三件事，写在一起才不会互相漂移：能否 `namespaceCtor`、能否用
 * 字段级 setter 族（`setVisible` / `setOpacity` / 状态 API 都是声明成员）、以及
 * 「缺成员」时的错误码（`BMAP_SDK_CALL_FAILED` vs `BMAP_CAPABILITY_UNSUPPORTED`）。
 */
const NATIVE_LAYER_DESCRIPTORS = {
  "point-icon": {
    ctor: "PointIconLayer",
    declared: true,
    operations: DECLARED_LAYER_OPERATIONS,
  },
  "point-shape": {
    ctor: "PointShapeLayer",
    declared: true,
    operations: DECLARED_LAYER_OPERATIONS,
  },
  line: { ctor: "LineLayer", declared: true, operations: DECLARED_LAYER_OPERATIONS },
  fill: { ctor: "FillLayer", declared: true, operations: DECLARED_LAYER_OPERATIONS },
  // 扩展 API：官方只公开「数据 + 通用 options + 拾取」，没有状态 / 层级方法面。
  //
  // 真实 4.0 的实测（ADR 的 smoke 记录，`直接调用` 一栏）显示这四个类**从共享基类继承了**
  // `setVisible` / `setOpacity` / `setZIndex`，调用不抛错。本表对 `setOpacity` / `setZIndex` /
  // 状态 API 仍然回答「不支持」：官方扩展 API 专页没有把它们列为这些类的方法面，而「不把未声明
  // 成员当契约」是本仓库对 SDK 边界的一贯口径（同 #22 的 `viewport → autoViewport`）。
  //
  // `setVisible` 是**唯一的例外**，理由是 #35 的**实测取证**（`scripts/probe-native-point-cluster.mts`，
  // 2026-09-19）：`PointLayer` / `ClusterLayer` 上 `setVisible(false)` 之后 `getVisible() === false`、
  // 再 `setVisible(true)` 能恢复 —— 而这三类数据组件共享 `BMapDataProps.visible`，
  // 「隐藏」是它们共同的最小契约的一部分。取证与取代关系见 ADR
  // `2026-09-19-native-point-layers-and-cluster`；其它继承成员仍然关闭（没有消费者，也没有取证）。
  point: {
    ctor: "PointLayer",
    declared: false,
    operations: ["setData", "clearData", "setStyle", "setVisible", "setEnablePicked", "hitTest"],
  },
  cluster: {
    ctor: "ClusterLayer",
    declared: false,
    operations: ["setData", "clearData", "setStyle", "setVisible"],
  },
  heatmap: { ctor: "Heatmap", declared: false, operations: ["setData", "clearData", "setStyle"] },
  // TrackLine 播放命令面（#110）。方法名经 live 探针（`scripts/probe-track-line.mts`，
  // 2026-09-23，exit 0）取证：`typeof layer.start === "function"` 等七条全部为真。
  // 官方类型包没有 TrackLine 类声明（`declared: false`），因此这里只登记运行时已验证的入口。
  "track-line": {
    ctor: "TrackLine",
    declared: false,
    operations: [
      "setData",
      "start",
      "pause",
      "resume",
      "stop",
      "setSpeed",
      "setProcess",
    ],
  },
} as const satisfies Record<NativeLayerKind, NativeLayerDescriptor>;

/** 每种原生图层对应的语义能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const NATIVE_LAYER_CAPABILITIES: Readonly<Record<NativeLayerKind, Capability>> = {
  point: "layer.point",
  cluster: "layer.cluster",
  "point-icon": "layer.point-icon",
  "point-shape": "layer.point-shape",
  line: "layer.line",
  fill: "layer.fill",
  heatmap: "layer.heatmap",
  "track-line": "layer.track-line",
};

export interface CreateJsapiV4NativeLayerDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4NativeLayerDriver(
  input: CreateJsapiV4NativeLayerDriverInput,
): NativeLayerDriver {
  const { rawSdk, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  const warnOnce = createWarnOnce();
  const mounted = createMountTracker();
  /** 原生数据图层只能挂到 Map（与 `LayerDriver` 同源）。 */
  const requireMapTarget = createMapTargetResolver({
    facet: "NativeLayerDriver",
    entry: "map.addLayer / removeLayer",
    resolve: (handle) => registry.resolve<object>(handle),
    warn: warnOnce,
  });

  /** 句柄品牌即 `native-layer:<kind>`（纯元数据，所有权校验留给 `registry.resolve`）。 */
  const kindOf = (layer: NativeLayerHandle): NativeLayerKind | undefined => {
    const match = /^native-layer:(.+)$/.exec(String(layer[HANDLE_BRAND]));
    return match?.[1] as NativeLayerKind | undefined;
  };

  const descriptorOf = (layer: NativeLayerHandle): NativeLayerDescriptor | undefined => {
    const kind = kindOf(layer);
    return kind ? NATIVE_LAYER_DESCRIPTORS[kind] : undefined;
  };

  /**
   * 归一化操作 → SDK 调用。
   *
   * 只在 `assertSupported()` 之后调用；因此这里按 `descriptor.declared` 分流是安全的
   * （专页图层有字段级 setter 族，扩展 API 只有 `setOptions` / `setEnablePicked`）。
   */
  const invoke = (
    raw: Record<string, unknown>,
    descriptor: NativeLayerDescriptor,
    kind: NativeLayerKind,
    operation: DispatchedOperation,
    payload?: unknown,
  ): void => {
    switch (operation) {
      case "setData":
        callRequired(raw, "setData", payload);
        return;
      case "clearData":
        callRequired(raw, "clearData");
        return;
      case "setStyle":
        if (descriptor.declared) {
          callRequired(raw, "setStyleOptions", payload);
          // 官方：专页图层更新样式后不会自动重绘，需要显式 doOnceDraw()
          const draw = readNamespaceMember(raw, "doOnceDraw");
          if (typeof draw === "function") callRequired(raw, "doOnceDraw");
          else {
            // 不静默：样式已写入但画面不会变，调用方必须知道要自己触发重绘
            warnOnce(
              `${kind}:no-doOnceDraw`,
              `NativeLayerDriver.setStyle: ${kind} 实例没有 doOnceDraw()，样式已更新但**不会重绘**；` +
                "需要调用方自行触发重绘",
            );
          }
          return;
        }
        // 扩展 API 只有整袋 setOptions（官方文档把它们列为 setOptions）
        callRequired(raw, "setOptions", payload);
        return;
      case "setVisible":
        callRequired(raw, "setVisible", payload);
        return;
      case "setOpacity":
        callRequired(raw, "setOpacity", payload);
        return;
      case "setZIndex":
        callRequired(raw, "setZIndex", payload);
        return;
      case "setZoomRange": {
        const range = payload as NativeLayerZoomRange;
        // 两端可选：只改给到的那一端（把缺失的一端当成默认值会把调用方的设置悄悄改掉）
        if (typeof range?.min === "number") callRequired(raw, "setMinZoom", range.min);
        if (typeof range?.max === "number") callRequired(raw, "setMaxZoom", range.max);
        return;
      }
      case "removeState":
        callRequired(raw, "removeState", payload);
        return;
      case "clearState":
        callRequired(raw, "clearState");
        return;
      case "replaceState":
        callRequired(raw, "replaceAllState", payload);
        return;
      case "setEnablePicked":
        if (descriptor.declared) {
          // 声明的成员里没有 setEnablePicked：官方把拾取开关放在基础配置项里
          callRequired(raw, "setBaseOptions", { enablePicked: payload });
          return;
        }
        callRequired(raw, "setEnablePicked", payload);
        return;
      // TrackLine 播放命令（#110；方法名均经 live 探针取证）
      case "start":
        callRequired(raw, "start");
        return;
      case "pause":
        callRequired(raw, "pause");
        return;
      case "resume":
        callRequired(raw, "resume");
        return;
      case "stop":
        callRequired(raw, "stop");
        return;
      case "setSpeed":
        callRequired(raw, "setSpeed", payload);
        return;
      case "setProcess":
        callRequired(raw, "setProcess", payload);
        return;
    }
    // 完备性检查：新增归一化操作却忘了在上面处理时，`operation` 不会收窄成 `never`，
    // 这一句会直接编译失败（而不是变成运行时静默 no-op）。
    operation satisfies never;
  };

  /** 该 kind 没有这个入口时显式失败（调用前可用 `supports()` 先问）。 */
  const assertSupported = (kind: NativeLayerKind, operation: NativeLayerOperation): void => {
    const operations: readonly NativeLayerOperation[] = NATIVE_LAYER_DESCRIPTORS[kind].operations;
    if (operations.includes(operation)) return;
    warnOnce(
      `${kind}:unsupported:${operation}`,
      `NativeLayerDriver: ${kind} 没有 "${operation}" 的运行时入口（官方 4.0 的该图层不公开这个方法），` +
        "本次调用被拒绝——不静默降级，否则调用方会以为设置生效了",
    );
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `NativeLayerDriver: ${kind}.${operation} 在 JSAPI 4.0 没有运行时入口`,
      { engine: "jsapi-v4", capability: NATIVE_LAYER_CAPABILITIES[kind] },
    );
  };

  /** 解析句柄并取回它自己的描述符（避免用调用方给的 kind 去解释别的实例）。 */
  const open = (
    layer: NativeLayerHandle,
    operation: NativeLayerOperation,
  ): { raw: Record<string, unknown>; descriptor: NativeLayerDescriptor; kind: NativeLayerKind } => {
    const kind = kindOf(layer);
    const descriptor = descriptorOf(layer);
    if (!kind || !descriptor) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `NativeLayerDriver.${operation}: 句柄不是本 Driver 创建的原生图层句柄`,
        { engine: "jsapi-v4" },
      );
    }
    assertSupported(kind, operation);
    return { raw: registry.resolve<Record<string, unknown>>(layer), descriptor, kind };
  };

  const ctorFor = (kind: NativeLayerKind, descriptor: NativeLayerDescriptor): JsapiV4Ctor => {
    if (descriptor.declared) return namespaceCtor(namespace, descriptor.ctor);
    return requireRuntimeCtor(namespace, descriptor.ctor, (message) =>
      warnOnce(
        `${kind}:no-runtime-entry`,
        `NativeLayerDriver: ${message}；"${kind}" 依赖 4.0 运行时按需注入可视化实现——` +
          "注入完成后再次 create() 即可（本 Driver 不在构造期冻结这个结论）",
      ),
    );
  };

  return {
    create(kind, options = {}) {
      const descriptor: NativeLayerDescriptor | undefined = NATIVE_LAYER_DESCRIPTORS[kind];
      if (!descriptor) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知原生图层种类: ${String(kind)}`, {
          engine: "jsapi-v4",
        });
      }
      // 能力守卫 **在调用时刻**求值（`supports()` 每次重算 rawMembers），因此
      // 「实现异步注入完成后再建」这条路径成立；`throw` 策略下失败发生在构造之前，
      // 不会留下孤儿实例。
      capabilities.require(NATIVE_LAYER_CAPABILITIES[kind]);
      const Ctor = ctorFor(kind, descriptor);
      const raw = sdkCall(descriptor.ctor, () => new Ctor(options));
      return registry.adopt(`native-layer:${kind}`, raw);
    },

    add(target, layer) {
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(layer);
      if (!mounted.claim(rawMap, raw)) return;
      try {
        sdkCall("map.addLayer", () => callRequired(rawMap, "addLayer", raw));
      } catch (error) {
        // 失败回滚记账（同 Layer / Control Facet）：否则用同一个句柄重试会被记成已挂过而静默跳过
        mounted.release(rawMap, raw);
        throw error;
      }
    },

    remove(target, layer) {
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(layer);
      sdkCall("map.removeLayer", () => callRequired(rawMap, "removeLayer", raw));
      mounted.release(rawMap, raw);
    },

    supports(kind, operation) {
      const descriptor: NativeLayerDescriptor | undefined = NATIVE_LAYER_DESCRIPTORS[kind];
      return descriptor ? descriptor.operations.includes(operation) : false;
    },

    setData(layer, data: NativeLayerData) {
      const { raw, descriptor, kind } = open(layer, "setData");
      invoke(raw, descriptor, kind, "setData", data);
    },

    clearData(layer) {
      const { raw, descriptor, kind } = open(layer, "clearData");
      invoke(raw, descriptor, kind, "clearData");
    },

    setStyle(layer, style) {
      const { raw, descriptor, kind } = open(layer, "setStyle");
      invoke(raw, descriptor, kind, "setStyle", style);
    },

    setVisible(layer, visible) {
      const { raw, descriptor, kind } = open(layer, "setVisible");
      invoke(raw, descriptor, kind, "setVisible", visible);
    },

    setOpacity(layer, opacity) {
      const { raw, descriptor, kind } = open(layer, "setOpacity");
      invoke(raw, descriptor, kind, "setOpacity", opacity);
    },

    setZIndex(layer, zIndex) {
      const { raw, descriptor, kind } = open(layer, "setZIndex");
      invoke(raw, descriptor, kind, "setZIndex", zIndex);
    },

    setZoomRange(layer, range) {
      const { raw, descriptor, kind } = open(layer, "setZoomRange");
      invoke(raw, descriptor, kind, "setZoomRange", range);
    },

    updateState(layer, keys, state, append = false) {
      // 官方签名固定（keys / params / ifAppend），因此不走 `invoke` 的通用分流
      const { raw } = open(layer, "updateState");
      callRequired(raw, "updateState", keys, state, append);
    },

    removeState(layer, keys) {
      const { raw, descriptor, kind } = open(layer, "removeState");
      invoke(raw, descriptor, kind, "removeState", keys);
    },

    clearState(layer) {
      const { raw, descriptor, kind } = open(layer, "clearState");
      invoke(raw, descriptor, kind, "clearState");
    },

    replaceState(layer, inputs) {
      const { raw, descriptor, kind } = open(layer, "replaceState");
      invoke(raw, descriptor, kind, "replaceState", inputs);
    },

    getState(layer) {
      // 与 `hitTest` 同类：有返回值，因此不走 `invoke` 的 void 分流
      const { raw } = open(layer, "getState");
      const result = sdkCall("NativeLayer.getAllState", () => callRequired(raw, "getAllState"));
      if (result === null || typeof result !== "object") {
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `NativeLayerDriver.getState: getAllState() 应当返回 id → 状态的对象，实际是 ${typeof result}`,
          { engine: "jsapi-v4" },
        );
      }
      // 只保留**状态对象**条目：声明里回包类型是 `object`，没有逐项类型；值不是对象的条目
      // 无法当作要素状态使用（把它透传出去会让调用方拿到形状不一致的映射）。
      const normalized: NativeLayerFeatureStateMap = {};
      for (const [key, state] of Object.entries(result as Record<string, unknown>)) {
        if (state !== null && typeof state === "object") {
          normalized[key] = state as NativeLayerFeatureState;
        }
      }
      return normalized;
    },

    setEnablePicked(layer, enabled) {
      const { raw, descriptor, kind } = open(layer, "setEnablePicked");
      invoke(raw, descriptor, kind, "setEnablePicked", enabled);
    },

    hitTest(layer, pixel: Pixel): NativeLayerPick | null {
      const { raw } = open(layer, "hitTest");
      const result = sdkCall("NativeLayer.hitTest", () =>
        callRequired(raw, "hitTest", pixel.x, pixel.y),
      ) as { dataIndex?: unknown; dataItem?: unknown } | null | undefined;
      if (!result || typeof result !== "object") return null;
      const dataIndex = Number(result.dataIndex);
      return {
        dataIndex: Number.isFinite(dataIndex) ? dataIndex : -1,
        dataItem: result.dataItem,
      };
    },

    /* ------------------------------------------------------------ TrackLine 播放 */
    // 六条命令共用 `open()` → `assertSupported()` → `invoke()`：不支持的 kind 显式失败，
    // 与其它操作同一口径。参数校验前置于 `sdkCall`（`BMAP_INVALID_ARGUMENT` 不碰 SDK）。

    start(layer) {
      const { raw, descriptor, kind } = open(layer, "start");
      invoke(raw, descriptor, kind, "start");
    },

    pause(layer) {
      const { raw, descriptor, kind } = open(layer, "pause");
      invoke(raw, descriptor, kind, "pause");
    },

    resume(layer) {
      const { raw, descriptor, kind } = open(layer, "resume");
      invoke(raw, descriptor, kind, "resume");
    },

    stop(layer) {
      const { raw, descriptor, kind } = open(layer, "stop");
      invoke(raw, descriptor, kind, "stop");
    },

    setSpeed(layer, speed) {
      // 校验前置于 SDK 调用：非法参数不是 SDK 失败，不该走 `sdkCall` 的错误归一。
      // 谓词与命令面共用（`trackLinePlayback.ts`），避免两处条件分叉。
      if (!isValidTrackLineSpeed(speed)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `NativeLayerDriver.setSpeed: 速度必须是有限正数，实际是 ${String(speed)}`,
          { engine: "jsapi-v4" },
        );
      }
      const { raw, descriptor, kind } = open(layer, "setSpeed");
      invoke(raw, descriptor, kind, "setSpeed", speed);
    },

    setProcess(layer, process) {
      // 官方参考面口径 0–1（含端点）；越界不静默 clamp——把非法值悄悄改成边界值会让调用方以为设置生效了
      if (!isValidTrackLineProcess(process)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `NativeLayerDriver.setProcess: 进度必须在 [0, 1] 内，实际是 ${String(process)}`,
          { engine: "jsapi-v4" },
        );
      }
      const { raw, descriptor, kind } = open(layer, "setProcess");
      invoke(raw, descriptor, kind, "setProcess", process);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * `declared: true` 的 kind，其构造器名必须真的在官方 `BMap` 命名空间上。
 *
 * 断言写成**逐成员分配式**（先对单个 kind 求条件类型，再取联合），而不是对联合整体判断：
 * 后者在「上游只补齐其中一部分声明」时会静默通过——`A | B extends keyof typeof BMap` 为
 * false，落到 `never` 分支上看起来也「对」。这里要求 union 的结果是 `never`，也就是
 * **每一个**都必须在官方声明里。
 */
type DeclaredNativeLayerKind = {
  [K in NativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["declared"] extends true ? K : never;
}[NativeLayerKind];
type MissingDeclaredCtors = {
  [K in DeclaredNativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? never
    : K;
}[DeclaredNativeLayerKind];
type _AssertDeclaredCtors = ExpectTrue<MissingDeclaredCtors extends never ? true : false>;

/**
 * 扩展 API 的构造器名在官方声明里**必须缺席**（上游补齐了就该把 `declared` 改成 `true`）。
 *
 * 同样逐成员判断：只补一个也让断言失败，而不是等四个都补齐才报错。
 */
type RuntimeNativeLayerKind = {
  [K in NativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["declared"] extends false
    ? K
    : never;
}[NativeLayerKind];
type DeclaredRuntimeCtors = {
  [K in RuntimeNativeLayerKind]: (typeof NATIVE_LAYER_DESCRIPTORS)[K]["ctor"] extends keyof typeof BMap
    ? K
    : never;
}[RuntimeNativeLayerKind];
type _AssertRuntimeCtorsUndeclared = ExpectTrue<DeclaredRuntimeCtors extends never ? true : false>;
