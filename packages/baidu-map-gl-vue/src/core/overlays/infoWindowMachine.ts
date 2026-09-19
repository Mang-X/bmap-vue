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
 * ## `close` 事件没有身份信息 ⇒ 用「在飞的关闭命令**计数**」来归属
 *
 * SDK 的 `close` 事件不带任何身份：它既可能是「我们刚下发的关闭命令的结算」，也可能是
 * 「更早一次关闭命令的迟到回包」，两者在 SDK 侧完全不可区分。处理错的后果是
 * 「明明还开着，模型却说关了」。
 *
 * **一个布尔不够**（外部评审 P1）：`关 → 立刻重开` 之后，两次回包的到达顺序都可能发生 ——
 * 重开的 `open` 先到、旧 `close` 后到（或反之）。若在一个布尔上「见到 `open` 就清掉待结算标记」，
 * 反序到达时那条旧 `close` 会被当成**未经请求的关闭**，把已经重开的模型关掉。
 *
 * 因此这里记的是**计数**，并且只统计**在「气泡确实开着」时下发的**关闭命令 ——
 * 只有那种命令才会产生回调（真机与夹具都证实：气泡尚未被接管时 `closeInfoWindow()` 是 no-op，
 * 不会有 `close` 事件）。每条 `close` 事件消耗一次计数，处置由**模型当前值**决定：
 *
 * | `closeOutstanding` | 模型（`open`） | 处置 |
 * | --- | --- | --- |
 * | `0` | 任意 | **未经请求的关闭**（点地图 / 点关闭按钮 / 被顶掉）⇒ 相位回 `closed`、模型收敛为关、回写 `update:open` |
 * | `> 0` | `false` | 结算我们已下发的关闭命令 ⇒ 计数减一、相位回 `closed`，**不改模型**（期望状态本来就是关） |
 * | `> 0` | `true` | **过期回包**（关之后又重开过）⇒ 计数减一，相位与模型都不动 |
 *
 * `>0` 且模型是 `true` 就一定是过期回包：「模型是 `true`」只可能来自「重开之后」，
 * 而重开之前的那些关闭命令的回包都是过期的。于是「关 → 立刻重开 → 迟到的 close 到达」
 * 在**两种到达顺序**下都不会把已经重开的气泡关掉，而「点地图关闭」仍然是一次真实的模型收敛。
 *
 * **消费计数先于「已经关着」的幂等判断**（外部评审第二轮 P1）：计数可以大于 1，
 * 而「相位已经回到 `closed`」不等于「计数已经还清」—— 第 2 条回包恰恰在那时到达。
 * 顺序反了就会留下永久残留计数，之后一次**真实**的关闭被当成过期回包吞掉（模型停在「开」）。
 *
 * ## `open` 事件同样需要归属（外部评审第三轮 P1）—— 与上面**完全对称**的一张表
 *
 * `sdk-open` 也不是孤立的：本组件在 `open` 相位下改变位置会**再下发一条 open**（移动），
 * 那条请求的回包可以晚到 —— 甚至晚到「关闭已经完成」之后。若不加区分地把它当成「外部打开」，
 * 模型会被一条旧请求的回包重新拉成开（父级刚明确关闭）。
 *
 * 因此 `open` 侧也记账（`openOutstanding` = 已下发、尚未被 `sdk-open` 确认的打开请求）：
 *
 * | 观测到 `sdk-open` | 期望状态 | 处置 |
 * | --- | --- | --- |
 * | 任意 | `open === true` | 确认：相位进 `open`（模型本来就是开 ⇒ 无回写） |
 * | `openOutstanding > 0` | `open === false` | **自己的迟到回包** ⇒ 重新收敛：补一条 close（计数 +1），相位进 `closing` |
 * | `openOutstanding === 0` | `open === false` | **外部未经请求的打开** ⇒ 如实回写 `update:open true`（既有契约） |
 *
 * 两张账（`openOutstanding` / `closeOutstanding`）互为镜像：**谁下发的请求，谁负责收敛**；
 * 没有在飞请求时，才把事件当作外部意图照实回写。
 *
 * ## 异常路径上的守恒：命令同步失败要**冲销**，不能借事件收敛（外部评审第四轮 P1）
 *
 * `openInfoWindow()` / `closeInfoWindow()` 抛错时**不会有回包**来还账。若照旧「伪造一条 `sdk-close`
 * 表示失败」，会留下两处不一致：① open 侧那笔账永远还不掉 ⇒ 后续一次**外部**打开被当成自己的迟到回包
 * 而主动关掉；② 移动请求失败时（气泡其实还开着）模型被错误地收敛成关。
 * 因此失败是**独立动作** `command-failed`：按 effect 上的 `accounted` 精确冲销那一本账，
 * 再按「失败的是哪种命令」收敛相位（打开失败 ⇒ 关；移动失败 ⇒ 什么都不改；关闭失败 ⇒ 关）。
 *
 * 计数只在三种时机增长（都保证会有一条 `close` 回调）：`open` 相位下收到关闭意图、
 * `closing` 相位里观测到 `sdk-open`（命令被吞掉 ⇒ 补一条）、以及它们各自的重复下发。
 * 重建 / 被顶掉 / 销毁一律清零（那一代的回包已经没有意义）。
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

