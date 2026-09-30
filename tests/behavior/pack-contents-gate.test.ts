/**
 * 发布 tarball 文件清单门禁（issue #45）
 *
 * 判据内核在 `scripts/pack-contents-boundary.mts`；这里用**合成 tarball 条目**逐条给出
 * 正例与反例。刻意不跑真实 `npm pack`：那是驱动脚本的事，单元层要的是「每条规则都有
 * 会红的输入」，跑真包只能证明「今天恰好没漂」。
 *
 * 最要紧的一条是 `files-entry-missing`。它对应一个**已经真实发生过**的发布缺陷：
 * `files` 声明 `volar.d.ts`，而 `volar.d.ts` 是 `.gitignore` 的生成产物，只由
 * `scripts/generate-manifest-artifacts.mts` 写。于是干净检出后直接 `pnpm pack` 会**静默
 * 发出缺 Volar 类型的包**，而 README 与安装页都承诺了自动补全。
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_DIST_FORMS,
  checkPackContents,
  collectExportTargets,
  matchesFilesEntry,
  normalizeEntries,
  type PackProblem,
} from "../../scripts/pack-contents-boundary.mts";

/** 一个健康 tarball 的最小条目集：`files` 声明的都在，且每个 JS 都有同名 map。 */
const HEALTHY_ENTRIES = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/NOTICE.md",
  "package/volar.d.ts",
  "package/dist/index.mjs",
  "package/dist/index.mjs.map",
  "package/dist/index.d.ts",
  "package/dist/index.global.js",
  "package/dist/index.global.js.map",
  "package/dist/bmap-vue.css",
];

const HEALTHY_MANIFEST = {
  name: "bmap-vue",
  version: "1.0.0-rc.0",
  files: ["dist", "volar.d.ts", "README.md", "NOTICE.md", "dist/bmap-vue.css"],
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" },
    "./package.json": "./package.json",
  },
  main: "./dist/index.mjs",
  types: "./dist/index.d.ts",
  unpkg: "./dist/index.global.js",
};

const kinds = (problems: readonly PackProblem[]): string[] => problems.map((p) => p.kind);

