/**
 * 上游类型包大小写引用补丁门禁（M3A0-BOUNDARY 衍生 / issue #50）
 *
 * 背景：`@baidumap/jsapi-v4-types@4.0.4` 的 `index.d.ts` 用 `core/displayOptions.d.ts`
 * 引用了一个发布产物中实际名为 `core/DisplayOptions.d.ts` 的文件。macOS（APFS 默认
 * 大小写不敏感）会解析到真实文件，Linux / 任何大小写敏感的卷上则：
 *
 * ```text
 * error TS6053: File '.../core/displayOptions.d.ts' not found.
 * error TS2552: Cannot find name 'DisplayOptions'.   // core/Map.d.ts / core/MapOptions.d.ts
 * ```
 *
 * 本仓库的处置是 `patches/@baidumap__jsapi-v4-types@4.0.4.patch`（上游产物的最小修补）。
 * 本文件把「补丁已生效」变成可执行断言。
 *
 * 判定方式与平台无关：三斜线引用用 TypeScript 自己的 `preProcessFile` 解析（引号、属性
 * 顺序、空格都不影响），目标路径用「递归枚举出的真实相对路径集合」做**精确大小写**比对。
 * 刻意不用 `existsSync` / `statSync`：它们在大小写不敏感的文件系统上会对不一致的路径返回
 * true，那正是这个缺陷能长期隐藏的原因。对「枚举结果为空」也做了非空断言，避免解析方式
 * 一变就静默放行（门禁空转）。
 *
 * @upstream @baidumap/jsapi-v4-types
 * @upstreamVersion 4.0.4
 * @runtimeBasis 纯 .d.ts 包，缺陷只在 `skipLibCheck: false` 的类型解析阶段暴露
 * @deletionCondition 上游发布修正大小写的版本后：升级 `@baidumap/jsapi-v4-types`
 *   （精确版本）→ 删除 `patches/@baidumap__jsapi-v4-types@4.0.4.patch` 与
 *   `pnpm-workspace.yaml` 的 `patchedDependencies` 条目 → 同步删除本用例的补丁断言
 *   （上游已修复时「大小写不匹配」扫描用例仍然应当通过）→ 重跑 `pnpm typecheck:v3`。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const LIB_PACKAGE_JSON = resolve(REPO_ROOT, "packages/baidu-map-gl-vue/package.json");
const WORKSPACE_YAML = resolve(REPO_ROOT, "pnpm-workspace.yaml");

const libManifest = JSON.parse(readFileSync(LIB_PACKAGE_JSON, "utf8")) as {
  devDependencies?: Record<string, string>;
};
const pinnedVersion = libManifest.devDependencies?.["@baidumap/jsapi-v4-types"];
const PATCH_FILE = resolve(REPO_ROOT, `patches/@baidumap__jsapi-v4-types@${pinnedVersion}.patch`);

/**
 * 定位**类型检查实际解析到的那份**上游类型包：优先包级 `node_modules`
 * （`packages/baidu-map-gl-vue` 是 `vue-tsc -p tsconfig.build.json` 的解析起点），
 * 回退根 `node_modules`（`.npmrc` 的 `shamefully-hoist=true` 下也存在）。
 */
function resolveUpstreamPackageDir(): string {
  const candidates = [
    resolve(REPO_ROOT, "packages/baidu-map-gl-vue/node_modules/@baidumap/jsapi-v4-types"),
    resolve(REPO_ROOT, "node_modules/@baidumap/jsapi-v4-types"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new Error(
    `未找到已安装的 @baidumap/jsapi-v4-types。先跑 \`pnpm install\`；候选路径：${candidates.join(", ")}`,
  );
}

const packageDir = resolveUpstreamPackageDir();

/** 递归枚举目录下的真实文件名（保留磁盘上的真实大小写），返回相对根目录的路径。 */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(relative(packageDir, full).split("\\").join("/"));
  }
  return out;
}

const packageFiles = listFiles(packageDir);
const packageFileSet = new Set(packageFiles);
const dtsFiles = packageFiles.filter((name) => name.endsWith(".d.ts"));

