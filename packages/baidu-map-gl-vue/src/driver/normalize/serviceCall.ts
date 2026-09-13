/**
 * 服务调用适配器（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 把 SDK 的 callback 风格服务调用收敛成**恒 resolve** 的 `ServiceResult`：
 *
 * - **不 reject**：业务不需要为「服务失败」再写一层 try/catch，失败/超时/取消都表达成
 *   `status`（`failed` / `timeout` / `canceled`）；
 * - **`empty` 是合并结论**：百度服务失败时经常只回 `null`（配额 302 / Referer 限制），而官方没有
 *   公开的错误码入口（错误码在私有回调表里，本库不嗅探——R25-C / #72）。因此「查无结果」与
 *   「服务当前不可用」都走 `empty`，`failed` 只留给能给出**公开**原因的调用（SDK 公开状态码、
 *   参数非法、前置条件不满足）。调用方用 `empty` / `failed` 区分的是「有没有公开原因」；
 * - **先到者胜**：任何一次结算之后再来的回调都是迟到回包，一律忽略（真实服务在超时后
 *   仍会回包，不设这道门就会把过期结果写回去）；
 * - **超时**：回调永远不来（SDK 失败时的常见表现）时给出 `timeout`，而不是永久挂起；
 * - **取消**：`cancel()` 立刻以 `canceled` 结算并执行 `onCancel`，之后的回调被忽略。
 *   SDK 侧大多没有取消入口（JSONP 发出去就收不回），因此这里只承诺「放弃结果 + 解绑」。
 *
 * 本模块不认识任何 SDK 成员（只在 `start` 回调里由 Facet Driver 提供），因此两个引擎
 * 都能复用；v4 的 Service Facet 是当前唯一消费者。
 */
import type {
  ServiceCall,
  ServiceCallOptions,
  ServiceCallSettle,
  ServiceResult,
} from "../types/services";

/** 服务调用默认超时：SDK 失败时可能永不回调。与 composable 层的 `SERVICE_TIMEOUT_MS` 同值。 */
export const SERVICE_CALL_TIMEOUT_MS = 15000;

function freeze<T>(result: ServiceResult<T>): ServiceResult<T> {
  return Object.freeze(result);
}

export function createServiceCall<T>(
  start: (settle: ServiceCallSettle<T>) => void,
  options: ServiceCallOptions,
): ServiceCall<T> {
  const { label, timeoutMs = SERVICE_CALL_TIMEOUT_MS, onCancel } = options;

  let resolveResult!: (result: ServiceResult<T>) => void;
  const result = new Promise<ServiceResult<T>>((resolve) => {
    resolveResult = resolve;
  });

  let pending = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** 唯一结算口：先到者胜（迟到回调 / 重复结算 / 取消后回包都在这里被挡掉）。 */
  const finish = (value: ServiceResult<T>): void => {
    if (!pending) return;
    pending = false;
    clearTimer();
    resolveResult(freeze(value));
  };

  const settle: ServiceCallSettle<T> = {
    success(data, sdkStatus = null) {
      finish({ status: "success", data, error: null, sdkStatus });
    },
    empty(sdkStatus = null) {
      finish({ status: "empty", data: null, error: null, sdkStatus });
    },
    failed(error, sdkStatus = null) {
      finish({ status: "failed", data: null, error, sdkStatus });
    },
  };

  timer = setTimeout(() => {
    finish({
      status: "timeout",
      data: null,
      error: { code: "BMAP_SERVICE_FAILED", message: `${label} timed out after ${timeoutMs}ms` },
      sdkStatus: null,
    });
  }, timeoutMs);

  try {
    start(settle);
  } catch (error) {
    // SDK 调用同步抛错（成员缺失 / 参数非法）时也要走结果通道，
    // 否则「绝不 reject」这条契约就只对异步路径成立。
    settle.failed({
      code: "BMAP_SERVICE_FAILED",
      message: `${label} failed: ${(error as Error)?.message ?? String(error)}`,
    });
  }

  return {
    result,
    cancel() {
      if (!pending) return;
      finish({ status: "canceled", data: null, error: null, sdkStatus: null });
      onCancel?.();
    },
  };
}
