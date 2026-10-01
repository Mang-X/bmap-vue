/**
 * 发布包形状门禁（publint / attw / 版本锁）（issue #45）
 *
 * 判据内核在 `scripts/package-shape-boundary.mts`。这里只测纯判据，用合成 attw 报告给出
 * 正反例——真实 attw 要跑 `--pack`（重新打包），单元层不跑它。
 */
import { describe, expect, it } from "vitest";
import {
  ATTW_EXCEPTIONS,
  evaluateAttwReport,
  unpinnedVersionIssues,
} from "../../scripts/package-shape-boundary.mts";

/**
 * 「与登记的例外完全一致」的 attw 报告，即真实 tarball 上的形态。
 *
 * 由 `ATTW_EXCEPTIONS` **生成**而不是手抄：手抄的摘要在例外表补齐 `expectedCount` /
 * `entrypoints` 之后立刻变成「次数对不上」的漂移用例（第一版就这么翻车），而那与
 * 「attw 真的多报了一处」是两回事。生成的方式保证这张正例与表**永远同步**。
 */
const REAL_REPORT = {
  problems: Object.fromEntries(
    ATTW_EXCEPTIONS.map((e) => [
      e.kind,
      (e.entrypoints ?? []).map((entrypoint) => ({
        entrypoint,
        resolutionKind: e.kind === "CJSResolvesToESM" ? "node16-cjs" : "node10",
      })),
    ]),
  ),
};

