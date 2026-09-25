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
  BUNDLE_REPORT_VERSION,
  decideBundleExit,
  formatBundleReport,
  type BundleReport,
  type BundleSideReading,
} from "../performance/official-contrast/bundle.mts";
import { decideLiveContrastExit } from "../browser/official-contrast/report.mts";
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
    teardownMs: 4,
    sdkCalls: 0,
    callKind: "listen",
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

  it("可比场景缺官方侧读数 ⇒ 3（缺一侧**不算**已对照）", () => {
    // 场景行填了、`ours` 有读数，但声明了官方等价物却没拿到官方侧 ⇒ 票面要的
    // 「同场景对照」没发生。这是第 1 轮评审第 6 条要求补的那一条。
    const decision = decideContrastExit({
      ...base,
      expectedComparableScenarios: 7,
      comparableScenarioCount: 6,
    });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join()).toContain("缺官方侧读数");
  });

  it("可比场景两侧齐全 ⇒ 0（这项校验不制造假红）", () => {
    expect(
      decideContrastExit({
        ...base,
        expectedComparableScenarios: 7,
        comparableScenarioCount: 7,
      }).exitCode,
    ).toBe(0);
    // 不传这两项 = 本档不做这项校验（老调用点仍能给出确定结果）。
    expect(decideContrastExit(base).exitCode).toBe(0);
  });
});

/* ------------------------------------------------------------------ 纯函数：编排的退出码结算 */

