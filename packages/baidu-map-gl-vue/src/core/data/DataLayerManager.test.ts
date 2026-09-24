import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataLayerManager, type DataLayerHost, type DataLayerSync } from "./DataLayerManager";
import type { ItemProblem } from "./itemScan";

interface Item {
  id: string;
  lng: number;
  lat: number;
}

function makeHost() {
  const createMarker = vi.fn((item: Item, point: { lng: number; lat: number }) => ({
    id: item.id,
    position: { ...point },
  }));
  const removeMarker = vi.fn();
  const updatePosition = vi.fn();
  const setVisible = vi.fn(() => true);
  const host: DataLayerHost<Item, { id: string; position: { lng: number; lat: number } }> = {
    createMarker,
    removeMarker,
    updatePosition,
    setVisible,
  };
  return { host, createMarker, removeMarker, updatePosition, setVisible };
}

const items: Item[] = [
  { id: "a", lng: 1, lat: 1 },
  { id: "b", lng: 2, lat: 2 },
  { id: "c", lng: 3, lat: 3 },
];

/** 便捷输入：`id` 字段当 key，`lng/lat` 当坐标。 */
function syncOf(list: readonly Item[], version?: PropertyKey): DataLayerSync<Item> {
  return {
    items: list,
    getKey: (item) => item.id,
    getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
    version,
  };
}

