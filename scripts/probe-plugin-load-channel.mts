#!/usr/bin/env node
/**
 * 插件脚本加载通道探针（issue #121）
 *
 * `scripts/probe-plugin-runtime.mts` 回答的是「插件在真实 4.0 上的最小功能路径能不能跑通」；
 * 本脚本回答的是**另一件事**：`plugins/builtins.ts` 的 `loadScriptWithExport` 这条**第三份**脚本加载
 * 通道（官方 Loader 与服务自建的 `ScriptLoader` 之外）在两种边界下的行为：
 *
 * 1. **挂起**：脚本服务器「建立连接但不响应」时，`whenPlugin` 会不会永久挂着；
 * 2. **取消**：`AbortSignal` 分支在真实浏览器里到底做了什么，共享宿主里的其它消费者会怎样。
 *
 * ## 为什么必须真的跑浏览器
 *
 * 这两件事都不是「读代码就能确定」的：`<script>` 的 `onload` / `onerror` 是否会来、移除元素能不能
 * 让请求停下来、abort 之后共享任务与其它消费者各是什么状态，都要在真实 DOM + 真实网络栈上量。
 * 因此页面里跑的是**候选提交的源码**（经 Vite 编译），只把「插件 URL 表里的一项」指向一个
 * **同源、永不响应**的地址（中间件见 `tests/browser/plugin-load-channel/vite.config.ts`）。
 *
 * ## 场景与判定
 *
 * 三个场景各用一个**全新文档**（`?scenario=<id>`），互不污染：
 *
 * | 场景 | 它在证明什么 |
 * | --- | --- |
 * | `control` | 正证：同一路径、**真实**内置 URL 必须真的就绪（否则「挂起场景的失败」什么都不说明） |
 * | `hang` | 挂起期间地图照常 ready；挂起在超时窗口内以失败结算；错误可归类为超时；结算后不留 `<script>`；同列表里后面的插件不被永久阻塞 |
 * | `cancel` | `map` 作用域 abort 真的摘脚本；共享宿主里一个消费者取消只解绑自己；宿主 `dispose()` 让在飞加载 abort |
 *
 * 判定是**纯函数**（`scripts/plugin-load-channel-report.mts`），本文件只负责「起服务、起浏览器、
 * 拿读数、打印」。
 *
 * | 退出码 | 含义 |
 * | --- | --- |
 * | `0` | 契约全部成立 |
 * | `1` | 契约不成立（库回归 / 本票要修的缺陷仍在） |
 * | `2` | 脚手架失败（缺 AK / 找不到浏览器 / dev server 起不来 / 页面没写报告 / 页面脚本抛错） |
 * | `3` | `blocked`（本轮无法判定，**不是通过**） |
 *
 * 输出里的 `ak=` 与 `BAIDU_MAP_AK` 一律脱敏（页面侧 URL 与错误文本都可能带上 AK）。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-load-channel
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-load-channel -- --out=/tmp/plugin-load-channel.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { connectCdpSession, readProbeReport, sleep, type CdpSession } from "./official-probe/cdp.mts";
import { ViteNotReadyError, waitForViteReady, type ChildExit } from "./official-probe/readiness.mts";
import { freshModuleUrl } from "./fresh-module-url.mts";
import {
  decidePluginLoadChannelExitCode,
  formatPluginLoadChannelSummary,
  PLUGIN_LOAD_CHANNEL_SCENARIOS,
  type PluginLoadChannelRun,
} from "./plugin-load-channel-report.mts";

const repoRoot = resolve(import.meta.dirname, "..");
const pageDir = resolve(repoRoot, "tests/browser/plugin-load-channel");
const ak = process.env.BAIDU_MAP_AK ?? "";
const port = Number(process.env.PLUGIN_CHANNEL_PORT ?? "5213");
const runId = randomUUID();

/** 页面脚本等多久（超时常量 + 余量）；无常量（修复前的树）时给固定窗口。 */
async function resolveWaitMs(): Promise<{ waitMs: number; configuredTimeoutMs: number | null }> {
  const builtins = (await import(
    freshModuleUrl(resolve(repoRoot, "packages/baidu-map-gl-vue/src/plugins/builtins.ts"))
  )) as Record<string, unknown>;
  const raw = builtins.PLUGIN_SCRIPT_TIMEOUT_MS;
  const configuredTimeoutMs = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return { waitMs: (configuredTimeoutMs ?? 20_000) + 5_000, configuredTimeoutMs };
}

/* -------------------------------------------------------------- 进程工具 */

/**
 * 这几个与 `scripts/smoke-jsapi-v4.mts` / `scripts/probe-official-packages.mts` 里同名的函数是
 * **刻意重复**的（同 smoke 的说明）：抽成共享模块要改动已评审通过的 harness，收益不抵回归成本。
 * 真正需要一致的两块已经共享：CDP 会话（`official-probe/cdp.mts`）与 dev server 就绪判定
 * （`official-probe/readiness.mts`，含「响应必须来自本轮实例」）。
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
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): TrackedChild {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: "pipe" });
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
      const list = (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()) as CdpTarget[];
      const page = list.find((entry) => entry.type === "page" && entry.url.startsWith(prefix));
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

/* ------------------------------------------------------------------ 主流程 */

