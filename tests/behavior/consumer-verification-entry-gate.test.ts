/**
 * 统一接线与最终验收的自测（issue #158 工作包 E）
 *
 * 工作包 E 的三条要求各有一个**可判定的落点**，这里逐条钉住：
 *
 * 1. **CI 与本地同一入口**：`verify:package` 调四个消费脚本；CI 的 `quality` 与 `package`
 *    两个 job **各自恰好一次**经 `pnpm verify:package`，且都不得被 `continue-on-error` 架空；
 *    两个 pack 步骤也都经 `pnpm pack:package`（否则没有来源记录）。
 * 2. **同一 tgz 且拒绝旧包**：判据不是「候选计数」（`isOwnTarball` 是文件名全等，多个候选在
 *    真实路径上不可能），而是**打包来源记录**与当前 HEAD 的比对。
 * 3. **记录版本 / commit / 摘要**：`describeTarball` 必须把三者都带上。
 *
 * 判据本体是纯函数（`tarball-identity.mts`），这里既有行为反例也有接线检查。
 * 真实 tarball / Vite / vue-tsc 的集成由 CI 的 `package` job 跑。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  describeTarball,
  requireTarballProvenance,
  type TarballProvenance,
} from "../../scripts/tarball-identity.mts";
import { readWorkflow } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");
const PACK = resolve(ROOT, "scripts/pack-package.mts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * 把 workflow 按 **job** 切开（顶层 `jobs:` 下两空格缩进的键）。
 *
 * 判据必须按 job 分组：把整个 YAML 的 `run` 合在一起数，「package 少一次、quality 多一次」
 * 会让计数仍然是 2 —— 恰好漏掉本票要防的「某个 job 没接线」。
 */
function jobsOf(workflow: string): Map<string, string> {
  const lines = workflow.split(/\r?\n/);
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  expect(jobsAt, "workflow 里找不到顶层 jobs: 段").toBeGreaterThanOrEqual(0);
  const jobs = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(jobsAt + 1)) {
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job !== null) {
      current = job[1]!;
      jobs.set(current, []);
      continue;
    }
    if (/^\S/.test(line)) break; // jobs 段结束
    if (current !== null) jobs.get(current)!.push(line);
  }
  return new Map([...jobs].map(([name, body]) => [name, body.join("\n")]));
}

/** 把一个 job 切成步骤（同级 `-` 列表项），并在缩进变浅时收口（避免吃进下一个 job）。 */
function stepsOf(jobBody: string): string[] {
  const lines = jobBody.split(/\r?\n/);
  const starts: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^\s*-\s/.test(line)) starts.push(index);
  }
  return starts.map((from, index) => {
    const to = starts[index + 1] ?? lines.length;
    const indent = /^(\s*)/.exec(lines[from]!)![1]!.length;
    const out: string[] = [lines[from]!];
    for (const line of lines.slice(from + 1, to)) {
      if (line.trim().length === 0) continue;
      if (/^(\s*)/.exec(line)![1]!.length < indent) break;
      out.push(line);
    }
    return out.join("\n");
  });
}

/**
 * 这个步骤是否真的执行 `pnpm <command>`：单行形态（`run: pnpm x`）与块形态里的裸命令行
 * 都要认。只看裸命令行会漏掉单行步骤（`package` job 的 verify 就是那一形态）。
 */
