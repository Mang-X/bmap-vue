/// <reference types="@baidumap/jsapi-v4-types" />

/**
 * @augmentation bmap-4.0.4-gaps
 * @upstream @baidumap/jsapi-v4-types
 * @upstreamVersion 4.0.4
 * @runtimeBasis 百度地图 JSAPI 4.0（`v=4.0`，全局 `BMap`）。官方 4.0.4 声明中
 *   `MapType` 构造参数、`MapType#getProjection` 返回值与 `Route#setPolylineStyle`
 *   参数被引用却未声明；在 `skipLibCheck: false` 下这些缺口会直接导致类型检查失败。
 * @deletionCondition 升级 `@baidumap/jsapi-v4-types` 后，若官方已补齐
 *   `MapTypeOptions` / `Projection` / `RoutePolylineStyle`，删除本文件，并从
 *   `types-reference.d.ts` 的三斜线引用中移除；随后重跑 `pnpm typecheck:package`。
 * @owner driver/jsapi-v4
 *
 * 约束（见同目录 README.md）：
 * - 只补官方缺口，禁止复制整套声明，禁止 `any`；
 * - 只声明接口/类型，不引入运行时值；
 * - 本文件属于声明边界，不进入发布产物（由 `scripts/check-public-dts.mts` 把关）。
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

    /** 路径服务 polyline 样式（官方 `Route#setPolylineStyle` 参数引用，暂缺声明） */
    interface RoutePolylineStyle {
      strokeColor?: string;
      strokeWeight?: number;
      strokeOpacity?: number;
      strokeStyle?: "solid" | "dashed" | "dotted";
      highlight?: {
        strokeColor?: string;
        strokeWeight?: number;
        strokeOpacity?: number;
      };
    }
  }
}
