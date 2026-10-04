#!/usr/bin/env node
/**
 * MVT 矢量瓦片图层的**运行时探针**（issue #109，MVTLayer 基线）
 *
 * ## 为什么需要它
 *
 * issue #109 把 `MVTLayer` 从 #36 切出去的原因是「一处机制缺真实运行时证据」：v4 的
 * `map.addLayer` 靠实例上的 `isXxxLayer` 标记分派，而 MVT 这一族被官方 React 组件库
 * （`huiyan-fe/react-bmap` 的 `unwrapTileWrapper`）当成「包在真 TileLayer 外面的壳」处理；
 * 仓库内官方参考（`references/mvt-layer.md`）却说 MVTLayer **带** `isTileLayer` 标记、统一分发
 * 会直接识别。两种说法冲突，只能**实测**：
 *
 * | 事实 | 现有依据 | 缺什么 |
 * | --- | --- | --- |
 * | 挂载：直接 `addLayer(壳)` 还是要拆壳传 `.layer` | 官方 `@example` 说直接挂；skill 参考说带标记；react-bmap 先拆壳 | **真实运行时的分派行为** + `removeLayer` 对称性 |
 * | 占位符：`[z]` 还是 `{z}` | 字段注释说方括号、`@example` 写花括号、参考说花括号不生效 | **真实请求 URL** |
 * | 拾取载荷（`MVTLayerPickEvent.value` 形状、`idProperty` 对身份的作用） | 类型声明有 `Entity[] \| undefined` | 真实点击读回的 `id` / `layerName` / `properties` |
 * | `updateState` 的 keys 语义（裸 id 还是 `layerName_id`）与状态是否进入样式求值 | skill 参考断言组合键 + `feature-state` 生效 | **画面差分**证据（截图对照） |
 *
 * ## 臂与正证控件
 *
 * | 臂 | 实例 | 问的问题 |
 * | --- | --- | --- |
 * | `direct` | A（方括号模板 + `idProperty` + 样式 + 监听） | 直接 `map.addLayer(壳)` 可用吗；占位符换成数字了吗 |
 * | `unwrap` | U（仅当 direct 没发出请求） | 拆壳 `addLayer(壳.layer)` 才可用吗 |
 * | `curly` | C（花括号模板） | 花括号占位符会被替换吗 |
 * | `id` 对照 | A2（**不给** `idProperty`，方括号，带监听） | `idProperty` 决定拾取 `Entity.id` 的来源吗 |
 * | state | 在 A 上：截图差分 | 裸 id / `layerName_id` 哪种键改变画面；`setStyle` 对照证明截图灵敏 |
 *
 * 正证控件（不成立 ⇒ **本轮不出结论**，退出码 1）：
 *
 * 1. `BMap.MVTLayer` 构造器存在；
 * 2. **本地瓦片请求数 > 0**（某种挂载路径 + 模板真的发出了请求——没有它，占位符 / 拾取 / 状态
 *    三组读数全部无意义）；
 * 3. 截图基线两次一致（`stable`）——不成立时 **state 组**落「无法判定」，但不影响挂载 / 占位符组
 *    （它只出现在 state 组的判定里）。
 *
 * 拾取没有命中时，拾取组与状态组落「无法判定」，**不是**控件失败（挂载 / 占位符的结论仍然成立）。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 正证控件成立，读数取到（各组三态结论自行标注无法判定） | 0 |
 * | `fail` | 正证控件不成立（本轮**无法判定**） | 1 |
 * | `blocked` | SDK / 地图没起来 | 3 |
 * | 脚手架失败 | 缺 AK / 没浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-layer-detached.mts` / `probe-native-point-cluster.mts` 同一口径：不进 CI、不参与
 * 必需链路放行。结论的固化方式是写进 `.agents/skills/bmap-jsapi-v4/references/mvt-layer.md`
 * 与 ADR。AK 从 `BAIDU_MAP_AK` 读、**不落库**；输出里的 `ak=` 一律脱敏。
 *
 * ## 瓦片从哪来（本探针与其它探针不同的地方）
 *
 * 拾取与要素状态需要**真实 PBF 里有要素**，公网 MVT 源有 CORS / 可用性风险，因此本探针在
 * 同源本地服务器上**手写一个最小合法 MVT**（protobuf 直编码：一层线 + 一层点，方环过中心）：
 * 页面与瓦片同源，SDK 用 XHR/fetch 拉取也不会撞 CORS；请求 URL 同时就是占位符替换的读数。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:mvt-layer
 *   BAIDU_MAP_AK=<ak> pnpm probe:mvt-layer -- --out=/tmp/mvt-layer.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const outPath = argValue("out") ?? "";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/* ------------------------------------------------------------------ 最小 MVT（PBF） */

/**
 * 手写 protobuf 编码（只用到 varint / len-delim，不引依赖）。
 *
 * 结构（mapbox vector tile spec 2.1 的最小子集）：
 * VectorTile.layers = field 3；Layer = name/f1、features/f2、keys/f3、values/f4、extent/f5；
 * Feature = id/f1、tags/f2（packed key/value 下标对）、type/f3、geometry/f4（packed 命令流）；
 * Value.string_value = field 1。几何命令：MoveTo=1 / LineTo=2，参数个数进高 5 位，坐标是
 * 相对上一点的 zigzag 增量。
 */
function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function zigzag(n: number): number {
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

function tagOf(field: number, wire: number): number {
  return ((field << 3) | wire) >>> 0;
}

function varField(field: number, value: number): number[] {
  const out: number[] = [];
  writeVarint(out, tagOf(field, 0));
  writeVarint(out, value);
  return out;
}

function lenField(field: number, payload: number[]): number[] {
  const out: number[] = [];
  writeVarint(out, tagOf(field, 2));
  writeVarint(out, payload.length);
  for (const byte of payload) out.push(byte);
  return out;
}

function utf8(text: string): number[] {
  return [...Buffer.from(text, "utf8")];
}

function concat(...parts: number[][]): number[] {
  const out: number[] = [];
  for (const part of parts) for (const byte of part) out.push(byte);
  return out;
}

interface MvtFeatureInput {
  id: number;
  type: 1 | 2; // 1=POINT 2=LINESTRING
  geometry: number[]; // 已编码的命令流
  propertyValue: string;
}

function packedVarints(values: number[]): number[] {
  const out: number[] = [];
  for (const n of values) writeVarint(out, n);
  return out;
}

function encodeLayer(name: string, features: MvtFeatureInput[]): number[] {
  const keys = lenField(3, utf8("id"));
  const valueMessages = features.map((feature) => lenField(4, lenField(1, utf8(feature.propertyValue))));
  const featureMessages = features.map((feature, index) =>
    lenField(
      2,
      concat(
        varField(1, feature.id),
        // tags: 交替 key 下标 / value 下标；唯一 key "id" 在下标 0，value 按要素顺序
        lenField(2, packedVarints([0, index])),
        varField(3, feature.type),
        // geometry 是 packed uint32 命令流：命令/坐标必须逐个 varint，不能当字节塞
        lenField(4, packedVarints(feature.geometry)),
      ),
    ),
  );
  // version=15（spec required，default 1）；缺它时部分解析器整层丢弃
  return concat(
    varField(15, 2),
    lenField(1, utf8(name)),
    ...featureMessages,
    keys,
    ...valueMessages,
    varField(5, 4096),
  );
}

/**
 * 方环 + 对角线（LINESTRING），**tile-local 0..extent**。
 *
 * 绝对米制坐标（EPSG:3857 / BD09MC）会落在 extent 外被裁掉——skill 的
 * 「PBF 几何为 EPSG:3857」指 tile 像素反投影到的地理网格，不是把米塞进命令流。
 * 命令流必须经 `packedVarints`（geometry 是 packed uint32）。
 */
const LOCAL_C = 2048;
const LOCAL_HALF = 1500;

function ringAndDiagonalGeometry(): number[] {
  const pts: Array<[number, number]> = [
    [LOCAL_C - LOCAL_HALF, LOCAL_C - LOCAL_HALF],
    [LOCAL_C + LOCAL_HALF, LOCAL_C - LOCAL_HALF],
    [LOCAL_C + LOCAL_HALF, LOCAL_C + LOCAL_HALF],
    [LOCAL_C - LOCAL_HALF, LOCAL_C + LOCAL_HALF],
    [LOCAL_C - LOCAL_HALF, LOCAL_C - LOCAL_HALF],
    [LOCAL_C - LOCAL_HALF, LOCAL_C - LOCAL_HALF],
    [LOCAL_C + LOCAL_HALF, LOCAL_C + LOCAL_HALF],
  ];
  const cmds: number[] = [];
  cmds.push(9);
  let cx = 0;
  let cy = 0;
  const pushPoint = (x: number, y: number): void => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    cmds.push(zigzag(rx - cx), zigzag(ry - cy));
    cx = rx;
    cy = ry;
  };
  pushPoint(pts[0]![0], pts[0]![1]);
  cmds.push(2 | (4 << 3));
  for (let i = 1; i <= 4; i += 1) pushPoint(pts[i]![0], pts[i]![1]);
  cmds.push(9);
  pushPoint(pts[5]![0], pts[5]![1]);
  cmds.push(2 | (1 << 3));
  pushPoint(pts[6]![0], pts[6]![1]);
  return cmds;
}

function centerPointGeometry(): number[] {
  return [9, zigzag(LOCAL_C), zigzag(LOCAL_C)];
}

