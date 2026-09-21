/**
 * 预处理步骤的基准（M6-PERFORMANCE / issue #37，阶段 A）
 *
 * 这个文件回答「**主线程上的预处理到底要花多少时间**」，逐条对应 issue 的步骤清单：
 *
 * | issue 列出的步骤 | 本库的真实对应 | 处置 |
 * | --- | --- | --- |
 * | GeoJSON 解析 | `core/data/geojsonAdapter.adaptPoints`（`Item[]` → `FeatureCollection`） | 测 |
 * | 过滤 | `core/data/itemScan.scanValidItems`（坏数据跳过 + 重复 key 处置） | 测 |
 * | 聚类 | `core/data/gridCluster.cluster`（fallback 像素网格聚合） | 测 |
 * | 路径简化 | **本库没有这个能力**（也没有消费者） | 不测，如实登记（不为凑清单先造一个） |
 * | SDK `setData` / 重绘本身 | 组件路径，见 `component-path.perf.test.ts`；**真实重绘不在本套读数内** | 测「我们下发的那部分」 |
 *
 * ## 判据的口径（为什么门禁写得这么松）
 *
 * issue 的风险条目写得很清楚：「硬门禁使用宽容相对阈值，精细回归由定期基准审查」，非目标第 2 条
 * 禁止把单次本机数字当跨平台硬阈值。因此这里有**两类**判据：
 *
 * 1. **机器无关的比值**（超线性、每项成本的量级）——这是真正的门禁，在任何机器上都成立；
 * 2. **极宽的绝对上界**（`PATHOLOGICAL_CEILING_MS`）——只抓「量级上的病态回归」（比如某次改动让
 *    50k 从 30ms 变成 3s），不承担精细回归的职责。
 *
 * 「是否越过浏览器 50ms 长任务线」**只作为读数**（`*.exceedsLongTask`）进报告：它是本票结论的
 * 依据，但依赖机器速度，拿它当门禁会在慢 CI 上假红。
 */
import { afterAll, describe, expect, it } from "vitest";
import { adaptPoints } from "../../packages/baidu-map-gl-vue/src/core/data/geojsonAdapter";
import { itemKeyReader, scanValidItems } from "../../packages/baidu-map-gl-vue/src/core/data/itemScan";
import { cluster } from "../../packages/baidu-map-gl-vue/src/core/data/gridCluster";
import { readValidPoint } from "../../packages/baidu-map-gl-vue/src/core/data/points";
import {
  DATASET_VERSION,
  PERF_ITEM_KEY,
  PERF_SIZES,
  datasetDescription,
  makeItems,
  perfItemPosition,
  perfItemProperties,
  type PerfItem,
  type PerfSize,
} from "./dataset";
import { createPerfRecorder } from "./metrics";

const recorder = createPerfRecorder({ file: "preprocess", dataset: datasetDescription() });

/**
 * 报告末尾的「本套测不到」清单。
 *
 * 放在**模块级**（而不是写成一条「至少有 N 条」的用例）：它是报告内容，脚本会原样打印；
 * 写成用例会让那条断言变成自证——清单本身就是同一段代码 push 的。
 */
recorder.notMeasured(
  "真实 SDK 的 setData 之后的渲染 / 重绘成本：本套的 SDK 是 Fake（只记账），且无真实浏览器布局与合成",
);
recorder.notMeasured(
  "浏览器 Long Task API 的观测（PerformanceObserver）与帧率：happy-dom 没有调度器，只测单次同步耗时",
);
recorder.notMeasured("跨浏览器 / 跨平台差异：只有本机一个运行时（报告里记录了机器与运行时版本）");

/**
 * 超线性容差：**每项成本**（`cost / 项数 / 本规模校准量`）从 1k 到 50k 允许涨的倍数。
 *
 * 取 12 的依据：大数组的每项成本本来就比小数组高（缓存不友好 + GC 压力），安静档实测 `adaptPoints`
 * 是 2.8 倍，本机极高负载（load 260）下实测到 5.4 倍 —— 12 在这之上还留了一倍余量；
 * 而 O(n²) 会让每项成本随规模线性上升（50k/1k 是 50 倍），与容差上限仍差 4 倍以上。
 * 也就是说这条门禁抓的是「结构性超线性」，不用它承担精细回归（那是 `pnpm perf:baseline` 趋势对比的活）。
 *
 * 用**每项成本**而不是总耗时比，并且除掉**同规模的**校准量：这样「50k 与 1k 是在不同负载时刻
 * 被测的」这件事不会污染结论（实测极载时总耗时比会从 2.8× 漂到 8× 以上。
 */
const SLOPE_TOLERANCE = 12;

/** 量级上的病态上界：超过它就一定出了结构性问题，而不是「这台机器慢」。 */
const PATHOLOGICAL_CEILING_MS = 500;