/** 逐条核对三斜线 `path` 引用：目标必须命中真实文件名（大小写精确）。 */
function scanReferences(): { mismatches: string[]; scanned: number } {
  const mismatches: string[] = [];
  let scanned = 0;
  for (const rel of dtsFiles) {
    const text = readFileSync(join(packageDir, rel), "utf8");
    for (const ref of ts.preProcessFile(text, false, false).referencedFiles) {
      scanned += 1;
      const target = relative(packageDir, resolve(dirname(join(packageDir, rel)), ref.fileName));
      if (!packageFileSet.has(target.split("\\").join("/"))) {
        mismatches.push(`${rel} -> ${ref.fileName}`);
      }
    }
  }
  return { mismatches, scanned };
}

describe("上游类型包大小写引用补丁（issue #50）", () => {
  it("依赖以精确版本锁定（补丁按版本生效的前提）", () => {
    expect(pinnedVersion, "packages/baidu-map-gl-vue/package.json 应精确锁定版本").toMatch(
      /^\d+\.\d+\.\d+$/,
    );
    expect(
      JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version,
    ).toBe(pinnedVersion);
  });

  it("已安装的上游声明文件不存在大小写不匹配的三斜线引用", () => {
    const { mismatches, scanned } = scanReferences();

    // 非空断言：解析方式一变（或上游改用别的入口机制）就报错，而不是「扫到 0 条 → 通过」。
    expect(scanned, "没有解析到任何三斜线引用，本用例无法证明任何事").toBeGreaterThan(0);

    expect(
      mismatches,
      [
        "上游类型包存在大小写不匹配的三斜线引用，Linux 上 `pnpm typecheck:v3` 会失败：",
        ...mismatches.map((m) => `  - ${m}`),
        "",
        `补丁文件：${relative(REPO_ROOT, PATCH_FILE)}`,
        "若 pnpm 没有应用补丁，重跑 `pnpm install`；",
        "若上游已修复大小写，请按 deletionCondition 删除补丁与下面那条用例。",
      ].join("\n"),
    ).toEqual([]);
  });

  it("补丁已声明且内容针对同一处缺陷", () => {
    expect(
      existsSync(PATCH_FILE),
      [
        `补丁文件缺失：${relative(REPO_ROOT, PATCH_FILE)}`,
        "若 pnpm 没有应用补丁，重跑 `pnpm install`；",
        "若上游已发布修正大小写的版本并据此删除了补丁，请同步删除本条用例。",
      ].join("\n"),
    ).toBe(true);

    // 补丁键 = `包名@精确版本`：键必须与 package.json 的锁定版本一致，否则
    // pnpm install 会以 ERR_PNPM_UNUSED_PATCH 失败（见 patches/README.md，2026-09-13 实测）。
    // pnpm 会把键写成 `'pkg@version': patches/...`，比对前先去掉引号。
    const workspacePlain = readFileSync(WORKSPACE_YAML, "utf8").replace(/['"]/g, "");
    expect(workspacePlain, "pnpm-workspace.yaml 应声明 patchedDependencies").toContain(
      "patchedDependencies:",
    );
    expect(workspacePlain).toContain(
      `@baidumap/jsapi-v4-types@${pinnedVersion}: patches/`,
    );

    const patch = readFileSync(PATCH_FILE, "utf8");
    expect(patch).toContain('-/// <reference path="core/displayOptions.d.ts" />');
    expect(patch).toContain('+/// <reference path="core/DisplayOptions.d.ts" />');
  });

  it("补丁文件在任何平台都按 LF 检出（CRLF 会让 `pnpm patch` 失配）", () => {
    // Windows 上 core.autocrlf=true 会把文本文件按 CRLF 检出，.patch 的上下文行带上 \r 后应用会
    // 失配（2026-09-13 实测：不加这行时 .patch 首行为 `b'diff --git a/x b/x\r'`）。用 .gitattributes
    // 把补丁钉成 LF，这条断言防止它被悄悄删掉。
    const attributes = readFileSync(resolve(REPO_ROOT, ".gitattributes"), "utf8");
    expect(attributes, ".gitattributes 应把 patches/*.patch 固定为 LF 检出").toMatch(
      /^patches\/\*\.patch\s+text\s+eol=lf\s*$/m,
    );
  });
});
