/**
 * 被验证 tarball 的**身份记录**（issue #158 工作包 E）
 *
 * 工作包 E 的要求是「明确选定一个 tgz 验证所有档位，记录版本 / commit / 摘要，拒绝从旧
 * `.artifacts` 意外选另一个包」。这三件事各是一类真实失效：
 *
 * | 要求 | 防的是 |
 * | --- | --- |
 * | 唯一候选 | `.artifacts` 里同时有多个同身份 tarball 时**静默挑一个**，验的可能不是这次构建的 |
 * | 版本 | 验了另一条版本线的包（`1.0.0-rc.9` 也符合 `1.0.0-rc.*` 这类宽正则） |
 * | 摘要 | 「同一个版本号、内容不同」的包无法区分（版本号不足以标识产物） |
 * | commit | 事后无法回答「这次验证对应哪次提交的产物」 |
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发整个
 * 消费验证；这里只有纯函数，可以喂合成候选列表做行为级反例。与 `consumer-isolation.mts`
 * 等同一分层理由。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface TarballIdentity {
  readonly name: string;
  readonly version: string;
}

export interface TarballRecord {
  /** tarball 的**文件名**（不是全路径：记录要在不同机器上可读）。 */
  readonly file: string;
  readonly name: string;
  readonly version: string;
  /** 打包时的提交（`git rev-parse HEAD`）；工作树有未提交改动时为 `-dirty` 后缀。 */
  readonly commit: string;
  /** 全量摘要：版本号不足以标识产物（同版本重打包内容会变）。 */
  readonly sha256: string;
}

/**
 * 从候选文件名里**唯一**确定一个 tarball。
 *
 * 刻意在多于一个候选时**失败**而不是「取排序最后一个」：后者在 `.artifacts` 里同时存在
 * 多个同身份包时，会静默换一个包去验证，而所有断言仍然可能通过 —— 那正是 E 要堵的
 * 「意外选另一个包」。要消歧就显式清掉旧产物（CI 里本来就是 `rm -rf .artifacts`）。
 */
export function selectTarball(
  candidates: readonly string[],
  identity: TarballIdentity,
): string {
  if (candidates.length === 0) {
    throw new Error(
      `[verify-package] .artifacts 里找不到 ${identity.name}@${identity.version} 的 tarball` +
        ` —— 先跑 pnpm pack:package。`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `[verify-package] .artifacts 里有 ${candidates.length} 个同身份 tarball，无法确定验哪一个：\n` +
        `  - ${[...candidates].sort().join("\n  - ")}\n` +
        `  刻意不「取排序最后一个」：那会在多个候选之间静默换包，而断言仍然可能全绿。\n` +
        `  清掉旧产物（CI 里是 rm -rf .artifacts）后重跑 pnpm pack:package。`,
    );
  }
  return candidates[0]!;
}

/** 文件的 sha256（十六进制）。 */
export function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 打包时的提交；工作树有未提交改动时加 `-dirty`，避免把「脏树产出的包」记成干净提交。 */
export function commitOf(cwd: string): string {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim();
  return status.length > 0 ? `${head}-dirty` : head;
}

/** 汇总成一条可打印、也可别处消费的记录。 */
export function describeTarball(record: TarballRecord): string {
  return (
    `${record.name}@${record.version} sha256=${record.sha256.slice(0, 16)}… ` +
    `commit=${record.commit} file=${record.file}`
  );
}
