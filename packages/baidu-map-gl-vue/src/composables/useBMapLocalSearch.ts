/**
 * useBMapLocalSearch —— 本地检索（headless）
 *
 * 与其它服务 composable 的差别只有一处：`LocalSearch` **有构造期选项**（检索区域、页容量、
 * 起始页、绘制选项），而「构造字段变化才重建」是这一票（`#38`）明确要求的行为。因此：
 *
 * - 选项接受 `MaybeRefOrGetter`（对象整体、或每个字段各自给 ref / getter）；
 * - 只有**构造字段**（`location` / `pageCapacity` / `pageNum` / `renderOptions`）变化才丢弃并
 *   重建 SDK 实例；重复调用 `search()` 不会重建（实例是**有状态**的：结果与页码都在它上面）；
 * - 与官方 UI Kit 的分流：本 composable 只发**一次** headless 请求，不复制建议列表 / 搜索面板 /
 *   详情 UI，也不接管任何 UI 组件的事件（见 ADR `2026-09-14-service-lifecycle-and-local-search`）。
 *
 * 服务默认只依赖 Client（`<BMapProvider>` 子树即可用）；**要绘制结果就必须显式传 MapHandle**：
 * `renderOptions.map`（绘制出来的覆盖物所有权因此可验证，`clear()` / 卸载时由 Driver 收回）。
 */
import { toValue, watch, type MaybeRefOrGetter } from "vue";
import type { MapHandle } from "../driver/types/handles";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  LocalSearchInBoundsRequest,
  LocalSearchKeyword,
  LocalSearchNearbyRequest,
  LocalSearchOptions,
  LocalSearchResult,
  LocalSearchSearchOption,
} from "../driver/types/services";
import { BMapError } from "../core/errors/BMapError";
import { resolveMapContext } from "./resolveMapContext";
import {
  useBMapServiceTask,
  type BMapServiceInvokeContext,
} from "./useBMapServiceTask";
import { jsapiV4ServicesOf } from "../core/services";
import type { GeoPoint } from "./useBMapGeocoder";

/** 检索区域：城市名 / 领域 Point / 本库的 MapHandle。 */
export type LocalSearchLocation = string | GeoPoint | MapHandle;

export interface BMapLocalSearchRenderOptions {
  /**
   * 绘制目标（本库的 `MapHandle`，或它的 ref / getter）。不传 = 纯 headless，不绘制。
   *
   * 允许 `null`：`useBMap()` 返回的 `map` 是 `MapHandle | null`（地图尚未 ready 时为 `null`），
   * 直接把它传进来是最自然的写法——`null` 与 `undefined` 一样表示「现在没有绘制目标」。
   */
  map?: MaybeRefOrGetter<MapHandle | null | undefined>;
  panel?: string | HTMLElement;
  selectFirstResult?: boolean;
  autoViewport?: boolean;
  viewportOptions?: {
    noAnimation?: boolean;
    margins?: readonly number[];
    zoomFactor?: number;
  };
}

/**
 * composable 的构造期选项。
 *
 * 每个字段都可以是 `MaybeRefOrGetter`；只有它们**变化**才会重建实例。刻意**不接受**
 * `onSearchComplete` 之类的回调：结果经 `data` / `status` 表达，而 `onMarkersSet` 之类会把
 * 官方 raw 对象（`marker`）交出去——那属于 `./advanced` 的逃生口，不进公共 surface。
 */
export interface BMapLocalSearchOptions {
  /**
   * 检索区域。不传时取当前 `<BMap>` 的**地图实例**（上下文注入）；在没有地图的
   * `<BMapProvider>` 子树里必须显式给，否则以 `failed(BMAP_INVALID_ARGUMENT)` 结算。
   */
  location?: MaybeRefOrGetter<LocalSearchLocation | undefined>;
  pageCapacity?: MaybeRefOrGetter<number | undefined>;
  pageNum?: MaybeRefOrGetter<number | undefined>;
  renderOptions?: MaybeRefOrGetter<BMapLocalSearchRenderOptions | undefined>;
}

