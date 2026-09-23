/**
 * 真实浏览器档性能读数的页面（#123）
 *
 * ## 它要回答的四个问题（issue 目标 1~3 + 对照）
 *
 * 1. **首帧交付**：每类图层**独立挂载**后，初始 `setData` → 画面可交互的时间；
 * 2. **SDK 调用本身**：同数据量下再次 `setData` —— 数据**提前生成**，窗口只覆盖
 *    prop 赋值 → settle（与 Fake `data.replace.*` / `setData.replace@*` 同口径）；
 *    另拆 **redraw**（settle → paint）与 **native setData 边界**（原型包装，纯 SDK 返回）；
 * 3. **交互阻塞**：主线程 long task 按窗口分账（setData 窗 / redraw 窗）与换数据后的 FPS；
 * 4. **对照**：Node 侧把本页 `setData` 读数与 `tests/performance/baseline.json` 的 Fake 读数并排。
 *
 * ## 计时协议（评审 #131 两轮；改窗口必须同步改 ADR / docs）
 *
 * | 窗口 | 起点 | 终点 | 与 Fake 对照？ |
 * | --- | --- | --- | --- |
 * | `setData` | `host.setItems(预生成数据)` | 跨 macrotask + `nextTick` 的**近似 settle**（与 Fake 同型，task source 可能不同） | **是**（`buildFakeContrast` 用它） |
 * | `redraw` | settle 结束之后 | 再等 2×rAF paint 边界 | 否（渲染尾巴，不进 Fake 对照） |
 * | `sdkSetDataMs` | 原生 `prototype.setData` 进入 | 同函数返回 | 否（纯 SDK 返回墙钟） |
 * | `firstFrame` | **首次原生 `setData` 进入**（#123 目标 1） | ready 后**第一次** 2×rAF paint | 否（不含之后的 200ms 稳定期；未捕到 setData ⇒ fatal，不回退 mount 起点） |
 * | `mountToPaintMs` | `app.mount(stage)` | 同上 paint | 否（建图 / ready 成本旁路，**不是** #123 目标 1） |
 * | `postUpdateFps` | redraw 结束后 | 再采 1s rAF | 否（更新**之后**的环境诊断，不是 setData 期间帧率） |
 *
 * 数据生成（`variantData` / `makeInitialData`）**必须跨 macrotask 与窗口隔开**——否则 50k
 * 造数会和 `setItems` 同属一条 event-loop task，long task 整条 duration 会被算进窗口。
 *
 * 稳定期（`sleep(200)` + paint）在 `firstFrame` **采样之后**执行，只隔离后续测量尾巴，
 * **不计入**任何上报窗口。
 *
 * ## long task 归属（#131 复审第 1 条 + 第三轮第 1 条）
 *
 * 页面级**长生命周期** `PerformanceObserver` 收集 `{startTime, duration}`；每个窗口只记
 * `start/end` 时间戳。窗口结束时先 `flush()`（跨一个 macrotask + `takeRecords()`）再按
 * 时间重叠归属——不能在窗末直接 `disconnect()`（会清空 buffer，且 observer 回调本身
 * 是另排的 task：实跑出现过 `sdkSetData=1250ms` 却 `setData long task=0` 的假 0）。
 *
 * 归属取**窗口交集时长** `max(0, min(entryEnd,end) − max(entryStart,start))`，不是整条
 * `entry.duration`——造数与 `setItems` 若同 task，整条时长会比窗口还长（第二轮实测
 * longest ≈ 2× duration）。造数侧另加 macrotask 隔离，双保险。
 *
 * ## 页面只产出**读数**，不产出结论
 *
 * 判定是纯函数（`report.mts`），可以用合成报告回归；放在浏览器里就只能靠人肉复查。
 * 因此这里只记录事实：duration / long task 条数 / 窗口交集最长任务 / 更新后 FPS /
 * 环境 / 被忽略的 SDK worker 噪声（`notes`）。
 *
 * ## 页面内测量逻辑**不单测**
 *
 * rAF / `PerformanceObserver` / 原型包装只能真浏览器跑，由实跑读数本身取证
 * （两层缝的第二层是接线契约，不是把计时协议抽成纯函数）。
 */
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import {
  BFillLayer,
  BLineLayer,
  BMap,
  BPointCollection,
} from "../../../packages/baidu-map-gl-vue/src/index.ts";
import {
  featureCollection,
  makeItems,
  makeLineFeatures,
  makePolygonFeatures,
  PERF_ITEM_KEY,
  perfItemPosition,
  perfItemProperties,
  DATASET_VERSION,
  type PerfItem,
} from "../../../tests/performance/dataset.ts";
import {
  LIVE_PERF_LAYERS,
  LIVE_PERF_REPORT_VERSION,
  type LivePerfLayer,
  type LivePerfLayerReadings,
  type LivePerfReport,
  type LivePerfSample,
} from "./report.mts";

