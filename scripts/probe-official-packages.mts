/**
 * 官方包探针 orchestrator（R25-A / issue #70）
 *
 * 一条命令跑完：起 probe 页的 Vite dev server → 起 headless Chromium → 经 CDP 读
 * `window.__PROBE__` → 打印/落盘报告 → 收摊。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:official
 *   pnpm probe:official -- --out=/tmp/probe.json --timeout=240000
 *
 * 为什么自己起浏览器而不是 `--dump-dom --virtual-time-budget`：瓦片持续加载时虚拟时间
 * 永远不会耗尽，headless_shell 会挂死（实测 2 分钟不返回、产物 0 字节）。CDP 轮询是确定性的。
 *
 * 退出码：`0` 全 pass；`1` 有 fail；`3` 只有 blocked（环境/配额），`2` 脚手架失败。
 * 注意 `3` **不等于**通过 —— 与 #25「blocked 不得放行」的口径一致，调用方必须区分。
 *
 * 可信度要求（评审第 2 轮补强，别再简化）：
 * - **就绪判定必须指向本轮实例**：Vite 子进程退出即按脚手架失败；且必须校验响应头上的
 *   `PROBE_RUN_ID`（见 `official-probe/readiness.mts`）。否则端口被旧服务占着时会读旧页面，
 *   而 `packages` 字段却读当前安装版本 → 旧结果被归到当前候选版本。
 * - **CDP 一定有截止时间**：命令超时 / 全局截止 / socket 断开三者任一先到都会拒绝并结束
 *   （见 `official-probe/cdp.mts`），`finally` 里的清理因此必然执行。
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

const repoRoot = resolve(import.meta.dirname, "..");
const probeDir = join(repoRoot, "tests/browser/official-packages");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const port = Number(argValue("port") ?? "5211");
const outPath = argValue("out");
const overallTimeoutMs = Number(argValue("timeout") ?? "240000");
const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);
/** 本轮运行标识：Vite 经响应头回显、页面经 `?run=` 回显，两边都必须与本值一致。 */
const runId = randomUUID();

/** headless Chromium 解析顺序：显式覆盖 → Playwright 缓存 → 系统 Chrome。 */
function resolveBrowser(): string {
  const explicit = process.env.SMOKE_BROWSER;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`SMOKE_BROWSER 不存在：${explicit}`);
    return explicit;
  }
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith("chromium_headless_shell-")) continue;
      const candidate = join(cache, entry, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(candidate)) return candidate;
    }
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chrome)) return chrome;
  throw new Error("找不到可用的 Chromium：设置 SMOKE_BROWSER 指向浏览器可执行文件");
}

/** 跟踪子进程退出（含 spawn 失败），供「启动失败立刻失败」使用。 */
interface TrackedChild {
  child: ChildProcess;
  exited: Promise<ChildExit>;
}

function spawnTracked(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; verbose?: boolean }): TrackedChild {
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
    child.once("error", (error) =>
      finish({ code: null, signal: null, error: String(error.message) }),
    );
  });
  return { child, exited };
}

