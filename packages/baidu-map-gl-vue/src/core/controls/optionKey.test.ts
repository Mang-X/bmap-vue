/**
 * 控件选项变化键（M7-CONTROL-PANORAMA / issue #41）
 *
 * 这一层的价值全在「两个不同的值必须得到两个不同的键」——键重复就是**静默的漏检**
 * （变更检测失效、该下发的更新被吃掉），而它不会以任何形式报错。因此每一类值都配一条
 * **反证**（换一个值必须换一个键），而不是只断言「同一个值得到同一个键」。
 */
import { describe, it, expect } from "vitest";
import { changedOptionKeys, optionKey } from "./optionKey";

describe("optionKey：同一个值得到同一个键", () => {
  it("标量按值比较（与对象身份无关）", () => {
    expect(optionKey({ anchor: "BMAP_ANCHOR_TOP_LEFT" })).toBe(
      optionKey({ anchor: "BMAP_ANCHOR_TOP_LEFT" }),
    );
    expect(optionKey({ size: { x: 1, y: 2 } })).toBe(optionKey({ size: { x: 1, y: 2 } }));
  });

  it("对象的键顺序不影响结果（`{a,b}` 与 `{b,a}` 是同一个选项）", () => {
    expect(optionKey({ size: { x: 1, y: 2 } })).toBe(optionKey({ size: { y: 2, x: 1 } }));
  });

  it("数组按元素顺序比较（顺序不同就是不同的值）", () => {
    expect(optionKey({ mapTypes: [1, 2] })).not.toBe(optionKey({ mapTypes: [2, 1] }));
  });

  it("`undefined` 与显式 `null` 得到同一个键（都是「没有值」）", () => {
    expect(optionKey({ type: undefined })).toBe(optionKey({ type: null }));
  });

  it("函数折叠成固定字面量（父级每次渲染传新箭头函数不得触发下发）", () => {
    expect(optionKey({ onChange: () => 1 })).toBe(optionKey({ onChange: () => 2 }));
  });

  it("DOM 节点按**对象身份**区分：同一个节点同一个键，换一个节点就是另一个键", () => {
    const trigger = document.createElement("button");
    const other = document.createElement("button");
    expect(optionKey({ trigger })).toBe(optionKey({ trigger }));
    expect(optionKey({ trigger })).not.toBe(optionKey({ trigger: other }));
  });

  it("循环引用不抛错（选项来自用户 props，抛错会把一次渲染变成崩溃）", () => {
    const cyclic: Record<string, unknown> = { type: "a" };
    cyclic.self = cyclic;
    expect(() => optionKey(cyclic)).not.toThrow();
  });
});

describe("changedOptionKeys：只回答「哪些键可能要变」", () => {
  it("逐键比较，未变的键不进结果", () => {
    expect(
      changedOptionKeys(
        { anchor: "A", offset: { x: 1, y: 1 }, expand: false },
        { anchor: "A", offset: { x: 1, y: 1 }, expand: true },
      ),
    ).toEqual(["expand"]);
  });

  it("新增 / 删除的键都算变化（组件 props 有默认值，但 `recreate` 类选项可能是首次给出）", () => {
    expect(changedOptionKeys({}, { type: "BMAP_NAVIGATION_CONTROL_SMALL" })).toEqual(["type"]);
    expect(changedOptionKeys({ type: "old" }, {})).toEqual(["type"]);
  });

  it("两份完全相同的选项得到空数组（这是「不产生多余下发」的判据）", () => {
    expect(changedOptionKeys({ anchor: "A", offset: { x: 1, y: 1 } }, { anchor: "A", offset: { x: 1, y: 1 } })).toEqual(
      [],
    );
  });

  it("反证：值真的变了必须报出来（否则下发会被吃掉）", () => {
    expect(changedOptionKeys({ showStreetLayer: true }, { showStreetLayer: false })).toEqual([
      "showStreetLayer",
    ]);
  });
});
