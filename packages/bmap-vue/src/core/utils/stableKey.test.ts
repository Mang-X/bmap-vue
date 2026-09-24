import { describe, expect, it } from "vitest";
import { stableKeyOf } from "./stableKey";

describe("stableKeyOf", () => {
  it("给同一个对象的不同键序同一个 key（父级传内联字面量不会空跑 watch）", () => {
    expect(stableKeyOf({ imageUrl: "a.png", size: { width: 1, height: 2 } })).toBe(
      stableKeyOf({ size: { height: 2, width: 1 }, imageUrl: "a.png" }),
    );
  });

  it("区分内容不同的对象", () => {
    expect(stableKeyOf({ width: 1 })).not.toBe(stableKeyOf({ width: 2 }));
    expect(stableKeyOf(["a"])).not.toBe(stableKeyOf(["b"]));
  });

  it("把函数折叠成 fn（内联回调每次渲染都是新函数，不该触发更新）", () => {
    expect(stableKeyOf({ cb: () => {} })).toBe(stableKeyOf({ cb: () => {} }));
  });

  it("标量原样序列化，且类型不同不会撞车", () => {
    expect(stableKeyOf(1)).toBe("1");
    expect(stableKeyOf("1")).toBe('"1"');
    expect(stableKeyOf(null)).toBe("null");
    expect(stableKeyOf(undefined)).toBe('"[undefined]"');
  });

  it("循环引用按路径判定：兄弟分支里重复出现不算循环", () => {
    const shared = { x: 1 };
    expect(stableKeyOf({ a: shared, b: shared })).toBe(stableKeyOf({ a: { x: 1 }, b: { x: 1 } }));

    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    expect(stableKeyOf(cyclic)).toBe('{"self":"[circular]","x":1}');
  });
});
