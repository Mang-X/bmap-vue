#!/usr/bin/env node
/**
 * 仓库外隔离项目里的**严格类型消费**验证（issue #158 工作包 A）
 *
 * ## 为什么不能复用 `fixtures/consumer`
 *
 * `fixtures/consumer` 是 pnpm 工作区的一部分，装依赖时 pnpm 会做依赖提升；
 * TypeScript 的 `node_modules` 向上查找因此可能**走到工作区根**，把本库漏发的类型
 * 从源码侧补回来 —— 于是「包缺件」这件事在门禁里看起来是绿的。
 *
 * 本脚本在操作系统临时目录里另起一个**没有上级 `node_modules`** 的裸项目：
 * 手写一份只有一个依赖的 `package.json`，用 `npm install`（不是 pnpm）装入正式
 * tarball，然后在那里跑严格编译。判定用硬约束而不是「相信」：
 *
 * - 安装根到磁盘根之间**不得**存在任何 `node_modules`（爬升路径必须无货可提）；
 * - **不得**存在 `pnpm-workspace.yaml` / `pnpm-lock.yaml`（不是工作区成员）；
 * - 装出来的环境里**不得**有 `@baidumap/jsapi-v4-types`（官方类型包未安装 —— 发布
 *   声明一旦泄漏 `BMap.*`，消费方立刻编译失败，而不是被官方类型悄悄接住）；
 * - `@mangax/bmap-vue` 必须解析到**临时项目自己的** `node_modules`，而不是别处。
 *
 * ## 两档编译
 *
 * `fixtures/consumer/strict/` 的同一份探针在两种模块系统下各跑一次，两份配置都要求
 * `skipLibCheck: false`（`.d.ts` 内部必须真的被检查）：
 *
 * | 档 | `moduleResolution` | 为什么 |
 * | --- | --- | --- |
 * | bundler | `bundler` | Vite / 现代打包器的解析路径 |
 * | node16 | `Node16` | `exports` 的 `types` 条件在 Node 下走另一条解析路径 |
 *
 * 探针自带正反两侧（合法用法必须通过、错误用法必须被 `@ts-expect-error` 断言住），
 * 因此这里**不重复**判「有没有报错」：有任何诊断（含 `TS2578` 未使用的
 * `@ts-expect-error`）都是失败，零诊断才是通过。
 *
 * 本库刻意**不承诺** CJS / Node10 支持，所以不跑那两个档。
 *
 * 用法（由 `pnpm verify:package` 调用，也可单独跑）：
 *   node --experimental-strip-types scripts/consumer-isolated-strict.mts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoAncestorNodeModules, assertOutsidePnpmWorkspace } from "./consumer-isolation.mts";
import { releaseIdentityOf } from "./release-identity.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT_DIR = resolve(ROOT, "fixtures/consumer/strict");

/**
 * 验收项目的名字。**判定依赖它**：断言「所有依赖都在本项目的 `node_modules` 下」、
 * 「任何在飞的安装都在本项目目录内」都按这个根来。
 */
const PROJECT_PREFIX = "bmap-vue-strict-";

/** 两档编译配置。文件在 fixture 里（人可读、可单独跑），这里只点名。 */
const TARGETS = [
  { id: "bundler", tsconfig: "tsconfig.json" },
  { id: "node16", tsconfig: "tsconfig.node16.json" },
] as const;

