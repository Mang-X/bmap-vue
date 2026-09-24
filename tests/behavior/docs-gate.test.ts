/**
 * 文档站门禁回归（R25-E / issue #74「完成 docs 既存红」）
 *
 * `docs:format:check` / `docs:typecheck` / `docs:build` 长期是红的，而且**没有任何 CI 跑它们**
 * —— 于是「docs 通过」这条验收一直挂在 #25/#74 上却没人在跑。本文件锁三件事：
 *
 * 1. **它们真的进了 PR 门禁**（`quality.yml` 的 `docs` job，且 step 没被 `if:` / `continue-on-error`
 *    架空）——「门禁不存在」比「门禁失败」更难发现；
 * 2. **`docs/tsconfig.json` 的类型解析面**：docs 示例是消费方，类型检查必须对着**发布声明面**
 *    （`dist/*.d.ts`）。退回映射组件库 `src/` 会重新把库内部的 `Map` 全局引入 types 环境，
 *    立刻退化成 23 条 `Cannot find name 'Map'`；
 * 3. **一类会把 `docs:build` 打挂的 markdown 写法**：行内代码里用**转义反引号**（`\``）。
 *    markdown-it 的代码跨度规则不把转义反引号当分隔符 ⇒ 该 span 不闭合 ⇒ 后面的裸 `<...>`
 *    会被当作 HTML/Vue 标签，最后报 `Element is missing end tag`，而且**报错位置指向别处**
 *    （本次实测：真正的元凶在 83 行，报的是 128:306），排障成本极高。
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stepBlockContaining } from "./workflow-helpers";

const repoRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(repoRoot, ".github/workflows/quality.yml");
const docsTsconfigPath = resolve(repoRoot, "docs/tsconfig.json");

/** 按缩进切出某个 job 的原文（与 `typecheck-gate.test.ts` 同样的口径）。 */
function jobSectionLines(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/** 取包含某字符串的 step 区块：与其它 workflow 门禁用例共用一份实现。 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.md$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("#74 文档站门禁：真的进 CI 且步骤没被架空", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const job = jobSectionLines(workflow, "docs");

  it("quality.yml 里有 docs job", () => {
    expect(job.length).toBeGreaterThan(0);
  });

  it("格式 / lint / 类型 / 构建四条命令都在 docs job 里，且都是真 step", () => {
    for (const command of ["pnpm docs:format:check", "pnpm docs:lint", "pnpm docs:typecheck", "pnpm docs:build"]) {
      const block = stepBlockContaining(job.join("\n"), command);
      expect(block.length, command).toBeGreaterThan(0);
      const body = block.join("\n");
      expect(body, command).toMatch(/^\s*run:/m);
      expect(body, command).not.toContain("continue-on-error");
      expect(body, command).not.toMatch(/^\s*if:/m);
    }
  });

  it("docs job 先构建组件库（docs 的类型检查与站点都对着发布产物）", () => {
    const buildIndex = job.findIndex((line) => line.includes("scripts/build-package.mts"));
    const typecheckIndex = job.findIndex((line) => line.includes("pnpm docs:typecheck"));
    expect(buildIndex).toBeGreaterThan(-1);
    expect(typecheckIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(typecheckIndex);
  });
});

describe("#74 文档站类型面：对着发布声明，而不是组件库源码", () => {
  const tsconfig = JSON.parse(
    // tsconfig 允许 JSONC；这里只去掉行注释（现有文件里只有行注释）
    readFileSync(docsTsconfigPath, "utf8").replace(/^\s*\/\/.*$/gm, ""),
  ) as { compilerOptions: { paths: Record<string, string[]> } };

  it("两个公开入口都映射到 dist 的声明产物", () => {
    expect(tsconfig.compilerOptions.paths["bmap-vue"]).toEqual([
      "../packages/bmap-vue/dist/index.d.ts",
    ]);
    expect(tsconfig.compilerOptions.paths["bmap-vue/ui-kit"]).toEqual([
      "../packages/bmap-vue/dist/ui-kit.d.ts",
    ]);
  });

  it("没有任何一条映射指回组件库 src（那会让库内部的 Map 全局进入 docs 的 types 环境）", () => {
    for (const [specifier, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
      for (const target of targets) {
        expect(target, `${specifier} → ${target}`).not.toContain("packages/bmap-vue/src");
      }
    }
  });
});

describe("#74 文档站 markdown：不得出现转义反引号（会让 docs:build 报错且位置误导）", () => {
  const offenders: string[] = [];
  for (const file of walk(resolve(repoRoot, "docs"))) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\\`/.test(line)) {
        offenders.push(`${file.replace(`${repoRoot}/`, "")}:${index + 1}`);
      }
    });
  }

  it("docs/**/*.md 里没有 `\\``（用围栏代码块或改述代替）", () => {
    expect(offenders).toEqual([]);
  });
});
