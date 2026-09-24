/**
 * 数据组件路径的基准（M6-PERFORMANCE / issue #37，阶段 A）
 *
 * 与 `preprocess.perf.test.ts` 的分工：那个文件测**纯函数步骤**（适配 / 扫描 / 聚合）的 CPU 成本；
 * 这个文件测**组件路径**——数据从 prop 到「SDK 收到 setData」的整段墙钟延迟，以及反复替换数据时的
 * 资源 / 保留内存趋势（issue #36 欠下的「大数据量用例」，本票在这里补上量级维度）。
 *
 * ## 本文件最重要的一个读数：§5 的「响应式形态」对照
 *
 * 阶段 A 的结论由这一条决定：
 *
 * | 50k 数据替换一次 | 读数（Apple M4 / Node 22 / happy-dom） |
 * | --- | --- |
 * | 宿主用 `ref([...])`（Vue 深响应数组，最常见写法） | ~120ms |
 * | 同一份数据 `markRaw` / `shallowRef` | ~14ms |
 * | 同一个适配函数 `adaptPoints`（纯输入 13ms / 深响应输入 90~130ms） | —— |
 *
 * 也就是说：**贵的是「在响应式 effect 里逐项读一份深响应大数组」这件事本身**（Vue 的 Proxy 读取
 * 与依赖收集），不是我们的算法——同一个 `adaptPoints` 对同一份数据在普通输入上是 13ms。
 * 这条读数直接决定了「Worker 不是答案」：Worker 也要先把数据读出来送过去，读取成本照付。
 * 详细口径与后续动作见 ADR `2026-09-21-performance-baseline-and-worker-decision`。
 *
 * ## 读数是什么、不是什么
 *
 * - **是**：`Item[] → 适配 → 指纹 → setData → 资源` 这条链在**我们这一侧 + Vue 运行时**上的延迟
 *   与增长趋势。
 * - **不是**：SDK 侧真实重绘。这里的 SDK 是 Fake（`setData` 只记引用，O(1)），没有真实浏览器，
 *   也没有渲染。因此这些数字**不能**读成「50k 点在页面上要多久」。
 * - 墙钟延迟里包含 `await` 边界（微任务让出），所以它**不等于**单次同步阻塞时长；那些步骤的同步
 *   读数在 `preprocess.perf.test.ts`（那里是同步直接调用）。
 *
 * ## 每个规模都先证明「走的是批量路径」
 *
 * 读数若来自逐项 Marker 路径，50k 的挂载时间会被 50k 次 SDK 调用主导，结论就完全反了。
 * 因此每个规模都断言 `nativeLayersCreated` 恰好 1、`attached('overlay')` 恰好 0
 * ——这正是「批量点不是逐点 Marker」的领域读数（#34 / #35）。
 *
 * ## 堆趋势需要强制 GC
 *
 * 「100 次替换后堆涨了多少」在 Node 里默认测不准：不强制 GC 时读到的是**未回收的垃圾**
 * （实测 230MB+，把「GC 还没跑」误读成泄漏）。因此本文件用 `globalThis.gc()` 取「**保留量**」，
 * 并把 `--expose-gc` 写进 `tests/performance/vitest.config.ts`（缺了它这里**直接报错**，不静默降级
 * ——静默降级会让这条门禁变成一条永远通过的空门禁）。
 */
import { afterAll, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, markRaw, nextTick, ref, shallowRef, type VNodeChild } from "vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BLineLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BLineLayer.vue";
import BFillLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BFillLayer.vue";
import BHeatmapLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BHeatmapLayer.vue";
import BTrackLineLayer from "../../packages/baidu-map-gl-vue/src/components/layers/BTrackLineLayer.vue";
import BPointCollection from "../../packages/baidu-map-gl-vue/src/components/data/BPointCollection.vue";
import {
  PERF_ITEM_KEY,
  PERF_SIZES,
  datasetDescription,
  featureCollection,
  makeItems,
  makeLineFeatures,
  makePointFeatures,
  makePolygonFeatures,
  makeTrackFeature,
  perfItemPosition,
  perfItemProperties,
  type PerfItem,
  type PerfSize,
} from "./dataset";
import { createPerfRecorder } from "./metrics";

