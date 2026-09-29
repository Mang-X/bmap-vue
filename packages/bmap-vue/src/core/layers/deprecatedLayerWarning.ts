/**
 * 官方**已弃用**的图层类的开发期告知（#165「适配被弃用的图层类」）
 *
 * ## 需求
 *
 * 官方 `@baidumap/jsapi-v4-types@4.0.5` 把 `BMap.FillLayer` / `BMap.LineLayer` /
 * `BMap.PointIconLayer` / `BMap.PointShapeLayer` 四个类标了 `@deprecated`。本库**保留**了其中
 * 三个组件的封装（弃用不等于可以删，见各组件文件头），因此要让使用者在开发期**看见**这件事，
 * 而且只看见**一次**：同一张页面里挂五个 `<LineLayer>`，刷五条同样的话等于没提示。
 *
 * ## 为什么单独立一个模块，而不在组件里直接调 `createDevWarnOnce()`
 *
 * `createDevWarnOnce()` 已经是「同 key 只报一次」的语义了，但它的去重集合挂在**调用方**身上 ——
 * 于是调用方必须有一处「只跑一次」的代码。在 SFC 里那只有两个位置，两个都有问题：
 *
 * - **`<script setup>` 顶层**：那里每次实例化都重跑 ⇒ 每个实例一份 `Set` ⇒ 刷 N 条。
 * - **普通 `<script>` 块**：只在模块求值时跑一次，语义对了，**但代价是公共 `.d.ts` 形状变了**。
 *   实测：SFC 同时有 `<script>` 与 `<script setup>` 时，Volar 对 `LineLayer` / `FillLayer` 的
 *   推断与纯 `<script setup>` 不同 —— `DefineComponent<…>` 从具名常量**内联展开**，
 *   `etc/<出口>/bmap-vue.dts.md`（第 3 层签名基线）能直接看出差别。
 *   为了加一句告警而改动**公共类型基线**，不值得：1.0 冻结面（ADR「公共出口冻结」）
 *   正是把 `dist` 下的公共 `.d.ts` 钉成门禁，用来防这类「顺手改掉公共面」。
 *
 * 本模块把那份「只跑一次的 `Set`」放在**模块作用域**（模块级代码天然只求值一次），
 * 组件侧只剩一次普通函数调用：去重是模块级的，公共类型面**一个字节都不动**。
 *
 * ## 它做什么 / 不做什么
 *
 * - **每个 `key` 只报一次**。键由调用方给（惯例 `<组件名>:deprecated-class`），**不要**拿文案
 *   当键 —— 改了文案就重新开始刷，那会变成静默行为。
 * - **生产环境完全静默**：走 `core/logger` 的 `devWarn`，由它按 `isDev()` 早退。本模块**不另造**
 *   环境判定（消费方 bundler 会把 `process.env.NODE_ENV` 折叠掉，生产包里这段进不去）。
 * - **不改行为**：只发一条告警。组件照常工作，资源账本、释放路径一概不动。
 *
 * ⚠️ 本模块**不进公共出口**：它是组件内部的告知机制，不是库使用者要 import 的 API。
 */
import { devWarn } from "../logger";

/**
 * 模块级去重集合。
 *
 * 刻意**不是** `createDevWarnOnce()` 返回的闭包：那个闭包是「给一个调用方用的」，去重集合跟着
 * 那个调用方走。本模块要让去重**跨组件实例**成立，所以权威必须是模块级的 `Set`；
 * 底层输出仍然复用 `devWarn`（生产静音那一份判定只有它有）。
 */
const seen = new Set<string>();

/**
 * 报一条「官方已弃用」的开发期提示，每个 `key` 只报一次。
 *
 * ⚠️ 组件的调用点放在 **setup 里**（组件**创建**时）而不是模块求值时：模块一被 `import` 就说话，
 * 使用者的构建工具 / SSR 预渲染会在他们自己的进程里看到「组件还没用就被警告了」。
 *
 * @param key 稳定去重键，惯例是 `<组件名>:deprecated-class`。
 * @param message 提示正文。**必须点名官方弃用的类与官方建议的替代类**；替代品本库还没提供时
 *   还要说清楚「还没有」—— 对着不存在的东西说「改用 X」是本票明确禁止的。
 */
export function warnDeprecatedLayerOnce(key: string, message: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  devWarn(message);
}
