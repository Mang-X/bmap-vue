/**
 * v4 ControlDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 把 JSAPI 4.0 的控件收敛成项目领域映射（`ControlDriver`）；公共 API 不新增成员，
 * 只把 `ControlHandle` 的品牌补成 `control:<kind>`（与 Overlay / Layer 句柄同形，
 * `setOptions` 因此能按种类给出正确的更新口径）。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.5` + 官方 Skill
 * `references/controls-and-context-menu.md`）：
 * - 控件统一经 `map.addControl/removeControl` 管理；**一个实例只添加一次**，因此 Driver
 *   自己记账重复 `add`（SDK 不保证去重，官方「常见错误」里就有「同一控件实例重复添加」）；
 * - `Control` 基类提供 `setAnchor/setOffset/show/hide/isVisible`；自定义控件实现
 *   `initialize(map)` 并给出 `defaultAnchor` / `defaultOffset`；
 * - **停靠只支持四角**：`BMAP_ANCHOR_TOP_CENTER` 等常量虽然存在，传给控件会被 SDK
 *   静默回落到 `defaultAnchor`；Driver 认识这些常量但会告警一次（不静默）；
 * - `PanoramaControl` 由全景模块提供（不是普通 `Control` 子类），因此基类成员一律
 *   结构性调用：缺失时告警一次，而不是让组件以为「调用成功了」；
 * - `location`（领域名）→ 4.0 的 `GeolocationControl`；`GeolocationControl#setOptions`
 *   是该控件唯一的运行期配置入口，所以它的 option 走「options 袋」整体写回；
 * - `CopyrightControl#addCopyright` 接收**对象字面量**（官方 `@example` 即如此；类型包把
 *   参数写成结构等价的 `Copyright`，两处不冲突）。
 * - 控件 `type`（`navigation` / `map-type`）在项目侧是**本族常量名**（`string`），官方收的是
 *   **数值**枚举（`NavigationControlType` = `0|1|2|3`，`MapTypeControlType` = `0|1|2`）。
 *   `NAVIGATION_TYPE_VALUES` / `MAPTYPE_TYPE_VALUES` 负责换算（**按族分表**，跨族名字被拒），
 *   与 `anchor` 的 `ANCHOR_VALUES` 同一套做法（issue #175）。
 * - `create("custom")` 显式失败并指向 `createCustomControl()`：自定义控件要的是 DOM 工厂，
 *   走通用构造器只会拿到一个没有 `initialize` 的空控件。
 *
 * M7-CONTROL-PANORAMA（issue #41）在本文新增 `planOptions()`：把「构造之后改某个 option 会
 * 怎样」逐键报给调用方，供组件层的统一 Control adapter 在**就地更新**与**重建控件**之间选择。
 * 它与 `setOptions` 共用同一处分类（`classifyOption`）——分类表、options 袋与 `set<Key>`
 * 逃生口只有一份，不存在第二张会漂移的表。
 */
