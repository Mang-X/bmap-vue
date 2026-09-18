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
 * ## 第三组读数：「再显示」能不能复用实例（内核的 hide -> show 路径）
 *
 * 严格按内核的 `addLayer -> setData` 顺序跑一遍 `DOMLayer`：挂载 + `setData`（2 个节点连在文档）
 * → `removeLayer`（0 个）→ **再 `addLayer`（仍是 0——内容不会自己回来）** → 补 `setData`
 * （**抛错**：`Cannot read properties of null (reading 'coordinate')`）→ 对照「换新实例」（2 个）。
 * 结论是 `removeLayer` 清空了图层持有的 Map 引用、实例不可复用，所以内核的「重新可见」改成了重建。
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
// 判定层（读数 → 结论）单独成模块：它是纯函数，由 `tests/behavior/v3-probe-verdicts.test.ts`
// 用合成报告直接驱动，所以「缺失读数 ⇒ 无法判定」这条口径是可回归验证的，不靠下次跑探针时肉眼看。
import { controlFailures, verdicts, type ProbeReport } from "./probe-layer-detached-verdicts.mts"

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

    // ---- 聚焦实验：**严格按内核顺序**跑一遍数据图层的「挂载 → 隐藏 → 再显示」 ----
    //
    // 内核顺序（useLayerResource 的 mount 路径）是：create → syncMounted（addLayer）→
    // 槽位同步（data 槽 → setData）。也就是说 **setData 发生在挂载之后**。
    // 本探针第一版把 setData 放在 addLayer 之前（非内核顺序），于是「再显示」那一段的读数
    // 可能归因于顺序而不是 SDK 行为 —— 所以这里另起一个实例，严格按内核顺序重跑。
    //
    // 要回答的问题：真实 SDK 上「隐藏（removeLayer）→ 再显示（addLayer）」之后
    // ① 内容会不会自己回来？② 如果不回来，补一次 setData 能不能救？
    const nodes3 = [];
    const dom3 = new window.BMap.DOMLayer(function (properties) {
      const element = document.createElement("div");
      element.textContent = String(properties.id);
      element.style.cssText = "width:16px;height:16px;background:#00f";
      nodes3.push(element);
      return element;
    }, {});
    const connected3 = () => nodes3.filter((element) => element.isConnected).length;
    const snapshot = (id, extra) =>
      push(id, Object.assign({ threw: false, created: nodes3.length, connected: connected3(), overlayCount: len(dom3, "getCustomOverlays") }, extra || {}));

    push("kernel.mount.addLayer", attempt(() => map.addLayer(dom3)));
    push("kernel.mount.setData", attempt(() => dom3.setData(data)));
    await wait(900);
    snapshot("kernel.mounted");

    push("kernel.hide.removeLayer", attempt(() => map.removeLayer(dom3)));
    await wait(400);
    snapshot("kernel.hidden");

    push("kernel.show.addLayer", attempt(() => map.addLayer(dom3)));
    await wait(900);
    snapshot("kernel.shown");

    push("kernel.repair.setData", attempt(() => dom3.setData(data)));
    await wait(900);
    snapshot("kernel.repaired");

    // GeoJSON 也按同一套内核顺序跑一遍：它是否与 DOM 一样「摘掉之后实例就废了」？
    // 这决定修法是「所有数据图层统一重建」还是「按 kind 分级」。
    const geo3 = new window.BMap.GeoJSONLayer("probe-kernel-order", {});
    const geoSnapshot = (id, extra) =>
      push(id, Object.assign({ threw: false, overlayCount: len(geo3, "getData") }, extra || {}));
    push("geojson.kernel.mount.addLayer", attempt(() => map.addLayer(geo3)));
    push("geojson.kernel.mount.setData", attempt(() => geo3.setData(data)));
    await wait(900);
    geoSnapshot("geojson.kernel.mounted");
    push("geojson.kernel.hide.removeLayer", attempt(() => map.removeLayer(geo3)));
    await wait(400);
    geoSnapshot("geojson.kernel.hidden");
    push("geojson.kernel.show.addLayer", attempt(() => map.addLayer(geo3)));
    await wait(900);
    geoSnapshot("geojson.kernel.shown");
    push("geojson.kernel.repair.setData", attempt(() => geo3.setData(data)));
    await wait(900);
    geoSnapshot("geojson.kernel.repaired");
    const geo4 = new window.BMap.GeoJSONLayer("probe-kernel-rebuild", {});
    // 按真实内核顺序（addLayer -> setData，与上面 DOM 的对照一致）：反过来写只能证明
    // 「新实例的集合可写入」，证不了内核重建走的那条路径（第七轮评审发现 3）。
    // ⚠️ 本段位于 PAGE_JS 模板串内部：注释里**不能出现反引号**（会截断外层模板串，
    // 报 ERR_INVALID_TYPESCRIPT_SYNTAX，而报错位置在被截断的下一行）。
    push("geojson.kernel.rebuild.addLayer", attempt(() => map.addLayer(geo4)));
    push("geojson.kernel.rebuild.setData", attempt(() => geo4.setData(data)));
    await wait(900);
    push("geojson.kernel.rebuilt", { threw: false, overlayCount: len(geo4, "getData") });

    // 对照：**换一个新实例**（内核的重建路径）能不能正常渲染 —— 决定「修法」是补 setData 还是换实例。
    const nodes4 = [];
    const dom4 = new window.BMap.DOMLayer(function (properties) {
      const element = document.createElement("div");
      element.textContent = String(properties.id);
      nodes4.push(element);
      return element;
    }, {});
    push("kernel.rebuild.addLayer", attempt(() => map.addLayer(dom4)));
    push("kernel.rebuild.setData", attempt(() => dom4.setData(data)));
    await wait(900);
    push("kernel.rebuilt", {
      threw: false,
      created: nodes4.length,
      connected: nodes4.filter((element) => element.isConnected).length,
      overlayCount: len(dom4, "getCustomOverlays"),
    });

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
    // **顺序要紧**：正证控件先判，成立之后才打印结论。反过来（先印「安全 / 可升级为已证事实」、
    // 再印「控件不成立、本轮无法判定」）会让日志前半段看起来像拿到了结论 —— 第六轮评审的同一类
    // 问题（措辞比证据强）在探针里也不能犯。
    const failures = controlFailures(report)
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --")
      for (const failure of failures) console.error(`  ${failure}`)
      console.error("（上面这些读数按「无法判定」对待：控件不成立时它们无意义）")
      return 1
    }
    if (report.phase !== "done") return 3

    console.log("-- 结论 --")
    const lines = verdicts(report)
    for (const line of lines) console.log(`  ${line}`)

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