describe("DataLayerManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("首次同步为每一项创建资源，并把**已校验的坐标**交给宿主", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(3);
    expect(createMarker).toHaveBeenCalledWith(items[0], { lng: 1, lat: 1 });
    expect(m.size).toBe(3);
    m.dispose();
  });

  it("第二次同步做 keyed diff：新增 / 删除 / 位置更新互不干扰", () => {
    const { host, createMarker, removeMarker, updatePosition } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    vi.clearAllMocks();

    m.sync(
      syncOf([
        // 新对象、**坐标也变了** ⇒ 真正的「更新」
        { id: "a", lng: 9, lat: 9 },
        { id: "d", lng: 4, lat: 4 }, // 新增
      ]),
    );
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(1);
    expect(removeMarker).toHaveBeenCalledTimes(2); // b / c
    expect(updatePosition.mock.calls.map((call) => call[1]), "只有 a 的坐标变了").toEqual([
      { lng: 9, lat: 9 },
    ]);
    expect(m.size).toBe(2);
    m.dispose();
  });

  it("同一引用 + 同一版本 ⇒ 零 SDK 调用（父级重复渲染不付代价）", () => {
    const { host, createMarker, removeMarker, updatePosition } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items, "v1"));
    m.flush();
    vi.clearAllMocks();

    // 同一个数组引用、同一个版本（父级重新渲染但数据没变）
    for (let i = 0; i < 5; i += 1) {
      m.sync(syncOf(items, "v1"));
      m.flush();
    }
    expect(createMarker).not.toHaveBeenCalled();
    expect(removeMarker).not.toHaveBeenCalled();
    expect(updatePosition).not.toHaveBeenCalled();
    m.dispose();
  });

  it("版本变化 + 同一引用 ⇒ 重新下发坐标（dataVersion 的语义就是「内容变了」）", () => {
    const { host, updatePosition } = makeHost();
    const list: Item[] = [
      { id: "a", lng: 1, lat: 1 },
      { id: "b", lng: 2, lat: 2 },
    ];
    const m = new DataLayerManager(host);
    m.sync(syncOf(list, "v1"));
    m.flush();
    vi.clearAllMocks();

    // 原地改内容（引用不变），调用方递增 version 表态「内容变了」
    list[0]!.lng = 116;
    m.sync(syncOf(list, "v2"));
    m.flush();
    expect(updatePosition.mock.calls.map((c) => c[1])).toEqual([
      { lng: 116, lat: 1 },
      { lng: 2, lat: 2 },
    ]);
    m.dispose();
  });

  it("缺 key / 非法坐标 ⇒ 跳过该项并报告（不创建任何资源）", () => {
    const problems: ItemProblem[] = [];
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host, { label: "BMarkerList", onProblem: (p) => problems.push(p) });
    m.sync(
      syncOf([
        items[0]!,
        { id: "", lng: 2, lat: 2 },
        { id: "nan", lng: Number.NaN, lat: 2 },
        { id: "far", lng: 730, lat: 2 },
      ]),
    );
    m.flush();
    // 空字符串是合法 PropertyKey（不发明「空白算缺失」的规则）⇒ 4 项里 2 项可用
    expect(createMarker).toHaveBeenCalledTimes(2);
    expect(problems.map((p) => [p.kind, p.index, p.key])).toEqual([
      ["invalid-position", 2, "nan"],
      ["invalid-position", 3, "far"],
    ]);
    expect(m.size).toBe(2);
    m.dispose();
  });

  it("重复 key：后者胜，只创建一个资源，且报告重复", () => {
    const problems: ItemProblem[] = [];
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host, { onProblem: (p) => problems.push(p) });
    m.sync(
      syncOf([
        { id: "a", lng: 1, lat: 1 },
        { id: "a", lng: 9, lat: 9 },
      ]),
    );
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(1);
    expect(createMarker).toHaveBeenCalledWith({ id: "a", lng: 9, lat: 9 }, { lng: 9, lat: 9 });
    expect(problems.map((p) => p.kind)).toEqual(["duplicate-key"]);
    m.dispose();
  });

  it("latest / latestOf 返回**最新**业务对象（数据换引用后跟着换）", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    const first: Item[] = [{ id: "a", lng: 1, lat: 1 }];
    m.sync(syncOf(first));
    m.flush();
    const resource = createMarker.mock.results[0]!.value;
    expect(m.latest("a")).toBe(first[0]);
    expect(m.latestOf(resource)).toBe(first[0]);

    const second: Item[] = [{ id: "a", lng: 1, lat: 1 }];
    m.sync(syncOf(second));
    m.flush();
    // 同一个资源、新业务对象 ⇒ 事件路径拿到的必须是最新的那个
    expect(m.latestOf(resource)).toBe(second[0]);
    expect(m.latestOf(resource)).not.toBe(first[0]);
    m.dispose();
  });

  it("latest 对已从数据里删除的 key 返回 undefined（不留幽灵项）", () => {
    const { host } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    m.sync(syncOf([items[0]!]));
    m.flush();
    expect(m.latest("b")).toBeUndefined();
    expect(m.latest("a")).toBe(items[0]);
    m.dispose();
  });

  it("setVisible(false) 全员隐藏，之后新建的资源也隐藏；true 再显示回来", () => {
    const { host, createMarker, setVisible } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    vi.clearAllMocks();

    m.setVisible(false);
    expect(setVisible).toHaveBeenCalledTimes(3);
    expect(setVisible).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), false);

    // 隐藏期间新来的点也必须隐藏（否则它会「亮」着出现在图上）
    m.sync(syncOf([...items, { id: "d", lng: 4, lat: 4 }]));
    m.flush();
    expect(setVisible).toHaveBeenCalledWith(expect.objectContaining({ id: "d" }), false);
    expect(createMarker).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    m.setVisible(true);
    expect(setVisible).toHaveBeenCalledTimes(4);
    expect(setVisible.mock.calls.every((c) => c[1] === true)).toBe(true);
    m.dispose();
  });

  it("同值的 setVisible 不重复下发（幂等）", () => {
    const { host, setVisible } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    vi.clearAllMocks();
    m.setVisible(false);
    m.setVisible(false);
    expect(setVisible).toHaveBeenCalledTimes(3);
    m.dispose();
  });

  it("宿主没有 setVisible 能力时只告警一次，不假装成功", () => {
    const warn = vi.fn();
    const { createMarker, removeMarker, updatePosition } = makeHost();
    const m = new DataLayerManager(
      { createMarker, removeMarker, updatePosition },
      { label: "BMarkerList", warn },
    );
    m.sync(syncOf(items));
    m.flush();
    m.setVisible(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("不支持显隐");
    m.setVisible(true);
    m.setVisible(false);
    expect(warn).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  it("clear() 复位账本与短路基线：下一次 sync 会重建", () => {
    const { host, createMarker, removeMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    m.clear();
    expect(removeMarker).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(0);
    expect(m.latest("a")).toBeUndefined();

    vi.clearAllMocks();
    m.sync(syncOf(items));
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(3);
    m.dispose();
  });

  it("dispose() 幂等：重复调用不重复摘除资源", () => {
    const { host, removeMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf(items));
    m.flush();
    m.dispose();
    m.dispose();
    expect(removeMarker).toHaveBeenCalledTimes(3);
  });

  it("dispose() 之后 sync 不再产生副作用（scheduler 已释放）", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.dispose();
    m.sync(syncOf(items));
    m.flush();
    expect(createMarker).not.toHaveBeenCalled();
  });

  it("合帧：同一帧内多次 sync 只执行最后一次输入", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(syncOf([items[0]!]));
    m.sync(syncOf([items[0]!, items[1]!]));
    m.sync(syncOf(items));
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(3);
    m.dispose();
  });
});