/** 一次检索操作（`execute` 的载荷；四种操作共用实例上的一条 `onSearchComplete`）。 */
export type BMapLocalSearchOperation =
  | { kind: "search"; keyword: LocalSearchKeyword; option?: LocalSearchSearchOption }
  | ({ kind: "nearby" } & LocalSearchNearbyRequest)
  | ({ kind: "inBounds" } & LocalSearchInBoundsRequest)
  | { kind: "page"; page: number };

/** 构造期快照：字段级比较用（`MapHandle` / Point 走身份或值，不做序列化）。 */
interface ConstructionSnapshot {
  location: LocalSearchLocation | undefined;
  pageCapacity: number | undefined;
  pageNum: number | undefined;
  render: {
    map: MapHandle | null | undefined;
    panel: string | HTMLElement | undefined;
    selectFirstResult: boolean | undefined;
    autoViewport: boolean | undefined;
    margins: string;
    zoomFactor: number | undefined;
    noAnimation: boolean | undefined;
  } | null;
}

function sameLocation(a: LocalSearchLocation | undefined, b: LocalSearchLocation | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if ("lng" in a && "lng" in b) return a.lng === b.lng && a.lat === b.lat;
  return false;
}

function sameConstruction(a: ConstructionSnapshot, b: ConstructionSnapshot): boolean {
  if (!sameLocation(a.location, b.location)) return false;
  if (a.pageCapacity !== b.pageCapacity || a.pageNum !== b.pageNum) return false;
  if (a.render === null || b.render === null) return a.render === b.render;
  return (
    a.render.map === b.render.map &&
    a.render.panel === b.render.panel &&
    a.render.selectFirstResult === b.render.selectFirstResult &&
    a.render.autoViewport === b.render.autoViewport &&
    a.render.margins === b.render.margins &&
    a.render.zoomFactor === b.render.zoomFactor &&
    a.render.noAnimation === b.render.noAnimation
  );
}

