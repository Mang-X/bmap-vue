/**
 * #165 覆盖门禁的**全链路判据**（`evaluateCoverage` —— 纯判定，无 I/O）
 *
 * ## 为什么单独一组
 *
 * #215 首次引入这份记录时，CI 走的全是 `base.kind === "absent"`（目标分支还没有这个 JSON），
 * 所以 ②④⑤ 三条**跨提交**判据在真实环境里**从未被执行过**。第六轮评审明确点出这个缺口：
 * 「合并后第一张 G 子票应专门验证 `base=found` 下的完整门禁」。
 *
 * 只测单个判据（`coverageDrift` / `unjudgedNewKeys` / `regressedJudgedKeys` 各自的单测）**抓不到**
 * 「判据在 baseline 形态下恒真」那类失效——列表比对必须放在**门禁整体**上，看它到底出不出错、
 * 报出的是哪一条。这就是本文件存在的原因。
 *
 * ## 反例
 *
 * 每一个「应该红」的用例都真的构造出该形态的记录，断言 `problems` **非空**且**指向该键**；
 * 每一个「应该绿」的用例断言 `problems` 为空——只测红会让判据退化成常量。
 */
import { describe, expect, it } from "vitest";
import {
  coverageKey,
  evaluateCoverage,
  type CoverageRecord,
  type CoverageEvaluationInput,
} from "../../scripts/coverage-inventory.mts";

/** 造一条记录：`entries` 从 `[key, status, note?]` 列表来。 */
function record(
  entries: readonly (readonly [string, CoverageRecord["entries"][string]["status"], string?])[],
  baseline: CoverageRecord["baseline"] = { unaudited: 0 },
): CoverageRecord {
  return {
    baseline,
    entries: Object.fromEntries(
      entries.map(([key, status, note]) => [key, note === undefined ? { status } : { status, note }]),
    ),
  };
}

/** 由记录里的键反推出「清单」（入口 → 名字），让 `coverageDrift` 保持空。 */
function inventoryFrom(rec: CoverageRecord): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(rec.entries)) {
    const [entry, name] = key.split("#");
    (out[entry] ??= []).push(name);
  }
  return out;
}

/** 组装一次 `base=found` 的全链路判定；清单由记录反推，确保只考察「判定」而不牵连漂移。 */
function found(
  current: CoverageRecord,
  base: CoverageRecord,
): ReturnType<typeof evaluateCoverage> {
  const inventory = inventoryFrom(current);
  const input: CoverageEvaluationInput = {
    inventory,
    record: current,
    listedNameCount: Object.values(inventory).reduce((n, names) => n + names.length, 0),
    base: { kind: "found", record: base, source: "test-base" },
  };
  return evaluateCoverage(input);
}

/** 未核对数：让 `baseline.unaudited` 与之一致，避免「未核对超基线」这条无关判据先报。 */
function unauditedCount(rec: CoverageRecord): number {
  return Object.values(rec.entries).filter((e) => e.status === "unaudited").length;
}

const A = coverageKey(".", "Alpha");
const B = coverageKey(".", "Beta");

describe("evaluateCoverage · base=found：② 跨提交基线只降不升", () => {
  it("基线相对 base 上涨 ⇒ 红（且报出是基线问题）", () => {
    const base = record([[A, "unaudited"]], { unaudited: 1 });
    const current = record([[A, "unaudited"]], { unaudited: 2 });
    const { problems } = found(current, base);
    expect(problems.some((p) => p.includes("基线从") && p.includes("涨到"))).toBe(true);
  });

  it("基线不上涨 ⇒ 不因这条判据报错", () => {
    const base = record([[A, "unaudited"]], { unaudited: 1 });
    const current = record([[A, "unaudited"]], { unaudited: 1 });
    expect(found(current, base).problems).toEqual([]);
  });
});

