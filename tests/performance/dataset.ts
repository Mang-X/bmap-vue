/**
 * 性能基准的固定数据集与规模格（M6-PERFORMANCE / issue #37）
 *
 * 基准的**唯一目的是回答「哪一步真的到了需要迁出主线程的量级」**，因此数据本身必须具备三条性质，
 * 少一条读数就没有意义：
 *
 * 1. **确定**（同一个 `DATASET_VERSION` + 同一个规模 ⇒ 逐项相同的数据）。用固定种子的
 *    `mulberry32`（不引入依赖，也不依赖 `Math.random()`），
 *    不用 `Math.random()`：否则「这次的 50k 比上次慢」分不清是数据变了还是代码变了，
 *    而本票的全部结论都建立在「同一份数据的前后对比」上。
 * 2. **有真实结构**。80% 的点聚在 32 个「城市」附近，20% 均匀散布：全均匀分布会让 fallback
 *    聚类退化成「一个点一个桶」，测出来的是「建 50k 个桶」的成本，不是聚类的成本。
 * 3. **与组件输入同形**：`Item[]` + `itemKey` + `getPosition`，即 `PointCollection` /
 *    `MarkerList` / `MarkerCluster` 真实消费的形状（不是为基准另造一种输入）。
 *
 * ## 它不是「未来 Worker 协议的消息格式」
 *
 * 本票的范围纠正明确禁止先定义通用协议再找消费者。这个模块只服务基准：**没有**序列化、
 * **没有** TypedArray、**没有** `postMessage` 形状。真要迁出主线程时，消息格式应当由**那一个**
 * 被证明有问题的 workload 决定（见 ADR `2026-09-21-performance-baseline-and-worker-decision`）。
 *
 * 数据规模格取 issue 指定的 `100 / 1k / 10k / 50k`：`100` 是「小数据不该有任何额外机制」的对照
 * （非目标第 3 条），`50k` 是 issue 认为可能压到主线程的上界。
 */

/** 数据集版本：**生成规则**一变就必须改它（否则基线比较的是两份不同的数据）。 */
export const DATASET_VERSION = "1";

/** 伪随机种子（写死，保证跨机器、跨运行时得到同一份数据）。 */
export const DATASET_SEED = 0x2f6e2b1;

/** 规模格（issue 指定）。 */
export const PERF_SIZES = [100, 1_000, 10_000, 50_000] as const;

export type PerfSize = (typeof PERF_SIZES)[number];

/** 「城市」个数与聚在它们附近的点占比（决定聚合类步骤的桶分布）。 */
export const DATASET_CITY_COUNT = 32;
export const DATASET_CLUSTERED_RATIO = 0.8;

/** 业务项形状：与 `PointCollection` 的 `data` 逐项同形。 */
export interface PerfItem {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  readonly name: string;
  readonly category: string;
  readonly value: number;
}

/** 与 `PerfItem` 配套的取值函数（组件 props 真实会用到的三个）。 */
export const PERF_ITEM_KEY = "id" as const;

export function perfItemPosition(item: PerfItem): { lng: number; lat: number } {
  return { lng: item.lng, lat: item.lat };
}

export function perfItemProperties(item: PerfItem): Record<string, unknown> {
  return { name: item.name, category: item.category, value: item.value };
}

/** mulberry32：小、快、确定（同一种子在任何运行时给出同一串数）。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = ["restaurant", "school", "hospital", "shop", "park"] as const;

/** 城市中心：由同一个种子推出来（所以「数据中心」本身也是确定的）。 */
function makeCityCenters(): Array<{ lng: number; lat: number }> {
  const next = mulberry32(DATASET_SEED);
  const centers: Array<{ lng: number; lat: number }> = [];
  for (let index = 0; index < DATASET_CITY_COUNT; index += 1) {
    centers.push({
      // 中国陆域大致范围：经度 100~120、纬度 25~42。
      lng: 100 + next() * 20,
      lat: 25 + next() * 17,
    });
  }
  return centers;
}

const CITY_CENTERS = makeCityCenters();

/**
 * 生成固定数据集的**前 `count` 项**。
 *
 * 前缀性质：`makeItems(1000)` 与 `makeItems(50_000).slice(0, 1000)` 逐项相同。
 * 于是不同规模之间的「每项成本」可以直接比较——那正是规模格存在的意义。
 */
export function makeItems(count: number): PerfItem[] {
  const next = mulberry32(DATASET_SEED ^ 0x5f3759df);
  const items: PerfItem[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    const clustered = next() < DATASET_CLUSTERED_RATIO;
    const center = CITY_CENTERS[Math.floor(next() * CITY_CENTERS.length)]!;
    // 聚类的抖动幅度（≈5km）远小于「城市间距」（≈ 1 度），因此聚合桶是真实存在的。
    const lng = clustered ? center.lng + (next() - 0.5) * 0.1 : 100 + next() * 20;
    const lat = clustered ? center.lat + (next() - 0.5) * 0.1 : 25 + next() * 17;
    items[index] = {
      id: `perf-${index}`,
      lng,
      lat,
      name: `poi-${index}`,
      category: CATEGORIES[Math.floor(next() * CATEGORIES.length)]!,
      value: Math.round(next() * 1000),
    };
  }
  return items;
}

