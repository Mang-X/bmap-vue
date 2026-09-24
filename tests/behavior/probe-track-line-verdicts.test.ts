/**
 * `scripts/probe-track-line-verdicts.mts` 的三态回归守卫（issue #110）
 *
 * 与 #98 的 `probe-verdicts.test.ts` 同一口径：判定层是纯函数，用**合成报告**驱动，
 * 使「缺失读数 ⇒ 无法判定」可回归验证，不依赖「下次跑探针时肉眼看一眼」。
 *
 * - **空报告** ⇒ 每条结论都必须是第三态（主守卫：新增结论也必须带第三态）；
 * - **逐条点名**缺失 ⇒ 对应那条落第三态（防止整段早退漏掉某条）；
 * - **读数齐备**（正证控件）⇒ 全部结论必须是**确定**结论（否则「永远输出无法判定」也能过）；
 * - **`threw` / `type` / `count` 等字段类型不对** ⇒ 同样算没测到（不得靠 `??` 兜底成安全侧）；
 * - **COMPLETE ↔ live fixture 逐字段一致**：正证保护的必须是真实基线。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  controlFailures,
  verdicts,
  type ProbeReport,
  type Reading,
} from "../../scripts/probe-track-line-verdicts.mts";

function report(readings: Reading[]): ProbeReport {
  return { phase: "done", sdk: null, readings, console: [], error: null };
}

function lineOf(lines: string[], prefix: string): string {
  const found = lines.filter((line) => line.startsWith(prefix));
  expect(found.length, `结论里没有以 ${prefix} 开头的那一行`).toBe(1);
  return found[0]!;
}

function conclusionOf(line: string): string {
  return line.slice(line.lastIndexOf("⇒") + 1).trim();
}

/** 方法面七个方法的 typeof 读数（正控与方法面结论共用）。 */
const METHOD_TYPES: Reading[] = [
  { id: "method.setData.type", type: "function" },
  { id: "method.start.type", type: "function" },
  { id: "method.pause.type", type: "function" },
  { id: "method.resume.type", type: "function" },
  { id: "method.stop.type", type: "function" },
  { id: "method.setSpeed.type", type: "function" },
  { id: "method.setProcess.type", type: "function" },
];

/**
 * 「读数齐备」的合成报告：每次新加一条结论都要同步补读数，否则下面的正证用例会红
 * ——这正是我们想要的「新结论必须被正证覆盖」。
 *
 * 字段值必须与 `tests/behavior/fixtures/probe-track-line.live.json` 一致（文件末尾的
 * 漂移用例做机器检查）——否则「正证」保护的是一条 live 从不发生的分支。
 *
 * live 要点：SDK **不**因 hidden 暂停（progress 继续）；statuschange 偶发但 keys 可取；
 * pause 效果表现为 progress 停住（count=0），不是 statuschange。
 */
const COMPLETE: Reading[] = [
  ...METHOD_TYPES,
  { id: "control.start.attempt", threw: false, message: null },
  { id: "control.progress.baseline", count: 7, firstProcess: 0, lastProcess: 0.005 },
  { id: "event.statuschange.keys", keys: ["status", "statusName"] },
  { id: "event.progress.keys", keys: ["process", "elapsed", "trace", "distance", "point", "angle"] },
  { id: "cmd.pause.attempt", threw: false, message: null },
  { id: "cmd.pause.observed", count: 0, statusCount: 0 },
  { id: "cmd.resume.attempt", threw: false, message: null },
  { id: "cmd.resume.observed", count: 16, statusCount: 0 },
  { id: "cmd.stop.attempt", threw: false, message: null },
  { id: "cmd.stop.observed", count: 1, statusCount: 0 },
  { id: "cmd.setProcess.attempt", threw: false, message: null },
  { id: "cmd.setProcess.observed", count: 1, process: 0.5, statusCount: 0 },
  { id: "cmd.setSpeed.attempt", threw: false, message: null },
  { id: "cmd.setSpeed.observed", count: 1, process: 0.5, statusCount: 0 },
  { id: "vis.method", method: "synthetic" },
  {
    id: "vis.hidden.observed",
    count: 11,
    statusCount: 0,
    firstProcess: 0.2749875999999999,
    lastProcess: 0.3899875999999999,
  },
  {
    id: "vis.shown.observed",
    count: 20,
    statusCount: 0,
    firstProcess: 0.48332759999999997,
    lastProcess: 0.6316476000000001,
  },
  { id: "rm.remove.attempt", threw: false, message: null },
  { id: "rm.after.observed", count: 0, statusCount: 0 },
];

