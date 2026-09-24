/**
 * `scripts/probe-destroy-idempotency-verdicts.mts` 的三态回归守卫（issue #128 / F-3）
 *
 * 与 #98 / #110 / #128-F2 的判定层同口径：判定层是纯函数，用**合成报告**驱动，
 * 使「缺失读数 ⇒ 无法判定」可回归验证。
 *
 * - **空报告** ⇒ 每条结论都必须是第三态（主守卫）；
 * - **逐条点名**缺失 ⇒ 对应那条落第三态；
 * - **读数齐备**（正证控件）⇒ 全部结论必须是**确定**结论；
 * - **`threw` 字段类型不对** ⇒ 同样算没测到；
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
} from "../../scripts/probe-destroy-idempotency-verdicts.mts";

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

/**
 * 「读数齐备」的合成报告。字段值必须与
 * `tests/behavior/fixtures/probe-destroy-idempotency.live.json` 一致。
 *
 * live 要点（2026-09-24 真实 AK + chrome-headless-shell）：
 * - Map first 不抛、**second 抛** `enableAutoResize` ⇒ 重复 destroy 不是 no-op；
 * - Autocomplete **对照组 callbackObserved=1**（不 dispose 时回调能到达）；
 *   first/second dispose 都不抛；dispose 期间/之后回调 count 均为 0（对照组成立 ⇒ 可解释）；
 * - `setId` 调用本身不抛，但 headless 下场景未真正加载（无 `id_changed`/`dataload`），
 *   destroy 仍抛 `START`（与未加载反例同形；first 已抛 ⇒ second 不构成幂等取证）；
 * - Map destroy 事件 count=1。
 */
const COMPLETE: Reading[] = [
  { id: "map.control.destroyOnce", threw: false, message: null },
  { id: "map.destroyEventCount", threw: false, count: 1 },
  { id: "map.destroyTwice", threw: true, message: "Cannot set properties of undefined (setting 'enableAutoResize')" },
  { id: "auto.control.ctrlCreate", threw: false, message: null },
  { id: "auto.control.callbackObserved", threw: false, count: 1 },
  { id: "auto.control.create", threw: false, message: null },
  { id: "auto.control.disposeOnce", threw: false, message: null },
  { id: "auto.callbacksDuringDispose", threw: false, count: 0 },
  { id: "auto.callbacksAfterDispose", threw: false, count: 0 },
  { id: "auto.disposeTwice", threw: false, message: null },
  { id: "pano.loaded.setId", threw: false, message: null },
  { id: "pano.loaded.destroyOnce", threw: true, message: "Cannot read properties of undefined (reading 'START')" },
  { id: "pano.loaded.destroyTwice", threw: true, message: "Cannot read properties of undefined (reading 'START')" },
  { id: "pano.unloaded.destroy", threw: true, message: "Cannot read properties of undefined (reading 'START')" },
];

