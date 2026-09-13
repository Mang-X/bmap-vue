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
 * 退出码：`0` 全 pass；`1` 有 fail；`3` 只有 blocked（环境/配额），`2` 脚手架失败（没读到报告）。
 * 注意 `3` **不等于**通过 —— 与 #25「blocked 不得放行」的口径一致，调用方必须区分。
 *
 * 约束（`node --experimental-strip-types`）：不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`等待 ${url} 超时`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** `--remote-debugging-port=0`：轮询 DevToolsActivePort 第一行拿真实端口（不抢端口、慢机器不假失败）。 */
async function waitForDevToolsPort(userDataDir: string, timeoutMs: number): Promise<number> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const started = Date.now();
  for (;;) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      if (first) return Number(first);
    }
    if (Date.now() - started > timeoutMs) throw new Error("等待 DevToolsActivePort 超时");
    await new Promise((r) => setTimeout(r, 200));
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
    await new Promise((r) => setTimeout(r, 300));
  }
}

interface ProbeReport {
  checks: { id: string; status: "pass" | "fail" | "blocked" }[];
  verdicts: Record<string, string>;
}

/** 连上页面 target，轮询 `window.__PROBE__` 直到超时。 */
async function readReport(target: CdpTarget, timeoutMs: number): Promise<ProbeReport | null> {
  const ws = new WebSocket(target.webSocketDebuggerUrl!);
  let messageId = 0;
  const pending = new Map<number, (msg: { result?: unknown }) => void>();
  ws.addEventListener("message", (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown }> => {
    const id = ++messageId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveFn) => pending.set(id, resolveFn));
  };
  await new Promise((resolveFn) => ws.addEventListener("open", resolveFn, { once: true }));
  await send("Runtime.enable");

  const deadline = Date.now() + timeoutMs;
  let report: ProbeReport | null = null;
  while (Date.now() < deadline) {
    const res = (await send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__PROBE__ ?? null)",
      returnByValue: true,
    })) as { result?: { result?: { value?: string } } };
    const value = res.result?.result?.value;
    if (value && value !== "null") {
      report = JSON.parse(value) as ProbeReport;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  ws.close();
  return report;
}

function shutdown(children: (ChildProcess | null)[]): void {
  for (const child of children) {
    if (!child || child.exitCode !== null) continue;
    try {
      child.kill("SIGKILL");
    } catch {
      /* 已经退出 */
    }
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

async function main(): Promise<void> {
  if (!ak) {
    console.error("缺少 AK：用 `BAIDU_MAP_AK=<ak> pnpm probe:official` 或 `--ak=<ak>` 传入。");
    console.error("（AK 只经 URL 查询参数传给页面，不落盘、不入库。）");
    process.exit(2);
  }
  const browser = resolveBrowser();
  const userDataDir = mkdtempSync(join(tmpdir(), "official-probe-"));
  let vite: ChildProcess | null = null;
  let chrome: ChildProcess | null = null;
  const url = `http://localhost:${port}/?ak=${encodeURIComponent(ak)}`;

  try {
    vite = spawn(join(repoRoot, "node_modules/.bin/vite"), ["--config", join(probeDir, "vite.config.ts")], {
      cwd: probeDir,
      stdio: hasFlag("verbose") ? "inherit" : "pipe",
    });
    await waitForHttp(`http://localhost:${port}/`, 30_000);

    chrome = spawn(
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
      { stdio: "pipe" },
    );
    const devtoolsPort = await waitForDevToolsPort(userDataDir, 30_000);
    const target = await waitForPageTarget(devtoolsPort, `http://localhost:${port}`, 30_000);
    const report = await readReport(target, overallTimeoutMs);
    if (!report) {
      // 用 exitCode + return 而不是 process.exit：后者会跳过 finally，把 Chromium / Vite 留在后台。
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__PROBE__（看页面控制台）");
      process.exitCode = 2;
      return;
    }
    const envelope = {
      generatedAt: new Date().toISOString(),
      packages: installedVersions(),
      browser: browser,
      report,
    };
    const serialized = redactAk(JSON.stringify(envelope, null, 2));
    console.log(serialized);
    if (outPath) writeFileSync(outPath, `${serialized}\n`);

    const failed = report.checks.filter((c) => c.status === "fail");
    const blocked = report.checks.filter((c) => c.status === "blocked");
    console.error(
      `\n[packages] ${JSON.stringify(envelope.packages)}\n` +
        `[fail=${failed.length}] ${failed.map((c) => c.id).join(",") || "-"}\n` +
        `[blocked=${blocked.length}] ${blocked.map((c) => c.id).join(",") || "-"}\n` +
        `[verdicts] ${JSON.stringify(report.verdicts)}`,
    );
    process.exitCode = failed.length > 0 ? 1 : blocked.length > 0 ? 3 : 0;
  } finally {
    if (!hasFlag("keep")) shutdown([chrome, vite]);
  }
}

await main();
