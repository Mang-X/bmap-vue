#!/usr/bin/env node
/**
 * 打包并写下**打包来源记录**（issue #158 工作包 E）
 *
 * 单纯 `pnpm --filter bmap-vue pack` 只产出一个 tarball，它自己不带「从哪个 commit 打的」。
 * 于是「在 commit A 打包、切到 B 后不重新打包就验证」会把 A 的产物记成 B 的。这里在打包的
 * **同一时刻**把 commit / dirty / sha256 / 时间写进 `<tarball>.build.json`，验证侧读它并与
 * 当前 HEAD 比对（见 `tarball-identity.mts`）。
 *
 * 同时清掉 `.artifacts` 里旧的 `*.tgz` 与旧 sidecar —— 否则「同名旧包」会原地留着，而判据
 * 靠的是「旧包的来源记录与当前 HEAD 不一致」，清理能让正常流程不必靠失败来提醒。
 *
 * 用法（由 `pnpm pack:package` 调用，CI 里的 pack 步骤也走它）：
 *   node --experimental-strip-types scripts/pack-package.mts
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isOwnTarball, releaseIdentityOf } from "./release-identity.mts";
import { PROVENANCE_SUFFIX, sha256Of, sourceStateOf } from "./tarball-identity.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = resolve(root, ".artifacts");
const identity = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(root, "packages/bmap-vue/package.json"), "utf8")),
);

function run(command: string): void {
  console.log(`[pack-package] ${command}`);
  execSync(command, { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } });
}

/** 当前被 git 跟踪且已修改/新增的文件路径（`git status --porcelain` 的路径列）。 */
function trackedModifiedFiles(): string[] {
  return execSync("git status --porcelain", { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((path) => path.length > 0)
    .sort();
}

// 1) manifest 产物（volar.d.ts 等）必须在 pack 之前就位。
//
//    用 **`:check`** 而不是非 check 模式：非 check 会无条件用 `new Date()` 改写**受版本控制**
//    的 `docs/.vitepress/component-index.json` 与 `src/components/index.ts`，于是随后读到的
//    `git status` 恒为脏 —— 干净检出打出的包也会被记成 `-dirty`，那个标注就失去了区分力。
//    `:check` 仍会写 gitignore 的 `volar.d.ts`，同时对受跟踪生成物做只读比对（漂移即失败）。
//
//    这里再补一条**行为守卫**：manifest 步骤前后，受跟踪的改动集合不得变化 —— 换回非 check
//    模式会立刻被它拦下，而不是等「来源记录总是 -dirty」这种症状出现。
const trackedBeforeManifest = trackedModifiedFiles();
run("pnpm generate:manifest:check");
const trackedAfterManifest = trackedModifiedFiles();
const introduced = trackedAfterManifest.filter((path) => !trackedBeforeManifest.includes(path));
if (introduced.length > 0) {
  throw new Error(
    `[pack-package] manifest 步骤改动了受版本控制的文件：${introduced.join(", ")}\n` +
      `  那会让来源记录里的 dirty 恒为 true，无法区分真实未提交修改。` +
      `  请用 generate:manifest:check（它不写受跟踪文件）。`,
  );
}

// 2) 清掉旧的 tarball 与旧 sidecar：同名旧包留着会让「来源记录与当前 HEAD 不一致」成为
//    正常路径上的常见失败，而不是异常信号。
mkdirSync(artifactsDir, { recursive: true });
for (const entry of readdirSync(artifactsDir)) {
  if (entry.endsWith(".tgz") || entry.endsWith(PROVENANCE_SUFFIX)) {
    rmSync(resolve(artifactsDir, entry), { force: true });
  }
}

// 3) 打包。
run("pnpm --filter bmap-vue pack --pack-destination .artifacts");

// 4) 校验产物唯一，并写下来源记录。
const tarballs = readdirSync(artifactsDir).filter((file) => isOwnTarball(file, identity));
if (tarballs.length !== 1) {
  throw new Error(
    `[pack-package] 期望 .artifacts 里恰好有 1 个 ${identity.name}@${identity.version} 的 tarball，` +
      `实际 ${tarballs.length} 个：${tarballs.join(", ") || "（无）"}`,
  );
}
const file = tarballs[0]!;
const tarball = resolve(artifactsDir, file);
if (!existsSync(tarball)) {
  throw new Error(`[pack-package] 找不到刚打出的 tarball：${tarball}`);
}
const source = sourceStateOf(root);
const provenance = {
  name: identity.name,
  version: identity.version,
  file,
  sha256: sha256Of(tarball),
  commit: source.commit,
  dirty: source.dirty,
  packedAt: new Date().toISOString(),
};
writeFileSync(`${tarball}${PROVENANCE_SUFFIX}`, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(
  `[pack-package] 来源记录：${file}${PROVENANCE_SUFFIX}（commit=${source.commit}` +
    `${source.dirty ? "-dirty" : ""} sha256=${provenance.sha256.slice(0, 16)}…）`,
);
