import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyBootstrapFailure,
  evaluateSmokeReport,
  SmokeBlocked,
  SmokeFailure,
  SmokeRun,
  bootstrapDeclarations,
  checkReportEnvelope,
  withBlockedTimeout,
  type SmokeCheckResult,
  type SmokeReport,
  type SmokeUnhandledEntry,
  type SmokeVerdict,
} from "../browser/jsapi-v4/report.mts";
import { allCheckSpecs, requiredChecks, SMOKE_CHECKS, UNATTRIBUTED_WHITELIST } from "../browser/jsapi-v4/registry.mts";

/**
 * R25-E / issue #74 的「承接欠账 1、2」：smoke 判定补齐五态、required 只接受 pass、
 * 取消「按跨域来源一律豁免异常」。
 *
 * 这门禁本身很容易写成空转（断言恒真 / 只覆盖 happy path），所以每条规则都配一条**反证**：
 * 把期望调成「必须红」，并让「正证守卫」由同一个用例自证（不依赖别的用例提供正证）。
 */

const TODAY = "2026-09-13";

function check(
  id: string,
  verdict: SmokeVerdict,
  extra: Partial<SmokeCheckResult> = {},
): SmokeCheckResult {
  return { id, name: id, verdict, durationMs: 1, ...extra };
}

function report(checks: SmokeCheckResult[], unhandled: SmokeUnhandledEntry[] = []): SmokeReport {
  return {
    mode: "live",
    runId: "run-1",
    akUsed: true,
    checks,
    unhandled,
    env: {},
    startedAt: "2026-09-13T00:00:00.000Z",
    finishedAt: "2026-09-13T00:00:01.000Z",
    durationMs: 1000,
  };
}

const REQUIRED = ["a", "b"];

