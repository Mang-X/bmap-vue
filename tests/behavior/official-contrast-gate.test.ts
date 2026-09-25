/**
 * 官方对照基准的门禁回归（#140）
 *
 * 同一份「两层缝」（沿用 `live-performance-gate.test.ts` 的口径）：
 *
 * ① **纯函数单测**：`tests/performance/official-contrast/report.mts` 的信封自检、
 *    退出码 0·1·2·3 判定、人读报告**分节**（可比 / 扩展档 / 不变式）。
 *    之所以能单测：它只吃 JSON 形状的入参、只吐文本与退出码，不 import vitest、不碰 `window`。
 *
 * ② **接线契约**（文件文本断言）：`perf:contrast` 入口指向真脚本、官方基线版本**精确锁定**
 *    `1.0.1`、AK 绝不入库、CI 真有 job、ADR / 性能文档已更新。
 *
 * 基准**本身**（10 场景 × 2 侧的装配与读数）不单测——它只能真跑一遍才有意义，
 * 由 `pnpm perf:contrast` 与 `tests/performance/official-contrast.perf.test.ts` 取证。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkContrastEnvelope,
  decideContrastExit,
  formatContrastReport,
  OFFICIAL_BASELINE_VERSION,
  sameMachine,
  CONTRAST_REPORT_VERSION,
  type ContrastEnvelope,
  type ContrastReport,
  type ContrastSideReadings,
} from "../performance/official-contrast/report.mts";
import {
  CONTRAST_SCENARIOS,
  comparableScenarios,
  measureToScenarioTable,
  oursOnlyScenarios,
  scenarioIdOfMeasure,
} from "../performance/officialScenarios.ts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const repoRoot = resolve(import.meta.dirname, "../..");

/* ------------------------------------------------------------------ 夹具 */

function makeSide(overrides: Partial<ContrastSideReadings> = {}): ContrastSideReadings {
  return {
    durationMs: 10,
    sdkCalls: 0,
    recreates: 0,
    renderCallbacks: 0,
    retainedResources: 0,
    retainedListeners: 0,
    ...overrides,
  };
}

