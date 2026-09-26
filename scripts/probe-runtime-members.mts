#!/usr/bin/env node
/**
 * 几处**只靠类型声明定不了**的运行时事实探针（#165 Class 1 / Class 2 / Class 3）
 *
 * 这些结论此前都是「依据仓库旧记录转述」或「按同构推的候选名」。本探针把它们
 * 一次性升级为**本轮 live 读数**，不改动任何生产代码。
 *
 * ## 测什么
 *
 * | # | 待验证 | 为什么要 live |
 * | --- | --- | --- |
 * | 1 | `BMap.MapTypeId` 运行时到底有哪些成员？`HYBRID` 存在吗？ | Class 1 登记了 `hybrid: ["HYBRID", "BMAP_HYBRID_MAP"]`，**候选名是按同构推的，没有取证** |
 * | 2 | `Marker#setAnchor` 构造后立刻调会不会抛？ | 仓库把它按 `recreate` 处理，理由写「官方说明」——但**类型声明里明明有 `setAnchor`**，那句话其实是运行时观察，不是声明事实 |
 * | 3 | 四个 visualization 图层的显示成员真在吗？ | Class 3 已按 4.0.5 声明登记；这里核对**运行时**是否同样在位（声明与运行时可以不一致） |
 * | 4 | `MapTypeOptions` / `Projection` 运行时有没有？ | 本地 augmentation 补了这两个声明；若运行时也提供，可删补丁 |
 * | 5 | `Polyline#setPositionAt` / `Polygon#setPositionAt(index, point, deep)` 的第三参？ | Class 3 暴露了它们，参数个数需实测定 |
 * | 6 | `Panorama#getLinks()` 运行时返回什么形状？ | Class 3 新投影了 8 个成员，形状需实测 |
 *
 * ## 判定与退出码
 *
 * | 结论 | 含义 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 页面脚本跑完且报告写出来了（**不代表每条都"符合预期"**——本探针是**取证器**，不是判定器） | 0 |
 * | `blocked` | SDK 没起来（`loadError`）——**不是通过也不是失败** | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 语法错 / 没写报告 | 2 |
 *
 * ⚠️ **本探针不给「pass/fail」结论**，它只产出读数。读数的解释与后续动作
 * （例如 `hybrid` 该不该登记、`setAnchor` 该不该改成 mutable）由人工裁决，
 * 并按 ADR 写回对应模块的注释。理由见同目录其它 `probe-*.mts` 的同款声明。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-runtime-members.mts
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-runtime-members.mts -- --out=/tmp/x.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, sleep, type CdpSession } from "./official-probe/cdp.mts";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const OUT = outIndex >= 0 ? (argv[outIndex + 1] ?? "/tmp/runtime-members.json") : "/tmp/runtime-members.json";
const AK = (process.env.BAIDU_MAP_AK ?? "").trim();

if (!AK) {
  console.error("缺少 AK：BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-runtime-members.mts");
  process.exit(2);
}

/** 页面侧脚本：只读 API 表面，不改任何全局状态。 */
function pageScript(ak: string): string {
  return `
(async () => {
  const publish = (r) => { window.__RM_PROBE__ = r; return r; };
  const R = { sdk: {}, readings: {}, errors: [], phase: "running" };
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("load:" + src));
    document.head.appendChild(s);
  });
  try {
    await load("https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(${JSON.stringify(ak)}) + "&callback=__rm_cb");
    await new Promise((r) => { if (window.BMap && window.BMap.Map) r(); else setTimeout(r, 15000); });
  } catch (e) { R.loadError = String(e && e.message || e); R.phase = "done"; return publish(R); }
  if (!window.BMap) { R.loadError = "BMap undefined"; R.phase = "done"; return publish(R); }
  const B = window.BMap;
  R.sdk.ready = !!(B.Map && B.Point && B.Marker);
  R.sdk.version = B.sdkVersion || B.version || null;

  const own = (o, k) => { try { return o != null && Object.prototype.hasOwnProperty.call(o, k); } catch { return false; } };
  const protoHas = (ctor, name) => {
    try { return typeof ctor === "function" && typeof ctor.prototype[name] === "function"; } catch { return false; }
  };
  const statics = (C) => { try { return C ? Object.getOwnPropertyNames(C).filter(n => /^(BMAP_|MAPTYPE|.*_MAP$)/i.test(n)) : null; } catch { return null; } };

  // 1. MapTypeId 运行时成员 —— 决定 hybrid 候选名是否成立
  R.readings.mapTypeIdStatics = statics(B.MapTypeId);
  R.readings.mapTypeIdAllOwn = B.MapTypeId ? Object.getOwnPropertyNames(B.MapTypeId) : null;
  R.readings.mapTypeIdValues = (() => {
    try { const o = {}; for (const n of (B.MapTypeId ? Object.getOwnPropertyNames(B.MapTypeId) : [])) {
      const v = B.MapTypeId[n]; if (typeof v === "string" || typeof v === "number") o[n] = v; } return o; } catch { return null; }
  })();

  // 2. Marker#setAnchor 构造后立刻调会不会抛
  R.readings.markerSetAnchor = {
    declared: true,
    onProto: protoHas(B.Marker, "setAnchor"),
    callAfterCtor: (() => {
      try {
        const div = document.createElement("div");
        div.style.cssText = "width:200px;height:200px;position:absolute;top:0;left:0";
        document.body.appendChild(div);
        const m = new B.Marker(new B.Point(116.404, 39.915));
        m.setAnchor(new B.ControlAnchor(1, 1));
        const after = own(m, "anchor") || protoHas(B.Marker, "getAnchor");
        m.remove();
        return { threw: false, applied: after };
      } catch (e) { return { threw: true, message: String(e && e.message || e) }; }
    })(),
  };

  // 3. visualization 四类的显示成员（声明 vs 运行时）
  const VIS = {
    PointLayer: ["setData","clearData","setStyle","setVisible","setOpacity","setZIndex","setRenderStage","setRefCenter","setEnablePicked","setGradient","setRadius","hitTest"],
    ClusterLayer: ["setData","clearData","setStyle","setVisible","setOpacity","setZIndex","setRenderStage","setRefCenter","setEnablePicked","hitTest"],
    Heatmap: ["setData","clearData","setStyle","setVisible","setOpacity","setZIndex","setRenderStage","setRefCenter","setGradient","setRadius","hitTest"],
    TrackLine: ["setData","clearData","setStyle","setVisible","setOpacity","setZIndex","setRenderStage","setRefCenter","setSpeed","setProcess","start","pause","resume","stop"],
  };
  R.readings.visualization = {};
  for (const [name, members] of Object.entries(VIS)) {
    const ctor = B[name];
    R.readings.visualization[name] = {
      ctorPresent: typeof ctor === "function",
      members: Object.fromEntries(members.map(m => [m, protoHas(ctor, m)])),
    };
  }

  // 4. MapTypeOptions / Projection 运行时是否存在（决定本地 augmentation 还要不要留）
  R.readings.mapTypeOptionsCtor = typeof B.MapTypeOptions;
  R.readings.projectionCtor = typeof B.Projection;

  // 5. setPositionAt 的实际 arity（Class 3 暴露的第三参是否有依据）
  R.readings.setPositionAtArity = {
    Polyline: protoHas(B.Polyline, "setPositionAt") ? B.Polyline.prototype.setPositionAt.length : null,
    Polygon: protoHas(B.Polygon, "setPositionAt") ? B.Polygon.prototype.setPositionAt.length : null,
    Circle: protoHas(B.Circle, "setPositionAt") ? B.Circle.prototype.setPositionAt.length : null,
  };

  // 6. Panorama#getLinks 返回形状（Class 3 新投影的 8 个成员）
  R.readings.panorama = {
    hasGetLinks: protoHas(B.Panorama, "getLinks"),
    hasSetId: protoHas(B.Panorama, "setId"),
    setIdArity: protoHas(B.Panorama, "setId") ? B.Panorama.prototype.setId.length : null,
    hasCapture: protoHas(B.Panorama, "capture"),
    hasClearOverlays: protoHas(B.Panorama, "clearOverlays"),
    hasSetTheme: protoHas(B.Map, "setTheme"),
    hasScreenshot: protoHas(B.Map, "getScreenshot"),
    hasFlyTo: protoHas(B.Map, "flyTo"),
    hasGetViewport: protoHas(B.Map, "getViewport"),
    hasSetViewport: protoHas(B.Map, "setViewport"),
    hasRestrictBounds: protoHas(B.Map, "restrictBounds"),
    hasZoomIn: protoHas(B.Map, "zoomIn"),
    hasZoomOut: protoHas(B.Map, "zoomOut"),
    hasCenterAndZoom: protoHas(B.Map, "centerAndZoom"),
    hasIsSupportEarth: protoHas(B.Map, "isSupportEarth"),
  };
  // preserveDrawingBuffer 是否真被官方运行时承认：建一张开了该选项的图，看随后
  // getScreenshot() 返回的是不是全黑（无法直接读像素，只能比较「字符串长度是否非零」
  // 以及未开该选项时是否明显更短/为空）。这是**读数**，不是 pass/fail 判定。
  R.readings.preserveDrawingBuffer = await (async () => {
    const grab = async (opts) => {
      const div = document.createElement("div");
      div.style.cssText = "width:320px;height:240px;position:absolute;top:0;left:0";
      document.body.appendChild(div);
      // 必须给容器尺寸，否则官方内部拿不到绘制目标（实测报
      // "Cannot read properties of undefined (reading '_painter')"）
      const mk = new B.Map(div, opts);
      mk.centerAndZoom(new B.Point(116.404, 39.915), 12);
      // 等首帧真正画完，否则截图拿到的是空画布
      return new Promise((res) => setTimeout(() => {
      let out = null;
      try { out = mk.getScreenshot(); } catch (e) { out = "THREW:" + String(e && e.message || e); }
      res({ type: typeof out, length: typeof out === "string" ? out.length : null,
            head: typeof out === "string" ? out.slice(0, 200) : null });
      }, 2500));
    };
    try {
      // grab 是 async：必须 await，否则两个 Promise 会被 JSON 序列化成 {}（读数全丢）
      return { without: await grab({}), withBuffer: await grab({ preserveDrawingBuffer: true }),
               optionAcceptedByRuntime: true };
    } catch (e) { return { optionAcceptedByRuntime: false, error: String(e && e.message || e) }; }
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
    console.error("[runtime-members] 找不到 Chrome/Chromium（脚手架失败）");
    return 2;
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "runtime-members-chrome-"));
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
      if (existsSync(portFile)) { devtoolsPort = Number(readFileSync(portFile, "utf8").split("\n")[0]); if (devtoolsPort) break; }
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
      deadline: Date.now() + 180_000,
      commandTimeoutMs: 30_000,
    });
    const value = await (async () => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const msg = await session!.send("Runtime.evaluate", {
          expression: "window.__RM_PROBE__ ? JSON.stringify(window.__RM_PROBE__) : null",
          returnByValue: true,
        });
        const raw = msg.result?.result?.value;
        if (typeof raw === "string" && raw !== "null") {
          const parsed = JSON.parse(raw) as { readings: Record<string, unknown>; loadError?: string };
          if (parsed.phase === "done") return parsed;
        }
        if (Date.now() > deadline) return null;
        await sleep(400);
      }
    })();
    if (!value) { console.error("[runtime-members] 没读到页面结果"); return 2; }
    writeFileSync(OUT, JSON.stringify(value, null, 2), "utf8");
    if (value.loadError) { console.error(`[runtime-members] blocked: ${value.loadError}`); return 3; }
    console.log(JSON.stringify(value.readings, null, 2));
    console.log(`\n[runtime-members] 读数已写入 ${OUT}`);
    return 0;
  } catch (error) {
    console.error(`[runtime-members] 探针异常：${(error as Error).message}`);
    return 2;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

process.exit(await main());
