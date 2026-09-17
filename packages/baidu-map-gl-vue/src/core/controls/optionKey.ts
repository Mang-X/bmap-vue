import { stableKeyOf } from "../utils/stableKey";

/**
 * 控件选项的**变化键**与**逐键值快照**（M7-CONTROL-PANORAMA / issue #41）
 *
 * ## 取值口径：**复用共享的 `stableKeyOf`**
 *
 * 「一个值 → 一个稳定字符串」这件事由 `core/utils/stableKey.ts` 的 `stableKeyOf` 提供
 * （与官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 同源；Overlay 侧的 watch 源用的
 * 就是它）。本文件**不再自带一份序列化**——同一件事有两份实现，迟早会在
 * 「函数怎么折叠」「`undefined` 与 `null` 要不要分」这类细节上分叉，而分叉的表现是
 * **变更检测静默失效**，最难查。
 *
 * ## 本文件只加控件侧需要的三件事
 *
 * 1. **逐键值快照**（`optionSnapshot`）：diff 基线必须是**值**而不是 `options()` 返回的对象。
 *    `offset` / `size` / `mapTypes` 的值是父级传入的**同一个引用**，把对象当基线会让父级的原地
 *    修改（`offset.x = 21`）把基线一起改掉——watch 源能感知，diff 两边序列化却相同 ⇒ 判成
 *    「没变化」⇒ 更新被静默吃掉（#95 评审第 2 轮 P1）。快照在建立的那一刻把值固定下来。
 * 2. **「键缺席」等价于「键存在但值为 `undefined`」**：两者在 Driver 侧都被跳过，不该算变化。
 * 3. **快照 vs 当前值**的比较口径与 watch 源一致（同一套 `stableKeyOf`），因此不会出现
 *    「watcher 说变了、diff 说没变」的分歧。
 *
 * ## 已知限制（登记在案，不在本文件修）
 *
 * `stableKeyOf` **不做 DOM 身份**：DOM 节点没有自有可枚举属性，会被序列化成 `{}`，因此
 * 「换成另一个节点」与「没换」得到同一个键。当前**没有任何组件把 DOM 放进 `options()`**
 * （`city-list.trigger` 没被暴露，且反向门禁要求组件的每个选项 prop 都有落地方式）；
 * 将来要暴露这类选项时，应在**共享的** `stableKeyOf` 里补 DOM 身份分支——一处修，两个 Facet 受益。
 * 用例见 `optionKey.test.ts` 的同名 describe。
 */

/**
 * 一份控件选项 → 变化键。
 *
 * 键里**刻意包含 `anchor` / `offset`**：它们也是「运行时可变」的选项，必须同一份 diff 覆盖，
 * 否则 anchor 变化会被漏掉（这正是 issue #41 要修的「位置不动态更新」）。
 */
export function optionKey(options: Record<string, unknown>): string {
  return stableKeyOf(options)
}

/**
 * **逐键的值快照**：`键 → 该键取值的变化键`。
 *
 * 为什么 diff 基线必须是快照，而不是 `options()` 返回的那个对象：`offset` / `size` / `mapTypes`
 * 这些键的值是**父级传入的同一个引用**。父级原地改字段（`offset.x = 21`）时，watch 源能感知
 * （`optionKey` 会递归跟踪到 `x` / `y`），但拿「持有同一引用的基线」去做比较，两边序列化出来
 * 完全一样 ⇒ 判定成「没变化」⇒ 更新被**静默吃掉**（#95 评审第 2 轮 P1）。
 *
 * 把值序列化在**基线建立的那一刻**固定下来，就与后续的原地修改彻底解耦；同时它与 watch 源
 * 共用同一套取值口径（都是 `optionKey`），因此不会出现「watcher 说变了、diff 说没变」的分歧。
 *
 * 不深拷贝的另一个理由（评审也提到了）：选项值域含 DOM、函数与可能的循环引用，深拷贝很难保持
 * 同一份契约；序列化字符串没有这个问题。
 */
export type OptionSnapshot = Readonly<Record<string, string>>

/** 建立一份值快照（与 `optionKey` 同一套取值口径）。 */
export function optionSnapshot(options: Record<string, unknown>): OptionSnapshot {
  const snapshot: Record<string, string> = {}
  for (const [key, value] of Object.entries(options)) {
    snapshot[key] = stableKeyOf(value)
  }
  return snapshot
}

/** 「键缺席」等价于「键存在但值为 `undefined`」——两者在 Driver 侧都被跳过，不该算变化。 */
const ABSENT_KEY = stableKeyOf(undefined)

/**
 * 快照与**当前**选项之间真的变了的键。
 *
 * 入参类型刻意是 `OptionSnapshot` 而不是 `Record<string, unknown>`：后者可以被误传成
 * 「上一次的选项对象」，那正是上一版的 bug（基线持有父级的引用）。类型上收窄能挡住这种写法。
 */
export function changedOptionKeys(
  previous: OptionSnapshot,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  const changed: string[] = []
  for (const key of keys) {
    if ((previous[key] ?? ABSENT_KEY) !== stableKeyOf(next[key])) changed.push(key)
  }
  return changed
}