const { harness, fake } = createFakeV4Harness();

const recorder = createPerfRecorder({ file: "component-path", dataset: datasetDescription() });

afterAll(() => {
  recorder.flush();
});

/** 量级上的病态上界（与 `preprocess` 同一口径：只抓数量级回归，不承担精细回归）。 */
const PATHOLOGICAL_CEILING_MS = 2_000;

/** 浏览器长任务的判定线（**只进读数与结论**，不当门禁）。 */
const LONG_TASK_MS = 50;

/** 采集次数：组件路径每次都要真挂真卸，次数多了会让整轮变慢（5 次足够取 `min`/`max`）。 */
const SAMPLES = 5;

const ITEMS = new Map<PerfSize, PerfItem[]>(PERF_SIZES.map((size) => [size, makeItems(size)]));

/**
 * 数据源的两种「响应式形态」。
 *
 * - `reactive`：`ref([...])`，Vue 会把这棵树深响应化 —— `<script setup>` 里最常见的写法，
 *   也是本文件 §1 的默认口径（**不替使用者美化输入**：读数要反映真实用法）；
 * - `shallow`：`shallowRef(markRaw([...]))`，Vue 只跟踪引用本身。
 *
 * 两者的差别就是 §5 的结论，因此这里用同一个类型承载，避免「两个用例走两条不同代码路径」。
 */
interface DataHolder {
  get(): readonly PerfItem[];
  set(value: readonly PerfItem[]): void;
}

function reactiveHolder(items: readonly PerfItem[]): DataHolder {
  const source = ref(items as readonly PerfItem[]);
  return {
    get: () => source.value,
    set: (value) => {
      source.value = value;
    },
  };
}

function shallowHolder(items: readonly PerfItem[]): DataHolder {
  const source = shallowRef(markRaw(items as readonly PerfItem[]));
  return {
    get: () => source.value,
    set: (value) => {
      source.value = markRaw(value);
    },
  };
}

