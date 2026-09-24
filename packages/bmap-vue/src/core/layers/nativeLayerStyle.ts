/**
 * 图层样式的**投影**（M6 / issue #36）
 *
 * 线 / 面图层的样式里允许出现**函数**（官方 `StyleExpress` 的第三支：
 * `(properties) => color`，做数据驱动样式）。这类字段有两个必须同时满足的需求：
 *
 * 1. **换实现之后要生效**：用户把 `strokeColor: fn1` 改成 `fn2` 时，SDK 侧手上那个函数必须
 *    变成新的实现；
 * 2. **内联箭头不能触发写**：父级每次渲染都新建一个箭头函数是常态，若按引用比较指纹，图层会
 *    在每次渲染时重写样式（并触发一次重绘）——那是比「不生效」更糟的缺陷。
 *
 * 两条同时满足的方式就是仓库里已有的 `forwardCallback`（`core/layers/LayerSpec.ts`）：交给 SDK
 * 的是一个**身份恒定**的包装，它每次被调用时去读**最新**的 prop。于是指纹里函数依旧折叠成 `fn`
 * （不触发写），而实现已经换了。
 *
 * 生效范围要说准（与 `forwardCallback` 的文档一致）：换实现后生效的是**后续的调用**——SDK 下一次
 * 求值样式表达式时用新实现；**已经产生的画面不会回溯变化**。需要让已经在图上的要素立刻换样式时，
 * 换掉 `data` 的引用（触发 `setData` 重新解析）是最可靠的做法。
 *
 * ⚠️ 函数以外的值**不做任何处理**：本模块不猜官方表达式的结构（`object` 那一支是 SDK 自己的语法），
 * 只负责「有表态的字段进袋、`undefined` 不进袋」。
 */
import { forwardCallback } from "./LayerSpec";

/**
 * 把组件的 `style` prop 投影成交给 SDK 的样式袋。
 *
 * @param get 样式对象的取值器（**必须**是取值器而不是对象本身：包装函数要在调用时刻读最新值）
 * @returns 只含「有表态」字段的样式袋；一个都没有时返回 `undefined`（= 不表态，不产生 SDK 调用）
 */
export function projectLayerStyle(
  get: () => Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const source = get();
  if (!source) return undefined;
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    projected[key] =
      typeof value === "function"
        ? forwardCallback(() => {
            const latest = get();
            return latest ? latest[key] : undefined;
          })
        : value;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}
