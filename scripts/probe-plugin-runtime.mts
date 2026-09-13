#!/usr/bin/env node
/**
 * 插件运行时探针（M3A3-07 / issue #25）
 *
 * `scripts/probe-plugin-compat.mts` 只能给「产物面 + 声明面」的结论。本脚本补**运行时面**：
 * 在真实 JSAPI 4.0 页面上（真实 AK、真实浏览器、真实 CDN）逐个加载四个内置插件脚本，记录
 *
 * - 脚本是否加载成功、应暴露的全局是否出现；
 * - 最小可用路径是否成立（构造 + 一次真实调用），失败时记下错误文本；
 * - 副作用：例如 DrawingManager 会不会**自己**注入额外脚本；
 * - 以及本页能顺带证实的环境事实（`BMap.version`、`BMapGL === BMap`、私有回调表是否存在）。
 *
 * ## 每个插件一个**独立页面**（评审 #85 P2-2）
 *
 * 第一版把四个插件跑在同一个页面里，顺序是 `TrackAnimation → DrawingManager → GeoUtils → Mapvgl`。
 * 这会让 GeoUtils 的证据不独立：DrawingManager 打开 `enableCalculate` / `enableGpc` 时会**自己**
 * 注入 `GeoUtils.min.js` 与 `gpc.js`，随后 GeoUtils 那一步直接从 `BMapGLLib.GeoUtils` 取全局，
 * 于是无法区分「我们的 `BUILTIN_PLUGIN_URLS.geoUtils` 那支脚本生效了」与「捡了 DrawingManager 的副作用」。
 *
 * 现在每个插件导航到一个**全新文档**（`?only=<id>`）再跑，并额外记录 `globalExistedBeforeLoad`：
 * 它必须为 `false`，即「加载我们这支脚本之前，那个全局并不存在」——这就是证据独立性的**前置断言**。
 * 顺带也消掉了「四个第三方脚本同页互相影响」这类隐患。
 *
 * ## 为什么需要 AK
 *
 * 页面必须真的把 JSAPI 4.0 拉起来才能谈插件行为。AK 从 `BAIDU_MAP_AK` 读，**不落库**；
 * 仓库里 `docs/.vitepress/theme/index.ts` 有一支已入库的浏览器端 AK，本地冒烟可以用它。
 *
 * ## 与「插件页」的区别（ADR 2026-09-13-plugin-compat-inventory 决策 8）
 *
 * 本脚本是**证据生成器**，不是 smoke harness 的插件页：它不登记进 `tests/browser/jsapi-v4` 的
 * 检查表、不进任何 CI job、不参与必需链路的放行判定。把插件脚本塞进必需页面会让跨域脚本异常直接
 * 染红必需链路——那正是决策 8 要避免的。把结论搬进 nightly / CI 属 #43。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 每个插件的脚本加载 + 全局暴露 + 最小路径都没抛错，且独立性断言成立 | 0 |
 * | `fail` | 有插件在运行时抛错（记下错误文本），或独立性断言被打破 | 1 |
 * | `blocked` | SDK 没起来 / 脚本取不到（AK、网络、浏览器不成立）⇒ 本轮无法判定 | 3 |
 * | 脚手架失败 | 读不到数据模块 / 找不到浏览器 / 页面没写报告 | 2 |
 *
 * 输出里的 `ak=` 与 `BAIDU_MAP_AK` 一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime -- --out=/tmp/plugin-runtime.json
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts"
import { freshModuleUrl } from "./fresh-module-url.mts"

const repoRoot = resolve(import.meta.dirname, "..")
const ak = process.env.BAIDU_MAP_AK ?? ""
if (!ak) {
  console.error("缺 BAIDU_MAP_AK")
  process.exitCode = 2
}

const builtins = (await import(freshModuleUrl(resolve(repoRoot, "packages/baidu-map-gl-vue/src/plugins/builtins.ts")))) as {
  BUILTIN_PLUGIN_URLS: Record<string, string>
}
const urls = builtins.BUILTIN_PLUGIN_URLS

/** 插件 → （`BUILTIN_PLUGIN_URLS` 的键, 应暴露的全局路径）。 */
const PLUGIN_SPECS = [
  { id: "TrackAnimation", key: "trackAnimation", global: "BMapGLLib.TrackAnimation" },
  { id: "GeoUtils", key: "geoUtils", global: "BMapGLLib.GeoUtils" },
  { id: "DrawingManager", key: "drawingManager", global: "BMapGLLib.DrawingManager" },
  { id: "Mapvgl", key: "mapvgl", global: "mapvgl" },
] as const

