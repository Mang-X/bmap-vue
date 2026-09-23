#!/usr/bin/env node
/**
 * 真实浏览器档性能读数采集（M6 / issue #123）
 *
 * 与 smoke **刻意分离**的独立入口（交付形态在开工前已确认）：
 *
 * ```bash
 * BAIDU_MAP_AK=xxx pnpm perf:baseline:live
 * ```
 *
 * 产物：`.artifacts/perf-live/report.json` + 同一份内容的人读表格（stdout，page / node 两段）。
 *
 * ## 为什么不是 `smoke --mode=live --perf`
 *
 * smoke 是**五态门禁**（退出码语义绑死 required 判定：0/1/2/3）；本票是**无阈值的读数采集**
 * （0/2/3，**永不返回 1**）。混进 smoke 会让两套退出码语义互相污染，且 smoke 页面已 2793 行。
 * 进程编排按仓库既有口径与 smoke/probe **刻意重复**（只共享 cdp + readiness 两块）——
 * 与 `smoke-jsapi-v4.mts` 文件头登记的同一条约定一致。
 *
 * ## 退出码
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 读数采齐、信封自检通过 |
 * | `2` | 脚手架失败（缺报告 / 信封不匹配 / 页面 fatal） |
 * | `3` | blocked（缺 AK、SDK 没 ready、前置不成立）——**不是通过** |
 *
 * **没有 1**：本票不设跨机器硬阈值（issue 非目标）。
 *
 * ## 约束（`node --experimental-strip-types`）
 *
 * 不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, homedir, platform, release, tmpdir } from "node:os";
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
import { datasetDescription } from "../tests/performance/dataset.ts";
import {
  buildFakeContrast,
  checkLivePerfEnvelope,
  decideLivePerfExit,
  formatLivePerfReport,
  LIVE_PERF_LAYERS,
  redactAk,
  type LivePerfReport,
} from "../tests/browser/live-performance/report.mts";

const repoRoot = resolve(import.meta.dirname, "..");
const pageDir = join(repoRoot, "tests/browser/live-performance");
const OUT_DIR = resolve(repoRoot, ".artifacts/perf-live");
const REPORT_PATH = resolve(OUT_DIR, "report.json");
const BASELINE_PATH = resolve(repoRoot, "tests/performance/baseline.json");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const port = Number(argValue("port") ?? "5214");
const outPath = argValue("out");
const logPath = argValue("log");
const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const overallTimeoutMs = Number(argValue("timeout") ?? 300_000);
const readyMs = argValue("ready-ms");
const runId = randomUUID();

/** 与 `dataset.ts` 的 `DATASET_SIZE` 口径对齐：issue 固定 50k。 */
const SIZE = 50_000;
const EXPECTED_READINGS = LIVE_PERF_LAYERS.length;

/* -------------------------------------------------------------- 进程工具 */

/**
 * 下面几个函数与 `scripts/smoke-jsapi-v4.mts` 里同名的**刻意重复**（见文件头）：
 * 真正需要共享的只有 CDP 会话与就绪判定。
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
  const exited = new Promise<ChildExit>((settle) => {
    let done = false;
    const finish = (exit: ChildExit): void => {
      if (done) return;
      done = true;
      settle(exit);
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

/** Fake 基线（对照表的 Node 侧输入）；缺失 ⇒ 对照段为空，不阻断读数本身。 */
function readFakeBaseline(): { metrics: Record<string, { minMs?: number } | undefined> } {
  if (!existsSync(BASELINE_PATH)) return { metrics: {} };
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
      metrics?: Record<string, { minMs?: number }>;
    };
    return { metrics: parsed.metrics ?? {} };
  } catch {
    return { metrics: {} };
  }
}

function fail(code: 2 | 3, message: string): never {
  console.error(redactAk(message));
  process.exit(code);
}