describe("[#110] TrackLine 探针判定层的三态", () => {
  it("空报告 ⇒ 全部结论是「无法判定」（主守卫：新增结论也必须带第三态）", () => {
    const lines = verdicts(report([]));
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(6);
    const determinate = lines
      .map((line) => ({ line, conclusion: conclusionOf(line) }))
      .filter((item) => !item.conclusion.includes("无法判定"))
      .map((item) => item.line);
    expect(
      determinate,
      "读数一条都没有，却被判成了确定结论 —— 缺读数必须落第三态，不得进正/负任一分支",
    ).toEqual([]);
  });

  it("缺 method.start.type ⇒ 方法面那条是第三态，不是「方法缺失」", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "method.start.type"))),
      "[方法面",
    );
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成负结论").not.toContain("**缺失**");
  });

  it("method.start.type 不是 function ⇒ 确定负结论（读到了，是坏的那一侧）", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) => (r.id === "method.start.type" ? { ...r, type: "undefined" } : r)),
        ),
      ),
      "[方法面",
    );
    expect(line).toContain("**缺失**");
    expect(line).not.toContain("无法判定");
  });

  it("缺 event.progress.keys ⇒ 事件载荷那条第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "event.progress.keys"))),
      "[事件载荷",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成「progress 载荷为空」").not.toContain("progress 无字段");
  });

  it("缺 cmd.pause.observed ⇒ 播放命令那条第三态（不是「pause 无效」）", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "cmd.pause.observed"))),
      "[播放命令",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成命令无效").not.toContain("**无效**");
  });

  it("pause.attempt 抛错 ⇒ 播放命令第三态，文案点名是哪一步", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) =>
            r.id === "cmd.pause.attempt" ? { ...r, threw: true, message: "boom" } : r,
          ),
        ),
      ),
      "[播放命令",
    );
    expect(line).toContain("无法判定");
    expect(line).toContain("cmd.pause.attempt");
    expect(line, "实验步骤失败不得读成 SDK 语义").not.toContain("**无效**");
  });

  it("pause 窗口 progress 不停（count>0）且无 statuschange ⇒ 部分可观测", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "cmd.pause.observed" ? { ...r, count: 8, statusCount: 0 } : r,
    );
    const line = lineOf(verdicts(report(readings)), "[播放命令");
    expect(line).toContain("**部分可观测**");
    expect(line).not.toContain("**pause / resume / stop 可观测**");
  });

  it("缺 vis.hidden.observed ⇒ 页面可见性第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "vis.hidden.observed"))),
      "[页面可见性",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成「SDK 没有暂停」").not.toContain("**SDK 自行暂停**");
    expect(line, "也不得读成「progress 继续」").not.toContain("**progress 继续**");
  });

  it("vis：hidden 期间 statusName=paused 且 progress 不动 ⇒ SDK 自行暂停", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "vis.hidden.observed"
        ? {
            ...r,
            statusName: "paused",
            firstProcess: 0.1,
            lastProcess: 0.1,
            statusCount: 1,
          }
        : r,
    );
    const line = lineOf(verdicts(report(readings)), "[页面可见性");
    expect(line).toContain("**SDK 自行暂停**");
  });

  it("vis：hidden 期间 progress 前进（live 基线）⇒ progress 继续", () => {
    const line = lineOf(verdicts(report(COMPLETE)), "[页面可见性");
    expect(line).toContain("**progress 继续**");
    expect(line, "live 明确是继续，不得说 SDK 自行暂停").not.toContain("**SDK 自行暂停**");
  });

  it("vis：hidden 期间 progress 不动但没有 statuschange ⇒ 不确定的暂停信号", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "vis.hidden.observed"
        ? ({ id: r.id, count: 0, firstProcess: 0.1, lastProcess: 0.1 } as Reading)
        : r,
    );
    const line = lineOf(verdicts(report(readings)), "[页面可见性");
    expect(line).toContain("**progress 停止**");
    expect(line, "没有 statuschange 就不能说 SDK「自行暂停」").not.toContain("**SDK 自行暂停**");
  });

  it("缺 rm.after.observed ⇒ removeLayer 那条第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "rm.after.observed"))),
      "[removeLayer",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成「已隐式停止」").not.toContain("**已隐式停止**");
  });

  it("rm：摘除后无事件 ⇒ **已隐式停止**；摘除后仍有 progress ⇒ **仍在推进**", () => {
    const withAfter = (reading: Reading) =>
      report(COMPLETE.map((r) => (r.id === "rm.after.observed" ? reading : r)));

    const stopped = lineOf(
      verdicts(withAfter({ id: "rm.after.observed", count: 0 })),
      "[removeLayer",
    );
    expect(stopped).toContain("**已隐式停止**");

    const still = lineOf(
      verdicts(withAfter({ id: "rm.after.observed", count: 5, process: 0.4 })),
      "[removeLayer",
    );
    expect(still).toContain("**仍在推进**");
    expect(still, "仍在推进时不得说已停止").not.toContain("**已隐式停止**");
  });

  it("读数对象**在**、`threw` 字段**不在** ⇒ 第三态（不得读成「未抛错」）", () => {
    const blank = (id: string): Reading => ({ id });
    const line = lineOf(verdicts(report([blank("cmd.pause.attempt")])), "[播放命令");
    expect(line).toContain("无法判定");
    expect(line, "不得读成「未抛错」").not.toContain("调用未抛错");
  });

  it("`type` 字段类型不对（页面回传数字）同样算没测到 ⇒ 第三态", () => {
    const readings = METHOD_TYPES.map((r) =>
      r.id === "method.start.type" ? ({ id: r.id, type: 1 } as unknown as Reading) : r,
    );
    const line = lineOf(verdicts(report(readings)), "[方法面");
    expect(line).toContain("无法判定");
  });

  it("正证控件：齐备时为空；缺 baseline 或 method 时点名失败", () => {
    expect(controlFailures(report(COMPLETE)), "齐备时控件成立").toEqual([]);

    const noBaseline = controlFailures(
      report(COMPLETE.filter((r) => r.id !== "control.progress.baseline")),
    );
    expect(noBaseline.length).toBeGreaterThan(0);
    expect(noBaseline.join("\n")).toContain("control.progress.baseline");

    const noStart = controlFailures(
      report(COMPLETE.map((r) => (r.id === "method.start.type" ? { ...r, type: "undefined" } : r))),
    );
    expect(noStart.join("\n")).toContain("method.start");

    const weakBaseline = controlFailures(
      report(
        COMPLETE.map((r) =>
          r.id === "control.progress.baseline" ? { ...r, count: 1 } : r,
        ),
      ),
    );
    expect(weakBaseline.join("\n"), "count < 2 = progress 没有前进").toContain("count");
  });

  it("读数齐备 ⇒ 六条结论都是确定结论（正证：否则「永远输出无法判定」也能过）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    expect(lineOf(lines, "[方法面")).toContain("**七个方法齐全**");
    expect(lineOf(lines, "[事件载荷")).toContain("已取到");
    expect(lineOf(lines, "[播放命令")).toContain("**pause / resume / stop 可观测**");
    expect(lineOf(lines, "[setProcess / setSpeed]")).toContain("**可调用**");
    expect(lineOf(lines, "[页面可见性")).toContain("**progress 继续**");
    expect(lineOf(lines, "[removeLayer")).toContain("**已隐式停止**");
  });
});

