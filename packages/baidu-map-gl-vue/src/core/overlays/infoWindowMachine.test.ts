/**
 * InfoWindow 状态机：竞态、归属与迟到回包（M5-INFOWINDOW / issue #32）
 *
 * 这一组用例是**纯函数**级的：不挂组件、不碰 DOM、不碰 SDK。它锁的是验收里那几条描述竞态的
 * 条目 —— 「prop / SDK / map-click 的竞态无重复开关回环」「迟到 callback 不改变状态」
 * 「关 → 立刻重开时旧回包不得关掉新状态」。这些语义一旦落进组件测试就很难构造（要同时控制
 * SDK 事件的到达顺序与 props 的时序），而在 reducer 上可以直接把时序写成一行。
 *
 * 读数的写法刻意是**命令序列 + 模型变化**两条：前者证明「没有重复下发」，后者证明「回写正确」。
 */
import { describe, expect, it } from "vitest";
import {
  initialInfoWindowSnapshot,
  positionKeyOf,
  reduceInfoWindow,
  type InfoWindowAction,
  type InfoWindowChange,
  type InfoWindowSnapshot,
} from "./infoWindowMachine";

/** 位置 A / B（值只需可区分；`null` = 没有可用位置）。 */
const A = "116.4,39.9";
const B = "121.5,31.2";
const NO_POSITION = null;

/** 一个可累加读数的驱动器：把 reducer 的命令与回写记下来，便于逐条断言顺序。 */
function drive(generation = 1) {
  let state: InfoWindowSnapshot = initialInfoWindowSnapshot(generation);
  const commands: string[] = [];
  const changes: InfoWindowChange[] = [];
  const notices: string[] = [];

  const send = (action: InfoWindowAction): void => {
    const result = reduceInfoWindow(state, action);
    state = result.snapshot;
    for (const effect of result.effects) {
      commands.push(`${effect.type}@${effect.generation}`);
    }
    for (const change of result.changes) changes.push(change);
    for (const notice of result.notices) notices.push(notice);
  };

  return {
    send,
    /** 当前模型（`v-model:open` 的值）。 */
    get open() {
      return state.open;
    },
    get phase() {
      return state.phase;
    },
    get snapshot() {
      return state;
    },
    get commands() {
      return commands;
    },
    get changes() {
      return changes;
    },
    get notices() {
      return notices;
    },
    intent(wantOpen: boolean, positionKey: string | null = A): void {
      send({ type: "intent", wantOpen, canOpen: positionKey !== null, positionKey });
    },
    sdkOpen(gen = generation): void {
      send({ type: "sdk-open", generation: gen });
    },
    sdkClose(gen = generation): void {
      send({ type: "sdk-close", generation: gen });
    },
    /** 用户点了气泡上的关闭按钮（官方 `clickclose`，带明确来源）。 */
    sdkClickClose(gen = generation): void {
      send({ type: "sdk-clickclose", generation: gen });
    },
    /**
     * 「用户点击」那一组事件的配对窗口在本 task 结束时关闭（组件层排微任务派发，见 reducer 注释）。
     * 纯 reducer 不认识时间，所以用例显式驱动它来模拟「跨过若干个 task」。
     */
    expireClosePair(gen = generation): void {
      send({ type: "explicit-close-pair-expired", generation: gen });
    },
    superseded(gen = generation): void {
      send({ type: "superseded", generation: gen });
    },
    /** 命令同步失败（`openInfoWindow` / `closeInfoWindow` 抛错时组件回喂的动作）。 */
    commandFailed(command: "open" | "close", accounted = true): void {
      send({ type: "command-failed", command, accounted, generation });
    },
    rebuild(next: number): void {
      send({ type: "rebuild", generation: next });
    },
    dispose(): void {
      send({ type: "dispose" });
    },
  };
}

describe("位置指纹", () => {
  it("非法 / 缺失坐标与合法坐标区分开（`null` = 没有可用的位置）", () => {
    expect(positionKeyOf(undefined)).toBeNull();
    expect(positionKeyOf(null)).toBeNull();
    expect(positionKeyOf({ lng: Number.NaN, lat: 39.9 })).toBeNull();
    expect(positionKeyOf({ lng: 116.4, lat: 39.9 })).toBe("116.4,39.9");
  });
});

