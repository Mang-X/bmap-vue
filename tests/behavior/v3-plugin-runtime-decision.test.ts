/**
 * `probe-plugin-runtime` 判定函数的桩测试（评审 #85 第二、三轮）
 *
 * 两轮各自暴露了一个「假绿」形态，这里都用纯数据钉住：
 *
 * - **第二轮**：汇总时把 `result === null` 的 run 过滤掉、`sdkLoaded` 只看 `runs[0]`
 *   ⇒「某个插件的页面没跑起来」被读成「没有异常」⇒ `0`。
 * - **第三轮**：成功条件太宽 —— 只要不是 `THREW` 就可能 `0`，而页面存在多种「没执行到最小路径但不抛错」
 *   的返回（构造器不是 function、`mapvgl.View` 不是 function……）。现在页面统一产出结构化
 *   `status`（`verified` / `threw` / `inconclusive`），**只有 `verified` 才算跑通最小路径**。
 *
 * 每条负例都先断言**健康基线是 `0`**，再改一个字段断言期望码 —— 否则「判定恒返回某个码」也能过。
 */
import { describe, it, expect } from "vitest";
import {
  decidePluginRuntimeExitCode,
  expectedPluginIds,
  formatPluginRuntimeSummary,
  PLUGIN_SPECS,
  PLUGIN_PROBE_STATUSES,
  readProbeStatus,
  type PluginProbeOutcome,
  type PluginRuntimeExpectation,
  type PluginRuntimeRun,
} from "../../scripts/plugin-runtime-report.mts";
import { PLUGIN_COMPAT_INVENTORY } from "../../packages/baidu-map-gl-vue/src/plugins/compat-inventory";

/** 一条「跑通最小路径」的结构化小结。 */
function verifiedOutcome(): PluginProbeOutcome {
  return {
    status: "verified",
    detail: { ok: true },
    checks: [{ name: "invariant", ok: true }],
  };
}

/** 一份「四个插件都跑通」的健康报告（Mapvgl 也按 verified 造，便于单独测各条分支）。 */
function healthyRuns(): PluginRuntimeRun[] {
  return PLUGIN_SPECS.map((spec) => ({
    only: spec.id,
    env: {
      sdkLoaded: true,
      aliasIsSameObject: true,
      bmapVersion: "gl",
      globalExistedBeforeLoad: false,
      mapCreated: true,
    },
    result: { id: spec.id, urlLoaded: "ok", globalExposed: true, probe: verifiedOutcome() },
    done: true,
  }));
}

const ALL_VERIFIED: PluginRuntimeExpectation[] = PLUGIN_SPECS.map((spec) => ({
  id: spec.id,
  status: "verified",
}));

/** 按 id 改一个 run（其余保持健康）。 */
function withRun(
  runs: PluginRuntimeRun[],
  id: string,
  patch: (run: PluginRuntimeRun) => PluginRuntimeRun,
): PluginRuntimeRun[] {
  return runs.map((run) => (run.only === id ? patch(run) : run));
}

describe("判定函数的健康基线", () => {
  it("四个插件都 verified ⇒ 0（后面每条负例都以此为基准）", () => {
    const decision = decidePluginRuntimeExitCode(healthyRuns(), ALL_VERIFIED);
    expect(decision.exitCode).toBe(0);
    expect(decision.reasons).toEqual([]);
    expect(decision.counts.verified).toBe(4);
  });

  it("汇总行带上每个计数（评审照着它核结论）", () => {
    const summary = formatPluginRuntimeSummary(
      decidePluginRuntimeExitCode(healthyRuns(), ALL_VERIFIED),
    );
    for (const key of [
      "exit=0",
      "runs=4",
      "results=4",
      "invalidStatus=0",
      "inconclusive=0",
      "verified=4",
      "threw=0",
      "statusMismatch=0",
    ]) {
      expect(summary).toContain(key);
    }
  });

  it("清单与 inventory 的插件 id 一致（两处清单不漂移）", () => {
    expect(expectedPluginIds().slice().sort()).toEqual(
      PLUGIN_COMPAT_INVENTORY.map((entry) => entry.id).slice().sort(),
    );
  });
});

