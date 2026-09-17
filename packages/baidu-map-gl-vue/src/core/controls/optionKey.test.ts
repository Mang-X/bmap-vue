/**
 * 控件选项变化键（M7-CONTROL-PANORAMA / issue #41）
 *
 * 这一层的价值全在「两个不同的值必须得到两个不同的键」——键重复就是**静默的漏检**
 * （变更检测失效、该下发的更新被吃掉），而它不会以任何形式报错。因此每一类值都配一条
 * **反证**（换一个值必须换一个键），而不是只断言「同一个值得到同一个键」。
 */
import { describe, it, expect } from "vitest";
import { reactive, watch, nextTick } from "vue";
import { changedOptionKeys, optionKey, optionSnapshot } from "./optionKey";

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
    expect(changedOptionKeys(optionSnapshot({ type: null }), { type: undefined })).toEqual(["type"]);
  });

  /**
   * **已知限制（登记在案，不在本文件修）**：共享的 `stableKeyOf` 不做 DOM 身份——DOM 节点没有
   * 自有可枚举属性，会被序列化成 `{}`，因此「换成另一个节点」与「没换」得到同一个键。
   *
   * 当前不是活缺陷：没有组件把 DOM 放进 `options()`（`city-list.trigger` 没被暴露，且反向门禁
   * 要求组件的每个选项 prop 都有落地方式）。将来要暴露这类选项时，应在**共享的**
   * `stableKeyOf` 里补 DOM 身份分支（一处修，Overlay / Control 两个 Facet 一起受益）。
   *
   * 这条用例锁的是**限制本身**：它一旦被修好就会红，提醒同步更新 `optionKey` 的文件头与这里。
   */
  it("[已知限制] DOM 节点不做身份区分：换一个节点得到同一个键", () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    expect(optionKey({ trigger: first })).toBe(optionKey({ trigger: second }));
    // 但「有 DOM」与「没有 DOM」仍然分得开（存在性被跟踪）
    expect(optionKey({ trigger: first })).not.toBe(optionKey({}));
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
        optionSnapshot({ anchor: "A", offset: { x: 1, y: 1 }, expand: false }),
        { anchor: "A", offset: { x: 1, y: 1 }, expand: true },
      ),
    ).toEqual(["expand"]);
  });

  it("新增 / 删除的键都算变化（组件 props 有默认值，但 `recreate` 类选项可能是首次给出）", () => {
    expect(changedOptionKeys(optionSnapshot({}), { type: "BMAP_NAVIGATION_CONTROL_SMALL" })).toEqual([
      "type",
    ]);
    expect(changedOptionKeys(optionSnapshot({ type: "old" }), {})).toEqual(["type"]);
  });

  it("两份完全相同的选项得到空数组（这是「不产生多余下发」的判据）", () => {
    expect(
      changedOptionKeys(optionSnapshot({ anchor: "A", offset: { x: 1, y: 1 } }), {
        anchor: "A",
        offset: { x: 1, y: 1 },
      }),
    ).toEqual([]);
  });

  it("反证：值真的变了必须报出来（否则下发会被吃掉）", () => {
    expect(
      changedOptionKeys(optionSnapshot({ showStreetLayer: true }), { showStreetLayer: false }),
    ).toEqual(["showStreetLayer"]);
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
    expect(
      changedOptionKeys(optionSnapshot({ onChange: () => 1 }), { onChange: () => 2 }),
    ).toEqual([]);
  });

  it("但「有回调」与「没有回调」是变化（存在性仍然被跟踪）", () => {
    expect(changedOptionKeys(optionSnapshot({ onChange: () => 1 }), {})).toEqual(["onChange"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 快照基线的不可变性（#95 评审第 2 轮 P1）                                    */
/* -------------------------------------------------------------------------- */

describe("optionSnapshot：基线必须是**值快照**，不能被后续原地修改污染", () => {
  /**
   * 这一节是本 PR 那次 P1 的**根因**所在，值得单独钉住：
   *
   * 适配器早期把 `controlSpec.options()` 返回的**对象**当 diff 基线，而 `offset` / `size` 这些
   * 键的值是父级传入的同一个引用。父级原地改字段时：watch 源（`optionKey`）**能**感知到
   * （下面的用例证明它确实递归跟踪到了 `x` / `y`），但随后的 diff 两边指向同一个已被改过的
   * 对象、序列化完全相同 ⇒ `changed` 为空 ⇒ 更新被静默吃掉。
   */
  it("watch 源确实跟踪嵌套字段（所以问题在 diff，不在 watcher）", async () => {
    const offset = reactive({ x: 7, y: 9 });
    let fired = 0;
    const stop = watch(
      () => optionKey({ offset }),
      () => {
        fired += 1;
      },
    );
    offset.x = 21;
    await nextTick();
    stop();
    expect(fired).toBe(1);
  });

  it("快照之后原地修改原对象，diff 仍然必须报出该键", () => {
    const offset = { x: 7, y: 9 };
    const snapshot = optionSnapshot({ anchor: "A", offset });
    // 基线建立后，父级原地改同一个对象
    offset.x = 21;
    expect(changedOptionKeys(snapshot, { anchor: "A", offset })).toEqual(["offset"]);
  });

  it("数组原地 push 同理", () => {
    const mapTypes = [1, 2];
    const snapshot = optionSnapshot({ mapTypes });
    mapTypes.push(3);
    expect(changedOptionKeys(snapshot, { mapTypes })).toEqual(["mapTypes"]);
  });

  it("值没变时报空数组（快照不能变成「每次都算变化」）", () => {
    const offset = { x: 7, y: 9 };
    const snapshot = optionSnapshot({ anchor: "A", offset });
    expect(changedOptionKeys(snapshot, { anchor: "A", offset: { x: 7, y: 9 } })).toEqual([]);
  });

  it("「键缺席」与「键存在但值为 undefined」等价（不产生假变化）", () => {
    const snapshot = optionSnapshot({ anchor: "A" });
    expect(changedOptionKeys(snapshot, { anchor: "A", type: undefined })).toEqual([]);
  });
});