describe("打开 / 关闭只有一个同步路径（无重复开关回环）", () => {
  it("intent(true) 只下发一条 open；重复喂同样的意图不再下发", () => {
    const d = drive();
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1"]);
    expect(d.phase).toBe("opening");
    // 同一个意图被重复喂（父级重渲染 / 位置 watcher 与 open watcher 同时触发）
    d.intent(true, A);
    d.intent(true, A);
    expect(d.commands, "重复意图不得产生第二条命令").toEqual(["open@1"]);
  });

  it("SDK 确认打开后，再喂一次同样的意图也不下发（回环抑制）", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    expect(d.phase).toBe("open");
    expect(d.commands).toEqual(["open@1"]);
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1"]);
    // 模型只在真的变化时回写：prop 驱动的打开不回写 `update:open`（受控语义）
    expect(d.changes).toEqual([{ open: true, source: "prop" }]);
  });

  it("已打开时位置变化 ⇒ 一条 open（移动），且不产生第二条 open 事件", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(true, B);
    expect(d.commands).toEqual(["open@1", "open@1"]);
    expect(d.changes, "移动不改模型 ⇒ 不产生 open/close 事件").toEqual([
      { open: true, source: "prop" },
    ]);
    d.sdkOpen();
    expect(d.phase).toBe("open");
  });

  it("intent(false) 关闭：一条 close，模型收敛为关且不回写（父级已经知道）", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(false, A);
    expect(d.commands).toEqual(["open@1", "close@1"]);
    expect(d.phase).toBe("closing");
    expect(d.changes).toEqual([
      { open: true, source: "prop" },
      { open: false, source: "prop" },
    ]);
    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.changes, "相位回 closed，模型已经收敛在关 ⇒ 不多发一条回写").toHaveLength(2);
  });
});

