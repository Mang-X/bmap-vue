/**
 * `probe-plugin-runtime` 判定函数的桩测试（评审 #85 第二轮 P1）
 *
 * 上一版的汇总阶段有一个 **漏测却通过** 的漏洞：把 `result === null` 的 run 过滤掉，而
 * `sdkLoaded` 只看 `runs[0]`。于是「某个插件的页面 SDK 没起来 ⇒ 它从结果里消失」会被当成
 * 「没有异常」⇒ 退出码 `0`。这个文件用纯数据把这个反例钉住，不需要真跑浏览器。
 *
 * 每条用例都先断言**健康基线是 `0`**，再改一个字段断言期望码 —— 否则「判定恒返回某个码」也能过。
 */
import { describe, it, expect } from "vitest";
import {
  decidePluginRuntimeExitCode,
  expectedPluginIds,
  formatPluginRuntimeSummary,
  isThrew,
  PLUGIN_SPECS,
  type PluginRuntimeRun,
} from "../../scripts/plugin-runtime-report.mts";
import { PLUGIN_COMPAT_INVENTORY } from "../../packages/baidu-map-gl-vue/src/plugins/compat-inventory";

/** 一份「四个插件都跑通」的健康报告。 */
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
    result: { id: spec.id, urlLoaded: "ok", globalExposed: true, probe: { ok: true } },
    done: true,
  }));
}

describe("判定函数的健康基线", () => {
  it("四个插件都成立 ⇒ 0（后面每条负例都以此为基准）", () => {
    const decision = decidePluginRuntimeExitCode(healthyRuns());
    expect(decision.exitCode).toBe(0);
    expect(decision.reasons).toEqual([]);
    expect(decision.counts.runs).toBe(4);
    expect(decision.counts.results).toBe(4);
  });

  it("汇总行带上每个计数（评审照着它核结论）", () => {
    const summary = formatPluginRuntimeSummary(decidePluginRuntimeExitCode(healthyRuns()));
    for (const key of [
      "exit=0",
      "runs=4",
      "results=4",
      "sdkBlocked=0",
      "missingResults=0",
      "notIndependent=0",
      "scriptFailed=0",
      "globalMissing=0",
      "threw=0",
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

describe("漏测不得通过（评审 #85 第二轮 P1 的具体反例）", () => {
  it("Mapvgl 那一页 SDK 没起来 ⇒ blocked(3)，绝不落到 0", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "Mapvgl"
        ? { ...run, env: { ...run.env, sdkLoaded: false }, result: null }
        : run,
    );

    const decision = decidePluginRuntimeExitCode(runs);
    expect(decision.exitCode, "『Mapvgl 根本没测到』不能算通过").toBe(3);
    expect(decision.reasons.join(" ")).toContain("Mapvgl");
    // 顺带钉住计数：这份报告里 results 只有 3 —— 如果实现又去「过滤 null 后按 3 个判」，就会误判
    expect(decision.counts.results).toBe(3);
    expect(decision.counts.missingResults).toBe(1);
    expect(decision.counts.sdkBlocked).toBe(1);
  });

  it("SDK 正常但某一页没给出 result ⇒ blocked(3)", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "GeoUtils" ? { ...run, result: null } : run,
    );
    const decision = decidePluginRuntimeExitCode(runs);
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join(" ")).toContain("GeoUtils");
  });

  it("期望的插件整页没有报告（导航失败）⇒ 脚手架失败(2)", () => {
    const runs = healthyRuns().filter((run) => run.only !== "DrawingManager");
    const decision = decidePluginRuntimeExitCode(runs);
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain("DrawingManager");
  });

  it("被要求跑的插件 id 不在期望清单里 ⇒ 报缺失（2），而不是当成多跑了一个", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "Mapvgl" ? { ...run, only: "SomethingElse" } : run,
    );
    expect(decidePluginRuntimeExitCode(runs).exitCode).toBe(2);
  });
});

describe("其它形态各自的退出码", () => {
  it("页面脚本自身抛错 ⇒ 脚手架失败(2)", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "TrackAnimation" ? { ...run, fatal: "TypeError: x is not a function" } : run,
    );
    expect(decidePluginRuntimeExitCode(runs).exitCode).toBe(2);
  });

  it("独立性被打破（全局先于脚本存在）⇒ 1", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "GeoUtils" ? { ...run, env: { ...run.env, globalExistedBeforeLoad: true } } : run,
    );
    const decision = decidePluginRuntimeExitCode(runs);
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("GeoUtils");
  });

  it("脚本加载失败 / 全局没暴露 ⇒ blocked(3)", () => {
    const notLoaded = healthyRuns().map((run) =>
      run.only === "TrackAnimation"
        ? { ...run, result: { ...run.result!, urlLoaded: "script error event" } }
        : run,
    );
    expect(decidePluginRuntimeExitCode(notLoaded).exitCode).toBe(3);

    const notExposed = healthyRuns().map((run) =>
      run.only === "TrackAnimation" ? { ...run, result: { ...run.result!, globalExposed: false } } : run,
    );
    expect(decidePluginRuntimeExitCode(notExposed).exitCode).toBe(3);
  });

  it("真正跑起来但运行时抛错 ⇒ 1", () => {
    const runs = healthyRuns().map((run) =>
      run.only === "Mapvgl" ? { ...run, result: { ...run.result!, probe: "THREW: boom" } } : run,
    );
    const decision = decidePluginRuntimeExitCode(runs);
    expect(decision.exitCode).toBe(1);
    expect(decision.counts.threw).toBe(1);
    expect(decision.reasons.join(" ")).toContain("Mapvgl");
  });

  it("脚手架(2) 优先于 blocked(3)：既有缺报告又有 SDK 没起来时判 2", () => {
    const runs = healthyRuns()
      .filter((run) => run.only !== "Mapvgl")
      .map((run) => (run.only === "GeoUtils" ? { ...run, env: { ...run.env, sdkLoaded: false } } : run));
    expect(decidePluginRuntimeExitCode(runs).exitCode).toBe(2);
  });

  it("isThrew 只认 `THREW:` 前缀（`ok` / undefined 都不算）", () => {
    expect(isThrew({ id: "x", probe: "THREW: boom" })).toBe(true);
    expect(isThrew({ id: "x", probe: "ok" })).toBe(false);
    expect(isThrew({ id: "x" })).toBe(false);
    expect(isThrew(null)).toBe(false);
  });
});
