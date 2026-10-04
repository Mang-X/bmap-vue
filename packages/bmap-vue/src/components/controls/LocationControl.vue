<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";
import { createLocationCommands } from "../../core/controls/controlCommands";
import type { Point } from "../../driver/types/geometry";
import type { LocationAddressComponents, LocationCommandApi } from "../../driver/types/controls";
import type { MarkerIcon } from "../../types/components";

/**
 * 定位成功的地址组成部分（官方 `BMap.AddressComponent` 的领域投影）。
 *
 * 逐字段取自 `@baidumap/jsapi-v4-types@4.0.5` 的 `service/AddressComponent.d.ts`：
 * `streetNumber?` / `street?` / `district?` / `city?` / `province?`——**五个全是可选的**，
 * 因此这里也全部可选，且**不补默认值**（`city ?? ""` 会把「上游没给」与「空」混起来）。
 *
 * 这是 `driver/types/controls.ts` 的 `LocationAddressComponents` 的**别名**，不是第二份形状：
 * 组件的 SFC 不能被 `.ts` 引用它的类型，而命令面必须引用领域类型——因此形状自持在
 * `driver/types/`（raw 边界内），组件侧只做别名。两处手抄同一组五个可选字符串字段，
 * 迟早会分叉（曾经就分叉过：`getAddressComponent()` 的投影与 `locationSuccess` 的投影各写一份）。
 */
export type AddressComponents = LocationAddressComponents;

/** `locationSuccess` 的载荷（官方 `GeolocationControlSuccessEvent`）。 */
export interface LocationSuccessEvent {
  /** 定位到的坐标。官方声明为非可空 `Point`。 */
  point: Point;
  /** 地址组成部分；官方声明为 `AddressComponent | null`（拿不到时为 `null`，不是空对象）。 */
  addressComponent: AddressComponents | null;
}

/** `locationError` 的载荷（官方 `GeolocationControlErrorEvent`）。 */
export interface LocationErrorEvent {
  /** 官方错误码。官方只声明了 `code: number`，没有可对照的枚举 —— 因此不替它编一张表。 */
  code: number;
}

export interface LocationControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;

  /* --- issue #165 Class 3 / TASK 3：官方 `GeolocationControlOptions` 的 8 个选项 ---
   *
   * 逐条取自 `@baidumap/jsapi-v4-types@4.0.5` 的 `control/GeolocationControlOptions.d.ts`
   * （该接口共 9 个键，本库此前只收了 `anchor` / `offset` 两个）。
   *
   * **全部构造期**：`GeolocationControl` 对这一族只给了**一个整袋入口**
   * `setOptions(options: GeolocationControlOptions): void`，没有一对一 setter；Driver 的
   * `CONTROL_OPTIONS_BAG.location = "setOptions"` 就是这条。因此任何一个变了都**重建控件**
   * （统一 adapter 按 `planOptions` 的 `recreate` 决定）——整袋写回与重建在此等价，
   * 而重建能让「新建实例时读到最新闭包」这件事成立。
   */
  /** 是否在控件上显示地址栏（官方 `showAddressBar?: boolean`）。 */
  showAddressBar?: boolean;
  /** 挂载后是否自动定位一次（官方 `enableAutoLocation?: boolean`）。 */
  enableAutoLocation?: boolean;
  /**
   * 定位时使用的自定义图标（官方 `locationIcon?: Icon`）。
   *
   * 收的是**图标描述**而不是 raw `BMap.Icon`：组件面不得接触 raw SDK 对象
   * （AGENTS.md 的边界规则），因此复用 `<Marker icon>` 那套描述形状
   * （见 `MarkerIconInput` / `core/icons/markerIcon` 的归一化）。
   */
  locationIcon?: MarkerIcon;
  /** 是否持续跟踪位置（官方 `watchPosition?: boolean`）。⚠️ 与「卸载」不同，见下。 */
  watchPosition?: boolean;
  /** 是否使用设备指南针定向（官方 `useCompass?: boolean`）。 */
  useCompass?: boolean;
  /** 定位成功后是否自动缩放到该点（官方 `autoZoom?: boolean`）。 */
  autoZoom?: boolean;
  /** 定位成功后是否自动调整视野包含该点（官方 `autoViewport?: boolean`）。 */
  autoViewport?: boolean;
  /**
   * 接管定位流程（官方
   * `onLocationStart?: (onSuccess, onFail) => boolean | void`）。
   *
   * **构造期回调**：官方对这一族只给了整袋入口 `setOptions`，没有 `setOnLocationStart`。
   * `onSuccess` / `onFail` 收到的是官方那两个回调；**本库不替它转调**
   * `locationSuccess` / `locationError` 事件（那需要猜「这次定位属于哪次命令」，
   * 而官方没有给这件事任何身份——与 `Autocomplete` 同款理由，见
   * `core/services/serviceTaskCore.ts` 的文件头）。
   *
   * **闭包永远最新，不需要重建**：见下方 `onLocationStartProxy` 的注释。
   */
  onLocationStart?: (
    onSuccess: (position: unknown) => void,
    onFail: () => void,
  ) => boolean | void;
}