import { BMapError } from "../../core/errors/BMapError";
import type {
  CityListCommandApi,
  ControlDriver,
  ControlKind,
  ControlOptionStatus,
  ControlOptions,
  CopyrightEntry,
  LocationAddressComponents,
  LocationCommandApi,
} from "../types/controls";
import type { Pixel } from "../types/geometry";
import { HANDLE_BRAND, type ControlHandle } from "../types/handles";
import {
  assertJsapiV4Namespace,
  callRequired,
  createMapTargetResolver,
  createMountTracker,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 控件种类 → 4.0 构造器名（`custom` 走 `createCustomControl`，不在表内）。
 *
 * 写成字面量 + `satisfies`（而不是 `Record<…, string>`）：这样文件末尾的
 * 「构造器名 ∈ 官方 `BMap` 命名空间」断言才成立——用 `string` 写会退化成
 * `string extends keyof typeof BMap`，断言变成恒 false 的假检查。
 */
const CONTROL_CTORS = {
  zoom: "ZoomControl",
  scale: "ScaleControl",
  navigation: "NavigationControl",
  "navigation-3d": "NavigationControl3D",
  "city-list": "CityListControl",
  // 领域名 `location` 在 4.0 上统一写 `GeolocationControl`（运行时仍保留同实现的
  // `LocationControl` 名称，官方 Skill 明确「新代码统一写后者」）。
  location: "GeolocationControl",
  "map-type": "MapTypeControl",
  overview: "OverviewMapControl",
  panorama: "PanoramaControl",
  copyright: "CopyrightControl",
} as const satisfies Record<Exclude<ControlKind, "custom">, string>;

/**
 * 锚点常量表：官方 `const/Anchor.d.ts` 的**声明值**。
 *
 * 刻意不从 `window.BMAP_ANCHOR_*` 读：Driver 边界只认 `rawSdk` 传入的命名空间，
 * 不读未经 Provider 校验的全局值（同-jsapi-v4-map-facet §9）。
 *
 * ⚠️ **这张表没有类型层护栏**（与本文件末尾的 `*_TYPE_VALUES` 断言不同，那两组有）。
 * 早先这里写着「见文件末尾的锚点断言」——**本文件从来没有过那个断言**：
 * `OfficialCornerAnchor` / `OfficialCenterAnchor` 只被本表的注解类型消费。
 * 改锚点值**不会**产生任何编译期信号，它只会在真实 4.0 上把控件挂到错误的角。
 * 本表的实际护栏是 `driver/jsapi-v4/controls.test.ts` 里的换算用例
 * （`anchor` 的名字→数字）——**不是**类型断言。要补类型护栏请照
 * `AssertNavigationTypeValues` + `AssertNavigationTypeExhaustive` 那对「逐名 + 值域」
 * 的成对写法补，两条缺一不可（见文件末尾的说明）。
 *
 * ⚠️ **覆盖物也复用这一张**（issue #165 第三批：`Marker.label` 之外的 `Marker.anchor` 与
 * `Label.anchor`，见 `overlays.ts` 的 `anchorFor`）。两张表一旦漂移，同一个锚点名在
 * `<ZoomControl>` 与 `<Label>` 上会落到不同的角——那是肉眼几乎发现不了的 bug。
 * live 读数（2026-09-27）也确认九个数在 `window` 与 `BMap` 命名空间上同值。
 */
export const ANCHOR_VALUES: Readonly<Record<string, OfficialCornerAnchor | OfficialCenterAnchor>> = {
  BMAP_ANCHOR_TOP_LEFT: 0,
  BMAP_ANCHOR_TOP_RIGHT: 1,
  BMAP_ANCHOR_BOTTOM_LEFT: 2,
  BMAP_ANCHOR_BOTTOM_RIGHT: 3,
  BMAP_ANCHOR_TOP_CENTER: 4,
  BMAP_ANCHOR_MIDDLE_LEFT: 5,
  BMAP_ANCHOR_CENTER: 6,
  BMAP_ANCHOR_MIDDLE_RIGHT: 7,
  BMAP_ANCHOR_BOTTOM_CENTER: 8,
};

/**
 * 控件 `type` 常量表：官方 `const/NavigationControlType.d.ts`（`0|1|2|3`）与
 * `const/MapTypeControlType.d.ts`（`0|1|2`）的**声明值**，**按族分表**。
 *
 * 公共 prop 收**字符串**（`NavigationControlProps.type` / `MapTypeControlProps.type` 都是
 * `string`），但上游 `NavigationControlOptions.type?: NavigationControlType` 与
 * `MapTypeControlOptions.type?: MapTypeControlType` 都是**数值**联合。此前 Driver 走
 * `projectOptions` 的原样透传分支，把 `"BMAP_NAVIGATION_CONTROL_LARGE"` 塞进只认数字的
 * 构造器——类型在**主动误导**使用者（issue #175 / `doc-audit-findings.md` 第 10 条）。
 *
 * 处置是**补这两张表**而不是把 prop 收窄成字面量联合：文档与示例一直用常量名，收窄会破坏
 * 现有调用方，而公共 API 形状（仍是 `string`）保持不变——这与 `anchor` 是同一套做法。
 *
 * **为什么分表而不是一张平表**：官方是**两套独立的枚举**，控件族与常量前缀一一对应。
 * 合成一张 `Record<string, …>` 会让两族共用一个键空间，于是
 * `<NavigationControl type="BMAP_MAPTYPE_CONTROL_MAP">` 会被静默接受成 `2`——
 * 官方会照着这个数渲染出**地图类型控件的样式**，而使用者的本意是导航控件。
 * 数值上 `BMAP_MAPTYPE_CONTROL_MAP`(2) 与 `BMAP_NAVIGATION_CONTROL_PAN`(2) 还撞值，
 * 连「看起来不对」都看不出来。按族分表让 `resolveType` 只查本族，跨族名字落到
 * 「不认识」分支——告警 + 忽略（与 `resolveAnchor` 同一口径）。
 *
 * 键类型用官方常量名的字面量联合而非 `string`：跨族名字连键位都不存在，`satisfies` 又要求
 * 四项齐全（删一行会红）。表里写**字面量数字**（与 `ANCHOR_VALUES` 同一手法，不读未经
 * Provider 校验的全局常量）。
 *
 * 取值有**两条成对**的类型层护栏（见文件末尾），实测四类变异全部转红：
 * 删表项 / 值改成越界数 / 本表某个值被调换（哪怕仍在合法范围内）/ 上游新增枚举成员。
 * 单留任何一条都会漏——**成对**是必要的，不是冗余（注释里写明了各自的分工）。
 */
export const NAVIGATION_TYPE_VALUES = {
  // `const/NavigationControlType.d.ts`：LARGE=0 / SMALL=1 / PAN=2 / ZOOM=3
  BMAP_NAVIGATION_CONTROL_LARGE: 0,
  BMAP_NAVIGATION_CONTROL_SMALL: 1,
  BMAP_NAVIGATION_CONTROL_PAN: 2,
  BMAP_NAVIGATION_CONTROL_ZOOM: 3,
} as const satisfies Readonly<Record<OfficialNavigationTypeName, NavigationControlType>>;

export const MAPTYPE_TYPE_VALUES = {
  // `const/MapTypeControlType.d.ts`：HORIZONTAL=0 / DROPDOWN=1 / MAP=2
  BMAP_MAPTYPE_CONTROL_HORIZONTAL: 0,
  BMAP_MAPTYPE_CONTROL_DROPDOWN: 1,
  BMAP_MAPTYPE_CONTROL_MAP: 2,
} as const satisfies Readonly<Record<OfficialMapTypeControlName, MapTypeControlType>>;

/** 4.0 控件真正接受的落点：四角。其它常量会被 SDK 静默回落。 */
const CORNER_ANCHORS: ReadonlySet<string> = new Set([
  "BMAP_ANCHOR_TOP_LEFT",
  "BMAP_ANCHOR_TOP_RIGHT",
  "BMAP_ANCHOR_BOTTOM_LEFT",
  "BMAP_ANCHOR_BOTTOM_RIGHT",
]);

/**
 * 控件 option 的更新口径（「动态 option 与必须重建的 option」的分类，issue #22 实施步骤 3）。
 *
 * - `mutable` + `setter`：值型 setter（`setUnit` / `setType` / `setSize`）；
 * - `mutable` + `choice`：值型二选一（`[值为真时的方法, 值为假时的方法]`），
 *   用于只有成对动作、没有幂等 setter 的选项（`city-list.expand` → `open` / `close`）；
 * - `recreate`：只有构造期生效（4.0 没有对应 setter），`setOptions` 告警一次并**不动它**，
 *   把「重建」的决定交给调用方。
 *
 * `value` 是**取值形状**，两个 policy 都有：`"size"` 是 Pixel → `Size`，
 * `"navigation-type"` / `"map-type-style"` 是**各族的**常量名（string）→ 数值枚举
 * （`resolveType`）。两种 `type` 标记**必须分开**而不是合用一个 `"control-type"`：
 * 合一时两张表会共用一个键空间，跨族名字被静默接受（见 `NAVIGATION_TYPE_VALUES` 的注释）。
 * `value` 只作用在**构造期**（`projectOptions`）与 `mutable` 的 setter 写入——`recreate`
 * 上的 `value` 表示「重建时这次构造要用哪个换算」，不表示它可以就地写（issue #175）。
 *
 * `anchor` / `offset` 是全部控件的公共可更新项（基类 `setAnchor` / `setOffset`），
 * 因此在 `setOptions` 里单独处理，不重复出现在本表。
 *
 * 表用 `Record<ControlKind, …>` 而非 `Partial`：新增一个控件种类却忘记写分类会直接编译失败。
 */
type ControlOptionValue = "size" | "navigation-type" | "map-type-style";
type ControlOptionSpec =
  | { policy: "mutable"; setter: string; value?: ControlOptionValue }
  | { policy: "mutable"; choice: readonly [string, string] }
  | { policy: "recreate"; reason: string; value?: ControlOptionValue };

const CONTROL_OPTION_SPECS: Readonly<
  Record<ControlKind, Readonly<Record<string, ControlOptionSpec>>>
> = {
  zoom: {},
  scale: {
    unit: { policy: "mutable", setter: "setUnit" },
  },
  navigation: {
    // `value: "navigation-type"`：`type` 在项目侧是常量名（`string`），官方
    // `setType(type: NavigationControlType)` 要**数字**（issue #175）。没有这个标记时
    // `normalizeValue` 会把它原样透传，等于把 `"BMAP_NAVIGATION_CONTROL_LARGE"` 塞进
    // 数值枚举的位置。
    type: { policy: "mutable", setter: "setType", value: "navigation-type" },
    // 官方 4.0.5 的 `NavigationControl` 只声明了 getType/setType：其余构造选项没有运行期入口
    showZoomInfo: { policy: "recreate", reason: "4.0 的 NavigationControl 没有级别提示的 setter" },
    enableGeolocation: {
      policy: "recreate",
      reason: "4.0 的 NavigationControl 没有定位集成的 setter",
    },
  },
  "navigation-3d": {},
  "city-list": {
    expand: { policy: "mutable", choice: ["open", "close"] },
    trigger: {
      policy: "recreate",
      reason: "4.0 的 CityListControl 只在构造期读取自定义触发元素（没有 setTrigger）",
    },
    canCheckSize: { policy: "recreate", reason: "容器尺寸检查只在构造期读取" },
    onChangeBefore: { policy: "recreate", reason: "回调只在构造期注册" },
    onChangeAfter: { policy: "recreate", reason: "回调只在构造期注册" },
    onChangeSuccess: { policy: "recreate", reason: "回调只在构造期注册" },
    onOpen: { policy: "recreate", reason: "回调只在构造期注册" },
    onClose: { policy: "recreate", reason: "回调只在构造期注册" },
  },
  location: {},
  "map-type": {
    // `showStreetLayer(isShow)` 是官方 4.0.5 上 `MapTypeControl` **唯一**的字段级 setter
    // （路网层显隐），成员名不是 `set<Key>` 形状——所以它必须进分类表，否则会落到下面
    // 的「未知键 + `set<Key>` 结构逃生口」里被判成 unsupported（值被静默丢弃）。
    showStreetLayer: { policy: "mutable", setter: "showStreetLayer" },
    type: {
      policy: "recreate",
      reason: "4.0 的 MapTypeControl 只公开 showStreetLayer(isShow)，控件样式没有 setter",
      // 同样是「项目侧常量名 → 官方数值」：`recreate` 说的是**不能就地改**，
      // 不是「不能构造」——`projectOptions` 仍会经过 `normalizeValue`（issue #175）。
      // 与 `navigation` 分成两个标记：两族是**独立**的枚举，跨族名字必须落到「不认识」。
      value: "map-type-style",
    },
    mapTypes: { policy: "recreate", reason: "地图类型列表只在构造期读取" },
  },
  overview: {
    size: { policy: "mutable", setter: "setSize", value: "size" },
    zoomInterval: { policy: "recreate", reason: "4.0 的 OverviewMapControl 没有缩放级别差的 setter" },
    padding: { policy: "recreate", reason: "4.0 的 OverviewMapControl 没有空隙宽度的 setter" },
    isOpen: {
      policy: "recreate",
      reason:
        "4.0 只提供 changeView() 的**切换**语义，没有幂等的 setOpen；" +
        "要确定性设置请在构造期给 isOpen（isOpen() 可读回当前状态）",
    },
  },
  panorama: {},
  copyright: {},
  custom: {},
};

/**
 * 「options 袋」控件：4.0 提供整体 `setOptions(options)` 的实例级配置入口。
 *
 * `GeolocationControl` 的 `showAddressBar` / `enableAutoLocation` / `watchPosition` /
 * `locationIcon` / `onLocationStart` 等没有一对一 setter，官方只给了这个袋装入口；
 * 未在 `CONTROL_OPTION_SPECS` 里命中的键按一次调用整袋写回（而不是按键逐次结构调用）。
 */
const CONTROL_OPTIONS_BAG: Readonly<Partial<Record<ControlKind, string>>> = {
  location: "setOptions",
};

export interface CreateJsapiV4ControlDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  /** 领域 Pixel（`{x, y}`）→ 4.0 `Size`（`{width, height}`）的换算入口。 */
  geometry: { toRawSize(size: { width: number; height: number }): unknown };
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4ControlDriver(
  input: CreateJsapiV4ControlDriverInput,
): ControlDriver {
  const { rawSdk, geometry, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /** 已告警过的「分类 / 键 / 成员」组合：每个 Driver 一份，避免重复刷屏。 */
  const warnOnce = createWarnOnce();
  /**
   * 已挂到某张地图上的控件。
   *
   * SDK 不保证 `addControl` 去重（官方「常见错误」把「同一控件实例重复添加」列为误用），
   * 因此「重复 add 只挂一次」这条不变式由 Driver 自己记账保证。
   */
  const mounted = createMountTracker();
  /** 控件只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const requireMapTarget = createMapTargetResolver({
    facet: "ControlDriver",
    entry: "map.addControl / removeControl",
    resolve: (handle) => registry.resolve<object>(handle),
    warn: warnOnce,
  });

  /** 控件句柄种类：品牌即 `control:<kind>`（纯元数据，所有权校验留给 `registry.resolve`）。 */
  const kindOfControl = (control: ControlHandle): ControlKind | undefined => {
    const match = /^control:(.+)$/.exec(String(control[HANDLE_BRAND]));
    return match?.[1] as ControlKind | undefined;
  };

  /**
   * 官方常量名 → 4.0 数值。
   *
   * 三种情形分开处理，避免「静默回落」被当成成功：
   * - 四角：正常换算；
   * - 已知但非四角（`TOP_CENTER` 等）：换算并告警一次（SDK 会回落，可见即可诊断）；
   * - 完全不认识的名字：无法换算 → 告警一次并**不透传**（控件沿用自身默认落点）。
   */
  const resolveAnchor = (anchor: unknown): unknown => {
    if (typeof anchor !== "string") return anchor;
    const value = ANCHOR_VALUES[anchor];
    if (value === undefined) {
      warnOnce(
        `anchor:unknown:${anchor}`,
        `ControlDriver: 不认识的停靠位置 "${anchor}"；JSAPI 4.0 的控件停靠位置是官方常量（` +
          "BMAP_ANCHOR_TOP_LEFT / TOP_RIGHT / BOTTOM_LEFT / BOTTOM_RIGHT），本次取值已忽略，" +
          "控件沿用自身默认落点",
      );
      return undefined;
    }
    if (!CORNER_ANCHORS.has(anchor)) {
      warnOnce(
        `anchor:non-corner:${anchor}`,
        `ControlDriver: "${anchor}" 不是四角落点；JSAPI 4.0 的控件只接受四角，该值会被 SDK ` +
          "静默回落到控件默认落点（官方 Skill：常见错误之一）",
      );
    }
    return value;
  };

  /** 领域 offset / size（Pixel `{x, y}`）→ 4.0 `Size`（`{width, height}`）。 */
  const toRawSize = (pixel: unknown): unknown => {
    const value = pixel as Pixel;
    return geometry.toRawSize({ width: value.x, height: value.y });
  };

  /**
   * 控件 `type` 的项目侧取值（常量名，**字符串**）→ 4.0 取值（**数字**）。
   *
   * 官方 `NavigationControlOptions.type` / `MapTypeControlOptions.type` 收的是数值枚举，
   * 而公共 prop 收字符串（issue #175）。取不到时**告警一次并丢弃**——不原样透传：
   * 把一个官方不认的字符串塞进数值枚举的位置只会被 SDK 静默吃掉，而丢弃至少让控件
   * 落到**自身默认样式**并留下可诊断的控制台告警（与 `resolveAnchor` 同一口径）。
   *
   * **只查本族**（`values` 由调用方按 `value` 标记传入）：跨族名字落到「不认识」分支，
   * 因此 `<NavigationControl type="BMAP_MAPTYPE_CONTROL_MAP">` 会被告警并忽略，而不是
   * 静默渲染成地图类型控件的样式（两族还撞值：`MAP` 与 `PAN` 都是 `2`）。
   *
   * 非字符串（已经传了数字）原样放行：`ControlOptions` 的索引签名本就是「4.0 自身构造选项」
   * 的逃生口，不在这里替调用方做二次判断。
   */
  const resolveType = (values: Readonly<Record<string, number>>, accepted: string, type: unknown): unknown => {
    if (typeof type !== "string") return type;
    const value = values[type];
    if (value === undefined) {
      warnOnce(
        `type:unknown:${type}`,
        `ControlDriver: <${accepted}> 不认识的控件类型 "${type}"；JSAPI 4.0 的该控件只接受本族的官方常量名（` +
          `${accepted} 的取值范围，不接受另一控件族的同名空间），本次取值已忽略，控件沿用自身默认样式`,
      );
      return undefined;
    }
    return value;
  };

  /** `value` 标记 → 该族的名字→数值表。跨族不在此表内。 */
  const CONTROL_TYPE_TABLES = {
    "navigation-type": NAVIGATION_TYPE_VALUES,
    "map-type-style": MAPTYPE_TYPE_VALUES,
  } as const satisfies Readonly<
    Record<Exclude<ControlOptionValue, "size">, Readonly<Record<string, number>>>
  >;

  /**
   * 领域值 → 4.0 取值。
   *
   * - `value: "size"` 的 option（`overview.size`）与 `offset` 同形：项目侧是 Pixel，4.0 是 `Size`；
   * - `value: "navigation-type"` / `"map-type-style"` 的 option（`navigation.type` /
   *   `map-type.type`）：项目侧是**本族**常量名字符串，4.0 是数值枚举（`resolveType`）。
   *
   * 构造与更新两条路径共用这里，避免「同一次更新」在两条入口上语义不同。
   */
  const normalizeValue = (spec: ControlOptionSpec | undefined, value: unknown): unknown => {
    if (!spec || !("value" in spec) || !spec.value) return value;
    if (spec.value === "size") return toRawSize(value);
    return resolveType(CONTROL_TYPE_TABLES[spec.value], spec.value, value);
  };

  /**
   * 领域 options → 4.0 构造 options。
   *
   * `anchor` / `offset` / 描述符里声明了 `value: "size"` 的键换成 4.0 取值；其余键原样透传
   * （项目 option 接口的索引签名就是「4.0 自身构造选项」的逃生口，例如 `CityListControl` 的
   * `expand` / `canCheckSize`）。`recreate` 分类的键同样投影——「recreate」说的是**不能就地改**，
   * 不是「不能构造」。
   */
  const projectOptions = (
    kind: ControlKind | undefined,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const specs = kind ? CONTROL_OPTION_SPECS[kind] : undefined;
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      if (key === "anchor") {
        const anchor = resolveAnchor(value);
        if (anchor !== undefined) projected.anchor = anchor;
        continue;
      }
      if (key === "offset") {
        projected.offset = toRawSize(value);
        continue;
      }
      // 换算不出来的取值跳过（与 `anchor` 同一口径）：键不出现 ⇒ 构造期沿用 SDK 默认值，
      // 而不是把一个表外的名字原样塞进去。
      const normalized = normalizeValue(specs?.[key], value);
      if (normalized !== undefined) projected[key] = normalized;
    }
    return projected;
  };

  /**
   * 控件实例方法的**唯一**调用点。
   *
   * 4.0 的控件里 `PanoramaControl` 由全景模块提供、不保证 `Control` 基类成员，
   * 所以一律结构性调用：成员缺失时告警一次，而不是让调用方以为「更新/显隐成功了」。
   */
  const callControl = (
    raw: Record<string, unknown>,
    method: string,
    args: unknown[] = [],
  ): boolean => {
    const fn = readNamespaceMember(raw, method);
    if (typeof fn !== "function") {
      warnOnce(
        `member:${method}`,
        `ControlDriver: 当前控件实例没有 ${method}()（官方 4.0 的 PanoramaControl 由全景模块提供、` +
          "不保证 `Control` 基类成员；个别运行时版本的控件也可能缺少某些成员），本次调用被忽略",
      );
      return false;
    }
    sdkCall(method, () => (fn as (...a: unknown[]) => unknown).apply(raw, args));
    return true;
  };

  /** 控件只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const adopt = (kind: ControlKind, raw: unknown): ControlHandle =>
    registry.adopt(`control:${kind}`, raw);

  const ctorFor = (kind: Exclude<ControlKind, "custom">): JsapiV4Ctor => {
    const name = CONTROL_CTORS[kind];
    if (!name) {
      throw new BMapError("BMAP_INVALID_ARGUMENT", `未知控件种类: ${String(kind)}`, {
        engine: "jsapi-v4",
      });
    }
    return namespaceCtor(namespace, name);
  };

  /**
   * 单个 option 键**在运行期**的落地方式——`setOptions` 与 `planOptions` 的**唯一**分类点。
   *
   * 两个入口共用它而不是各写一套：分类表（`CONTROL_OPTION_SPECS`）、options 袋
   * （`CONTROL_OPTIONS_BAG`）与 `set<Key>` 逃生口共同决定一个键的归属，任何一处漂移都会
   * 变成「组件以为能就地改、Driver 却告警忽略」这种最难查的分歧。
   *
   * - `apply` 存在：就地落地（`setOptions` 调它；`planOptions` 只看 `status`）。
   * - `apply` 缺席但 `status === "mutable"`：**options 袋**的键——袋装入口是「整袋一次写回」，
   *   逐键调用会漏掉袋内其它键的语义，所以聚合交给调用方（`setOptions` 的 `bag`）。
   */
  type OptionAction =
    | { readonly status: "mutable"; readonly apply?: (value: unknown) => void }
    | { readonly status: "recreate"; readonly reason: string }
    | { readonly status: "unsupported" };

  const classifyOption = (
    raw: Record<string, unknown>,
    kind: ControlKind | undefined,
    key: string,
  ): OptionAction => {
    // anchor / offset 是全部控件的公共可更新项（基类 setAnchor / setOffset），不重复进分类表……
    // ……**但版权控件例外**：它的实例按停靠位置**共享**（同一 anchor 的多个组件共用一个
    // `CopyrightControl`，各自往里加一条版权项）。对共享实例就地 `setAnchor()` 会让「实例」与
    // 「它服务的 anchor」脱钩，于是后续同 anchor 的组件找不到它、另建一个，同一个位置上出现两个
    // 控件（#95 评审 P1 的复现）。因此这里把 `copyright.anchor` 判成构造期项：变化时重建，
    // 由 `CopyrightControl` 的 create/mount/unmount 完成「离开旧共享组 → 加入目标共享组」的迁移。
    if (key === "anchor" && kind === "copyright") {
      return {
        status: "recreate",
        reason:
          "版权控件的实例按停靠位置共享（同 anchor 共用一个 CopyrightControl），" +
          "就地 setAnchor 会让实例与它服务的 anchor 脱钩、同一位置出现两个控件",
      };
    }
    if (key === "anchor") {
      return {
        status: "mutable",
        apply: (value) => {
          const anchor = resolveAnchor(value);
          if (anchor !== undefined) callControl(raw, "setAnchor", [anchor]);
        },
      };
    }
    if (key === "offset") {
      return { status: "mutable", apply: (value) => callControl(raw, "setOffset", [toRawSize(value)]) };
    }
    const spec = kind ? CONTROL_OPTION_SPECS[kind]?.[key] : undefined;
    if (spec) {
      if (spec.policy === "recreate") return { status: "recreate", reason: spec.reason };
      if ("choice" in spec) {
        return {
          status: "mutable",
          apply: (value) => callControl(raw, value ? spec.choice[0] : spec.choice[1]),
        };
      }
      return {
        status: "mutable",
        apply: (value) => {
          const normalized = normalizeValue(spec, value);
          // 换算不出来的取值（`resolveType` 撞上表外的名字）**不写**：告警已经由
          // `resolveType` 发过了，把 `undefined` 交给 `setType` 只会让 SDK 拿到一个
          // 既不是 0 也不是 1 的空值——那是「静默换成某个未知样式」。
          // 控件保持**上一个**已知样式，下一次给合法名字会正常写下去。
          if (normalized === undefined) return;
          callControl(raw, spec.setter, [normalized]);
        },
      };
    }
    // 「options 袋」控件：整袋写回，按键结构调用会漏掉袋装选项
    if (kind && CONTROL_OPTIONS_BAG[kind]) return { status: "mutable" };
    // 逃生口：未知键按 `set<Key>` 结构性调用（与 OverlayDriver.setOptions 同形）
    const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    if (typeof readNamespaceMember(raw, setter) === "function") {
      return { status: "mutable", apply: (value) => callControl(raw, setter, [value]) };
    }
    /**
     * 到这里：既不在分类表里、没有 options 袋、实例上也没有 `set<Key>`。
     *
     * **这不等于「本引擎没有这个 option」**——4.0 的构造选项是**原样透传**的
     * （`projectOptions` 只归一化 anchor / offset / `value: "size"`，其余键照发），所以未命中
     * 分类表的键依然可能在**构造期**生效。按三态的定义，这属于 `recreate`（「只有构造期生效」），
     * 不是 `unsupported`（「连构造期也没有入口」）。把两者混为一谈会让调用方二选一地犯错：
     * 要么把能生效的键当成没入口而**丢掉更新**，要么对真正没入口的键做**无效重建**（#95 评审第 3 轮）。
     *
     * 两个例外——「构造期也到不了」的才叫 `unsupported`：
     * - `custom`：`createCustomControl({ anchor, offset, render })` 只接收这三样，别的键连构造期
     *   都进不去；
     * - 裸 `"control"` 句柄（`kindOfControl` 认不出种类的、手工登记的句柄）：**授权重建需要知道
     *   种类**，认不出就不猜。
     */
    if (kind === undefined || kind === "custom") return { status: "unsupported" };
    return {
      status: "recreate",
      reason:
        "未命中控件 option 分类表、实例上也没有对应的 set<Key>——只有构造期可能生效" +
        "（4.0 的构造选项原样透传）",
    };
  };

  return {
    create(kind: ControlKind, options: ControlOptions = {}): ControlHandle {
      if (kind === "custom") {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "ControlDriver.create: 自定义控件请用 createCustomControl({ anchor, offset, render })——" +
            "空控件没有 initialize()，直接构造不会挂上任何 DOM",
          { engine: "jsapi-v4" },
        );
      }
      const ctor = ctorFor(kind);
      const opts = projectOptions(kind, options);
      const raw = sdkCall(CONTROL_CTORS[kind], () => new ctor(opts));
      return adopt(kind, raw);
    },

    createCustomControl({ anchor, offset, render }) {
      const Control = namespaceCtor(namespace, "Control");
      const control = sdkCall("Control", () => new Control()) as Record<string, unknown>;
      const resolvedAnchor = anchor === undefined ? undefined : resolveAnchor(anchor);
      // `defaultAnchor` / `defaultOffset` 是官方自定义控件契约的一部分：`initialize()` 之前
      // 就要求存在，因此这里用赋值而不是 setter（4.0 的 Control 也提供 setAnchor/setOffset，
      // 但官方示例两种写法都在用；赋值不依赖实例方法，对「工厂函数型」控件也成立）。
      if (resolvedAnchor !== undefined) control.defaultAnchor = resolvedAnchor;
      if (offset !== undefined) control.defaultOffset = toRawSize(offset);
      control.initialize = (map: unknown) => {
        const container = (map as { getContainer?: () => HTMLElement }).getContainer?.();
        if (!container) {
          throw new BMapError(
            "BMAP_SDK_CALL_FAILED",
            "ControlDriver.createCustomControl: 地图实例没有 getContainer()，无法提供自定义控件的挂载容器",
            { engine: "jsapi-v4" },
          );
        }
        return render(container) ?? container;
      };
      return adopt("custom", control);
    },

    add(target, control) {
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(control);
      // 一个实例只添加一次（SDK 不保证去重，见 `mounted` 的注释）
      if (!mounted.claim(rawMap, raw)) return;
      try {
        sdkCall("map.addControl", () => callRequired(rawMap, "addControl", raw));
      } catch (error) {
        // 记账先于 SDK 调用（重入/重复调用都只挂一次），但**失败时必须回滚**：不释放记录的话，
        // 调用方修好条件后用同一个句柄重试会被记成「已挂过」而静默跳过
        // （`initialize()` 里的 DOM 工厂抛错就是这个形状）。
        // 若 SDK 其实已经部分挂上，`remove` 仍能到达 `removeControl`——remove 不读记账（见下）。
        mounted.release(rawMap, raw);
        throw error;
      }
    },

    remove(target, control) {
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<Record<string, unknown>>(control);
      // 定位控件的持续跟踪不归 `removeControl` 管（官方 Skill：控件自身的 `remove()` 不会清除
      // `watchPosition`，只有 `stopLocationTrace()` 会），因此先停跟踪再摘控件。
      // 无条件调用：它对自己没启动过的跟踪是 no-op，**不**依赖记账状态（记账只服务去重，
      // 不能反过来当清理的前置条件——复审 P2-2 的教训）。
      // 注：一次性 `getCurrentPosition` 没有公开取消入口，本方法**不**声称取消它。
      if (kindOfControl(control) === "location") callControl(raw, "stopLocationTrace");
      // remove 不做「是否挂过」的前置拒绝：SDK 的 removeControl 对未挂载控件是 no-op，
      // 而按记录拒绝会让「先移除再挂载」的调用方在记账漂移时永久挂不上。
      sdkCall("map.removeControl", () => callRequired(rawMap, "removeControl", raw));
      mounted.release(rawMap, raw);
    },

    show(control) {
      callControl(registry.resolve<Record<string, unknown>>(control), "show");
    },

    hide(control) {
      callControl(registry.resolve<Record<string, unknown>>(control), "hide");
    },

    setOptions(control, options) {
      // 真实 AK smoke 实测（ADR「真实 AK smoke 记录」）：**kind 专属 setter 要求控件已挂载**
      // ——`NavigationControl#setType()` 在 `addControl()` 之前调用会抛
      // `TypeError: Cannot read properties of undefined (reading 'show')`（内部滑块 DOM 属
      // `initialize()` 阶段）。因此调用顺序是 `create → add → setOptions`（kind 专属项），
      // 与覆盖物编辑能力「先挂载再开关」同源；Driver 不替调用方猜挂载状态，
      // 失败经 `sdkCall` 归一成 `BMAP_SDK_CALL_FAILED` 而不是静默吞掉。
      const raw = registry.resolve<Record<string, unknown>>(control);
      const kind = kindOfControl(control);
      const bagMethod = kind ? CONTROL_OPTIONS_BAG[kind] : undefined;
      const bag: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        const action = classifyOption(raw, kind, key);
        if (action.status === "recreate") {
          warnOnce(
            `recreate:${kind}:${key}`,
            `ControlDriver.setOptions: ${kind}.${key} 只有构造期生效（${action.reason}）；本次更新被忽略，` +
              "需要生效请重建控件",
          );
          continue;
        }
        if (action.status === "unsupported") {
          warnOnce(
            `unknown:${kind}:${key}`,
            `ControlDriver.setOptions: ${kind ?? "control"} 没有 "${key}" 的字段级 setter` +
              "（也不在控件 option 分类里），本次更新被忽略",
          );
          continue;
        }
        // 袋装键（`apply` 缺席）：聚到一次 `setOptions(options)` 写回，不逐键结构调用
        if (!action.apply) {
          bag[key] = value;
          continue;
        }
        action.apply(value);
      }

      if (bagMethod && Object.keys(bag).length > 0) callControl(raw, bagMethod, [bag]);
    },

    planOptions(control, keys) {
      const raw = registry.resolve<Record<string, unknown>>(control);
      const kind = kindOfControl(control);
      const plan: Record<string, ControlOptionStatus> = {};
      for (const key of keys) plan[key] = classifyOption(raw, kind, key).status;
      return plan;
    },

    addCopyright(control, copyright: CopyrightEntry) {
      const raw = registry.resolve<Record<string, unknown>>(control);
      // 官方 `CopyrightControl#addCopyright` 的 @example 传对象字面量（类型包把参数写成
      // 结构等价的 `Copyright`），因此这里构造同形对象而不是 `new Copyright(...)`：
      // 后者要求 bounds 位置参数，会把「无 bounds」的版权项变成需要臆造一个空 Bounds。
      const entry: Record<string, unknown> = { id: copyright.id, content: copyright.content };
      if (copyright.bounds !== undefined) entry.bounds = copyright.bounds;
      sdkCall("CopyrightControl.addCopyright", () =>
        callRequired(raw, "addCopyright", entry),
      );
    },

    removeCopyright(control, id: number) {
      const raw = registry.resolve<Record<string, unknown>>(control);
      sdkCall("CopyrightControl.removeCopyright", () => callRequired(raw, "removeCopyright", id));
    },

    /**
     * `removeCopyright` 在**实例**上是否已就绪（#165c 复核）。
     *
     * 为什么这条查询值得单列一个方法：`removeCopyright` 属于官方控件成员面里**后补**的那一批
     * ——loader 判就绪（`__bmapJSApiOnLoad_N` callback）时它还不存在，约 150ms 后才挂上原型
     * （live 读数：`scripts/probe-165c-surface.mts`；窗口 126–167ms）。而 `addCopyright` /
     * `getCopyright` / `getCopyrightCollection` 属于**先到**的那批，窗口内就可用。
     *
     * 因此「`removeCopyright` 抛 `BMAP_SDK_CALL_FAILED`」是**可预期**的常态窗口，不是引擎缺陷；
     * 组件层要在摘除**之前**问一次，才能决定「同步摘」还是「延后摘」。用 catch 兜底做不到：
     * 那既把「还没到」和「永远没有」混成同一个诊断，也让调用方失去重试的判据。
     *
     * 读法取**实例**而不是原型：补齐是**追溯**的（被补的是原型，已存在的实例自动获得成员），
     * 所以「这个实例现在能不能调」才是唯一有决策价值的问题。
     */
    canRemoveCopyright(control) {
      const raw = registry.resolve<Record<string, unknown>>(control);
      return typeof readNamespaceMember(raw, "removeCopyright") === "function";
    },

    listCopyrights(control): CopyrightEntry[] {
      const raw = registry.resolve<Record<string, unknown>>(control);
      const entries = callRequired(raw, "getCopyrightCollection") as
        | readonly { id: number; content?: string; bounds?: unknown }[]
        | undefined;
      // `bounds` 一并回读：`CopyrightControl` 的更新路径会带着旧 bounds 重新 addCopyright，
      // 丢掉它会让「内容变了但适用范围变回全局」（webgl-v1 的 listCopyrights 没有回读 bounds，
      // 差异登记在 ADR「已知限制」里）。
      return (entries ?? []).map((entry) => {
        const item: CopyrightEntry = { id: entry.id, content: entry.content ?? "" };
        if (entry.bounds !== undefined) item.bounds = entry.bounds;
        return item;
      });
    },

    /**
     * 定位控件的命令面（issue #168 item 1）。
     *
     * **kind 必须对上**：`registry.resolve` 只保证句柄有效，而「把 `toggle()` 打到
     * `GeolocationControl` 上」在运行时是一个静默的无操作（方法不存在 ⇒ `callControl`
     * 告警一次后返回 false）。组件层永远传自己 kind 的句柄，但 Driver 仍是最终把关的一层：
     * 显式失败比「告警一次然后什么都没发生」好定位得多。
     */
    locationCommands(control): LocationCommandApi {
      const raw = requireKind(control, "location", "locationCommands");
      return {
        location: () => {
          callControl(raw, "location");
        },
        // 官方声明是 `startLocation()`；`startLocationTrace()` 不在 d.ts 里，live 读数
        // `callable: false`。逐条依据见 `driver/types/controls.ts` 的 `LocationCommandApi`。
        startLocation: () => {
          callControl(raw, "startLocation");
        },
        stopLocationTrace: () => {
          callControl(raw, "stopLocationTrace");
        },
        getAddressComponent: () => toAddressComponents(callRequired(raw, "getAddressComponent")),
      };
    },

    cityListCommands(control): CityListCommandApi {
      const raw = requireKind(control, "city-list", "cityListCommands");
      return {
        toggle: () => {
          callControl(raw, "toggle");
        },
        getCityName: () => String(callRequired(raw, "getCityName") ?? ""),
      };
    },
  };

  /**
   * 命令面取到**另一种** kind 的句柄时显式失败。
   *
   * 判据用句柄品牌（`kindOfControl`）而不是让调用方保证——命令面是「用户拿着组件 ref 调」的那一层，
   * 传错 kind 的代价是「方法不存在 ⇒ 告警一次 ⇒ 静默无操作」，那正是 AGENTS.md 说的假支持。
   */
  function requireKind(
    control: ControlHandle,
    expected: ControlKind,
    command: string,
  ): Record<string, unknown> {
    const actual = kindOfControl(control);
    if (actual !== expected) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `ControlDriver.${command}: 句柄的种类是 ${String(actual)}，该命令面只服务 ${expected} 控件`,
        { engine: "jsapi-v4" },
      );
    }
    return registry.resolve<Record<string, unknown>>(control);
  }
}