/** `--remote-debugging-port=0`：轮询 DevToolsActivePort 第一行拿真实端口（不抢端口、慢机器不假失败）。 */
async function waitForDevToolsPort(userDataDir: string, exited: Promise<ChildExit>, timeoutMs: number): Promise<number> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const started = Date.now();
  let exitedWith: ChildExit | null = null;
  void exited.then((exit) => {
    exitedWith = exit;
  });
  for (;;) {
    if (exitedWith) {
      throw new Error(`Chromium 未能在本轮启动：${JSON.stringify(exitedWith)}`);
    }
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

async function waitForPageTarget(devtoolsPort: number, prefix: string, timeoutMs: number): Promise<CdpTarget> {
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

/** AK 会随 getscript URL 出现在栈帧里；落盘前再脱敏一次（页面侧已脱敏，这里是纵深防御）。 */
function redactAk(text: string): string {
  return text.replace(/([?&]ak=)[^&#\s"')]+/gi, "$1<redacted>");
}

/** 锁定版本：把探针实际加载到的官方包版本记进报告，供契约表引用。 */
function installedVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of ["@baidumap/jsapi-loader", "@baidumap/jsapi-ui-kit"]) {
    const pkgPath = join(repoRoot, "node_modules", name, "package.json");
    versions[name] = existsSync(pkgPath)
      ? (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version
      : "NOT_INSTALLED";
  }
  return versions;
}

interface ProbeReport {
  runId?: string;
  checks: { id: string; status: "pass" | "fail" | "blocked" }[];
  verdicts: Record<string, string>;
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

async function main(): Promise<void> {
  if (!ak) {
    console.error("缺少 AK：用 `BAIDU_MAP_AK=<ak> pnpm probe:official` 或 `--ak=<ak>` 传入。");
    console.error("（AK 只经 URL 查询参数传给页面，不落盘、不入库。）");
    process.exitCode = 2;
    return;
  }
  const browser = resolveBrowser();
  const userDataDir = mkdtempSync(join(tmpdir(), "official-probe-"));
  const url = `http://localhost:${port}/?ak=${encodeURIComponent(ak)}&run=${runId}`;
  let vite: TrackedChild | null = null;
  let chrome: TrackedChild | null = null;
  let session: CdpSession | null = null;

  try {
    vite = spawnTracked(
      join(repoRoot, "node_modules/.bin/vite"),
      ["--config", join(probeDir, "vite.config.ts")],
      {
        cwd: probeDir,
        // 把本轮 run id 交给 Vite，由 vite.config.ts 通过 x-probe-run 响应头回显
        env: { ...process.env, PROBE_RUN_ID: runId },
        verbose: hasFlag("verbose"),
      },
    );
    try {
      await waitForViteReady({
        url: `http://localhost:${port}/`,
        runId,
        timeoutMs: 30_000,
        exited: vite.exited,
      });
    } catch (error) {
      if (error instanceof ViteNotReadyError) {
        console.error(`PROBE_VITE_NOT_READY：${error.message}`);
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
        "--enable-unsafe-swiftshader",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        url,
      ],
      {},
    );
    const devtoolsPort = await waitForDevToolsPort(userDataDir, chrome.exited, 30_000);
    const target = await waitForPageTarget(devtoolsPort, `http://localhost:${port}`, 30_000);

    // 连接与每条命令都受同一个截止时间约束（断连/不回响应都会拒绝，不会挂死）。
    const deadline = Date.now() + overallTimeoutMs;
    session = await connectCdpSession(target.webSocketDebuggerUrl!, {
      deadline,
      commandTimeoutMs: 30_000,
    });
    const report = await readProbeReport<ProbeReport>(session, { deadline });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__PROBE__（看页面控制台）");
      process.exitCode = 2;
      return;
    }
    if (report.runId !== runId) {
      // 兜底：即便就绪判定被绕过，报告也必须自证来自本轮页面。
      console.error(
        `PROBE_RUN_ID_MISMATCH：报告来自 ${report.runId ?? "(未标注)"}，本轮应为 ${runId}`,
      );
      process.exitCode = 2;
      return;
    }

    const envelope = {
      generatedAt: new Date().toISOString(),
      runId,
      packages: installedVersions(),
      browser,
      report,
    };
    const serialized = redactAk(JSON.stringify(envelope, null, 2));
    console.log(serialized);
    if (outPath) writeFileSync(outPath, `${serialized}\n`);

    const failed = report.checks.filter((c) => c.status === "fail");
    const blocked = report.checks.filter((c) => c.status === "blocked");
    console.error(
      `\n[run] ${runId}\n` +
        `[packages] ${JSON.stringify(envelope.packages)}\n` +
        `[fail=${failed.length}] ${failed.map((c) => c.id).join(",") || "-"}\n` +
        `[blocked=${blocked.length}] ${blocked.map((c) => c.id).join(",") || "-"}\n` +
        `[verdicts] ${JSON.stringify(report.verdicts)}`,
    );
    process.exitCode = failed.length > 0 ? 1 : blocked.length > 0 ? 3 : 0;
  } catch (error) {
    const reason =
      error instanceof CdpTimeoutError || error instanceof CdpClosedError
        ? `CDP 会话在截止时间内未能完成：${error.message}`
        : String((error as Error)?.message ?? error);
    console.error(`PROBE_FAILED：${reason}`);
    process.exitCode = 2;
  } finally {
    if (!hasFlag("keep")) shutdown([chrome, vite], session);
  }
}

await main();
