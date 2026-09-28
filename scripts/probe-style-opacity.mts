#!/usr/bin/env node
/**
 * 样式袋的 `opacity` 与图层级 `setOpacity` 是不是**同一个 SDK 状态**（#174 评审 P1-1）
 *
 * ## 这条探针在回答什么
 *
 * 评审给 `useNativeLayerResource.fieldWrites()` 记的缺陷是：`opacity`（`setOpacity`）与
 * `style`（`setStyle` → `setOptions` / `setStyleOptions`）争同一个 SDK 状态，写入顺序决定
 * 最终值。**仓库文档当时把 `setOptions` 记成「整袋替换」**（`types/components.ts` 的
 * `TextLayerStyle` 文件头），而官方 4.0.5 声明写的恰恰相反。
 *
 * 因此在改代码之前必须先把两件事分开读，它们决定完全不同的修法：
 *
 * | 问题 | 读法 | 决定 |
 * | --- | --- | --- |
 * | A. `setOptions` 是 merge 还是整袋替换？ | 设一次 `setOpacity(v)`，再做一次**不含** `opacity` 的样式写，再读 `getOpacity()` | 决定「是不是所有 kind 都中招」 |
 * | B. 袋里的 `opacity` 会不会写**同一份**状态？ | `setOptions({opacity: w})` 后读 `getOpacity()`，再 `setOpacity(v)` 后读 | 决定「两个入口是不是真的争同一个东西」 |
 *
 * `getOpacity()` 读回**不等于**驱动渲染（`PolygonLayer#setOpacity` 就是「present-but-ineffective」，
 * `native-layers.ts` 里有逐条像素读数）。所以本探针额外走一遍**像素判决**：
 * `setOpacity(0)` ⇒ 画布归零，再做一次**不含** `opacity` 的样式写 ⇒ 仍然归零才是「样式写没有
 * 碰 opacity 这份状态」；反之若画面回来了，说明样式写把它重置了。
 * 像素通道本身用 `setVisible(false)` 作**对照**（同一份读数里证明通道是活的）。
 *
 * 逐 kind 覆盖两个家族（`styleMember` 不同，语义必须分别读，不能假设）：
 * `TextLayer` / `PolylineLayer`（`visualization/`，`setOptions`）与
 * `LineLayer` / `PointShapeLayer`（`layer/`，`setStyleOptions` + `doOnceDraw`）。
 * `PointShapeLayer` 另有一条**逐要素** `PointShapeStyle.opacity`（`layer/PointShapeLayer.d.ts:137`），
 * 与图层级 `opacity` 是**两个字段**——本探针顺带确认这一条，免得把「逐要素」误当成争用。
 *
 * 退出码：`0` 报告写出来了 / `3` SDK 没起来（blocked）/ `2` 脚手架失败。
 * **不给 pass/fail 结论**——它是取证器，解释由人工裁决（与同目录其它 probe 同一约定）。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-style-opacity.mts -- --out=/tmp/style-opacity.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, sleep, type CdpSession } from "./official-probe/cdp.mts";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const OUT = outIndex >= 0 ? (argv[outIndex + 1] ?? "/tmp/style-opacity.json") : "/tmp/style-opacity.json";
const AK = (process.env.BAIDU_MAP_AK ?? "").trim();

if (!AK) {
  console.error("缺少 AK：BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-style-opacity.mts");
  process.exit(2);
}

/** 页面侧脚本。⚠️ 整段在模板字符串里，**不能出现反引号**。 */
function pageScript(ak: string): string {
  return `
(async () => {
  const publish = (r) => { window.__SO_PROBE__ = r; return r; };
  const R = { sdk: {}, readings: {}, errors: [], phase: "running" };
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("load:" + src));
    document.head.appendChild(s);
  });
  try {
    await load("https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(${JSON.stringify(ak)}) + "&callback=__so_cb");
    await new Promise((r) => { if (window.BMap && window.BMap.Map) r(); else setTimeout(r, 15000); });
  } catch (e) { R.loadError = String(e && e.message || e); R.phase = "done"; return publish(R); }
  if (!window.BMap) { R.loadError = "BMap undefined"; R.phase = "done"; return publish(R); }
  const B = window.BMap;
  R.sdk.ready = !!(B.Map && B.Point);
  R.sdk.version = B.sdkVersion || B.version || null;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const err = (e) => String((e && e.message) || e);
  // 反复复读直到构造器真的在位（扩展 API 那几类是异步注入的；settle 之前读到 undefined
  // 只能说明「还没到」，不能说明「没有」——见 probe-runtime-members case 15 的同款理由）。
  const settledCtor = async (name, budgetMs) => {
    const t0 = Date.now();
    for (;;) {
      if (typeof B[name] === "function") return B[name];
      if (Date.now() - t0 > budgetMs) return null;
      await wait(500);
    }
  };

  // 造一张**真的画得出东西**的图。preserveDrawingBuffer 让 readPixels 在合成之后仍可读，
  // 否则像素读数会全 0（#165 probe 已实测该选项被官方运行时承认）。
  const withMap = async (fn, settleMs) => {
    const div = document.createElement("div");
    div.style.cssText = "width:320px;height:240px;position:absolute;top:0;left:0";
    document.body.appendChild(div);
    const mk = new B.Map(div, { preserveDrawingBuffer: true });
    mk.centerAndZoom(new B.Point(116.404, 39.915), 13);
    await wait(settleMs);
    try { return await fn(mk, div); }
    finally { try { mk.destroy(); } catch {} try { div.remove(); } catch {} }
  };

  // 哨兵像素计数：数画布上「接近纯蓝」的像素个数。
  // 蓝 (0,0,255) 不可能出现在底图里，count > 0 即「那条形状真的画上去了」。
  const countSentinel = (div) => {
    try {
      const canvas = div.querySelector("canvas");
      if (!canvas) return { ok: false, why: "no-canvas" };
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { ok: false, why: "no-webgl-context" };
      const w = canvas.width, h = canvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let blue = 0, nonEmpty = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];
        if (a > 0) nonEmpty += 1;
        if (b > 180 && r < 90 && g < 90) blue += 1;
      }
      return { ok: true, blue, nonEmpty, w, h };
    } catch (e) { return { ok: false, why: err(e) }; }
  };

  // A/B 两问的统一夹具。styleWrite 是该 kind 的样式入口。
  const probeKind = async (spec) => {
    const Ctor = await settledCtor(spec.ctor, 20000);
    if (!Ctor) return { ctorPresent: false };
    const out = { ctorPresent: true, styleMember: spec.styleMember, notes: {} };
    return await withMap(async (mk, div) => {
      let L;
      try { L = new Ctor(spec.ctorOptions || {}); } catch (e) { return { ctorPresent: true, ctorThrew: err(e) }; }
      try { L.setData(spec.data); } catch (e) { out.notes.setDataThrew = err(e); }
      mk.addLayer(L);
      await wait(1200);

      const has = (n) => typeof L[n] === "function";
      out.members = {
        setOpacity: has("setOpacity"), getOpacity: has("getOpacity"),
        setOptions: has("setOptions"), getOptions: has("getOptions"),
        setStyleOptions: has("setStyleOptions"), doOnceDraw: has("doOnceDraw"),
      };
      out.hasGetOpacity = has("getOpacity");
      const readOpacity = () => {
        try { return has("getOpacity") ? L.getOpacity() : "(no getOpacity)"; }
        catch (e) { return "THREW:" + err(e); }
      };
      const styleWrite = (bag) => {
        try {
          if (has("setStyleOptions")) { L.setStyleOptions(bag); if (has("doOnceDraw")) L.doOnceDraw(); return "setStyleOptions"; }
          if (has("setOptions")) { L.setOptions(bag); return "setOptions"; }
          return "(no style member)";
        } catch (e) { return "THREW:" + err(e); }
      };

      // ---- A：样式写（不含 opacity）会不会把 setOpacity 的值冲掉 ----
      out.A = {};
      try { L.setOpacity(0.25); } catch (e) { out.A.setOpacityThrew = err(e); }
      await wait(400);
      out.A.afterSetOpacity = readOpacity();
      out.A.styleWrite = styleWrite(spec.unrelatedStyle);
      await wait(600);
      out.A.afterUnrelatedStyleWrite = readOpacity();
      out.A.mergeNotReplace = out.A.afterUnrelatedStyleWrite === 0.25;

      // ---- B：袋里的 opacity 是不是写同一份状态 ----
      out.B = {};
      out.B.styleWriteWithOpacity = styleWrite({ opacity: 0.75 });
      await wait(600);
      out.B.afterBagOpacity = readOpacity();
      out.B.bagOpacityReachesSetter = out.B.afterBagOpacity === 0.75;
      try { L.setOpacity(0.25); } catch (e) { out.B.setOpacityThrew = err(e); }
      await wait(600);
      out.B.afterSetterWins = readOpacity();
      out.B.sameTargetState = out.B.afterSetterWins === 0.25;

      // ---- 像素判决：样式写（不含 opacity）会不会让画面回来 ----
      out.pixel = {};
      if (spec.pixelData) {
        try { L.setOpacity(0); } catch (e) { out.pixel.setOpacityThrew = err(e); }
        await wait(800);
        const off = countSentinel(div);
        out.pixel.atOpacity0 = off;
        styleWrite(spec.unrelatedStyle);
        await wait(900);
        const after = countSentinel(div);
        out.pixel.afterUnrelatedStyleWrite = after;
        out.pixel.stillInvisible = !!(off.ok && after.ok && after.blue === 0);
        // 对照：显隐通道必须是活的，否则上面两条读数一律作废。
        try { L.setVisible(false); } catch (e) { out.pixel.setVisibleThrew = err(e); }
        await wait(800);
        out.pixel.atVisibleFalse = countSentinel(div);
        try { L.setVisible(true); } catch (e) { out.pixel.setVisibleTrueThrew = err(e); }
        await wait(800);
        out.pixel.atVisibleTrue = countSentinel(div);
      }

      mk.removeLayer(L);
      return out;
    }, 2500);
  };

  const LINE = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [[116.33, 39.88], [116.48, 39.96]] }, properties: { id: "l1" } },
  ] };
  const POINT = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [116.404, 39.915] }, properties: { id: "t1" } },
  ] };

  // 像素判决的形状：一条粗纯蓝线/一个粗纯蓝点，够大到哨兵像素稳定非零。
  const BIG_LINE = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [[116.30, 39.86], [116.52, 39.97]] }, properties: { id: "big" } },
  ] };
  const BLUE = { strokeColor: "#0000ff", strokeWeight: 18 };

  R.readings.perFamily = {};
  R.readings.perFamily.PolylineLayer = await probeKind({
    ctor: "PolylineLayer", styleMember: "setOptions",
    data: LINE, unrelatedStyle: { strokeWeight: 6 },
    pixelData: BIG_LINE, ctorOptions: Object.assign({}, BLUE),
  });
  R.readings.perFamily.TextLayer = await probeKind({
    ctor: "TextLayer", styleMember: "setOptions",
    data: POINT, unrelatedStyle: { fontSize: 22 },
    ctorOptions: { color: "#0000ff" },
  });
  R.readings.perFamily.LineLayer = await probeKind({
    ctor: "LineLayer", styleMember: "setStyleOptions",
    data: LINE, unrelatedStyle: { strokeWeight: 6 },
    pixelData: BIG_LINE, ctorOptions: Object.assign({}, BLUE),
  });
  R.readings.perFamily.PointShapeLayer = await probeKind({
    ctor: "PointShapeLayer", styleMember: "setStyleOptions",
    data: POINT, unrelatedStyle: { size: 30 },
    ctorOptions: { shape: "circle", size: 30, color: "#0000ff" },
  });

  // 逐要素 vs 图层级：PointShapeStyle.opacity（PointShapeLayer.d.ts 第 137 行）与 setOpacity
  // 是**两个官方字段**。若逐要素那个不改变 getOpacity()，本库就**不能**把它与图层级混成同一个入口。
  R.readings.perFeatureVsLayerLevel = await (async () => {
    const Ctor = await settledCtor("PointShapeLayer", 20000);
    if (!Ctor) return { ctorPresent: false };
    return await withMap(async (mk) => {
      const L = new Ctor({ shape: "circle", size: 30, color: "#0000ff" });
      L.setData(POINT); mk.addLayer(L);
      await wait(1200);
      const out = {};
      try {
        L.setOpacity(0.25); out.afterSetOpacity = L.getOpacity();
        L.setStyleOptions({ opacity: 0.9 }); L.doOnceDraw && L.doOnceDraw();
        await wait(600);
        out.afterPerFeatureStyleOpacity = L.getOpacity();
        out.distinctFields = out.afterPerFeatureStyleOpacity === 0.25;
      } catch (e) { out.threw = err(e); }
      mk.removeLayer(L);
      return out;
    }, 2500);
  })();

  R.phase = "done";
  return publish(R);
})()
`;
}

