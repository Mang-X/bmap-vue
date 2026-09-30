#!/usr/bin/env node
/**
 * 发布 tarball 文件清单门禁（issue #45）
 *
 * 回答一个此前**无人回答**的问题：「实际发布的那一个 tarball 里到底有什么」。
 * `publint` / `@arethetypeswrong/cli` 都只看**目录**（自己重新打包一次），因此
 * 「`files` 声明了却没发出去」这类缺陷它们一条都抓不到。
 *
 * ## 抓到的第一个真实缺陷
 *
 * `files` 声明 `volar.d.ts`，而 `volar.d.ts` 是 `.gitignore` 的生成产物，只由
 * `scripts/generate-manifest-artifacts.mts` 写（第 81 行，连 `--check` 模式也写）。
 * 于是干净检出后直接 `pnpm pack` 会**静默发出缺 Volar 类型的包**。本脚本把这条钉死。
 *
 * ## 用法
 *
 * ```bash
 * pnpm --filter bmap-vue pack --pack-destination .artifacts
 * pnpm check:pack-contents
 *
 * # 或者指定具体 tarball
 * node --experimental-strip-types scripts/check-pack-contents.mts --tarball=.artifacts/bmap-vue-1.0.0-rc.0.tgz
 * ```
 *
 * 判据内核在 `scripts/pack-contents-boundary.mts`（可被用例直接 import）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkPackContents,
  type PackageManifestLike,
  type PackProblem,
} from "./pack-contents-boundary.mts";

const root = resolve(import.meta.dirname, "..");
const artifactsDir = resolve(root, ".artifacts");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/**
 * 定位 tarball。
 *
 * 刻意**按 manifest 的 name + version 拼**而不是按正则扫目录：正则认不出带 scope 的包名
 * （npm 会把 `@scope/name` 打成 `@scope-name-1.0.0.tgz`），而 scope 迟早会变。
 */
function findTarball(): string {
  const explicit = argValue("tarball");
  if (explicit) {
    const full = resolve(root, explicit);
    if (!existsSync(full)) throw new Error(`[check-pack-contents] 指定的 tarball 不存在：${explicit}`);
    return full;
  }
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/bmap-vue/package.json"), "utf8"),
  ) as { name: string; version: string };
  const basename = `${manifest.name.replace("/", "-")}-${manifest.version}.tgz`;
  const full = resolve(artifactsDir, basename);
  if (!existsSync(full)) {
    const available = existsSync(artifactsDir)
      ? readdirSync(artifactsDir).filter((f) => f.endsWith(".tgz"))
      : [];
    throw new Error(
      `[check-pack-contents] 找不到 ${basename}；请先跑 pnpm --filter bmap-vue pack --pack-destination .artifacts` +
        (available.length > 0 ? `（.artifacts 下现有：${available.join(", ")}）` : ""),
    );
  }
  return full;
}

function listEntries(tarball: string): string[] {
  return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function readTarballManifest(tarball: string): PackageManifestLike {
  const output = execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" });
  return JSON.parse(output) as PackageManifestLike;
}

/**
 * sourcemap 的反向检查：产物里带 `//# sourceMappingURL=` 却**没有**对应 `.map` 的文件。
 *
 * 判据内核那条只看**清单**，因此「有注释没文件」这一形态要读内容才看得见。分两个脚本是
 * 为了让单元层不必读盘。
 *
 * ⚠️ 这里必须自己拼 tar 内的相对路径，**不能**用 `path.resolve`：`sourceMappingURL` 里是
 * **裸文件名**（`index.mjs.map`），而 `tar -tzf` 的条目带 `package/` 前缀
 * （`package/dist/index.mjs.map`）。第一版用 `resolve(dirname, ref)` 得到绝对路径，
 * 于是**每个**文件都被误报成悬空 —— 一条真问题都没有，全是假红。
 */
function findDanglingSourceMapReferences(tarball: string): string[] {
  const entries = listEntries(tarball);
  const jsEntries = entries.filter((e) => e.endsWith(".mjs") || e.endsWith(".js"));
  const dangling: string[] = [];
  for (const entry of jsEntries) {
    const content = execFileSync("tar", ["-xOzf", tarball, entry], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!content.includes("//# sourceMappingURL=")) continue;
    const referenced = content.split("//# sourceMappingURL=").pop()?.trim();
    if (!referenced) continue;
    // 相对**同一目录**拼：`dist/index.mjs` 的注释 `index.mjs.map` ⇒ `package/dist/index.mjs.map`
    const joined = `${dirnameOf(entry)}${referenced}`;
    if (!entries.includes(joined)) {
      dangling.push(`${entry} -> ${referenced}`);
    }
  }
  return dangling;
}

function dirnameOf(entry: string): string {
  const idx = entry.lastIndexOf("/");
  return idx === -1 ? "" : entry.slice(0, idx + 1);
}

function main(): void {
  const tarball = findTarball();
  const entries = listEntries(tarball);
  const manifest = readTarballManifest(tarball);
  console.log(`[check-pack-contents] tarball: ${tarball}`);
  console.log(`[check-pack-contents] 条目 ${entries.length} 个`);

  const problems: PackProblem[] = checkPackContents({ entries, manifest });

  // 清单层判不出「map 悬空」：它只看到条目名，无从知道哪个 `.mjs` 带
  // `//# sourceMappingURL=` 注释。纯 re-export facade（`components.mjs` 等）既没注释也没 map，
  // 所以「有 JS 没 map」不是问题；真正会 404 的是「有注释却缺 map」，由下面这个函数读内容判定。
  for (const dangling of findDanglingSourceMapReferences(tarball)) {
    problems.push({
      kind: "source-map-dangling-reference",
      detail: `sourceMappingURL 指向不存在的文件：${dangling}`,
    });
  }

  if (problems.length === 0) {
    console.log("[check-pack-contents] OK：files / exports / 顶层字段 / 禁止形态 / sourcemap 配对全部成立");
    return;
  }

  console.error(`\n[check-pack-contents] FAIL：${problems.length} 条`);
  for (const problem of problems) {
    console.error(`  - [${problem.kind}] ${problem.detail}`);
  }
  process.exitCode = 1;
}

main();