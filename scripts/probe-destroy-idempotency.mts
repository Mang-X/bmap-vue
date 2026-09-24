#!/usr/bin/env node
/**
 * destroy / dispose 幂等性与销毁期回调探针（issue #128 / F-3）
 *
 * 审计表登记的问题：SDK 实例的 `destroy()` / `dispose()` 是否幂等、销毁期是否真会回调业务。
 * 现状只有**已知反例**（ADR 2026-09-12 真实 AK smoke：**未加载场景**的 `Panorama#destroy()`
 * 抛 `TypeError: Cannot read properties of undefined (reading 'START')`），没有正向读数。
 * 在取证之前，契约措辞一律「本库保证」而非「官方保证」。
 *
 * 本探针取两组读数：
 *
 * 1. **幂等性**：Map 首次 destroy（正证控件）→ 第二次；Autocomplete 首次 dispose → 第二次；
 *    Panorama 先 `setId` 再首次 / 第二次 destroy；Panorama **未加载场景**（已知反例对照）。
 *    ⚠️ headless 下 `setId` 调用本身不抛，但场景常**未真正加载**（无 `id_changed` / `dataload`），
 *    destroy 仍抛 `START` —— 读数按实际结果记，不把「setId 调用成功」当成「场景已加载」。
 * 2. **销毁期回调**：Map destroy 事件监听收到几条；Autocomplete `search` 后立刻 `dispose`，
 *    dispose 期间与之后 `onSearchComplete` 各被调几次。
 *
 * ## 浏览器
 *
 * 必须用 **chrome-headless-shell**（与 `smoke-jsapi-v4.mts` 同口径）。系统 Chrome 在
 * `--headless` 下调用 `Panorama#setId` 会挂死渲染主线程（CDP `Runtime.evaluate` 无响应），
 * 导致探针永远写不出报告。`resolveBrowser()` 优先解析 Playwright 缓存里的 headless shell，
 * 仍可用 `SMOKE_BROWSER` 显式覆盖。
 *
 * ## 正证控件
 *
 * - `map.control.destroyOnce.threw === false`；
 * - `auto.control.disposeOnce.threw === false`；
 * - `auto.control.search.threw === false`：对照组的**显式 search** 必须发出——否则
 *   `callbackObserved` 可能来自同实例其它触发，不证明「本次 search 可回调」；
 * - `auto.control.callbackObserved.count >= 1`：**对照组**——同环境同类实例不 dispose 时
 *   `onSearchComplete` 必须能到达；否则 dispose 臂的 0/0 无法区分「dispose 挡住了」与
 *   「网络/服务根本没回」（issue #128：每个探针要有对照组，否则挂起会退化成失败）。
 *
 * 控件读数齐备但任一不成立 ⇒ 退出码 1、**本轮不出结论**；
 * 若是 SDK 没起来 / phase 未完成，走 blocked（退出码 3）。
 *
 * ## 半边前置（进结论、不进全局控件）
 *
 * - `map.control.destroyListener.threw === false`：destroy 监听必须挂上，否则
 *   `destroyEventCount=0` 不构成「未见回调」（Map 半边第三态）；
 * - `auto.search.threw === false`：dispose 臂请求必须发出，否则 0/0 不构成
 *   「窗口内未见回调」（Autocomplete 半边第三态）。
 *
 * 半边前置**不**进 `controlFailures`（否则 exit 1 时不再打印另一半有效结论）；
 * 但打印 verdicts 后必须走 `conclusionExitCode`：任一结论仍含「无法判定」⇒ 退出码 1。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 正证控件成立，**且**全部结论都是确定结论 | 0 |
 * | `fail` | 控件不成立，**或**任一结论仍是第三态（无法判定） | 1 |
 * | `blocked` | SDK 没起来（`loadError`）或 `phase ≠ done`（**先于**控件判定） | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 语法错 / 没写报告 | 2 |
 *
 * 判定顺序有意为 **blocked → 控件 → 结论 → 第三态退出码**：SDK 没起来时控件读数
 * 通常也缺失，若先跑 `controlFailures` 会把「没起来」误报成 exit 1。
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-layer-detached.mts` 同一口径：不进 CI 必需链路。**可回归 gate** 是
 * `tests/behavior/probe-destroy-idempotency-verdicts.test.ts` 的 COMPLETE ↔ live fixture
 * 一致性（读数固化）+ 既有 `driver-contract` 的 Fake 侧断言（OWNED）。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:destroy-idempotency
 *   BAIDU_MAP_AK=<ak> pnpm probe:destroy-idempotency -- --out=/tmp/destroy-idempotency.json
 *   SMOKE_BROWSER=<chrome-headless-shell> BAIDU_MAP_AK=<ak> pnpm probe:destroy-idempotency
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";
import {
  conclusionExitCode,
  controlFailures,
  verdicts,
  type ProbeReport,
} from "./probe-destroy-idempotency-verdicts.mts";

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const outPath = argValue("out") ?? "";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/**
 * 只接受 chrome-headless-shell（系统 Chrome 在 `--headless` 下调用 `Panorama#setId`
 * 会挂死渲染主线程，与文件头记录一致）。系统 Chrome 若要做实验，仅允许用户显式
 * `SMOKE_BROWSER` opt-in——不进自动回退链，避免静默选中已知坏路径后等到 CDP 截止才失败。
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
      );
    }
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(
    "找不到 chrome-headless-shell：设置 SMOKE_BROWSER（显式 opt-in），或 `npx playwright install chromium`。" +
      " 本探针**不**自动回退系统 Chrome（setId 会挂死渲染主线程）。",
  );
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 结构（每一步写进 report；页面异常落 `report.error`）：
 *
 * 1. 加载 SDK（带 `callback=` 入口）并等到 `BMap.Map` 是函数；
 * 2. 建图 + `centerAndZoom`，挂 `destroy` 监听计数；
 * 3. Map：第一次 destroy（正证）→ 等一会看事件 → 第二次 destroy；
 * 4. Autocomplete **对照组**：同环境构造 → `search` → 等 `onSearchComplete`（不 dispose）
 *    → 记 `callbackObserved`；再走 dispose 臂：`search` → **立刻** `dispose` →
 *    计 dispose 期间 / 之后回调次数 → 再 `dispose` 一次（幂等）；
 * 5. Panorama：已加载场景（`setId`）destroy ×2；未加载场景 destroy（已知反例对照）。
 *
 * ⚠️ 页面里**不出现反引号**（外层是 TS 模板串），由 `probe-page-scripts.test.ts` 静态守卫。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = { phase: "boot", sdk: null, readings: [], console: [], error: null, loadError: null };
  // 只在结束时写 window：readProbeReport 一看到非 null 就返回（phase 可能还是 boot）。
  // 与 probe-layer-detached 同口径——中途挂了由 catch 写 phase=error 再挂上。

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const push = (id, extra) => { report.readings.push(Object.assign({ id: id }, extra)); };
  const attempt = (fn) => {
    try { fn(); return { threw: false, message: null }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error) }; }
  };

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapDestroyProbeReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapDestroyProbeReady";
    script.onerror = () => { report.loadError = "SDK 入口脚本加载失败（script error）"; };
    document.head.appendChild(script);
    await Promise.race([readyPromise, wait(60000)]);
    for (let i = 0; i < 150; i++) {
      if (window.BMap && typeof window.BMap.Map === "function") break;
      await wait(200);
    }
    if (!(window.BMap && typeof window.BMap.Map === "function")) {
      throw new Error("BMap.Map 未就绪；loadError=" + String(report.loadError));
    }
    report.sdk = {
      version: String(window.BMap.version),
      map: typeof window.BMap.Map,
      panorama: typeof window.BMap.Panorama,
      autocomplete: typeof window.BMap.Autocomplete,
    };

    /* ---- Map：destroy 幂等 + destroy 事件 ---- */
    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:400px";
    document.body.appendChild(host);
    const map = new window.BMap.Map(host);
    map.centerAndZoom(new window.BMap.Point(116.404, 39.915), 13);
    let destroyEvents = 0;
    // 监听安装本身也要留读数：安装失败时 destroyEventCount=0 不构成「未见回调」。
    push("map.control.destroyListener", attempt(function () {
      map.addEventListener("destroy", function () { destroyEvents += 1; });
    }));
    await wait(600);

    push("map.control.destroyOnce", attempt(() => map.destroy()));
    await wait(500);
    push("map.destroyEventCount", { threw: false, count: destroyEvents });
    push("map.destroyTwice", attempt(() => map.destroy()));
    await wait(300);

    /* ---- Autocomplete 对照组：同环境 search，不 dispose，等 onSearchComplete ---- */
    /* 先证明「这类实例在本环境下回调能到达」，再解释下面 dispose 臂的 0/0。 */
    const inputCtrl = document.createElement("input");
    inputCtrl.style.cssText = "width:200px";
    document.body.appendChild(inputCtrl);
    let ctrlCallbacks = 0;
    let autoCtrl = null;
    try {
      autoCtrl = new window.BMap.Autocomplete({
        input: inputCtrl,
        onSearchComplete: function () { ctrlCallbacks += 1; },
      });
      push("auto.control.ctrlCreate", { threw: false, message: null });
    } catch (error) {
      push("auto.control.ctrlCreate", { threw: true, message: String(error && error.message ? error.message : error) });
      throw error;
    }
    push("auto.control.search", attempt(function () { autoCtrl.search("北京"); }));
    // 最多等 5s：JSONP 往返常见在 1–3s 内；超时则 count=0 ⇒ 控件不成立（exit 1），不把 0/0 当结论。
    for (let i = 0; i < 50 && ctrlCallbacks < 1; i++) await wait(100);
    push("auto.control.callbackObserved", { threw: false, count: ctrlCallbacks });
    try { autoCtrl.dispose(); } catch (ignoreCtrlDispose) { void ignoreCtrlDispose; }

    /* ---- Autocomplete dispose 臂：search → 立刻 dispose → 计回调 ---- */
    const input = document.createElement("input");
    input.style.cssText = "width:200px";
    document.body.appendChild(input);
    let cbDuring = 0;
    let cbAfter = 0;
    let disposing = false;
    const onSearchComplete = function () {
      if (disposing) cbDuring += 1;
      else cbAfter += 1;
    };
    let auto = null;
    try {
      auto = new window.BMap.Autocomplete({ input: input, onSearchComplete: onSearchComplete });
      push("auto.control.create", { threw: false, message: null });
    } catch (error) {
      push("auto.control.create", { threw: true, message: String(error && error.message ? error.message : error) });
      throw error;
    }
    // 成功/失败都要留读数：search 抛错时 0/0 不构成「窗口内未见回调」的证据
    //（判定层读 auto.search.threw 作 Autocomplete 半边前置）。
    push("auto.search", attempt(function () { auto.search("北京"); }));
    // 立刻 dispose（模拟组件卸载：请求在飞时释放）
    disposing = true;
    push("auto.control.disposeOnce", attempt(() => auto.dispose()));
    await wait(400);
    disposing = false;
    // dispose 之后再等一会，看迟到回调（SwiftShader 下缩短窗口，仍覆盖常见 JSONP 往返）
    await wait(1200);
    push("auto.callbacksDuringDispose", { threw: false, count: cbDuring });
    push("auto.callbacksAfterDispose", { threw: false, count: cbAfter });
    push("auto.disposeTwice", attempt(() => auto.dispose()));

    /* ---- Panorama：已加载场景 ×2 + 未加载场景（已知反例） ---- */
    // 先让出主线程一拍：Map/Autocomplete 的 WebGL/网络尾巴别和全景构造叠在同一帧。
    await wait(100);
    if (typeof window.BMap.Panorama === "function") {
      // 官方要求宿主容器：new BMap.Panorama(container)（无容器构造会抛「全景引擎宿主容器不存在」）。
      const panoHost = document.createElement("div");
      panoHost.style.cssText = "width:400px;height:300px";
      document.body.appendChild(panoHost);
      document.title = "panoCtor";
      const panoLoaded = new window.BMap.Panorama(panoHost);
      document.title = "panoCtorOk";
      try {
        panoLoaded.setId("fnu5jgn3b8ibg3vqcdmnhpfv"); // 已知可用的公开全景 id（北京天安门一带）
        document.title = "setIdOk";
        await wait(400);
        push("pano.loaded.setId", { threw: false, message: null });
      } catch (error) {
        push("pano.loaded.setId", { threw: true, message: String(error && error.message ? error.message : error) });
      }
      document.title = "panoD1";
      push("pano.loaded.destroyOnce", attempt(() => panoLoaded.destroy()));
      document.title = "panoD1Done";
      push("pano.loaded.destroyTwice", attempt(() => panoLoaded.destroy()));
      document.title = "panoD2Done";

      // 未加载场景：有宿主、但从不 setId —— 对照 ADR 2026-09-12 的已知反例。
      const emptyHost = document.createElement("div");
      emptyHost.style.cssText = "width:400px;height:300px";
      document.body.appendChild(emptyHost);
      document.title = "emptyCtor";
      const panoEmpty = new window.BMap.Panorama(emptyHost);
      document.title = "emptyCtorOk";
      push("pano.unloaded.destroy", attempt(() => panoEmpty.destroy()));
      document.title = "emptyDDone";
    } else {
      push("pano.unloaded.destroy", { threw: null, message: "Panorama 构造器不存在" });
      push("pano.loaded.destroyOnce", { threw: null, message: "Panorama 构造器不存在" });
      push("pano.loaded.destroyTwice", { threw: null, message: "Panorama 构造器不存在" });
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__DESTROY_IDEMPOTENCY_PROBE__ = report;
})();
`;

function redact(text: string): string {
  const trimmed = ak.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:destroy-idempotency`");
    return 2;
  }
  let browser: string;
  try {
    browser = resolveBrowser();
  } catch (error) {
    console.error(String(error));
    return 2;
  }
  console.log(`[destroy-idempotency] browser=${browser}`);

  const pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak));
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>destroy idempotency probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "destroy-idempotency-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[destroy-idempotency] 服务未就绪（脚手架失败）");
    return 2;
  }
  const baseUrl = `http://localhost:${address.port}/`;

  let chrome: ChildProcess | null = null;
  let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null;
  try {
    chrome = spawn(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        baseUrl,
      ],
      { stdio: "ignore" },
    );

    const portFile = join(userDataDir, "DevToolsActivePort");
    const startedAt = Date.now();
    let devtoolsPort = 0;
    for (;;) {
      if (existsSync(portFile)) {
        devtoolsPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
        if (devtoolsPort) break;
      }
      if (Date.now() - startedAt > 30_000) throw new Error("等待 DevToolsActivePort 超时");
      await sleep(200);
    }

    let target: { webSocketDebuggerUrl?: string } | undefined;
    const t1 = Date.now();
    for (;;) {
      try {
        const list = (await (
          await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
        ).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
        target = list.find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
        if (target?.webSocketDebuggerUrl) break;
      } catch {
        /* CDP 还没起来 */
      }
      if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时");
      await sleep(300);
    }

    session = await connectCdpSession(target!.webSocketDebuggerUrl!, {
      deadline: Date.now() + 240_000,
      // Panorama/WebGL 在 SwiftShader 下可能长时间占住主线程，单条 evaluate 给足预算；
      // readProbeReport 在超时后继续轮询（见下方 catch），不把一次超时当成脚手架失败。
      commandTimeoutMs: 60_000,
    });
    let report: ProbeReport | null = null;
    const reportDeadline = Date.now() + 200_000;
    for (;;) {
      try {
        report = await readProbeReport<ProbeReport>(session, {
          expression:
            "window.__DESTROY_IDEMPOTENCY_PROBE__ ? JSON.stringify(window.__DESTROY_IDEMPOTENCY_PROBE__) : null",
          deadline: Math.min(reportDeadline, Date.now() + 65_000),
          pollIntervalMs: 500,
        });
        if (report) break;
      } catch (error) {
        if (Date.now() >= reportDeadline) throw error;
        console.log(`[destroy-idempotency] 轮询被 CDP 超时打断，重试：${(error as Error).message}`);
        await sleep(500);
      }
      if (Date.now() >= reportDeadline) break;
    }
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__DESTROY_IDEMPOTENCY_PROBE__");
      return 2;
    }

    console.log("== destroy / dispose 幂等性与销毁期回调探针 ==")
    console.log(`SDK：${redact(JSON.stringify(report.sdk))}  页面阶段：${report.phase}`)
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`)
    for (const reading of report.readings) {
      console.log(`  ${reading.id.padEnd(34)} ${redact(JSON.stringify(reading))}`)
    }
    if (report.console.length > 0) {
      console.log(`-- 页面 console（${report.console.length} 条）--`)
      for (const entry of report.console.slice(0, 12)) {
        console.log(`  [${entry.level}] ${redact(entry.text)}`)
      }
    }
    // 退出码顺序与 issue 分档对齐：blocked（SDK 没起来 / phase 未完成）先于 fail。
    // 控件缺失通常就是「SDK 没起来」的表现，若先判 controlFailures 会把它误报成 exit 1。
    if (report.loadError || report.phase !== "done") {
      if (report.loadError) {
        console.error(`-- blocked：SDK 入口未就绪（${report.loadError}）⇒ 退出码 3 --`)
      } else {
        console.error(`-- blocked：页面阶段 ${report.phase} ≠ done ⇒ 退出码 3 --`)
      }
      if (outPath) writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      return 3;
    }
    const failures = controlFailures(report);
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --")
      for (const failure of failures) console.error(`  ${failure}`)
      console.error("（上面这些读数按「无法判定」对待：控件不成立时它们无意义）")
      if (outPath) writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      return 1;
    }

    console.log("-- 结论 --")
    const lines = verdicts(report)
    for (const line of lines) console.log(`  ${line}`)

    if (outPath) {
      writeFileSync(outPath, redact(JSON.stringify(report, null, 2)))
      console.log(`原始报告（已脱敏）写入 ${outPath}`)
    }
    console.log(`summary: ${redact(lines.join(" | "))}`)
    // #128「0 = 全 pass」：stdout 已有「无法判定」时 shell status 不得仍是 0。
    // 半边前置不进 controlFailures，因此这里在打印完两半结论后再收退出码。
    const exitCode = conclusionExitCode(report)
    if (exitCode === 1) {
      console.error("-- 存在第三态结论（无法判定）⇒ 退出码 1（#128：0 才是全 pass）--")
    }
    return exitCode
  } finally {
    session?.close()
    chrome?.kill()
    server.close()
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[destroy-idempotency] 脚手架失败：${redact(String(error))}`)
  return 2
})
