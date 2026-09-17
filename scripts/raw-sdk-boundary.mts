/**
 * raw SDK / 公共声明边界配置（单一事实源）— M3A0-BOUNDARY（issue #15）
 *
 * 被以下位置消费，避免边界规则在脚本、测试与文档之间漂移：
 * - `scripts/check-raw-sdk.mts`    源码静态门禁
 * - `scripts/check-public-dts.mts` 公共声明门禁
 * - `tests/behavior/v3-raw-sdk-scanner.test.ts`
 * - `tests/behavior/v3-public-dts-gate.test.ts`
 *
 * 边界原则：`BMap.*`（JSAPI 4.0 的唯一命名空间）只能出现在 v4 Driver /
 * Client / Loader / 插件适配层与最小 augmentation；组件、业务 composable 与
 * runtime 一律视为禁区。
 *
 * `BMapGL` 自 M3A3-REMOVE-LEGACY（issue #26）起**在任何位置都是违规**——旧引擎已删除，
 * 它只剩两种合法出现：官方 4.0 runtime 自己挂的别名（不在本库源码里）与测试替身按真实形状
 * 做的镜像（`packages/test-utils` 在扫描范围之外）。跨整棵树的这条不变量由
 * `scripts/check-no-bmapgl.mts`（`pnpm check:no-bmapgl`）守。
 */

/** SDK 全局命名空间：`BMap`（JSAPI 4.0）。`BMapGL` 保留在清单里作为**违规标记**。 */
export const RAW_SDK_NAMESPACES = ["BMap", "BMapGL"] as const;
export type RawSdkNamespace = (typeof RAW_SDK_NAMESPACES)[number];

/**
 * 浏览器/运行时全局对象名：`<global>.BMap` / `<global>["BMap"]` 属于越界访问，
 * 合法探测入口只有 Loader/Provider 边界：`core/loader/providers/namespace.ts` 的
 * `readJsapiV4Global()`。
 */
export const GLOBAL_OBJECT_NAMES = ["window", "globalThis", "self", "global"] as const;

/** 相对 `packages/baidu-map-gl-vue/src` 的禁区目录（`check-raw-sdk` 默认扫描范围）。 */
export const FORBIDDEN_SRC_DIRS = [
  "components",
  "composables",
  "core/runtime",
  // M7-LAYERS（#40）新增的图层内核（LayerSpec / LayerRegistry）：与组件同档的禁区，
  // 只能经 Facet Driver 与引擎交互。新增顶层目录时**顺手加进来**，否则「单一事实源」
  // 会与实际扫描范围漂移（只跑默认门禁命令就会漏扫整个新目录）。
  "core/layers",
  // 对接官方包的薄封装（`integrations/ui-kit`，issue #73）与组件同属禁区：
  // 它只能经 MapHandle（`unwrapRaw()`）与 Facet Driver 与引擎交互。
  "integrations",
] as const;

/**
 * raw SDK 允许出现的边界（相对同一 `src` 根）。
 * 使用 `check-raw-sdk --src <dir>` 扫描整棵源码树时，未命中任一模式的文件即禁区。
 *
 * 说明：`packages/test-utils`（Fake SDK）在扫描范围之外，作为独立测试边界存在。
 */
export const RAW_SDK_ALLOWED_PATTERNS = [
  "driver/**",
  "client/**",
  "core/loader/**",
  "plugins/**",
] as const;

/** 公共声明中禁止出现的官方类型包（基础消费者不应依赖它）。 */
export const OFFICIAL_TYPES_PACKAGE = "@baidumap/jsapi-v4-types";

/** 公共声明禁止出现的全局命名空间标记（namespace / declare global）。 */
export const PUBLIC_DTS_FORBIDDEN_MARKERS = ["declare global", "namespace BMap", "namespace BMapGL"] as const;

/** 极简 glob 匹配：支持 `dir/**`、`**\/name` 与精确路径。 */
export function matchesPattern(pattern: string, relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    return path === suffix || path.endsWith(`/${suffix}`);
  }
  return path === pattern;
}

/** 判断一个相对 `src` 的路径是否处于 raw SDK 白名单内。 */
export function isRawSdkAllowedPath(relativePath: string): boolean {
  return RAW_SDK_ALLOWED_PATTERNS.some((pattern) => matchesPattern(pattern, relativePath));
}

/** 结构化边界配置，供 `--print-boundary` 与测试断言使用。 */
export function boundarySummary(): {
  namespaces: string[];
  globalObjects: string[];
  forbiddenSrcDirs: string[];
  allowedPatterns: string[];
  officialTypesPackage: string;
} {
  return {
    namespaces: [...RAW_SDK_NAMESPACES],
    globalObjects: [...GLOBAL_OBJECT_NAMES],
    forbiddenSrcDirs: [...FORBIDDEN_SRC_DIRS],
    allowedPatterns: [...RAW_SDK_ALLOWED_PATTERNS],
    officialTypesPackage: OFFICIAL_TYPES_PACKAGE,
  };
}
