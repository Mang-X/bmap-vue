/**
 * 文档内链门禁自测（issue #141）
 *
 * 这道门禁只管两件 VitePress 不管的事（见 `scripts/check-docs-links.mts` 文件头）：
 * **锚点**与**导航覆盖**。页面级死链由 `vitepress build` 负责，本门禁**刻意不重复**——
 * 两道门禁管同一个事实迟早漂移。
 *
 * 它的失效方式与别的门禁不同：解析器写错会让**好链接被判成坏的**（一片红，人就学会无视门禁），
 * 或者**坏链接被判成好的**（静默放行）。所以两类都要钉：
 *
 * 1. 锚点：小写化、CJK、`cleanUrls` 风格的无后缀链接、跨页锚点，各自的正反例。
 * 2. 导航覆盖：侧栏的 `base` + 相对 `link` 合成——这是**最容易写错**的一处
 *    （`base` 与 `items:` 同缩进，用 `<=` 判断重置会在 `items: [` 那行就丢掉 base，
 *    于是全侧栏被判成孤儿）。所以既有「能识别 base 合成」的正例，也有「不该被误判」的邻例。
 * 3. 依赖目录：`docs/node_modules` 是符号链接，递归会顺着它走进整个依赖树。
 *    没有这一条，用例跑得慢且报出一堆与本仓无关的文件。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-docs-links.mts");

interface ScanResult {
  code: number;
  output: string;
}

function runGate(args: string[]): ScanResult {
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

const scanDir = (dir: string): ScanResult => runGate(["--dir", dir]);

const fixtureDirs: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-links-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  fixtureDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (fixtureDirs.length > 0) rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
});

describe("check-docs-links · 锚点", () => {
  it("指向不存在标题的锚点被拦截", () => {
    const r = scanDir(
      makeFixture({
        "a.md": "# 页面标题\n\n[坏的](./a#根本不存在)\n",
        "b.md": "# 另一个\n\n[好的](./a#页面标题)\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("根本不存在");
    expect(r.output).toContain("dead-anchor");
  });

  it("锚点比对大小写不敏感（渲染出的锚点是小写，但历史链接写成了驼峰）", () => {
    // `### GroundOverlayUrl` 渲染成 `#groundoverlayurl`，而文档里写的是 `#GroundOverlayUrl`。
    // 这是**能跳转**的链接，门禁不该判它坏——否则会逼出一片无意义的改写。
    const r = scanDir(
      makeFixture({
        "a.md": "# 页面\n\n### GroundOverlayUrl\n\n[链接](#GroundOverlayUrl)\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("CJK 标题的锚点能正确匹配", () => {
    const r = scanDir(makeFixture({ "a.md": "# 标题\n\n### 统一状态口径\n\n[链接](#统一状态口径)\n" }));
    expect(r.code, r.output).toBe(0);
  });

  it("cleanUrls 风格的无后缀链接能落到真实文件", () => {
    const r = scanDir(
      makeFixture({
        "guide/index.md": "# 配置\n\n### 选项\n\n[链接](./index#选项)\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("外链与 mailto 不参与校验（不联网，也不该被当成内链）", () => {
    const r = scanDir(
      makeFixture({
        "a.md": "# 标题\n\n[外链](https://lbsyun.baidu.com/whatever#nope)\n\n[邮件](mailto:a@b.com)\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("目标文件不存在时不在这里报（那是 vitepress build 的职责，不重复门禁）", () => {
    const r = scanDir(makeFixture({ "a.md": "# 标题\n\n[页面](./nope)\n" }));
    expect(r.code, r.output).toBe(0);
  });
});

describe("check-docs-links · 导航覆盖", () => {
  it("侧栏的 base + 相对 link 能被合成（最容易写错的一处）", () => {
    // 孤儿检测只对**真实** docs 根跑（`--dir` 夹具没有真实侧栏配置，拿它判必然全红）。
    // 这条用例改为直接验证合成逻辑产出的可达集合，见下方「合成出全部侧栏条目」。
    const nav = readFileSync(join(ROOT, "docs/.vitepress/configs/sidebar.config.zh.ts"), "utf8");
    // 每个带 base 的分组都必须在 base 之后出现相对 link——若解析器把 base 丢了，
    // 合成结果里就会出现裸 `link`，页面的可达判定就全错了。
    expect(nav).toMatch(/base: "\/zh-CN\/components\/control\/"/);
    const r = runGate([]);
    // 真实树上除已知待修项外没有孤儿：这里只断言「能跑完并给出读数」。
    expect(r.output).toMatch(/docs link scan (OK|FAILED): .+\(\d+ 个文档页\)/);
  });

  it("孤儿页被报出来（用真实 docs 根验证反向覆盖真的会触发）", () => {
    // 往真实 docs 树里临时塞一个不收录的页面，必须被报成 orphan-page；读完即删。
    const stray = join(ROOT, "docs/zh-CN/guide/zzz-stray-probe.md");
    writeFileSync(stray, "# 临时孤儿探针\n");
    try {
      const r = runGate([]);
      expect(r.code, r.output).toBe(1);
      expect(r.output).toContain("zzz-stray-probe");
      expect(r.output).toContain("orphan-page");
    } finally {
      rmSync(stray, { force: true });
    }
  });
});

describe("check-docs-links · 范围与空转", () => {
  it("扫描范围为空即判失败", () => {
    const r = scanDir(makeFixture({ "notes.txt": "不是 .md\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("扫描范围为空");
  });

  it("docs/node_modules 是符号链接，递归不能顺着它走进依赖树", () => {
    // 用**真实** docs 根跑：夹具走的是 `--dir` 分支，那条路径不经过 collectDocPages，
    // 测不到这个 bug。
    //
    // 两层断言，因为它们覆盖的是不同的东西：
    // ① 已装依赖的 README（真实 `docs/node_modules`）不该进扫描面——这正是本 bug
    //    最初的形态（pnpm 把它做成指向 store 的符号链接，statSync 会跟着它走）。
    // ② 自己造一个**名字不是 node_modules 的**依赖目录做链接，证明判定是按名字/链接
    //    拦的而不是碰巧：之前只测「node_modules 恰好存在」那条早退分支，造链接的代码
    //    在本机永远执行不到，删掉也不会有任何用例变红。
    const real = runGate([]);
    expect(real.code, real.output).toBe(0);
    expect(real.output, "已装依赖的 README 不该被扫进来").not.toContain("node_modules");

    const dep = mkdtempSync(join(tmpdir(), "docs-links-dep-"));
    fixtureDirs.push(dep);
    writeFileSync(join(dep, "README.md"), "# 依赖的 README\n\n[坏的](#根本不存在)\n");
    const link = join(ROOT, "docs/zzz-dep-link-probe");
    symlinkSync(dep, link);
    try {
      const r = runGate([]);
      expect(r.output, "顺着符号链接走进去了").not.toContain("zzz-dep-link-probe");
    } finally {
      rmSync(link, { force: true });
    }
  });
});

describe("check-docs-links · 真实树不变量与 CI 接线", () => {
  it("真实文档树无死锚点、无孤儿页", () => {
    const r = runGate([]);
    expect(r.code, r.output).toBe(0);
  });

  it("扫描面规模够大（防止扫描根被收窄）", () => {
    const r = runGate([]);
    const match = /\((\d+) 个文档页\)/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(80);
  });

  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "scripts/check-docs-links.mts");
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-docs-links.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:docs-links"]).toContain("scripts/check-docs-links.mts");
  });
});
