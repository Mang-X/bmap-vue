/**
 * 容器尺寸读数（M4-HANDLE-UX / issue #29）
 *
 * 「容器获得非零尺寸后才创建 Map」这条门禁需要一个**可测**的读数，而这个读数的语义必须与
 * 门禁的**触发源**一致 —— 触发源是 `useResizeObserver(..., { box: "border-box" })`（见
 * `composables/useMapSuspension.ts`），而**纯 transform 变化不会触发 ResizeObserver**。
 *
 * 因此本模块的语义是 **布局盒（border-box）**，取值优先级：
 * `offsetWidth/Height`（同步、整数、不受 transform 影响）→ `clientWidth/Height`
 * → `getBoundingClientRect()`（仅当前两级不可读时兜底，例如 SVG / 非 HTMLElement）。
 *
 * 为什么不是「rect 优先」（#29 四轮复审 P2 的结论）：`getBoundingClientRect()` 包含 transform，
 * 与观察器的触发语义不一致，会出现「`scale(0)` → `scale(1)` 之后 rect 非零、但观察器不通知」
 * ⇒ 门禁永远不放行、地图永不创建。**transform 明确不属于门禁语义**：一个被缩放到 0 的容器，
 * 其布局盒仍是它声明的尺寸，地图按布局盒创建是正确的（视觉缩放交给 CSS）。
 *
 * | 环境 | 可靠来源 | 说明 |
 * | --- | --- | --- |
 * | 真实浏览器 | `offsetWidth/Height`（布局盒） | 同步、整数；不受 transform 影响 |
 * | 无布局引擎的测试环境（happy-dom / jsdom） | 同上（由测试基线的**最小盒模型**提供，见 `packages/test-utils/browser-shims.ts`） | 两个 DOM 实现都不做布局，原生读数恒为 0，替身按登记的尺寸给出 |
 *
 * 本模块只做两件事：**按固定优先级取值**与**判定「能不能拿来建图」**（宽高都必须 > 0）。
 * 判定与取值分开，让「零尺寸」这条规则可以脱离 DOM 直接单测。
 *
 * 契约（与 issue #29 的「容器/可见性策略不会泄漏 Observer 或 RAF」一致）：
 * - 本模块**不持有**任何资源：不订阅事件、不建 Observer、不排帧。观察器归
 *   `composables/useMapSuspension.ts` 的实例级作用域。
 * - 读不到元素（`null` / 未挂载）返回 `null`，**不等于**「零尺寸」：
 *   前者是「还不知道」，后者是「确定的 0×0」。两者对门禁的处理相同（都不建图），
 *   但对调用方语义不同，因此不合并成一个哨兵值。
 */

/** 元素的内容盒尺寸（像素；真实浏览器上可能是小数）。 */
export interface ElementSize {
  readonly width: number;
  readonly height: number;
}

/** 确定的零尺寸（测试与比较用的常量，**不要**原地改写它）。 */
export const ZERO_SIZE: ElementSize = Object.freeze({ width: 0, height: 0 });

/** 取一个可用的有限数：`undefined` / `NaN` / `Infinity` 一律归 0。 */
function toFiniteSize(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 读 `getBoundingClientRect()`；环境不提供（或实现残缺）时返回 `null`。 */
function readRect(element: Element): { width: number; height: number } | null {
  const measure = (element as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  if (typeof measure !== "function") return null;
  try {
    // 只把「读不到」降级成 null：这里 catch 的是 DOM 读数本身（脱离文档 / 自定义元素 /
    // 残缺实现），不吞业务逻辑里的异常。读到的值仍是原样返回，不做修正。
    const rect = (measure as () => DOMRect).call(element);
    return rect ?? null;
  } catch {
    return null;
  }
}

/**
 * 读元素的**布局盒（border-box）**尺寸。
 *
 * 优先级：`offsetWidth/Height` → `clientWidth/Height` → `getBoundingClientRect()`。
 * 前两级是布局盒/内容盒（不含 transform），与 `ResizeObserver(border-box)` 的触发语义一致；
 * 第三级只在「非 HTMLElement / 无布局信息」时兜底（例如 SVG 元素）。
 *
 * **「读得到就返回、哪怕是 0」**这条不变：只有在**读不到**（成员缺失 / 抛错 / 非有限数）时
 * 才降级 —— 否则「元素真的被折叠成 0」会被降级读数掩盖掉。
 */
export function readElementSize(element: Element | null | undefined): ElementSize | null {
  if (!element) return null;
  const box = element as { offsetWidth?: unknown; offsetHeight?: unknown };
  if (typeof box.offsetWidth === "number" || typeof box.offsetHeight === "number") {
    return { width: toFiniteSize(box.offsetWidth), height: toFiniteSize(box.offsetHeight) };
  }
  const client = element as { clientWidth?: unknown; clientHeight?: unknown };
  if (typeof client.clientWidth === "number" || typeof client.clientHeight === "number") {
    return { width: toFiniteSize(client.clientWidth), height: toFiniteSize(client.clientHeight) };
  }
  const rect = readRect(element);
  if (rect) {
    return { width: toFiniteSize(rect.width), height: toFiniteSize(rect.height) };
  }
  return null;
}

/**
 * 这个尺寸能不能拿来建图：**宽与高都必须是正数**。
 *
 * 只要求「大于 0」而不是某个最小边长：Tab / Drawer 展开动画的中间帧上容器是 1px 宽，
 * 那已经是「有尺寸」了 —— 拒绝它会让地图永远等不到门禁放行。真正要挡的是
 * 「未展开（0×0）」与「还没挂载（读不到）」。
 */
export function isUsableSize(size: ElementSize | null): boolean {
  return size !== null && size.width > 0 && size.height > 0;
}

/** 尺寸是否相同（逐字段严格相等；容差判定不适用于「有没有尺寸」这个布尔语义）。 */
export function sizeEquals(a: ElementSize | null, b: ElementSize | null): boolean {
  if (a === null || b === null) return a === b;
  return a.width === b.width && a.height === b.height;
}
