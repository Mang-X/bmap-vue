/**
 * `<ContextMenu>` 的属性声明、条目归一化与菜单指纹（M5-CUSTOM-MENU / issue #33）
 *
 * 从 SFC 里抽出来是为了**可测**：`tests/behavior/v3-bcontextmenu.test.ts` 要拿「声明面」与
 * `ContextMenuProps` 的键集、以及 Driver 的属性描述符交叉核对；放在 `.vue` 里就只能靠人眼
 * （与 `markerSpec.ts` / `InfoWindowSpec.ts` 同一手法）。
 *
 * ## 为什么菜单不走 `OverlaySpec` 内核
 *
 * 引擎对右键菜单的动词是**「挂到目标上」**（`Map#addContextMenu` / `Marker#addContextMenu`），
 * 不是「加进地图」（`map.addOverlay`）——菜单从不出现在 `map.getOverlays()` 里，也不参与
 * `clearOverlays()`。内核的 `mount` 固定走 `add/remove`，为了菜单去加一个 `mount` 覆盖钩子
 * 会让「登记 + 回滚」那段（PR #103 评审 1）出现第二份实现。因此菜单复用的是内核**下面的那层**
 * （`useSdkResource` 的实例 child scope / 代次守卫 / 释放路径）加上同一套
 * `OverlayRegistry` 记账与事件矩阵，而不是内核本身。理由同时记在 ADR
 * `2026-09-19-custom-overlay-and-context-menu` 里。
 *
 * ## 两种写法，一份条目
 *
 * 数据 API（`items`）与声明式 API（`<MenuItem>` / `<MenuSeparator>`）最终都归一化成
 * `ContextMenuEntry`：菜单构建、指纹、`select` 派发都只看这一份结构。「两种写法行为一致」
 * 因此是结构上成立的，而不是靠两处分别对齐。
 *
 * ## 属性怎么落地
 *
 * | prop | 落地 | 依据（`OVERLAY_DESCRIPTORS["context-menu"]`） |
 * | --- | --- | --- |
 * | `items` | **重建菜单**（`recreate`） | 描述符：`unsupported`——「菜单项经 addItem/removeItem 管理，项目侧走重建菜单路径」 |
 * | `menuItems` | `alias`：由集中弃用层在读取层解析成 `items`，自身不下发 | 不是 SDK 属性 |
 * | `width` | **重建菜单** | 描述符：`unsupported`——「宽度是 MenuItem 的构造选项（`MenuItemOptions.width`），ContextMenu 实例上没有宽度 setter」 |
 * | `visible` | **挂载 / 摘除**（不是弹层显隐） | 描述符：`visible: toggleBy(["show","hide"])`，但组件侧走 attach/detach（见决策） |
 *
 * `visible` 这一行是**有意的偏离**：描述符登记的是 SDK 的实例方法（`ContextMenu#show/hide`），而
 * 组件的 `visible` 语义是「菜单是否挂到目标上」。把 `visible=true` 映射成 `menu.show()` 会让
 * 「没有右键过就直接弹在 (0,0)」成为可能（真实 v4 实测：`show()` 在未右键过时不抛错、直接派发
 * `open`），那是另一种语义、也不是调用方想要的。偏离记在 ADR 的已知限制里。
 */
import type { ContextMenuItem, ContextMenuSelectPayload } from "../../types/components";
import { stableKeyOf } from "../utils/stableKey";

/** 归一化后的一条菜单条目（数据 API 与声明式 API 共用同一形状）。 */
export interface ContextMenuEntry {
  readonly kind: "item" | "separator";
  /** 分隔线的 `text` 为空串（SDK 不看它）。 */
  readonly text: string;
  readonly disabled: boolean;
  readonly width?: number;
  readonly id?: string;
  /**
   * 选中时的回调。
   *
   * 数据 API 的 `callback` 与声明式的 `@select` 都归一化到这里；菜单构建时**不捕获具体函数**，
   * 而是经序号回读当前条目（见 `contextMenuEntriesFingerprint` 的注释），因此改回调不会触发重建。
   */
  readonly onSelect: ((payload: ContextMenuSelectPayload) => void) | null;
}

/** 数据 API 的取值：`"-"` 是分隔线。 */
export function contextMenuEntryFromData(
  value: ContextMenuItem | "-",
): ContextMenuEntry {
  if (value === "-") {
    return { kind: "separator", text: "", disabled: false, onSelect: null };
  }
  return {
    kind: "item",
    text: typeof value.text === "string" ? value.text : "",
    disabled: value.disabled === true,
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.id === undefined ? {} : { id: value.id }),
    onSelect: typeof value.callback === "function" ? value.callback : null,
  };
}

/**
 * 菜单指纹：**不含回调**。
 *
 * 回调不进指纹有两个后果，都是想要的：
 * 1. 父级每次渲染传一个新的内联箭头函数时**不会重建菜单**（那会让菜单在用户看着的时候闪一下）；
 * 2. 菜单项的 SDK 回调因此必须**按序号回读当前条目**（`latestEntries[index]`）而不是捕获创建时的
 *    那个函数——这条约定写在 `useContextMenu` 的构建代码里。
 *
 * 进指纹的是「菜单长什么样」：条目种类、文字、禁用态、宽度、id。这些任何一项变了都必须重建，
 * 因为 SDK 侧没有可靠的逐项更新入口（`MenuItem#setText` 存在，但 `disabled` 之后无法再启用——
 * 官方只有 `enable()` / `disable()` 且没有读回，重建是唯一能保证「最终状态正确」的路径）。
 */
export function contextMenuEntriesFingerprint(entries: readonly ContextMenuEntry[]): string {
  return stableKeyOf(
    entries.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
      disabled: entry.disabled,
      width: entry.width ?? null,
      id: entry.id ?? null,
    })),
  );
}

/** prop → 落地方式的完整映射（`-?` 由类型层保证漏一个就编译失败）。 */
export type ContextMenuFieldLanding = "rebuild" | "visibility" | "alias";

export type ContextMenuFieldMap<Props> = {
  readonly [K in keyof Props]-?: ContextMenuFieldLanding;
};

/**
 * 每个公开属性的落地方式（唯一声明点）。
 *
 * 表与上面的模块注释逐行对应；`tests/behavior/v3-bcontextmenu.test.ts` 的「声明面」一组拿它与
 * `ContextMenuProps` 的键集、以及 `OVERLAY_DESCRIPTORS["context-menu"]` 交叉核对。
 */
export const CONTEXT_MENU_FIELDS: ContextMenuFieldMap<{
  items: unknown;
  menuItems: unknown;
  width: unknown;
  visible: unknown;
}> = {
  items: "rebuild",
  menuItems: "alias",
  width: "rebuild",
  visible: "visibility",
};