/**
 * 机器能产生的副作用。一次转换最多一条 —— 「无重复开关回环」的可断言形态。
 *
 * `accounted` 说明**这次命令是否记了一份在飞账**（`openOutstanding` / `closeOutstanding`）。
 * 它存在的唯一理由是**同步失败**：命令抛错时不会有对应的 SDK 回包来还账，
 * 调用方必须带着这个事实回喂 `command-failed`，让机器**精确**冲销它（外部评审第四轮 P1）。
 * 「抛错后伪造一条 `sdk-close`」是错的 —— 那既不冲销 open 侧的账，也会把还开着的气泡在模型里关掉。
 */
export type InfoWindowEffect =
  | { readonly type: "open"; readonly generation: number; readonly accounted: boolean }
  | { readonly type: "close"; readonly generation: number; readonly accounted: boolean };

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
  /**
   * 在飞的关闭命令**条数**（只统计「气泡确实开着时下发」的那些），见模块注释的归属表。
   *
   * 刻意不是布尔：`关 → 立刻重开` 之后回包顺序无法预期，一个布尔无法区分
   * 「旧命令的回包」与「未经请求的关闭」。
   */
  readonly closeOutstanding: number;
  /**
   * 已下发、尚未被 `sdk-open` 确认的**打开请求**条数（open 侧的对称账）。
   *
   * 用来区分「本组件自己的迟到打开回包」（要重新收敛到关闭）与「外部未经请求的打开」
   * （要如实回写 `update:open true`）—— 两者在事件载荷上不可区分。
   */
  readonly openOutstanding: number;
  /** 当前生效的位置指纹（`null` = 无位置）。用来判断已开着的气泡是否需要移动。 */
  readonly positionKey: string | null;
  /** 「想开但缺位置」是否已经报过一次（进入该状态时报一次，离开即复位）。 */
  readonly invalidNotified: boolean;
  /**
   * 「用户主动关闭」那一对事件的**配对标记**（外部评审第九轮 P1）。
   *
   * 真实 4.0 实测（真实 AK · headless Chromium，5 轮）：点一次气泡的关闭按钮会派发
   * **`close` 与 `clickclose` 各一次**，两者间隔约 0.1ms（**同一个 task**，微任务里已经两条都到齐），
   * 但**顺序不固定** —— 5 轮里 4 次 `close` 在前、1 次 `clickclose` 在前。
   *
   * 这一对属于**一次**用户关闭，两半都**不得**消费我们下发的关闭命令的账（那一对不带我们命令的身份）。
   * 麻烦在于：一条 `close` 到达时无法预知后面会不会跟着 `clickclose`，所以只能**回溯性对账**：
   *
   * - `none`：不在这一对里；
   * - `close-consumed`：上一条 `sdk-close` 消费了一份 `closeOutstanding` ⇒ 若随后那条
   *   `clickclose` 是它的配对，要把这份账**还回去**；
   * - `close-noop`：上一条 `sdk-close` 什么都没消费（没有在飞账，或相位已 `closed` 的幂等）⇒ 无需还；
   * - `clickclose-just-seen`：上一条动作是 `sdk-clickclose` ⇒ 随后那条 `close` 是它的伴随事件，
   *   来了也**不得**消费。
   *
   * 任何**别的**动作都会把它清回 `none`（见 `reduceInfoWindow`）：标记只在「紧邻的下一条关闭类事件」
   * 上有意义，否则一条很久以前的 `close` 会被后来的点击认领（或反过来）。
   *
   * ⚠️ **光靠「别的动作」清理不够**（外部评审第十轮 P1）：**时间过去本身不会产生 action**。
   * 一条真正迟到的旧回包留下的 `close-consumed` 会一直挂着，直到很多个 task 之后的一次用户点击
   * 把它误认成「本次点击的伴随 close」—— 于是凭空多出一份幽灵 `closeOutstanding`。
   * 所以配对窗口**以 task 为界**：组件在本 task 第一条关闭类事件后排一个微任务派发
   * `explicit-close-pair-expired`（实测整组事件都在同一 task 内到齐，微任务跑到时已经收全）。
   */
  readonly explicitClosePair: ExplicitClosePair;
}

