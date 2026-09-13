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
 * ## 为什么需要 AK
 *
 * 页面必须真的把 JSAPI 4.0 拉起来才能谈插件行为。AK 从 `BAIDU_MAP_AK` 读，**不落库**；
 * 仓库里 `docs/.vitepress/theme/index.ts` 有一支已入库的浏览器端 AK，本地冒烟可以用它
 * （`BAIDU_MAP_AK=$(grep -oE 'ak: "[A-Za-z0-9]{16,}"' docs/.vitepress/theme/index.ts | head -1 | sed -E 's/ak: "//; s/"//')`）。
 *
 * ## 与「插件页」的区别（ADR 2026-09-13-plugin-compat-inventory 决策 8）
 *
 * 本脚本是**证据生成器**，不是 smoke harness 的插件页：它不登记进
 * `tests/browser/jsapi-v4` 的检查表、不进任何 CI job、不参与必需链路的放行判定。
 * 把插件脚本塞进必需页面会让跨域脚本异常直接染红必需链路——那正是决策 8 要避免的。
 * 把结论搬进 nightly / CI 属 #43。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 每个插件的脚本加载 + 全局暴露 + 最小路径都没抛错 | 0 |
 * | `fail` | 有插件在运行时抛错（记下错误文本） | 1 |
 * | `blocked` | SDK 没起来（AK / 网络 / 浏览器不成立）⇒ 本轮无法判定 | 3 |
 * | 脚手架失败 | 读不到数据模块 / 找不到浏览器 / 页面没写报告 | 2 |
 *
 * 输出里的 `ak=` 与 `BAIDU_MAP_AK` 一律脱敏（页面记录的是插件 URL，本来不含 AK；这里仍做兜底）。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime
 *   BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime -- --out=/tmp/plugin-runtime.json
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

/* ------------------------------------------------------------------ 页面 */

