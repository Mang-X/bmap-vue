import { describe, it, expect } from "vitest";
import { diffData } from "./diffData";

describe("diffData", () => {
  const items = [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
    { id: "c", v: 3 },
  ];

  it("detects added/updated/removed with keyed index (reference-based)", () => {
    const next = [
      { id: "a", v: 1 },
      { id: "b", v: 9 },
      { id: "d", v: 4 },
    ];
    const d = diffData(items, next, "id");
    expect(d.added.map((i) => i.id)).toEqual(["d"]);
    // 默认按引用比较:next 是新对象,key 已存在的 a/b 视为"更新"(引用变化)
    expect(d.updated.map((i) => i.id)).toEqual(["a", "b"]);
    expect(d.removed.map((i) => i.id)).toEqual(["c"]);
  });

  it("treats same-reference items as unchanged by default", () => {
    const a = { id: "a", v: 1 };
    const b = { id: "b", v: 2 };
    const prev = [a, b];
    const next = [a, b];
    const d = diffData(prev, next, "id");
    expect(d.unchanged).toBe(2);
    expect(d.updated).toHaveLength(0);
  });

  it("treats replaced-reference items as updated via custom compareItem", () => {
    const next = [{ id: "a", v: 5 }];
    const d = diffData([{ id: "a", v: 1 }], next, "id", (a, b) => a.v === b.v);
    expect(d.updated.map((i) => i.v)).toEqual([5]);
  });

  it("handles empty previous and duplicate keys", () => {
    const d = diffData(null, items, "id");
    expect(d.added).toHaveLength(3);
    expect(d.unchanged).toBe(0);
    // 重复 key:忽略后续重复
    const dup = diffData(
      [{ id: "a", v: 1 }],
      [
        { id: "a", v: 1 },
        { id: "a", v: 2 },
      ],
      "id",
    );
    expect(dup.added).toHaveLength(0);
  });

  it("supports key function", () => {
    const d = diffData([{ k: 1 }], [{ k: 1 }, { k: 2 }], (i) => i.k);
    expect(d.added.map((i) => i.k)).toEqual([2]);
  });
});
