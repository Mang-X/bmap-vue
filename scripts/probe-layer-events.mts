#!/usr/bin/env node
/**
 * 网络图层的**事件面与加载观察面**探针（issue #97 / 承接 #40 的欠账）
 *
 * #40 的实施步骤 4 要求「定义网络 Layer 的 loading/error 回调」，而 PR #96 没有实现它，依据是
 * 逐成员核对 `@baidumap/jsapi-v4-types@4.0.4` 后得到的事实：`TileLayer` 家族（含 `TrafficLayer`）、
 * `XYZLayer` / `WMSLayer` / `WMTSLayer` / `RasterTileLayer` 的类声明里**没有任何事件成员**。
 * 本库的口径是「不把未声明成员当契约」，所以在拿到证据之前**不发明** `tileload` / `tileerror`。
 *
 * 但「声明里没有」不等于「运行时不派发」——真实 SDK 常在声明之外派发事件。本探针取两组读数：
 *
 * ## 读数组 A：这些家族到底派发不派发事件
 *
 * 对每个家族：构造 → `map.addLayer` → 对**候选事件名**逐个 `addEventListener` → 等真实请求发生
 * → 统计回调被调用了几次。候选名覆盖 `tileload` / `tileerror` / `tilesloaded` / `load` / `error`
 * 以及几个常见变体（漏掉的名字等于漏掉证据，所以宁可多试）。
 *
 * **正证控件**：同时统计页面里**真的发出**了多少个瓦片请求（`performance` 资源条目里带
 * `probe-marker` 的条数）。没有请求发生 ⇒「没有事件」这条读数无意义（可能只是压根没加载），
 * 此时探针判 `fail` 而不是输出一个看起来通过的结论。
 *
 * ## 读数组 B：官方 `tileLoadFunction` 是「接管式」还是「观察式」
 *
 * 仓库当前在 #97 里记的判断是「它是**接管式**的：调用方设置它就意味着自己负责给 `tile.src` 赋值，
 * 因此本库不能直接拿它做『只在旁边观察』的探针」。这条判断必须**实测**——它直接决定
 * 「不接管加载的观察面」这条路能不能走：
 *
 * | 读数 | 含义 |
 * | --- | --- |
 * | 传了 `tileLoadFunction` 之后瓦片请求**仍在发** | 它是观察式（或至少不排除默认加载）⇒ 观察面可以直接用它 |
 * | 传了之后请求**停了** | 接管式 ⇒ 要在它里面自己完成默认加载（`tile.src = url`）才能既观察又不断网 |
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 全部读数取到，且每组读数都有正证控件成立 | 0 |
 * | `fail` | 有正证控件不成立（本轮**无法判定**，不是「SDK 行为不好」） | 1 |
 * | `blocked` | SDK 没起来 / 地图建不出来 | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * ## ⚠️ 入口 URL 必须带 `callback=`（与 `probe-layer-detached.mts` 同一条坑）
 *
 * 不带 `callback` 时引导脚本用 `document.write` 注入 `getscript`，而动态插入的脚本在解析完成后
 * 执行 `document.write` 会触发 `document.open()` ⇒ 文档被清空、`window.BMap` 永远没有成员。
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-plugin-runtime.mts` 同一口径（ADR `2026-09-13-plugin-compat-inventory` 决策 8）：
 * 不登记进 `tests/browser/jsapi-v4` 的检查表、不进任何 CI job、不参与必需链路的放行判定。
 * AK 从 `BAIDU_MAP_AK` 读、**不落库**；输出里的 `ak=` 一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:layer-events
 *   BAIDU_MAP_AK=<ak> pnpm probe:layer-events -- --out=/tmp/layer-events.json
 */
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts"

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? ""
const outPath = argValue("out") ?? ""

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 结构：加载 SDK → 建图 → 对每个家族取读数 → 单独取 `tileLoadFunction` 语义读数。
 * 每一步都写进 `report`，页面里有任何异常都落成 `report.error`，最后写 `window.__LAYER_EVENTS_PROBE__`。
 *
 * 页面里**不出现反引号**（外层是 TS 模板串）。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const MARKER = "probe-marker=1";
  const CANDIDATE_EVENTS = ["tileload", "tileerror", "tilesloaded", "load", "error", "tileLoad", "tileError", "dataLoad", "dataLoaded", "loadtiles"];
  const report = { phase: "boot", sdk: null, families: [], tileLoadFunction: null, error: null };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const attempt = (fn) => {
    try { return { threw: false, value: fn() }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error) }; }
  };
  // 资源时间线默认只保留 250 条，前面的臂会把缓冲填满 ⇒ 后跑的臂静默丢条目（实测踩到：
  // 第三臂读成 0 次请求，而它的图片其实已经 naturalWidth=256 地加载完了）。
  // 口径改成「提高上限 + 每臂前清空 + 绝对计数」，不再用前后相减。
  const BUFFER = 4000;
  if (typeof performance.setResourceTimingBufferSize === "function") performance.setResourceTimingBufferSize(BUFFER);
  const resetRequests = () => { if (typeof performance.clearResourceTimings === "function") performance.clearResourceTimings(); };
  const countRequests = () => performance.getEntriesByType("resource").filter((e) => e.name.indexOf(MARKER) >= 0).length;

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapLayerEventsReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapLayerEventsReady";
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
    report.sdk = { version: String(window.BMap.version) };

    const host = document.createElement("div");
    host.style.cssText = "width:640px;height:420px";
    document.body.appendChild(host);
    const map = new window.BMap.Map(host);
    map.centerAndZoom(new window.BMap.Point(116.404, 39.915), 12);
    await wait(2500);
    // 底图基线：本页真的在渲染（有瓦片/脚本请求打到百度主机）。「没有事件」的结论只有在
    // 渲染确实发生过时才有意义——这是整轮实验的总开关。
    report.baseMapRequests = performance.getEntriesByType("resource")
      .filter((e) => e.name.indexOf("bdimg.com") >= 0 || e.name.indexOf("map.baidu.com") >= 0).length;

    // 所有家族的瓦片 URL 都带上 MARKER，于是「有没有真的发请求」可以用一个口径统计。
    const tileUrl = "https://maponline0.bdimg.com/tile/?qt=tile&x={X}&y={Y}&z={Z}&styles=pl&scaler=1&" + MARKER;
    const xyzUrl = "https://maponline0.bdimg.com/tile/?qt=tile&x={x}&y={y}&z={z}&styles=pl&" + MARKER;
    const wmsUrl = "https://maponline0.bdimg.com/tile/?qt=tile&" + MARKER;
    const rasterUrl = "https://maponline0.bdimg.com/tile/?qt=tile&x={x}&y={y}&z={z}&" + MARKER;

    // ⚠️ 构造签名逐个核对过上游声明：**全都是 options-only**（TileLayer / XYZLayer /
    // RasterTileLayer / WMSLayer / WMTSLayer 的构造首参都是 options 对象，URL 在选项里）。
    // 第一版按位置参数传 URL，SDK 直接忽略 ⇒ 一个瓦片都不请求（正证控件当场挡住）。
    // 这类错的表现与「网络被墙」一模一样，先怀疑自己的参数。
    // ⚠️ 本段注释**不能出现反引号**：它在外层 TS 模板串里，反引号会截断模板串
    // （实测 ERR_INVALID_TYPESCRIPT_SYNTAX，而 new Function 那道预检挡不住——它只检查页面脚本）。
    const FAMILIES = [
      { id: "tile", ctor: "TileLayer", build: (B) => new B.TileLayer({ tileUrlTemplate: tileUrl }) },
      { id: "traffic", ctor: "TrafficLayer", build: (B) => new B.TrafficLayer() },
      { id: "xyz", ctor: "XYZLayer", build: (B) => new B.XYZLayer({ tileUrlTemplate: xyzUrl }) },
      { id: "raster", ctor: "RasterTileLayer", build: (B) => new B.RasterTileLayer({ url: rasterUrl }) },
      { id: "wms", ctor: "WMSLayer", build: (B) => new B.WMSLayer({ url: wmsUrl, params: { LAYERS: "probe" } }) },
      { id: "wmts", ctor: "WMTSLayer", build: (B) => new B.WMTSLayer({ url: wmsUrl, params: { Layer: "probe" } }) },
    ];

    for (const spec of FAMILIES) {
      const entry = { id: spec.id, ctor: spec.ctor, ctorType: typeof window.BMap[spec.ctor], events: {}, notes: [] };
      if (entry.ctorType !== "function") {
        entry.notes.push("运行时没有这个构造器");
        report.families.push(entry);
        continue;
      }
      const built = attempt(() => spec.build(window.BMap));
      if (built.threw) {
        entry.notes.push("构造抛错：" + built.message);
        report.families.push(entry);
        continue;
      }
      const layer = built.value;
      entry.addEventListener = typeof layer.addEventListener;
      entry.removeEventListener = typeof layer.removeEventListener;

      // 候选事件名逐个登记；登记本身抛错也要记下来（「有这个入口但拒绝这个事件名」也是读数）。
      const hits = {};
      for (const name of CANDIDATE_EVENTS) hits[name] = 0;
      const registration = attempt(() => {
        for (const name of CANDIDATE_EVENTS) {
          layer.addEventListener(name, function () { hits[name] += 1; });
        }
      });
      entry.registration = registration.threw ? { threw: true, message: registration.message } : { threw: false };

      resetRequests();
      const added = attempt(() => map.addLayer(layer));
      entry.addLayer = added.threw ? { threw: true, message: added.message } : { threw: false };
      await wait(2500);

      entry.requestsDuringWindow = countRequests();
      entry.events = hits;
      report.families.push(entry);
      attempt(() => map.removeLayer(layer));
      await wait(300);
    }

    // ---- 读数组 B：tileLoadFunction 是接管式还是观察式 ----
    //
    // **必须带对照跑**：只测「设了 hook 之后请求为 0」无法区分「hook 挡掉了默认加载」与
    // 「本来就一个请求都没有」（本探针第一版就是这么误判的）。所以先用**同样的 URL、同样的窗口**
    // 建一个不带 hook 的 TileLayer 当对照，再建带 hook 的那个。
    const controlLayer = attempt(() => new window.BMap.TileLayer({ tileUrlTemplate: tileUrl }));
    let controlRequests = -1;
    if (!controlLayer.threw) {
      resetRequests();
      attempt(() => map.addLayer(controlLayer.value));
      await wait(2500);
      controlRequests = countRequests();
      attempt(() => map.removeLayer(controlLayer.value));
      await wait(300);
    }

    // 第三臂：在 hook 里**自己完成默认加载**（tile.src = url）——用来验证「包装能恢复默认加载」。
    // 没有这一臂，「观察面必须自己加载」就只是从「设了 hook 就没请求」推断出来的，而不是实测的。
    // 第三臂顺带做**形状诊断**：如果自己赋 src 也不产生请求，必须知道那块 tile 到底是什么
    // （不是 HTMLImageElement ⇒ 赋值是静默 no-op；是 image ⇒ 说明 SDK 的默认加载不是这一句）。
    const restoreCalls = [];
    const tileShape = { kind: null, tagName: null, isImage: null, srcTook: null, connected: null, complete: null, naturalWidth: null };
    let restoreTile = null;
    const restoreLayer = attempt(() => new window.BMap.TileLayer({
      tileUrlTemplate: tileUrl,
      tileLoadFunction: function (tile, url) {
        restoreCalls.push(url);
        if (!restoreTile) {
          restoreTile = tile;
          tileShape.kind = Object.prototype.toString.call(tile);
          tileShape.tagName = String(tile && tile.tagName);
          tileShape.isImage = typeof window.HTMLImageElement === "function" ? tile instanceof window.HTMLImageElement : null;
          tileShape.connected = !!(tile && tile.isConnected);
        }
        tile.src = url;
        if (restoreCalls.length === 1) tileShape.srcTook = String(tile.getAttribute ? tile.getAttribute("src") : "no-getAttribute") === url;
      },
    }));
    let restoreRequests = -1;
    if (!restoreLayer.threw) {
      resetRequests();
      attempt(() => map.addLayer(restoreLayer.value));
      await wait(2500);
      restoreRequests = countRequests();
      if (restoreTile) {
        tileShape.complete = restoreTile.complete;
        tileShape.naturalWidth = restoreTile.naturalWidth;
      }
      attempt(() => map.removeLayer(restoreLayer.value));
      await wait(300);
    }

    const calls = [];
    let silentTile = null;
    const hooked = attempt(() => new window.BMap.TileLayer({
      tileUrlTemplate: tileUrl,
      tileLoadFunction: function (tile, url) {
        calls.push(url);
        if (!silentTile) silentTile = tile;
        /* 刻意**不**给 tile.src 赋值：模拟「设了钩子但不接管加载」 */
      },
    }));
    if (hooked.threw) {
      report.tileLoadFunction = { threw: true, message: hooked.message };
    } else {
      resetRequests();
      attempt(() => map.addLayer(hooked.value));
      await wait(2500);
      // 判据看**元素自己的加载结果**，不是网络条目数：同名 URL 已在 HTTP 缓存里时，
      // Chrome 不产生新的 resource 条目（实测第三臂读成 0 次，而图片其实 naturalWidth=256 加载完了）。
      const silentOutcome = silentTile
        ? { complete: silentTile.complete, naturalWidth: silentTile.naturalWidth }
        : null;
      report.tileLoadFunction = {
        silentTileOutcome: silentOutcome,
        threw: false,
        calls: calls.length,
        sampleUrl: calls.length > 0 ? String(calls[0]).slice(0, 160) : null,
        sampleUrlHasMarker: calls.length > 0 ? String(calls[0]).indexOf(MARKER) >= 0 : null,
        requestsWithHook: countRequests(),
        requestsWithoutHook: controlRequests,
        requestsWhenHookLoadsItself: restoreRequests,
        restoreCalls: restoreCalls.length,
        restoreTileShape: tileShape,
      };
      attempt(() => map.removeLayer(hooked.value));
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__LAYER_EVENTS_PROBE__ = report;
})();
`;

/* ------------------------------------------------------------------ 判定 */

interface FamilyReading {
  id: string
  ctor: string
  ctorType: string
  addEventListener?: string
  removeEventListener?: string
  registration?: { threw: boolean; message?: string }
  addLayer?: { threw: boolean; message?: string }
  events?: Record<string, number>
  requestsDuringWindow?: number
  notes: string[]
}
interface EventsReport {
  phase: string
  sdk: Record<string, string> | null
  families: FamilyReading[]
  tileLoadFunction:
    | { threw: true; message?: string }
    | {
        threw: false
        calls: number
        sampleUrl: string | null
        sampleUrlHasMarker: boolean | null
        /** 第二臂（钩子什么都不做）那块瓦片的最终加载结果。 */
        silentTileOutcome: { complete: boolean; naturalWidth: number } | null
        requestsWithHook: number
        requestsWithoutHook: number
        /** 第三臂：hook 自己 `tile.src = url` 时窗口内的请求数（验证包装能恢复默认加载）。 */
        requestsWhenHookLoadsItself: number
        restoreCalls: number
      }
    | null
  /** 整轮实验的总开关：本页有没有真的从百度主机取到资源。 */
  baseMapRequests?: number
  error: string | null
  loadError?: string
}

/** 正证控件：读过数但「没有真的发请求」的家族，其「没有事件」这条读数无意义。 */
function controlFailures(report: EventsReport): string[] {
  const failures: string[] = []
  if ((report.baseMapRequests ?? 0) <= 0) {
    failures.push("底图基线为 0：本页根本没有从百度主机取到资源 ⇒ 整轮「无事件」结论不可判定")
  }
  const measurable = report.families.filter(
    (f) =>
      f.addEventListener !== undefined &&
      f.addLayer?.threw === false &&
      (f.requestsDuringWindow ?? 0) > 0,
  )
  if (measurable.length === 0) {
    failures.push("没有任何家族在窗口内发出瓦片请求 ⇒ 整轮「无事件」结论不可判定")
  }
  // 个别家族发不出请求（例如 TrafficLayer 需要授权的路况服务）**不算轮次失败**，但必须点名——
  // 「哪些家族真的测到了」是结论的适用范围，不能靠读者去数。
  const hook = report.tileLoadFunction
  if (hook && hook.threw === false && hook.requestsWithoutHook <= 0) {
    failures.push(
      "tileLoadFunction 对照跑（不带 hook）也是 0 次请求 ⇒ 「设了 hook 就不再加载」这条结论不可判定",
    )
  }
  return failures
}

function verdicts(report: EventsReport): string[] {
  const lines: string[] = []
  const withEntry = report.families.filter((f) => f.addEventListener !== undefined)
  const declared = report.families.filter((f) => f.addEventListener === "function")
  lines.push(
    `[事件入口] 有 addEventListener 的家族：${
      declared.length > 0 ? declared.map((f) => f.id).join(" / ") : "无"
    }（共 ${report.families.length} 个家族参与测量，${withEntry.length} 个暴露了该成员）`,
  )
  const unmeasurable = report.families.filter(
    (f) => f.addEventListener !== undefined && (f.requestsDuringWindow ?? 0) <= 0,
  )
  if (unmeasurable.length > 0) {
    lines.push(
      "[适用范围] 以下家族本轮窗口内没有发出瓦片请求，**未参与**「无事件」结论：" +
        unmeasurable.map((f) => f.id).join(" / "),
    )
  }
  const fired = report.families.filter((f) =>
    Object.values(f.events ?? {}).some((count) => count > 0),
  )
  lines.push(
    `[事件派发] 候选事件名里有回调被触发的家族：${
      fired.length > 0
        ? fired
            .map(
              (f) =>
                `${f.id}(${Object.entries(f.events ?? {})
                  .filter(([, c]) => c > 0)
                  .map(([name, c]) => `${name}×${c}`)
                  .join(",")})`,
            )
            .join(" / ")
        : "**无**（在请求确实发生过的前提下 ⇒ 「不发明未声明事件」这条口径有运行时依据）"
    }`,
  )
  const hook = report.tileLoadFunction
  if (hook && hook.threw === false) {
    const silentLoaded = (hook.silentTileOutcome?.naturalWidth ?? 0) > 0
    lines.push(
      `[tileLoadFunction 是否为接管式] 设了它、函数里什么都不做时，那块瓦片最终 ` +
        `complete=${String(hook.silentTileOutcome?.complete)} naturalWidth=${String(
          hook.silentTileOutcome?.naturalWidth,
        )} ⇒ ` +
        (silentLoaded
          ? "**观察式**：SDK 自己仍会加载 ⇒ 观察面可以直接用它"
          : "**接管式**：SDK 不再自己加载 ⇒ 观察面必须在内部完成加载"),
    )
    lines.push(
      `[包装能否恢复默认加载] 在钩子里自己赋 tile.src（被调用 ${hook.restoreCalls} 次）：` +
        `${JSON.stringify(hook.restoreTileShape)} ⇒ ` +
        ((hook.restoreTileShape?.naturalWidth ?? 0) > 0
          ? "**可以**：瓦片真的加载出来了（以元素自身结果为准，不看网络条目数）"
          : "**不能**：元素最终没有解码出像素 ⇒ 观察面这条路走不通"),
    )
    lines.push(
      `[网络条目数（仅参考，缓存命中时不可信）] 对照 ${hook.requestsWithoutHook} 次 / 静默钩子 ` +
        `${hook.requestsWithHook} 次 / 自加载钩子 ${hook.requestsWhenHookLoadsItself} 次`,
    )
  } else if (hook) {
    lines.push(`[tileLoadFunction 语义] 构造抛错：${hook.message}`)
  }
  return lines
}

function redact(text: string): string {
  const trimmed = ak.trim()
  return trimmed ? text.split(trimmed).join("***") : text
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:layer-events`")
    return 2
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`)
    return 2
  }

  const pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak))
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript)
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`)
    return 2
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>layer events probe</title></head>
<body><script>${pageScript}</script></body></html>`

  const userDataDir = mkdtempSync(join(tmpdir(), "layer-events-chrome-"))
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(pageHtml)
  })
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()))
  const address = server.address()
  if (address === null || typeof address === "string") {
    console.error("[layer-events] 服务未就绪（脚手架失败）")
    return 2
  }
  const baseUrl = `http://localhost:${address.port}/`

  let chrome: ChildProcess | null = null
  let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null
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
    )

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
        const list = (await (
          await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
        ).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>
        target = list.find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl))
        if (target?.webSocketDebuggerUrl) break
      } catch {
        /* CDP 还没起来 */
      }
      if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时")
      await sleep(300)
    }

    session = await connectCdpSession(target!.webSocketDebuggerUrl!, {
      deadline: Date.now() + 240_000,
      commandTimeoutMs: 30_000,
    })
    const report = await readProbeReport<EventsReport>(session, {
      expression: "window.__LAYER_EVENTS_PROBE__ ? JSON.stringify(window.__LAYER_EVENTS_PROBE__) : null",
      deadline: Date.now() + 180_000,
      pollIntervalMs: 500,
    })
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__LAYER_EVENTS_PROBE__")
      return 2
    }

    console.log("== 网络图层事件面与加载观察面探针 ==")
    console.log(
      `SDK：${JSON.stringify(report.sdk)}  页面阶段：${report.phase}  底图资源请求：${String(
        report.baseMapRequests,
      )}`,
    )
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`)
    for (const family of report.families) {
      console.log(
        `  ${family.id.padEnd(9)} ctor=${family.ctorType.padEnd(9)} addEventListener=${String(
          family.addEventListener,
        ).padEnd(10)} 请求=${String(family.requestsDuringWindow)} 事件=${JSON.stringify(family.events ?? {})} ${
          family.notes.join("; ")
        }`,
      )
    }
    console.log(`  tileLoadFunction: ${JSON.stringify(report.tileLoadFunction)}`)
    console.log("-- 结论 --")
    const lines = verdicts(report)
    for (const line of lines) console.log(`  ${line}`)

    const failures = controlFailures(report)
    if (failures.length > 0) {
      console.error("-- 正证控件不成立（本轮无法判定）--")
      for (const failure of failures) console.error(`  ${failure}`)
      return 1
    }
    if (report.phase !== "done") return 3

    if (outPath) {
      writeFileSync(outPath, redact(JSON.stringify(report, null, 2)))
      console.log(`原始报告（已脱敏）写入 ${outPath}`)
    }
    console.log(`summary: ${redact(lines.join(" | "))}`)
    return 0
  } finally {
    session?.close()
    chrome?.kill()
    server.close()
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[layer-events] 脚手架失败：${redact(String(error))}`)
  return 2
})
