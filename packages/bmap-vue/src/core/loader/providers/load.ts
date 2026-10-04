/**
 * v4 script 加载编排（CDN / Custom 共用）
 *
 * 两个 script 型 Provider 共用同一套「先验证、再提交」的加载契约：
 *
 * 1. `assertReady` 交给底层 Loader，在**成功提交之前**执行（见 `SharedLoadTask.succeed`）：
 *    命名空间不完整 / 版本不符都算本次加载失败，底层因此不写成功缓存、并移除 script；
 * 2. 加载返回后重新读取全局命名空间——metadata 需要它，而且这里读到的才是「当下可用」的对象；
 * 3. 只有「成功已提交、但命名空间不可用」这一条路径才作废成功缓存（`invalidateCompleted`）；
 *    普通失败 / 取消不动 Loader 的登记——那是它按任务身份自己收尾的事，越权清理会让其它
 *    消费者失去去重、重复插入 script。
 *
 * 失败（含超时、取消、校验不通过）时按**对象身份**登记本次加载残留：只有「进入本次加载前
 * 不存在、退出时已存在」的全局才可能由这次加载产生，因此绝不误伤宿主预先提供的全局，也从不
 * 删除任何对象。否则一次未到就绪回调的失败（超时 / 取消）会留下残缺全局，把后续重试永久挡住。
 *
 * `exportGetter` 在这里刻意不用：它只是「回调没带实参时的取值兜底」，回调带实参时会整段跳过，
 * 拿它当校验点会留下绕过路径（见 #57 评审 R2）。
 */
import type { ScriptLoader, ScriptLoaderOptions } from "../ScriptLoader";
import { getScriptKey } from "../ScriptLoader";
import { markRejectedJsapiV4Global, readJsapiV4Global, requireJsapiV4Global } from "./namespace";
import type { JsapiV4ProviderId } from "./types";

export interface LoadJsapiV4ScriptInput {
  readonly loader: ScriptLoader;
  /** 已包含 `assertReady` 的 Loader 选项（就绪校验由调用方按 Provider 语义给出）。 */
  readonly loadOptions: ScriptLoaderOptions;
  readonly providerId: JsapiV4ProviderId;
  readonly signal?: AbortSignal;
}

/**
 * 登记「本次加载产生的全局残留」。
 *
 * 与进入加载前的快照做身份比较：相同即宿主原有对象（或仍是上一次的残留），不动；不同说明本次
 * 加载期间出现了新的全局对象，而它没能通过契约——登记它，让下一次重试不被这份残缺对象挡住。
 * 只登记、不删除。
 *
 * 两个 script 型入口共用它：自研 `ScriptLoader` 路径（CustomScript）与官方 Loader 路径（默认）。
 * 后者同样可能「脚本执行了但命名空间不可用」，若只登记不区分，这份残缺全局会被
 * `reuseExistingJsapiV4()` 当成宿主全局而永久挡住重试。
 */
export function registerJsapiV4LoadResidue(before: unknown): void {
  const current = readJsapiV4Global();
  if (current !== undefined && current !== before) markRejectedJsapiV4Global(current);
}

/** 执行一次 v4 script 加载并返回校验通过的全局命名空间。 */
export async function loadJsapiV4Script(
  input: LoadJsapiV4ScriptInput,
): Promise<Record<string, unknown>> {
  const key = getScriptKey(input.loadOptions);
  const before = readJsapiV4Global();

  try {
    await input.loader.load(input.loadOptions, input.signal);
  } catch (error) {
    registerJsapiV4LoadResidue(before);
    throw error;
  }

  try {
    return requireJsapiV4Global(input.providerId);
  } catch (error) {
    // 成功已提交、但命名空间不可用：这份成功缓存已过期，只失效它，不动 inFlight 登记。
    input.loader.invalidateCompleted(key);
    registerJsapiV4LoadResidue(before);
    throw error;
  }
}
