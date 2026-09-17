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
 * - `live`：有就地入口，`setOptions` 会真的写下去；
 * - `recreate`：只有构造期生效，`setOptions` 告警一次且**不动实例**，需要新值请重建控件；
 * - `unsupported`：本引擎没有该 option 的入口（未命中分类表、没有 options 袋，实例上也没有
 *   对应的 `set<Key>`）——`setOptions` 告警一次且忽略，**重建同样不会生效**。
 */
export type ControlOptionStatus = "live" | "recreate" | "unsupported";

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
   * 组件层的统一 Control adapter 靠它在两条动作里选一条：**就地更新**（`live`）还是
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
  removeCopyright(control: ControlHandle, id: number): void;
  listCopyrights(control: ControlHandle): CopyrightEntry[];
}
