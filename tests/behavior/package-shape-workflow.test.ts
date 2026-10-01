/**
 * #45 新增门禁的 CI 接线（issue #45）
 *
 * 「脚本写对了」不等于「CI 真的跑它」。本文件断言三件容易静默坏掉的事：
 *
 * 1. **门禁步骤存在且未被架空** —— `continue-on-error: true` / `if:` 会让判定不生效，
 *    而步骤还在，看上去一切正常。断言落在**真正的 `run:` 所在 step 区块**上，
 *    而不是「文件里出现过这个字符串」（`workflow-helpers.ts` 的 `stepBlockContaining`
 *    就是为此存在）。
 * 2. **未锁版本的 `npx -y` 没有回来** —— 它是本票修掉的东西，回归时必须变红。
 * 3. **`volar.d.ts` 的生成步骤排在 `pack` 之前** —— 顺序反了门禁就会误报（那时缺陷是真的），
 *    但那会让「门禁红了」与「产物确实缺件」两件事混在一起，看不出是哪一步的责任。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const quality = readWorkflow("quality.yml");

/** 一个 step 区块内是否被 `continue-on-error` 架空。 */
function isNeutralized(block: readonly string[]): string | null {
  const text = block.join("\n");
  if (/continue-on-error:\s*true/.test(text)) return "continue-on-error: true";
  // step 级的 `if:` 同样能让判定不生效（job 级的 `if:` 不算，它管的是整个 job）。
  if (/^\s+if:/m.test(text)) return "step 级 if:";
  return null;
}

describe("#45 CI 接线：package job", () => {
  it("跑 check:package-shape（publint + attw + 版本锁）", () => {
    const block = stepBlockContaining(quality, "check:package-shape");
    expect(block.length).toBeGreaterThan(0);
    expect(isNeutralized(block)).toBeNull();
  });

  it("跑 check:pack-contents（发布 tarball 文件清单）", () => {
    // needle 必须是 `pnpm check:pack-contents`（**run 行**），不能是 `check:pack-contents`。
    // 后者会先命中 quality.yml:327 的**注释**——那里为了说明「从结果侧钉死」写了这句话——
    // 于是 stepBlockContaining 返回的是上一步 `Install dependencies`，断言非架空就成了假绿：
    // 真的给门禁步骤加 continue-on-error，这条仍然绿。评审 #45 时实测确认过这个假绿。
    const block = stepBlockContaining(quality, "pnpm check:pack-contents");
    expect(block.length).toBeGreaterThan(0);
    expect(block.join("\n"), "切到的必须是门禁自己那一步").toContain("Check pack contents");
    expect(isNeutralized(block)).toBeNull();
  });

  it("生成 volar.d.ts 的 manifest 步骤排在 pack 之前", () => {
    const manifestAt = quality.indexOf("generate-manifest-artifacts.mts --check");
    const packAt = quality.indexOf("pnpm --filter bmap-vue pack");
    expect(manifestAt).toBeGreaterThan(-1);
    expect(packAt).toBeGreaterThan(-1);
    expect(manifestAt, "manifest 步骤必须排在 pack 之前：否则 tarball 静默缺 Volar 类型").toBeLessThan(
      packAt,
    );
  });

  it("未锁版本的 npx -y publint / attw 没有回来", () => {
    // 这两行是 #45 修掉的：版本不锁 ⇒ 上游一次 minor 就能在无人 review 的情况下改变判定。
    expect(quality).not.toContain("npx -y publint");
    expect(quality).not.toContain("npx -y @arethetypeswrong/cli");
  });

  it("attw 的 || true 没有回来（它让「崩了」与「判了」长得一样）", () => {
    const block = stepBlockContaining(quality, "check:package-shape");
    expect(block.join("\n")).not.toMatch(/\|\|\s*true/);
  });

  it("仍保留 tarball 消费方验证（不能被新门禁挤掉）", () => {
    const block = stepBlockContaining(quality, "Package tarball consumer");
    expect(block.length).toBeGreaterThan(0);
    expect(isNeutralized(block)).toBeNull();
  });
});

/* ------------------------------ volar.d.ts 的「真正发布路径」守卫（PR 评审 P1） */