const PAGE_JS = `
(function () {
  var URLS = __URLS__;
  var AK = __AK__;
  var out = (window.__PLUGIN_PROBE__ = { env: {}, results: {}, steps: [], done: false });
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
    // 1) 真实 SDK（走官方入口 URL，与官方 loader 注入的形状一致）
    var cb = "__probeSdkCb_" + Date.now();
    window[cb] = function () { window.__probeSdkReady = true; };
    var sdk = document.createElement("script");
    sdk.src = "https://api.map.baidu.com/api?v=4.0&ak=" + AK + "&callback=" + cb;
    document.head.appendChild(sdk);
    var t0 = Date.now();
    while (
      !(window.BMap && typeof window.BMap.Map === "function") &&
      Date.now() - t0 < 25000
    ) await sleep(100);
    out.env.sdkLoaded = !!(window.BMap && typeof window.BMap.Map === "function");
    out.env.namespaceKeysRightAfterBMap = window.BMap ? Object.keys(window.BMap).length : 0;
    out.env.aliasIsSameObject = window.BMapGL === window.BMap;
    out.env.bmapVersion = window.BMap ? String(window.BMap.version) : null;
    out.env.namespaceHasPrivateCallbackTable = !!(window.BMap && (window.BMap._rd || window.BMapGL._rd));
    if (!out.env.sdkLoaded) { out.done = true; return; }
    step("sdk", { version: out.env.bmapVersion, alias: out.env.aliasIsSameObject, hasRd: out.env.namespaceHasPrivateCallbackTable });

    // 2) 真实地图 + 折线（TrackAnimation 需要）
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
    step("map", { created: out.env.mapCreated, error: out.env.mapError || null });

    // 3) 逐个插件：加载 → 暴露 → 最小使用
    // 注意：BUILTIN_PLUGIN_URLS 的键是小驼峰（trackAnimation / mapvgl...），别拿 id 去取，
    // 否则 s.src = undefined ⇒ 请求打到同源 /undefined ⇒ 404 ⇒ 四个插件全部 "script error event"
    var order = [
      { id: "TrackAnimation", key: "trackAnimation", global: "BMapGLLib.TrackAnimation" },
      { id: "DrawingManager", key: "drawingManager", global: "BMapGLLib.DrawingManager" },
      { id: "GeoUtils", key: "geoUtils", global: "BMapGLLib.GeoUtils" },
      { id: "Mapvgl", key: "mapvgl", global: "mapvgl" },
    ];
    var probes = {
      TrackAnimation: async function () {
        var C = getPath("BMapGLLib.TrackAnimation");
        if (typeof C !== "function") return "no-ctor";
        var before = polyline.getPath().length;
        var ta = new C(map, polyline, { duration: 1500, overallView: false });
        ta.start();
        await sleep(400);
        var midPath = polyline.getPath().length;
        var zooms = map.getZoom();
        ta.cancel();
        return { statusAfter400ms: ta._status, pathBefore: before, pathAfterStart: midPath, zoomDuringAnim: zooms };
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

    for (var k = 0; k < order.length; k++) {
      var spec = order[k];
      var id = spec.id;
      var r = { id: id, url: URLS[spec.key], urlLoaded: null, globalExposed: null, probe: null };
      var load = await loadScript(URLS[spec.key]);
      r.urlLoaded = load.ok ? "ok" : (load.error || "error");
      r.globalExposed = !!getPath(spec.global);
      if (r.globalExposed) {
        try { r.probe = await probes[id](); } catch (e) { r.probe = "THREW: " + msg(e); }
      } else {
        r.probe = "skipped: global missing";
      }
      out.results[id] = r;
      step("plugin", r);
    }

    out.env.thirdPartyScriptsOnPage = (function () {
      var n = 0, scripts = document.scripts;
      for (var i = 0; i < scripts.length; i++) {
        var src = String(scripts[i].src || "");
        if (src.indexOf("BMapGLLib") >= 0 || src.indexOf("unpkg") >= 0) n++;
      }
      return n;
    })();
    out.done = true;
  })().catch(function (e) {
    out.fatal = String((e && e.stack) || e);
    out.done = true;
  });
})();
`

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>plugin runtime probe</title></head>
<body><script>${PAGE_JS.replace("__URLS__", JSON.stringify(urls)).replace("__AK__", JSON.stringify(ak))}</script></body></html>`

/* ------------------------------------------------------------------ 服务与浏览器 */

const workDir = mkdtempSync(join(tmpdir(), "plugin-probe-"))
const userDataDir = mkdtempSync(join(tmpdir(), "plugin-probe-chrome-"))
writeFileSync(join(workDir, "index.html"), pageHtml)
writeFileSync(join(workDir, "probe.js"), "")

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0]
  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(pageHtml)
    return
  }
  res.writeHead(404).end("not found")
})
await new Promise<void>((done) => server.listen(0, "localhost", () => done()))
const address = server.address()
if (address === null || typeof address === "string") {
  console.error("服务未就绪")
  process.exitCode = 2
}
const port = typeof address === "object" && address ? address.port : 0
const url = `http://localhost:${port}/`

const browser = process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if (!existsSync(browser)) {
  console.error(`浏览器不存在：${browser}`)
  process.exitCode = 2
}

