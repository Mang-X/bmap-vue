/**
 * 原生点图层的**声明式 profile**（M6-POINT-CLUSTER / issue #35）
 *
 * 三个点图层组件（`BPointShapeLayer` / `BPointIconLayer` / `BPointLayer`）的生命周期**完全相同**：
 * 适配业务数据 → 创建实例 → 挂载 → 逐字段写入 → 交付数据 → 绑拾取 → 释放。差异只有四处：
 *
 * | 差异 | 表现 |
 * | --- | --- |
 * | 落到哪个原生 kind | `point-shape` / `point-icon` / `point` |
 * | 构造期选项有哪些 | 图标层多 `isFlat` / `isFixed` |
 * | 就地可写的视觉字段叫什么 | 形状层用 `style` 袋（`shapeType` / `size` / …），扩展 API 用**扁平**选项（`shape` / `fillColor` / …） |
 * | 命中载荷长什么样 | 声明面 `value.dataItem.properties[idKey]`；扩展 API `value.properties[idKey]` 且**没有** `dataIndex` |
 *
 * 把这三份差异写成数据（而不是把 600 行生命周期抄三遍）是 issue #35「实现统一 NativePointLayerSpec」
 * 的字面要求；`useNativePointLayer` 读本文件，`BPointCollection` 的旧实现是它的第一版原型。
 *
 * ## 这里**不**写的东西（刻意）
 *
 * - **不写「哪些操作支持」**：那是 `NativeLayerDriver.supports(kind, op)` 的答案（单一事实源在
 *   `driver/jsapi-v4/native-layers.ts` 的 `NATIVE_LAYER_DESCRIPTORS`）。组件侧再抄一份必然与
 *   `supports()` 漂移，而漂移的表现是「静默收下但什么都不做」。
 * - **不写样式默认值**：官方默认值由 SDK 自己决定，本库不认识它们（同 #34 决策 6 的「不猜默认值」）。
 * - **不 import Driver / Vue**：本模块是纯函数，可以在没有 SDK、没有 Vue 的环境里直接测。
 *
 * ## 一处刻意的形状差异：`stylePayload` 的键名就是**写进 SDK 的字段名**
 *
 * 「由有值变回未表态」的判定要逐字段做（`setStyleOptions` / `setOptions` 都是 **merge**），
 * 因此撤回判定用的键必须与送进 SDK 的键**同一个**。让 profile 直接产出这个对象的键，
 * 判定与执行就只可能一致。
 */
import type { NativeLayerKind } from "../../driver/types/native-layers";
import type {
  BPointIconLayerProps,
  BPointLayerProps,
  BPointShapeLayerProps,
} from "../../types/components";

/** 三个点图层共用的原生 kind（`BPointCollection` 的更名落在 `point-shape`）。 */
export type NativePointLayerKind = Extract<NativeLayerKind, "point-shape" | "point-icon" | "point">;

/** 一次命中的读数（坐标与像素由调用方从事件里统一取，与 kind 无关）。 */
export interface NativePointPickRead {
  /** 是否命中要素。判定依据**逐 kind 不同**，见各 profile 的注释。 */
  readonly hit: boolean;
  /**
   * 命中的要素下标；扩展 API 上取不到时为 `-1`。
   *
   * ⚠️ 它只在声明面（`point-shape` / `point-icon`）上可靠 —— 官方把「未命中也派发事件、
   * `dataIndex === -1`」写进了 `NormalLayerPickEvent` 的用法，扩展 API 没有这个承诺。
   */
  readonly dataIndex: number;
  /** 业务键（从要素的 `properties[idKey]` 取回）；取不到时为 `undefined`。 */
  readonly key: PropertyKey | undefined;
}

export interface NativePointLayerProfile<Props> {
  readonly kind: NativePointLayerKind;
  /** 告警前缀 / 资源作用域标签（用组件名，方便用户对照文档）。 */
  readonly label: string;
  /**
   * 构造期选项。
   *
   * **只放「改了就换实例」的项**：`idKey`（要素身份）、拾取开关与拾取矩形、以及图标层的
   * `isFlat` / `isFixed`。视觉样式一律走 `stylePayload()` 在挂载后写入 —— 两处都写会让
   * 「构造期那一份」成为永远不再被更新的第二份真相。
   */
  constructorOptions(props: Props, idKey: string): Record<string, unknown>;
  /** 可就地写入的视觉字段；返回 `undefined` = 本次没有任何样式表态（一个字都不写 SDK）。 */
  stylePayload(props: Props): Record<string, unknown> | undefined;
  /** 构造期指纹：变化 ⇒ 换实例（`kind` 一定在首位，三个组件的指纹不会互相撞）。 */
  rebuildKey(props: Props, idKey: string): string;
  /** 命中载荷 → 业务身份。入参是**事件的 `value` 字段**（未归一化的那一层）。 */
  readPick(value: unknown, idKey: string): NativePointPickRead;
}

