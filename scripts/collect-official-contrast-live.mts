#!/usr/bin/env node
/**
 * 官方对照基准的**真实浏览器档**采集（issue #140，档位二）
 *
 * ```bash
 * BAIDU_MAP_AK=xxx pnpm perf:contrast:live
 * ```
 *
 * 产物：`.artifacts/perf-contrast-live/report.json` + 同一份内容的人读表格。
 *
 * ## 与 Fake 档（`collect-official-contrast.mts`）的关系
 *
 * Fake 档是**主档**（无 AK、可入 PR 门禁）；本档补它 `notMeasured` 的四项：long task、
 * 真实 SDK 重绘、帧调度、堆增长。本档**不设阈值**（不判「比官方慢就算回退」），唯一能
 * 返回 1 的位置留给不变式——而骨架阶段尚未接 SDK 侧的实例重建信号，`invariants` 为空。
 *
 * ## ⚠️ 本轮**未实跑**
 *
 * 本环境没有 `BAIDU_MAP_AK`，因此**本档没有产出任何数据**。脚本与页面已落地，缺 AK 时
 * 走退出码 3（blocked）——**不是通过**。不要从 Fake 读数外推浏览器表现。
 *
 * ## 退出码
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 采齐、信封自检通过 |
 * | `1` | 不变式被破坏（本库侧的架构预期没了） |
 * | `2` | 脚手架失败（vite/chrome/CDP/报告缺失） |
 * | `3` | blocked（缺 AK、SDK 没 ready、前置不成立）——**不是通过** |
 *
 * ## AK 处置
 *
 * AK **只**从 `BAIDU_MAP_AK` 环境变量读，**不接受** `--ak=`（argv 进 `ps`）；子进程
 * （vite 与 chrome）拿到的都是**删掉了 `BAIDU_MAP_AK` 的净化 env**。唯一一条传递通道是本脚本
 * 经 **CDP** 注入页面（`injectAkOverCdp`）——本进程持有的内存 socket，不进 OS 进程表、不进
 * 任何日志、不落盘。四条被否掉的路径各有一票否决的理由，见 `main()` 里 `injectAkOverCdp`
 * 调用处的注释。此外 stdout 与落盘 JSON 两条出口仍过 `redactAk`（页面错误消息会进
 * `report.fatal` / `notes`，那里可能带上 URL）。
 *
 * ## 约束（`node --experimental-strip-types`）
 *
 * 不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CdpClosedError,
  CdpTimeoutError,
  connectCdpSession,
  readProbeReport,
  sleep,
  type CdpSession,
} from "./official-probe/cdp.mts";
import { ViteNotReadyError, waitForViteReady, type ChildExit } from "./official-probe/readiness.mts";
import { DATASET_VERSION } from "../tests/performance/dataset.ts";
import {
  checkLiveContrastEnvelope,
  decideLiveContrastExit,
  formatLiveContrastReport,
  OFFICIAL_BASELINE_VERSION,
  redactAk,
  type LiveContrastReport,
} from "../tests/browser/official-contrast/report.mts";

const repoRoot = resolve(import.meta.dirname, "..");
const pageDir = join(repoRoot, "tests/browser/official-contrast");
const OUT_DIR = resolve(repoRoot, ".artifacts/perf-contrast-live");
const REPORT_PATH = resolve(OUT_DIR, "report.json");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const port = Number(argValue("port") ?? "5215");
const outPath = argValue("out");
const logPath = argValue("log");
/**
 * AK **只**从 `BAIDU_MAP_AK` 环境变量读，**不接受** `--ak=`。
 *
 * 理由是 argv 的读者范围：`--ak=<raw>` 会进**本进程**的命令行，因此进 `ps`——同机器任何
 * 进程（CI 上并行的其它 step、容器里的 sidecar、开发者机器上的任何程序）都能无凭据读到。
 * 环境变量至少不进 OS 进程表。CDP 注入那条通道已经是父进程内存 → 页面的一次传递，
 * 没必要再多开一个 argv 入口（第 1 轮评审第 4 条）。
 */
const ak = process.env.BAIDU_MAP_AK ?? "";
const overallTimeoutMs = Number(argValue("timeout") ?? 300_000);
const runId = randomUUID();