function mountTree(children: () => VNodeChild) {
  const Root = defineComponent({
    setup: () => () => h(BMap, { provider: harness.provider() }, children),
  });
  return mount(Root, { attachTo: harness.container() });
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

/** 挂一个 `BPointCollection`（数据来自 `holder`，样式可写）。 */
async function mountPoints(holder: DataHolder) {
  const style = ref<Record<string, unknown>>({ size: 6, color: "#0055ff" });
  const wrapper = mountTree(() =>
    h(BPointCollection as never, {
      data: holder.get(),
      itemKey: PERF_ITEM_KEY,
      getPosition: perfItemPosition,
      properties: perfItemProperties,
      ...style.value,
    }),
  );
  return { wrapper, holder, style };
}

describe("§1 原生批量点组件：挂载 / 换引用 / 样式 / 卸载（100 / 1k / 10k / 50k）", () => {
  it.each(PERF_SIZES.map((size) => [String(size), size] as const))(
    "规模 %s：四个动作各采样 5 次，并证明走的是批量路径",
    async (_label, size) => {
      const items = ITEMS.get(size)!;
      const featuresPerMount: number[] = [];

      // 采样前先做一次**丢弃的挂载 / 卸载**：`<BMap>` 的第一次挂载要付「client + loader + driver 装配 +
      // Vue 首次 patch + 建图」这些**过程内一次性**成本（实测合并 main 后的第一次运行里，
      // `mount.pointCollection@100` 的 min 是 16.15ms，紧接着再跑一次就掉回个位数毫秒）。
      // 记的是**稳定态**的挂载；首次那一次仍然以 `.firstMs` 读数进报告（读数，不做门禁）。
      const warmup = await mountPoints(reactiveHolder(items));
      await settle();
      warmup.wrapper.unmount();
      await settle();
      harness.assertIdle(`规模 ${size} 预热后`);

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const layersBefore = harness.nativeLayersCreated();

        const mountStart = performance.now();
        const { wrapper, holder, style } = await mountPoints(reactiveHolder(items));
        await settle();
        recorder.sample(`mount.pointCollection@${size}`, performance.now() - mountStart);

        // 正证守卫：批量路径（1 个图层、0 个覆盖物）；否则后面的读数测的是别的东西。
        const created = harness.nativeLayersCreated() - layersBefore;
        expect(created, `规模 ${size}：必须只有 1 个原生图层`).toBe(1);
        expect(harness.attached("overlay"), `规模 ${size}：不得逐点建覆盖物`).toBe(0);
        featuresPerMount.push(readFeatures(harness.nativeLayerData()));

        const replaceStart = performance.now();
        // 换**引用**、内容相同：正是「宿主换了数组」这条最常见的更新路径。
        holder.set([...items]);
        await settle();
        recorder.sample(`setData.replace@${size}`, performance.now() - replaceStart);

        const styleStart = performance.now();
        style.value = { size: 10, color: "#ff5500" };
        await settle();
        recorder.sample(`style.update@${size}`, performance.now() - styleStart);

        const unmountStart = performance.now();
        wrapper.unmount();
        await settle();
        recorder.sample(`unmount.pointCollection@${size}`, performance.now() - unmountStart);

        // 每一个规模都跑一遍泄漏门禁：数据量不该改变「卸载后归零」。
        harness.assertIdle(`规模 ${size} 卸载后`);
      }

      recorder.readout(`features@${size}`, featuresPerMount[0] ?? 0);
      recorder.readout(
        `mount.pointCollection@${size}.firstMs`,
        round(recorder.stat(`mount.pointCollection@${size}`).samples[0] ?? 0),
      );
      recorder.readout(
        `mount.pointCollection@${size}.perItemMicros`,
        round((recorder.stat(`mount.pointCollection@${size}`).min / size) * 1000),
      );
      expect(featuresPerMount.length, "真的采了样（否则下面的 every 在空数组上恒真）").toBe(SAMPLES);
      expect(featuresPerMount.every((count) => count === size), "每次挂载都必须下发全部要素").toBe(true);
    },
  );
});

describe("§2 组件路径的量级上界（病态回归的绊线）", () => {
  it("50k 的挂载 / 替换 / 卸载都不越界，并留下长任务读数", () => {
    const steps = [
      "mount.pointCollection@50000",
      "setData.replace@50000",
      "unmount.pointCollection@50000",
    ];
    for (const step of steps) {
      const stat = recorder.stat(step);
      recorder.readout(`${step}.maxMs`, round(stat.max));
      // 50ms 线只作**读数**（与预处理那套同口径）：组件路径的耗时随机器速度与负载变化，
      // 拿它当门禁会在慢机器 / 共享 runner 上假红。它进报告，由 ADR 的结论与欠账表消费。
      recorder.readout(`${step}.exceedsLongTask`, stat.max > LONG_TASK_MS ? "yes" : "no");
      // 判据用 median（理由见 `preprocess.perf.test.ts` 同一条）：`max` 会成为进程被抢占的读数。
      expect(stat.median, `${step} median ${stat.median.toFixed(1)}ms`).toBeLessThan(PATHOLOGICAL_CEILING_MS);
    }
  });
});