function findBrowser(): string | null {
  for (const candidate of [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

async function main(): Promise<number> {
  const browser = findBrowser();
  if (!browser) {
    console.error("[style-opacity] 找不到 Chrome/Chromium（脚手架失败）");
    return 2;
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "style-opacity-chrome-"));
  const pageHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${pageScript(AK)}</script></body></html>`;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") return 2;
  const baseUrl = `http://localhost:${address.port}/`;

  let chrome: ChildProcess | null = null;
  let session: CdpSession | null = null;
  try {
    chrome = spawn(browser, ["--headless", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, baseUrl], { stdio: "ignore" });
    const portFile = join(userDataDir, "DevToolsActivePort");
    let devtoolsPort = 0;
    for (;;) {
      if (existsSync(portFile)) {
        devtoolsPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
        if (devtoolsPort) break;
      }
      await sleep(200);
    }
    let target: { webSocketDebuggerUrl?: string } | undefined;
    const t1 = Date.now();
    for (;;) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json()) as Array<{
          type: string; url: string; webSocketDebuggerUrl?: string;
        }>;
        target = list.find((e) => e.type === "page" && e.url.startsWith(baseUrl));
        if (target?.webSocketDebuggerUrl) break;
      } catch { /* CDP 未就绪 */ }
      if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时");
      await sleep(300);
    }
    session = await connectCdpSession(target!.webSocketDebuggerUrl!, {
      deadline: Date.now() + 300_000,
      commandTimeoutMs: 60_000,
    });
    const value = await (async () => {
      const deadline = Date.now() + 300_000;
      for (;;) {
        const msg = await session!.send("Runtime.evaluate", {
          expression: "window.__SO_PROBE__ ? JSON.stringify(window.__SO_PROBE__) : null",
          returnByValue: true,
        });
        const raw = msg.result?.result?.value;
        if (typeof raw === "string" && raw !== "null") {
          const parsed = JSON.parse(raw) as { readings: Record<string, unknown>; phase: string; loadError?: string };
          if (parsed.phase === "done") return parsed;
        }
        if (Date.now() > deadline) return null;
        await sleep(500);
      }
    })();
    if (!value) {
      console.error("[style-opacity] 没读到页面结果");
      return 2;
    }
    writeFileSync(OUT, JSON.stringify(value, null, 2), "utf8");
    if (value.loadError) {
      console.error(`[style-opacity] blocked: ${value.loadError}`);
      return 3;
    }
    console.log(JSON.stringify(value.readings, null, 2));
    console.log("\n[style-opacity] 读数已写入 " + OUT);
    return 0;
  } catch (error) {
    console.error(`[style-opacity] 探针异常：${(error as Error).message}`);
    return 2;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

process.exit(await main());