function buildProbeTile(): Buffer {
  // 三种对照（MVT_PROBE_TILE=local|abs|self，默认 local）：
  // - local: tile-local 0..4096（标准 MVT；若被当成绝对坐标会落到 null island ⇒ 空 layers）
  // - abs:   绝对 EPSG:3857（skill 表 gridModel=1 且 transform.source=EPSG3857 的口径）
  // - self:  本脚本 encoder
  const knownGoodLocal = Buffer.from(
    "GnAKBWxpbmVzEiQIARICAAAYAiIaCeQvpgQy1AsAALIL0wsAALEL5wXLB6YXzBoSJAgCEgIAARgCIhoJ5C+mBDLUCwAAsgvTCwAAsQvnBcsHphfMGhoCaWQiCAoGZmVhdC0xIggKBmZlYXQtMiiAIHgCGikKA3B0cxIPCAMSAgAAGAEiBQnONYAKGgJpZCIICgZmZWF0LXAogCB4Ag==",
    "base64",
  );
  const knownGoodAbs = Buffer.from(
    "GnAKBWxpbmVzEiQIARICAAAYAiIaCeTYrQz78M8EKoAZAAD/GP8YAACAGYAZ/xgSJAgCEgIAARgCIhoJ5NitDPvwzwQqgBkAAP8Y/xgAAIAZgBn/GBoCaWQiCAoGZmVhdC0xIggKBmZlYXQtMiiAIHgCGi0KA3B0cxITCAMSAgAAGAEiCQmk5a0Mu/3PBBoCaWQiCAoGZmVhdC1wKIAgeAI=",
    "base64",
  );
  const mode = process.env.MVT_PROBE_TILE || "local";
  if (mode === "abs") return knownGoodAbs;
  if (mode === "self") {
    const lines = encodeLayer("lines", [
      { id: 1, type: 2, geometry: ringAndDiagonalGeometry(), propertyValue: "feat-1" },
      { id: 2, type: 2, geometry: ringAndDiagonalGeometry(), propertyValue: "feat-2" },
    ]);
    const pts = encodeLayer("pts", [
      { id: 3, type: 1, geometry: centerPointGeometry(), propertyValue: "feat-p" },
    ]);
    return Buffer.from(concat(lenField(3, lines), lenField(3, pts)));
  }
  return knownGoodLocal;
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * ⚠️ 本模板串里**不得出现反引号**、也不得出现 ${ 插值（会截断外层 TS 模板串），由
 * `tests/behavior/probe-page-scripts.test.ts` 静态守卫。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = {
    phase: "boot",
    sdk: null,
    brands: null,
    apiPresence: {},
    mount: { direct: null, unwrap: null, curly: null },
    placeholders: { bracketUrls: [], curlyUrls: [] },
    remove: {},
    eventAttach: {},
    eventCounts: { A: {}, A2: {}, C: {} },
    picks: [],
    clickTargets: [],
    state: { attempts: [] },
    baiduRequests: 0,
    console: [],
    error: null,
    loadError: null,
  };
  window.__MVT_LAYER_PROBE__ = report;
  window.__mvtDone = false;

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };
  window.addEventListener("error", function (event) {
    report.console.push({ level: "window.error", text: String(event && event.message ? event.message : event) });
  });
  window.addEventListener("unhandledrejection", function (event) {
    report.console.push({ level: "unhandledrejection", text: String(event && event.reason ? event.reason : event) });
  });
  // Worker 构造拦截：MVT 走 _loadTileDataByWorker，worker 内错误不会冒泡到页面 console
  try {
    const NativeWorker = window.Worker;
    if (typeof NativeWorker === "function") {
      window.Worker = function (scriptURL, options) {
        const worker = new NativeWorker(scriptURL, options);
        worker.addEventListener("error", function (event) {
          report.console.push({ level: "worker.error", text: String(event && event.message ? event.message : event) });
        });
        worker.addEventListener("messageerror", function () {
          report.console.push({ level: "worker.messageerror", text: "messageerror" });
        });
        return worker;
      };
      window.Worker.prototype = NativeWorker.prototype;
    }
  } catch (error) {
    report.console.push({ level: "worker.hook", text: String(error) });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const attempt = (fn) => {
    try { return { threw: false, message: null, value: fn() }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error), value: null }; }
  };
  const memberNames = (value) => {
    const names = {};
    let proto = value;
    let depth = 0;
    while (proto && proto !== Object.prototype && proto !== Function.prototype && depth < 6) {
      Object.getOwnPropertyNames(proto).forEach(function (name) { names[name] = true; });
      proto = Object.getPrototypeOf(proto);
      depth += 1;
    }
    return Object.keys(names).sort();
  };
  const summarizeDeep = (value, depth) => {
    const d = depth === undefined ? 0 : depth;
    if (value === null || value === undefined) return String(value);
    if (typeof value === "function") return "fn";
    if (Array.isArray(value)) {
      return {
        kind: "array",
        length: value.length,
        sample: value.length > 0 && d < 2 ? summarizeDeep(value[0], d + 1) : null,
      };
    }
    if (typeof value === "object") {
      const out = { kind: "object", keys: Object.keys(value).slice(0, 30) };
      if (d < 2) {
        for (const k of out.keys) {
          try { out[k] = summarizeDeep(value[k], d + 1); } catch (e) { out[k] = "throw"; }
        }
      }
      return out;
    }
    return { kind: typeof value, value: String(value).slice(0, 120) };
  };
  const resourceEntries = () => {
    try { return performance.getEntriesByType("resource").map(function (e) { return e.name; }); }
    catch (error) { return []; }
  };
  const countPrefix = (prefix) => resourceEntries().filter(function (name) {
    try { return new URL(name).pathname.indexOf(prefix) === 0; } catch (error) { return false; }
  }).length;
  const samplePrefix = (prefix, limit) => resourceEntries().filter(function (name) {
    try { return new URL(name).pathname.indexOf(prefix) === 0; } catch (error) { return false; }
  }).slice(0, limit);

  const summarizeEntity = (entity) => ({
    idType: entity === null || entity === undefined ? String(entity) : typeof entity.id,
    id: entity === undefined || entity === null ? String(entity) : String(entity.id),
    layerName: entity === undefined || entity === null ? String(entity) : String(entity.layerName),
    propertyKeys: entity && entity.properties && typeof entity.properties === "object" ? Object.keys(entity.properties) : [],
    propertiesJson: entity && entity.properties ? (function () { try { return JSON.stringify(entity.properties).slice(0, 120); } catch (e) { return "n/a"; } })() : "n/a",
  });

  const recordPick = (label, event) => {
    const value = event ? event.value : undefined;
    const list = Array.isArray(value) ? value : null;
    report.picks.push({
      layer: label,
      type: event && event.type !== undefined ? String(event.type) : "n/a",
      topKeys: event && typeof event === "object" ? Object.keys(event) : [],
      hasPixel: !!(event && event.pixel),
      hasLatLng: !!(event && event.latLng),
      valueKind: value === undefined ? "undefined" : value === null ? "null" : (Array.isArray(value) ? "array" : typeof value),
      valueLength: list ? list.length : "n/a",
      entities: list ? list.slice(0, 3).map(summarizeEntity) : [],
    });
  };

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapMvtProbeReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapMvtProbeReady";
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
    const NS = window.BMap;

    const CANDIDATES = [
      "setZIndex", "getZIndex", "setZIndexTop", "setUpLevel", "setDownLevel", "setStyle",
      "updateState", "clearState", "addEventListener", "removeEventListener",
      "setVisible", "setOpacity", "setMinZoom", "setMaxZoom", "setBaseOptions",
      "setData", "clearData", "removeState", "replaceAllState", "getAllState",
      "redraw", "setOptions", "show", "hide", "isVisible", "getOptions",
    ];
    report.sdk = {
      version: String(NS.version),
      mvtLayer: typeof NS.MVTLayer,
      prototypeMembers: typeof NS.MVTLayer === "function" ? memberNames(NS.MVTLayer.prototype) : [],
    };
    if (typeof NS.MVTLayer === "function") {
      for (const name of CANDIDATES) {
        report.apiPresence[name] = memberNames(NS.MVTLayer.prototype).indexOf(name) >= 0;
      }
    }

    document.body.style.margin = "0";
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;width:760px;height:560px";
    document.body.appendChild(host);
    const map = new NS.Map(host);
    const zoomRead = attempt(() => map.getZoom());
    report.mapZoom = { threw: zoomRead.threw, value: zoomRead.value === null ? null : zoomRead.value };
    map.centerAndZoom(new NS.Point(116.404, 39.915), 13);
    await wait(1500);
    report.baiduRequests = resourceEntries().filter(function (name) {
      return name.indexOf("baidu.com") >= 0 || name.indexOf("bdimg.com") >= 0;
    }).length;

    const origin = location.origin;
    // skill：运行时按源图层读 { type, painter }；平铺 point/polyline/polygon 不会被遍历。
    // 官方 d.ts 的平铺 MVTLayerStyle 仍保留一条 solidFlatStyle 给 setStyle 对照。
    const style = {
      lines: { type: "polyline", painter: { strokeColor: "#1677ff", strokeWeight: 14 } },
      pts: { type: "point", painter: { color: "#ff3b1f", fontSize: 36 } },
    };
    const solidStyle = {
      lines: { type: "polyline", painter: { strokeColor: "#22cc44", strokeWeight: 14 } },
      pts: { type: "point", painter: { color: "#22cc44", fontSize: 36 } },
    };
    const solidFlatStyle = {
      polyline: { strokeColor: "#22cc44", strokeWeight: 14 },
      point: { color: "#22cc44", fontSize: 36 },
      polygon: { fillColor: "#22cc44", fillOpacity: 0.8, strokeColor: "#22cc44", strokeWeight: 3 },
    };
    // worker Xb: c.indexOf(sourceLayerName) — layers 必须是 **源图层名字符串数组**；
    // 传 MVTLayerConfig[] 对象数组时 indexOf 恒为 -1，全部被跳过 ⇒ 空 layers。
    const layerConfigs = ["lines", "pts"];
    const layerConfigObjects = [
      { layerName: "lines", type: "polyline", visible: true, painter: { strokeColor: "#1677ff", strokeWeight: 14 } },
      { layerName: "pts", type: "point", visible: true, painter: { color: "#ff3b1f", fontSize: 36 } },
    ];
    void layerConfigObjects;
    // feature-state 对照样式（状态组用）：按源图层键
    const featureStateStyle = {
      lines: {
        type: "polyline",
        painter: {
          strokeColor: ["case", ["boolean", ["feature-state", "selected"], false], "#ff3b1f", "#1677ff"],
          strokeWeight: 14,
        },
      },
      pts: {
        type: "point",
        painter: {
          color: ["case", ["boolean", ["feature-state", "selected"], false], "#ff3b1f", "#1677ff"],
          fontSize: 36,
        },
      },
    };

    const readBrands = (layer) => {
      const inner = layer && typeof layer === "object" && "layer" in layer ? layer.layer : undefined;
      return {
        shellIsTileLayer: layer && "isTileLayer" in layer ? layer.isTileLayer : "absent",
        shellHasLayer: layer && "layer" in layer ? typeof layer.layer : "absent",
        innerIsTileLayer: inner && typeof inner === "object" && "isTileLayer" in inner ? inner.isTileLayer : "absent",
        innerCtor: inner && inner.constructor ? String(inner.constructor.name) : "n/a",
        shellMembers: memberNames(layer).filter(function (n) { return n.indexOf("is") === 0 || n === "layer"; }),
      };
    };

    const listenAll = (label, layer) => {
      report.eventAttach[label] = {};
      report.eventCounts[label] = { click: 0, dblclick: 0, mousemove: 0, mouseout: 0, tilesloadstart: 0, tilesloadend: 0 };
      for (const name of Object.keys(report.eventCounts[label])) {
        const handler = function (event) {
          report.eventCounts[label][name] += 1;
          if (name === "click" || name === "dblclick" || name === "mousemove") {
            if (report.picks.length < 40) recordPick(label, event);
          }
        };
        // 壳 addEventListener → 壳 on → 内层 addEventListener，逐级兜底并记栈
        let status = null;
        let via = "shell.addEventListener";
        let stack = null;
        try { layer.addEventListener(name, handler); status = "ok"; }
        catch (error) {
          stack = String(error && error.stack ? error.stack : error).split("\\n").slice(0, 4).join(" | ");
          via = "shell.addEventListener";
          try { layer.on(name, handler); status = "ok"; via = "shell.on"; stack = null; }
          catch (error2) {
            stack = (stack || "") + " >> on: " + String(error2 && error2.stack ? error2.stack : error2).split("\\n").slice(0, 3).join(" | ");
            const inner = layer && typeof layer === "object" && layer.layer ? layer.layer : null;
            if (inner && typeof inner.addEventListener === "function") {
              try { inner.addEventListener(name, handler); status = "ok"; via = "inner.addEventListener"; }
              catch (error3) {
                status = "throw:" + String(error3 && error3.message ? error3.message : error3);
                via = "inner.addEventListener";
                stack = (stack || "") + " >> inner: " + String(error3 && error3.stack ? error3.stack : error3).split("\\n").slice(0, 3).join(" | ");
              }
            } else {
              status = "throw:" + String(error && error.message ? error.message : error);
            }
          }
        }
        report.eventAttach[label][name] = status === "ok" ? "ok" : (status || "unknown");
        if (via !== "shell.addEventListener" || status !== "ok") {
          report.eventAttach[label][name + ":via"] = via;
          if (stack) report.eventAttach[label][name + ":stack"] = stack;
        }
      }
    };

    /* ---------------------------------------------------------- direct 臂 */
    const A = new NS.MVTLayer({
      tileUrlTemplate: origin + "/mvt/[z]/[x]/[y].pbf",
      idProperty: "id",
      minZoom: 3,
      maxZoom: 18,
      gridModel: 1,
      transform: { source: "EPSG3857", target: "BD09MC" },
      style: style,
      layers: layerConfigs,
      noCollision: true,
      useThumb: false,
    });
    report.brands = readBrands(A);
    // 挂载前挂钩：tilesloadend 可能在 HTTP 完成时就触发，但 firstTileLoad 仍为 false
    // 壳上是 _loadTileData/_loadTileDataByWorker/_tileDataCbk；内层是 loadTileData/vectorTileDataCbk 等
    report.tileHooks = { calls: [], worker: [], load: [], cbk: [], other: [], actionPost: {}, actionMsg: {} };
    {
      const summarize0 = (value) => {
        if (value === null || value === undefined) return String(value);
        if (typeof value === "function") return "fn";
        if (Array.isArray(value)) return { kind: "array", length: value.length };
        if (typeof value === "object") {
          const keys = Object.keys(value);
          return { kind: "object", keys: keys.slice(0, 20), length: keys.length };
        }
        return { kind: typeof value, value: String(value).slice(0, 120) };
      };
      const bucketFor = (label) => {
        if (/worker/i.test(label)) return report.tileHooks.worker;
        if (/load/i.test(label)) return report.tileHooks.load;
        if (/cbk|cb/i.test(label)) return report.tileHooks.cbk;
        return report.tileHooks.other;
      };
      const wrap = (label, holder, name) => {
        const raw = holder[name];
        if (typeof raw !== "function") return false;
        holder[name] = function (...args) {
          const bucket = bucketFor(label);
          if (bucket.length < 15) {
            const summarized = args.map((x) => (typeof x === "function" ? "fn" : summarize0(x)));
            // _setTileData / tile 写入：把 status / tileData 深挖出来
            if (/SetTile|setTile|shellSetTile/i.test(label) && args[1] && typeof args[1] === "object") {
              const payload = args[1];
              summarized.push({
                deep: {
                  status: payload.status,
                  retry: payload.retry,
                  dataType: payload.dataType,
                  tileInfo: payload.tileInfo ? summarize0(payload.tileInfo) : undefined,
                  label: payload.label ? summarize0(payload.label) : undefined,
                  tileData: summarizeDeep(payload.tileData),
                  mvMatrix: summarize0(payload.mvMatrix),
                },
              });
            }
            bucket.push({
              fn: label,
              n: args.length,
              args: summarized,
            });
          }
          try {
            const result = raw.apply(this, args);
            if (bucket.length < 15 && typeof result !== "undefined") {
              bucket.push({ fn: label + ":ret", ret: summarize0(result) });
            }
            return result;
          } catch (error) {
            bucket.push({ fn: label + ":throw", message: String(error && error.message ? error.message : error) });
            throw error;
          }
        };
        return true;
      };
      const inner0 = A.layer || A;
      // 壳
      wrap("shellWorker", A, "_loadTileDataByWorker");
      wrap("shellLoad", A, "_loadTileData");
      wrap("shellCbk", A, "_tileDataCbk");
      wrap("shellSetTile", A, "_setTileData");
      wrap("shellLoadTile", A, "_loadTile");
      wrap("shellDraw", A, "doOnceDraw");
      // 内层（真实瓦片回写路径）
      wrap("innerLoadTileData", inner0, "loadTileData");
      wrap("innerLoadVectorTile", inner0, "loadVectorTileData");
      wrap("innerVectorCbk", inner0, "vectorTileDataCbk");
      wrap("innerLoadLayer", inner0, "loadLayerData");
      wrap("innerLoadVectorLayer", inner0, "loadVectorLayerData");
      wrap("innerInitDraw", inner0, "initDrawData");
      wrap("innerSetDumb", inner0, "_setDumbTileData");
      wrap("innerTileLoadFn", inner0, "tileLoadFunction");
      // 钩 Worker 通信：worker 回包/错误是 firstTileLoad 的关键路径
      try {
        const NativeWorker = window.Worker;
        if (typeof NativeWorker === "function" && !NativeWorker.__mvtProbe) {
          window.Worker = function (scriptURL, options) {
            const worker = new NativeWorker(scriptURL, options);
            const bucket = report.tileHooks.worker;
            if (bucket.length < 20) bucket.push({ fn: "Worker.ctor", url: String(scriptURL).slice(0, 200) });
            const rawPost = worker.postMessage.bind(worker);
            worker.postMessage = function (data, transfer) {
              const action = data && typeof data === "object" ? String(data.action) : String(typeof data);
              report.tileHooks.actionPost[action] = (report.tileHooks.actionPost[action] || 0) + 1;
              if (bucket.length < 20 && action !== "hasReady" && action !== "setLayerStyle") {
                bucket.push({
                  fn: "worker.post",
                  action: action,
                  id: data && data.id ? String(data.id).slice(0, 80) : null,
                  data: summarizeDeep(data && data.data !== undefined ? data.data : data, 1),
                });
              } else if (bucket.length < 6 && (action === "hasReady" || action === "setLayerStyle")) {
                bucket.push({ fn: "worker.post", action: action, id: data && data.id ? String(data.id).slice(0, 80) : null });
              }
              return rawPost(data, transfer);
            };
            worker.addEventListener("message", function (event) {
              const d = event && event.data;
              const action = d && typeof d === "object" ? String(d.action) : "unknown";
              report.tileHooks.actionMsg[action] = (report.tileHooks.actionMsg[action] || 0) + 1;
              // loadTile 的 response 要深挖：layers 是否空、features 是否在
              const id = d && d.id ? String(d.id) : "";
              const isLoadTileResponse = id.indexOf("loadTile") >= 0 || (d && d.data && d.data.tile_options);
              if (bucket.length < 20 && (action !== "<response>" || isLoadTileResponse)) {
                const rawData = d && d.data !== undefined ? d.data : d;
                bucket.push({
                  fn: "worker.message",
                  action: action,
                  id: id.slice(0, 80),
                  error: d && d.error !== undefined && d.error !== null ? String(d.error) : null,
                  dataType: rawData === null || rawData === undefined ? String(rawData) : (rawData.constructor ? rawData.constructor.name : typeof rawData),
                  dataByteLength: rawData && typeof rawData.byteLength === "number" ? rawData.byteLength : undefined,
                  data: summarizeDeep(rawData, 2),
                });
              } else if (d && d.error) {
                bucket.push({ fn: "worker.message.error", id: id.slice(0, 80), error: String(d.error) });
              }
            });
            worker.addEventListener("error", function (event) {
              bucket.push({ fn: "worker.error", message: String(event && event.message ? event.message : event) });
            });
            return worker;
          };
          window.Worker.prototype = NativeWorker.prototype;
          window.Worker.__mvtProbe = true;
        }
      } catch (error) {
        report.tileHooks.other.push({ fn: "workerHookFail", message: String(error) });
      }
      report.tileHooks.shellProto = memberNames(A).filter(function (n) {
        return /load|tile|data|style|draw|state|pick|worker|express|parse/i.test(n);
      });
      report.tileHooks.innerProto = memberNames(inner0).filter(function (n) {
        return /load|tile|data|style|draw|state|pick|worker|express|parse/i.test(n);
      });
    }
    const aSetZ = attempt(() => A.setZIndex(5));
    const aGetZ = attempt(() => A.getZIndex());
    report.setZIndexCheck = {
      setThrew: aSetZ.threw, setMessage: aSetZ.message,
      getThrew: aGetZ.threw, getValue: aGetZ.value === null ? null : aGetZ.value, getMessage: aGetZ.message,
    };
    const directAdd = attempt(() => map.addLayer(A));
    // 挂载后再挂事件：挂载前壳上 addEventListener 可能还没完成 _initEvent（2026-09-23 实测挂载前全 throw）
    listenAll("A", A);
    await wait(3500);
    const directRequests = countPrefix("/mvt/");
    report.mount.direct = { threw: directAdd.threw, message: directAdd.message, bracketRequests: directRequests };
    report.placeholders.bracketUrls = samplePrefix("/mvt/", 8).map(function (name) {
      try { return new URL(name).pathname; } catch (error) { return name; }
    });
    // 拾取诊断：不依赖事件，直接调 pickFeatures（原型上有）
    report.pickFeaturesProbe = attempt(() => {
      if (typeof A.pickFeatures !== "function") return { available: false };
      const rect = host.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const out = { available: true, args: [[cx, cy]] };
      try {
        const r = A.pickFeatures(cx, cy);
        out.result = r === undefined ? "undefined" : r === null ? "null" : (Array.isArray(r) ? "array:" + r.length : typeof r);
        if (Array.isArray(r) && r[0]) {
          out.sample = { id: String(r[0].id), layerName: String(r[0].layerName), keys: r[0].properties ? Object.keys(r[0].properties) : [] };
        }
      } catch (error) {
        out.threw = String(error && error.message ? error.message : error);
      }
      return out;
    });

    /* ---------------------------------------------------------- id 对照臂 */
    const A2 = new NS.MVTLayer({
      tileUrlTemplate: origin + "/mvt/[z]/[x]/[y].pbf",
      minZoom: 3,
      maxZoom: 18,
      gridModel: 1,
      transform: { source: "EPSG3857", target: "BD09MC" },
      style: style,
      layers: layerConfigs,
      noCollision: true,
      useThumb: false,
    });
    const a2Add = attempt(() => map.addLayer(A2));
    listenAll("A2", A2);
    report.mount.a2 = { threw: a2Add.threw, message: a2Add.message };

    /* ---------------------------------------------------------- curly 臂 */
    const C = new NS.MVTLayer({
      tileUrlTemplate: origin + "/mvtc/{z}/{x}/{y}.pbf",
      minZoom: 3,
      maxZoom: 18,
      gridModel: 1,
      transform: { source: "EPSG3857", target: "BD09MC" },
      style: style,
      layers: layerConfigs,
      noCollision: true,
      useThumb: false,
    });
    const cAdd = attempt(() => map.addLayer(C));
    listenAll("C", C);
    await wait(2000);
    const curlyRequests = countPrefix("/mvtc/");
    report.mount.curly = { threw: cAdd.threw, message: cAdd.message, curlyRequests: curlyRequests };
    report.placeholders.curlyUrls = samplePrefix("/mvtc/", 8).map(function (name) {
      try { return decodeURIComponent(new URL(name).pathname); } catch (error) { return name; }
    });

    /* ---------------------------------------------------------- unwrap 臂 */
    // 壳引用提到 try 顶层：remove 对称 arm 要能拿到同一个实例（#109 验收）。
    let U = null;
    if (directRequests === 0 || directAdd.threw) {
      U = new NS.MVTLayer({
        tileUrlTemplate: origin + "/mvt/[z]/[x]/[y].pbf",
        minZoom: 3,
        maxZoom: 18,
      });
      const hasInner = "layer" in U;
      let addAttempt;
      if (hasInner && U.layer) {
        addAttempt = attempt(() => map.addLayer(U.layer));
      } else {
        addAttempt = { threw: true, message: "壳上没有 .layer 可拆", value: null };
      }
      await wait(2500);
      const after = countPrefix("/mvt/");
      report.mount.unwrap = {
        hasInner: hasInner,
        threw: addAttempt.threw,
        message: addAttempt.message,
        bracketRequestsTotal: after,
        bracketRequestsDelta: after - directRequests,
      };
    } else {
      report.mount.unwrap = { skipped: true, reason: "direct 已发出请求，无需拆壳" };
    }

    /* ---------------------------------------------------------- 事件与瓦片就绪 */
    const tileWaitStart = Date.now();
    let sawTilesEnd = false;
    while (Date.now() - tileWaitStart < 8000) {
      if ((report.eventCounts.A.tilesloadend || 0) > 0) { sawTilesEnd = true; break; }
      await wait(300);
    }
    report.tilesReady = {
      sawTilesEnd: sawTilesEnd,
      A: Object.assign({}, report.eventCounts.A),
      bracketRequests: countPrefix("/mvt/"),
      curlyRequests: countPrefix("/mvtc/"),
      perfBracket: countPrefix("/mvt/"),
    };

    /* ---------------------------------------------------------- 内部要素诊断 */
    const summarizeValue = (value) => {
      if (value === null || value === undefined) return String(value);
      if (Array.isArray(value)) return { kind: "array", length: value.length, sample: value.length ? String(JSON.stringify(value[0]).slice(0, 120)) : null };
      if (typeof value === "object") {
        const keys = Object.keys(value);
        return { kind: "object", keys: keys.slice(0, 24), length: keys.length };
      }
      return { kind: typeof value, value: String(value).slice(0, 80) };
    };
    report.internal = attempt(() => {
      const inner = A && A.layer ? A.layer : A;
      const out = { shellOwn: [], innerOwn: {}, probes: {} };
      out.shellOwn = Object.getOwnPropertyNames(A).filter((n) => n !== "constructor");
      for (const name of Object.getOwnPropertyNames(inner)) {
        if (name === "constructor") continue;
        let raw;
        try { raw = inner[name]; } catch (error) { out.innerOwn[name] = "throw"; continue; }
        if (raw === null || raw === undefined || typeof raw === "function" || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
          if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null || raw === undefined) {
            out.innerOwn[name] = raw;
          }
          continue;
        }
        if (Array.isArray(raw)) {
          out.innerOwn[name] = { __type: "array", length: raw.length };
        } else if (typeof raw === "object") {
          out.innerOwn[name] = { __type: "object", keys: Object.keys(raw).slice(0, 16) };
        }
      }
      const tryCall = (label, fn) => {
        try { out.probes[label] = summarizeValue(fn()); }
        catch (error) { out.probes[label] = { threw: String(error && error.message ? error.message : error) }; }
      };
      tryCall("getAllState", () => (typeof A.getAllState === "function" ? A.getAllState() : "missing"));
      tryCall("getLayerVisible", () => (typeof inner.getLayerVisible === "function" ? inner.getLayerVisible() : "missing"));
      tryCall("getZIndex", () => (typeof A.getZIndex === "function" ? A.getZIndex() : "missing"));
      tryCall("doOnceDraw", () => (typeof A.doOnceDraw === "function" ? A.doOnceDraw() : (typeof inner.doOnceDraw === "function" ? inner.doOnceDraw() : "missing")));
      tryCall("styleExpress", () => A.styleExpress);
      tryCall("upStyle", () => A.upStyle);
      tryCall("mvt", () => (A.mvt && typeof A.mvt === "object" ? Object.keys(A.mvt) : String(A.mvt)));
      tryCall("layerOption", () => A.layerOption);
      tryCall("running", () => A.running);
      tryCall("tileCacheMeta", () => {
        const c = inner.tileCache;
        if (!c) return "missing";
        return {
          size: c._size,
          curSize: c._curSize,
          getDataTimes: c._getDataTimes,
          hitTimes: c._hitTimes,
          cacheLen: c._cache && typeof c._cache === "object"
            ? Object.keys(c._cache).length
            : (Array.isArray(c._cache) ? c._cache.length : typeof c._cache),
          firstTileLoad: inner.firstTileLoad,
          numLoading: inner.numLoading,
          tileType: inner.tileType
            ? { name: inner.tileType._name, baseZoom: inner.tileType._baseZoom, opts: inner.tileType._opts }
            : null,
          tileTypeName: inner.opts ? inner.opts.tileTypeName : null,
          dataType: inner.dataType,
        };
      });
      // summarizeValue 只留 keys，会丢掉计数；这里单独存原始 JSON
      try {
        const c = inner.tileCache;
        out.rawTileCache = c
          ? {
              size: c._size, curSize: c._curSize, getDataTimes: c._getDataTimes, hitTimes: c._hitTimes,
              cacheLen: c._cache ? (typeof c._cache === "object" ? Object.keys(c._cache).length : null) : null,
              firstTileLoad: inner.firstTileLoad, numLoading: inner.numLoading,
            }
          : null;
        out.rawLayerOption = A.layerOption
          ? {
              useWorker: A.layerOption.useWorker, dataType: A.layerOption.dataType,
              encrypt: A.layerOption.encrypt, gridModel: A.layerOption.gridModel,
              transform: A.layerOption.transform, spanLevel: A.layerOption.spanLevel,
              idProperty: A.layerOption.idProperty, styleKeys: A.layerOption.style ? Object.keys(A.layerOption.style) : null,
              layers: A.layerOption.layers,
              tileUrlTemplate: A.layerOption.tileUrlTemplate,
            }
          : null;
        out.rawStyleExpress = A.styleExpress && typeof A.styleExpress === "object"
          ? { kind: Array.isArray(A.styleExpress) ? "array" : "object", json: JSON.stringify(A.styleExpress).slice(0, 500) }
          : String(A.styleExpress);
        out.rawMvt = A.mvt && typeof A.mvt === "object"
          ? { isArray: Array.isArray(A.mvt), keys: Object.keys(A.mvt).slice(0, 20), len: Array.isArray(A.mvt) ? A.mvt.length : null, json: JSON.stringify(A.mvt).slice(0, 400) }
          : String(A.mvt);
        out.probeMethods = {
          shell: memberNames(A).filter(function (n) { return /load|tile|data|style|draw|state|pick|worker|express/i.test(n); }),
          inner: memberNames(inner).filter(function (n) { return /load|tile|data|style|draw|state|pick|worker|express/i.test(n); }),
        };
      } catch (error) {
        out.rawDumpError = String(error && error.message ? error.message : error);
      }
      // 原始缓存条目（cacheLen 有 24 但 firstTileLoad=false ⇒ 看条目里到底有没有要素）
      try {
        const c = inner.tileCache;
        const cache = c && c._cache;
        const cacheKeys = cache && typeof cache === "object" ? Object.keys(cache) : [];
        out.rawCacheEntries = cacheKeys.slice(0, 3).map(function (key) {
          const entry = cache[key];
          if (entry === null || entry === undefined) return { key, value: String(entry) };
          if (typeof entry !== "object") return { key, value: entry };
          const ek = Object.keys(entry);
          const summary = { key, keys: ek.slice(0, 24) };
          if (entry.data && typeof entry.data === "object") {
            summary.dataStatus = entry.data.status;
            summary.dataRetry = entry.data.retry;
            summary.dataDataType = entry.data.dataType;
            summary.tileData = entry.data.tileData ? summarizeDeep(entry.data.tileData) : null;
            summary.tileInfo = entry.data.tileInfo ? summarizeDeep(entry.data.tileInfo) : null;
            summary.label = entry.data.label;
            // tileData.layers 才是 worker 解出来的源图层 → 要素是否真有几何
            const td = entry.data.tileData;
            if (td && typeof td === "object" && Array.isArray(td.layers)) {
              summary.layers = td.layers.map(function (layer) {
                if (!layer || typeof layer !== "object") return String(layer);
                const feats = layer.features || layer.features_data || layer.data || null;
                return {
                  keys: Object.keys(layer).slice(0, 20),
                  name: layer.name || layer.layerName || layer.id || null,
                  featureCount: Array.isArray(feats) ? feats.length : (feats && typeof feats === "object" ? Object.keys(feats).length : null),
                  sampleFeature: Array.isArray(feats) && feats[0] ? summarizeDeep(feats[0], 0) : null,
                  style: layer.style ? summarize0(layer.style) : undefined,
                };
              });
            }
            if (td && typeof td === "object" && td.layers && !Array.isArray(td.layers)) {
              summary.layersMapKeys = Object.keys(td.layers).slice(0, 20);
              summary.layersMap = {};
              for (const lk of summary.layersMapKeys) {
                const layer = td.layers[lk];
                if (!layer || typeof layer !== "object") { summary.layersMap[lk] = String(layer); continue; }
                const feats = layer.features || layer.features_data || layer.data || null;
                summary.layersMap[lk] = {
                  keys: Object.keys(layer).slice(0, 20),
                  featureCount: Array.isArray(feats) ? feats.length : (feats && typeof feats === "object" ? Object.keys(feats).length : null),
                  sampleFeature: Array.isArray(feats) && feats[0] ? summarizeDeep(feats[0], 0) : null,
                };
              }
            }
          }
          return summary;
        });
        out.rawFirstTileFlags = {
          firstTileLoad: inner.firstTileLoad,
          firstTileLoadType: typeof inner.firstTileLoad,
          hasZoomChange: inner.hasZoomChange,
          running: A.running,
          numLoading: inner.numLoading,
          numTileLoading: inner.numTileLoading,
        };
      } catch (error) {
        out.rawCacheError = String(error && error.message ? error.message : error);
      }
      // 再 pick 一次（doOnceDraw 之后）
      try {
        const rect2 = host.getBoundingClientRect();
        const r = typeof A.pickFeatures === "function" ? A.pickFeatures(Math.round(rect2.left + rect2.width / 2), Math.round(rect2.top + rect2.height / 2)) : "missing";
        out.probes.pickAfterDraw = summarizeValue(r);
      } catch (error) {
        out.probes.pickAfterDraw = { threw: String(error && error.message ? error.message : error) };
      }
      return out;
    });
    if (report.internal && report.internal.value && typeof report.internal.value === "object") {
      const iv = report.internal.value;
      if (iv.rawCacheEntries) report.rawCacheEntries = iv.rawCacheEntries;
      if (iv.rawFirstTileFlags) report.rawFirstTileFlags = iv.rawFirstTileFlags;
      if (iv.rawTileCache) report.rawTileCache = iv.rawTileCache;
      if (iv.rawStyleExpress) report.rawStyleExpress = iv.rawStyleExpress;
    }

    /* ---------------------------------------------------------- 点击目标（网格） */
    const rect = host.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const targets = [];
    for (let dy = -150; dy <= 150; dy += 50) {
      for (let dx = -200; dx <= 200; dx += 50) {
        targets.push({ x: Math.round(cx + dx), y: Math.round(cy + dy) });
      }
    }
    report.clickTargets = targets;

    /* ---------------------------------------------------------- 状态命令包装 */
    window.__mvt = {
      updateStateBare: () => {
        const r = attempt(() => A.updateState("feat-1", { selected: true }, false));
        report.state.attempts.push({ form: "bare", threw: r.threw, message: r.message });
        return r;
      },
      updateStateComposite: () => {
        const r = attempt(() => A.updateState("lines_feat-1", { selected: true }, false));
        report.state.attempts.push({ form: "composite", threw: r.threw, message: r.message });
        return r;
      },
      clearState: () => {
        const r = attempt(() => A.clearState());
        report.state.attempts.push({ form: "clear", threw: r.threw, message: r.message });
        return r;
      },
      setStyleSolid: () => {
        const r = attempt(() => A.setStyle(solidStyle));
        report.state.attempts.push({ form: "setStyleSolid", threw: r.threw, message: r.message });
        const rFlat = attempt(() => A.setStyle(solidFlatStyle));
        report.state.attempts.push({ form: "setStyleSolidFlat", threw: rFlat.threw, message: rFlat.message });
        return r;
      },
      setStyleFeatureState: () => {
        const r = attempt(() => A.setStyle(featureStateStyle));
        report.state.attempts.push({ form: "setStyleFeatureState", threw: r.threw, message: r.message });
        return r;
      },
    };

    report.phase = "ready";
    const readyDeadline = Date.now() + 90000;
    while (!window.__mvtDone && Date.now() < readyDeadline) await wait(200);

    /* ---------------------------------------------------------- remove 对称 */
    report.remove.directShell = attempt(() => map.removeLayer(A));
    report.remove.a2Shell = attempt(() => map.removeLayer(A2));
    report.remove.curlyShell = attempt(() => map.removeLayer(C));
    if (U) {
      report.remove.unwrapShell = attempt(() => map.removeLayer(U));
    } else {
      report.remove.unwrapShell = { skipped: true, note: "direct 已可用时未构造 unwrap 臂实例" };
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__MVT_LAYER_PROBE__ = report;
})();
`;

/* ------------------------------------------------------------------ 判定 */

interface Attempt {
  threw: boolean;
  message?: string | null;
}

interface ProbeReport {
  phase: string;
  sdk: { version?: string; mvtLayer?: string; prototypeMembers?: string[] } | null;
  brands?: {
    shellIsTileLayer?: unknown;
    shellHasLayer?: unknown;
    innerIsTileLayer?: unknown;
    innerCtor?: string;
    shellMembers?: string[];
  };
  apiPresence?: Record<string, boolean>;
  mapZoom?: Attempt & { value?: unknown };
  baiduRequests?: number;
  mount: {
    direct?: (Attempt & { bracketRequests?: number; perfBracketRequests?: number }) | null;
    a2?: Attempt | null;
    curly?: (Attempt & { curlyRequests?: number; perfCurlyRequests?: number }) | null;
    unwrap?: {
      skipped?: boolean;
      reason?: string;
      hasInner?: boolean;
    } & Partial<Attempt> & { bracketRequestsDelta?: number; bracketRequestsTotal?: number };
  };
  placeholders: { bracketUrls: string[]; curlyUrls: string[] };
  remove: Record<string, Attempt | { skipped?: boolean; note?: string }>;
  eventAttach: Record<string, Record<string, string>>;
  eventCounts: Record<string, Record<string, number>>;
  picks: Array<{
    layer: string;
    type: string;
    valueKind: string;
    valueLength: number | string;
    entities: Array<{ id: string; idType: string; layerName: string; propertyKeys: string[]; propertiesJson: string }>;
  }>;
  clickTargets: Array<{ x: number; y: number }>;
  state: { attempts: Array<{ form: string; threw: boolean; message?: string | null }> };
  pickFeaturesProbe?: Attempt & { available?: boolean; args?: unknown; result?: string; sample?: unknown; threw?: string };
  tilesReady?: {
    sawTilesEnd?: boolean;
    bracketRequests?: number;
    curlyRequests?: number;
    perfBracket?: number;
    serverHitTotal?: number;
  };
  internal?: Attempt & { value?: unknown };
  rawCacheEntries?: unknown[];
  rawFirstTileFlags?: Record<string, unknown>;
  rawTileCache?: Record<string, unknown> | null;
  rawStyleExpress?: unknown;
  tileHooks?: {
    calls?: Array<Record<string, unknown>>;
    worker?: Array<Record<string, unknown>>;
    load?: Array<Record<string, unknown>>;
    cbk?: Array<Record<string, unknown>>;
    other?: Array<Record<string, unknown>>;
    attempted?: Array<Record<string, unknown>>;
    installed?: Array<Record<string, unknown>>;
    missing?: Array<Record<string, unknown>>;
    shellProto?: string[];
    innerProto?: string[];
    actionPost?: Record<string, number>;
    actionMsg?: Record<string, number>;
  };
  setZIndexCheck?: { setThrew?: boolean; getThrew?: boolean; getValue?: unknown };
  console: Array<{ level: string; text: string }>;
  error: string | null;
  loadError?: string;
}

interface ShotReading {
  data: string;
}

/**
 * 本地瓦片请求数：**以 HTTP 服务端命中为准**，不用主线程 `performance` 资源表。
 *
 * 实测（2026-09-23）：MVT 拉瓦片走 Worker/独立请求通道时，`getEntriesByType("resource")`
 * 在页面主线程上看不到 `/mvt/` 条目（读成 0），但本地 HTTP 服务收到了 50 次命中——
 * 若拿 performance 当控件，会把「实际已请求」误判成「没挂上」。
 */
function serverTileHits(serverHits: string[], prefix: "/mvt/" | "/mvtc/"): string[] {
  return serverHits.filter((path) => path.startsWith(prefix));
}

function localTileRequests(report: ProbeReport, serverHits: string[]): number {
  void report;
  return serverTileHits(serverHits, "/mvt/").length + serverTileHits(serverHits, "/mvtc/").length;
}

/**
 * 把**服务端命中路径**叠到页面报告上（Worker 请求不进主线程 resource timing，
 * 页面侧的 performance 计数会漏读成 0——见 `serverTileHits` 注释）。
 *
 * 页面脚本只用浏览器 API；这份叠层发生在 Node 侧读完报告之后，因此 `PAGE_JS`
 * 里绝不能引用 `serverTileHits`（会 ReferenceError，见 2026-09-23 实测）。
 */
function overlayServerReadings(report: ProbeReport, serverHits: string[]): ProbeReport {
  const bracket = serverTileHits(serverHits, "/mvt/");
  const curly = serverTileHits(serverHits, "/mvtc/");
  // 占位符样本：服务端路径是 ground truth（performance 样本可能为空）
  if (bracket.length > 0) report.placeholders.bracketUrls = bracket.slice(0, 8);
  if (curly.length > 0) report.placeholders.curlyUrls = curly.slice(0, 8);
  // 挂载读数：服务端有命中 ⇒ 以服务端为准；否则保留页面侧 performance 计数
  if (report.mount.direct && (bracket.length > 0 || report.mount.direct.bracketRequests === 0)) {
    report.mount.direct.bracketRequests = bracket.length;
    report.mount.direct.perfBracketRequests = report.mount.direct.bracketRequests;
  }
  if (report.mount.curly && (curly.length > 0 || report.mount.curly.curlyRequests === 0)) {
    report.mount.curly.curlyRequests = curly.length;
  }
  if (report.mount.unwrap && report.mount.unwrap.skipped !== true) {
    const total = bracket.length;
    report.mount.unwrap.bracketRequestsTotal = total;
    report.mount.unwrap.bracketRequestsDelta = total - (report.mount.direct?.bracketRequests ?? 0);
  }
  report.tilesReady = {
    ...report.tilesReady,
    bracketRequests: bracket.length,
    curlyRequests: curly.length,
    serverHitTotal: serverHits.length,
    perfBracket: report.tilesReady?.perfBracket ?? 0,
  };
  return report;
}

/** 正证控件：不成立就**不出结论**（不是「SDK 行为不好」）。 */
function controlFailures(report: ProbeReport, serverHits: string[]): string[] {
  const failures: string[] = [];
  if (report.sdk?.mvtLayer !== "function") {
    failures.push(`BMap.MVTLayer 构造器不是 function（得到 ${String(report.sdk?.mvtLayer)}）：本轮无法判定`);
  }
  const bracket = serverTileHits(serverHits, "/mvt/").length;
  const curly = serverTileHits(serverHits, "/mvtc/").length;
  const local = bracket + curly;
  if (!(local > 0)) {
    failures.push(
      `本地瓦片请求数为 ${local}（/mvt/=${bracket} /mvtc/=${curly}，服务端命中合计 ${serverHits.length}）：` +
        "挂载 / 占位符实验无法判定",
    );
  }
  return failures;
}

const UNKNOWN = "**无法判定**（读数缺失）";

function verdicts(report: ProbeReport, shots: Record<string, unknown>): string[] {
  const lines: string[] = [];

  // ── 1. 挂载：直接挂 vs 拆壳 ─────────────────────────────────────────────
  const direct = report.mount.direct;
  const unwrap = report.mount.unwrap;
  if (!direct || typeof direct.threw !== "boolean") {
    lines.push(`[挂载·直接] ${UNKNOWN}`);
  } else if (direct.threw) {
    const delta = unwrap && unwrap.skipped !== true ? unwrap.bracketRequestsDelta : undefined;
    lines.push(
      `[挂载·直接] map.addLayer(壳) 抛错（${String(direct.message)}）；` +
        (unwrap && unwrap.skipped !== true
          ? `拆壳 addLayer(壳.layer) 未抛错=${String(unwrap.threw === false)} 且新增请求=${String(delta)} ⇒ ` +
            (unwrap.threw === false && typeof delta === "number" && delta > 0
              ? "**必须拆壳**（直接挂不可用，拆壳可用）"
              : "拆壳臂读数不支持「拆壳可用」⇒ 需人工看原始报告")
          : "拆壳臂未跑 ⇒ 本轮不能回答拆壳是否可用") +
        `（请求 ${String(direct.bracketRequests)}）`,
    );
  } else {
    const requests = direct.bracketRequests ?? 0;
    lines.push(
      `[挂载·直接] map.addLayer(壳) 未抛错，方括号模板请求=${requests} ⇒ ` +
        (requests > 0
          ? "**直接挂壳可用**（不需要拆壳；与 skill 参考一致，与 react-bmap 的 unwrap 宽容写法也不冲突）"
          : "未抛错但没有请求 ⇒ 直接挂是否真的生效**无法判定**（看拆壳臂）"),
    );
    if (unwrap && unwrap.skipped !== true) {
      lines.push(
        `[挂载·拆壳] 追加跑了一次：未抛错=${String(unwrap.threw === false)} 新增请求=${String(unwrap.bracketRequestsDelta)}`,
      );
    }
  }
  if (report.mount.a2) {
    lines.push(
      `[挂载·id 对照] 无 idProperty 的实例 addLayer 未抛错=${String(report.mount.a2.threw === false)}` +
        (report.mount.a2.message ? `（${report.mount.a2.message}）` : ""),
    );
  }

  // ── 2. 占位符 ──────────────────────────────────────────────────────────
  const bracketUrls = report.placeholders.bracketUrls;
  const bracketSubstituted =
    bracketUrls.length > 0 && bracketUrls.every((url) => /^\/mvt\/\d+\/\d+\/\d+\.pbf$/.test(url));
  lines.push(
    `[占位符·方括号] 样本=${JSON.stringify(bracketUrls)} ⇒ ` +
      (bracketUrls.length === 0
        ? UNKNOWN
        : bracketSubstituted
          ? "**方括号占位符生效**（请求 URL 里是数字坐标）"
          : "**方括号样本不是数字坐标** ⇒ 需要看原始报告"),
  );
  const curlyUrls = report.placeholders.curlyUrls;
  const curlyLiteral = curlyUrls.some((url) => /\{z\}|\{x\}|\{y\}|%7Bz%7D/i.test(url));
  const curlySubstituted = curlyUrls.length > 0 && curlyUrls.every((url) => /^\/mvtc\/\d+\/\d+\/\d+\.pbf$/.test(url));
  lines.push(
    `[占位符·花括号] 样本=${JSON.stringify(curlyUrls)} ⇒ ` +
      (curlyUrls.length === 0
        ? UNKNOWN
        : curlyLiteral
          ? "**花括号不生效**（请求里仍是字面量 {z}/{x}/{y}）——与 skill 参考、react-bmap 一致"
          : curlySubstituted
            ? "**花括号也生效了**（与「参考」的说法冲突，以本读数为准）"
            : "请求既非字面量也非纯数字路径 ⇒ 需要看原始报告"),
  );

  // ── 3. removeLayer 对称 ────────────────────────────────────────────────
  for (const [key, label] of [
    ["directShell", "直接挂的壳"],
    ["a2Shell", "id 对照壳"],
    ["curlyShell", "花括号壳"],
    ["unwrapShell", "拆壳臂的壳"],
  ] as const) {
    const reading = report.remove[key];
    if (!reading || typeof (reading as Attempt).threw !== "boolean") {
      lines.push(`[remove·${label}] ${UNKNOWN}`);
      continue;
    }
    const attemptReading = reading as Attempt;
    lines.push(
      `[remove·${label}] removeLayer ${attemptReading.threw ? `抛错（${attemptReading.message}）` : "未抛错"}` +
        "（对称性：与挂载用同一个引用）",
    );
  }

  // ── 4. 声明面之外的成员 ─────────────────────────────────────────────────
  const presence = report.apiPresence ?? {};
  const declaredOnly = [
    "setZIndex", "getZIndex", "setStyle", "updateState", "clearState",
    "addEventListener", "removeEventListener",
  ];
  const undeclaredPresent = Object.keys(presence).filter(
    (name) => presence[name] && !declaredOnly.includes(name),
  );
  const declaredMissing = declaredOnly.filter((name) => presence[name] === false);
  lines.push(
    `[声明面] 原型上**超出**核心声明却存在的成员：${undeclaredPresent.join(", ") || "（无）"}；` +
      `核心声明里**缺失**的：${declaredMissing.join(", ") || "（无）"}`,
  );
  if (report.setZIndexCheck) {
    lines.push(
      `[声明面·setZIndex] set 未抛错=${String(report.setZIndexCheck.setThrew === false)} ` +
        `get 未抛错=${String(report.setZIndexCheck.getThrew === false)} 值=${String(report.setZIndexCheck.getValue)}`,
    );
  }

  // ── 5. 拾取载荷与 idProperty ───────────────────────────────────────────
  const picksA = report.picks.filter((p) => p.layer === "A");
  const picksA2 = report.picks.filter((p) => p.layer === "A2");
  const hitA = picksA.find((p) => p.valueKind === "array" && Number(p.valueLength) > 0);
  const hitA2 = picksA2.find((p) => p.valueKind === "array" && Number(p.valueLength) > 0);
  lines.push(
    `[拾取·有 idProperty] 命中样本数=${picksA.filter((p) => Number(p.valueLength) > 0).length} ` +
      (hitA
        ? `载荷 value=${hitA.valueKind}[${String(hitA.valueLength)}] 实体=${JSON.stringify(hitA.entities[0])}`
        : "（本轮没有取到非空命中 ⇒ 拾取载荷**无法判定**）"),
  );
  lines.push(
    `[拾取·无 idProperty] 命中样本数=${picksA2.filter((p) => Number(p.valueLength) > 0).length} ` +
      (hitA2
        ? `载荷 value=${hitA2.valueKind}[${String(hitA2.valueLength)}] 实体=${JSON.stringify(hitA2.entities[0])}`
        : "（本轮没有取到非空命中 ⇒ **无法判定**）"),
  );
  if (hitA && hitA2) {
    const idA = hitA.entities[0]?.id;
    const idA2 = hitA2.entities[0]?.id;
    lines.push(
      `[idProperty 作用] 有 idProperty 时 Entity.id=${JSON.stringify(idA)}；` +
        `无 idProperty 时 Entity.id=${JSON.stringify(idA2)} ⇒ ` +
        (idA !== idA2
          ? "**idProperty 决定身份来源**（两者不同）"
          : "两者相同 ⇒ 本轮看不出 idProperty 对 Entity.id 的作用"),
    );
  }
  const attachA = report.eventAttach.A ?? {};
  const attachFailures = Object.entries(attachA).filter(([k, v]) => !k.endsWith(":via") && !k.endsWith(":stack") && v !== "ok");
  lines.push(
    `[事件·挂绑] A 的六个官方事件名 addEventListener 全部成功=${attachFailures.length === 0}` +
      (attachFailures.length ? ` 失败=${JSON.stringify(attachFailures)}` : "") +
      `；计数=${JSON.stringify(report.eventCounts.A)}` +
      (report.eventAttach.A?.["click:via"] ? `；click.via=${report.eventAttach.A["click:via"]}` : ""),
  );
  if (report.pickFeaturesProbe) {
    lines.push(
      `[拾取·pickFeatures] ${JSON.stringify(report.pickFeaturesProbe)}`,
    );
  }

  // ── 6. 状态键与样式求值（截图差分） ─────────────────────────────────────
  const stable = shots.stable === true;
  const styleFsStable = shots.styleFsStable === true;
  const styleChanged = shots.styleChanged === true;
  const styleFsChanged = shots.styleFsChanged === true;
  const bareChanged = shots.bareChanged === true;
  const compositeChanged = shots.compositeChanged === true;
  const afterBareClearOk = shots.afterBareClearOk === true;
  const afterCompositeClearOk = shots.afterCompositeClearOk === true;
  const bareDelta = Number(shots.bareBytesDelta ?? Number.POSITIVE_INFINITY);
  const compositeDelta = Number(shots.compositeBytesDelta ?? Number.POSITIVE_INFINITY);
  // 源码 evaluateContext/getRender 始终拼 layerName_id；裸键差分若远小于组合键，按噪声/未命中记。
  const bareEffective = bareChanged && bareDelta >= Math.max(500, compositeDelta * 0.25);
  const compositeEffective = compositeChanged && compositeDelta >= 500;
  const attemptErrors = report.state.attempts.filter((a) => a.threw);
  const prefix = `[状态] 调用抛错=${attemptErrors.length ? JSON.stringify(attemptErrors) : "无"}；`;
  if (!stable || !styleFsStable) {
    lines.push(`${prefix}截图基线不稳定（纯色或 feature-state 基线两次不一致）⇒ **状态组无法判定**`);
  } else if (!styleChanged) {
    lines.push(
      `${prefix}setStyle 纯色对照没有改变画面 ⇒ 截图差分对本场景不灵敏（或 setStyle 无效），` +
        "**状态组无法判定**",
    );
  } else if (!styleFsChanged) {
    lines.push(
      `${prefix}切到 feature-state 样式没有改变画面（或未生效）⇒ **状态组无法判定**` +
        `（clearState 恢复：裸=${afterBareClearOk ? "是" : "否"} 组合=${afterCompositeClearOk ? "是" : "否"}）`,
    );
  } else {
    const keyVerdict = bareEffective && compositeEffective
      ? "两种键形都改变了画面"
      : compositeEffective && !bareEffective
        ? "**组合键 layerName_id 生效**（裸 id 不生效或差分可忽略）——与 skill 参考一致"
        : bareEffective && !compositeEffective
          ? "**裸 id 生效**（组合键不生效）——与 skill 参考冲突，以本读数为准"
          : "两种键形都没证明改变画面 ⇒ **未能证明状态进入样式求值**（键形与 feature-state 求值无法区分）";
    lines.push(
      `${prefix}setStyle 对照=变了；feature-state 样式基线=变了；` +
        `裸 id=${bareEffective ? "生效" : bareChanged ? `有噪声级差分(Δ${bareDelta}B)` : "未变"} ` +
        `组合键=${compositeEffective ? `生效(Δ${compositeDelta}B)` : compositeChanged ? `有噪声级差分(Δ${compositeDelta}B)` : "未变"} ` +
        `⇒ ${keyVerdict}` +
        `（clearState 恢复：裸=${afterBareClearOk ? "是" : "否"} 组合=${afterCompositeClearOk ? "是" : "否"}）`,
    );
  }

  const counts = report.eventCounts.A ?? {};
  lines.push(
    `[事件·瓦片] tilesloadstart=${String(counts.tilesloadstart)} tilesloadend=${String(counts.tilesloadend)} ` +
      `（sawTilesEnd=${String(report.tilesReady?.sawTilesEnd)}）`,
  );
  return lines;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:mvt-layer`");
    return 2;
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`);
    return 2;
  }

  let pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak));
  if (process.env.MVT_PROBE_NO_LAYERS === "1") {
    pageScript = pageScript.split("layers: layerConfigs,").join("");
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>mvt layer probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const tile = buildProbeTile();
  console.log(`[mvt-layer] 瓦片字节=${tile.byteLength} 模式=${process.env.MVT_PROBE_TILE || "local"}`);
  const userDataDir = mkdtempSync(join(tmpdir(), "mvt-layer-chrome-"));
  const serverHits: string[] = [];
  const server: Server = createServer((req, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0]!;
    serverHits.push(path);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,HEAD,OPTIONS",
        "access-control-allow-headers": "*",
      });
      res.end();
      return;
    }
    if (path === "/" ) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(pageHtml);
      return;
    }
    // 方括号与花括号两条路径都吃：占位符**没被替换**时路径里会是字面量 {z} 等，照样 200，
    // 这样「花括号不生效」表现为「请求路径含字面量」而不是「0 个请求」（0 个请求会与
    // 「图层没挂上」混在一起，读数会分不清）。
    if (path.startsWith("/mvt/") || path.startsWith("/mvtc/") || path.includes("{z}") || path.includes("%7B")) {
      res.writeHead(200, {
        "content-type": "application/x-protobuf",
        "cache-control": "no-store",
        "content-length": String(tile.byteLength),
        // Worker（blob 源）拉瓦片时若无 CORS 头会静默失败 ⇒ 只剩 loading / 空 layers
        "access-control-allow-origin": "*",
      });
      res.end(tile);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[mvt-layer] 服务未就绪（脚手架失败）");
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
        "--window-size=900,700",
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
    await session.send("Page.enable").catch(() => undefined);

    const ready = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__MVT_LAYER_PROBE__ && window.__MVT_LAYER_PROBE__.phase === 'ready' ? JSON.stringify(window.__MVT_LAYER_PROBE__) : null",
      deadline: Date.now() + 150_000,
      pollIntervalMs: 500,
    });
    if (!ready) {
      const err = await readProbeReport<ProbeReport>(session, {
        expression:
          "window.__MVT_LAYER_PROBE__ && window.__MVT_LAYER_PROBE__.phase === 'error' ? JSON.stringify(window.__MVT_LAYER_PROBE__) : null",
        deadline: Date.now() + 3_000,
        pollIntervalMs: 300,
      });
      if (err?.error) console.error(`页面异常：${redact(err.error).split("\n")[0]}`);
      console.error("PROBE_NOT_READY：页面没有进入 ready（SDK / 地图 / 图层没起来）");
      return 3;
    }

    console.log("== MVT 图层探针 ==");
    console.log(`SDK：version=${String(ready.sdk?.version)} MVTLayer=${String(ready.sdk?.mvtLayer)}`);
    console.log(`  品牌标记：${JSON.stringify(ready.brands)}`);
    console.log(`  mount.direct：${JSON.stringify(ready.mount.direct)}`);
    console.log(`  mount.curly：${JSON.stringify(ready.mount.curly)}`);
    console.log(`  mount.unwrap：${JSON.stringify(ready.mount.unwrap)}`);
    console.log(`  占位符方括号样本：${JSON.stringify(ready.placeholders.bracketUrls)}`);
    console.log(`  占位符花括号样本：${JSON.stringify(ready.placeholders.curlyUrls)}`);
    const bracketHits = serverTileHits(serverHits, "/mvt/");
    const curlyHits = serverTileHits(serverHits, "/mvtc/");
    console.log(`  服务端 /mvt/ 命中=${bracketHits.length} /mvtc/ 命中=${curlyHits.length} 合计=${serverHits.length}`);
    console.log(`  服务端路径样本：${JSON.stringify(serverHits.slice(0, 12))}`);
    console.log(`  本地瓦片请求合计（服务端口径）：${bracketHits.length + curlyHits.length}`);
    console.log(`  主线程 performance /mvt/ 计数：direct=${String(ready.mount.direct?.bracketRequests)} tilesReady=${String(ready.tilesReady?.perfBracket)}`);
    console.log(`  百度主机请求（含 SDK 脚本）：${String(ready.baiduRequests)}`);

    const shots: Record<string, string> = {};
    const capture = async (name: string): Promise<void> => {
      const message = await session!.send("Page.captureScreenshot", { format: "png" });
      // captureScreenshot 的返回在 CDP 顶层 result.data（不是 Runtime.evaluate 的 result.result.value）
      const data = (message.result as { data?: unknown } | undefined)?.data;
      if (typeof data === "string") shots[name] = data;
    };

    // 稳定性基线（纯色初值）→ setStyle 敏感度对照 → feature-state 样式基线 → 状态臂
    for (let attemptI = 0; attemptI < 8; attemptI += 1) {
      await sleep(600);
      await capture("baselineA");
      await sleep(400);
      await capture("baselineB");
      if (shots.baselineA !== undefined && shots.baselineA === shots.baselineB) break;
    }

    let dispatched = 0;
    for (const targetPoint of ready.clickTargets) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
        await session.send("Input.dispatchMouseEvent", {
          type,
          x: targetPoint.x,
          y: targetPoint.y,
          button: type === "mouseMoved" ? "none" : "left",
          clickCount: type === "mouseMoved" ? 0 : 1,
        });
      }
      dispatched += 1;
      await sleep(120);
    }
    console.log(`  已派发网格点击 ${dispatched} 点`);
    await sleep(1000);

    const evaluate = async (expression: string): Promise<void> => {
      await session!.send("Runtime.evaluate", { expression, returnByValue: true });
    };

    // setStyle 敏感度对照（在 feature-state 之前，对照初值基线）
    await evaluate("window.__mvt.setStyleSolid()");
    await sleep(600);
    await capture("styleSolid");

    // 状态必须先落在带 feature-state 表达式的样式上，否则 updateState 写状态也不改画面。
    await evaluate("window.__mvt.setStyleFeatureState()");
    for (let fsI = 0; fsI < 6; fsI += 1) {
      await sleep(500);
      await capture("styleFsBaseline");
      await sleep(350);
      await capture("styleFsBaselineB");
      if (shots.styleFsBaseline !== undefined && shots.styleFsBaseline === shots.styleFsBaselineB) break;
    }
    await evaluate("window.__mvt.updateStateBare()");
    await sleep(500);
    await capture("bare");
    await evaluate("window.__mvt.clearState()");
    await sleep(400);
    await capture("afterBareClear");
    await evaluate("window.__mvt.updateStateComposite()");
    await sleep(500);
    await capture("composite");
    await evaluate("window.__mvt.clearState()");
    await sleep(400);
    await capture("afterCompositeClear");
    await evaluate("window.__mvt.setStyleFeatureState()");
    await sleep(400);
    await capture("styleRestored");

    await evaluate("window.__mvtDone = true");

    const report = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__MVT_LAYER_PROBE__ && window.__MVT_LAYER_PROBE__.phase === 'done' ? JSON.stringify(window.__MVT_LAYER_PROBE__) : null",
      deadline: Date.now() + 60_000,
      pollIntervalMs: 400,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有在状态臂之后收尾");
      return 3;
    }
    overlayServerReadings(report, serverHits);

    // 状态差分以 feature-state 样式基线为准（纯色初值下 updateState 不改画面）。
    // 键形生效用字节差分阈值过滤 map 微抖动（源码 evaluateContext/getRender 只读 layerName_id）。
    const fsRef = shots.styleFsBaseline;
    const delta = (a?: string, b?: string) => {
      if (a === undefined || b === undefined) return Number.POSITIVE_INFINITY;
      return Math.abs(Buffer.from(a, "base64").length - Buffer.from(b, "base64").length);
    };
    // 粗差分：base64 字符串不等即算“变”；键形另报字节差供判定参考。
    const shotFlags = {
      stable: shots.baselineA !== undefined && shots.baselineA === shots.baselineB,
      styleFsStable: shots.styleFsBaseline !== undefined && shots.styleFsBaseline === shots.styleFsBaselineB,
      styleFsChanged: shots.baselineA !== undefined && shots.styleFsBaseline !== undefined && shots.styleFsBaseline !== shots.baselineA,
      bareChanged: fsRef !== undefined && shots.bare !== undefined && shots.bare !== fsRef,
      afterBareClearOk: fsRef !== undefined && shots.afterBareClear !== undefined && shots.afterBareClear === fsRef,
      compositeChanged: fsRef !== undefined && shots.composite !== undefined && shots.composite !== fsRef,
      afterCompositeClearOk: fsRef !== undefined && shots.afterCompositeClear !== undefined && shots.afterCompositeClear === fsRef,
      styleChanged: shots.baselineA !== undefined && shots.styleSolid !== undefined && shots.styleSolid !== shots.baselineA,
      styleRestored: shots.styleFsBaseline !== undefined && shots.styleRestored !== undefined && shots.styleRestored === shots.styleFsBaseline,
      bareBytesDelta: delta(shots.bare, fsRef),
      compositeBytesDelta: delta(shots.composite, fsRef),
      shotBytes: Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.length])),
    };

    console.log(`页面阶段：${report.phase}`);
    for (const [label, counts] of Object.entries(report.eventCounts)) {
      console.log(`  事件计数 ${label}：${JSON.stringify(counts)}`);
    }
    if (report.internal) {
      console.log(`  内部诊断：${JSON.stringify(report.internal).slice(0, 4000)}`);
    }
    if (report.tileHooks) {
      console.log(`  瓦片钩子·actions post=${JSON.stringify(report.tileHooks.actionPost)} msg=${JSON.stringify(report.tileHooks.actionMsg)}`);
      console.log(`  瓦片钩子·worker：${JSON.stringify(report.tileHooks.worker).slice(0, 2500)}`);
      console.log(`  瓦片钩子·load：${JSON.stringify(report.tileHooks.load).slice(0, 1500)}`);
      console.log(`  瓦片钩子·cbk：${JSON.stringify(report.tileHooks.cbk).slice(0, 1500)}`);
      console.log(`  瓦片钩子·other：${JSON.stringify(report.tileHooks.other).slice(0, 2500)}`);
    }
    if (report.rawCacheEntries) {
      console.log(`  缓存条目：${JSON.stringify(report.rawCacheEntries).slice(0, 4000)}`);
    }
    if (report.rawFirstTileFlags) {
      console.log(`  firstTile 标志：${JSON.stringify(report.rawFirstTileFlags)}`);
    }
    for (const pick of report.picks.slice(0, 8)) console.log(`  拾取：${JSON.stringify(pick)}`);
    for (const attemptEntry of report.state.attempts) {
      console.log(`  状态调用：${JSON.stringify(attemptEntry)}`);
    }
    console.log(`  截图差分：${JSON.stringify({ ...shotFlags, shotBytes: shotFlags.shotBytes })}`);
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`);
    if (report.console.length > 0) {
      console.log(`-- 页面 console（${report.console.length} 条，最多 12 条）--`);
      for (const entry of report.console.slice(0, 12)) {
        console.log(`  [${entry.level}] ${redact(entry.text)}`);
      }
    }

    const writeOut = (): void => {
      if (!outPath) return;
      const serializable = { ...report, shots: shotFlags, serverHits: serverHits.slice(0, 80) };
      writeFileSync(outPath, redact(JSON.stringify(serializable, null, 2)));
      console.log(`原始报告（已脱敏）写入 ${outPath}`);
    };

    const failures = controlFailures(report, serverHits);
    writeOut();
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --");
      for (const failure of failures) console.error(`  ${failure}`);
      return 1;
    }
    if (report.phase !== "done") return 3;

    console.log("-- 结论 --");
    const lines = verdicts(report, shotFlags as Record<string, unknown>);
    for (const line of lines) console.log(`  ${line}`);
    console.log(`summary: ${redact(lines.join(" | "))}`);
    return 0;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

function redact(text: string): string {
  const trimmed = ak.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[mvt-layer] 脚手架失败：${redact(String(error))}`);
  return 2;
});
