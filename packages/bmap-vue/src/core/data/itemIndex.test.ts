/**
 * key → 最新业务 item 账本（issue #34）
 *
 * 它没有「能省一次查询」这种自证需求，唯一要钉住的是**语义**：整体替换（而不是增量）、
 * 删掉的 key 不留幽灵项、同 key 后者胜。这三条一旦漂移，表现是「点击回传了一个已经不在数据里的
 * 旧对象」——而那种缺陷在组件用例里只会偶发。
 */
import { describe, expect, it } from "vitest";
import { createItemIndex } from "./itemIndex";

interface Row {
  id: string;
  v?: number;
}

describe("createItemIndex", () => {
  it("replace 是整体替换：上一次的 key 不再可查（不留幽灵项）", () => {
    const index = createItemIndex<Row>();
    index.replace([{ key: "a", item: { id: "a", v: 1 } }, { key: "b", item: { id: "b", v: 1 } }]);
    expect(index.latest("a")).toEqual({ id: "a", v: 1 });

    index.replace([{ key: "a", item: { id: "a", v: 2 } }]);
    expect(index.latest("a"), "同一个 key 拿到的是新的那一项").toEqual({ id: "a", v: 2 });
    expect(index.latest("b"), "被删掉的 key 不能还查得到").toBeUndefined();
  });

  it("同一个 key 出现多次时后者胜（去重由扫描负责，这里如实照做）", () => {
    const index = createItemIndex<Row>();
    const first: Row = { id: "a", v: 1 };
    const second: Row = { id: "a", v: 2 };
    index.replace([
      { key: "a", item: first },
      { key: "a", item: second },
    ]);
    expect(index.latest("a")).toBe(second);
  });

  it("clear 之后查不到任何项", () => {
    const index = createItemIndex<Row>();
    index.replace([{ key: "a", item: { id: "a" } }]);
    index.clear();
    expect(index.latest("a")).toBeUndefined();
  });

  it("空账本查任意 key 都是 undefined（不抛错）", () => {
    const index = createItemIndex<Row>();
    expect(index.latest("missing")).toBeUndefined();
  });
});
