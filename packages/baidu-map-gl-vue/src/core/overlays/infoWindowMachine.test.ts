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
    superseded(gen = generation): void {
      send({ type: "superseded", generation: gen });
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
  it("open 命令失败（组件回喂一条 sdk-close）⇒ 相位收敛回 closed，不停留在过渡态", () => {
    const d = drive();
    d.intent(true, A);
    expect(d.phase).toBe("opening");
    // 组件在 `openInfoWindow` 抛错后回喂 sdk-close
    d.sdkClose();
    expect(d.phase).toBe("closed");
    expect(d.open).toBe(false);
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
