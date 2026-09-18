/**
 * 瓦片加载的**观察面**（issue #97）
 *
 * ## 为什么需要它
 *
 * 官方这批网络图层（`TileLayer` 家族 / `XYZLayer` / `WMSLayer` / `WMTSLayer` / `RasterTileLayer`）
 * 的**类声明里没有任何事件成员**，issue #97 的 live 探针在真实 4.0 上进一步确认：即使这些实例都
 * 暴露了 `addEventListener`，十个候选事件名（`tileload` / `tileerror` / `tilesloaded` / `load` /
 * `error` …）在网络请求**确实发生过**（窗口内 12~20 次）的前提下**一个都没有触发**。
 * 所以「不发明未声明事件」这条口径有运行时依据，唯一可用的观察点就是官方的 **`tileLoadFunction`**。
 *
 * ## 它是「接管式」的（实测），所以本库要补上默认加载
 *
 * 探针在同一页面做了带**对照**的三臂实验（`scripts/probe-layer-events.mts`）：
 *
 * | 臂 | 配置 | 窗口内瓦片请求 |
 * | --- | --- | --- |
 * | 对照 | 不设 `tileLoadFunction` | **12** |
 * | 第二臂 | 设了它，但函数里什么都不做 | **0**（它被调用了 12 次） |
 * | 第三臂 | 设了它，函数里自己赋 `tile.src = url` | **12**（被调用 12 次） |
 *
 * 结论：**设了它，SDK 就不再自己加载**；因此本库的观察面必须在内部完成那次默认加载
 * （`tile.src = url`），否则用户会**静默失去瓦片**。第三臂证明这样能恢复请求。
 *
 * ## 它做了什么
 *
 * 1. 每次 SDK 要求加载一张瓦片时，先回调观察者（`onRequest`）；
 * 2. 给该图片元素挂一次性的 `load` / `error` 监听（按**元素**去重，见下面的口径），
 *    触发时回调 `onLoaded` / `onError`；
 * 3. 把这次加载**交给**实现者：调用方给了自己的 `tileLoadFunction` 就用它（接管），
 *    否则由本库完成默认加载（`tile.src = url`）。
 *
 * 「观察」与「接管」是正交的：两者可以同时给，此时还在旁边观察、加载由调用方负责。
 *
 * ## 口径（刻意写清楚，别让调用方猜）
 *
 * - **`onRequest` 是「SDK 要求加载这张瓦片」**，不是「加载成功」。想数请求次数用它。
 * - **`onLoaded` / `onError` 以图片元素为单位**：回调里回传的 `url` 是**元素当前的 `src`**，
 *   而不是发起时记下的字符串。官方没有暴露「这一次请求的身份」，SDK 复用元素时本库**不做归属推断**
 *   （那需要未声明的面）——需要逐请求归因的话，请用 `onRequest` 的顺序 + 自己的请求计数。
 * - **`onError` 不带失败原因**：DOM 的 `error` 事件不提供原因（CORS / 404 / 超时在浏览器侧同形）。
 *   可诊断的是「哪个 URL 失败了、失败了几次」，不是「为什么失败」。
 * - **元素归属**：结果监听按**元素**只挂一次（不随加载次数堆积），但每块元素**当前归谁观察**
 *   以**最近一次**向它发起加载的包装器为准。所以图层重建 / 多个网络图层复用同一块元素时，
 *   事件回调的是**当前**那个观察者，而不是第一个注册者。
 * - **观察者回调抛错不会影响加载**：本库捕获并 `devWarn`，加载照常继续。
 *
 * ## 与 `tileLoadFunction` 的关系
 *
 * `tileLoadObserver` 是**本库的观察面**；`tileLoadFunction` 是**官方的接管点**。
 * 只给观察者时，本库替你完成默认加载；两者都给时，本库只在旁边观察，加载完全由你的函数负责
 * （包括「什么都不做 ⇒ 瓦片不加载」这种后果）。
 */
import { devWarn } from "../../core/logger";

/** 一次瓦片加载的读数。 */
export interface TileLoadInfo {
  /** 瓦片地址。`onRequest` 里是 SDK 交来的 URL；`onLoaded` / `onError` 里是元素当前的 `src`。 */
  readonly url: string;
  /** 承载这次加载的图片元素（由 SDK 提供）。 */
  readonly tile: HTMLImageElement;
}

