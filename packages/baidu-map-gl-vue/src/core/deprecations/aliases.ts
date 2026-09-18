/**
 * 集中弃用别名表（M5-VECTORS / issue #31）
 *
 * 迁移前「兼容旧名字」是散在各组件里的一行行手写代码：`BMarker` 的
 * `deps.emit("drag-end", event)` 与 `BInfoWindow` 里手写的 `show` 告警都是同类
 * （#31 收掉前者、#32 收掉后者，两边现在都只读本表）。
 * 那种写法有三个必然的后果：**没有稳定 code**（无法在文档/日志里指认）、
 * **没有统一文案**、**没有人负责去重**（同一次会话里同一个警告刷屏）。
 *
 * 本表把「旧名 → 新名」的**身份**收在一处（`code` / `kind` / 正典名 / 旧名 / 迁移说明），
 * 由两个消费者读取：
 *
 * | 消费者 | 用法 |
 * | --- | --- |
 * | `useOverlaySpec`（内核） | prop 别名在**读取层**解析（新 API 优先、旧值只在正典缺失时生效），事件别名在**派发层**补发 |
 * | 文档（`docs/zh-CN/guide/migration-from-v2.md`、各组件页） | 表格从本表派生，不再手抄 |
 *
 * 三条硬约束（对应 issue #31 的「集中提供旧 prop/event alias 和 once-per-instance
 * deprecation warning」与迁移文档里「每条弃用都有稳定 code，同实例只警告一次，production
 * 默认不输出」）：
 *
 * 1. **code 稳定且唯一**：`BMAP_DEPRECATED_PROP_ALIAS` / `BMAP_DEPRECATED_EVENT_ALIAS`
 *    两个 code 分别覆盖两类，具体条目由 `kind + 名字` 指认（`describeDeprecation` 生成文案）。
 * 2. **同实例只警告一次**：去重发生在 `core/deprecations/warner.ts`（每个组件实例一份 warner）。
 * 3. **新 API 优先**：正典 prop 一旦有值，旧名**完全不参与**（连告警都不发）——不是「合并」，
 *    而是「旧名只在正典缺失时才是数据来源」。
 *
 * ## 为什么事件别名不放在事件矩阵里
 *
 * `core/overlays/overlayEventCatalog.ts` 的 `vue !== sdk` 那些条目是**无损双拼写**
 * （`style_loaded` ↔ `style-loaded`），两种写法指向同一件事、没有任何弃用含义；
 * 而 `drag-end` 是**历史名字**，它需要 code、需要告警、将来要删。两类放在一张表里，
 * 「哪些名字可以不打招呼地删」就说不清了。
 */
import type { OverlayKind } from "../../driver/types/overlays";
import { isPointLike } from "../utils/guards";

/** 弃用码：prop 别名。 */
export const DEPRECATED_PROP_ALIAS_CODE = "BMAP_DEPRECATED_PROP_ALIAS";
/** 弃用码：事件别名。 */
export const DEPRECATED_EVENT_ALIAS_CODE = "BMAP_DEPRECATED_EVENT_ALIAS";

/** 一条 prop 别名：「旧 prop 组 → 正典 prop」。 */
export interface OverlayPropAlias {
  readonly target: "prop";
  readonly code: string;
  readonly kind: OverlayKind;
  /** 正典 prop 名（新代码应当写的那个）。 */
  readonly canonical: string;
  /**
   * 旧 prop 名。**必须同时提供**才会被采纳：这些旧名是一组（例如西南/东北两个角点），
   * 只给一半就没有可解释的语义——此时内核**不猜**，落到「正典缺失」那条路径上。
   */
  readonly deprecated: readonly string[];
  /** 迁移说明（进告警文案与文档表格）。 */
  readonly note: string;
  /**
   * 旧 props → 正典值。只在「正典缺失 + 旧名齐备」时调用。
   *
   * 入参是**原始 props 记录**（读取层不解包响应式对象，与 `readProp` 同口径）；
   * 值不可用（形状不对）时返回 `undefined`，等价于「旧名这条路也不成立」。
   */
  readonly derive: (props: Record<string, unknown>) => unknown;
}

/** 一条事件别名：「旧事件名 → 正典事件名」。 */
export interface OverlayEventAlias {
  readonly target: "event";
  readonly code: string;
  readonly kind: OverlayKind;
  /** 正典事件名（规范 Vue 名）。 */
  readonly canonical: string;
  /** 历史事件名（派发时与正典名**各发一次**，同载荷）。 */
  readonly alias: string;
  readonly note: string;
}

