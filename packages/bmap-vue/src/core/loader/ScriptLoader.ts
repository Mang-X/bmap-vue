/**
 * ScriptLoader
 *
 * 进程级 script 加载器（M3A1-01 / issue #16）：
 * - 模式由显式的 `mode: "load" | "jsonp"` 决定，不再隐式推断；
 * - 相同配置并发调用共用一个底层 `<script>`（SharedLoadTask）；
 * - 每个消费者使用独立 `AbortSignal`，取消互不影响；
 * - 失败 / 超时 / 取消后移除缓存，允许重试；
 * - SSR 安全（不执行加载）。
 *
 * 资源释放见 `SharedLoadTask`：全路径清理 callback、abort listener、timer 与 script。
 */
import { BMapError } from "../errors/BMapError";
import { SharedLoadTask } from "./SharedLoadTask";
import type { ScriptLoaderBaseOptions, ScriptLoaderOptions } from "./SharedLoadTask";
import { DEFAULT_CALLBACK_PARAM, resolveBrowserUrl, type BMapLoadOptions } from "./url";

export type {
  ScriptJsonpModeOptions,
  ScriptLoadModeOptions,
  ScriptLoaderBaseOptions,
  ScriptLoaderMode,
  ScriptLoaderOptions,
  SharedLoadTaskHooks,
  SharedLoadTaskState,
} from "./SharedLoadTask";
export { SharedLoadTask } from "./SharedLoadTask";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * 逻辑缓存 key：只区分 src / 模式 / 完整性策略。
 *
 * `src` 经 `resolveBrowserUrl` 归一，保证相对路径与绝对路径指向同一配置时去重。
 * 仅在 `jsonp` 模式下剔除 **Loader 自己管理**的回调参数——它的取值是每次加载的
 * 实现细节；`load` 模式下 `callback` 只是普通查询参数，必须完整保留。
 * 自定义 `callbackParam` 时只剔除该参数名，`callback` 等其它参数一律保留。
 */
export function getScriptKey(options: ScriptLoaderOptions): string {
  let src = options.src;
  try {
    const url = resolveBrowserUrl(src);
    if (options.mode === "jsonp") {
      url.searchParams.delete(options.callbackParam ?? DEFAULT_CALLBACK_PARAM);
    }
    src = url.toString();
  } catch {
    // 保留原 src，让非法 URL 继续由浏览器/加载流程报告错误。
  }
  return JSON.stringify({
    src,
    mode: options.mode,
    integrity: options.integrity,
    crossOrigin: options.crossOrigin,
  });
}

/** script 级运行时配置（不含 src / 就绪信号），Provider 之间共用同一映射。 */
export type ScriptRuntimeOptions = Pick<
  ScriptLoaderBaseOptions,
  "timeout" | "nonce" | "integrity" | "crossOrigin" | "referrerPolicy"
>;

/** 把 `BMapLoadOptions` 上 script 级配置映射到 Loader 选项。 */
export function scriptOptions(options: BMapLoadOptions): ScriptRuntimeOptions {
  return {
    timeout: options.timeout,
    nonce: options.nonce,
    integrity: options.integrity,
    crossOrigin: options.crossOrigin,
    referrerPolicy: options.referrerPolicy,
  };
}

export class ScriptLoader {
  /** 进行中的共享任务（创建即登记，保证并发同配置只创建一个 script）。 */
  private readonly inFlight = new Map<string, SharedLoadTask>();
  /** 成功结果缓存：全局 SDK 只需加载一次。 */
  private readonly completed = new Map<string, unknown>();

  load(options: ScriptLoaderOptions, signal?: AbortSignal): Promise<unknown> {
    if (!isBrowser()) {
      return Promise.reject(
        new BMapError("BMAP_SDK_LOAD_FAILED", "SDK load requires a browser environment"),
      );
    }
    // 已取消的 signal 优先于成功缓存：命中缓存也必须拒绝当前消费者，
    // 但不清理共享缓存（其它消费者仍可复用）。
    if (signal?.aborted) {
      return Promise.reject(
        new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted before start"),
      );
    }
    const key = getScriptKey(options);
    if (this.completed.has(key)) {
      return Promise.resolve(this.completed.get(key));
    }

    let task = this.inFlight.get(key);
    if (!task) {
      task = new SharedLoadTask(options, {
        onSuccess: (result) => {
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
          this.completed.set(key, result);
        },
        onFailure: () => {
          // 失败缓存移除：不污染下一次加载。
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
        },
        onCancelled: () => {
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
        },
      });
      // 先登记 in-flight，再执行真实加载。
      this.inFlight.set(key, task);
    }
    return task.subscribe(signal);
  }

  /** 移除某配置的成功缓存（测试 / 强制重新加载用）。 */
  clear(key: string): void {
    this.completed.delete(key);
    this.inFlight.delete(key);
  }

  /**
   * 仅失效某配置的**成功缓存**，不动 `inFlight` 登记。
   *
   * 使用场景是「底层已提交成功、但上层就绪校验发现结果不可用」：要作废的是这次的成功结果，
   * 而不是把正在进行的任务登记一起删掉——后者会让其它消费者失去去重，重复插入 script。
   * 普通失败 / 取消由 Loader 自己按任务身份收尾（`onFailure` / `onCancelled`），不要在这里兜底。
   */
  invalidateCompleted(key: string): void {
    this.completed.delete(key);
  }

  get size(): number {
    return this.inFlight.size + this.completed.size;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get completedCount(): number {
    return this.completed.size;
  }
}
