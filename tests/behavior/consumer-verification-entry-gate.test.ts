/**
 * 统一接线与最终验收的自测（issue #158 工作包 E）
 *
 * 工作包 E 的三条要求各有一个**可判定的落点**，这里逐条钉住：
 *
 * 1. **A–D 接入同一实现，CI 调同一入口**：`verify:package` 调四个消费脚本；CI 里**两个**
 *    job（`quality` 与 `package`）都必须经 `pnpm verify:package`，不得直接跑脚本 —— 直接跑
 *    会分叉（`quality` 那处少了 `.artifacts` 清理）。
 * 2. **明确选定一个 tgz 并记录版本 / commit / 摘要**：`selectTarball` 在多于一个候选时必须
 *    失败；`describeTarball` 必须把三者都带上。
 * 3. **任一必需场景失败返回非零**：workflow 里不得对消费验证用 `continue-on-error`。
 *
 * 判据本体是纯函数（`tarball-identity.mts`），这里既有行为反例也有接线检查。
 * 真实 tarball / Vite / vue-tsc 的集成由 CI 的 `package` job 跑。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  describeTarball,
  selectTarball,
  type TarballIdentity,
} from "../../scripts/tarball-identity.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");
const IDENTITY: TarballIdentity = { name: "@mangax/bmap-vue", version: "1.0.0-rc.0" };

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("E：CI 与本地同一入口", () => {
  it("CI 的每个 job 都经 pnpm verify:package，不直接跑脚本", () => {
    const workflow = readWorkflow("quality.yml");
    // 判据只看 **`run:` 的实体**，不看文本出现次数：注释里提一句 `pnpm verify:package`
    // 也会命中纯文本计数，那样「注释」就能冒充一次真实调用。
    //
    // `run:` 有两种形态：单行（`run: pnpm verify:package`）与块（`run: |` 后跟多行 shell），
    // 块形态里可能是 `pack` + `verify:package` 的组合，所以按**块**取再在块内找。
    const runBodies: string[] = [];
    for (const [index, line] of workflow.split(/\r?\n/).entries()) {
      const single = /^\s*run:\s+(?!\|)(.+)$/.exec(line);
      if (single !== null) {
        runBodies.push(single[1]!);
        continue;
      }
      if (/^\s*run:\s*\|\s*$/.test(line)) {
        const indent = /^(\s*)/.exec(line)![1]!.length;
        const body: string[] = [];
        for (const next of workflow.split(/\r?\n/).slice(index + 1)) {
          if (next.trim().length === 0) continue;
          if (/^(\s*)/.exec(next)![1]!.length <= indent) break;
          body.push(next.trim());
        }
        runBodies.push(body.join("\n"));
      }
    }
    const invocations = runBodies.filter((body) => body.includes("verify:package"));
    expect(
      invocations.length,
      `CI 里真正执行 verify:package 的 run 步骤有 ${invocations.length} 个，期望 2 个` +
        `（quality 与 package 各一个）—— 少一个说明那处退回了直接跑脚本，两处会分叉`,
    ).toBe(2);
    for (const body of invocations) {
      expect(body, `这个 run 步骤不是 pnpm verify:package：\n${body}`).toContain(
        "pnpm verify:package",
      );
    }
    // 反向：不得**执行** scripts/verify-package.mts。判据同样只看 run 实体 ——
    // workflow 里合法地**提到**过这个文件（`check:docs-brand` 步骤的注释里点名它是拒绝表），
    // 按全文查会假红。
    for (const body of runBodies) {
      expect(
        body,
        `CI 里直接跑了 scripts/verify-package.mts（应当只经 pnpm verify:package）：\n${body}`,
      ).not.toContain("scripts/verify-package.mts");
    }
  });

  it("每个消费验证步骤都不得被 continue-on-error 架空", () => {
    // 切「步骤」时必须**同时**在下一个同级 `-` 列表项、以及第一个更浅缩进的行
    // （`performance:` 这类 job 名）处收口。只按前者切会越过末尾注释块吃进下一个 job ——
    // performance job 的说明里合法地写着「不能用 continue-on-error 架空」，那会被误判成
    // 消费验证步骤自己的内容。
    const lines = readWorkflow("quality.yml").split(/\r?\n/);
    const stepStarts: number[] = [];
    for (const [index, line] of lines.entries()) {
      if (/^\s*-\s/.test(line)) stepStarts.push(index);
    }
    const clip = (from: number, to: number): string => {
      const indent = /^(\s*)/.exec(lines[from]!)![1]!.length;
      const out: string[] = [lines[from]!];
      for (const line of lines.slice(from + 1, to)) {
        if (line.trim().length === 0) continue;
        const currentIndent = /^(\s*)/.exec(line)![1]!.length;
        if (currentIndent < indent) break;
        out.push(line);
      }
      return out.join("\n");
    };
    const steps = stepStarts.map((from, index) =>
      clip(from, stepStarts[index + 1] ?? lines.length),
    );
    const consumerSteps = steps.filter((step) =>
      // 单行 `run: pnpm verify:package` 与块形态里独立成行的 `pnpm verify:package` 都要认。
      // 只认单行会漏掉 quality job（它的 run 体里还有 pack）。
      /^\s*run:\s*pnpm verify:package\s*$/m.test(step) ||
      /^\s+pnpm verify:package\s*$/m.test(step),
    );
    expect(
      consumerSteps.length,
      `真正执行 pnpm verify:package 的步骤有 ${consumerSteps.length} 个，期望 2 个` +
        `（quality 与 package 各一个）`,
    ).toBe(2);
    for (const step of consumerSteps) {
      const name = /- name:\s*(.+)/.exec(step)?.[1]?.trim() ?? "(未命名步骤)";
      expect(step, `步骤「${name}」被 continue-on-error 架空了`).not.toContain("continue-on-error");
    }
  });

  it("verify:package 调了 A–D 四个消费实现（缺一个就是「写了但没跑」）", () => {
    const source = read(VERIFY);
    for (const script of [
      "consumer-isolated-strict.mts", // A
      "consumer-ssr.mts", // B
      "consumer-volar.mts", // C
      "consumer-styles.mts", // D
    ]) {
      expect(source, `verify-package.mts 没有调用 ${script}`).toContain(script);
    }
  });
});

describe("E：明确选定一个 tgz（合成候选列表）", () => {
  it("唯一候选时返回它", () => {
    expect(selectTarball(["mangax-bmap-vue-1.0.0-rc.0.tgz"], IDENTITY)).toBe(
      "mangax-bmap-vue-1.0.0-rc.0.tgz",
    );
  });

  it("没有候选时失败（并提示先 pack）", () => {
    expect(() => selectTarball([], IDENTITY)).toThrow(/pack:package/);
  });

  it("**多于一个候选时必须失败**，不得静默取排序最后一个", () => {
    // 这正是 E 要堵的「意外选另一个包」：静默取最后一个时，验的可能不是这次构建的产物，
    // 而所有断言仍然可能通过。
    expect(() =>
      selectTarball(
        ["mangax-bmap-vue-1.0.0-rc.0.tgz", "mangax-bmap-vue-1.0.0-rc.0.tgz.bak"],
        IDENTITY,
      ),
    ).toThrow(/2 个同身份 tarball/);
  });

  it("失败信息里列出全部候选（人能直接看出是哪一个多出来的）", () => {
    let message = "";
    try {
      selectTarball(["a.tgz", "b.tgz"], IDENTITY);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("a.tgz");
    expect(message).toContain("b.tgz");
  });
});

describe("E：身份记录含版本 / commit / 摘要", () => {
  it("describeTarball 把三者都带上（版本号不足以标识产物）", () => {
    const text = describeTarball({
      file: "mangax-bmap-vue-1.0.0-rc.0.tgz",
      name: "@mangax/bmap-vue",
      version: "1.0.0-rc.0",
      commit: "427e68f",
      sha256: "0".repeat(64),
    });
    expect(text, "缺少版本").toContain("1.0.0-rc.0");
    expect(text, "缺少 commit").toContain("427e68f");
    expect(text, "缺少摘要").toContain("sha256=");
    expect(text, "缺少文件名").toContain("mangax-bmap-vue-1.0.0-rc.0.tgz");
  });

  it("verify-package 在跑任何档位**之前**就打印身份记录", () => {
    const source = read(VERIFY);
    const recordAt = source.indexOf("被验证产物：");
    const firstConsumerAt = source.indexOf("consumer-styles.mts");
    expect(recordAt, "verify-package 没有打印被验证产物的身份记录").toBeGreaterThan(0);
    expect(firstConsumerAt).toBeGreaterThan(0);
    expect(
      recordAt,
      "身份记录打印在第一个消费档位之后 —— 失败时日志里看不出验的是哪一个包",
    ).toBeLessThan(firstConsumerAt);
  });
});
