/**
 * 文档 prop 名门禁自测（issue #141）
 *
 * ## 这道门禁在防什么
 *
 * `docs:typecheck` 编译示例，但**编译不出**「prop 名写错」这一类错误：
 * 一个不存在的 kebab prop 会落进 `$attrs`，Vue 既不报错、也不生效。#165 把
 * `enableScrollWheelZoom` 改名成 `enableWheelZoom` 之后，文档里 9 处旧名一直静静
 * 躺在那儿——每一条都让示例的一个开关**静默失效**。
 *
 * ## 失效方式
 *
 * 抽取器写错会让门禁恒绿（扫不到东西）或恒红（把所有 prop 都判成不符）。
 * 所以每条规则都配正反例，并断言**真实扫描面确实扫到了东西**——
 * 「扫到 0 个所以通过」和「真的干净」在日志上必须长得不一样。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-doc-props.mts");

// 没有构建出的声明面（packages/bmap-vue/dist/index.d.ts）就没有判据，
// 脚本会 fail-closed；依赖它的用例要跳过而不是假装通过。
const hasDist = existsSync(join(ROOT, "packages/bmap-vue/dist/index.d.ts"));

interface ScanResult {
  code: number;
  output: string;
}

function runGate(args: string[] = []): ScanResult {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-doc-props · 判据有区分力", () => {
  it("真实文档面通过，并且**确实扫到了东西**", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    // 关键：不能是「扫到 0 个所以通过」。这是本用例最重要的一条。
    const match = /(\d+) 处 prop 名/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(50);
  });

  it("kebab-case 的 prop 名被接受（Vue 会归一化成 camel）", () => {
    // 真实扫描面里全是 kebab 写法的 prop（`:enable-wheel-zoom`），若抽取器不认
    // kebab，上面那条会立刻红。显式点出来，避免以后有人「修」过头。
    const r = runGate();
    expect(r.output).not.toContain("enable-wheel-zoom");
  });
});

describe("check-doc-props · 抽取器", () => {
  it("camel：kebab 归一化成 camelCase", () => {
    // 与实现同形地验一遍规则本身
    const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(camel("enable-wheel-zoom")).toBe("enableWheelZoom");
    expect(camel("enableDblclickZoom")).toBe("enableDblclickZoom");
  });
});

describe("check-doc-props · 入包 README 在扫描面里（#190）", () => {
  /**
   * 这道门禁此前只扫根 README，于是**真正发到 npm** 的
   * `packages/bmap-vue/README.md` 从不参与检查：同一个错误示例在能跑的门禁里被
   * 改正、在入包 README 里静静留着（#190 的原始缺陷）。
   *
   * 下面两条分别钉住「抽取器抓得到这个缺陷」与「真实扫描面真的包含那份文件」。
   * 缺任何一条，这个回归都能悄悄回来。
   */
  it("抽取器抓得到 `<BMapProvider :ak>` 这类『声明面里没有的 prop』", async () => {
    const mod = await import("../../scripts/check-doc-props.mts");
    // 直接喂给真实抽取器，而不是在测试里重写一份正则——两份实现会漂移。
    const bad = [
      "```vue",
      "<template>",
      '  <BMapProvider :ak="ak">',
      "    <Map :zoom=\"12\" />",
      "  </BMapProvider>",
      "</template>",
      "```",
    ].join("\n");
    const found = mod.scanFile("probe.md", bad).map((m: { component: string; prop: string }) => `${m.component}:${m.prop}`);
    expect(found).toContain("BMapProvider:ak");

    // 反向：`ak` 在 `<Map>` 上是**真实存在**的 prop，不能被同一个抽取器判成可疑。
    const good = bad.replace("<BMapProvider :ak=\"ak\">", '<Map :ak="ak">').replace("</BMapProvider>", "");
    const foundGood = mod.scanFile("probe.md", good).map((m: { component: string; prop: string }) => `${m.component}:${m.prop}`);
    expect(foundGood).toContain("Map:ak");
    expect(foundGood).not.toContain("BMapProvider:ak");
  });

  it("入包 README 真的在**扫描面**里（不是「文件里恰好写了什么」）", async () => {
    const mod = await import("../../scripts/check-doc-props.mts");
    const targets = mod.scanTargets().map((t: string) => t.replace(ROOT + "/", ""));
    // 判据必须是「它会去读那份文件」，而不是「那份文件目前内容如何」——
    // 后者在 `PACKAGE_README` 被从扫描面删掉时仍然通过（#190 评审 P1 实测）。
    expect(targets).toContain(mod.PACKAGE_README);
    // 正反两例：删掉这一项即红（用真实开关而不是注释里的承诺）。
    expect(targets.filter((t: string) => t === mod.PACKAGE_README)).toHaveLength(1);
  });

  it("门禁真的会读入包 README 里的内容（把坏 prop 写进真实文件即红）", () => {
    // 端到端证明「扫描面覆盖到那份文件」：往**真实**入包 README 里临时注入
    // `<BMapProvider :ak>`，门禁必须点它的名；恢复后必须回绿。
    const path = join(ROOT, "packages/bmap-vue/README.md");
    const original = readFileSync(path, "utf8");
    try {
      writeFileSync(path, `${original}\n\n\`\`\`vue\n<template><BMapProvider :ak="ak" /></template>\n\`\`\`\n`);
      const red = runGate();
      expect(red.code, "注入坏 prop 后门禁必须失败").toBe(1);
      expect(red.output).toContain("packages/bmap-vue/README.md");
      expect(red.output).toContain("BMapProvider");
    } finally {
      writeFileSync(path, original);
    }
    if (hasDist) expect(runGate().code, "恢复后必须回绿").toBe(0);
  });

  it.runIf(hasDist)("真实扫描面通过，且入包 README 不再含缺陷原样", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    const packageReadme = readFileSync(join(ROOT, "packages/bmap-vue/README.md"), "utf8");
    // 缺陷原样（`:ak` 传给 Provider）不得再出现在这份文件里。
    expect(packageReadme).not.toMatch(/<BMapProvider[^>]*\s:ak=/);
  });

  it("根 package.json#files 声明的就是被扫描的那一份 README（两份事实不漂移）", async () => {
    const mod = await import("../../scripts/check-doc-props.mts");
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "packages/bmap-vue/package.json"), "utf8"),
    ) as { files: string[] };
    // 门禁扫的相对路径必须以 `files` 里那一条结尾——否则「扫的不是发出去的那份」。
    const declared = pkg.files.filter((f) => f.endsWith("README.md"));
    expect(declared, "入包 README 必须在 files 里").toHaveLength(1);
    expect(mod.PACKAGE_README.endsWith(declared[0]!)).toBe(true);
  });
});

describe("check-doc-props · CI 接线", () => {
  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "scripts/check-doc-props.mts");
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-doc-props.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:doc-props"]).toContain("scripts/check-doc-props.mts");
  });
});
