/**
 * 官方对照的**真实浏览器档**页面（issue #140，档位二）
 *
 * ## 它补 Fake 档的哪四项
 *
 * Fake 档（`tests/performance/official-contrast.perf.test.ts`）用 Fake v4 测「建了多少资源、
 * 发了多少 SDK 写入、卸载后剩多少」，但它的 `notMeasured` 明写着测不到：long task、真实
 * SDK 重绘、帧调度（FPS）、堆增长。本页正是这四项。
 *
 * ## 计时协议：沿用 `live-performance` 的同名窗口，不另发明
 *
 * | 窗口 | 起点 | 终点 |
 * | --- | --- | --- |
 * | `firstFrame` | `app.mount(stage)` | ready 后**第一次** 2×rAF paint |
 * | `redraw` | **换一份数据**（造数与窗口隔开） | 数据生效后的 2×rAF paint 边界 |
 * | `longTaskMs` | 与 `redraw` 同步 | 同上——它不是一个独立窗口，而是**按窗口归属**的长任务读数 |
 * | `fps` | `redraw` 结束后 | 再采 1s rAF |
 *
 * 之所以复用而不重新设计：#131 两轮评审把那张协议表定下来了（尤其是「造数必须跨 macrotask
 * 与窗口隔开」与「long task 取窗口交集、不取整条 duration」两条），重新发明等于把已付过
 * 学费的坑再踩一遍。
 *
 * ## 页面只产出**读数**，不产出结论
 *
 * 判定与渲染都在 `report.mts`（纯函数），与 Node 编排共用同一份，因此可以用合成报告单测，
 * 不必起浏览器。页面只记录事实：duration / long task 条数 / 窗口交集最长任务 / FPS / 堆增长。
 *
 * ## 页面内测量逻辑**不单测**
 *
 * rAF / `PerformanceObserver` / 真实瓦片只能真浏览器跑，由实跑读数本身取证
 * （两层缝的第二层是接线契约，不是把计时协议抽成纯函数）。
 *
 * ## ⚠️ 本轮**未实跑**（无 AK）
 *
 * 本页与编排已落地，但**没有产出任何数据**。缺 AK 时编排脚本走退出码 3（blocked），
 * 页面不会被当成「跑过了」。文档与 ADR 都如实标注，不从 Fake 读数外推。
 */
import { createApp, defineComponent, h, nextTick, shallowRef, type App } from "vue";
import { Map, PointCollection } from "../../../packages/bmap-vue/src/index.ts";
import {
  DATASET_VERSION,
  PERF_ITEM_KEY,
  datasetDescription,
  makeItems,
  makeMovedItems,
  perfItemPosition,
  perfItemProperties,
  type PerfItem,
} from "../../../tests/performance/dataset.ts";
import {
  LIVE_CONTRAST_REPORT_VERSION,
  type LiveContrastReport,
  type LiveContrastReportDraft,
  type LiveContrastSample,
  type LiveContrastSideReadings,
} from "./report.mts";

declare global {
  interface Window {
    /** 编排脚本用 CDP 读这个全局拿报告（与 live-performance 同一约定）。 */
    __OFFICIAL_CONTRAST_LIVE__?: LiveContrastReport;
  }
}

/* ------------------------------------------------------------------ 报告骨架 */

/**
 * 本轮参数经**页面 URL 查询串**进入，但 **AK 不在其中**。
 *
 * 理由是 AK 的三条去处：
 * - `import.meta.env.VITE_*` 会被 **vite 内联进产物**，等于把 AK 写进 `.artifacts` 里
 *   可能被上传的构建输出；
 * - 页面 URL 是 chrome 的**命令行参数**，因此进 `ps`——同机器上任何进程都能无凭据读到；
 *   它同时是 vite 的一次 HTTP 请求 URL，而 vite 的 info 级请求日志会把它写进 stdout，
 *   在 CI 里 stdout 就是 job log（读者范围比 secrets 大得多）。
 *
 * 因此 AK 由编排脚本经 **CDP** 注入（`window.__CONTRAST_AK_TAKEN__`，**一次性**、领完自删），
 * 那条通道是本进程持有的内存 socket，不进进程表、不进日志、不落盘。URL 只带非敏感的
 * 运行标识——它会进 vite 的请求日志、chrome 的启动参数与 CDP 诊断。
 */
const params = new URLSearchParams(location.search);
const RUN_ID = params.get("run") ?? "unset";
const OURS_VERSION = params.get("ours") ?? "";
const OFFICIAL_VERSION = params.get("official") ?? "";

