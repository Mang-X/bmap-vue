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
 * 默认插槽**载荷**的类型。
 *
 * 与 `DefaultSlotOf` 配套：前者取插槽**函数**，这里取它的第一个参数。
 * 零参数插槽（`default?(): any`）的 `Parameters` 是 `[]`，取 `[0]` 得 `undefined` ——
 * 那是「没有载荷」的合法形态，`NotAny<undefined>` 为真，符合语义。
 */
type DefaultSlotPropsOf<S> = DefaultSlotOf<S> extends (props: infer P, ...rest: never[]) => unknown
  ? P
  : unknown;
/**
 * 载荷的**每个成员**都不得是 `any`（#188 评审 P2 的补充实测）。
 *
 * 上一条 `NotAny<DefaultSlotPropsOf<S>>` 只看载荷**整体**；把成员逐个改成 `any`
 * 而名字不变时整体仍是一个具体的对象类型，那条仍绿。实测：把 `<Map>` 默认插槽的
 * 四个成员（`status` / `map` / `error` / `client`）逐个换成 `any`，
 * 「成员还在」那条断言不转红 —— 成员**名**在、**类型**没了。
 *
 * 判据：`{ [K in keyof P]: NotAny<P[K]> }` 之后整体是否仍可赋值给「成员皆非 any」的形状。
 * 用映射类型逐成员过一遍 `NotAny`，任何成员是 `any` 就得到字符串字面量类型，
 * 与 `true` 不匹配 ⇒ 断言转红。
 */
type NoAnyMembers<T> = { [K in keyof T]: NotAny<T[K]> };
const _mapSlotMembersAreTyped: NoAnyMembers<DefaultSlotPropsOf<MapSlots>> = {
  status: true,
  map: true,
  error: true,
  client: true,
};
const _providerSlotMembersAreTyped: NoAnyMembers<DefaultSlotPropsOf<ProviderSlots>> = {
  status: true,
};
/**
 * 「载荷**至少有**这些成员，且**没退化成 `any`**」的**单向**判断。
 *
 * 刻意单向（`P extends M`）而不是双向：成员类型写 `unknown` 时双向不成立 ——
 * `MapHandle | null` 与 `unknown` 互不assignable，写成双向会让这条断言恒假。
 * 单向正是这里要的语义：只关心「成员还在不在、名字没变」，不关心具体类型
 * （具体类型由上面 `MapProps` 那组 `@ts-expect-error` 守着）。
 *
 * **`IsAny` 这一层是必须的，不是冗余**（#188 评审 P2）：`P = any` 时 `P extends M` 的
 * 求值结果是 `boolean`（不是 `false`），而 `const x: boolean = true` 完全合法 ——
 * 于是把 `default` 插槽改成 `(props: any) => any` 仍会通过本条断言。
 * `NotAny<typeof Map>` 抓不到这一层：它只看组件值本身，不看**嵌套**的插槽载荷。
 */
type HasSlotMembers<T, M> = T extends (props: infer P) => unknown
  ? IsAny<P> extends true
    ? false
    : P extends M
      ? true
      : false
  : false;
// 实例化（理由同 `_rootIsTyped`）：未实例化的 `type` 是惰性的，没有判别力。
const _mapSlotIsTyped: HasSlotMembers<DefaultSlotOf<MapSlots>, MapSlotMembers> = true;
const _providerSlotIsTyped: HasSlotMembers<DefaultSlotOf<ProviderSlots>, ProviderSlotMembers> = true;

/**
 * 插槽**载荷本身**也不得是 `any`（与 `HasSlotMembers` 正交的第二道）。
 *
 * 单独一条是因为上面那条只在「成员名对得上」时才有意义；一个**空**载荷退化成 `any`
 * （`(props: any) => any`，没有任何具名成员）会让 `HasSlotMembers` 因为成员缺失而红，
 * 但那是**偶然**红 —— 若同时把成员名也放宽，两条会一起失效。这里直接对载荷下判据。
 */
const _mapSlotPayloadIsTyped: NotAny<DefaultSlotPropsOf<MapSlots>> = true;
const _providerSlotPayloadIsTyped: NotAny<DefaultSlotPropsOf<ProviderSlots>> = true;

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

// 无参数插槽的载荷表示法（#188 评审 P1）
//
// 绝大多数组件的内容插槽不传任何东西，而表示「空载荷」有两个写法 ——
// `Record<string, never>` 与 `Record<never, never>`。两者 emit 出来的声明**完全一致**，
// 语义却相反：
//
// - `Record<string, never>` 带字符串索引签名，于是 `const { typo } = props` **不报错**
//   （`typo` 只得到 `never`，而 `never` 可赋给任何目标类型）—— 写错插槽 prop 完全无感；
// - `Record<never, never>` 没有索引签名，`typo` 真的报 `TS2339`（实测）。
//
// 也就是说选前者会**静默弱化**消费方的错误诊断，而那正是 #188 要恢复的东西。
type MarkerDefaultSlotProps = DefaultSlotPropsOf<SlotsOf<typeof Marker>>;

/**
 * 断言「载荷**没有**字符串索引签名」。
 *
 * 这是「写错的插槽 prop 会报错」的**直接**判据，也是上面那个取舍的守卫：把载荷换回
 * `Record<string, never>` 时 `string extends keyof P` 成立 ⇒ 断言转红。
 *
 * 刻意**不用** `@ts-expect-error` 写这条：后者只要求「那行有错误」，而载荷一旦宽化成
 * `any`，`props.typo` 变成**合法访问** ⇒ 那行不报错 ⇒ 整条断言静默失效。这正是首轮
 * `NotAny<any>` 那类惰性断言的病根（见文件头）。实测两条的差别：换成
 * `Record<string, never>` 时本条转红，而 `@ts-expect-error` 版本不会。
 *
 * 判据用 `string extends keyof P`：有字符串索引签名时成立；没有则不成立。
 * 实例化成 `const` 才会有牙（未实例化的类型别名是惰性的）。
 */
type HasStringIndex<T> = string extends keyof T ? true : false;
const _markerSlotHasNoStringIndex: HasStringIndex<MarkerDefaultSlotProps> = false;
const _providerSlotHasNoStringIndex: HasStringIndex<
  DefaultSlotPropsOf<SlotsOf<typeof BMapProvider>>
> = false;

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
  _mapSlotPayloadIsTyped,
  _providerSlotPayloadIsTyped,
  _mapSlotMembersAreTyped,
  _providerSlotMembersAreTyped,
  _markerSlotHasNoStringIndex,
  _providerSlotHasNoStringIndex,
};