/**
 * 传给子进程的**净化 env**：`BAIDU_MAP_AK` 被**显式删掉**。
 *
 * 两条理由，缺一不可：
 * - vite 会把 `import.meta.env.VITE_*` **内联进构建产物**，AK 若在子进程 env 里就有机会被
 *   写进可能被上传的输出（页面侧本就不读 `import.meta.env`，但子进程 env 仍会流进 vite 自身
 *   的日志与诊断面）；
 * - chrome 继承父 env 就意味着 AK 进了浏览器进程的整份环境，而浏览器进程是**会被 dump** 的
 *   那一类（崩溃报告 / 调试器附加）。CDP 已经承担了「把 AK 从父进程内存递到页面」这件事，
 *   子进程不需要、也不该持有它。
 */
function childEnvWithoutAk(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.BAIDU_MAP_AK;
  return env;
}

/**
 * 本档只跑**一个**场景：5 万点批量图层。
 *
 * 刻意小于 Fake 档的 10 场景：真实浏览器里每次测量都要等瓦片、走真实网络与鉴权，
 * 10 场景 × 2 侧 × 多次采样在 CI 上不现实。而本档的职责是补 Fake 档 `notMeasured` 的四项
 * （long task / 真实重绘 / FPS / 堆增长）——它们在**一个**大数据场景上就取得到，不必铺满。
 * 场景本身沿用 Fake 档场景表登记的 5 万点批量图层（官方 4.0 无等价物，故本档 `official`
 * 恒为 `null`，不硬比）。
 */
const EXPECTED_SCENARIOS = 1;

/* -------------------------------------------------------------- 进程工具 */

/**
 * 下面几个函数与 `collect-live-performance.mts` / `smoke-jsapi-v4.mts` 里同名的**刻意重复**
 * （沿用那两个文件头登记的同一条约定）：真正需要共享的只有 CDP 会话与就绪判定。
 */
function resolveBrowser(): string {
  const explicit = process.env.SMOKE_BROWSER;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`SMOKE_BROWSER 不存在：${explicit}`);
    return explicit;
  }
  const candidates: string[] = [];
  for (const root of [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? "",
  ]) {
    if (!root || !existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const base = join(root, entry);
      candidates.push(
        join(base, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        join(base, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        join(base, "chrome-linux/chrome-headless-shell"),
        join(base, "chrome-linux/chrome"),
        join(base, "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"),
        join(base, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      );
    }
  }
  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error("找不到 Chromium：设置 SMOKE_BROWSER，或 `npx playwright install chromium`。");
}

interface TrackedChild {
  child: ChildProcess;
  exited: Promise<ChildExit>;
}

function spawnTracked(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; verbose?: boolean },
): TrackedChild {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.verbose ? "inherit" : "pipe",
  });
  const exited = new Promise<ChildExit>((settlePromise) => {
    let done = false;
    const finish = (exit: ChildExit): void => {
      if (done) return;
      done = true;
      settlePromise(exit);
    };
    child.once("exit", (code, signal) => finish({ code, signal }));
    child.once("error", (error) => finish({ code: null, signal: null, error: String(error.message) }));
  });
  return { child, exited };
}

async function waitForDevToolsPort(
  userDataDir: string,
  exited: Promise<ChildExit>,
  timeoutMs: number,
): Promise<number> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const started = Date.now();
  let exitedWith: ChildExit | null = null;
  void exited.then((exit) => {
    exitedWith = exit;
  });
  for (;;) {
    if (exitedWith) throw new Error(`Chromium 未能在本轮启动：${JSON.stringify(exitedWith)}`);
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      if (first) return Number(first);
    }
    if (Date.now() - started > timeoutMs) throw new Error("等待 DevToolsActivePort 超时");
    await sleep(200);
  }
}

interface CdpTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

async function waitForPageTarget(
  devtoolsPort: number,
  prefix: string,
  timeoutMs: number,
): Promise<CdpTarget> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
      const list = (await res.json()) as CdpTarget[];
      const page = list.find((t) => t.type === "page" && t.url.startsWith(prefix));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* CDP 还没起来 */
    }
    if (Date.now() - started > timeoutMs) throw new Error("等待 CDP page target 超时");
    await sleep(300);
  }
}

function shutdown(children: (TrackedChild | null)[], session: CdpSession | null): void {
  try {
    session?.close();
  } catch {
    /* 已经断开 */
  }
  for (const tracked of children) {
    const child = tracked?.child;
    if (!child || child.exitCode !== null) continue;
    try {
      child.kill("SIGKILL");
    } catch {
      /* 已经退出 */
    }
  }
}