describe("DataLayerManager 的失败隔离（SDK 调用抛错时不许把整轮 diff 带走）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("某一条摘除失败 ⇒ 其余项照常摘除，失败项保留所有权", () => {
    const warn = vi.fn();
    const { host, removeMarker, createMarker } = makeHost();
    removeMarker.mockImplementation((resource: { id: string }) => {
      if (resource.id === "b") throw new Error("removeLayer failed");
    });
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();

    m.sync(syncOf([{ id: "d", lng: 4, lat: 4 }]));
    m.flush();
    // b 摘除失败，其余两个照常摘掉
    expect(removeMarker).toHaveBeenCalledTimes(3);
    // b 摘除失败 ⇒ 仍留在账本里（所有权没丢）+ 新来的 d = 2
    expect(m.size, "失败的那一条仍留在账本里（所有权没丢）").toBe(2);
    // 失败项仍然可以被重试：销毁时会再摘一次
    removeMarker.mockImplementation(() => {});
    m.dispose();
    expect(removeMarker.mock.calls.map((call) => (call[0] as { id: string }).id)).toContain("b");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("摘除资源失败"));
    void createMarker;
  });

  it("某一条创建失败 ⇒ 其余项照常创建，失败项下次同步重试", () => {
    const warn = vi.fn();
    const { host, createMarker } = makeHost();
    createMarker.mockImplementation((item: Item) => {
      if (item.id === "b") throw new Error("create failed");
      return { id: item.id, position: { lng: item.lng, lat: item.lat } };
    });
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();
    expect(m.size, "失败项不进账本").toBe(2);

    // 下一次同步（换引用）会重试失败的那一项
    createMarker.mockImplementation((item: Item) => ({ id: item.id, position: { lng: item.lng, lat: item.lat } }));
    m.sync(syncOf([...items]));
    m.flush();
    expect(m.size).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("创建资源失败"));
    m.dispose();
  });

  it("位置更新失败不影响同一次同步里的其它项，且下次同步会重试", () => {
    const warn = vi.fn();
    const { host, updatePosition } = makeHost();
    updatePosition.mockImplementation(() => {
      throw new Error("setPosition failed");
    });
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();
    vi.clearAllMocks();

    // 每一项的坐标都真的变了 ⇒ 每一项都要下发位置（位置由**值**决定，不再由 item 引用决定）
    m.sync(syncOf(items.map((item) => ({ ...item, lng: item.lng + 10 }))));
    m.flush();
    expect(updatePosition, "每一项都试过了（不是第一项失败就中断）").toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);
    m.dispose();
  });
});

/* ------------------------------------------------------------------ 评审（PR #102）的四条语义修正
 *
 * 每条都先写成**会红**的复现（评审给的最小场景原样搬到用例里），再改实现。
 * 命名带上 `[#102 Fn]` 便于回看「这条用例是为哪条评审意见存在的」。
 */