/**
 * LocationControl —— 定位控件（官方 `GeolocationControl`）
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。两个 SDK 事件经 spec 的 `events`
 * 绑定，随**实例 scope** 释放（ADR 2026-09-11 §6：先解绑业务事件、再由 Map 移除控件）。
 *
 * 显隐用 SDK 的 `show()` / `hide()`：`visible=false` 只是把控件藏起来，**不会**顺带停下
 * 持续性定位跟踪——那是 `removeControl` 的语义（Driver 的 `remove` 会先调
 * `stopLocationTrace()`），属于「卸载」而不是「隐藏」。
 */
const props = withDefaults(defineProps<LocationControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 18, y: 18 }),
  visible: true,
});

/**
 * 事件载荷**从 `unknown` 收窄成官方命名类型**（ / TASK 4）。
 *
 * 此前两条事件的载荷都是 `unknown` —— 官方 `control/GeolocationControl.d.ts` 明明声明了
 * `GeolocationControlEventMap`（`locationSuccess: GeolocationControlSuccessEvent` /
 * `locationError: GeolocationControlErrorEvent`），消费方却拿不到任何字段。
 *
 * 逐条依据：
 * - `GeolocationControlSuccessEvent`：`type: string` / `target: GeolocationControl` /
 *   `point: Point` / `addressComponent: AddressComponent | null`；
 * - `GeolocationControlErrorEvent`：`type: string` / `target: GeolocationControl` /
 *   `code: number`。
 *
 * ⚠️ 本库**不**复刻 `target`（它是 raw `BMap.GeolocationControl`，组件面不得交出 raw 对象），
 * 因此载荷里只保留 `point` / `addressComponent` / `code` 三个**领域**字段。
 * ⚠️ `code` **不**配一张错误码枚举表：官方只声明 `code: number`，没有任何可对照的取值清单，
 * 猜一张表就是 AGENTS.md 说的「不取证就建抽象」。
 */const emit = defineEmits<{
  /** 官方事件形状取不到时为 `null`（不编一个 `{lng:0, lat:0}` 冒充成功）。 */
  locationSuccess: [e: LocationSuccessEvent | null];
  locationError: [e: LocationErrorEvent | null];
}>();

/**
 * 官方事件对象的取值入口。
 *
 * 控件事件与地图 / 覆盖物事件走**同一条** `normalizeDriverEvent` 路径（`driver/jsapi-v4/events.ts`），
 * 它按**地图**事件的形状重建载荷。官方 `GeolocationControlSuccessEvent` 的
 * `addressComponent` 与 `GeolocationControlErrorEvent` 的 `code` 都不在那套形状里，
 * 因此必须经 `raw` 逃生口取（见 `driver/types/events.ts` 的 `DriverEvent.raw`）。
 *
 * 归一化**不修改** `raw`（它就是 SDK 给的那个对象），因此从它取到的就是官方原样。
 */
function officialEvent(event: unknown): Record<string, unknown> | null {
  const raw = (event as { raw?: unknown } | null)?.raw;
  const record = (raw ?? event) as Record<string, unknown> | null;
  return record && typeof record === "object" ? record : null;
}

/**
 * 投影 `locationSuccess`（官方 `GeolocationControlSuccessEvent`）。
 *
 * 官方声明 `point: Point` 非空、`addressComponent: AddressComponent | null`（拿不到时是
 * **`null`**，不是空对象）。逐字段按类型收窄，取不到的 `addressComponent` 成员**留在
 * `undefined`**——不补空串（那会把「没给」与「空」混起来）。
 *
 * 整体取不到时为 `null`：编一个 `{ lng: 0, lat: 0 }` 会让「事件形状不对」变成一次静默的
 * 坐标错误。
 */
function readLocationSuccess(event: unknown): LocationSuccessEvent | null {
  const record = officialEvent(event);
  if (!record) return null;
  const point = record.point as { lng?: unknown; lat?: unknown } | null;
  if (!point || typeof point.lng !== "number" || typeof point.lat !== "number") return null;
  const raw = record.addressComponent as Record<string, unknown> | null | undefined;
  let addressComponent: AddressComponents | null = null;
  if (raw && typeof raw === "object") {
    addressComponent = {};
    for (const key of ADDRESS_TEXT_KEYS) {
      if (typeof raw[key] === "string") addressComponent[key] = raw[key] as string;
    }
  }
  return { point: { lng: point.lng, lat: point.lat }, addressComponent };
}

/** 官方 `AddressComponent` 的五个字符串成员。 */
const ADDRESS_TEXT_KEYS = [
  "streetNumber",
  "street",
  "district",
  "city",
  "province",
] as const satisfies readonly (keyof AddressComponents)[];

