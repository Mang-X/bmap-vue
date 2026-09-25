#!/usr/bin/env node
/**
 * 包体对照的采集编排（issue #140 · 指标 8「bundle/tarball 入口大小」）
 *
 * ```bash
 * pnpm perf:contrast:bundle            # 量 + 判 + 出报告
 * pnpm perf:contrast:bundle -- --update # 量 + 录基线（不判）
 * ```
 *
 * 产物：`.artifacts/perf-contrast-bundle/bundle-report.json` + stdout 人读表格。
 * 基线：`tests/performance/bundle-baseline.json`（`--update` 写入）。
 *
 * ## 为什么要**单独**一个基线文件
 *
 * `tests/performance/baseline.json` 是 `collect-performance-baseline.mts` 的**运行时**
 * 指标集（mount 耗时 / 渲染计数……），它有一套双向指标集校验。把包体读数塞进去会让
 * 那条校验炸掉，也会让「运行时回退」和「包体回退」共用一条门禁——两者的失败处理完全不同
 * （前者跨机不可比，后者是确定性字节差）。因此分成两个文件、两个脚本、两个退出码语境。
 *
 * ## 不判「谁比谁小」
 *
 * 官方当前是**单文件**产物，本库是**多 chunk** 产物。这不是谁更强，只是上游打包形态不同。
 * 唯一能判回退的是**本库相对自己基线**的入口字节变大——那是确定性的、与机器无关的事实。
 *
 * ## 前提：`packages/bmap-vue/dist` 必须已构建
 *
 * 本库不在 fixture 的 `node_modules` 里（它不是被安装的依赖，而是**待测对象**），
 * alias 指向 `packages/bmap-vue/dist/index.mjs`。dist 不存在时**读不出来**，脚本按
 * 脚手架失败（2）退出，并明说「先跑 `pnpm build:package`」——不拿 src 现编一份顶替，
 * 因为那量的就不是发布物了。
 *
 * ## 约束（`node --experimental-strip-types`）
 *
 * 不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OFFICIAL_BASELINE_VERSION } from "../tests/performance/official-contrast/report.mts";
import { readOursVersion as oursVersion } from "../tests/performance/oursVersion.mts";
import {
  BUNDLE_REPORT_VERSION,
  decideBundleExit,
  formatBundleReport,
  type BundleBuildRecipe,
  type BundleReport,
  type BundleSideReading,
} from "../tests/performance/official-contrast/bundle.mts";

const repoRoot = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(repoRoot, ".artifacts/perf-contrast-bundle");
const REPORT_PATH = resolve(OUT_DIR, "bundle-report.json");
const BASELINE_PATH = resolve(repoRoot, "tests/performance/bundle-baseline.json");
const SHAKE_DIR = resolve(repoRoot, "fixtures/consumer/shake");
const CONFIG = resolve(SHAKE_DIR, "bundle-contrast.config.mjs");
const WORK_DIR = resolve(OUT_DIR, "build");
const VITE_BIN = resolve(repoRoot, "node_modules/.bin/vite");

const OUR_DIST = resolve(repoRoot, "packages/bmap-vue/dist/index.mjs");
const OFFICIAL_DIST = resolve(repoRoot, "node_modules/@baidumap/vue-bmap/dist");

/** 两侧**同一份**入口形状：`BMapProvider` / `Map` / `Marker` / `InfoWindow`（见 basic-*.ts 头）。 */
const EXPECTED_SHAPE = ["BMapProvider", "Map", "Marker", "InfoWindow"] as const;

/**
 * **从真实配置对象里读出**打包条件（见 `BundleBuildRecipe`），不手抄一份。
 *
 * 之前这里是一份手写的 `{external, minify, target, format}` 常量，与 `.mjs` 里的真实配置
 * 各写各的。那是这条读数最危险的一种形态：改配置不改常量 → 报告里印着「minify=true」
 * 而实际没压缩 → 基线在一个数字与声称完全不同的前提下录下，且**永远不会有人发现**。
 *
 * 读法：先把 `BUNDLE_ENTRY` / `BUNDLE_OUT` 指到合法的占位路径再 `import()`——配置只在
 * 顶层用这两个变量算 `build.outDir`，import 时**不会**真的打包，于是守卫过了、也不会有副作用。
 * 拿到的是 vite 即将使用的那**同一个对象**，不是复述。
 */
