/**
 * useLocalSearch —— 本地检索（headless）
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
 *
 * **并发语义（PR #89 评审后定稿）**：官方只承诺**单次多关键字检索内部**的顺序，**没有**承诺多次
 * 请求之间的回调顺序，`keyword` 也不是请求身份——因此回包归属只能靠**实例身份**：
 *
 * - 新 `search*` 取代在飞检索时，本 composable **废弃旧实例**（释放它 → 公开的 `clearResults()`
 *   顺带清掉它画出的标注），并为新检索建一个新实例。旧的迟到回包只会落到旧实例上，不会污染新结果；
 * - `cancel()` / 超时之后，实例**不再复用**（那时 SDK 侧可能仍有回包在路上）：下一次 `search*` 建新实例；
 * - `gotoPage` 是对**上一条结果**的延续，因此在「上一次还没结算」或「实例已过期」时**被拒绝**
 *   （`failed` + 说明），而不是让 SDK 空转等超时。
 */
import { toValue, watch, type MaybeRefOrGetter } from "vue";
import type { BMapClient } from "../client/types";
import type { MapHandle } from "../driver/types/handles";
import {
  isMapHandleLocation,
  usableLocationOverride,
  type LocalSearchRuntimeOverrides,
} from "./localSearchRuntimeOverrides";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  LocalSearchInBoundsRequest,
  LocalSearchKeyword,
  LocalSearchNearbyRequest,
  LocalSearchOptions,
  LocalSearchResult,
  LocalSearchSearchOption,
  ViewportOptions,
} from "../driver/types/services";
import { BMapError } from "../core/errors/BMapError";
import { resolveInternalMapContext } from "./resolveMapContext";
import { useExclusiveServiceTask, type ServiceInvokeContext } from "./serviceTask";
import { jsapiV4ServicesOf } from "../core/services";
import type { GeoPoint } from "./useGeocoder";

/** 检索区域：城市名 / 领域 Point / 本库的 MapHandle。 */
export type LocalSearchLocation = string | GeoPoint | MapHandle;

export interface BMapLocalSearchRenderOptions {
  /**
   * 绘制目标（本库的 `MapHandle`，或它的 ref / getter）。不传 = 纯 headless，不绘制。
   *
   * 允许 `null`：`useMap()` 返回的 `map` 是 `MapHandle | null`（地图尚未 ready 时为 `null`），
   * 直接把它传进来是最自然的写法——`null` 与 `undefined` 一样表示「现在没有绘制目标」。
   */
  map?: MaybeRefOrGetter<MapHandle | null | undefined>;
  panel?: string | HTMLElement;
  selectFirstResult?: boolean;
  autoViewport?: boolean;
  /** 视野计算选项（与路线服务共用官方 `ViewportOptions` 的同一份投影） */
  viewportOptions?: ViewportOptions;
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
   * 检索区域。不传时取当前 `<Map>` 的**地图实例**（上下文注入）；在没有地图的
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
    enableAnimation: boolean | undefined;
    /** `callback` 走**身份**比较：它只有构造期一条路（官方无对应 setter），换函数就得重建实例。 */
    callback: (() => void) | undefined;
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
    a.render.enableAnimation === b.render.enableAnimation &&
    a.render.callback === b.render.callback
  );
}

