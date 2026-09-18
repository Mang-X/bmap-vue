#!/usr/bin/env node
/**
 * 原生批量点图层的**拾取载荷**运行时探针（issue #34）
 *
 * ## 为什么需要它：我们的用例是**循环论证**的
 *
 * `BPointCollection` 的 `item-click` 依赖一条**只在运行时成立**的约定：批量图层的拾取事件把命中要素
 * 放在 `event.value.dataItem.properties` 里。这条约定有两处依据，但都不足以当契约：
 *
 * | 来源 | 说法 |
 * | --- | --- |
 * | `@baidumap/jsapi-v4-types@4.0.4` 的 `NormalLayerPickEvent` | `value` 只声明成 **`object`**（字段是运行时约定） |
 * | 官方 Skill 的批量图层专页（`.agents/skills/.../visualization-layers.md`） | 用 `event.value.dataItem.properties.id` 取业务键；未命中时 `dataIndex === -1` |
 *
 * 而 Fake v4 的 `simulateNativePick()` **正是按这份假设造载荷的** —— 于是「组件用例全绿」证明不了
 * 真实 SDK 也这么派发。这个探针的作用就是**打破这个循环**：在真实 4.0 上点一下，把 raw 事件形状
 * 读出来，与实现假设逐字段对照。
 *
 * ## 四组读数
 *
 * 1. **SDK 成员**：`PointShapeLayer` / `PointIconLayer` / **`PointCollection`** 在 4.0 运行时是否存在。
 *    （最后一项有争议：官方 React 组件库 `huiyan-fe/react-bmap` 标注它「整体 @removed 4.0」，
 *    而本仓库 #22 的 ADR 记录「4.0 运行时存在」——两份仓库记录冲突时以**本次读数**为准。）
 * 2. **命中载荷**（正证控件）：在点的像素位置派发**真实**鼠标点击（CDP `Input.dispatchMouseEvent`），
 *    要求 `dataIndex !== -1`；拿不到命中就**不出结论**（`fail`），而不是把「没测到」写成「形状不对」。
 * 3. **未命中载荷**：在远离所有点的角落再点一次，核对「未命中也派发事件且 `value` 是真值」。
 * 4. **`setVisible(false)` 的语义**：显隐之后 `getData()` 是否还在（本库用 `setVisible` 表达
 *    `visible`，而不是摘掉图层 —— 依据里需要这一条）。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 两组点击都取到读数且命中那一次成功 | 0 |
 * | `fail` | 命中控件不成立（本轮**无法判定**），或载荷形状与实现假设**不符** | 1 |
 * | `blocked` | SDK / 地图没起来（AK、网络、浏览器不成立） | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-plugin-runtime.mts` / `probe-layer-detached.mts` 同一口径：不登记进
 * `tests/browser/jsapi-v4`、不进任何 CI job、不参与必需链路的放行。结论的固化方式是写进 ADR 与
 * 数据组件文档。AK 从 `BAIDU_MAP_AK` 读、不落库（仓库里 `docs/.vitepress/theme/index.ts`
 * 有一支已入库的浏览器端 AK，本地取证可以用它）；输出里的 `ak=` 一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:point-pick
 *   BAIDU_MAP_AK=<ak> pnpm probe:point-pick -- --out=/tmp/point-pick.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const outPath = argValue("out") ?? "";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 页面里的每一步都写进 `report.readings`（断言的是读数，不是「有没有抛错」）。
 *
 * 阶段：`boot` → `ready`（等外部两次点击）→ `done`。编排侧在 `ready` 时派发真实点击，
 * 因此点击**必须**由 CDP 派发（真实事件），不能靠 `element.click()`（合成事件）。
 *
 * ⚠️ 本模板串里**不得出现反引号**（会截断外层 TS 模板串），由
 * `tests/behavior/v3-probe-page-scripts.test.ts` 静态守卫。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = { phase: "boot", sdk: null, readings: [], picks: [], clickCount: 0, console: [], error: null, loadError: null };

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const push = (id, extra) => { report.readings.push(Object.assign({ id: id }, extra)); };

  /** SDK 方法调用的读数：把「抛没抛 / 抛什么 / 返回什么」变成可断言的对象。 */
  const attempt = (fn) => {
    try { return { threw: false, message: null, value: fn() }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error), value: null }; }
  };

  /** 只保留 JSON 安全的浅层摘要（探针报告要能序列化）。 */
  const summarizeValue = (value) => {
    if (value === null) return { kind: "null" };
    if (value === undefined) return { kind: "undefined" };
    if (typeof value !== "object") return { kind: typeof value, text: String(value) };
    const keys = Object.keys(value);
    const dataItem = value.dataItem;
    const properties = dataItem && typeof dataItem === "object" ? dataItem.properties : undefined;
    return {
      kind: "object",
      keys: keys,
      dataIndex: typeof value.dataIndex === "number" ? value.dataIndex : String(value.dataIndex),
      dataItemKind: dataItem === undefined ? "undefined" : dataItem === null ? "null" : typeof dataItem,
      dataItemKeys: dataItem && typeof dataItem === "object" ? Object.keys(dataItem) : [],
      propertiesKeys: properties && typeof properties === "object" ? Object.keys(properties) : [],
      propertiesId: properties && typeof properties === "object" ? String(properties.id) : "n/a",
    };
  };

  const summarizePick = (event) => ({
    type: event && event.type !== undefined ? String(event.type) : "n/a",
    topKeys: event && typeof event === "object" ? Object.keys(event) : [],
    hasPixel: !!(event && event.pixel),
    pixel: event && event.pixel ? { x: event.pixel.x, y: event.pixel.y } : null,
    hasLatLng: !!(event && event.latLng),
    latLng: event && event.latLng ? { lng: event.latLng.lng, lat: event.latLng.lat } : null,
    value: summarizeValue(event ? event.value : undefined),
  });

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapPointPickProbeReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapPointPickProbeReady";
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

    // 读数 1：成员存在性（含 PointCollection 这一条有争议的事实）
    report.sdk = {
      version: String(window.BMap.version),
      pointShapeLayer: typeof window.BMap.PointShapeLayer,
      pointIconLayer: typeof window.BMap.PointIconLayer,
      pointCollection: typeof window.BMap.PointCollection,
      shapeTypeEnum: window.BMap.PointShapeLayer && window.BMap.PointShapeLayer.ShapeType ? Object.keys(window.BMap.PointShapeLayer.ShapeType).join(",") : "n/a",
    };

    document.body.style.margin = "0";
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;width:600px;height:400px";
    document.body.appendChild(host);
    const map = new window.BMap.Map(host);
    const CENTER = { lng: 116.404, lat: 39.915 };
    const FAR = { lng: 116.30, lat: 39.85 };
    map.centerAndZoom(new window.BMap.Point(CENTER.lng, CENTER.lat), 13);
    await wait(1200);

    const data = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [CENTER.lng, CENTER.lat] }, properties: { id: "a", name: "中心点" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [FAR.lng, FAR.lat] }, properties: { id: "b", name: "远点" } },
      ],
    };

    const layer = new window.BMap.PointShapeLayer({
      idKey: "id",
      enablePicked: true,
      style: { shapeType: 0, size: 28, color: "#d93025", strokeColor: "#ffffff", strokeWeight: 2 },
    });
    const picks = [];
    layer.addEventListener("click", function (event) {
      picks.push(summarizePick(event));
      report.picks = picks;
      report.clickCount = picks.length;
    });
    map.addLayer(layer);
    layer.setData(data);
    await wait(1500);

    push("layer.state.afterSetData", Object.assign({ dataType: typeof layer.getData(), visible: attempt(() => layer.getVisible()).value }, {}));
    const dataShape = attempt(() => layer.getData());
    push("layer.getData.shape", { threw: dataShape.threw, message: dataShape.message, keys: dataShape.value && typeof dataShape.value === "object" ? Object.keys(dataShape.value).slice(0, 8) : String(dataShape.value) });

    // 命中位置：用官方 pointToPixel 换算，而不是猜像素
    const centerPixel = attempt(() => map.pointToPixel(new window.BMap.Point(CENTER.lng, CENTER.lat)));
    push("map.pointToPixel", { threw: centerPixel.threw, message: centerPixel.message, pixel: centerPixel.value ? { x: centerPixel.value.x, y: centerPixel.value.y } : null });
    if (centerPixel.threw || !centerPixel.value) throw new Error("pointToPixel 不可用，无法定位命中点");

    const rect = host.getBoundingClientRect();
    report.clickTargets = [
      { label: "hit", x: Math.round(rect.left + centerPixel.value.x), y: Math.round(rect.top + centerPixel.value.y) },
      // 未命中点刻意避开左下 / 右上：那里通常是比例尺、版权与导航控件，点击会被它们吃掉
      { label: "miss", x: Math.round(rect.left + 500), y: Math.round(rect.top + 60) },
    ];

    report.phase = "ready";
    window.__POINT_PICK_PROBE__ = report;

    // 等编排侧派发**两次真实点击**（命中 + 未命中）；超时也继续，读数里会体现出来
    const startedAt = Date.now();
    while (report.clickCount < 2 && Date.now() - startedAt < 15000) await wait(300);

    // 声明面里还有一条可对照的入口：getPickedItem(index, model)
    const picked = attempt(() => layer.getPickedItem(0, "onclick"));
    push("layer.getPickedItem(0,onclick)", {
      threw: picked.threw,
      message: picked.message,
      keys: picked.value && typeof picked.value === "object" ? Object.keys(picked.value) : String(picked.value),
      dataIndex: picked.value && typeof picked.value === "object" ? picked.value.dataIndex : "n/a",
      dataItemPropertiesId:
        picked.value && picked.value.dataItem && picked.value.dataItem.properties
          ? String(picked.value.dataItem.properties.id)
          : "n/a",
    });

    // setVisible(false) 之后数据是否还在（本库用 setVisible 表达 visible 的依据）
    const hide = attempt(() => layer.setVisible(false));
    await wait(400);
    const afterHide = attempt(() => layer.getVisible());
    const dataAfterHide = attempt(() => layer.getData());
    push("layer.setVisible(false)", {
      threw: hide.threw,
      message: hide.message,
      visibleAfter: afterHide.value,
      dataStillPresent: dataAfterHide.value !== null && dataAfterHide.value !== undefined,
    });

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__POINT_PICK_PROBE__ = report;
})();
`;

interface ProbeReport {
  phase: string;
  sdk: Record<string, unknown> | null;
  readings: Array<Record<string, unknown>>;
  picks: Array<Record<string, unknown>>;
  clickCount: number;
  clickTargets?: Array<{ label: string; x: number; y: number }>;
  console: Array<{ level: string; text: string }>;
  error: string | null;
  loadError: string | null;
}

function redact(text: string): string {
  const trimmed = ak.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

/* ------------------------------------------------------------------ 判定 */

/** 正证控件：不成立就**不出结论**（不是「SDK 行为不好」）。 */
function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = [];
  if (report.clickCount < 2) {
    failures.push(`只收到 ${report.clickCount} 次点击事件（需要命中 + 未命中各一次）：本轮无法判定`);
    return failures;
  }
  const hit = report.picks.find((pick) => (pick.value as { dataIndex?: unknown } | undefined)?.dataIndex !== -1);
  if (!hit) failures.push("两次点击都没命中要素（dataIndex 全是 -1）：命中路径本轮无法判定");
  return failures;
}

/** 读数 → 结论（三态：确认 / 与假设不符 / 无法判定）。 */
function verdicts(report: ProbeReport): string[] {
  const lines: string[] = [];
  const hit = report.picks.find((pick) => (pick.value as { dataIndex?: unknown } | undefined)?.dataIndex !== -1);
  const miss = report.picks.find((pick) => (pick.value as { dataIndex?: unknown } | undefined)?.dataIndex === -1);

  if (hit) {
    const value = hit.value as { dataIndex?: unknown; dataItemKeys?: string[]; propertiesId?: string } | undefined;
    const expected = value?.propertiesId === "a";
    lines.push(
      `命中载荷：value.dataIndex=${String(value?.dataIndex)} dataItemKeys=[${(value?.dataItemKeys ?? []).join(",")}] properties.id=${String(value?.propertiesId)}`,
    );
    lines.push(
      expected
        ? "结论：命中要素的业务键确实在 value.dataItem.properties 上 —— 与实现假设（pick → properties[idKey]）一致"
        : "结论：**与实现假设不符** —— value.dataItem.properties 里没有我们写入的业务键（实现需要改）",
    );
  } else {
    lines.push("命中载荷：未取到（无法判定）");
  }

  if (miss) {
    const value = miss.value as { kind?: string; dataIndex?: unknown } | undefined;
    lines.push(
      `未命中载荷：value.kind=${String(value?.kind)} dataIndex=${String(value?.dataIndex)}（官方口径：未命中也派发事件且 value 是真值）`,
    );
  } else {
    lines.push("未命中载荷：未取到（无法判定）");
  }

  const hide = report.readings.find((reading) => reading.id === "layer.setVisible(false)");
  lines.push(
    hide
      ? `setVisible(false)：visibleAfter=${String(hide.visibleAfter)} dataStillPresent=${String(hide.dataStillPresent)}`
      : "setVisible(false)：未取到（无法判定）",
  );

  const picked = report.readings.find((reading) => reading.id === "layer.getPickedItem(0,onclick)");
  lines.push(
    picked
      ? `getPickedItem(0,'onclick')：threw=${String(picked.threw)} keys=[${String(picked.keys)}] dataIndex=${String(picked.dataIndex)} properties.id=${String(picked.dataItemPropertiesId)}`
      : "getPickedItem(0,'onclick')：未取到（无法判定）",
  );

  return lines;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:point-pick`");
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
<html><head><meta charset="utf-8"><title>point pick probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "point-pick-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[point-pick] 服务未就绪（脚手架失败）");
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
        "--window-size=800,600",
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

    // 第一阶段：等页面进入 ready（图层就绪、点击目标算好）
    const ready = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__POINT_PICK_PROBE__ && window.__POINT_PICK_PROBE__.phase === 'ready' ? JSON.stringify(window.__POINT_PICK_PROBE__) : null",
      deadline: Date.now() + 120_000,
      pollIntervalMs: 500,
    });
    if (!ready) {
      console.error("PROBE_NOT_READY：页面没有进入 ready（SDK / 地图 / 图层没起来）");
      return 3;
    }
    console.log("== 原生批量点图层拾取载荷探针 ==");
    console.log(`SDK：${JSON.stringify(ready.sdk)}`);
    for (const reading of ready.readings) {
      console.log(`  ${String(reading.id).padEnd(32)} ${JSON.stringify(reading)}`);
    }

    // 第二阶段：派发**真实**鼠标点击（CDP 的 trusted 事件；合成 click 不能代表用户操作）
    for (const target2 of ready.clickTargets ?? []) {
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: target2.x,
        y: target2.y,
        button: "none",
        clickCount: 0,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: target2.x,
        y: target2.y,
        button: "left",
        clickCount: 1,
      });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: target2.x,
        y: target2.y,
        button: "left",
        clickCount: 1,
      });
      console.log(`  已派发真实点击 [${target2.label}] @ (${target2.x}, ${target2.y})`);
      await sleep(700);
    }

    const report = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__POINT_PICK_PROBE__ && window.__POINT_PICK_PROBE__.phase === 'done' ? JSON.stringify(window.__POINT_PICK_PROBE__) : null",
      deadline: Date.now() + 60_000,
      pollIntervalMs: 400,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有在点击之后收尾");
      return 3;
    }

    console.log(`页面阶段：${report.phase} 点击次数：${report.clickCount}`);
    for (const pick of report.picks) {
      console.log(`  拾取事件：${JSON.stringify(pick)}`);
    }
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`);

    for (const reading of report.readings) console.log(`  ${String(reading.id).padEnd(32)} ${JSON.stringify(reading)}`);

    const failures = controlFailures(report);
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --");
      for (const failure of failures) console.error(`  ${failure}`);
      return 1;
    }
    if (report.phase !== "done") return 3;

    console.log("-- 结论 --");
    const lines = verdicts(report);
    for (const line of lines) console.log(`  ${line}`);
    if (outPath) {
      writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      console.log(`原始报告（已脱敏）写入 ${outPath}`);
    }
    console.log(`summary: ${redact(lines.join(" | "))}`);
    const mismatch = lines.some((line) => line.includes("与实现假设不符"));
    return mismatch ? 1 : 0;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[point-pick] 脚手架失败：${redact(String(error))}`);
  return 2;
});
