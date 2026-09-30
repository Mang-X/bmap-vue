/**
 * `ae-forgotten-export` 零容忍门禁自测（issue #160 + #165 回归修补）
 *
 * 五份 `etc/<出口>/forgotten-exports.json` 必须**全空**（`[]`）。这道门禁的失效方式与
 * 本仓库其他门禁不同，值得单列：
 *
 * 1. **门禁只对「没跑生成器」严格**。`check:api` 逐出口比对身份集合、方向对称（新增与清理
 *    都红）；但 `pnpm generate:api` 原先**无条件**把当前集合写回基线，于是「跑一次生成器」
 *    就把红线洗成了基线。#165 正是这样把三个名字（`MarkerLabelInput` /
 *    `OverlayAnchorName` / `ViewportOptions`）吸收进去的：门禁当时是红的，处置没做，
 *    生成器把欠账写成了基线，之后 `check:api` 全绿、再无人提。所以**生成器必须拒绝对
 *    「新增」方向自动落盘**（第一节）。判据是纯函数 `newForbiddenForgottenExports` ——
 *    直接从门禁脚本 import，断言打到的是**门禁真正在跑的那段判定**。
 * 2. **豁免表必须显式且空**。「没登记就是不允许」这条不变量只有靠空表才成立；一旦有条豁免
 *    被加进来忘了删，门禁会继续放行那个名字。第二节把这条钉住。
 * 3. **基线非空时，门禁形同虚设**。判据不是「比条数」而是「恒等于 `[]`」——任何非空都是
 *    回归，哪怕只有一个名字。第三节直接读仓库里五份基线。
 * 4. **门禁没接进 CI / 被 `continue-on-error` 架空**。第四节把脚本接线读出来断言。
 *
 * 第一节的反例刻意成对：「清理」方向必须照常写 —— 否则把一个名字真正导出之后，基线反而永远
 * 更新不掉，门禁会因为文件不是生成器的规范化形式而把「已修好」报成缺陷。
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORGOTTEN_EXEMPTIONS,
  REPORTED_ENTRIES,
  collectForbiddenAdditions,
  forbiddenForgottenMessage,
  newForbiddenForgottenExports,
} from "../../scripts/api-forgotten-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const ETC = resolve(ROOT, "packages/bmap-vue/etc");

/**
 * 有 API report、因而也有身份集合基线的出口。
 *
 * 从**门禁自己的名单**导出，不在这里抄一份：抄一份的话，`REPORTED_ENTRIES` 加第六个出口时
 * 下面那条「基线恒空」会静默漏掉它（AGENTS.md 的「只查数字抓不到『数量对了但漏列』」，同理）。
 */
const ENTRIES = REPORTED_ENTRIES;

describe("生成器不得吸收新增未导出类型", () => {
  it("基线为空、当前有一个新名字 ⇒ 拒绝吸收", () => {
    // #165 的形状：门禁当时是红的，`generate:api` 却把名字写进了基线。
    expect(newForbiddenForgottenExports("advanced", [], ["BrandNewInternalShape"])).toEqual([
      "BrandNewInternalShape",
    ]);
  });

  it("多个新增名字逐个点名，不只报数量", () => {
    expect(
      newForbiddenForgottenExports("advanced", ["GammaInternal"], ["AlphaInternal", "BetaInternal"]),
    ).toEqual(["AlphaInternal", "BetaInternal"]);
  });

  it("「清理」方向不阻止写入（把名字真正导出后，基线要能更新回空）", () => {
    expect(newForbiddenForgottenExports("advanced", ["SomeOldInternal"], [])).toEqual([]);
  });

  it("集合没变时不是新增（空跑不该被拦）", () => {
    expect(newForbiddenForgottenExports("advanced", ["KeptShape"], ["KeptShape"])).toEqual([]);
  });

  it("豁免按 (entry, name) 两层匹配：同名可在多个出口各自登记", () => {
    // 用 fixture 豁免表而非真实表（真实表刻意为空，见下一节）。
    // 同一个符号在 `./advanced` 与 `./plugins` **各自**登记 —— 两条能共存，不会互相覆盖。
    const exemptions = {
      advanced: { ExemptShape: { reason: "advanced 侧刻意接受" } },
      plugins: { ExemptShape: { reason: "plugins 侧刻意接受" } },
    };
    expect(newForbiddenForgottenExports("advanced", [], ["ExemptShape"], exemptions)).toEqual([]);
    expect(newForbiddenForgottenExports("plugins", [], ["ExemptShape"], exemptions)).toEqual([]);
    // 未登记的出口仍然拒绝 —— 豁免不跨出口泄漏。
    expect(newForbiddenForgottenExports("composables", [], ["ExemptShape"], exemptions)).toEqual([
      "ExemptShape",
    ]);
  });

  it("豁免只放行被登记的那一个名字（不是整出口放行）", () => {
    const exemptions = { advanced: { ExemptShape: { reason: "fixture" } } };
    expect(
      newForbiddenForgottenExports("advanced", [], ["ExemptShape", "AnotherShape"], exemptions),
    ).toEqual(["AnotherShape"]);
  });
});