/** 见 `InfoWindowSnapshot.explicitClosePair`。 */
export type ExplicitClosePair =
  | "none"
  | "close-consumed"
  | "close-noop"
  | "clickclose-just-seen";

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
  /** SDK 报告「关闭了」。**无身份**：要按在飞账判定它是结算还是过期回包（见模块注释的归属表）。 */
  | { readonly type: "sdk-close"; readonly generation: number }
  /**
   * 用户点了气泡上的**关闭按钮**（官方 `clickclose`，见 `overlayEventCatalog`：
   * 「点击信息窗口的关闭按钮时触发」）—— 与 `sdk-close` **分开**的动作（外部评审第八轮 P1）。
   *
   * 它带**明确来源**：用户刚刚主动关掉了这个气泡。因此它不能被当成「我们自己那条关闭命令的
   * 过期回包」而只减账 —— 那种处置会让一次真实的用户关闭被在飞账静默吞掉（模型停在「开」）。
   * 语义 = **一次真实的关闭**：模型收敛为关、相位落到 `closed`，
   * 但**保留** `closeOutstanding`（我们下发的关闭命令仍然欠一条回包，迟到时还要被认成结算）。
   */
  | { readonly type: "sdk-clickclose"; readonly generation: number }
  /**
   * 「用户点击关闭按钮」那一组事件的**配对窗口在本 task 结束时关闭**（外部评审第十轮 P1）。
   *
   * 由组件在收到本 task 第一条关闭类事件后 `queueMicrotask` 派发：真实 4.0 实测整组事件
   * （`close` + `clickclose`×N）都在**同一个 task 内**派发完毕，所以微任务跑到时这一组已经收全。
   * 之后残留的配对标记必须作废 —— 否则一条更早的旧回包留下的 `close-consumed` 会被**很多个 task
   * 之后**的一次用户点击误认成「本次点击的伴随 close」，把账还回去、凭空造出一份幽灵
   * `closeOutstanding`，随后一次真实关闭又会被它当成旧命令结算而吞掉。
   *
   * 纯 reducer 不认识时间，所以「过期」必须由调用方显式喂进来（组件层排微任务）；
   * 这样状态机仍然是纯函数，这条规则也能在 reducer 上直接测。
   */
  | { readonly type: "explicit-close-pair-expired"; readonly generation: number }
  /**
   * **命令同步失败**（`openInfoWindow()` / `closeInfoWindow()` 抛错）—— 与 SDK 观测事件分开的动作。
   *
   * 语义是「这条命令已经作废」：不会有回包了，因此要
   * ① 按 `accounted` **精确冲销**它在飞账；② 把过渡相位收敛掉（不停留）。
   */
  | {
      readonly type: "command-failed";
      readonly command: "open" | "close";
      readonly accounted: boolean;
      readonly generation: number;
    }
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
    closeOutstanding: 0,
    openOutstanding: 0,
    positionKey: null,
    invalidNotified: false,
    explicitClosePair: "none",
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
  const step = reduceAction(state, action);
  // `explicitClosePair` 只在「紧邻的下一条关闭类事件」上有意义：任何**别的**动作都把它清掉，
  // 否则一条很久以前的 `close` 会被后来的点击认领（或反过来，一条点击的标记留到下一次关闭）。
  // 这一组实测间隔约 0.1ms（同一 task），正常路径上不会有别的动作插进来。
  //
  // 注意：光靠「别的动作」清理**不够**（外部评审第十轮 P1）—— 时间过去本身不会产生 action。
  // 所以「关闭类动作」里还有一个 `explicit-close-pair-expired`（组件在 task 末尾派发），
  // 它同样在下面这个豁免列表里，由自己的 reducer 负责清理。
  if (
    action.type !== "sdk-close" &&
    action.type !== "sdk-clickclose" &&
    action.type !== "explicit-close-pair-expired" &&
    step.snapshot.explicitClosePair !== "none"
  ) {
    return { ...step, snapshot: { ...step.snapshot, explicitClosePair: "none" } };
  }
  return step;
}

