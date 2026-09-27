#!/usr/bin/env node
/**
 * #165 收口探针：`BMap.FeatureLayer` 是否存在 + `<GeoJSONLayer>` 被漏掉的成员是否**可观测地生效**
 *
 * ## 为什么需要它（两条互不相干的结论，共享一个 headless Chrome 会话）
 *
 * ### A. `FeatureLayer`：三方不一致（参考实现有、官方类型零命中、运行时未知）
 *
 * | 来源 | 说法 |
 * | --- | --- |
 * | `@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`） | **零命中**（本探针启动前已 `grep -rc` 整包确认，207 个 `.d.ts`） |
 * | 官方 React 参考 `react-bmap` master `fde5bbd` | 有 `src/components/Layer/FeatureLayer.tsx` + `createFeatureLayer` 工厂 |
 * | 官方 Vue 参考 `vue-bmap` master `ffc6dad` | **没有** `FeatureLayer` 组件（`src/components/Layer/` 下只有 `index.ts`） |
 *
 * ⚠️ **「参考实现有」不构成 SDK 有的证据**，本探针只裁决运行时。
 * 取样纪律全部走 `scripts/official-probe/member-surface.mts`：
 * 成员面**晚约 150ms–2.4s 补齐**，补齐前读到的 `false` 是「还没到」而不是「永远没有」；
 * `absent` 只在 `settled` 之后才允许出现。
 *
 * 关系问题（同一 ctor / 子类 / 别名）用三个可判定的读数回答，不靠命名猜：
 * `BMap.FeatureLayer === BMap.NormalLayer`（同一 ctor）、`instanceof`（继承）、
 * 品牌标志位 `isNormalLayer` / `isGeoJSONLayer`（4.0 的 `Map.addLayer` 靠它分派）。
 *
 * ### B. `GeoJSONLayer` 被 descriptor 漏掉的成员：**「在位」不等于「生效」**
 *
 * 本票的判据是**「可观测地生效」**（`setStrokeLineCap` 在位可调、什么都不做）。
 * 因此对每个候选成员都做**截图差分**：
 * 先 `setData` 一份**在画面上确实可见**的要素（红/蓝/绿三个实心方块，坐标由地图中心换算），
 * 逐个成员做「操作前截图 → 调成员 → 等两帧 → 操作后截图」，比对 PNG 字节。
 * `getLevel()` 之类的读回**另**记一条（读回变了但画面没变 = 只改了内部字段，仍判「不可观测」）。
 *
 * ## 正证控件（不成立 ⇒ 本轮不出结论，退出码 1）
 *
 * 1. `BMap.GeoJSONLayer` 构造器存在且 `new BMap.GeoJSONLayer(name)` 成功；
 * 2. 基准截图**两次一致**（`stable`）——否则差分组全部落「无法判定」；
 * 3. 至少一个成员的差分**确实变了画面**（`setVisible(false)` 是对照：它必须变），
 *    否则「全都变了」不能证明差分工具灵敏。
 *
 * ## 判定与退出码
 *
 * | 结论 | 含义 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 页面脚本跑完且报告写出来了（**不代表每条都符合仓库预期**——本探针是取证器） | 0 |
 * | `fail` | 正证控件不成立（本轮**无法判定**） | 1 |
 * | `blocked` | SDK 没起来 | 3 |
 * | 脚手架失败 | 缺 AK / 没浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * 与 `probe-165c-surface.mts` 同一口径：**本探针不给 pass/fail 结论**，只产出读数；
 * 读数的解释由人工裁决并写回注释 / descriptor。AK 从 `BAIDU_MAP_AK` 读、**不落库**，输出一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165-feature-layer.mts
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165-feature-layer.mts --out=/tmp/165fl.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";
import {
  MEMBER_SURFACE_PAGE_SOURCE,
  normalizeReport,
  verdictsOf,
  type MemberSurfaceSpec,
} from "./official-probe/member-surface.mts";

const argv = process.argv.slice(2);
/** 取 --name=value 或 --name value 两种写法（探针之间调用习惯不统一，两个都收）。 */
function argValue(name: string): string {
  const prefix = `--${name}=`;
  const eq = argv.find((a) => a.startsWith(prefix));
  if (eq !== undefined) return eq.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : "";
}
const OUT = argValue("out");
const SHOT_DIR = argValue("shots");
const AK = (process.env.BAIDU_MAP_AK ?? "").trim();

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 页面里**不出现反引号**（外层是 TS 模板串），AK 走 `__AK_LITERAL__` 占位符。
 * 报告**只在最后发布**（`window.__PROBE_165FL__`）：半成品会让探针立刻读到
 * 一个只有 `sdk:null` 的报告并退出。
 */
