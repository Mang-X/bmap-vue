/**
 * ControlDriver
 *
 * 控件构造器、anchor/offset 归一化与 add/remove 全部收进 Driver。
 *
 * `kind` 是**引擎无关的能力面**（M3A2-CONTROLS-LAYERS / issue #22 的目标与范围）：
 * 十个内置控件的语义名 + `custom`（业务 DOM）。各引擎负责把它映射到自己的构造器与
 * 停靠/偏移 API；组件层不需要知道 SDK 构造器名。
 *
 * 命名口径：
 * - `location` 在 JSAPI 4.0 上是 `GeolocationControl`（v4 同时保留同实现的
 *   `LocationControl` 名称，但官方 Skill 明确「新代码统一写 GeolocationControl」）；
 *   领域名保持不变，避免为一次重命名动组件契约。
 * - `anchor` 传的是官方常量**名**（`"BMAP_ANCHOR_BOTTOM_RIGHT"`），不是数值——
 *   与 webgl-v1 的组件 props 形状保持一致，由 Driver 换算成各引擎的取值。
 */
import type { ControlHandle } from "./handles";
import type { Pixel } from "./geometry";
import type { OverlayTarget } from "./overlays";

export type ControlKind =
  | "zoom"
  | "scale"
  | "navigation"
  | "navigation-3d"
  | "city-list"
  | "location"
  | "map-type"
  | "overview"
  | "panorama"
  | "copyright"
  | "custom";

export interface ControlOptions {
  anchor?: string;
  offset?: Pixel;
  [key: string]: unknown;
}

/**
 * 单个 option 键**在构造之后**改动的落地方式（`ControlDriver.planOptions()` 的返回值）。
 *
 * 三态而不是二态：「本引擎没有入口」与「有入口但只能构造期生效」对调用方是两件不同的事——
 * 前者重建也没用（值会被静默丢弃），后者重建就能生效。合并它们会让组件对着一堆无用重建
 * 反复创建控件（M7-CONTROL-PANORAMA / issue #41）。
 *
 * - `mutable`：有就地入口，`setOptions` 会真的写下去；
 * - `recreate`：**只有构造期生效**，`setOptions` 告警一次且**不动实例**，需要新值请重建控件。
 *   既包括分类表里显式声明的构造期项（`map-type.type`、`overview.isOpen`、版权控件的 `anchor`），
 *   也包括「未命中分类表、但构造选项**原样透传**」的键——后者依然可能在构造期生效，因此归这里
 *   而不是 `unsupported`；
 * - `unsupported`：**连构造期也没有入口**（例如自定义控件上未知的键：`createCustomControl`
 *   只接收 `anchor` / `offset` / `render`）——`setOptions` 告警一次且忽略，**重建同样不会生效**。
 *
 * 实现者注意：把「没有就地 setter」一律报成 `unsupported` 是**错的**（那会让调用方丢掉本可
 * 在构造期生效的键）；判定 `unsupported` 的唯一依据是「构造期也到不了」。#95 评审第 3 轮。
 *
 * **词汇与 `OverlayPropertyPolicy` 对齐**：同一个「构造之后改这个键会怎样」的三态概念，Overlay 侧
 * 公开的是 `mutable` / `recreate` / `unsupported`，本 Facet 用同一组名字。此前控件侧叫 `live`，
 * 而控件 Driver 自己的**内部**分类表（`CONTROL_OPTION_SPECS`）用的又是 `policy: "mutable"`——
 * 一个概念三种写法最容易让消费方对不上号。#95 评审第 3 轮合并 #94 时统一。
 */
export type ControlOptionStatus = "mutable" | "recreate" | "unsupported";

export interface CopyrightEntry {
  id: number;
  content: string;
  bounds?: unknown;
}

