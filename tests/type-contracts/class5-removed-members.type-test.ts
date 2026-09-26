/**
 * 「被删除成员」的**类型面**契约（issue #165 Class 5）
 *
 * Class 5 = 「明显超出 sdk 语义意图的，画蛇添足的，整理后删除」。这一类删除**只能**用类型面
 * 钉住：被删的成员本来就在 `defineProps<T>()` / 导出选项类型上，运行期读不到「它还在不在」
 * （它在就是真在，删了就编译不过），而 issue #165 §3.6 同时禁止留弃用别名 / 迁移垫片 / 第二个
 * 兼容入口——所以判据必须是**这个键不再被接受**，而不是「接受但打告警」。
 *
 * ## 为什么落在 `tests/type-contracts/` 而不是 `*.test.ts`
 *
 * 同 `service-task-tiers.type-test.ts` 的理由，且已实测：`packages/` 下的 `.test.ts` 不在任何
 * typecheck 的编译范围里（`tsconfig.build.json` 排除 `src/` 下的 `*.test.ts`，
 * `tsconfig.tests.json` 只 include `tests/performance` 与 `tests/browser/live-performance`），
 * 写在那里的 `@ts-expect-error` 是**恒真**的（注释里那条「加回 `release` 仍全绿」的实测就是这个）。
 * 本文件被 `tsconfig.type-contracts.json` 覆盖，**判别力是双向的**：成员被加回来时
 * `@ts-expect-error` 变成 TS2578（unused）而翻红。
 *
 * 下方每个「正控」断言同类成员**仍然被接受**（`map.center` / `v-model` 相关的 `defaultCenter`、
 * `center` 的 `string` 形态、layer 家族的 `pickWidth`），保证本文件不是「因为类型退化成什么都收」
 * 而恒绿。
 */
import type { BMapProviderProps } from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import type { CreateBMapPluginOptions } from "../../packages/bmap-vue/src/plugins/createBMapPlugin";
import type {
  MapProps,
  PointCollectionProps,
  PointIconLayerProps,
  PointLayerProps,
} from "../../packages/bmap-vue/src/types/components";

/* ------------------------------------------------------------------ A. <Map> 四个空转 prop */

/**
 * `noAnimation` / `restrictCenter` / `backgroundColor` 三个键在官方 `MapOptions` 里**不存在**
 * （`@baidumap/jsapi-v4-types` 的 `core/MapOptions.d.ts` 逐键核对过：`noAnimation` 只是
 * `setCenter` / `setZoom` 等**单次调用**的选项；范围限制的官方能力是 `restrictBounds(bounds)`，
 * 收 `Bounds` 而**不是**布尔）。本库原声明它们却读也不读 —— 收下用不了的 prop 属于假支持。
 */
declare const mapProps: MapProps;
// @ts-expect-error `noAnimation` 不是 MapOptions 的构造项（官方只有单次调用选项），已按 #165 Class 5 删除
mapProps.noAnimation;
// @ts-expect-error v4 没有布尔项 restrictCenter；官方能力是 restrictBounds(bounds)，上游**没有**撤销入口
mapProps.restrictCenter;
// @ts-expect-error 4.0 的 MapOptions 没有 backgroundColor（背景由容器样式 / displayOptions 表达）
mapProps.backgroundColor;

/** 正控：`center` 的 `string` 形态与 `default*` 四件套是刻意的 Vue 适配（Class 4），不得被一并删掉。 */
declare const mapPropsStillValid: MapProps;
const _stillCenterString: MapProps["center"] = "北京市";
const _stillDefaultCenter: MapProps["defaultCenter"] = "北京市";
const _stillDefaultZoom: MapProps["defaultZoom"] = 12;
const _stillDefaultHeading: MapProps["defaultHeading"] = 0;
const _stillDefaultTilt: MapProps["defaultTilt"] = 0;
void [_stillCenterString, _stillDefaultCenter, _stillDefaultZoom, _stillDefaultHeading, _stillDefaultTilt, mapPropsStillValid];

/* ------------------------------------------------------------------ B. createBMapPlugin.plugins */

/**
 * `CreateBMapPluginOptions.plugins` 声明了却**没有任何读者**：app 级配置
 * `BMapPluginConfig` 只有 `{ provider, defaults }`，插件注册读的是 `<Map>` 自己的 `plugins` **组件 prop**
 * （两个不同的东西）。于是 `createBMapPlugin({ plugins: [...] })` 静默无效。
 */
declare const pluginOptions: CreateBMapPluginOptions;
// @ts-expect-error app 级 options.plugins 从未被读取（静默无效），已按 #165 Class 5 删除
pluginOptions.plugins;

/** 正控：同类型的其它选项仍然成立。 */
declare const pluginOptionsStillValid: CreateBMapPluginOptions;
const _stillAk: string | undefined = pluginOptionsStillValid.ak;
const _stillDefaults: CreateBMapPluginOptions["defaults"] = { version: "4.0" };
void [_stillAk, _stillDefaults, pluginOptionsStillValid];

/* ------------------------------------------------------------------ C. PointLayer.pickWidth/pickHeight */

/**
 * `pickWidth` / `pickHeight` 在官方只声明于 `layer/LineLayer.d.ts`、`layer/PointIconLayer.d.ts`、
 * `layer/FillLayer.d.ts`、`layer/PointShapeLayer.d.ts`（各 75/80 行前后），**`visualization/` 与
 * `PointLayerOptions` 上没有**。`PointLayerOptions` 的拾取面是 `pickTolerance`（默认 4）、
 * `pickThrough`、`mouseStyleChange`。
 */
declare const pointLayerProps: PointLayerProps<unknown>;
// @ts-expect-error PointLayer 上游没有 pickWidth（拾取面是 pickTolerance / pickThrough），已按 #165 Class 5 删除
pointLayerProps.pickWidth;
// @ts-expect-error 同上：pickHeight 不是 PointLayer 的构造项
pointLayerProps.pickHeight;

/**
 * 正控（关键）：**同名成员在别的 props 接口上仍然合法**，因为官方确实在那些图层上声明了它们。
 * 这条断言是本文件里最容易误伤的边界——`pickWidth` 的删除是 **kind 特定**的，不是全库一刀切。
 */
declare const pointIconLayerProps: PointIconLayerProps<unknown>;
const _stillPointIconPickWidth: number | undefined = pointIconLayerProps.pickWidth;
const _stillPointIconPickHeight: number | undefined = pointIconLayerProps.pickHeight;
declare const pointCollectionProps: PointCollectionProps<unknown>;
const _stillCollectionPickWidth: number | undefined = pointCollectionProps.pickWidth;
const _stillCollectionPickHeight: number | undefined = pointCollectionProps.pickHeight;
void [
  _stillPointIconPickWidth,
  _stillPointIconPickHeight,
  _stillCollectionPickWidth,
  _stillCollectionPickHeight,
];

/* ------------------------------------------------------------------ E. <BMapProvider>.suspense */

/** 声明 + 默认值都在，`grep "props.suspense"` = 0 命中：从未被读过。 */
declare const providerProps: BMapProviderProps;
// @ts-expect-error `suspense` 从未被读取（无 Suspense 集成），已按 #165 Class 5 删除
providerProps.suspense;

/** 正控：Provider 的其余选项仍然成立。 */
declare const providerPropsStillValid: BMapProviderProps;
const _stillAutoLoad: boolean | undefined = providerPropsStillValid.autoLoad;
const _stillLoadOptions: BMapProviderProps["loadOptions"] = { ak: "x" };
void [_stillAutoLoad, _stillLoadOptions, providerPropsStillValid, providerProps, pluginOptions];
