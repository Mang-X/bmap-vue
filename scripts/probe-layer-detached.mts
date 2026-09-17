#!/usr/bin/env node
/**
 * detached 图层运行时契约探针（issue #98 / 承接 #40 的 ADR 决策 12b、13、14）
 *
 * 上游类型包与官方 API 参考对下面两件事**没有任何说法**，而图层生命周期内核依赖它们：
 *
 * 1. **`map.removeLayer()` 对已经摘掉的图层是否安全**（ADR 决策 12b 的前提 P）：三态挂载收敛
 *    （`unknown` ⇒ 先 best-effort 摘一次、再挂）会对一个可能已经不在图上的图层再调一次
 *    `removeLayer`。若真实 SDK 在这里抛错，收敛就不会发生（见已知限制 14）。
 * 2. **`DOMLayer.removeAllOverlays()` 在 detached 实例上是否生效**（ADR 已知限制 13）：内核在
 *    永久销毁时会对已经摘下的 DOM 图层调它（策略是 best-effort）。若它无效，`visible=false`
 *    之后卸载这条**常规路径**会残留真实 DOM 节点。
 *
 * 另外顺带核对官方 reference 对 `GeoJSONLayer.clearData()` 的那句断言——「`removeLayer` 之后
 * 图层不再持有 Map 引用，所以要真正清空 `getData()` 集合得在 `removeLayer` **之前**调」——
 * 它是内核「detached 时跳过该清空」这条决策的直接依据（ADR 决策 12）。
 *
 * ## 为什么读数是**差分**的
 *
 * 「摘下之后清空还有效吗」这个问题，只有拿**同一个实例**在「刚 detach」与「调用清空之后」两个
 * 时刻的读数相减才答得了。单看一个时刻无法区分「清空无效」与「本来就没有东西可清」。
 * 因此每个对象都取三段读数：**attached（正证控件）/ 刚 detach / 调用清空之后**。
 * attached 那一段是**正证控件**：它若不成立（例如 DOM 节点根本没进文档），后面两段的结论都不成立，
 * 探针判 `fail` 而不是给出一个看似通过的读数。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 全部读数取到，且每段的正证控件成立 | 0 |
 * | `fail` | 有正证控件不成立（本轮实验**无法判定**，不是「SDK 行为不好」） | 1 |
 * | `blocked` | SDK 没起来 / 地图建不出来（AK、网络、浏览器不成立） | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * 注意 `pass` **不表示**「我们的策略是对的」——它只表示「这一轮读数可用」。策略结论由读数本身
 * 决定，探针会把两个前提的**读数→结论**映射打印出来。
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-plugin-runtime.mts` 同一口径（ADR `2026-09-13-plugin-compat-inventory` 决策 8）：
 * 不登记进 `tests/browser/jsapi-v4` 的检查表、不进任何 CI job、不参与必需链路的放行判定。
 * 真实 SDK 的运行时行为不该让必需链路染红；结论的固化方式是写进 ADR 与
 * `.agents/skills/bmap-jsapi-v4/references/data-layers.md`。
 *
 * AK 从 `BAIDU_MAP_AK` 读、**不落库**；仓库里 `docs/.vitepress/theme/index.ts` 有一支已入库的
 * 浏览器端 AK，本地取证可以用它。输出里的 `ak=` 一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:layer-detached
 *   BAIDU_MAP_AK=<ak> pnpm probe:layer-detached -- --out=/tmp/layer-detached.json
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
 * 结构（每一步都写进 report，页面**任何**异常都落成 `report.error`）：
 *
 * 1. 加载 SDK（`v=4.0`）并等到 `BMap.Map` 是函数（入口脚本会再拉一次 getscript，成员后到）；
 * 2. 建图，建 GeoJSONLayer（2 个点）与 DOMLayer（2 个点）并分别 `setData` + `addLayer`；
 * 3. GeoJSON：取 attached 读数 → `removeLayer` ×2（读数 1 在第一次、读数 2 在**已摘下**时）
 *    → 取 detached 读数 → `clearData()` → 取清空后读数；
 * 4. DOM：同上，但清空入口是 `removeAllOverlays()`，并且额外计数**真实 DOM 节点**里还有几个
 *    仍然连在文档上（`el.isConnected`）——那才是「残留」的直接读数。
 *
 * ## ⚠️ 入口 URL 必须带 `callback=`（本探针第一版就死在这里）
 *
 * 不带 `callback` 时，`api?v=4.0&ak=` 返回的引导脚本用 **`document.write`** 注入 `getscript`；
 * 而**动态插入**的脚本在文档解析完成后执行 `document.write`会触发 `document.open()` ——
 * 整个文档（连同页面里的探测状态）被清空，`window.BMap` 再也不会有成员。
 * 症状是「入口脚本 onload 了、30 秒后 `BMap.Map` 仍不是函数」，很容易被误判成 AK / 网络问题。
 * 带 `callback=<全局函数名>` 时引导脚本改用 `createElement` + `apiLoad` 回调（官方 loader 就是这么做的）。
 * 这里的正证控件（`*_READING` 缺失即 fail）会挡住这种「什么都没测到却输出结论」的情况。
 *
 * 页面里**不出现反引号**（外层是 TS 模板串）。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = { phase: "boot", sdk: null, readings: [], console: [], error: null, loadError: null };

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 数组长度读数：拿不到就返回标识串，绝不抛（探针要的是读数，不是中断）。 */
  const len = (obj, method) => {
    try {
      const value = obj[method]();
      if (Array.isArray(value)) return value.length;
      return value === undefined ? "undefined" : String(value);
    } catch (error) {
      return "throw:" + String(error && error.message ? error.message : error);
    }
  };

  /** 调一次可能抛错的 SDK 方法，把「抛没抛 / 抛什么」变成读数。 */
  const attempt = (fn) => {
    try { fn(); return { threw: false, message: null }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error) }; }
  };

  const push = (id, extra) => { report.readings.push(Object.assign({ id: id }, extra)); };

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapLayerProbeReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapLayerProbeReady";
    script.onerror = () => { report.loadError = "SDK 入口脚本加载失败（script error）"; };
    document.head.appendChild(script);
    await Promise.race([readyPromise, wait(60000)]);
    for (let i = 0; i < 150; i++) {
      if (window.BMap && typeof window.BMap.Map === "function") break;
      await wait(200);
    }
    if (!(window.BMap && typeof window.BMap.Map === "function")) {
      throw new Error("BMap.Map 未就绪（入口脚本已加载但成员没挂上）；loadError=" + String(report.loadError));
    }
    report.sdk = {
      version: String(window.BMap.version),
      geojsonLayer: typeof window.BMap.GeoJSONLayer,
      domLayer: typeof window.BMap.DOMLayer,
    };

    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:400px";
    document.body.appendChild(host);
    const map = new window.BMap.Map(host);
    map.centerAndZoom(new window.BMap.Point(116.404, 39.915), 13);
    await wait(600);

    const data = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [116.404, 39.915] }, properties: { id: "a" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [116.418, 39.922] }, properties: { id: "b" } },
      ],
    };

    /* ---------------------------------------------------------- GeoJSONLayer */
    const geo = new window.BMap.GeoJSONLayer("probe-geojson", { markerStyle: { width: 12, height: 12 } });
    geo.setData(data);
    map.addLayer(geo);
    await wait(900);
    push("geojson.attached", { threw: false, overlayCount: len(geo, "getData") });

    push("geojson.removeLayer#1", attempt(() => map.removeLayer(geo)));
    push("geojson.removeLayer#2.已摘下", attempt(() => map.removeLayer(geo)));
    push("geojson.detached", { threw: false, overlayCount: len(geo, "getData") });
    push("geojson.clearData.已detached", attempt(() => geo.clearData()));
    push("geojson.afterClearData", { threw: false, overlayCount: len(geo, "getData") });

    /* -------------------------------------------------------------- DOMLayer */
    const nodes = [];
    const dom = new window.BMap.DOMLayer(function (properties) {
      const element = document.createElement("div");
      element.textContent = String(properties.id);
      element.style.cssText = "width:16px;height:16px;background:#f00";
      nodes.push(element);
      return element;
    }, {});
    dom.setData(data);
    map.addLayer(dom);
    await wait(900);
    const connected = () => nodes.filter((element) => element.isConnected).length;
    push("dom.attached", { threw: false, created: nodes.length, connected: connected(), overlayCount: len(dom, "getCustomOverlays") });

    push("dom.removeLayer#1", attempt(() => map.removeLayer(dom)));
    push("dom.removeLayer#2.已摘下", attempt(() => map.removeLayer(dom)));
    push("dom.detached", { threw: false, created: nodes.length, connected: connected(), overlayCount: len(dom, "getCustomOverlays") });
    push("dom.removeAllOverlays.已detached", attempt(() => dom.removeAllOverlays()));
    push("dom.afterRemoveAllOverlays", { threw: false, created: nodes.length, connected: connected(), overlayCount: len(dom, "getCustomOverlays") });

    /* ------------------------------------------------------------ 瓦片家族 */
    // 三态挂载收敛是 kind 无关的，而 removeLayer 最常落在瓦片家族上，所以前提 P 的结论必须覆盖它。
    // 瓦片源指向百度自己的瓦片主机（与 smoke 同源），避免探针自己去撞一个不存在的域名。
    const tile = new window.BMap.TileLayer(
      "https://maponline0.bdimg.com/tile/?qt=tile&x={X}&y={Y}&z={Z}&styles=pl&scaler=1",
    );
    map.addLayer(tile);
    await wait(900);
    push("tile.removeLayer#1", attempt(() => map.removeLayer(tile)));
    push("tile.removeLayer#2.已摘下", attempt(() => map.removeLayer(tile)));

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__LAYER_DETACHED_PROBE__ = report;
})();
`;

/* ------------------------------------------------------------------ 判定 */

interface Reading {
  id: string
  threw?: boolean
  message?: string | null
  overlayCount?: number | string
  created?: number
  connected?: number
}
interface ProbeReport {
  phase: string
  sdk: Record<string, string> | null
  readings: Reading[]
  console: Array<{ level: string; text: string }>
  error: string | null
  loadError?: string
}

const CONTROL_READINGS = ["geojson.attached", "dom.attached"]

/** 正证控件：这些读数不成立 ⇒ 本轮实验无法判定（fail），而不是「SDK 行为不好」。 */
function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = []
  const byId = new Map(report.readings.map((r) => [r.id, r]))
  const geo = byId.get("geojson.attached")
  if (!geo || typeof geo.overlayCount !== "number" || geo.overlayCount <= 0) {
    failures.push(`geojson.attached 的 overlayCount 不是正数（得到 ${String(geo?.overlayCount)}）`)
  }
  const dom = byId.get("dom.attached")
  if (!dom || (dom.created ?? 0) <= 0) failures.push("dom.attached 没有创建出任何元素")
  // 「节点真的进了文档」是「残留」这个读数的前提：不成立就无法区分「没残留」与「本来就没进去」
  else if ((dom.connected ?? 0) <= 0) failures.push("dom.attached 的节点一个都没连到文档上")
  return failures
}

/** 把读数映射成两个前提的结论——这是本探针真正的产物。 */
function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]))
  const lines: string[] = []

  const geoSafe = byId.get("geojson.removeLayer#2.已摘下")
  const domSafe = byId.get("dom.removeLayer#2.已摘下")
  const tileSafe = byId.get("tile.removeLayer#2.已摘下")
  const safeVerdict = !geoSafe?.threw && !domSafe?.threw && !tileSafe?.threw
  lines.push(
    `[前提 P] 对已摘下的图层重复 removeLayer —— ` +
      `GeoJSON ${geoSafe?.threw ? `抛错（${geoSafe.message}）` : "未抛错"} / ` +
      `DOM ${domSafe?.threw ? `抛错（${domSafe.message}）` : "未抛错"} / ` +
      `Tile ${tileSafe?.threw ? `抛错（${tileSafe.message}）` : "未抛错"} ` +
      `⇒ ${safeVerdict ? "安全（可把前提 P 升级为已证事实）" : "**不安全**（三态收敛的该分支需要换机制）"}`,
  )

  const domBefore = byId.get("dom.detached")
  const domAfter = byId.get("dom.afterRemoveAllOverlays")
  const clearAttempt = byId.get("dom.removeAllOverlays.已detached")
  const before = typeof domBefore?.connected === "number" ? domBefore.connected : -1
  const after = typeof domAfter?.connected === "number" ? domAfter.connected : -1
  // 三分支必须**互斥且各自诚实**：`before === 0` 不是「清空无效」，而是「removeLayer 自己就摘干净了」——
  // 本探针第一版把它归进「未清掉」，得出一条与实际读数相反的结论（这正是「判定文案必须跟着读数走」）。
  const domVerdict =
    before < 0
      ? "读数缺失，无法判定"
      : before === 0
        ? "**无需清空**（`removeLayer` 已把节点从文档摘掉）；detached 调 `removeAllOverlays()` 是安全的 no-op"
        : after === 0
          ? "**有效**（detached 清空确实移除了节点 ⇒ 可固化为「不要求 attached」）"
          : "**无效**（detached 之后节点仍在文档上 ⇒ 永久销毁必须先补挂再清）"
  lines.push(
    `[DOM 摘除与清空] removeLayer 之后仍连在文档上的节点 ${String(domBefore?.connected)} 个；` +
      `再调 removeAllOverlays() ${clearAttempt?.threw ? `抛错（${clearAttempt.message}）` : "未抛错"}；` +
      `之后剩 ${String(domAfter?.connected)} 个 ⇒ ${domVerdict}`,
  )

  const geoDetached = byId.get("geojson.detached")
  const geoAfter = byId.get("geojson.afterClearData")
  lines.push(
    `[GeoJSON detached clearData] 摘掉后 getData() ${String(geoDetached?.overlayCount)} 条；` +
      `再调 clearData() 之后 ${String(geoAfter?.overlayCount)} 条 ⇒ ` +
      (geoAfter?.overlayCount === geoDetached?.overlayCount
        ? "**未清空**（印证 reference「要真正清空得在 removeLayer 之前调」⇒ 内核跳过它是正确的）"
        : "**被清空了**（reference 那句话与运行时不一致，需要据实修正）"),
  )
  return lines
}

function redact(text: string): string {
  const trimmed = ak.trim()
  return trimmed ? text.split(trimmed).join("***") : text
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:layer-detached`")
    return 2
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`)
    return 2
  }

  const pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak))
  // 页面脚本是拼出来的字符串，语法错的表现是「页面永远不写报告」——编译一次（不执行）立刻退 2。
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript)
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`)
    return 2
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>layer detached probe</title></head>
<body><script>${pageScript}</script></body></html>`

  const userDataDir = mkdtempSync(join(tmpdir(), "layer-detached-chrome-"))
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(pageHtml)
  })
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()))
  const address = server.address()
  if (address === null || typeof address === "string") {
    console.error("[layer-detached] 服务未就绪（脚手架失败）")
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
      deadline: Date.now() + 180_000,
      commandTimeoutMs: 30_000,
    })
    const report = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__LAYER_DETACHED_PROBE__ ? JSON.stringify(window.__LAYER_DETACHED_PROBE__) : null",
      deadline: Date.now() + 150_000,
      pollIntervalMs: 500,
    })
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__LAYER_DETACHED_PROBE__")
      return 2
    }

    console.log("== detached 图层运行时契约探针 ==")
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
  console.error(`[layer-detached] 脚手架失败：${redact(String(error))}`)
  return 2
})