function reduceAction(
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
    case "sdk-clickclose":
      return transition(reduceSdkClickClose(state, action.generation));
    case "explicit-close-pair-expired":
      return transition(reduceExplicitClosePairExpired(state, action.generation));
    case "command-failed":
      return transition(reduceCommandFailed(state, action));
    case "superseded": {
      if (action.generation !== state.generation) return settle(state);
      if (state.phase === "closed") return settle(state);
      // 不下发任何命令：地图上已经是新的那一个，任何 map 级关闭都会打到它头上
      // 刻意**保留** `openOutstanding`：在飞的打开请求仍然会回包，而它回来时模型是「关」——
      // 必须继续被认作「自己的迟到回包」（清零会让它变成「外部打开」而把模型拉开）。
      const closed = changeOpen({ ...state, closeOutstanding: 0 }, false, "sdk");
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
        closeOutstanding: 0,
        openOutstanding: 0,
        positionKey: null,
        invalidNotified: false,
        explicitClosePair: "none",
      });
    case "dispose":
      return settle(enterPhase({ ...state, closeOutstanding: 0, openOutstanding: 0 }, "disposed"));
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
    // 计数只在**气泡确实开着**时增长：`closing` / `opening` 时下发的关闭命令可能被 SDK 吞掉
    // （尚未接管），那种命令不会产生 `close` 回调，计进去会让后续一次真实的关闭被误判成结算。
    const accounted = base.phase === "open";
    const closed = changeOpen(
      { ...base, closeOutstanding: base.closeOutstanding + (accounted ? 1 : 0) },
      false,
      "prop",
    );
    return {
      snapshot: enterPhase(closed.snapshot, "closing"),
      effects: [{ type: "close", generation: state.generation, accounted }],
      changes: closed.changes ?? NONE_CHANGES,
      notices,
    };
  }

  if (base.phase === "open" || base.phase === "opening") {
    // 已经在打开一侧：只有位置**真的变了**才补一条 open（它同时负责「移动」）。
    // 那条请求同样要记账（`openOutstanding`）：它的回包可能晚到关闭完成之后（第三轮 P1）。
    const moved = base.positionKey !== state.positionKey;
    return {
      snapshot: moved
        ? { ...base, openOutstanding: base.openOutstanding + 1 }
        : base,
      effects: moved ? [{ type: "open", generation: state.generation, accounted: true }] : NONE_EFFECTS,
      changes: NONE_CHANGES,
      notices,
    };
  }

  // closed / closing：都要（重新）发起打开。
  // `closeOutstanding` **保持原值**：从 `closing` 重开时，那条关闭命令仍然在飞，它的迟到回包
  // 必须继续被认作「过期」——**直到那条回包真的到达**为止（清掉计数会让它变成「未经请求的关闭」，
  // 见模块注释的归属表）。因此这里的清账只发生在 `sdk-close` 上，不发生在 `sdk-open` 上。
  const reopened = changeOpen(
    { ...base, closeOutstanding: state.closeOutstanding, openOutstanding: base.openOutstanding + 1 },
    true,
    "prop",
  );
  return {
    snapshot: enterPhase(reopened.snapshot, "opening"),
    effects: [{ type: "open", generation: state.generation, accounted: true }],
    changes: reopened.changes ?? NONE_CHANGES,
    notices,
  };
}

