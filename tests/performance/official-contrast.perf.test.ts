/**
 * 官方对照基准：bmap-vue vs `@baidumap/vue-bmap@1.0.1`（issue #140）
 *
 * ## 这份基准回答什么、不回答什么
 *
 * **回答**：在**同一进程、同一 Vue、同一 Fake v4 替身、同一份确定性数据**下，两库在票面 10 个
 * 场景里的墙钟、SDK 侧调用、实例重建、组件更新、残留资源各是多少。哪些「可并排比较」、
 * 哪些是「本库扩展档」由 `officialScenarios.ts` 登记，本文件只执行。
 *
 * **不回答**「谁更快」。票面明确禁止营销式排名，因此：
 * - 绝对毫秒**只作读数**（Fake 没有真实渲染，跨机器本就不可比）；
 * - 唯一能判失败的是**不变式**（架构预期被破坏），与机器快慢无关；
 * - 官方更轻的场景（简单 Map / Marker 很可能是）**如实记录**。
 *
 * ## 为什么能在 CI 里当门禁
 *
 * 因为它**无 AK、无网络、完全确定**：官方库经 `jsapi-loader.load()` 复用 `window.BMap`，
 * 两边都跑在本仓库的 Fake v4 上（机制见 `officialContrastHarness.ts` 文件头）。
 * 真实浏览器档（long task / 真实重绘 / FPS）是**另一档**，由 `perf:contrast:live` 采集。
 *
 * ## 计时窗只包住「动作」，且**两侧的 setup/act 切分必须逐场景对齐**
 *
 * 每个场景都拆成 `setup → act → teardown` 三段，只有 `act` 进计时窗。这不是洁癖：
 * 官方 `Map` 的 ready 信号在 Fake 上要等它自己的兜底定时器（装配成本里最大的一块是**夹具
 * 差异**，不是性能差），把它算进动作里会让读数变成「谁等得久」而不是「谁建的资源多」。
 * 残留读数则取**卸载之后**的快照——挂载型场景在动作窗口结束时资源本来就还挂着，那是动作
 * 本身，不是泄漏。
 *
 * ⚠️ 切分必须**两侧对称**，且**按场景性质**定，不能一刀切（这是第 1 轮评审的第 2 条）：
 * - **挂载型场景**（§1 / §2 / §6 / §7 / §9）：动作**就是**挂载——放进 setup 会让 `act` 变成
 *   空操作、`recreates` 恒读 0，基准空转。因此两侧的挂载都留在 act 里；
 * - **更新 / 生命周期场景**（§3 / §4 / §5 / §8 / §10）：挂载与 ready 等待是**准备**，两侧都
 *   移进 `setup`，窗口里只留被问的那件事。官方侧此前把挂载放在 act 里，于是它的
 *   时长 / 重建数 / 渲染数把「首挂 1 000 个 Marker」一起吃进去，而本库侧没有——两侧量的
 *   根本不是同一件事。
 *
 * ## 数据
 *
 * 全部来自既有 `dataset.ts`（固定 `DATASET_VERSION` + 种子）。**同一条 `makeItems` 结果同时喂
 * 两边**——数据不同形就不存在比同一件事。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 必须排在 `vue` 之前（渲染器只在创建那一刻读一次 devtools 钩子）。
import "./officialContrastHarness.ts";
import { createApp, defineComponent, getCurrentInstance, h, KeepAlive, nextTick, ref, shallowRef, markRaw, type VNodeChild } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import MarkerList from "../../packages/bmap-vue/src/components/data/MarkerList.vue";
import PointCollection from "../../packages/bmap-vue/src/components/data/PointCollection.vue";
import PointLayer from "../../packages/bmap-vue/src/components/data/PointLayer.vue";
import PolylineComponent from "../../packages/bmap-vue/src/components/overlays/Polyline.vue";
import InfoWindowComponent from "../../packages/bmap-vue/src/components/overlays/InfoWindow.vue";
import {
  DATASET_VERSION,
  PERF_ITEM_KEY,
  datasetDescription,
  makeItems,
  perfItemPosition,
  perfItemProperties,
  type PerfItem,
} from "./dataset";
import { createPerfRecorder } from "./metrics";
import { bucketForInstance } from "./vueRenderCounter.ts";
import { readOursVersion } from "./oursVersion.mts";
import {
  CONTRAST_SCENARIOS,
  contrastDatasetDescription,
  contrastScenario,
  scenarioIdOfMeasure,
} from "./officialScenarios";
import {
  CONTRAST_REPORT_VERSION,
  OFFICIAL_BASELINE_VERSION,
  type ContrastInvariant,
  type ContrastReport,
  type ContrastScenarioReadings,
  type ContrastSideReadings,
} from "./official-contrast/report.mts";
import {
  OFFICIAL_READY_TIMEOUT_MS,
  countOverlayCalls,
  deltaBetween,
  installOfficialLib,
  createOurSideFactory,
  mountOfficial,
  officialFake,
  harness,
  ourFake,
  retainedAfter,
  settle,
  sleep,
  withRenders,
  type ContrastSide,
  type OfficialLib,
} from "./officialContrastHarness";

/* ------------------------------------------------------------------ 装配 */

const recorder = createPerfRecorder({
  file: "official-contrast",
  dataset: contrastDatasetDescription(datasetDescription()),
});

/**
 * 收尾时落两份产物：
 *
 * 1. `recorder.flush()` —— 既有的**指标快照**（每步的 min/median/max + 逐次增量读数）；
 * 2. `contrast-report.json` —— 票面要的那份**对照报告**（`ContrastReport` 形状），
 *    供 `scripts/collect-official-contrast.mts` 渲染人读表格并算退出码。
 *
 * 为什么要两份而不是把报告塞进 recorder：recorder 记的是「每步耗时的分布」，
 * 报告要的是「按票面场景分组的两侧读数 + 不变式 + 身份信封」。形状不同、消费者不同
 * （一个给趋势基线、一个给门禁与报告），合在一起会让两边都要在对方的字段里找东西。
 */