describe("#74 smoke 门禁：required 只接受 pass", () => {
  it("required 全 pass 且没有其他结论时放行（exit 0）", () => {
    const gate = evaluateSmokeReport(report([check("a", "pass"), check("b", "pass")]), {
      required: REQUIRED,
      today: TODAY,
    });
    expect(gate.ok).toBe(true);
    expect(gate.exitCode).toBe(0);
    expect(gate.reasons).toEqual([]);
  });

  it('required 里出现 blocked 时不可放行（exit 3，不是 0）', () => {
    const gate = evaluateSmokeReport(
      report([check("a", "pass"), check("b", "blocked", { reason: "没有 AK" })]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.ok).toBe(false);
    expect(gate.exitCode).toBe(3);
    expect(gate.requiredNotPass).toEqual([{ id: "b", verdict: "blocked" }]);
  });

  it("required 里出现带理由的 skipped / 未过期的 expected-failure 也不可放行", () => {
    for (const verdict of ["skipped", "expected-failure"] as const) {
      const extra =
        verdict === "skipped"
          ? { reason: "本档不执行" }
          : { tracking: "#32", expires: "2026-12-31", reason: "已知缺口" };
      const gate = evaluateSmokeReport(report([check("a", "pass"), check("b", verdict, extra)]), {
        required: REQUIRED,
        today: TODAY,
      });
      expect(gate.ok, verdict).toBe(false);
      expect(gate.exitCode, verdict).toBe(3);
    }
  });

  it('required 的检查「根本没跑」必须红，而不是被当成通过（REQUIRED_CHECK_MISSING）', () => {
    const gate = evaluateSmokeReport(report([check("a", "pass")]), {
      required: REQUIRED,
      today: TODAY,
    });
    expect(gate.ok).toBe(false);
    expect(gate.exitCode).toBe(1);
    expect(gate.requiredMissing).toEqual(["b"]);
    expect(gate.reasons.some((line) => line.startsWith("REQUIRED_CHECK_MISSING"))).toBe(true);
  });

  it("required 之外的 fail 同样让整轮红（可选检查不是免死金牌）", () => {
    const gate = evaluateSmokeReport(
      report([check("a", "pass"), check("b", "pass"), check("z", "fail", { code: "BMAP_X" })]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.exitCode).toBe(1);
    expect(gate.failing).toContain("z");
  });
});

describe("#74 smoke 门禁：expected-failure 必须有可追踪的元数据", () => {
  it("缺 tracking / 缺 expires / 日期格式不对 → 退化为 fail", () => {
    const cases: Partial<SmokeCheckResult>[] = [
      { expires: "2026-12-31" },
      { tracking: "#32" },
      { tracking: "#32", expires: "2099/12/31" },
    ];
    for (const extra of cases) {
      const gate = evaluateSmokeReport(
        report([check("a", "pass"), check("b", "pass"), check("c", "expected-failure", extra)]),
        { required: REQUIRED, today: TODAY },
      );
      expect(gate.exitCode, JSON.stringify(extra)).toBe(1);
      expect(gate.reasons.some((line) => line.startsWith("EXPECTED_FAILURE_WITHOUT_METADATA"))).toBe(
        true,
      );
    }
  });

  it("已过期的 expected-failure → fail（到期即重新变红，不会永久豁免）", () => {
    const gate = evaluateSmokeReport(
      report([
        check("a", "pass"),
        check("b", "pass"),
        check("c", "expected-failure", { tracking: "#32", expires: "2026-01-01" }),
      ]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.exitCode).toBe(1);
    expect(gate.reasons.some((line) => line.startsWith("EXPECTED_FAILURE_EXPIRED"))).toBe(true);
  });

  it("带齐元数据且未过期的 expected-failure 只到 blocked（exit 3，仍不可放行）", () => {
    const gate = evaluateSmokeReport(
      report([
        check("a", "pass"),
        check("b", "pass"),
        check("c", "expected-failure", { tracking: "#32", expires: "2026-12-31" }),
      ]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.exitCode).toBe(3);
    expect(gate.inconclusive).toContain("c");
  });
});

describe("#74 smoke 门禁：skipped 不允许静默", () => {
  it("skipped 缺 reason → fail", () => {
    const gate = evaluateSmokeReport(
      report([check("a", "pass"), check("b", "pass"), check("c", "skipped")]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.exitCode).toBe(1);
    expect(gate.reasons.some((line) => line.startsWith("SKIPPED_WITHOUT_REASON"))).toBe(true);
  });

  it("skipped 带 reason → 单列并阻止放行（exit 3）", () => {
    const gate = evaluateSmokeReport(
      report([check("a", "pass"), check("b", "pass"), check("c", "skipped", { reason: "缺前置" })]),
      { required: REQUIRED, today: TODAY },
    );
    expect(gate.exitCode).toBe(3);
    expect(gate.inconclusive).toContain("c");
  });
});

describe("#74 smoke 门禁：取消「跨域来源一律豁免异常」", () => {
  const attributed: SmokeUnhandledEntry = {
    kind: "error",
    message: "boom",
    source: "http://localhost:5212/main.ts",
    attributed: true,
    signature: "own",
  };
  const unattributed: SmokeUnhandledEntry = {
    kind: "error",
    message: "Script error.",
    source: "",
    attributed: false,
    signature: "third-party-script-error",
  };
  const passing = [check("a", "pass"), check("b", "pass")];

  it("能归属到本库的未处理异常 → fail", () => {
    const gate = evaluateSmokeReport(report(passing, [attributed]), {
      required: REQUIRED,
      today: TODAY,
    });
    expect(gate.exitCode).toBe(1);
    expect(gate.reasons.some((line) => line.startsWith("UNHANDLED_ATTRIBUTED"))).toBe(true);
  });

  it("未归因异常在**空**白名单下 → fail（跨域不再自动豁免；这也是正证守卫）", () => {
    expect(UNATTRIBUTED_WHITELIST).toEqual([]);
    const gate = evaluateSmokeReport(report(passing, [unattributed]), {
      required: REQUIRED,
      whitelist: UNATTRIBUTED_WHITELIST,
      today: TODAY,
    });
    expect(gate.exitCode).toBe(1);
    expect(gate.reasons.some((line) => line.startsWith("UNATTRIBUTED_ERROR_UNLISTED"))).toBe(true);
  });

  it("白名单条目字段不全 → fail；过期 → fail；完整且在期内 → blocked（仍不可放行）", () => {
    const base = {
      signature: "third-party-script-error",
      reason: "上游脚本在跨域下抛错，无法归属",
      version: "BMapGLLib@2.0",
      owner: "infra",
      tracking: "#999",
      expires: "2026-12-31",
    };
    const cases: [name: string, entry: Partial<typeof base>, expected: 1 | 3][] = [
      ["缺 reason", { ...base, reason: "" }, 1],
      ["缺 version", { ...base, version: "" }, 1],
      ["缺 owner", { ...base, owner: "" }, 1],
      ["缺 tracking", { ...base, tracking: "" }, 1],
      ["缺 expires", { ...base, expires: "" }, 1],
      ["已过期", { ...base, expires: "2026-01-01" }, 1],
      ["完整且在期内", base, 3],
    ];
    for (const [name, entry, expected] of cases) {
      const gate = evaluateSmokeReport(report(passing, [unattributed]), {
        required: REQUIRED,
        whitelist: [entry as typeof base],
        today: TODAY,
      });
      expect(gate.exitCode, name).toBe(expected);
    }
  });
});

describe("#74 smoke 收集器：blocked 与 fail 必须分开", () => {
  it("SmokeFailure → fail；SmokeBlocked → blocked（前置不满足不等于库回归）", async () => {
    const run = new SmokeRun({ mode: "live", runId: "r", akUsed: true });
    await run.check("f", "f", () => {
      throw new SmokeFailure("BMAP_X", "断言不成立");
    });
    await run.check("b", "b", () => {
      throw new SmokeBlocked("SERVICE_EMPTY", "配额不成立，本轮无法判定");
    });
    const report = run.finish([]);
    expect(report.checks.map((c) => [c.id, c.verdict])).toEqual([
      ["f", "fail"],
      ["b", "blocked"],
    ]);
    // blocked 必须带理由进报告，否则门禁只能打印一个没有解释的 BLOCKED。
    expect(report.checks[1]!.reason).toBe("配额不成立，本轮无法判定");
    expect(evaluateSmokeReport(report, { required: [], today: TODAY }).exitCode).toBe(1);
  });

  it("只有 blocked 时退出码是 3——既不是 0（放行）也不是 1（库回归）", async () => {
    const run = new SmokeRun({ mode: "live", runId: "r", akUsed: true });
    await run.check("b", "b", () => {
      throw new SmokeBlocked("SERVICE_EMPTY", "配额不成立");
    });
    const gate = evaluateSmokeReport(run.finish([]), { required: [], today: TODAY });
    expect(gate.exitCode).toBe(3);
    expect(gate.ok).toBe(false);
    expect(gate.failing).toEqual([]);
  });
});

describe("#74 第 1 轮评审 P1：bootstrap 失败必须区分「外部前置」与「实现回归」", () => {
  it("外部前置类错误（加载失败 / 超时）⇒ external", () => {
    expect(classifyBootstrapFailure([{ code: "BMAP_SDK_LOAD_FAILED", message: "网络" }]).kind).toBe(
      "external",
    );
    expect(classifyBootstrapFailure([{ code: "BMAP_SDK_LOAD_TIMEOUT" }]).kind).toBe("external");
  });

  it("实现/契约类错误 ⇒ library（哪怕同时存在外部错误，也按 library 处理：宁可红不可绿）", () => {
    expect(
      classifyBootstrapFailure([{ code: "BMAP_SDK_CALL_FAILED", message: "MapTypeId" }]).kind,
    ).toBe("library");
    expect(
      classifyBootstrapFailure([
        { code: "BMAP_SDK_LOAD_FAILED" },
        { code: "BMAP_SDK_CALL_FAILED" },
      ]).kind,
    ).toBe("library");
  });

  it("一条错误都没有、ready 又没来 ⇒ external（无法归属时不冒充库回归，但结论仍是不可放行）", () => {
    const verdict = classifyBootstrapFailure([]);
    expect(verdict.kind).toBe("external");
    expect(verdict.code).toBe("BMAP_READY_TIMEOUT");
  });

  it("external ⇒ 把本档 required 逐条登记成 blocked；gate 得到 exit 3 且没有 REQUIRED_CHECK_MISSING", () => {
    const specs = [
      { id: "map-ready", name: "map-ready" },
      { id: "overlay-marker", name: "overlay-marker" },
    ];
    const declarations = bootstrapDeclarations(
      classifyBootstrapFailure([{ code: "BMAP_SDK_LOAD_FAILED" }]),
      specs,
    );
    expect(declarations.map((d) => [d.id, d.verdict])).toEqual([
      ["map-ready", "blocked"],
      ["overlay-marker", "blocked"],
    ]);
    for (const declaration of declarations) expect(declaration.reason).toBeTruthy();

    const gate = evaluateSmokeReport(
      report(declarations.map((d) => check(d.id, d.verdict, { reason: d.reason }))),
      { required: specs.map((s) => s.id), today: TODAY },
    );
    expect(gate.exitCode).toBe(3);
    expect(gate.requiredMissing).toEqual([]);
    expect(gate.failing).toEqual([]);
  });

  it("library ⇒ 不生成 blocked 声明（缺席的 required 继续按 REQUIRED_CHECK_MISSING 判 fail）", () => {
    const declarations = bootstrapDeclarations(
      classifyBootstrapFailure([{ code: "BMAP_SDK_CALL_FAILED" }]),
      [{ id: "map-ready", name: "map-ready" }],
    );
    expect(declarations).toEqual([]);
    const gate = evaluateSmokeReport(report([]), { required: ["map-ready"], today: TODAY });
    expect(gate.exitCode).toBe(1);
    expect(gate.requiredMissing).toEqual(["map-ready"]);
  });
});

describe("#74 第 1 轮评审 P2：网络阶段超时按 blocked 结算", () => {
  it("withBlockedTimeout 超时 ⇒ blocked；而原 promise 自身的拒绝照原样透传（不被吞成 blocked）", async () => {
    const run = new SmokeRun({ mode: "live", runId: "r", akUsed: true });
    await run.check("t", "t", () =>
      withBlockedTimeout(new Promise(() => {}), 20, "Geocoder.getPoint", "SERVICE_GEOCODE_TIMEOUT"),
    );
    await run.check("r", "r", () => withBlockedTimeout(Promise.reject(new Error("boom")), 1000, "x"));
    expect(run.checks.map((c) => [c.id, c.verdict])).toEqual([
      ["t", "blocked"],
      ["r", "fail"],
    ]);
    expect(run.checks[0]!.code).toBe("SERVICE_GEOCODE_TIMEOUT");
  });
});

describe("#74 第 1 轮评审：orchestrator 的信封自检", () => {
  const base = report([check("a", "pass")]);

  it("mode / runId / akUsed 不一致时必须报出来（否则 Node 会跟着页面换成更小的 required 集合）", () => {
    expect(checkReportEnvelope({ ...base, mode: "fixture" }, { mode: "live", runId: "run-1" })).toEqual(
      ["SMOKE_MODE_MISMATCH"],
    );
    expect(checkReportEnvelope({ ...base, runId: "other" }, { mode: "live", runId: "run-1" })).toEqual(
      ["SMOKE_RUN_ID_MISMATCH"],
    );
    expect(
      checkReportEnvelope({ ...base, akUsed: false }, { mode: "live", runId: "run-1" }),
    ).toEqual(["SMOKE_AK_NOT_USED"]);
  });

  it("一致时没有问题；fixture 档不要求 akUsed", () => {
    expect(checkReportEnvelope(base, { mode: "live", runId: "run-1" })).toEqual([]);
    expect(
      checkReportEnvelope({ ...base, mode: "fixture", akUsed: false }, { mode: "fixture", runId: "run-1" }),
    ).toEqual([]);
  });
});

describe("#74 smoke 检查登记表：required 与页面的实现必须对齐", () => {
  const pageSource = readFileSync(
    resolve(import.meta.dirname, "../browser/jsapi-v4/main.ts"),
    "utf8",
  );

  it("登记表里没有重复 id，每个 id 都有非空名字", () => {
    const specs = allCheckSpecs();
    const ids = specs.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of specs) expect(spec.name.trim().length, spec.id).toBeGreaterThan(0);
  });

  it("两档的 required 都非空，且每个 id 都在登记表里", () => {
    const known = new Set(allCheckSpecs().map((spec) => spec.id));
    for (const mode of ["fixture", "live"] as const) {
      const required = requiredChecks(mode);
      expect(required.length, mode).toBeGreaterThan(0);
      for (const id of required) expect(known.has(id), `${mode}:${id}`).toBe(true);
      expect(new Set(required).size, mode).toBe(required.length);
    }
  });

  it("每个 required 检查都真的被页面实现（防止登记表骗过门禁）", () => {
    // 匹配 `"<id>": {` 这种**实现条目**的形状，而不是裸 id 子串——后者在注释里出现同名即可蒙混。
    const missing = [...requiredChecks("fixture"), ...requiredChecks("live")].filter(
      (id) => !pageSource.includes(`"${id}": {`),
    );
    expect(missing).toEqual([]);
  });

  it("文档里承诺的档位与登记表一致（fixture 不含需要网络的检查）", () => {
    const fixture = requiredChecks("fixture");
    const networkOnly = ["provider-default-delegation", "service-geocode"];
    for (const id of networkOnly) expect(fixture, id).not.toContain(id);
    expect(SMOKE_CHECKS.fixture.required).not.toContain("ui-kit-autocomplete-search");
  });
});