/** 手写的 install 根清单：**不写 library 依赖**，包只能来自命令行给的 tarball。 */
interface InstallManifest {
  name: string;
  private: boolean;
  version: string;
  type: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function run(command: string, args: readonly string[], cwd: string, label: string): string {
  console.log(`[consumer-isolated] ${label}: ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    // CI=1 是仓库既有约定（见 verify-package 的 run()）：让 npm / tsc 走非交互分支。
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/**
 * npm 全局缓存默认落在 `$HOME/.npm`，那是**仓库外**的路径，可能因权限或既有脏数据
 * 让安装失败，而失败原因与本次改动的正确性无关（实测过 `EPERM mkdtemp`）。
 *
 * 因此把缓存放进 `.artifacts/`（已 gitignore），并**导出成 `npm_config_cache`** ——
 * 必须走环境变量：npm 的缓存位置在安装期间也会被子进程（`prepare` / `postinstall`）
 * 读取，而 `--cache` 只作用于顶层进程。
 */
function configureNpmCache(): string {
  const cache = resolve(ROOT, ".artifacts", ".npm-cache");
  mkdirSync(cache, { recursive: true });
  process.env["npm_config_cache"] = cache;
  return cache;
}

/**
 * 解析成规范路径后再比较。macOS 的 `os.tmpdir()` 是 `/var/folders/…` 而
 * `require.resolve` 回的是真实路径 `/private/var/folders/…` —— 不做这一步的话
 * 「解析到了本项目之外」会**假红**，而那条判据的全部意义就是区分「验的是 tarball」
 * 与「验的是别处找到的另一份」。假红和假绿一样会让门禁失去意义。
 */
function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function readManifest(file: string): InstallManifest {
  return JSON.parse(readFileSync(file, "utf8")) as InstallManifest;
}

/**
 * 判定「装出来的那棵树」确实来自 tarball：
 *
 * 1. `@mangax/bmap-vue` 出现在**本项目**的 `node_modules` 下；
 * 2. 它解析出来的路径就在本项目里（不是向上找到的别处）；
 * 3. 官方类型包**不在**（否则公共声明泄漏 `BMap.*` 会被它接住）；
 * 4. `vue` 已安装（消费 smoke 的硬前提）。
 */
function assertInstalledTree(dir: string, packageName: string): void {
  const installed = resolve(dir, "node_modules", packageName, "package.json");
  if (!existsSync(installed)) {
    throw new Error(`[consumer-isolated] ${packageName} 没有装进本项目：${installed}`);
  }

  const resolved = run(
    process.execPath,
    [
      "-e",
      `process.stdout.write(require.resolve(${JSON.stringify(`${packageName}/package.json`)}, { paths: [${JSON.stringify(dir)}] }))`,
    ],
    dir,
    "解析安装位置",
  );
  if (!realpath(resolved).startsWith(realpath(resolve(dir, "node_modules")))) {
    throw new Error(
      `[consumer-isolated] ${packageName} 解析到了本项目之外：${resolved}\n` +
        `  这正是隔离要防的那件事——解析到了别处，验的就不是 tarball。`,
    );
  }

  const officialTypes = resolve(dir, "node_modules/@baidumap/jsapi-v4-types");
  if (existsSync(officialTypes)) {
    throw new Error(
      `[consumer-isolated] 隔离项目里出现了 @baidumap/jsapi-v4-types —— ` +
        `公共声明一旦泄漏 \`BMap.*\`，消费方会被官方类型悄悄接住而不是编译失败。`,
    );
  }

  if (!existsSync(resolve(dir, "node_modules/vue"))) {
    throw new Error("[consumer-isolated] 隔离项目里没有 vue —— 消费 smoke 的前提不成立。");
  }
}

/** 把 fixture 里的输入（探针 + 两份 tsconfig）拷进隔离项目，逐字不改。 */
function copyStrictInputs(dir: string): void {
  for (const file of ["probe.ts", ...TARGETS.map((t) => t.tsconfig)]) {
    const source = resolve(STRICT_DIR, file);
    if (!existsSync(source)) {
      throw new Error(`[consumer-isolated] 缺少判据输入：${source}`);
    }
    writeFileSync(resolve(dir, file), readFileSync(source));
  }
}

function compile(dir: string, tsconfigFile: string): void {
  const tsconfig = resolve(dir, tsconfigFile);
  const raw = JSON.parse(readFileSync(tsconfig, "utf8")) as {
    compilerOptions?: Record<string, unknown>;
  };
  const options = raw.compilerOptions;
  if (options === undefined) {
    throw new Error(`[consumer-isolated] ${tsconfigFile} 没有 compilerOptions 段，判据无处着力。`);
  }
  // 判据的两个支点，逐档显式确认：改成 true 的话 `.d.ts` 内部完全不被检查，
  // 「严格消费」这件事就不存在了（#188 的原始缺陷正是这样流出去的）。
  if (options.skipLibCheck !== false) {
    throw new Error(
      `[consumer-isolated] ${tsconfigFile} 的 skipLibCheck 必须是 false，当前是 ` +
        `${JSON.stringify(options.skipLibCheck)}`,
    );
  }
  if (options.strict !== true) {
    throw new Error(
      `[consumer-isolated] ${tsconfigFile} 的 strict 必须是 true，当前是 ${JSON.stringify(options.strict)}`,
    );
  }
  run(resolve(dir, "node_modules/.bin/tsc"), ["-p", tsconfig], dir, "tsc");
}