const REPORT_DIR = process.env.PERF_CONTRAST_DIR ?? ".artifacts/perf-contrast";
/** 仓库根（读 package manifest 用；两侧版本号从这里解析）。 */
const PERF_REPO_ROOT = resolve(import.meta.dirname, "../..");

/** 报告文件名。编排脚本用 `PERF_CONTRAST_REPORT` 指向别处（CI 收 artifact 用）。 */
const REPORT_FILE = process.env.PERF_CONTRAST_REPORT
  ? resolve(process.env.PERF_CONTRAST_REPORT)
  : resolve(REPORT_DIR, "contrast-report.json");

/** 报告的信封字段：起止时刻与整轮耗时（`afterAll` 用它算 duration）。 */
const STARTED_AT = new Date().toISOString();
const STARTED_MS = Date.now();
/**
 * 本轮的唯一标识。信封自检（`checkContrastEnvelope`）用它确认「比对的还是同一轮读数」。
 *
 * 允许 `CONTRAST_RUN_ID` 覆盖：编排脚本（`collect-official-contrast.mts`）在跑基准**之前**
 * 生成 id 并注入，这样它随后读的 `contrast-report.json` 与它自己算退出码时认的 id 是同一个；
 * 不注入则退回进程 pid（本地直接 `vitest run` 时的兜底）。
 */
const RUN_ID = process.env.CONTRAST_RUN_ID || `local-${process.pid}`;

/** 不变式的实测结果：场景跑完就登记，`afterAll` 汇总成报告里的一节。 */
const invariantResults: ContrastInvariant[] = [];

/**
 * 登记一条不变式的实测结论。
 *
 * 为什么不直接用 `expect` 就算完：`expect` 失败会让**这一条用例**红，而报告还需要在
 * 「没有红」的时候也**如实写下来**（哪条钉住、钉在哪一侧）。这里**记录**并判定，
 * 判定权与报告读同一个来源，不会出现「CI 说过了、报告说没过」的分叉。
 *
 * ⚠️ **只有 `side: "ours"` / `"both"` 会让用例变红。** `side: "official"` 的那条是
 * **读数**：官方没做到某件事不是本库的回归，让它红等于用别人的缺陷卡自己的门禁。
 * 但它照样进报告的「不变式」一节（`holds: false` 会被显式列出来）——如实记录，不当攻击点，
 * 这正是票面要求的姿态。
 */
function recordInvariant(
  id: string,
  scenario: string,
  description: string,
  side: ContrastInvariant["side"],
  holds: boolean,
): void {
  invariantResults.push({ id, scenario, description, side, holds });
  if (side !== "official") {
    expect(holds, `不变式被破坏：${id}（${scenario}）— ${description}`).toBe(true);
  }
}

let official: OfficialLib;

beforeAll(async () => {
  official = await installOfficialLib();
});

/**
 * 采样次数：每次都要真挂真卸（官方侧装配要等到 ready），3 次够取 min/max 又不至于让整轮太久。
 * 预热 1 次：第一次常含模块冷启动 / JIT 未热。
 */
const SAMPLES = 3;
const WARMUP = 1;

const ITEMS_100 = makeItems(100);
const ITEMS_1K = makeItems(1_000);
const ITEMS_10K = makeItems(10_000);
const ITEMS_50K = makeItems(50_000);

/** 10k 点的路径：Polyline 场景用（与 Marker 场景共用同一批点，量的维度不同而已）。 */
const PATH_10K = ITEMS_10K.map((item) => ({ lng: item.lng, lat: item.lat }));
/** 第二份 10k 路径：真实 path replacement 用（经度整体平移，形状不变、内容全变）。 */
const PATH_10K_MOVED = PATH_10K.map((point) => ({ lng: point.lng + 0.5, lat: point.lat }));

/** 本库 `MarkerList` 的取数面（它没有 `properties` —— 那是 `PointCollection` 的 prop）。 */
const MARKER_DATA = {
  itemKey: PERF_ITEM_KEY,
  getPosition: perfItemPosition,
} as const;

/** 本库两个批量点组件的取数面（含 `properties`）。 */
const POINT_DATA = {
  ...MARKER_DATA,
  properties: perfItemProperties,
} as const;

/**
 * 官方侧的点列表：刻意**逐项**渲染 `Marker`（与本库 `MarkerList` 语义对齐）。
 *
 * 官方 `PointCollection` 在 4.0 已整体移除，所以官方在本场景**没有**批量路径可选——
 * 报告如实记，不拿别的组件冒充等价物（票面：不为对照伪造等价物）。
 */
const officialMarkers = (items: readonly PerfItem[], tag = "") =>
  items.map((item) =>
    h(official.Marker as never, {
      key: `${item.id}${tag}`,
      position: { lng: item.lng, lat: item.lat },
    }),
  );

/** 官方侧的一条折线（与本库 `Polyline` 同一份路径数据）。 */
const officialPolyline = (path: readonly { lng: number; lat: number }[]) =>
  h(official.Polyline as never, { path: path.map((p) => ({ lng: p.lng, lat: p.lat })) });

/* ------------------------------------------------------------------ 测量循环 */

/** 一次测量采齐的两侧读数。 */
interface SideReadings {
  /** **动作**（挂载 / 换数据 / 生命周期切换）本身的墙钟毫秒。 */
  readonly durationMs: number;
  /**
   * **卸载 / 销毁**的墙钟毫秒（独立窗口，第 2 轮评审第 5 条）。
   *
   * 与 `durationMs` 分开是因为场景名同时含两个动作（"mount / destroy"）：合成一个数字
   * 就没法归因「慢在挂载还是慢在卸载」，只有一个数字时又会让读者误以为两个都测了。
   */
  readonly teardownMs: number;
  readonly delta: {
    readonly sdkCalls: number;
    readonly callKind: string;
    readonly recreates: number;
    readonly renderCallbacks: number;
    readonly retainedResources: number;
    readonly retainedListeners: number;
  };
}