describe("[#128 F-3] destroy/dispose 幂等探针判定层的三态", () => {
  it("空报告 ⇒ 全部结论是「无法判定」（主守卫）", () => {
    const lines = verdicts(report([]));
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(2);
    const determinate = lines
      .map((line) => ({ line, conclusion: conclusionOf(line) }))
      .filter((item) => !item.conclusion.includes("无法判定"))
      .map((item) => item.line);
    expect(
      determinate,
      "读数一条都没有，却被判成了确定结论 —— 缺读数必须落第三态",
    ).toEqual([]);
  });

  it("缺 map.destroyTwice ⇒ 幂等性那条第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "map.destroyTwice"))),
      "[幂等性",
    );
    expect(line).toContain("无法判定");
  });

  it("map.destroyTwice 不抛（合成改写）⇒ 不落「重复调用抛错」那条负结论", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) =>
            r.id === "map.destroyTwice" ? { ...r, threw: false, message: null } : r,
          ),
        ),
      ),
      "[幂等性",
    );
    // live 基线本身 map.destroyTwice 就抛；本用例只钉「改写成不抛」时结论分支会走开。
    expect(line).not.toContain("**重复调用抛错**（Map/Autocomplete 第二次");
  });

  it("pano.loaded first 抛错、second 不抛 ⇒ second 不构成幂等取证（不得落「有条件幂等」）", () => {
    // 复现评审场景：first 已抛、second 是失败后的重试、Map/Auto second 都不抛、empty 首次抛。
    const readings = COMPLETE.map((r) => {
      if (r.id === "map.destroyTwice") return { ...r, threw: false, message: null };
      if (r.id === "auto.disposeTwice") return { ...r, threw: false, message: null };
      if (r.id === "pano.loaded.destroyOnce") return { ...r, threw: true, message: "START" };
      if (r.id === "pano.loaded.destroyTwice") return { ...r, threw: false, message: null };
      return r;
    });
    const line = lineOf(verdicts(report(readings)), "[幂等性");
    expect(line, "first 已抛错时不得把 second 不抛读成幂等").not.toContain("**有条件幂等**");
    expect(line, "first 已抛错时不得把 second 不抛读成三者均幂等").not.toContain("**三者均幂等**");
    expect(line).toContain("first 已抛错");
    expect(line).toContain("**已加载 Panorama 首次即抛**");
  });

  it("pano.unloaded 不抛（反例消失）⇒ 未加载侧负结论点名", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) =>
            r.id === "pano.unloaded.destroy" ? { ...r, threw: false, message: null } : r,
          ),
        ),
      ),
      "[幂等性",
    );
    expect(line).toContain("**未加载 Panorama 首次不抛**");
  });

  it("缺 map.control.destroyOnce ⇒ 幂等性第三态（控件本身缺失）", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "map.control.destroyOnce"))),
      "[幂等性",
    );
    expect(line).toContain("无法判定");
  });

  it("缺 map.destroyEventCount 与 auto.callbacksDuringDispose/AfterDispose ⇒ 销毁期回调第三态", () => {
    const filtered = COMPLETE.filter(
      (r) =>
        r.id !== "map.destroyEventCount" &&
        r.id !== "auto.callbacksDuringDispose" &&
        r.id !== "auto.callbacksAfterDispose",
    );
    const line = lineOf(verdicts(report(filtered)), "[销毁期回调");
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成 Map「会回调」").not.toContain("**Map destroy 会回调业务**");
    expect(line, "缺读数也不得落成 Map「未见回调」").not.toContain("**Map destroy 未见业务回调**");
  });

  it("对照组缺失/为 0 且 dispose 臂 0/0 ⇒ Autocomplete 第三态（不得借 Map 外推）", () => {
    const noCtrl = COMPLETE.filter((r) => r.id !== "auto.control.callbackObserved");
    const lineNo = lineOf(verdicts(report(noCtrl)), "[销毁期回调");
    expect(lineNo).toContain("Autocomplete：**无法判定**");
    expect(lineNo, "Map 路径仍可确定").toContain("**Map destroy 会回调业务**");
    expect(lineNo).not.toContain("**Autocomplete dispose 窗口内未见回调**");

    const zeroCtrl = COMPLETE.map((r) =>
      r.id === "auto.control.callbackObserved" ? { ...r, count: 0 } : r,
    );
    const lineZero = lineOf(verdicts(report(zeroCtrl)), "[销毁期回调");
    expect(lineZero).toContain("Autocomplete：**无法判定**");
    expect(lineZero).not.toContain("**Autocomplete dispose 窗口内未见回调**");
  });

  it("对照组成立 + dispose 臂任一 count>=1 ⇒ Autocomplete dispose 会回调业务", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "auto.callbacksDuringDispose" ? { ...r, count: 1 } : r,
    );
    const line = lineOf(verdicts(report(readings)), "[销毁期回调");
    expect(line).toContain("**Autocomplete dispose 会回调业务**");
    expect(line).toContain("**Map destroy 会回调业务**");
  });

  it("map.destroyEventCount=1 + 对照组=1 + dispose 0/0（live 基线）⇒ 分路径确定结论", () => {
    const line = lineOf(verdicts(report(COMPLETE)), "[销毁期回调");
    expect(line).toContain("**Map destroy 会回调业务**");
    expect(line).toContain("**Autocomplete dispose 窗口内未见回调**");
    expect(line).not.toContain("无法判定");
  });

  it("读数对象**在**、`threw` 字段**不在** ⇒ 第三态（不得读成「未抛错」）", () => {
    const line = lineOf(
      verdicts(report([{ id: "map.destroyTwice" } as Reading])),
      "[幂等性",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成第二次未抛错").not.toMatch(/second=未抛错/);
  });

  it("`threw` 字段类型不对（页面回传字符串）同样算没测到 ⇒ 第三态", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "map.destroyTwice" ? ({ id: r.id, threw: "false" } as unknown as Reading) : r,
    );
    const line = lineOf(verdicts(report(readings)), "[幂等性");
    expect(line).toContain("无法判定");
  });

  it("正证控件：齐备时为空；Map/Autocomplete first 失败或对照组缺失时点名", () => {
    expect(controlFailures(report(COMPLETE)), "齐备时控件成立").toEqual([]);

    const mapFail = controlFailures(
      report(
        COMPLETE.map((r) =>
          r.id === "map.control.destroyOnce" ? { ...r, threw: true, message: "x" } : r,
        ),
      ),
    );
    expect(mapFail.join("\n")).toContain("map.control.destroyOnce");

    const autoFail = controlFailures(
      report(
        COMPLETE.map((r) =>
          r.id === "auto.control.disposeOnce" ? { ...r, threw: true, message: "x" } : r,
        ),
      ),
    );
    expect(autoFail.join("\n")).toContain("auto.control.disposeOnce");

    const noMap = controlFailures(
      report(COMPLETE.filter((r) => r.id !== "map.control.destroyOnce")),
    );
    expect(noMap.join("\n")).toContain("map.control.destroyOnce");

    // 对照组 count=0 ⇒ 控件失败（0/0 不能当「dispose 挡住了」的证据）
    const noCtrl = controlFailures(
      report(
        COMPLETE.map((r) =>
          r.id === "auto.control.callbackObserved" ? { ...r, count: 0 } : r,
        ),
      ),
    );
    expect(noCtrl.join("\n")).toContain("auto.control.callbackObserved");

    const ctrlMissing = controlFailures(
      report(COMPLETE.filter((r) => r.id !== "auto.control.callbackObserved")),
    );
    expect(ctrlMissing.join("\n")).toContain("auto.control.callbackObserved");
  });

  it("读数齐备 ⇒ 两条结论都是确定结论（正证）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    // live（2026-09-24）：Map 第二次 destroy 抛 ⇒ 重复调用抛错；
    // 销毁期回调分路径：Map 会回调；Autocomplete 对照组成立 + 0/0 ⇒ 窗口内未见回调。
    expect(lineOf(lines, "[幂等性")).toContain("**重复调用抛错**");
    expect(lineOf(lines, "[幂等性")).toContain("first 已抛错 ⇒ second 不构成幂等取证");
    expect(lineOf(lines, "[销毁期回调")).toContain("**Map destroy 会回调业务**");
    expect(lineOf(lines, "[销毁期回调")).toContain("**Autocomplete dispose 窗口内未见回调**");
  });
});

