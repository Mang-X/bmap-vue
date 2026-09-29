/**
 * v4 OverlayDriver（M3A2-OVERLAYS / issue #21）
 *
 * 把 JSAPI 4.0 的覆盖物收敛成项目领域映射（`OverlayDriver`）；公共 API 只新增
 * 「Rectangle / CustomOverlay 两个构造入口」与「属性分类查询 `updatePolicy`」。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.5`）：
 * - 覆盖物统一经 `map.addOverlay/removeOverlay` 管理，显隐是继承来的 `show/hide/isVisible`；
 * - `InfoWindow` **不是**普通 Overlay：`map.openInfoWindow(infoWnd, point)` 必须带位置，
 *   关闭是地图级的 `map.closeInfoWindow()`（无参数），状态查询走公开的 `isOpen()` /
 *   `map.getInfoWindow()`——不用任何私有字段；
 * - `Rectangle` 收 Bounds；`CustomOverlay` 由 DOM 工厂 + 构造选项创建，4.0 缺 point 直接拒绝，
 *   因此项目签名把位置提为必填位置参数；
 * - `ContextMenu` 经 `map.addContextMenu/removeContextMenu` 挂在 Map 上（4.0 没有 Marker 级挂载）；
 * - `Marker3D` / `MapMask` 在 4.0.5**类型包**里都**没有类声明**（`MapMask` 全包 0 命中；
 *   `Marker3D` 只在 `const/Marker3DShapeType.d.ts` 的文档注释里出现，类本身缺席；4.0.5 同）——而官方
 *   React 参考实现 `huiyan-fe/react-bmap`（master 与 v2.0.6 都有 `Overlay/Marker3D.tsx` /
 *   `MapMask.tsx`，driver 侧有 `createMarker3D` 工厂与 `new BMap.MapMask` 调用）**两者都包了**。
 *   即缺口在「类型声明」而非「官方参考没有这个能力」，所以只能按命名空间结构性探测：
 *   有就按结构创建，没有就显式失败（不是静默降级）。
 *
 * 属性更新一律走 `driver/types/overlays.ts` 的 `OVERLAY_DESCRIPTORS`：`mutable` 调字段级 setter /
 * 成对开关；`recreate` 与 `unsupported` **不静默**——前者告警一次并把决定权交给调用方（组件侧
 * `useOverlayResource.applyOptions` 据此重建一次），后者告警一次说明本引擎没有该语义。
 * 组件因此不再需要探测 `raw.setIcon` 之类的成员形状。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import {
  createLruIconCache,
  DEFAULT_ICON_CACHE_SIZE,
  type IconCache,
} from "../../core/icons/iconCache";
import {
  isBuiltinMarkerIconName,
  resolveMarkerIconDescriptor,
} from "../../core/icons/markerIcon";
import type { CapabilityRegistry } from "../capability/registry";
import type { Bounds, GeometryDriver, Pixel, Point, Size } from "../types/geometry";
import type {
  InfoWindowHandle,
  MapHandle,
  MarkerHandle,
  OverlayHandle,
  SdkHandle,
} from "../types/handles";
import type {
  CustomOverlayOptions,
  InfoWindowOptions,
  LabelOptions,
  MarkerIconInput,
  MarkerLabelInput,
  MarkerOptions,
  OverlayAnchorName,
  OverlayDescriptor,
  OverlayDriver,
  OverlayKind,
  OverlayPropertySpec,
  MenuItemView,
  OverlayTarget,
  PathOptions,
} from "../types/overlays";
import { ANCHOR_VALUES } from "./controls";
import {
  OVERLAY_DESCRIPTORS,
  mutableSetter,
  mutableToggle,
  overlayDescriptor,
  overlayKindOf,
  overlayPropertyPolicy,
  overlayPropertySpec,
} from "../types/overlays";
import {
  assertJsapiV4Namespace,
  callOptional,
  callRequired,
  namespaceCtor,
  readNamespaceMember,
  requireRuntimeCtor as requireRuntimeCtorFromNamespace,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

export interface CreateJsapiV4OverlayDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4OverlayDriver(
  input: CreateJsapiV4OverlayDriverInput,
): OverlayDriver {
  const { rawSdk, geometry, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /**
   * `Marker.icon` 的**有界缓存**（M5-SPEC-MARKER / issue #30）。
   *
   * 作用域是 **Driver（= Client / SDK 域）**，不是单个实例：`createJsapiV4Driver` 每次装
   * Client 时创建一份，因此**同一个 Client 下的多张地图共用同一个缓存**（`<BMapProvider>` 下
   * 渲染两个 `<Map>` 就是这种情况），换一个 Client（换 AK / 换 Provider）就是另一份。
   *
   * - **descriptor 归一化**由 `core/icons/markerIcon` 负责（内置名 / 自定义描述的单一事实源），
   *   这里只做「descriptor → `BMap.Icon` 构造参数」——raw SDK 构造必须留在边界内；
   * - 键是 descriptor 的全字段，因此「同配置 ⇒ 同一个 Icon 实例」：一屏 500 个同款 Marker、
   *   或组件因构造期属性变化反复重建，都只创建一次 `BMap.Icon`；
   * - **上限**是必须的（{@link DEFAULT_ICON_CACHE_SIZE}）：只要用户在渲染里拼 `imageUrl`
   *   （带时间戳 / 宽度参数的 CDN 地址），键空间就是无界的；
   * - 缓存里的 Icon **只读、从不就地修改**：官方文档明确「直接调 `setImageUrl` / `setSize` 改 icon
   *   之后 Marker 不会同步刷新，必须重新 `setIcon(icon)`」。共享实例因此安全（官方示例也共享）；
   *   一旦我们原地改它，所有共享它的 Marker 都会跟着变；跨地图共享同理（Icon 是纯值对象，
   *   不属于任何一张地图）。**换图标 = 换 descriptor = 换缓存条目。**
   * - **只有库内部的 Marker 路径（`iconFor`）走缓存**：公共的 `buildIcon` 每次新建实例，
   *   因为 `useMarkerIcons()` 会把结果直接交给调用方，而 `BMap.Icon` 有可变面
   *   （外部评审 P2：公共 API 不得交出缓存持有的共享可变对象）。
   */
  const iconCache: IconCache<unknown> = createLruIconCache<unknown>(DEFAULT_ICON_CACHE_SIZE);

  /** 已告警过的「分类 / 键 / 种类」组合：每个 Driver 一份，避免重复刷屏。 */
  const warned = new Set<string>();
  /** `openInfoWindow` 打开过的气泡 → 它所属的 raw map（**归属**记账，不是打开状态）。 */
  const infoWindowOwners = new WeakMap<object, object>();
  /**
   * 每张地图**最近一次被请求打开**的气泡。
   *
   * 它的用途**只有一个**：`map.getInfoWindow()` 为空时那个**歧义窗口**的兜底判据。
   * 真实 4.0 的打开是异步的 —— 同一 tick 里刚 `openInfoWindow(B)` 时 `map.getInfoWindow()`
   * 仍是 `null`（实测 0ms 为 null、~100ms 变成该实例），这一刻没有任何事实能回答「当前是谁」。
   * 该窗口里只有「本 Driver 最后请求打开的气泡」才允许触碰地图，否则关一个旧气泡可能干扰
   * 正在进行的打开请求（PR #61 评审的跨气泡风险；真实 SDK 上未能复现，但这是本 Driver 唯一
   * 能自行保证的不变量，不依赖 SDK 内部时序）。
   *
   * ⚠️ **不要**把它提到 `map.getInfoWindow()` 之前当总闸（PR #101 第五轮评审 P1）：迟到的打开
   * 接管地图之后，「当前气泡」已经是本实例、而它早已不是「最后请求者」；按它挡掉关闭会把一个
   * 明确关闭静默丢弃 —— 气泡留在图上，状态机里已经记下的在飞账也永远等不到回包。
   */
  const lastRequestedByMap = new WeakMap<object, object>();
  /** `createContextMenu({ width })` → `MenuItem` 的默认宽度。 */
  const menuWidths = new WeakMap<object, number>();

  /**
   * 菜单 raw → **本库侧的条目表**（#165 Class 3 / TASK 2d/2e）。
   *
   * 为什么需要它：官方的 `ContextMenu#getItem(index): MenuItem` 返回 raw `MenuItem`，
   * 而 `MenuItem` 上**没有任何 getter**（`context-menu/MenuItem.d.ts` 只有
   * `setText` / `enable` / `disable`）。因此「读回一条菜单项」**只能**来自本库在
   * `addContextMenuItem` 时记下的结构——否则交出去的 raw 实例对调用方是**全盲**的
   * （它拿得到对象、读不到任何字段）。这正是本库把 `getItem` 改成返回 `MenuItemView`
   * 而不是 raw 实例的**直接后果**，不是妥协。
   *
   * 表与 SDK 侧**同序**且**同步维护**：`addContextMenuItem` 追加，`removeItem` /
   * `removeSeparator` 同步 `splice`。菜单重建时整张表换新（新的 `ContextMenu` raw 拿到
   * 一张新表），因此它不会跨代残留。
   */
  const contextMenuItems = new WeakMap<
    object,
    Array<{ kind: "item" | "separator"; model: Omit<MenuItemView, "index">; instance?: object }>
  >();

  /**
   * `MenuItem` raw → 它所属的那张条目表与它在表里的位置。
   *
   * `setText` 要能同时改 SDK **和**本库这份读回模型，否则「`getItem(i).text` 读到旧值」
   * 就是一处必然出现的分叉（正是这张表存在要消灭的东西）。`WeakMap` 随 `MenuItem`
   * 实例一起回收，不需要显式清理。
   */
  const contextMenuItemOwners = new WeakMap<
    object,
    { entries: Array<{ kind: "item" | "separator"; model: Omit<MenuItemView, "index">; instance?: object }> }
  >();

  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
  };

  /** 句柄种类：只读品牌即可（纯元数据），真正的所有权校验留给 `registry.resolve`。 */
  const kindOfHandle = (overlay: OverlayHandle): OverlayKind => {
    const kind = overlayKindOf(overlay);
    if (!kind) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        "覆盖物句柄种类无法识别：句柄必须由本 Driver 创建（raw SDK 对象请先经 SDK 边界包装）",
        { engine: "jsapi-v4" },
      );
    }
    return kind;
  };

  /** 属性元数据查询走公共描述符（`driver/types/overlays.ts`），Driver 不另抄一份键表。 */
  const specOf = (descriptor: OverlayDescriptor, key: string): OverlayPropertySpec | undefined =>
    overlayPropertySpec(descriptor.kind, key);

  const rawSize = (pixel: Pixel): unknown =>
    geometry.toRawSize({ width: pixel.x, height: pixel.y });

  /** 未知内置名的告警（两条图标路径共用）。 */
  const warnUnknownIconName = (icon: MarkerIconInput): void => {
    if (typeof icon === "string" && !isBuiltinMarkerIconName(icon)) {
      // 未知名字此前会**静默**落进兜底图标（旧实现里 20 个内置名都如此），至少要说出来。
      warnOnce(
        `icon:unknown-name:${icon}`,
        `OverlayDriver: "${icon}" 不是内置图标名，已按兜底图标（simple_red）渲染；` +
          "内置名清单见 core/icons/markerIcon 的 BUILTIN_MARKER_ICON_NAMES",
      );
    }
    if (typeof icon !== "string" && (icon as { printImageUrl?: unknown } | null)?.printImageUrl) {
      // 4.0.5 的 IconOptions 只声明 anchor / imageOffset / imageSize，没有打印图入口。
      //
      // ⚠️ `printImageUrl` 已从 `MarkerIconInput` 的**类型面**删除（issue #177），因此 TypeScript
      // 不会让任何合法调用方走到这里——只有 JS / `any` 调用方仍能传进来。告警**保留**：
      // 类型面之外的真实运行仍然可能带着这个键，诊断丢掉它就退化成静默丢弃。
      warnOnce(
        "icon:print-image-url",
        "OverlayDriver: 图标描述里的 printImageUrl 在 JSAPI 4.0 的 IconOptions 里没有对应项（4.0.5 只声明 anchor / imageOffset / imageSize），已丢弃；该字段已从 bmap-vue 的图标类型中移除",
      );
    }
  };

  /** descriptor → **新建**的 raw `Icon`（不做缓存）。 */
  const constructIcon = (descriptor: ReturnType<typeof resolveMarkerIconDescriptor>): unknown => {
    const Icon = namespaceCtor(namespace, "Icon");
    const opts: Record<string, unknown> = {};
    if (descriptor.imageSizeWidth != null && descriptor.imageSizeHeight != null) {
      opts.imageSize = geometry.toRawSize({
        width: descriptor.imageSizeWidth,
        height: descriptor.imageSizeHeight,
      });
    }
    if (descriptor.anchorX != null && descriptor.anchorY != null) {
      opts.anchor = geometry.toRawSize({ width: descriptor.anchorX, height: descriptor.anchorY });
    }
    if (descriptor.imageOffsetX != null && descriptor.imageOffsetY != null) {
      opts.imageOffset = geometry.toRawSize({
        width: descriptor.imageOffsetX,
        height: descriptor.imageOffsetY,
      });
    }
    return new Icon(
      descriptor.imageUrl,
      geometry.toRawSize({ width: descriptor.width, height: descriptor.height }),
      opts,
    );
  };

  /**
   * **公共** `buildIcon`：每次调用都返回一个**新的** `BMap.Icon`。
   *
   * `BMap.Icon` 有 `setImageUrl` / `setSize` / `setAnchor` 等可变面，而
   * `useMarkerIcons()`（公开 hook）把这里的结果直接交给调用方。公共 API **不得**交出
   * 缓存持有的共享可变对象——否则一个消费者改了自己那份，会污染同一 Client 下所有地图后续拿到的
   * 图标（外部评审 P2）。因此缓存只服务**库内部**的 Marker 路径（{@link iconFor}）。
   */
  const buildIcon = (icon: MarkerIconInput): unknown => {
    warnUnknownIconName(icon);
    return constructIcon(resolveMarkerIconDescriptor(icon));
  };

  /**
   * **内部**图标解析（Marker 的构造与 `setIcon` 路径）：同 descriptor 命中**有界 LRU 缓存**，
   * 返回同一个 raw `Icon`。
   *
   * 缓存持有的实例只被读、从不就地修改（官方指南：改了 icon 自己也必须重新 `setIcon`），
   * 因此共享是安全的；且它**不经过**任何公开 API，调用方拿不到这份实例。
   */
  const iconFor = (icon: MarkerIconInput): unknown => {
    warnUnknownIconName(icon);
    const descriptor = resolveMarkerIconDescriptor(icon);
    return iconCache.get(descriptor, () => constructIcon(descriptor));
  };

  /**
   * `Marker.label`：本库的**领域形状** → raw `BMap.Label`（issue #165 第三批）。
   *
   * ## 为什么必须在这一层构造
   *
   * 官方 `MarkerOptions.label` / `Marker#setLabel(label: Label)` 的类型是 `BMap.Label`
   * ——一个 raw SDK 对象。组件面**不构造** SDK 对象（AGENTS.md 的 raw SDK 边界），
   * 因此这个 `new BMap.Label(...)` 只能发生在 Driver 边界内；组件传领域形状（`MarkerLabelInput`）。
   * 若把领域对象原样递下去（`value: "raw"` 的后果），官方读到的是普通 JS 对象，
   * 标注**不显示且不报错**——那是最难排查的一类静默失败。
   *
   * ## 释放路径：为什么这个 Label **不**登记进 Registry
   *
   * 从属 Label 随 Marker 一起被 `map.removeOverlay(marker)` 释放（官方语义：Label 挂在
   * Marker 上时不需要独立 `addOverlay`），因此**不另建** registration——那会造出第四种
   * 「谁负责摘它」的答案（Marker 摘 / 用户摘 / Registry 摘 / 谁都不摘）。
   * 换 Marker 实例时旧 Label 随旧 Marker 一起消失，与 `Marker#icon` 的处理同一条口径。
   *
   * ## 没有缓存（与 `iconFor` 相反）
   *
   * `Icon` 是**纯值对象**、可安全共享；`Label` 有可变面（`setContent` / `setPosition` …）
   * 且**一个 Label 只属于一个 Marker**——共享实例会让「改了 A 的标注，B 的也跟着变」。
   * 因此每次都新建。这也意味着 `projectOptions` 每次调用会产生新实例：官方只在**构造时**
   * 读一次 `label`，不会反复调，所以不构成问题（与 `GroundOverlay.url` 的投影同一注意事项）。
   */
  const markerLabelFor = (spec: MarkerLabelInput): unknown => {
    const Label = namespaceCtor(namespace, "Label");
    const opts: Record<string, unknown> = {};
    if (spec.position !== undefined) opts.position = geometry.toRawPoint(spec.position);
    if (spec.offset !== undefined) opts.offset = rawSize(spec.offset);
    if (spec.style !== undefined) opts.styles = spec.style;
    return new Label(spec.content, opts);
  };

  /**
   * 锚点的**官方常量名** → 官方数值（issue #165 第三批）。
   *
   * 复用控件那一族的**同一张** `ANCHOR_VALUES`（`driver/jsapi-v4/controls.ts` 把它导出在这里
   * 共享，见该常量旁的注释）。刻意**不**另抄一份：两张表一旦漂移，同一个 `anchor` 名在
   * `<ZoomControl>` 与 `<Label>` 上会落到不同的角——那是肉眼几乎发现不了的 bug。
   *
   * ⚠️ 与控件的 `resolveAnchor` 有一处**故意的**差别：控件只接受四角（官方 4.0 的控件会
   * 把 `TOP_CENTER` 之类**静默回落**到默认落点），因此它对非四角会告警；覆盖物的
   * `setAnchor` / `LabelOptions.anchor` 接受**全部九个**（官方 `ControlAnchor` 就是九元联合，
   * `Label` 的 `setAnchor` 文档示例正是 `BMAP_ANCHOR_BOTTOM_CENTER`），所以这里**不**告警。
   * 真正无法换算的（不认识的名字）两条路径同样处理：告警一次 + **不透传**。
   */
  const anchorFor = (anchor: OverlayAnchorName): unknown => {
    const value = ANCHOR_VALUES[anchor];
    if (value === undefined) {
      warnOnce(
        `anchor:unknown:${anchor}`,
        `OverlayDriver: 不认识的锚点 "${anchor}"；JSAPI 4.0 的锚点是官方常量名（` +
          "BMAP_ANCHOR_TOP_LEFT / TOP_CENTER / CENTER / BOTTOM_CENTER …），本次取值已忽略，" +
          "该属性沿用 SDK 自身默认锚点",
      );
      return undefined;
    }
    return value;
  };

  /** 领域值 → v4 构造参数 / setter 入参。 */
  const normalize = (spec: OverlayPropertySpec, value: unknown): unknown => {
    switch (spec.value) {
      case "point":
        return geometry.toRawPoint(value as Point);
      case "points":
        return geometry.toRawPoints(value as readonly Point[]);
      case "path":
        // 允许 SDK 原生字符串路径（行政区边界名），与 setPath 的口径保持一致
        return toRawPath(value as readonly (Point | string)[]);
      case "point-groups":
        return (value as readonly (readonly Point[])[]).map((group) =>
          geometry.toRawPoints(group),
        );
      case "bounds":
        return geometry.toRawBounds(value as Bounds);
      case "size":
        // 项目侧偏移是 Pixel（`{x, y}`），v4 的 offset / anchor 是 Size（`{width, height}`）
        return rawSize(value as Pixel);
      case "size-shape":
        // 同 `size` 的归一化，但组件侧的形状**就是** Size（`{width, height}`）——`GroundPoint`
        // 的 `size` / `anchor` / `offset` 在官方 `GroundPointOptions` 里声明为 `Size`。
        return geometry.toRawSize(value as Size);
      case "icon":
        return iconFor(value as MarkerIconInput);
      case "marker-label":
        return markerLabelFor(value as MarkerLabelInput);
      case "anchor":
        return anchorFor(value as OverlayAnchorName);
      default:
        return value;
    }
  };

  /**
   * 领域 options → v4 构造 options。
   *
   * - 描述符里**有 ctorKey** 的键：改写成 v4 的键名并按 `value` 归一化（`recreate` 分类的键也
   *   属于构造期属性，因此同样投影）；
   * - 描述符里 `ctorKey === null` 的键：是位置参数，已在各 `create*` 里显式传入，这里剔除，
   *   避免同一个值既走位置参数又进 options；
   * - 描述符**没有**的键：原样透传（项目 option 接口的索引签名就是 v4 自身构造选项的逃生口，
   *   例如 GroundOverlay 的 `type`、Prism 的 `autoCenter`）；
   * - `unsupported` 分类的键：显式告警（本引擎没有该语义），不透传也不静默。
   */
  const projectOptions = (
    descriptor: OverlayDescriptor,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      const spec = specOf(descriptor, key);
      if (!spec) {
        projected[key] = value;
        continue;
      }
      if (spec.policy === "unsupported") {
        warnOnce(
          `${descriptor.kind}:ctor:${key}`,
          `OverlayDriver: ${descriptor.kind}.${key} 在 JSAPI 4.0 不支持（${spec.reason}），构造时已忽略`,
        );
        continue;
      }
      if (spec.ctorKey == null) continue;
      const normalized = normalize(spec, value);
      // ⚠️ **归一化可能「拒绝」这个值**（`anchorFor` 对不认识的常量名告警并给 `undefined`）。
      // 拒绝的键**必须整个不出现**——把 `anchor: undefined` 塞进构造 options 与「键不存在」
      // 在 SDK 侧不是一回事：前者会让官方读到「用户显式要求了一个无意义的值」。
      // 与控件 Driver 的 `if (anchor !== undefined)` 同款守卫（同一条 `ANCHOR_VALUES`）。
      if (normalized === undefined) continue;
      projected[spec.ctorKey] = normalized;
    }
    return projected;
  };

  /** 采纳 raw 对象为句柄：先按能力策略守卫，再登记（品牌 = `overlay:<kind>`）。 */
  const adopt = <Kind extends OverlayKind>(
    kind: Kind,
    raw: unknown,
  ): SdkHandle<`overlay:${Kind}`> => {
    const descriptor = overlayDescriptor(kind);
    if (descriptor.capability) capabilities.require(descriptor.capability);
    return registry.adopt(`overlay:${kind}`, raw);
  };

  const ctorFor = (kind: OverlayKind): JsapiV4Ctor =>
    namespaceCtor(namespace, overlayDescriptor(kind).ctor);

  const toRawPath = (path: readonly (Point | string)[]): unknown[] =>
    path.map((point) => (typeof point === "string" ? point : geometry.toRawPoint(point)));

  /**
   * 语义键 → 官方 setter 的**唯一**调用点：专用入口（setPosition / setPath）与通用入口
   * （setOptions）都经这里落地，参数一律取自描述符（含 `valueArgs` 常量尾随参数），
   * 避免两条路径对同一次更新传不同的参数（PR #61 评审 P2-2）。
   */
  const applyFieldUpdate = (
    raw: Record<string, unknown>,
    kind: OverlayKind,
    key: string,
    value: unknown,
  ): void => {
    const spec = overlayPropertySpec(kind, key);
    const setter = spec ? mutableSetter(spec) : undefined;
    if (!spec || !setter) {
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `OverlayDriver: ${kind} 没有可用的 "${key}" 更新入口（描述符里没有该键或不是 mutable）`,
        { engine: "jsapi-v4" },
      );
    }
    // ⚠️ 归一化「拒绝」这个值时**不调 setter**（同 `projectOptions` 的守卫与理由：
    // `anchorFor` 对不认识的常量名告警并给 `undefined`；调 `setAnchor(undefined)` 是
    // 「把一个无意义的值写进 SDK」，而不是「沿用默认」——与控件 Driver 的
    // `if (anchor !== undefined)` 同款）。
    //
    // 判据是**归一化后**的入参而不是原值：`normalize` 只可能因为「拒绝」才返回 `undefined`
    //（`raw` 一路原样返回，调用方传进来什么就是什么），因此这一条只会在拒绝发生时命中。
    const normalized = normalize(spec, value);
    if (normalized === undefined) return;
    sdkCall(setter, () => callRequired(raw, setter, normalized, ...(spec.valueArgs ?? [])));
  };

  /**
   * 位置类更新用的语义键。
   *
   * - 圆是 `center`（`Circle#setCenter`）——描述符里的键就叫 `center`；
   * - **贴地点是 `point`**——官方 `GroundPoint.d.ts:29` 的位置入口是 `setPoint`，
   *   描述符里的键因此是 `point` 而**不是**通用的 `position`（后者会落到 `setPosition`，
   *   官方 `GroundPoint` 上**没有**这个方法）。这是与 `Marker`（`setPosition`）、
   *   `marker3d`（同样是 `setPoint`）各自不同的入口，必须逐类登记，不能默认。
   * - 其余各类都是 `position`。
   */
  const POSITION_KEY: Partial<Record<OverlayKind, string>> = {
    circle: "center",
    "ground-point": "point",
  };

  /* ------------------------------------------------- 读回 / 命令面（#165 Class 3）
   *
   * 官方读回返回的是 raw `BMap.Point` / `BMap.Bounds` / `BMap.Size` / `BMap.MenuItem`；
   * 组件面**不得**接触 raw SDK 对象（AGENTS.md 的边界规则），因此投影全部收在这一处，
   * 公共调用面只给领域值。
   *
   * 几何投影**复用 `GeometryDriver` 的 `fromRawPoint` / `fromRawBounds`**（不另抄一份）：
   * 那一族已经在 `driver/jsapi-v4/geometry.ts` 里处理了「空 Bounds 返回 null」这类上游怪癖，
   * 两处各写一遍必然在某个边角上分叉。`Size` → `Pixel` 的换算也走 `geometry`（组件侧的
   * `offset` 一直是 Pixel，见 `useOverlaySpec` 的 `fixedShapeKeyOf` 注释）。
   *
   * **两条与 `setOptions` 不同的口径**：
   * 1. 读回用 `callRequired`（成员缺失 ⇒ 显式失败），不像 `setOptions` 那样对 `mutable`
   *    声明但实例缺成员只告警一次——读回没有「忽略」这个选项，调用方要的是一个值。
   * 2. 几何**形状不符**如实报错（由 `geometry` 一族抛），不编一个默认值：那会让
   *    「上游形状变了」变成一次静默的坐标错误。
   */

  /** 读回一个无参的字符串 / 数值 / 枚举（`callRequired` ⇒ 成员缺失即失败）。 */
  const readScalar = <T>(raw: object, method: string): T =>
    sdkCall(method, () => callRequired(raw, method)) as T;

  /** raw `BMap.Size`（`{width, height}`）→ 领域 `Pixel`（`{x, y}`）。 */
  const fromRawSizeToPixel = (raw: unknown): Pixel => {
    const size = geometry.fromRawSize(raw);
    return { x: size.width, y: size.height };
  };

  /** 读回一族无参成员（官方：`Circle.d.ts` / `Rectangle.d.ts` / `Polygon.d.ts` / `Polyline.d.ts`）。 */
  const createPathReadBackApi = (raw: object) => ({
    getBounds: () =>
      geometry.fromRawBounds(sdkCall("getBounds", () => callRequired(raw, "getBounds"))),
    getStrokeColor: () => readScalar<string>(raw, "getStrokeColor"),
    getStrokeOpacity: () => readScalar<number>(raw, "getStrokeOpacity"),
    getStrokeWeight: () => readScalar<number>(raw, "getStrokeWeight"),
    getStrokeStyle: () => readScalar<"solid" | "dashed" | "dotted">(raw, "getStrokeStyle"),
  });

  const createPathFillReadBackApi = (raw: object) => ({
    getFillColor: () => readScalar<string>(raw, "getFillColor"),
    getFillOpacity: () => readScalar<number>(raw, "getFillOpacity"),
  });

  /** 覆盖物只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const requireMapTarget = (target: OverlayTarget, operation: string): object => {
    if (target.kind !== "map") {
      warnOnce(
        `target:${target.kind}`,
        `OverlayDriver.${operation}: JSAPI 4.0 的覆盖物只能挂到 Map（map.addOverlay / removeOverlay）；` +
          `目标 kind="${target.kind}" 没有运行时入口（BMapGL 的 Marker / Clusterer 级挂载属迁移期能力），本次调用被拒绝`,
      );
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `OverlayDriver.${operation}: target.kind="${target.kind}" 在 JSAPI 4.0 没有运行时入口`,
        { engine: "jsapi-v4" },
      );
    }
    return registry.resolve<object>(target.handle);
  };

  /**
   * 右键菜单的挂载目标（M5-CUSTOM-MENU / issue #33）。
   *
   * **只有 `map` 与 `marker` 两个目标**，依据分两档：
   *
   * | 目标 | SDK 入口 | 依据 |
   * | --- | --- | --- |
   * | `map` | `Map#addContextMenu(menu)` / `#removeContextMenu(menu)` | 官方 4.0.5 的 `core/Map.d.ts` 里有声明（**一个** 参数，没有目标参数） |
   * | `marker` | `Marker#addContextMenu(menu)` / `#removeContextMenu(menu)` | **运行时扩展**：`@baidumap/jsapi-v4-types@4.0.5` 只在 `Map` 上声明，但真实 4.0 的 `Marker.prototype` 上有这两个成员且可用（真实 AK 实测，读数见 ADR `2026-09-19-custom-overlay-and-context-menu`） |
   *
   * 其余 kind（`overlay` / `clusterer`）**没有任何入口证据**，显式拒绝——本库不把「挂到地图」
   * 当成回退（那是另一种语义，会让菜单在整张地图上冒出来），也不静默忽略。
   *
   * `marker` 这一档刻意**不做就地类型 augmentation**：它是运行时扩展成员，按仓库对
   * `Marker3D` / `MapMask` 的既有口径（白名单 README 的「先确认能否用项目领域类型绕开」）
   * 走**结构性查找 + 缺失即显式失败**。
   */
  const requireContextMenuTarget = (target: OverlayTarget, operation: string): object => {
    if (target.kind !== "map" && target.kind !== "marker") {
      warnOnce(
        `menu-target:${target.kind}`,
        `OverlayDriver.${operation}: 右键菜单只支持 map 与 marker 目标（4.0 的实测入口是 ` +
          `Map#addContextMenu 与 Marker#addContextMenu）；目标 kind="${target.kind}" 没有运行时入口，本次调用被拒绝`,
      );
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `OverlayDriver.${operation}: target.kind="${target.kind}" 没有右键菜单入口`,
        { engine: "jsapi-v4" },
      );
    }
    return registry.resolve<object>(target.handle);
  };

  /**
   * 在运行时扩展目标（`marker`）上调用菜单挂载/摘除成员。
   *
   * 成员缺失时**显式失败**而不是静默 no-op：真实 4.0 的 `Map` 与 `Marker` 都有它，缺失说明
   * 「这个版本/这个 target 与实测形态不一致」，静默忽略会让使用者看到「菜单挂不上但不报错」。
   */
  const callContextMenuTargetMethod = (
    rawTarget: object,
    method: string,
    menu: object,
    operation: string,
    targetKind: string,
  ): void => {
    const fn = readNamespaceMember(rawTarget, method);
    if (typeof fn !== "function") {
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `OverlayDriver.${operation}: kind="${targetKind}" 的目标上没有 ${method}（真实 4.0 的 Map 与 Marker 都有它）`,
        { engine: "jsapi-v4" },
      );
    }
    sdkCall(`${targetKind}.${method}`, () => (fn as (m: object) => unknown).call(rawTarget, menu));
  };

  const assertNotInfoWindow = (kind: OverlayKind, operation: string): void => {
    if (kind !== "info-window") return;
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `OverlayDriver.${operation}: InfoWindow 不作为普通覆盖物处理——打开/关闭是地图级 API，` +
        "请用 openInfoWindow(map, infoWindow, position) / closeInfoWindow(infoWindow)",
      { engine: "jsapi-v4" },
    );
  };

  /**
   * 结构性查找「官方类型包没有声明」的运行时扩展构造器。
   *
   * 不预判版本、也不臆造 augmentation：有就按结构创建，没有就显式失败并点名缺的是哪个构造器
   * （与 ADR 2026-09-11-jsapi-v4-map-facet 对 `tilt-gestures` 的处理同源）。结构性探测本身
   * 收敛在 `internal.requireRuntimeCtor`，Overlay / Layer Facet 共用同一份口径。
   *
   * 真实 AK smoke（ADR「真实 AK smoke 记录」一节）确认：`Marker3D` / `MapMask` 在 4.0 运行时
   * **都存在**，只是 `@baidumap/jsapi-v4-types@4.0.5` 没有类声明——所以这条路在真实 SDK 上会
   * 直接创建成功；失败分支只在「运行时确实没提供」时触发（Fake v4 故意不提供，用来覆盖它）。
   */
  const requireRuntimeCtor = (kind: OverlayKind, hint: string): JsapiV4Ctor => {
    const name = overlayDescriptor(kind).ctor;
    return requireRuntimeCtorFromNamespace(namespace, name, (message) =>
      warnOnce(`${kind}:no-runtime-entry`, `OverlayDriver: ${message}；"${kind}" 无法创建；${hint}`),
    );
  };

  return {
    createMarker(position, options: MarkerOptions = {}): MarkerHandle {
      const opts = projectOptions(overlayDescriptor("marker"), options);
      const raw = sdkCall(
        "Marker",
        () => new (ctorFor("marker"))(geometry.toRawPoint(position), opts),
      );
      return adopt("marker", raw);
    },

    createPolyline(path, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("polyline"), options);
      const raw = sdkCall(
        "Polyline",
        () => new (ctorFor("polyline"))(geometry.toRawPoints(path), opts),
      );
      return adopt("polyline", raw);
    },

    createPolygon(path, options: PathOptions & { isBoundary?: boolean } = {}) {
      const opts = projectOptions(overlayDescriptor("polygon"), options);
      const raw = sdkCall("Polygon", () => new (ctorFor("polygon"))(toRawPath(path), opts));
      return adopt("polygon", raw);
    },

    createRectangle(bounds, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("rectangle"), options);
      const raw = sdkCall(
        "Rectangle",
        () => new (ctorFor("rectangle"))(geometry.toRawBounds(bounds), opts),
      );
      return adopt("rectangle", raw);
    },

    createCircle(center, radius, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("circle"), options);
      const raw = sdkCall(
        "Circle",
        () => new (ctorFor("circle"))(geometry.toRawPoint(center), radius, opts),
      );
      return adopt("circle", raw);
    },

    createInfoWindow(content, options: InfoWindowOptions = {}): InfoWindowHandle {
      const opts = projectOptions(overlayDescriptor("info-window"), options);
      const raw = sdkCall("InfoWindow", () => new (ctorFor("info-window"))(content, opts));
      return adopt("info-window", raw);
    },

    createLabel(content, options: LabelOptions = {}) {
      const opts = projectOptions(overlayDescriptor("label"), options);
      const raw = sdkCall("Label", () => new (ctorFor("label"))(content, opts));
      return adopt("label", raw);
    },

    createPrism(path, altitude, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("prism"), options);
      const raw = sdkCall("Prism", () => new (ctorFor("prism"))(toRawPath(path), altitude, opts));
      return adopt("prism", raw);
    },

    createMarker3D(position, height, options: Record<string, unknown> = {}) {
      // `Marker3D` 在类型包里只出现在 const/Marker3DShapeType.d.ts 的文档注释里（没有类声明），
      // 但真实 4.0 运行时确实提供该构造器 → 按结构创建；缺成员时才显式失败。
      const Ctor = requireRuntimeCtor(
        "marker3d",
        "需要 3D 标记时可改用 Marker + 自定义 icon",
      );
      const opts = projectOptions(overlayDescriptor("marker3d"), options);
      const raw = sdkCall("Marker3D", () => new Ctor(geometry.toRawPoint(position), height, opts));
      return adopt("marker3d", raw);
    },

    createBezierCurve(path, controlPoints, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("bezier-curve"), options);
      const raw = sdkCall(
        "BezierCurve",
        () =>
          new (ctorFor("bezier-curve"))(
            geometry.toRawPoints(path),
            controlPoints.map((group) => geometry.toRawPoints(group)),
            opts,
          ),
      );
      return adopt("bezier-curve", raw);
    },

    createMapMask(path, options: Record<string, unknown> = {}) {
      // 同 `createMarker3D`：类型包无类声明，但真实 4.0 运行时提供 `MapMask`。
      const Ctor = requireRuntimeCtor("map-mask", "本仓库的 <MapMask> 需要该构造器");
      const opts = projectOptions(overlayDescriptor("map-mask"), options);
      const raw = sdkCall("MapMask", () => new Ctor(geometry.toRawPoints(path), opts));
      return adopt("map-mask", raw);
    },

    createGroundOverlay(bounds, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("ground-overlay"), options);
      const raw = sdkCall(
        "GroundOverlay",
        () => new (ctorFor("ground-overlay"))(geometry.toRawBounds(bounds), opts),
      );
      return adopt("ground-overlay", raw);
    },

    createGroundPoint(position, options: Record<string, unknown> = {}) {
      // `GroundPoint` 在 4.0.5 **有完整类声明**（`overlay/GroundPoint.d.ts:5`
      // `class GroundPoint extends GroundOverlay`），与 `Marker3D` / `MapMask` 那种
      // 「只在文档出现、类型包无声明」的情况不同 ⇒ 走严格命名空间查找 `ctorFor`。
      const opts = projectOptions(overlayDescriptor("ground-point"), options);
      const raw = sdkCall(
        "GroundPoint",
        () => new (ctorFor("ground-point"))(geometry.toRawPoint(position), opts),
      );
      return adopt("ground-point", raw);
    },

    createCustomOverlay(position, render, options: CustomOverlayOptions = {}) {
      // anchor（元组）与 offset（拆成 offsetX/offsetY）先摘出来，再走统一的构造选项投影
      const { anchor, offset, ...rest } = options;
      const opts = projectOptions(overlayDescriptor("custom-overlay"), rest);
      opts.point = geometry.toRawPoint(position);
      if (anchor) opts.anchors = [anchor.x, anchor.y];
      if (offset) {
        opts.offsetX = offset.x;
        opts.offsetY = offset.y;
      }
      const raw = sdkCall("CustomOverlay", () => new (ctorFor("custom-overlay"))(render, opts));
      return adopt("custom-overlay", raw);
    },

    createContextMenu(options) {
      const raw = sdkCall("ContextMenu", () => new (ctorFor("context-menu"))());
      // ContextMenu 自身没有宽度；宽度是 MenuItem 的构造选项，因此记成默认值
      if (options?.width != null) menuWidths.set(raw as object, options.width);
      return adopt("context-menu", raw);
    },

    addContextMenuItem(menu, item, options) {
      const raw = registry.resolve<object>(menu);
      const entries = contextMenuItems.get(raw) ?? [];
      contextMenuItems.set(raw, entries);
      if (item === "-") {
        sdkCall("ContextMenu.addSeparator", () => callRequired(raw, "addSeparator"));
        entries.push({ kind: "separator", model: { text: "", disabled: false } });
        return;
      }
      const width = options?.width ?? menuWidths.get(raw);
      const MenuItem = namespaceCtor(namespace, "MenuItem");
      // `MenuItemOptions` 只有这两个键（4.0.5 的 `context-menu/MenuItemOptions.d.ts`）：`width` 与 `id`。
      // 两者都是**构造期**输入，实例上没有对应 setter ⇒ 调用方改了它们只能重建菜单（组件侧就是这么做的）。
      const menuItemOptions: Record<string, unknown> = {};
      if (width != null) menuItemOptions.width = width;
      if (options?.id != null) menuItemOptions.id = options.id;
      const menuItem = sdkCall(
        "MenuItem",
        () => new MenuItem(item.text, item.callback, menuItemOptions),
      );
      if (item.disabled) callOptional(menuItem, "disable");
      sdkCall("ContextMenu.addItem", () => callRequired(raw, "addItem", menuItem));
      // 记进本库侧条目表（读回的唯一来源，理由见 `contextMenuItems` 的注释）
      const model: Omit<MenuItemView, "index"> = {
        text: item.text,
        disabled: item.disabled === true,
        ...(width != null ? { width } : {}),
        ...(options?.id != null ? { id: options.id } : {}),
      };
      entries.push({ kind: "item", model, instance: menuItem as unknown as object });
      contextMenuItemOwners.set(menuItem as unknown as object, { entries });
    },

    /**
     * 菜单的逐条命令面（#165 Class 3 / TASK 2d）。
     *
     * **`getItem` 的返回值经本库条目模型投影**：官方 `ContextMenu#getItem(index): MenuItem`
     * 返回 raw 实例，而 `MenuItem` 上**没有任何 getter**（`context-menu/MenuItem.d.ts` 只有
     * `setText` / `enable` / `disable`）——把它交出去等于发一个「调用方什么也读不到」的对象。
     * 因此读回的内容（文字 / 禁用态）来自**本库维护的条目表**（`contextMenuItems`），
     * 那是菜单真正建成时的**结构**；SDK 侧的结构由 `getItem` 的存在性校验。
     */
    contextMenuCommands(menu) {
      const raw = registry.resolve<object>(menu);
      // 本库侧的条目表（与 SDK 侧同序）：`addContextMenuItem` 每建一条就在这里记一份。
      const items = contextMenuItems.get(raw);
      if (!items) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "ContextMenu.handle：菜单不是由本 Driver 的 addContextMenuItem 建的" +
            "（条目表里没有它）——读回无从谈起，如实失败而不是编一个空表",
          { engine: "jsapi-v4" },
        );
      }
      return {
        getItem(index: number): MenuItemView | null {
          if (!Number.isInteger(index) || index < 0) {
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `getItem 的 index 必须是非负整数，实际是 ${String(index)}`,
              { engine: "jsapi-v4" },
            );
          }
          const entry = items[index];
          if (!entry) return null;
          // 分隔线没有「菜单项」可言 ⇒ 先判，再问 SDK：官方 `getItem` 落在分隔线上
          // 本身就是一次没有意义的调用（真实 v4 上返回 `undefined`，替身上会抛）。
          if (entry.kind === "separator") return null;
          // 存在性由 SDK 侧确认（官方 `getItem` 越界会抛），本库这一侧只投影结构。
          sdkCall("ContextMenu.getItem", () => callRequired(raw, "getItem", index));
          return { ...entry.model, index };
        },
        removeItem(index: number): boolean {
          const entry = items[index];
          if (!entry || entry.kind === "separator") return false;
          const item = sdkCall("ContextMenu.getItem", () => callRequired(raw, "getItem", index));
          sdkCall("ContextMenu.removeItem", () => callRequired(raw, "removeItem", item));
          items.splice(index, 1);
          return true;
        },
        removeSeparator(index: number): boolean {
          const entry = items[index];
          if (!entry || entry.kind !== "separator") return false;
          sdkCall("ContextMenu.removeSeparator", () => callRequired(raw, "removeSeparator", index));
          items.splice(index, 1);
          return true;
        },
        setItemText(index: number, text: string): void {
          if (typeof text !== "string") {
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `setItemText 的入参必须是字符串，实际是 ${typeof text}`,
              { engine: "jsapi-v4" },
            );
          }
          const entry = items[index];
          if (!entry || entry.kind === "separator" || !entry.instance) {
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `setItemText(${index}): 该序号没有菜单项（或越界）`,
              { engine: "jsapi-v4" },
            );
          }
          sdkCall("MenuItem.setText", () => callRequired(entry.instance!, "setText", text));
          // 同步本库读回模型，否则 `getItem(index).text` 与 SDK 会立刻分叉
          entry.model = { ...entry.model, text };
        },
        setItemEnabled(index: number, enabled: boolean): void {
          const entry = items[index];
          if (!entry || entry.kind === "separator" || !entry.instance) {
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `setItemEnabled(${index}): 该序号没有菜单项（或越界）`,
              { engine: "jsapi-v4" },
            );
          }
          const method = enabled ? "enable" : "disable";
          sdkCall(`MenuItem.${method}`, () => callRequired(entry.instance!, method));
          // ⚠️ 刻意**不**改 `entry.model.disabled`：见接口注释「不回写本库条目表的 disabled」。
        },
        getDom: () => sdkCall("ContextMenu.getDom", () => callRequired(raw, "getDom")) as HTMLElement,
        show: () => sdkCall("ContextMenu.show", () => callRequired(raw, "show")),
        hide: () => sdkCall("ContextMenu.hide", () => callRequired(raw, "hide")),
      };
    },

    /**
     * 一条 `MenuItem` 的命令面（#165 Class 3 / TASK 2e）。
     *
     * `MenuItem` **没有句柄品牌**（它不是 `Overlay`，SDK 也没有把它 adopt 进来），因此
     * 这里收的是**本库记下的那条**（`addContextMenuItem` 建的 `MenuItem` 实例），
     * 而不是 `OverlayHandle`。`getItem` 返回的 `MenuItemView` 里也**不**含这个引用——
     * 要逐条改就经 `<ContextMenu>` 的命令面（`setItemText` / `setItemEnabled`）。
     */
    menuItemCommands(item) {
      const raw = item.raw as object;
      return {
        setText: (text: string) => {
          if (typeof text !== "string") {
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `MenuItem.setText 的入参必须是字符串，实际是 ${typeof text}`,
              { engine: "jsapi-v4" },
            );
          }
          sdkCall("MenuItem.setText", () => callRequired(raw, "setText", text));
          const owner = contextMenuItemOwners.get(raw);
          if (owner) {
            const entry = owner.entries.find((candidate) => candidate.instance === raw);
            if (entry) entry.model = { ...entry.model, text };
          }
        },
        enable: () => {
          sdkCall("MenuItem.enable", () => callRequired(raw, "enable"));
        },
        disable: () => {
          sdkCall("MenuItem.disable", () => callRequired(raw, "disable"));
        },
      };
    },

    add(target, overlay) {
      const kind = kindOfHandle(overlay);
      assertNotInfoWindow(kind, "add");
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(overlay);
      sdkCall("map.addOverlay", () => callRequired(rawMap, "addOverlay", raw));
    },

    remove(target, overlay) {
      const kind = kindOfHandle(overlay);
      assertNotInfoWindow(kind, "remove");
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(overlay);
      sdkCall("map.removeOverlay", () => callRequired(rawMap, "removeOverlay", raw));
    },

    show(overlay) {
      const raw = registry.resolve<object>(overlay);
      const fn = readNamespaceMember(raw, "show");
      if (typeof fn !== "function") return false;
      sdkCall("overlay.show", () => (fn as () => unknown).apply(raw));
      return true;
    },

    hide(overlay) {
      const raw = registry.resolve<object>(overlay);
      const fn = readNamespaceMember(raw, "hide");
      if (typeof fn !== "function") return false;
      sdkCall("overlay.hide", () => (fn as () => unknown).apply(raw));
      return true;
    },

    attachContextMenu(target, menu) {
      const rawTarget = requireContextMenuTarget(target, "attachContextMenu");
      const raw = registry.resolve<object>(menu);
      // `map` 与 `marker` 走**同一份**结构性调用面：Map 上的成员有官方声明，Marker 上的没有，
      // 但两者的调用形状一致，分成两条实现只会让「哪一条才是真的」变得难读。
      callContextMenuTargetMethod(rawTarget, "addContextMenu", raw, "attachContextMenu", target.kind);
    },

    detachContextMenu(target, menu) {
      const rawTarget = requireContextMenuTarget(target, "detachContextMenu");
      const raw = registry.resolve<object>(menu);
      callContextMenuTargetMethod(
        rawTarget,
        "removeContextMenu",
        raw,
        "detachContextMenu",
        target.kind,
      );
    },

    setPosition(overlay, position) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      applyFieldUpdate(raw, kind, POSITION_KEY[kind] ?? "position", position);
    },

    setPath(overlay, path) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      applyFieldUpdate(raw, kind, "path", path);
    },

    /* ------------------------------------------------ 读回 / 命令面（#165 Class 3） */

    infoWindowCommands(overlay) {
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      return {
        getTitle: () => readScalar<string>(raw, "getTitle"),
        getContent: () => readScalar<string | HTMLElement>(raw, "getContent"),
        isOpen: () => readScalar<boolean>(raw, "isOpen"),
        getOffset: () => fromRawSizeToPixel(sdkCall("getOffset", () => callRequired(raw, "getOffset"))),
        maximize: () => sdkCall("maximize", () => callRequired(raw, "maximize")),
        restore: () => sdkCall("restore", () => callRequired(raw, "restore")),
      };
    },

    pathReadBacks(overlay) {
      kindOfHandle(overlay);
      return createPathReadBackApi(registry.resolve<Record<string, unknown>>(overlay));
    },

    circleReadBacks(overlay) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      if (kind !== "circle") {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `circleReadBacks 只对 circle 生效，收到的是 ${kind}（圆的 getCenter/getRadius 在别的类上不存在）`,
          { engine: "jsapi-v4" },
        );
      }
      return {
        ...createPathReadBackApi(raw),
        getCenter: () =>
          geometry.fromRawPoint(sdkCall("getCenter", () => callRequired(raw, "getCenter"))),
        getRadius: () => readScalar<number>(raw, "getRadius"),
        getFillColor: () => readScalar<string>(raw, "getFillColor"),
        getFillOpacity: () => readScalar<number>(raw, "getFillOpacity"),
      };
    },

    pathFillReadBacks(overlay) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      // `Polyline` 没有填充：官方 `Polyline.d.ts` 只声明描边 getter，**没有** getFillColor/getFillOpacity。
      // 把它也算进来会让「读回一个不存在的能力」变成 `BMAP_SDK_CALL_FAILED`（一个运行时炸点），
      // 因此在 kind 层就拒绝——`unsupported` 是编译期就能看出的事实。
      if (kind === "polyline") {
        throw new BMapError(
          "BMAP_CAPABILITY_UNSUPPORTED",
          "Polyline 没有填充：官方 4.0.5 的 Polyline 只声明描边 getter，没有 getFillColor/getFillOpacity",
          { engine: "jsapi-v4" },
        );
      }
      return createPathFillReadBackApi(raw);
    },

    markerCommands(overlay) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      if (kind !== "marker") {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `markerCommands 只对 marker 生效，收到的是 ${kind}`,
          { engine: "jsapi-v4" },
        );
      }
      return {
        getRank: () => readScalar<number>(raw, "getRank"),
        setRank: (rank) => {
          sdkCall("setRank", () => callRequired(raw, "setRank", rank));
        },
        setRotationOrigin: (angle) => {
          sdkCall("setRotationOrigin", () => callRequired(raw, "setRotationOrigin", angle));
        },
        getTitle: () => readScalar<string>(raw, "getTitle"),
        getOffset: () => fromRawSizeToPixel(sdkCall("getOffset", () => callRequired(raw, "getOffset"))),
        getRotation: () => readScalar<number>(raw, "getRotation"),
        getPosition: () =>
          geometry.fromRawPoint(sdkCall("getPosition", () => callRequired(raw, "getPosition"))),
        closePlaceDetail: () => {
          sdkCall("closePlaceDetail", () => callRequired(raw, "closePlaceDetail"));
        },
      };
    },

    setPositionAt(overlay, index, point, options) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      if (!Number.isInteger(index) || index < 0) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `setPositionAt 的 index 必须是非负整数，实际是 ${String(index)}`,
          { engine: "jsapi-v4" },
        );
      }
      if (
        !point ||
        !Number.isFinite(point.lng) ||
        !Number.isFinite(point.lat)
      ) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `setPositionAt 的 point 必须是有限坐标，实际是 ${JSON.stringify(point)}`,
          { engine: "jsapi-v4" },
        );
      }
      // `deep` 只属于 Polygon（多环路径的层数）：官方 `Polygon.d.ts` 是
      // `setPositionAt(index, point, deep?)`，而 `Polyline.d.ts` 是 `setPositionAt(index, point)`。
      // 把它传给 polyline 会被官方默默吞掉 ⇒ 在这里显式拒绝（静默丢参数比报错难查得多）。
      const deep = options?.deep;
      if (deep !== undefined && kind !== "polygon") {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `setPositionAt 的 deep 参数只对 polygon 有效（多环路径的层数）：官方 ${kind}` +
            ".setPositionAt(index, point) 只有两个参数，第三个会被静默忽略。",
          { engine: "jsapi-v4" },
        );
      }
      const rawPoint = geometry.toRawPoint(point);
      const args: unknown[] = deep === undefined ? [index, rawPoint] : [index, rawPoint, deep];
      sdkCall("setPositionAt", () => callRequired(raw, "setPositionAt", ...args));
    },

    setOptions(overlay, options) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      const descriptor = overlayDescriptor(kind);
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        const spec = specOf(descriptor, key);
        if (!spec) {
          // 逃生口：未知键按 `set<Key>` 结构性调用（与 webgl-v1 的默认分支同形）
          const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          const fn = readNamespaceMember(raw, setter);
          if (typeof fn === "function") {
            sdkCall(setter, () => (fn as (v: unknown) => unknown).apply(raw, [value]));
          } else {
            warnOnce(
              `${kind}:unknown:${key}`,
              `OverlayDriver.setOptions: ${kind} 没有 "${key}" 的字段级 setter（也不在覆盖物属性描述符里），本次更新被忽略`,
            );
          }
          continue;
        }
        if (spec.policy === "mutable") {
          // 分类是**声明**层（描述符按官方类型给出）；实例上缺成员属于声明与运行时的偏差，
          // 必须告警一次而不是静默 no-op（否则组件会以为「更新成功了」）。
          const setter = mutableSetter(spec);
          const toggle = mutableToggle(spec);
          const method = setter ?? (value ? toggle![0] : toggle![1]);
          if (typeof readNamespaceMember(raw, method) !== "function") {
            warnOnce(
              `${kind}:missing:${method}`,
              `OverlayDriver.setOptions: ${kind}.${key} 声明为 mutable（${method}），但当前实例没有该方法，本次更新被忽略`,
            );
            continue;
          }
          const args = setter ? [normalize(spec, value), ...(spec.valueArgs ?? [])] : [];
          sdkCall(method, () => callOptional(raw, method, ...args));
          continue;
        }
        warnOnce(
          `${kind}:${spec.policy}:${key}`,
          spec.policy === "recreate"
            ? `OverlayDriver.setOptions: ${kind}.${key} 只有构造期生效（${spec.reason}）；` +
                "本次更新被忽略，需要生效请重建实例（可用 OverlayDriver.updatePolicy() 预判）"
            : `OverlayDriver.setOptions: ${kind}.${key} 在当前引擎不支持（${spec.reason}）；本次更新被忽略`,
        );
      }
    },

    updatePolicy(overlay, key) {
      // 纯元数据查询：不校验所有权（跨 Client 的句柄会在真正的操作路径上被拒绝）
      const kind = overlayKindOf(overlay);
      if (!kind) return undefined;
      return overlayPropertyPolicy(kind, key);
    },

    openInfoWindow(map: MapHandle, overlay, position: Point) {
      // **位置是必需参数**（R25-C 复审 P1）：官方 4.0 的 `Map#openInfoWindow(infoWnd, point)`
      // 要求 point，`InfoWindow` 实例也没有公开的 `openInfoWindow()`。此前这里保留了一条
      // 「未给位置时结构性尝试实例成员」的回退，那是 **undocumented fallback**：真实运行时没有该
      // 成员就抛 `BMAP_INVALID_ARGUMENT`，有就「碰巧打开」，组件所谓的最小成功路径只覆盖了传位置
      // 的情形。现在取消回退，缺失即显式失败（组件侧在调这里之前就会把错误交到 `resource:error`）。
      // 「气泡挂到 Marker 的目标级打开」不需要位置，但它是另一条路径（M5 #31/#32）。
      if (!position || !Number.isFinite(position.lng) || !Number.isFinite(position.lat)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "OverlayDriver.openInfoWindow: 必须给出 position——官方 4.0 的 map.openInfoWindow(infoWnd, point) " +
            "里 point 是必需参数，且 InfoWindow 实例没有公开的 openInfoWindow()（气泡挂到 Marker 的目标级" +
            "打开属 M5 #31/#32）",
          { engine: "jsapi-v4" },
        );
      }
      const rawMap = registry.resolve<object>(map);
      const raw = registry.resolve<object>(overlay);
      sdkCall("map.openInfoWindow", () =>
        callRequired(rawMap, "openInfoWindow", raw, geometry.toRawPoint(position)),
      );
      infoWindowOwners.set(raw, rawMap);
      // 记下「这张地图最后被请求打开的是谁」——closeInfoWindow 据此判断该不该动地图
      lastRequestedByMap.set(rawMap, raw);
    },

    closeInfoWindow(overlay) {
      const raw = registry.resolve<object>(overlay);
      const owner = infoWindowOwners.get(raw);
      if (owner) {
        // 判据顺序：先读 `map.getInfoWindow()`（它就是我们 ⇒ 照关，即使最后请求者是别人），
        // 它是别人 ⇒ 不碰；读不到（异步窗口）才退回 `lastRequestedByMap`。
        const current = callOptional(owner, "getInfoWindow");
        if (current) {
          if (current !== raw) return;
        } else if (lastRequestedByMap.get(owner) !== raw) {
          return;
        }
        sdkCall("map.closeInfoWindow", () => callRequired(owner, "closeInfoWindow"));
        return;
      }
      // 从未由本 Driver 打开过：尝试实例级 close（真实 4.0 运行时提供 `InfoWindow#close`），
      // 没有则视为已关闭（幂等）
      const fn = readNamespaceMember(raw, "close");
      if (typeof fn === "function") {
        sdkCall("InfoWindow.close", () => (fn as () => unknown).apply(raw));
      }
    },

    redrawInfoWindow(overlay) {
      const raw = registry.resolve<object>(overlay);
      sdkCall("InfoWindow.redraw", () => callOptional(raw, "redraw"));
    },

    /** 读当前气泡是不是这一个（`Map#getInfoWindow()` + handle 身份比对；打开是异步生效的）。 */
    isCurrentInfoWindow(map, overlay) {
      const rawMap = registry.resolve<object>(map);
      const raw = registry.resolve<object>(overlay);
      // `callRequired` + `sdkCall`：读回失败要**显式**报错（包成 BMapError），不静默吞成 false ——
      // 否则「读不到」会被静默解释成「不是我」，收敛会朝错误方向走。
      const current = sdkCall("map.getInfoWindow", () => callRequired(rawMap, "getInfoWindow"));
      return (current as unknown) === (raw as unknown);
    },

    buildIcon,
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 覆盖物构造器名必须与官方 `BMap` 命名空间一致。
 *
 * `marker3d` / `map-mask` 被**显式排除**：它们的构造器在 `@baidumap/jsapi-v4-types@4.0.5`
 * 里不存在（仓库内官方参考 `.agents/skills/bmap-jsapi-v4/references/` 也没有对应章节——它们只在
 * `runtime-extended-apis.md` 的「其他扩展名称」名单里被列举，没有独立接口说明；这与**官方 React
 * 参考实现** `huiyan-fe/react-bmap` 恰好相反，它为两者都提供了组件与 driver 工厂），属于运行时扩展，
 * 因此不能进「官方声明一致性」断言——
 * 它们的存在性只能由 `requireRuntimeCtor` 在运行时按结构判断。上游一旦补齐声明，这条断言会失败，
 * 提醒把结构性查找收回 `namespaceCtor`。
 */
type OfficialOverlayKind = Exclude<OverlayKind, "marker3d" | "map-mask">;
type OfficialOverlayCtor = (typeof OVERLAY_DESCRIPTORS)[OfficialOverlayKind]["ctor"];

// 断言结果不参与运行时；存在性由类型检查保证（`noUnusedLocals` 未开启）。
type _AssertOfficialOverlayCtors = ExpectTrue<
  OfficialOverlayCtor extends keyof typeof BMap ? true : false
>;
type _AssertIconAndMenuItem = ExpectTrue<
  ("Icon" | "MenuItem") extends keyof typeof BMap ? true : false
>;
