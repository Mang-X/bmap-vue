/**
 * v4 required smoke 的进程编排（R25-E / issue #74）
 *
 * 一条命令跑完「起页面 → 起浏览器 → 读结论 → 判退」：
 *
 * ```bash
 * node --experimental-strip-types scripts/smoke-jsapi-v4.mts --mode=fixture        # PR 门禁，无 AK / 无网络
 * BAIDU_MAP_AK=xxx node --experimental-strip-types scripts/smoke-jsapi-v4.mts --mode=live
 * ```
 *
 * 退出码：`0` 全 required pass 且没有任何不可放行结论；`1` 有 fail；`3` 有
 * blocked / skipped / expected-failure（**不可放行**，与「通过」严格区分）；`2` 脚手架失败。
 *
 * 复用的两个模块是 #70 为官方包探针建的，语义已经过评审：`official-probe/readiness.mts`
 * 保证「就绪判定绑定本轮实例」，`official-probe/cdp.mts` 保证「CDP 一定有截止时间」。
 * 这里刻意不再自造一套。
 *
 * 为什么不用 `chrome-headless-shell --dump-dom --virtual-time-budget`：真实瓦片持续加载时
 * 虚拟时间永远不会耗尽，进程会挂死（实测 2 分钟不返回、产物 0 字节）。
 *
 * 约束（`node --experimental-strip-types`）：不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { evaluateSmokeReport, formatReport, redactAk, type SmokeReport } from "../tests/browser/jsapi-v4/report.mts";
import { requiredChecks, UNATTRIBUTED_WHITELIST } from "../tests/browser/jsapi-v4/registry.mts";

const repoRoot = resolve(import.meta.dirname, "..");
const pageDir = join(repoRoot, "tests/browser/jsapi-v4");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const mode = argValue("mode") === "live" ? "live" : "fixture";
const port = Number(argValue("port") ?? "5212");
const outPath = argValue("out");
const logPath = argValue("log");
const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const overallTimeoutMs = Number(argValue("timeout") ?? (mode === "live" ? 300_000 : 180_000));
const readyMs = argValue("ready-ms");
const runId = randomUUID();

/* -------------------------------------------------------------- 进程工具 */

/**
 * 下面这几个函数（spawnTracked / waitForDevToolsPort / waitForPageTarget / resolveBrowser）与
 * `scripts/probe-official-packages.mts` 里同名的那几个**是刻意重复的**，不是漏抽：
 * 抽成共享模块就要改动 #70 已评审通过的探针文件，收益（两个 orchestrator 少 60 行胶水）
 * 不抵它带来的评审与回归成本。**真正需要共享的两块已经共享**：CDP 会话（`official-probe/cdp.mts`
 * 的截止时间语义）与就绪判定（`official-probe/readiness.mts` 的「绑定本轮实例」）。
 * 收敛项登记在 ADR 2026-09-13 的「已知限制与欠账」里。
 */

/** headless Chromium 解析顺序：显式覆盖 → Playwright 缓存 → 系统 Chrome/Chromium。 */
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

/** 记进报告与日志的载荷版本：报告要能自证「跑的是哪一版候选」。 */
function packageVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of ["@baidumap/jsapi-loader", "@baidumap/jsapi-ui-kit"]) {
    const path = join(repoRoot, "node_modules", name, "package.json");
    versions[name] = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version
      : "NOT_INSTALLED";
  }
  return versions;
}

async function main(): Promise<void> {
  if (mode === "live" && !ak) {
    console.error(
      "缺少 AK：live 档需要 `BAIDU_MAP_AK=<ak>` 或 `--ak=<ak>`。\n" +
        "（AK 只经 URL 查询参数传给页面，不落盘、不入库。）",
    );
    process.exitCode = 2;
    return;
  }

  const browser = resolveBrowser();
  const userDataDir = mkdtempSync(join(tmpdir(), "v4-smoke-"));
  const query = new URLSearchParams({ mode, run: runId });
  if (mode === "live") query.set("ak", ak);
  if (readyMs) query.set("readyMs", readyMs);
  const url = `http://localhost:${port}/?${query.toString()}`;
  let vite: TrackedChild | null = null;
  let chrome: TrackedChild | null = null;
  let session: CdpSession | null = null;

  try {
    vite = spawnTracked(join(repoRoot, "node_modules/.bin/vite"), ["--config", join(pageDir, "vite.config.ts")], {
      cwd: pageDir,
      // `SMOKE_PORT` 与 `--port` 必须同时生效：vite.config.ts 的 `strictPort` 用的是这个端口，
      // 只改 URL 不改 dev server 会必然落进 ViteNotReady（退出 2）。
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
        console.error(`SMOKE_VITE_NOT_READY：${error.message}`);
        process.exitCode = 2;
        return;
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
    const report = await readProbeReport<SmokeReport>(session, {
      deadline,
      expression: "JSON.stringify(window.__SMOKE__ ?? null)",
    });
    if (!report) {
      console.error("SMOKE_REPORT_MISSING：页面没有写 window.__SMOKE__（页面控制台见 console）");
      process.exitCode = 2;
      return;
    }
    if (report.runId !== runId) {
      // 兜底：就绪判定被绕过时，报告也必须自证来自本轮页面。
      console.error(`SMOKE_RUN_ID_MISMATCH：报告来自 ${report.runId ?? "(未标注)"}，本轮应为 ${runId}`);
      process.exitCode = 2;
      return;
    }

    // 判定在 Node 侧重算：页面的结论不可作为判退依据（页面可能被旧实例或旧模块图污染）。
    const gate = evaluateSmokeReport(report, {
      required: requiredChecks(report.mode),
      whitelist: UNATTRIBUTED_WHITELIST,
    });
    const header = [
      `# v4 required smoke`,
      `mode=${report.mode}`,
      `run=${runId}`,
      `ak=${report.akUsed ? "yes" : "no"}`,
      `browser=${browser}`,
      `packages=${JSON.stringify(packageVersions())}`,
      `gate.ok=${gate.ok} gate.exit=${gate.exitCode}`,
      ``,
      formatReport(report, gate),
      ``,
    ].join("\n");
    const serialized = redactAk(header);
    console.log(serialized);
    if (outPath) writeFileSync(outPath, `${serialized}\n`);
    if (logPath) writeFileSync(logPath, `${serialized}\n`);

    console.error(
      redactAk(
        `\n[smoke:v4] mode=${report.mode} ok=${gate.ok} exit=${gate.exitCode}\n` +
          `[required] ${gate.required.join(",")}\n` +
          `[missing] ${gate.requiredMissing.join(",") || "-"}\n` +
          `[fail] ${gate.failing.join(",") || "-"}\n` +
          `[inconclusive] ${gate.inconclusive.join(",") || "-"}\n` +
          `[reasons]\n${gate.reasons.map((r) => `  ${r}`).join("\n") || "  -"}`,
      ),
    );
    process.exitCode = gate.exitCode;
  } catch (error) {
    const reason =
      error instanceof CdpTimeoutError || error instanceof CdpClosedError
        ? `CDP 会话在截止时间内未能完成：${error.message}`
        : String((error as Error)?.message ?? error);
    // 与 stdout 一样过一遍脱敏：异常消息里可能嵌着带 `ak=` 的入口 URL（栈帧同理）。
    console.error(`SMOKE_FAILED：${redactAk(reason)}`);
    process.exitCode = 2;
  } finally {
    if (!hasFlag("keep")) shutdown([chrome, vite], session);
  }
}

await main();
