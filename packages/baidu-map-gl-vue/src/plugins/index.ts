export { createBMapPlugin, bmapConfigKey } from "./createBMapPlugin";
export type { BMapPluginConfig, CreateBMapPluginOptions } from "./createBMapPlugin";
export {
  urlPluginDefinition,
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  geoUtilsPlugin,
  stringToPluginDefinitions,
  BUILTIN_PLUGIN_URLS,
} from "./builtins";
// 插件兼容 inventory（M3A3-07）：数据驱动，文档由 `pnpm generate:plugin-inventory` 生成。
export {
  PLUGIN_COMPAT_INVENTORY,
  PLUGIN_COMPAT_BY_ID,
  PLUGIN_EVIDENCE_BASIS_MEANING,
  PLUGIN_VERDICT_MEANING,
} from "./compat-inventory";
export type {
  BuiltinPluginName,
  PluginCompatEntry,
  PluginEvidenceBasis,
  PluginVerdict,
} from "./compat-inventory";
export type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";
