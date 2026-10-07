/**
 * 三处 API 示例一致性门禁自测（issue #141）
 *
 * 这道门禁的失效方式是**恒绿**：抽取逻辑写错（没抓到任何标识符）时，
 * 真实树照样通过——真实树里三处示例的形状恰好完全相等，所以任何弱化判据的改动
 * 都不会被现有用例发现。上一版测试文件顶部写着「合法 / 不存在 / bash-json 注释」
 * 三类负向控制，实际一条都没有，`makeTmp()` 定义了从未使用。
 *
 * 现在补的是**真的负向样本**：用 `--dir` 把三处示例面换到合成目录，跑真实门禁脚本。
 * 每条断言都要求门禁在**错误的输入**上变红——没有区分力的断言等于没写。
 *
 * 判据本身的口径是「每处都必须包含三处的并集」，等价于三者完全相等：
 * 少任何一个名字都红。文档站比 README 多两个名字是**合理扩展**，但那意味着另两处
 * 也得有——所以并集判据与完全相等在这个形状下同义，用哪个说法都成立，
 * 重要的是它真的会对「某处少写」变红（见下面「某处少一个标识符」）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-snippet-consistency.mts");

const tmp: string[] = [];
afterEach(() => {
  while (tmp.length > 0) rmSync(tmp.pop()!, { recursive: true, force: true });
});

/**
 * 造一个含三处示例面的目录。
 *
 * `readme` 与 `package-readme` 内容相同，docs 可以不同——真实的三处就是这个关系。
 * 文件名必须与 `SNIPPET_SURFACES` 一致，脚本按固定文件名读。
 */
function makeTmp(readme: string, packageReadme: string, docs: string): string {
  const root = mkdtempSync(join(tmpdir(), "snippet-gate-"));
  tmp.push(root);
  writeFileSync(join(root, "README.md"), readme);
  const pkgDir = join(root, "packages/bmap-vue");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "README.md"), packageReadme);
  const docsDir = join(root, "docs/zh-CN/guide");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, "quick-start.md"), docs);
  return root;
}

const GOOD = `\`\`\`vue
<script setup>
import { Map, Marker } from '@mangax/bmap-vue'
</script>
<template><Map><Marker /></Map></template>
\`\`\`
`;

/** 只含一个标识符的基线，用在「噪音不该被算成用法」那类断言上。 */
const BASE_ONE = `\`\`\`vue
<script setup>
import { Map } from '@mangax/bmap-vue'
</script>
<template><Map /></template>
\`\`\`
`;

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

/** 门禁读不到 dist 时没有判据，这类用例必须跳过而不是假装通过。 */
const hasDist = runGate().code === 0;