describe("evaluateCoverage · base=found：④ 新增未判定键不可被净额抵消", () => {
  it("新增 1 个 unaudited + 判掉 1 个旧项（总数不变）⇒ 红，且点名新键", () => {
    // base：A 未核对、B 未核对（基线 2）
    const base = record([[A, "unaudited"], [B, "unaudited"]], { unaudited: 2 });
    // current：A 判成 retained（有依据）、**新增** C 仍是 unaudited —— 总数还是 2，基线没涨
    const current = record(
      [[A, "retained", "对照官方声明后确认一致"], [B, "unaudited"], [coverageKey(".", "Gamma"), "unaudited"]],
      { unaudited: 2 },
    );
    expect(unauditedCount(current)).toBe(2); // 净额抵消的条件确实成立
    const { problems } = found(current, base);
    expect(problems.some((p) => p.includes("本次新增") && p.includes(coverageKey(".", "Gamma")))).toBe(true);
  });

  it("新增键**已判定**（带依据）⇒ 不因这条判据报错", () => {
    const base = record([[A, "unaudited"]], { unaudited: 1 });
    const current = record(
      [[A, "unaudited"], [coverageKey(".", "Gamma"), "fixed", "补上官方成员（PR #999）"]],
      { unaudited: 1 },
    );
    expect(found(current, base).problems).toEqual([]);
  });
});

describe("evaluateCoverage · base=found：⑤ 已判定结论不可无痕回退", () => {
  it("fixed → unaudited 并靠另一键进展抵消总数 ⇒ 红，且点名被回退的键", () => {
    // base：A 已判定 fixed、B 未核对
    const base = record([[A, "fixed", "证据"], [B, "unaudited"]], { unaudited: 1 });
    // current：A 被退回 unaudited、B 判成 retained —— 两侧未核对数相同、没有新键、基线不涨
    const current = record([[A, "unaudited"], [B, "retained", "依据"]], { unaudited: 1 });
    expect(unauditedCount(current)).toBe(1);
    const { problems } = found(current, base);
    expect(problems.some((p) => p.includes("已判定") && p.includes(A))).toBe(true);
  });

  it("已判定键在已判定档位之间改判 ⇒ 不报（回退才报）", () => {
    const base = record([[A, "fixed", "证据"]], { unaudited: 0 });
    const current = record([[A, "retained", "改为有意保留，依据见 ADR"]], { unaudited: 0 });
    expect(found(current, base).problems).toEqual([]);
  });
});

describe("evaluateCoverage · base=found：迁移豁免的边界", () => {
  it("内容为新的迁移 + 精确豁免清单 ⇒ 允许基线一次性上涨", () => {
    const base = record([[A, "unaudited"]], { unaudited: 1 });
    const current = record([[A, "unaudited"], [coverageKey("./volar", "GlobalComponents"), "unaudited"]], {
      unaudited: 2,
      migration: {
        reason: "覆盖维度迁移：新增 ./volar 声明增强入口（114 个成员级键）",
        exemptNewKeys: [coverageKey("./volar", "GlobalComponents")],
      },
    });
    const { problems } = found(current, base);
    expect(problems).toEqual([]);
  });

  it("豁免清单指向的不是「本次新增」的键 ⇒ 红（清单过期/抄错）", () => {
    const base = record([[A, "unaudited"]], { unaudited: 1 });
    const current = record([[A, "unaudited"]], {
      unaudited: 1,
      migration: {
        reason: "尝试复用豁免",
        // A 在 base 里已存在，不是「本次新增」⇒ invalidExemptKeys 必须报
        exemptNewKeys: [A],
      },
    });
    const { problems } = found(current, base);
    expect(problems.some((p) => p.includes("豁免声明指向的不是"))).toBe(true);
  });
});

describe("evaluateCoverage · fail-closed 守卫", () => {
  it("清单里的公开名为 0 ⇒ 红（否则所有判据恒真）", () => {
    // 「没有名字要查」不能与「全部查过了」在判定上不可区分。
    const rec = record([], { unaudited: 0 });
    const { problems } = evaluateCoverage({
      inventory: {},
      record: rec,
      listedNameCount: 0,
      base: { kind: "absent", source: "test" },
    });
    expect(problems.some((p) => p.includes("清单里的公开名为 0"))).toBe(true);
  });

  it("旧库形态 base=absent ⇒ 只比文件内基线，不报跨提交判据", () => {
    const rec = record([[A, "unaudited"]], { unaudited: 1 });
    const { problems } = evaluateCoverage({
      inventory: inventoryFrom(rec),
      record: rec,
      listedNameCount: 1,
      base: { kind: "absent", source: "test" },
    });
    expect(problems).toEqual([]);
  });
});