/** 浏览器长任务的判定线（**只进读数与结论**，不当门禁）。 */
const LONG_TASK_MS = 50;

/** 采样次数：`100` 这类小规模要多跑几次才有意义，大规模少跑（每次都是几十毫秒）。 */
const samplesFor = (size: PerfSize): number => (size >= 10_000 ? 5 : 20);

/** 全部规模的数据一次生成（避免把「造数据」的成本算进被测步骤）。 */
const ITEMS = new Map<PerfSize, PerfItem[]>(PERF_SIZES.map((size) => [size, makeItems(size)]));

/**
 * 校准工作量（机器速度的粗归一）。
 *
 * 它存在的唯一理由：提交的基线要跨机器比较，而绝对毫秒不可比。用它做分母得到「归一成本」后，
 * 趋势门禁才可能在 CI 与开发机上给出同一个结论。**它不是被测对象**，也不代表任何真实 workload
 * （粗细差一个数量级是预期的，见 ADR 的口径说明）。
 */
function calibrationWorkload(): number {
  let acc = 1;
  for (let i = 1; i <= 2_000_000; i += 1) {
    acc = (acc * 1.0000001 + Math.sqrt(i)) % 1e9;
  }
  return acc;
}

function scanStep(items: PerfItem[]): number {
  return scanValidItems(items, {
    getKey: itemKeyReader(PERF_ITEM_KEY),
    getPosition: perfItemPosition,
  }).length;
}

function adaptStep(items: PerfItem[]) {
  return adaptPoints(items, {
    itemKey: PERF_ITEM_KEY,
    getPosition: perfItemPosition,
    properties: perfItemProperties,
  });
}

function clusterStep(items: PerfItem[]) {
  return cluster(items, { getPosition: perfItemPosition, zoom: 8, gridSize: 128, minClusterSize: 3 });
}

afterAll(() => {
  recorder.flush();
});

describe("§1 预处理步骤的规模曲线（100 / 1k / 10k / 50k）", () => {
  it("校准工作量可重复（趋势门禁的分母；它自己也必须有读数）", () => {
    recorder.time("calibration.cpu", calibrationWorkload, { samples: 3, warmup: 1 });
    recorder.readout("dataset.version", DATASET_VERSION);
    expect(recorder.stat("calibration.cpu").min).toBeGreaterThan(0);
  });

  it("数据集是**前缀稳定**的（跨规模比较「每项成本」的前提）", () => {
    // 没有这条性质，`cost(50k) / cost(1k)` 比的就不只是规模，还包括两份不同的数据。
    const small = makeItems(1000);
    const large = makeItems(10_000);
    expect(large.slice(0, small.length)).toEqual(small);
    expect(large.length, "大的一份真的更大").toBeGreaterThan(small.length);
  });

  it.each(PERF_SIZES.map((size) => [String(size), size] as const))(
    "规模 %s：三个步骤各采样一次耗时，并留下可解释的读数",
    (_label, size) => {
      const items = ITEMS.get(size)!;
      const samples = samplesFor(size);

      // **本规模的校准量**：紧挨着被测步骤测一次同规模的校准工作量，用它归一之后，
      // 规模之间的比较不再受「两个规模被测的时刻负载不同」影响（实测负载 260 时，不做这一步
      // 会让 `50k / 1k` 的比值从 2.8× 漂到 8× 以上，门禁偶发假红）。
      recorder.time(`calibration.local@${size}`, calibrationWorkload, { samples: 2, warmup: 0 });

      const scanned = recorder.time(`scanValidItems@${size}`, () => scanStep(items), {
        samples,
        warmup: 1,
      });
      const adapted = recorder.time(`adaptPoints@${size}`, () => adaptStep(items), {
        samples,
        warmup: 1,
      });
      const clustered = recorder.time(`cluster@${size}`, () => clusterStep(items), {
        samples,
        warmup: 1,
      });

      // 读数（不是判据）：结果规模——没有它，耗时数字无法解释（桶多桶少差别很大）。
      recorder.readout(`scanValidItems@${size}.kept`, scanned);
      recorder.readout(`adaptPoints@${size}.features`, adapted.data.features.length);
      recorder.readout(`adaptPoints@${size}.problems`, adapted.problems.length);
      recorder.readout(`cluster@${size}.features`, clustered.length);
      recorder.readout(
        `cluster@${size}.clusters`,
        clustered.filter((feature) => feature.kind === "cluster").length,
      );
      recorder.readout(
        `cluster@${size}.singles`,
        clustered.filter((feature) => feature.kind === "item").length,
      );

      // 正证守卫：读数不能被「数据是空的」满足。
      expect(adapted.data.features.length, "适配后必须有要素").toBe(size);
      expect(clustered.length, "聚合后必须有结果").toBeGreaterThan(0);
      expect(adapted.problems, "这份数据集不含坏数据（坏数据另有 §3）").toEqual([]);
    },
  );
});