function invokes(step: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return step
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*(?:run:\\s*)?${escaped}\\s*$`).test(line));
}

/**
 * 只取步骤的 `run:` 体（shell 行），不含 `name:` / 注释 —— 注释里提到某个路径不代表执行它。
 *
 * 块形态（`run: |`）的 shell 行比 `run:` 更深；遇到缩进不超过 `run:` 的行就收口，
 * 这样同一步骤里 `run:` 之后的注释块不会被当成命令。
 */
function runBodyOf(step: string): string {
  const lines = step.split(/\r?\n/);
  const runAt = lines.findIndex((line) => /^\s*run:/.test(line));
  if (runAt === -1) return "";
  const runIndent = /^(\s*)/.exec(lines[runAt]!)![1]!.length;
  const body: string[] = [lines[runAt]!];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim().length === 0) continue;
    if (/^(\s*)/.exec(line)![1]!.length <= runIndent) break;
    body.push(line);
  }
  return body.join("\n");
}

function provenance(overrides: Partial<TarballProvenance> = {}): TarballProvenance {
  return {
    name: "@mangax/bmap-vue",
    version: "1.0.0-rc.0",
    file: "mangax-bmap-vue-1.0.0-rc.0.tgz",
    sha256: "a".repeat(64),
    commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    dirty: false,
    packedAt: "2026-10-07T17:00:00.000Z",
    ...overrides,
  };
}

const CURRENT = { commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", dirty: false };

describe("E：CI 与本地同一入口", () => {
  it("quality 与 package **各自**恰好一次经 pnpm verify:package", () => {
    const jobs = jobsOf(readWorkflow("quality.yml"));
    for (const job of ["quality", "package"]) {
      const body = jobs.get(job);
      expect(body, `workflow 里找不到 ${job} job`).toBeTruthy();
      const consumerSteps = stepsOf(body!).filter((step) =>
        invokes(step, "pnpm verify:package"),
      );
      expect(
        consumerSteps.length,
        `${job} job 里执行 pnpm verify:package 的步骤有 ${consumerSteps.length} 个，期望 1 个\n` +
          `  （按整个 YAML 计数不行：package 少一次、quality 多一次仍是 2，恰好漏掉某个 job 没接线）`,
      ).toBe(1);
      expect(
        consumerSteps[0],
        `${job} job 的消费验证步骤被 continue-on-error 架空了`,
      ).not.toContain("continue-on-error");
    }
  });

  it("CI 不直接跑 scripts/verify-package.mts（只经 pnpm verify:package）", () => {
    const jobs = jobsOf(readWorkflow("quality.yml"));
    for (const [name, body] of jobs) {
      for (const step of stepsOf(body)) {
        const runBody = runBodyOf(step);
        expect(
          runBody,
          `${name} job 里的步骤直接跑了 scripts/verify-package.mts（应当只经 pnpm verify:package）`,
        ).not.toContain("scripts/verify-package.mts");
      }
    }
  });

  it("CI 的两个 pack 步骤都经 pnpm pack:package（否则没有来源记录）", () => {
    const jobs = jobsOf(readWorkflow("quality.yml"));
    for (const job of ["quality", "package"]) {
      const body = jobs.get(job)!;
      const packSteps = stepsOf(body).filter((step) => invokes(step, "pnpm pack:package"));
      expect(
        packSteps.length,
        `${job} job 里经 pnpm pack:package 打包的步骤有 ${packSteps.length} 个，期望 1 个` +
          `（直接 pnpm --filter bmap-vue pack 不写来源记录，verify:package 会 fail-closed）`,
      ).toBe(1);
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

describe("E：同一 tgz —— 打包来源记录 vs 当前 HEAD", () => {
  it("来源记录与当前 HEAD / 摘要一致时通过", () => {
    const record = requireTarballProvenance({
      provenance: provenance({ commit: CURRENT.commit }),
      current: CURRENT,
      actualSha256: "a".repeat(64),
      expectedFile: "mangax-bmap-vue-1.0.0-rc.0.tgz",
    });
    expect(record.commit).toBe(CURRENT.commit);
  });

  it("**没有**来源记录时 fail-closed（无法追溯来源的包不得被当成已验证）", () => {
    expect(() =>
      requireTarballProvenance({
        provenance: undefined,
        current: CURRENT,
        actualSha256: "a".repeat(64),
        expectedFile: "mangax-bmap-vue-1.0.0-rc.0.tgz",
      }),
    ).toThrow(/pack:package/);
  });

  it("摘要不一致时失败（文件被替换 / 损坏）", () => {
    expect(() =>
      requireTarballProvenance({
        provenance: provenance({ commit: CURRENT.commit }),
        current: CURRENT,
        actualSha256: "c".repeat(64),
        expectedFile: "mangax-bmap-vue-1.0.0-rc.0.tgz",
      }),
    ).toThrow(/摘要/);
  });

  it("**在 A 打包、切到 B 后直接验证**必须失败（评审 P1 的复现步骤）", () => {
    // 这是真正要堵的形态：同名旧 tarball 没有换名，「候选计数」永远看不到它。
    let message = "";
    try {
      requireTarballProvenance({
        provenance: provenance(),
        current: CURRENT,
        actualSha256: "a".repeat(64),
        expectedFile: "mangax-bmap-vue-1.0.0-rc.0.tgz",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message, "没有拦住旧产物被验成当前源码").toContain(provenance().commit);
    expect(message, "错误信息里没有当前 HEAD").toContain(CURRENT.commit);
  });

  it("sidecar 与 tarball 不是一对时失败", () => {
    expect(() =>
      requireTarballProvenance({
        provenance: provenance({ commit: CURRENT.commit, file: "some-other.tgz" }),
        current: CURRENT,
        actualSha256: "a".repeat(64),
        expectedFile: "mangax-bmap-vue-1.0.0-rc.0.tgz",
      }),
    ).toThrow(/不是一对/);
  });
});

describe("E：身份记录含版本 / commit / 摘要", () => {
  it("describeTarball 把三者都带上（版本号不足以标识产物）", () => {
    const text = describeTarball(
      provenance({ commit: "427e68f", dirty: true, packedAt: "2026-10-07T17:00:00.000Z" }),
    );
    expect(text, "缺少版本").toContain("1.0.0-rc.0");
    expect(text, "缺少 commit").toContain("427e68f");
    expect(text, "缺少脏树标注").toContain("-dirty");
    expect(text, "缺少摘要").toContain("sha256=");
    expect(text, "缺少打包时间").toContain("packedAt=");
    expect(text, "缺少文件名").toContain("mangax-bmap-vue-1.0.0-rc.0.tgz");
  });

  it("pack 写来源记录、verify 读它（不是验证时现查 HEAD）", () => {
    const pack = read(PACK);
    expect(pack, "pack-package.mts 没有写下来源记录").toContain("PROVENANCE_SUFFIX");
    expect(pack, "pack-package.mts 没有记录打包时的 HEAD").toContain("sourceStateOf");
    const verify = read(VERIFY);
    expect(verify, "verify-package.mts 没有读来源记录").toContain("readProvenance");
    expect(verify, "verify-package.mts 没有校验来源与当前 HEAD 是否一致").toContain(
      "requireTarballProvenance",
    );
    // 打印出来的必须是**打包来源记录**（pack 时写的那份），不是验证时现算的对象。
    expect(verify, "verify-package.mts 打印的不是打包来源记录").toContain(
      "describeTarball(provenance)",
    );
  });
});