describe("#45 prepack：volar.d.ts 在真正 publish 路径上也被强制", () => {
  const pkgManifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../packages/bmap-vue/package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  it("子包自带 prepack，生成 generate-manifest-artifacts", () => {
    // 根级 `pack:package` 的前置**不够**：实测 `npm publish` 会执行**子包**的 lifecycle，
    // 但不会跑根级脚本。缺了 prepack，干净检出直接 `npm publish` 仍然复现 47 条目的
    // 缺件包——而那正是本 PR 声称修掉的那个缺陷。
    const prepack = pkgManifest.scripts?.prepack;
    expect(prepack, "packages/bmap-vue 必须有 prepack").toBeTruthy();
    expect(prepack).toContain("generate-manifest-artifacts.mts");
    // 必须用 --check：该模式**也会写** volar.d.ts（第 81 行无条件写），
    // 但同时会因 manifest 漂移而失败。
    expect(prepack).toContain("--check");
  });

  it("prepack 用的是相对路径，能从子包目录解析到仓库根", () => {
    // `generate-manifest-artifacts.mts` 按自身位置解析 root，因此从子包调用要用 ../../。
    expect(pkgManifest.scripts?.prepack).toContain("../../scripts/");
  });
});

describe("#45 attw 输出读取方式（间歇性故障回归）", () => {
  it("脚本用 shell 重定向读 attw 报告，而不是 execFileSync 的 stdout 捕获", () => {
    // attw 在本包上产出 134541 字节 JSON，且用非零退出码表示「有 problem」。这两件事同时
    // 发生时，execFileSync 的 error.stdout 会被截断到 65536 字节（Node 管道读取的分块边界），
    // 于是 JSON.parse 抛 "Unterminated string in JSON at position 65536"。
    // 症状是**时绿时红**：同一个脚本连跑多次结果不一致，而 attw 单独跑完全稳定。
    const source = readFileSync(resolve(import.meta.dirname, "../../scripts/check-package-shape.mts"), "utf8");
    expect(source, "attw 报告必须落文件再读").toContain("spawnSync");
    expect(source, "必须用 shell 重定向绕过 Node 管道缓冲").toContain("shell: true");

    // 这条是那个 bug 的**直接证据**。判据刻意写成「attw 的结论只能来自 report 文件」，
    // 而不是去正则匹配各种 `.stdout` 写法——第一版那么写，被 `(attwRun as any).stdout`
    // 这种带括号断言的形态绕过，注入回归后测试仍然绿（假绿）。
    // 正确的问法是：读到的那份 JSON 是不是**只**来自 `readFileSync(attwOutFile)`。
    //
    // 正则刻意**不跨行**（`[^;\n]+`）：第一版用 `[^;]+`，它会一路吞到下一个分号，把
    // `if (attwRaw === undefined) {` 也算成一条赋值，于是正常代码被判红。
    const assignments = [...source.matchAll(/^\s*attwRaw\s*=\s*([^;\n]+);/gm)].map((m) => m[1]!.trim());
    expect(assignments.length, "脚本里应当只有一处 attwRaw 赋值").toBe(1);
    expect(assignments[0]).toContain("readFileSync(attwOutFile");
  });
});

describe("#45 门禁判定的负例自测（合成 workflow）", () => {
  const synth = [
    "jobs:",
    "  package:",
    "    steps:",
    "      - name: gated",
    "        continue-on-error: true",
    "        run: pnpm check:pack-contents",
    "      - name: gated2",
    "        if: github.event_name == 'push'",
    "        run: pnpm check:pack-contents",
    "      - name: fine",
    "        run: pnpm check:pack-contents",
  ].join("\n");

  it("continue-on-error: true 必须被判定为已架空", () => {
    const block = stepBlockContaining(synth, "check:pack-contents");
    expect(isNeutralized(block)).toBe("continue-on-error: true");
  });

  it("step 级 if: 同样判定为已架空", () => {
    // 用只含该 step 的合成文本，避免 stepBlockContaining 取到第一个命中。
    const solo = ["      - name: gated", "        if: github.event_name == 'push'", "        run: pnpm x"].join(
      "\n",
    );
    expect(isNeutralized(stepBlockContaining(solo, "pnpm x"))).toBe("step 级 if:");
  });

  it("正常 step 不被判为架空（正证：否则上面两条恒真）", () => {
    const solo = ["      - name: fine", "        run: pnpm check:pack-contents"].join("\n");
    expect(isNeutralized(stepBlockContaining(solo, "check:pack-contents"))).toBeNull();
  });
});