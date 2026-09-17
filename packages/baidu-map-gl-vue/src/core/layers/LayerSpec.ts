/**
 * LayerSpec —— 图层的**统一规格**（M7-LAYERS / issue #40）
 *
 * 一份 `LayerSpec` 就是「一个图层实例该长什么样」的唯一描述：种类 + 构造选项 + 六个统一槽位
 * （`visible` / `opacity` / `minZoom` / `maxZoom` / `zIndex` / `data`）。十种 kind 的差异不进
 * 这里，而是由 Driver 的 `surface()` / `isMutableOption()` 回答——本文件只做**投影**与**指纹**。
 *
 * 本文件是**框架无关**的（不 import vue、也不 import 任何 Driver 实现）：它既被
 * `core/layers/LayerRegistry.ts` 与 `core/composables/useLayerResource.ts` 使用，也能在
 * 没有 Vue 的测试里直接用。
 *
 * 三条投影规则（与 Driver 的 `surface()` 一一对应）：
 *
 * 1. **构造期选项**（`layerCtorOptions`）＝ 不可就地更新的 `options` 键 + 「支持但不可就地
 *    更新」的统一槽位。**可就地更新的槽位与 option 刻意不进构造选项**（同一个值只留一条写入
 *    路径），它们在挂载后写一次、之后变化时原地更新；
 * 2. **重建指纹**（`layerRebuildKey`）＝ kind + 构造期选项 + 不可就地更新的槽位。
 *    它回答「哪些变化必须换一个实例」——`DistrictLayer` 的所有选项都在这里，
 *    `TileLayer` 的 `tileUrlTemplate` 也在（URL 变化必须重建）；
 * 3. **廉价变化指纹**（`layerWatchKey`）＝ 所有可能影响图层形态的字段（`data` 只比引用身份）。
 *    它只用来当 `watch` 的源，回答「要不要重算」；「重建还是就地更新」由回调里的
 *    `layerRebuildKey()` / 槽位指纹决定。
 */
import {
  LAYER_CTOR_SLOTS,
  type LayerCtorSlot,
  type LayerData,
  type LayerKind,
  type LayerSurface,
} from "../../driver/types/layers";

/**
 * 图层规格。
 *
 * `kind` 之外全部可选：省略 = 「不表态」，由 Driver 与内核各自给出默认语义（显隐默认可见、
 * 槽位默认沿用 SDK 自己的默认值）。
 */
export interface LayerSpec {
  readonly kind: LayerKind;
  /**
   * 构造期选项（4.0 自身选项的逃生口：`tileUrlTemplate` / `params` / `boundary` / `colors` …）。
   *
   * 统一槽位**不**放这里：它们是库保证语义的字段，混进来会有两份事实源。
   */
  readonly options?: Readonly<Record<string, unknown>> | undefined;
  /** 是否挂在图上。`false` = 摘掉（不是 `hide()`），`undefined` = 可见。 */
  readonly visible?: boolean | undefined;
  readonly opacity?: number | undefined;
  readonly minZoom?: number | undefined;
  readonly maxZoom?: number | undefined;
  readonly zIndex?: number | undefined;
  /** 数据（只有 `geojson` / `dom` 有一等公民语义，见 Driver 的 `operations`）。 */
  readonly data?: LayerData | null | undefined;
}

/**
 * 内核需要的最小 Driver 能力。
 *
 * 收成两项（而不是直接吃整个 `LayerDriver`）有两个好处：`core/layers` 与具体引擎解耦；
 * 测试可以只实现这两个方法来构造边界场景。
 */
export interface LayerProbe {
  /** 该 kind 的能力面（构造期槽位 + 可用操作）。 */
  surface(kind: LayerKind): LayerSurface;
  /** 该 option 键能否就地更新（`false` ⇒ 变化需要重建）。 */
  isMutableOption(kind: LayerKind, key: string): boolean;
}

/**
 * 统一槽位清单：**直接复用** `driver/types/layers.ts` 的单一事实源，不在这里再抄一份
 * （两侧各抄一份时，新增一个槽位只改一处也能编译通过）。
 */
export { LAYER_CTOR_SLOTS };

/**
 * 稳定指纹：值相等 ⇒ 指纹相等。
 *
 * 三条折叠规则是关键（否则「父级传内联字面量」会让每一次渲染都判成变化，图层被反复重建）：
 * - **函数折叠成 `fn`**：`tileLoadFunction` / `createDOM` 这类内联箭头每次渲染都是新引用；
 * - **非纯对象（DOM 节点、类实例）折叠成 `obj:<构造器名>`**：SDK 常接受 DOM 元素或富对象，
 *   逐字段递归既昂贵又会踩到循环引用；
 * - **键按字典序**：`{a,b}` 与 `{b,a}` 指纹相同。
 *
 * 该实现与官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 同源（它也是折叠函数与
 * DOM 节点），但这里多一层：数组保持顺序（经纬度数组的顺序有语义）。
 */
