/**
 * JSAPI 4.0 Provider 家族（M3A1-PROVIDERS / issue #17）
 *
 * 三个 Provider 共享同一进程级 `BMap` 冲突域：相同配置复用同一任务，不同 AK /
 * 版本按默认 `throw` 策略报结构化冲突；全部返回 `LoadedJsapiV4` 而非裸全局对象。
 */
export { BaiduJsapiV4Provider, baiduJsapiV4Provider } from "./BaiduJsapiV4Provider";
export { ExistingGlobalV4Provider, existingGlobalV4Provider } from "./ExistingGlobalV4Provider";
export {
  CustomScriptV4Provider,
  customScriptV4Provider,
  type CustomScriptV4ProviderOptions,
} from "./CustomScriptV4Provider";
export { createLoadedJsapiV4 } from "./loaded";
export type { CreateLoadedJsapiV4Input } from "./loaded";
export { loadJsapiV4Script, registerJsapiV4LoadResidue } from "./load";
export type { LoadJsapiV4ScriptInput } from "./load";
export {
  OFFICIAL_LOADER_UNSUPPORTED_KEYS,
  officialJsapiLoader,
  toOfficialLoadError,
  toOfficialLoadOptions,
  resolveOfficialNamespace,
} from "./official";
export type {
  OfficialJsapiLoadOptions,
  OfficialJsapiLoader,
  OfficialLoaderUnsupportedKey,
} from "./official";
export { reuseExistingJsapiV4 } from "./reuse";
export type { ReuseExistingJsapiV4Input } from "./reuse";
export {
  JSAPI_V4_DOMAIN,
  JSAPI_V4_REQUIRED_MEMBERS,
  JSAPI_V4_VERSION_PROBE_KEYS,
  assertJsapiV4Namespace,
  assertJsapiV4Version,
  findMissingJsapiV4Members,
  isJsapiV4Namespace,
  isRejectedJsapiV4Global,
  markRejectedJsapiV4Global,
  probeJsapiV4Version,
  readJsapiV4Global,
  resetRejectedJsapiV4GlobalsForTests,
  resolveExistingJsapiV4Version,
} from "./namespace";
export type {
  BaiduJsapiV4ProviderOptions,
  JsapiV4Engine,
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4Namespace,
  JsapiV4Provider,
  JsapiV4ProviderId,
  JsapiV4ProviderOptions,
  JsapiV4ScriptMode,
  JsapiV4VersionSource,
  LoadedJsapiV4,
} from "./types";
