/**
 * 注释卫生门禁（issue #192）
 *
 * 判据内核在 `scripts/comment-hygiene-boundary.mts`。这里只测纯判据。
 *
 * ⚠️ 本文件**没有**「注释不得引用 ADR / issue / 文档路径」这类判据，尽管它一度是本门禁的
 * 主判据。实测推翻了它：核对全部 499 处剩余引用后没有一处是纯重复——每一处都在承载
 * 实质理由，删掉编号只会把注释变成没有依据的断言。详见 issue #192。
 *
 * 因此这里测的是两件更朴素的事：**什么算注释行**、**高比例注释何时该红**，
 * 以及两条豁免（实测证据主体、类型定义密集）不会把真债务放过。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  checkCommentRatio,
  countLines,
  hasLiveEvidence,
  isCommentLine,
  isEvidenceDominant,
} from "../../scripts/comment-hygiene-boundary.mts";

describe("#192 注释卫生门禁", () => {
  describe("什么算「注释行」", () => {
    it("认整行注释", () => {
      for (const line of ["// 说明", " * 说明", "/* 说明", "   <!-- 说明"]) {
        expect(isCommentLine(line), line).toBe(true);
      }
    });

    it("不认行尾注释（混进来会稀释真正要拦的文件头长篇）", () => {
      // 刻意不判：行尾注释通常短且贴着代码，判它会让比值失去意义。
      expect(isCommentLine("const x = 1; // 说明")).toBe(false);
      expect(isCommentLine("  }); // 收尾")).toBe(false);
    });

    it("不认空行与普通代码", () => {
      expect(isCommentLine("")).toBe(false);
      expect(isCommentLine("export const a = 1;")).toBe(false);
    });
  });

  describe("注释 / 实码比", () => {
    it("统计只数非空行，并区分注释与实码", () => {
      const stats = countLines(["// c1", "", "const a = 1;", " * c2", "const b = 2;"]);
      expect(stats.commentLines).toBe(2);
      expect(stats.codeLines).toBe(2);
    });

    it("实码 ≥ 20 且比例超阈值时红", () => {
      const issues = checkCommentRatio("src/layers/x.ts", { commentLines: 130, codeLines: 40 });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("comment-ratio");
      // 判据是粗筛不是判决——文案必须说清，否则维护者会以为「命中=该删」。
      expect(issues[0]!.detail).toContain("粗筛");
    });

    it("实码不足下限时**不判**（小文件比值高是正常的）", () => {
      // 实测：`deprecatedLayerWarning.ts` 7 行实码 / 27 行注释 = 3.9:1，逐句读过每一段
      // 都是必要的（模块不进公共出口、去重为何模块级、调用点为何在 setup）。逼人压到
      // 阈值以下是让人做无意义的事。
      expect(checkCommentRatio("src/layers/deprecatedLayerWarning.ts", {
        commentLines: 27,
        codeLines: 7,
      })).toEqual([]);
      expect(DEFAULT_LIMITS.minCodeLines).toBe(20);
    });

    it("实码为 0 时不判（纯注释/声明文件交给人看）", () => {
      expect(checkCommentRatio("src/types.d.ts", { commentLines: 50, codeLines: 0 })).toEqual([]);
    });

    it("阈值边界留 0.05 余量，避免浮点抖动让门禁不可预测", () => {
      // 实测踩到：`core/controls/spec.ts` 是 3.023 而阈值是 3.0，反复横跳。
      expect(checkCommentRatio("src/x.ts", { commentLines: 130, codeLines: 43 })).toEqual([]);
    });

    it("明显超阈值时仍然红（豁免不能把真债务放过）", () => {
      const issues = checkCommentRatio("src/bad.ts", { commentLines: 200, codeLines: 22 });
      expect(issues).toHaveLength(1);
    });
  });

  describe("实测证据豁免", () => {
    // 实测踩到：`nativeLayerStyleOwnership.ts`（22 实码 / 105 注释 = 4.8:1）被判红，
    // 逐句读过后发现整份注释是一张 live 读数表 + 逐 kind 判定依据，每一个数字都不可替代。
    const EVIDENCE_LINES = [
      "/**",
      " * 样式袋与顶层受控字段的**归属**",
      " *",
      " * live 读数（2026-09-28，真实 AK 跑通）逐 kind 证实：",
      " * | kind | 样式成员 | A：保持？ |",
      " * | --- | --- | --- |",
      " * | `text` | `setOptions` | **是**（merge） |",
      " */",
      "export const TABLE = new Set<string>();",
    ];

    it("含 live 读数 / 实测记录的文件不判（那正是 probe 的产物，删掉等于删证据）", () => {
      expect(hasLiveEvidence(EVIDENCE_LINES)).toBe(true);
      const issues = checkCommentRatio(
        "src/layers/nativeLayerStyleOwnership.ts",
        countLines(EVIDENCE_LINES),
        DEFAULT_LIMITS,
        EVIDENCE_LINES,
      );
      expect(issues).toEqual([]);
    });

    it("判据刻意窄：不看「证据」以外的词", () => {
      // 宁可漏豁免（多红一次，人来看一眼），不可宽豁免（真债务被放过）。
      expect(hasLiveEvidence(["// 官方文档说这是一种做法", "const a = 1;"])).toBe(false);
      expect(hasLiveEvidence(["// 我们决定这么做", "const b = 2;"])).toBe(false);
    });

    it("代码行里的实测字样不算（必须是注释）", () => {
      expect(hasLiveEvidence(["const live = 1; // 实测", "const x = 2;"])).toBe(false);
    });

    // 评审 P1-2：豁免是**整文件短路**，任意一条 `// 实测` 就能让整个高比例文件免判。
    // 实测两个真实超阈值文件里证据行只占 1% / 3%，其余 96%+ 的注释仍无人过目。
    it("豁免按**证据占比**给，不按「文件里有没有」给", () => {
      const lines = [
        "/**",
        " * live 读数（真实 AK 跑通）逐 kind 证实：", // 唯一一条证据
        " * | kind | 值 |",
        " * | --- | --- |",
        " * | `text` | 是 |",
        " */",
        ...Array.from({ length: 59 }, (_, i) => `// 决策史第 ${i + 1} 段。`),
        ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
      ];
      // 证据 1 行 / 注释 65 行 = 1.5% ⇒ 注释 3.2 倍于实码，超阈值，但不该整文件免判
      expect(checkCommentRatio("src/x.ts", countLines(lines), DEFAULT_LIMITS, lines)).toHaveLength(1);
    });

    it("成块的读数表豁免（真实形态：取证行 + 读表说明 + 表头/分隔/数据行）", () => {
      const lines = [
        "/**",
        " * live 读数（`probe.mts`，真实 AK 跑通）逐 kind 证实：",
        " * `setOpacity(0.25)` → 一次不含 opacity 的样式写 → 读回仍是 `0.25`：",
        " *",
        " * | kind | 入口 | A：保持？ |",
        " * | --- | --- | --- |",
        " * | `text` | `setOptions` | **是** |",
        " * | `line` | `setStyleOptions` | **是** |",
        " * | `point` | `setStyleOptions` | **是** |",
        " * | `cluster` | `setStyleOptions` | **是** |",
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      expect(checkCommentRatio("src/z.ts", countLines(lines), DEFAULT_LIMITS, lines)).toEqual([]);
    });

    // 反例：一句「实测」后跟决策史，凑不出成块的取证记录 ⇒ 不豁免。
    // 这条曾被放行过：早期实现是「取证行后跟任意 2 行注释都算证据」，
    // 结果这个反例也能凑满 5 行——等于把评审点破的漏洞原样放回来。
    it("零星一句「实测」+ 决策史不豁免", () => {
      const lines = [
        "/**",
        " * 实测。",
        " *",
        ...Array.from({ length: 100 }, (_, i) => ` * 决策史第 ${i + 1} 段。`),
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      // 注释 103 / 实码 30 = 3.4:1 超阈值，但证据只有开头 1 行 ⇒ 该红
      expect(checkCommentRatio("src/evil.ts", countLines(lines), DEFAULT_LIMITS, lines)).toHaveLength(1);
    });

    // 评审第二轮驳回的就是这条：只判「成块」不判「主导」，于是文件里放一张
    // 5 行读数表，后面 100+ 行决策史就全部绕过比例检查。
    it("表格在前、决策史在后：证据成块但**不主导** ⇒ 仍判红", () => {
      const lines = [
        "/**",
        " * live 读数（真实 AK 跑通）逐 kind 证实：",
        " * | kind | 入口 | 保持？ |",
        " * | --- | --- | --- |",
        " * | `text` | `setOptions` | 是 |",
        " * | `line` | `setStyleOptions` | 是 |",
        " * | `point` | `setStyleOptions` | 是 |",
        " *",
        ...Array.from({ length: 100 }, (_, i) => ` * 决策史第 ${i + 1} 段。`),
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      // 证据 7 行 / 注释 108 行 = 6% ⇒ 不是主体 ⇒ 该红
      expect(checkCommentRatio("src/tail-heavy.ts", countLines(lines), DEFAULT_LIMITS, lines)).toHaveLength(1);
    });

    // 表格分隔行属于表的一部分。漏掉它会把一张表从中间劈成两半，
    // 两半都不够 5 行 ⇒ 真实文件永远豁免不了。
    it("表格分隔行算证据（漏掉它会让整张表失效）", () => {
      const lines = [
        "/**",
        " * live 读数：",
        " * | a | b |",
        " * | --- | --- |",
        " * | 1 | 2 |",
        " * | 3 | 4 |",
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      expect(checkCommentRatio("src/table.ts", countLines(lines), DEFAULT_LIMITS, lines)).toEqual([]);
    });
  });

  describe("表格不是证据（评审第三轮 P1-3）", () => {
    // 表格是**载体**不是**证据**：`| A | 快 | 差 |` 里的字既不是读数也不是 probe 结果。
    // 上一版 isEvidenceLine 无条件认下任何 `|…|` 行，纯设计表因此能拿证据豁免。
    it("纯设计对照表 + 决策史 ⇒ 判红（表格未被取证行领进来）", () => {
      const lines = [
        "/**",
        " * ## 设计对照表",
        " * | 方案 | 优点 | 代价 |",
        " * | --- | --- | --- |",
        " * | A | 快 | 差 |",
        " * | B | 稳 | 慢 |",
        " * | C | 中 | 中 |",
        ...Array.from({ length: 95 }, (_, i) => ` * 决策史第 ${i + 1} 段。`),
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      expect(checkCommentRatio("src/table.ts", countLines(lines), DEFAULT_LIMITS, lines)).toHaveLength(1);
    });

    it("有 live 读数标记领进来的表才算证据", () => {
      const lines = [
        "/**",
        " * live 读数（probe.mts，真实 AK 跑通）逐 kind 证实：",
        " * | kind | A | B |",
        " * | --- | --- | --- |",
        " * | `text` | 是 | 是 |",
        " * | `line` | 是 | 否 |",
        " * | `point` | 是 | 否 |",
        " * | `cluster` | 是 | 否 |",
        " */",
        ...Array.from({ length: 30 }, (_, i) => `const v${i} = ${i};`),
      ];
      expect(isEvidenceDominant(lines, countLines(lines))).toBe(true);
    });
  });

  describe("类型定义密集豁免", () => {
    it("逐成员说明的冻结面不判（压缩它等于删掉使用面）", () => {
      const lines = [
        "/**",
        " * `<Map>` 的 expose 形状。",
        " */",
        "export interface MapExpose {",
        "  /** 容器 DOM。 */",
        "  getContainer(): HTMLElement | null;",
        "  /** 容器是否已拿到非零尺寸。 */",
        "  isSized(): boolean;",
        "  /** 地图中心。 */",
        "  getCenter(): unknown;",
        "  /** 缩放级别。 */",
        "  getZoom(): number;",
        "  /** 平移。 */",
        "  panBy(x: number, y: number): void;",
        "  /** 缩放到。 */",
        "  setZoom(z: number): void;",
        "  /** 截图。 */",
        "  getViewport(): unknown;",
        "  /** 飞行。 */",
        "  flyTo(o: unknown): void;",
        "}",
      ];
      expect(checkCommentRatio("src/expose.ts", countLines(lines), DEFAULT_LIMITS, lines)).toEqual([]);
    });

    // 评审第三轮 P1-2：判据一度把 `export interface X {` 与 `}` 也算成「成员」，
    // 于是一个小 interface 配 100 行决策史就能豁免——它显然不是类型定义密集。
    // ⚠️ 实码必须 ≥ `minCodeLines`（20），否则小文件规则先放行，测不到这条豁免。
    it("小 interface + 决策史 ⇒ 判红（成员行本身不够多就不算密集）", () => {
      const lines = [
        "/**",
        ...Array.from({ length: 100 }, (_, i) => ` * 决策史第 ${i + 1} 段。`),
        " */",
        "export interface Small {",
        "  a: string;",
        "  b: number;",
        "}",
        ...Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`),
      ];
      expect(checkCommentRatio("src/small.ts", countLines(lines), DEFAULT_LIMITS, lines)).toHaveLength(1);
    });

    it("方法签名（零参数箭头式）也算成员声明", () => {
      // `MapExpose` 的成员全是 `getContainer(): T;` 这种形态——只认 `readonly x:` 的
      // 判据一条都匹配不上，豁免形同虚设。
      const lines = [
        "/**",
        " * 冻结面。",
        " */",
        "export interface A {",
        "  a(): void;",
        "  b(): void;",
        "  c(): void;",
        "  d(): void;",
        "  e(): void;",
        "  f(): void;",
        "}",
      ];
      expect(checkCommentRatio("src/methods.ts", countLines(lines), DEFAULT_LIMITS, lines)).toEqual([]);
    });
  });
});