/** 本库版本（`packages/bmap-vue/package.json`），报告必须自述「跑的是哪一版」。 */
function oursVersion(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(repoRoot, "packages/bmap-vue/package.json"), "utf8"),
    ) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 失败通道：**抛出**而不是 `process.exit`（沿用 `collect-live-performance.mts` 的 #131 评审第 4 条）。
 *
 * `fail()` 若直接 `process.exit`，失败发生在 vite/chrome 已启动之后时会绕过 `finally →
 * shutdown()`，留下孤儿进程。因此：初始化也进 try；一切失败都变成 `LiveContrastFail`，
 * 由统一 catch 结算 2/3 并走 finally。
 */
class LiveContrastFail extends Error {
  readonly code: 2 | 3;
  constructor(code: 2 | 3, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: 2 | 3, message: string): never {
  throw new LiveContrastFail(code, message);
}

/**
 * 经 CDP 把 AK 注入页面（不进 argv / URL / env —— 理由见调用处）。
 *
 * 用 `Runtime.evaluate` 直接给页面挂一个**一次性**的接收口，页面在 `main()` 里向它领取；
 * 领完立刻删掉，所以 AK 在页面里也不留可被后续 `Runtime.evaluate` 再读走的残留。
 *
 * 注入串是**字面量拼接**而不是 `eval` 变量的形式：AK 是调用方给的字符串，JSON.stringify
 * 保证引号 / 反斜杠 / 换行都被转义，页面侧再 `JSON.parse` 一次——不拼进可执行代码。
 */
async function injectAkOverCdp(session: CdpSession, akValue: string): Promise<void> {
  const literal = JSON.stringify(akValue);
  const expression =
    `(() => {` +
    ` let taken = false;` +
    ` window.__CONTRAST_AK_TAKEN__ = () => {` +
    `  if (taken) return null;` +
    `  taken = true;` +
    `  delete window.__CONTRAST_AK_TAKEN__;` +
    `  return ${literal};` +
    ` };` +
    ` return true;` +
    `})()`;
  const result = (await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails || result.result?.value !== true) {
    fail(2, `AK_INJECT_FAILED：页面没有装上 AK 接收口（${result.exceptionDetails?.text ?? "未知原因"}）`);
  }
}

async function main(): Promise<void> {
  let vite: TrackedChild | null = null;
  let chrome: TrackedChild | null = null;
  let session: CdpSession | null = null;
  let browser = "";
  try {
    if (!ak) {
      fail(3, "BLOCKED：缺少 AK（`BAIDU_MAP_AK=<ak>`）。本档没有产出读数，不是通过。");
    }

    browser = resolveBrowser();
    const userDataDir = mkdtempSync(join(tmpdir(), "perf-contrast-live-"));
    // AK **不进页面 URL**，也不进 chrome 的 argv —— 见下方 `injectAkOverCdp` 的说明。
    // URL 只带非敏感的运行标识：它会进 vite 的请求日志、chrome 的启动参数与 CDP 诊断。
    const query = new URLSearchParams({
      run: runId,
      ours: oursVersion(),
      official: OFFICIAL_BASELINE_VERSION,
    });
    const url = `http://localhost:${port}/?${query.toString()}`;

    vite = spawnTracked(join(repoRoot, "node_modules/.bin/vite"), ["--config", join(pageDir, "vite.config.ts")], {
      cwd: pageDir,
      env: childEnvWithoutAk({ CONTRAST_RUN_ID: runId, SMOKE_PORT: String(port) }),
      // ⚠️ 刻意**不接受** `--verbose`（继承 stdio）：vite 的 info 级请求日志会把 URL 原样写进
      // stdout，而 stdout 在 CI 里就是 job log——那是比进程表更广的读者。诊断需求由
      // `collect-live-performance.mts` 那条链承担；本档要保的是「AK 不进任何日志」。
      verbose: false,
    });
    try {
      await waitForViteReady({
        url: `http://localhost:${port}/`,
        runId,
        timeoutMs: 30_000,
        exited: vite.exited,
      });
    } catch (error) {
      if (error instanceof ViteNotReadyError) {
        fail(2, `VITE_NOT_READY：${error.message}`);
      }
      throw error;
    }

    chrome = spawnTracked(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        url,
      ],
      // ⚠️ 刻意**给一份净化 env**（`{}` = 继承父 env = AK 进了浏览器进程整份环境，
      // 而浏览器进程是会被崩溃报告 / 调试器附加 dump 的那一类）。CDP 已经承担了
      // 「父进程内存 → 页面」的单次传递，子进程不需要持有 AK。
      { env: childEnvWithoutAk() },
    );

    const devtoolsPort = await waitForDevToolsPort(userDataDir, chrome.exited, 30_000);
    const target = await waitForPageTarget(devtoolsPort, `http://localhost:${port}`, 30_000);
    const deadline = Date.now() + overallTimeoutMs;
    session = await connectCdpSession(target.webSocketDebuggerUrl!, {
      deadline,
      commandTimeoutMs: 30_000,
    });

    // AK 走 CDP 注入，不走 argv / URL / env。
    //
    // 为什么不走 URL：`url` 是 chrome 的**命令行参数**，因此进 `ps`——同机器上任何进程
    // （CI 上是并行的其它 step、容器里的 sidecar、开发者机器上的任何程序）都能无凭据读到。
    // 它同时是 vite 的一次 HTTP 请求 URL，而 vite 的 info 级请求日志会把它写进 stdout；
    // 在 CI 里 stdout 就是 job log，读者范围比 secrets 大得多。
    //
    // 为什么不走 env：vite 会把 `import.meta.env.VITE_*` **内联进产物**——AK 会被写进
    // 可能被上传的构建输出；chrome 继承 env 则让 AK 进入浏览器进程的整份环境（崩溃报告 /
    // 调试器附加会 dump 它）。因此两个子进程都只拿 `childEnvWithoutAk()`。
    //
    // CDP 通道是本进程持有的内存 socket，不进 OS 进程表、不进任何日志、不落盘。
    await injectAkOverCdp(session, ak);

    const report = await readProbeReport<LiveContrastReport>(session, {
      deadline,
      expression: "JSON.stringify(window.__OFFICIAL_CONTRAST_LIVE__ ?? null)",
    });
    if (!report) {
      fail(2, "REPORT_MISSING：页面没有写 window.__OFFICIAL_CONTRAST_LIVE__（控制台见 console）");
    }

    const envelopeIssues = checkLiveContrastEnvelope(report, {
      runId,
      datasetVersion: DATASET_VERSION,
    });
    const decision = decideLiveContrastExit({
      envelopeIssues,
      fatal: report.fatal,
      blockedReason: report.blockedReason,
      done: report.done,
      expectedScenarioCount: EXPECTED_SCENARIOS,
      scenarioCount: report.ours.length,
    });

    // ⚠️ **两条出口都过 redactAk**：页面错误消息会进 `report.fatal` / `notes`，而错误消息里
    // 可能带 URL（AK 已不进 URL，但这条出口仍按「消息可能含敏感串」处理）。
    const serialized = redactAk(formatLiveContrastReport({ report, decision }));
    console.log(serialized);

    mkdirSync(OUT_DIR, { recursive: true });
    const payload = { ...report, exitCode: decision.exitCode, reasons: decision.reasons };
    const json = redactAk(`${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(REPORT_PATH, json);
    if (outPath) writeFileSync(outPath, json);
    if (logPath) writeFileSync(logPath, `${serialized}\n`);
    console.error(
      redactAk(
        `[perf:contrast:live] exit=${decision.exitCode} ok=${decision.ok} ` +
          `scenarios=${report.ours.length}/${EXPECTED_SCENARIOS}\n` +
          decision.reasons.map((r) => `  ${r}`).join("\n"),
      ),
    );
    process.exitCode = decision.exitCode;
    if (hasFlag("keep")) {
      for (const tracked of [chrome, vite]) tracked?.child.unref?.();
      session?.close();
      session = null;
      process.exit(decision.exitCode);
    }
  } catch (error) {
    const reason =
      error instanceof CdpTimeoutError || error instanceof CdpClosedError
        ? `CDP 会话在截止时间内未能完成：${error.message}`
        : String((error as Error)?.message ?? error);
    console.error(redactAk(`OFFICIAL_CONTRAST_LIVE_FAILED：${reason}`));
    // 缺 AK = blocked 3（不是脚手架 2）；其它意外按脚手架失败 2。
    process.exitCode = error instanceof LiveContrastFail ? error.code : 2;
    if (hasFlag("keep")) {
      for (const tracked of [chrome, vite]) tracked?.child.unref?.();
      session?.close();
      session = null;
      process.exit(process.exitCode);
    }
  } finally {
    if (!hasFlag("keep")) shutdown([chrome, vite], session);
  }
}

await main();