describe("DataLayerManager：根引用变化必须重新读取位置 [#102 F1]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("换新数组 + 复用同一个 item 对象（原地改坐标）⇒ 必须重新下发位置", () => {
    const { host, updatePosition } = makeHost();
    const m = new DataLayerManager(host);
    const item: Item = { id: "a", lng: 1, lat: 1 };
    m.sync(syncOf([item]));
    m.flush();
    vi.clearAllMocks();

    // 评审的最小场景：`item.lng = 2; data.value = [item]`
    item.lng = 2;
    m.sync(syncOf([item]));
    m.flush();
    expect(
      updatePosition.mock.calls.map((call) => call[1]),
      "根引用变了就该重新读取（公开契约只说「根引用不变」时需要 dataVersion）",
    ).toEqual([{ lng: 2, lat: 1 }]);
    m.dispose();
  });

  it("换新数组但坐标确实没变 ⇒ 不产生多余的位置下发", () => {
    const { host, updatePosition } = makeHost();
    const m = new DataLayerManager(host);
    const item: Item = { id: "a", lng: 1, lat: 1 };
    m.sync(syncOf([item]));
    m.flush();
    vi.clearAllMocks();

    m.sync(syncOf([{ ...item }]));
    m.flush();
    expect(updatePosition, "值没变就不写（按位置指纹，不按 item 引用）").not.toHaveBeenCalled();
    m.dispose();
  });
});

describe("DataLayerManager：失败的更新必须能重试 [#102 F2]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updatePosition 抛错之后，用**同一批输入**再 sync 必须重试（不被短路吞掉）", () => {
    const warn = vi.fn();
    const { host, updatePosition } = makeHost();
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    const item: Item = { id: "a", lng: 1, lat: 1 };
    m.sync(syncOf([item]));
    m.flush();

    // 第一次：原地改坐标 ⇒ 位置下发失败
    updatePosition.mockImplementationOnce(() => {
      throw new Error("setPosition failed");
    });
    item.lng = 2;
    m.sync(syncOf([item]));
    m.flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("更新位置失败"));

    // 第二次：**完全相同的输入**（同一数组引用、同一 version）也必须重试
    vi.clearAllMocks();
    m.sync(syncOf([item]));
    m.flush();
    expect(updatePosition.mock.calls.map((call) => call[1]), "失败的那一项必须重试").toEqual([
      { lng: 2, lat: 1 },
    ]);
    m.dispose();
  });

  it("创建失败之后，同一批输入再 sync 必须重试创建", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    createMarker.mockImplementationOnce(() => {
      throw new Error("create failed");
    });
    const items2: Item[] = [{ id: "a", lng: 1, lat: 1 }];
    m.sync(syncOf(items2));
    m.flush();
    expect(m.size).toBe(0);

    m.sync(syncOf(items2));
    m.flush();
    expect(m.size, "同一批输入也要能补建").toBe(1);
    m.dispose();
  });
});

describe("DataLayerManager：clear() 失败不得丢失所有权 [#102 F3]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("某一条 removeMarker 失败 ⇒ 保留所有权；之后 sync 不得为同一 key 重复创建", () => {
    const warn = vi.fn();
    const { host, removeMarker, createMarker } = makeHost();
    removeMarker.mockImplementation((resource: { id: string }) => {
      if (resource.id === "b") throw new Error("remove failed");
    });
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();

    m.clear();
    expect(m.size, "失败的那一条仍被持有（与 diff 删除路径同一条原则）").toBe(1);

    // 再同步同一批数据：b 仍在账本里 ⇒ 不得为它再建一个资源（否则图上会出现两份/泄漏）
    createMarker.mockClear();
    removeMarker.mockImplementation(() => {});
    m.sync(syncOf(items));
    m.flush();
    expect(createMarker.mock.calls.map((call) => (call[0] as Item).id), "只补建 a / c").toEqual(["a", "c"]);
    expect(m.size).toBe(3);
    m.dispose();
  });
});

/* ------------------------------------------------------------------ #113：失败恢复的直接读数
 *
 * 断言口径只取「最终资源归属 / 宿主可观察调用 / 可重试行为 / 告警出口」——不读
 * `unknownKeys` 身份、分支数量或状态结构（issue #113 的执行约束）。`unknownSize`
 * 是公开诊断读数，与 `size` 一起回答「归属是否收敛」。
 */

