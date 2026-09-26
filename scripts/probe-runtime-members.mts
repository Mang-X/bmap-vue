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
 * | 7 | `setCenter('北京')` 字符串中心到底能不能跑通？读回什么？ | **Class 2 / E**：`MapProps.center` 接受 `string`（v2 兼容）但 `MapCommands.setCenter` 不接受，两张脸打架。声明 `Point \| string` 不足以回答「字符串中心是否真能用」 |
 * | 8 | `panTo` / `setCenter` / `setZoom` / `setHeading` / `setTilt` 的 `options.callback` 真的会调吗？调几次？ | **Class 2 / F + G**：声明有 `options`，但「有声明」≠「回调被交付」。没有回调就没有「命令完成」这个概念，缺口是行为性的 |
 * | 9 | `panTo` 不传 `noAnimation` 时，中心点是一次到位还是渐变过去的？ | **Class 2 / G**：官方 `panTo` 的 `noAnimation` 默认 `false`（=有动画）。本库 prop 侧与命令侧的默认口径必须与之对上 |
 * | 10 | `setMapStyle({styleJson})` 收 `Record` 还是 `object[]`？同时给 `styleId` + `styleJson` 谁赢？ | **Class 2 / H**：官方声明 `styleJson?: object[]`，本库 prop 是 `Record`（单数）。数组 / 对象两种形状在运行时分别怎样 |
 * | 11 | `Panorama` 的 `capture` / `clearOverlays` 在**实例**上真在吗？ | **Class 2 / I**：上一轮探 `B.Panorama.prototype` 全 false，但那是**原型**读法，对挂在实例上的成员无效 |
 * | 12 | 官方 `reset()` 到底重置哪些字段？ | **Class 2 / D**：声明只说「恢复地图初始化时的中心点和级别」，**没提** heading/tilt；本库 `resetView()` 连 heading/tilt 一起重置，这是行为差 |
 * | 13 | 走**动画档**（不传 `noAnimation`）时 `options.callback` 还会不会调？ | **Class 2 / F**：`noAnimation:true` 下 callback「立即调用」不代表动画档也会交付 |
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
  // 注入时机（#166）：PolygonLayer / PolylineLayer 是不是像 PointLayer 那一族一样
  // 「首次加载时异步注入」？判据是**在 BMap.Map 刚可用的那一刻**它们是否已在位——
  // 若在位 ⇒ 随主包注入（Driver 走 namespaceCtor）；若不在 ⇒ 与扩展 API 同族
  // （Driver 走 requireRuntimeCtor，supports 要能被时序救回来）。
  R.readings.injectionTiming = {
    PolygonLayerAtMapReady: typeof B.PolygonLayer,
    PolylineLayerAtMapReady: typeof B.PolylineLayer,
    PointLayerAtMapReady: typeof B.PointLayer,
    HeatmapAtMapReady: typeof B.Heatmap,
  };

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

  // 3b. #166：visualization/PolygonLayer / PolylineLayer（4.0.5 新增，官方建议作为
  // 弃用 FillLayer / LineLayer 的替代）。逐个成员核对「声明 vs 运行时」——
  // 声明给的是形状，运行时给的是**在位性**，两者可以不一致（#165 结论三已实测过四类：
  // setStyle 声明没有 / 运行时也没有，而 setOptions 声明有）。
  const VIS2 = {
    PolygonLayer: ["setData","getData","clearData","setOptions","getOptions","setEnablePicked","getEnablePicked","hitTest","setVisible","getVisible","setZIndex","getZIndex","setRenderStage","getRenderStage","setRefCenter","getRefCenter","addEventListener","removeEventListener","setStyle","setStyleOptions","setBaseOptions","setOpacity","setMinZoom","setMaxZoom"],
    PolylineLayer: ["setData","getData","clearData","setOptions","getOptions","setEnablePicked","getEnablePicked","hitTest","setVisible","getVisible","setZIndex","getZIndex","setRenderStage","getRenderStage","setRefCenter","getRefCenter","addEventListener","removeEventListener","setStyle","setStyleOptions","setBaseOptions","setOpacity","setMinZoom","setMaxZoom"],
  };
  R.readings.visualizationV2 = {};
  for (const [name, members] of Object.entries(VIS2)) {
    const ctor = B[name];
    R.readings.visualizationV2[name] = {
      ctorPresent: typeof ctor === "function",
      members: Object.fromEntries(members.map(m => [m, protoHas(ctor, m)])),
    };
  }
  // 3c. 能否**真的构造 + 交付数据**（存在构造器 ≠ 构造成功；且命中回包的形状决定 pick 载荷）
  R.readings.visualizationV2Construct = {};
  for (const name of ["PolygonLayer", "PolylineLayer"]) {
    R.readings.visualizationV2Construct[name] = (() => {
      try {
        const L = new B[name]({});
        const out = { ctorThrew: false, setDataThrew: false, getDataShape: null, optionsThrew: false, enablePickedThrew: false };
        try { L.setData({ type: "FeatureCollection", features: [] }); }
        catch (e) { out.setDataThrew = String(e && e.message || e); }
        try { out.getDataShape = typeof L.getData(); } catch (e) { out.getDataShape = "THREW:" + String(e && e.message || e); }
        try { L.setOptions({}); } catch (e) { out.optionsThrew = String(e && e.message || e); }
        try { out.enablePickedThrew = L.getEnablePicked() === undefined; } catch (e) { out.enablePickedThrew = "THREW:" + String(e && e.message || e); }
        // 3d. Map 是否**真的接受**这两个图层（声明说 addLayer 接受，但 addLayer 是
        // overloaded —— 只有真挂过才算数）。挂上后读回 removeLayer 是否可逆。
        out.mapAccepts = (() => {
          try {
            const div = document.createElement("div");
            div.style.cssText = "width:200px;height:200px;position:absolute;top:0;left:0";
            document.body.appendChild(div);
            const m = new B.Map(div);
            m.centerAndZoom(new B.Point(116.404, 39.915), 11);
            m.addLayer(L);
            const attached = true;
            // setZIndex 的官方要求是「先挂到 Map 上」——正好在这里验这条前提
            let zIndexThrew = null;
            try { L.setZIndex(3); } catch (e) { zIndexThrew = String(e && e.message || e); }
            m.removeLayer(L);
            // 重复摘除是否安全（内核的 detach 幂等性依赖前提 P）
            let secondRemoveThrew = null;
            try { m.removeLayer(L); } catch (e) { secondRemoveThrew = String(e && e.message || e); }
            m.destroy();
            div.remove();
            return { attached, zIndexThrew, secondRemoveThrew, zIndexReadBack: L.getZIndex() };
          } catch (e) { return { threw: String(e && e.message || e) }; }
        })();
        return out;
      } catch (e) { return { ctorThrew: true, message: String(e && e.message || e) }; }
    })();
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

  // —— 以下为 #165 Class 2 追加的 7~11 号取证 ——
  // 统一造一张 320x240 的图（必须给尺寸，否则官方内部拿不到 _painter）。
  const withMap = async (fn, settleMs = 900) => {
    const div = document.createElement("div");
    div.style.cssText = "width:320px;height:240px;position:absolute;top:0;left:0";
    document.body.appendChild(div);
    const mk = new B.Map(div, {});
    mk.centerAndZoom(new B.Point(116.404, 39.915), 12);
    await new Promise((r) => setTimeout(r, settleMs));
    try { return await fn(mk); }
    finally { try { mk.destroy(); } catch {} try { div.remove(); } catch {} }
  };
  const pt = (p) => p ? { lng: p.lng, lat: p.lat } : null;

  // 7. setCenter(string)：官方声明支持城市名。运行时能不能跑通？读回什么？
  // ⚠️ 判据必须**从一个明显不同的城市出发**：先前一轮用北京当地做起点，
  // 「setCenter('北京') 没动」与「字符串被静默忽略」读数完全一样（混淆读数）。
  // 这里从上海出发，北京必须表现为**真的动过去**才算数。
  R.readings.setCenterString = await withMap(async (mk) => {
    const out = { note: "起点上海(121.47,31.23)；'moved' = 中心点是否真的离开起点。", start: null, attempts: [] };
    mk.setCenter(new B.Point(121.47, 31.23), { noAnimation: true });
    await new Promise((r) => setTimeout(r, 1200));
    const start = pt(mk.getCenter());
    out.start = start;
    for (const name of ["北京", "NotACityName-zzz"]) {
      const rec = { name, threw: null, after: null, moved: false, stillAtStart: null };
      try {
        mk.setCenter(name, { noAnimation: true });
        await new Promise((r) => setTimeout(r, 1500));
        const c = mk.getCenter();
        rec.after = pt(c);
        rec.moved = !!(start && c && (Math.abs(c.lng - start.lng) > 1e-4 || Math.abs(c.lat - start.lat) > 1e-4));
        rec.stillAtStart = !(rec.moved);
      } catch (e) { rec.threw = String(e && e.message || e); }
      // 每轮后回到上海，保证下一轮的起点可比较
      try { mk.setCenter(new B.Point(121.47, 31.23), { noAnimation: true }); await new Promise((r) => setTimeout(r, 1200)); } catch {}
      out.attempts.push(rec);
    }
    return out;
  });

  // 8. options.callback 真的会被交付吗？调几次？——决定「命令完成」是否可观察
  const callbackProbe = async (method, arg, extra) => await withMap(async (mk) => {
    const rec = { fired: 0, firedWithin: null, elapsedMs: null, threw: null };
    const t0 = Date.now();
    const cb = () => { rec.fired++; if (rec.firedWithin === null) { rec.firedWithin = true; rec.elapsedMs = Date.now() - t0; } };
    try {
      const opts = Object.assign({ noAnimation: true, callback: cb }, extra || {});
      mk[method](arg, opts);
      await new Promise((r) => setTimeout(r, 2500));
    } catch (e) { rec.threw = String(e && e.message || e); }
    return rec;
  });
  R.readings.optionsCallback = {
    note: "noAnimation:true 下官方承诺 callback「立即调用」；读数只说明交付与否与次数，不判定对错。",
    setCenter: await callbackProbe("setCenter", new B.Point(116.5, 39.8)),
    setZoom: await callbackProbe("setZoom", 14),
    setHeading: await callbackProbe("setHeading", 45),
    setTilt: await callbackProbe("setTilt", 30),
    panTo: await callbackProbe("panTo", new B.Point(117.0, 39.5)),
  };
  // 有动画时（不传 noAnimation）callback 还会不会调？耗时多少？
  // 这一条决定「回调 = 命令完成」这个契约在**动画档**成不成立。
  R.readings.optionsCallbackAnimated = await withMap(async (mk) => {
    const rec = {};
    for (const [label, method, arg] of [
      ["setCenter", "setCenter", new B.Point(116.9, 39.1)],
      ["panTo", "panTo", new B.Point(117.9, 39.2)],
      ["setZoom", "setZoom", 15],
    ]) {
      const row = { fired: 0, elapsedMs: null };
      const t0 = Date.now();
      try { mk[method](arg, { callback: () => { row.fired++; if (row.elapsedMs === null) row.elapsedMs = Date.now() - t0; } }); }
      catch (e) { row.threw = String(e && e.message || e); }
      await new Promise((r) => setTimeout(r, 3000));
      rec[label] = row;
    }
    return { note: "不传 noAnimation（走默认动画档）后等 3s", ...rec };
  });

  // 12. 官方 reset() 到底重置哪些字段？——本库 resetView() 连 heading/tilt 一起重置。
  // 声明只说「恢复地图初始化时的中心点和级别」，**没有**说 heading/tilt。
  // ⚠️ 页面脚本整段在模板字符串里：这里**不能出现反引号**（会提前结束模板）。
  R.readings.resetScope = await withMap(async (mk) => {
    const rec = { before: null, after: null, declared: true };
    try {
      mk.setHeading(60); mk.setTilt(30);
      await new Promise((r) => setTimeout(r, 600));
      rec.before = { center: pt(mk.getCenter()), zoom: mk.getZoom(), heading: mk.getHeading(), tilt: mk.getTilt() };
      mk.setCenter(new B.Point(116.1, 39.1), { noAnimation: true });
      mk.setZoom(16, { noAnimation: true });
      await new Promise((r) => setTimeout(r, 600));
      rec.changed = { center: pt(mk.getCenter()), zoom: mk.getZoom(), heading: mk.getHeading(), tilt: mk.getTilt() };
      mk.reset();
      await new Promise((r) => setTimeout(r, 900));
      rec.after = { center: pt(mk.getCenter()), zoom: mk.getZoom(), heading: mk.getHeading(), tilt: mk.getTilt() };
    } catch (e) { rec.threw = String(e && e.message || e); }
    return rec;
  });

  // 9. panTo 动画默认：不传 options 时中心点是渐变过去的吗？
  // ⚠️ 采样必须**密于动画**。先前一轮每 100ms 采一次，而无头 SwiftShader 帧间隔更长，
  // 读数只能看到起点与终点两端 —— 「全程跳变」与「每秒只画一帧的渐变」读数一样。
  // 这里 16ms 一采、连续 1.5s，并**逐帧**判「既非起点也非终点」。
  R.readings.panToAnimationDefault = await withMap(async (mk) => {
    const target = { lng: 118.0, lat: 40.0 };
    const start = pt(mk.getCenter());
    const near = (p, t) => !!(p && Math.abs(p.lng - t.lng) < 1e-6 && Math.abs(p.lat - t.lat) < 1e-6);
    if (near(start, target)) return { skipped: true, reason: "起点与目标重合，换个目标再测", start };
    try { mk.panTo(new B.Point(target.lng, target.lat)); } catch (e) { return { threw: String(e && e.message || e) }; }
    const samples = [];
    for (let i = 0; i < 94; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      samples.push(pt(mk.getCenter()));
    }
    const midFlight = samples.filter((p) => !near(p, start) && !near(p, target)).length;
    const distinct = new Set(
      samples.map((p) => (p ? p.lng.toFixed(6) + "," + p.lat.toFixed(6) : "null")),
    ).size;
    return {
      note: "requestAnimationFrame 逐帧采样 1.5s；distinct = 出现过的不同中心点个数",
      start, target, distinctSampleCount: distinct,
      midFlightSamples: midFlight,
      animatedByDefault: midFlight > 0,
      finalIsTarget: near(samples[samples.length - 1], target),
    };
  });

  // 10. setMapStyle 的 styleJson：数组 / 对象两种形状分别发生什么；styleId 与 styleJson 同时给谁赢
  R.readings.setMapStyleShapes = await withMap(async (mk) => {
    const probeStyle = async (label, config) => {
      const rec = { label, config, threw: null };
      try {
        mk.setMapStyle(config);
        await new Promise((r) => setTimeout(r, 800));
        rec.getMapStyleId = (() => { try { return mk.getMapStyleId(); } catch (e) { return "THREW:" + String(e && e.message || e); } })();
      } catch (e) { rec.threw = String(e && e.message || e); }
      return rec;
    };
    return {
      arrayShape: await probeStyle("styleJson:object[]", { styleJson: [{ featureType: "water", stylers: [{ color: "#0040a0" }] }] }),
      recordShape: await probeStyle("styleJson:Record", { styleJson: { featureType: "water", stylers: [{ color: "#0040a0" }] } }),
      idThenJson: await probeStyle("styleId 先, styleJson 后", { styleId: "a1", styleJson: [] }),
      jsonThenId: await probeStyle("styleJson 先, styleId 后", { styleJson: [], styleId: "a1" }),
      mergeReachable: { declared: true, note: "merge 与 styleId/styleJson 同时给；官方声明 @default false" },
    };
  });

  // 11. Panorama 实例成员：capture / clearOverlays 真在实例上吗？
  R.readings.panoramaInstance = await (async () => {
    const rec = { created: false, threw: null, members: null };
    try {
      const div = document.createElement("div");
      div.style.cssText = "width:320px;height:240px;position:absolute;top:0;left:0";
      document.body.appendChild(div);
      let pano = null;
      if (typeof B.createPanorama === "function" && B.Panorama) {
        pano = new B.Panorama(div, { id: "1" });
      } else if (typeof B.Panorama === "function") {
        pano = new B.Panorama(div, { id: "1" });
      }
      if (pano) {
        rec.created = true;
        const names = ["capture", "clearOverlays", "getLinks", "getPov", "getPosition", "getId", "getVisible", "getSceneType", "setId", "setTheme"];
        // 判据：own（实例自有）或 proto（沿原型链能找到）任一为真即为「可达」
        rec.members = Object.fromEntries(names.map((n) => [n, {
          own: own(pano, n),
          onProto: protoHas(Object.getPrototypeOf(pano), n),
          callable: typeof pano[n] === "function",
        }]));
        rec.captureCall = (() => {
          try { const r = pano.capture ? pano.capture({ quality: 10 }) : "(no member)";
            return { threw: false, type: typeof r, length: typeof r === "string" ? r.length : null }; }
          catch (e) { return { threw: true, message: String(e && e.message || e) }; }
        })();
        rec.clearOverlaysCall = (() => {
          try { pano.clearOverlays ? pano.clearOverlays() : (() => { throw new Error("(no member)"); })();
            return { threw: false }; }
          catch (e) { return { threw: true, message: String(e && e.message || e) }; }
        })();
      }
    } catch (e) { rec.threw = String(e && e.message || e); }
    return rec;
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
      // Class 2 追加的 7~11 号各自要建图 + 等动画/回调落地（7~11 合计 ~40s），
      // 60s 的原值只够 1~6 号。超时要当成读数失败，不能当成「页面没跑完」。
      const deadline = Date.now() + 180_000;
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
