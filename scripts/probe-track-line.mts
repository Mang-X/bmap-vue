#!/usr/bin/env node
/**
 * TrackLine 播放控制运行时探针（issue #110 / 承接 #36 的欠账）
 *
 * 上游类型包与官方 API 参考对下面四件事**没有可核对的声明**（`TrackLine` 属扩展 API、
 * `@baidumap/jsapi-v4-types@4.0.4` 无类声明），而薄命令面与可见性联动依赖它们：
 *
 * 1. **七个方法**（`setData` / `start` / `pause` / `resume` / `stop` / `setSpeed` /
 *    `setProcess`）是否存在，调用后有没有可观测效果；
 * 2. **`statuschange` / `progress` 载荷形状与到达时机**（能不能当公开读回面用）；
 * 3. **页面 hide/show 播放中**：SDK 是否自行暂停、progress 是否继续、有没有 statuschange；
 * 4. **`removeLayer` / 丢弃**之后：是否隐式停止（事件是否还在来）。
 *
 * ## 正证控件
 *
 * `start` 之后 progress 必须前进（`control.progress.baseline.count >= 2`），否则本轮实验
 * **无法判定**（不是「命令无效」），退出码 1。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 正证控件成立，读数取到 | 0 |
 * | `fail` | 正证控件不成立（本轮无法判定） | 1 |
 * | `blocked` | SDK / 地图没起来 | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 语法错 / 页面没写报告 | 2 |
 *
 * ## 可见性模拟
 *
 * 优先 CDP `Emulation.setDocumentVisibility`（Chrome 支持时）；不支持则回退**页内**覆盖
 * `document.hidden` / `visibilityState` 并合成 `visibilitychange`。两种方式都记进
 * `vis.method` 读数。握手：页面写 `phase=vis-ready-hide` → 节点应用 → 写
 * `window.__TL_VIS_APPLIED__=true` → 页面进入隐藏窗口采样。
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-layer-detached.mts` 同一口径：不进 CI 必需链路。结论固化方式是写进 ADR、
 * `.agents/skills/bmap-jsapi-v4/references/runtime-extended-apis.md` 与组件文档。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:track-line
 *   BAIDU_MAP_AK=<ak> pnpm probe:track-line -- --out=/tmp/track-line.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, sleep, type CdpSession } from "./official-probe/cdp.mts";
import {
  controlFailures,
  verdicts,
  type ProbeReport,
} from "./probe-track-line-verdicts.mts";

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const outPath = argValue("out") ?? "";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * ⚠️ 本模板串里**不得出现反引号**（会截断外层 TS 模板串），由
 * `tests/behavior/probe-page-scripts.test.ts` 静态守卫。同理不要用 `${` 插值。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = { phase: "boot", sdk: null, readings: [], console: [], error: null, loadError: null };
  // 尽早挂到 window：可见性握手靠轮询 phase，只在末尾写会让宿主永远看不到中间阶段。
  window.__TRACK_LINE_PROBE__ = report;

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
  const typeOfMember = (obj, name) => {
    try { return { type: typeof obj[name] }; }
    catch (error) { return { type: "throw:" + String(error && error.message ? error.message : error) }; }
  };

  // ---- 事件采样（公开载荷形状 + 窗口计数） ----
  const samples = { status: [], progress: [] };
  const onStatus = (event) => {
    const value = event && event.value && typeof event.value === "object" ? event.value : {};
    samples.status.push({
      t: Date.now(),
      keys: Object.keys(value),
      status: value.status,
      statusName: value.statusName,
    });
  };
  const onProgress = (event) => {
    const value = event && event.value && typeof event.value === "object" ? event.value : {};
    samples.progress.push({
      t: Date.now(),
      keys: Object.keys(value),
      process: typeof value.process === "number" ? value.process : null,
      elapsed: typeof value.elapsed === "number" ? value.elapsed : null,
      distance: typeof value.distance === "number" ? value.distance : null,
      point: value.point,
      angle: value.angle,
      trace: value.trace,
    });
  };

  /** 窗口采样：从 fromIndex 起新增的 progress / status 计数与 process 首末值。 */
  const windowSnapshot = (fromIndex) => {
    const prog = samples.progress.slice(fromIndex);
    const st = samples.status.slice(fromIndex);
    const processes = prog.map((p) => p.process).filter((n) => typeof n === "number");
    return {
      progressCount: prog.length,
      statusCount: st.length,
      statusNames: st.map((s) => s.statusName).filter((n) => n !== undefined),
      statuses: st.map((s) => s.status).filter((n) => n !== undefined),
      firstProcess: processes.length > 0 ? processes[0] : null,
      lastProcess: processes.length > 0 ? processes[processes.length - 1] : null,
      lastStatusName: st.length > 0 ? st[st.length - 1].statusName : null,
      lastStatus: st.length > 0 ? st[st.length - 1].status : null,
    };
  };

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapTrackLineProbeReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapTrackLineProbeReady";
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

    // 等扩展实现异步注入（TrackLine 是 runtime-only）
    for (let i = 0; i < 150; i++) {
      if (typeof window.BMap.TrackLine === "function") break;
      await wait(200);
    }
    report.sdk = {
      version: String(window.BMap.version),
      trackLine: typeof window.BMap.TrackLine,
    };

    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:400px";
    document.body.appendChild(host);
    const map = new window.BMap.Map(host);
    map.centerAndZoom(new window.BMap.Point(116.404, 39.915), 13);
    await wait(600);

    /* ---- 组 1：七个方法的存在性 ---- */
    // typeof 探测必须在实例上做（方法可能挂在原型上）；TrackLine 构造器本身也记一笔。
    const probeCtor = typeof window.BMap.TrackLine === "function" ? new window.BMap.TrackLine({ autoStart: false }) : null;
    const faceTarget = probeCtor || window.BMap.TrackLine;
    push("method.setData.type", typeOfMember(faceTarget, "setData"));
    push("method.start.type", typeOfMember(faceTarget, "start"));
    push("method.pause.type", typeOfMember(faceTarget, "pause"));
    push("method.resume.type", typeOfMember(faceTarget, "resume"));
    push("method.stop.type", typeOfMember(faceTarget, "stop"));
    push("method.setSpeed.type", typeOfMember(faceTarget, "setSpeed"));
    push("method.setProcess.type", typeOfMember(faceTarget, "setProcess"));
    if (probeCtor) { try { probeCtor.stop(); } catch (e) { /* 探测实例丢弃 */ } }

    const track = new window.BMap.TrackLine({
      color: "#1677ff",
      width: 5,
      passedColor: "#999999",
      duration: 20,
      speedMode: 0,
      autoStart: false,
    });
    track.addEventListener("statuschange", onStatus);
    track.addEventListener("progress", onProgress);

    const feature = {
      type: "Feature",
      properties: { id: "route-1" },
      geometry: {
        type: "LineString",
        coordinates: [
          [116.392, 39.906], [116.4, 39.912], [116.41, 39.918], [116.418, 39.924],
          [116.426, 39.93], [116.434, 39.936], [116.442, 39.942],
        ],
      },
    };
    push("track.setData", attempt(() => track.setData(feature)));
    push("track.addLayer", attempt(() => map.addLayer(track)));
    // 官方口径：可视化实现异步注入，**首次收到 statuschange/progress 之后**再开播放控制才可靠。
    for (let i = 0; i < 100; i += 1) {
      if (samples.progress.length > 0 || samples.status.length > 0) break;
      await wait(100);
    }
    push("track.readyState", {
      threw: false,
      count: samples.progress.length,
      statusCount: samples.status.length,
    });

    /* ---- 组 2：事件载荷形状（第一次事件的 keys） ---- */
    const firstStatus = samples.status[0];
    const firstProgress = samples.progress[0];
    push("event.statuschange.keys", { keys: firstStatus ? firstStatus.keys : null });
    push("event.progress.keys", { keys: firstProgress ? firstProgress.keys : null });

    /* ---- 正证控件：start 之后 progress 前进 ---- */
    const baseIndex = samples.progress.length;
    push("control.start.attempt", attempt(() => track.start()));
    // 轮询而不是固定 sleep：可视化实现是异步注入的，固定 2.5s 有时只赶上 1 条 progress
    // （第二次 live 就是这样，正证控件假红）。等到 count>=2 或 8s 超时。
    for (let i = 0; i < 80; i += 1) {
      if (samples.progress.length - baseIndex >= 2) break;
      await wait(100);
    }
    const base = windowSnapshot(baseIndex);
    push("control.progress.baseline", {
      threw: false,
      count: base.progressCount,
      firstProcess: base.firstProcess,
      lastProcess: base.lastProcess,
      statusCount: base.statusCount,
      lastStatusName: base.lastStatusName,
    });

    /* ---- 组 1b / 2b：播放命令可观测效果 ---- */
    let idx = samples.progress.length;
    push("cmd.pause.attempt", attempt(() => track.pause()));
    await wait(600);
    let win = windowSnapshot(idx);
    push("cmd.pause.observed", {
      threw: false,
      count: win.progressCount,
      status: win.lastStatus,
      statusName: win.lastStatusName,
      process: win.lastProcess,
      statusCount: win.statusCount,
    });

    idx = samples.progress.length;
    push("cmd.resume.attempt", attempt(() => track.resume()));
    await wait(800);
    win = windowSnapshot(idx);
    push("cmd.resume.observed", {
      threw: false,
      count: win.progressCount,
      status: win.lastStatus,
      statusName: win.lastStatusName,
      process: win.lastProcess,
      statusCount: win.statusCount,
    });

    idx = samples.progress.length;
    push("cmd.stop.attempt", attempt(() => track.stop()));
    await wait(500);
    win = windowSnapshot(idx);
    push("cmd.stop.observed", {
      threw: false,
      count: win.progressCount,
      status: win.lastStatus,
      statusName: win.lastStatusName,
      process: win.lastProcess,
      statusCount: win.statusCount,
    });

    idx = samples.progress.length;
    push("cmd.setProcess.attempt", attempt(() => track.setProcess(0.5)));
    await wait(700);
    win = windowSnapshot(idx);
    push("cmd.setProcess.observed", {
      threw: false,
      count: win.progressCount,
      process: win.lastProcess,
      statusCount: win.statusCount,
      lastStatusName: win.lastStatusName,
    });

    idx = samples.progress.length;
    push("cmd.setSpeed.attempt", attempt(() => track.setSpeed(2)));
    await wait(700);
    win = windowSnapshot(idx);
    push("cmd.setSpeed.observed", {
      threw: false,
      count: win.progressCount,
      process: win.lastProcess,
      statusCount: win.statusCount,
    });

    /* ---- 组 3：页面可见性（与 CDP 握手） ---- */
    // 确保在播：从 process 0.3 附近推进，避免停在 stop 之后测不到 progress。
    attempt(() => track.setProcess(0.2));
    attempt(() => track.start());
    await wait(400);

    const visIdx = samples.progress.length;
    report.phase = "vis-ready-hide";
    window.__TL_VIS_APPLIED__ = false;
    for (let i = 0; i < 400 && !window.__TL_VIS_APPLIED__; i += 1) await wait(50);
    const hiddenApplied = !!window.__TL_VIS_APPLIED__;
    const hiddenMark = samples.progress.length;
    await wait(1500);
    const hiddenWin = windowSnapshot(hiddenMark);
    push("vis.hidden.observed", {
      threw: false,
      count: hiddenWin.progressCount,
      status: hiddenWin.lastStatus,
      statusName: hiddenWin.lastStatusName,
      firstProcess: hiddenWin.firstProcess,
      lastProcess: hiddenWin.lastProcess,
      statusCount: hiddenWin.statusCount,
      applied: hiddenApplied,
      from: visIdx,
    });

    report.phase = "vis-ready-show";
    window.__TL_VIS_APPLIED__ = false;
    for (let i = 0; i < 400 && !window.__TL_VIS_APPLIED__; i += 1) await wait(50);
    const showApplied = !!window.__TL_VIS_APPLIED__;
    const shownMark = samples.progress.length;
    await wait(1500);
    const shownWin = windowSnapshot(shownMark);
    push("vis.shown.observed", {
      threw: false,
      count: shownWin.progressCount,
      status: shownWin.lastStatus,
      statusName: shownWin.lastStatusName,
      firstProcess: shownWin.firstProcess,
      lastProcess: shownWin.lastProcess,
      statusCount: shownWin.statusCount,
      applied: showApplied,
    });

    /* ---- 组 4：removeLayer 之后是否隐式停止 ---- */
    // 先保证在播，再摘除（不先显式 stop —— 要测的就是「摘除自己停不停」）。
    attempt(() => track.setProcess(0.4));
    attempt(() => track.start());
    await wait(300);
    const rmMark = samples.progress.length;
    push("rm.remove.attempt", attempt(() => map.removeLayer(track)));
    await wait(1500);
    const rmWin = windowSnapshot(rmMark);
    push("rm.after.observed", {
      threw: false,
      count: rmWin.progressCount,
      status: rmWin.lastStatus,
      statusName: rmWin.lastStatusName,
      process: rmWin.lastProcess,
      statusCount: rmWin.statusCount,
    });

    // 事件载荷 keys 若首次没拿到，用累计样本再补一次（不覆盖已有读数）。
    if (!firstStatus && samples.status.length > 0) {
      push("event.statuschange.keys", { keys: samples.status[0].keys });
    }
    if (!firstProgress && samples.progress.length > 0) {
      push("event.progress.keys", { keys: samples.progress[0].keys });
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__TRACK_LINE_PROBE__ = report;
})();
`;

function redact(text: string): string {
  const trimmed = ak.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

/* ------------------------------------------------------------------ CDP 握手 */

/** 页内回退：覆盖 document.hidden / visibilityState 并合成 visibilitychange。 */
const SYNTHETIC_HIDE = `
(() => {
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: function () { return true; } });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "hidden"; } });
    document.dispatchEvent(new Event("visibilitychange"));
    return { ok: true, via: "synthetic" };
  } catch (error) {
    return { ok: false, via: "synthetic", error: String(error) };
  }
})()
`;

const SYNTHETIC_SHOW = `
(() => {
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "visible"; } });
    document.dispatchEvent(new Event("visibilitychange"));
    return { ok: true, via: "synthetic" };
  } catch (error) {
    return { ok: false, via: "synthetic", error: String(error) };
  }
})()
`;

async function evalJson(session: CdpSession, expression: string): Promise<unknown> {
  const message = await session.send("Runtime.evaluate", { expression, returnByValue: true });
  return message.result?.result?.value;
}

async function applyVisibility(
  session: CdpSession,
  visible: boolean,
): Promise<{ method: string; ok: boolean; detail?: string }> {
  // 优先 CDP
  try {
    const result = await session.send("Emulation.setDocumentVisibility", { visible });
    if (!result.error) {
      return { method: "cdp", ok: true };
    }
  } catch {
    /* 回退页内 */
  }
  const fallbackRaw = await evalJson(session, visible ? SYNTHETIC_SHOW : SYNTHETIC_HIDE);
  try {
    const parsed = (
      typeof fallbackRaw === "string" ? JSON.parse(fallbackRaw) : fallbackRaw
    ) as { ok?: boolean; via?: string; error?: string };
    return { method: parsed.via ?? "synthetic", ok: parsed.ok === true, detail: parsed.error };
  } catch {
    return {
      method: "synthetic",
      ok: false,
      detail: String(fallbackRaw).slice(0, 120),
    };
  }
}

/**
 * 可见性握手：等页面进 `vis-ready-*`，应用一次可见性，写 `__TL_VIS_APPLIED__`。
 * 两段（hide / show）各做一次；超时返回 false（调用方按第三态处理）。
 */
async function handshakeVisibility(session: CdpSession, phase: "hide" | "show"): Promise<string> {
  const deadline = Date.now() + 60_000;
  const readyName = phase === "hide" ? "vis-ready-hide" : "vis-ready-show";
  for (;;) {
    const raw = await evalJson(
      session,
      "window.__TRACK_LINE_PROBE__ ? JSON.stringify(window.__TRACK_LINE_PROBE__.phase) : null",
    );
    // raw 是 JSON.stringify(phase) 的结果（字符串值带引号），或 null。
    if (typeof raw === "string" && raw !== "null" && JSON.parse(raw) === readyName) break;
    // 页面可能已经 error / done：别死等。
    if (typeof raw === "string" && raw !== "null") {
      const current = JSON.parse(raw) as string;
      if (current === "error" || current === "done") return `aborted:${current}`;
    }
    if (Date.now() > deadline) return "timeout-waiting-ready";
    await sleep(100);
  }
  const applied = await applyVisibility(session, phase === "show");
  await evalJson(session, "window.__TL_VIS_APPLIED__ = true");
  return applied.method + (applied.ok ? "" : ":failed");
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:track-line`");
    return 2;
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`);
    return 2;
  }

  const pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak));
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>track line probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "track-line-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[track-line] 服务未就绪（脚手架失败）");
    return 2;
  }
  const baseUrl = `http://localhost:${address.port}/`;

  let chrome: ChildProcess | null = null;
  let session: CdpSession | null = null;
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
      deadline: Date.now() + 180_000,
      commandTimeoutMs: 30_000,
    });

    // 可见性握手（hide → show），然后等最终报告
    const hideMethod = await handshakeVisibility(session, "hide");
    const showMethod = await handshakeVisibility(session, "show");

    const report = await (async () => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const raw = await evalJson(
          session!,
          "window.__TRACK_LINE_PROBE__ ? JSON.stringify(window.__TRACK_LINE_PROBE__) : null",
        );
        if (typeof raw === "string" && raw !== "null") {
          const parsed = JSON.parse(raw) as ProbeReport;
          if (parsed.phase === "done" || parsed.phase === "error") return parsed;
        }
        if (Date.now() > deadline) return null;
        await sleep(400);
      }
    })();
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__TRACK_LINE_PROBE__");
      return 2;
    }

    // 把握手结果写进读数（页面不知道用了哪条通道）
    const visMethodReading = report.readings.find((r) => r.id === "vis.method");
    const methodText = hideMethod.startsWith("cdp") ? "cdp" : hideMethod.split(":")[0] || "unknown";
    if (!visMethodReading) {
      report.readings.push({ id: "vis.method", method: methodText });
    }

    console.log("== TrackLine 播放控制运行时探针 ==")
    console.log(`SDK：${JSON.stringify(report.sdk)}  页面阶段：${report.phase}`)
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`)
    for (const reading of report.readings) {
      console.log(`  ${reading.id.padEnd(34)} ${JSON.stringify(reading)}`)
    }
    if (report.console.length > 0) {
      console.log(`-- 页面 console（${report.console.length} 条）--`)
      for (const entry of report.console.slice(0, 12)) {
        console.log(`  [${entry.level}] ${redact(entry.text)}`)
      }
    }

    const failures = controlFailures(report);
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --")
      for (const failure of failures) console.error(`  ${failure}`)
      console.error("（上面这些读数按「无法判定」对待：控件不成立时它们无意义）")
      if (outPath) writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      return 1;
    }
    if (report.phase === "error" || report.phase !== "done") return 3;

    console.log("-- 结论 --")
    const lines = verdicts(report)
    for (const line of lines) console.log(`  ${line}`)

    if (outPath) {
      writeFileSync(outPath, redact(JSON.stringify(report, null, 2)))
      console.log(`原始报告（已脱敏）写入 ${outPath}`)
    }
    console.log(`summary: ${redact(lines.join(" | "))}`)
    console.log(`vis handshake: hide=${hideMethod} show=${showMethod}`)
    return 0
  } finally {
    session?.close()
    chrome?.kill()
    server.close()
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[track-line] 脚手架失败：${redact(String(error))}`)
  return 2
})
