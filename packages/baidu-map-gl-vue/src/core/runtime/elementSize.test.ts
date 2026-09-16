/**
 * 容器尺寸读数（M4-HANDLE-UX / issue #29）
 *
 * 覆盖三类失败方式：
 * 1. **取值优先级写错**：rect 与 offsetWidth 都有值时用了后者（会掩盖「真的被折叠成 0」）；
 * 2. **读不到与零尺寸被合并**：`null`（没元素）与 `0×0`（确定零尺寸）语义不同，不能混；
 * 3. **门禁判据写歪**：只判一个方向（宽 > 0）就会放过 `0×N` 的半折叠容器。
 */
import { describe, expect, it } from "vitest";
import {
  ZERO_SIZE,
  isUsableSize,
  readElementSize,
  sizeEquals,
  type ElementSize,
} from "./elementSize";

/** 造一个「可读 rect」的元素；`rect` 之外的读数（offset/client）按需补。 */
function elementWith(
  rect: (() => { width: number; height: number }) | undefined,
  extra: Record<string, unknown> = {},
): Element {
  const element = document.createElement("div");
  if (rect) {
    Object.defineProperty(element, "getBoundingClientRect", { value: rect, configurable: true });
  } else {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: undefined,
      configurable: true,
    });
  }
  for (const [key, value] of Object.entries(extra)) {
    Object.defineProperty(element, key, { value, configurable: true });
  }
  return element;
}

describe("readElementSize", () => {
  it("没有元素时返回 null（「还不知道」而不是「零尺寸」）", () => {
    expect(readElementSize(null)).toBeNull();
    expect(readElementSize(undefined)).toBeNull();
  });

  it("优先用 getBoundingClientRect，并保留小数", () => {
    const element = elementWith(() => ({ width: 320.5, height: 240.25 }), {
      offsetWidth: 999,
      offsetHeight: 999,
    });
    expect(readElementSize(element)).toEqual({ width: 320.5, height: 240.25 });
  });

  it("rect 读得到 0 时就用 0，不降级到 offsetWidth（否则「折叠成 0」会被掩盖）", () => {
    const element = elementWith(() => ({ width: 0, height: 0 }), {
      offsetWidth: 320,
      offsetHeight: 240,
    });
    expect(readElementSize(element)).toEqual(ZERO_SIZE);
    // 正证守卫：这条用例真的能区分两种读数 —— 拿掉 rect 之后必须读到 320×240
    const legacyOnly = elementWith(undefined, { offsetWidth: 320, offsetHeight: 240 });
    expect(readElementSize(legacyOnly)).toEqual({ width: 320, height: 240 });
  });

  it("环境不提供 rect 时降级到 offsetWidth / offsetHeight", () => {
    const element = elementWith(undefined, { offsetWidth: 100, offsetHeight: 50 });
    expect(readElementSize(element)).toEqual({ width: 100, height: 50 });
  });

  it("rect 抛错时降级到 offsetWidth，而不是把异常抛给调用方", () => {
    const element = elementWith(() => {
      throw new Error("detached");
    }, { offsetWidth: 12, offsetHeight: 34 });
    expect(readElementSize(element)).toEqual({ width: 12, height: 34 });
  });

  it("offset 也不可读时降级到 clientWidth / clientHeight", () => {
    // 真实 DOM 元素上 `offsetWidth` 一定存在（最差也是 0），因此这条降级路径只能用
    // 形状对象覆盖：读数函数只碰 `getBoundingClientRect` / `offset*` / `client*` 三类成员。
    const element = {
      getBoundingClientRect: undefined,
      clientWidth: 7,
      clientHeight: 9,
    } as unknown as Element;
    expect(readElementSize(element)).toEqual({ width: 7, height: 9 });
  });

  it("真实 DOM 元素上 rect 不可读也不返回 null（offset 恒存在，0 就是「确定的零尺寸」）", () => {
    expect(readElementSize(elementWith(undefined))).toEqual(ZERO_SIZE);
  });

  it("三类读数都不可用时返回 null（形状对象 / 残缺环境）", () => {
    expect(readElementSize({} as unknown as Element)).toBeNull();
  });

  it("NaN / Infinity 归一为 0（不把脏读数带进门禁判定）", () => {
    const element = elementWith(() => ({ width: Number.NaN, height: Number.POSITIVE_INFINITY }));
    expect(readElementSize(element)).toEqual(ZERO_SIZE);
  });
});

describe("isUsableSize", () => {
  it("null（读不到）不可用", () => {
    expect(isUsableSize(null)).toBe(false);
  });

  it("任一方向为 0 都不可用", () => {
    expect(isUsableSize({ width: 0, height: 0 })).toBe(false);
    expect(isUsableSize({ width: 320, height: 0 })).toBe(false);
    expect(isUsableSize({ width: 0, height: 240 })).toBe(false);
  });

  it("1×1 也算可用（展开动画的中间帧不能被拒，否则门禁会永远等不到）", () => {
    expect(isUsableSize({ width: 1, height: 1 })).toBe(true);
  });
});

describe("sizeEquals", () => {
  const size = (width: number, height: number): ElementSize => ({ width, height });

  it("逐字段严格相等", () => {
    expect(sizeEquals(size(320, 240), size(320, 240))).toBe(true);
    expect(sizeEquals(size(320, 240), size(320, 241))).toBe(false);
  });

  it("null 只与 null 相等（「读不到」不能与「零尺寸」互相等价）", () => {
    expect(sizeEquals(null, null)).toBe(true);
    expect(sizeEquals(null, size(0, 0))).toBe(false);
    expect(sizeEquals(size(0, 0), null)).toBe(false);
  });
});