async function readRecipe(): Promise<BundleBuildRecipe> {
  const previousEntry = process.env.BUNDLE_ENTRY;
  const previousOut = process.env.BUNDLE_OUT;
  const previousAlias = process.env.BUNDLE_ALIAS;
  process.env.BUNDLE_ENTRY = resolve(SHAKE_DIR, "basic-ours.ts");
  process.env.BUNDLE_OUT = resolve(WORK_DIR, "recipe-probe");
  process.env.BUNDLE_ALIAS = "";
  try {
    const loaded = (await import(pathToFileURL(CONFIG).href)) as { default?: Record<string, unknown> };
    const config = loaded.default;
    if (!config) throw new Error(`${CONFIG} 没有 default 导出`);
    const build = config["build"] as {
      minify?: unknown;
      target?: unknown;
      rollupOptions?: { external?: unknown; output?: { format?: unknown } };
    };
    const rollup = build?.rollupOptions ?? {};
    return {
      external: (rollup.external as string[] | undefined) ?? [],
      minify: JSON.stringify(build?.minify ?? false),
      target: String(build?.target ?? "baseline"),
      format: String(rollup.output?.format ?? "esm"),
    };
  } finally {
    // 恢复：import 过配置对象之后环境仍是共享的，留着会影响下一次 `build()`。
    if (previousEntry === undefined) delete process.env.BUNDLE_ENTRY;
    else process.env.BUNDLE_ENTRY = previousEntry;
    if (previousOut === undefined) delete process.env.BUNDLE_OUT;
    else process.env.BUNDLE_OUT = previousOut;
    if (previousAlias === undefined) delete process.env.BUNDLE_ALIAS;
    else process.env.BUNDLE_ALIAS = previousAlias;
  }
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/* -------------------------------------------------------------- 失败通道 */

/**
 * 失败**抛出**而不是 `process.exit`（沿用 `collect-official-contrast.mts` 的同一约定）。
 *
 * `process.exit` 会绕过 `finally`（本脚本有「清 work dir」的 finally），留下半个产物目录，
 * 下一次 `--update` 会把它当已有产物读进去。
 */
class BundleFail extends Error {
  readonly code: 2 | 3;
  constructor(code: 2 | 3, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: 2 | 3, message: string): never {
  throw new BundleFail(code, message);
}

/* -------------------------------------------------------------- 度量工具 */

/** 闭包里所有文件的字节数，按扩展名分桶。 */
function measureClosure(outDir: string): { entryBytes: number; chunkBytes: number; cssBytes: number; chunkCount: number } {
  const entry = resolve(outDir, "entry.mjs");
  if (!existsSync(entry)) {
    fail(2, `BUNDLE_NO_ENTRY：${outDir}/entry.mjs 不存在——打包没产出入口`);
  }
  const files = walk(outDir);
  let chunkBytes = 0;
  let cssBytes = 0;
  let chunkCount = 0;
  for (const file of files) {
    if (file === entry) continue;
    if (file.endsWith(".css")) {
      cssBytes += statSync(file).size;
      continue;
    }
    if (/\.(mjs|js)$/.test(file)) {
      chunkBytes += statSync(file).size;
      chunkCount += 1;
    }
  }
  return { entryBytes: statSync(entry).size, chunkBytes, cssBytes, chunkCount };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * 「发布物」字节数：只算**运行时会加载的文件**，**不算** `.map` / `.d.ts`。
 *
 * 这一点不是洁癖：两侧的 sourcemap 策略完全不同（本库 17 张 map 共 5.6 MB，官方 0 张），
 * 把它算进去量到的不是「库有多大」而是「谁更爱发 sourcemap」——那是发布偏好，不是运行时成本。
 * `.d.ts` 同理：它只在编译期被读，浏览器一行都不会下载。
 * 排除后两边比的是同一件事：**装到 node_modules 里、会被运行时代码读到的字节**。
 */
function runtimeDistBytes(dir: string): number {
  let total = 0;
  for (const file of walk(dir)) {
    if (file.endsWith(".map") || file.endsWith(".d.ts") || file.endsWith(".d.ts.map")) continue;
    total += statSync(file).size;
  }
  return total;
}

/**
 * 读回产物的 import 列表，作为「两边是同一份任务」的**物证**。
 *
 * 脚本本身已经保证了入口文件同名同 shape，但「作者以为的 shape」与「实际打进去的 shape」
 * 是两回事。把产物里出现的包 specifier 读回来进报告，人一眼能看出有一侧少了东西。
 */
function importSpecifiers(outDir: string): string[] {
  const entry = resolve(outDir, "entry.mjs");
  const source = readFileSync(entry, "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/from\s*["']([^"']+)["']/g)) found.add(match[1]);
  return [...found].sort();
}

/** 产物里是否真的带了那四个公开面的**符号**（摇掉时会是 0 —— 见 basic-*.ts 的顶层副作用注释）。 */
function probeSurvived(outDir: string): boolean {
  const entry = resolve(outDir, "entry.mjs");
  const source = readFileSync(entry, "utf8");
  return source.includes("__basic");
}

/* -------------------------------------------------------------- 采集 */

function build(side: "ours" | "official"): string {
  const outDir = resolve(WORK_DIR, side);
  const entry = resolve(SHAKE_DIR, side === "ours" ? "basic-ours.ts" : "basic-official.ts");
  const alias = side === "ours" ? `bmap-vue=${OUR_DIST}` : "";
  try {
    execFileSync(VITE_BIN, ["build", "--config", CONFIG], {
      cwd: repoRoot,
      stdio: hasFlag("verbose") ? "inherit" : "ignore",
      env: {
        ...process.env,
        CI: "1",
        BUNDLE_ENTRY: entry,
        BUNDLE_OUT: outDir,
        BUNDLE_ALIAS: alias,
      },
    });
  } catch (error) {
    fail(2, `BUNDLE_BUILD_FAILED（${side}）：${String((error as Error)?.message ?? error)}`);
  }
  if (!probeSurvived(outDir)) {
    // 摇成 0 字节或没带进组件：量到的「包体」是「什么都没打包」，不是组件代价。
    fail(2, `BUNDLE_EMPTY_PROBE（${side}）：产物里没有入口探针——这侧被摇空了，读数无效`);
  }
  return outDir;
}

function readSide(side: "ours" | "official"): BundleSideReading {
  const outDir = build(side);
  const measured = measureClosure(outDir);
  if (side === "ours") {
    return {
      package: "bmap-vue",
      version: oursVersion(repoRoot),
      entryImports: importSpecifiers(outDir),
      ...measured,
      distBytes: runtimeDistBytes(resolve(repoRoot, "packages/bmap-vue/dist")),
    };
  }
  return {
    package: "@baidumap/vue-bmap",
    version: OFFICIAL_BASELINE_VERSION,
    entryImports: importSpecifiers(outDir),
    ...measured,
    distBytes: runtimeDistBytes(OFFICIAL_DIST),
  };
}


/** 官方版本必须**精确**等于票面锁定的 1.0.1：对着别的版本出的字节数不能叫「与 1.0.1 的对照」。 */
function checkOfficialVersion(): void {
  const manifest = JSON.parse(
    readFileSync(resolve(repoRoot, "node_modules/@baidumap/vue-bmap/package.json"), "utf8"),
  ) as { version?: string };
  if (manifest.version !== OFFICIAL_BASELINE_VERSION) {
    fail(2, `CONTRAST_OFFICIAL_VERSION_DRIFT：装的是 ${String(manifest.version)}，票面锁定 ${OFFICIAL_BASELINE_VERSION}`);
  }
}

/* -------------------------------------------------------------- 基线 */

interface BundleBaseline {
  readonly version: number;
  readonly recipe: BundleReport["recipe"];
  readonly ours: BundleSideReading;
}

/** 打包条件进基线：配置变了，基线就换了意义——不是「回退」，是「不可比」。 */
function assertSameRecipe(actual: BundleBuildRecipe, recorded: BundleBuildRecipe): void {
  if (JSON.stringify(actual) !== JSON.stringify(recorded)) {
    fail(
      2,
      `BUNDLE_RECIPE_DRIFT：基线是另一份打包配置下录的（本轮 ${JSON.stringify(actual)} / ` +
        `基线 ${JSON.stringify(recorded)}），先跑一次 \`--update\` 重录`,
    );
  }
}

function readBaseline(recipe: BundleBuildRecipe): BundleSideReading | null | undefined {
  if (hasFlag("no-baseline")) return undefined;
  if (!existsSync(BASELINE_PATH)) return undefined;
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BundleBaseline;
  assertSameRecipe(recipe, parsed.recipe);
  return parsed.ours;
}

function writeBaseline(report: BundleReport): void {
  const payload: BundleBaseline = {
    version: BUNDLE_REPORT_VERSION,
    recipe: report.recipe,
    ours: report.ours,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

/* -------------------------------------------------------------- 入口 */

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();

  if (!existsSync(VITE_BIN)) fail(2, "找不到 vite（包体对照需要真实打包器）");
  if (!existsSync(OUR_DIST)) {
    fail(2, `BUNDLE_DIST_MISSING：${OUR_DIST} 不存在——先跑 \`pnpm build:package\`。不拿 src 现编顶替，那量的不是发布物`);
  }
  if (!existsSync(resolve(OFFICIAL_DIST, "index.js"))) {
    fail(3, `缺官方依赖：${OFFICIAL_DIST}/index.js 不存在（跑 \`pnpm install\`）`);
  }
  checkOfficialVersion();

  // 打包条件先读出来：它既进报告，也在读基线时做不可比检查。
  const recipe = await readRecipe();
  const report = {
    version: BUNDLE_REPORT_VERSION,
    mode: "bundle" as const,
    done: false,
    fatal: null as string | null,
    blockedReason: null as string | null,
    notes: [] as string[],
    recipe,
    ours: null as BundleSideReading | null,
    official: null as BundleSideReading | null,
    startedAt,
    finishedAt: "",
  };

  try {
    report.ours = readSide("ours");
    report.official = readSide("official");
    report.done = true;
  } catch (error) {
    if (error instanceof BundleFail) {
      report.fatal = error.message;
    } else {
      report.fatal = String((error as Error)?.message ?? error);
    }
  }

  report.finishedAt = new Date().toISOString();
  // 采集失败时 sides 可能为 null；报告的形状要求两侧都在，此时按「脚手架失败」处理，
  // 人读表格走 `fatal` 分支即可（`formatBundleReport` 只在 done 时读两侧的字节）。
  if (!report.ours || !report.official) {
    const decision = decideBundleExit({
      envelopeIssues: [],
      fatal: report.fatal ?? "采集未产出两侧读数",
      blockedReason: report.blockedReason,
      done: false,
      oursEntryBytes: 0,
      version: oursVersion(repoRoot),
      baseline: null,
    });
    console.error(`[perf:contrast:bundle] FATAL：${report.fatal}`);
    process.exitCode = decision.exitCode;
    return;
  }

  const notes = [
    `基本路径入口形状（两侧同名）：${EXPECTED_SHAPE.join(" / ")}`,
    "官方当前是**单文件**产物（dist/index.js 一处装全），本库是**多 chunk**。打包形态不同是上游事实，不是谁更强。",
    "本档只判「本库相对**自己基线**的入口字节变没变大」，不判谁比谁小；不写百分比、不写「X 倍更快」。",
    "「发布物」字节只算运行时会加载的文件，**排除 `.map` 与 `.d.ts`**——两侧发不发 sourcemap 是发布偏好（本库 17 张 map 共 5.6 MB，官方 0 张），算进去量到的不是库的大小。tarball 压缩体积另由 verify-package / npm 覆盖。",
  ];
  report.notes.push(...notes);
  const finished: BundleReport = { ...report, notes: report.notes };

  if (hasFlag("update")) {
    writeBaseline(finished);
    console.log(formatBundleReport({ report: finished, decision: { exitCode: 0, ok: true, reasons: ["--update：已录基线，不判回退"] } }));
    console.error(`[perf:contrast:bundle] 基线已写入 ${BASELINE_PATH}`);
    process.exitCode = 0;
    return;
  }

  const baseline = readBaseline(recipe);
  const decision = decideBundleExit({
    envelopeIssues: [],
    fatal: finished.fatal,
    blockedReason: finished.blockedReason,
    done: finished.done,
    oursEntryBytes: finished.ours.entryBytes,
    version: finished.ours.version,
    baseline,
  });
  console.log(formatBundleReport({ report: finished, decision }));
  console.error(
    `[perf:contrast:bundle] exit=${decision.exitCode} ok=${decision.ok}\n` +
      decision.reasons.map((r) => `  ${r}`).join("\n"),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify({ ...finished, exitCode: decision.exitCode, reasons: decision.reasons }, null, 2)}\n`);
  const out = argValue("out");
  if (out) writeFileSync(resolve(repoRoot, out), readFileSync(REPORT_PATH, "utf8"));
  process.exitCode = decision.exitCode;
}

try {
  mkdirSync(WORK_DIR, { recursive: true });
  await main();
} catch (error) {
  console.error(`[perf:contrast:bundle] FAILED：${String((error as Error)?.message ?? error)}`);
  process.exitCode = error instanceof BundleFail ? error.code : 2;
} finally {
  if (!hasFlag("keep")) {
    // work dir 只是中转产物，报告已序列化到 OUT_DIR。删它是为了让下一次 `--update`
    // 不会把上一次的残留当成自己的读数（`build()` 会 emptyOutDir，但失败路径不一定走到）。
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}
