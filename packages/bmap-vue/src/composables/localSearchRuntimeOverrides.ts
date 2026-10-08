/**
 * `useLocalSearch` 的运行期覆盖：**纯决策**（#165，评审 P1）
 *
 * 官方 `LocalSearch` 有一组**同步**成员（`setLocation` / `setPageCapacity` / `setPageNum`…）。
 * 本库在「新检索取代在飞检索」时会**重建实例**（回包归属依赖实例身份），因此同步 setter 除了
 * 作用在活实例上，还要记进一份「运行期覆盖」，重建时优先于声明式选项 —— 否则
 * 「setter 成功返回、紧随其后的 `search()` 却没应用」且毫无提示。
 *
 * 这里只放**可判定的纯逻辑**：某个覆盖值对**当前** Client 是否可用。住在 boundary 而非
 * composable 里，是因为 `<Map>` 在 provider prop 变化时**不会**重建 Client（实测
 * `ctx.client.value` 不变），端到端切 Client 在现有 harness 里造不出来；把判据纯化后可以
 * 直接喂合成句柄做行为级反例。
 */
import { HANDLE_BRAND } from "../driver/types/handles";

/** 运行期覆盖（`location` 需要额外记住它所属的 Client）。 */
export interface LocalSearchRuntimeOverrides<TLocation, TClient> {
  location?: TLocation;
  /** `location` 是 `MapHandle` 时，记录它**所属的 Client**（句柄不可跨 Client 使用）。 */
  locationClient?: TClient;
  pageCapacity?: number;
  pageNum?: number;
}

/** 是不是本库的 `MapHandle`（只看句柄品牌，不猜对象形状）。 */
export function isMapHandleLocation(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[HANDLE_BRAND] === "map"
  );
}

/**
 * 取**当前 Client 可用**的 `location` 覆盖；不可用时返回 `undefined`（调用方回退到声明式选项）。
 *
 * 为什么需要归属校验：`MapHandle` 绑定创建它的那个 Client，跨 Client 使用会被 Driver 拒绝
 * （`BMAP_HANDLE_FOREIGN`）。而 Client 切换**不触发**构造快照的 watch（声明式选项没变），
 * 若不校验，旧 Client 的句柄会被永久带进新 Client —— 检索从此**一直失败**，且此时没有活实例，
 * 调用方连 `setLocation()` 都修不了。
 *
 * 非句柄的 `location`（城市名 / `Point`）与 Client 无关，照常可用。
 */
export function usableLocationOverride<TLocation, TClient>(
  overrides: LocalSearchRuntimeOverrides<TLocation, TClient>,
  currentClient: TClient,
): TLocation | undefined {
  const { location } = overrides;
  if (location === undefined) return undefined;
  if (!isMapHandleLocation(location)) return location;
  return overrides.locationClient === currentClient ? location : undefined;
}

/**
 * 覆盖值 → 重建时应传给构造器的值：覆盖优先，否则退回声明式选项。
 *
 * `pageCapacity` / `pageNum` 是 Client 无关的标量，不需要归属校验（它们由 setter 写入
 * **SDK 生效值**：官方会把越界容量归一到 10、无效页码归一到 0，重放原始入参会与重建前矛盾）。
 */
export function preferOverride<T>(override: T | undefined, declared: T | undefined): T | undefined {
  return override ?? declared;
}