/* -------------------------------------------------------------------------- */
/* 正证基线 ↔ live 报告：漂移必须在 CI 里被发现                                */
/* -------------------------------------------------------------------------- */

describe("[#128 F-3] 正证基线（COMPLETE）与 live 报告一致", () => {
  const fixturePath = join(
    process.cwd(),
    "tests/behavior/fixtures/probe-destroy-idempotency.live.json",
  );
  const live = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    capturedAt: string;
    phase: string;
    readings: Reading[];
  };

  it("fixture 不是空壳（正证守卫：文件被清空 / 搬走时不得静默空转）", () => {
    expect(live.phase, `${fixturePath} 的 phase 不是 done`).toBe("done");
    expect(live.readings.length, `${fixturePath} 里的读数太少`).toBeGreaterThan(8);
  });

  it("`COMPLETE` 的每条读数都与 live 报告逐字段一致", () => {
    const byId = new Map(live.readings.map((reading) => [reading.id, reading]));
    const fields = ["type", "threw", "message", "count", "ready", "same"] as const;
    const drifted = COMPLETE.flatMap((expected) => {
      const actual = byId.get(expected.id);
      if (actual === undefined) return [`${expected.id}：live 报告里没有这条读数`];
      return fields.flatMap((field) => {
        if (expected[field] === undefined || actual[field] === undefined) return [];
        const a = expected[field];
        const b = actual[field];
        const equal = Array.isArray(a) && Array.isArray(b)
          ? a.length === b.length && a.every((v, i) => v === b[i])
          : a === b;
        return equal
          ? []
          : [`${expected.id}.${field}：COMPLETE=${JSON.stringify(a)} live=${JSON.stringify(b)}`];
      }).concat(
        fields
          .filter((field) => expected[field] !== undefined && actual[field] === undefined)
          .map((field) => `${expected.id}.${field}：live 缺失`),
      );
    });
    expect(
      drifted,
      `COMPLETE 与 live 报告（${live.capturedAt}）漂移了：要么改回 live 的值，要么在重跑探针` +
        `（退出码 0）之后刷新 fixture——正证保护的必须是真实基线`,
    ).toEqual([]);
  });
});
