/**
 * 被验证 tarball 的**打包来源记录**（issue #158 工作包 E）
 *
 * ## 为什么不是「候选计数」
 *
 * `isOwnTarball` 判的是**文件名全等**（`fileName === tarballBasename(name, version)`），
 * 同一目录不可能有两个同文件名，所以「多个候选」在真实路径上永远不成立。真正会发生的失效是
 * **同名的旧 tarball 留在 `.artifacts` 里**：在 commit A 打出 `1.0.0-rc.0.tgz`，切到 commit B
 * 后不重新打包就跑验证 —— 此时验的是 A 的产物，而验证时 `git rev-parse HEAD` 读到的是 B。
 *
 * 所以判据必须绑在**打包那一刻**：`pack:package` 把当时的 commit / dirty / 摘要写进 sidecar，
 * 验证时读它并与当前 HEAD 比对。没有 sidecar 就**失败**（fail-closed）—— 无法追溯来源的
 * tarball 不该被当成「已验证」。
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发打包 / 验证；
 * 这里只有纯函数，可以喂合成 provenance 做行为级反例。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** sidecar 文件名后缀：`<tarball>.build.json`，与 tarball 同目录。 */
export const PROVENANCE_SUFFIX = ".build.json";

export interface TarballProvenance {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  /** 全量摘要：版本号不足以标识产物（同版本重打包内容会变）。 */
  readonly sha256: string;
  /** **打包时**的 HEAD。 */
  readonly commit: string;
  /** **打包时**工作树是否脏。 */
  readonly dirty: boolean;
  readonly packedAt: string;
}

export interface SourceState {
  readonly commit: string;
  readonly dirty: boolean;
}

/** 文件的 sha256（十六进制）。 */
export function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 当前 HEAD 与工作树是否脏。 */
export function sourceStateOf(cwd: string): SourceState {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim();
  return { commit, dirty: status.length > 0 };
}

/** 读 tarball 旁边的 sidecar；不存在返回 `undefined`（由判据决定是失败还是兜底）。 */
export function readProvenance(tarball: string): TarballProvenance | undefined {
  try {
    return JSON.parse(readFileSync(`${tarball}${PROVENANCE_SUFFIX}`, "utf8")) as TarballProvenance;
  } catch {
    return undefined;
  }
}

/**
 * 判「这个 tarball 能不能被当成**当前源码**的产物来验证」。
 *
 * 三条缺一不可：
 *
 * 1. **有来源记录**：没有就失败（fail-closed）。无法追溯来源的包不该被记成「已验证」。
 * 2. **摘要一致**：tarball 内容与打包时记录一致 —— 文件被替换 / 损坏都会在这里现形。
 * 3. **commit 一致**：打包时的 HEAD 必须等于当前 HEAD。这条正是「在 A 打包、切到 B 后直接
 *    验证」的拦截点；否则日志会把 A 的产物记成 B 的（评审 P1 的复现步骤）。
 *
 * `dirty` **不参与判定**：它是 tarball 的打包事实，用于显示；当前工作树在打包后变脏并不改变
 * 「这个包是从哪个 commit 打的」。HEAD 变了则由第 3 条拦住。
 *
 * 校验通过后**把记录返回**（而不是只断言）：调用方拿到的一定是非空 provenance，不会因为
 * 类型收窄问题写出 `provenance!` 这种把判据当装饰的代码。
 */
export function requireTarballProvenance(input: {
  readonly provenance: TarballProvenance | undefined;
  readonly current: SourceState;
  readonly actualSha256: string;
  readonly expectedFile: string;
}): TarballProvenance {
  const { provenance, current, actualSha256, expectedFile } = input;
  if (provenance === undefined) {
    throw new Error(
      `[verify-package] 这个 tarball 没有打包来源记录（缺 ${expectedFile}${PROVENANCE_SUFFIX}）—— ` +
        `无法证明它来自当前源码。请用 \`pnpm pack:package\` 重新打包（它会写下打包时的 ` +
        `commit / 摘要），而不是直接 \`pnpm --filter bmap-vue pack\`。`,
    );
  }
  if (provenance.file !== expectedFile) {
    throw new Error(
      `[verify-package] 打包来源记录指向的是 ${provenance.file}，而当前验证的是 ${expectedFile} —— ` +
        `sidecar 与 tarball 不是一对。`,
    );
  }
  if (provenance.sha256 !== actualSha256) {
    throw new Error(
      `[verify-package] tarball 内容与打包来源记录的摘要不一致：\n` +
        `  记录 ${provenance.sha256}\n  实际 ${actualSha256}\n` +
        `  文件被替换或损坏都可能这样。用 \`pnpm pack:package\` 重新打包。`,
    );
  }
  if (provenance.commit !== current.commit) {
    throw new Error(
      `[verify-package] 这个 tarball 是从 commit ${provenance.commit} 打的，而当前 HEAD 是 ` +
        `${current.commit} —— 拒绝把旧产物验成当前源码的产物。\n` +
        `  这正是「在 A 打包、切到 B 后不重新打包就验证」的形态；请重新 \`pnpm pack:package\`。`,
    );
  }
  return provenance;
}

/** 汇总成一条可打印、也可别处消费的记录。 */
export function describeTarball(provenance: TarballProvenance): string {
  const dirty = provenance.dirty ? "-dirty" : "";
  return (
    `${provenance.name}@${provenance.version} ` +
    `sha256=${provenance.sha256.slice(0, 16)}… commit=${provenance.commit}${dirty} ` +
    `packedAt=${provenance.packedAt} file=${provenance.file}`
  );
}
