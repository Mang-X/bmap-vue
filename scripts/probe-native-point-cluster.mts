#!/usr/bin/env node
/**
 * 原生点图层与原生聚合的**运行时探针**（issue #35，M6-POINT-CLUSTER）
 *
 * ## 为什么需要它
 *
 * issue #35 的开工前范围纠正写着「native-first：capability 缺失时可以明确返回 unsupported /
 * experimental；**不因为『理论上可能缺失』就自动进入自研 fallback**」，而 fallback 的启动条件之一是
 * 「真实 SDK/目标环境证明原生 Cluster 不可用、能力不足」。判定这一条不能靠读文档，只能**实测**：
 *
 * | 事实 | 现有依据 | 缺什么 |
 * | --- | --- | --- |
 * | `PointIconLayer` / `PointShapeLayer` | `@baidumap/jsapi-v4-types@4.0.4` 有完整类声明 | 已有（#23 的 smoke 记录） |
 * | `PointLayer` / `ClusterLayer` | 官方扩展 API 专页 + 本库 #23 的 smoke「构造器全部存在」 | **只验过构造与方法存在，从没验过「喂数据之后真的聚起来 / 真的能点中」** |
 * | 官方 React 参考 `huiyan-fe/react-bmap` | 只有 `PointIconLayer` / `PointShapeLayer` 两个组件，**没有** `PointLayer` / `ClusterLayer` / 任何 cluster 组件 | 说明「官方薄封装只暴露声明面」是既有选择，但不能据此断言扩展 API 不可用 |
 *
 * 本探针就是把上表最后两行补成读数：**喂一份会明显聚合的数据，读聚簇结果与真实点击命中**。
 *
 * ## 三个臂 + 一个正证控件
 *
 * | 臂 | 构造器 | 问的问题 |
 * | --- | --- | --- |
 * | `control` | `PointShapeLayer`（声明面） | 正证控件：它必须能命中，否则**本轮不出结论** |
 * | `point` | `PointLayer`（扩展 API） | 能创建 / 挂载 / `setData` / `getItems()` 出逐点缓存 / 点得中吗 |
 * | `cluster` | `ClusterLayer`（扩展 API） | 能创建 / 挂载 / `setData` / 聚合出簇（`change` 事件 + `getClusterLayer()`）/ 点得中吗 |
 *
 * 三臂共用一张地图、各自相距约 0.24° 经度（zoom 11 下约 350 px），因此互不遮挡；
 * `ClusterLayer` 显式传 `fitViewOnClick: false`，否则点击簇会把地图缩放掉、其它臂的像素目标同时失效。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 正证控件命中，且三个臂都没有被**证伪** | 0 |
 * | `fail` | 正证控件不成立（本轮无法判定），或某个臂**证实不可用**（构造/挂载/setData 抛错） | 1 |
 * | `blocked` | SDK / 地图没起来（AK、网络、浏览器不成立） | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-point-pick.mts` / `probe-layer-detached.mts` 同一口径：不登记进 `tests/browser/jsapi-v4`、
 * 不进任何 CI job、不参与必需链路的放行。结论的固化方式是写进 ADR 与组件文档。
 * AK 从 `BAIDU_MAP_AK` 读、不落库；输出里的 `ak=` 一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:native-point-cluster
 *   BAIDU_MAP_AK=<ak> pnpm probe:native-point-cluster -- --out=/tmp/native-point-cluster.json
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
 * ⚠️ 本模板串里**不得出现反引号**（会截断外层 TS 模板串），由
 * `tests/behavior/v3-probe-page-scripts.test.ts` 静态守卫。同理不要用 `${` 插值。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const report = { phase: "boot", sdk: null, arms: [], events: [], clickCount: 0, clickTargets: [], console: [], error: null, loadError: null };
  const instances = {};

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const attempt = (fn) => {
    try { return { threw: false, message: null, value: fn() }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error), value: null }; }
  };

  /** 实例 / 原型链上的成员名（到 Object.prototype 为止），用于「官方声明之外还有什么」。 */
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

  const summarizePick = (event) => {
    const value = event ? event.value : undefined;
    const item = value && typeof value === "object" ? value.dataItem : undefined;
    const properties = item && typeof item === "object" ? item.properties : undefined;
    return {
      type: event && event.type !== undefined ? String(event.type) : "n/a",
      topKeys: event && typeof event === "object" ? Object.keys(event) : [],
      hasPixel: !!(event && event.pixel),
      hasLatLng: !!(event && event.latLng),
      valueKind: value === undefined ? "undefined" : value === null ? "null" : typeof value,
      valueKeys: value && typeof value === "object" ? Object.keys(value) : [],
      isCluster: value && typeof value === "object" && "isCluster" in value ? value.isCluster : "n/a",
      pointCount: value && typeof value === "object" && "pointCount" in value ? value.pointCount : "n/a",
      dataIndex: value && typeof value === "object" && "dataIndex" in value ? value.dataIndex : "n/a",
      propertiesId: properties && typeof properties === "object" ? String(properties.id) : "n/a",
      /** ClusterLayer 的命中载荷把聚簇属性直接挂在 value.properties 上（没有 dataItem）。 */
      valuePropertiesId:
        value && typeof value === "object" && value.properties && typeof value.properties === "object"
          ? JSON.stringify(value.properties).slice(0, 160)
          : "n/a",
    };
  };

  const summarizeChange = (event) => ({
    type: "change",
    valueKeys: event && event.value ? Object.keys(event.value) : [],
    clusters: event && event.value && Array.isArray(event.value.clusters) ? event.value.clusters.length : "n/a",
    singles: event && event.value && Array.isArray(event.value.singles) ? event.value.singles.length : "n/a",
    zoom: event && event.value ? event.value.zoom : "n/a",
  });

  /** 只留 JSON 安全的浅层摘要（探针报告要能序列化）。 */
  const dumpJson = (value) => {
    try { return JSON.stringify(value).slice(0, 400); } catch (error) { return String(value); }
  };

  try {
    const readyPromise = new Promise((resolve) => { window.__bmapNativePointClusterReady = () => resolve(); });
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=__bmapNativePointClusterReady";
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
    report.sdk = {
      version: String(NS.version),
      pointIconLayer: typeof NS.PointIconLayer,
      pointShapeLayer: typeof NS.PointShapeLayer,
      pointLayer: typeof NS.PointLayer,
      clusterLayer: typeof NS.ClusterLayer,
      heatmap: typeof NS.Heatmap,
      pointLayerMembers: typeof NS.PointLayer === "function" ? memberNames(NS.PointLayer.prototype) : [],
      clusterLayerMembers: typeof NS.ClusterLayer === "function" ? memberNames(NS.ClusterLayer.prototype) : [],
      pointShapeLayerMembers: typeof NS.PointShapeLayer === "function" ? memberNames(NS.PointShapeLayer.prototype) : [],
    };

    document.body.style.margin = "0";
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;width:760px;height:560px";
    document.body.appendChild(host);
    const map = new NS.Map(host);
    const BASE = { lng: 116.404, lat: 39.915 };
    map.centerAndZoom(new NS.Point(BASE.lng, BASE.lat), 11);
    await wait(1500);

    /**
     * 40 个紧邻的点 + 2 个远点。
     *
     * 远点距离取 0.2°（zoom 11 下约 290 px），于是同一份数据能同时观测「聚簇命中」与
     * 「单点命中」两种拾取载荷。
     *
     * ⚠️ 首版用 0.08° 时读到 singles = 0（近点与远点被并进同一簇）；改成 0.2° 之后 change 事件
     * 给出 clusters = 1 / singles = 1，远近确实分开。这说明**官方默认的聚合半径比 60 像素大** ——
     * 因此本库不猜它的默认值，只写调用方表过态的选项（见下面的「选项」一栏）。
     */
    const buildData = (lng, lat, tag) => {
      const features = [];
      for (let i = 0; i < 40; i++) {
        const angle = (i / 40) * Math.PI * 2;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng + Math.cos(angle) * 0.0012, lat + Math.sin(angle) * 0.0012] },
          properties: { id: tag + "-" + i },
        });
      }
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng + 0.2, lat] }, properties: { id: tag + "-far-0" } });
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng - 0.2, lat] }, properties: { id: tag + "-far-1" } });
      return { type: "FeatureCollection", features: features };
    };

    const ARMS = [
      {
        label: "control",
        ctor: "PointShapeLayer",
        center: { lng: BASE.lng, lat: BASE.lat },
        data: buildData(BASE.lng, BASE.lat, "c"),
        options: { idKey: "id", enablePicked: true, style: { shapeType: 0, size: 26, color: "#d93025", strokeColor: "#ffffff", strokeWeight: 2 } },
      },
      {
        label: "point",
        ctor: "PointLayer",
        center: { lng: BASE.lng + 0.24, lat: BASE.lat },
        data: buildData(BASE.lng + 0.24, BASE.lat, "p"),
        options: { shape: "circle", size: 18, fillColor: "#1677ff", strokeColor: "#ffffff", strokeWeight: 2, enablePicked: true },
      },
      {
        label: "cluster",
        ctor: "ClusterLayer",
        center: { lng: BASE.lng - 0.24, lat: BASE.lat },
        data: buildData(BASE.lng - 0.24, BASE.lat, "k"),
        // ⚠️ **不传聚合参数**（clusterRadius / clusterMinPoints / …）：本库不补官方默认值，
        // 因此这里要证明「什么都不传也能聚簇、也能点中」。fitViewOnClick 同样不传 ——
        // 默认不做点击缩放，其它臂的像素目标因此不会被本次点击改变。
        options: { enablePicked: true },
      },
    ];

    for (const arm of ARMS) {
      const entry = { label: arm.label, ctor: arm.ctor, exists: typeof NS[arm.ctor] === "function", created: null, added: null, setData: null, readbacks: {}, members: [], events: [], isNormalLayer: "n/a" };
      report.arms.push(entry);
      if (!entry.exists) continue;

      const created = attempt(() => new NS[arm.ctor](arm.options));
      entry.created = { threw: created.threw, message: created.message };
      if (created.threw || !created.value) continue;

      const layer = created.value;
      instances[arm.label] = layer;
      entry.members = memberNames(layer);
      entry.isNormalLayer = layer.isNormalLayer === undefined ? "n/a" : layer.isNormalLayer;

      for (const type of ["click", "change", "dataparsed", "mousemove", "dblclick", "rightclick"]) {
        try {
          layer.addEventListener(type, function (event) {
            const summary = type === "change" ? summarizeChange(event) : summarizePick(event);
            entry.events.push(summary);
            report.events.push(Object.assign({ arm: arm.label }, summary));
            if (type === "click") report.clickCount += 1;
          });
        } catch (error) { /* 该实例没有这个事件 */ }
      }

      const added = attempt(() => map.addLayer(layer));
      entry.added = { threw: added.threw, message: added.message };
      const setData = attempt(() => layer.setData(arm.data));
      entry.setData = { threw: setData.threw, message: setData.message };
    }

    await wait(2500);

    for (const entry of report.arms) {
      const layer = instances[entry.label];
      if (!layer) continue;
      const reads = {};
      const gd = attempt(() => layer.getData());
      reads.getData = { threw: gd.threw, message: gd.message, kind: gd.value === null || gd.value === undefined ? String(gd.value) : typeof gd.value };
      const gi = attempt(() => layer.getItems());
      reads.getItems = { threw: gi.threw, message: gi.message, kind: gi.value === null || gi.value === undefined ? String(gi.value) : typeof gi.value, length: Array.isArray(gi.value) ? gi.value.length : "n/a" };
      const gc = attempt(() => layer.getClusterLayer());
      reads.getClusterLayer = { threw: gc.threw, message: gc.message, kind: gc.value === null || gc.value === undefined ? String(gc.value) : typeof gc.value };
      const gs = attempt(() => layer.getSingleLayer());
      reads.getSingleLayer = { threw: gs.threw, message: gs.message, kind: gs.value === null || gs.value === undefined ? String(gs.value) : typeof gs.value };
      // 官方默认值只能用官方读回入口问：本库**不猜**默认值（不传的键一个都不写），
      // 因此这条读数的作用是「拿到官方在未表态时实际采用的值」，写进 ADR 当参考，
      // 而不是让实现去补一个数字。
      const go = attempt(() => layer.getOptions());
      reads.getOptions = { threw: go.threw, message: go.message, json: dumpJson(go.value) };
      entry.readbacks = reads;
    }

    const rect = host.getBoundingClientRect();
    // 四个点击目标：三个臂的锚点 + cluster 臂的**单点**（远点）——「簇命中」与「单点命中」的
    // 载荷形状不一样，而验收标准要求「交互返回稳定业务 key/item」，两者都得读出来。
    const TARGETS = [
      { label: "control", lng: BASE.lng, lat: BASE.lat },
      { label: "point", lng: BASE.lng + 0.24, lat: BASE.lat },
      { label: "cluster", lng: BASE.lng - 0.24, lat: BASE.lat },
      { label: "cluster-single", lng: BASE.lng - 0.24 + 0.2, lat: BASE.lat },
      // 未命中：PointLayer 的**未命中**载荷形状是「命中判定」的唯一依据（PointShapeLayer 有
      // 官方的 dataIndex === -1 口径，扩展 API 没有声明可依据）。
      { label: "point-miss", lng: BASE.lng + 0.24, lat: BASE.lat + 0.15 },
    ];
    report.clickTargets = TARGETS.map(function (target) {
      const pixel = attempt(() => map.pointToPixel(new NS.Point(target.lng, target.lat)));
      return {
        label: target.label,
        pixel: pixel.threw || !pixel.value ? null : { x: Math.round(pixel.value.x), y: Math.round(pixel.value.y) },
        x: pixel.threw || !pixel.value ? null : Math.round(rect.left + pixel.value.x),
        y: pixel.threw || !pixel.value ? null : Math.round(rect.top + pixel.value.y),
      };
    }).filter(function (target) { return target.x !== null; });

    report.phase = "ready";
    window.__NATIVE_POINT_CLUSTER_PROBE__ = report;

    const startedAt = Date.now();
    while (report.clickCount < report.clickTargets.length && Date.now() - startedAt < 20000) await wait(300);

    for (const entry of report.arms) {
      const layer = instances[entry.label];
      if (!layer) continue;
      const redraw = attempt(() => layer.redraw());
      entry.postRedraw = { threw: redraw.threw, message: redraw.message };
      const hit = attempt(() => layer.hitTest(10, 10));
      entry.postHitTest = { threw: hit.threw, message: hit.message, kind: hit.value === null || hit.value === undefined ? String(hit.value) : typeof hit.value };

      // 聚簇命中只回传「簇的元数据」（isCluster / clusterId / pointCount / bbox），**没有业务项**。
      // 于是问题变成：官方有没有公开的读回入口能拿回簇里的业务点？读 getClusterLayer() / getSingleLayer()。
      // visible / setOptions 的合并语义 / clearData —— 组件的「统一 options / visible / 数据面」
      // 能不能落到三个 kind 上，取决于这三条读数（本库 Driver 对扩展 API 只认官方声明的面）。
      const hide = attempt(() => layer.setVisible(false));
      const visibleAfter = attempt(() => layer.getVisible());
      const show = attempt(() => layer.setVisible(true));
      entry.visibility = {
        setVisibleThrew: hide.threw,
        message: hide.message,
        visibleAfterHide: visibleAfter.value,
        restoreThrew: show.threw,
      };

      const before = attempt(() => layer.getOptions());
      const merge = attempt(() => layer.setOptions({ size: 24 }));
      const after = attempt(() => layer.getOptions());
      const sizeOf = (value) => (value && typeof value === "object" ? JSON.stringify(value).slice(0, 200) : String(value));
      entry.optionMerge = {
        setOptionsThrew: merge.threw,
        message: merge.message,
        before: sizeOf(before.value),
        after: sizeOf(after.value),
      };

      const cleared = attempt(() => layer.clearData());
      await wait(400);
      const itemsAfterClear = attempt(() => layer.getItems());
      entry.clearData = {
        threw: cleared.threw,
        message: cleared.message,
        itemsAfterClear: Array.isArray(itemsAfterClear.value) ? itemsAfterClear.value.length : "n/a",
      };

      if (entry.label === "cluster") {
        const clusterLayer = attempt(() => layer.getClusterLayer());
        entry.clusterLayerShape = clusterLayer.threw || !clusterLayer.value
          ? { threw: clusterLayer.threw, message: clusterLayer.message }
          : {
              threw: false,
              keys: Object.keys(clusterLayer.value).slice(0, 40),
              members: memberNames(clusterLayer.value).slice(0, 80),
              json: dumpJson(clusterLayer.value),
            };
        const singleLayer = attempt(() => layer.getSingleLayer());
        entry.singleLayerShape = singleLayer.threw || !singleLayer.value
          ? { threw: singleLayer.threw, message: singleLayer.message }
          : {
              threw: false,
              keys: Object.keys(singleLayer.value).slice(0, 40),
              members: memberNames(singleLayer.value).slice(0, 80),
              json: dumpJson(singleLayer.value),
            };

        // 决定性的一问：簇命中只给元数据，那「簇里有哪几个业务项」能不能从**公开读回入口**拿回来？
        // getClusterLayer() 是官方扩展专页列出的公开方法，它返回的是内部 PointLayer —— 读它的 getItems()。
        const clusterItems = attempt(() => layer.getClusterLayer().getItems());
        const list = Array.isArray(clusterItems.value) ? clusterItems.value : null;
        entry.clusterItems = clusterItems.threw
          ? { threw: true, message: clusterItems.message, length: "n/a", first: "n/a" }
          : {
              threw: false,
              message: null,
              length: list ? list.length : "n/a",
              first: list && list.length > 0 ? dumpJson(list[0]) : "n/a",
            };
      }
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__NATIVE_POINT_CLUSTER_PROBE__ = report;
})();
`;

interface ProbeReport {
  phase: string;
  sdk: Record<string, unknown> | null;
  arms: Array<{
    label: string;
    ctor: string;
    exists: boolean;
    created: { threw: boolean; message: string | null } | null;
    added: { threw: boolean; message: string | null } | null;
    setData: { threw: boolean; message: string | null } | null;
    readbacks: Record<string, Record<string, unknown>>;
    members: string[];
    events: Array<Record<string, unknown>>;
    isNormalLayer?: unknown;
    postRedraw?: { threw: boolean; message: string | null };
    postHitTest?: { threw: boolean; message: string | null; kind?: unknown };
    clusterLayerShape?: { threw: boolean; message?: string | null; keys?: string[]; members?: string[]; json?: string };
    singleLayerShape?: { threw: boolean; message?: string | null; keys?: string[]; members?: string[]; json?: string };
    clusterItems?: { threw: boolean; message?: string | null; length: number | string; first: string };
    visibility?: { setVisibleThrew: boolean; message?: string | null; visibleAfterHide?: unknown; restoreThrew?: boolean };
    optionMerge?: { setOptionsThrew: boolean; message?: string | null; before: string; after: string };
    clearData?: { threw: boolean; message?: string | null; itemsAfterClear: number | string };
  }>;
  events: Array<Record<string, unknown>>;
  clickCount: number;
  clickTargets: Array<{ label: string; pixel: { x: number; y: number } | null; x: number; y: number }>;
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
  const control = report.arms.find((arm) => arm.label === "control");
  if (!control || !control.exists) {
    failures.push("正证控件 PointShapeLayer 不存在：本轮无法判定");
    return failures;
  }
  if (
    !control.created ||
    control.created.threw ||
    !control.added ||
    control.added.threw ||
    !control.setData ||
    control.setData.threw
  ) {
    failures.push("正证控件 PointShapeLayer 创建/挂载/setData 失败：本轮无法判定");
    return failures;
  }
  const hit = control.events.some(
    (event) => event.dataIndex !== "n/a" && event.dataIndex !== -1 && event.dataIndex !== undefined,
  );
  if (!hit) failures.push("正证控件在锚点上没有命中要素（点击没到图上）：本轮无法判定");
  return failures;
}

/** 读数 → 结论（三态：确认 / 与假设不符 / 无法判定）。 */
function verdicts(report: ProbeReport): string[] {
  const lines: string[] = [];
  const sdk = report.sdk ?? {};
  lines.push(
    `构造器：PointShapeLayer=${String(sdk.pointShapeLayer)} PointIconLayer=${String(sdk.pointIconLayer)} ` +
      `PointLayer=${String(sdk.pointLayer)} ClusterLayer=${String(sdk.clusterLayer)}`,
  );

  for (const arm of report.arms) {
    if (!arm.exists) {
      lines.push(`[${arm.label}] ${arm.ctor} 在运行时**不存在** ⇒ 该能力没有运行时入口（capability 缺失成立）`);
      continue;
    }
    if (!arm.created || arm.created.threw) {
      lines.push(`[${arm.label}] ${arm.ctor} 构造失败：${String(arm.created?.message)} ⇒ 不可用`);
      continue;
    }
    if (!arm.added || arm.added.threw) {
      lines.push(`[${arm.label}] ${arm.ctor} 构造成功但 addLayer 失败：${String(arm.added?.message)} ⇒ 不可用`);
      continue;
    }
    if (!arm.setData || arm.setData.threw) {
      lines.push(`[${arm.label}] ${arm.ctor} 挂载成功但 setData 失败：${String(arm.setData?.message)} ⇒ 数据面不可用`);
      continue;
    }

    const reads = arm.readbacks;
    const items = reads.getItems;
    const clusters = reads.getClusterLayer;
    const changeEvents = arm.events.filter((event) => event.type === "change");
    const changeWithClusters = changeEvents.filter(
      (event) => typeof event.clusters === "number" && (event.clusters as number) > 0,
    );
    // ⚠️ 两种臂的命中载荷**形状不同**（实测）：PointShapeLayer / ClusterLayer 走 dataIndex，
    // PointLayer 走 id / index / properties。只认 dataIndex 会把 PointLayer 的命中读成「没命中」。
    const pick = arm.events.find((event) => {
      if (event.type === "change") return false;
      const index = event.dataIndex;
      if (typeof index === "number" && index >= 0) return true;
      const keys = (event.valueKeys as string[] | undefined) ?? [];
      return keys.includes("properties") || keys.includes("index") || keys.includes("dataItem");
    });
    const detail =
      "created=ok added=ok setData=ok" +
      (items && items.threw === false ? ` getItems=${String(items.length)}` : "") +
      (clusters && clusters.threw === false ? ` getClusterLayer=${String(clusters.kind)}` : "") +
      ` change 事件=${changeEvents.length}（clusters>0 的 ${changeWithClusters.length} 条）`;

    const produced =
      changeWithClusters.length > 0
        ? "聚簇产出成立（change 事件里 clusters > 0）"
        : arm.label === "cluster"
          ? "**没有观测到任何 clusters > 0 的 change 事件** ⇒ 本轮不能证明原生聚合真的产出簇"
          : typeof items?.length === "number" && (items.length as number) > 0
            ? `逐点产出成立（getItems=${String(items.length)}）`
            : arm.label === "control"
              ? "（正证控件按点击命中判定）"
              : "**没有观测到逐点产出** ⇒ 本轮不能证明该图层真的缓存了数据";
    lines.push(`[${arm.label}] ${arm.ctor}：${detail}；${produced}`);
    if (reads.getOptions) {
      lines.push(
        `[${arm.label}] getOptions()：threw=${String(reads.getOptions.threw)} json=${String(reads.getOptions.json)}`,
      );
    }
    lines.push(
      `[${arm.label}] 点击命中：` +
        (pick
          ? `type=${String(pick.type)} isCluster=${String(pick.isCluster)} pointCount=${String(pick.pointCount)} dataIndex=${String(pick.dataIndex)} valueKeys=[${(pick.valueKeys as string[] | undefined)?.join(",") ?? ""}] properties.id=${String(pick.propertiesId)} value.properties=${String(pick.valuePropertiesId)}`
          : "本轮没有取到锚点上的命中事件（无法判定渲染/拾取）"),
    );
    if (arm.postRedraw) {
      lines.push(
        `[${arm.label}] redraw()：threw=${String(arm.postRedraw.threw)}${arm.postRedraw.message ? `（${arm.postRedraw.message}）` : ""}`,
      );
    }
    if (arm.postHitTest) {
      lines.push(`[${arm.label}] hitTest(10,10)：threw=${String(arm.postHitTest.threw)} kind=${String(arm.postHitTest.kind)}`);
    }
    if (arm.clusterLayerShape) {
      lines.push(
        `[${arm.label}] getClusterLayer()：threw=${String(arm.clusterLayerShape.threw)} ` +
          `keys=[${(arm.clusterLayerShape.keys ?? []).join(",")}] json=${String(arm.clusterLayerShape.json)}`,
      );
      lines.push(
        `[${arm.label}] getClusterLayer() 上可用的读回成员：${(arm.clusterLayerShape.members ?? []).join(", ")}`,
      );
    }
    if (arm.singleLayerShape) {
      lines.push(
        `[${arm.label}] getSingleLayer()：threw=${String(arm.singleLayerShape.threw)} keys=[${(arm.singleLayerShape.keys ?? []).join(",")}] json=${String(arm.singleLayerShape.json)}`,
      );
    }
    if (arm.clusterItems) {
      lines.push(
        `[${arm.label}] getClusterLayer().getItems()：threw=${String(arm.clusterItems.threw)} length=${String(arm.clusterItems.length)} first=${String(arm.clusterItems.first)}` +
          "（问题：簇里的业务项能不能从这里读回来？）",
      );
    }
    if (arm.visibility) {
      lines.push(
        `[${arm.label}] setVisible(false)：threw=${String(arm.visibility.setVisibleThrew)}${arm.visibility.message ? `（${arm.visibility.message}）` : ""} ` +
          `getVisible()=${String(arm.visibility.visibleAfterHide)} 恢复 threw=${String(arm.visibility.restoreThrew)}` +
          "（官方扩展专页没有把 setVisible 列为这些类的方法面；#35 已按本探针的读数对 point / cluster" +
            " 放开 setVisible，其余继承成员仍然关闭）",
      );
    }
    if (arm.optionMerge) {
      lines.push(
        `[${arm.label}] setOptions({size:24})：threw=${String(arm.optionMerge.setOptionsThrew)} 前=${arm.optionMerge.before} 后=${arm.optionMerge.after}`,
      );
    }
    if (arm.clearData) {
      lines.push(
        `[${arm.label}] clearData()：threw=${String(arm.clearData.threw)} getItems 之后=${String(arm.clearData.itemsAfterClear)}`,
      );
    }
  }

  const cluster = report.arms.find((arm) => arm.label === "cluster");
  const members = cluster?.members ?? [];
  if (members.length) {
    const documented = new Set([
      "setData",
      "clearData",
      "setOptions",
      "redraw",
      "getClusterLayer",
      "getSingleLayer",
      "addEventListener",
      "removeEventListener",
      "constructor",
      "isNormalLayer",
    ]);
    const undeclared = members.filter((name) => !documented.has(name));
    lines.push(`[cluster] 官方专页之外还有这些成员：${undeclared.join(", ") || "（无）"}`);
  }

  return lines;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:native-point-cluster`");
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
<html><head><meta charset="utf-8"><title>native point / cluster probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "native-point-cluster-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[native-point-cluster] 服务未就绪（脚手架失败）");
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
      deadline: Date.now() + 240_000,
      commandTimeoutMs: 30_000,
    });

    const ready = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__NATIVE_POINT_CLUSTER_PROBE__ && window.__NATIVE_POINT_CLUSTER_PROBE__.phase === 'ready' ? JSON.stringify(window.__NATIVE_POINT_CLUSTER_PROBE__) : null",
      deadline: Date.now() + 150_000,
      pollIntervalMs: 500,
    });
    if (!ready) {
      console.error("PROBE_NOT_READY：页面没有进入 ready（SDK / 地图 / 图层没起来）");
      return 3;
    }
    console.log("== 原生点图层 / 原生聚合探针 ==");
    const sdk = ready.sdk ?? {};
    console.log(`SDK：version=${String(sdk.version)}`);
    console.log(
      `  构造器：PointShapeLayer=${String(sdk.pointShapeLayer)} PointIconLayer=${String(sdk.pointIconLayer)} PointLayer=${String(sdk.pointLayer)} ClusterLayer=${String(sdk.clusterLayer)}`,
    );
    console.log(`  PointLayer.prototype 成员：${(sdk.pointLayerMembers as string[] | undefined)?.join(", ")}`);
    console.log(`  ClusterLayer.prototype 成员：${(sdk.clusterLayerMembers as string[] | undefined)?.join(", ")}`);
    for (const arm of ready.arms) {
      console.log(
        `  arm ${arm.label}: exists=${arm.exists} created=${JSON.stringify(arm.created)} added=${JSON.stringify(arm.added)} setData=${JSON.stringify(arm.setData)}`,
      );
    }

    for (const clickTarget of ready.clickTargets) {
      if (clickTarget.pixel === null) continue;
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
        await session.send("Input.dispatchMouseEvent", {
          type,
          x: clickTarget.x,
          y: clickTarget.y,
          button: type === "mouseMoved" ? "none" : "left",
          clickCount: type === "mouseMoved" ? 0 : 1,
        });
      }
      console.log(`  已派发真实点击 [${clickTarget.label}] @ (${clickTarget.x}, ${clickTarget.y})`);
      await sleep(800);
    }

    const report = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__NATIVE_POINT_CLUSTER_PROBE__ && window.__NATIVE_POINT_CLUSTER_PROBE__.phase === 'done' ? JSON.stringify(window.__NATIVE_POINT_CLUSTER_PROBE__) : null",
      deadline: Date.now() + 90_000,
      pollIntervalMs: 400,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有在点击之后收尾");
      return 3;
    }

    console.log(`页面阶段：${report.phase}`);
    for (const event of report.events) console.log(`  事件：${JSON.stringify(event)}`);
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`);

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

    const broken = report.arms.some(
      (arm) =>
        arm.exists &&
        ((arm.created && arm.created.threw) || (arm.added && arm.added.threw) || (arm.setData && arm.setData.threw)),
    );
    return broken ? 1 : 0;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[native-point-cluster] 脚手架失败：${redact(String(error))}`);
  return 2;
});