/**
 * 官方 `AddressComponent` → 领域 `LocationAddressComponents`。
 *
 * 官方五个成员**全是可选的**，因此逐字段按类型收窄、取不到就**留在 undefined**——
 * **不补默认值**：`city ?? ""` 会把「上游没给」与「空」混成同一个串，而调用方正是靠这个区别
 * 判断「这一段地址上游到底有没有给」。
 *
 * 非字符串成员**不投影**（例如 `district` 可能是数字）：照抄进 `string` 字段是断言，不是投影。
 * 整体不是对象时给 `null`——官方声明就是 `AddressComponent | null`，编一个 `{}` 会让
 * 「还没定位到」被误判成「定位到了一个空地址」。
 */
function toAddressComponents(value: unknown): LocationAddressComponents | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const result: LocationAddressComponents = {};
  for (const key of ADDRESS_TEXT_KEYS) {
    if (typeof raw[key] === "string") result[key] = raw[key] as string;
  }
  return result;
}

/** 官方 `AddressComponent` 的五个字符串成员。 */
const ADDRESS_TEXT_KEYS = [
  "streetNumber",
  "street",
  "district",
  "city",
  "province",
] as const satisfies readonly (keyof LocationAddressComponents)[];

/* -------------------------------------------------------------------------- */
/* 常量与构造器的类型层一致性（零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/** 官方四角常量（`const/Anchor.d.ts` 的声明值）。 */
type OfficialCornerAnchor =
  | typeof BMAP_ANCHOR_TOP_LEFT
  | typeof BMAP_ANCHOR_TOP_RIGHT
  | typeof BMAP_ANCHOR_BOTTOM_LEFT
  | typeof BMAP_ANCHOR_BOTTOM_RIGHT;

