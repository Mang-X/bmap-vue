/**
 * 插件 Catalog（M8-PLUGIN-CORE / issue #42）
 *
 * **一个名字对应哪个 definition** 的单一事实源。此前这个映射散在 `builtins.ts` 的一个私有
 * 常量里，而且缺一个名字时不是报错、是**静默降级成空实现**：
 *
 * ```ts
 * // 旧实现（已删除）
 * return { name, required: false, load: async () => undefined }
 * ```
 *
 * 那个空实现与真工厂**同名、同 required、同样 resolve**，所以调用方从返回值上完全分不出
 * 「插件装上了」和「你拼错了一个字母」——`plugins: ['TrackAnimatino']` 会安静地什么都不做，
 * `getStatus()` 还是 `ready`。这正是本库明令禁止的「假支持」
 * （见 ADR `2026-09-13-official-first-loader-and-ui-kit`：接收后忽略属于假支持）。
 *
 * 现在改成两条明确的路：
 *
 * - **认得的名字** → 对应工厂产出的 definition（同一性由 `catalog.test.ts` 钉住，
 *   判据是 `create === trackAnimationPlugin` 这类函数同一性，不是「有没有 scope 字段」这类
 *   特征——特征判据挡不住「把工厂换成另一个也叫这名字的 noop」）；
 * - **不认识的名字** → 抛 `BMAP_PLUGIN_UNKNOWN`，消息里带上「认得的名字有哪些」。
 *
 * 为什么与 `BMAP_PLUGIN_LOAD_FAILED` 分开：前者是调用方配置错误（重试无意义），后者是
 * 脚本 / 依赖加载失败（CDN 抖动，可重试）。合成一个码会让 `BMapError.retryable` 说谎。
 *
 * 组件层（`BMap.vue`）不会因为这里抛错而崩：它逐个名字捕获，把未知名字**回执成
 * `plugin-error`**，地图照常 ready、其余插件照常加载。理由见 ADR
 * `2026-09-14-plugin-catalog-scope-scheduling` 决策 2 —— 「明确失败」不等于「让整张地图失败」。
 */
import { BMapError } from "../core/errors/BMapError";
import type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";
import {
  drawingManagerPlugin,
  geoUtilsPlugin,
  mapVglPlugin,
  trackAnimationPlugin,
} from "./builtins";
import type { BuiltinPluginName } from "./compat-inventory";

/** Catalog 条目：稳定名字 + 产出 definition 的工厂。 */
export interface PluginCatalogEntry {
  /** 稳定标识，同时是 `plugins: [...]` 接受的字符串名。 */
  readonly name: BuiltinPluginName;
  /**
   * 工厂。**存函数而不是存 definition 实例**：definition 的工厂每次调用都产出新对象，
   * 让 catalog 不持有可变状态；同时同一性判据（`create === trackAnimationPlugin`）才能
   * 被用例直接核对。
   */
  readonly create: () => BMapPluginDefinition<unknown>;
}

/**
 * 内置插件 Catalog。
 *
 * `Record<BuiltinPluginName, …>` 让**漏一个名字编译不过**；反过来「多一个名字」
 * 由 `catalog.test.ts` 与兼容清单做双向集合比较（类型锁不住多出来的键）。
 */
export const BUILTIN_PLUGIN_CATALOG: Readonly<
  Record<BuiltinPluginName, PluginCatalogEntry>
> = {
  TrackAnimation: { name: "TrackAnimation", create: trackAnimationPlugin },
  DrawingManager: { name: "DrawingManager", create: drawingManagerPlugin },
  GeoUtils: { name: "GeoUtils", create: geoUtilsPlugin },
  Mapvgl: { name: "Mapvgl", create: mapVglPlugin },
};

/** 认得的名字（错误消息与文档用同一份来源，避免两处清单漂移）。 */
export const BUILTIN_PLUGIN_NAMES: readonly BuiltinPluginName[] = Object.keys(
  BUILTIN_PLUGIN_CATALOG,
) as BuiltinPluginName[];

/**
 * 名字 → definition。名字不认识时抛 `BMAP_PLUGIN_UNKNOWN`。
 *
 * 这是「明确失败」的唯一入口：不要在这里做「未知名字返回空实现」这类宽容处理，
 * 那正是本模块要消灭的行为。
 */
export function resolvePluginDefinition(name: string): BMapPluginDefinition<unknown> {
  const entry = (BUILTIN_PLUGIN_CATALOG as Record<string, PluginCatalogEntry | undefined>)[name];
  if (!entry) {
    throw new BMapError(
      "BMAP_PLUGIN_UNKNOWN",
      `Unknown plugin "${name}". Known plugins: ${BUILTIN_PLUGIN_NAMES.join(", ")}.`,
      { plugin: name },
    );
  }
  return entry.create();
}

/**
 * 兼容旧 `plugins: string[]` 配置 → plugin definitions。
 *
 * **整体失败**：列表里只要有一个未知名字就抛错，不做「部分成功」。部分成功比整体失败更糟——
 * 调用方会以为列表里的插件都装上了。需要逐个名字容错的调用方请自行遍历
 * `resolvePluginDefinition` 并捕获（`BMap.vue` 就是这么做的）。
 */
export function stringToPluginDefinitions(
  names: readonly string[],
): BMapPluginDefinition<unknown>[] {
  return names.map(resolvePluginDefinition);
}