export function useBMapLocalSearch(options: MaybeRefOrGetter<BMapLocalSearchOptions> = {}) {
  const ctx = resolveMapContext();

  const readOptions = (): BMapLocalSearchOptions => toValue(options) ?? {};

  /** 当前构造期快照（每次都从可能变化的 ref / getter 里读一遍）。 */
  const snapshot = (): ConstructionSnapshot => {
    const current = readOptions();
    const render = toValue(current.renderOptions);
    return {
      location: toValue(current.location),
      pageCapacity: toValue(current.pageCapacity),
      pageNum: toValue(current.pageNum),
      render: render
        ? {
            map: toValue(render.map),
            panel: render.panel,
            selectFirstResult: render.selectFirstResult,
            autoViewport: render.autoViewport,
            margins: JSON.stringify(toValue(render.viewportOptions?.margins) ?? []),
            zoomFactor: render.viewportOptions?.zoomFactor,
            noAnimation: render.viewportOptions?.noAnimation,
          }
        : null,
    };
  };

  const task = useBMapServiceTask<
    LocalSearchResult[],
    ServiceHandle<"service:local-search">,
    [BMapLocalSearchOperation]
  >(ctx, {
      capability: "service.local-search" as const,
      create: (context: BMapServiceInvokeContext): ServiceHandle<"service:local-search"> => {
        const current = readOptions();
        const location = toValue(current.location) ?? context.map;
        if (location === undefined || location === null) {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            "useBMapLocalSearch: 缺少检索区域。在没有地图的 <BMapProvider> 子树里必须显式给 " +
              "`location`（城市名 / 坐标 / MapHandle）",
          );
        }
        const render = toValue(current.renderOptions);
        const pageCapacity = toValue(current.pageCapacity);
        const pageNum = toValue(current.pageNum);
        const settings: LocalSearchOptions = {};
        if (render) {
          const map = toValue(render.map);
          settings.renderOptions = {
            // 不传 `map` 就是纯 headless；传了必须是 MapHandle（Driver 会再校验一次）
            ...(map ? { map } : {}),
            ...(render.panel !== undefined ? { panel: render.panel } : {}),
            ...(render.selectFirstResult !== undefined
              ? { selectFirstResult: render.selectFirstResult }
              : {}),
            ...(render.autoViewport !== undefined ? { autoViewport: render.autoViewport } : {}),
            ...(render.viewportOptions ? { viewportOptions: render.viewportOptions } : {}),
          };
        }
        if (pageCapacity !== undefined) settings.pageCapacity = pageCapacity;
        if (pageNum !== undefined) settings.pageNum = pageNum;
        return jsapiV4ServicesOf(context.client).createLocalSearch(location, settings);
      },
      invoke: (
        context: BMapServiceInvokeContext,
        handle: ServiceHandle<"service:local-search">,
        operation: BMapLocalSearchOperation,
      ) => {
        const services = jsapiV4ServicesOf(context.client);
        switch (operation.kind) {
          case "search":
            return services.search(handle, operation.keyword, operation.option);
          case "nearby":
            return services.searchNearby(handle, {
              keyword: operation.keyword,
              center: operation.center,
              radius: operation.radius,
            });
          case "inBounds":
            return services.searchInBounds(handle, {
              keyword: operation.keyword,
              bounds: operation.bounds,
            });
          case "page":
            return services.gotoPage(handle, operation.page);
          default: {
            const exhaustive: never = operation;
            throw new BMapError(
              "BMAP_INVALID_ARGUMENT",
              `useBMapLocalSearch: 未覆盖的检索操作 ${JSON.stringify(exhaustive)}`,
            );
          }
        }
      },
      release: (context: BMapServiceInvokeContext, handle: ServiceHandle<"service:local-search">) => {
        jsapiV4ServicesOf(context.client).disposeLocalSearch(handle);
      },
    },
  );

  // 构造字段变化 ⇒ 丢弃旧实例（下一次调用重建）。用字段级比较而不是「响应式对象变没变」：
  // 选项可以是 getter，每次求值都会产生新对象，按引用比较会把「没变」判成「变了」。
  let previousConstruction = snapshot();
  watch(
    () => snapshot(),
    (next) => {
      if (sameConstruction(previousConstruction, next)) return;
      previousConstruction = next;
      task.invalidateService();
      task.reset();
    },
  );

  const search = (keyword: LocalSearchKeyword, option?: LocalSearchSearchOption) =>
    task.execute({ kind: "search", keyword, ...(option ? { option } : {}) });

  const searchNearby = (keyword: LocalSearchKeyword, center: string | GeoPoint, radius: number) =>
    task.execute({ kind: "nearby", keyword, center, radius });

  const searchInBounds = (
    keyword: LocalSearchKeyword,
    bounds: LocalSearchInBoundsRequest["bounds"],
  ) => task.execute({ kind: "inBounds", keyword, bounds });

  const gotoPage = (page: number) => task.execute({ kind: "page", page });

  /**
   * 清空检索结果：同时清掉 SDK 侧已产生的可见结果（地图标注 / 结果面板）与本地状态。
   *
   * 与 `cancel()` 的区别：`cancel()` 只放弃**在飞请求**的结果，已经画出来的结果不动；
   * `clear()` 是「把结果丢掉」。SDK 的 `clearResults` 没有回调，因此本方法同步完成。
   */
  const clear = (): void => {
    const client = ctx.client.value;
    const handle = task.peekService();
    if (client && handle) jsapiV4ServicesOf(client).clearLocalSearch(handle);
    task.reset();
  };

  return {
    data: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    search,
    searchNearby,
    searchInBounds,
    gotoPage,
    clear,
    cancel: task.cancel,
    reset: task.reset,
  };
}