/* -------------------------------------------------------------------------- */
/* 正证基线 ↔ live 报告：漂移必须在 CI 里被发现，而不是等到评审            */
/* -------------------------------------------------------------------------- */

/**
 * `COMPLETE` 是「读数齐备」的**合成**报告，用来做正证（结论都必须落定）。
 *
 * 它的字段值必须**逐条等于**最近一次成功的 live 报告——否则「正证」保护的是一条 live 从不发生的
 * 分支。fixture 的刷新方式（只在**探针退出码为 0** 时才抄）：
 *
 * ```bash
 * BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-track-line.mts --out=/tmp/live.json
 * # 然后把 phase / sdk / readings 抄进 tests/behavior/fixtures/probe-track-line.live.json
 * ```
 */
describe("[#110] 正证基线（COMPLETE）与 live 报告一致", () => {
  const fixturePath = join(
    process.cwd(),
    "tests/behavior/fixtures/probe-track-line.live.json",
  );
  const live = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    capturedAt: string;
    phase: string;
    readings: Reading[];
  };

  it("fixture 不是空壳（正证守卫：文件被清空 / 搬走时不得静默空转）", () => {
    expect(live.phase, `${fixturePath} 的 phase 不是 done`).toBe("done");
    expect(live.readings.length, `${fixturePath} 里的读数太少`).toBeGreaterThan(20);
  });

  it("`COMPLETE` 的每条读数都与 live 报告逐字段一致", () => {
    const byId = new Map(live.readings.map((reading) => [reading.id, reading]));
    // ⚠️ **只比 COMPLETE 声明过的字段**：判定层对每条读数只读它需要的字段。
    const fields = [
      "type",
      "threw",
      "message",
      "count",
      "statusCount",
      "process",
      "firstProcess",
      "lastProcess",
      "status",
      "statusName",
      "keys",
      "method",
    ] as const;
    const drifted = COMPLETE.flatMap((expected) => {
      const actual = byId.get(expected.id);
      if (actual === undefined) return [`${expected.id}：live 报告里没有这条读数`];
      return fields
        .filter((field) => expected[field] === undefined || actual[field] === undefined)
        .map((field) =>
          expected[field] === undefined
            ? ""
            : actual[field] === undefined
              ? `${expected.id}.${field}：live 缺失`
              : "",
        )
        .filter(Boolean)
        .concat(
          fields.flatMap((field) => {
            if (expected[field] === undefined || actual[field] === undefined) return [];
            const a = expected[field];
            const b = actual[field];
            const equal = Array.isArray(a) && Array.isArray(b)
              ? a.length === b.length && a.every((v, i) => v === b[i])
              : a === b;
            return equal
              ? []
              : [`${expected.id}.${field}：COMPLETE=${JSON.stringify(a)} live=${JSON.stringify(b)}`];
          }),
        );
    });
    expect(
      drifted,
      `COMPLETE 与 live 报告（${live.capturedAt}）漂移了：要么改回 live 的值，要么在重跑探针` +
        `（退出码 0）之后刷新 fixture——正证保护的必须是真实基线`,
    ).toEqual([]);
  });
});
