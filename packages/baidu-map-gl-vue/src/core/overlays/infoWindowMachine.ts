/**
 * BInfoWindow 的状态机（M5-INFOWINDOW / issue #32）
 *
 * 纯函数 reducer：**没有计时器、没有 SDK、没有 DOM**。它只回答「收到这件事之后，状态是什么、
 * 该向 SDK 下发哪条命令、该向父级报告哪次变化」。组件侧只负责执行效果、把事件喂进来。
 *
 * ## 五个相位
 *
 * ```
 *              intent(true)                    sdk-open（确认）
 *   closed ──────────────────▶ opening ─────────────────────────▶ open
 *     ▲                          │                                 │
 *     │  sdk-close(结算/未经请求) │ intent(false)                   │ intent(false)
 *     │                          ▼                                 ▼
 *     └──────────────────── closing ◀───────────────────────────────┘
 *                              ▲  │ sdk-open（关闭命令被吞掉）
 *                              └──┘  再下发一次 close 收敛
 * ```
 *
 * - `closed` / `open` 是**稳定态**；`opening` / `closing` 是「命令已下发、尚未观测到结果」的过渡态。
 * - 过渡态存在的唯一理由：**同一 tick 的 open → close 会让关闭命令被吞掉**。真机实测
 *   （`driver/jsapi-v4/overlays.ts` 的注释）：`map.openInfoWindow()` 之后同一 tick
 *   `map.getInfoWindow()` 仍是 `null`，此时 `map.closeInfoWindow()` 是 no-op。所以在 `closing`
 *   里观测到 SDK 的 `open` 时要**再下发一次关闭**，否则「点了关闭，气泡却留在地图上」。
 * - `disposed` 是终态：之后一切事件与意图都被丢弃（卸载后不得再产生命令或回写）。
 *
 * ## `close` 事件没有身份信息 ⇒ 用「未结算的关闭命令」来归属
 *
 * SDK 的 `close` 事件不带任何身份：它既可能是「我们刚下发的关闭命令的结算」，也可能是
 * 「更早一次关闭命令的迟到回包」，两者在 SDK 侧完全不可区分。处理错的后果是
 * 「明明还开着，模型却说关了」。因此：
 *
 * | `closePending` | 模型（`open`） | 处置 |
 * | --- | --- | --- |
 * | `false` | 任意 | **未经请求的关闭**（点地图 / 点关闭按钮 / 被顶掉）⇒ 相位回 `closed`、模型收敛为关、回写 `update:open` |
 * | `true` | `false` | 结算我们已下发的关闭命令 ⇒ 相位回 `closed`，**不改模型**（期望状态本来就是关） |
 * | `true` | `true` | **过期回包**（关之后又重开过）⇒ 只清标记，相位与模型都不动 |
 *
 * 于是「关 → 立刻重开 → 迟到的 close 到达」不会把已经重开的气泡在模型里关掉，
 * 而「点地图关闭」仍然是一次真实的模型收敛。
 *
 * ## 迟到回调只有一种处置：丢弃
 *
 * 每条来自实例的回调都带 `generation`（重建即 +1）。代次不匹配 ⇒ 它属于**已经被换掉的那个实例**，
 * 一律丢弃：既不写模型，也不下发命令。
 *
 * `superseded` 是互补的一路：同一张地图上**另一个组件**抢走了气泡。此时**绝不下发关闭命令** ——
 * `closeInfoWindow()` 是地图级 API，那一下会打到新的那个气泡头上（验收里的
 * 「Manager 打开 B 后，A 的迟到 close 不能改变 B 的状态」）。
 *
 * ## 受控模型：`update:*` 只在 SDK 侧变化时回写
 *
 * `change.source === "sdk"` 才回写 `update:open` / `update:show`；父级驱动的变化不回声，
 * 否则「父级改 → 我们 emit → 父级确认 → 我们再看」会多出一轮回环。
 *
 * ## 与官方参考实现 `huiyan-fe/react-bmap` 的对照
 *
 * 参考实现的 v4 `InfoWindow` **没有状态机**：它只有一个 `useEffect`，按构造期 props 的
 * 指纹重建实例、按 `open` 调 `map.openInfoWindow()`，`close` 只在卸载时调一次；`open` prop
 * 变 `false` 不会关闭已经打开的气泡，SDK 侧关闭也不回写 `open`。本库的五个相位、
 * 双向同步与上面这张归属表都是参考实现没有的（见 ADR 的对照表）。
 */
import type { Point } from "../../driver/types/geometry";

/** 气泡相位。`closed` / `open` 稳定，`opening` / `closing` 是命令在飞，`disposed` 终态。 */
export type InfoWindowPhase = "closed" | "opening" | "open" | "closing" | "disposed";

/** 机器能产生的副作用。一次转换最多一条 —— 「无重复开关回环」的可断言形态。 */
export type InfoWindowEffect =
  | { readonly type: "open"; readonly generation: number }
  | { readonly type: "close"; readonly generation: number };