/** 每个场景跑完后的**汇总**（报告的一行）：两侧中位数 + 官方为何缺席。 */
const measuredScenarios: {
  measure: string;
  ours: SideReadings;
  official: SideReadings | null;
  officialSkippedReason: string | null;
}[] = [];

/**
 * 跑一轮对照：预热 → 两侧各 `SAMPLES` 次。
 *
 * 每次采样都是：`reset()` → 快照基线 → `setup()` → 归零重渲染计数 → **计时 `act()`** →
 * 取窗口内增量 → `teardown()` → 取卸载后残留。
 *
 * 三个不变量在这里钉死（每条都写出来，因为它们都是「基准本身会骗人」的地方）：
 *
 * 1. **两侧的 `act` 是同一个动作的两种写法**——不是「官方那边随便做点别的」；
 * 2. **残留取自卸载之后**——否则挂载型场景必然读出「有资源」，那是挂载还没拆；
 * 3. **本库侧残留必须是 0**——这是**回归**门禁；官方侧只记录（`§5` 会看到官方 `Polyline`
 *    卸载后覆盖物还在，那条是本轮的真实读数，不当攻击点）。
 */
async function measureBoth(
  name: string,
  setupOurs: () => Promise<ContrastSide | null>,
  setupOfficial: () => Promise<ContrastSide | null>,
): Promise<{ ours: SideReadings; official: SideReadings | null }> {
  const oursReadings: SideReadings[] = [];
  const officialReadings: SideReadings[] = [];
  /** 某一侧这一次没测成的原因（累积到场景级，供报告如实写「官方为何缺席」）。 */
  const blockedReasons: string[] = [];

  const runOnce = async (
    side: ContrastSide | null,
    sideName: "ours" | "official",
  ): Promise<SideReadings | null> => {
    if (!side) {
      // `null` 侧有两类，得**分开**记：官方无等价物（扩展档，正常）≠ 官方跑挂了（blocked）。
      // 靠「setup 工厂返回 null」区分：扩展档是场景表登记过的，不是失败。
      const reason = sideName === "official" && !contrastScenario(scenarioIdOfMeasure(name)).official
        ? "官方无等价物（场景表登记为本库扩展档）"
        : "装配失败";
      blockedReasons.push(`${sideName}: ${reason}`);
      recorder.readout(`${name}.${sideName}`, `blocked: ${reason}`);
      return null;
    }
    // 两侧的账本**不共用**（见 officialContrastHarness 文件头第 2 条），所以按侧取 Fake。
    const fake = sideName === "ours" ? ourFake : officialFake;
    await side.setup();
    if (!side.ready) {
      await side.teardown();
      blockedReasons.push(`${sideName}: 装配后未 ready`);
      recorder.readout(`${name}.${sideName}`, "blocked: 装配后未 ready");
      return null;
    }
    await settle();
    side.resetRenders();
    const before = fake.diagnostics.snapshot();
    const start = performance.now();
    await side.act();
    await settle();
    const durationMs = performance.now() - start;
    // 「没跑成」必须在动作**之后**判（官方侧的子树是动作里才挂上的，见 blockedReason 注释）。
    const blocked = side.blockedReason?.() ?? null;
    if (blocked) {
      await side.teardown();
      blockedReasons.push(`${sideName}: ${blocked}`);
      recorder.readout(`${name}.${sideName}`, `blocked: ${blocked}`);
      return null;
    }
    const window = deltaBetween(before, fake.diagnostics.snapshot(), side.renders());
    if (side.sdkCallCount) {
      // 数字与**它量的那个调用面名字**一起覆盖：只换数字不换名字，报告里那一列就会
      // 继续顶着 `listenCalls` 的默认名，读起来像量了全部 SDK 交互（第 1 轮评审第 8 条）。
      window.sdkCalls = side.sdkCallCount();
      window.callKind = side.sdkCallKind ?? window.callKind;
    }
    // 卸载/销毁**单独计时**（票面指标 5 的另一半，第 2 轮评审第 5 条）。
    //
    // 此前 teardown 完全在计时窗外：场景名写着「mount / destroy」「mount / unmount」，
    // 读数却只有 mount 的时长，销毁成本**没有任何独立读数**——读者会把 durationMs
    // 读成「挂载+卸载」。这里给它自己的窗口：`act` 仍是那件事本身（不许把两个动作塞进
    // 同一个窗，否则时长不再是可归因的）。
    const teardownStart = performance.now();
    await side.teardown();
    const teardownMs = performance.now() - teardownStart;
    await settle();
    return {
      durationMs,
      teardownMs,
      delta: {
        ...withRenders(window, side.renders()),
        ...retainedAfter(before, fake.diagnostics.snapshot()),
      },
    };
  };

  // 预热：模块冷启动 / JIT 未热，第一次的读数不取。
  for (let i = 0; i < WARMUP; i += 1) {
    for (const setup of [setupOurs, setupOfficial]) {
      const side = await setup();
      if (!side) continue;
      await side.setup();
      if (side.ready) await side.act();
      await side.teardown();
      await settle();
    }
  }
  await settle();

  for (let i = 0; i < SAMPLES; i += 1) {
    for (const [sideName, setup] of [
      ["ours", setupOurs],
      ["official", setupOfficial],
    ] as const) {
      const fake = sideName === "ours" ? ourFake : officialFake;
      fake.diagnostics.reset();
      await settle();
      const readings = await runOnce(await setup(), sideName);
      if (!readings) continue;
      (sideName === "ours" ? oursReadings : officialReadings).push(readings);
      recorder.sample(`${name}.${sideName}`, readings.durationMs);
      // 卸载/销毁另记一条（票面指标 5 是「mount/unmount time」，两个都得有独立读数）。
      recorder.sample(`${name}.${sideName}.teardown`, readings.teardownMs);
      recorder.readout(
        `${name}.${sideName}.delta.${i}`,
        JSON.stringify(readings.delta),
      );
      // 本库卸载后必须零残留——这是**回归**门禁（官方侧只记录，见文件头第 3 条）。
      if (sideName === "ours") {
        expect(readings.delta.retainedResources, `${name} ours 卸载后有残留资源`).toBe(0);
        expect(readings.delta.retainedListeners, `${name} ours 卸载后有残留监听器`).toBe(0);
      }
    }
  }

  if (oursReadings.length === 0) throw new Error(`${name} ours 侧一次都没测到（基准空转）`);
  /**
   * 场景级聚合。
   *
   * ⚠️ **两个墙钟指标各自取中位数**（三轮评审第 1 条）。此前只按 `durationMs` 排序，然后把
   * 那一整条 sample 当成中位数——在 delta 基本是确定性计数时影响不大，但 `teardownMs`
   * 是**另一个独立的噪声型**墙钟指标，于是报告里的 teardown 实际是「act 耗时位于中间的
   * 那一轮，它碰巧对应的 teardown」，而不是 teardown 自己的中位数。
   *
   * 这不是吹毛求疵：同一轮基准的**两个产物**（recorder 的 `*.teardown` 与报告的
   * `teardownMs`）会给出不同的代表值，读者据此比较两侧就会得到一个两边口径不同的差值。
   *
   *   act:      5, 6, 7      → 取 6
   *   teardown: 1, 100, 2    → 取 2（而不是「act=6 那一轮的 100」）
   *
   * 计数类 `delta` 则**继续取 act-median 那一条**：它们是同一轮动作产生的账本增量，
   * 逐字段各取一个中位数会把「建了多少」与「重建了多少」拆到不同轮次去，比对时反而对不上。
   * 这条分界不是「有的聚合有的不聚合」，而是**墙钟各自取中位数、计数保持同源**。
   */
  const median = (values: readonly SideReadings[]): SideReadings => {
    const byAct = [...values].sort((a, b) => a.durationMs - b.durationMs);
    const byTeardown = [...values].sort((a, b) => a.teardownMs - b.teardownMs);
    const mid = Math.floor(values.length / 2);
    return { ...byAct[mid]!, teardownMs: byTeardown[mid]!.teardownMs };
  };
  const official = officialReadings.length > 0 ? median(officialReadings) : null;
  // 官方没读到数时，`officialSkippedReason` **必须**有值（报告里「本库扩展档」那一节要写
  // 「为什么没有对照」）；扩展档与跑挂了在这里就被合并成一句可读的说明。
  const officialSkippedReason = official
    ? null
    : (blockedReasons.find((entry) => entry.startsWith("official:"))?.slice("official: ".length) ??
      "官方侧未产出读数");
  measuredScenarios.push({ measure: name, ours: median(oursReadings), official, officialSkippedReason });
  return { ours: median(oursReadings), official };
}