/**
 * 等编排脚本经 CDP 把 AK 装上，然后**领一次**。
 *
 * 领完那个函数就自删了，所以 AK 不留在页面上给后续 `Runtime.evaluate` 读走。
 * 编排脚本连不上（页面被手工打开、或 CDP 注入失败）时超时退出，走 blocked 3——
 * **不**在没有 AK 的情况下测一���然后把读数当成跑成了。
 */
async function takeInjectedAk(timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const take = (window as { __CONTRAST_AK_TAKEN__?: () => string | null }).__CONTRAST_AK_TAKEN__;
    if (typeof take === "function") {
      const value = take();
      if (value) return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`编排脚本没经 CDP 注入 AK（等 ${timeoutMs}ms）`);
    }
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}

/** 本档只跑一个场景：5 万点批量图层（本库扩展，官方 4.0 无等价物）。 */
const SCENARIO = "point-collection-50k";
const ITEMS = makeItems(50_000);

/**
 * 报告草稿：边测边填。`publish()` 处把它赋给 `LiveContrastReport` 全局，
 * 那次赋值顺带验证「草稿仍与线上格式同形」（见 `LiveContrastReportDraft` 的注释）。
 */
const report: LiveContrastReportDraft = {
  version: LIVE_CONTRAST_REPORT_VERSION,
  mode: "live",
  runId: RUN_ID,
  // 由 `main()` 在真正领到 AK 后改写；初值 false（此刻**还没有** AK）。
  akUsed: false,
  done: false,
  fatal: null,
  blockedReason: null,
  notes: [],
  browser: {
    userAgent: navigator.userAgent,
    sdkVersion: "4.0",
    engine: "jsapi-v4",
  },
  datasetVersion: DATASET_VERSION,
  oursVersion: OURS_VERSION,
  officialVersion: OFFICIAL_VERSION,
  ours: [],
  official: null,
};

function finish(reason: string): void {
  if (report.done || report.fatal) return;
  report.fatal = reason;
  publish();
}

function publish(): void {
  // 这次赋值同时是「草稿仍与线上格式同形」的编译期检查（草稿类型 = 线上类型去 readonly）。
  const frozen: LiveContrastReport = report;
  window.__OFFICIAL_CONTRAST_LIVE__ = frozen;
}