/** 模型变化（`open` 的取值变了）。`source` 决定要不要回写 `update:*`。 */
export interface InfoWindowChange {
  readonly open: boolean;
  /**
   * - `prop`：父级意图驱动（受控），**不回写** `update:*`；
   * - `sdk`：由 SDK 侧观测（点地图关闭 / 点关闭按钮 / 被顶掉）驱动，**回写** `update:*`。
   */
  readonly source: "prop" | "sdk";
}

/**
 * 需要交给 `resource:error` 诊断通道的**用法问题**。
 *
 * 只有一种：`open=true` 但没有可用位置。它不是运行时故障，而是调用方前提不成立；经 `notices`
 * 交出（而不是 throw）让它可以与状态转换一起被断言。
 */
export type InfoWindowNotice = "missing-position";

export interface InfoWindowSnapshot {
  readonly phase: InfoWindowPhase;
  /** 受控模型当前认定的打开值，也就是 `v-model:open` 的值。 */
  readonly open: boolean;
  /** 实例代次：重建即 +1，回调据此丢弃过期事件。 */
  readonly generation: number;
  /** 已下发但尚未观测到结算的关闭命令，见模块注释的归属表。 */
  readonly closePending: boolean;
  /** 当前生效的位置指纹（`null` = 无位置）。用来判断已开着的气泡是否需要移动。 */
  readonly positionKey: string | null;
  /** 「想开但缺位置」是否已经报过一次（进入该状态时报一次，离开即复位）。 */
  readonly invalidNotified: boolean;
}

export type InfoWindowAction =
  /**
   * 父级意图（受控 prop 或异步到位的位置）。
   *
   * `wantOpen` 是**已经与位置前提求与之后**的期望；`canOpen` 单独带上，是为了让
   * 「想开但缺位置」只报一次错（`notices`），而不必在组件里再造一份边沿状态。
   */
  | {
      readonly type: "intent";
      readonly wantOpen: boolean;
      readonly canOpen: boolean;
      readonly positionKey: string | null;
    }
  /** SDK 报告「打开了」。 */
  | { readonly type: "sdk-open"; readonly generation: number }
  /** SDK 报告「关闭了」。 */
  | { readonly type: "sdk-close"; readonly generation: number }
  /** 同一张地图上另一个气泡接管了（本实例被顶掉）。 */
  | { readonly type: "superseded"; readonly generation: number }
  /** 实例被重建：旧实例作废，新代次从 `closed` 起步。 */
  | { readonly type: "rebuild"; readonly generation: number }
  /** 组件销毁：终态。 */
  | { readonly type: "dispose" };

export interface InfoWindowTransition {
  readonly snapshot: InfoWindowSnapshot;
  readonly effects: readonly InfoWindowEffect[];
  readonly changes: readonly InfoWindowChange[];
  readonly notices: readonly InfoWindowNotice[];
}

/**
 * 位置指纹：**没有可用位置时返回 `null`**（而不是 `""` 之类的哨兵）。
 *
 * 用值而不是对象引用判等（父级常传内联字面量）；「没有位置」与「某个具体位置」必须可区分 ——
 * 与 `core/runtime/elementSize.ts` 的既有口径一致（那里也是「读不到返回 `null`，不等于 0」）。
 */
export function positionKeyOf(point: Point | undefined | null): string | null {
  if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return null;
  return `${point.lng},${point.lat}`;
}

export function initialInfoWindowSnapshot(generation = 0): InfoWindowSnapshot {
  return {
    phase: "closed",
    open: false,
    generation,
    closePending: false,
    positionKey: null,
    invalidNotified: false,
  };
}

const NONE_EFFECTS: readonly InfoWindowEffect[] = [];
const NONE_CHANGES: readonly InfoWindowChange[] = [];
const NONE_NOTICES: readonly InfoWindowNotice[] = [];

interface Step {
  readonly snapshot: InfoWindowSnapshot;
  readonly effects?: readonly InfoWindowEffect[];
  readonly changes?: readonly InfoWindowChange[];
  readonly notices?: readonly InfoWindowNotice[];
}

/** 把内部的可选字段补齐成完整的转换结果（缺省即「这一路没有」）。 */
function transition(step: Step): InfoWindowTransition {
  return {
    snapshot: step.snapshot,
    effects: step.effects ?? NONE_EFFECTS,
    changes: step.changes ?? NONE_CHANGES,
    notices: step.notices ?? NONE_NOTICES,
  };
}

/** 无副作用的一步（丢弃 / 幂等）。 */
function settle(snapshot: InfoWindowSnapshot): InfoWindowTransition {
  return { snapshot, effects: NONE_EFFECTS, changes: NONE_CHANGES, notices: NONE_NOTICES };
}

/**
 * `open` 取值的统一出口：只有**真的变了**才产生 `changes`。
 *
 * 收在一处，是为了让「同值不回声」成为结构上的事实，而不是靠每个分支各自记得判一次。
 */
function changeOpen(state: InfoWindowSnapshot, open: boolean, source: "prop" | "sdk"): Step {
  if (state.open === open) return { snapshot: state };
  return { snapshot: { ...state, open }, changes: [{ open, source }] };
}

function enterPhase(state: InfoWindowSnapshot, phase: InfoWindowPhase): InfoWindowSnapshot {
  return state.phase === phase ? state : { ...state, phase };
}