describe("#140 编排结算：vitest 红 + 报告判 0 ⇒ 2（绝不按报告放行）", () => {
  const script = readFileSync(
    resolve(repoRoot, "scripts/collect-official-contrast.mts"),
    "utf8",
  );

  it("benchExit!==0 分支把判定为 0 的情况改判 2", () => {
    // 第 2 轮评审第 1 条。这条是本套最严重的一条假绿：基准里有大量**普通 `expect`**
    // （§3 的 setPosition / recreates、卸载残留归零、§6/§7 的资源构成、§10 的不重建），
    // 它们不写进 `invariants` 判定模型。其中一条挂掉时 vitest 非零退出，而 `afterAll`
    // 仍可能写出一份 `done=true` / 10-10 / 不变式全 PASS 的报告 ⇒ 判定 0。
    // 上一版把 `decision.exitCode` 原样写入 `process.exitCode`，于是**测试失败被吞成通过**。
    expect(script, "编排必须把「判定 0」与「vitest 非零」这个组合改判").toContain(
      "decision.exitCode === 0 ? 2 : decision.exitCode",
    );
    // 且必须留下一条可读的归因，而不是静默改码。
    expect(script, "改判时要说明归因").toContain("VITEST_FAILED_UNMODELLED");
  });

  it("vitest 红但报告明确判到 1/2/3 时按报告结算（那条 1 不能被重新压回 2）", () => {
    // 反向守卫：不能为了修「0 的假绿」把「1 永不可达」那条（第 1 轮评审第 7 条）又装回去。
    // `1 / 2 / 3` 三个取值都必须**原样透传**。
    expect(script, "1/2/3 原样透传的表达式不能被改回 benchExit!==0?2:…").not.toMatch(
      /process\.exitCode\s*=\s*benchExit\s*!==\s*0\s*\?\s*2/,
    );
    // 显式钉住这条表达式：它就是「报告判什么就结算什么（0 除外）」的实现。
    expect(script).toContain("const exitCode = decision.exitCode === 0 ? 2 : decision.exitCode;");
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

  it("没测到的场景两个耗时都为 null（渲染成 `-`），不填 0", () => {
    const text = formatContrastReport({
      report: makeReport({
        scenarios: [
          {
            id: "map-cold-mount",
            official: "Map",
            ours: makeSide({ durationMs: null, teardownMs: null }),
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
    // 两个耗时**各自**渲染成 `-`：动作与卸载都缺时不能只让一边缺，也不能填 0
    // （0 会被读成「快得不可能」）。
    expect(text).toMatch(/map-cold-mount\s+act=-ms teardown=-ms/);
  });

  it("卸载/销毁有独立读数与独立窗口（票面指标 5 是 mount/unmount 两个动作）", () => {
    // 第 2 轮评审第 5 条。场景名写着「mount / destroy」「mount / unmount」，此前
    // `durationMs` 只包 `act()`、teardown 完全在窗外 —— 销毁成本没有任何读数。
    // 报告里两个耗时**各自**带标签与差值，读者不必猜场景名的另一半测没测。
    const text = formatContrastReport({
      report: makeReport({
        scenarios: [
          {
            id: "map-cold-mount",
            official: "Map",
            ours: makeSide({ durationMs: 12, teardownMs: 5 }),
            officialSide: makeSide({ durationMs: 20, teardownMs: 3 }),
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
    expect(text, "两侧的 act 耗时都要打出来").toContain("act=12ms").and.toContain("act=20ms");
    expect(text, "两侧的 teardown 耗时都要打出来").toContain("teardown=5ms").and.toContain("teardown=3ms");
    // 差值列也带上卸载差，读者不必自己相减。
    expect(text, "差值列缺 teardown 差值").toMatch(/teardownΔ2ms/);

    // 且基准里 teardown 必须在**独立窗口**内计时：把它并进 act 的窗口会让时长不可归因。
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    expect(perfTest, "基准没有独立计时 teardown").toContain("const teardownStart = performance.now();");
    expect(perfTest, "teardown 读数没进指标").toContain(".teardown\`, readings.teardownMs");
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

  it("benchmark 没有成为改生产语义的理由：src/ 零改动（仅对显式开启的 benchmark PR 生效）", () => {
    // 票面第 4 条验收。本档只允许动 tests/、scripts/、docs/、packages/test-utils/。
    //
    // ⚠️⚠️ 这条约束是「**#140 这张 benchmark PR** 的属性」，不是「仓库从此禁止任何 PR 改
    // src」（第 2 轮评审第 2 条）。做成无条件永久 `test:unit` 用例的后果是：#156 合并后，
    // 下一张**任何**正常修改 `packages/bmap-vue/src/**` 的 PR 都会在 Unit & behavior
    // tests 里红；push 到 main 时还会拿 `github.event.before...HEAD` 做同样限制。
    //
    // 因此它必须**显式 opt-in**：CI 只在打了 `benchmark-no-src-change` 标签的 PR 上注入
    // `CONTRAST_DIFF_BASE`，本用例也只在拿到该 base 时才断言。没 opt-in 时它**不构成通过**，
    // 而是不适用——对应的「接线」在下一条用例里单独钉（防止它被悄悄删掉）。
    const base = process.env.CONTRAST_DIFF_BASE?.trim();
    if (!base) {
      // 未 opt-in：显式跳过，并把「为什么允许跳过」说清楚，避免读者以为它恒绿。
      expect(
        process.env.CONTRAST_ASSERT_NO_SRC,
        "注入了 CONTRAST_DIFF_BASE 却没声明 CONTRAST_ASSERT_NO_SRC=1：opt-in 要成对出现，" +
          "否则无法区分「本该断言」与「不适用」",
      ).not.toBe("1");
      return;
    }
    expect(
      process.env.CONTRAST_ASSERT_NO_SRC,
      "CI 注入了 base 却没声明这是一张 benchmark-only PR——门禁会误伤正常源码 PR",
    ).toBe("1");
    // ⚠️ 比的**基准**必须是本 PR 的 base，不是 `HEAD`（第 1 轮评审第 5 条）：
    // `git diff HEAD -- src` 在**干净的 CI checkout 上恒为空**（工作区 = HEAD），
    // 于是这条门禁在 CI 上恒绿，哪怕本 PR 的提交里真的动了 `src/`。必须比
    // 「PR 的 base …… HEAD」。
    const changed = runGit([
      "diff",
      "--name-only",
      `${base}...HEAD`,
      "--",
      "packages/bmap-vue/src",
    ]);
    expect(changed, `生产源码被本 PR 改动（base=${base}）：${changed}`).toBe("");
  });

  it("src 零改动门禁只挂在 opt-in 的 job 上，不在 test:unit 里", () => {
    const quality = readWorkflow("quality.yml");
    // `stepBlockContaining` 返回该 step 的**逐行数组**（沿用 workflow-helpers 的约定，
    // 其它门禁都 `join("\n")` 后再匹配），所以这里也要 join 一次。搜 `run:` 那一行
    // 而不是命令本身——文件里还有提到这个命令的说明性注释，搜命令会命中错误的区块。
    const unitStep = stepBlockContaining(quality, "run: pnpm test:unit");
    expect(unitStep.length, "找不到跑 test:unit 的 step").toBeGreaterThan(0);
    // ⚠️ 反向守卫（第 2 轮评审第 2 条）：base **不能**注入 `test:unit`。注入了就等于
    // 把「本 PR 不改 src」变成全仓每张 PR 的硬约束，合并后立刻开始误伤正常源码 PR。
    expect(
      stepCode(unitStep),
      "test:unit 不该注入 CONTRAST_DIFF_BASE（会把一次性 PR 属性变成永久仓库约束）",
    ).not.toContain("CONTRAST_DIFF_BASE");

    // 正向守卫：opt-in 的那个 step 必须在，且**由标签门控**（不是无条件）。
    // 搜 `CONTRAST_DIFF_BASE:` 这一**赋值行**而不是变量名本身——step 上方那段解释性注释
    // 里也提到了这个变量，按名字搜会命中注释、切出上一个 step 的区块（第一版就是这么
    // 假红的：断言在 `test:unit` 那个 step 上找标签门控，永远找不到）。
    const gated = stepCode(stepBlockContaining(quality, "CONTRAST_DIFF_BASE:"));
    expect(gated.length, "找不到注入 CONTRAST_DIFF_BASE 的 step").toBeGreaterThan(0);
    expect(gated, "opt-in 必须由 PR 标签门控，否则退化成无条件").toContain(
      "benchmark-no-src-change",
    );
    expect(gated, "opt-in 必须显式声明 CONTRAST_ASSERT_NO_SRC=1").toContain("CONTRAST_ASSERT_NO_SRC");
    expect(gated, "该 step 被架空").not.toContain("continue-on-error");
    // `...` 三点语法要历史里真的有 base，因此跑门禁的那个 job 必须不是浅克隆。
    expect(quality, "quality job 的 checkout 不是全历史，三点 diff 会取不到 base").toContain(
      "fetch-depth: 0",
    );
  });

  it("官方对照基准文件不硬编码 AK，且不读环境里的 AK", () => {
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    expect(perfTest).not.toMatch(/BAIDU_MAP_AK/);
  });

  it("基准红了**不**一律映射成 2：不变式被破坏时如实给 1", () => {
    // `recordInvariant` 用 `expect(...).toBe(true)` 让 vitest 非零退出；编排此前
    // `benchExit !== 0 ? 2 : …` 把它压成 2，于是文档写的「1 = 不变式被破坏」在唯一的
    // 正式入口 `pnpm perf:contrast` 上**从来没发生过**（第 1 轮评审第 7 条）。
    // 现在的契约是：报告与信封可读 ⇒ 按报告判定结算（可能是 1）；读不到报告才归 2。
    const code = stripComments(scriptText);
    expect(code, "编排仍把「基准红了」压成 2").not.toMatch(/benchExit\s*!==?\s*0\s*\?\s*2/);
    expect(code, "编排没有按报告判定结算").toContain("const decision = decide(report)");
  });

  it("「采齐了没」数的是真测到的场景，不是填了行的场景", () => {
    // `report.scenarios.length` 恒等于场景表条数（报告永远逐条填行）⇒ 拿它判采齐是
    // 恒真的假绿（第 1 轮评审第 6 条）。必须数 `ours !== null`。
    const code = stripComments(scriptText);
    expect(code, "编排仍在用 scenarios.length 当采齐数").not.toMatch(
      /scenarioCount:\s*report\.scenarios\.length/,
    );
    expect(code, "编排没数真正测到的场景").toContain("entry.ours !== null");
    // 可比场景缺官方侧读数也要报出来。
    expect(code, "编排不校验可比场景的官方侧读数").toContain(
      "entry.officialSide !== null",
    );
  });

  it("SDK 调用那一列**带名字**：票面原口径进 notMeasured，不冒充「总数」", () => {
    // `sdkCalls` 量的只是某一个调用面（listen / setPosition / setPath），真实与 Fake 都
    // 没有「全部 SDK 调用」的单一计数器；`renderCallbacks` 是组件渲染不是 watcher 回调。
    // 列名冒充它量的东西比没有这一列更坏（第 1 轮评审第 8 条）。
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    const report = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast/report.mts"),
      "utf8",
    );
    expect(report, "报告读数没有 callKind").toContain("callKind");
    expect(report, "人读报告仍把那一列叫笼统的 calls=").not.toMatch(/calls=\$\{/);
    expect(perfTest, "基准没把票面的「SDK 调用总数」写进 notMeasured").toContain(
      "SDK 调用总数",
    );
    expect(perfTest, "基准没把票面的「watcher 回调次数」写进 notMeasured").toContain(
      "watcher 回调次数",
    );
  });

  it("§3 的换数据是**真的会更新**的：渲染闭包读 data.value", () => {
    // 渲染闭包捕获 `first` 就等于换引用也不更新，场景退化成 no-op，而「0 次重建」在
    // no-op 下恰好也是 0——两件方向相反的事互相抵消，基准全绿（第 1 轮评审第 1 条）。
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    const section = perfTest.slice(
      perfTest.indexOf("§3 1k Marker position update"),
      perfTest.indexOf("§4 Polyline 10k"),
    );
    expect(section, "§3 的渲染闭包没读 data.value").toMatch(/data:\s*data\.value/);
    // 语义断言：真的发了 1 000 次位置写入，且没有重建覆盖物。
    expect(section, "§3 没有断言 1 000 次 setPosition").toMatch(
      /delta\.sdkCalls[\s\S]{0,80}toBe\(1_000\)/,
    );
    expect(section, "§3 没有断言 0 次重建").toMatch(/delta\.recreates[\s\S]{0,80}toBe\(0\)/);
  });

  it("更新类场景的两侧计时窗对称：官方侧的挂载与 ready 落在 setup，不在 act", () => {
    // 官方侧此前在 act 里 `mountOfficial(...)`（含 ready 等待），本库侧在 setup 里挂 ——
    // 官方侧的时长 / 重建数 / 渲染数把「首挂」一起吃进去，两侧量的不是同一件事
    // （第 1 轮评审第 2 条）。
    const perfTest = readFileSync(
      resolve(repoRoot, "tests/performance/official-contrast.perf.test.ts"),
      "utf8",
    );
    // 切片覆盖 §3–§8（更新 / 生命周期类场景，含中间的两条扩展档 §6/§7——它们官方侧
    // 本就无等价物、不挂官方，故本区间应恰好出现 4 处 `mountOfficial`）。
    const section = perfTest.slice(
      perfTest.indexOf("§3 1k Marker position update"),
      perfTest.indexOf("§9 Router"),
    );
    // 每个官方侧 `mountOfficial` 调用都必须**先**经过一个 `setup:`（挂载与 ready 等待
    // 在 setup 里），不能出现在 `act:` 之后。逐个挂载点检查它前面最近的阶段键。
    const mounts = [...section.matchAll(/mountOfficial\(/g)];
    expect(mounts.length, "§3/§4/§5/§8 应有 4 处官方侧挂载").toBe(4);
    for (const mount of mounts) {
      const before = section.slice(0, mount.index);
      const lastSetup = before.lastIndexOf("setup: async");
      const lastAct = before.lastIndexOf("act: async");
      expect(
        lastSetup,
        "有一处官方侧挂载不在 setup 里（最近的阶段键是 act 或更早）",
      ).toBeGreaterThan(lastAct);
    }
  });
});

/* ------------------------------------------------------------------ 纯函数：包体档 */

describe("#140 纯函数：包体档的退出码", () => {
  const base = {
    envelopeIssues: [] as string[],
    fatal: null,
    blockedReason: null,
    done: true,
    version: "1.0.0-rc.0",
  };

  it("入口没变大 ⇒ 0", () => {
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 1000,
      baseline: makeBundleSide({ entryBytes: 1000 }),
    });
    expect(decision.exitCode).toBe(0);
    expect(decision.ok).toBe(true);
  });

  it("入口变小 ⇒ 0（不因为「比基线小」而额外给理由——它不是一张成绩单）", () => {
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 900,
      baseline: makeBundleSide({ entryBytes: 1000 }),
    });
    expect(decision.exitCode).toBe(0);
  });

  it("本库入口相对**自己基线**变大 ⇒ 1（唯一能返回 1 的原因）", () => {
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 1200,
      baseline: makeBundleSide({ entryBytes: 1000 }),
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join()).toMatch(/BUNDLE_REGRESSION/);
    expect(decision.reasons.join()).toMatch(/\+200B/);
  });

  it("**不比官方**：官方那个包比本库小多少都不产生任何理由", () => {
    // 这一条是票面「不写 X 倍更快」的落点：官方小 8 万字节也不能变成一条判失败理由。
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 194_704,
      baseline: makeBundleSide({ entryBytes: 194_704 }),
    });
    expect(decision.exitCode).toBe(0);
    expect(decision.reasons).toEqual([]);
  });

  it("没有基线 ⇒ 3（不是通过），**不是** 0", () => {
    // 「还没建立基准」与「跑过了且没回退」必须分开——否则首轮会拿到一个无来源的绿。
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 1000,
      baseline: undefined,
    });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join()).toMatch(/没有基线/);
  });

  it("基线查无此项（null）⇒ 2，与「压根没读基线」分开报", () => {
    // 合成一处会得到一个查不到原因的绿：null 是「文件在但对不上」，undefined 是「文件都没有」。
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 1000,
      baseline: null,
    });
    expect(decision.exitCode).toBe(2);
  });

  it("基线是另一版本 ⇒ 2（不可归因），**不是** 1 回退", () => {
    // 拿 v1 的基线比 v2 的产物，得到的差值没有任何意义——那是量错了，不是变重了。
    const decision = decideBundleExit({
      ...base,
      oursEntryBytes: 5000,
      baseline: makeBundleSide({ entryBytes: 1000, version: "1.0.0-rc.0" }),
      version: "1.1.0",
    });
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join()).toMatch(/BASELINE_VERSION_DRIFT/);
  });

  it("脚手架失败优先级高于回退（fatal ⇒ 2）", () => {
    const decision = decideBundleExit({
      ...base,
      fatal: "vite 不存在",
      oursEntryBytes: 1200,
      baseline: makeBundleSide({ entryBytes: 1000 }),
    });
    expect(decision.exitCode).toBe(2);
  });
});

describe("#140 纯函数：包体档的人读报告", () => {
  it("报告自证**打包条件**（换配置数字就换意义，配置必须随读数走）", () => {
    const text = formatBundleReport({
      report: makeBundleReport(),
      decision: { exitCode: 0, ok: true, reasons: [] },
    });
    expect(text).toContain("external[vue]");
    expect(text).toContain("minify=true");
    expect(text).toContain("target=es2020");
  });

  it("只给**字节**差，不给百分比、不给「X 倍更快」", () => {
    // 票面禁止无支撑的排名说法。百分号与「倍」都不该出现在这张表里。
    const text = formatBundleReport({
      report: makeBundleReport(),
      decision: { exitCode: 0, ok: true, reasons: [] },
    });
    expect(text).not.toMatch(/\d+(\.\d+)?%/);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*倍/);
  });

  it("「发布物」字节排除 .map / .d.ts（否则量到的是 sourcemap 偏好）", () => {
    const text = formatBundleReport({
      report: makeBundleReport(),
      decision: { exitCode: 0, ok: true, reasons: [] },
    });
    expect(text).toContain("不含 .map / .d.ts");
  });

  it("两份产物都自述 import 列表（两侧是同一份任务的物证）", () => {
    const report = makeBundleReport();
    // vue 是 peer 依赖，external 掉了它，所以两侧产物都只应留下 vue 一个 specifier。
    expect(report.ours.entryImports).toEqual(["vue"]);
    expect(report.official.entryImports).toEqual(["vue"]);
  });
});

/* ------------------------------------------------------------------ 接线契约：包体档 */

describe("#140 接线契约：包体档", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scriptPath = "scripts/collect-bundle-contrast.mts";
  const scriptText = readFileSync(resolve(repoRoot, scriptPath), "utf8");

  it("package.json 有 perf:contrast:bundle 入口，且四类文件都在", () => {
    expect(pkg.scripts["perf:contrast:bundle"], "缺少 perf:contrast:bundle 入口").toContain(
      "collect-bundle-contrast.mts",
    );
    for (const relative of [
      scriptPath,
      "tests/performance/official-contrast/bundle.mts",
      "fixtures/consumer/shake/basic-ours.ts",
      "fixtures/consumer/shake/basic-official.ts",
      "fixtures/consumer/shake/bundle-contrast.config.mjs",
      "tests/performance/bundle-baseline.json",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
    }
  });

  it("两侧入口形状**同源**：官方侧是本库那份的逐行对照，不许各挑各的轻量面", () => {
    // 判据：两个入口 import 的**具名标识符集合**必须一致。挑轻量面（少 import 一个）
    // 就能把包体差做小 —— 这是这条读数最容易被做假的地方，所以钉在代码上。
    const named = (file: string): string[] => {
      const text = readFileSync(resolve(repoRoot, file), "utf8");
      const match = /import\s*\{([^}]*)\}/.exec(text);
      if (!match) throw new Error(`${file} 没有具名 import`);
      return match[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .sort();
    };
    const ours = named("fixtures/consumer/shake/basic-ours.ts");
    const official = named("fixtures/consumer/shake/basic-official.ts");
    expect(official, "两侧入口的 import 形状不一致——包体差不可比").toEqual(ours);
    expect(ours).toEqual(["BMapProvider", "InfoWindow", "Map", "Marker"]);
  });

  it("两侧入口都是**顶层副作用**（不是只有 export const——那会被摇成 0 字节）", () => {
    for (const file of [
      "fixtures/consumer/shake/basic-ours.ts",
      "fixtures/consumer/shake/basic-official.ts",
    ]) {
      const text = readFileSync(resolve(repoRoot, file), "utf8");
      expect(text, `${file} 没有顶层副作用`).toMatch(/globalThis\.__basic\w+Probe\s*=/);
    }
  });

  it("基线是**独立**于运行时 baseline.json 的文件（混进去会炸掉那边的指标集校验）", () => {
    const runtimeBaseline = resolve(repoRoot, "tests/performance/baseline.json");
    const bundleBaseline = resolve(repoRoot, "tests/performance/bundle-baseline.json");
    expect(bundleBaseline).not.toBe(runtimeBaseline);
    expect(existsSync(bundleBaseline)).toBe(true);
    // 基线里带的必须是**包体**读数，不能是运行时指标。
    const parsed = JSON.parse(readFileSync(bundleBaseline, "utf8")) as {
      ours: { entryBytes: number; package: string };
    };
    expect(parsed.ours.package).toBe("bmap-vue");
    expect(typeof parsed.ours.entryBytes).toBe("number");
  });

  it("编排不判阈值：判定只在纯函数里", () => {
    expect(scriptText).toContain("decideBundleExit");
    expect(scriptText).toContain("formatBundleReport");
    expect(scriptText).not.toMatch(/entryBytes\s*[<>]=?\s*\d/);
  });

  it("打包条件是**读出来的**而不是手抄的（手抄的那份会与真实配置静默漂移）", () => {
    // 手写一份 `{external, minify, target}` 常量看着无害，危害在于：改配置不改常量 →
    // 报告印着「minify=true」而实际没压缩 → 基线在错误前提下录下，且永远没人发现。
    // 判据：脚本必须 **import** 那个配置文件并从它的 default 导出里取值。
    expect(scriptText).toContain("pathToFileURL(CONFIG)");
    expect(scriptText).toContain("await import(");
    // 反向：不允许出现手写的字面量 recipe（`external: ["vue"]` 这种）。
    expect(scriptText).not.toMatch(/external:\s*\[\s*["']vue["']\s*\]/);
    expect(scriptText).not.toMatch(/minify:\s*["']true["']/);
  });

  it("dist 缺失时按脚手架失败报「先 build:package」，**不**拿 src 现编顶替", () => {
    // 拿 src 编一份量到的不是发布物。dist 缺失必须显式失败。
    expect(scriptText).toContain("BUNDLE_DIST_MISSING");
    expect(scriptText).toContain("build:package");
  });

  it("产物为 0 字节 / 被摇空时读数无效，脚本必须识别", () => {
    // 否则量到的「包体」是「什么都没打包」——一个恒为 0 的漂亮数字。
    expect(scriptText).toContain("BUNDLE_EMPTY_PROBE");
  });

  it("官方版本漂移时脚本自己拦（不是靠人记得 baseline 是 1.0.1）", () => {
    expect(scriptText).toContain("CONTRAST_OFFICIAL_VERSION_DRIFT");
    expect(scriptText).toContain("OFFICIAL_BASELINE_VERSION");
  });

  it("CI 里包体档真跑、且先 build:package（缺 dist 会 exit 2）", () => {
    const quality = readWorkflow("quality.yml");
    const blocks = stepBlockContaining(quality, "perf:contrast:bundle");
    expect(blocks.length, "quality.yml 里没有跑 perf:contrast:bundle 的 step").toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, "perf:contrast:bundle step 被架空").not.toContain("continue-on-error");
    }
    // dist 是前置：把 build 放在 contrast:bundle **之前**，否则这一档恒定 exit 2。
    const buildAt = quality.indexOf("pnpm build:package");
    const contrastAt = quality.indexOf("pnpm perf:contrast:bundle");
    expect(buildAt, "quality.yml 里没找到 build:package").toBeGreaterThan(-1);
    expect(contrastAt, "quality.yml 里没找到 perf:contrast:bundle").toBeGreaterThan(-1);
    expect(buildAt, "build:package 必须排在 perf:contrast:bundle 之前").toBeLessThan(contrastAt);
  });

  it("包体档的读数也能事后核对（上传 artifact）", () => {
    const quality = readWorkflow("quality.yml");
    expect(quality).toContain("official-contrast-bundle-report");
    expect(quality).toContain("perf-contrast-bundle/bundle-report.json");
  });
});

/* ------------------------------------------------------------------ 接线契约：真实浏览器档 */

describe("#140 接线契约：真实浏览器档（骨架，本轮未实跑）", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const liveScriptPath = "scripts/collect-official-contrast-live.mts";
  const liveScript = readFileSync(resolve(repoRoot, liveScriptPath), "utf8");
  const pageText = readFileSync(resolve(repoRoot, "tests/browser/official-contrast/main.ts"), "utf8");
  const liveReport = readFileSync(resolve(repoRoot, "tests/browser/official-contrast/report.mts"), "utf8");

  it("package.json 有 perf:contrast:live 入口，且档位二的四类文件都在", () => {
    expect(pkg.scripts["perf:contrast:live"], "缺少 perf:contrast:live 入口").toContain(
      "collect-official-contrast-live.mts",
    );
    for (const relative of [
      liveScriptPath,
      "tests/browser/official-contrast/main.ts",
      "tests/browser/official-contrast/report.mts",
      "tests/browser/official-contrast/index.html",
      "tests/browser/official-contrast/vite.config.ts",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
    }
  });

  it("新目录在 typecheck 范围内（漏了 include 就是个假绿）", () => {
    const tsconfig = readFileSync(resolve(repoRoot, "tsconfig.tests.json"), "utf8");
    // include 里的 glob 要同时覆盖 .ts 与 .mts —— TS 的 include **不支持** brace expansion。
    expect(tsconfig).toContain("tests/browser/official-contrast/**/*.ts");
    expect(tsconfig).toContain("tests/browser/official-contrast/**/*.mts");
  });

  it("AK 只经 BAIDU_MAP_AK 进入，**不进 argv、不进页面 URL、不进任何子进程 env**", () => {
    const code = stripComments(liveScript);
    expect(code).toContain("BAIDU_MAP_AK");
    // ⚠️ **不接受** `--ak=`：argv 进本进程命令行，因此进 `ps`——同机器任何进程
    // （CI 并行 step、容器 sidecar、开发者机器上的任何程序）都能无凭据读到（第 1 轮评审
    // 第 4 条）。环境变量至少不进 OS 进程表。
    expect(code, "编排仍支持 --ak=（argv 进 ps）").not.toMatch(/argValue\(\s*["']ak["']\s*\)/);
    expect(code, "编排仍把 AK 从 argv 读进来").not.toMatch(/\bak\s*=\s*[^;]*argValue/);
    // 两个子进程都必须拿**净化 env**（BAIDU_MAP_AK 被显式删掉）。
    expect(code, "没有净化子进程 env 的辅助函数").toContain("childEnvWithoutAk");
    expect(code, "净化 env 没有显式删掉 BAIDU_MAP_AK").toContain("delete env.BAIDU_MAP_AK");
    // vite 与 chrome 两处都要用；`{}` = 继承父 env = AK 进了浏览器进程的整份环境。
    const uses = code.match(/childEnvWithoutAk\(/g) ?? [];
    expect(uses.length, "childEnvWithoutAk 调用点少于 2 处（vite / chrome）").toBeGreaterThanOrEqual(2);
    expect(code, "chrome 仍以 {} 继承父 env（含 AK）").not.toMatch(/env:\s*\{\s*\}\s*,?\s*\n?\s*\)/);
    // 页面 URL 仍然带非敏感的运行标识（run / ours / official）——它们会进 vite 日志与 CDP。
    expect(pageText).toContain("URLSearchParams(location.search)");
    // 但 AK **不在** URL 构造里。
    const urlConstruction = /new URLSearchParams\(\{[\s\S]*?\}\)/.exec(code);
    expect(urlConstruction, "没找到页面 URL 的构造").not.toBeNull();
    expect(urlConstruction?.[0], "AK 出现在页面 URL 查询串里——那会进 chrome argv 与 vite 请求日志")
      .not.toMatch(/\bak\b/);
    // vite env 会被 import.meta.env 内联进产物，同样不能走。
    expect(stripComments(pageText)).not.toContain("import.meta.env");
    expect(code).not.toMatch(/VITE_[A-Z_]*AK/);
  });

  it("真实档的 redraw 窗口**真的重画**：换一份数据，不是只等一次 paint", () => {
    // `redraw` 此前只是 `await paintBoundary()`，没换任何数据——窗口名与实际量的东西
    // 对不上，而 `heapGrowthBytes` 的注释还写着「换数据后的堆增长」（第 1 轮评审第 3 条）。
    const code = stripComments(pageText);
    expect(code, "redraw 窗口没换数据").toMatch(/items\.value\s*=\s*moved/);
    expect(code, "没造那份平移后的数据").toContain("makeMovedItems");
    // 造数必须在窗口**之外**且跨一个 macrotask，否则 long task 窗口交集量到的是造数。
    expect(code, "造数没有在 redraw 窗口之外").toMatch(
      /makeMovedItems\([\s\S]{0,200}?settle\(\)[\s\S]{0,200}?redrawStart/,
    );
  });

  it("真实档如实标注它**不是**跨库对照（本场景官方无等价物 ⇒ official 恒为 null）", () => {
    // 一个「能 exit 0、但没有 official 侧」的骨架不该把 #140 的验收项提前关掉
    // （第 1 轮评审第 3 条）。因此代码与文档都要说清这是已知缺口。
    expect(stripComments(pageText)).toContain("measureOfficial");
    expect(pageText, "页面没写明真实档尚未完成双边对照").toMatch(/不是\*\*跨库对照|已知缺口/);
    expect(liveScript, "编排没写明本轮未实跑").toMatch(/未实跑/);
  });

  it("AK 经 **CDP** 注入（内存 socket，不进 OS 进程表 / 日志 / 磁盘）", () => {
    // URL 与 argv 都进 `ps`：同机器上任何进程都能无凭据读到。CI 上并行 step、
    // 容器 sidecar、开发者机器上的任何程序都算。CDP 是本进程持有的内存通道。
    expect(liveScript).toContain("injectAkOverCdp");
    expect(liveScript).toContain("__CONTRAST_AK_TAKEN__");
    expect(pageText).toContain("__CONTRAST_AK_TAKEN__");
    // 一次性：领完自删，AK 不留在页面上给后续 Runtime.evaluate 读走。
    expect(liveScript).toContain("delete window.__CONTRAST_AK_TAKEN__");
  });

  it("vite 不打请求日志（info 级会把 URL 写进 CI 的 job log）", () => {
    // 脚本 stdout 出口过了 redactAk，但**子进程**的 stdout 不经过那个出口。
    const viteConfig = readFileSync(resolve(repoRoot, "tests/browser/official-contrast/vite.config.ts"), "utf8");
    expect(stripComments(viteConfig)).toContain('logLevel: "silent"');
    // 编排也不许用 --verbose 把子进程 stdio 继承到终端 / CI log。
    expect(liveScript).toMatch(/verbose:\s*false/);
  });

  it("AK 只以**布尔**进报告，报告里没有 AK 字段", () => {
    // 报告会被当 CI artifact 上传（读者范围比 secrets 大）；AK 值本身不该出现在里面。
    expect(liveReport).toContain("akUsed");
    expect(liveReport).not.toMatch(/readonly ak\b/);
    const reportType = /export interface LiveContrastReport \{[\s\S]*?\n\}/.exec(liveReport);
    expect(reportType?.[0], "报告类型里不该有 AK 值字段").not.toMatch(/\bak:\s*string/);
  });

  it("AK 在**两条出口**都被 redact（stdout 与落盘 JSON，漏一条就把 AK 写进 CI 日志）", () => {
    expect(liveScript).toContain("redactAk");
    // 至少两处：人读表格 + 落盘 JSON。
    const redactions = liveScript.match(/redactAk\(/g) ?? [];
    expect(redactions.length, "redactAk 调用点少于 2 处").toBeGreaterThanOrEqual(3);
    expect(liveReport).toContain("redactAk");
  });

  it("编排与页面都**不含**任何 AK 字面量", () => {
    for (const [name, text] of [
      ["collect-official-contrast-live.mts", liveScript],
      ["main.ts", pageText],
      ["report.mts", liveReport],
    ] as const) {
      expect(text, `${name} 里有疑似 AK 字面量`).not.toMatch(/[?&]ak=[A-Za-z0-9]{20,}/);
    }
  });

  it("缺 AK 走退出码 3（blocked），**不是** 0——「没跑」≠「通过」", () => {
    expect(liveScript).toMatch(/fail\(3,/);
    expect(pageText).toContain("blockedReason");
    expect(pageText).toMatch(/缺 AK/);
  });

  it("页面用 `ready` **公开事件**等就绪，不探 DOM（探 .bm-viewport 是在读上游内部结构）", () => {
    expect(pageText).toContain("onReady");
    expect(stripComments(pageText)).not.toMatch(/bm-viewport/);
    // 没有超时保护时 ready 不来会永远挂住 —— 编排只能打成 blocked 且报不出卡在哪。
    expect(pageText).toContain("withTimeout");
  });

  it("本轮**未实跑**如实标注在页面与编排的头部（不假装有数据）", () => {
    expect(pageText).toMatch(/未实跑/);
    expect(liveScript).toMatch(/未实跑/);
  });

  it("真实档没有「比官方慢就算回退」这条判据", () => {
    const decision = decideLiveContrastExit({
      envelopeIssues: [],
      fatal: null,
      blockedReason: null,
      done: true,
      expectedScenarioCount: 1,
      scenarioCount: 1,
    });
    expect(decision.exitCode).toBe(0);
    expect(decision.reasons).toEqual([]);
  });

  it("真实档判不出退出码 1（没有不变式就不假装有门禁）", () => {
    // 骨架阶段尚未接 SDK 侧的实例重建信号；`decideLiveContrastExit` 的返回类型里就没有 1。
    // 这一条钉住「别为了让契约对称而加一个恒不触发的 1」。
    const reachable = [0, 1, 2, 3].filter((code) => {
      const decision = decideLiveContrastExit({
        envelopeIssues: code === 2 ? ["X"] : [],
        fatal: null,
        blockedReason: code === 3 ? "缺 AK" : null,
        done: code !== 3,
        expectedScenarioCount: 1,
        scenarioCount: code === 3 ? 0 : 1,
      });
      return decision.exitCode === code;
    });
    expect(reachable).not.toContain(1);
  });
});

/* ------------------------------------------------------------------ 夹具：包体档 */

function makeBundleSide(overrides: Partial<BundleSideReading> = {}): BundleSideReading {
  return {
    package: "bmap-vue",
    version: "1.0.0-rc.0",
    entryBytes: 1000,
    chunkBytes: 0,
    cssBytes: 0,
    chunkCount: 0,
    distBytes: 5000,
    entryImports: ["vue"],
    ...overrides,
  };
}

function makeBundleReport(overrides: Partial<BundleReport> = {}): BundleReport {
  return {
    version: BUNDLE_REPORT_VERSION,
    mode: "bundle",
    done: true,
    fatal: null,
    blockedReason: null,
    notes: [],
    recipe: { external: ["vue"], minify: "true", target: "es2020", format: "esm" },
    ours: makeBundleSide(),
    official: makeBundleSide({ package: "@baidumap/vue-bmap", version: OFFICIAL_BASELINE_VERSION }),
    startedAt: "2026-09-25T00:00:00.000Z",
    finishedAt: "2026-09-25T00:00:10.000Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ 工具 */

/** 跑一条只读 git 查询并取回 stdout。 */
function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

/**
 * 一个 step 区块的**可执行** YAML（去注释行）。
 *
 * 必须去注释再断言「这个 step 有没有注入 X」：step 区块的切片从本 step 的 `-` 行起算、
 * 到下一个同级 `-` 行止，因此**上一个 step 之后的说明性注释**会落进这个区块。workflow
 * 里恰好有一段注释在讲「为什么不能注入 CONTRAST_DIFF_BASE」——文本匹配会把它读成
 * 「注入了」，于是门禁自己把自己写的说明当成违规。
 */
function stepCode(block: readonly string[]): string {
  return block
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/**
 * 去掉行注释与块注释，只留**可执行代码**。
 *
 * 「这个文件**没有**做 X」这类断言必须只在代码上判：`main.ts` 的头部注释正当地
 * 解释着「为什么不用 `import.meta.env`」「为什么不用 `.bm-viewport`」，全文匹配会把
 * 那些解释当成违规——于是想守住契约的人只能把注释删掉，契约反而失去解释。
 * 朴素的行注释正则足够：这几份文件不把 `//` 写在字符串里。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}
