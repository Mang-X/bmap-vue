/**
 * #165 收口机制的纯判据（`scripts/coverage-inventory.mts`）
 *
 * 这组用例守的是「**可判定**」本身：
 * - 导出枚举必须**只认声明面**（`export * from` 不算，由调用方展平）；
 * - 清单与记录的差异两个方向都要报（新增未记录 / 陈旧记录）；
 * - 记录形状非法必须抛错（fail-closed，不按空集静默通过）。
 *
 * 真实清单与记录的一致性由 `pnpm check:165-coverage` 在 CI 上跑（需要 `build:package`）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  coverageDrift,
  exportedNamesOf,
  readCoverageRecord,
  statusCounts,
  type CoverageRecord,
} from "../../scripts/coverage-inventory.mts";

describe("exportedNamesOf：只认声明面的导出", () => {
  it("认出 export 列表、别名、以及各类 export declare", () => {
    const names = exportedNamesOf(`
export { Alpha, Beta as Gamma } from "./x";
export declare function doThing(): void;
export type T = number;
export interface I {}
export declare const K: string;
export declare class C {}
export declare enum E { A }
`);
    expect(names).toEqual(["Alpha", "C", "Gamma", "I", "K", "T", "doThing", "E"].sort());
  });

  it("**不**把 `export * from` 当成一个名字（它由调用方展平）", () => {
    const names = exportedNamesOf(`export * from "./other";\nexport { One } from "./one";`);
    expect(names).toEqual(["One"]);
  });

  it("不看非导出行（内部声明不是公共面）", () => {
    const names = exportedNamesOf(`
declare function internal(): void;
interface NotExported {}
const alsoNot = 1;
`);
    expect(names).toEqual([]);
  });
});

describe("coverageDrift：两个方向都要报", () => {
  const record = (names: string[]): CoverageRecord => ({
    baseline: { unaudited: 0 },
    entries: Object.fromEntries(names.map((name) => [name, { status: "unaudited" as const }])),
  });

  it("清单里有、记录里没有 ⇒ missing", () => {
    const drift = coverageDrift({ ".": ["A", "B"] }, record(["A"]));
    expect(drift.missing).toEqual(["B"]);
    expect(drift.stale).toEqual([]);
  });

  it("记录里有、任何入口都没有 ⇒ stale（陈旧记录不能冒充覆盖）", () => {
    const drift = coverageDrift({ ".": ["A"] }, record(["A", "Ghost"]));
    expect(drift.missing).toEqual([]);
    expect(drift.stale).toEqual(["Ghost"]);
  });

  it("多个入口共用一份语义记录：只要求出现在**任一**入口", () => {
    const drift = coverageDrift({ ".": ["A"], "./composables": ["B"] }, record(["A", "B"]));
    expect(drift).toEqual({ missing: [], stale: [] });
  });
});

describe("statusCounts", () => {
  it("按状态计数", () => {
    const counts = statusCounts({
      baseline: { unaudited: 99 },
      entries: {
        A: { status: "fixed" },
        B: { status: "fixed" },
        C: { status: "deferred" },
        D: { status: "unaudited" },
      },
    });
    expect(counts).toEqual({
      fixed: 2,
      retained: 0,
      "not-applicable": 0,
      deferred: 1,
      unaudited: 1,
    });
  });
});

describe("readCoverageRecord：fail-closed", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "165-coverage-"));
  const write = (name: string, content: string): string => {
    const file = resolve(dir, name);
    writeFileSync(file, content);
    return file;
  };

  it("形状不对 ⇒ 抛错（不按空集通过）", () => {
    const file = write("bad.json", JSON.stringify({ entries: {} }));
    expect(() => readCoverageRecord(file)).toThrow(/形状不对/);
  });

  it("非法状态 ⇒ 抛错", () => {
    const file = write(
      "badstatus.json",
      JSON.stringify({ baseline: { unaudited: 0 }, entries: { A: { status: "whatever" } } }),
    );
    expect(() => readCoverageRecord(file)).toThrow(/不在允许集合里/);
  });

  it("合法记录原样读出", () => {
    const file = write(
      "ok.json",
      JSON.stringify({ baseline: { unaudited: 1 }, entries: { A: { status: "retained" } } }),
    );
    expect(readCoverageRecord(file).entries.A?.status).toBe("retained");
  });
});