async function main(): Promise<void> {
  if (!ak) {
    fail(3, "BLOCKED：缺少 AK（`BAIDU_MAP_AK=<ak>` 或 `--ak=<ak>`）。读数采集不是通过。");
  }

  const browser = resolveBrowser();
  const userDataDir = mkdtempSync(join(tmpdir(), "perf-live-"));
  const query = new URLSearchParams({ mode: "live", run: runId, ak, size: String(SIZE) });
  if (readyMs) query.set("readyMs", readyMs);
  const url = `http://localhost:${port}/?${query.toString()}`;
  let vite: TrackedChild | null = null;
  let chrome: TrackedChild | null = null;
  let session: CdpSession | null = null;

  try {
    vite = spawnTracked(join(repoRoot, "node_modules/.bin/vite"), ["--config", join(pageDir, "vite.config.ts")], {
      cwd: pageDir,
      env: { ...process.env, PROBE_RUN_ID: runId, SMOKE_PORT: String(port) },
      verbose: hasFlag("verbose"),
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
      {},
    );
    const devtoolsPort = await waitForDevToolsPort(userDataDir, chrome.exited, 30_000);
    const target = await waitForPageTarget(devtoolsPort, `http://localhost:${port}`, 30_000);

    const deadline = Date.now() + overallTimeoutMs;
    session = await connectCdpSession(target.webSocketDebuggerUrl!, {
      deadline,
      commandTimeoutMs: 30_000,
    });
    const report = await readProbeReport<LivePerfReport>(session, {
      deadline,
      expression: "JSON.stringify(window.__LIVE_PERF__ ?? null)",
    });
    if (!report) {
      fail(2, "REPORT_MISSING：页面没有写 window.__LIVE_PERF__（控制台见 console）");
    }

    const envelopeIssues = checkLivePerfEnvelope(report, { runId, requireAk: true });
    const decision = decideLivePerfExit({
      envelopeIssues,
      fatal: report.fatal,
      blockedReason: report.blockedReason,
      done: report.done,
      readingCount: report.readings.length,
      expectedReadingCount: EXPECTED_READINGS,
    });
    const contrast = buildFakeContrast(report.readings, readFakeBaseline());
    // issue 验收：报告必须写明浏览器 / 机器 / SDK 版本 / 数据集版本（浏览器与数据集在 page 段，
    // 机器与 SDK 在 node 段——page/node 分开报告，不混成一条）。
    const machine = {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      node: process.version,
    };
    /** 本工程锁定的 engine / SDK version（唯一引擎 jsapi-v4，`v=4.0`；见 AGENTS 版本模型）。 */
    const sdk = { engine: "jsapi-v4", sdkVersion: "4.0" };
    const serialized = redactAk(
      formatLivePerfReport({ report, decision, contrast }) +
        `\nnode  machine=${machine.cpuModel} · ${machine.platform} ${machine.release} · ${machine.arch} · ${machine.node}` +
        `\nnode  sdk=${sdk.engine} v${sdk.sdkVersion}` +
        `\n\ndataset=${JSON.stringify(datasetDescription())}\n`,
    );
    console.log(serialized);

    mkdirSync(OUT_DIR, { recursive: true });
    const payload = {
      ...report,
      contrast,
      dataset: datasetDescription(),
      exitCode: decision.exitCode,
      reasons: decision.reasons,
      machine,
      sdk,
      environment: {
        browserPath: browser,
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpuModel: machine.cpuModel,
        cpuCount: machine.cpuCount,
      },
    };
    const json = redactAk(`${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(REPORT_PATH, json);
    if (outPath) writeFileSync(outPath, json);
    if (logPath) writeFileSync(logPath, `${serialized}\n`);
    console.error(
      redactAk(
        `[perf:baseline:live] exit=${decision.exitCode} ok=${decision.ok} readings=${report.readings.length}/${EXPECTED_READINGS}\n` +
          decision.reasons.map((r) => `  ${r}`).join("\n"),
      ),
    );
    process.exitCode = decision.exitCode;
    // `--keep` 保留 vite/chrome 时，子进程的 stdio 句柄会把事件循环钉住（实测打印完永不退出）。
    // 主路径显式收口：keep 只影响子进程存活，不影响本进程退出码何时生效。
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
    console.error(redactAk(`LIVE_PERF_FAILED：${reason}`));
    process.exitCode = 2;
    // `--keep` 时 finally 不杀子进程 ⇒ 事件循环被 stdio 钉住、永远不退出（实测）。
    // 错误路径同样显式收口。
    if (hasFlag("keep")) {
      for (const tracked of [chrome, vite]) tracked?.child.unref?.();
      session?.close();
      process.exit(2);
    }
  } finally {
    if (!hasFlag("keep")) shutdown([chrome, vite], session);
  }
}

await main();