describe("§3 100 次数据替换：保留内存与资源趋势（10k）", () => {
  /**
   * 判据是**保留量**（强制 GC 之后的 `heapUsed` 增量），不是分配量。
   *
   * 反证过：把 100 份数据留在数组里时这条门禁立刻红（见 PR 的「单点反证」一节），而在当前实现下
   * 它是 MB 以下——两者差两个数量级，阈值 8MB 有充足的判别力。
   */
  const REPLACEMENTS = 100;
  const WARMUP = 20;
  const SAMPLE_EVERY = 20;
  const RETAINED_CEILING_MB = 8;

  it("替换 100 次不换实例、不泄漏资源、不重复订阅，且保留内存有界", async () => {
    const items = ITEMS.get(10_000)!;
    const heapUsedMb = (): number => process.memoryUsage().heapUsed / 1024 ** 2;
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== "function") {
      throw new Error(
        "堆趋势需要强制 GC：请用 `pnpm test:performance`（tests/performance/vitest.config.ts 里设了 " +
          "execArgv: ['--expose-gc']）。缺了它读到的只是未回收的垃圾，会把「GC 还没跑」当成泄漏。",
      );
    }
    const retainedMb = (): number => {
      gc();
      gc();
      return heapUsedMb();
    };

    const { wrapper, holder } = await mountPoints(reactiveHolder(items));
    await settle();

    // 预热：把「第一次挂载的一次性分配」与冷启动的堆抬升排除在趋势之外。
    for (let i = 0; i < WARMUP; i += 1) {
      holder.set([...items]);
      await settle();
    }

    const layersAfterWarmup = harness.nativeLayersCreated();
    const listensAfterWarmup = harness.listenActivity().calls;
    const retainedSeries: number[] = [retainedMb()];
    const start = performance.now();
    for (let i = 0; i < REPLACEMENTS; i += 1) {
      holder.set([...items]);
      await settle();
      if ((i + 1) % SAMPLE_EVERY === 0) retainedSeries.push(retainedMb());
    }
    const totalMs = performance.now() - start;

    const retainedGrowth = retainedSeries[retainedSeries.length - 1]! - retainedSeries[0]!;
    const perReplaceMs = totalMs / REPLACEMENTS;
    const listenerGrowth = harness.listenActivity().calls - listensAfterWarmup;
    const layerGrowth = harness.nativeLayersCreated() - layersAfterWarmup;

    recorder.readout("replace100.iterations", REPLACEMENTS);
    recorder.readout("replace100.totalMs", round(totalMs));
    recorder.readout("replace100.perReplaceMs", round(perReplaceMs));
    recorder.readout("replace100.retainedSeriesMb", retainedSeries.map(round).join(" → "));
    recorder.readout("replace100.retainedGrowthMb", round(retainedGrowth));
    recorder.readout("replace100.layerInstancesDelta", layerGrowth);
    recorder.readout("replace100.listenerSubscriptionsDelta", listenerGrowth);
    recorder.readout("replace100.pendingListeners", harness.listenActivity().pending);
    recorder.sample("replace100.perIterationMs", perReplaceMs);

    // 先收尾（卸载）再断言：否则一条断言失败会把资源留到下一个用例，
    // 让「泄漏」以级联失败的形式出现在**别的**用例上（实测踩过）。
    wrapper.unmount();
    await settle();

    harness.assertIdle("100 次替换后卸载");
    expect(layerGrowth, "100 次替换不得换实例").toBe(0);
    expect(listenerGrowth, "100 次替换不得重复订阅").toBe(0);
    expect(
      retainedGrowth,
      `100 次替换后保留内存增长 ${retainedGrowth.toFixed(1)}MB（序列 ${retainedSeries.map(round).join(" → ")}）`,
    ).toBeLessThan(RETAINED_CEILING_MB);
    // 正证守卫：诊断计数真的在动（否则「归零」可能只是因为什么都没发生）。
    expect(fake.diagnostics.snapshot().activity.layersAttached, "至少挂过一次图层").toBeGreaterThan(0);
  });
});