/**
 * 装出隔离项目并返回它的根目录。失败时**保留现场**并打印路径：路径里带
 * `PROJECT_PREFIX` 与时间戳，排查时不必重跑一次构建。
 */
function prepareIsolatedProject(tarball: string, packageName: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), PROJECT_PREFIX));
  console.log(`[consumer-isolated] 隔离项目：${dir}`);

  const deps = readManifest(resolve(ROOT, "package.json"));
  const vue = { ...deps.dependencies, ...deps.devDependencies }["vue"];
  const typescript = deps.devDependencies?.["typescript"];
  if (vue === undefined || typescript === undefined) {
    throw new Error(
      "[consumer-isolated] 根 package.json 里读不到 vue / typescript 的版本 —— " +
        "判据要从消费方真实会用到的版本出发，不接受「随便装一个」。",
    );
  }

  const manifest: InstallManifest = {
    name: "bmap-vue-strict-consumer",
    private: true,
    version: "0.0.0",
    type: "module",
    // 依赖版本从根 `package.json` **派生**（vue 取 dependencies ∪ devDependencies，
    // typescript 取 devDependencies），不在这里另写一份 —— 另一份就是第二个事实源，
    // 上游升级时它会静默停在旧版本上，而门禁仍然「在跑」。
    dependencies: { vue },
    devDependencies: { typescript },
  };
  writeFileSync(resolve(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  copyStrictInputs(dir);
  assertOutsidePnpmWorkspace(dir);
  assertNoAncestorNodeModules(dir);

  // 本地 tarball 走 file: 说明符：装出来的就是**这个**包，不会去 registry 找同名包。
  try {
    run("npm", ["install", "--no-audit", "--no-fund", tarball], dir, "npm install tarball");
    assertInstalledTree(dir, packageName);
  } catch (error) {
    // 安装阶段失败也保留现场：装不上与装上了但类型不对，排查要看的东西不同。
    console.error(`[consumer-isolated] 安装/校验失败。隔离项目保留在：${dir}`);
    throw error;
  }
  return dir;
}

function main(): void {
  const tarball = process.argv[2];
  if (tarball === undefined) {
    throw new Error(
      "[consumer-isolated] 用法：node --experimental-strip-types scripts/consumer-isolated-strict.mts <tarball>\n" +
        "  tarball 由调用方（verify:package）选定，**不接受**默认值 —— " +
        "「验的是哪一个包」必须是显式输入，不能从 .artifacts 里猜。",
    );
  }
  if (!existsSync(tarball)) {
    throw new Error(`[consumer-isolated] tarball 不存在：${tarball}`);
  }
  const packageName = releaseIdentityOf(
    JSON.parse(readFileSync(resolve(ROOT, "packages/bmap-vue/package.json"), "utf8")),
  ).name;
  configureNpmCache();

  const dir = prepareIsolatedProject(resolve(tarball), packageName);
  try {
    for (const target of TARGETS) {
      compile(dir, target.tsconfig);
      console.log(`[consumer-isolated] ${target.id} 档 OK：skipLibCheck: false 下零诊断`);
    }
  } catch (error) {
    console.error(
      `[consumer-isolated] 失败。隔离项目保留在：${dir}\n` +
        `  复跑：cd ${dir} && ./node_modules/.bin/tsc -p <tsconfig>`,
    );
    throw error;
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(
    `[consumer-isolated] OK: ${packageName} 从正式 tarball 装进仓库外隔离项目，` +
      `${TARGETS.map((t) => t.id).join(" / ")} 两档在 skipLibCheck: false 下零诊断`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
