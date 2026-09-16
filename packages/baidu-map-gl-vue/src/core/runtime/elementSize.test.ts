/**
 * 容器尺寸读数（M4-HANDLE-UX / issue #29）
 *
 * 覆盖三类失败方式：
 * 1. **取值优先级写错**：布局盒（offset/client）与 rect 都有值时用了后者 —— 会把 transform 带进门禁，
 *    与 `ResizeObserver(border-box)` 的触发语义不一致（#29 四轮复审 P2）；
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

/**
 * 造一个「可读 rect」的元素；`rect` 之外的读数（offset/client）按需补。
 *
 * ⚠️ **默认把布局盒（`offsetWidth` / `offsetHeight`）钉成 0**：测试环境里的替身
 * （`packages/test-utils/browser-shims.ts`）会给真实 DOM 元素提供最小盒模型读数，未登记尺寸时
 * 回落到**视口尺寸** —— 不钉住的话，同一份断言会在「装没装替身」两种环境下得到不同结果
 * （读过一次全量才发现）。需要测某一级读数时显式传 `offsetWidth` / `offsetHeight`。
 */
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
  const readings: Record<string, unknown> = { offsetWidth: 0, offsetHeight: 0, ...extra };
  for (const [key, value] of Object.entries(readings)) {
    Object.defineProperty(element, key, { value, configurable: true });
  }
  return element;
}

describe("readElementSize", () => {
  it("没有元素时返回 null（「还不知道」而不是「零尺寸」）", () => {
    expect(readElementSize(null)).toBeNull();
    expect(readElementSize(undefined)).toBeNull();
  });

  it("优先用布局盒（offsetWidth/Height），与 ResizeObserver 的触发语义一致", () => {
    const element = elementWith(() => ({ width: 999, height: 999 }), {
      offsetWidth: 320,
      offsetHeight: 240,
    });
    expect(readElementSize(element)).toEqual({ width: 320, height: 240 });
  });

  it("纯 transform 不改变读数（`scale(0)` 的容器布局盒仍是它声明的尺寸）", () => {
    // rect 反映 transform（这里模拟 scale(0)：rect 为 0），但布局盒没变 ⇒ 读数必须是布局盒。
    // 反过来说：若以 rect 为准，`scale(0) → scale(1)` 这种转换**不会触发 ResizeObserver**
    // （纯 transform 不触发），门禁就永远等不到放行 —— 这正是 #29 四轮复审 P2 要收掉的口子。
    const element = elementWith(() => ({ width: 0, height: 0 }), {
      offsetWidth: 320,
      offsetHeight: 240,
    });
    expect(readElementSize(element)).toEqual({ width: 320, height: 240 });
    expect(isUsableSize(readElementSize(element)), "布局盒可用 ⇒ 门禁放行").toBe(true);
  });

  it("布局盒读得到 0 时就用 0，不降级到 client / rect（否则「折叠成 0」会被掩盖）", () => {
    const element = elementWith(() => ({ width: 320, height: 240 }), {
      offsetWidth: 0,
      offsetHeight: 0,
      clientWidth: 320,
      clientHeight: 240,
    });
    expect(readElementSize(element)).toEqual(ZERO_SIZE);
    // 正证守卫：这条用例真的能区分两种读数 —— 拿掉 offset 之后必须读到 320×240。
    // （真实 DOM 元素上 `offsetWidth` 恒存在（最差是 0），所以这一级只能用形状对象覆盖。）
    const noOffset = {
      clientWidth: 320,
      clientHeight: 240,
      getBoundingClientRect: () => ({ width: 320, height: 240 }),
    } as unknown as Element;
    expect(readElementSize(noOffset)).toEqual({ width: 320, height: 240 });
  });

  it("布局盒不可读（非 HTMLElement，如 SVG）时兜底到 getBoundingClientRect", () => {
    const element = elementWith(() => ({ width: 100, height: 50 }), {});
    // 真实 DOM 元素上 `offsetWidth` 恒存在（最差是 0）⇒ 用形状对象覆盖这条兜底路径
    const svgLike = {
      getBoundingClientRect: () => ({ width: 100, height: 50 }),
    } as unknown as Element;
    expect(readElementSize(svgLike)).toEqual({ width: 100, height: 50 });
    expect(
      readElementSize(element),
      "普通元素（夹具把布局盒钉成 0）⇒ 以布局盒为准，不落到 rect",
    ).toEqual(ZERO_SIZE);
  });

  it("rect 抛错时不把异常抛给调用方（前两级不可读时返回 null）", () => {
    const element = {
      getBoundingClientRect: () => {
        throw new Error("detached");
      },
    } as unknown as Element;
    expect(readElementSize(element)).toBeNull();
  });

  it("offset 不可读时降级到 clientWidth / clientHeight", () => {
    // 真实 DOM 元素上 `offsetWidth` 一定存在（最差也是 0），因此这条降级路径只能用
    // 形状对象覆盖：读数函数只碰 `offset*` / `client*` / `getBoundingClientRect` 三类成员。
    const element = {
      clientWidth: 7,
      clientHeight: 9,
    } as unknown as Element;
    expect(readElementSize(element)).toEqual({ width: 7, height: 9 });
  });

  it("真实 DOM 元素上 rect 不可读也不返回 null（布局盒恒存在，0 就是「确定的零尺寸」）", () => {
    expect(readElementSize(elementWith(undefined))).toEqual(ZERO_SIZE);
  });

  it("三类读数都不可用时返回 null（形状对象 / 残缺环境）", () => {
    expect(readElementSize({} as unknown as Element)).toBeNull();
  });

  it("NaN / Infinity 归一为 0（不把脏读数带进门禁判定）", () => {
    const dirtyBox = elementWith(undefined, {
      offsetWidth: Number.NaN,
      offsetHeight: Number.POSITIVE_INFINITY,
    });
    expect(readElementSize(dirtyBox)).toEqual(ZERO_SIZE);
    const dirtyRect = {
      getBoundingClientRect: () => ({ width: Number.NaN, height: Number.POSITIVE_INFINITY }),
    } as unknown as Element;
    expect(readElementSize(dirtyRect)).toEqual(ZERO_SIZE);
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