/** 瓦片加载的观察者。三个回调都可选；只给需要的那个即可。 */
export interface TileLoadObserver {
  /** 每次 SDK 要求加载一张瓦片时调用（**请求**，不代表成功）。 */
  onRequest?(info: TileLoadInfo): void;
  /** 该图片元素加载成功时调用。 */
  onLoaded?(info: TileLoadInfo): void;
  /** 该图片元素加载失败时调用（不含失败原因，见文件头的口径）。 */
  onError?(info: TileLoadInfo): void;
}

/** 官方 `tileLoadFunction` 的形状。 */
export type TileLoadFunction = (tile: HTMLImageElement, url: string) => void;

/** 观察者的三个回调都缺省时的取值。 */
export interface TileLoadObserverInput {
  readonly observer?: TileLoadObserver | undefined;
  readonly takeover?: TileLoadFunction | undefined;
}

/** 本库在观察面里完成的**默认加载**：把 URL 交给图片元素（实测能恢复与不设钩子时相同的请求数）。 */
export function defaultTileLoad(tile: HTMLImageElement, url: string): void {
  tile.src = url;
}

/**
 * 每块元素**当前归谁观察**。
 *
 * 为什么是「归属」而不是「登记过没有」：SDK 可能复用同一块元素（图层重建、或多个网络图层共用）。
 * 若只在第一次注册时把观察者 getter 捕获进闭包，事件就会**永远**回调**第一个**包装器的观察者
 * ——后来的拥有者收不到结果，而已卸载的组件反而还在被回调。
 *
 * 现在的语义：**监听器按元素只挂一次**（不随加载次数堆积），但每次加载都把归属更新到**当前**
 * 包装器；事件发生时按归属取观察者。
 */
const tileOwners = new WeakMap<HTMLImageElement, () => TileLoadObserver | undefined>();

function reportOutcome(tile: HTMLImageElement, hook: "onLoaded" | "onError"): void {
  const observer = tileOwners.get(tile)?.();
  if (!observer) return;
  try {
    observer[hook]?.({ url: tile.src, tile });
  } catch (error) {
    // 观察者抛错不得影响加载：这是「在旁边看」，不是链路的一部分。
    devWarn(
      `[layer] tileLoadObserver.${hook} 抛错，已忽略（瓦片加载不受影响）：${
        (error as Error)?.message ?? String(error)
      }`,
    );
  }
}

function observeOutcome(tile: HTMLImageElement, owner: () => TileLoadObserver | undefined): void {
  if (!tileOwners.has(tile)) {
    tile.addEventListener("load", () => reportOutcome(tile, "onLoaded"));
    tile.addEventListener("error", () => reportOutcome(tile, "onError"));
  }
  // **后来的包装器接管归属**：它才是这块元素当前的拥有者。
  tileOwners.set(tile, owner);
}

/**
 * 造一个可以交给官方 `tileLoadFunction` 的函数；**两个输入都没有时返回 `undefined`**。
 *
 * 返回 `undefined` 是要紧的：那表示「本库不表态」，SDK 走它自己的默认加载路径——没有观察需求时
 * 本库不得改变任何行为。反过来，调用方从「不给」变成「给观察者」会让这个 option 由缺席变为一个
 * 函数，重建指纹随之变化 ⇒ 图层重建一次并把包装装上（这正是我们要的收敛路径）。
 *
 * `get()` 每次调用都重新读一遍，因此换一个观察者 / 换一个接管函数都**立即生效**，不需要重建。
 */
export function createTileLoadFunction(
  get: () => TileLoadObserverInput,
): TileLoadFunction | undefined {
  const initial = get();
  if (!initial.observer && !initial.takeover) return undefined;

  return (tile, url) => {
    const current = get();
    if (current.observer) {
      try {
        current.observer.onRequest?.({ url, tile });
      } catch (error) {
        devWarn(
          `[layer] tileLoadObserver.onRequest 抛错，已忽略（瓦片加载不受影响）：${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
      observeOutcome(tile, () => get().observer);
    }
    if (typeof current.takeover === "function") current.takeover(tile, url);
    else defaultTileLoad(tile, url);
  };
}