let chrome: ChildProcess | null = null
let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null
let report: Record<string, unknown> | null = null
try {
  // 沙箱给 Node 设了 HTTP(S)_PROXY，但 Chrome 不读 env 代理 ⇒ 必须显式传，否则第三方 CDN 脚本
  // 一律 "script error event"（而 api.map.baidu.com 是直连可达的，所以 live smoke 不需要它）。
  // 实测：这些 CDN 与本机**直连可达**（不经代理），所以默认不给 Chrome 传代理；
  // 需要时用 SMOKE_PROXY=1 显式打开（Chrome 不读 env 代理，必须用 --proxy-server）。
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  const proxyArgs = process.env.SMOKE_PROXY === "1" && proxy
    ? [`--proxy-server=${proxy}`, "--proxy-bypass-list=localhost;127.0.0.1"]
    : []
  console.log(`[plugin-runtime] proxy=${proxy ? "explicit" : "none"}`)

  chrome = spawn(browser, [
    "--headless", ...proxyArgs,
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    url,
  ], { stdio: "ignore" })

  const portFile = join(userDataDir, "DevToolsActivePort")
  const startedAt = Date.now()
  let devtoolsPort = 0
  for (;;) {
    if (existsSync(portFile)) {
      devtoolsPort = Number((await import("node:fs")).readFileSync(portFile, "utf8").split("\n")[0])
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
      target = list.find((t) => t.type === "page" && t.url.startsWith(`http://localhost:${port}`))
      if (target?.webSocketDebuggerUrl) break
    } catch { /* CDP 还没起来 */ }
    if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时")
    await sleep(300)
  }

  const deadline = Date.now() + 120_000
  session = await connectCdpSession(target!.webSocketDebuggerUrl!, { deadline, commandTimeoutMs: 30_000 })
  report = await readProbeReport<Record<string, unknown>>(session, {
    deadline,
    // 必须等到 `done === true`：只要对象存在就返回，会拿到「刚建好、还没跑任何一步」的空壳
    expression:
      "(window.__PLUGIN_PROBE__ && window.__PLUGIN_PROBE__.done) ? JSON.stringify(window.__PLUGIN_PROBE__) : null",
    pollIntervalMs: 1000,
  })
} finally {
  try { session?.close() } catch { /* ignore */ }
  try { chrome?.kill("SIGKILL") } catch { /* ignore */ }
  server.close()
  try { rmSync(workDir, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

function redact(text: string): string {
  return text
    .replace(/([?&]ak=)[^&"'\s]+/g, "$1<redacted>")
    .replaceAll(ak, "<redacted>")
}

const outPath = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length)

if (!report) {
  console.error("[plugin-runtime] 页面没有写出报告（脚手架失败）")
  process.exitCode = 2
} else {
  const payload = JSON.stringify(report, null, 2)
  console.log(redact(payload))
  if (outPath) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(outPath, redact(payload) + "\n")
    console.log(`\n[plugin-runtime] wrote ${outPath}`)
  }
  const env = (report.env ?? {}) as Record<string, unknown>
  const results = (report.results ?? {}) as Record<
    string,
    { urlLoaded?: string; globalExposed?: boolean; probe?: unknown }
  >
  const ids = Object.keys(results)
  const notLoaded = ids.filter((id) => results[id]?.urlLoaded !== "ok")
  const notExposed = ids.filter((id) => !results[id]?.globalExposed)
  const threw = ids.filter(
    (id) => typeof results[id]?.probe === "string" && String(results[id]!.probe).startsWith("THREW"),
  )
  console.log(
    `\n[plugin-runtime] sdk=${env.sdkLoaded === true ? "ok" : "failed"} plugins=${ids.length} ` +
      `scriptFailed=${notLoaded.length} globalMissing=${notExposed.length} threw=${threw.length}`,
  )
  if (env.sdkLoaded !== true) {
    console.error("[plugin-runtime] SDK 没起来，本轮无法判定（blocked 不是通过）")
    process.exitCode = 3
  } else if (notLoaded.length > 0 || notExposed.length > 0) {
    // 脚本加载失败 / 全局缺失：CDN 或网络问题，本轮拿不到结论
    console.error(`[plugin-runtime] blocked: ${[...notLoaded, ...notExposed].join(", ")}`)
    process.exitCode = 3
  } else if (threw.length > 0) {
    console.error(`[plugin-runtime] 运行时抛错：${threw.join(", ")}`)
    process.exitCode = 1
  } else {
    process.exitCode = 0
  }
}