/* ------------------------------------------------------------------ 共用小工具 */

/** 只在值是合法要素身份时才取它（`NaN !== NaN` 会让同一项每次 diff 都判成新增）。 */
function asFeatureKey(value: unknown): PropertyKey | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return Number.isNaN(value as number) ? undefined : (value as PropertyKey);
  }
  if (typeof value === "symbol") return value;
  return undefined;
}

/** 指纹拼接：`|` 是安全的（取值来自预定义字段名，不来自用户输入）。 */
function fingerprint(parts: readonly unknown[]): string {
  return parts.map((part) => (part === undefined ? "·" : String(part))).join("|");
}

/** 只保留**有表态**的字段（`undefined` 进 SDK 只会把官方默认值盖成非法值）。 */
function declared(entries: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function nonEmpty(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(payload).length > 0 ? payload : undefined;
}

/** 读取 `value.dataItem.properties[idKey]`（声明面批量图层的形状）。 */
function readNestedProperties(value: unknown): Record<string, unknown> | undefined {
  const dataItem = (value as { dataItem?: unknown } | undefined)?.dataItem;
  const properties = (dataItem as { properties?: unknown } | undefined)?.properties;
  return properties && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined;
}

/** 读取 `value.properties[idKey]`（扩展 API 的形状，也兼容声明面的扁平写法）。 */
function readFlatProperties(value: unknown): Record<string, unknown> | undefined {
  const properties = (value as { properties?: unknown } | undefined)?.properties;
  return properties && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined;
}

/** 声明面的命中口径：官方文档写明「未命中也派发事件，`dataIndex === -1`」。 */
function declaredPick(value: unknown, idKey: string): NativePointPickRead {
  const dataIndex = (value as { dataIndex?: unknown } | undefined)?.dataIndex;
  const index = typeof dataIndex === "number" ? dataIndex : -1;
  const key = asFeatureKey(readNestedProperties(value)?.[idKey]);
  return { hit: index !== -1, dataIndex: index, key };
}

/**
 * 扩展 API（`PointLayer`）的命中口径。
 *
 * ⚠️ 依据是**实测**（`scripts/probe-native-point-cluster.mts`）：`PointLayer` 的命中载荷是
 * `{ lng, lat, size, scale, offset, id, index, properties, feature }` —— **没有** `dataIndex`，
 * 业务键在 `value.properties[idKey]`（或 `value.id`）上，因此**命中判据只能是「能不能解析出
 * 业务身份」**。
 *
 * 载荷里那个 `index` **刻意不读**：探针只取到了「有这个字段」，没有取证它的语义（是不是
 * 本次 `setData` 的要素下标）。拿一个语义未定的数字当要素下标，读错会**静默映射到另一个业务项**
 * ——比拿不到更糟。因此 `dataIndex` 如实返回 `-1`，并由组件把它交给调用方（见 ADR 的已知限制）。
 */
function extensionPick(value: unknown, idKey: string): NativePointPickRead {
  const properties = readFlatProperties(value);
  const key = asFeatureKey(properties?.[idKey]) ?? asFeatureKey((value as { id?: unknown } | undefined)?.id);
  return { hit: key !== undefined, dataIndex: -1, key };
}

/* ------------------------------------------------------------------ 三个 profile */

/**
 * 三个 profile 是**工厂函数**而不是常量对象，原因只有一个：`Props` 里带 `Item` 的方差。
 *
 * `NativePointLayerProfile<BPointShapeLayerProps<Item>>` 与 `...Props<unknown>>` 互不兼容
 * （`properties?: (item: Item) => …` 的参数位置是逆变的，`strictFunctionTypes` 下会直接报错），
 * 而用 `any` 抹平会把「调用方传错 props」变成运行时问题。工厂让每个 SFC 用**自己的** `Item`
 * 实例化一次：`const profile = pointShapeLayerProfile<Item>()`。返回值里只有纯函数，没有状态。
 */

/** 批量形状图层（官方 `PointShapeLayer`，两处都有声明）。 */
export function pointShapeLayerProfile<Item>(): NativePointLayerProfile<BPointShapeLayerProps<Item>> {
  return {
    kind: "point-shape",
    label: "BPointShapeLayer",
    constructorOptions: ({ enablePicked, pickWidth, pickHeight }, idKey) => ({
      idKey,
      enablePicked,
      ...declared([
        ["pickWidth", pickWidth],
        ["pickHeight", pickHeight],
      ]),
    }),
    stylePayload: ({ shape, size, color, strokeColor, strokeWeight }) =>
      nonEmpty(
        declared([
          ["shapeType", shape],
          ["size", size],
          ["color", color],
          ["strokeColor", strokeColor],
          ["strokeWeight", strokeWeight],
        ]),
      ),
    rebuildKey: ({ enablePicked, pickWidth, pickHeight }, idKey) =>
      fingerprint(["point-shape", idKey, enablePicked, pickWidth, pickHeight]),
    readPick: declaredPick,
  };
}

/**
 * 批量图标图层（官方 `PointIconLayer`，两处都有声明）。
 *
 * `isFlat` / `isFixed` 是**构造期**选项（官方把它们写在 `PointIconLayerOptions` 上，而不是
 * `PointIconStyle`）：贴合地面的图标与「跟随缩放保持尺寸」在创建时就决定渲染通道。
 */
export function pointIconLayerProfile<Item>(): NativePointLayerProfile<BPointIconLayerProps<Item>> {
  return {
    kind: "point-icon",
    label: "BPointIconLayer",
    constructorOptions: ({ isFlat, isFixed, enablePicked, pickWidth, pickHeight }, idKey) => ({
      idKey,
      enablePicked,
      ...declared([
        ["isFlat", isFlat],
        ["isFixed", isFixed],
        ["pickWidth", pickWidth],
        ["pickHeight", pickHeight],
      ]),
    }),
    stylePayload: ({ icon, width, height, anchors, offset, scale, rotation }) =>
      nonEmpty(
        declared([
          ["icon", icon],
          ["width", width],
          ["height", height],
          ["anchors", anchors],
          ["offset", offset],
          ["scale", scale],
          ["rotation", rotation],
        ]),
      ),
    rebuildKey: ({ isFlat, isFixed, enablePicked, pickWidth, pickHeight }, idKey) =>
      fingerprint(["point-icon", idKey, enablePicked, pickWidth, pickHeight, isFlat, isFixed]),
    readPick: declaredPick,
  };
}

/**
 * 扩展 API 的点图层（`BMap.PointLayer`：**运行时存在、类型包无声明**，可视化实现异步注入）。
 *
 * 它的选项是**扁平**的（官方扩展专页的例子是 `new BMap.PointLayer({ shape, size, fillColor })`），
 * 而不是 `style` 袋 —— 这不是本库的取舍，是 SDK 自己的形状。实测（同上探针）：
 * `setOptions({ size: 24 })` 之后 `getOptions().size === 24`，即扁平选项走 `setOptions` 合并生效。
 *
 * 这也是三个 profile 里唯一「没有类型声明兜底」的那个：调用面由
 * `NativeLayerDriver.supports()` 收口，能力缺失时显式失败（`BMAP_CAPABILITY_UNSUPPORTED`），
 * **不**自动降级成另外两个类（它们是不同的 SDK 能力，偷偷换等于把调用方的意图改掉）。
 */
export function pointLayerProfile<Item>(): NativePointLayerProfile<BPointLayerProps<Item>> {
  return {
    kind: "point",
    label: "BPointLayer",
    constructorOptions: ({ enablePicked, pickWidth, pickHeight }, idKey) => ({
      idKey,
      enablePicked,
      ...declared([
        ["pickWidth", pickWidth],
        ["pickHeight", pickHeight],
      ]),
    }),
    stylePayload: ({
      shape,
      icon,
      size,
      fillColor,
      fillOpacity,
      strokeColor,
      strokeWeight,
      scale,
      rotation,
      offset,
      anchor,
    }) =>
      nonEmpty(
        declared([
          ["shape", shape],
          ["icon", icon],
          ["size", size],
          ["fillColor", fillColor],
          ["fillOpacity", fillOpacity],
          ["strokeColor", strokeColor],
          ["strokeWeight", strokeWeight],
          ["scale", scale],
          ["rotation", rotation],
          ["offset", offset],
          ["anchor", anchor],
        ]),
      ),
    rebuildKey: ({ enablePicked, pickWidth, pickHeight }, idKey) =>
      fingerprint(["point", idKey, enablePicked, pickWidth, pickHeight]),
    readPick: extensionPick,
  };
}

/* ------------------------------------------------------------------ 共用的取值函数 */

/**
 * 从事件里读出命中载荷。
 *
 * ⚠️ 回调拿到的是 **Driver 归一化后的 `DriverEvent`**，而 `value` 这类 facet 独有字段**不在**
 * 归一化面里（`NormalLayerPickEvent.value` 在 `.d.ts` 里只声明成 `object`）⇒ 这里走 `raw` 逃生口，
 * 坐标 / 像素用归一化后的 `point` / `pixel`（与 #34 的 `BPointCollection` 同一条口径）。
 * 把 `value` 归一化进 `DriverEvent` 属事件 facet 的改动，登记为欠账（#36 的拾取面收口时一起做）。
 */
export function readPickValue(event: unknown): unknown {
  const normalized = (event ?? {}) as { raw?: unknown };
  const raw = normalized.raw ?? event;
  return (raw as { value?: unknown } | undefined)?.value;
}
