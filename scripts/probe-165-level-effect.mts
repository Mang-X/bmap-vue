#!/usr/bin/env node
/**
 * Does `GeoJSONLayer.setLevel` observably do anything?
 *
 * Screenshot diffing turns out to be a poor instrument here (the polygons are small
 * and the basemap repaints underneath them), so this probe reads the thing the
 * official reference says setLevel drives: per-overlay `setZIndex`.
 * "可观测地生效" then means: the zIndex the layer reports actually changed.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, sleep } from "./official-probe/cdp.mts";

const AK = (process.env.BAIDU_MAP_AK ?? "").trim();

const PAGE = `
(async () => {
  var report = { phase: "running" };
  try {
  await new Promise(function (resolve) {
    var n = "__p_l_cb";
    window[n] = function () { resolve(); };
    var s = document.createElement("script");
    s.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(${JSON.stringify(AK)}) + "&callback=" + n;
    s.onerror = function () { report.loadError = "script"; resolve(); };
    document.head.appendChild(s);
  });
  var B = window.BMap;
  if (!B || !B.Map) { report.loadError = "no BMap"; report.phase = "done"; window.__L__ = report; return; }

  function sq(cx, cy, tag) {
    var x0 = cx - 0.002, x1 = cx + 0.002, y0 = cy - 0.0014, y1 = cy + 0.0014;
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]] }, properties: { tag: tag } };
  }
  function poly(cx, cy, tag) {
    var x0 = cx - 0.004, x1 = cx + 0.004, y0 = cy - 0.002, y1 = cy + 0.002;
    return { type: "Feature", geometry: { type: "LineString", coordinates: [[x0,y0],[x1,y1]] }, properties: { tag: tag } };
  }
  function data() {
    return { type: "FeatureCollection", features: [
      sq(116.4034, 39.9153, "sq-a"),
      sq(116.4046, 39.9153, "sq-b"),
      poly(116.4026, 39.9146, "ln-a"),
    ] };
  }

  var div = document.createElement("div");
  div.style.cssText = "width:480px;height:360px;";
  document.body.appendChild(div);
  var map = new B.Map(div, { center: new B.Point(116.404, 39.915), zoom: 14, preserveDrawingBuffer: true });
  await new Promise(function (r) { setTimeout(r, 3500); });

  /** 一个覆盖物上所有可能的 zIndex 读法，逐个记（不同子类字段名不一样）。 */
  function zOf(o) {
    var out = { ctor: o && o.constructor ? o.constructor.name : null };
    for (var k of ["zIndex", "_zIndex", "_zindex"]) {
      out[k] = o ? o[k] : undefined;
    }
    out.getZIndex = (o && typeof o.getZIndex === "function")
      ? (function () { try { return o.getZIndex(); } catch (e) { return "THREW:" + e.message; } })()
      : "no-getZIndex";
    out.hasSetZIndex = !!(o && typeof o.setZIndex === "function");
    return out;
  }
  function snapshot(layer) {
    var ovs = layer.getData();
    var out = [];
    for (var i = 0; i < ovs.length; i++) out.push(zOf(ovs[i]));
    return out;
  }

  var layer = new B.GeoJSONLayer("lvl", {
    polygonStyle: { strokeColor: "#000000", strokeWeight: 2, fillColor: "#ff0000", fillOpacity: 1 },
    polylineStyle: { strokeColor: "#0000ff", strokeWeight: 3 },
  });
  map.addLayer(layer);
  layer.setData(data());
  await new Promise(function (r) { setTimeout(r, 1500); });

  report.steps = [];
  function step(label, fn) {
    return (async function () {
      var entry = { label: label };
      entry.levelBefore = (function () { try { return layer.getLevel(); } catch (e) { return "THREW"; } })();
      entry.zBefore = snapshot(layer);
      entry.call = (function () { try { fn(); return "ok"; } catch (e) { return "THREW:" + e.message; } })();
      await new Promise(function (r) { setTimeout(r, 900); });
      entry.levelAfter = (function () { try { return layer.getLevel(); } catch (e) { return "THREW"; } })();
      entry.zAfter = snapshot(layer);
      report.steps.push(entry);
    })();
  }

  await step("baseline", function () {});
  report.afterFirstStep = true;
  await step("setLevel(-50)", function () { layer.setLevel(-50); });
  for (var probe of [-1023, -1024, -1025, -2000, 1023, 1024, 1025, 2000, 1.5, -1.5]) { await step("C" + probe, function () { layer.setLevel(probe); }); }
  await step("setLevel(0)", function () { layer.setLevel(0); });
  await step("setLevel(-1) small negative", function () { layer.setLevel(-1); });
  // 回到默认，再测 setVisible / resetStyle 的读回
  await step("setLevel(-99)", function () { layer.setLevel(-99); });
  await step("setVisible(false)", function () { layer.setVisible(false); });
  await step("setVisible(true)", function () { layer.setVisible(true); });
  await step("resetStyle", function () { layer.resetStyle(); });

  // 构造期 level 是否也透传到覆盖物
  var l2 = new B.GeoJSONLayer("lvl-ctor", {
    level: -77,
    polygonStyle: { fillColor: "#00ff00", fillOpacity: 1 },
  });
  map.addLayer(l2);
  l2.setData({ type: "FeatureCollection", features: [sq(116.404, 39.9153, "ctor")] });
  await new Promise(function (r) { setTimeout(r, 1500); });
  report.ctorLevel = { getLevel: l2.getLevel(), z: snapshot(l2) };
  map.removeLayer(l2);

  // 截图（可选，仅供人工核对）
  try { var s = await map.getScreenshot(); var i = s.indexOf("base64,"); window.__LSHOT__ = s.slice(i + 7); } catch (e) {}

  layer.clearData();
  map.removeLayer(layer);
  layer.destroy();
  report.phase = "done";
  window.__L__ = report;
  } catch (e) { window.__LERR__ = JSON.stringify({ phase: "error", err: String(e && e.message ? e.message : e) }); report.phase = "error"; report.err = String(e && e.message ? e.message : e); report.stack = String(e && e.stack ? e.stack : "").split(String.fromCharCode(10)).slice(0,6).join(" | "); window.__L__ = report; }
})();
`;

async function main(): Promise<number> {
  const browser = process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>${PAGE}</script></body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "probe-level-"));
  const server = createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(html); });
  await new Promise<void>((d) => server.listen(0, "localhost", () => d()));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://localhost:${port}/`;
  const chrome = spawn(browser, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--window-size=760,420", baseUrl,
  ], { stdio: "ignore" });
  const portFile = join(dir, "DevToolsActivePort");
  let dp = 0;
  for (;;) { if (existsSync(portFile)) { dp = Number(readFileSync(portFile, "utf8").split("\n")[0]); if (dp) break; } await sleep(200); }
  let target: { webSocketDebuggerUrl?: string } | undefined;
  for (;;) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${dp}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
      target = list.find((e) => e.type === "page" && e.url.startsWith(baseUrl));
      if (target?.webSocketDebuggerUrl) break;
    } catch { /* wait */ }
    await sleep(300);
  }
  const session = await connectCdpSession(target!.webSocketDebuggerUrl!, { deadline: Date.now() + 180_000 });
  await session.send("Runtime.enable");
  await session.send("Log.enable").catch(() => {});
  for (let i = 0; i < 90; i++) {
    const m = await session.send("Runtime.evaluate", { expression: "window.__L__ ? JSON.stringify(window.__L__) : (window.__LERR__ || null)", returnByValue: true });
    const v = (m.result as { result?: { value?: unknown } } | undefined)?.result?.value;
    if (typeof v === "string") {
      const rep = JSON.parse(v) as { steps: Array<{ label: string; levelBefore: unknown; levelAfter: unknown; zBefore: unknown[]; zAfter: unknown[]; call: string }>; ctorLevel: unknown };
      for (const st of rep.steps ?? []) {
        console.log(`\n== ${st.label}  call=${st.call}  getLevel: ${st.levelBefore} → ${st.levelAfter}`);
        const names = ["zIndex", "_zIndex", "getZIndex", "ctor"];
        for (let i = 0; i < (st.zBefore ?? []).length; i++) {
          const b = st.zBefore[i] as Record<string, unknown>;
          const a = (st.zAfter?.[i] ?? {}) as Record<string, unknown>;
          const parts = names.map((n) => `${n}: ${JSON.stringify(b[n])}→${JSON.stringify(a[n])}`);
          console.log(`   ov[${i}] ${parts.join("  ")}`);
        }
      }
      console.log(`\n构造期 level: ${JSON.stringify(rep.ctorLevel)}`);
      const sm = await session.send("Runtime.evaluate", { expression: "window.__LSHOT__ || null", returnByValue: true });
      const sv = (sm.result as { result?: { value?: unknown } } | undefined)?.result?.value;
      if (typeof sv === "string") writeFileSync("/tmp/level.png", Buffer.from(sv, "base64"));
      session.close(); chrome.kill(); server.close();
      return 0;
    }
    await sleep(1000);
  }
  const diag = await session.send("Runtime.evaluate", { expression: "JSON.stringify({ hasL: typeof window.__L__, hasErr: typeof window.__LERR__, bmap: typeof window.BMap, canvas: document.querySelectorAll(\"canvas\").length, bodyLen: document.body.innerHTML.length })", returnByValue: true });
  console.error("no report; diag:", (diag.result as { result?: { value?: unknown } } | undefined)?.result?.value);
  const errs: string[] = [];
  session.onMessage?.((m) => { if (m.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(m.params).slice(0, 300)); });
  const ev = await session.send("Runtime.evaluate", { expression: "(function(){ try { new Function(document.querySelector(\"script\").textContent); return \"ok\"; } catch(e) { return String(e.message) + \" @\" + (e.stack||\"\").split(String.fromCharCode(10))[1]; } })()", returnByValue: true });
  console.error("reparse:", (ev.result as { result?: { value?: unknown } } | undefined)?.result?.value);
  console.error("runtime exceptions:", errs.join(" || "));
  session.close(); chrome.kill(); server.close();
  return 2;
}
process.exitCode = await main();
await new Promise<void>((d) => process.stdout.write("", () => d()));
