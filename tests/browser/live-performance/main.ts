/**
 * 真实浏览器档性能读数的页面（#123）
 *
 * ## 它要回答的四个问题（issue 目标 1~3 + 对照）
 *
 * 1. **首帧交付**：50k 点 / 线 / 面 `setData` 之后到画面可交互的时间；
 * 2. **SDK 调用本身**：同数据量下再次 `setData` 的墙钟（含 SDK 内部解析）；
 * 3. **交互阻塞**：主线程 long task（`PerformanceObserver`）与换数据窗口的 FPS；
 * 4. **对照**：Node 侧把本页读数与 `tests/performance/baseline.json` 的 Fake 读数并排
 *    （差值量级 ≈ SDK 内部成本）。
 *
 * ## 页面只产出**读数**，不产出结论
 *
 * 判定是纯函数（`report.mts`），可以用合成报告回归；放在浏览器里就只能靠人肉复查。
 * 因此这里只记录事实：duration / long task 条数 / 最长任务 / FPS / 环境。
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, resolve));

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
  finish(`window.error: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  finish(`unhandledrejection: ${String(event.reason)}`);
});

/* ------------------------------------------------------------------ 计时 */

/** long task 观察器（`PerformanceObserver`；页面测量逻辑，不单测）。 */
function observeLongTasks(): { stop: () => { count: number; longestMs: number }; reset: () => void } {
  let count = 0;
  let longestMs = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        count += 1;
        if (entry.duration > longestMs) longestMs = entry.duration;
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // 某些环境没有 longtask 支持：读数记 0，不把整轮判死（报告会如实写 count=0）。
    observer = null;
  }
  return {
    reset() {
      count = 0;
      longestMs = 0;
    },
    stop() {
      observer?.disconnect();
      return { count, longestMs };
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

/** FPS 采样：在 `windowMs` 内数 rAF 回调。 */
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
  return frames / (elapsed / 1000) / 60;
}

function sample(durationMs: number, longTasks: { count: number; longestMs: number }): LivePerfSample {
  return {
    durationMs,
    longTaskCount: longTasks.count,
    longestTaskMs: longTasks.longestMs,
  };
}

/* ------------------------------------------------------------------ 夹具 */

interface LayerHost {
  setItems: (next: unknown) => void;
  unmount: () => void;
}

/**
 * 挂载地图 + 三图层，并**在挂载窗口内**采首帧（issue 目标 1：`setData` 提交 → 可交互）。
 *
 * 首帧必须从「给初始 data」起算：图层构造 + 首次 `setData` + 渲染都在这个窗口里；
 * 若先挂完再计时，测到的只是空转，不是交付。
 */
async function mountMapWithLayers(): Promise<{
  app: App;
  hosts: Partial<Record<LivePerfLayer, LayerHost>>;
  firstFrame: LivePerfSample;
}> {
  const stage = document.getElementById("stage")!;
  stage.innerHTML = "";

  const items = makeItems(SIZE);
  const lines = featureCollection(makeLineFeatures(SIZE));
  const polygons = featureCollection(makePolygonFeatures(SIZE));

  const pointData = ref<unknown>(items);
  const lineData = ref<unknown>(lines);
  const fillData = ref<unknown>(polygons);
  const ready = ref(false);
  const hosts: Partial<Record<LivePerfLayer, LayerHost>> = {};

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
            default: () => [
              h(BPointCollection, {
                data: pointData.value as never,
                itemKey: PERF_ITEM_KEY,
                getPosition: perfItemPosition,
                properties: perfItemProperties,
              }),
              h(BLineLayer, { data: lineData.value as never, idKey: "id" }),
              h(BFillLayer, { data: fillData.value as never, idKey: "id" }),
            ],
          }),
        );
    },
  });

  const app = createApp(Root);
  // 首帧窗口：从 mount（初始 data 进入组件树）到 ready + 下一帧 paint。
  const firstObserver = observeLongTasks();
  const firstStart = performance.now();
  app.mount(stage);

  hosts.pointCollection = {
    setItems: (next) => {
      pointData.value = next;
    },
    unmount: () => undefined,
  };
  hosts.line = {
    setItems: (next) => {
      lineData.value = next;
    },
    unmount: () => undefined,
  };
  hosts.fill = {
    setItems: (next) => {
      fillData.value = next;
    },
    unmount: () => undefined,
  };

  const deadline = performance.now() + READY_MS;
  while (!ready.value) {
    if (report.blockedReason) break;
    if (performance.now() > deadline) {
      finish(undefined, `BMap ready 超时（${READY_MS}ms）`);
      break;
    }
    await sleep(100);
    await nextTick();
  }

  await nextPaintFrame();
  await sleep(200);
  await nextTick();
  await nextPaintFrame();
  const firstFrame = sample(performance.now() - firstStart, firstObserver.stop());

  return { app, hosts, firstFrame };
}

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

async function measureLayer(
  layer: LivePerfLayer,
  hosts: Partial<Record<LivePerfLayer, LayerHost>>,
  firstFrame: LivePerfSample,
): Promise<void> {
  const host = hosts[layer];
  if (!host) {
    finish(undefined, `缺少图层宿主：${layer}`);
    return;
  }

  // 换数据：再次 setData（SDK 调用返回墙钟 + long task）
  const setObserver = observeLongTasks();
  const setStart = performance.now();
  host.setItems(variantData(layer, 2));
  await nextTick();
  // setData 是同步调用链；再等一帧让渲染有机会跟上，FPS 采样窗口从这里开始。
  await nextPaintFrame();
  const setDuration = performance.now() - setStart;
  const setTasks = setObserver.stop();

  const fps = await sampleFps(1000);

  // 首帧（挂载窗口）对三个图层是**同一段**交付时间（三图层同一棵树）；记在每行便于按图层读。
  report.readings.push({
    layer,
    size: SIZE,
    firstFrame,
    setData: sample(setDuration, setTasks),
    fps,
  });
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  if (!AK) {
    finish(undefined, "缺少 AK（live 档必须带 ak=）");
    return;
  }

  let app: App | null = null;
  try {
    const mounted = await mountMapWithLayers();
    app = mounted.app;
    if (report.blockedReason) return;

    for (const layer of LIVE_PERF_LAYERS) {
      await measureLayer(layer, mounted.hosts, mounted.firstFrame);
      if (report.blockedReason || report.fatal) return;
      // 图层之间让出一帧，避免上一层的渲染尾巴算进下一层。
      await sleep(50);
      await nextPaintFrame();
    }

    finish();
  } catch (error) {
    finish(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // 读数已写入 window；卸载释放资源（泄漏不是本票门禁，但不该故意留着）。
    try {
      app?.unmount();
    } catch {
      /* 已卸载 */
    }
  }
}

void main();