function reduceSdkOpen(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);

  // 先还 `open` 侧的账（与 `sdk-close` 先还 close 侧的账对称）：这条回包是不是我们自己要的？
  const ours = state.openOutstanding > 0;
  const base: InfoWindowSnapshot = {
    ...state,
    openOutstanding: ours ? state.openOutstanding - 1 : 0,
  };

  if (state.open) {
    // 期望是开：这就是那次打开（或重开）的确认。
    // 刻意**不**碰 `closeOutstanding`（第一轮 P1）：仍在飞的关闭命令还没回包，
    // 清掉它会让反序到达的旧 `close` 被当成「未经请求的关闭」而误关已经重开的气泡。
    if (base.phase === "open") return settle(base);
    return { snapshot: enterPhase(base, "open") };
  }

  if (ours) {
    // 期望是**关**、而这条 `open` 是我们自己下发的（还有在飞的打开请求）⇒ 我们并不想它开着。
    // 两种情况都落到这里：① 关闭命令被 SDK 吞掉（同 tick 的 open → close，第一轮）；
    // ② 移动请求的回包在关闭完成之后才到（第三轮 P1）。处置都是**重新收敛到关闭** ——
    // 此刻 SDK 确认它是开着的，所以这一条 close 一定会产生回调，计数 +1。
    return {
      snapshot: enterPhase(
        { ...base, closeOutstanding: state.closeOutstanding + 1 },
        "closing",
      ),
      // 「此刻 SDK 确认它是开着的 ⇒ 这条 close 一定会有回包 ⇒ 记一份账」这个前提**不是自足的**：
      // 它依赖 Driver 把这条 close 真的发出去。被顶掉的实例走到这里时，「最后请求打开的气泡」
      // 往往已经不是它，所以 Driver 的守卫必须**先看 `map.getInfoWindow()` 是不是它**、
      // 而不是先按「最后请求者」挡掉 —— 否则命令被静默丢弃，这份账就永远等不到回包
      // （PR #101 第五轮评审 P1；Driver 侧的判据顺序见 `driver/jsapi-v4/overlays.ts`）。
      effects: [{ type: "close", generation: state.generation, accounted: true }],
    };
  }

  // 期望是关、且本组件没有任何打开请求在飞 ⇒ **外部未经请求的打开**：如实回写（既有契约）
  const opened = changeOpen(base, true, "sdk");
  return {
    snapshot: enterPhase(opened.snapshot, "open"),
    changes: opened.changes ?? NONE_CHANGES,
  };
}

/**
 * 命令**同步失败**的收敛（外部评审第四轮 P1）。
 *
 * 与 `reduceSdkClose` 分开是刻意的：`sdk-close` 表示「SDK 观测到关闭」，会消费 close 侧的在飞账；
 * 而失败表示「这条命令作废、不会有回包」—— 它必须按 `accounted` **冲销对应的那本账**，
 * 否则残留计数会把后续一次真实的关闭 / 外部打开归错类。借用 `sdk-close` 表达失败，
 * 既冲不掉 open 侧的账，也会把**还开着**的气泡在模型里关掉（移动请求失败时就是这种情形）。
 */