/**
 * prop 别名表。两项：GroundOverlay 的角点组合在 v3 改成单一的 `bounds`
 * （与上游 `createGroundOverlay(bounds, options)` 同形）、`BInfoWindow` 的 `show` 在 v3
 * 让位给唯一的打开主状态 `open`。留着它们不是为了「以后可能有用」：
 * 它们承载的是**已经发布过的 prop 名**，删掉即等于让老代码静默失效。
 *
 * `show` 这条的消费者不是 `useOverlaySpec`（信息窗不走 `OverlaySpec`，见 ADR
 * `2026-09-18-infowindow-host-and-ownership`），而是 `useInfoWindow` ——
 * 两者共用本表与 `warner.ts`，因此「稳定 code / 统一文案 / 同实例一次」仍是一份实现。
 */
export const OVERLAY_PROP_ALIASES: readonly OverlayPropAlias[] = Object.freeze([
  {
    target: "prop",
    code: DEPRECATED_PROP_ALIAS_CODE,
    kind: "info-window",
    canonical: "open",
    deprecated: ["show"],
    note: "主状态统一为 open（v2 沿用 v-model:show，本版仍会读取，但将在后续大版本移除）",
    derive: (props) => props.show,
  },
  {
    target: "prop",
    code: DEPRECATED_PROP_ALIAS_CODE,
    kind: "ground-overlay",
    canonical: "bounds",
    deprecated: ["startPoint", "endPoint"],
    note: "改用单个 bounds（{ southwest, northeast }）：startPoint 是西南角、endPoint 是东北角",
    derive: (props) => {
      const start = props.startPoint;
      const end = props.endPoint;
      if (!isPointLike(start) || !isPointLike(end)) return undefined;
      return {
        southwest: { lng: start.lng, lat: start.lat },
        northeast: { lng: end.lng, lat: end.lat },
      };
    },
  },
]);

/**
 * 事件别名表。
 *
 * `drag-end` 是 v2/v3-beta 的写法（kebab 拼写），v3 起规范名是上游的 `dragend`。
 * 在 #31 之前它由 `markerSpec` 里一行 `deps.emit("drag-end", event)` 维持——那是「组件各自兼容」，
 * 正是 issue #28 明令禁止的形态；现在由内核按本表补发，组件侧不再出现旧名字。
 */
export const OVERLAY_EVENT_ALIASES: readonly OverlayEventAlias[] = Object.freeze([
  {
    target: "event",
    code: DEPRECATED_EVENT_ALIAS_CODE,
    kind: "marker",
    canonical: "dragend",
    alias: "drag-end",
    note: "事件名统一为 SDK 的 dragend 拼写（v2 的 drag-end 仍会发出，但将在后续大版本移除）",
  },
]);

/** 该 kind 的 prop 别名（无则为空）。 */
export function propAliasesOf(kind: OverlayKind | undefined): readonly OverlayPropAlias[] {
  if (!kind) return [];
  return OVERLAY_PROP_ALIASES.filter((alias) => alias.kind === kind);
}

/** 某个**正典**事件的别名（派发时补发这些名字）。 */
export function eventAliasesOf(
  kind: OverlayKind | undefined,
  canonical: string,
): readonly OverlayEventAlias[] {
  if (!kind) return [];
  return OVERLAY_EVENT_ALIASES.filter(
    (alias) => alias.kind === kind && alias.canonical === canonical,
  );
}

/** 全量事件别名（文档表格用；`kind` 为 `undefined` 时返回全部）。 */
export function allEventAliases(kind?: OverlayKind): readonly OverlayEventAlias[] {
  return kind ? OVERLAY_EVENT_ALIASES.filter((alias) => alias.kind === kind) : OVERLAY_EVENT_ALIASES;
}

/** 可告警的弃用条目（prop / 事件共用同一形状）。 */
export interface DeprecationNotice {
  readonly code: string;
  readonly message: string;
}

/**
 * 生成一条弃用告警。
 *
 * 文案与 `docs/zh-CN/guide/migration-from-v2.md` 里给出的示例同形：
 * 旧名与前缀用反引号包住，便于在控制台里一眼看出是哪两个名字。
 */
export function describeDeprecation(
  entry: OverlayPropAlias | OverlayEventAlias,
): DeprecationNotice {
  if (entry.target === "event") {
    return {
      code: entry.code,
      message: `\`${entry.alias}\` is deprecated; use \`${entry.canonical}\`. ${entry.note}`,
    };
  }
  const from = entry.deprecated.map((name) => `\`${name}\``).join(" / ");
  return {
    code: entry.code,
    message: `${from} is deprecated; use \`${entry.canonical}\`. ${entry.note}`,
  };
}