describe("豁免表", () => {
  it("没有登记任何豁免（1.0 立场：未导出类型欠账不接受）", () => {
    // 判据是「表里一条都没有」。「没登记就是不允许」这条不变量只有靠空表才成立。
    //
    // 刻意**不**再单独写一条「每条豁免都带 reason」的用例：表为空时那条的循环体永不执行，
    // 是空跑；而豁免表的**类型**已经要求两个字段（`ForgottenExemption` 的 `reason` / `entry`
    // 都不是可选），缺字段会直接编译失败。要真给某个符号开豁免时，把它的两个字段填上即可 ——
    // 豁免的语义判据（按 `(name, entry)` 匹配）由上面那条 fixture 用例守住。
    expect(FORGOTTEN_EXEMPTIONS, "FORGOTTEN_EXEMPTIONS 里出现了豁免条目").toEqual({});
  });
});

describe("拒绝文案", () => {
  it("点名每个出口与每个新增名字，并指向二选一与豁免表", () => {
    const message = forbiddenForgottenMessage([
      { entry: "advanced", added: ["AlphaInternal", "BetaInternal"] },
      { entry: "plugins", added: ["GammaInternal"] },
    ]);
    expect(message).toContain("advanced");
    expect(message).toContain("AlphaInternal");
    expect(message).toContain("BetaInternal");
    expect(message).toContain("plugins");
    expect(message).toContain("GammaInternal");
    // 文案是处置指引，不是「已吸收」的通知 —— 指向 ADR 的二选一与豁免表位置。
    expect(message).toContain("二选一");
    expect(message).toContain("FORGOTTEN_EXEMPTIONS");
  });
});

describe("写盘的事务边界（#160 评审 P1）", () => {
  /**
   * 评审给的场景：`advanced` 有一次**合法**的公共面变化（先会写成功），`plugins` 出现一个
   * 新 forgotten export（被拒）。修之前 `advanced` 的新 report 留在工作树，且后面的签名基线
   * 循环根本没跑到 —— 于是「report 已更新、对应 `bmap-vue.dts.md` 未更新」的组合会被提交出去。
   *
   * 判据写成纯函数而不是真跑 `generate:api`：那条路要改源码 + 重新 build `dist/`，
   * 而 `dist/` 正是 `export-surface-freeze` / `core-surface` / `doc-props-gate` 等**并行**读的
   * 对象 —— 实测会让那几个文件随机变红（本条最初就是这么写的，13 个用例挂了 11 个）。
   * 跨出口的「一个都不写」性质由 `updateMode` 里「先 `preflight()`、判据全绿后才进写盘阶段」
   * 这条**结构**保证；这里钉住的是它的前提 —— 只要判据返回非空，写盘就不会开始。
   */
  const scenario = [
    { entry: "advanced", baseline: [], actual: [] }, // 合法变化：没有新增未导出类型
    { entry: "composables", baseline: [], actual: [] },
    { entry: "plugins", baseline: [], actual: ["NewPluginInternalShape"] }, // 被拒
  ];

  it("一个出口有新增未导出类型时，判据整体返回非空（写盘阶段不会开始）", () => {
    expect(collectForbiddenAdditions(scenario)).toEqual([
      { entry: "plugins", added: ["NewPluginInternalShape"] },
    ]);
  });

  it("先前出口的合法变化不会让判据「提前放行」", () => {
    // 关键性质：判据只看**最终结果**，不因 advanced/composables 通过就认为可以写盘。
    // 若实现改成「遇到第一个通过的出口就返回空」，这条会红。
    expect(collectForbiddenAdditions(scenario).length).toBeGreaterThan(0);
  });

  it("不短路：一次报出全部待处置出口（改一个跑一轮不是修法）", () => {
    const many = [
      { entry: "advanced", baseline: [], actual: ["A1", "A2"] },
      { entry: "composables", baseline: [], actual: ["C1"] },
      { entry: "plugins", baseline: [], actual: [] },
    ];
    expect(collectForbiddenAdditions(many)).toEqual([
      { entry: "advanced", added: ["A1", "A2"] },
      { entry: "composables", added: ["C1"] },
    ]);
  });

  it("全部出口都没有新增时判据才为空（写盘阶段的前提）", () => {
    expect(
      collectForbiddenAdditions([
        { entry: "advanced", baseline: ["OldShape"], actual: [] }, // 清理方向不算新增
        { entry: "plugins", baseline: [], actual: [] },
      ]),
    ).toEqual([]);
  });

  it("拒绝文案把每个出口与名字都点出来", () => {
    const message = forbiddenForgottenMessage(collectForbiddenAdditions(scenario));
    expect(message).toContain("plugins");
    expect(message).toContain("NewPluginInternalShape");
    // 文案是处置指引，不是「已吸收」的通知。
    expect(message).toContain("二选一");
    expect(message).toContain("FORGOTTEN_EXEMPTIONS");
  });
});