describe("§2 规模曲线判据（机器无关）", () => {
  /** 三个步骤的共同形状：规模比 50×，耗时比不得超过 50×tolerance。 */
  const STEPS = ["scanValidItems", "adaptPoints", "cluster"] as const;

  /** 每项成本（毫秒/项 × 本规模校准量）：`undefined` 表示读数缺失。 */
  const perItemCost = (step: string, size: PerfSize): number => {
    const calibration = recorder.stat(`calibration.local@${size}`).min;
    return recorder.stat(`${step}@${size}`).min / (calibration * size);
  };

  it.each(STEPS)("%s：每项成本不随规模显著上升（超线性判据）", (step) => {
    const small = perItemCost(step, 1000);
    const large = perItemCost(step, 50_000);
    // 正证守卫：小规模那一段不能是 0，否则比值恒真（门禁空转）。
    expect(small, `${step}@1000 的读数必须 > 0`).toBeGreaterThan(0);
    recorder.readout(`${step}@1000.perItemNormalized`, round(small * 1e6, 4));
    recorder.readout(`${step}@50000.perItemNormalized`, round(large * 1e6, 4));
    expect(
      large / small,
      `${step}：50k 的每项成本是 1k 的 ${(large / small).toFixed(2)} 倍（容差 ${SLOPE_TOLERANCE}×）`,
    ).toBeLessThanOrEqual(SLOPE_TOLERANCE);
  });

  it.each(STEPS)("%s：50k 的耗时量级正常（病态上界，用 median 判定）", (step) => {
    const stat = recorder.stat(`${step}@50000`);
    recorder.readout(`${step}@50000.maxMs`, round(stat.max));
    recorder.readout(`${step}@50000.exceedsLongTask`, stat.max > LONG_TASK_MS ? "yes" : "no");
    // 判据用 **median**：`max` 是「单次最长阻塞」，它天然会被进程被抢占 / GC 停顿污染
    // （本机在极高负载下实测到过 2.2s 的单次采样，而同一轮 median 只有 197ms）。
    // 「量级上的病态」问的是形状，不是某一次调度；`max` 因此只作读数。
    expect(stat.median, `${step}@50k median ${stat.median.toFixed(1)}ms`).toBeLessThan(PATHOLOGICAL_CEILING_MS);
  });

  it("小数据（100）的 adaptPoints 不出现「固定开销压过规模」的病态", () => {
    // 非目标第 3 条说小数据不该有额外机制；这里给出可观察的形式：100 项的**每项成本**不得超过
    // 50k 的每项成本的 5 倍（固定开销允许存在，只要求量级一致）。
    const perItemSmall = recorder.stat("adaptPoints@100").min / 100;
    const perItemLarge = recorder.stat("adaptPoints@50000").min / 50_000;
    recorder.readout("adaptPoints@100.perItemMicros", round(perItemSmall * 1_000));
    recorder.readout("adaptPoints@50000.perItemMicros", round(perItemLarge * 1_000));
    expect(perItemLarge).toBeGreaterThan(0);
    expect(perItemSmall / perItemLarge).toBeLessThanOrEqual(5);
  });
});

describe("§3 坏数据不改变规模行为（正证：过滤真的在做过滤）", () => {
  it("掺入坏数据后仍然线性，且坏数据全部被报告", () => {
    const good = makeItems(10_000);
    const mixed: PerfItem[] = [...good];
    // 每 100 项塞一个坏坐标（`NaN` 会走 `readValidPoint` 的 not-finite 分支）。
    for (let i = 0; i < 100; i += 1) {
      mixed[Math.floor(mixed.length / 200) + i * 100] = { ...good[i]!, lng: Number.NaN };
    }

    const kept = recorder.time("scanValidItems@10k-with-bad", () => scanStep(mixed), {
      samples: 5,
      warmup: 1,
    });
    const stat = recorder.stat("scanValidItems@10k-with-bad");
    recorder.readout("scanValidItems@10k-with-bad.kept", kept);
    recorder.readout("scanValidItems@10k-with-bad.dropped", mixed.length - kept);
    recorder.readout("scanValidItems@10k-with-bad.maxMs", round(stat.max));

    expect(kept, "坏数据必须被跳过").toBeLessThan(mixed.length);
    expect(kept, "只有塞进去的那些被跳过").toBe(mixed.length - 100);
    expect(readValidPoint({ lng: Number.NaN, lat: 0 }).ok, "NaN 的判定必须是 not-ok").toBe(false);
  });
});

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