describe("DataLayerManager：remove 抛错后的 unknown 与恢复 [#113]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("remove 抛错 ⇒ 该 key 进入 unknown：保留所有权、告警、后续 updatePosition/setVisible 都不碰它", () => {
    const warn = vi.fn();
    const { host, removeMarker, updatePosition, setVisible } = makeHost();
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();

    // b 摘除失败（摘之前抛：可能仍在图上）
    removeMarker.mockImplementation((resource: { id: string }) => {
      if (resource.id === "b") throw new Error("removeLayer failed");
    });
    m.sync(syncOf([{ id: "a", lng: 1, lat: 1 }]));
    m.flush();
    expect(warn, "失败必须可观测").toHaveBeenCalledWith(expect.stringContaining("摘除资源失败"));
    expect(m.unknownSize, "b 的挂载态未知").toBe(1);
    expect(m.size, "所有权保留：a + 未确认的 b").toBe(2);

    // b 回到数据里（换新对象、坐标变了）——unknown 不吃 updatePosition
    vi.clearAllMocks();
    m.sync(
      syncOf([
        { id: "a", lng: 10, lat: 10 },
        { id: "b", lng: 20, lat: 20 },
      ]),
    );
    m.flush();
    expect(
      updatePosition.mock.calls.map((call) => (call[0] as { id: string }).id),
      "已知的 a 仍写；unknown 的 b 一个字都不写",
    ).toEqual(["a"]);
    expect(m.unknownSize, "没有收敛动作时 unknown 持续").toBe(1);

    // unknown 不吃 setVisible，且**不计入失败**（不抛、不把调用方推进到「永远重试」）
    expect(() => m.setVisible(false)).not.toThrow();
    expect(
      setVisible.mock.calls.map((call) => (call[0] as { id: string }).id),
      "只有已知资源收到显隐",
    ).toEqual(["a"]);
    expect(m.unknownSize).toBe(1);
    m.dispose();
  });

  it("再次摘除成功 ⇒ 销账：unknownSize 归零、所有权与显隐恢复确定状态", () => {
    const warn = vi.fn();
    const { host, removeMarker, updatePosition } = makeHost();
    const m = new DataLayerManager(host, { label: "BMarkerList", warn });
    m.sync(syncOf(items));
    m.flush();

    removeMarker.mockImplementation((resource: { id: string }) => {
      if (resource.id === "b") throw new Error("removeLayer boom");
    });
    m.sync(syncOf([{ id: "a", lng: 1, lat: 1 }]));
    m.flush();
    expect(m.unknownSize).toBe(1);

    // 修复宿主：下一次摘除成功 ⇒ 收敛
    removeMarker.mockImplementation(() => {});
    m.sync(syncOf([{ id: "a", lng: 1, lat: 1 }]));
    m.flush();
    // b 不在数据里 ⇒ 走删除路径；成功摘除后销账
    expect(m.unknownSize, "成功摘除后销账").toBe(0);
    expect(m.size).toBe(1);

    // 归属确定后，普通写入路径恢复可用（a 坐标变化仍会下发）
    vi.clearAllMocks();
    m.sync(syncOf([{ id: "a", lng: 10, lat: 10 }]));
    m.flush();
    expect(updatePosition).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  it("显隐部分失败 ⇒ 抛给调用方、全部试过、下一次不被短路吞掉（可重试）", () => {
    const { host, setVisible } = makeHost();
    const m = new DataLayerManager(host, { label: "BMarkerList" });
    m.sync(syncOf(items));
    m.flush();
    vi.clearAllMocks();

    // b 显隐失败：逐条隔离——a、c 仍要对齐
    setVisible.mockImplementation((resource: { id: string }, visible: boolean) => {
      if (resource.id === "b") throw new Error("hide failed");
      return true;
    });
    expect(() => m.setVisible(false), "失败必须让调用方知道").toThrowError(/hide failed/);
    expect(
      setVisible.mock.calls.map((call) => (call[0] as { id: string }).id),
      "一条失败不中断其余对齐",
    ).toEqual(["a", "b", "c"]);

    // 内部目标值没推进 ⇒ 第二次 setVisible(false) 不被顶部短路吞掉，全员重对齐
    setVisible.mockImplementation(() => true);
    vi.clearAllMocks();
    m.setVisible(false);
    expect(setVisible, "同一批资源必须重试").toHaveBeenCalledTimes(3);
    expect(setVisible.mock.calls.every((call) => call[1] === false)).toBe(true);

    // 全部成功之后才推进：再调同值 ⇒ 幂等短路
    vi.clearAllMocks();
    m.setVisible(false);
    expect(setVisible).not.toHaveBeenCalled();
    m.dispose();
  });
});
