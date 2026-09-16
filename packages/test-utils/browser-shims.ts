/**
 * 测试环境的浏览器能力替身（M4-HANDLE-UX / issue #29）
 *
 * ## 为什么需要这一层
 *
 * `happy-dom` 提供的是**接口存在但什么都不做**的实现，配合「没有布局引擎」这条事实，
 * `<BMap>` 的容器门禁与可见性策略在测试环境里既**读不到尺寸**，也**收不到回调**：
 *
 * | 能力 | happy-dom 现状 | 本项目真的用它的地方 | 本文件补什么 |
 * | --- | --- | --- | --- |
 * | `getBoundingClientRect()` | 恒为 0×0（无布局引擎） | `core/runtime/elementSize.ts` 的容器读数 | 最小盒模型（显式登记 / 内联样式） |
 * | `ResizeObserver` | 类存在，`observe` / `disconnect` 是空实现（源码注释 `TODO: Implement`） | `useMapSuspension` 的尺寸变化 | 记录观察者 + 可手动派发 + 计数 |
 * | `IntersectionObserver` | 同上 | `useMapSuspension` 的视口判定 | 同上 |
 * | `window.matchMedia` | 存在，`matches` 恒为 `false` | `usePreferredReducedMotion` | 可切换 + 派发 `change` |
 * | `document.visibilityState` | 恒为 `"visible"` | `useDocumentVisibility` | 可切换 + 派发 `visibilitychange` |
 *
 * 它**不是**给生产代码用的抽象：生产代码只用标准 DOM API（`elementSize.ts` 里那条
 * 「`getBoundingClientRect` → `offsetWidth` → `clientWidth`」的优先级链），
 * 由本文件在测试环境里把那条链喂饱 —— 于是「门禁读的是标准读数」在实现里是显式的。
 * 观察器替身还负责一件事：**`disconnect()` 计数**，它是「释放路径真的被走到」的可用证据
 * （happy-dom 的空实现让这件事在测试里原本不可观察）。
 *
 * ## 最小盒模型的规则（数值口径与 `fake-bmap-v4/FakeMap.ts` 的内联样式读法一致）
 *
 * 1. 显式登记（`setElementSize`）优先；
 * 2. 其次是元素自己的**内联样式**：`"320px"` → 320、`"100%"` → 视口宽（没有包含块可算）、
 *    未设置 → 视口尺寸（`div` 的默认块级宽度就是包含块宽度）；
 * 3. `display: none`（含祖先）→ 0×0 —— 这是「未展开的 Tab / Drawer」在测试里的表达方式。
 *
 * 规则 2 的「未设置 → 视口」很重要：既有的大量组件用例只用 `document.createElement("div")`
 * 当容器（不设任何样式），如果未设置被判成 0，容器门禁会把它们全部挡住。
 */
export interface ElementSizeInput {
  width: number;
  height: number;
}

export interface BrowserShimDiagnostics {
  /** 当前仍然「观察中」的 ResizeObserver 数（释放后必须归零）。 */
  resizeObservers: number;
  /** ResizeObserver 的 `disconnect()` 累计调用次数（释放路径的正证）。 */
  resizeDisconnects: number;
  /** 当前仍然「观察中」的 IntersectionObserver 数。 */
  intersectionObservers: number;
  /** IntersectionObserver 的 `disconnect()` 累计调用次数。 */
  intersectionDisconnects: number;
}

export interface BrowserShims {
  /** 安装全部替身（幂等）；`tests/setup.ts` 的 `beforeEach` 调用。 */
  install(): void;
  /** 清空记录（不卸载替身）：每个用例开头调用，避免跨用例读到上一个用例的元素。 */
  reset(): void;
  /** 还原全局并清空记录；`afterEach` 调用。 */
  restore(): void;

  /* ------------------------------------------------------------------ 驱动 */
  /** 直接给出元素的尺寸（等价于「布局把这元素算成了这个尺寸」）。 */
  setElementSize(element: Element, size: ElementSizeInput): void;
  /** 改尺寸并派发一次 resize 回调。 */
  resize(element: Element, size: ElementSizeInput): void;
  /**
   * 只派发一次 resize 回调（**不**改尺寸）：尺寸由替身的盒模型自己算。
   *
   * 用来覆盖「组件读的是标准 DOM 读数」这条路径 —— 先改真实 DOM（例如祖先的 `display`），
   * 再只通知一次变化。`resize()` 会写显式尺寸覆盖，证明不了这一点。
   */
  notifyResize(element: Element): void;
  /** 派发一次视口交叉回调。 */
  intersect(element: Element, isIntersecting: boolean): void;
  /** 切换页面可见性并派发 `visibilitychange`。 */
  setDocumentHidden(hidden: boolean): void;
  /** 切换「减少动画」偏好并派发媒体查询 `change`。 */
  setReducedMotion(reduced: boolean): void;