describe("归属：close 事件有没有身份信息（`closePending` 表）", () => {
  it("点地图关闭（未经请求）⇒ 模型收敛为关并回写 `update:open`", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);
    expect(d.changes).toEqual([
      { open: true, source: "prop" },
      { open: false, source: "sdk" },
    ]);
    expect(d.commands, "未经请求的关闭不得再下发命令").toEqual(["open@1"]);
  });

  it("关 → 立刻重开 → 迟到的 close 不得关掉已经重开的状态", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    // 关：命令已下发，但 SDK 的 close 回包还没到
    d.intent(false, A);
    expect(d.commands).toEqual(["open@1", "close@1"]);
    // 立刻重开（父级马上又把 open 打开）
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1", "close@1", "open@1"]);
    expect(d.phase).toBe("opening");
    // 迟到的 close 到达：它结算的是上面那条 close 命令，不是当前期望
    d.sdkClose();
    expect(d.phase, "相位必须保持在「打开一侧」").toBe("opening");
    expect(d.open, "模型不得被旧回包改回关闭").toBe(true);
    expect(d.changes.at(-1)).toEqual({ open: true, source: "prop" });
    // 之后 SDK 的重开确认照常生效
    d.sdkOpen();
    expect(d.phase).toBe("open");
  });

  it("同一 tick 的 open → close 会把关闭命令吞掉：观测到 open 后要再下发一次 close", () => {
    const d = drive();
    d.intent(true, A);
    // 此时 SDK 还没真正接管气泡（真机实测同一 tick `getInfoWindow()` 仍是 null）
    d.intent(false, A);
    expect(d.commands).toEqual(["open@1", "close@1"]);
    // SDK 迟一步真的打开了 ⇒ 必须再关一次，否则「点了关闭，气泡却留在地图上」
    d.sdkOpen();
    expect(d.commands).toEqual(["open@1", "close@1", "close@1"]);
    expect(d.open).toBe(false);
    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);

    // ★ 关键的后半段：被吞掉的那条关闭命令**不会**产生回调，因此它**不能**计入在飞条数 ——
    // 否则计数永远还不清，下面这次真实的关闭会被误判成「结算」而静默丢掉。
    d.intent(true, A);
    d.sdkOpen();
    expect(d.phase).toBe("open");
    d.sdkClose();
    expect(d.open, "被吞掉的命令不得把计数留在账上（否则真实关闭会丢）").toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
  });

  it("重开确认先到、旧 close 后到：不得把已经重开的模型关掉（反序回包）", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    // 关：下发 close 命令（它的回包晚到）
    d.intent(false, A);
    // 立刻重开
    d.intent(true, A);
    // ★ 反序：**重开的确认先到**
    d.sdkOpen();
    expect(d.phase).toBe("open");
    // ★ 然后前一次 close 的迟到回包才到
    d.sdkClose();

    expect(d.open, "模型必须仍然是打开：这条 close 是重开之前那次关闭的回包").toBe(true);
    expect(d.phase, "相位不得被旧回包拉回 closed").toBe("open");
    expect(d.changes.at(-1)).toEqual({ open: true, source: "prop" });
    expect(d.commands, "旧回包不得触发任何新命令").toEqual(["open@1", "close@1", "open@1"]);

    // 对照组：随后一次**真实的**未经请求关闭（点地图）仍必须被收敛
    d.sdkClose();
    expect(d.open, "真实的关闭不能被误判成过期回包").toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
  });

  it("clickclose（用户点关闭按钮）带明确来源：有在飞关闭账时也必须真的关上", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    // 关：下发 close 命令（closeOutstanding = 1），它的回包还没到
    d.intent(false, A);
    // 立刻重开，并且重开的确认先到
    d.intent(true, A);
    d.sdkOpen();
    expect(d.open).toBe(true);
    expect(d.snapshot.closeOutstanding, "对照组：那笔关闭账还挂着").toBe(1);

    // ★ 用户点了关闭按钮。它和「无身份的 close 回包」不是一回事：
    //   来源是用户主动关闭 ⇒ 不能被那笔在飞账吞掉。
    d.sdkClickClose();

    expect(d.open, "用户主动关闭必须生效").toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
    expect(d.snapshot.closeOutstanding, "那笔账**不得**被用户的一次点击冲销").toBe(1);

    // 父级随后再次重开（并确认）：那笔账仍然挂着 —— 这正是它不能被冲销的原因
    d.intent(true, A);
    d.sdkOpen();
    expect(d.open).toBe(true);
    expect(d.snapshot.closeOutstanding).toBe(1);

    // 对照组：那条旧命令的回包终于到了 —— 它必须仍被认成「结算」，
    // 而不是「未经请求的关闭」（否则会把刚重开的模型关掉）
    const changesBefore = d.changes.length;
    d.sdkClose();
    expect(d.open, "陈旧回包不得把刚重开的模型关掉").toBe(true);
    expect(d.snapshot.closeOutstanding).toBe(0);
    expect(d.changes, "陈旧回包不得再产生模型变化").toHaveLength(changesBefore);
  });

  it("clickclose 伴随的那条普通 close 不得吞掉命令账（真实 4.0 的三种形状都要对）", () => {
    // 真实 4.0 实测（真实 AK · headless Chromium）：
    //   - 全新实例只打开过一次 ⇒ `close` + `clickclose` 各一次，顺序不固定；
    //   - 同一个实例被打开过 N 次 ⇒ `close` **仍恰好一次**，但 `clickclose` 有 N 条
    //     （1/2/3 次打开 ⇒ 1/2/3 条），因为 SDK 每次打开/重绘都会重新绑定关闭按钮的处理器。
    // 不变量（与形状无关）：这一对**不带我们命令的身份** ⇒ 不得消费 `closeOutstanding`。
    const shapes: Array<{ tag: string; events: string[] }> = [
      { tag: "1 次打开 · close 在前", events: ["close", "clickclose"] },
      { tag: "1 次打开 · clickclose 在前", events: ["clickclose", "close"] },
      { tag: "2 次打开", events: ["clickclose", "close", "clickclose"] },
      { tag: "3 次打开", events: ["clickclose", "close", "clickclose", "clickclose"] },
    ];

    for (const { tag, events } of shapes) {
      const d = drive();
      d.intent(true, A);
      d.sdkOpen();
      // 关：下发 close 命令（closeOutstanding = 1），它的回包还没到
      d.intent(false, A);
      // 立刻重开，并且重开的确认先到
      d.intent(true, A);
      d.sdkOpen();
      expect(d.open).toBe(true);
      expect(d.snapshot.closeOutstanding, `${tag}：对照组，那笔账挂着`).toBe(1);

      // ★ 用户点了关闭按钮 —— 按实测形状派发
      for (const name of events) {
        if (name === "close") d.sdkClose();
        else d.sdkClickClose();
      }

      expect(d.open, `${tag}：用户主动关闭必须生效`).toBe(false);
      expect(d.phase).toBe("closed");
      expect(
        d.snapshot.closeOutstanding,
        `${tag}：这一对不带命令身份 ⇒ 不得消费我们那条在飞命令的账`,
      ).toBe(1);

      // 父级再次重开并确认：那笔账仍然挂着（它要留给真正迟到的那条回包）
      d.intent(true, A);
      d.sdkOpen();
      expect(d.open).toBe(true);
      expect(d.snapshot.closeOutstanding, `${tag}：账仍在`).toBe(1);

      // 对照组：我们那条关闭命令的回包这时才到 —— 必须仍被认成「结算」，
      // 而不是「未经请求的关闭」（后者会把刚重开的模型关掉）
      const changesBefore = d.changes.length;
      d.sdkClose();
      expect(d.open, `${tag}：陈旧回包不得把刚重开的模型关掉`).toBe(true);
      expect(d.snapshot.closeOutstanding, `${tag}：结算后账归零`).toBe(0);
      expect(d.changes, `${tag}：陈旧回包不得再产生模型变化`).toHaveLength(changesBefore);
    }
  });

  it("配对窗口随 task 结束关闭：更早那条旧回包留的标记不得与后来的一次点击配对（第十轮 P1）", () => {
    // 纯 reducer 不认识时间 ⇒ 用 `expireClosePair()` 显式表示「跨过了若干个 task」。
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(false, A); // closeOutstanding = 1
    d.intent(true, A);
    d.sdkOpen();
    expect(d.open).toBe(true);
    expect(d.snapshot.closeOutstanding).toBe(1);

    // 1) **真正那条旧命令的回包**到了：消费掉那笔账，模型仍是开，并留下 close-consumed
    d.sdkClose();
    expect(d.snapshot.closeOutstanding, "对照组：旧回包结算掉了那笔账").toBe(0);
    expect(d.snapshot.explicitClosePair, "对照组：留下了配对标记").toBe("close-consumed");

    // 2) ★ 跨过若干个 task（没有任何别的 action）⇒ 配对窗口必须关闭
    d.expireClosePair();
    expect(d.snapshot.explicitClosePair, "task 结束 ⇒ 标记作废").toBe("none");

    // 3) 用户这时才点关闭按钮（实测形状：clickclose → close → clickclose）
    d.sdkClickClose();
    d.sdkClose();
    d.sdkClickClose();

    expect(d.open, "用户主动关闭仍要生效").toBe(false);
    expect(
      d.snapshot.closeOutstanding,
      "陈旧的 close-consumed 不得被这次点击认领 —— 否则会凭空多出一份幽灵账",
    ).toBe(0);
  });

  it("clickclose 的配对标记不得留到下一次关闭（它只在紧邻的下一条关闭类事件上有意义）", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(false, A); // 关闭命令下发 ⇒ closeOutstanding = 1，回包还没到

    // 用户点关闭按钮：此时前一条动作**不是**关闭类事件 ⇒ 会打上
    // 「随后那条伴随 close 不许消费」的标记（因为那一对还有一半可能没到）
    d.sdkClickClose();
    expect(d.open).toBe(false);
    expect(d.snapshot.closeOutstanding, "对照组：命令账还挂着").toBe(1);

    // 中间插入了别的动作（父级重开 + SDK 确认）⇒ 那条标记必须已经失效
    d.intent(true, A);
    d.sdkOpen();
    expect(d.open).toBe(true);

    // 对照组：真正迟到的命令回包这时才到 —— 必须照常被认成「结算」并消费掉那笔账；
    // 若那条陈旧标记留着，这次消费会被跳过 ⇒ 计数永远还不清（后续真实关闭会被吞）
    d.sdkClose();
    expect(d.snapshot.closeOutstanding, "陈旧标记不得让这次结算被跳过").toBe(0);
    expect(d.open, "陈旧回包不得把刚重开的模型关掉").toBe(true);
  });

  it("多条关闭命令在飞：每一条回包都必须清账，否则重开后的真实关闭会被吞掉", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    // 位置变化 ⇒ 再下发一条 open（移动），SDK 稍后会为它补一条 `open`
    d.intent(true, B);
    // 关：此时气泡确实开着 ⇒ 这条命令会产生回调（closeOutstanding = 1）
    d.intent(false, B);
    // ★ 移动那次打开的回包迟到到达：相位是 closing ⇒ 补发一条 close，计数到 2
    //    （两条 close 命令都打在一个确实开着的气泡上，因此**都会**有回调）
    d.sdkOpen();
    expect(d.commands).toEqual(["open@1", "open@1", "close@1", "close@1"]);

    d.sdkClose();
    expect(d.phase, "第一条回包：结算 ⇒ 相位关闭").toBe("closed");
    // ★ 第二条回包必须在**相位已经 closed** 时也能被消费掉（否则残留计数）
    d.sdkClose();

    // 重开，然后来一次**真实的**未经请求关闭：它必须被收敛，而不是被残留计数当成过期回包
    d.intent(true, A);
    d.sdkOpen();
    expect(d.phase).toBe("open");
    d.sdkClose();
    expect(d.open, "残留计数不得把真实关闭吞掉").toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
  });

  it("迟到的**内部** open（关闭已完成之后才到）：不得把模型重新拉开", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    // 位置变化 ⇒ 再下发一条 open（移动）：这条请求的回包会晚到
    d.intent(true, B);
    // 关：气泡确实开着 ⇒ 关闭命令计数 1
    d.intent(false, B);
    d.sdkClose();
    expect(d.phase, "关闭已经结算").toBe("closed");
    expect(d.open).toBe(false);

    // ★ 移动那条 open 的回包这时才到 —— 它是**本组件自己下发**的，不是外部打开
    d.sdkOpen();
    expect(d.open, "父级刚明确关闭，模型不得被旧请求的回包拉开").toBe(false);
    expect(d.phase, "应当重新收敛到关闭").toBe("closing");
    expect(d.commands, "要再补一条 close").toEqual(["open@1", "open@1", "close@1", "close@1"]);

    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);
  });

  it("外部未经请求的 open（没有本组件的请求在飞）：仍须回写 update:open true", () => {
    const d = drive();
    d.intent(false, A); // 期望关闭，且没有任何打开请求在飞
    d.sdkOpen();
    expect(d.open, "外部打开仍然要如实回写").toBe(true);
    expect(d.phase).toBe("open");
    expect(d.changes.at(-1)).toEqual({ open: true, source: "sdk" });
    expect(d.commands, "外部打开不得触发关闭命令").toEqual([]);
  });

  it("被顶掉（superseded）：不下发任何命令，只收敛自己的模型", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.superseded();
    expect(d.commands, "被顶掉的一方绝不能碰 map 级关闭（那会关掉新气泡）").toEqual(["open@1"]);
    expect(d.open).toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
    // 之后再收到该实例的迟到 close 也不产生第二条回写
    d.sdkClose();
    expect(d.changes).toHaveLength(2);
  });

  it("已经处于 closed 时 superseded 是 no-op（不产生多余的 close 事件）", () => {
    const d = drive();
    d.superseded();
    expect(d.changes).toEqual([]);
    expect(d.commands).toEqual([]);
  });
});