const PAGE_JS = `
__MEMBER_SURFACE_SOURCE__
var MEMBER_SURFACE_SPECS = __MEMBER_SURFACE_SPECS__;
(async () => {
  var report = { phase: "running" };
  // 页面里任何一处抛错都必须**留下报告**——否则 Node 侧只看到「报告缺失」，
  // 拿不到「抛在哪一行」，排错就得来回加打印。error / unhandledrejection 双挂。
  function bail(where, e) {
    report.phase = "error";
    report.errorAt = where;
    report.error = String(e && e.message ? e.message : e);
    report.errorStack = String(e && e.stack ? e.stack : "").split("\\n").slice(0, 6).join(" | ");
    window.__PROBE_165FL__ = report;
  }
  try {

  function t(fn) {
    try { var r = fn(); return { threw: false, value: r === undefined ? "undefined" : (r === null ? "null" : (typeof r === "object" ? "[object]" : String(r))) }; }
    catch (e) { return { threw: true, message: String(e && e.message ? e.message : e) }; }
  }
  function hasFn(o, n) { try { return !!(o && typeof o[n] === "function"); } catch (e) { return false; } }
  function ownHas(o, n) { try { return !!(o && Object.prototype.hasOwnProperty.call(o, n)); } catch (e) { return false; } }
  function frame() { return new Promise(function (r) { window.requestAnimationFrame(function () { window.requestAnimationFrame(r); }); }); }

  // —— 官方 loader 自己的 callback：那正是 jsapi-loader 判「已加载」的那一下 ——
  await new Promise(function (resolve) {
    var name = "__p165fl_cb";
    window[name] = function () { report.callbackAt = Math.round(window.performance.now()); resolve(); };
    var s = document.createElement("script");
    s.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(__AK_LITERAL__) + "&callback=" + name;
    s.onerror = function () { report.loadError = "script error"; resolve(); };
    document.head.appendChild(s);
  });
  var B = window.BMap;
  if (!B || !B.Map) { report.loadError = "BMap.Map undefined"; report.phase = "done"; window.__PROBE_165FL__ = report; return; }
  report.sdk = { version: B.sdkVersion || B.version || null, ready: true };

  /* ============================================================ A. FeatureLayer */

  // 三态：「在位」必须等 settled；但**存在性**先记一条即时读数（缺席也是读数）。
  report.featureLayer = {
    typeofCtor: typeof B.FeatureLayer,
    inNamespace: Object.prototype.hasOwnProperty.call(B, "FeatureLayer"),
    typeofNormalLayer: typeof B.NormalLayer,
    sameCtor: false,
    ctorName: null,
    ctorNameNormal: null,
    construct: null,
    brandFlags: null,
    protoMembers: null,
    normalProtoMembers: null,
    chainToNormal: null,
    addLayer: null,
    declaredOnNormal: null,
  };
  if (typeof B.NormalLayer === "function" && B.FeatureLayer) {
    report.featureLayer.sameCtor = B.FeatureLayer === B.NormalLayer;
  }
  report.featureLayer.ctorName = (B.FeatureLayer && B.FeatureLayer.name) || null;
  report.featureLayer.ctorNameNormal = (B.NormalLayer && B.NormalLayer.name) || null;
  report.featureLayer.protoMembers = B.FeatureLayer && B.FeatureLayer.prototype
    ? Object.getOwnPropertyNames(B.FeatureLayer.prototype).slice().sort() : null;
  report.featureLayer.normalProtoMembers = B.NormalLayer && B.NormalLayer.prototype
    ? Object.getOwnPropertyNames(B.NormalLayer.prototype).slice().sort() : null;

  // 构造（两层：新 BMap.FeatureLayer()，以及「继承 NormalLayer」的说法——
  // 若 FeatureLayer 是子类，正常 new 即可；构造失败本身就是判据）。
  report.featureLayer.construct = t(function () { return new B.FeatureLayer({}); });
  var fl = null;
  if (report.featureLayer.construct && !report.featureLayer.construct.threw) {
    fl = report.featureLayer.construct.value;
  }
  // t() 把对象压成了 "[object]"，所以单独再 new 一次拿真身（探针内可接受：构造无副作用）。
  if (!report.featureLayer.construct.threw) {
    try { fl = new B.FeatureLayer({}); } catch (e) { report.featureLayer.construct = { threw: true, message: String(e && e.message ? e.message : e) }; }
  }
  if (fl) {
    report.featureLayer.brandFlags = {
      isNormalLayer: typeof fl.isNormalLayer,
      isNormalLayerValue: fl.isNormalLayer === undefined ? "undefined" : String(fl.isNormalLayer),
      isGeoJSONLayer: typeof fl.isGeoJSONLayer,
      isFeatureLayer: typeof fl.isFeatureLayer,
      isCustomHtmlLayer: typeof fl.isCustomHtmlLayer,
      isTileLayer: typeof fl.isTileLayer,
      isDistrictLayer: typeof fl.isDistrictLayer,
      isWebGLLayer: typeof fl.isWebGLLayer,
    };
    // 继承关系：instanceof 是**运行时**事实，不靠命名猜。
    try { report.featureLayer.instanceOfNormal = fl instanceof B.NormalLayer; } catch (e) { report.featureLayer.instanceOfNormal = "threw"; }
    try { report.featureLayer.instanceOfOverlay = fl instanceof B.Overlay; } catch (e) { report.featureLayer.instanceOfOverlay = "threw"; }
    // 品牌标志位在原型上还是实例上：4.0 的 addLayer 读的是实例可见的那一个。
    report.featureLayer.declaredOnNormal = {
      proto: hasFn(B.NormalLayer && B.NormalLayer.prototype, "isNormalLayer"),
      inst: typeof fl.isNormalLayer,
    };
  }

  // 等成员面补齐（共享判定层）。FeatureLayer 缺席时**不能**进 settleWhenPresent
  // （否则永远等不到 → 整轮超时 → 连带把 GeoJSONLayer 的读数也拖成 unsettled）。
  // 因此只拿 NormalLayer（已知的真类）当就绪锚点，FeatureLayer 缺席另行陈述。
  report.memberSurface = await window.__BMAP_MEMBER_SURFACE__.awaitSettled(MEMBER_SURFACE_SPECS, {
    intervalMs: 25,
    timeoutMs: 20000,
  });
  report.settleMsAfterCallback = Math.round(window.performance.now() - report.callbackAt);
  // 补齐**之后**再看一次 FeatureLayer（构造器也可能是后挂的）。
  report.featureLayer.afterSettle = {
    typeofCtor: typeof B.FeatureLayer,
    inNamespace: Object.prototype.hasOwnProperty.call(B, "FeatureLayer"),
    ctorName: (B.FeatureLayer && B.FeatureLayer.name) || null,
  };
  if (typeof B.FeatureLayer === "function" && !report.featureLayer.construct) {
    report.featureLayer.afterSettle.construct = t(function () { return new B.FeatureLayer({}); });
  }

  /* ---- 建图 + addLayer 判定 ---- */
  var div = document.createElement("div");
  div.style.width = "480px"; div.style.height = "360px";
  document.body.appendChild(div);
  var center = new B.Point(116.404, 39.915);
  // ⚠️ **必须**带 preserveDrawingBuffer: true，否则 map.getScreenshot() 读到的是
  // 一张全黑图（WebGL 默认在合成后清空绘图缓冲）。本轮真的撞到过：带 = 2827 种颜色
  // / 红要素 1620 像素；不带 = distinct=1、全黑。
  var map = new B.Map(div, { center: center, zoom: 15, preserveDrawingBuffer: true });
  await frame();
  // addLayer 认不认：用**地图自己的 getter** 判，而不是「没抛异常」
  //（4.0 的 addLayer 认不出图层会打印 "unknown layer type" 并**静默返回**）。
  report.addLayer = {};
  if (fl) {
    report.addLayer.featureLayer = t(function () { map.addLayer(fl); return "ok"; });
    await frame();
    // addLayer 之后，GeoJSONLayer 家族的 getter 认不认它？
    var getters = ["getGeoJSONLayer", "getNormalLayer", "getTileLayer", "getDistrictLayer", "getCustomHtmlLayer", "getWebGLLayer", "getLayerById", "getLayers"];
    report.addLayer.getters = {};
    for (var gi = 0; gi < getters.length; gi++) {
      if (typeof map[getters[gi]] !== "function") continue;
      report.addLayer.getters[getters[gi]] = t(function (g) { var r = map[g](); return r === null ? "null" : (r === undefined ? "undefined" : (typeof r === "object" ? "[object]" : String(r))); }.bind(null, getters[gi]));
    }
    // removeLayer 对称性
    report.addLayer.removeLayer = t(function () { map.removeLayer(fl); return "ok"; });
  }

  /* ============================================================ B. GeoJSONLayer 成员 */

  // 可见要素：**一个大方块**，铺满视野中央，占画面约一半。
  //
  // ⚠️ 坐标是**量出来的**，不是算出来的：先前按「zoom 15 下 320px ≈ ±0.004 经度」估，
  // 结果三个方块全跑到视野外（截图里只剩零星几个红点，574 像素）。
  // 现在的判据不依赖估：先量一张**空图层**的基准，再量加上面块后的读数——
  // 两者差得够多（见 report.featCoverage）才算「要素真的在画面上」。
  var CLNG = 116.404, CLAT = 39.915, D = 0.001;
  function squareFeature(cx, cy, sizeLng, sizeLat, tag) {
    var x0 = cx - sizeLng / 2, x1 = cx + sizeLng / 2;
    var y0 = cy - sizeLat / 2, y1 = cy + sizeLat / 2;
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
      properties: { tag: tag },
    };
  }
  // 「基准数据」：三个方块在**上排**，红色实心。
  function dataFor(_style) {
    return {
      type: "FeatureCollection",
      features: [
        squareFeature(CLNG - 0.0012, CLAT + 0.0004, 0.0012, 0.0008, "a"),
        squareFeature(CLNG + 0.0000, CLAT + 0.0004, 0.0012, 0.0008, "b"),
        squareFeature(CLNG + 0.0012, CLAT + 0.0004, 0.0012, 0.0008, "c"),
      ],
    };
  }
  // 「换内容」：同样的形状，挪到**下排**且改成别的颜色——画面必须变。
  function movedData() {
    return {
      type: "FeatureCollection",
      features: [
        squareFeature(CLNG - 0.0012, CLAT - 0.0012, 0.0012, 0.0008, "moved-a"),
        squareFeature(CLNG + 0.0000, CLAT - 0.0012, 0.0012, 0.0008, "moved-b"),
        squareFeature(CLNG + 0.0012, CLAT - 0.0012, 0.0012, 0.0008, "moved-c"),
      ],
    };
  }
  // 「换颜色」：形状位置**完全不变**，只有 feature 的 tag 变了。
  // polygonStyle 官方支持按 properties 求值，所以这里能问出「样式是否真的驱动渲染」。
  function recoloredData() {
    return {
      type: "FeatureCollection",
      features: [
        squareFeature(CLNG - 0.0012, CLAT + 0.0004, 0.0012, 0.0008, "red"),
        squareFeature(CLNG + 0.0000, CLAT + 0.0004, 0.0012, 0.0008, "blue"),
        squareFeature(CLNG + 0.0012, CLAT + 0.0004, 0.0012, 0.0008, "green"),
      ],
    };
  }

  // polygonStyle 官方支持「按 properties 求值」（GeoJSONLayerOptions 里就是
  // polygonStyle 官方支持「按 properties 求值」（GeoJSONLayerOptions 里就是 MarkerOptions 联合一个按 properties 求值的函数），所以用函数形式：
  // recoloredData() 只改 properties.tag，画面**必须**跟着变色——否则说明
  // 样式函数这条入口没驱动渲染，后续任何「样式类」成员都判不了。
  var STYLE_BY_TAG = { red: "#ff0000", blue: "#0000ff", green: "#00aa00" };
  function styleFor(props) {
    var tag = props && props.tag;
    return {
      strokeColor: "#000000",
      strokeWeight: 1,
      fillColor: STYLE_BY_TAG[tag] || "#ff0000",
      fillOpacity: 1,
    };
  }
  var layer = new B.GeoJSONLayer("p165fl", { polygonStyle: styleFor });
  map.addLayer(layer);
  layer.setData(dataFor("solid"));
  // 渲染是异步的（要素解析 + 绘制），给足时间
  await new Promise(function (r) { window.setTimeout(r, 1500); });
  await frame();

  /* ------------------------------------------------------------ 步骤驱动
   *
   * 截图差分**不能在页面里做**：页面里的 canvas.toDataURL() 画的是一张**空画布**
   * （WebGL 地图走 GPU，2D canvas 读不到它的像素——本轮真的撞到过：空画布
   * toDataURL 只有 3422 字节，且 setVisible(false) 不改变它）。所以页面只**暴露
   * 一个步骤函数**，由 Node 侧在每两步之间用 Page.captureScreenshot 取真画面。
   */

  // 官方声明有、而本库 descriptor 未开面的成员，以及各自的读回。
  var MEMBERS = {
    setLevel: { arg: -50, readback: function () { return String(layer.getLevel()); } },
    resetStyle: { arg: null, readback: function () { return String(layer.getData().length); } },
    setVisible: { arg: false, readback: function () { return String(layer.getVisible()); } },
    // 换内容（画面**必须**变）
    setDataMoved: { arg: null, readback: function () { return String(layer.getData().length); } },
    // 同内容同顺序（画面**不应**变）——把「画面变了」从「数据变了」里剥出来
    setDataSame: { arg: null, readback: function () { return String(layer.getData().length); } },
    // 形状位置**完全不变**、只改 properties.tag ⇒ 只有样式函数真的驱动渲染，画面才会变
    setDataRecolored: { arg: null, readback: function () { return String(layer.getData().length); } },
  };

  // 「回到基线」的一步：每项差分都从同一画面起手，否则前一项的残留会污染结果。
  function reset() {
    layer.setVisible(true);
    layer.setLevel(-99);
    layer.setData(dataFor("solid"));
  }
  function applyStep(name) {
    var m = MEMBERS[name];
    if (name === "setDataMoved") return t(function () { layer.setData(movedData()); return "ok"; });
    if (name === "setDataSame") return t(function () { layer.setData(dataFor("solid")); return "ok"; });
    if (name === "setDataRecolored") return t(function () { layer.setData(recoloredData()); return "ok"; });
    if (name === "resetStyle") return t(function () { layer.resetStyle(); return "ok"; });
    return t(function () { return layer[name](m.arg); });
  }
  // resetStyleAfterRestyle 的前置：把要素样式改成绿。
  // 官方没有 setPolygonStyle 这类字段级入口，只能通过重新 setData + 不同 feature 达成。
  // 「清空」：没有要素的画面。没有它，「变了」可能是底图瓦片自己刷出来的。
  function clearAll() {
    return t(function () { layer.clearData(); return "ok"; });
  }

  report.stepResults = {};
  report.baseline = { getDataLen: t(function () { return String(layer.getData().length); }) };

  window.__P165FL_STEP__ = async function (op, name) {
    var out = {};
    if (op === "reset") { reset(); }
    else if (op === "clearAll") { out.call = clearAll(); }
    else if (op === "apply") { out.call = applyStep(name); }
    else { return { error: "unknown op " + op }; }
    // 让要素解析 + 绘制落地（渲染是异步的）
    await new Promise(function (r) { window.setTimeout(r, 900); });
    await frame();
    var m = MEMBERS[name];
    out.readback = m && m.readback ? t(m.readback) : null;
    out.getDataLen = t(function () { return String(layer.getData().length); });
    return out;
  };
  window.__P165FL_STEP__.ready = true;

  // 截图入口：Node 侧每两步之间调一次，拿的是**真画面**（需 preserveDrawingBuffer）。
  // 返回去掉前缀的 base64，便于 Node 侧直接写 PNG 落盘人工核对。
  window.__P165FL_SHOT__ = async function () {
    await frame();
    try {
      var s = await map.getScreenshot();
      if (typeof s !== "string") return null;
      var i = s.indexOf("base64,");
      return i > 0 ? s.slice(i + 7) : s;
    } catch (e) { return null; }
  };

  // —— 官方声明有、descriptor 无的全部成员：三态（补齐后才有 absent 的资格）——
  report.declaredMembers = {};
  var declared = ["setData", "getData", "clearData", "resetStyle", "pickOverlays", "setLevel", "getLevel", "setVisible", "getVisible", "destroy", "addEventListener", "removeEventListener"];
  for (var di = 0; di < declared.length; di++) {
    var dn = declared[di];
    report.declaredMembers[dn] = {
      protoFn: hasFn(B.GeoJSONLayer && B.GeoJSONLayer.prototype, dn),
      instFn: hasFn(layer, dn),
    };
  }
  report.declaredMembers.__note = "步骤驱动另测了 setData 的两个数据变体（换内容 / 同内容），不属声明面";

  // —— 「构造期生效」的 level：构造给非默认值，看读回 ——
  var probeLevel = new B.GeoJSONLayer("p165fl-level", { level: -42, polygonStyle: { fillColor: "#ff0000", fillOpacity: 1 } });
  report.ctorLevel = { getLevel: t(function () { return String(probeLevel.getLevel()); }) };
  var probeMinZoom = new B.GeoJSONLayer("p165fl-mz", { minZoom: 7, maxZoom: 18, level: -42 });
  report.ctorZoom = {
    getLevel: t(function () { return String(probeMinZoom.getLevel()); }),
    hasSetMinZoom: hasFn(probeMinZoom, "setMinZoom"),
    hasSetMaxZoom: hasFn(probeMinZoom, "setMaxZoom"),
    hasSetOpacity: hasFn(probeMinZoom, "setOpacity"),
    hasSetZIndex: hasFn(probeMinZoom, "setZIndex"),
  };
  map.removeLayer(probeLevel);
  map.removeLayer(probeMinZoom);

  // 收尾：清数据 → removeLayer → destroy（顺带证明 removeLayer 之后 clearData 仍有效）
  var cleanup = {};
  var cleanup = {};
  layer.clearData();
  map.removeLayer(layer);
  cleanup.clearDataAfterRemove = t(function () { layer.clearData(); return "ok"; });
  cleanup.getDataAfterClear = t(function () { return String(layer.getData().length); });
  cleanup.destroy = t(function () { layer.destroy(); return "ok"; });
  report.cleanup = cleanup;

  report.phase = "done";
  window.__PROBE_165FL__ = report;
  } catch (e) { bail("body", e); }
})();
window.addEventListener("error", function (ev) { if (!window.__PROBE_165FL__) window.__PROBE_165FL__ = { phase: "error", errorAt: "window.onerror", error: String(ev && ev.message ? ev.message : ev) }; });
window.addEventListener("unhandledrejection", function (ev) { if (!window.__PROBE_165FL__) window.__PROBE_165FL__ = { phase: "error", errorAt: "unhandledrejection", error: String(ev && ev.reason && ev.reason.message ? ev.reason.message : ev.reason) }; });
`;