// SDK 内部 worker 的偶发 `importScripts` 错误是**可恢复噪声**（同 URL 200；ready 由下面
// 的 ready 等待负责）。把它当 fatal 会让整轮 0 读数直接 exit=2 —— 与 live-performance 同一
// 处置：只把**页面自身**的脚本错误记成 fatal，噪声进 notes。
window.addEventListener("error", (event) => {
  if (/WorkerGlobalScope|importScripts/i.test(event.message)) {
    report.notes.push(`ignored sdk worker error: ${event.message}`);
    console.warn(`[official-contrast:live] ignored sdk worker error: ${event.message}`);
    return;
  }
  finish(`window.error: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason);
  if (/WorkerGlobalScope|importScripts/i.test(message)) {
    report.notes.push(`ignored sdk worker rejection: ${message}`);
    console.warn(`[official-contrast:live] ignored sdk worker rejection: ${message}`);
    return;
  }
  finish(`unhandledrejection: ${message}`);
});

/* ------------------------------------------------------------------ 计时工具 */

interface LongTaskEntry {
  startTime: number;
  duration: number;
}

/**
 * 页面级**长生命周期** long task 收集器（沿用 #131 定下的口径）。
 *
 * 长收、短 flush、按窗口时间戳**交集**归属。窗末直接 `disconnect()` 会清空 buffer，且
 * PerformanceObserver 通知本身是另排的 task——`nextTick` 只冲微任务，窗末立刻 stop 会丢掉
 * 刚发生、尚未回调的 entry（live-performance 实测过 `sdkSetData=1250ms` 却
 * `setData long task=0` 的假 0）。
 */
function createLongTaskCollector(): {
  flush: () => Promise<void>;
  countIn: (start: number, end: number) => { count: number; longestMs: number };
  stop: () => void;
} {
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
    observer = null;
  }
  const absorb = (): void => {
    if (!observer) return;
    for (const record of observer.takeRecords()) {
      entries.push({ startTime: record.startTime, duration: record.duration });
    }
  };
  return {
    async flush() {
      await new Promise<void>((r) => setTimeout(r, 0));
      absorb();
    },
    countIn(start, end) {
      let count = 0;
      let longestMs = 0;
      for (const entry of entries) {
        const entryStart = entry.startTime;
        const entryEnd = entry.startTime + entry.duration;
        if (entryStart < end && entryEnd > start) {
          count += 1;
          // 窗口交集，不是整条 task：窗外部分不归本窗。
          const overlap = Math.max(0, Math.min(entryEnd, end) - Math.max(entryStart, start));
          if (overlap > longestMs) longestMs = overlap;
        }
      }
      return { count, longestMs };
    },
    stop() {
      absorb();
      observer?.disconnect();
      observer = null;
    },
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/** 跨一个 macrotask + `nextTick` 的近似 settle（与 live-performance 同型）。 */
async function settle(): Promise<void> {
  await sleep(0);
  await nextTick();
}

/** 下一帧 paint 边界（rAF 之后再等一帧，与 live-performance 同一代理）。 */
async function paintBoundary(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

/** 窗口采样：跨一个 macrotask 收 long task，再按**交集**归属。 */
async function sampleWindow(
  collector: ReturnType<typeof createLongTaskCollector>,
  start: number,
): Promise<LiveContrastSample> {
  const end = performance.now();
  await collector.flush();
  const { count, longestMs } = collector.countIn(start, end);
  return { durationMs: end - start, longTaskCount: count, longestTaskMs: longestMs, fps: null };
}

/** 采 1s 的 rAF 帧数并折成 FPS（更新**之后**的环境诊断，不是更新期间帧率）。 */
async function sampleFps(durationMs = 1_000): Promise<LiveContrastSample> {
  let frames = 0;
  const end = performance.now() + durationMs;
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      frames += 1;
      if (performance.now() >= end) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const fps = Math.round((frames / (durationMs / 1_000)) * 10) / 10;
  return { durationMs, longTaskCount: 0, longestTaskMs: 0, fps };
}

/* ------------------------------------------------------------------ 本库侧 */

/**
 * 只测**建图 + 首批数据上屏**这一件事：firstFrame / redraw / longTask / fps / 堆增长。
 *
 * ready 信号用 `Map` 组件的 **`ready` 事件**（公开契约），不是 DOM 探测：探
 * `.bm-viewport` 是在读上游未公开的内部结构，上游改一次类名这里就静默读成「没 ready」。
 */
async function measureOurs(
  collector: ReturnType<typeof createLongTaskCollector>,
  ak: string,
): Promise<LiveContrastSideReadings> {
  const stage = document.createElement("div");
  stage.style.width = "800px";
  stage.style.height = "600px";
  document.body.appendChild(stage);

  // 造数**在挂载前完成**，且跨一个 macrotask 隔开：否则造数与 `mount` 同属一条 task，
  // long task 的窗口交集会被整条撑大（#131 复审第 1 条）。
  //
  // `items` 放进 `ref` 是因为 redraw 窗口要**换一份真实数据**（见下）。原先它是 `const`，
  // `redraw` 窗口因此只是「再等 2×rAF」——**什么都没重画**，窗口名与实际量的东西对不上
  // （第 1 轮评审第 3 条）。堆增长那一项此前文档写的是「换数据后的堆增长」，同样名不副实。
  const items = shallowRef<readonly PerfItem[]>(ITEMS);
  await settle();
  const heapBefore = heapUsed();

  let markReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const Root = defineComponent({
    setup: () => () =>
      h(
        Map,
        {
          center: { lng: 116.404, lat: 39.915 },
          zoom: 11,
          ak,
          style: "width:100%;height:100%",
          onReady: () => markReady?.(),
        },
        {
          default: () => [
            // `as never`：`PointCollection` 对 item 类型是**泛型**的（`TItem`），而 `h()` 的
            // 重载从 props 反推不出 `TItem`，于是把 `perfItemPosition` 收成
            // `(item: unknown) => …` 而不兼容。泛型参数在**调用点**由 data 决定，
            // 渲染期不存在泛型——`as never` 是这一处的正确收窄（与 Fake 档基准同一处理）。
            h(PointCollection as never, {
              // 读 `.value` 才有重渲染的输入：写死 `ITEMS` 会让下面那次换数据
              // 同样退化成 no-op（与 Fake 档 §3 同一条教训）。
              data: items.value,
              itemKey: PERF_ITEM_KEY,
              getPosition: perfItemPosition,
              properties: perfItemProperties,
            }),
          ],
        },
      ),
  });
  const app: App = createApp(Root);

  // firstFrame：mount → ready → 第一次 2×rAF paint。
  const firstStart = performance.now();
  app.mount(stage);
  await withTimeout(ready, 30_000, "Map ready");
  await settle();
  await paintBoundary();
  const firstFrame = await sampleWindow(collector, firstStart);

  // redraw：**真换一份数据** → 数据生效 → 2×rAF paint 边界。
  //
  // 造数（`makeMovedItems`）必须**在窗口之外**且跨一个 macrotask 完成（同 #131 复审第 1 条）：
  // 否则 5 万条的构造与 `setData` 同属一条 task，long task 的窗口交集量到的是造数。
  const moved = makeMovedItems(ITEMS, 0.5);
  await settle();
  const redrawStart = performance.now();
  items.value = moved;
  await nextTick();
  await paintBoundary();
  const redraw = await sampleWindow(collector, redrawStart);

  // fps：redraw 之后采 1s rAF。
  const fps = await sampleFps();
  // 堆增长：自 `heapBefore`（挂载前）到**换完数据之后**——这就是文档承诺的
  // 「换数据后的堆增长」，先前那份文档在没有任何换数据动作时就这么写着。
  const heapAfter = heapUsed();

  app.unmount();
  stage.remove();

  return {
    scenario: SCENARIO,
    firstFrame,
    redraw,
    // `longTaskMs` 不是一个独立窗口——它是 `redraw` 窗口归属的长任务读数。
    // 再单独取一个窗口只会让「重绘阻塞」和「首帧阻塞」混成一团，两边都读不出来。
    longTaskMs: redraw,
    fps,
    heapGrowthBytes: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore,
  };
}

/**
 * 给一个 promise 加超时。
 *
 * 没有它，`ready` 事件不来时这一轮会**永远挂住**，编排脚本只能靠自己的总超时把整轮打成
 * blocked——那时报不出「到底卡在 ready 还是卡在重绘」。
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 未在 ${ms}ms 内到达`)), ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function heapUsed(): number | null {
  const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
  return perf.memory?.usedJSHeapSize ?? null;
}

/* ------------------------------------------------------------------ 官方侧 */

/**
 * 官方侧：**本场景 4.0 无等价物**（`BMap.PointCollection` 已在 4.0 整体移除），因此
 * `official: null`。留一个显式空实现而不是注释掉，是为了让「为什么没有对照」出现在代码里
 * 而不是消失在提交记录里——与 Fake 档场景表的判据一致。
 *
 * ⚠️ **因此本档目前**不是**跨库对照**：它只在官方无等价物的扩展档上量本库自己的
 * long task / 重绘 / FPS / 堆增长，两侧并排那一节永远是空的。这是**已知缺口**，由
 * follow-up issue 接手（见 ADR 的「本档尚未完成」一节）。因此 PR **不**用 `Closes #140`
 * 关掉票面——真实浏览器档的双边对照是 #140 的一条验收项，一个「能 exit 0、但没有 official
 * 侧」的骨架不该把它提前关掉（第 1 轮评审第 3 条）。
 */
async function measureOfficial(_ak: string): Promise<LiveContrastSideReadings[] | null> {
  return null;
}

/* ------------------------------------------------------------------ 驱动 */

async function main(): Promise<void> {
  if (!RUN_ID || RUN_ID === "unset") {
    report.blockedReason = "缺 run= 查询参数：编排脚本没注入本轮标识";
    publish();
    return;
  }
  // 领 AK：编排脚本经 CDP 装好后这里才拿得到。没装上就超时 → fatal，不是「没 AK 也测一轮」。
  let ak = "";
  try {
    ak = await takeInjectedAk();
  } catch (error) {
    report.fatal = String((error as Error)?.message ?? error);
    publish();
    return;
  }
  if (!ak) {
    report.blockedReason = "缺 AK（BAIDU_MAP_AK）：本档不产出任何读数";
    publish();
    return;
  }
  // 领到了才置 true，且**不把 ak 本身写进任何字段**——只有这个布尔进报告。
  report.akUsed = true;

  const collector = createLongTaskCollector();
  try {
    report.ours.push(await measureOurs(collector, ak));
    report.official = await measureOfficial(ak);
    report.done = true;
  } catch (error) {
    report.fatal = String((error as Error)?.message ?? error);
  } finally {
    collector.stop();
  }
  publish();
  // 数据集自述附在 notes，报告读者不必另开文件。
  report.notes.push(`dataset=${JSON.stringify(datasetDescription())}`);
}

void main();
