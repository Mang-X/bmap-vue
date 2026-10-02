/**
 * 发布声明的**严格消费**探针（#188）
 *
 * 为什么需要这一个文件：`fixtures/consumer/tsconfig.json` 是 `skipLibCheck: true`，
 * 全仓库没有任何消费侧的 `skipLibCheck: false` 覆盖。那种配置下 TypeScript
 * **根本不检查 `.d.ts` 内部**，于是 `dist/index.d.ts` 里 51 处「找不到名字 `__VLS_1`」
 * 可以在消费方完全无感的情况下发布出去 —— 这正是 #188 的原始问题。
 *
 * 本文件的作用是给 `check:dts-strict` 一把**判别力**：让 tsc 真的去查声明内部。
 * 判据是「下面每一个 `@ts-expect-error` 都必须真的报错」——
 * 一旦声明面被放宽（例如插槽载荷写成 `any`、props 变成索引签名），
 * 对应的 `@ts-expect-error` 就会「没有错误可抑制」，tsc 报 `TS2578`，门禁转红。
 */

/**
 * 正证：七个出口的**值导出**都能被解析，且类型不是 `any`。
 *
 * `IsAny` 判定刻意写在这里而不是只靠「import 不报错」—— 若某个出口整个退化成
 * `any`（例如声明打包失败后回落），import 依然成功，只有这条会红。
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** 断言 `T` **不是** `any`。 */
type NotAny<T> = IsAny<T> extends true ? "该导出退化成 any，声明面已失效" : true;

/* eslint-disable @typescript-eslint/no-unused-vars */
import { BMapProvider, Map, Marker, ZoomControl, createBMapClientDefinition } from "@mangax/bmap-vue";
// `./components` 是**独立出口**（不是根入口的子集）：它有自己的 dist 声明文件，
// 漏掉它等于那一整个出口没人验。实测它的 `ae-forgotten-export` 与根入口不同
// （160 vs 192），正是因为两者打包出的声明面并不相同。
import { Map as MapFromComponents } from "@mangax/bmap-vue/components";
import { useMapContext } from "@mangax/bmap-vue/composables";
import { resolvePluginDefinition } from "@mangax/bmap-vue/plugins";
import { BMapResolver } from "@mangax/bmap-vue/resolver";
import { unwrapRaw } from "@mangax/bmap-vue/advanced";
import { UI_KIT_STYLE_PATH } from "@mangax/bmap-vue/ui-kit";
import type { MapProps, MarkerProps } from "@mangax/bmap-vue";
/* eslint-enable @typescript-eslint/no-unused-vars */

// 七个出口的值导出都拿到了具体类型。
//
// **刻意实例化成 `const`，而不是写 `export type _Root = [...]`。**
// 未实例化的类型别名是**惰性**的：TypeScript 只在别名被真正求值时才检查其内部，
// 所以 `export type _Root = NotAny<any>` 单独编译是**零错误**（实测）——
// 那样这条「反 any 防御」根本没有牙，退化成 `any` 时门禁照样全绿。
// 写成 `const _root: NotAny<any> = true` 后，导出退化成 `any` 会立刻报 `TS2322`。
const _rootIsTyped: [
  NotAny<typeof Map>,
  NotAny<typeof Marker>,
  NotAny<typeof ZoomControl>,
  NotAny<typeof BMapProvider>,
  // `./components` 出口拿到的 `Map` 必须同样有具体类型（它是另一次打包的产物）。
  NotAny<typeof MapFromComponents>,
  NotAny<typeof createBMapClientDefinition>,
  NotAny<typeof BMapResolver>,
  NotAny<typeof unwrapRaw>,
  NotAny<typeof useMapContext>,
  NotAny<typeof resolvePluginDefinition>,
  NotAny<typeof UI_KIT_STYLE_PATH>,
] = [true, true, true, true, true, true, true, true, true, true, true];

/**
 * 插槽类型可取用（#188 的核心修复面）。
 *
 * 断言写法刻意**不**用 `InstanceType<typeof Map>["$slots"]`：`__VLS_WithSlots<T, S>` 是
 * 交叉类型 `T & { new (): { $slots: S } }`，而 `T`（`DefineComponent`）自己就带构造签名，
 * `InstanceType` 取到的是**它**而不是带 `$slots` 的那个分支 —— 实测那样写会得到
 * `never`，断言随即恒假。直接从构造签名的 `$slots` 取才对。
 */
type SlotsOf<T> = T extends { new (...args: never[]): { $slots: infer S } } ? S : "取不到 $slots";
export type MapSlots = SlotsOf<typeof Map>;
export type ProviderSlots = SlotsOf<typeof BMapProvider>;

/** `<Map>` 的默认插槽载荷必须保留**四个具名成员**，而不是被放宽成 `any`。 */
type MapSlotMembers = {
  status: unknown;
  map: unknown;
  error: unknown;
  client: unknown;
};
type ProviderSlotMembers = { status: unknown };
type DefaultSlotOf<S> = S extends { default?: infer F } ? NonNullable<F> : never;
/**
 * 「载荷**至少有**这些成员」的**单向**判断。
 *
 * 刻意单向（`P extends M`）而不是双向：成员类型写 `unknown` 时双向不成立 ——
 * `MapHandle | null` 与 `unknown` 互不assignable，写成双向会让这条断言恒假。
 * 单向正是这里要的语义：只关心「成员还在不在、名字没变」，不关心具体类型
 * （具体类型由上面 `MapProps` 那组 `@ts-expect-error` 守着）。
 */
type HasSlotMembers<T, M> = T extends (props: infer P) => unknown ? (P extends M ? true : false) : false;
// 实例化（理由同 `_rootIsTyped`）：未实例化的 `type` 是惰性的，没有判别力。
const _mapSlotIsTyped: HasSlotMembers<DefaultSlotOf<MapSlots>, MapSlotMembers> = true;
const _providerSlotIsTyped: HasSlotMembers<DefaultSlotOf<ProviderSlots>, ProviderSlotMembers> = true;

/* eslint-disable @typescript-eslint/no-unused-vars */

// ── 负向：合法成员不报错、非法成员必须报错 ────────────────────────────────────
//
// 正反两侧都要有：只测正向的话，声明面退化成 `any` 会让「能编译」变成恒真。

// ✅ 合法 prop 存在
const okProps: MapProps = { zoom: 12 };
const okMarkerProps: MarkerProps = { position: { lng: 116.4, lat: 39.9 }, visible: true };

// ❌ 合法 prop 上**类型写错**必须报错（属性存在不等于值类型对）
const badZoom: MapProps = {
  // @ts-expect-error zoom 是 number，字符串不合法
  zoom: "12",
};

// ❌ 不存在的 prop 必须报错（#165 改名后文档里的旧名就是这类，会静默落进 $attrs）
const badProp: MapProps = {
  // @ts-expect-error MapProps 没有这个成员
  totallyNotARealProp: 1,
};

// ❌ Marker 的 prop 面同样有效
const badMarker: MarkerProps = {
  // @ts-expect-error visible 是 boolean
  visible: "yes",
};

/* eslint-enable @typescript-eslint/no-unused-vars */

export {
  okProps,
  okMarkerProps,
  badZoom,
  badProp,
  badMarker,
  _rootIsTyped,
  _mapSlotIsTyped,
  _providerSlotIsTyped,
};
