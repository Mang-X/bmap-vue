export { createBMapPlugin, bmapConfigKey } from "./createBMapPlugin";
export type { BMapPluginConfig, CreateBMapPluginOptions } from "./createBMapPlugin";
export {
  urlPluginDefinition,
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  geoUtilsPlugin,
  BUILTIN_PLUGIN_URLS,
} from "./builtins";
// 插件 Catalog（M8-PLUGIN-CORE / #42）：名字 → definition 的单一事实源，未知名字明确失败。
// `stringToPluginDefinitions` 从 `builtins.ts` 迁到这里（公共路径不变，仍是根入口那一个）。
export {
  BUILTIN_PLUGIN_CATALOG,
  BUILTIN_PLUGIN_NAMES,
  resolvePluginDefinition,
  stringToPluginDefinitions,
} from "./catalog";
export type { PluginCatalogEntry } from "./catalog";
// 共享宿主（M8-PLUGIN-CORE / #42）：`global` 作用域插件资源的持有者。
// `disposeDefaultPluginHost()` 是它唯一的释放入口（测试 / 热更新要一个干净起点时用）——
// 地图卸载**不是**释放入口，理由见 ADR 2026-09-14 的决策 4。
export { createPluginHost, getDefaultPluginHost, disposeDefaultPluginHost } from "../core/plugins/PluginHost";
export type { PluginHost, PluginHostEntryInspection } from "../core/plugins/PluginHost";
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
