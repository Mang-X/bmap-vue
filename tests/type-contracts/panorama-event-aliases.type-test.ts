/**
 * `<Panorama>` 事件面的**声明契约**（issue #165 TASK 6 / 7）
 *
 * 运行时行为（两个拼写都真的派发、`linksVisibleChanged` 的 boolean 载荷、卸载后监听归零）
 * 由 `tests/behavior/panorama-event-aliases.test.ts` 钉住；本文件钉的是**声明面**——
 * 也就是「模板里写 `@link_click` 会不会被 vue-tsc 认出来」这一层。
 *
 * ## 为什么这一层值得单独钉
 *
 * Vue 只把**已声明**的事件名交给 `emit()` 匹配，未声明的名字会落到 `attrs`，
 * `emit()` 唤不醒它——**静默失败**。也就是说，别名只写在运行时表
 * （`PANORAMA_EVENT_EMIT_ALIASES`）里、忘了写进 `defineEmits`，用户会看到
 * 「监听写对了但什么都不发生」，而**类型检查一路绿灯**。这里用
 * `$props["on<EventName>"]` 把那条声明钉住。
 *
 * ## 为什么落在本目录而不是 `*.test.ts`
 *
 * `tsconfig.tests.json` 只 include `tests/performance` 与 `tests/browser/live-performance`，
 * 写在 `tests/behavior/` 的 `@ts-expect-error` **不会被任何 tsc 编译**，
 * 因此永远翻红不了（判别力为零）。
 */
import type { PanoramaLink, PanoramaPov } from "../../packages/bmap-vue/src/index";
import Panorama from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";

/** 严格相等（不是互相可赋值——那会放过更宽的形参类型这类假绿）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
function expectTrue<T extends true>(_value?: T): void {}

/** `<Panorama>` 的 props（即 Vue 为已声明事件名生成的 `on*` 监听 prop）。 */
type PanoramaProps = InstanceType<typeof Panorama>["$props"];

/** 某个事件名对应的监听 prop 的**形参类型**（`undefined` 剥掉）。 */
type ListenerOf<E extends keyof PanoramaProps> = PanoramaProps[E] extends
  | ((arg: infer P) => unknown)
  | undefined
  ? P
  : never;

/** 该事件名在声明面上**存在**（`on*` prop 已生成 ⇒ `emit()` 能唤醒它）。 */
type Declared<E extends string> = E extends keyof PanoramaProps ? true : false;

/* ------------------------------------------------------------ 规范名（camelCase）*/

// 1. `linksVisibleChanged` 的载荷是**裸 boolean**（官方 `{value}` 包装被投影掉）。
//    判别力：若声明成 `{ value: boolean }`，这条 `equals` 会红。
expectTrue<Equals<ListenerOf<"onLinksVisibleChanged">, boolean>>();

// 2. `linksChange` 的载荷是 `PanoramaLink[]`，**与上一条不同**——两者不得互换。
//    这条同时钉住「不要把两条相近的事件合并」。
expectTrue<Equals<ListenerOf<"onLinksChange">, PanoramaLink[]>>();

/* --------------------------------------------------------------- SDK 拼写别名 */

// 3. **每一条**别名都必须**在声明面上存在**——这是「不会被 `emit()` 静默吞掉」的唯一判据。
//    删掉 `defineEmits` 里的任何一个 `on<SDK名>` 键，这里立刻红。
expectTrue<Declared<"onLink_click">>();
expectTrue<Declared<"onLinks_changed">>();
expectTrue<Declared<"onLinks_visible_changed">>();
expectTrue<Declared<"onPov_changed">>();
expectTrue<Declared<"onPov_changed_end">>();
expectTrue<Declared<"onZoom_changed">>();
expectTrue<Declared<"onId_changed">>();
expectTrue<Declared<"onScene_type_changed">>();
expectTrue<Declared<"onScene_change_end">>();
expectTrue<Declared<"onSize_changed">>();
expectTrue<Declared<"onOverlay_add">>();
expectTrue<Declared<"onOverlay_remove">>();
expectTrue<Declared<"onOverlays_clear">>();
expectTrue<Declared<"onVisible_poi_type_changed">>();

// 4. 别名的载荷必须与它的规范名**逐字相同**（「双发」发出去的是同一个东西）。
//    别名写成宽类型（`unknown` / `any`）会让这条红。
expectTrue<Equals<ListenerOf<"onLinks_visible_changed">, ListenerOf<"onLinksVisibleChanged">>>();
expectTrue<Equals<ListenerOf<"onLinks_changed">, ListenerOf<"onLinksChange">>>();
expectTrue<Equals<ListenerOf<"onPov_changed">, ListenerOf<"onPovChange">>>();
expectTrue<Equals<ListenerOf<"onPov_changed_end">, ListenerOf<"onPovChangedEnd">>>();
expectTrue<Equals<ListenerOf<"onScene_type_changed">, ListenerOf<"onSceneTypeChange">>>();
expectTrue<Equals<ListenerOf<"onScene_change_end">, ListenerOf<"onSceneChangeEnd">>>();
expectTrue<Equals<ListenerOf<"onVisible_poi_type_changed">, ListenerOf<"onVisiblePoiTypeChanged">>>();

// 5. 别名的载荷仍然是**领域类型**，没有退化成 `unknown`（`getPov()` 回读补的那个 `Pov`）。
expectTrue<Equals<ListenerOf<"onPovChange">, PanoramaPov | null>>();
expectTrue<Equals<ListenerOf<"onPov_changed">, PanoramaPov | null>>();
// @ts-expect-error povChange 的载荷是 `PanoramaPov | null`，不是 `number`
const wrongPov: ListenerOf<"onPovChange"> = 1;
void wrongPov;

// 6. `links_visible_changed` 收**裸 boolean**——给官方那个包装对象必须编译不过。
// @ts-expect-error 载荷是裸 boolean，不是官方那个 { value } 包装
const badAlias: ListenerOf<"onLinks_visible_changed"> = { value: true };
void badAlias;

/* ------------------------------------------ 负判据：改名的那两个 SDK 键不是事件 */

// 7. `dataload` / `pano_error` 是**改名**（→ `load` / `error`）不是拼写别名，
//    因此**不得**出现在事件名联合里。模板里给它们写监听会落到 `attrs`（不报错），
//    所以这里能断言、也真的会红的是「它们不在 `keyof $props` 的事件名里」。
expectTrue<Equals<Declared<"onDataload">, false>>();
expectTrue<Equals<Declared<"onPano_error">, false>>();
// 改名后的**对外名**确实存在
expectTrue<Declared<"onLoad">>();
expectTrue<Declared<"onError">>();

/* ---------------------------------------------------- 交互事件只有一份拼写 */

// 8. 官方事件名本来就没有分隔符的那五条，`camelCase` 与 `snake_case` 对它们是同一个
//    字符串 ⇒ **不需要别名**，只出现一次（加了会把同一个监听回调调两遍）。
expectTrue<Equals<ListenerOf<"onClickonroad">, { type: string }>>();
expectTrue<Equals<ListenerOf<"onDblclick">, ListenerOf<"onDblclick">>>();