export interface ControlDriver {
  create(kind: ControlKind, options?: ControlOptions): ControlHandle;
  /** 自定义控件：render 只接收地图 DOM 容器，SDK 细节留在 Driver 内 */
  createCustomControl(options: {
    anchor?: string;
    offset?: Pixel;
    render: (mapContainer: HTMLElement) => HTMLElement | null;
  }): ControlHandle;
  add(target: OverlayTarget, control: ControlHandle): void;
  remove(target: OverlayTarget, control: ControlHandle): void;
  show(control: ControlHandle): void;
  hide(control: ControlHandle): void;
  setOptions(control: ControlHandle, options: Record<string, unknown>): void;
  /**
   * 逐键报告「构造之后改这个 option 会怎样」（M7-CONTROL-PANORAMA / issue #41）。
   *
   * 组件层的统一 Control adapter 靠它在两条动作里选一条：**就地更新**（`mutable`）还是
   * **重建控件**（`recreate`）。没有这个查询面时，组件只能各自抄一份「哪些键要重建」的表，
   * 与 Driver 的分类各自漂移——所以本方法与 `setOptions` **共用同一处分类**（同一函数返回
   * 的动作同时决定两者），而不是并列两张表。
   *
   * `unsupported` 只在能读到实例时才能判定（逃生口按 `set<Key>` 是否存在分流），因此入参是
   * 句柄而不是 kind。
   */
  planOptions(
    control: ControlHandle,
    keys: readonly string[],
  ): Record<string, ControlOptionStatus>;

  addCopyright(control: ControlHandle, copyright: CopyrightEntry): void;
  /**
   * 摘掉一条版权项。
   *
   * ⚠️ **可能在运行时抛 `BMAP_SDK_CALL_FAILED`**，且这是**可预期**的：官方 4.0 的控件成员面在
   * loader 判就绪之后约 150ms 才补齐，`removeCopyright` 属于**后补**的那一批（`addCopyright` /
   * `getCopyright` / `getCopyrightCollection` 属于先到的那批，窗口内就可用）。
   * live 读数见 `scripts/probe-165c-surface.mts`。调用方**必须**先问
   * `canRemoveCopyright()`，而不是靠 catch 兜底（见方法注释）。
   */
  removeCopyright(control: ControlHandle, id: number): void;
  /**
   * 该实例的 `removeCopyright` **是否已就绪**（结构性判据，不吃异常、不产生任何 SDK 调用）。
   *
   * 存在的理由：`removeCopyright` 缺失**不是**「本引擎没有这个能力」，而是「**还没到**」——
   * 而这两种在处置上完全不同：前者只能放弃，后者**等一会就回来了**（补齐是**追溯**的，
   * 因为被补的是原型，已存在的实例自动获得成员）。把两者混为一谈会让「稍后可用」被
   * 当成「永远不可用」⇒ 版权项永久残留在 SDK 上。
   *
   * 组件层因此靠它决定「同步摘」还是「延后摘」，**不在组件里摸 raw 实例**。
   */
  canRemoveCopyright(control: ControlHandle): boolean;
  listCopyrights(control: ControlHandle): CopyrightEntry[];

  /**
   * 控件的**命令面**（issue #168 item 1）。
   *
   * 与 `OverlayDriver.markerCommands()` / `infoWindowCommands()` 同一手法：一个 kind 一个
   * 归一化入口，raw 成员的调用与返回值投影全部收在 Driver 内，组件层不接触 raw SDK。
   *
   * 判据与 `OverlaySpec.expose` 一致：只服务**无对应 prop 的动作**与**读回**两类。
   * 受控写入仍由 `setOptions` / `setVisible` 承担，因此**不**在这里重复暴露。
   *
   * 按 kind 分方法而不是一个 `command(kind, name, args)`：成员集是**封闭**的
   * （官方每个控件类的公开成员有限且已定），一个 kind 一个接口让「这个控件有哪些命令」
   * 成为类型层可查的事实，调用方拼错名字会编译失败。
   */
  locationCommands(control: ControlHandle): LocationCommandApi;
  cityListCommands(control: ControlHandle): CityListCommandApi;
}