/** 官方其余（控件不接受的）落点常量。 */
type OfficialCenterAnchor =
  | typeof BMAP_ANCHOR_TOP_CENTER
  | typeof BMAP_ANCHOR_MIDDLE_LEFT
  | typeof BMAP_ANCHOR_CENTER
  | typeof BMAP_ANCHOR_MIDDLE_RIGHT
  | typeof BMAP_ANCHOR_BOTTOM_CENTER;

/**
 * 官方控件 `type` 的两套数值枚举（`const/NavigationControlType.d.ts` 的
 * `0|1|2|3` 与 `const/MapTypeControlType.d.ts` 的 `0|1|2`），以及**它们各自的常量名**。
 *
 * 常量名是手写的字面量联合而不是 `keyof typeof`：官方把它们声明成
 * `declare const BMAP_NAVIGATION_CONTROL_LARGE: 0`——**只有类型、没有值**，运行时
 * 也不保证挂出来（`map.ts` 的 `MAP_TYPE_CONSTANT_CANDIDATES` 就是因为这一点才要去
 * 命名空间里试多个候选名）。所以「键名」只能是本库自己声明的字面量。
 *
 * 名字并集**逐项**对应两个 `const/*.d.ts`：`type NavigationControlType` 由 LARGE / SMALL /
 * PAN / ZOOM 四个 `typeof` 组成，`type MapTypeControlType` 由 HORIZONTAL / DROPDOWN / MAP
 * 三个 `typeof` 组成。
 *
 * 刻意**不**定义 `NavigationControlType | MapTypeControlType` 的并集别名：两族分表后
 * 没有任何消费方需要它，而下面两条断言各自针对**一族**——并集只能表达「两族都不溢出」，
 * 表达不了「每族的每个名字都对」，那正是恒真重言式栽跟头的地方。
 */
