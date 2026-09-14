/**
 * 服务任务的**状态口径**（M7-SERVICE-CORE / issue #38）
 *
 * 这一层只放「纯函数 + 类型」，不依赖 Vue、也不引用任何 SDK：composable 与测试共用同一份
 * 口径，避免「状态机」在六个 composable 里各写一遍。
 *
 * 与 Driver 的 `ServiceCallStatus` 的关系是**加两个非终态**而不是另立一套：
 *
 * | 状态 | 含义 |
 * | --- | --- |
 * | `idle` | 尚未发起（或 `reset()` 之后） |
 * | `loading` | 调用在飞 |
 * | `success` | 拿到结果（结果可能为空列表——「查无结果」是成功，见下） |
 * | `empty` | 没有结果或服务当前不可用（官方没有公开原因时的合并结论） |
 * | `failed` | 有公开原因（SDK 状态码 / 参数非法 / 前置条件不满足） |
 * | `timeout` | 适配器超时（SDK 可能永不回调） |
 * | `canceled` | 逻辑取消（SDK 没有取消入口，因此只承诺「放弃结果」） |
 * | `unsupported` | 当前引擎没有这个能力：**没有发起任何请求**，这一点与 `failed` 必须区分 |
 *
 * 「查无结果」与「服务不可用」在公开面上不可区分（R25-C / #72 的结论），两者都是 `empty`；
 * 而**拿到了合法回包但结果为空**（`LocalSearch` 的 `pois: []`）仍然是 `success`——调用方
 * 通过 `data` 的长度区分，比把它压成 `empty` 更有信息量。
 */
import { BMapError } from "../errors/BMapError";
import type {
  ServiceCallStatus,
  ServiceErrorInfo,
  ServiceResult,
} from "../../driver/types/services";

/** 终态集合（与 Driver 的 `ServiceCallStatus` 一一对应）。 */
export const SERVICE_CALL_STATUSES = [
  "success",
  "empty",
  "failed",
  "timeout",
  "canceled",
] as const satisfies readonly ServiceCallStatus[];

/** 服务任务在 UI 上的状态：终态 + 两个非终态 + `unsupported`。 */
export type BMapServiceStatus =
  | "idle"
  | "loading"
  | ServiceCallStatus
  | "unsupported";

/**
 * 未知错误 → `ServiceErrorInfo`。
 *
 * 为什么需要它：`execute()` 的两条路径都会抛出**非 `ServiceResult`** 的错误——
 * ① `whenReady()` 失败（SDK 加载失败/被取消）；② 句柄守卫（`BMAP_HANDLE_FOREIGN` /
 * `BMAP_INVALID_ARGUMENT`）与 `create*` 的 `BMAP_SDK_CALL_FAILED`。这些都要归一成同一份
 * 载荷，否则调用方要同时处理 `error: ServiceErrorInfo` 与 `catch (e: unknown)` 两套。
 */
export function toServiceErrorInfo(error: unknown): ServiceErrorInfo {
  if (error instanceof BMapError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: null, message: error.message };
  return { code: null, message: String(error) };
}

/** 构造一个「已经结算」的结果载荷（`unsupported` / 取消 / 归一化失败时用）。 */
export function settledServiceResult<T>(
  status: ServiceCallStatus,
  error: ServiceErrorInfo | null = null,
): ServiceResult<T> {
  return Object.freeze({ status, data: null, error, sdkStatus: null });
}