describe("check-snippet-consistency · 抽取器有区分力", () => {
  it("三处完全一致的真实 API → 绿", () => {
    if (!hasDist) return;
    const r = runGate(["--dir", makeTmp(GOOD, GOOD, GOOD)]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("Map");
    expect(r.output).toContain("Marker");
  });

  it.runIf(hasDist)("标识符不在发布声明面里 → 必须红（证明它抓得到**坏**名字）", () => {
    const bad = GOOD.replace("Marker", "MarkerXyz");
    const r = runGate(["--dir", makeTmp(bad, bad, bad)]);
    expect(r.code, "不存在的标识符必须让门禁失败").toBe(1);
    expect(r.output).toContain("MarkerXyz");
    expect(r.output).toContain("不在发布声明面里");
  });

  it.runIf(hasDist)("某处少一个标识符 → 必须红（形状漂移）", () => {
    // import 与模板标签都要删：判据抽的是 `imports ∪ tags` 两者的并集，
    // 只删 import 的话 `<Marker />` 仍把名字留在集合里，门禁自然绿——
    // 这是第一次写这条用例时犯的错，真实判据比直觉更宽。
    const fewer = GOOD.replace(", Marker", "").replace("<Marker />", "");
    const r = runGate(["--dir", makeTmp(GOOD, GOOD, fewer)]);
    expect(r.code, "docs 少写 Marker 必须让门禁失败").toBe(1);
    expect(r.output).toContain("形状不一致");
    expect(r.output).toContain("Marker");
  });

  it.runIf(hasDist)("docs 多一个名字而另两处没有 → 同样红（并集判据）", () => {
    const more = GOOD.replace(/'@mangax\/bmap-vue'/, "'@mangax/bmap-vue'").replace(
      "import { Map, Marker }",
      "import { Map, Marker, ZoomControl }",
    );
    const r = runGate(["--dir", makeTmp(GOOD, GOOD, more)]);
    expect(r.code, "只有 docs 有 ZoomControl，另两处缺 → 必须失败").toBe(1);
    expect(r.output).toContain("ZoomControl");
  });

  it.runIf(hasDist)("bash / json 块与注释里的名字不算 API 用法（判据不产生噪音）", () => {
    // 基线只含 `Map`；下面这些噪音名字**一个都不该**出现在报出的标识符里。
    // （第一版拿 GOOD 当基线，而 GOOD 本身就含 Marker，却又断言输出不含它——自相矛盾。）
    const base = BASE_ONE;
    const noisy =
      base +
      "\n```bash\npnpm add bmap-vue\n```\n" +
      "\n```json\n{ \"notAComponent\": true }\n```\n" +
      "\n```vue\n" +
      "<!-- <Marker> 在 HTML 注释里不算 -->\n" +
      "<script setup>\n" +
      "// import { Fake } from '@mangax/bmap-vue'\n" +
      "/* import { AlsoFake } from '@mangax/bmap-vue' */\n" +
      "import { Map } from '@mangax/bmap-vue'\n" +
      "</script>\n```\n";
    const r = runGate(["--dir", makeTmp(noisy, noisy, noisy)]);
    expect(r.code, r.output).toBe(0);
    for (const noise of ["Marker", "Fake", "AlsoFake", "notAComponent"]) {
      expect(r.output, noise + " 是注释或非示例代码里的名字，不该被算成 API 用法").not.toContain(noise);
    }
    expect(r.output).toContain("Map");
  });

  it.runIf(hasDist)("从子路径导入也算公开 API（@mangax/bmap-vue/advanced 等）", () => {
    const sub = `\`\`\`ts
import { unwrapRaw } from '@mangax/bmap-vue/advanced'
\`\`\`\n`;
    const r = runGate(["--dir", makeTmp(sub, sub, sub)]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("unwrapRaw");
  });

  it.runIf(hasDist)("代码块不自足（模板用了本库组件却没在本块 import）→ 必须红（#190 评审 P1）", () => {
    // 复现评审在入包 README 第三段抓到的现场：模板用 `<Map>`，本块只导入
    // `BMapProvider, ZoomControl`。`vue-tsc` 对未解析的**组件标签**退出码是 0
    // （实测），所以只有这条静态判据能挡住它。
    const notSelfContained = `\`\`\`vue
<script setup>
import { BMapProvider, ZoomControl } from '@mangax/bmap-vue'
</script>
<template>
  <BMapProvider><Map :zoom="12"><ZoomControl /></Map></BMapProvider>
</template>
\`\`\`\n`;
    const r = runGate(["--dir", makeTmp(notSelfContained, notSelfContained, notSelfContained)]);
    expect(r.code, "模板用了未导入的 Map 必须失败").toBe(1);
    expect(r.output).toContain("不自足");
    expect(r.output).toContain("<Map>");
  });

  it.runIf(hasDist)("同块导入即绿（判据不是「凡用了 Map 就红」）", () => {
    const selfContained = `\`\`\`vue
<script setup>
import { BMapProvider, Map, ZoomControl } from '@mangax/bmap-vue'
</script>
<template>
  <BMapProvider><Map :zoom="12"><ZoomControl /></Map></BMapProvider>
</template>
\`\`\`\n`;
    const r = runGate(["--dir", makeTmp(selfContained, selfContained, selfContained)]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("自足");
  });

  it.runIf(hasDist)("跨块 import 不算数（每个块各自自足，不能靠别的块兜底）", () => {
    // 第一块导入 `Map`，第二块只用不导——合并 fixture 曾让这种泄漏蒙混过关。
    const leaked = `\`\`\`vue
<script setup>
import { Map } from '@mangax/bmap-vue'
</script>
<template><Map /></template>
\`\`\`

\`\`\`vue
<script setup>
import { Marker } from '@mangax/bmap-vue'
</script>
<template><Map><Marker /></Map></template>
\`\`\`\n`;
    const r = runGate(["--dir", makeTmp(leaked, leaked, leaked)]);
    expect(r.code, "第二块借第一块的 import 必须失败").toBe(1);
    expect(r.output).toContain("第 2 个代码块");
  });

  it.runIf(hasDist)("原生标签与 VitePress 组件不参与自足判据（不产生噪音）", () => {
    const nativeOnly = `\`\`\`vue
<template>
  <div><Badge text="tip" /><span>hi</span></div>
</template>
\`\`\`\n`;
    const r = runGate(["--dir", makeTmp(nativeOnly, nativeOnly, nativeOnly)]);
    // 没有本库组件 ⇒ 自足判据无话可说；但它也没有首图/形状，整体结果由既有判据决定。
    expect(r.output).not.toContain("不自足");
  });
});

describe("check-snippet-consistency · 真实树", () => {
  it("通过，并报出它实际校验的标识符", () => {
    const r = runGate();
    if (r.code !== 0) {
      // 没 build:package 时没有判据，门禁正确地 fail-closed。
      expect(r.output).toContain("读不到 packages/bmap-vue/dist");
      return;
    }
    const match = /的 (\d+) 个标识符/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(3);
    expect(r.output).toContain("Map");
    expect(r.output).toContain("createBMapPlugin");
  });

  it("真实三处的形状完全相等（所以上面的负向样本才能覆盖真实形状）", () => {
    const r = runGate();
    if (r.code !== 0) return;
    // 真树 7 个标识符，三处齐全。若将来某一处真的引入了「合法的额外示例」，
    // 这条会红——那时需要重新确认并集判据是否仍符合意图，而不是改断言迁就。
    expect(r.output).toMatch(/的 (\d+) 个标识符/);
    const names = /（([^）]*)）/.exec(r.output)![1]!.split(",").map((s) => s.trim());
    expect(new Set(names).size, "报出的名字不应有重复").toBe(names.length);
  });
});

describe("check-snippet-consistency · CI 接线", () => {
  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "scripts/check-snippet-consistency.mts");
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-snippet-consistency.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:snippet-consistency"]).toContain("scripts/check-snippet-consistency.mts");
  });
});