type OfficialNavigationTypeName =
  | "BMAP_NAVIGATION_CONTROL_LARGE"
  | "BMAP_NAVIGATION_CONTROL_SMALL"
  | "BMAP_NAVIGATION_CONTROL_PAN"
  | "BMAP_NAVIGATION_CONTROL_ZOOM";
type OfficialMapTypeControlName =
  | "BMAP_MAPTYPE_CONTROL_HORIZONTAL"
  | "BMAP_MAPTYPE_CONTROL_DROPDOWN"
  | "BMAP_MAPTYPE_CONTROL_MAP";

/** 精确相等（`extends` 对联合会做子类型放宽，`never` 这类需要严格等值）。 */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * 两族**常量名**互不重叠：`Exclude` 一个都没删掉（两边的结果都等于自己）。
 *
 * 这条是「按族分表」的类型层依据：名字空间分离，跨族名字在结构上就不属于本族，
 * 官方哪天让两族共用一个常量名（或改名撞车）会直接红。
 */
type _AssertTypeNamesDisjoint = ExpectTrue<
  Equals<Exclude<OfficialNavigationTypeName, OfficialMapTypeControlName>, OfficialNavigationTypeName> extends true
    ? Equals<Exclude<OfficialMapTypeControlName, OfficialNavigationTypeName>, OfficialMapTypeControlName> extends true
      ? true
      : false
    : false
