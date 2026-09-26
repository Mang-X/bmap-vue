/// <reference types="@baidumap/jsapi-v4-types" />

/**
 * @augmentation bmap-4.0.4-gaps
 * @upstream @baidumap/jsapi-v4-types
 * @upstreamVersion 4.0.5 (git 5ba67f4dda11b0a4b54fc631278d3e39e11667c3)
 * @runtimeBasis 百度地图 JSAPI 4.0（`v=4.0`，全局 `BMap`）。官方声明中 `MapType` 构造参数
 *   与 `MapType#getProjection` 返回值被引用却未声明；在 `skipLibCheck: false` 下这些缺口
 *   会直接导致类型检查失败。
 * @deletionCondition 升级 `@baidumap/jsapi-v4-types` 后，若官方已补齐
 *   `MapTypeOptions` / `Projection`，删除本文件，并从
 *   `types-reference.d.ts` 的三斜线引用中移除；随后重跑 `pnpm typecheck:package`。
 * @owner driver/jsapi-v4
 *
 * 约束（见同目录 README.md）：
 * - 只补官方缺口，禁止复制整套声明，禁止 `any`；
 * - 只声明接口/类型，不引入运行时值；
 * - 本文件属于声明边界，不进入发布产物（由 `scripts/check-public-dts.mts` 把关）。
 *
 * **4.0.5 部分达成删除条件**：`RoutePolylineStyle` 的三个缺口已闭合——上游不再引用这个名字
 * （全包 `grep -c RoutePolylineStyle` = 0），四个路线服务的 `setPolylineStyle` 改成了
 * 真实存在的 `PolylineOptions`。因此该接口声明**已删除**：留着它就是给一个上游没有的
 * 类型发通行证，会让「官方有没有这个类型」的判断被本地声明污染。
 * `MapTypeOptions` / `Projection` 仍被引用且仍未声明（`map-type/MapType.d.ts:12,32`），
 * 所以本文件与其余引用**保留**——删除条件尚未全部满足。
 */

export {};

declare global {
  namespace BMap {
    /** 自定义地图类型选项（官方 `MapType` 构造参数引用，暂缺声明） */
    interface MapTypeOptions {
      minZoom?: number;
      maxZoom?: number;
      textColor?: string;
      tips?: string;
    }

    /** 地图投影（官方 `MapType#getProjection` 返回，暂缺声明） */
    interface Projection {}
  }
}
