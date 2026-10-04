/**
 * 官方**已弃用**的图层类的开发期告知（#165「适配被弃用的图层类」）
 *
 * 官方把 `BMap.FillLayer` / `BMap.LineLayer` / `BMap.PointIconLayer` /
 * `BMap.PointShapeLayer` 四个类标了 `@deprecated`，本库**保留**了其中三个组件的封装
 * （弃用不等于可以删，见各组件文件头），因此要让使用者在开发期**看见**这件事，
 * 而且只看见**一次**：同一张页面里挂五个 `<LineLayer>`，刷五条同样的话等于没提示。
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