>;

/**
 * ⚠️ 但两族的**数值**是重叠的（`MapTypeControlType` 的 `0|1|2` ⊂ `NavigationControlType`
 * 的 `0|1|2|3`）——这正是不能合成一张平表的原因：跨族接受在数值上**看不出来**
 * （`<NavigationControl type="BMAP_MAPTYPE_CONTROL_MAP">` 在平表下会拿到 `2`，与本族合法的
 * `BMAP_NAVIGATION_CONTROL_PAN: 2` 完全同值），使用者与审查者都发现不了控件样式错了。
 * 断言成「重叠」而不是「不相交」：官方哪天把两套枚举改成不重叠的值域，这条会红，
 * 提示重新评估分表的必要性（那时跨族接受才不再静默）。
 */
type _AssertTypeValuesOverlap = ExpectTrue<
  Equals<Exclude<NavigationControlType, MapTypeControlType>, never> extends true ? false : true
>;

/**
 * **逐名**对应：`NAVIGATION_TYPE_VALUES` 的每个值必须**正好**等于官方那个名字的
 * `NavigationControlType` 成员。任何一个值被改错（哪怕仍在 `0|1|2|3` 范围内）都会红——
 * 这正是把 `LARGE: 0` 错改成 `LARGE: 3` 那种整体错位最需要防的回归。
 *
 * ⚠️ 逐名等值**只挡改值、挡不住「上游新增成员」**（新成员在表里没有对应键，逐名断言压根不看
 * 它）。所以下面 `AssertNavigationTypeExhaustive` 必须与它**成对**存在，两条各挡一半。
 * 早期版本只写「并集 `extends`」一条，恰恰栽在这里：那条是**恒真重言式**（右侧由上游联合
 * 自己的成员拼出来，让上游联合 extends 它永远成立），改值全错也不红。
 */