function reduceCommandFailed(
  state: InfoWindowSnapshot,
  action: Extract<InfoWindowAction, { type: "command-failed" }>,
): Step {
  if (action.generation !== state.generation) return settle(state);
  if (state.phase === "disposed") return settle(state);

  const rollback = action.accounted ? 1 : 0;
  if (action.command === "open") {
    const base: InfoWindowSnapshot = {
      ...state,
      openOutstanding: Math.max(0, state.openOutstanding - rollback),
    };
    // 移动失败（气泡已经开着）不得把模型收敛成关：那是另一次「打开」失败，不是关闭意图
    if (base.phase === "open") return settle(base);
    // 打开失败 ⇒ 收敛到「关」（与状态机的期望状态一致），并回写一次（调用方只给过一次意图）
    const closed = changeOpen(base, false, "sdk");
    return {
      snapshot: enterPhase(closed.snapshot, "closed"),
      changes: closed.changes ?? NONE_CHANGES,
    };
  }

  // 关闭失败：冲销那笔计数 + 收敛掉过渡相位（不留在 `closing` 里等一条永远不会来的回包）
  const closed = changeOpen(
    { ...state, closeOutstanding: Math.max(0, state.closeOutstanding - rollback) },
    false,
    "sdk",
  );
  return {
    snapshot: enterPhase(closed.snapshot, "closed"),
    changes: closed.changes ?? NONE_CHANGES,
  };
}

/**
 * 关闭「用户点击」那一组事件的配对窗口（外部评审第十轮 P1）。
 *
 * 组件在收到本 task 第一条关闭类事件后 `queueMicrotask` 派发它：微任务必然在「本 task 的同步派发
 * 全部结束」之后、下一个 task 之前运行 —— 于是同 task 的伴随事件已经配对完成，而**跨 task** 的
 * 陈旧标记会被清掉（不清的话，一条更早的旧回包留下的 `close-consumed` 会在很多个 task 之后
 * 被一次用户点击误认成它的伴随 close，把账还回去、凭空造出幽灵 `closeOutstanding`）。
 */
function reduceExplicitClosePairExpired(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);
  if (state.explicitClosePair === "none") return settle(state);
  return settle({ ...state, explicitClosePair: "none" });
}

function reduceSdkClose(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);

  // 「用户主动关闭」那一对里的**后半**（前半是 `sdk-clickclose`；真实 4.0 实测两条在同一个 task 里，
  // 但顺序不固定）：它只是那次点击的伴随事件，**不消费任何账**，模型与相位也不动
  // （点击那半已经收敛过了）。见 `InfoWindowSnapshot.explicitClosePair`。
  if (state.explicitClosePair === "clickclose-just-seen") {
    return settle(enterPhase({ ...state, explicitClosePair: "none" }, "closed"));
  }

  // ⚠️ 顺序是硬要求（外部评审 P1）：**先消费在飞计数，再判「已经关着」的幂等**。
  // 计数允许 > 1（相位是 `closing` 时观测到迟到的 `sdk-open` 会补发一条 close，见 `reduceSdkOpen`），
  // 而「相位已经回到 `closed`」不代表「计数已经还清」—— 第二条回包正是在那一刻到达的。
  // 反过来先按 `closed` 早退，残留计数就永远还不清，下一次重开后一条**真实**的关闭会被
  // 当成过期回包吞掉（模型停在「开」），也就是本模块反复强调的「漏关」那一侧。
  if (state.closeOutstanding > 0) {
    // 记下「这一条消费了一份账」：万一它其实是用户点击的伴随事件（紧随一条 `clickclose`），
    // 那一份要由 `reduceSdkClickClose` 还回去。
    const settled: InfoWindowSnapshot = {
      ...state,
      closeOutstanding: state.closeOutstanding - 1,
      explicitClosePair: "close-consumed",
    };
    if (state.open) {
      // 过期回包：模型是「开」只可能来自「重开之后」，而重开之前的关闭命令的回包都是过期的。
      // 只消耗一次计数，相位与模型都不动。
      return settle(settled);
    }
    // 结算我们已下发的关闭命令：期望状态本来就是关，不改模型。
    // 相位已经是 `closed` 时这一步是幂等 no-op（`enterPhase` 会直接返回原快照）。
    return settle(enterPhase(settled, "closed"));
  }

  // 计数为 0 的 `close` 事件：相位已经关了 ⇒ 幂等（不产生任何回写）
  if (state.phase === "closed") {
    return settle({ ...state, explicitClosePair: "close-noop" });
  }

  // 未经请求的关闭（点地图 / 被顶掉）。注意「点关闭按钮」不在这里 —— 那是带来源的
  // `sdk-clickclose`，见 `reduceSdkClickClose`。
  const closed = changeOpen(
    { ...state, closeOutstanding: 0, explicitClosePair: "close-noop" },
    false,
    "sdk",
  );
  return {
    snapshot: enterPhase(closed.snapshot, "closed"),
    changes: closed.changes ?? NONE_CHANGES,
  };
}