  /** 观察器账本（门禁读数）。 */
  diagnostics(): BrowserShimDiagnostics;
}

/** 媒体查询替身用到的查询串（与 `usePreferredReducedMotion` 内部一致）。 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface SizeRecord {
  width: number;
  height: number;
}

type ResizeCallback = (entries: unknown[], observer: unknown) => void;

class ShimResizeObserver {
  readonly elements = new Set<Element>();
  disconnectCalls = 0;
  disconnected = false;

  constructor(readonly callback: ResizeCallback) {}
  observe(target: Element): void {
    this.elements.add(target);
  }
  unobserve(target: Element): void {
    this.elements.delete(target);
  }
  disconnect(): void {
    this.disconnectCalls += 1;
    this.elements.clear();
    this.disconnected = true;
  }
}

class ShimIntersectionObserver extends ShimResizeObserver {
  constructor(
    callback: ResizeCallback,
    readonly options?: Record<string, unknown>,
  ) {
    super(callback);
  }
  takeRecords(): unknown[] {
    return [];
  }
}

function parseInlineLength(value: string, fallback: number): number {
  if (!value) return fallback;
  if (value.trim().endsWith("%")) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createBrowserShims(): BrowserShims {
  /** 每个元素当前的尺寸覆盖（`setElementSize` 写、盒模型读）。 */
  const sizes = new WeakMap<Element, SizeRecord>();
  const resizeObservers = new Set<ShimResizeObserver>();
  const intersectionObservers = new Set<ShimIntersectionObserver>();
  let resizeDisconnects = 0;
  let intersectionDisconnects = 0;
  let installed = false;
  let documentPatched = false;

  const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getBoundingClientRect",
  );
  let originalMatchMedia: unknown;
  let originalResizeObserver: unknown;
  let originalIntersectionObserver: unknown;

  function hiddenByStyle(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
      if (current instanceof HTMLElement && current.style.display === "none") return true;
      current = current.parentElement;
    }
    return false;
  }

  function boxOf(element: Element): SizeRecord {
    const override = sizes.get(element);
    if (override) return override;
    if (hiddenByStyle(element)) return { width: 0, height: 0 };
    const inline = element instanceof HTMLElement ? element.style : null;
    const fallbackWidth = typeof window === "undefined" ? 0 : window.innerWidth;
    const fallbackHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    return {
      width: parseInlineLength(inline?.width ?? "", fallbackWidth),
      height: parseInlineLength(inline?.height ?? "", fallbackHeight),
    };
  }

  /** 造一个形状正确的 `DOMRect`（读数的消费者可能读相对字段）。 */
  function rectOf(size: SizeRecord): DOMRect {
    return {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
      toJSON: () => ({ width: size.width, height: size.height }),
    } as DOMRect;
  }

  function resizeEntryFor(element: Element): unknown {
    const size = boxOf(element);
    const rect = rectOf(size);
    const box = [{ inlineSize: size.width, blockSize: size.height }];
    return {
      target: element,
      contentRect: rect,
      borderBoxSize: box,
      contentBoxSize: box,
      devicePixelContentBoxSize: box,
    };
  }

  function intersectionEntryFor(element: Element, isIntersecting: boolean): unknown {
    const rect = rectOf(boxOf(element));
    return {
      target: element,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: rect,
      intersectionRect: isIntersecting ? rect : rectOf({ width: 0, height: 0 }),
      rootBounds: rect,
      time: 0,
    };
  }

  /* ------------------------------------------------------------ 媒体查询替身 */

  const mediaStates = new Map<string, { matches: boolean; listeners: Set<(event: unknown) => void> }>();

  function mediaState(query: string) {
    let state = mediaStates.get(query);
    if (!state) {
      state = { matches: false, listeners: new Set() };
      mediaStates.set(query, state);
    }
    return state;
  }

  function createMediaQueryList(query: string): MediaQueryList {
    const state = mediaState(query);
    const notify = (event: unknown) => {
      for (const listener of [...state.listeners]) listener(event);
    };
    return {
      media: query,
      get matches() {
        return state.matches;
      },
      onchange: null,
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (type === "change") state.listeners.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        if (type === "change") state.listeners.delete(listener);
      },
      // 老实现的回退面：VueUse 的 `useEventListener` 只在没有 `addEventListener` 时才用它，
      // 这里一并提供，避免「哪天上游换了分支」变成静默不生效。
      addListener(listener: (event: unknown) => void) {
        state.listeners.add(listener);
      },
      removeListener(listener: (event: unknown) => void) {
        state.listeners.delete(listener);
      },
      dispatchEvent(event: Event) {
        notify(event);
        return true;
      },
    } as unknown as MediaQueryList;
  }

  function setMatches(query: string, matches: boolean): void {
    const state = mediaState(query);
    if (state.matches === matches) return;
    state.matches = matches;
    for (const listener of [...state.listeners]) listener({ matches, media: query });
  }

  /* ------------------------------------------------------------ 观察器派发 */

  function notifyResize(element: Element): void {
    for (const observer of [...resizeObservers]) {
      if (observer.disconnected || !observer.elements.has(element)) continue;
      observer.callback([resizeEntryFor(element)], observer);
    }
  }

  /* ------------------------------------------------------------ 释放记录 */

  function resetRecords(): void {
    for (const observer of [...resizeObservers]) observer.disconnect();
    for (const observer of [...intersectionObservers]) observer.disconnect();
    resizeObservers.clear();
    intersectionObservers.clear();
    resizeDisconnects = 0;
    intersectionDisconnects = 0;
    mediaStates.clear();
    if (documentPatched) {
      documentPatched = false;
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  }

  return {
    install(): void {
      if (installed) return;
      installed = true;

      Object.defineProperty(Element.prototype, "getBoundingClientRect", {
        configurable: true,
        writable: true,
        value: function getBoundingClientRect(this: Element): DOMRect {
          return rectOf(boxOf(this));
        },
      });

      // 布局盒读数：`elementSize.ts` 的优先级链是 `offset*` → `client*` → `getBoundingClientRect()`
      // （与 `ResizeObserver(border-box)` 的触发语义一致，见该模块文件头）。替身必须把前两级也
      // 补上 —— 否则会落到 happy-dom 原生的 `0×0`，「容器拿到尺寸才建图」的门禁在测试里永不放行。
      for (const [name, pick] of [
        ["offsetWidth", (size: SizeRecord) => size.width],
        ["offsetHeight", (size: SizeRecord) => size.height],
        ["clientWidth", (size: SizeRecord) => size.width],
        ["clientHeight", (size: SizeRecord) => size.height],
      ] as const) {
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement): number {
            return pick(boxOf(this));
          },
        });
      }

      const globals = globalThis as unknown as Record<string, unknown>;
      originalResizeObserver = globals.ResizeObserver;
      originalIntersectionObserver = globals.IntersectionObserver;
      globals.ResizeObserver = class extends ShimResizeObserver {
        constructor(callback: ResizeCallback) {
          super(callback);
          resizeObservers.add(this);
        }
        override disconnect(): void {
          resizeDisconnects += 1;
          super.disconnect();
          resizeObservers.delete(this);
        }
      };
      globals.IntersectionObserver = class extends ShimIntersectionObserver {
        constructor(callback: ResizeCallback, options?: Record<string, unknown>) {
          super(callback, options);
          intersectionObservers.add(this);
        }
        override disconnect(): void {
          intersectionDisconnects += 1;
          super.disconnect();
          intersectionObservers.delete(this);
        }
      };

      originalMatchMedia = (window as unknown as Record<string, unknown>).matchMedia;
      (window as unknown as Record<string, unknown>).matchMedia = (query: string) =>
        createMediaQueryList(query);
    },

    reset(): void {
      resetRecords();
    },

    restore(): void {
      if (!installed) return;
      installed = false;
      resetRecords();
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          Element.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect,
        );
      }
      const globals = globalThis as unknown as Record<string, unknown>;
      globals.ResizeObserver = originalResizeObserver;
      globals.IntersectionObserver = originalIntersectionObserver;
      (window as unknown as Record<string, unknown>).matchMedia = originalMatchMedia;
    },

    setElementSize(element: Element, size: ElementSizeInput): void {
      sizes.set(element, { width: size.width, height: size.height });
    },

    resize(element: Element, size: ElementSizeInput): void {
      sizes.set(element, { width: size.width, height: size.height });
      notifyResize(element);
    },

    notifyResize,

    intersect(element: Element, isIntersecting: boolean): void {
      for (const observer of [...intersectionObservers]) {
        if (observer.disconnected || !observer.elements.has(element)) continue;
        observer.callback([intersectionEntryFor(element, isIntersecting)], observer);
      }
    },

    setDocumentHidden(hidden: boolean): void {
      documentPatched = true;
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
      document.dispatchEvent(new Event("visibilitychange"));
    },

    setReducedMotion(reduced: boolean): void {
      setMatches(REDUCED_MOTION_QUERY, reduced);
    },

    diagnostics(): BrowserShimDiagnostics {
      return {
        resizeObservers: resizeObservers.size,
        resizeDisconnects,
        intersectionObservers: intersectionObservers.size,
        intersectionDisconnects,
      };
    },
  };
}

let current: BrowserShims | null = null;

/** 取（或惰性创建）全局唯一的那份替身控制面。 */
export function browserShims(): BrowserShims {
  if (!current) current = createBrowserShims();
  return current;
}