describe("#45 发布包形状门禁", () => {
  describe("attw 判据：把「隐形例外」变成「枚举过的例外」", () => {
    it("例外表刻意非空，且每条都带理由、追踪票号与预期次数", () => {
      // 空表会让「attw 报了新问题」与「attw 什么都没报」无法区分。
      expect(ATTW_EXCEPTIONS.length).toBeGreaterThan(0);
      for (const exception of ATTW_EXCEPTIONS) {
        expect(exception.why.length, exception.kind).toBeGreaterThan(10);
        expect(exception.tracking, exception.kind).toMatch(/^#\d+$/);
        // 每条例外都必须钉住次数与子路径清单，否则它会静默增长（见 drift 用例）。
        expect(exception.expectedCount, `${exception.kind} 缺 expectedCount`).toBeGreaterThan(0);
        expect(exception.entrypoints?.length, `${exception.kind} 缺 entrypoints`).toBe(
          exception.expectedCount,
        );
      }
    });

    it("实测存在的两类问题被接受，且被记录成「已接受的例外」而非静默", () => {
      const { problems, accepted } = evaluateAttwReport(REAL_REPORT);
      expect(problems).toEqual([]);
      expect(accepted.map((a) => a.kind).sort()).toEqual(["CJSResolvesToESM", "NoResolution"]);
    });

    it("accepted 里带上了条目与档位，便于 review 时核对", () => {
      const { accepted } = evaluateAttwReport(REAL_REPORT);
      expect(accepted[0]!.detail).toContain("@node16-cjs");
    });

    it("表里没有的新 problem 必须红（上游新增一条检查的情形）", () => {
      const report = {
        problems: { ...REAL_REPORT.problems, InternalResolutionError: [{ entrypoint: "." }] },
      };
      const { problems } = evaluateAttwReport(report);
      expect(problems).toHaveLength(1);
      expect(problems[0]!.kind).toBe("unexpected:InternalResolutionError");
    });

    it("fail-closed：报告为 null / undefined / 非对象都判失败，不当作通过", () => {
      for (const bad of [null, undefined, 42, "ok"]) {
        const { problems } = evaluateAttwReport(bad as never);
        expect(problems.map((p) => p.kind), String(bad)).toContain("attw-unreadable");
      }
    });

    it("登记的例外**整类消失**必须红（PR 评审 P1）", () => {
      // 第一版只遍历报告里现有的 key，于是 `NoResolution` 从 6 处降到 0 处时，
      // `expectedCount` 根本不进比较，`problems` 仍是 `[]` —— 假绿。
      // 而「问题消失」恰恰需要人看一眼：要么该删登记，要么 attw 改了检查方式。
      for (const report of [{ problems: {} }, { problems: { NoResolution: [] } }]) {
        const { problems, accepted } = evaluateAttwReport(report);
        expect(accepted, JSON.stringify(report)).toEqual([]);
        expect(
          problems.some((p) => p.kind.startsWith("exception-vanished")),
          JSON.stringify(report),
        ).toBe(true);
      }
    });

    it("例外只出现一部分时，另一半报 vanished 而已出现的那半仍走 drift 判定", () => {
      const noRes = ATTW_EXCEPTIONS.find((e) => e.kind === "NoResolution")!;
      const report = {
        problems: {
          CJSResolvesToESM: (ATTW_EXCEPTIONS.find((e) => e.kind === "CJSResolvesToESM")!.entrypoints ?? []).map(
            (entrypoint) => ({ entrypoint, resolutionKind: "node16-cjs" }),
          ),
          NoResolution: (noRes.entrypoints ?? []).slice(0, 2).map((entrypoint) => ({ entrypoint })),
        },
      };
      const kinds = evaluateAttwReport(report).problems.map((p) => p.kind);
      expect(kinds).toContain("exception-drift:NoResolution");
      expect(kinds).not.toContain("exception-vanished:NoResolution");
      expect(kinds).not.toContain("exception-vanished:CJSResolvesToESM");
    });

    it("解析档位漂移必须红（PR 评审 P2：例外成立的前提就是那个档位）", () => {
      // 6 处 entrypoint 完全对，但档位从 node10 漂到 node16-cjs。
      // 第一版只比 entrypoint，这种漂移会被 accepted。
      const noRes = ATTW_EXCEPTIONS.find((e) => e.kind === "NoResolution")!;
      const drifted = (noRes.entrypoints ?? []).map((entrypoint) => ({
        entrypoint,
        resolutionKind: "node16-cjs",
      }));
      const { problems, accepted } = evaluateAttwReport({ problems: { NoResolution: drifted } });
      expect(accepted, "档位漂移不得算作已接受").toEqual([]);
      const drift = problems.find((p) => p.kind === "exception-drift:NoResolution");
      expect(drift?.detail).toContain("解析档位漂移");
      expect(drift?.detail).toContain(noRes.expectedResolutionKind);
    });

    it("每条例外都钉了档位（否则上面那条判据无从比较）", () => {
      for (const exception of ATTW_EXCEPTIONS) {
        expect(exception.expectedResolutionKind, `${exception.kind} 缺 expectedResolutionKind`).toMatch(
          /^node\d+|^bundler$/,
        );
      }
    });

    it("同一类问题**变多**必须红（只按 kind 匹配的话 7→8 会静默放行）", () => {
      const cjs = ATTW_EXCEPTIONS.find((e) => e.kind === "CJSResolvesToESM")!;
      const entries = (cjs.entrypoints ?? []).map((entrypoint) => ({ entrypoint }));
      const report = {
        problems: {
          CJSResolvesToESM: [
            ...entries,
            // 多出一个子路径：某个新入口也开始解析不对
            { entrypoint: "./brand-new-subpath" },
          ],
        },
      };
      const { problems, accepted } = evaluateAttwReport(report);
      expect(accepted, "有漂移时不得再算作已接受").toEqual([]);
      const drift = problems.find((p) => p.kind === "exception-drift:CJSResolvesToESM");
      expect(drift).toBeDefined();
      expect(drift!.detail).toContain("./brand-new-subpath");
    });

    it("同一类问题**变少**也要红（子路径修好了，应当去登记而不是继续挂着）", () => {
      const noRes = ATTW_EXCEPTIONS.find((e) => e.kind === "NoResolution")!;
      const entries = (noRes.entrypoints ?? []).slice(0, -1).map((entrypoint) => ({ entrypoint }));
      const report = { problems: { NoResolution: entries } };
      const { problems } = evaluateAttwReport(report);
      expect(problems.some((p) => p.kind === "exception-drift:NoResolution")).toBe(true);
    });

    it("次数一致但子路径换了，同样红（「次数对」不等于「是同一批」）", () => {
      const cjs = ATTW_EXCEPTIONS.find((e) => e.kind === "CJSResolvesToESM")!;
      const entries = (cjs.entrypoints ?? []).map((e, i) => ({
        entrypoint: i === 0 ? "./somewhere-else" : e,
      }));
      const { problems } = evaluateAttwReport({ problems: { CJSResolvesToESM: entries } });
      expect(problems.some((p) => p.kind === "exception-drift:CJSResolvesToESM")).toBe(true);
    });

    it("fail-closed：JSON 缺少 problems 字段也判失败（「没读到 problems」不等于「没问题」）", () => {
      const { problems } = evaluateAttwReport({ entrypoints: {} });
      expect(problems.map((p) => p.kind)).toContain("attw-unreadable");
    });

    it("某个 kind 是空数组时，报 vanished 而不是「没问题」", () => {
      // 改动前这条断言 `problems` 为空——那正是 PR 评审 P1 指出的假绿。
      // 现在它必须报 vanished：登记过的例外没出现，需要人判断是修好了还是 attw 改了。
      const { problems, accepted } = evaluateAttwReport({ problems: { CJSResolvesToESM: [] } });
      expect(accepted).toEqual([]);
      expect(problems.map((p) => p.kind)).toContain("exception-vanished:CJSResolvesToESM");
      expect(problems.map((p) => p.kind)).toContain("exception-vanished:NoResolution");
    });

    it("判据有区分力：登记内的完整清单放行、未登记的 kind 变红", () => {
      // 「表内」这一侧必须用**完整**的登记清单（REAL_REPORT）：只给一条 occurrence 会撞上
      // 次数漂移判据而变红，那时测的就是漂移、不是「表内/表外」这一件事了。
      const inside = evaluateAttwReport(REAL_REPORT);
      const outside = evaluateAttwReport({ problems: { TotallyNew: [{ entrypoint: "." }] } });
      expect(inside.problems).toEqual([]);
      // 未登记的 kind 报 unexpected，同时两条已登记的因未出现而报 vanished。
      expect(outside.problems.some((p) => p.kind === "unexpected:TotallyNew")).toBe(true);
    });
  });

  describe("版本锁判据", () => {
    it("精确锁定的版本没有意见", () => {
      expect(
        unpinnedVersionIssues({ publint: "0.3.24", "@arethetypeswrong/cli": "0.18.5" }, [
          "publint",
          "@arethetypeswrong/cli",
        ]),
      ).toEqual([]);
    });

    it("带 ^ / ~ 的版本必须红（上游 minor 不能静默改变门禁判定）", () => {
      const issues = unpinnedVersionIssues({ publint: "^0.3.24", "@arethetypeswrong/cli": "~0.18.5" }, [
        "publint",
        "@arethetypeswrong/cli",
      ]);
      expect(issues).toHaveLength(2);
      expect(issues[0]).toContain("publint");
    });

    it("latest 必须红", () => {
      expect(unpinnedVersionIssues({ publint: "latest" }, ["publint"])).toHaveLength(1);
    });

    it("未声明也必须红（不能靠 npx -y 在 CI 里现取）", () => {
      const issues = unpinnedVersionIssues({}, ["publint"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("未声明");
    });
  });
});