export function reduceInfoWindow(
  state: InfoWindowSnapshot,
  action: InfoWindowAction,
): InfoWindowTransition {
  // 终态：一切输入都被丢弃，且不产生任何效果
  if (state.phase === "disposed") return settle(state);

  switch (action.type) {
    case "intent":
      return transition(reduceIntent(state, action));
    case "sdk-open":
      return transition(reduceSdkOpen(state, action.generation));
    case "sdk-close":
      return transition(reduceSdkClose(state, action.generation));
    case "superseded": {
      if (action.generation !== state.generation) return settle(state);
      if (state.phase === "closed") return settle(state);
      // 不下发任何命令：地图上已经是新的那一个，任何 map 级关闭都会打到它头上
      const closed = changeOpen({ ...state, closePending: false }, false, "sdk");
      return transition({
        snapshot: enterPhase(closed.snapshot, "closed"),
        changes: closed.changes ?? NONE_CHANGES,
      });
    }
    case "rebuild":
      // 期望状态由接下来的 reconciliation 重新施加，此刻只把相位收回 closed。
      // 刻意**不**产生 changes：重建对外是原子的（父级没有改过 `open`）。
      return settle({
        phase: "closed",
        open: state.open,
        generation: action.generation,
        closePending: false,
        positionKey: null,
        invalidNotified: false,
      });
    case "dispose":
      return settle(enterPhase({ ...state, closePending: false }, "disposed"));
    default:
      return settle(state);
  }
}

function reduceIntent(
  state: InfoWindowSnapshot,
  action: Extract<InfoWindowAction, { type: "intent" }>,
): Step {
  const { wantOpen, canOpen, positionKey } = action;
  const wantsOpen = wantOpen && canOpen;
  const invalid = wantOpen && !canOpen;
  // 边沿触发：「想开但缺位置」只在**进入**该状态时报一次（异步位置到位后不再重复刷）
  const notices: readonly InfoWindowNotice[] =
    invalid && !state.invalidNotified ? ["missing-position"] : NONE_NOTICES;
  const base: InfoWindowSnapshot = {
    ...state,
    positionKey: canOpen ? positionKey : null,
    invalidNotified: invalid,
  };

  if (!wantsOpen) {
    if (base.phase === "closed" || base.phase === "closing") {
      // 已经收敛在关闭一侧：不重复下发关闭命令
      return { snapshot: base, effects: NONE_EFFECTS, changes: NONE_CHANGES, notices };
    }
    const closed = changeOpen({ ...base, closePending: true }, false, "prop");
    return {
      snapshot: enterPhase(closed.snapshot, "closing"),
      effects: [{ type: "close", generation: state.generation }],
      changes: closed.changes ?? NONE_CHANGES,
      notices,
    };
  }

  if (base.phase === "open" || base.phase === "opening") {
    // 已经在打开一侧：只有位置**真的变了**才补一条 open（它同时负责「移动」）
    const moved = base.positionKey !== state.positionKey;
    return {
      snapshot: base,
      effects: moved ? [{ type: "open", generation: state.generation }] : NONE_EFFECTS,
      changes: NONE_CHANGES,
      notices,
    };
  }

  // closed / closing：都要（重新）发起打开。
  // `closePending` **保持原值**：从 `closing` 重开时，那条关闭命令仍然在飞，它的迟到回包
  // 必须继续被认作「过期」（否则重开之后会被一条旧回包关掉，见模块注释的归属表）。
  const reopened = changeOpen({ ...base, closePending: state.closePending }, true, "prop");
  return {
    snapshot: enterPhase(reopened.snapshot, "opening"),
    effects: [{ type: "open", generation: state.generation }],
    changes: reopened.changes ?? NONE_CHANGES,
    notices,
  };
}

function reduceSdkOpen(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);
  if (state.phase === "closing") {
    // 关闭命令被吞掉了（同 tick 的 open → close）。再下发一次收敛到关闭。
    return {
      snapshot: { ...state, closePending: true },
      effects: [{ type: "close", generation: state.generation }],
    };
  }
  if (state.phase === "open") return settle(state);
  const confirmed = changeOpen({ ...state, closePending: false }, true, "sdk");
  return {
    snapshot: enterPhase(confirmed.snapshot, "open"),
    changes: confirmed.changes ?? NONE_CHANGES,
  };
}

function reduceSdkClose(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);
  if (state.phase === "closed") return settle(state);

  if (state.closePending) {
    const settled = { ...state, closePending: false };
    if (state.open) {
      // 过期回包：关闭命令之后又重开过。只清标记，相位与模型都不动。
      return settle(settled);
    }
    // 结算我们已下发的关闭命令：期望状态本来就是关，不改模型
    return settle(enterPhase(settled, "closed"));
  }

  // 未经请求的关闭（点地图 / 点关闭按钮 / 被顶掉）
  const closed = changeOpen({ ...state, closePending: false }, false, "sdk");
  return {
    snapshot: enterPhase(closed.snapshot, "closed"),
    changes: closed.changes ?? NONE_CHANGES,
  };
}
