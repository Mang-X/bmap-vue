/**
 * v4 required smoke 的 CI 接线与「迁仓后不静默跳过」守卫（R25-E / issue #74 实施步骤 6）
 *
 * 两件容易静默坏掉的事，各配**正证 + 反证**：
 *
 * 1. **job 守卫写成个人账号** ⇒ 仓库迁到组织后 `github.repository_owner` 已是组织名，
 *    `if: github.repository_owner == 'MangMax'` 会让 job **永久跳过**——CI 看着是绿的，
 *    其实什么都没跑。「绿」与「没跑」必须可区分，所以这条判定按**字面量**核对，
 *    并用合成 workflow 证明它真的会红。
 * 2. **门禁步骤被架空**（`continue-on-error: true`、被 `if:` 挂住）⇒ 步骤在、判定不生效。
 *    断言落在**真正的 `run:` 所在 step 区块**上，而不是「文件里出现过这个字符串」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkflowNames, readWorkflow, stepBlockContaining } from "./workflow-helpers";

const NEW_REPO = "Mang-X/bmap-vue";
const ORG = "Mang-X";

const workflowNames = listWorkflowNames();

/* ------------------------------------------------------------------ 判定（纯函数） */

/**
 * 找出「会让 job 静默跳过」的守卫写法。
 *
 * - `github.repository_owner` 必须比较组织名（比较个人账号 ⇒ 迁仓后永久跳过）；
 * - `github.repository` 必须比较**完整** `owner/repo`（只比 owner 同样会跳过或误放行）。
 */
export function guardIssues(text: string): string[] {
  const issues: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("if:") && !trimmed.startsWith("if :")) continue;
    for (const match of trimmed.matchAll(/github\.repository_owner\s*[!=]==?\s*(['"])([^'"]*)\1/g)) {
      if (match[2] !== ORG) {
        issues.push(`repository_owner 守卫比较的不是组织名 ${ORG}：${match[2]}`);
      }
    }
    for (const match of trimmed.matchAll(/github\.repository\s*[!=]==?\s*(['"])([^'"]*)\1/g)) {
      if (match[2] !== NEW_REPO) {
        issues.push(`repository 守卫比较的不是完整 owner/repo ${NEW_REPO}：${match[2]}`);
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ 负例自测（反证） */

describe("#74 CI 守卫判定：合成 workflow 上的负例自测", () => {
  it("比较个人账号的 owner 守卫必须被判定为问题（否则这条守卫就是恒真）", () => {
    const bad = [
      "jobs:",
      "  live-smoke:",
      "    if: github.repository_owner == 'MangMax'",
      "    runs-on: ubuntu-latest",
    ].join("\n");
    expect(guardIssues(bad).length).toBeGreaterThan(0);
  });

  it("比较组织名 / 完整 owner-repo 的守卫没有意见（正证）", () => {
    const good = [
      "jobs:",
      "  a:",
      `    if: github.repository == '${NEW_REPO}'`,
      "  b:",
      `    if: github.repository_owner == '${ORG}'`,
    ].join("\n");
    expect(guardIssues(good)).toEqual([]);
  });

  it("只比较 owner 的 repository 守卫同样被判定为问题（迁仓后一样会跳过）", () => {
    const bad = "    if: github.repository == 'MangMax'";
    expect(guardIssues(bad).length).toBeGreaterThan(0);
  });

  it("step 区块切分只取目标 step，不把后面的步骤算进来", () => {
    const text = [
      "      - name: A",
      "        run: echo a",
      "      - name: B",
      "        run: echo b",
    ].join("\n");
    const block = stepBlockContaining(text, "echo b");
    expect(block.join("\n")).not.toContain("echo a");
    expect(block.join("\n")).toContain("echo b");
  });
});

/* ------------------------------------------------------------------ 真仓库上的守卫 */

describe("#74 CI 守卫：现有 workflow 不得静默跳过", () => {
  it("仓库里每个 workflow 的 job 守卫都指向新组织 / 新仓库", () => {
    const found: Record<string, string[]> = {};
    for (const name of workflowNames) {
      const issues = guardIssues(readWorkflow(name));
      if (issues.length > 0) found[name] = issues;
    }
    expect(found).toEqual({});
  });

  it("nightly v4 smoke 用完整 owner/repo 守卫（不是 owner），且路径存在", () => {
    const name = "nightly-v4-smoke.yml";
    expect(workflowNames).toContain(name);
    const text = readWorkflow(name);
    expect(text).toContain(`github.repository == '${NEW_REPO}'`);
    expect(guardIssues(text)).toEqual([]);
  });

  it("nightly 的 AK 缺失给出可执行信息，而不是让运行器以代码问题形态失败", () => {
    const text = readWorkflow("nightly-v4-smoke.yml");
    expect(text).toContain("secrets.BAIDU_MAP_AK");
    expect(text).toMatch(/if \[ -z "\$BAIDU_MAP_AK" \]/);
    expect(text).toContain("::error::");
  });

  it("nightly 真的调用了 live smoke 脚本，且该 step 没有被架空", () => {
    const text = readWorkflow("nightly-v4-smoke.yml");
    const block = stepBlockContaining(text, "scripts/smoke-jsapi-v4.mts");
    expect(block.length).toBeGreaterThan(0);
    const body = block.join("\n");
    expect(body).toMatch(/^\s*run:/m);
    expect(body).toContain("--mode=live");
    expect(body).not.toContain("continue-on-error");
    // 被 `if:` 挂住的 step 等于没跑：只允许出现在 job 级守卫上。
    expect(body).not.toMatch(/^\s*if:/m);
  });

  /**
   * P0 回归（第 1 轮评审）：文档与 nightly 的注释都声称 fixture 档是「PR 门禁」，
   * 而当时**没有任何 workflow 跑它**——门禁实际不存在、注释在说谎。
   */
  it("fixture 档真的被 PR 门禁跑起来（不是只写在注释里）", () => {
    const text = readWorkflow("quality.yml");
    const block = stepBlockContaining(text, "smoke:v4:fixture");
    expect(block.length).toBeGreaterThan(0);
    const body = block.join("\n");
    expect(body).toMatch(/^\s*run:/m);
    expect(body).not.toContain("continue-on-error");
    expect(body).not.toMatch(/^\s*if:/m);
  });
});

/* ------------------------------------------------------------------ package.json 接线 */

describe("#74 npm scripts：两条命令都在，且都指向同一个 orchestrator", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  it("smoke:v4:fixture 与 smoke:v4 分别对应 fixture / live 档", () => {
    expect(pkg.scripts["smoke:v4:fixture"]).toContain("--mode=fixture");
    expect(pkg.scripts["smoke:v4"]).toContain("--mode=live");
    for (const key of ["smoke:v4", "smoke:v4:fixture"]) {
      expect(pkg.scripts[key]).toContain("scripts/smoke-jsapi-v4.mts");
    }
  });

  it("文档里承诺的命令名与脚本存在性一致（文档不能写一条跑不起来的命令）", () => {
    const doc = readFileSync(
      resolve(import.meta.dirname, "../../docs/zh-CN/contributing/v4-browser-smoke.md"),
      "utf8",
    );
    for (const command of doc.matchAll(/pnpm (smoke:v4(?::fixture)?)/g)) {
      expect(pkg.scripts[command[1]!], command[1]).toBeDefined();
    }
  });
});