describe("§4 对照：GeoJSON 直通的原生图层（我们的逐要素成本为 0）", () => {
  it("50k 线的挂载延迟不随要素数增长（数据整包转发给 SDK）", async () => {
    const features = makeLineFeatures(50_000);
    const createdBase = harness.nativeLayersCreated();

    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const start = performance.now();
      const wrapper = mountTree(() =>
        h(BLineLayer as never, { data: { type: "FeatureCollection", features }, idKey: "id" }),
      );
      await settle();
      recorder.sample("mount.lineLayerGeoJson@50000", performance.now() - start);
      wrapper.unmount();
      await settle();
      harness.assertIdle(`50k 线图层卸载（第 ${sample + 1} 次）`);
    }

    recorder.readout(
      "mount.lineLayerGeoJson@50000.layersCreated",
      harness.nativeLayersCreated() - createdBase,
    );
    recorder.readout(
      "mount.lineLayerGeoJson@50000.perItemMicros",
      round((recorder.stat("mount.lineLayerGeoJson@50000").min / 50_000) * 1000),
    );

    // 对照结论的可观察形式：两条路径每项成本的量级差（适配层才是我们那部分成本）。
    const adaptedPerItem = recorder.stat("mount.pointCollection@50000").min / 50_000;
    const passthroughPerItem = recorder.stat("mount.lineLayerGeoJson@50000").min / 50_000;
    recorder.readout("contrast.perItemRatio", round(adaptedPerItem / Math.max(passthroughPerItem, 1e-6)));
    expect(passthroughPerItem).toBeGreaterThan(0);
  });
});

describe("§5 输入数据的响应式形态决定更新成本（阶段 A 结论的关键对照）", () => {
  /**
   * 这条对照是「Worker 不是答案」的直接依据：贵的是**在响应式 effect 里读一份深响应大数组**，
   * 而 Worker 也必须先把数据读出来（`postMessage` 会遍历同一棵树），照付这份成本。
   *
   * #124 已据这一条收口：3.0 的落地方式是**文档指引**（大数据量用 `shallowRef` / `markRaw` +
   * `dataVersion`），实现级 `pauseTracking` 取证有效（组件路径 ~2.7×）但因公开边界 / 模块身份耦合
   * 不落地。取证读数与理由见 ADR `2026-09-24-deep-reactive-array-update-path`。
   *
   * 断言取「深响应明显更贵」而不是一个固定毫秒数：它是**机器无关**的（两条路径在同一进程里跑），
   * 同时把「这条结论仍然成立」变成一个可证伪的门禁——如果哪天 Vue 让追踪变便宜、或者我们的实现
   * 不再在 effect 里读数据，这条会红，要求回头更新 ADR 的结论。
   */
  const RATIO_FLOOR = 1.5;

  it("同一份 50k 数据：ref 数组比 markRaw 明显更贵", async () => {
    const items = ITEMS.get(50_000)!;

    async function measureReplace(holder: DataHolder, metric: string): Promise<number> {
      const mounted = await mountPoints(holder);
      await settle();
      // 预热一次：排除首次适配时的 Proxy 创建成本，只比**稳态**替换成本。
      mounted.holder.set([...items]);
      await settle();
      for (let sample = 0; sample < 3; sample += 1) {
        const start = performance.now();
        mounted.holder.set([...items]);
        await settle();
        recorder.sample(metric, performance.now() - start);
      }
      mounted.wrapper.unmount();
      await settle();
      harness.assertIdle(metric);
      return recorder.stat(metric).min;
    }

    const reactiveMs = await measureReplace(reactiveHolder(items), "replace.reactiveArray@50000");
    const shallowMs = await measureReplace(shallowHolder(items), "replace.markRawArray@50000");
    const ratio = reactiveMs / Math.max(shallowMs, 1e-6);

    recorder.readout("contrast.reactiveArrayMs", round(reactiveMs));
    recorder.readout("contrast.markRawArrayMs", round(shallowMs));
    recorder.readout("contrast.reactiveOverMarkRaw", round(ratio));

    // 正证守卫：两条读数都必须真的 > 0（否则比值恒真，门禁空转）。
    expect(shallowMs, "markRaw 路径必须有读数").toBeGreaterThan(0);
    expect(reactiveMs, "ref 路径必须有读数").toBeGreaterThan(0);
    expect(
      ratio,
      `深响应数组替换 ${reactiveMs.toFixed(1)}ms vs markRaw ${shallowMs.toFixed(1)}ms（${ratio.toFixed(1)}×）：` +
        "阶段 A 的结论依赖这条差值，若它不再成立需要更新 ADR",
    ).toBeGreaterThan(RATIO_FLOOR);
  }, 120_000);
});