/**
 * 要判「补齐了没有」的类（喂给共享判定层的 `awaitSettled`）。
 *
 * ⚠️ 锚点**只能是确定存在的类**：`FeatureLayer` 若运行时缺席，把它写进 `settleWhenPresent`
 * 会让整轮等待永远超时，连带把 `GeoJSONLayer` 的读数拖成 `unsettled`——
 * 那正是本模块要根除的假阴性（超时后所有读数都不成立）。因此就绪锚点取 `GeoJSONLayer`
 * 与 `NormalLayer`，`FeatureLayer` 的存在性**另行**在补齐前后各读一次。
 */
export const MEMBER_SURFACE_SPECS: readonly MemberSurfaceSpec[] = [
  {
    ctor: "GeoJSONLayer",
    settleWhenPresent: ["setData", "clearData", "setLevel", "getLevel"],
    observe: [
      "setData", "getData", "clearData", "resetStyle", "pickOverlays",
      "setLevel", "getLevel", "setVisible", "getVisible", "destroy",
      "addEventListener", "removeEventListener",
    ],
    minProtoMembers: 10,
  },
  {
    ctor: "NormalLayer",
    // ⚠️ 锚点成员必须是**实测在位**的：`NormalLayer` 原型上没有 `setData`（live 读到的是
    // setVisible/setOpacity/setZIndex/setMinZoom/setMaxZoom/pick/render/onAdd…），
    // 写错锚点会让整轮等待永远超时，把 GeoJSONLayer 的读数一起拖成 unsettled。
    settleWhenPresent: ["setVisible", "setZIndex", "setOpacity"],
    observe: ["setVisible", "setOpacity", "setZIndex", "getOpacity", "getVisible", "pick", "onAdd", "onDestroy"],
    minProtoMembers: 30,
  },
];