declare global {
  interface Window {
    __LIVE_PERF__?: LivePerfReport;
  }
}

const params = new URLSearchParams(location.search);
const RUN_ID = params.get("run") ?? "unset";
const AK = params.get("ak") ?? "";
const SIZE = Number(params.get("size") ?? "50000");
const READY_MS = Number(params.get("readyMs") ?? "40000");

const CENTER = { lng: 116.404, lat: 39.915 };

/** 等待 `ms` 毫秒（第二参必须是数字：早期草稿误传了 `resolve`，50/200ms 稳定等待全部失效）。 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const startedAtMs = Date.now();
/**
 * 报告只在 **`finish()` 里**挂到 `window.__LIVE_PERF__`。
 *
 * orchestrator 的 `readProbeReport` 一见非空就返回——若像早期草稿那样在模块顶层写入，
 * 会拿到一份 `done=false / durationMs=0` 的半截报告（首跑实测）。
 */
const report: LivePerfReport = {
  version: LIVE_PERF_REPORT_VERSION,
  runId: RUN_ID,
  mode: "live",
  akUsed: AK.length > 0,
  done: false,
  fatal: null,
  blockedReason: null,
  notes: [],
  env: {
    userAgent: navigator.userAgent,
    browser: detectBrowser(),
    datasetVersion: DATASET_VERSION,
    size: SIZE,
  },
  readings: [],
  startedAt: new Date(startedAtMs).toISOString(),
  finishedAt: "",
  durationMs: 0,
};

function detectBrowser(): string {
  const ua = navigator.userAgent;
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return `Chrome ${chrome[1]}`;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  const safari = /Version\/(\d+).*Safari/.exec(ua);
  if (safari) return `Safari ${safari[1]}`;
  return "unknown";
}

function finish(fatal?: string, blocked?: string): void {
  if (fatal) report.fatal = fatal;
  if (blocked) report.blockedReason = blocked;
  report.done = !fatal && !blocked && report.readings.length === LIVE_PERF_LAYERS.length;
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAtMs;
  const pre = document.getElementById("report");
  if (pre) pre.textContent = JSON.stringify(report, null, 2);
  // **只在这里**暴露给 orchestrator：`readProbeReport` 一见非空就返回，
  // 顶层赋值会让它拿到半截报告（首跑实测：done=false / durationMs=0）。
  window.__LIVE_PERF__ = report;
}