/**
 * §6 四类原生图层 × 四种规模（issue #37 评审 3 指出的缺口）。
 *
 * `#36` 把「大数据 setData / style update 与资源清理」交办给了本票，而原先的矩阵只覆盖
 * `BPointCollection`（逐项 `Item[]` 路径）+ 一个 `BLineLayer` 的 50k 挂载对照。这里把**四类原生
 * 图层**（line / fill / heatmap / track-line）在 100 / 1k / 10k / 50k 上都跑一遍四个动作，
 * 并逐个断言「只有一个 SDK 资源 / 不逐要素建覆盖物 / 换数据不换实例 / 卸载后归零」。
 *
 * 口径说明：
 * - 这四类的 `data` 是**直接吃 GeoJSON**（没有适配层），因此读数主要是「我们的转发 + 挂载链路成本」，
 *   而不是逐要素算法成本——这正是与 `BPointCollection`（走 `adaptPoints`）的分工；
 * - `track-line` 的大数据维度是**一条路径的顶点数**（官方只接收单条 `LineString` Feature），
 *   且它的登记面只有 `setData`（没有 style），因此它的动作是三个而不是四个；
 * - 采样 3 次（而非 5 次）：这一节的目的是**覆盖面**，不是精度；精度由 §1/§5 的规模曲线承担。
 */
interface NativeLayerCase {
  /** 指标前缀与用例文案。 */
  readonly name: string;
  readonly component: unknown;
  readonly data: (size: PerfSize) => object;
  /**
   * 「数据真的下发了」的**规模读数**：集合类数要素、`TrackLine` 数一条路径的顶点。
   *
   * 两种形状必须分开读：`TrackLine` 收的是单条 `LineString` Feature（没有 `features` 数组），
   * 用集合的口径去数会恒为 0 —— 那会把「形状弄错了」伪装成「数据没下发」。
   */
  readonly volume: (data: unknown) => number;
  /**
   * 该 kind 的样式面：
   * - `null` = 没有 style（`TrackLine` 只登记了 `setData`，因此**不要**给它传 `style`）；
   * - 否则给出「更新一次样式**必须**看到的 SDK 调用」（含最小次数）。
   *
   * 为什么要把「必须看到什么」写进夹具：这一节第一版把样式字段**展开成顶层 prop** 传给组件
   * （`...style.value`），而 `useVisualLayer` 读的是 `props.style` ⇒ 样式路径根本没跑，
   * 而当时只把调用次数记成 readout、没有断言，矩阵照样是绿的（评审第 2 轮指出的假绿）。
   * 现在按 kind 逐条断言：专页图层（line / fill）是 `setStyleOptions` + 显式 `doOnceDraw`，
   * 扩展 API（heatmap）走它自己的 `setOptions`（依据见 `driver/jsapi-v4/native-layers.ts` 的 invoke 分流）。
   */
  readonly style: {
    readonly value: Record<string, unknown>;
    readonly expectCalls: ReadonlyArray<{ readonly call: string; readonly min: number }>;
  } | null;
}