/**
 * 用户点了关闭按钮（官方 `clickclose`）—— **带明确来源的真实关闭**（外部评审第八轮 P1）。
 *
 * 与 `reduceSdkClose` 分开是刻意的：`sdk-close` **没有身份**，只能靠在飞账判断它是不是自己的
 * 过期回包；而 `clickclose` 的来源就是「用户主动关掉了当前气泡」，无论账上还挂着多少条未结算的
 * 关闭命令，这一次关闭都是真的。把它塞进归属表，就会出现「用户点了关闭按钮、模型却仍是开」。
 *
 * 刻意**保留** `closeOutstanding`：我们下发的关闭命令仍然欠一条回包，它迟到时必须继续被认成
 * 「结算」而不是「未经请求的关闭」—— 那条回包不该由用户的一次点击来冲销。
 *
 * 它还要负责**给这一对事件结账**（外部评审第九轮 P1）：真实 4.0 实测一次点击会派发
 * `close` + `clickclose` 各一次、**顺序不固定**（见 `explicitClosePair`）。那一对不带我们命令的
 * 身份，因此两半都不该消费 `closeOutstanding`：
 *
 * - 伴随的 `close` **已经先到**并消费了一份 ⇒ 这里**还回去**（`closeOutstanding + 1`）；
 * - 前一条动作不是关闭类事件 ⇒ 打上 `clickclose-just-seen`，让**随后**那条伴随 `close` 不消费。
 */
function reduceSdkClickClose(state: InfoWindowSnapshot, generation: number): Step {
  if (generation !== state.generation) return settle(state);

  const isPairTail = state.explicitClosePair === "close-consumed";
  const restored = isPairTail ? state.closeOutstanding + 1 : state.closeOutstanding;
  // 前一条就是 `sdk-close`（无论它消没消费）⇒ 这一对已经闭合，不再给别人留标记；
  // 只有「前一条不是关闭类事件」时才标记「接下来那条伴随 close 不许消费」。
  //
  // ⚠️ 还要**这次点击确实关掉了东西**（`state.open === true`）才留标记：实测一对可能是
  // `clickclose > close > clickclose`（同一个气泡被打开/重绘多次后 SDK 会重复派发），
  // 末尾那条 `clickclose` 落在「模型已经是关」时若还留标记，就会一直挂到下一次关闭、
  // 让一条**真实的**命令回包被跳过结算 —— 那正是「计数还不清 ⇒ 后续真实关闭被吞」的老毛病。
  const pair: ExplicitClosePair =
    state.explicitClosePair === "none" && state.open ? "clickclose-just-seen" : "none";

  const closed = changeOpen(
    { ...state, closeOutstanding: restored, explicitClosePair: pair },
    false,
    "sdk",
  );
  return {
    snapshot: enterPhase(closed.snapshot, "closed"),
    changes: closed.changes ?? NONE_CHANGES,
  };
}
