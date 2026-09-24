/**
 * 复用页面已有全局
 *
 * 「探测 → 校验 → 组装」是三个 v4 Provider 共用的第一步：页面里可能已经由宿主
 * 页面、其他构建产物或其他 Provider 加载好 `BMap`，此时不应该再插入 script，而是
 * 校验结构、解析版本来源后直接复用。抽在这里，避免三个 Provider 各写一份而漂移。
 */
import { createConsumerAbortError } from "../SdkRegistry";
import type { BMapLoadOptions } from "../url";
import { createLoadedJsapiV4 } from "./loaded";
import {
  assertJsapiV4Namespace,
  isRejectedJsapiV4Global,
  readJsapiV4Global,
  resolveExistingJsapiV4Version,
} from "./namespace";
import type { JsapiV4ProviderId, LoadedJsapiV4 } from "./types";

export interface ReuseExistingJsapiV4Input {
  readonly providerId: JsapiV4ProviderId;
  readonly options: BMapLoadOptions;
  readonly fingerprint: string;
  /**
   * 本次加载的**聚合** signal（`SdkRegistry` 在「最后一个消费者离开」时 abort 它）。
   *
   * 复用已有全局是**同步成功**的捷径，而 `SdkRegistry.start()` 是在 microtask 里调用 loader 的：
   * 若这里不看 signal，「调用方 load 后立刻 abort」的时序下，被取消的任务仍会在那个 microtask 里
   * 成功结算，把域记账抢到自己头上，与随后启动的另一份配置形成「两份同时成功、只记住一份」的
   * 不一致状态。看了 signal，声明 `cancellable: true` 的 Provider 才真正满足「abort 之后不会成功」。
   */
  readonly signal?: AbortSignal;
}

/**
 * 全局已就绪时返回结构化结果；全局尚不存在时返回 `undefined`，由调用方继续走
 * script 加载路径。命名空间不完整或版本不是 4.x 时，按来源分别处理：
 *
 * - **宿主提供**的全局不可用 → 直接抛错（不替宿主做决定）；
 * - **本库本次加载残留**的全局不可用（见 `markRejectedJsapiV4Global`）→ 返回 `undefined`，
 *   让调用方重新插入 script；否则一次失败就会永久挡住重试。
 */
export function reuseExistingJsapiV4(
  input: ReuseExistingJsapiV4Input,
): LoadedJsapiV4 | undefined {
  // 取消优先于复用：见 `ReuseExistingJsapiV4Input.signal`。
  if (input.signal?.aborted) throw createConsumerAbortError();

  const present = readJsapiV4Global();
  if (present === undefined) return undefined;

  try {
    const namespace = assertJsapiV4Namespace(present, input.providerId);
    const version = resolveExistingJsapiV4Version(
      namespace,
      input.providerId,
      input.options.version,
    );
    return createLoadedJsapiV4({
      providerId: input.providerId,
      mode: "existing-global",
      version: version.version,
      versionSource: version.source,
      options: input.options,
      fingerprint: input.fingerprint,
      namespace,
    });
  } catch (error) {
    if (isRejectedJsapiV4Global(present)) return undefined;
    throw error;
  }
}