const NATIVE_LAYER_CASES: readonly NativeLayerCase[] = [
  {
    name: "line",
    component: BLineLayer,
    data: (size) => featureCollection(makeLineFeatures(size)) as object,
    volume: featureCount,
    style: {
      value: { strokeColor: "#ff5500", strokeWeight: 4 },
      expectCalls: [
        { call: "setStyleOptions", min: 1 },
        { call: "doOnceDraw", min: 1 },
      ],
    },
  },
  {
    name: "fill",
    component: BFillLayer,
    data: (size) => featureCollection(makePolygonFeatures(size)) as object,
    volume: featureCount,
    style: {
      value: { fillColor: "#ff5500", fillOpacity: 0.6 },
      expectCalls: [
        { call: "setStyleOptions", min: 1 },
        { call: "doOnceDraw", min: 1 },
      ],
    },
  },
  {
    name: "heatmap",
    component: BHeatmapLayer,
    data: (size) => featureCollection(makePointFeatures(size)) as object,
    volume: featureCount,
    // 扩展 API 只公开整袋 `setOptions`（官方没有可核对的 Heatmap 声明）⇒ 断言它，而不是专页图层的 setter。
    style: { value: { radius: 20 }, expectCalls: [{ call: "setOptions", min: 1 }] },
  },
  {
    name: "track-line",
    component: BTrackLineLayer,
    data: (size) => makeTrackFeature(size) as unknown as object,
    volume: trackVertexCount,
    style: null,
  },
];

/**
 * 当前实例上某类 SDK 调用的**次数**。
 *
 * 增量断言必须用它：`nativeLayerCalls().includes("setData")` 会被**挂载阶段**那次调用满足，
 * 于是「换引用路径退化成 no-op」也是绿的（评审第 2 轮指出的第二处假绿）。
 */
function nativeCallCount(call: string): number {
  return harness.nativeLayerCalls().filter((entry) => entry === call).length;
}

/** 集合类夹具的规模：要素数。 */
function featureCount(data: unknown): number {
  const features = (data as { features?: unknown } | undefined)?.features;
  return Array.isArray(features) ? features.length : 0;
}

/** `TrackLine` 夹具的规模：一条 `LineString` 的顶点数。 */
function trackVertexCount(data: unknown): number {
  const coordinates = (data as { geometry?: { coordinates?: unknown } } | undefined)?.geometry
    ?.coordinates;
  return Array.isArray(coordinates) ? coordinates.length : 0;
}

const MATRIX_SAMPLES = 3;