/* ------------------------------------------------------------------ 页面 */

const PAGE_JS = `
(function () {
  var SPECS = __SPECS__;
  var URLS = __URLS__;
  var AK = __AK__;
  var only = new URLSearchParams(location.search).get("only");
  var spec = null;
  for (var i = 0; i < SPECS.length; i++) if (SPECS[i].id === only) spec = SPECS[i];
  var out = (window.__PLUGIN_PROBE__ = { only: only, env: {}, result: null, steps: [], done: false });
  function step(name, detail) { out.steps.push({ name: name, detail: detail || null }); }
  function loadScript(url) {
    return new Promise(function (res) {
      var s = document.createElement("script");
      s.async = false;
      s.src = url;
      s.onload = function () { res({ ok: true }); };
      s.onerror = function () { res({ ok: false, error: "script error event" }); };
      document.head.appendChild(s);
    });
  }
  function getPath(path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, window);
  }
  function msg(e) { return String((e && e.message) || e); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  (async function () {
    if (!spec) { out.fatal = "unknown only=" + only; out.done = true; return; }

    var cb = "__probeSdkCb_" + Date.now();
    window[cb] = function () { window.__probeSdkReady = true; };
    var sdk = document.createElement("script");
    sdk.src = "https://api.map.baidu.com/api?v=4.0&ak=" + AK + "&callback=" + cb;
    document.head.appendChild(sdk);
    var t0 = Date.now();
    while (!(window.BMap && typeof window.BMap.Map === "function") && Date.now() - t0 < 25000) await sleep(100);
    out.env.sdkLoaded = !!(window.BMap && typeof window.BMap.Map === "function");
    out.env.aliasIsSameObject = window.BMapGL === window.BMap;
    out.env.bmapVersion = window.BMap ? String(window.BMap.version) : null;
    out.env.namespaceKeys = window.BMap ? Object.keys(window.BMap).length : 0;
    out.env.namespaceHasPrivateCallbackTable = !!(window.BMap && (window.BMap._rd || window.BMapGL._rd));
    if (!out.env.sdkLoaded) { out.done = true; return; }

    var div = document.createElement("div");
    div.style.cssText = "width:420px;height:320px";
    document.body.appendChild(div);
    var map = null, polyline = null;
    try {
      map = new window.BMap.Map(div);
      map.centerAndZoom(new window.BMap.Point(116.404, 39.915), 13);
      polyline = new window.BMap.Polyline(
        [new window.BMap.Point(116.4, 39.91), new window.BMap.Point(116.42, 39.93)],
        { strokeColor: "#00f", strokeWeight: 4 },
      );
      map.addOverlay(polyline);
      out.env.mapCreated = true;
      out.env.overlaysAfterAdd = map.getOverlays().length;
    } catch (e) {
      out.env.mapCreated = false;
      out.env.mapError = msg(e);
    }

    // 独立性前置断言：加载**我们这支**脚本之前，那个全局必须还不存在。
    out.env.globalExistedBeforeLoad = !!getPath(spec.global);
    step("precondition", { global: spec.global, existedBefore: out.env.globalExistedBeforeLoad });

    var r = { id: spec.id, url: URLS[spec.key], urlLoaded: null, globalExposed: null, probe: null };
    var load = await loadScript(URLS[spec.key]);
    r.urlLoaded = load.ok ? "ok" : (load.error || "error");
    r.globalExposed = !!getPath(spec.global);

    var probes = {
      TrackAnimation: async function () {
        var C = getPath("BMapGLLib.TrackAnimation");
        if (typeof C !== "function") return "no-ctor";
        var before = polyline.getPath().length;
        var ta = new C(map, polyline, { duration: 1500, overallView: false });
        ta.start();
        await sleep(400);
        var midPath = polyline.getPath().length;
        var zoom = map.getZoom();
        ta.cancel();
        return { statusAfter400ms: ta._status, pathBefore: before, pathAfterStart: midPath, zoomDuringAnim: zoom };
      },
      DrawingManager: async function () {
        var C = getPath("BMapGLLib.DrawingManager");
        if (typeof C !== "function") return "no-ctor";
        var dm = new C(map, { isOpen: false, enableCalculate: true, enableGpc: true });
        var mode = typeof dm.getDrawingMode === "function" ? dm.getDrawingMode() : null;
        if (typeof dm.enableCalculate === "function") dm.enableCalculate();
        if (typeof dm.enableGpc === "function") dm.enableGpc();
        await sleep(1200);
        var injected = [];
        var scripts = document.scripts;
        for (var i = 0; i < scripts.length; i++) {
          var src = String(scripts[i].src || "");
          if (src.indexOf("GeoUtils") >= 0 || src.indexOf("gpc.js") >= 0) injected.push(src);
        }
        if (typeof dm.close === "function") dm.close();
        if (typeof dm.dispose === "function") { try { dm.dispose(); } catch (e) {} }
        return { drawingMode: mode, selfInjectedScripts: injected };
      },
      GeoUtils: function () {
        var G = getPath("BMapGLLib.GeoUtils");
        if (!G) return "no-global";
        var P = window.BMap.Point;
        return {
          members: Object.keys(G).length,
          isPointInRect: typeof G.isPointInRect === "function"
            ? G.isPointInRect(new P(1, 1), new P(0, 0), new P(2, 2))
            : null,
          getDistance: typeof G.getDistance === "function" ? G.getDistance(new P(0, 0), new P(0, 1)) : null,
        };
      },
      Mapvgl: function () {
        if (!window.mapvgl) return "no-global";
        var View = window.mapvgl.View;
        if (typeof View !== "function") return { viewType: typeof View, keys: Object.keys(window.mapvgl).length };
        var layerNames = Object.keys(window.mapvgl).filter(function (k) { return /Layer$/.test(k); });
        var v = new View({ map: map, mapType: "bmap" });
        var created = !!v;
        var LayerCtor = window.mapvgl.PointLayer || window.mapvgl.LineLayer || window.mapvgl.FillLayer;
        var layerOk = null, layerErr = null;
        if (typeof LayerCtor === "function") {
          try {
            var layer = new LayerCtor({ data: [{ geometry: { type: "Point", coordinates: [116.404, 39.915] } }], size: 6, color: "#f00" });
            v.addLayer(layer);
            layerOk = true;
            v.removeLayer(layer);
            if (typeof layer.destroy === "function") layer.destroy();
          } catch (e) { layerErr = msg(e); }
        }
        try { if (typeof v.destroy === "function") v.destroy(); } catch (e) {}
        return { viewCreated: created, layerAdded: layerOk, layerError: layerErr, layerCtors: layerNames.slice(0, 8) };
      },
    };

    if (r.globalExposed) {
      try { r.probe = await probes[spec.id](); } catch (e) { r.probe = "THREW: " + msg(e); }
    } else {
      r.probe = "skipped: global missing";
    }
    out.result = r;
    step("plugin", r);
    out.done = true;
  })().catch(function (e) {
    out.fatal = String((e && e.stack) || e);
    out.done = true;
  });
})();
`

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>plugin runtime probe</title></head>
<body><script>${PAGE_JS.replace("__SPECS__", JSON.stringify(PLUGIN_SPECS))
  .replace("__URLS__", JSON.stringify(urls))
  .replace("__AK__", JSON.stringify(ak))}</script></body></html>`

/* ------------------------------------------------------------------ 服务与浏览器 */

const workDir = mkdtempSync(join(tmpdir(), "plugin-probe-"))
const userDataDir = mkdtempSync(join(tmpdir(), "plugin-probe-chrome-"))
writeFileSync(join(workDir, "index.html"), pageHtml)

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(pageHtml)
})
await new Promise<void>((done) => server.listen(0, "localhost", () => done()))
const address = server.address()
if (address === null || typeof address === "string") {
  console.error("服务未就绪")
  process.exitCode = 2
}
const port = typeof address === "object" && address ? address.port : 0
const baseUrl = `http://localhost:${port}/`

