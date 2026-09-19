import { describe, it, expect } from "vitest";
import { gridCluster, type PointLike } from "./gridCluster";

const pts: PointLike[] = [
  { lng: 116.4, lat: 39.9 },
  { lng: 116.41, lat: 39.91 },
  { lng: 116.42, lat: 39.92 },
  { lng: 121.5, lat: 31.2 },
];

describe("gridCluster", () => {
  it("groups nearby points into a cluster", () => {
    const items = pts.map((p, i) => ({ id: i, pos: p }));
    const clusters = gridCluster(items, (i) => i.pos, { minClusterSize: 3 });
    // 北京 3 点聚合为 1 个簇,上海 1 点单独
    expect(clusters).toHaveLength(2);
    const beijing = clusters.find((c) => c.size >= 3);
    expect(beijing?.points).toHaveLength(3);
  });

  it("does not mark small groups as clusters (they stay individual markers)", () => {
    const items = pts.map((p, i) => ({ id: i, pos: p }));
    const clusters = gridCluster(items, (i) => i.pos, { minClusterSize: 10 });
    // 阈值过高,北京 3 点所在网格不被标记为簇(size<10),但仍按网格产出 2 个视觉标记
    const beijing = clusters.find((c) => c.size >= 1);
    expect(clusters.length).toBeGreaterThan(1);
    // 没有标记为聚合簇(size 最大 < 10)
    expect(Math.max(...clusters.map((c) => c.size))).toBeLessThan(10);
  });

  it("低于阈值的桶**展开为独立条目**，点数守恒（不丢点）", () => {
    const items = pts.map((p, i) => ({ id: i, pos: p }));
    const clusters = gridCluster(items, (i) => i.pos, { minClusterSize: 10 });
    // 阈值远高于每桶点数 ⇒ 全部展开；每个条目恰好 1 个点，且**每个输入点都还在**
    expect(clusters.every((entry) => entry.clustered !== true && entry.points.length === 1)).toBe(true);
    expect(
      clusters.flatMap((entry) => entry.points.map((item) => item.id)).sort((a, b) => a - b),
      "输入 4 个点就必须输出 4 个点（旧实现曾用「桶内下标」当 id，两个桶的单点会撞成同一个）",
    ).toEqual(items.map((item) => item.id));
  });

  it("computes centroid position", () => {
    const items = pts.map((p, i) => ({ id: i, pos: p }));
    const clusters = gridCluster(items, (i) => i.pos, { minClusterSize: 3 });
    const beijing = clusters.find((c) => c.size >= 3)!;
    expect(beijing.position.lng).toBeCloseTo(116.41, 2);
    expect(beijing.position.lat).toBeCloseTo(39.91, 2);
  });
});