describe("§6 四类原生图层 × 四种规模：setData / style / 卸载", () => {
  const combos = NATIVE_LAYER_CASES.flatMap((entry) =>
    PERF_SIZES.map((size) => [entry, size] as const),
  );

  it.each(combos.map(([entry, size]) => [`${entry.name}@${size}`, entry, size] as const))(
    "%s：挂载 / 换数据 / 样式 / 卸载，且不换实例、不泄漏",
    async (_label, entry, size) => {
      const first = entry.data(size);
      const second = entry.data(size);

      for (let sample = 0; sample < MATRIX_SAMPLES; sample += 1) {
        const layersBefore = harness.nativeLayersCreated();
        const data = ref<object>(first);
        // 样式走**组件的 `style` prop**（一个袋子）。四类可视化图层的共享装配
        // （`useVisualLayer`）读的是 `props.style`；把它展开成 `strokeColor` 之类的顶层字段
        // 只会落进 attrs，样式路径根本不会跑（这一节第一版就是这么错的）。
        const style = ref<Record<string, unknown> | undefined>(undefined);

        const mountStart = performance.now();
        const wrapper = mountTree(() =>
          h(entry.component as never, {
            data: data.value,
            idKey: "id",
            ...(entry.style ? { style: style.value } : {}),
          }),
        );
        await settle();
        recorder.sample(`mount.${entry.name}@${size}`, performance.now() - mountStart);

        // 正证守卫：这条 kind 真的只建了 1 个 SDK 资源，且没有逐要素覆盖物。
        const created = harness.nativeLayersCreated() - layersBefore;
        expect(created, `${entry.name}@${size}：只应创建 1 个原生图层`).toBe(1);
        expect(harness.attached("overlay"), `${entry.name}@${size}：不得逐要素建覆盖物`).toBe(0);
        expect(
          entry.volume(harness.nativeLayerData()),
          `${entry.name}@${size}：下发的规模必须等于夹具规模`,
        ).toBe(size);

        const setDataBefore = nativeCallCount("setData");
        const replaceStart = performance.now();
        data.value = second;
        await settle();
        recorder.sample(`data.replace.${entry.name}@${size}`, performance.now() - replaceStart);
        expect(
          harness.nativeLayersCreated() - layersBefore,
          `${entry.name}@${size}：换数据不得换实例`,
        ).toBe(1);
        // **增量**断言（`includes("setData")` 会被挂载阶段那次调用满足 ⇒ 假绿），并且核对下发的
        // 就是**新那份引用**：两条合起来才证明「换引用 → 真的重新下发了一次」。
        expect(
          nativeCallCount("setData") - setDataBefore,
          `${entry.name}@${size}：换引用必须恰好再下发一次 setData`,
        ).toBe(1);
        // 比的是**交出去的那份**（`data.value`）：`ref` 会把它深响应化成 Proxy，
        // 拿原始对象比会因为 Proxy !== target 而假红 —— 那不是「没下发」的证据。
        expect(
          harness.nativeLayerData(),
          `${entry.name}@${size}：下发的必须是新那份数据（换引用后交出去的那份）`,
        ).toBe(data.value);

        if (entry.style) {
          const before = new Map(entry.style.expectCalls.map((spec) => [spec.call, nativeCallCount(spec.call)]));
          const styleStart = performance.now();
          style.value = entry.style.value;
          await settle();
          recorder.sample(`style.update.${entry.name}@${size}`, performance.now() - styleStart);
          expect(
            harness.nativeLayersCreated() - layersBefore,
            `${entry.name}@${size}：样式更新不得换实例`,
          ).toBe(1);
          // 逐 kind 的正证：样式真的走完了它那条 SDK 路径（不是「父级重新 render 了一下」）。
          for (const spec of entry.style.expectCalls) {
            const delta = nativeCallCount(spec.call) - (before.get(spec.call) ?? 0);
            expect(
              delta,
              `${entry.name}@${size}：样式更新必须触发 ${spec.call}（实际 delta=${delta}）`,
            ).toBeGreaterThanOrEqual(spec.min);
          }
          recorder.readout(
            `${entry.name}@${size}.styleCalls`,
            entry.style.expectCalls
              .map((spec) => `${spec.call}+${nativeCallCount(spec.call) - (before.get(spec.call) ?? 0)}`)
              .join(" "),
          );
        }

        const unmountStart = performance.now();
        wrapper.unmount();
        await settle();
        recorder.sample(`unmount.${entry.name}@${size}`, performance.now() - unmountStart);

        // 资源归零：四类图层的卸载路径都不许留残留（#36 交办的另一半）。
        harness.assertIdle(`${entry.name}@${size} 卸载后`);
      }

      recorder.readout(`volume.${entry.name}@${size}`, entry.volume(entry.data(size)));
      recorder.readout(
        `mount.${entry.name}@${size}.maxMs`,
        round(recorder.stat(`mount.${entry.name}@${size}`).max),
      );
      recorder.readout(
        `mount.${entry.name}@${size}.exceedsLongTask`,
        recorder.stat(`mount.${entry.name}@${size}`).max > LONG_TASK_MS ? "yes" : "no",
      );
    },
    120_000,
  );
});

/** 从 Fake 收到的 `setData()` 数据里数要素（顺带证明数据真的下发了）。 */
function readFeatures(data: unknown): number {
  const features = (data as { features?: unknown } | undefined)?.features;
  return Array.isArray(features) ? features.length : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