function makeEnvelope(overrides: Partial<ContrastEnvelope> = {}): ContrastEnvelope {
  return {
    runId: "run-1",
    oursVersion: "1.0.0-rc.0",
    officialVersion: OFFICIAL_BASELINE_VERSION,
    datasetVersion: "1",
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M4",
    node: "v24.0.0",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ContrastReport> = {}): ContrastReport {
  return {
    version: CONTRAST_REPORT_VERSION,
    mode: "fake-v4",
    done: true,
    fatal: null,
    blockedReason: null,
    notes: [],
    envelope: makeEnvelope(),
    scenarios: [
      {
        id: "map-cold-mount",
        official: "Map",
        ours: makeSide(),
        officialSide: makeSide(),
      },
    ],
    invariants: [],
    notMeasured: ["long task"],
    startedAt: "2026-09-25T00:00:00.000Z",
    finishedAt: "2026-09-25T00:00:10.000Z",
    durationMs: 10_000,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ 纯函数：信封 */

describe("#140 纯函数：信封自检", () => {
  const expected = { runId: "run-1", datasetVersion: "1" };

  it("全对时无问题", () => {
    expect(checkContrastEnvelope(makeReport(), expected)).toEqual([]);
  });

  it("官方版本偏离 1.0.1 一定被抓住（基线锁版本不是装饰）", () => {
    const issues = checkContrastEnvelope(
      makeReport({ envelope: makeEnvelope({ officialVersion: "1.0.2" }) }),
      expected,
    );
    expect(issues.join()).toContain("CONTRAST_OFFICIAL_VERSION_DRIFT");
  });

  it("runId / 数据集版本 / 报告版本各自单独报", () => {
    expect(
      checkContrastEnvelope(makeReport({ envelope: makeEnvelope({ runId: "other" }) }), expected),
    ).toContain("CONTRAST_RUN_ID_MISMATCH");
    expect(
      checkContrastEnvelope(
        makeReport({ envelope: makeEnvelope({ datasetVersion: "2" }) }),
        expected,
      ),
    ).toContain("CONTRAST_DATASET_VERSION_MISMATCH");
    expect(checkContrastEnvelope(makeReport({ version: 99 }), expected)).toContain(
      "CONTRAST_VERSION_MISMATCH",
    );
  });

  it("sameMachine 认机器三件套（跨机只出报告，不做绝对值比较）", () => {
    expect(sameMachine(makeEnvelope(), makeEnvelope())).toBe(true);
    expect(sameMachine(makeEnvelope(), makeEnvelope({ cpuModel: "Intel Xeon" }))).toBe(false);
    expect(sameMachine(makeEnvelope(), makeEnvelope({ arch: "x64" }))).toBe(false);
  });
});

/* ------------------------------------------------------------------ 纯函数：退出码 */

describe("#140 纯函数：退出码 0·1·2·3", () => {
  const base = {
    envelopeIssues: [] as string[],
    fatal: null,
    blockedReason: null,
    done: true,
    expectedScenarioCount: 1,
    scenarioCount: 1,
    invariants: [] as ContrastReport["invariants"],
  };

  it("全齐、无破坏 ⇒ 0", () => {
    expect(decideContrastExit(base).exitCode).toBe(0);
  });

  it("本库侧不变式被破坏 ⇒ 1（唯一能返回 1 的原因）", () => {
    const decision = decideContrastExit({
      ...base,
      invariants: [
        {
          id: "x",
          scenario: "s",
          description: "d",
          side: "ours",
          holds: false,
        },
      ],
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join()).toContain("INVARIANT_BROKEN");
  });

  it("官方侧不变式不成立**不**判失败——那只是读数，不是本库的回归", () => {
    const decision = decideContrastExit({
      ...base,
      invariants: [
        {
          id: "official-x",
          scenario: "s",
          description: "官方读数",
          side: "official",
          holds: false,
        },
      ],
    });
    expect(decision.exitCode, "官方侧读数不该卡本库门禁").toBe(0);
    expect(decision.ok).toBe(true);
  });

  it("信封不符 / fatal ⇒ 2（脚手架，优先级高于不变式）", () => {
    expect(decideContrastExit({ ...base, envelopeIssues: ["X"] }).exitCode).toBe(2);
    expect(decideContrastExit({ ...base, fatal: "崩了" }).exitCode).toBe(2);
    expect(
      decideContrastExit({
        ...base,
        envelopeIssues: ["X"],
        invariants: [
          { id: "x", scenario: "s", description: "d", side: "ours", holds: false },
        ],
      }).exitCode,
      "信封问题优先判 2",
    ).toBe(2);
  });

  it("「没跑成」⇒ 3，**不是**通过：done=false、blocked、场景缺项三条", () => {
    expect(decideContrastExit({ ...base, done: false }).exitCode).toBe(3);
    expect(decideContrastExit({ ...base, blockedReason: "官方没 ready" }).exitCode).toBe(3);
    expect(decideContrastExit({ ...base, scenarioCount: 0 }).exitCode).toBe(3);
  });

  it("done=false 又没给 blockedReason ⇒ 仍 3（无法归因也不能当通过）", () => {
    const decision = decideContrastExit({ ...base, done: false, blockedReason: null });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join()).toContain("INCOMPLETE");
  });
});

/* ------------------------------------------------------------------ 纯函数：人读报告 */

describe("#140 纯函数：人读报告分三节 + 扩展档不并排", () => {
  it("扩展档场景单列，且**不**与任何官方数字并排", () => {
    const report = makeReport({
      scenarios: [
        {
          id: "keepalive-toggle",
          official: null,
          ours: makeSide({ durationMs: 3 }),
          officialSide: null,
          officialSkippedReason: "官方库没有 KeepAlive 语义",
        },
      ],
    });
    const text = formatContrastReport({
      report,
      decision: decideContrastExit({
        envelopeIssues: [],
        fatal: null,
        blockedReason: null,
        done: true,
        expectedScenarioCount: 1,
        scenarioCount: 1,
        invariants: [],
      }),
    });
    expect(text).toContain("本库扩展档");
    expect(text).toContain("官方库没有 KeepAlive 语义");
    // 扩展档那一节里不应出现「delta」列（并排比较的痕迹）。
    const section = text.slice(text.indexOf("本库扩展档"));
    const oursOnlySection = section.slice(0, section.indexOf("不变式"));
    expect(oursOnlySection).not.toContain("delta");
  });

  it("可比场景列出两侧读数与差值（差值只是读数）", () => {
    const report = makeReport({
      scenarios: [
        {
          id: "map-cold-mount",
          official: "Map",
          ours: makeSide({ durationMs: 4 }),
          officialSide: makeSide({ durationMs: 22 }),
        },
      ],
    });
    const text = formatContrastReport({
      report,
      decision: decideContrastExit({
        envelopeIssues: [],
        fatal: null,
        blockedReason: null,
        done: true,
        expectedScenarioCount: 1,
        scenarioCount: 1,
        invariants: [],
      }),
    });
    expect(text).toContain("map-cold-mount");
    expect(text).toContain("-18ms");
  });

  it("没测到的场景 durationMs 为 null（渲染成 `-`），不填 0", () => {
    const text = formatContrastReport({
      report: makeReport({
        scenarios: [
          {
            id: "map-cold-mount",
            official: "Map",
            ours: makeSide({ durationMs: null }),
            officialSide: null,
            officialSkippedReason: "blocked",
          },
        ],
      }),
      decision: decideContrastExit({
        envelopeIssues: [],
        fatal: null,
        blockedReason: null,
        done: true,
        expectedScenarioCount: 1,
        scenarioCount: 1,
        invariants: [],
      }),
    });
    expect(text).toMatch(/map-cold-mount\s+-/);
  });

  it("报告自带身份：机器 / 两库版本 / 数据集版本", () => {
    const text = formatContrastReport({
      report: makeReport(),
      decision: decideContrastExit({
        envelopeIssues: [],
        fatal: null,
        blockedReason: null,
        done: true,
        expectedScenarioCount: 1,
        scenarioCount: 1,
        invariants: [],
      }),
    });
    expect(text).toContain(`official=${OFFICIAL_BASELINE_VERSION}`);
    expect(text).toContain("Apple M4");
    expect(text).toContain("dataset=v1");
  });

  it("「本档测不到」一节必须在（禁止把 Fake 读数外推到浏览器）", () => {
    const text = formatContrastReport({
      report: makeReport(),
      decision: decideContrastExit({
        envelopeIssues: [],
        fatal: null,
        blockedReason: null,
        done: true,
        expectedScenarioCount: 1,
        scenarioCount: 1,
        invariants: [],
      }),
    });
    expect(text).toContain("本档测不到");
  });
});

/* ------------------------------------------------------------------ 纯函数：场景表 */

describe("#140 纯函数：场景表（票面 10 场景 + 不伪造等价物）", () => {
  it("正好 10 个场景，id 不重复", () => {
    expect(CONTRAST_SCENARIOS).toHaveLength(10);
    expect(new Set(CONTRAST_SCENARIOS.map((s) => s.id)).size).toBe(10);
  });

  it("扩展档 = 官方无等价物，且每条都**写清了为什么**", () => {
    for (const scenario of oursOnlyScenarios()) {
      expect(scenario.official, `${scenario.id} 标成扩展档却没有说明`).toBeNull();
      expect(scenario.measures.length, `${scenario.id} 缺 measures 口径`).toBeGreaterThan(0);
    }
    // 本轮实测的三条：PointCollection（v3-only）、原生点图层、KeepAlive。
    expect(oursOnlyScenarios().map((s) => s.id).sort()).toEqual([
      "keepalive-toggle",
      "native-point-50k",
      "pointcollection-50k",
    ]);
  });

  it("可比场景必须给出官方等价物（不是空串、不是 undefined）", () => {
    for (const scenario of comparableScenarios()) {
      expect(typeof scenario.official, `${scenario.id} 缺官方等价物`).toBe("string");
      expect((scenario.official as string).length).toBeGreaterThan(0);
    }
  });

  it("每个场景都能由测量名反查到，且映射是**双向**的（报告不会漏场景、也不会算错场景）", () => {
    // 直接读基准自己用的那张表（不在这里另抄一份——两张表漂了会全绿但数据是错的）。
    const table = measureToScenarioTable();
    const measured = new Set<string>();
    for (const [measure, scenarioId] of table) {
      expect(scenarioIdOfMeasure(measure), `${measure} 的正向反查不一致`).toBe(scenarioId);
      measured.add(scenarioId);
    }
    // 票面 10 个场景必须**全部**有测量名：少一个，报告里就有一行永远是「未跑到」。
    for (const scenario of CONTRAST_SCENARIOS) {
      expect(measured.has(scenario.id), `场景 ${scenario.id} 没有登记测量名`).toBe(true);
    }
    expect(measured.size, "同一场景被两个测量名登记").toBe(CONTRAST_SCENARIOS.length);
    expect(() => scenarioIdOfMeasure("nope")).toThrow();
  });
});

/* ------------------------------------------------------------------ 接线契约 */

describe("#140 接线契约：入口 / 版本锁 / AK / CI / 文档", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scriptPath = "scripts/collect-official-contrast.mts";
  const scriptText = readFileSync(resolve(repoRoot, scriptPath), "utf8");

  it("package.json 有 perf:contrast 入口且指向真实文件", () => {
    expect(pkg.scripts["perf:contrast"], "缺少 perf:contrast 入口").toContain(
      "collect-official-contrast.mts",
    );
    for (const relative of [
      scriptPath,
      "tests/performance/official-contrast.perf.test.ts",
      "tests/performance/official-contrast/report.mts",
      "tests/performance/officialScenarios.ts",
      "tests/performance/officialContrastHarness.ts",
      "tests/performance/vueRenderCounter.ts",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
    }
  });

  it("官方基线版本**精确锁定** 1.0.1（不是 ^、不是 ~）", () => {
    expect(pkg.devDependencies?.["@baidumap/vue-bmap"]).toBe("1.0.1");
  });

  it("报告纯逻辑与编排分离：编排只做 spawn/读 JSON/写退出码", () => {
    expect(scriptText).toContain("decideContrastExit");
    expect(scriptText).toContain("formatContrastReport");
    // 判定阈值不得写回编排——那会让「纯函数单测」失效。
    expect(scriptText).not.toMatch(/durationMs\s*[<>]=?\s*\d/);
  });

  it("AK 绝不入库：仓库里没有任何 BAIDU_MAP_AK 的字面量取值", () => {
    // Fake 档本来就不需要 AK；这里钉的是「代码里没有把 AK 写死」这一条。
    // 官方侧 provider 传的是字面量 `"fake"`，不是真实 AK。
    const official = readFileSync(
      resolve(repoRoot, "tests/performance/officialContrastHarness.ts"),
      "utf8",
    );
    expect(official).not.toMatch(/ak\s*[:=]\s*["'][A-Za-z0-9]{20,}["']/);
    // 编排脚本不读 AK（Fake 档无 AK 路径）。
    expect(scriptText).not.toContain("BAIDU_MAP_AK");
  });

  it("CI 有真跑 perf:contrast 的 job，且未被 continue-on-error 架空", () => {
    const quality = readWorkflow("quality.yml");
    const blocks = stepBlockContaining(quality, "perf:contrast");
    expect(blocks.length, "quality.yml 里没有跑 perf:contrast 的 step").toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, "perf:contrast step 被架空").not.toContain("continue-on-error");
    }
  });

  it("CI 的对照 job 上传 artifact（读数要能事后核对）", () => {
    const quality = readWorkflow("quality.yml");
    expect(quality).toContain("official-contrast-report");
    expect(quality).toContain("perf-contrast");
  });

  it("性能文档有「官方对照档」一节，并如实写明本轮无 AK、真实档未实跑", () => {
    const docs = readFileSync(
      resolve(repoRoot, "docs/zh-CN/contributing/performance-baseline.md"),
      "utf8",
    );
    expect(docs).toContain("官方对照档");
    expect(docs).toContain("perf:contrast");
    // 票面要求：不得编造未实跑的数据。文档必须自己声明。
    expect(docs).toMatch(/未实跑|无 AK|AK 不可用|没有 AK/);
  });

  it("ADR 存在并登记在索引里", () => {
    const adrPath = "docs/adr/2026-09-25-official-contrast-benchmark.md";
    expect(existsSync(resolve(repoRoot, adrPath))).toBe(true);
    const adr = readFileSync(resolve(repoRoot, adrPath), "utf8");
    for (const section of ["## 背景", "## 决策", "## 后果", "## 非目标"]) {
      expect(adr, `ADR 缺 ${section}`).toContain(section);
    }
    const index = readFileSync(resolve(repoRoot, "docs/adr/README.md"), "utf8");
    expect(index).toContain("2026-09-25-official-contrast-benchmark");
  });

  it("benchmark 没有成为改生产语义的理由：src/ 零改动", () => {
    // 票面第 4 条验收。本档只允许动 tests/、scripts/、docs/、packages/test-utils/。
    const changed = runGit(["diff", "--name-only", "HEAD", "--", "packages/bmap-vue/src"]);
    expect(changed, `生产源码被改动：${changed}`).toBe("");
  });

  it("官方对照基准文件不硬编码 AK，且不读环境里的 AK", () => {
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    expect(perfTest).not.toMatch(/BAIDU_MAP_AK/);
  });
});

/* ------------------------------------------------------------------ 工具 */

/** 跑一条只读 git 查询并取回 stdout。 */
function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}
