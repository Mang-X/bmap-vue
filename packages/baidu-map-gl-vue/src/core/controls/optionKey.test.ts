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

  it("`undefined` 与显式 `null` **必须**得到不同的键", () => {
    // 依据：Driver 对两者走不同路径（`projectOptions` / `setOptions` 跳过 `undefined`、
    // 把 `null` 交给结构逃生口），合并会让「显式传 null」被当成没变化而吃掉。
    // 官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 同样分开标记。
    expect(optionKey({ type: undefined })).not.toBe(optionKey({ type: null }));
    expect(changedOptionKeys({ type: null }, { type: undefined })).toEqual(["type"]);
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

/* -------------------------------------------------------------------------- */
/* 函数值的契约：按**存在性**比较，不按身份（#95 评审 P2-3 的口径）              */
/* -------------------------------------------------------------------------- */

describe("optionKey：函数值按存在性比较（与官方参考实现同口径）", () => {
  /**
   * 这一节锁的是**刻意的取舍**，不是「还没修」：
   *
   * - 若按身份比较，父级在模板里写 `:on-change="(e) => ..."`（内联箭头每次渲染都是新函数）
   *   会让 `recreate` 类回调选项**每次渲染都重建控件**——内联回调是常规写法，这个代价不可接受；
   * - 官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 也是
   *   `typeof value === 'function' → 'fn'`（同一份文件里它却**分开**标记 `undefined` / `null`，
   *   本库两者都对齐）。
   *
   * 代价写在 `optionKey` 的文件头：**回调选项更新不会被下发**，因此 `ControlSpec.options()`
   * 不应承载需要在运行期更新的回调（要新闭包就经 `spec.events` 或自建稳定代理）。
   * 当前没有任何控件把函数值放进 `options()`。
   */
  it("换一个回调不算「选项变了」", () => {
    expect(optionKey({ onChange: () => 1 })).toBe(optionKey({ onChange: () => 2 }));
    expect(changedOptionKeys({ onChange: () => 1 }, { onChange: () => 2 })).toEqual([]);
  });

  it("但「有回调」与「没有回调」是变化（存在性仍然被跟踪）", () => {
    expect(changedOptionKeys({ onChange: () => 1 }, {})).toEqual(["onChange"]);
  });
});