/**
 * 全部步骤收在一个函数里，**早退码必须真的停下来**（#85 第二轮 P2 的形态）：
 * 缺 AK / 找不到浏览器时不能只设一个 exitCode 就继续往下跑（那会把「缺 AK」报成 blocked，
 * 还要白等一次超时）。
 */
async function main(): Promise<number> {
  if (!ak) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:plugin-load-channel`");
    return 2;
  }

  let browser: string;
  try {
    browser = resolveBrowser();
  } catch (error) {
    console.error(`[plugin-load-channel] ${(error as Error).message}`);
    return 2;
  }

  const { waitMs, configuredTimeoutMs } = await resolveWaitMs();
  console.log(
    `[plugin-load-channel] 超时常量=${configuredTimeoutMs === null ? "（不存在）" : `${configuredTimeoutMs}ms`} ` +
      `等待窗口=${waitMs}ms port=${port}`,
  );

  const chromeProfile = mkdtempSync(join(tmpdir(), "plugin-channel-chrome-"));
  const base = `http://localhost:${port}/`;
  let vite: TrackedChild | null = null;
  let chrome: TrackedChild | null = null;
  let session: CdpSession | null = null;
  const runs: PluginLoadChannelRun[] = [];

  try {
    /* --- dev server（必须证明「响应来自本轮实例」） --- */
    vite = spawnTracked(join(repoRoot, "node_modules/.bin/vite"), ["--config", join(pageDir, "vite.config.ts")], {
      cwd: repoRoot,
      env: { ...process.env, PROBE_RUN_ID: runId, SMOKE_PORT: String(port) },
    });
    try {
      await waitForViteReady({ url: base, runId, timeoutMs: 60_000, exited: vite.exited });
    } catch (error) {
      if (error instanceof ViteNotReadyError) {
        console.error(`[plugin-load-channel] ${error.message}`);
        return 2;
      }
      throw error;
    }

    /* --- 浏览器 --- */
    chrome = spawnTracked(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        // 真实 4.0 需要 WebGL（SwiftShader 即可）
        "--enable-unsafe-swiftshader",
        "--remote-debugging-port=0",
        `--user-data-dir=${chromeProfile}`,
        base,
      ],
      {},
    );
    const devtoolsPort = await waitForDevToolsPort(chromeProfile, chrome.exited, 30_000);
    const target = await waitForPageTarget(devtoolsPort, base, 30_000);
    // 截止时间必须覆盖「三个场景各自等满窗口」的最坏情况 + 启动与清理余量。
    const deadline = Date.now() + waitMs * 2 + 120_000;
    session = await connectCdpSession(target.webSocketDebuggerUrl!, {
      deadline,
      commandTimeoutMs: 30_000,
    });

    for (const scenario of PLUGIN_LOAD_CHANNEL_SCENARIOS) {
      const url = `${base}?scenario=${scenario}&ak=${encodeURIComponent(ak)}&wait=${waitMs}`;
      await session.send("Page.navigate", { url });
      const report = await readProbeReport<PluginLoadChannelRun>(session, {
        deadline,
        pollIntervalMs: 1000,
        // 只认「本轮这个场景写完」——否则会读到上一个场景遗留的报告
        expression:
          "(window.__PLUGIN_LOAD_CHANNEL__ && window.__PLUGIN_LOAD_CHANNEL__.done && " +
          "window.__PLUGIN_LOAD_CHANNEL__.scenario === " +
          JSON.stringify(scenario) +
          ") ? JSON.stringify(window.__PLUGIN_LOAD_CHANNEL__) : null",
      });
      if (!report) throw new Error(`场景 ${scenario} 没有写出报告`);
      runs.push(report);
      const keys = Object.keys((report.readings ?? {}) as Record<string, unknown>);
      console.log(`[plugin-load-channel] ${scenario}: 读数块 = ${keys.length === 0 ? "（无）" : keys.join(", ")}`);
    }
  } catch (error) {
    console.error(`[plugin-load-channel] 脚手架失败：${(error as Error).message}`);
    return 2;
  } finally {
    shutdown([chrome, vite], session);
    try {
      rmSync(chromeProfile, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  const payload = redact(JSON.stringify({ runs }, null, 2));
  console.log(payload);
  const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  if (outPath) {
    writeFileSync(outPath, payload + "\n");
    console.log(`\n[plugin-load-channel] wrote ${outPath}`);
  }

  const decision = decidePluginLoadChannelExitCode(runs);
  console.log(`\n${formatPluginLoadChannelSummary(decision)}`);
  for (const reason of decision.reasons) console.error(`[plugin-load-channel] ${reason}`);
  if (decision.exitCode === 3) {
    console.error("[plugin-load-channel] blocked 不是通过：本轮无法判定");
  }
  return decision.exitCode;
}

/** 输出里的 `ak=` 与 `BAIDU_MAP_AK` 一律脱敏（页面侧的错误文本与 URL 都可能带上它）。 */
function redact(text: string): string {
  return text
    .replace(/([?&]ak=)[^&"'\s]+/g, "$1<redacted>")
    .replaceAll(ak, "<redacted>");
}

// 顶层只做一件事：把 main 的返回码变成 `process.exitCode`，并兜住脚手架异常（→ 2）。
// 刻意不用 `process.exit()`：它会跳过 finally，把 Chromium / Vite 子进程留在后台。
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[plugin-load-channel] 脚手架失败：${(error as Error).message}`);
    process.exitCode = 2;
  });
