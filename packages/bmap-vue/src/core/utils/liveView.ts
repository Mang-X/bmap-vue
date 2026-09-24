/**
 * 地图状态读回的容错口径（M4-EVENTS / issue #28，从 `<Map>` 抽出为单一事实源）
 *
 * 「读回地图当前值」在两条路径上出现：受控视野的写入前判等（`<Map>`）与 `useMapStatus`
 * 的状态刷新。它们对**什么错误可以忽略**必须有同一个答案，否则同一张已销毁的地图上，
 * 一个组件告警、另一个静默。
 *
 * 只有两种情形算「这次读本来就不成立」：
 * - 资源已销毁（销毁后没有可读状态，写命令也只会抛同样的错）；
 * - 该能力在本引擎不可用（读不出、也没有可写的东西）。
 *
 * 其余 `BMapError`（`BMAP_SDK_CALL_FAILED` / `BMAP_INVALID_ARGUMENT` / `BMAP_INVALID_POINT` /
 * `BMAP_HANDLE_FOREIGN`）与非 `BMapError` 的编程错误**一律上抛**：把「读错」归零成「读不到」
 * 就是静默失效。
 */
import { BMapError, type BMapErrorCode } from "../errors/BMapError";

/** 读回地图状态时**允许**被忽略的错误码。 */
export const IGNORABLE_VIEW_READ_ERRORS: ReadonlySet<BMapErrorCode> = new Set([
  "BMAP_RESOURCE_DISPOSED",
  "BMAP_RUNTIME_DISPOSED",
  "BMAP_CAPABILITY_UNSUPPORTED",
]);

/**
 * 读回地图当前值；不可读时返回 `null`——**调用方必须显式处理 `null`，不要顺手写下一条命令**。
 *
 * 非 `BMapError`（`TypeError` 一类编程错误）与不在白名单里的 `BMapError` 都继续抛。
 */
export function readLiveView<T>(read: () => T): T | null {
  try {
    return read();
  } catch (e) {
    if (e instanceof BMapError && IGNORABLE_VIEW_READ_ERRORS.has(e.code)) return null;
    throw e;
  }
}