export function stableLayerValue(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  const type = typeof value;
  if (type === "function") return "fn";
  // 非有限数单独记（`NaN` 与 `±Infinity` 互不相等，也不能与有限数混淆：
  // `fn(NaN) === fn(NaN)` 会让「从 NaN 变成 Infinity」被判成没变化）
  if (type === "number") {
    return Number.isFinite(value as number) ? `#${String(value)}` : `nonfinite:${String(value)}`;
  }
  if (type === "string" || type === "boolean" || type === "bigint") {
    return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) return `[${value.map(stableLayerValue).join(",")}]`;
  if (type === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (value as { constructor?: { name?: string } }).constructor?.name ?? "unknown";
      return `obj:${name}`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${key}:${stableLayerValue(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return "?";
}

/**
 * 回调型 option 的统一包装：交给 SDK 的是一个**转发到「当前取值」**的函数。
 *
 * 为什么需要它：`stableLayerValue` 刻意把函数折叠成 `fn`（否则父级每次渲染产生的内联箭头
 * 都会让图层重建），代价是**函数 A → 函数 B 的变化在指纹里看不出来**。折叠行为要保留，
 * 于是换一种方式让语义正确：SDK 手上那个函数身份恒定，但它每次被调用时都去读**最新的 prop**。
 * 这样 `tileLoadFunction` / `url` / 模板回调 / 函数型 style 换成新实现后立即生效，
 * 而内联箭头仍然不会触发重建。
 *
 * 语义细节（刻意选择，已写进 ADR 已知限制）：
 * - 创建时该 option 不是函数 ⇒ 原样返回（「不表态」就该缺席，包一层空函数等于假支持）；
 * - 调用时刻 prop 已变成非函数（例如回调被清空）：继续用**最后一个确定的实现**，而不是抛错或
 *   返回 `undefined`——这类变化同时会改变重建指纹、旧实例很快被替换，在替换完成前抛错只会把
 *   「我要换了」变成 SDK 侧的一次异常。
 */
export function forwardCallback<T>(get: () => T): T {
  const initial = get();
  if (typeof initial !== "function") return initial;
  let last = initial as (...args: never[]) => unknown;
  const wrapper = (...args: never[]): unknown => {
    const latest = get();
    if (typeof latest === "function") last = latest as (...args: never[]) => unknown;
    return last(...args);
  };
  return wrapper as T;
}

/** 规格里 `options` 的「可就地更新」键（其余键变化 ⇒ 重建）。 */
function splitOptions(
  spec: LayerSpec,
  probe: LayerProbe,
): { mutable: Record<string, unknown>; ctorOnly: Record<string, unknown> } {
  const mutable: Record<string, unknown> = {};
  const ctorOnly: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec.options ?? {})) {
    if (value === undefined) continue;
    if (probe.isMutableOption(spec.kind, key)) mutable[key] = value;
    else ctorOnly[key] = value;
  }
  return { mutable, ctorOnly };
}

/**
 * 某个统一槽位在该 kind 上是否**可就地更新**。
 *
 * 两条判据取「或」：
 * - 该槽位有对应的归一化操作（`zIndex` ↔ `setZIndex`、`data` ↔ `setData`）；
 * - 该槽位名本身是一个**可就地更新的 option**（`DOMLayer` 的 `zIndex` 走整袋 `setStyleOptions`，
 *   因此它没有 `setZIndex` 操作，却能就地写入）。
 *
 * `opacity` / `minZoom` / `maxZoom` 在官方这批图层上两者都不成立（逐成员核对见
 * `driver/types/layers.ts` 的 `LayerOperation` 注释），因此它们只能构造期生效。
 */
export function isUpdatableSlot(spec: LayerSpec, probe: LayerProbe, slot: LayerCtorSlot): boolean {
  const surface = probe.surface(spec.kind);
  if (!surface.ctorSlots.includes(slot)) return false;
  // 归一化操作（`zIndex` ↔ `setZIndex`、`data` ↔ `setData`）**或**同名 option 的就地更新通道。
  // 两者取或：`DOMLayer` 的 `zIndex` 没有 `setZIndex`，但它是可就地更新的 option。
  if (slot === "zIndex") {
    return surface.operations.includes("setZIndex") || probe.isMutableOption(spec.kind, slot);
  }
  if (slot === "data") return surface.operations.includes("setData");
  return probe.isMutableOption(spec.kind, slot);
}

/** 读取规格里某个统一槽位的值（`undefined` = 没表态）。 */
export function layerSlotValue(spec: LayerSpec, slot: LayerCtorSlot): unknown {
  switch (slot) {
    case "opacity":
      return spec.opacity;
    case "minZoom":
      return spec.minZoom;
    case "maxZoom":
      return spec.maxZoom;
    case "zIndex":
      return spec.zIndex;
    case "data":
      return spec.data;
  }
}

/**
 * 领域规格 → 构造选项。
 *
 * 只包含**构造期**的部分：不可就地更新的 `options` 键 + 「支持但只能构造期生效」的槽位。
 *
 * **可就地更新的槽位刻意不进构造选项**（哪怕官方也接受它们做构造参数）：否则同一个值会有
 * 两条写入路径——构造一次、挂载后再写一次。对 `data` 这种「写一次就重建全部覆盖物」的槽位，
 * 重复写入正是要避免的（旧实现里「DOM 元素被抹掉后 setTimeout 回调还在」就是这么来的）。
 * 于是规则收敛成一句：**能就地写的，就只在挂载后写一次**。
 */
export function layerCtorOptions(spec: LayerSpec, probe: LayerProbe): Record<string, unknown> {
  const { ctorOnly } = splitOptions(spec, probe);
  const projected: Record<string, unknown> = { ...ctorOnly };
  const surface = probe.surface(spec.kind);
  for (const slot of LAYER_CTOR_SLOTS) {
    if (!surface.ctorSlots.includes(slot)) continue;
    if (isUpdatableSlot(spec, probe, slot)) continue;
    const value = layerSlotValue(spec, slot);
    if (value === undefined) continue;
    projected[slot] = value;
  }
  return projected;
}

/**
 * 重建指纹：变化 ⇒ 必须换一个图层实例。
 *
 * 组成 = kind + 构造期选项 + **不可就地更新**的槽位。刻意不含 `visible`（挂上 / 摘掉即可）、
 * 也不含可就地更新的槽位与 option 键。
 */
export function layerRebuildKey(spec: LayerSpec, probe: LayerProbe): string {
  const { ctorOnly } = splitOptions(spec, probe);
  const surface = probe.surface(spec.kind);
  const slots = LAYER_CTOR_SLOTS.filter(
    (slot) => surface.ctorSlots.includes(slot) && !isUpdatableSlot(spec, probe, slot),
  ).map((slot) => `${slot}=${stableLayerValue(layerSlotValue(spec, slot))}`);
  return [spec.kind, stableLayerValue(ctorOnly), slots.join("|")].join("::");
}

/** 该规格里**可就地更新**的 option 键与值（供 `setOptions` 使用）。 */
export function layerMutableOptions(
  spec: LayerSpec,
  probe: LayerProbe,
): Record<string, unknown> {
  return splitOptions(spec, probe).mutable;
}

/**
 * 从组件 props 里挑出「有表态」的构造选项（`undefined` 一律跳过）。
 *
 * 统一槽位名（opacity / minZoom / maxZoom / zIndex / data / visible）必须从 `keys` 里排除：
 * 它们是库保证语义的字段，走 `LayerSpec` 的具名槽位，而不是 options 逃生口。这里做一次
 * 显式守卫（而不是靠约定），否则「某个组件把 zIndex 也塞进 options」会让同一个值有两条路径。
 */
export function pickLayerOptions<Props extends object>(
  source: Props,
  keys: readonly (keyof Props)[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const name = String(key);
    if ((LAYER_UNIFIED_FIELDS as readonly string[]).includes(name)) {
      throw new Error(
        `pickLayerOptions: "${name}" 是统一槽位（由 LayerSpec 的具名字段承载），不能进 options 逃生口`,
      );
    }
    const value = (source as Record<string, unknown>)[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

/** 统一槽位的领域名（含 `visible`）：`options` 逃生口的排他清单。 */
export const LAYER_UNIFIED_FIELDS: readonly string[] = [...LAYER_CTOR_SLOTS, "visible"];

/**
 * `data` 的**引用身份**（`WeakMap` 计数，`O(1)`）。
 *
 * 用途见 `layerWatchKey`：`data` 往往是整份 `FeatureCollection`，用 `stableLayerValue()`
 * 深度序列化会让「每次 props 变化」都付一次遍历成本。这里只比引用，代价恒定。
 */
const dataIdentities = new WeakMap<object, number>();
let nextDataIdentity = 0;

export function layerDataIdentity(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value !== "object") return `p:${String(value)}`;
  const key = value as object;
  let id = dataIdentities.get(key);
  if (id === undefined) {
    id = ++nextDataIdentity;
    dataIdentities.set(key, id);
  }
  return `o:${id}`;
}

/**
 * **廉价的**变化指纹：只用来当 `watch` 的源（回答「要不要重算」），不回答「怎么更新」。
 *
 * 刻意与 `layerRebuildKey` / `layerSlotKey` 分工：
 * - 本函数求值在**每次 props 变化**时发生，因此不能做深遍历（`data` 只比引用身份）；
 * - 精确判据（重建 / 就地更新）在回调里用 `layerRebuildKey()` 与槽位指纹算，只在真的
 *   发生变化时才付那份成本。
 *
 * 代价：**原地修改同一份 `data` 不会被感知**（Vue 的响应式约定也是「换引用才更新」）。
 */
export function layerWatchKey(spec: LayerSpec): string {
  return [
    spec.kind,
    spec.visible === false ? "0" : "1",
    spec.opacity,
    spec.minZoom,
    spec.maxZoom,
    spec.zIndex,
    layerDataIdentity(spec.data),
    stableLayerValue(spec.options ?? {}),
  ].join("::");
}
