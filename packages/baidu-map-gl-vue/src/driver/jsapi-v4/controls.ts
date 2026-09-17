/**
 * v4 ControlDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 把 JSAPI 4.0 的控件收敛成项目领域映射（`ControlDriver`）；公共 API 不新增成员，
 * 只把 `ControlHandle` 的品牌补成 `control:<kind>`（与 Overlay / Layer 句柄同形，
 * `setOptions` 因此能按种类给出正确的更新口径）。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4` + 官方 Skill
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
  ControlDriver,
  ControlKind,
  ControlOptionStatus,
  ControlOptions,
  CopyrightEntry,
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
 * 停靠位置常量表：官方 `const/Anchor.d.ts` 的**声明值**。
 *
 * 刻意不从 `window.BMAP_ANCHOR_*` 读：Driver 边界只认 `rawSdk` 传入的命名空间，
 * 不读未经 Provider 校验的全局值（同 ADR 2026-09-11-jsapi-v4-map-facet §9）。
 * 表本身被类型层钉在官方声明上（见文件末尾的锚点断言），上游改值会直接编译失败。
 */
const ANCHOR_VALUES: Readonly<Record<string, OfficialCornerAnchor | OfficialCenterAnchor>> = {
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
 * `anchor` / `offset` 是全部控件的公共可更新项（基类 `setAnchor` / `setOffset`），
 * 因此在 `setOptions` 里单独处理，不重复出现在本表。
 *
 * 表用 `Record<ControlKind, …>` 而非 `Partial`：新增一个控件种类却忘记写分类会直接编译失败。
 */
type ControlOptionSpec =
  | { policy: "mutable"; setter: string; value?: "size" }
  | { policy: "mutable"; choice: readonly [string, string] }
  | { policy: "recreate"; reason: string };

const CONTROL_OPTION_SPECS: Readonly<
  Record<ControlKind, Readonly<Record<string, ControlOptionSpec>>>
> = {
  zoom: {},
  scale: {
    unit: { policy: "mutable", setter: "setUnit" },
  },
  navigation: {
    type: { policy: "mutable", setter: "setType" },
    // 官方 4.0.4 的 `NavigationControl` 只声明了 getType/setType：其余构造选项没有运行期入口
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
    // `showStreetLayer(isShow)` 是官方 4.0.4 上 `MapTypeControl` **唯一**的字段级 setter
    // （路网层显隐），成员名不是 `set<Key>` 形状——所以它必须进分类表，否则会落到下面
    // 的「未知键 + `set<Key>` 结构逃生口」里被判成 unsupported（值被静默丢弃）。
    showStreetLayer: { policy: "mutable", setter: "showStreetLayer" },
    type: {
      policy: "recreate",
      reason: "4.0 的 MapTypeControl 只公开 showStreetLayer(isShow)，控件样式没有 setter",
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
   * 领域值 → 4.0 取值。
   *
   * `value: "size"` 的 option（`overview.size`）与 `offset` 同形：项目侧是 Pixel，4.0 是 `Size`。
   * 构造与更新两条路径共用这里，避免「同一次 size 更新」在两条入口上语义不同。
   */
  const normalizeValue = (spec: ControlOptionSpec | undefined, value: unknown): unknown =>
    spec && "value" in spec && spec.value === "size" ? toRawSize(value) : value;

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
      projected[key] = normalizeValue(specs?.[key], value);
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
    // 由 `BCopyright` 的 create/mount/unmount 完成「离开旧共享组 → 加入目标共享组」的迁移。
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
        apply: (value) => callControl(raw, spec.setter, [normalizeValue(spec, value)]),
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

    listCopyrights(control): CopyrightEntry[] {
      const raw = registry.resolve<Record<string, unknown>>(control);
      const entries = callRequired(raw, "getCopyrightCollection") as
        | readonly { id: number; content?: string; bounds?: unknown }[]
        | undefined;
      // `bounds` 一并回读：`BCopyright` 的更新路径会带着旧 bounds 重新 addCopyright，
      // 丢掉它会让「内容变了但适用范围变回全局」（webgl-v1 的 listCopyrights 没有回读 bounds，
      // 差异登记在 ADR「已知限制」里）。
      return (entries ?? []).map((entry) => {
        const item: CopyrightEntry = { id: entry.id, content: entry.content ?? "" };
        if (entry.bounds !== undefined) item.bounds = entry.bounds;
        return item;
      });
    },
  };
}

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
 * 构造器名必须与官方 `BMap` 命名空间一致（与 `overlays.ts` 的同源断言同一手法）。
 *
 * 上游改名/移除某个控件构造器时，`pnpm typecheck:v3`（`skipLibCheck: false`）会在编译期失败，
 * 而不是等到运行时才报 `BMap.GeolocationControl is not available`。
 */
type OfficialControlCtor = (typeof CONTROL_CTORS)[Exclude<ControlKind, "custom">];
type _AssertControlCtors = ExpectTrue<
  OfficialControlCtor extends keyof typeof BMap ? true : false
>;
type _AssertBaseControl = ExpectTrue<"Control" extends keyof typeof BMap ? true : false>;