describe("迟到回调按代次丢弃", () => {
  it("旧代次的 open / close / superseded 一律不生效", () => {
    const d = drive(1);
    d.intent(true, A);
    d.sdkOpen();
    // 重建：新代次从 closed 起步
    d.rebuild(2);
    expect(d.phase).toBe("closed");
    expect(d.open, "重建对外是原子的：模型不因重建而翻转").toBe(true);
    expect(d.changes, "重建不产生 open/close 事件").toHaveLength(1);

    const before = { commands: [...d.commands], changes: d.changes.length };
    d.sdkClose(1);
    d.sdkOpen(1);
    d.superseded(1);
    expect(d.commands).toEqual(before.commands);
    expect(d.changes).toHaveLength(before.changes);
    expect(d.phase).toBe("closed");
  });

  it("重建后按新代次重新打开", () => {
    const d = drive(1);
    d.intent(true, A);
    d.sdkOpen();
    d.rebuild(2);
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1", "open@2"]);
    d.sdkOpen(2);
    expect(d.phase).toBe("open");
    // 旧代次的迟到 close 不影响新代次
    d.sdkClose(1);
    expect(d.phase).toBe("open");
    expect(d.open).toBe(true);
  });
});

describe("缺少位置：只报一次错", () => {
  it("想开但缺位置 ⇒ 报一次，位置到位后开、不再重复报", () => {
    const d = drive();
    d.intent(true, NO_POSITION);
    expect(d.notices).toEqual(["missing-position"]);
    expect(d.commands).toEqual([]);
    expect(d.phase).toBe("closed");
    d.intent(true, NO_POSITION);
    expect(d.notices, "同一个「缺位置」episode 只报一次").toEqual(["missing-position"]);
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1"]);
    expect(d.notices).toHaveLength(1);
  });

  it("已打开后位置变回缺失 ⇒ 关掉 + 报一次错（进入新的 invalid episode）", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(true, NO_POSITION);
    expect(d.commands).toEqual(["open@1", "close@1"]);
    expect(d.notices).toEqual(["missing-position"]);
    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);
  });
});

