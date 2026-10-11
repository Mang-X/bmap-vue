/**
 * #165 收口机制的纯判据（`scripts/coverage-inventory.mts`）
 *
 * 这组用例守的是「**可判定**」本身。评审要求「核心判据都要有会变红的反例」，因此每条判据下面
 * 都配了对应负例：
 *
 * - 导出枚举：`export { type T }` / `export default` / `export namespace` 都必须认出来
 *   （旧实现用正则，实测漏掉 `type T`）；
 * - 入口清单：从 **manifest** 派生，新增带 `types` 的子路径必须自动出现（含只有声明的 `./volar`）；
 * - 覆盖维度：**`入口#名字`** —— 同名后来新增到另一个入口必须形成 `missing`；
 * - 记录校验：基线非负整数、已判定项必须有非空 `note`（否则全标 `retained` 就能把未核对清零）。
 *
 * 真实清单与记录的一致性、以及跨提交基线单调性由 `pnpm check:165-coverage` 在 CI 上跑
 * （需要 `build:package`；跨提交比较读 `git show origin/main:<file>`）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, win32 } from "node:path";
import {
  augmentationNamesOf,
  coverageDrift,
  coverageKey,
  entryPointsFromManifest,
  exportedNamesOf,
  readCoverageRecord,
  statusCounts,
  type CoverageRecord,
} from "../../scripts/coverage-inventory.mts";

describe("exportedNamesOf：AST 枚举，认全合法导出形态", () => {
  it("export 列表 / 别名 / 各类 export declare", () => {
    const names = exportedNamesOf(`
export { Alpha, Beta as Gamma } from "./x";
export declare function doThing(): void;
export type T = number;
export interface I {}
export declare const K: string;
export declare class C {}
export declare enum E { A }
`);
    expect(names).toEqual(["Alpha", "C", "E", "Gamma", "I", "K", "T", "doThing"].sort());
  });

  it("**`export { type T }` 必须认出来**（旧正则实现实测漏掉）", () => {
    expect(exportedNamesOf(`export { type NewType, Foo } from "./x";`)).toEqual([
      "Foo",
      "NewType",
    ]);
  });

  it("**`export default` 的公开名字是 `default`**（不是本地声明名）", () => {
    // 消费者 import 的是 default，本地类名 `Widget` 不是公共名（上一版断言错了）
    expect(exportedNamesOf(`export default class Widget {}`)).toEqual(["default"]);
    expect(exportedNamesOf(`export default class {}`)).toEqual(["default"]);
    expect(exportedNamesOf(`export default function () {}`)).toEqual(["default"]);
    expect(exportedNamesOf(`declare const X: number; export default X;`)).toEqual(["default"]);
    // `export = X` 是另一套语义（TS export-assignment）
    expect(exportedNamesOf(`declare const Y: number; export = Y;`)).toEqual(["Y"]);
  });

  it("`export namespace NS` 必须认出来", () => {
    expect(exportedNamesOf(`export namespace NS { export const a = 1 }`)).toEqual(["NS"]);
  });

  it("**`export * as NS` 要登记 `NS`**", () => {
    expect(exportedNamesOf(`export * as NS from "./x";`)).toEqual(["NS"]);
  });

  it("**`export * from` 必须 fail-closed**（静默跳过就是给门禁开洞）", () => {
    expect(() => exportedNamesOf(`export * from "./other";`)).toThrow(/不能枚举/);
    // 同一文件里有名字导出也照样抛：不许「部分枚举 + 静默漏掉转出的」
    expect(() => exportedNamesOf(`export { One } from "./one";\nexport * from "./other";`)).toThrow(
      /不能枚举/,
    );
  });

  it("非导出行不是公共面", () => {
    expect(exportedNamesOf(`declare function i(): void;\ninterface N {}\nconst x = 1;`)).toEqual([]);
  });
});

describe("augmentationNamesOf：模块增强的成员级清单", () => {
  it("**`declare module 'vue' { export interface GlobalComponents { … } }` 要列出成员**", () => {
    const names = augmentationNamesOf(`
declare module "vue" {
  export interface GlobalComponents {
    Map: typeof import("@mangax/bmap-vue")["Map"];
    Marker: typeof import("@mangax/bmap-vue")["Marker"];
  }
}
`);
    expect(names).toContain("vue.GlobalComponents");
    expect(names).toContain("vue.GlobalComponents.Map");
    expect(names).toContain("vue.GlobalComponents.Marker");
  });

  it("顶层 `export {}` 的增强文件不再得到空集（上一版 `./volar` 就是零记录）", () => {
    const source = `
export {};
declare module "@vue/runtime-core" {
  export interface GlobalComponents { BMapProvider: unknown }
}
`;
    expect(exportedNamesOf(source)).toEqual([]);
    expect(augmentationNamesOf(source)).toContain("@vue/runtime-core.GlobalComponents.BMapProvider");
  });

  it("成员增删会改变清单（这就是门禁能知情的原因）", () => {
    const withOne = augmentationNamesOf(`declare module "vue" { export interface G { A: 1 } }`);
    const withTwo = augmentationNamesOf(`declare module "vue" { export interface G { A: 1; B: 2 } }`);
    expect(withOne).not.toContain("vue.G.B");
    expect(withTwo).toContain("vue.G.B");
  });
});

describe("entryPointsFromManifest：新增子路径不能被静默漏检", () => {
  it("从 manifest 派生（含只有声明的 `./volar`；排除 css / package.json）", () => {
    const points = entryPointsFromManifest(
      {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" },
          "./components": { types: "./dist/components.d.ts", import: "./dist/components.mjs" },
          "./volar": { types: "./volar.d.ts" },
          "./styles.css": "./dist/bmap-vue.css",
          "./package.json": "./package.json",
        },
      },
      "/pkg/dist",
    );
    expect(points.map((p) => p.entry)).toEqual([".", "./components", "./volar"]);
    // `./volar` 的声明在**包根**，不在 dist/ 下
    expect(points.find((p) => p.entry === "./volar")?.dts).toBe("/pkg/volar.d.ts");
    expect(points.find((p) => p.entry === ".")?.dts).toBe("/pkg/dist/index.d.ts");
  });

  it("**新增一个带 types 的入口必须自动出现**（写死列表就会漏）", () => {
    const before = entryPointsFromManifest({ exports: { ".": { types: "./dist/index.d.ts" } } }, "/d");
    const after = entryPointsFromManifest(
      { exports: { ".": { types: "./dist/index.d.ts" }, "./brand-new": { types: "./dist/new.d.ts" } } },
      "/d",
    );
    expect(before).toHaveLength(1);
    expect(after.map((p) => p.entry)).toContain("./brand-new");
  });

  it("**Windows 路径**：`./volar` 解析到包根而不是 `dist\\` 下", () => {
    const points = entryPointsFromManifest(
      { exports: { "./volar": { types: "./volar.d.ts" } } },
      "C:\\repo\\packages\\bmap-vue\\dist",
      { pathApi: win32 },
    );
    expect(points[0]?.dts).toBe(win32.resolve("C:\\repo\\packages\\bmap-vue", "./volar.d.ts"));
    expect(points[0]?.dts).not.toContain("dist");
  });

  it("`includeDeclarationOnly: false` 时排除只有声明的入口", () => {
    const points = entryPointsFromManifest(
      { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" }, "./volar": { types: "./volar.d.ts" } } },
      "/pkg/dist",
      { includeDeclarationOnly: false },
    );
    expect(points.map((p) => p.entry)).toEqual(["."]);
  });
});

describe("coverageDrift：维度是「入口#名字」", () => {
  const record = (keys: string[]): CoverageRecord => ({
    baseline: { unaudited: 0 },
    entries: Object.fromEntries(keys.map((k) => [k, { status: "unaudited" as const }])),
  });

  it("清单里有、记录里没有 ⇒ missing", () => {
    const drift = coverageDrift({ ".": ["A", "B"] }, record([coverageKey(".", "A")]));
    expect(drift.missing).toEqual([coverageKey(".", "B")]);
  });

  it("**同一个名字新增到另一个入口 ⇒ 必须形成 missing**（全局名字集合会漏掉）", () => {
    const before = coverageDrift({ ".": ["Foo"] }, record([coverageKey(".", "Foo")]));
    expect(before).toEqual({ missing: [], stale: [] });
    // 之后 `./advanced` 也公开了 `Foo`：新的「入口#名字」组合必须被要求单独判定
    const after = coverageDrift({ ".": ["Foo"], "./advanced": ["Foo"] }, record([coverageKey(".", "Foo")]));
    expect(after.missing).toEqual([coverageKey("./advanced", "Foo")]);
  });

  it("从某个入口移除该名字 ⇒ 该键变 stale", () => {
    const drift = coverageDrift(
      { ".": ["Foo"] },
      record([coverageKey(".", "Foo"), coverageKey("./advanced", "Foo")]),
    );
    expect(drift.stale).toEqual([coverageKey("./advanced", "Foo")]);
  });
});

describe("statusCounts", () => {
  it("按状态计数", () => {
    expect(
      statusCounts({
        baseline: { unaudited: 99 },
        entries: {
          a: { status: "fixed" },
          b: { status: "fixed" },
          c: { status: "deferred" },
          d: { status: "unaudited" },
        },
      }),
    ).toEqual({ fixed: 2, retained: 0, "not-applicable": 0, deferred: 1, unaudited: 1 });
  });
});

describe("readCoverageRecord：fail-closed 且有依据要求", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "165-coverage-"));
  const write = (name: string, value: unknown): string => {
    const file = resolve(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };

  it("缺 baseline ⇒ 抛错（**不能再出现 `count > undefined` 恒 false 的静默通过**）", () => {
    const file = write("nobase.json", { entries: { a: { status: "unaudited" } } });
    expect(() => readCoverageRecord(file)).toThrow(/baseline\.unaudited 必须是非负整数/);
  });

  it("baseline 非法（负数 / 非整数 / 非数字）⇒ 抛错", () => {
    expect(() =>
      readCoverageRecord(write("neg.json", { baseline: { unaudited: -1 }, entries: {} })),
    ).toThrow(/非负整数/);
    expect(() =>
      readCoverageRecord(write("frac.json", { baseline: { unaudited: 1.5 }, entries: {} })),
    ).toThrow(/非负整数/);
    expect(() =>
      readCoverageRecord(write("str.json", { baseline: { unaudited: "0" }, entries: {} })),
    ).toThrow(/非负整数/);
  });

  it("entries 不是对象 ⇒ 抛错", () => {
    expect(() =>
      readCoverageRecord(write("arr.json", { baseline: { unaudited: 0 }, entries: [] })),
    ).toThrow(/entries 必须是对象/);
  });

  it("非法状态 ⇒ 抛错", () => {
    expect(() =>
      readCoverageRecord(
        write("bad.json", { baseline: { unaudited: 0 }, entries: { a: { status: "whatever" } } }),
      ),
    ).toThrow(/不在允许集合里/);
  });

  it("**已判定项没有 note ⇒ 抛错**（否则全标 retained 就能把未核对清零）", () => {
    expect(() =>
      readCoverageRecord(
        write("nonote.json", { baseline: { unaudited: 0 }, entries: { a: { status: "retained" } } }),
      ),
    ).toThrow(/必须给出非空 note/);
    // 只有空白字符也不算依据
    expect(() =>
      readCoverageRecord(
        write("blanknote.json", {
          baseline: { unaudited: 0 },
          entries: { a: { status: "fixed", note: "   " } },
        }),
      ),
    ).toThrow(/必须给出非空 note/);
  });

  it("`unaudited` 不需要 note；已判定项有 note 时正常读出", () => {
    const file = write("ok.json", {
      baseline: { unaudited: 1 },
      entries: { a: { status: "unaudited" }, b: { status: "fixed", note: "#210 d9304f5" } },
    });
    const record = readCoverageRecord(file);
    expect(record.entries.a?.status).toBe("unaudited");
    expect(record.entries.b?.note).toBe("#210 d9304f5");
    expect(record.baseline.unaudited).toBe(1);
  });
});

describe("baseline.migration：唯一允许基线上涨的出口", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "165-coverage-migration-"));
  const write = (name: string, value: unknown): string => {
    const file = resolve(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };

  it("migration 必须是字符串（写清迁移原因）", () => {
    expect(() =>
      readCoverageRecord(
        write("badmin.json", {
          baseline: { unaudited: 0, migration: 42 },
          entries: {},
        }),
      ),
    ).toThrow(/migration 必须是字符串/);
  });

  it("带 migration 的记录能正常读出（check 脚本用它区分「合法迁移」与「偷偷抬高」）", () => {
    const file = write("ok.json", {
      baseline: { unaudited: 10, migration: "维度从名字改为入口#名字" },
      entries: { a: { status: "unaudited" } },
    });
    const record = readCoverageRecord(file);
    expect(record.baseline.unaudited).toBe(10);
    expect(record.baseline.migration).toBe("维度从名字改为入口#名字");
  });

  it("没有 migration 时读出来就没有该字段（不会凭空造一个）", () => {
    const file = write("plain.json", { baseline: { unaudited: 3 }, entries: {} });
    expect(readCoverageRecord(file).baseline.migration).toBeUndefined();
  });
});
