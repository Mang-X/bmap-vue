/**
 * 源码静态扫描门禁：raw SDK 边界（M3A0-03 / issue #15）
 *
 * 默认扫描范围（禁区，相对 packages/baidu-map-gl-vue/src）：
 *   - components
 *   - composables
 *   - core/runtime
 *
 * 检测规则（实现在 `scripts/raw-sdk-detector.mts`，与公共声明门禁共用）：
 *   1. `BMapGL` 标识符 / `"BMapGL"` 精确字符串键；
 *   2. `window.BMap` / `globalThis.BMap` / `self.BMap` / `global.BMap`
 *      与 `window["BMap"]` 等全局对象成员访问；
 *   3. `BMap.*` 成员访问、`new BMap.*()` 构造调用；
 *   4. `BMap.*` 类型位置（`QualifiedName` / `TypeReference` / `typeof BMap`）；
 *   5. `namespace BMap` / `declare global` 声明；
 *   6. 具名导入 `@baidumap/jsapi-v4-types`。
 *
 * 目录白名单见 `scripts/raw-sdk-boundary.mts`：`--src <dir>` 会扫描整棵源码树，
 * 并放行 `driver/**`、`client/**`、`core/loader/**`、`plugins/**`。
 *
 * `.vue` 文件用 `vue/compiler-sfc` 的官方解析器提取 `<script>`/`<script setup>`
 * 区块，再把区块内容交给同一 AST 检查，并按 `block.loc.start.offset` 映射回源文件。
 * SFC 解析失败时明确报错退出,绝不静默放行。
 */
import { join, relative, resolve } from "node:path";
import {
  FORBIDDEN_SRC_DIRS,
  boundarySummary,
  isRawSdkAllowedPath,
} from "./raw-sdk-boundary.mts";
import { RULE_LABELS, sortViolations, type Violation } from "./raw-sdk-detector.mts";
import { scanSourceDirs } from "./source-scan.mts";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/baidu-map-gl-vue/src");

/** 文件收集与 SFC 解析在 `./source-scan.mts`（与 no-bmapgl 门禁共用）。 */
const scanDirs = (
  dirs: readonly { dir: string; skip?: (file: string) => boolean }[],
  violations: Violation[],
  failures: string[],
): void => scanSourceDirs(dirs, violations, failures, { root: ROOT });

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes("--print-boundary")) {
    console.log(JSON.stringify({ ...boundarySummary(), rules: RULE_LABELS }, null, 2));
    return;
  }

  const violations: Violation[] = [];
  const failures: string[] = [];
  let scopeLabel: string;

  const dirFlag = argv.indexOf("--dir");
  const srcFlag = argv.indexOf("--src");

  if (dirFlag !== -1) {
    const dir = resolve(argv[dirFlag + 1] ?? "");
    scopeLabel = `${argv[dirFlag + 1]} (explicit --dir, all files are forbidden territory)`;
    scanDirs([{ dir }], violations, failures);
  } else if (srcFlag !== -1) {
    const srcRoot = resolve(argv[srcFlag + 1] ?? "");
    scopeLabel = `${argv[srcFlag + 1]} (--src tree, allow-list: ${boundarySummary().allowedPatterns.join(", ")})`;
    scanDirs(
      [{ dir: srcRoot, skip: (file) => isRawSdkAllowedPath(relative(srcRoot, file)) }],
      violations,
      failures,
    );
  } else {
    scopeLabel = FORBIDDEN_SRC_DIRS.join(", ");
    scanDirs(
      FORBIDDEN_SRC_DIRS.map((dir) => ({ dir: join(PKG, dir) })),
      violations,
      failures,
    );
  }

  if (violations.length > 0) {
    console.error(`raw SDK static scan FAILED [${scopeLabel}]:`);
    for (const v of sortViolations(violations)) {
      console.error(`  ${v.file}:${v.line}:${v.column} -> ${v.text}  [${v.rule}]`);
    }
    console.error(
      "Access the SDK only via Driver/Loader boundaries; probe the global only from core/loader (readJsapiV4Global() is the single legal entry for JSAPI 4.0). Boundary spec: scripts/raw-sdk-boundary.mts.",
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error("raw SDK static scan FAILED (unparsable input; refusing to pass silently):");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    process.exit(1);
  }

  console.log(`raw SDK static scan OK: ${scopeLabel} are clean.`);
}

main();