window.addEventListener("error", (event) => {
  // SDK 的 Worker 往 `WorkerGlobalScope.importScripts` 拉 wasm 时的 NetworkError
  // 是**可恢复噪声**（curl 同 URL 200；地图 ready 由下面的 READY_MS 负责）。
  // 把它当 fatal 会让整轮 0 读数直接 exit=2（#131 复跑实测两次）。
  // 只把**页面自身**的脚本错误记成 fatal；被忽略的进 `report.notes`（nightly artifact 可见）。
  if (/WorkerGlobalScope|importScripts/i.test(event.message)) {
    report.notes.push(`ignored sdk worker error: ${event.message}`);
    console.warn(`[live-perf] ignored sdk worker error: ${event.message}`);
    return;
  }
  finish(`window.error: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason);
  if (/WorkerGlobalScope|importScripts/i.test(message)) {
    report.notes.push(`ignored sdk worker rejection: ${message}`);
    console.warn(`[live-perf] ignored sdk worker rejection: ${message}`);
    return;
  }
  finish(`unhandledrejection: ${message}`);
});

/* ------------------------------------------------------------------ 计时 */

interface LongTaskEntry {
  startTime: number;
  duration: number;
}

interface LongTaskCollector {
  /** 跨一个 macrotask + `takeRecords()`，把尚在 buffer / 未回调的 entry 收进来。 */
  flush: () => Promise<void>;
  /**
   * 与 `[start, end)` 时间重叠的 long task 计数与**窗口交集**最长一条。
   * `longestMs` = `max(0, min(entryEnd,end) − max(entryStart,start))`，不是整条
   * `entry.duration`（第三轮第 1 条：窗外造数与 setItems 同 task 时整条会 ≈2× 窗口）。
   */
  countIn: (start: number, end: number) => { count: number; longestMs: number };
  stop: () => void;
}

/**
 * 页面级长生命周期 long task 收集器（#131 复审第 1 条）。
 *
 * 不能在每个测量窗末直接 `disconnect()`：`disconnect` 会 empty observer buffer，
 * 且 PerformanceObserver 通知本身是**另排的 task**——`settle()` 只冲微任务，窗末
 * 立刻 stop 会丢掉刚发生、尚未回调的 entry（实跑反证：`sdkSetData=1250ms` 却
 * `setData long task=0`）。因此：长收、短 flush、按窗口时间戳重叠归属。
 */
function createLongTaskCollector(): LongTaskCollector {
  const entries: LongTaskEntry[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        entries.push({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // 某些环境没有 longtask 支持：读数记 0，不把整轮判死（报告会如实写 count=0）。
    observer = null;
  }

  function absorbPending(): void {
    if (!observer) return;
    for (const record of observer.takeRecords()) {
      entries.push({ startTime: record.startTime, duration: record.duration });
    }
  }

  return {
    async flush() {
      // 让 PerformanceObserver 的 task 跑完（通知是另排 task，不是微任务）。
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      absorbPending();
    },
    countIn(start, end) {
      let count = 0;
      let longestMs = 0;
      for (const entry of entries) {
        const entryStart = entry.startTime;
        const entryEnd = entry.startTime + entry.duration;
        if (entryStart < end && entryEnd > start) {
          count += 1;
          // 窗口交集（不是整条 task）：窗外部分不归本窗。
          const overlap = Math.max(0, Math.min(entryEnd, end) - Math.max(entryStart, start));
          if (overlap > longestMs) longestMs = overlap;
        }
      }
      return { count, longestMs };
    },
    stop() {
      absorbPending();
      observer?.disconnect();
      observer = null;
    },
  };
}

/** 下一帧 paint 边界（首帧「可交互」的代理：rAF 之后再等一帧）。 */
function nextPaintFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * 与 Fake `settle()` **同型**的近似冲刷（#131 第三轮第 2 条 + 第四轮第 2 条）。
 *
 * Fake（`component-path.perf.test.ts`）= `flushPromises()` + `nextTick`；
 * `@vue/test-utils@2.5.0` 的 `flushPromises` 在 Node / Vitest 里通常走 **`setImmediate`**
 * （有则优先），浏览器 live 侧没有 `setImmediate` ⇒ 用 `setTimeout(…, 0)`。
 * 两者都**跨 macrotask** 再 `nextTick`，但 **task source 不必相同**——文档与注释只称
 * 「近似边界 / 同型」，不称「完全同边界」（#131 第四轮第 2 条）。
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await nextTick();
}

/** 跨一个 macrotask（造数 task 与测量窗之间强制边界；与 Fake `flushPromises` 同型）。 */
function macrotask(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 更新后 FPS 采样：redraw 结束后再数 1s rAF，返回**真实帧率**（fps，不是 ÷60 比值）。 */
async function sampleFps(windowMs: number): Promise<number | null> {
  if (typeof requestAnimationFrame !== "function") return null;
  let frames = 0;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      frames += 1;
      if (performance.now() - started >= windowMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const elapsed = performance.now() - started;
  if (elapsed <= 0) return null;
  return frames / (elapsed / 1000);
}

function sample(durationMs: number, longTasks: { count: number; longestMs: number }): LivePerfSample {
  return {
    durationMs,
    longTaskCount: longTasks.count,
    longestTaskMs: longTasks.longestMs,
  };
}

/* ------------------------------------------------- 原生 setData 边界包装 */

interface SetDataProbe {
  /** 上一次原生 `setData` 的墙钟（ms）；本轮没触发过则为 `null`。 */
  last: () => number | null;
  /** 上一次原生 `setData` 的**进入时刻**（`performance.now()`）；`firstFrame` 起点。 */
  lastStart: () => number | null;
  /** 本轮是否真的进入了原生 `setData`（防「没调用却拿旧值」）。 */
  reset: () => void;
  restore: () => void;
}

/**
 * 包装 v4 三个原生图层类的 `prototype.setData`，读**纯 SDK 返回**墙钟。
 *
 * - 页面在 `tests/browser` 下；raw SDK 边界门禁只扫 `packages` 的 `src` 白名单外禁区
 *   ⇒ 这里读 `globalThis.BMap` 合法（与 `tests/browser/jsapi-v4/main.ts` 同口径）。
 *   注释里别写字面量的 glob 结尾（星号紧跟斜杠）：那会提前关掉本块注释。
 * - 三个 ctor 与 `BPointCollection` / `BLineLayer` / `BFillLayer` 落到的
 *   `PointShapeLayer` / `LineLayer` / `FillLayer` 一一对应（`native-layers.ts` 描述符）。
 * - **只包原型、不改行为**：`finally` 里记时，返回值原样透传；`restore()` 还原。
 */
function instrumentNativeSetData(): SetDataProbe {
  let lastMs: number | null = null;
  let lastStart: number | null = null;
  const restores: Array<() => void> = [];
  const namespace = (globalThis as { BMap?: Record<string, unknown> }).BMap;
  if (!namespace) {
    return {
      last: () => null,
      lastStart: () => null,
      reset: () => undefined,
      restore: () => undefined,
    };
  }
  for (const name of ["PointShapeLayer", "LineLayer", "FillLayer"] as const) {
    const ctor = namespace[name] as { prototype?: Record<string, unknown> } | undefined;
    const proto = ctor?.prototype;
    const original = proto?.setData;
    if (!proto || typeof original !== "function") continue;
    const wrapped = function setData(this: unknown, data: unknown): unknown {
      const callStart = performance.now();
      lastStart = callStart;
      try {
        return (original as (d: unknown) => unknown).call(this, data);
      } finally {
        lastMs = performance.now() - callStart;
      }
    };
    proto.setData = wrapped;
    restores.push(() => {
      proto.setData = original;
    });
  }
  return {
    last: () => lastMs,
    lastStart: () => lastStart,
    reset: () => {
      lastMs = null;
      lastStart = null;
    },
    restore: () => {
      for (const undo of restores) undo();
    },
  };
}

/* ------------------------------------------------------------------ 夹具 */

interface LayerHost {
  setItems: (next: unknown) => void;
}

interface MountResult {
  app: App;
  host: LayerHost;
  firstFrame: LivePerfSample;
  /** `app.mount` → 同一次 paint（建图 / ready 旁路；**不是** #123 目标 1 的 `firstFrame`）。 */
  mountToPaintMs: number;
}

/**
 * **只挂一个图层**的完整交付窗口（issue 目标 1：逐类「初始 `setData` → 可交互」）。
 *
 * 评审 #131 第 3 条：此前三图层同树共用一个 `firstFrame` 再复制三行，回答不了
 * 「点 / 线 / 面各自」的首帧。现在每类独立 mount / measure / unmount。
 *
 * **#131 第四轮第 1 条**：`firstFrame` 起点必须是**首次原生 `setData` 进入时刻**，
 * 终点是 ready 后第一次 paint——**不是** `app.mount`（那会把建图 / `whenReady` 成本
 * 算进 #123 目标 1）。`app.mount` → paint 另记 `mountToPaintMs` 旁路。
 * 未捕到 `setData` 起点 ⇒ `finish(fatal)`，**不回退** mount 起点。
 * 稳定期（`sleep(200)`）仍在采样**之后**，不计入任何上报窗口（#131 复审第 2 条）。
 *
 * @param probe 原生 `setData` 探针；`null` = 预热挂载（SDK 尚未包装，读数丢弃）。
 */
async function mountSingleLayer(
  layer: LivePerfLayer,
  longTasks: LongTaskCollector,
  probe: SetDataProbe | null = null,
): Promise<MountResult> {
  const stage = document.getElementById("stage")!;
  stage.innerHTML = "";

  const initialData = makeInitialData(layer);
  // 造数 task 与 firstFrame 窗隔开：否则初始 50k 生成与 mount 同 task，
  // firstFrame 的 long task 会混入窗外造数（第三轮第 1 条）。
  await macrotask();
  await longTasks.flush();

  const data = ref<unknown>(initialData);
  const ready = ref(false);

  const Root = defineComponent({
    setup() {
      return () =>
        h(
          "div",
          { style: "width:100%;height:100%" },
          h(BMap, {
            center: CENTER,
            zoom: 11,
            ak: AK,
            width: "100%",
            height: "100%",
            onReady: () => {
              ready.value = true;
            },
            onError: (error: unknown) => {
              finish(undefined, `BMap error: ${JSON.stringify(error)}`);
            },
          }, {
            default: () => [renderLayer(layer, data.value)],
          }),
        );
    },
  });

  probe?.reset();
  const app = createApp(Root);
  const mountStart = performance.now();
  app.mount(stage);

  const host: LayerHost = {
    setItems: (next) => {
      data.value = next;
    },
  };

  const deadline = performance.now() + READY_MS;
  while (!ready.value) {
    if (report.blockedReason || report.fatal) break;
    if (performance.now() > deadline) {
      finish(undefined, `BMap ready 超时（${READY_MS}ms）`);
      break;
    }
    await sleep(100);
    await nextTick();
  }

  // 首帧终点：ready 后第一次 paint 边界（**不含**下面的稳定期）。
  await nextPaintFrame();
  const firstEnd = performance.now();
  const mountToPaintMs = firstEnd - mountStart;
  await longTasks.flush();

  // #123 目标 1：起点 = 首次原生 setData 进入；预热（probe=null）仍用 mount 起点但读数丢弃。
  const initialSetDataStart = probe?.lastStart() ?? null;
  if (probe && !report.fatal && !report.blockedReason && initialSetDataStart === null) {
    finish(`firstFrame: 首挂未捕获原生 setData 起点（#123 目标 1 不可测，不回退 mount 起点）`);
  }
  const firstFrameStart =
    initialSetDataStart !== null ? initialSetDataStart : mountStart;
  const firstFrame = sample(
    firstEnd - firstFrameStart,
    longTasks.countIn(firstFrameStart, firstEnd),
  );

  // 稳定期：隔离后续 setData/redraw 不受首帧尾巴影响；**不计入** firstFrame。
  await sleep(200);
  await nextTick();
  await nextPaintFrame();

  return { app, host, firstFrame, mountToPaintMs };
}

function renderLayer(layer: LivePerfLayer, dataValue: unknown) {
  if (layer === "pointCollection") {
    // 与 `component-path.perf.test.ts` 同一形态：泛型 SFC 经 h() 会把 Item 推成 unknown，
    // 调用点 `as never` 收掉（typecheck 只在此处放行，props 形状仍由组件自身声明守住）。
    return h(BPointCollection as never, {
      data: dataValue as PerfItem[],
      itemKey: PERF_ITEM_KEY,
      getPosition: perfItemPosition,
      properties: perfItemProperties,
    });
  }
  if (layer === "line") {
    return h(BLineLayer, { data: dataValue as object, idKey: "id" });
  }
  return h(BFillLayer, { data: dataValue as object, idKey: "id" });
}

function makeInitialData(layer: LivePerfLayer): unknown {
  if (layer === "pointCollection") return makeItems(SIZE);
  if (layer === "line") return featureCollection(makeLineFeatures(SIZE));
  return featureCollection(makePolygonFeatures(SIZE));
}

/** 第二份数据：**计时窗外**预生成**，窗口内只赋引用（与 Fake `second = entry.data(size)` 对齐）。 */
function variantData(layer: LivePerfLayer, offset: number): unknown {
  if (layer === "pointCollection") {
    return makeItems(SIZE).map((item, index) => ({
      ...item,
      id: `${item.id}-v${offset}`,
      value: item.value + offset + index,
    }));
  }
  if (layer === "line") {
    return featureCollection(
      makeLineFeatures(SIZE).map((feature, index) => ({
        ...feature,
        properties: { ...feature.properties, id: `line-v${offset}-${index}` },
      })),
    );
  }
  return featureCollection(
    makePolygonFeatures(SIZE).map((feature, index) => ({
      ...feature,
      properties: { ...feature.properties, id: `area-v${offset}-${index}` },
    })),
  );
}

/**
 * 逐图层：首帧（独立挂载）+ 换数据三窗（setData / redraw / native）+ 更新后 FPS。
 *
 * long task **按窗口时间戳 + 交集时长归属**（页面级 collector，窗末 flush 再 countIn）：
 * - `setData` 窗：赋值 → 跨 macrotask + `nextTick` 的**近似 settle**（与 Fake 同型）；
 * - `redraw` 窗：settle 之后 → paint（渲染尾巴算 redraw，不污染 Fake 对照窗）；
 * - 造数与窗口之间强制跨 macrotask，避免整条造数 task 被算进 setData。
 */
async function measureLayer(
  layer: LivePerfLayer,
  probe: SetDataProbe,
  longTasks: LongTaskCollector,
): Promise<LivePerfLayerReadings | null> {
  const mounted = await mountSingleLayer(layer, longTasks, probe);
  if (report.blockedReason || report.fatal) {
    try {
      mounted.app.unmount();
    } catch {
      /* 已卸载 */
    }
    return null;
  }

  // 造数在窗外，且**跨 macrotask** 与 setItems 隔开；native 探针先清零。
  const next = variantData(layer, 2);
  probe.reset();
  await macrotask();
  await longTasks.flush();

  const windowStart = performance.now();
  mounted.host.setItems(next);
  await settle();
  const setDataEnd = performance.now();
  const setDataMs = setDataEnd - windowStart;
  const sdkSetDataMs = probe.last();
  await longTasks.flush();
  const setDataTasks = longTasks.countIn(windowStart, setDataEnd);

  // redraw 窗：从 settle 之后到 paint（不含造数、不含 Fake 对照窗已记的那段）
  const redrawStart = performance.now();
  await nextPaintFrame();
  const redrawEnd = performance.now();
  const redrawMs = redrawEnd - redrawStart;
  await longTasks.flush();
  const redrawTasks = longTasks.countIn(redrawStart, redrawEnd);

  // 更新**之后**的 rAF 频率（环境诊断，不是 setData / redraw 期间的帧率）。
  const postUpdateFps = await sampleFps(1000);

  const reading: LivePerfLayerReadings = {
    layer,
    size: SIZE,
    firstFrame: mounted.firstFrame,
    mountToPaintMs: mounted.mountToPaintMs,
    setData: sample(setDataMs, setDataTasks),
    redraw: sample(redrawMs, redrawTasks),
    sdkSetDataMs,
    postUpdateFps,
  };

  try {
    mounted.app.unmount();
  } catch {
    /* 已卸载 */
  }
  // 图层之间让出一帧 + 短睡，避免上一层的渲染尾巴算进下一层首帧。
  await sleep(50);
  await nextPaintFrame();
  return reading;
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  if (!AK) {
    finish(undefined, "缺少 AK（live 档必须带 ak=）");
    return;
  }

  let probe: SetDataProbe | null = null;
  const longTasks = createLongTaskCollector();
  try {
  // SDK 要等第一次 BMap ready 才存在；先挂一次点图层完成加载与原型包装，
  // 丢弃其读数——否则第 0 个图层的 firstFrame 会混进 loader / 进程冷启动（与 Fake 预热同口径）。
  // 预热时 probe 尚未安装（`instrumentNativeSetData` 在下面），故 `probe=null` 不要求捕获 setData。
  const warmup = await mountSingleLayer("pointCollection", longTasks, null);
    if (report.blockedReason || report.fatal) {
      warmup.app.unmount();
      return;
    }
    warmup.app.unmount();
    await sleep(100);
    await nextPaintFrame();

    probe = instrumentNativeSetData();

    for (const layer of LIVE_PERF_LAYERS) {
      const reading = await measureLayer(layer, probe, longTasks);
      if (!reading) return;
      report.readings.push(reading);
      if (report.blockedReason || report.fatal) return;
    }

    finish();
  } catch (error) {
    finish(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // 计时用的原型包装在测量结束后立刻还原（与真实 0/2/3 路径无关，纯卫生）。
    probe?.restore();
    longTasks.stop();
  }
}

void main();