describe("门禁脚本自身的签名一致性（评审 P2 的那类失效兜底分支）", () => {
  /**
   * `scripts/**` **不在任何 typecheck 编译范围里**（根 tsconfig 的 `include` 只收
   * `packages/**` 与 `types/**`），所以 `vue-tsc` 抓不到脚本里的签名失配 ——
   * `forbiddenForgottenMessage` 从 3 个散参改成收 refusal 数组时，
   * `writeForgottenBaseline` 里的旧调用原样留着也能过 typecheck。
   *
   * 后果不是「编译报错」而是**运行时 TypeError**：字符串 `entry` 被当数组用，
   * 在 `refusals.map` 处炸掉，于是本该给出的门禁指引变成一坨栈。
   *
   * 判据是**门禁脚本里对 boundary 模块的每一次调用都与导出签名一致**，用 TypeScript 编译器
   * 现场查（`ts.createProgram` + `getSemanticDiagnostics`）—— 跑的是真正的类型检查，
   * 覆盖全部 `import` 而不是手写几行断言。
   */
  it("check-api.mts 里对 boundary 模块的调用全部通过类型检查", () => {
    const { createProgram } = require("typescript") as typeof import("typescript");
    const root = resolve(ROOT, "scripts");
    // AE 的回调载荷类型比脚本里内联的字面形状多一个 `handled` 字段（脚本注释里就引用了它），
    // 真实声明里也确实有；此处放宽成 `Record<string, unknown>` 形状再断言字段，避免把
    // 「我给回调写了多窄的字面类型」误报成签名失配。
    const files = [resolve(root, "check-api.mts"), resolve(root, "api-forgotten-boundary.mts")];
    const program = createProgram(files, {
      strict: true,
      noEmit: true,
      target: 99, // ESNext
      module: 99, // ESNext
      moduleResolution: 100, // Bundler —— 能解析 .mts 的扩展名
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: ["node"],
      typeRoots: [resolve(ROOT, "node_modules/@types")],
    });
    const diagnostics = program
      .getSemanticDiagnostics()
      .concat(program.getSyntacticDiagnostics())
      .filter((d) => d.file?.fileName.startsWith(root));
    const text = diagnostics
      .map((d) => {
        const where = d.file
          ? `${d.file.fileName.slice(root.length + 1)}:${(d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1)}`
          : "<global>";
        return `${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
      })
      .join("\n");
    expect(text, `门禁脚本与 boundary 模块之间有签名失配:\n${text}`).toBe("");
  });

  it("拒绝文案对每个出口都成立（数组形态，不是散参形态）", () => {
    // 反例：若有人把签名改回 `(entry, added, target)`，这里会拿到 undefined 的 refusals。
    const message = forbiddenForgottenMessage([{ entry: "plugins", added: ["SomeShape"] }]);
    expect(message).toContain("plugins");
    expect(message).toContain("SomeShape");
  });
});

describe("五份身份集合基线恒为空", () => {
  it.each(ENTRIES)("./%s 的 forgotten-exports.json 是 []（存量已清零）", (entry) => {
    const target = resolve(ETC, entry, "forgotten-exports.json");
    expect(existsSync(target), `${entry}: 身份集合基线缺失 —— 跑 pnpm generate:api 并提交`).toBe(true);
    // 判据是「恒空」，不是「比条数」：任何非空都是回归，哪怕只有一个名字。
    expect(JSON.parse(readFileSync(target, "utf8")), `${entry}: 未导出类型存量回来了`).toEqual([]);
  });
});

describe("门禁接线", () => {
  it("CI 真的跑 check:api，且没有被 continue-on-error 架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "check:api");
    expect(block.length, "CI 里找不到 check:api 这一步").toBeGreaterThan(0);
    expect(block.join("\n")).not.toContain("continue-on-error");
  });
});
