/**
 * 网格聚合算法(纯函数,可单测)
 *
 * 像素网格聚合——按 zoom + project 将经纬度投影到像素坐标，
 * 以 gridSize 为网格边长聚合；低于 minClusterSize 的桶必须展开为单点，
 * 不得丢点；禁止固定 `lng * 10` 网格。
 */
import type { PointLike } from "../utils/geometry";

export interface Cluster<Item> {
  id: string;
  points: Item[];
  position: { lng: number; lat: number };
  size: number;
  /** 是否为聚合簇（size >= minClusterSize）；单点展开为 false */
  clustered?: boolean;
}

export interface ClusterOptions<Item = unknown> {
  /** 网格大小(像素),越大簇越粗 */
  gridSize?: number;
  /** 触发聚合的最小点数,小于该值保持独立 marker */
  minClusterSize?: number;
  /** 聚合时的地图 zoom（默认 12）；越大网格越细 */
  zoom?: number;
  /** 经纬度 → 像素投影；默认等距圆柱近似 */
  project?: (position: PointLike, zoom: number) => { x: number; y: number };
  /** 像素 → 经纬度逆投影；默认等距圆柱近似 */
  unproject?: (point: { x: number; y: number }, zoom: number) => PointLike;
  /** item 唯一键（用于稳定 id） */
  getKey?: (item: Item, index: number) => PropertyKey;
}

export type ClusterFeature<Item> =
  | { kind: "item"; id: string; item: Item; position: PointLike }
  | { kind: "cluster"; id: string; items: Item[]; position: PointLike; size: number };

export interface ClusterFeaturesOptions<Item> {
  zoom?: number;
  gridSize?: number;
  project?: (position: PointLike, zoom: number) => { x: number; y: number };
  unproject?: (point: { x: number; y: number }, zoom: number) => PointLike;
  getKey?: (item: Item, index: number) => PropertyKey;
  getPosition?: (item: Item) => PointLike;
  minClusterSize?: number;
}

function defaultProject(position: PointLike, zoom: number): { x: number; y: number } {
  const scale = 256 * Math.pow(2, zoom);
  return {
    x: ((position.lng + 180) / 360) * scale,
    y: ((90 - position.lat) / 180) * scale,
  };
}

function defaultUnproject(point: { x: number; y: number }, zoom: number): PointLike {
  const scale = 256 * Math.pow(2, zoom);
  return {
    lng: (point.x / scale) * 360 - 180,
    lat: 90 - (point.y / scale) * 180,
  };
}

/**
 * 像素网格聚合，返回 item/cluster 特征数组。
 * 低于 minClusterSize 的桶展开为单点特征，不丢点。
 */
export function cluster<Item>(
  items: readonly Item[],
  options: ClusterFeaturesOptions<Item> & { getPosition: (item: Item) => PointLike },
): ClusterFeature<Item>[] {
  const {
    zoom = 8,
    gridSize = 128,
    project = defaultProject,
    unproject = defaultUnproject,
    getKey = (_item: Item, index: number) => index,
    getPosition,
    minClusterSize = 3,
  } = options;

  const buckets = new Map<string, { items: Item[]; sumX: number; sumY: number }>();
  items.forEach((item, index) => {
    const pos = getPosition(item);
    const pixel = project(pos, zoom);
    const cellX = Math.floor(pixel.x / gridSize);
    const cellY = Math.floor(pixel.y / gridSize);
    const key = `${cellX}:${cellY}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { items: [], sumX: 0, sumY: 0 };
      buckets.set(key, bucket);
    }
    bucket.items.push(item);
    bucket.sumX += pixel.x;
    bucket.sumY += pixel.y;
    void index;
  });

  const features: ClusterFeature<Item>[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.items.length < minClusterSize) {
      // 低于阈值必须展开为单点
      bucket.items.forEach((item, i) => {
        features.push({
          kind: "item",
          id: String(getKey(item, i)),
          item,
          position: getPosition(item),
        });
      });
      continue;
    }
    const centroidPixel = {
      x: bucket.sumX / bucket.items.length,
      y: bucket.sumY / bucket.items.length,
    };
    features.push({
      kind: "cluster",
      id: `c-${key}`,
      items: bucket.items,
      position: unproject(centroidPixel, zoom),
      size: bucket.items.length,
    });
  }
  return features;
}

/**
 * 兼容签名：按经纬度集合做像素网格聚合，返回簇数组。
 * 低于阈值的桶展开为 size=1 的单点条目（clustered:false），不丢点。
 */
export function gridCluster<Item>(
  items: readonly Item[],
  getPosition: (item: Item) => PointLike,
  options: ClusterOptions<Item> = {},
): Cluster<Item>[] {
  const {
    gridSize = 128,
    minClusterSize = 3,
    zoom = 8,
    project = defaultProject,
    unproject = defaultUnproject,
    getKey = (_item: Item, index: number) => index,
  } = options;

  const buckets = new Map<string, { items: Item[]; sumX: number; sumY: number }>();
  items.forEach((item, index) => {
    const pos = getPosition(item);
    const pixel = project(pos, zoom);
    const cellX = Math.floor(pixel.x / gridSize);
    const cellY = Math.floor(pixel.y / gridSize);
    const key = `${cellX}:${cellY}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { items: [], sumX: 0, sumY: 0 };
      buckets.set(key, bucket);
    }
    bucket.items.push(item);
    bucket.sumX += pixel.x;
    bucket.sumY += pixel.y;
    void index;
  });

  const clusters: Cluster<Item>[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.items.length < minClusterSize) {
      // 低于阈值：展开为单点条目
      bucket.items.forEach((item, i) => {
        const pos = getPosition(item);
        clusters.push({
          id: String(getKey(item, i)),
          points: [item],
          position: { lng: pos.lng, lat: pos.lat },
          size: 1,
          clustered: false,
        });
      });
      continue;
    }
    const centroidPixel = {
      x: bucket.sumX / bucket.items.length,
      y: bucket.sumY / bucket.items.length,
    };
    const centroid = unproject(centroidPixel, zoom);
    clusters.push({
      id: `c-${key}`,
      points: bucket.items,
      position: { lng: centroid.lng, lat: centroid.lat },
      size: bucket.items.length,
      clustered: true,
    });
  }
  return clusters;
}
