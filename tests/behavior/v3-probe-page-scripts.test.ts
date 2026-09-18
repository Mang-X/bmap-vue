/**
 * 探针页面脚本的静态守卫（issue #97）
 *
 * 背景：`scripts/probe-*.mts` 里的页面脚本是一个 **TS 模板串**（`const PAGE_JS = \`...\``），
 * 于是它有两条只在「某一天跑真实探针」时才会暴露的坑：
 *
 * 1. **模板串内出现反引号会截断模板串**。写注释时手滑写成 `` `tile.src = url` `` 就会让外层
 *    TS 直接 `ERR_INVALID_TYPESCRIPT_SYNTAX: Expected a semicolon`——而报错位置在被截断的**下一行**，
 *    非常难定位。2026-09-17 实测在同一份文件里连踩两次；**2026-09-18 又在
 *    `probe-layer-detached.mts` 里踩了第三次**（正是在给本守卫加「引号」这类说明时踩的），
 *    于是这道守卫同时挂在两个分支上。这就是它必须存在、而且必须覆盖 `probe-*.mts` 全集的理由。
 * 2. **页面脚本自身的语法错**会让页面永远不写报告，表现是「读报告超时」（几分钟后才失败）。
 *    探针里用 `new Function(pageScript)` 做了预检，但那道预检**检查不到坑 1**
 *    （坑 1 在外层文件，代码根本 import 不进来）。
 *
 * 所以这里把两件事都变成机器可查的：**先按文本抽出模板串**（不 import 目标文件，因此即使它当前
 * 语法已坏也能跑），再断言「内容里没有反引号」+「`new Function` 能编译」。
 *
 * 覆盖方式：glob `scripts/probe-*.mts`，凡是有 `const PAGE_JS = \`` 的文件都要过这两条。
 * 有正证守卫（必须至少检查到 1 个模板串），否则文件被改名/搬走时这个守卫会静默空转。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ 路径用 `process.cwd()`（vitest 的 root 就是仓库根），**不要**用 `import.meta.url`：
 * Vite 会把模块 id 改写成 `/@fs/…` 形式，`new URL(...).pathname` 拿出来的是假路径
 * （实测 `ENOENT: scandir '/@fs/Users/…/scripts'`）。
 */
const SCRIPTS_DIR = join(process.cwd(), "scripts");

/**
 * 从源码文本里抽出 `const PAGE_JS = \`` … 结束行之间的内容。
 *
 * 结束行的形态在不同探针里不一样（有 `\`;`、也有单独一个 `\``），因此按「trim 之后以反引号开头」
 * 判定；找不到就说明模板串已经被截断了（那正是本守卫要抓的形态）。
 */
function extractPageScripts(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]!.startsWith("const PAGE_JS = `")) continue;
    const end = lines.findIndex((line, index) => index > i && line.trim().startsWith("`"));
    expect(
      end,
      `第 ${i + 1} 行开始的 PAGE_JS 模板串没有找到结束符（说明它已经被反引号截断了）`,
    ).toBeGreaterThan(i);
    found.push(lines.slice(i + 1, end).join("\n"));
  }
  return found;
}

const probeFiles = readdirSync(SCRIPTS_DIR)
  .filter((name) => name.startsWith("probe-") && name.endsWith(".mts"))
  .map((name) => ({ name, source: readFileSync(join(SCRIPTS_DIR, name), "utf8") }))
  .filter((entry) => entry.source.includes("const PAGE_JS = `"));

describe("[#97] 探针页面脚本的静态守卫", () => {
  it("至少有一个探针带 PAGE_JS 模板串（正证守卫：文件改名/搬走时不得静默空转）", () => {
    expect(probeFiles.length, `在 ${SCRIPTS_DIR} 下没有找到带 PAGE_JS 的 probe-*.mts`).toBeGreaterThan(0);
  });

  it.each(probeFiles.map((entry) => entry.name))("%s：PAGE_JS 模板串里不得出现反引号", (name) => {
    const entry = probeFiles.find((candidate) => candidate.name === name)!;
    const scripts = extractPageScripts(entry.source);
    expect(scripts.length, `${name} 里没有抽到 PAGE_JS 内容`).toBeGreaterThan(0);
    for (const script of scripts) {
      const offending = script
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter((item) => item.line.includes("`"));
      expect(
        offending.map((item) => `第 ${item.index + 1} 行：${item.line.trim()}`),
        `${name} 的 PAGE_JS 模板串里出现了反引号 —— 它会截断外层模板串，报 ERR_INVALID_TYPESCRIPT_SYNTAX`,
      ).toEqual([]);
    }
  });

  it.each(probeFiles.map((entry) => entry.name))("%s：页面脚本能被 new Function 编译（预检同一道门）", (name) => {
    const entry = probeFiles.find((candidate) => candidate.name === name)!;
    for (const script of extractPageScripts(entry.source)) {
      // 与探针里的预检同一件事：编译（不执行）。页面脚本里用到的 `__AK__` 之类占位符只是标识符，
      // 语法检查不需要它们存在。
      expect(() => new Function(script), `${name} 的 PAGE_JS 编译失败`).not.toThrow();
    }
  });
});
