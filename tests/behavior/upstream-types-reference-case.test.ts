/**
 * 上游类型包三斜线引用的大小写回归门禁（issue #50 的**长期**形态）
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
 * 当时的处置是 `patches/@baidumap__jsapi-v4-types@4.0.4.patch`（上游产物的最小修补）。
 * **上游在 4.0.5（`baidu-maps/jsapi-v4-types@5ba67f4`）自己修正了大小写**，因此按补丁自己
 * 写明的 deletionCondition：删除补丁、删除 `patchedDependencies` 条目，并把依赖从 npm 的
 * `4.0.4` 换到**钉住 commit** 的 git 依赖（4.0.5 至今**未发布到 npm**，`npm view` 的
 * `latest` 仍是 4.0.4，所以只能从 git 取）。
 *
 * 门禁**没有跟着删掉，而是反转成回归断言**：缺陷的本体是「上游声明内部的自引用大小写
 * 不一致」，它与用不用补丁无关——换依赖、重新 vendored 之后仍然要成立。
 *
 * 判定方式与平台无关：三斜线引用用 TypeScript 自己的 `preProcessFile` 解析（引号、属性
 * 顺序、空格都不影响），目标路径用「递归枚举出的真实相对路径集合」做**精确大小写**比对。
 * 刻意不用 `existsSync` / `statSync`：它们在大小写不敏感的文件系统上会对不一致的路径返回
 * true，那正是这个缺陷能长期隐藏的原因。对「枚举结果为空」也做了非空断言，避免解析方式
 * 一变就静默放行（门禁空转）。
 *
 * @upstream @baidumap/jsapi-v4-types
 * @upstreamVersion 4.0.5 (git 5ba67f4dda11b0a4b54fc631278d3e39e11667c3)
 * @runtimeBasis 纯 .d.ts 包，缺陷只在 `skipLibCheck: false` 的类型解析阶段暴露
 * @deletionCondition 上游把这个检查移交给自己的 CI（我们改为跟随其 commit 钉依赖）；
 *   本用例的断言届时若恒真再删——在那之前它是唯一一处能在 Linux 上把大小写回归挡住的地方。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const LIB_PACKAGE_JSON = resolve(REPO_ROOT, "packages/bmap-vue/package.json");
const WORKSPACE_YAML = resolve(REPO_ROOT, "pnpm-workspace.yaml");

const libManifest = JSON.parse(readFileSync(LIB_PACKAGE_JSON, "utf8")) as {
  devDependencies?: Record<string, string>;
};
const pinnedVersion = libManifest.devDependencies?.["@baidumap/jsapi-v4-types"];

/**
 * 定位**类型检查实际解析到的那份**上游类型包：优先包级 `node_modules`
 * （`packages/bmap-vue` 是 `vue-tsc -p tsconfig.build.json` 的解析起点），
 * 回退根 `node_modules`。
 *
 * 回退分支保留是因为它**曾经**必要：当时 `.npmrc` 写着 `shamefully-hoist=true`，根
 * `node_modules` 里有全部传递依赖（该设置现已删除——pnpm 12 不再读取 `.npmrc` 的安装设置，
 * 见 ADR 2026-10-02 / #187）。今天根下只有直接依赖，两个分支在正常安装下指向同一份文件；
 * 保留它是为了在解析起点布局变化时不必重新论证。
 */
function resolveUpstreamPackageDir(): string {
  const candidates = [
    resolve(REPO_ROOT, "packages/bmap-vue/node_modules/@baidumap/jsapi-v4-types"),
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
  it("依赖钉死到具体来源（npm 精确版本或 git commit，二者必居其一）", () => {
    expect(pinnedVersion, "packages/bmap-vue/package.json 应锁定上游类型包").toBeTruthy();
    const installedVersion = (
      JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { version: string }
    ).version;

    // 上游 4.0.5 未发布到 npm，因此现在走 git；仍接受 npm 精确版本，便于上游补发后切回。
    if (/^github:baidu-maps\/jsapi-v4-types#[0-9a-f]{40}$/.test(pinnedVersion!)) {
      // git 路径断言的是「装到磁盘上的就是那个 commit 的产物」——版本号可能仍是 4.0.4，
      // 真正的区分是**产物内容**（4.0.5 才有 `visualization/`），由下面那条用例把关。
      expect(installedVersion, "git 依赖应已安装").toBeTruthy();
    } else {
      expect(
        pinnedVersion,
        "npm 依赖应精确锁定版本（不允许 ^ / ~ 等范围）",
      ).toMatch(/^\d+\.\d+\.\d+$/);
      expect(installedVersion, "安装到磁盘的版本必须与 package.json 的锁定一致").toBe(
        pinnedVersion,
      );
    }
  });

  it("装到磁盘的是 4.0.5 产物（含 4.0.5 才有的 visualization/ 命名空间）", () => {
    // 版本号本身不足以区分 4.0.4 / 4.0.5（npm 上的 4.0.4 与 git 上的 4.0.5 版本号不同，但
    // 依赖声明指向 git 时不能靠版本号判断装对了没有）。用 4.0.5 **独有**的产物做证据。
    expect(
      existsSync(join(packageDir, "visualization", "PointLayer.d.ts")),
      [
        "安装到的上游类型包没有 visualization/ ——这不是 4.0.5 产物。",
        "确认 package.json 的 git 依赖与 pnpm-lock 一致，并重跑 `pnpm install`。",
      ].join("\n"),
    ).toBe(true);
  });

  it("仓库里不再残留已删除补丁的引用（4.0.5 已修好大小写）", () => {
    const workspace = readFileSync(WORKSPACE_YAML, "utf8");
    expect(
      workspace,
      [
        "pnpm-workspace.yaml 仍声明 patchedDependencies：4.0.5 起上游自己修好了大小写，",
        "按 patches/@baidumap__jsapi-v4-types@4.0.4.patch 自带的 deletionCondition，",
        "补丁与该条目都应删除（补丁留着会在 pnpm install 时失配）。",
      ].join("\n"),
    ).not.toContain("jsapi-v4-types");
  });

  it("已安装的上游声明文件不存在大小写不匹配的三斜线引用", () => {
    const { mismatches, scanned } = scanReferences();

    // 非空断言：解析方式一变（或上游改用别的入口机制）就报错，而不是「扫到 0 条 → 通过」。
    expect(scanned, "没有解析到任何三斜线引用，本用例无法证明任何事").toBeGreaterThan(0);

    expect(
      mismatches,
      [
        "上游类型包存在大小写不匹配的三斜线引用，Linux 上 `pnpm typecheck:package` 会失败：",
        ...mismatches.map((m) => `  - ${m}`),
        "",
        "重新 `pnpm install` 后仍不匹配，说明解析到的不是钉住的上游产物——",
        "检查 package.json 的 git 依赖与 pnpm-lock 是否同步。",
      ].join("\n"),
    ).toEqual([]);
  });
});