describe("失败收敛与终态", () => {
  it("open 命令同步失败 ⇒ 冲销那笔在飞请求，且后续（外部）打开仍走正常路径", () => {
    const d = drive();
    d.intent(true, A); // openOutstanding = 1
    expect(d.phase).toBe("opening");
    expect(d.snapshot.openOutstanding).toBe(1);
    // 组件在 `openInfoWindow` 抛错后回喂失败（**不是**伪造 sdk-close）
    d.commandFailed("open");
    expect(d.phase, "不停留在过渡态").toBe("closed");
    expect(d.open).toBe(false);
    expect(d.snapshot.openOutstanding, "幽灵请求必须被冲销").toBe(0);
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });

    // ★ 账冲干净之后，一次**外部**打开必须走既有契约（回写），而不是被当成自己的迟到回包
    d.sdkOpen();
    expect(d.open).toBe(true);
    expect(d.phase).toBe("open");
    expect(d.changes.at(-1)).toEqual({ open: true, source: "sdk" });
    expect(d.commands, "外部打开不得触发关闭命令").toEqual(["open@1"]);

    // 而父级自己重试也必须照常工作（不残留任何旧账）
    d.intent(false, A);
    d.sdkClose();
    d.intent(true, A);
    expect(d.commands).toEqual(["open@1", "close@1", "open@1"]);
    d.sdkOpen();
    expect(d.phase).toBe("open");
    expect(d.open).toBe(true);
  });

  it("移动的 open 同步失败 ⇒ 不得把还开着的气泡在模型里关掉", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen(); // 气泡确实开着
    d.intent(true, B); // 位置变化 ⇒ 再下发一条 open（移动）
    expect(d.snapshot.openOutstanding).toBe(1);
    d.commandFailed("open");
    expect(d.open, "移动失败不代表关闭意图").toBe(true);
    expect(d.phase).toBe("open");
    expect(d.snapshot.openOutstanding).toBe(0);
  });

  it("close 命令同步失败 ⇒ 冲销那笔计数，后续真实关闭不被残账吞掉", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.intent(false, A); // 气泡开着 ⇒ closeOutstanding = 1
    expect(d.snapshot.closeOutstanding).toBe(1);
    d.commandFailed("close");
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);
    expect(d.snapshot.closeOutstanding, "失败的关闭命令必须被冲销").toBe(0);

    // 重开之后一次**真实**的关闭必须被收敛（不是被残账当成结算）
    d.intent(true, A);
    d.sdkOpen();
    d.sdkClose();
    expect(d.open).toBe(false);
    expect(d.phase).toBe("closed");
    expect(d.changes.at(-1)).toEqual({ open: false, source: "sdk" });
  });

  it("dispose 之后一切输入都不产生命令与回写", () => {
    const d = drive();
    d.intent(true, A);
    d.sdkOpen();
    d.dispose();
    const commands = [...d.commands];
    const changes = d.changes.length;
    d.intent(false, A);
    d.intent(true, B);
    d.sdkClose();
    d.sdkOpen();
    d.superseded();
    expect(d.commands).toEqual(commands);
    expect(d.changes).toHaveLength(changes);
    expect(d.phase).toBe("disposed");
  });
});