export function useLocalSearch(options: MaybeRefOrGetter<BMapLocalSearchOptions> = {}) {
  const ctx = resolveInternalMapContext();

  const readOptions = (): BMapLocalSearchOptions => toValue(options) ?? {};

  /**
   * **运行期覆盖**（官方同步 setter 写入）。
   *
   * 为什么需要它：`LocalSearch` 的实例在「检索取代在飞检索」时会被**重建**（`supersede:
   * "recreate"`，因为回包归属依赖实例身份）。若 `setLocation` / `setPageCapacity` /
   * `setPageNum` 只改活实例，紧随其后的 `search()` 会用新实例、而新实例的构造参数仍来自
   * 声明式选项 —— 于是「setter 成功返回、下一次检索却没应用」且毫无提示。
   *
   * 规则：**运行期覆盖优先于声明式选项**，直到声明式选项自身变化（见下面的 watch）——
   * 那时覆盖整份作废，避免「改了 ref 却不生效」这种反向困惑。
   *
   * 刻意是**普通变量**而不是 ref / reactive：setter 已经作用在活实例上，不该再触发构造快照
   * 的 watch（那会立刻把刚设好的实例丢掉重建）。
   */
  let runtimeOverrides: LocalSearchRuntimeOverrides<LocalSearchLocation, BMapClient> = {};

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
            enableAnimation: render.viewportOptions?.enableAnimation,
            callback: render.viewportOptions?.callback,
          }
        : null,
    };
  };

  const task = useExclusiveServiceTask<
    LocalSearchResult[],
    ServiceHandle<"service:local-search">,
    [BMapLocalSearchOperation]
  >(ctx, {
      capability: "service.local-search" as const,
      create: (context: ServiceInvokeContext): ServiceHandle<"service:local-search"> => {
        const current = readOptions();
        // 运行期覆盖优先（见 `runtimeOverrides` 的说明）：重建后设置仍然生效。
        // 但 `MapHandle` 覆盖只在**同一个 Client** 上有效：跨 Client 的句柄会被 Driver 拒绝，
        // 那是「检索永远失败且无法自救」，不如回退到当前声明式 location。
        const overrideLocation = usableLocationOverride(
          runtimeOverrides,
          // 可选成员：自定义 Driver 不实现它时不会走到这里（`setLocation(MapHandle)` 已在
          // 调用当场拒绝），因此 `undefined` 回退成 `false` 是安全的兜底。
          (handle) => context.client.driver.isMapHandleLive?.(handle as MapHandle) ?? false,
        );
        if (runtimeOverrides.location !== undefined && overrideLocation === undefined) {
          // 失效即清理：不继续持有旧 MapHandle + Client 的强引用。
          delete runtimeOverrides.location;
        }
        const location = overrideLocation ?? toValue(current.location) ?? context.map;
        if (location === undefined || location === null) {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            "useLocalSearch: 缺少检索区域。在没有地图的 <BMapProvider> 子树里必须显式给 " +
              "`location`（城市名 / 坐标 / MapHandle）",
          );
        }
        const render = toValue(current.renderOptions);
        const pageCapacity = runtimeOverrides.pageCapacity ?? toValue(current.pageCapacity);
        const pageNum = runtimeOverrides.pageNum ?? toValue(current.pageNum);
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
        context: ServiceInvokeContext,
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
              `useLocalSearch: 未覆盖的检索操作 ${JSON.stringify(exhaustive)}`,
            );
          }
        }
      },
      release: (client: BMapClient, handle: ServiceHandle<"service:local-search">) => {
        jsapiV4ServicesOf(client).disposeLocalSearch(handle);
      },
      // 归属依赖实例身份（见文件头）：检索类调用取代在飞调用时换新实例；翻页必须落在同一条
      // 结果集上，因此在「未结算 / 实例已过期」时拒绝，而不是让它空转。
      supersede: (operation: BMapLocalSearchOperation) =>
        operation.kind === "page" ? "refuse" : "recreate",
      refuseMessage:
        "上一次检索还没结算（或它的结果已被清空）：翻页是对同一条结果集的延续，此时没有意义；" +
        "请等它结算，或重新 search()",
      // 复用缓存实例**之前**再复核一次：`await whenReady()` 期间地图可能已被销毁
      // （第七轮评审 P2 的 TOCTOU）。同步入口的 `dropDeadMapLocationOverride()` 挡不住这个窗口。
      isCachedHandleUsable: (_handle, context) => {
        const override = runtimeOverrides.location;
        if (!isMapHandleLocation(override)) return true;
        return context.client.driver.isMapHandleLive?.(override as MapHandle) ?? false;
      },
      cachedHandleInvalidMessage:
        "上一次检索绑定的地图已销毁：翻页是对同一条结果集的延续，此时没有意义；请重新 search()",
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
      // 声明式选项变了：运行期覆盖整份作废（否则「改了 ref 却不生效」）。
      runtimeOverrides = {};
      task.invalidateService();
      task.reset();
    },
  );

  /**
   * 发起新检索**之前**复核运行期 `MapHandle` 覆盖是否还活着。
   *
   * 为什么不能只在 `create()` 里查（第六轮评审 P2）：`create()` 只在**重建**时被调用，而
   * 「上一次检索已结算 → 再 search」走的是 `instanceChannel.acquire()` 的**缓存复用**路径
   * （`cached.client === client && !instanceStale` 直接返回旧句柄），既不会重建、也不会查存活。
   * 于是地图在这两次检索之间被销毁时，新检索会打到一个 `setLocation` 已指向死地图的旧实例上。
   *
   * 这里主动把失效覆盖丢掉并让缓存实例过期（下一次 `execute` 重建并退回声明式 location）
   * —— 与「运行期设置活过重建」互补：**死的设置不该活过重建**。
   */
  const dropDeadMapLocationOverride = (): void => {
    if (!isMapHandleLocation(runtimeOverrides.location)) return;
    const driver = ctx.client.value?.driver;
    const isLive = driver?.isMapHandleLive;
    const alive =
      typeof isLive === "function" &&
      isLive.call(driver, runtimeOverrides.location as MapHandle);
    if (alive) return;
    delete runtimeOverrides.location;
    // 缓存实例的检索区域已经指向死地图：让它过期，下一次 acquire 会重建。
    task.invalidateService();
  };

  const search = (keyword: LocalSearchKeyword, option?: LocalSearchSearchOption) => {
    dropDeadMapLocationOverride();
    return task.execute({ kind: "search", keyword, ...(option ? { option } : {}) });
  };

  const searchNearby = (keyword: LocalSearchKeyword, center: string | GeoPoint, radius: number) => {
    dropDeadMapLocationOverride();
    return task.execute({ kind: "nearby", keyword, center, radius });
  };

  const searchInBounds = (
    keyword: LocalSearchKeyword,
    bounds: LocalSearchInBoundsRequest["bounds"],
  ) => {
    dropDeadMapLocationOverride();
    return task.execute({ kind: "inBounds", keyword, bounds });
  };

  const gotoPage = (page: number) => task.execute({ kind: "page", page });

  /**
   * 清空检索结果：清掉 SDK 侧已画出的标注 / 结果面板与本地状态。
   *
   * 实现上是**释放当前实例**（`disposeLocalSearch` → 公开的 `clearResults()`）：LocalSearch 的
   * 结果集与绘制物都挂在实例上，丢弃实例是唯一能同时清干净两者、又不留下「实例还活着但结果已被
   * 清掉」这种中间态的入口（那种中间态下的 `gotoPage` 只会空转到超时）。下一次 `search()` 会
   * 建一个新实例。SDK 侧没有回调，因此本方法同步完成。
   *
   * 与 `cancel()` 的区别：`cancel()` 只放弃**在飞请求**的结果，已经画出来的结果不动。
   */
  const clear = (): void => {
    task.invalidateService();
    task.reset();
  };

  /**
   * 官方的**同步**成员（`LocalSearch#getPageCapacity` / `setPageCapacity` / `getPageNum` /
   * `setPageNum` / `clearSelected` / `setLocation`）走 `withHandle` 通道：它们不产生异步结果，
   * 用 `execute()` 表达会把官方语义改成「发一次调用」，`get*` 更是表达不出来。
   *
   * **先 `search()` 一次才有活实例**：本库不会为了设一个分页容量而顺手创建 SDK 实例。
   * 没有实例时这些方法抛 `BMAP_RESOURCE_DISPOSED`；用 `hasInstance()` 可以先问再做。
   */
  const withService = <R>(fn: (services: ReturnType<typeof jsapiV4ServicesOf>, handle: ServiceHandle<"service:local-search">) => R): R =>
    task.withHandle((handle, context) => fn(jsapiV4ServicesOf(context.client), handle));

  /** 当前是否有可操作的活实例（`withService` 系方法是否可用）。 */
  const hasInstance = (): boolean => task.currentInstanceExists();

  /**
   * 改页容量（官方 `setPageCapacity`）。
   *
   * 与 `gotoPage` 的区别：后者是**翻页动作**（会请求第 N 页数据、可能失败），本方法是**设置**
   * 每页容量，官方同步生效、不产生请求。
   */
  const setPageCapacity = (capacity: number): void => {
    // 记进覆盖：实例被取代重建时设置仍然生效（否则下一次 search 会悄悄用回旧值）。
    // 记的是**SDK 生效值**（官方会把越界值归一到 10），不是原始入参 —— 否则重建时把 200
    // 当构造参数传下去，新实例的 getPageCapacity() 会与重建前的 10 矛盾。
    runtimeOverrides.pageCapacity = withService((services, handle) => {
      services.setLocalSearchPageCapacity(handle, capacity);
      return services.getLocalSearchPageCapacity(handle);
    });
  };

  /** 读页容量（官方 `getPageCapacity`）。 */
  const getPageCapacity = (): number =>
    withService((services, handle) => services.getLocalSearchPageCapacity(handle));

  /** 设当前页码（官方 `setPageNum`）；是**设置**而不是翻页请求。 */
  const setPageNum = (pageNum: number): void => {
    // 同上：记 SDK 生效值（官方把无效值归一到 0），而不是原始入参。
    runtimeOverrides.pageNum = withService((services, handle) => {
      services.setLocalSearchPageNum(handle, pageNum);
      return services.getLocalSearchPageNum(handle);
    });
  };

  /** 读当前页码（官方 `getPageNum`）。 */
  const getPageNum = (): number =>
    withService((services, handle) => services.getLocalSearchPageNum(handle));

  /** 清掉当前选中项（官方 `clearSelected`），不影响结果集。 */
  const clearSelected = (): void =>
    withService((services, handle) => services.clearLocalSearchSelected(handle));

  /** 改检索区域（官方 `setLocation`）；与构造期的 `location` 同一套归一。 */
  const setLocation = (location: LocalSearchLocation): void => {
    if (isMapHandleLocation(location)) {
      const driver = ctx.client.value?.driver;
      const isLive = driver?.isMapHandleLive;
      if (typeof isLive !== "function") {
        throw new BMapError(
          "BMAP_CAPABILITY_UNSUPPORTED",
          "setLocation(MapHandle)：当前 Driver 不提供 isMapHandleLive，无法验证地图句柄是否仍可用。" +
            "请改用城市名 / 坐标，或使用内置的 jsapi-v4 Driver —— 本库不会「先接受、到重建时才静默丢弃」。",
        );
      }
      if (!isLive.call(driver, location as MapHandle)) {
        throw new BMapError(
          "BMAP_RESOURCE_DISPOSED",
          "setLocation(MapHandle)：该地图句柄已不可用（已进入销毁，或不属于当前 Client）",
        );
      }
    }
    withService((services, handle) => services.setLocalSearchLocation(handle, location));
    runtimeOverrides.location = location;
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
    setPageCapacity,
    getPageCapacity,
    setPageNum,
    getPageNum,
    clearSelected,
    setLocation,
    hasInstance,
    clear,
    cancel: task.cancel,
    reset: task.reset,
  };
}