type AssertNavigationTypeValues = ExpectTrue<
  typeof NAVIGATION_TYPE_VALUES["BMAP_NAVIGATION_CONTROL_LARGE"] extends typeof BMAP_NAVIGATION_CONTROL_LARGE
    ? typeof NAVIGATION_TYPE_VALUES["BMAP_NAVIGATION_CONTROL_SMALL"] extends typeof BMAP_NAVIGATION_CONTROL_SMALL
      ? typeof NAVIGATION_TYPE_VALUES["BMAP_NAVIGATION_CONTROL_PAN"] extends typeof BMAP_NAVIGATION_CONTROL_PAN
        ? typeof NAVIGATION_TYPE_VALUES["BMAP_NAVIGATION_CONTROL_ZOOM"] extends typeof BMAP_NAVIGATION_CONTROL_ZOOM
          ? true
          : false
        : false
      : false
    : false
>;

/**
 * **穷尽**对应：表里的**值域**必须与官方 `NavigationControlType` 的**值域完全相同**。
 *
 * 逐名断言看不见「上游新增了一个成员」——新成员在表里没有键，两条逐名断言照样绿。
 * 这条按**值**比较（`Equals` 是精确等值，不做子类型放宽），所以官方给
 * `NavigationControlType` 加了第 5 个取值时它立刻红，提示补表。
 *
 * 与逐名断言的分工（两类变异各由一条挡，实测于 `node_modules` 里真实的类型包）：
 *
 * | 变异 | 逐名等值 | 本条（值域穷尽） |
 * | --- | --- | --- |
 * | 表里某个值改错（`LARGE: 0` → `3`） | 🔴 红 | — |
 * | 表里删掉一整行 | 🔴 红（`satisfies` + 键不存在） | — |
 * | 上游把 `LARGE` 的值改成别的数 | 🔴 红 | — |
 * | **上游新增一个枚举成员** | 绿 | 🔴 红 |
 *
 * ⚠️ 两条**都删不得**：只留本条，`LARGE: 0` 改成 `3` 仍然绿（值域还是 `0|1|2|3`，
 * 只是对应的名字错了）；只留逐名，上游加成员无人察觉。
 */