describe("#45 npm pack 文件清单判据", () => {
  it("健康集合没有问题（正证：否则下面每条反例都可能是恒真）", () => {
    expect(checkPackContents({ entries: HEALTHY_ENTRIES, manifest: HEALTHY_MANIFEST })).toEqual([]);
  });

  describe("空转守卫：fail-closed", () => {
    it("条目为空必须判失败，而不是「没有违规」", () => {
      const problems = checkPackContents({ entries: [], manifest: HEALTHY_MANIFEST });
      expect(kinds(problems)).toContain("empty-entries");
    });

    it("files 缺失或为空必须判失败（否则下面所有 files 判据都 vacuous 通过）", () => {
      const problems = checkPackContents({ entries: HEALTHY_ENTRIES, manifest: { exports: {} } });
      expect(kinds(problems)).toContain("files-missing");
    });
  });

  describe("files 声明了却没发出（#45 抓到的真实缺陷）", () => {
    it("volar.d.ts 不在包里时必须报出，且点名它", () => {
      const entries = HEALTHY_ENTRIES.filter((e) => !e.includes("volar.d.ts"));
      const problems = checkPackContents({ entries, manifest: HEALTHY_MANIFEST });
      const hit = problems.find((p) => p.kind === "files-entry-missing");
      expect(hit).toBeDefined();
      expect(hit!.detail).toContain("volar.d.ts");
    });

    it("这是一个**会红**的反证：把那条判据的输入去掉，问题就消失了", () => {
      const withoutVolar = checkPackContents({
        entries: HEALTHY_ENTRIES.filter((e) => !e.includes("volar.d.ts")),
        manifest: HEALTHY_MANIFEST,
      });
      const withVolar = checkPackContents({ entries: HEALTHY_ENTRIES, manifest: HEALTHY_MANIFEST });
      expect(kinds(withoutVolar).length).toBeGreaterThan(kinds(withVolar).length);
    });

    it("files 里声明了一个谁都没发的文件同样要报", () => {
      const problems = checkPackContents({
        entries: HEALTHY_ENTRIES,
        manifest: { ...HEALTHY_MANIFEST, files: [...HEALTHY_MANIFEST.files, "CHANGELOG.md"] },
      });
      expect(problems.some((p) => p.kind === "files-entry-missing" && p.detail.includes("CHANGELOG.md"))).toBe(
        true,
      );
    });
  });

  describe("exports 与顶层字段：声明的面必须在包里", () => {
    it("exports 指向缺失文件时报出并点名子路径", () => {
      const entries = HEALTHY_ENTRIES.filter((e) => !e.endsWith("dist/index.d.ts"));
      const problems = checkPackContents({ entries, manifest: HEALTHY_MANIFEST });
      const hit = problems.find((p) => p.kind === "export-target-missing");
      expect(hit?.detail).toContain("dist/index.d.ts");
    });

    it("unpkg 指向缺失文件也要报（CDN 面同样属于发布面）", () => {
      const entries = HEALTHY_ENTRIES.filter((e) => !e.endsWith("index.global.js"));
      const problems = checkPackContents({ entries, manifest: HEALTHY_MANIFEST });
      expect(problems.some((p) => p.kind === "export-target-missing")).toBe(true);
    });

    it("collectExportTargets 能递归压平嵌套条件对象", () => {
      expect(
        collectExportTargets({
          ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" },
          "./package.json": "./package.json",
        }).sort(),
      ).toEqual(["dist/index.d.ts", "dist/index.mjs", "package.json"]);
    });
  });

  describe("不该发的不能发", () => {
    it("凭据类文件", () => {
      for (const bad of ["package/.env", "package/.npmrc", "package/server.key", "package/x.pem"]) {
        const problems = checkPackContents({
          entries: [...HEALTHY_ENTRIES, bad],
          manifest: HEALTHY_MANIFEST,
        });
        expect(kinds(problems), bad).toContain("forbidden-path");
      }
    });

    it("node_modules 与源码 / 测试 / CI 目录", () => {
      for (const bad of [
        "package/node_modules/vue/index.js",
        "package/src/index.ts",
        "package/tests/x.test.ts",
        "package/scripts/x.mts",
        "package/.github/workflows/quality.yml",
        "package/.changeset/config.json",
      ]) {
        const problems = checkPackContents({
          entries: [...HEALTHY_ENTRIES, bad],
          manifest: HEALTHY_MANIFEST,
        });
        expect(kinds(problems), bad).toContain("forbidden-path");
      }
    });

    it("根目录出现未声明文件要报", () => {
      const problems = checkPackContents({
        entries: [...HEALTHY_ENTRIES, "package/AGENTS.md"],
        manifest: HEALTHY_MANIFEST,
      });
      expect(kinds(problems)).toContain("unexpected-root-file");
    });
  });

  describe("dist 产物形态与 CSS 声明", () => {
    it("dist 下出现未登记形态", () => {
      const problems = checkPackContents({
        entries: [...HEALTHY_ENTRIES, "package/dist/notes.txt"],
        manifest: HEALTHY_MANIFEST,
      });
      expect(kinds(problems)).toContain("dist-form");
    });

    it("CSS 按文件名声明在 files 里 → 通过（#45 裁决：把它当公共面）", () => {
      expect(checkPackContents({ entries: HEALTHY_ENTRIES, manifest: HEALTHY_MANIFEST })).toEqual([]);
    });

    it("CSS 只靠 files 的目录项顺带发出 → 报 undeclared-css（区分力在此）", () => {
      const problems = checkPackContents({
        entries: HEALTHY_ENTRIES,
        // 去掉 files 里的 "dist/bmap-vue.css" 文件名项（`dist` 目录项仍在，css 仍在包里）
        manifest: { ...HEALTHY_MANIFEST, files: ["dist", "volar.d.ts", "README.md", "NOTICE.md"] },
      });
      const hit = problems.find((p) => p.kind === "undeclared-css");
      expect(hit?.detail).toContain("dist/bmap-vue.css");
    });
  });

  describe("sourcemap（#45 裁决：保留 map）", () => {
    it("map 是被允许的产物形态（有意发布，不是遗漏）", () => {
      expect(ALLOWED_DIST_FORMS).toContain(".map");
      expect(checkPackContents({ entries: HEALTHY_ENTRIES, manifest: HEALTHY_MANIFEST })).toEqual([]);
    });

    it("**不带** map 的纯 re-export facade 不判红（components.mjs 就是这种）", () => {
      // 真实 dist 里 `components.mjs` / `composables.mjs` / `resolver.mjs` 只含
      // import/export，没有 `//# sourceMappingURL=`，因此也没有 `.map`。
      // 判据若要求「每个 .mjs 都有 map」就会把这三条最普通的产物判红（第一版真实踩过）。
      const entries = [
        ...HEALTHY_ENTRIES,
        "package/dist/components.mjs",
        "package/dist/composables.mjs",
      ];
      expect(checkPackContents({ entries, manifest: HEALTHY_MANIFEST })).toEqual([]);
    });

    it("清单层不判「有注释却缺 map」——那要读内容，由驱动脚本负责", () => {
      // 刻意把 index.mjs.map 去掉：清单层无从知道 index.mjs 有没有注释，因此**不该**报。
      const entries = HEALTHY_ENTRIES.filter((e) => !e.endsWith("index.mjs.map"));
      expect(checkPackContents({ entries, manifest: HEALTHY_MANIFEST })).toEqual([]);
    });
  });

  describe("辅助函数", () => {
    it("normalizeEntries 去 package/ 前缀、丢目录条目、排序", () => {
      // `package/dist/` 与 `b/` 都是**目录条目**（以 `/` 结尾），刻意被丢弃：留着会让
      // 「目录算一个文件」而误判 files 条目。
      expect(normalizeEntries(["package/dist/", "package/a.mjs", "", "b/"])).toEqual(["a.mjs"]);
      expect(normalizeEntries(["package/dist/index.mjs", "package/README.md"])).toEqual([
        "README.md",
        "dist/index.mjs",
      ]);
    });

    it("matchesFilesEntry：目录项匹配其下全部，文件项只匹配自己", () => {
      expect(matchesFilesEntry("dist/chunks/a.mjs", "dist")).toBe(true);
      expect(matchesFilesEntry("dist/bmap-vue.css", "dist/bmap-vue.css")).toBe(true);
      expect(matchesFilesEntry("dist/other.css", "dist/bmap-vue.css")).toBe(false);
      expect(matchesFilesEntry("anything", "!dist/**/*.map")).toBe(false);
      expect(matchesFilesEntry("anything", "")).toBe(false);
    });
  });
});