/** 投影 `locationError`（官方 `GeolocationControlErrorEvent`：`code: number`）。 */
function readLocationError(event: unknown): LocationErrorEvent | null {
  const record = officialEvent(event);
  if (!record || typeof record.code !== "number") return null;
  return { code: record.code };
}

/**
 * `onLocationStart` 的**稳定转发器**（issue #177）。
 *
 * ## 为什么需要它
 *
 * 官方 `GeolocationControlOptions.onLocationStart` 是一个**构造期回调**：它没有对应的
 * `setOnLocationStart`，而 `ControlSpec.options` 的变化键对函数值按**存在性**比较
 * （`core/controls/spec.ts` 的契约）——直接把用户的内联箭头放进 `options()`，
 * 换闭包不会触发重建（这是刻意的，否则模板里的内联箭头会让控件每次渲染都重建），
 * 但**首次创建之后再换的闭包就永远不会被 SDK 看到**。
 *
 * 此前这个 prop 干脆没进 `options()`（注释还写着「走 `create` 覆盖」，而那个钩子不存在），
 * 于是它**类型检查通过、Vue 正常接收、然后被静默丢弃**。
 *
 * ## 口径
 *
 * 它定义在 `<script setup>` 里，因此**每个组件实例一个**（不是模块级单例）；
 * 重要的性质是**同一实例的整个生命周期内引用不变**，而它在每次被调用时**现读** `props`。
 * 稳定性契约两种情况都成立——变化键只关心「同一个 props 视图算出来的引用有没有变」，
 * 而跨实例本来就是两组不同的 props——所以不必为了「模块级唯一」把它提到 `<script>`：
 * 那会把一个组件的 props 捕获进模块作用域，组件卸载后闭包仍持有它。
 *
 * 因此「最新闭包」成立，且**不引入任何重建**。
 *
 * 键的**存在性**仍然跟着用户走：没传 `onLocationStart` 时该键为 `undefined`，
 * Driver 的 `projectOptions` 会跳过它，SDK 侧就**不会**注册一个空回调——否则等于
 * 替用户凭空加了一个官方声明里不存在的回调。代价是「补上 / 删掉」这个 prop 会
 * 触发**一次**重建（存在性确实变了，这与该回调的构造期语义一致）。
 */
const onLocationStartProxy: NonNullable<LocationControlProps["onLocationStart"]> = (
  onSuccess,
  onFail,
) => props.onLocationStart?.(onSuccess, onFail);

const spec: ControlSpec<LocationControlProps, LocationCommandApi> = {
  kind: "location",
  // ⚠️ 用户的**原始回调**不进 `options`：`ControlSpec.options` 的契约要求「同 props 得同结果」，
  // 而内联箭头每次渲染都是新引用——把原值放进变化键会让控件**每次渲染都重建**。
  // 这里放的是 `onLocationStartProxy`（一个**稳定引用**的转发器），因此换闭包既不重建也不丢。
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    showAddressBar: p.showAddressBar,
    enableAutoLocation: p.enableAutoLocation,
    locationIcon: p.locationIcon,
    watchPosition: p.watchPosition,
    useCompass: p.useCompass,
    autoZoom: p.autoZoom,
    autoViewport: p.autoViewport,
    // 判据 `p.onLocationStart` 本身**也**被读（不是无条件带上代理）：没传这个 prop 时
    // 该键为 `undefined`，Driver 的 `projectOptions` 会跳过它，SDK 侧就**不会**注册一个
    // 官方声明里不存在的空回调。存在性仍然被变化键跟踪（函数折叠成 `"fn"` 只抹掉
    // 「换闭包」），因此「补上 / 删掉」这个 prop 会触发**一次**重建——这与该回调的
    // 构造期语义一致，而「换闭包」不会重建。
    onLocationStart: p.onLocationStart ? onLocationStartProxy : undefined,
  }),
  events: () => [
    ["locationSuccess", (event: unknown) => emit("locationSuccess", readLocationSuccess(event))],
    ["locationError", (event: unknown) => emit("locationError", readLocationError(event))],
  ],
  // 命令面（#168 item 1）。逐条依据见 `core/controls/controlCommands.ts` 的
  // `createLocationCommands` 注释与 `driver/types/controls.ts` 的 `LocationCommandApi`。
  expose: (exposeCtx) => createLocationCommands(exposeCtx),
};

const { commands, status } = useControlResource(props, spec);

defineExpose({
  ...(commands ?? {}),
  /**
   * 实例状态（`idle` / `creating` / `ready` / `error` / `disposing` / `disposed`）。
   *
   * 命令面在未就绪 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，因此**必须**有一个能先看状态的出口——
   * 否则调用方只能靠 try/catch 区分「还没好」与「已经没了」，而这两者的处置完全不同。
   */
  status,
});

defineOptions({ name: "LocationControl" });
</script>

<template>
  <slot />
</template>