type AssertNavigationTypeExhaustive = ExpectTrue<
  Equals<
    typeof NAVIGATION_TYPE_VALUES[keyof typeof NAVIGATION_TYPE_VALUES],
    NavigationControlType
  >
>;
/** 同上，逐名钉 `MAPTYPE_TYPE_VALUES`（`HORIZONTAL=0` / `DROPDOWN=1` / `MAP=2`）。 */
type AssertMapTypeControlValues = ExpectTrue<
  typeof MAPTYPE_TYPE_VALUES["BMAP_MAPTYPE_CONTROL_HORIZONTAL"] extends typeof BMAP_MAPTYPE_CONTROL_HORIZONTAL
    ? typeof MAPTYPE_TYPE_VALUES["BMAP_MAPTYPE_CONTROL_DROPDOWN"] extends typeof BMAP_MAPTYPE_CONTROL_DROPDOWN
      ? typeof MAPTYPE_TYPE_VALUES["BMAP_MAPTYPE_CONTROL_MAP"] extends typeof BMAP_MAPTYPE_CONTROL_MAP
        ? true
        : false
      : false
    : false
>;

/** 同上，值域穷尽（挡「上游给 `MapTypeControlType` 加新成员」）。两条成对，缺一不可。 */
type AssertMapTypeControlExhaustive = ExpectTrue<
  Equals<typeof MAPTYPE_TYPE_VALUES[keyof typeof MAPTYPE_TYPE_VALUES], MapTypeControlType>
>;

/**
 * 构造器名必须与官方 `BMap` 命名空间一致（与 `overlays.ts` 的同源断言同一手法）。
 *
 * 上游改名/移除某个控件构造器时，`pnpm typecheck:package`（`skipLibCheck: false`）会在编译期失败，
 * 而不是等到运行时才报 `BMap.GeolocationControl is not available`。
 */
type OfficialControlCtor = (typeof CONTROL_CTORS)[Exclude<ControlKind, "custom">];
type _AssertControlCtors = ExpectTrue<
  OfficialControlCtor extends keyof typeof BMap ? true : false
>;
type _AssertBaseControl = ExpectTrue<"Control" extends keyof typeof BMap ? true : false>;