/**
 * 同一批点的**位置平移**副本（经度整体 `+deltaLng`）：内容全变、`id` 不变。
 *
 * 用途是「换数据」场景（#140 官方对照的 1k Marker 位置更新、真实浏览器档的 `redraw`
 * 窗口）：它换的是**真的位置**而不是引用，因此一次 `setPosition` / `setData` 是有内容的
 * 写入——只换引用会让「更新场景」退化成「什么都没发生」（第 1 轮评审第 1、3 条）。
 */
export function makeMovedItems(
  items: readonly PerfItem[],
  deltaLng: number,
): readonly PerfItem[] {
  return items.map((item) => ({ ...item, lng: item.lng + deltaLng }));
}

/** 自持的 GeoJSON 线要素（**不** import SDK 类型包：基准不该依赖上游声明）。 */
export interface PerfLineFeature {
  readonly type: "Feature";
  readonly geometry: { readonly type: "LineString"; readonly coordinates: number[][] };
  readonly properties: Record<string, unknown>;
}

/**
 * 与 `makeItems` **同源**的线段集合（每个点是一条 2 点线）。
 *
 * 用途只是一个**对照**：原生图层组件的 `data` 直接吃 GeoJSON，主线程上没有任何逐要素工作；
 * 与逐项 `Item[]` 路径（要走适配层）比较，才能把「成本在适配层」这句话变成读数。
 */
export function makeLineFeatures(count: number): PerfLineFeature[] {
  const items = makeItems(count);
  return items.map((item, index) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [item.lng, item.lat],
        [item.lng + 0.001, item.lat + 0.001],
      ],
    },
    properties: { id: `line-${index}`, name: item.name },
  }));
}

/** 自持的 GeoJSON 点要素（热力图的输入形状）。 */
export interface PerfPointFeature {
  readonly type: "Feature";
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
  readonly properties: Record<string, unknown>;
}

/** 几何自持的要素集合（不 import SDK 类型包：基准不该依赖上游声明）。 */
export function featureCollection<Feature>(features: Feature[]): {
  readonly type: "FeatureCollection";
  readonly features: Feature[];
} {
  return { type: "FeatureCollection", features };
}

/**
 * 四类原生图层的输入夹具（`PointCollection` 之外的四个 kind；issue #37 评审 3 要求补齐
 * 「四类图层的 setData / style / resource 大数据路径」）。
 *
 * 形状照组件文档与既有用例：`LineLayer` / `FillLayer` 吃 `FeatureCollection`、`Heatmap` 吃点集合、
 * `TrackLine` 只接收**单条 `LineString` Feature**（见 `TrackLineLayerProps.data`）。
 * 三者都派生自同一份 `makeItems`，因此规模之间仍然前缀稳定、彼此可比。
 */
export function makePointFeatures(count: number): PerfPointFeature[] {
  return makeItems(count).map((item, index) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [item.lng, item.lat] as const },
    properties: { id: `point-${index}` },
  }));
}

/** 每个点一个 4 顶点小方块（`FillLayer` 的输入形状）。 */
export function makePolygonFeatures(count: number) {
  const delta = 0.0005;
  return makeItems(count).map((item, index) => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [item.lng - delta, item.lat - delta],
          [item.lng + delta, item.lat - delta],
          [item.lng + delta, item.lat + delta],
          [item.lng - delta, item.lat + delta],
          [item.lng - delta, item.lat - delta],
        ],
      ],
    },
    properties: { id: `area-${index}` },
  }));
}

/**
 * 单条 `LineString` 轨迹，顶点数 = `vertexCount`（`TrackLine` 的输入形状）。
 *
 * 它的「大数据」维度与集合类图层不同：不是**要素数**而是一条路径上的**顶点数** ——
 * 这正是 issue 里「路径预处理」那一类 workload 的真实形态（本库不做简化，只转发给 SDK）。
 */
export function makeTrackFeature(vertexCount: number) {
  return {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: makeItems(vertexCount).map((item) => [item.lng, item.lat]),
    },
    properties: { id: "track" },
  };
}

/** 数据集自述（进报告：没有它，两个不同数据集的读数会被并排比较）。 */
export function datasetDescription(): Record<string, unknown> {
  return {
    version: DATASET_VERSION,
    seed: DATASET_SEED,
    sizes: [...PERF_SIZES],
    cityCount: DATASET_CITY_COUNT,
    clusteredRatio: DATASET_CLUSTERED_RATIO,
  };
}