/* ------------------------------------------------------------------ §1 */

describe("§1 Map cold mount / destroy", () => {
  it("两边都建立并释放一张地图", async () => {
    await measureBoth(
      "map.lifecycle",
      async () => {
        // **挂载型场景**：`setup()` 只备料不挂；建图这件事就是被计时的「动作」。
        // （否则 §1 会退化成「测一个空函数」——挂载型场景的动作**就是**挂载。）
        const side = createOurSideFactory(() => null);
        return {
          ready: true,
          setup: async () => {},
          act: async () => {
            side.mount();
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      async () => {
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        return {
          // 官方侧 **不能**像本库侧那样「ready 先于动作」：`mountOfficial` 一挂载就同步
          // 建图（`createMap` 在 setup 里跑），ready 只决定「子树渲不渲」。因此
          // 「挂载」在官方侧必然属于动作窗口，本库侧也必须对齐——否则两侧量的不是同一件事。
          get ready() {
            return true;
          },
          setup: async () => {},
          act: async () => {
            mounted = await mountOfficial(official, () => null);
            ok = mounted.ready;
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
        };
      },
    );
  }, 180_000);
});

/* ------------------------------------------------------------------ §2 */

describe("§2 100 Marker mount/unmount", () => {
  it("两边都是逐点 Marker", async () => {
    const items = ITEMS_100;
    await measureBoth(
      "marker100.mount",
      async () => {
        const side = createOurSideFactory(() => h(MarkerList as never, { data: items, ...MARKER_DATA }));
        return {
          ready: true,
          setup: async () => {},
          act: async () => {
            side.mount();
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      async () => {
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        return {
          get ready() {
            return true;
          },
          setup: async () => {},
          act: async () => {
            mounted = await mountOfficial(official, () => officialMarkers(items));
            ok = mounted.ready;
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
        };
      },
    );
  }, 180_000);
});

/* ------------------------------------------------------------------ §3 */

describe("§3 1k Marker position update", () => {
  it("换一份新位置数据：SDK 写入与实例重建次数", async () => {
    const first = ITEMS_1K;
    // 第二份：同一批点、经度整体平移 —— 「真的换了位置」而不是换了引用就完事。
    const second: PerfItem[] = first.map((item) => ({ ...item, lng: item.lng + 0.5 }));

    const result = await measureBoth(
      "marker1k.update",
      async () => {
        const side = createOurSideFactory(() =>
          // ⚠️ 必须读 `data.value`：渲染闭包捕获 `first` 就等于**换引用也不更新**，
        // 场景退化成「什么都没发生」——`act()` 里的赋值触发不了任何重渲染，于是
        // 「0 次重建」读成的是「0 次更新」而不是「更新了但复用实例」。`children` 是个
        // 每次渲染都重新调用的 thunk（见 `createOurSideFactory`），所以读得到最新值。
          h(MarkerList as never, { data: data.value, ...MARKER_DATA }),
        );
        const data = shallowRef(markRaw(first as readonly PerfItem[]));
        let baseline = 0;
        return {
          ready: true,
          setup: async () => {
            side.mount();
            await settle();
            // 基线取在装配之后、动作之前：装配建的那批点不算「动作发的写入」。
            baseline = countOverlayCalls(ourFake, "setPosition");
          },
          act: async () => {
            data.value = markRaw(second as readonly PerfItem[]);
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
          // 按 SDK 语义覆盖：票面要的是「换位置发了多少次 SDK 写入」，而 `listenCalls`
          // 分辨不出位置写入。1 000 个点换位置 ⇒ 恰好 1 000 次 `setPosition`（复用实例）。
          sdkCallCount: () => countOverlayCalls(ourFake, "setPosition") - baseline,
          sdkCallKind: "setPosition",
        };
      },
      async () => {
        const current = ref<readonly PerfItem[]>(first);
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        let baseline = 0;
        return {
          get ready() {
            return true;
          },
          // 官方侧的挂载与 ready 等待**移进 setup**（不在 act 里）：本场景问的是
          // 「换位置数据」，首挂不是被问的那件事。此前把 `mountOfficial` 放在 act 里
          // 会让官方侧的时长 / 重建数 / 渲染数把「首次挂载 1 000 个 Marker」一起吃进去，
          // 而本库侧在 setup 里挂——两侧量的就不是同一件事了。
          setup: async () => {
            mounted = await mountOfficial(official, () => officialMarkers(current.value));
            ok = mounted.ready;
            await settle();
            baseline = countOverlayCalls(officialFake, "setPosition");
          },
          act: async () => {
            current.value = second;
            await settle();
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
          sdkCallCount: () => countOverlayCalls(officialFake, "setPosition") - baseline,
          sdkCallKind: "setPosition",
        };
      },
    );

    // 语义断言：这场景的**前提**是「真的更新了 1 000 个位置」。没有它，一个再次退化成
    // no-op 的基准仍然全绿（第 1 条评审意见就是它）——而「0 次重建」在 no-op 下
    // 恰好也是 0，方向相反的两件事会互相抵消。
    expect(result.ours.delta.sdkCalls, "本库 1k 换位置应发 1000 次 setPosition").toBe(1_000);
    expect(result.official?.delta.sdkCalls, "官方 1k 换位置应发 1000 次 setPosition").toBe(1_000);
    // 0 次重建 = 复用实例改位置；重建数非 0 意味着「删了重建」而不是「原地更新」。
    expect(result.ours.delta.recreates, "本库 1k 换位置不应重建覆盖物").toBe(0);
  }, 180_000);
});

/* ------------------------------------------------------------------ §4 */

describe("§4 Polyline 10k 点：父级无关状态更新", () => {
  it("父级改一个与 path 无关的状态：两侧都**不**重发 path（不变式）", async () => {
    const result = await measureBoth(
      "polyline10k.parentUpdate",
      async () => {
        const path = shallowRef(markRaw(PATH_10K as { lng: number; lat: number }[]));
        // 父级状态：Polyline 挂在它**下面**，path 引用**不变**。读 `parentState.value`
        // 就是为了让父级更新真的重渲到 Polyline —— 不读它，父级更新与折线无关，
        // 场景就退化成「什么都没发生」，不变式就成了空跑。
        const parentState = ref(0);
        const side = createOurSideFactory((): VNodeChild => {
          void parentState.value;
          return h(PolylineComponent as never, { path: path.value });
        });
        let baseline = 0;
        return {
          ready: true,
          setup: async () => {
            side.mount();
            await settle();
            // 基线取在装配**之后**、动作之前：装配建的那条折线不算「动作发了 path」。
            baseline = countOverlayCalls(ourFake, "setPath");
          },
          act: async () => {
            parentState.value += 1;
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
          sdkCallCount: () => countOverlayCalls(ourFake, "setPath") - baseline,
          sdkCallKind: "setPath",
        };
      },
      async () => {
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        const parentState = ref(0);
        let baseline = 0;
        return {
          get ready() {
            return true;
          },
          // 挂载与 ready 等待在 **setup**（与本库侧同位置）：本场景问的只是「父级改一个
          // 与 path 无关的状态」，首挂 10k 折线不是被问的那件事。放在 act 里会让两侧
          // 量的不是同一件事（本库侧在 setup 里挂、官方侧在 act 里挂 + 等 ready）。
          setup: async () => {
            mounted = await mountOfficial(official, () => {
              void parentState.value;
              return officialPolyline(PATH_10K);
            });
            ok = mounted.ready;
            await settle();
            baseline = countOverlayCalls(officialFake, "setPath");
          },
          act: async () => {
            parentState.value += 1;
            await settle();
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
          sdkCallCount: () => countOverlayCalls(officialFake, "setPath") - baseline,
          sdkCallKind: "setPath",
        };
      },
    );
    // 票面 §4 的核心不变式：**父级改一个与 path 无关的状态，不应重发 path**。
    // 这是「父级更新被隔离到 path 之外」的架构预期，与快慢无关，因此可判。
    recordInvariant(
      "polyline-parent-update-no-resend",
      "polyline-10k-parent-update",
      "父级改一个与 path 无关的状态时，0 次 setPath 重发",
      "ours",
      result.ours.delta.sdkCalls === 0,
    );
    // 官方侧同一条只作**读数**：官方没做到不算本库的回归，但如实记进报告。
    if (result.official) {
      recordInvariant(
        "official-polyline-parent-update-no-resend",
        "polyline-10k-parent-update",
        "官方在父级无关更新时是否重发 path（读数，不构成本库的义务）",
        "official",
        result.official.delta.sdkCalls === 0,
      );
    }
  }, 180_000);
});

/* ------------------------------------------------------------------ §5 */

describe("§5 Polyline 10k 点：真实 path replacement", () => {
  it("真的换一份 10k path：两侧都重发 path、不重建实例", async () => {
    const result = await measureBoth(
      "polyline10k.pathReplace",
      async () => {
        const path = shallowRef(markRaw(PATH_10K as { lng: number; lat: number }[]));
        const side = createOurSideFactory(
          (): VNodeChild => h(PolylineComponent as never, { path: path.value }),
        );
        let baseline = 0;
        return {
          ready: true,
          setup: async () => {
            side.mount();
            await settle();
            baseline = countOverlayCalls(ourFake, "setPath");
          },
          act: async () => {
            path.value = markRaw(PATH_10K_MOVED as { lng: number; lat: number }[]);
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
          sdkCallCount: () => countOverlayCalls(ourFake, "setPath") - baseline,
          sdkCallKind: "setPath",
        };
      },
      async () => {
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        const path = ref<readonly { lng: number; lat: number }[]>(PATH_10K);
        let baseline = 0;
        return {
          get ready() {
            return true;
          },
          // 同 §4：挂载与 ready 在 setup，窗口里只留「换 path」这一件事。
          setup: async () => {
            mounted = await mountOfficial(official, () => officialPolyline(path.value));
            ok = mounted.ready;
            await settle();
            baseline = countOverlayCalls(officialFake, "setPath");
          },
          act: async () => {
            path.value = PATH_10K_MOVED;
            await settle();
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
          sdkCallCount: () => countOverlayCalls(officialFake, "setPath") - baseline,
          sdkCallKind: "setPath",
        };
      },
    );
    // 真实 path replacement：**两侧都应恰好重发一次** path。这是架构预期（不重建实例、
    // 只重发数据），与快慢无关，因此是可判的不变式。
    recordInvariant(
      "polyline-path-replace-once",
      "polyline-10k-path-replace",
      "换一份 10k path 时恰好重发一次 setPath（不重建覆盖物）",
      "ours",
      result.ours.delta.sdkCalls === 1,
    );
    if (result.official) {
      recordInvariant(
        "official-polyline-path-replace-once",
        "polyline-10k-path-replace",
        "官方换一份 10k path 时恰好重发一次 setPath（读数，不是本库的义务）",
        "official",
        result.official.delta.sdkCalls === 1,
      );
    }
  }, 180_000);
});

/* ------------------------------------------------------------------ §6（扩展档） */

describe("§6 PointCollection / equivalent 50k（本库扩展档）", () => {
  it("5 万点走单个 SDK 批量资源（官方 v4 无此组件）", async () => {
    const result = await measureBoth(
      "pointcollection50k",
      async () => {
        const side = createOurSideFactory(() =>
          h(PointCollection as never, { data: ITEMS_50K, ...POINT_DATA }),
        );
        return {
          ready: true,
          setup: async () => {},
          act: async () => {
            // **挂载型场景**：建这 5 万点的批量图层就是被计时的动作（放进 setup 会让
            // `act` 变成空操作，断言 `recreates <= 1` 恒真——基准空转）。
            side.mount();
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      // 官方无等价物：v3-only 的 `BMap.PointCollection` 在 4.0 整体移除，**返回 null**
      // 让报告把它列进「本库扩展档」而不是伪造一个数字。
      async () => null,
    );
    expect(result.official, "官方侧本应无等价物（PointCollection 4.0 已移除）").toBeNull();
    // 本库侧是**一张图 + 一个数据图层**承载 5 万点，而不是 5 万个覆盖物。数字写死成 2
    // （1 map + 1 layer）而不是「≤ N」：上界在点规模涨 50 倍时也成立，读者看不出构成；
    // 写死构成才能在真的多建了一层时立刻指向「点被拆成了多个批量资源」。
    expect(result.ours.delta.recreates, "本库 50k 应是 1 张图 + 1 个批量图层").toBe(2);
  }, 300_000);
});

/* ------------------------------------------------------------------ §7（扩展档） */

describe("§7 本库 Native Point 50k（本库扩展档）", () => {
  it("5 万点走扩展 API 的原生点图层（官方无对应组件封装）", async () => {
    const result = await measureBoth(
      "nativepoint50k",
      async () => {
        const side = createOurSideFactory(() => h(PointLayer as never, { data: ITEMS_50K, ...POINT_DATA }));
        return {
          ready: true,
          setup: async () => {},
          act: async () => {
            // 同 §6：挂载就是动作（见那里「基准空转」的说明）。
            side.mount();
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      // 官方 binding 没有原生点图层的组件封装 —— 同样返回 null，单列为扩展档。
      async () => null,
    );
    expect(result.official, "官方侧本应无等价物（无原生点图层组件封装）").toBeNull();
    // 同 §6：1 张图 + 1 个原生点图层，不因点数增长而拆分。
    expect(result.ours.delta.recreates, "本库 native point 50k 应是 1 张图 + 1 个图层").toBe(2);
  }, 300_000);
});

/* ------------------------------------------------------------------ §8 */

describe("§8 InfoWindow mount/update/destroy", () => {
  it("信息窗的建立、内容更新与关闭", async () => {
    await measureBoth(
      "infowindow.lifecycle",
      async () => {
        const open = ref(false);
        const title = ref("初始");
        const side = createOurSideFactory(
          (): VNodeChild =>
            h(InfoWindowComponent as never, {
              open: open.value,
              title: title.value,
              position: { lng: 116.404, lat: 39.915 },
            }),
        );
        return {
          ready: true,
          setup: async () => {
            side.mount();
            await settle();
          },
          act: async () => {
            open.value = true;
            await settle();
            title.value = "更新";
            await settle();
            open.value = false;
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      async () => {
        let mounted: Awaited<ReturnType<typeof mountOfficial>> | null = null;
        let ok = true;
        const open = ref(false);
        const content = ref("初始");
        return {
          get ready() {
            return true;
          },
          // 挂载与 ready 在 setup：本场景问的是「打开 / 更新内容 / 关闭」三步，首挂不是
          // 被问的那件事（与本库侧的 setup/act 切分对齐）。
          setup: async () => {
            mounted = await mountOfficial(official, () =>
              h(official.InfoWindow as never, {
                content: content.value,
                open: open.value,
                position: { lng: 116.404, lat: 39.915 },
              }),
            );
            ok = mounted.ready;
            await settle();
          },
          act: async () => {
            open.value = true;
            await settle();
            content.value = "更新";
            await settle();
            open.value = false;
            await settle();
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            mounted?.unmount();
            await settle();
          },
          renders: () => mounted?.renders() ?? 0,
          resetRenders: () => mounted?.resetRenders(),
        };
      },
    );
  }, 180_000);
});

/* ------------------------------------------------------------------ §9 */

describe("§9 Router 重复 mount/unmount", () => {
  it("真实路由反复进出同一路由（两侧都接 vue-router）", async () => {
    const { createRouter, createMemoryHistory, RouterView } = await import("vue-router");

    // 两侧的路由表**逐条对应**：`/` 空路由、`/map` 带一个覆盖物的路由。两边差的只有
    // 「谁提供地图容器」——那正是被对照的库本身，其余（路由、history、进出次数）同构。
    const routes = [
      { path: "/", component: defineComponent({ render: () => null }) },
      {
        path: "/map",
        component: defineComponent({
          render: () => h(PolylineComponent as never, { path: PATH_10K.slice(0, 10) }),
        }),
      },
    ];

    await measureBoth(
      "router.remount",
      async () => {
        const router = createRouter({ history: createMemoryHistory(), routes });
        // `<RouterView>` 读的是**注入**里的 router 实例，因此 app 必须 `use(router)`；
        // 少了这一步它会在 render 时抛 `undefined.value`（实测）。
        // 本库的 Map 是**外壳**（provider 在它身上），RouterView 挂在它里面。
        const side = createOurSideFactory(
          (): VNodeChild => h(RouterView as never, null, { default: () => [] }),
          { global: { plugins: [router] } },
        );
        return {
          ready: true,
          setup: async () => {
            await router.push("/");
            await router.isReady();
          },
          act: async () => {
            // 挂载与「进出路由」同属动作窗口：本场景问的是「反复进出」，
            // 首挂是它的第一步，不是能挪到窗口外的准备。
            side.mount();
            await settle();
            for (let i = 0; i < 3; i += 1) {
              await router.push("/map");
              await nextTick();
              await router.push("/");
              await nextTick();
            }
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      async () => {
        const container = document.createElement("div");
        container.style.width = "400px";
        container.style.height = "300px";
        document.body.appendChild(container);
        const ready = ref(false);
        const router = createRouter({ history: createMemoryHistory(), routes });
        // 计数桶在**根组件 setup 里**建（与两侧共用的 `createOurSideFactory` / `mountOfficial`
        // 同一条路径）。这里不能写死 `() => 0`：那会让「官方侧的渲染次数」恒读 0，
        // 两侧用同一把尺子的前提就没了。
        let bucket = bucketForInstance(null);
        const Root = defineComponent({
          setup() {
            bucket = bucketForInstance(getCurrentInstance());
            return () =>
              h(official.BMapProvider as never, { ak: "fake", version: "4.0" }, {
                default: () => [
                  h(
                    official.Map as never,
                    {
                      center: { lng: 116.404, lat: 39.915 },
                      zoom: 11,
                      style: "width:100%;height:100%",
                      onReady: () => {
                        ready.value = true;
                      },
                    },
                    // 官方库的地图是**外壳**（Provider/Map 在它身上），RouterView 在它里面。
                    { default: () => [h(RouterView as never, null, { default: () => [] })] },
                  ),
                ],
              });
          },
        });
        const app = createApp(Root);
        // `router` 必须 `install` 到 app 上、并 `use(router)` 注入——缺任一条，`<RouterView>`
        // 读不到注入的 router 实例（实测会在 `vue-router` 内部抛 `undefined.value`）。
        app.use(router);
        let ok = true;
        return {
          get ready() {
            return true;
          },
          setup: async () => {},
          act: async () => {
            await router.push("/");
            await router.isReady();
            app.mount(container);
            const started = Date.now();
            while (!ready.value && Date.now() - started < OFFICIAL_READY_TIMEOUT_MS) {
              await sleep(20);
              await nextTick();
            }
            ok = ready.value;
            for (let i = 0; i < 3; i += 1) {
              await router.push("/map");
              await nextTick();
              await router.push("/");
              await nextTick();
            }
            await settle();
          },
          blockedReason: () => (ok ? null : "官方 Map 未报 onReady"),
          teardown: async () => {
            app.unmount();
            container.remove();
            await settle();
          },
          renders: () => bucket.count,
          resetRenders: () => {
            bucket.count = 0;
          },
        };
      },
    );
  }, 300_000);
});

/* ------------------------------------------------------------------ §10（扩展档） */

describe("§10 KeepAlive activate/deactivate（本库扩展档）", () => {
  it("deactivate/activate：地图挂起而非重建（官方无 KeepAlive 语义）", async () => {
    const result = await measureBoth(
      "keepalive.toggle",
      async () => {
        // 切换的开关在 **KeepAlive 之内**：KeepAlive 只对「被切换的那棵子树」调
        // onDeactivated / onActivated，把 Map 放在 KeepAlive 外面再切它，只会触发
        // unmount/remount —— 测的就不是「挂起」而是「重建」了。
        const inside = ref(true);
        // `wrap` 里那棵子树才是被 KeepAlive 切换的 Map；factory 自己的 children 为空
        // （地图**不能**同时出现在两个位置，否则 KeepAlive 缓存的与实际显示的不是同一棵）。
        const side = createOurSideFactory(() => null, {
          wrap: () =>
            h(KeepAlive, { max: 1 }, {
              default: () => [inside.value ? h(MapComponent, { provider: harness.provider() }) : h("div")],
            }),
        });
        return {
          ready: true,
          setup: async () => {
            side.mount();
            await settle();
          },
          act: async () => {
            inside.value = false; // deactivate（KeepAlive 缓存，不销毁）
            await settle();
            inside.value = true; // activate（复用，不重建）
            await settle();
          },
          teardown: async () => {
            side.unmount();
            await settle();
          },
          renders: side.renders,
          resetRenders: side.resetRenders,
        };
      },
      // 官方库**没有**任何 KeepAlive 语义（无 onActivated / onDeactivated）—— 不伪造对照。
      async () => null,
    );
    expect(result.official, "官方侧本应无等价物（无 KeepAlive 语义）").toBeNull();
    // deactivate → activate 不应重建地图：recreates 为 0 是「挂起而非重建」的直接读数。
    expect(result.ours.delta.recreates, "KeepAlive 切换不应重建地图").toBe(0);
  }, 180_000);
});

/* ------------------------------------------------------------------ 报告 */

function toSideReadings(readings: SideReadings): ContrastSideReadings {
  return {
    durationMs: readings.durationMs,
    teardownMs: readings.teardownMs,
    sdkCalls: readings.delta.sdkCalls,
    callKind: readings.delta.callKind,
    recreates: readings.delta.recreates,
    renderCallbacks: readings.delta.renderCallbacks,
    retainedResources: readings.delta.retainedResources,
    retainedListeners: readings.delta.retainedListeners,
  };
}

/** 把内部读数整理成报告的场景列表（顺序 = 场景表顺序 = 票面顺序）。 */
function buildScenarioReadings(): ContrastScenarioReadings[] {
  // 反向索引：场景 id → 测量名（`scenarioIdOfMeasure` 的逆）。集中在这里而不是让
  // 报告顺着场景表逐条反查，是为了「测量名 ↔ 票面 id」这张表**只有一处**。
  const measuredById = new Map(
    measuredScenarios.map((entry) => [scenarioIdOfMeasure(entry.measure), entry]),
  );
  return CONTRAST_SCENARIOS.map((scenario) => {
    const measured = measuredById.get(scenario.id);
    if (!measured) {
      // 场景表登记了但**没跑**（用例被 skip / 崩了）。填 `null` 而不是省略这一行：
      // 报告少一行会被读成「这个场景不存在」，而票面要求逐条可核对。
      return {
        id: scenario.id,
        official: scenario.official,
        ours: null,
        officialSide: null,
        officialSkippedReason: "本轮未跑到该场景（用例缺失或提前失败）",
      };
    }
    return {
      id: scenario.id,
      official: scenario.official,
      ours: toSideReadings(measured.ours),
      officialSide: measured.official ? toSideReadings(measured.official) : null,
      ...(measured.officialSkippedReason
        ? { officialSkippedReason: measured.officialSkippedReason }
        : {}),
    };
  });
}

afterAll(() => {
  // 明确写出本档测不到什么，避免读者把 Fake 读数外推到真实浏览器。
  recorder.notMeasured("long task（happy-dom 无 PerformanceObserver longtask）→ 真实浏览器档才出");
  recorder.notMeasured("真实 SDK 重绘 / 帧调度 / FPS");
  recorder.notMeasured("堆增长（--expose-gc 下的 heapUsed）→ Fake 档不测，真实浏览器档才出");
  recorder.notMeasured("官方侧真实网络与 AK 鉴权路径（本档复用 window.BMap，无 script 加载）");
  // 票面原口径与本档实测口径**明确分开**，不让列名冒充它量的东西（第 1 轮评审第 8 条）。
  recorder.notMeasured(
    "票面的「SDK 调用总数」：真实与 Fake v4 都没有单一计数器，报告按调用面分列 " +
      "（listen / setPosition / setPath），没有一项是「总数」",
  );
  recorder.notMeasured(
    "票面的「watcher 回调次数」：Vue 3 没有公开的 watcher 计数面（本档记的是组件渲染次数）",
  );
  // 票面指标 5「mount/unmount time」：两个动作各有一个独立窗口（`act` / `teardown`），
  // 不合并成一个数字——合成后无法归因「慢在挂载还是慢在卸载」。
  recorder.readout("timingWindows", "act（挂载或更新）+ teardown（卸载/销毁）各一个窗口");
  recorder.readout("scenarios", CONTRAST_SCENARIOS.length);
  recorder.readout("datasetVersion", DATASET_VERSION);

  const snapshot = recorder.snapshot();
  const env = snapshot.environment as Record<string, string>;
  const report: ContrastReport = {
    version: CONTRAST_REPORT_VERSION,
    mode: "fake-v4",
    done: true,
    fatal: null,
    blockedReason: null,
    notes: [
      "两侧在同一 vitest 进程里跑，共享同一份 Vue 与同一份确定性数据（`dataset.ts` 固定种子）。",
      "官方库经 `@baidumap/jsapi-loader` 的 load() 复用 `window.BMap`，本档**无 AK、无网络**。",
      "绝对毫秒只作读数：本档是 Fake v4，没有真实渲染，跨机器不可比。",
    ],
    envelope: {
      runId: RUN_ID,
      oursVersion: readOursVersion(PERF_REPO_ROOT),
      officialVersion: readPackageVersion("node_modules/@baidumap/vue-bmap/package.json"),
      datasetVersion: DATASET_VERSION,
      platform: env.platform ?? "unknown",
      arch: env.arch ?? "unknown",
      cpuModel: env.cpuModel ?? "unknown",
      node: env.node ?? process.version,
    },
    scenarios: buildScenarioReadings(),
    invariants: invariantResults,
    notMeasured: [...snapshot.notMeasured],
    startedAt: STARTED_AT,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - STARTED_MS,
  };
  mkdirSync(resolve(REPORT_FILE, ".."), { recursive: true });
  writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  recorder.flush();
});

/**
 * 报告要自述「跑的是哪一版」：版本从**实际安装的** manifest 读，缺失时给 `unknown`。
 *
 * ⚠️ 本库侧走 `readOursVersion`（与两个编排脚本**同一份**实现，见 `oursVersion.mts` 的文件头：
 * 这段逻辑曾逐字重复四处，改一处不会让任何门禁变红，而「本库版本」是报告自证用的字段）。
 * 官方侧读的是**已安装包**的 manifest，路径不同，所以留本地的通用读法。
 */
function readPackageVersion(manifestPath: string): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(PERF_REPO_ROOT, manifestPath), "utf8")) as {
      version?: string;
    };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
