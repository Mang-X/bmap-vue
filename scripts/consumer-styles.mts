#!/usr/bin/env node
/**
 * 样式消费门禁（issue #158 工作包 D）
 *
 * 在**装出来 tarball 的消费 fixture**里用 Vite 跑两次**生产构建**，把 #189 只在 ADR 里留过
 * 实测证据的「样式子路径」变成可重复的判据：
 *
 * | 入口 | 期望 | 证明 |
 * | --- | --- | --- |
 * | `entry-with-styles.ts` | 产物 CSS 含 Autocomplete 的定位 / 层级 / 偏移规则 | 显式 import 真的生效 |
 * | `entry-root-only.ts` | 产物 CSS **不含**这些规则 | 本库不自动注入样式；产物里确实有本库代码（正证） |
 *
 * basic 与 UI 消费方的边界（根入口不静态拉进可选 UI Kit）由
 * `tests/behavior/ui-kit-entry.test.ts` 的真实 basic / UI 生产构建判，这里不重复。
 *
 * 判据本体在 `consumer-styles-boundary.mts`（纯函数，可喂合成产物做行为级反例）。
 * 真实浏览器里的**计算样式**是另一条证据链：`tests/behavior/autocomplete-published-style.test.ts`
 * 用 dist 产物 + happy-dom 断言同样的规则确实参与层叠（不依赖外部浏览器与网络）。
 *
 * 用法（由 `pnpm verify:package` 调用，参数是装好依赖的消费 fixture 目录）：
 *   node --experimental-strip-types scripts/consumer-styles.mts .artifacts/fixture-consumer
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStylesReport, type StylesBuild } from "./consumer-styles-boundary.mts";

/** 逐个入口的构建任务：`entry` 是 fixture 里的文件名，`out` 是产物目录名。 */
const BUILDS = [
  { id: "with-styles", entry: "entry-with-styles.ts", out: "with-styles" },
  { id: "root-only", entry: "entry-root-only.ts", out: "root-only" },
] as const;

function listFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

function readBuild(outDir: string): StylesBuild {
  const files = listFiles(outDir);
  const readAll = (predicate: (file: string) => boolean): string =>
    files
      .filter(predicate)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
  return {
    code: readAll((file) => file.endsWith(".mjs") || file.endsWith(".js")),
    css: readAll((file) => file.endsWith(".css")),
  };
}

function main(): void {
  const fixtureDir = process.argv[2];
  if (fixtureDir === undefined) {
    throw new Error(
      "[consumer-styles] 用法：node --experimental-strip-types scripts/consumer-styles.mts <fixtureDir>\n" +
        "  fixtureDir 必须是**已经 npm install 过**的消费 fixture —— 判据要跑在真实 tarball 上。",
    );
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cwd = resolve(fixtureDir);
  const stylesDir = resolve(cwd, "styles");
  const viteBin = resolve(root, "node_modules/.bin/vite");
  if (!existsSync(viteBin)) {
    throw new Error("[consumer-styles] 找不到 vite（样式消费构建需要真实打包器）");
  }
  for (const build of BUILDS) {
    if (!existsSync(resolve(stylesDir, build.entry))) {
      throw new Error(
        `[consumer-styles] 缺少判据输入：${resolve(stylesDir, build.entry)}\n` +
          `  入口是 fixture 的一部分（fixtures/consumer/styles/），缺失说明 fixture 没被完整复制。`,
      );
    }
  }

  const built: Record<string, StylesBuild> = {};
  for (const build of BUILDS) {
    const outDir = resolve(stylesDir, "out", build.out);
    rmSync(outDir, { recursive: true, force: true });
    console.log(`[consumer-styles] vite build（生产）: ${build.entry}`);
    execFileSync(viteBin, ["build", "--config", resolve(stylesDir, "vite.config.mjs")], {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        CI: "1",
        STYLES_ENTRY: resolve(stylesDir, build.entry),
        STYLES_OUT: outDir,
      },
    });
    built[build.id] = readBuild(outDir);
  }

  assertStylesReport({
    withStyles: built["with-styles"]!,
    rootOnly: built["root-only"]!,
  });
  const relativeOut = relative(cwd, resolve(stylesDir, "out"));
  console.log(
    `[consumer-styles] OK：显式 import '<pkg>/styles.css' 的产物含 Autocomplete 定位/层级规则；` +
      `不 import 的产物不含它（产物在 ${relativeOut}/）`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
