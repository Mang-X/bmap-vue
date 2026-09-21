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
 * 本脚本是**证据生成器 + 可选插件门禁**，不是 smoke harness 的插件页：它不登记进
 * `tests/browser/jsapi-v4` 的检查表、不参与必需链路的放行判定。把插件脚本塞进必需页面会让
 * 跨域脚本异常直接染红必需链路——那正是决策 8 要避免的。
 *
 * #43 起它**单独**进 nightly（`plugin-runtime` job）：可选插件的结论要能每天被核对，但与
 * required smoke 分属两个 job，任一插件脚本抖动都不会影响必需链路的判定。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 每次读数都与 inventory 记录的 `runtime.status` 一致，且独立性断言成立 | 0 |
 * | `fail` | 独立性被打破；或读数与 inventory 不一致（inventory 已过期）；或**未登记过**的运行时抛错 | 1 |
 * | `blocked` | SDK 没起来 / 脚本取不到（AK、网络、浏览器不成立）、最小路径 invariant 不成立 ⇒ 本轮无法判定 | 3 |
 * | 脚手架失败 | 读不到数据模块 / 找不到浏览器 / 页面没写报告 | 2 |
 *
 * ⚠️ **已登记的 `threw` 不算 fail**（#43 修正）：MapVGL 的结论就是「它在 4.0 上抛错」，
 * 旧规则会让这个探针永远红。详见 `scripts/plugin-runtime-report.mts` 的说明。
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
import {
  decidePluginRuntimeExitCode,
  formatPluginRuntimeSummary,
  PLUGIN_SPECS,
  type PluginRuntimeRun,
} from "./plugin-runtime-report.mts"

const repoRoot = resolve(import.meta.dirname, "..")
const ak = process.env.BAIDU_MAP_AK ?? ""

