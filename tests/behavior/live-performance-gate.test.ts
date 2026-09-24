/**
 * 真实浏览器档性能读数的门禁回归（#123）
 *
 * 两层缝（issue 实施前已与调用方确认）：
 *
 * ① **纯函数单测**：`tests/browser/live-performance/report.mts` 的信封自检 / Fake 对照拼表 /
 *    人读报告分 page·node 两段 + redactAk / 退出码 0·2·3 判定；
 * ② **接线契约**（文件文本断言，同 `performance-gate.test.ts` 口径）：package.json 入口、
 *    nightly job 未被架空且有 artifact、docs 真实浏览器档一节、ADR 两处按票更新、
 *    orchestrator 数据集来自 `tests/performance/dataset` 且输出过脱敏。
 *
 * 页面内测量逻辑（rAF / long task / 原型包装）**不单测**——它只能真浏览器跑，由实跑读数本身取证。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  buildFakeContrast,
  checkLivePerfEnvelope,
  decideLivePerfExit,
  formatLivePerfReport,
  LIVE_PERF_FAMILIES,
  LIVE_PERF_LAYERS,
  LIVE_PERF_REPORT_VERSION,
  redactAk,
  type LivePerfLayerReadings,
  type LivePerfReport,
} from "../browser/live-performance/report.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const repoRoot = resolve(import.meta.dirname, "../..");

function makeSample(durationMs: number, longTaskCount = 0, longestTaskMs = 0) {
  return { durationMs, longTaskCount, longestTaskMs };
}

function makeReading(layer: LivePerfLayerReadings["layer"]): LivePerfLayerReadings {
  return {
    layer,
    size: 50_000,
    firstFrame: makeSample(120, 2, 60),
    mountToPaintMs: layer === "pointCollection" ? 800 : 2500,
    setData: makeSample(layer === "pointCollection" ? 250 : 30, 1, 55),
    redraw: makeSample(layer === "pointCollection" ? 40 : 18, 0, 0),
    sdkSetDataMs: layer === "pointCollection" ? 42.5 : 1200.1,
    postUpdateFps: 58.4,
  };
}

function makeReport(overrides: Partial<LivePerfReport> = {}): LivePerfReport {
  return {
    version: LIVE_PERF_REPORT_VERSION,
    runId: "run-1",
    mode: "live",
    akUsed: true,
    done: true,
    fatal: null,
    blockedReason: null,
    notes: [],
    env: {
      userAgent: "Mozilla/5.0",
      browser: "Chrome 130",
      datasetVersion: "1",
      size: 50_000,
    },
    readings: LIVE_PERF_LAYERS.map((layer) => makeReading(layer)),
    startedAt: "2026-09-23T00:00:00.000Z",
    finishedAt: "2026-09-23T00:01:00.000Z",
    durationMs: 60_000,
    ...overrides,
  };
}

describe("#123 纯函数：信封自检", () => {
  it("runId / ak / mode / version 全对 ⇒ 无 issue（正证控件）", () => {
    const report = makeReport();
    expect(checkLivePerfEnvelope(report, { runId: "run-1", requireAk: true })).toEqual([]);
  });

  it("runId 不匹配 ⇒ LIVE_PERF_RUN_ID_MISMATCH", () => {
    const issues = checkLivePerfEnvelope(makeReport({ runId: "other" }), {
      runId: "run-1",
      requireAk: true,
    });
    expect(issues).toContain("LIVE_PERF_RUN_ID_MISMATCH");
  });

  it("live 档缺 AK ⇒ LIVE_PERF_AK_NOT_USED", () => {
    const issues = checkLivePerfEnvelope(makeReport({ akUsed: false }), {
      runId: "run-1",
      requireAk: true,
    });
    expect(issues).toContain("LIVE_PERF_AK_NOT_USED");
  });

  it("版本漂移 ⇒ LIVE_PERF_VERSION_MISMATCH（报告自报版本不能当通过依据）", () => {
    const issues = checkLivePerfEnvelope(makeReport({ version: 99 }), {
      runId: "run-1",
      requireAk: true,
    });
    expect(issues).toContain("LIVE_PERF_VERSION_MISMATCH");
  });

  it("mode 不是 live ⇒ LIVE_PERF_MODE_MISMATCH", () => {
    const issues = checkLivePerfEnvelope({ ...makeReport(), mode: "fixture" as never }, {
      runId: "run-1",
      requireAk: true,
    });
    expect(issues).toContain("LIVE_PERF_MODE_MISMATCH");
  });
});

describe("#123 纯函数：退出码 0·2·3（永不返回 1）", () => {
  const full = {
    envelopeIssues: [] as string[],
    fatal: null as string | null,
    blockedReason: null as string | null,
    done: true,
    readingCount: 3,
    expectedReadingCount: 3,
  };

  it("采齐 + 信封通过 ⇒ 0", () => {
    expect(decideLivePerfExit(full)).toMatchObject({ exitCode: 0, ok: true });
  });

  it("信封问题 ⇒ 2（脚手架优先于 blocked）", () => {
    const decision = decideLivePerfExit({
      ...full,
      envelopeIssues: ["LIVE_PERF_RUN_ID_MISMATCH"],
      blockedReason: "no ak",
    });
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain("LIVE_PERF_RUN_ID_MISMATCH");
  });

  it("页面 fatal ⇒ 2", () => {
    expect(decideLivePerfExit({ ...full, fatal: "TypeError: …" }).exitCode).toBe(2);
  });

  it("缺 AK / SDK 未 ready（blockedReason）⇒ 3，不是 0", () => {
    const decision = decideLivePerfExit({ ...full, done: false, blockedReason: "missing ak" });
    expect(decision.exitCode).toBe(3);
    expect(decision.ok).toBe(false);
  });

  it("未 done 且无归因 ⇒ 3（INCOMPLETE），不静默当通过", () => {
    const decision = decideLivePerfExit({ ...full, done: false });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join(" ")).toContain("INCOMPLETE");
  });

  it("读数缺项 ⇒ 3（范围被改窄时门禁不许空转）", () => {
    const decision = decideLivePerfExit({ ...full, readingCount: 2 });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join(" ")).toContain("2/3");
  });

  it("没有任何路径返回 1（本票无阈值、无回退态）", () => {
    const shapes = [
      full,
      { ...full, envelopeIssues: ["X"] },
      { ...full, fatal: "boom" },
      { ...full, done: false, blockedReason: "ak" },
      { ...full, readingCount: 0 },
    ];
    for (const shape of shapes) {
      expect(decideLivePerfExit(shape).exitCode).not.toBe(1);
    }
  });
});

describe("#123 纯函数：Fake 对照拼表", () => {
  it("pointCollection 用 setData.replace@*，line/fill 用 data.replace.*", () => {
    const readings = LIVE_PERF_LAYERS.map((layer) => makeReading(layer));
    const contrast = buildFakeContrast(readings, {
      metrics: {
        "setData.replace@50000": { minMs: 253.8 },
        "data.replace.line@50000": { minMs: 0.61 },
        "data.replace.fill@50000": { minMs: 0.43 },
      },
    });
    expect(contrast.map((row) => row.fakeSetDataMs)).toEqual([253.8, 0.61, 0.43]);
    const point = contrast.find((row) => row.layer === "pointCollection")!;
    expect(point.deltaMs).toBe(round2(250 - 253.8));
    // 原生 setData 边界旁路列出，但**不参与** delta（窗口不同，#131 评审第 1 条）。
    expect(point.liveSdkSetDataMs).toBe(42.5);
    const line = contrast.find((row) => row.layer === "line")!;
    expect(line.liveSdkSetDataMs).toBe(1200.1);
    // delta 只来自 setData 对照窗，不得被 sdkSetDataMs 或 redraw 污染。
    expect(line.deltaMs).toBe(round2(30 - 0.61));
  });

  it("Fake 侧缺指标 ⇒ fake/delta 为 null（不猜、不补 0）", () => {
    const contrast = buildFakeContrast([makeReading("line")], { metrics: {} });
    expect(contrast[0]!.fakeSetDataMs).toBeNull();
    expect(contrast[0]!.deltaMs).toBeNull();
  });

  it("sdkSetDataMs 为 null 时旁路列也是 null（未进原生调用不猜 0）", () => {
    const reading = { ...makeReading("line"), sdkSetDataMs: null };
    const contrast = buildFakeContrast([reading], { metrics: { "data.replace.line@50000": { minMs: 1 } } });
    expect(contrast[0]!.liveSdkSetDataMs).toBeNull();
    expect(contrast[0]!.deltaMs).toBe(round2(30 - 1));
  });
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

describe("#123 纯函数：人读报告分 page·node 两段 + redactAk", () => {
  const report = makeReport();
  const decision = decideLivePerfExit({
    envelopeIssues: [],
    fatal: null,
    blockedReason: null,
    done: true,
    readingCount: 3,
    expectedReadingCount: 3,
  });

  it("page 段含浏览器 / 数据集版本 / 三窗读数；node 段含 exit 与对照表 sdk 旁路列", () => {
    const text = formatLivePerfReport({
      report,
      decision,
      contrast: buildFakeContrast(report.readings, {
        metrics: { "setData.replace@50000": { minMs: 253.8 } },
      }),
    });
    expect(text).toContain("--- page: readings ---");
    expect(text).toContain("browser=Chrome 130");
    expect(text).toContain("dataset=v1");
    expect(text).toContain("--- node: envelope ---");
    expect(text).toContain("node  exit=0");
    expect(text).toContain("fake contrast");
    expect(text).toContain("firstFrame");
    expect(text).toContain("mountToPaint"); // #131 第四轮：建图成本旁路，不是 #123 目标 1
    expect(text).toContain("setData");
    // 独立窗口各自成行（#131 第 1/3 条）。
    expect(text).toContain("redraw");
    expect(text).toContain("sdkSetData");
    expect(text).toContain("58.4"); // 真实 FPS，不是 0~1 比值（#131 第 5 条）
    expect(text).toContain("postFps"); // 更新后采样列名，不是「setData 期间 FPS」
    expect(text).toContain("overlap"); // 窗口交集列，不是整条 task duration
  });

  it("redactAk：打码 ak 查询参数，保留其它参数", () => {
    const raw = "http://localhost/?ak=SECRET&mode=live";
    const redacted = redactAk(raw);
    expect(redacted).not.toContain("SECRET");
    expect(redacted).toContain("ak=<redacted>");
    expect(redacted).toContain("mode=live");
  });

  it("报告里出现的 ak 值在渲染后不可见（正证：原文里确实有）", () => {
    const withAk = "url=http://localhost/?ak=super-secret-token";
    expect(withAk).toContain("super-secret-token");
    expect(redactAk(withAk)).not.toContain("super-secret-token");
  });
});

describe("#123 接线契约：入口 / nightly / docs / ADR / dataset / 脱敏", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scriptPath = "scripts/collect-live-performance.mts";
  const scriptText = readFileSync(resolve(repoRoot, scriptPath), "utf8");
  const nightly = readWorkflow("nightly-v4-smoke.yml");
  const docs = readFileSync(
    resolve(repoRoot, "docs/zh-CN/contributing/performance-baseline.md"),
    "utf8",
  );
  const adr = readFileSync(
    resolve(repoRoot, "docs/adr/2026-09-21-performance-baseline-and-worker-decision.md"),
    "utf8",
  );

  it("package.json 有 perf:baseline:live 入口且指向真实文件", () => {
    expect(pkg.scripts["perf:baseline:live"], "缺少 perf:baseline:live 入口").toContain(
      "scripts/collect-live-performance.mts",
    );
    for (const relative of [
      scriptPath,
      "tests/browser/live-performance/report.mts",
      "tests/browser/live-performance/main.ts",
      "tests/browser/live-performance/vite.config.ts",
      "tests/browser/live-performance/index.html",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
    }
  });

  it("orchestrator 数据集来自 tests/performance/dataset（不另造一份）", () => {
    expect(scriptText).toContain("tests/performance/dataset");
    expect(scriptText).toMatch(/from\s+["'].*dataset/);
  });

  it("orchestrator 输出过 redactAk（stdout / 文件两侧）", () => {
    expect(scriptText).toContain("redactAk");
    // 页面 URL 带 ak= 时，写日志/打印必须过脱敏。
    expect(scriptText).toMatch(/redactAk\(/);
  });

  it("orchestrator 不引入退出码 1（无阈值读数采集）", () => {
    // 注释里可以写「永不返回 1」；判定入口只交 0/2/3。
    expect(scriptText).toContain("process.exitCode");
    expect(scriptText).not.toMatch(/process\.exitCode\s*=\s*1\b/);
    expect(scriptText).not.toMatch(/exitCode\s*=\s*1\b/);
  });

  it("orchestrator 失败通道只抛 LivePerfFail，不在启动中段 process.exit 跳过 finally（#131 第 4 条）", () => {
    // fail() 函数体必须是 throw，不能直接 process.exit —— 否则 vite/chrome 不会进 shutdown。
    // 注意：只截 fail 函数体；整文件里 process.exit 在 --keep 收口处是合法的。
    const failStart = scriptText.indexOf("function fail");
    const failEnd = scriptText.indexOf("async function main", failStart);
    expect(failStart, "找不到 fail 函数").toBeGreaterThanOrEqual(0);
    expect(failEnd, "fail 后面没有 main").toBeGreaterThan(failStart);
    const failBody = scriptText.slice(failStart, failEnd);
    expect(failBody).toMatch(/\): never \{\s*throw new LivePerfFail/);
    expect(failBody, "fail() 体内不得 process.exit").not.toContain("process.exit");
    // resolveBrowser / mkdtemp 必须在 main() 的 try 内（否则抛错落 Node 默认 1）。
    const mainBody = scriptText.slice(scriptText.indexOf("async function main"));
    const tryIndex = mainBody.indexOf("try {");
    const browserIndex = mainBody.indexOf("resolveBrowser()");
    const mkdtempIndex = mainBody.indexOf("mkdtempSync(");
    expect(tryIndex).toBeGreaterThanOrEqual(0);
    expect(browserIndex).toBeGreaterThan(tryIndex);
    expect(mkdtempIndex).toBeGreaterThan(tryIndex);
    // 统一 finally 收口。
    expect(mainBody).toContain("finally");
    expect(mainBody).toMatch(/if \(!hasFlag\("keep"\)\) shutdown/);
    // LivePerfFail 的 3（blocked）不能被 catch 硬改成 2。
    expect(scriptText).toContain("error instanceof LivePerfFail ? error.code : 2");
  });

  it("页面 sleep 用毫秒数字（曾经误传 resolve 导致稳定等待全部失效，#131 第 2 条）", () => {
    const page = readFileSync(resolve(repoRoot, "tests/browser/live-performance/main.ts"), "utf8");
    expect(page).toMatch(/setTimeout\(resolve,\s*ms\)/);
    expect(page).not.toMatch(/setTimeout\(resolve,\s*resolve\)/);
  });

  it("SDK worker importScripts 噪声不记 fatal，且写进 report.notes", () => {
    const page = readFileSync(resolve(repoRoot, "tests/browser/live-performance/main.ts"), "utf8");
    // error / unhandledrejection 两侧都要过滤 WorkerGlobalScope|importScripts。
    expect(page).toMatch(/WorkerGlobalScope\|importScripts/);
    // 过滤分支必须 return，不得落到 finish(fatal)；并 push 到 notes（nightly 可见）。
    expect(page).toMatch(/ignored sdk worker error/);
    expect(page).toMatch(/ignored sdk worker rejection/);
    expect(page).toMatch(/report\.notes\.push\(/);
    // 正证：仍然会对页面自身错误调 finish(fatal)。
    expect(page).toContain("finish(`window.error:");
    expect(page).toContain("finish(`unhandledrejection:");
  });

  it("页面计时：造数隔离 + 近似 settle + 交集归属 + postFps + firstFrame 起点=原生 setData（#131 第三/四轮）", () => {
    const page = readFileSync(resolve(repoRoot, "tests/browser/live-performance/main.ts"), "utf8");
    // 预生成在窗外，且必须跨 macrotask 与 setItems 隔开（否则整条造数 task 算进窗口）。
    expect(page).toMatch(/const next = variantData\(/);
    expect(page).toMatch(/await macrotask\(\)/);
    const variantLine = page.indexOf("const next = variantData(");
    const windowStartLine = page.indexOf("const windowStart = performance.now()", variantLine);
    expect(windowStartLine, "找不到 setData windowStart").toBeGreaterThan(variantLine);
    expect(
      page.slice(variantLine, windowStartLine),
      "variantData 与 windowStart 之间必须有 macrotask 隔离",
    ).toMatch(/await macrotask\(\)/);
    expect(page).toMatch(/mounted\.host\.setItems\(next\)/);
    // settle 跨 macrotask + nextTick（近似 Fake；#131 第三/四轮），不是纯微任务。
    expect(page).toMatch(/setTimeout\(resolve,\s*0\)/);
    expect(page).not.toMatch(/await Promise\.resolve\(\);\s*\n\s*await Promise\.resolve\(\);\s*\n\s*await nextTick\(\);/);
    // long task：页面级 collector + 窗末 flush + takeRecords + **窗口交集**归属。
    expect(page).toContain("createLongTaskCollector");
    expect(page).toContain("takeRecords");
    expect(page).toContain("longTasks.flush()");
    expect(page).toMatch(/countIn\(windowStart, setDataEnd\)/);
    expect(page).toMatch(/countIn\(redrawStart, redrawEnd\)/);
    expect(page).toMatch(/Math\.min\(entryEnd,\s*end\)\s*-\s*Math\.max\(entryStart,\s*start\)/);
    // firstFrame 起点 = 原生 setData 进入，不是 app.mount；未捕获则 fatal 不回退。
    expect(page).toMatch(/lastStart/);
    expect(page).toMatch(/initialSetDataStart/);
    expect(page).toMatch(/firstFrame: 首挂未捕获原生 setData 起点/);
    expect(page).toMatch(/const firstFrame = sample\(/);
    const firstFrameSample = page.indexOf("const firstFrame = sample(");
    const stabilizeSleep = page.indexOf("await sleep(200)");
    expect(firstFrameSample, "找不到 firstFrame 采样").toBeGreaterThanOrEqual(0);
    expect(stabilizeSleep, "找不到稳定期 sleep").toBeGreaterThan(firstFrameSample);
    // 协议表不得再写「ready + paint + 稳定等待」当 firstFrame 终点，也不得把 mount 当起点。
    expect(page).not.toMatch(/ready \+ paint \+ 稳定等待/);
    expect(page).toMatch(/mountToPaintMs/);
    // FPS 重命名为 postUpdateFps（更新后采样，不是 setData 期间）。
    expect(page).toContain("postUpdateFps");
    expect(page).not.toMatch(/\bfps:\s*await sampleFps/);
    // 逐图层独立 mount / unmount + 原生 setData 探针。
    expect(page).toContain("async function mountSingleLayer");
    expect(page).toContain("mounted.app.unmount()");
    expect(page).toContain("instrumentNativeSetData");
    expect(page).toContain("PointShapeLayer");
    expect(page).toContain("LineLayer");
    expect(page).toContain("FillLayer");
    // FPS = frames / seconds，不是 ÷60 比值。
    expect(page).toMatch(/return frames \/ \(elapsed \/ 1000\)/);
    expect(page).not.toMatch(/frames\s*\/\s*\(elapsed\s*\/\s*1000\)\s*\/\s*60/);
  });

  it("报告 schema 含 firstFrame 起点旁路 / redraw / sdkSetDataMs / notes，家族清单与之一致", () => {
    const reportSource = readFileSync(
      resolve(repoRoot, "tests/browser/live-performance/report.mts"),
      "utf8",
    );
    expect(reportSource).toContain("redraw: LivePerfSample");
    expect(reportSource).toContain("mountToPaintMs: number");
    expect(reportSource).toContain("sdkSetDataMs: number | null");
    expect(reportSource).toContain("notes: string[]");
    expect(LIVE_PERF_FAMILIES).toContain("firstFrame");
    expect(LIVE_PERF_FAMILIES).toContain("mountToPaint");
    expect(LIVE_PERF_FAMILIES).toContain("redraw");
    expect(LIVE_PERF_FAMILIES).toContain("sdkSetData");
    expect(LIVE_PERF_REPORT_VERSION).toBe(2);
  });

  it("人读报告渲染 notes（被忽略的 SDK worker 噪声进 artifact）", () => {
    const report = makeReport({ notes: ["ignored sdk worker error: boom"] });
    const decision = decideLivePerfExit({
      envelopeIssues: [],
      fatal: null,
      blockedReason: null,
      done: true,
      readingCount: 3,
      expectedReadingCount: 3,
    });
    const text = formatLivePerfReport({ report, decision });
    expect(text).toContain("page  NOTE: ignored sdk worker error: boom");
  });

  it("nightly 有 live-performance job，跑 perf:baseline:live，未被架空，且有 artifact", () => {
    const lines = nightly.split(/\r?\n/);
    const jobLine = lines.findIndex((line) => /^ {2}live-performance:\s*$/.test(line));
    expect(jobLine, "nightly 缺少 live-performance job").toBeGreaterThanOrEqual(0);

    // 只认真正的 `run:`（注释里也会写入口名，findIndex 首个命中不能当执行点）。
    const runLine = lines.findIndex(
      (line, index) => index > jobLine && /^\s+run:.*perf:baseline:live/.test(line),
    );
    expect(runLine, "nightly 没有跑 pnpm perf:baseline:live").toBeGreaterThanOrEqual(0);
    expect(runLine).toBeGreaterThan(jobLine);

    // 该 step 段不被 if / continue-on-error 架空（从 run 行向下扫到下一个 step 或 job 边界）。
    const blockers: string[] = [];
    for (let i = runLine; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (i > runLine && /^\s+-\s+name:/.test(line)) break;
      if (/^\s+(if|continue-on-error)\s*:/.test(line)) blockers.push(line.trim());
      if (/^ {2}\w[\w-]*:\s*$/.test(line) && i > runLine) break;
    }
    expect(blockers, "live-performance step 被架空").toEqual([]);

    const block = stepBlockContaining(nightly, "run: pnpm perf:baseline:live");
    expect(block.length, "找不到 perf:baseline:live step").toBeGreaterThan(0);
    const hasArtifact = nightly.includes("upload-artifact") && nightly.includes("live-performance");
    expect(hasArtifact, "nightly 缺少 live-performance artifact 上传").toBe(true);
    // artifact name 应能对上本 job（防止只上传了别人的报告）。
    expect(nightly).toMatch(/name:\s*live-performance(-report)?\b/);
  });

  it("docs 有「真实浏览器档」一节且提到本入口与无阈值", () => {
    expect(docs, "docs 缺少真实浏览器档标题").toMatch(/真实浏览器档/);
    expect(docs).toContain("perf:baseline:live");
    expect(docs).toContain("#123");
    // 无阈值：不能把本套读数写成门禁。
    expect(docs).toMatch(/不设阈值|无阈值|不作门禁/);
  });

  it("ADR 已知限制 1 已按票从「未读数」改成取证口径，并指向 #123 结论", () => {
    // 已知限制 1 的段落：必须不再写「另立票承接」当作唯一去处，而要写本轮已取证/待复核。
    const limitation = adr.split("## 已知限制")[1]?.split("## 欠账")[0] ?? "";
    expect(limitation.length, "ADR 找不到已知限制段").toBeGreaterThan(0);
    expect(limitation).toContain("#123");
    expect(limitation).toMatch(/已取证|待复核|真实浏览器档/);
    // 旧口径「另立票承接下来的工作」若仍在，必须同时出现取证状态（不是只留欠账）。
    if (limitation.includes("另立票承接")) {
      expect(limitation).toMatch(/已取证|待复核/);
    }
  });

  it("ADR「重新评估的条件」第三条已标成本轮已核/待复核", () => {
    const reevaluate = adr.split("重新评估的条件")[1]?.split("###")[0] ?? "";
    expect(reevaluate.length, "ADR 找不到重新评估条件段").toBeGreaterThan(0);
    expect(reevaluate).toContain("真实浏览器");
    expect(reevaluate, "第三条未标记本轮状态").toMatch(/已核|待复核|#123/);
  });

  it("orchestrator 读的是提交的 Fake 基线（对照表输入不是凭空造的）", () => {
    expect(scriptText).toContain("tests/performance/baseline.json");
  });
});

describe("#123 typecheck 接线：live 页面真进 TS program（#131 第 2 条）", () => {
  /**
   * 用 TypeScript 官方 API 解析 `tsconfig.tests.json` 的 include，证明
   * `tests/browser/live-performance/main.ts` 与 `report.mts` **真的**进了编译范围。
   *
   * 不能只断言 config 文本：曾经写成 `*.{ts,mts}`（TS 不支持 brace expansion），
   * 匹配 0 个文件，typecheck 全绿却漏掉页面 TS 错误——文本断言挡不住那种假绿。
   */
  function matchedLiveFiles(): string[] {
    const configPath = resolve(repoRoot, "tsconfig.tests.json");
    const configFile = ts.readConfigFile(configPath, (path) => readFileSync(path, "utf8"));
    expect(configFile.error, "tsconfig.tests.json 解析失败").toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config as object,
      ts.sys,
      repoRoot,
      undefined,
      configPath,
    );
    return parsed.fileNames.filter((file) => file.replace(/\\/g, "/").includes("browser/live-performance"));
  }

  it("include 能匹配到 live 页面与 report（不是 0 个）", () => {
    const matched = matchedLiveFiles();
    expect(matched.length, "live 页面一个都没进 program").toBeGreaterThanOrEqual(2);
    const normalized = matched.map((file) => file.replace(/\\/g, "/"));
    expect(normalized.some((file) => file.endsWith("browser/live-performance/main.ts"))).toBe(true);
    expect(normalized.some((file) => file.endsWith("browser/live-performance/report.mts"))).toBe(true);
  });

  it("include 数组本身不依赖 brace expansion（只看 JSON 的 include，不看 _comment）", () => {
    const configRaw = readFileSync(resolve(repoRoot, "tsconfig.tests.json"), "utf8");
    const config = JSON.parse(configRaw) as { include?: string[] };
    const include = config.include ?? [];
    expect(include, "include 里不得出现 *.{ts,mts} 形态").not.toContain(
      expect.stringContaining("{ts,mts}") as unknown as string,
    );
    for (const pattern of include) {
      expect(pattern).not.toMatch(/\*\.\{/);
    }
    expect(include).toContain("tests/browser/live-performance/**/*.ts");
    expect(include).toContain("tests/browser/live-performance/**/*.mts");
  });
});