/**
 * 定位控件的**地址组成部分**（官方 `service/AddressComponent` 的领域投影）。
 *
 * 五个成员**全部可选**，与 `control/GeolocationControlSuccessEvent.addressComponent`
 * 的投影口径一致（`components/controls/LocationControl.vue` 的 `AddressComponents`）。
 * 这里是**同一份形状的第二个声明点**而不是 re-export：控件组件那个 interface 住在 `.vue` 里
 * （SFC 的 `<script setup>` 不能被 `.ts` import 它的类型），因此领域类型必须自持在
 * `driver/types/`，由组件侧 import 过来——**一处形状、两处引用**，不允许各自手抄。
 */
export interface LocationAddressComponents {
  streetNumber?: string;
  street?: string;
  district?: string;
  city?: string;
  province?: string;
}

/** 定位控件的命令面（官方 `control/GeolocationControl.d.ts`）。 */
export interface LocationCommandApi {
  /** 开始进行定位（官方 `location(): void`）。 */
  location(): void;
  /**
   * 开始执行定位（官方 `startLocation(): void`）。
   *
   * ⚠️ **名字不对称是上游的形状**：官方只声明 `startLocation()`（开始定位）与
   * `stopLocationTrace()`（停止跟踪），**没有** `startLocationTrace()`。issue #168 的
   * 描述把命令写成 `startLocationTrace()`，那是把兄弟成员的名字带过来了——按
   * 「d.ts 定存在与否」的口径暴露 `startLocation`。
   *
   * live AK 读数确认（`scripts/probe-runtime-members.mts` probe 14）：
   * `startLocation` `callable: true`，`startLocationTrace` `callable: false`。
   * 两者**都不能**互相顶替，因此 `startLocation` 是唯一有依据的那一个。
   */
  startLocation(): void;
  /** 停止跟踪用户位置（官方 `stopLocationTrace(): void`）。 */
  stopLocationTrace(): void;
  /**
   * 当前定位地址信息（官方 `getAddressComponent(): AddressComponent | null`）。
   *
   * 尚未定位时是 `null` 而**不是**空对象——官方声明就是可空，编一个 `{}` 会让调用方
   * 把「没定位到」误判成「定位到了一个空地址」。
   */
  getAddressComponent(): LocationAddressComponents | null;
}

/** 城市列表控件的命令面（官方 `control/CityListControl.d.ts`）。 */
export interface CityListCommandApi {
  /**
   * 切换城市列表面板的展开状态（官方 `toggle(): void`）。
   *
   * 与 `expand` prop 的关系：`expand` 是**受控**入口（变化即下发 `open` / `close`），
   * `toggle` 是**动作**（切一次，不镜像回 prop）。官方没有「面板被别人打开过」的可观察值
   * 之外的可观察值可供同步，因此刻意不做命令 ⇄ prop 双向绑定——与
   * `PanoramaLabel#show/hide` 同一取舍。
   */
  toggle(): void;
  /** 当前城市名称（官方 `getCityName(): string`）。 */
  getCityName(): string;
  /**
   * ⚠️ **刻意没有** `getTriggerDom(): HTMLElement | undefined`（官方有声明）。
   *
   * 返回值是**原生 DOM 元素**：交出去就把 SDK 内部渲染结构（按钮 class、子节点、
   * 事件绑定）变成公共契约——调用方一 `appendChild` / `addEventListener` 就会与 SDK 的
   * 事件系统打架，而本库既无法约束这种用法，也无法在控件重建时替它善后。
   * AGENTS.md 的 raw SDK 边界不覆盖控件组件（禁区）。
   *
   * 「收窄成领域投影」在这里**不成立**：一个 `HTMLElement` 没有任何可投影的领域值，
   * 它的全部意义就是那个节点本身。需要该节点的用户走 `./advanced` 的 `unwrapRaw()`
   * （明确的 raw 逃生口，不是组件面）。
   */
}