describe("第三轮：没跑通最小路径不得算通过（评审点名的回归）", () => {
  it("`probe` 是旧字符串（`no-ctor`）⇒ blocked(3)，绝不 0", () => {
    const runs = withRun(healthyRuns(), "TrackAnimation", (run) => ({
      ...run,
      result: { ...run.result!, probe: "no-ctor" as never },
    }));
    const decision = decidePluginRuntimeExitCode(runs, ALL_VERIFIED);
    expect(decision.exitCode).toBe(3);
    expect(decision.counts.invalidStatus).toBe(1);
    expect(decision.reasons.join(" ")).toContain("TrackAnimation");
  });

  it("`probe` 是 undefined / null ⇒ blocked(3)", () => {
    for (const probe of [undefined, null]) {
      const runs = withRun(healthyRuns(), "DrawingManager", (run) => ({
        ...run,
        result: { ...run.result!, probe: probe as never },
      }));
      expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode, `probe=${probe}`).toBe(3);
    }
  });

  it("`status` 是未定义取值（例如 `passed`）⇒ blocked(3)，不按「不是 threw 就算过」", () => {
    const runs = withRun(healthyRuns(), "GeoUtils", (run) => ({
      ...run,
      result: { ...run.result!, probe: { status: "passed" } as never },
    }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(3);
  });

  it("构造器 / View 不是 function（inconclusive）⇒ blocked(3)", () => {
    const runs = withRun(healthyRuns(), "Mapvgl", (run) => ({
      ...run,
      result: {
        ...run.result!,
        probe: {
          status: "inconclusive",
          reason: "View 不是 function",
          detail: { viewType: "object" },
        },
      },
    }));
    const decision = decidePluginRuntimeExitCode(runs, ALL_VERIFIED);
    expect(decision.exitCode).toBe(3);
    expect(decision.counts.inconclusive).toBe(1);
    expect(decision.reasons.join(" ")).toContain("View 不是 function");
  });

  it("TrackAnimation 的 path 没增长（invariant 不成立）⇒ blocked(3)", () => {
    const runs = withRun(healthyRuns(), "TrackAnimation", (run) => ({
      ...run,
      result: {
        ...run.result!,
        probe: {
          status: "inconclusive",
          reason: "最小路径 invariant 不成立",
          checks: [
            { name: "path 增长（start 真的驱动了动画）", ok: false, detail: { before: 2, after: 2 } },
          ],
        },
      },
    }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(3);
  });

  it("GeoUtils 的 getDistance 不是有限数值 ⇒ blocked(3)", () => {
    const runs = withRun(healthyRuns(), "GeoUtils", (run) => ({
      ...run,
      result: {
        ...run.result!,
        probe: {
          status: "inconclusive",
          reason: "最小路径 invariant 不成立",
          checks: [
            {
              name: "getDistance 是有限数值且约为 1 度纬度（111194.87，容差 1%）",
              ok: false,
              detail: { getDistance: null },
            },
          ],
        },
      },
    }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(3);
  });

  it("readProbeStatus 只认三个取值（其余一律 null —— 交由 blocked 处理）", () => {
    for (const status of PLUGIN_PROBE_STATUSES) {
      expect(readProbeStatus({ id: "x", probe: { status } })).toBe(status);
    }
    expect(readProbeStatus({ id: "x", probe: "no-ctor" as never })).toBeNull();
    expect(readProbeStatus({ id: "x", probe: { status: "ok" } as never })).toBeNull();
    expect(readProbeStatus({ id: "x" })).toBeNull();
    expect(readProbeStatus(null)).toBeNull();
  });
});

describe("第二轮：漏测不得通过（同一个反例继续钉住）", () => {
  it("Mapvgl 那一页 SDK 没起来 ⇒ blocked(3)，绝不落到 0", () => {
    const runs = withRun(healthyRuns(), "Mapvgl", (run) => ({
      ...run,
      env: { ...run.env, sdkLoaded: false },
      result: null,
    }));
    const decision = decidePluginRuntimeExitCode(runs, ALL_VERIFIED);
    expect(decision.exitCode, "『Mapvgl 根本没测到』不能算通过").toBe(3);
    expect(decision.counts.results).toBe(3);
    expect(decision.counts.missingResults).toBe(1);
    expect(decision.counts.sdkBlocked).toBe(1);
    expect(decision.reasons.join(" ")).toContain("Mapvgl");
  });

  it("SDK 正常但某一页没给出 result ⇒ blocked(3)", () => {
    const runs = withRun(healthyRuns(), "GeoUtils", (run) => ({ ...run, result: null }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(3);
  });

  it("期望的插件整页没有报告（导航失败）⇒ 脚手架失败(2)", () => {
    const runs = healthyRuns().filter((run) => run.only !== "DrawingManager");
    const decision = decidePluginRuntimeExitCode(runs, ALL_VERIFIED);
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain("DrawingManager");
  });

  it("被要求跑的插件 id 不在期望清单里 ⇒ 报缺失（2）", () => {
    const runs = withRun(healthyRuns(), "Mapvgl", (run) => ({ ...run, only: "SomethingElse" }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(2);
  });
});

describe("其它形态各自的退出码", () => {
  it("页面脚本自身抛错 ⇒ 脚手架失败(2)", () => {
    const runs = withRun(healthyRuns(), "TrackAnimation", (run) => ({
      ...run,
      fatal: "TypeError: x is not a function",
    }));
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(2);
  });

  it("独立性被打破（全局先于脚本存在）⇒ 1", () => {
    const runs = withRun(healthyRuns(), "GeoUtils", (run) => ({
      ...run,
      env: { ...run.env, globalExistedBeforeLoad: true },
    }));
    const decision = decidePluginRuntimeExitCode(runs, ALL_VERIFIED);
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("GeoUtils");
  });

  it("脚本加载失败 / 全局没暴露 ⇒ blocked(3)", () => {
    const notLoaded = withRun(healthyRuns(), "TrackAnimation", (run) => ({
      ...run,
      result: { ...run.result!, urlLoaded: "script error event" },
    }));
    expect(decidePluginRuntimeExitCode(notLoaded, ALL_VERIFIED).exitCode).toBe(3);

    const notExposed = withRun(healthyRuns(), "TrackAnimation", (run) => ({
      ...run,
      result: { ...run.result!, globalExposed: false },
    }));
    expect(decidePluginRuntimeExitCode(notExposed, ALL_VERIFIED).exitCode).toBe(3);
  });

  it("读数与 inventory 记录的 status 不一致 ⇒ 1（提醒更新 inventory）", () => {
    // inventory 记 threw（例如 MapVGL），本次实测却 verified ⇒ 说明 inventory 过期了
    const upgraded = decidePluginRuntimeExitCode(
      healthyRuns(),
      PLUGIN_SPECS.map((spec) => ({ id: spec.id, status: "threw" as const })),
    );
    expect(upgraded.exitCode).toBe(1);
    expect(upgraded.counts.statusMismatch).toBe(4);
    expect(upgraded.reasons.join(" ")).toContain("inventory");
  });

  it("真正跑起来但运行时抛错 ⇒ 1（且与 inventory 一致时不算漂移）", () => {
    const runs = withRun(healthyRuns(), "Mapvgl", (run) => ({
      ...run,
      result: { ...run.result!, probe: { status: "threw", error: "boom" } },
    }));
    const decision = decidePluginRuntimeExitCode(
      runs,
      PLUGIN_SPECS.map((spec) => ({
        id: spec.id,
        status: spec.id === "Mapvgl" ? ("threw" as const) : ("verified" as const),
      })),
    );
    expect(decision.exitCode).toBe(1);
    expect(decision.counts.threw).toBe(1);
    expect(decision.counts.statusMismatch).toBe(0);
    expect(decision.reasons.join(" ")).toContain("Mapvgl");
  });

  it("脚手架(2) 优先于 blocked(3)：既有缺报告又有 SDK 没起来时判 2", () => {
    const runs = healthyRuns()
      .filter((run) => run.only !== "Mapvgl")
      .map((run) =>
        run.only === "GeoUtils" ? { ...run, env: { ...run.env, sdkLoaded: false } } : run,
      );
    expect(decidePluginRuntimeExitCode(runs, ALL_VERIFIED).exitCode).toBe(2);
  });
});