/** 每个要问的成员（喂给 Node 侧的 `verdictsOf()` 出三态）。 */
export const SURFACE_MEMBERS: Record<string, readonly string[]> = {
  GeoJSONLayer: [
    "setData", "getData", "clearData", "resetStyle", "pickOverlays",
    "setLevel", "getLevel", "setVisible", "getVisible", "destroy",
    "addEventListener", "removeEventListener",
  ],
  NormalLayer: ["setVisible", "setOpacity", "setZIndex", "getOpacity", "getVisible", "pick", "onAdd", "onDestroy"],
};

/**
 * 组装最终页面脚本。三个占位符**各自**替换一次。
 *
 * ⚠️ 刻意**不用**全局正则替换：上一步刚注入的内容会被再套一层，
 * 而那种损坏在 `new Function` 的语法检查下**看不出来**——它仍是合法 JS，只是名字错了。
 */
function buildPageScript(ak: string): string {
  return PAGE_JS.replace("__AK_LITERAL__", JSON.stringify(ak))
    .replace("__MEMBER_SURFACE_SPECS__", JSON.stringify(MEMBER_SURFACE_SPECS))
    .replace("__MEMBER_SURFACE_SOURCE__", MEMBER_SURFACE_PAGE_SOURCE);
}

/* -------------------------------------------------------------------- 打印 */