const browser = process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if (!existsSync(browser)) {
  console.error(`浏览器不存在：${browser}`)
  process.exitCode = 2
}

interface RunReport {
  only: string | null
  env: Record<string, unknown>
  result: { id: string; urlLoaded?: string; globalExposed?: boolean; probe?: unknown } | null
  steps: Array<{ name: string; detail: unknown }>
  done: boolean
  fatal?: string
}

let chrome: ChildProcess | null = null
let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null
const runs: RunReport[] = []
try {
  chrome = spawn(browser, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    baseUrl,
  ], { stdio: "ignore" })

  const portFile = join(userDataDir, "DevToolsActivePort")
  const startedAt = Date.now()
  let devtoolsPort = 0
  for (;;) {
    if (existsSync(portFile)) {
      devtoolsPort = Number(readFileSync(portFile, "utf8").split("\n")[0])
      if (devtoolsPort) break
    }
    if (Date.now() - startedAt > 30_000) throw new Error("等待 DevToolsActivePort 超时")
    await sleep(200)
  }

  let target: { webSocketDebuggerUrl?: string } | undefined
  const t1 = Date.now()
  for (;;) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>
      target = list.find((t) => t.type === "page" && t.url.startsWith(baseUrl))
      if (target?.webSocketDebuggerUrl) break
    } catch { /* CDP 还没起来 */ }
    if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时")
    await sleep(300)
  }

  const deadline = Date.now() + 240_000
  session = await connectCdpSession(target!.webSocketDebuggerUrl!, { deadline, commandTimeoutMs: 30_000 })

  // 每个插件一个**全新文档**（`?only=<id>`），并且只认「那个 id 写完了」为本轮结束 —— 这样既消除
  // 插件之间的副作用串扰，也不会误读上一轮遗留的报告。
  for (const spec of PLUGIN_SPECS) {
    await session.send("Page.navigate", { url: `${baseUrl}?only=${spec.id}` })
    const report = await readProbeReport<RunReport>(session, {
      deadline,
      pollIntervalMs: 1000,
      expression:
        "(window.__PLUGIN_PROBE__ && window.__PLUGIN_PROBE__.done && window.__PLUGIN_PROBE__.only === " +
        JSON.stringify(spec.id) +
        ") ? JSON.stringify(window.__PLUGIN_PROBE__) : null",
    })
    if (!report) throw new Error(`插件 ${spec.id} 没有写出报告`)
    runs.push(report)
  }
} finally {
  try { session?.close() } catch { /* ignore */ }
  try { chrome?.kill("SIGKILL") } catch { /* ignore */ }
  server.close()
  try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ 报告 */

function redact(text: string): string {
  return text
    .replace(/([?&]ak=)[^&"'\s]+/g, "$1<redacted>")
    .replaceAll(ak, "<redacted>")
}

const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)

if (runs.length !== PLUGIN_SPECS.length) {
  console.error("[plugin-runtime] 页面没有写全报告（脚手架失败）")
  process.exitCode = 2
} else {
  const payload = JSON.stringify({ runs }, null, 2)
  console.log(redact(payload))
  if (outPath) {
    writeFileSync(outPath, redact(payload) + "\n")
    console.log(`\n[plugin-runtime] wrote ${outPath}`)
  }

  const env = runs[0]?.env ?? {}
  const results = runs
    .map((run) => run.result)
    .filter((r): r is NonNullable<RunReport["result"]> => r !== null)
  const notIndependent = runs
    .filter((run) => run.env.globalExistedBeforeLoad === true)
    .map((run) => run.only)
  const notLoaded = results.filter((r) => r.urlLoaded !== "ok")
  const notExposed = results.filter((r) => !r.globalExposed)
  const threw = results.filter(
    (r) => typeof r.probe === "string" && String(r.probe).startsWith("THREW"),
  )

  console.log(
    `\n[plugin-runtime] sdk=${env.sdkLoaded === true ? "ok" : "failed"} plugins=${results.length} ` +
      `notIndependent=${notIndependent.length} scriptFailed=${notLoaded.length} ` +
      `globalMissing=${notExposed.length} threw=${threw.length}`,
  )

  if (env.sdkLoaded !== true) {
    console.error("[plugin-runtime] SDK 没起来，本轮无法判定（blocked 不是通过）")
    process.exitCode = 3
  } else if (notIndependent.length > 0) {
    // 独立性断言失败：全局在加载我们这支脚本之前就存在 ⇒ 本轮的读数不能归因给我们那个 URL
    console.error(`[plugin-runtime] 证据不独立（全局先于脚本存在）：${notIndependent.join(", ")}`)
    process.exitCode = 1
  } else if (notLoaded.length > 0 || notExposed.length > 0) {
    console.error(
      `[plugin-runtime] blocked: ${[...notLoaded, ...notExposed].map((r) => r.id).join(", ")}`,
    )
    process.exitCode = 3
  } else if (threw.length > 0) {
    console.error(`[plugin-runtime] 运行时抛错：${threw.map((r) => r.id).join(", ")}`)
    process.exitCode = 1
  } else {
    process.exitCode = 0
  }
}