const builtins = (await import(freshModuleUrl(resolve(repoRoot, "packages/baidu-map-gl-vue/src/plugins/builtins.ts")))) as {
  BUILTIN_PLUGIN_URLS: Record<string, string>
}
const urls = builtins.BUILTIN_PLUGIN_URLS

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

    // 每个 probe 自己判定「最小路径 invariant」，并返回**结构化小结**（评审 #85 第三轮）：
    // 「脚本加载了、全局存在、没抛错」不等于「跑通了该插件的最小功能路径」。
    function okCheck(name, condition, detail) {
      return { name: name, ok: !!condition, detail: detail || null };
    }
    // 第三参 readings 是**不进判定**的补充读数（M8-ADAPTERS-ADVANCED / #43）：
    // 只有「在真实 4.0 上确定会成立」的性质才配进 checks；结果未知的观察进 readings。
    function verified(detail, checks, readings) {
      return { status: "verified", detail: detail, checks: checks, readings: readings };
    }
    function inconclusive(reason, detail, checks, readings) {
      return {
        status: "inconclusive",
        reason: reason,
        detail: detail || null,
        checks: checks || [],
        readings: readings,
      };
    }
    function allOk(checks) {
      return checks.every(function (c) { return c.ok; });
    }

    // 真实指针输入（#43）：DrawingManager 的绘制链路只认「SDK 归一化后的鼠标事件」，
    // 所以驱动它必须发**真实 DOM 指针事件**，而不是调库的私有方法。
    // 事件类型按脚本自己的检测口径选（PointerEvent 且设备报告触摸点时才用 pointer*）——
    // 口径抄自产物里那段「三种事件名映射成 mousedown/mousemove/mouseup」的分支，别按名字猜。
    var pointerMode = !!(window.PointerEvent || window.MSPointerEvent) &&
      ((navigator.maxTouchPoints || 0) > 0 || (navigator.msMaxTouchPoints || 0) > 0);
    var DOWN_EVENT = pointerMode ? "pointerdown" : "mousedown";
    var MOVE_EVENT = pointerMode ? "pointermove" : "mousemove";

    // 按容器内的**相对位置**开枪：默认打 elementFromPoint 命中的元素，事件随后冒泡上去。
    // targetEl 可显式指定接收者 —— 绘制链路里工具条 / 提示 Label 会盖在掩膜上，
    // 用「按下时命中的那个元素」继续发后续事件，才与真实用户在同一次绘制里的接收者一致。
    function fireAt(rect, fx, fy, type, buttons, detail, targetEl) {
      var x = rect.left + rect.width * fx;
      var y = rect.top + rect.height * fy;
      var target = targetEl || document.elementFromPoint(x, y) || div;
      var init = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: buttons,
        detail: detail || 0,
      };
      var ev = pointerMode ? new PointerEvent(type, init) : new MouseEvent(type, init);
      target.dispatchEvent(ev);
      return { x: Math.round(x), y: Math.round(y), target: String(target.tagName || "") };
    }

    // 抛错点定位（MapVGL 的根因）：从 stack 里取「文件:行:列」，回到产物原文里剪一段出来。
    // 只读不解释：把现场交给报告，避免在探针里写一句未经核对的因果。
    async function throwSite(url, stackHead) {
      // 刻意用 [0-9] 而**不是**反斜杠 d：本段文本既会被探针当模板串求值（反斜杠会少一层），
      // 也会被静态守卫 v3-probe-page-scripts.test.ts 当成**原文**用 new Function 编译一次。
      // 只有「两种读法都合法」的写法才安全 —— 转义换行的那两处恰好两种读法都对，
      // 而反斜杠 d / 反斜杠右括号不是，所以这里一个反斜杠都不用。别改回去。
      var m = /:([0-9]+):([0-9]+)[)]?$/.exec(String(stackHead || "").trim());
      if (!m) return { located: false, stackHead: String(stackHead || "") };
      var lineNo = Number(m[1]);
      var column = Number(m[2]);
      try {
        var text = await (await fetch(url)).text();
        var lines = text.split("\\n");
        var line = lines[lineNo - 1] || "";
        return {
          located: true,
          line: lineNo,
          column: column,
          lineLength: line.length,
          excerpt: line.slice(Math.max(0, column - 120), column + 160),
        };
      } catch (e) {
        // 取不到原文时**不把缺失藏起来**：located 说的是「栈里解析出了行列号」，
        // 而 excerpt 显式给 null（而不是干脆没有这个键）——否则读者会以为摘到了现场。
        return { located: true, line: lineNo, column: column, excerpt: null, fetchError: msg(e) };
      }
    }

    var probes = {
      TrackAnimation: async function () {
        var C = getPath("BMapGLLib.TrackAnimation");
        if (typeof C !== "function") return inconclusive("构造器不是 function", { ctorType: typeof C });
        var before = polyline.getPath().length;
        var zoomBefore = map.getZoom();
        // onAnimateEnd 是**构造选项**（产物里 _initOpts 直接把它收进 _opts），不是私有成员。
        // 用它观察「播放到结尾」这条分支；读数进 readings，是否成立不影响 status。
        var pathAtAnimateEnd = null;
        var ta = new C(map, polyline, {
          duration: 2000,
          overallView: false,
          onAnimateEnd: function () {
            if (pathAtAnimateEnd === null) pathAtAnimateEnd = polyline.getPath().length;
          },
        });
        ta.start();
        await sleep(400);
        var afterStart = polyline.getPath().length;
        var zoomDuring = map.getZoom();
        ta.pause();
        await sleep(150);
        var atPause = polyline.getPath().length;
        await sleep(400);
        var afterPauseWait = polyline.getPath().length;
        ta.continue();
        await sleep(400);
        var afterContinue = polyline.getPath().length;
        // setSpeed 依赖上游**未声明**的 ViewAnimation 私有成员（animation / _options /
        // _beginTime 与 setBeginTime / setDuration）。它在 4.0 上到底有没有入口，
        // 此前只是「依据不足」；这里在**运行中**如实测一次，结果进 readings —— 抛出也是一种结论。
        var setSpeedError = null;
        try { ta.setSpeed(2); } catch (e) { setSpeedError = msg(e); }
        await sleep(200);
        var afterSetSpeed = polyline.getPath().length;
        // 播放到结尾：轮询到 path 连续 800ms 不再变化为止（duration=2000，上限 8s）。
        // 这条**不设门禁**：轮询到稳定的判定本身近乎恒真，写进 checks 只会制造一条没有区分力的
        // 断言（ADR 2026-09-21 的取舍）；它的价值是 readings 里的结尾长度与 onAnimateEnd 是否回调。
        var lastLength = afterSetSpeed;
        var stableSince = null;
        var elapsed = 0;
        for (var w = 0; w < 40; w++) {
          await sleep(200);
          elapsed += 200;
          var sampled = polyline.getPath().length;
          if (sampled === lastLength) {
            if (stableSince === null) stableSince = elapsed;
          } else {
            stableSince = null;
            lastLength = sampled;
          }
          if (stableSince !== null && elapsed - stableSince >= 800) break;
        }
        var pathAfterPlayback = polyline.getPath().length;
        ta.cancel();
        var readings = {
          pathBefore: before,
          pathAfterStart: afterStart,
          zoomBefore: zoomBefore,
          zoomDuringAnim: zoomDuring,
          pathAtPause: atPause,
          pathAfterPauseWait: afterPauseWait,
          pathAfterContinue: afterContinue,
          pathAfterSetSpeed: afterSetSpeed,
          setSpeedError: setSpeedError,
          pathAfterPlayback: pathAfterPlayback,
          playbackStableAfterMs: stableSince === null ? null : elapsed,
          animateEndFired: pathAtAnimateEnd !== null,
          pathAtAnimateEnd: pathAtAnimateEnd,
        };
        var checks = [
          okCheck("path 增长（start 真的驱动了动画）", afterStart > before, {
            before: before,
            afterStart: afterStart,
          }),
          okCheck("视角跟随（zoom 发生变化）", Math.abs(zoomDuring - zoomBefore) > 1e-6, {
            zoomBefore: zoomBefore,
            zoomDuringAnim: zoomDuring,
          }),
          okCheck("pause 真的停住（400ms 内 path 不再变化）", afterPauseWait === atPause, {
            pathAtPause: atPause,
            pathAfterPauseWait: afterPauseWait,
          }),
          okCheck("continue 真的继续（path 继续增长）", afterContinue > afterPauseWait, {
            pathAfterPauseWait: afterPauseWait,
            pathAfterContinue: afterContinue,
          }),
        ];
        if (!allOk(checks)) return inconclusive("最小路径 invariant 不成立", null, checks, readings);
        return verified(readings, checks, readings);
      },
      DrawingManager: async function () {
        var C = getPath("BMapGLLib.DrawingManager");
        if (typeof C !== "function") return inconclusive("构造器不是 function", { ctorType: typeof C });
        // confirmVisible: false 是**公开构造选项**（产物里的判定是 t.confirmVisible !== false）。
        // 缺省为 true 时，画完会先插入确认面板、等用户点「确定」才 complete；本探针要证的是
        // 「绘制链路能画出几何体」，不是那个确认面板，所以显式关掉它 —— 不是绕过校验。
        var dm = new C(map, {
          isOpen: false,
          confirmVisible: false,
          enableCalculate: true,
          enableGpc: true,
        });
        var modeInitial = typeof dm.getDrawingMode === "function" ? dm.getDrawingMode() : null;
        if (typeof dm.enableCalculate === "function") dm.enableCalculate();
        if (typeof dm.enableGpc === "function") dm.enableGpc();
        await sleep(1200);
        var injected = [];
        var scripts = document.scripts;
        for (var i = 0; i < scripts.length; i++) {
          var src = String(scripts[i].src || "");
          if (src.indexOf("GeoUtils") >= 0 || src.indexOf("gpc.js") >= 0) injected.push(src);
        }

        // 真实绘制路径（#43）：打开工具条 -> 切到 polygon -> 用真实 DOM 指针序列画一个多边形。
        // 全程只碰公开面（open / setDrawingMode / getDrawingMode / getOverlays / 事件 / 构造选项），
        // 不碰任何下划线成员 —— 结论要能归到「用户操作」上，而不是「我们调了私有 API」。
        var completedEvent = null;
        var cancelEvent = null;
        if (typeof dm.addEventListener === "function") {
          dm.addEventListener("overlaycomplete", function (e) { completedEvent = e; });
          dm.addEventListener("overlaycancel", function (e) { cancelEvent = e; });
        }
        var modeAfterSet = null;
        var setModeError = null;
        if (typeof dm.open === "function") dm.open();
        if (typeof dm.setDrawingMode === "function") {
          try { dm.setDrawingMode("polygon"); } catch (e) { setModeError = msg(e); }
        }
        if (typeof dm.getDrawingMode === "function") modeAfterSet = dm.getDrawingMode();
        await sleep(200);
        var rect = div.getBoundingClientRect();
        var corners = [[0.2, 0.22], [0.76, 0.26], [0.7, 0.74], [0.24, 0.7]];
        var pointerTrace = [];
        var first = fireAt(rect, corners[0][0], corners[0][1], DOWN_EVENT, 1, 1);
        var maskTarget = document.elementFromPoint(first.x, first.y) || div;
        pointerTrace.push(first);
        for (var c = 1; c < corners.length; c++) {
          await sleep(70);
          pointerTrace.push(
            fireAt(rect, corners[c][0], corners[c][1], MOVE_EVENT, 1, 0, maskTarget),
          );
        }
        await sleep(90);
        // 多边形靠 dblclick 收尾（产物里的收尾分支：setPath -> enableEditing -> overlaycomplete）
        fireAt(rect, corners[3][0], corners[3][1], "dblclick", 0, 2, maskTarget);
        await sleep(600);
        var drawn = completedEvent && completedEvent.overlay ? completedEvent.overlay : null;
        var drawnKind = null;
        var drawnPathPoints = null;
        try {
          drawnPathPoints = drawn && typeof drawn.getPath === "function" ? drawn.getPath().length : null;
          drawnKind = drawn && drawn.constructor && drawn.constructor.name
            ? String(drawn.constructor.name)
            : null;
        } catch (e) { /* 读数而已，读不到就留 null */ }
        var drawnOnMap = false;
        try {
          drawnOnMap = !!drawn && map.getOverlays().indexOf(drawn) >= 0;
        } catch (e) { /* 同上 */ }
        var dmOverlays = typeof dm.getOverlays === "function" ? dm.getOverlays() : null;
        var readings = {
          drawingModeInitial: modeInitial,
          drawingModeAfterSet: modeAfterSet,
          setDrawingModeError: setModeError,
          selfInjectedScripts: injected,
          pointerMode: pointerMode,
          downEvent: DOWN_EVENT,
          pointerTrace: pointerTrace,
          overlaycomplete: !!completedEvent,
          overlaycancel: !!cancelEvent,
          completePayloadDrawingMode: completedEvent ? completedEvent.drawingMode : null,
          drawnOverlayKind: drawnKind,
          drawnPathPoints: drawnPathPoints,
          drawnOverlayOnMap: drawnOnMap,
          drawingManagerOverlays: dmOverlays ? dmOverlays.length : null,
          mapOverlaysCount: map.getOverlays().length,
        };
        if (typeof dm.close === "function") dm.close();
        if (typeof dm.dispose === "function") { try { dm.dispose(); } catch (e) {} }
        var joined = injected.join(",");
        var checks = [
          okCheck("getDrawingMode() 返回非空字符串", typeof modeInitial === "string" && modeInitial.length > 0, {
            drawingMode: modeInitial,
          }),
          okCheck("自行注入 GeoUtils 与 gpc 两个脚本", joined.indexOf("GeoUtils") >= 0 && joined.indexOf("gpc.js") >= 0, {
            selfInjectedScripts: injected,
          }),
          okCheck("setDrawingMode('polygon') 读回 polygon", modeAfterSet === "polygon", {
            drawingMode: modeAfterSet,
            error: setModeError,
          }),
          okCheck(
            "真实指针序列画出一个多边形并收到 overlaycomplete（载荷 drawingMode 为 polygon）",
            !!completedEvent && completedEvent.drawingMode === "polygon",
            {
              overlaycomplete: !!completedEvent,
              payloadDrawingMode: completedEvent ? completedEvent.drawingMode : null,
            },
          ),
          okCheck(
            "画出的覆盖物真的在图上，且被 DrawingManager 记进自己的 overlays",
            drawnOnMap && !!dmOverlays && dmOverlays.length === 1,
            { drawnOverlayOnMap: drawnOnMap, drawingManagerOverlays: dmOverlays ? dmOverlays.length : null },
          ),
        ];
        if (!allOk(checks)) return inconclusive("最小路径 invariant 不成立", null, checks, readings);
        return verified(readings, checks, readings);
      },
      GeoUtils: function () {
        var G = getPath("BMapGLLib.GeoUtils");
        if (!G) return inconclusive("全局不存在");
        var P = window.BMap.Point;
        var members = Object.keys(G).length;
        var dist = typeof G.getDistance === "function" ? G.getDistance(new P(0, 0), new P(0, 1)) : null;
        var rect = typeof G.isPointInRect === "function" ? G.isPointInRect(new P(1, 1), new P(0, 0), new P(2, 2)) : null;
        var checks = [
          okCheck("静态成员数大于 0", members > 0, { members: members }),
          okCheck("getDistance 是有限数值且约为 1 度纬度（111194.87，容差 1%）",
            typeof dist === "number" && isFinite(dist) && Math.abs(dist - 111194.87) / 111194.87 < 0.01,
            { getDistance: dist }),
          okCheck("isPointInRect 返回布尔", typeof rect === "boolean", { isPointInRect: rect }),
        ];
        if (!allOk(checks)) return inconclusive("最小路径 invariant 不成立", null, checks);
        return verified({ members: members, getDistance: dist, isPointInRect: rect }, checks);
      },
      Mapvgl: async function () {
        if (!window.mapvgl) return inconclusive("全局不存在");
        var View = window.mapvgl.View;
        if (typeof View !== "function") {
          return inconclusive("View 不是 function", {
            viewType: typeof View,
            keys: Object.keys(window.mapvgl).length,
          });
        }
        var layerNames = Object.keys(window.mapvgl).filter(function (k) { return /Layer$/.test(k); });
        // 它抛错时读的是哪一层容器（#43 的根因读数）：getPanes() 的键与 mapPane 是否存在。
        // 只记录事实，不在探针里下因果结论。
        function readPanes() {
          try {
            if (typeof map.getPanes !== "function") return { supported: false, reason: "Map#getPanes 不是 function" };
            var panes = map.getPanes();
            if (!panes) return { supported: true, panes: null };
            return {
              supported: true,
              keys: Object.keys(panes),
              hasMapPane: !!panes.mapPane,
              mapPaneType: typeof panes.mapPane,
            };
          } catch (e) {
            return { supported: false, error: msg(e) };
          }
        }
        var panesBefore = readPanes();
        // 真实 4.0 上这一步会抛（View 挂载容器时读到 undefined）。**刻意在探针内部捕获并显式返回
        // threw，而不是让它冒到最外层：这样才能把「抛错现场」与「当时容器面的事实」一起带回报告。
        try {
          var v = new View({ map: map, mapType: "bmap" });
          var LayerCtor = window.mapvgl.PointLayer || window.mapvgl.LineLayer || window.mapvgl.FillLayer;
          var layerOk = null;
          var layerErr = null;
          if (typeof LayerCtor === "function") {
            try {
              var layer = new LayerCtor({
                data: [{ geometry: { type: "Point", coordinates: [116.404, 39.915] } }],
                size: 6,
                color: "#f00",
              });
              v.addLayer(layer);
              layerOk = true;
              v.removeLayer(layer);
              if (typeof layer.destroy === "function") layer.destroy();
            } catch (e) {
              layerErr = msg(e);
            }
          }
          try { if (typeof v.destroy === "function") v.destroy(); } catch (e) {}
          // 「View 构造成功」不写成 check：走到这里就说明它没抛错（抛错会进下面的 catch），
          // 那条断言恒真、只会让报告看起来多验了一件事。这里只留真正会不成立的那一条。
          var checksOk = [okCheck("图层能挂上", layerOk === true, { layerError: layerErr })];
          var readingsOk = { panesBefore: panesBefore, layerCtors: layerNames.slice(0, 8) };
          if (!allOk(checksOk)) return inconclusive("最小路径 invariant 不成立", { layerError: layerErr }, checksOk, readingsOk);
          return verified({ viewCreated: true, layerAdded: layerOk }, checksOk, readingsOk);
        } catch (e) {
          var stackLines = String((e && e.stack) || "").split("\\n");
          var site = await throwSite(URLS[spec.key], stackLines[1] || stackLines[0]);
          return {
            status: "threw",
            error: msg(e),
            detail: { stack: stackLines.slice(0, 3) },
            checks: [okCheck("View 构造成功", false, { error: msg(e) })],
            readings: { panesBefore: panesBefore, throwSite: site, layerCtors: layerNames.slice(0, 8) },
          };
        }
      },
    };

    if (!r.globalExposed) {
      r.probe = inconclusive("脚本加载后全局不存在", { global: spec.global });
    } else {
      try {
        r.probe = await probes[spec.id]();
      } catch (e) {
        // 抛出本身是**结论**（MapVGL 的 View 构造就落在这一档），记下错误文本与栈的前几行
        r.probe = {
          status: "threw",
          error: msg(e),
          detail: { stack: String((e && e.stack) || "").split("\\n").slice(0, 3) },
        };
      }
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

const pageScript = PAGE_JS
  .replace("__SPECS__", JSON.stringify(PLUGIN_SPECS))
  .replace("__URLS__", JSON.stringify(urls))
  .replace("__AK__", JSON.stringify(ak))

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>plugin runtime probe</title></head>
<body><script>${pageScript}</script></body></html>`

/* ------------------------------------------------------------------ 主流程 */

/**
 * 全部步骤都收在一个函数里，**早退码必须真的停下来**（评审 #85 第二轮 P2）：
 * 旧写法在缺 AK / 找不到浏览器时只设 `process.exitCode = 2` 就继续往下跑 —— 后面仍会起服务器、
 * 起浏览器、用空 AK 去加载 SDK，等页面超时后又把退出码改成 `3`。于是「缺 AK」被报成 blocked，
 * 还白等一次超时。现在缺什么立刻 `return 2`。
 */
async function main(): Promise<number> {
  if (!ak) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime`")
    return 2
  }

  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`)
    return 2
  }

  // 预检：页面脚本是**拼出来的字符串**，一旦语法错，表现是「页面永远不写报告」——
  // 要等到读报告的截止时间才暴露（实测白等 4 分钟）。编译一次（不执行）就能立刻退 2。
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript)
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`)
    return 2
  }

  const workDir = mkdtempSync(join(tmpdir(), "plugin-probe-"))
  const userDataDir = mkdtempSync(join(tmpdir(), "plugin-probe-chrome-"))
  writeFileSync(join(workDir, "index.html"), pageHtml)

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(pageHtml)
  })
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()))
  const address = server.address()
  if (address === null || typeof address === "string") {
    console.error("[plugin-runtime] 服务未就绪（脚手架失败）")
    return 2
  }
  const port = typeof address === "object" && address ? address.port : 0
  const baseUrl = `http://localhost:${port}/`

  let chrome: ChildProcess | null = null
  let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null
  const runs: PluginRuntimeRun[] = []
  try {
    // `SMOKE_CHROME_ARGS`：给「验证判定分支」用的仿真开关。**按换行分隔**（参数值里本来就有空格，
    // 按空格拆会把 `--host-resolver-rules=MAP a.com 127.0.0.1` 拆坏 —— 实测 Chrome 直接起不来），例如：
    //   SMOKE_CHROME_ARGS=$'--host-resolver-rules=MAP api.map.baidu.com 127.0.0.1'
    // 它能把 SDK 入口指向死路，从而端到端验 `blocked = 3`（否则这条分支只能靠纯函数桩测试覆盖）。
    // 与 `SMOKE_BROWSER` 同一族：只影响本机取证，不进 CI。
    const extraArgs = (process.env.SMOKE_CHROME_ARGS ?? "")
      .split("\n")
      .map((arg) => arg.trim())
      .filter(Boolean)
    chrome = spawn(browser, [
      "--headless",
      ...extraArgs,
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
      const report = await readProbeReport<PluginRuntimeRun>(session, {
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

  const payload = JSON.stringify({ runs }, null, 2)
  console.log(redact(payload))
  const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length)
  if (outPath) {
    writeFileSync(outPath, redact(payload) + "\n")
    console.log(`\n[plugin-runtime] wrote ${outPath}`)
  }

  // 期望值来自 inventory 的 `runtime.status` —— 读数与记录不一致时会退 1 并提示更新 inventory
  const inventory = (await import(
    freshModuleUrl(resolve(repoRoot, "packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts"))
  )) as { PLUGIN_COMPAT_BY_ID: Record<string, { runtime?: { status?: string } }> }
  const expectations = PLUGIN_SPECS.map((spec) => ({
    id: spec.id,
    status: inventory.PLUGIN_COMPAT_BY_ID[spec.id]?.runtime?.status as never,
  }))
  const decision = decidePluginRuntimeExitCode(runs, expectations)
  console.log(`\n${formatPluginRuntimeSummary(decision)}`)
  for (const reason of decision.reasons) console.error(`[plugin-runtime] ${reason}`)
  if (decision.exitCode === 3) {
    console.error("[plugin-runtime] blocked 不是通过：本轮无法判定")
  }
  return decision.exitCode
}

/** 输出里的 `ak=` 与 `BAIDU_MAP_AK` 一律脱敏。 */
function redact(text: string): string {
  return text
    .replace(/([?&]ak=)[^&"'\s]+/g, "$1<redacted>")
    .replaceAll(ak, "<redacted>")
}

// 顶层只做一件事：把 main 的返回码变成 `process.exitCode`，并兜住脚手架异常（→ 2）。
// 刻意不用 `process.exit()`：它会跳过 finally，把 Chromium / Vite 子进程留在后台。
main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(`[plugin-runtime] 脚手架失败：${(error as Error).message}`)
    process.exitCode = 2
  })