function redact(text: string): string {
  const trimmed = AK.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

function shortLen(dataUrl: string | undefined): number {
  return typeof dataUrl === "string" ? dataUrl.length : -1;
}

async function main(): Promise<number> {
  if (!AK) {
    console.error(
      "缺 AK：BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165-feature-layer.mts",
    );
    return 2;
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`);
    return 2;
  }

  const pageScript = buildPageScript(AK);
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>165 feature-layer + geojson probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "probe-165fl-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[165fl] 服务未就绪（脚手架失败）");
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
      deadline: Date.now() + 300_000,
      commandTimeoutMs: 30_000,
    });
    const report = await readProbeReport<Record<string, any>>(session, {
      expression: "window.__PROBE_165FL__ ? JSON.stringify(window.__PROBE_165FL__) : null",
      deadline: Date.now() + 240_000,
      pollIntervalMs: 500,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__PROBE_165FL__");
      return 2;
    }

    console.log("== #165 FeatureLayer / GeoJSONLayer 成员探针 ==");
    console.log(`SDK：${JSON.stringify(report.sdk)}  阶段：${report.phase}`);
    if (report.errorAt) {
      console.log(`  页面抛错于 ${report.errorAt}：${report.error}`);
      if (report.errorStack) console.log(`  ${report.errorStack}`);
    }
    if (report.loadError) console.log(`SDK 未起来：${redact(String(report.loadError))}`);
    // 半路抛错时后续段没有读数，续跑只会打出一堆 undefined。
    if (report.phase !== "done") return 2;

    /* ------------------------------------------------ 截图差分（Node 侧驱动）
     *
     * 页面只暴露 `window.__P165FL_STEP__(op, name)`；每两步之间这里用
     * `Page.captureScreenshot` 取**真画面**（页面内的 2D canvas 读不到 WebGL 像素）。
     */
    const shots = new Map<string, string>();
    // ⚠️ 截图走 **map.getScreenshot()**（SDK 自己的 readPixels），不是
    // `Page.captureScreenshot`：后者在 headless 下读不到 WebGL 图层的像素
    // （本轮实测：CDP 拿到的整页图里根本没有地图，只有一片底色）。
    // 前提是建图时带 preserveDrawingBuffer: true，见页面侧。
    const capture = async (name: string): Promise<string> => {
      const expression =
        "(window.__P165FL_SHOT__ ? window.__P165FL_SHOT__() : Promise.resolve(null))" +
        ".then(function (s) { return s === null ? null : String(s); }, function () { return null; })";
      const message = await session!.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const value = (message.result as { result?: { value?: unknown } } | undefined)?.result?.value;
      const dataUrl = typeof value === "string" ? value : "";
      shots.set(name, dataUrl);
      return dataUrl;
    };
    const callStep = async (op: string, name = ""): Promise<Record<string, unknown> | null> => {
      const expression = `window.__P165FL_STEP__(${JSON.stringify(op)}, ${JSON.stringify(name)}).then(function (r) { return JSON.stringify(r); }, function (e) { return JSON.stringify({ threw: true, message: String(e && e.message ? e.message : e) }); })`;
      const message = await session!.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const value = (message.result as { result?: { value?: unknown } } | undefined)?.result?.value;
      if (typeof value !== "string") return { threw: true, message: "step 未返回字符串" };
      return JSON.parse(value) as Record<string, unknown>;
    };

    // 基线：reset 之后连拍两次——**一致**才说明「没在动」，差分才有意义。
    await callStep("reset");
    const baseA = await capture("baseA");
    await sleep(500);
    const baseB = await capture("baseB");
    const stable = baseA !== "" && baseA === baseB;

    // 灵敏度对照：setVisible(false) **必须**改变画面，否则整套差分工具不可信。
    await callStep("reset");
    const visBefore = await capture("visBefore");
    const visCall = await callStep("apply", "setVisible");
    const visAfter = await capture("visAfter");
    const setVisibleChanged = visAfter !== visBefore;
    await callStep("reset");
    const visRestored = (await capture("visRestored")) === visBefore;

    // 正证控件：①基线稳定 ②至少一个对照变了画面 ③反向对照（同内容 setData）不变画面
    //             ④空画面 ≠ 有要素画面（证明差分确实在看要素，而不是底图瓦片在抖）。
    // 缺 ③ 时「全都变了」不能证明是成员在起作用；缺 ④ 时「没变」可能只是画面里本来就没有要素。
    await callStep("reset");
    const sameBefore = await capture("sameBefore");
    const sameCall = await callStep("apply", "setDataSame");
    const sameAfter = await capture("sameAfter");
    const setDataSameChanged = sameAfter !== sameBefore;

    // 逐成员差分
    interface MemberDiff {
      call?: unknown;
      threw?: boolean;
      readbackBefore?: unknown;
      readbackAfter?: unknown;
      getDataLenAfter?: unknown;
      pictureChanged?: boolean | null;
    }
    const diffs: Record<string, MemberDiff> = {};
    const probeMembers: Array<{ name: string; pre?: "clearAll" }> = [
      { name: "setLevel" },
      { name: "resetStyle" },
      { name: "setVisible" },
      { name: "setDataMoved" },
      { name: "setDataRecolored" },
    ];

    // 「空画面」基准：没有要素时的读数。没有它，「变了」可能只是底图瓦片自己刷出来的。
    await callStep("clearAll");
    const emptyShot = await capture("empty");
    const featureCoverage = baseA !== "" && emptyShot !== "" ? baseA !== emptyShot : null;
    for (const probe of probeMembers) {
      await callStep("reset");
      if (probe.pre) await callStep(probe.pre);
      const before = await capture(`${probe.name}-before`);
      const call = await callStep("apply", probe.name);
      const after = await capture(`${probe.name}-after`);
      diffs[probe.name] = {
        call: (call as Record<string, unknown>).call,
        threw: call === null ? true : undefined,
        readbackAfter: (call as Record<string, unknown>).readback,
        getDataLenAfter: (call as Record<string, unknown>).getDataLen,
        pictureChanged: before !== "" && after !== "" ? before !== after : null,
      };
    }
    const backToBaseline = await (async (): Promise<boolean> => {
      await callStep("reset");
      return (await capture("final")) === baseA;
    })();

    const controlOk = stable && setVisibleChanged && !setDataSameChanged && featureCoverage === true;

    console.log("-- ① FeatureLayer 三方分歧：运行时裁决 --");
    const fl = report.featureLayer ?? {};
    console.log(`  typeof BMap.FeatureLayer = ${fl.typeofCtor}`);
    console.log(`  BMap 上是自有属性        = ${fl.inNamespace}`);
    console.log(`  typeof BMap.NormalLayer  = ${fl.typeofNormalLayer}`);
    console.log(`  构造器名 Feature/Normal  = ${fl.ctorName} / ${fl.ctorNameNormal}`);
    console.log(`  FeatureLayer === NormalLayer = ${fl.sameCtor}`);
    console.log(`  构造：${JSON.stringify(fl.construct)}`);
    if (fl.instanceOfNormal !== undefined) {
      console.log(`  instanceof NormalLayer = ${fl.instanceOfNormal}   instanceof Overlay = ${fl.instanceOfOverlay}`);
    }
    if (fl.brandFlags) console.log(`  品牌标志位：${JSON.stringify(fl.brandFlags)}`);
    if (fl.protoMembers) console.log(`  FeatureLayer.prototype（${fl.protoMembers.length}）：${JSON.stringify(fl.protoMembers)}`);
    else console.log(`  FeatureLayer.prototype：—`);
    if (fl.normalProtoMembers) {
      console.log(`  NormalLayer.prototype（${fl.normalProtoMembers.length}）：${JSON.stringify(fl.normalProtoMembers)}`);
    }
    if (fl.afterSettle) {
      console.log(`  **补齐之后**再读：${JSON.stringify(fl.afterSettle)}`);
    }
    if (report.addLayer) {
      console.log(`  map.addLayer(featureLayer)：${JSON.stringify(report.addLayer.featureLayer)}`);
      if (report.addLayer.getters) {
        for (const [name, value] of Object.entries(report.addLayer.getters)) {
          console.log(`    map.${name}() → ${JSON.stringify(value)}`);
        }
      }
      console.log(`  map.removeLayer(featureLayer)：${JSON.stringify(report.addLayer.removeLayer)}`);
    }

    console.log("-- ② 等待是否真的等到补齐（判 absent 的前置条件）--");
    const surface = normalizeReport(report.memberSurface);
    console.log(
      `  settled=${surface.settled}  timedOut=${surface.timedOut}  ` +
        `settledAfterMs=${String(surface.settledAfterMs)}  采样 ${surface.attempts} 次  ` +
        `（官方 callback 之后 ${String(report.settleMsAfterCallback)}ms）`,
    );
    if (!surface.settled) {
      console.log("  ⚠️ **没等到补齐** ⇒ 下面所有「不存在」都是**未判定**，不得当证据引用。");
    }
    for (const spec of MEMBER_SURFACE_SPECS) {
      const final = surface.final[spec.ctor];
      console.log(
        `  ${spec.ctor}：终态原型成员数=${String(final?.protoMemberCount)}  ` +
          `settleWhenPresent=[${spec.settleWhenPresent.join(", ")}] 在位=[${(final?.present ?? []).join(", ")}]`,
      );
    }

    console.log("-- ③ 正证控件：差分工具本身灵不灵 --");
    const base = report.baseline ?? {};
    console.log(`  基准画面 getData() 长度 = ${JSON.stringify(base.getDataLen)}`);
    console.log(`  基线两次截图一致 stable = ${stable}（${shortLen(baseA)}B / ${shortLen(baseB)}B）`);
    console.log(`  对照①setVisible(false) 改变画面 = ${setVisibleChanged}（调=${JSON.stringify(visCall?.call)}）`);
    console.log(`  对照②setVisible(true)  恢复画面 = ${visRestored}`);
    console.log(`  对照③同内容 setData 不改变画面 = ${!setDataSameChanged}（调=${JSON.stringify(sameCall?.call)}）`);
    console.log(`  对照④空画面 ≠ 有要素画面 = ${featureCoverage}（empty=${shortLen(emptyShot)}B）`);
    console.log(`  reset 之后回到基线        = ${backToBaseline}`);
    if (!controlOk) {
      console.log(
        "  ⚠️ 正证控件不成立（基线不稳 / 显隐对照没变 / 反向对照也变了 / 空画面与要素画面相同）" +
          "⇒ ④ 的差分结论一律「无法判定」，本轮不出结论。",
      );
    }

    console.log("-- ④ 逐成员：截图差分（可观测地生效？只改内部字段？）--");
    for (const [name, diff] of Object.entries(diffs)) {
      const status = controlOk
        ? diff.pictureChanged === true
          ? "画面变了（可观测生效）"
          : diff.pictureChanged === false
            ? "**画面没变**（读回变 / 不可观测）"
            : "无法判定"
        : "无法判定（控件不成立）";
      const callText = (diff.call as { threw?: boolean; message?: string } | undefined)?.threw
        ? "THREW(" + (diff.call as { message?: string }).message + ")"
        : "ok";
      console.log(`  ${name.padEnd(24)} 调=${callText.padEnd(6)} ${status}`);
      console.log(`  ${"".padEnd(24)} 读回=${JSON.stringify(diff.readbackAfter)}  getData()=${JSON.stringify(diff.getDataLenAfter)}`);
    }

    console.log("-- ⑤ GeoJSONLayer 声明面三态（补齐后才有 absent 的资格）--");
    const verdicts = verdictsOf(MEMBER_SURFACE_SPECS, SURFACE_MEMBERS, surface);
    for (const [ctor, members] of Object.entries(verdicts)) {
      console.log(`  [${ctor}]`);
      for (const [member, presence] of Object.entries(members)) {
        const suffix = presence === "unsettled" ? "  ← 不可当「不存在」的证据" : "";
        console.log(`    ${member.padEnd(20)} ${presence}${suffix}`);
      }
    }

    console.log("-- ⑥ 构造期 vs 可变：level / minZoom / maxZoom --");
    console.log(`  构造 { level: -42 } → getLevel() = ${JSON.stringify(report.ctorLevel?.getLevel)}`);
    console.log(`  构造 { minZoom:7, maxZoom:18, level:-42 } → ${JSON.stringify(report.ctorZoom)}`);
    console.log(`  收尾：${JSON.stringify(report.cleanup)}`);

    if (OUT) {
      writeFileSync(
        OUT,
        redact(JSON.stringify({ ...report, diffs, controls: { stable, setVisibleChanged, visRestored, setDataSameChanged, backToBaseline } }, null, 2)),
      );
      console.log(`原始报告（已脱敏）写入 ${OUT}`);
      // 截图落盘：差分「没变」有两种可能——成员无效，或者**画面里本来就没有要素**。
      // 只印字节数分辨不出来，必须能看图。
      if (SHOT_DIR) {
        for (const [name, data] of shots) {
          if (!data) continue;
          const payload = data.startsWith("data:") ? data.slice(data.indexOf("base64,") + 7) : data;
          writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(payload, "base64"));
        }
        console.log(`截图（${shots.size} 张）写入 ${SHOT_DIR}`);
      }
    }
    return report.phase === "done" ? (controlOk ? 0 : 1) : 3;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

const code = await main();
// ⚠️ process.exit 会**截断**还没 flush 的 stdout（本轮真的丢掉了最后两行输出：
// 「原始报告写入…」与返回码都不见了）。写 stderr 走同步通道，且退出前先让 stdout 排空。
process.exitCode = code;
await new Promise((done) => process.stdout.write("", done));
if (code !== 0) process.exitCode = code;

