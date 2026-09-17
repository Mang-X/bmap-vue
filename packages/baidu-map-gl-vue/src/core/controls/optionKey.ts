/**
 * 控件选项的**变化键**（M7-CONTROL-PANORAMA / issue #41）
 *
 * 统一 Control adapter 用它当 `watch` 的源。直接 watch 选项对象会让「父级传内联字面量」
 * （引用每次都新）每次都触发一次无用的比较；而比较本身又不能用 `===`——选项的取值域是
 * **官方构造选项的值域**，里面既有标量，也有数组（`mapTypes`）、回调
 * （`CityListControlOptions.onChangeSuccess` 之类）与 DOM 节点（`CityListControlOptions.trigger`）。
 *
 * 三类值分开处理（与 `equality.ts` 的 `centerKey` 同一口径：**键只回答「可能要变」**，
 * 真正的相等判定留给调用方）：
 *
 * - **函数** → 固定字面量 `fn`（**按存在性比较，不按身份**，见下面的「函数值的契约」）；
 * - **DOM 节点** → 按对象身份分配稳定序号（`trigger` 这类选项传的是真 DOM；同一个节点、
 *   同一份配置不应触发重建，换一个节点才应该）；
 * - **其余** → 稳定 JSON（对象键排序），因此 `{type: "a"}` 与 `{type: "a"}` 得到同一个键，
 *   而 `mapTypes: [1, 2]` 与 `[2, 1]` 不同。
 *
 * `undefined` 与 `null` **必须分开**（`undefined` / `null`）：前者是「没传这个键」，后者是
 * 「显式传了 null」，两者在本 Driver 里走不同路径（`projectOptions` / `setOptions` 会跳过
 * `undefined`、把 `null` 原样交给 SDK 的结构逃生口）。合并成一个键会把「显式传 null」当成
 * 「没变化」而吃掉——这与「有值 → undefined」是同一类漏检。官方参考实现
 * `huiyan-fe/react-bmap` 的 `stableStringify` 也是这么分的（注释写明「两者互换时 effect
 * 不重跑」）。
 *
 * ## 函数值的契约（**按存在性比较**）
 *
 * 函数折叠成 `fn` 意味着：**换一个回调不算「选项变了」**。这是刻意的，与官方参考实现同口径
 * （它的 `stableStringify` 同样 `typeof value === 'function' → 'fn'`）：父级在模板里传内联
 * 箭头函数是常规写法，若按身份比较，`recreate` 类回调选项会**每次渲染都重建控件**。
 *
 * 代价写在明处：**回调选项更新不会被下发**。因此 `ControlSpec.options()` 不应承载需要在运行期
 * 更新的回调——需要新闭包时应当经 `spec.events`（每次（重）创建后绑定）或由组件自己维护稳定
 * 代理。当前没有任何控件把函数值放进 `options()`（`BControl` 的 DOM 工厂走 `spec.render`，
 * 不进选项），这条约束是给后续消费者看的。用例：`optionKey.test.ts` 的同名 describe。
 *
 * 函数与 DOM 两个分支在当前组件集里没有直接消费者，但它们不是「预留」：没有它们，函数会被
 * 序列化成 `{}`、DOM 会被序列化成属性快照——两种都是**静默的漏检**（两个不同的值得到同一个
 * 键 ⇒ 变更检测失效、下发被吃掉）。
 *
 * 值里出现循环引用时**不抛错**（选项来自用户 props，抛错会把一次渲染变成崩溃）：
 * 退化为 `cycle` 标记。这只会让「本该等」的判成「不等」，代价是一次多余的下发。
 */

/** DOM 节点 → 稳定序号。同一个节点在两次调用中得到同一个序号。 */
const domIds = new WeakMap<object, number>()
let nextDomId = 0

function isDomNode(value: object): boolean {
  // 只认节点身份，不读节点上的任何属性：`nodeType` 在 happy-dom / 真实浏览器上一致，
  // 而 `tagName` 之类在「同一节点的自定义包装」上会给出误导性的相等。
  return typeof (value as { nodeType?: unknown }).nodeType === "number"
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null"
  // 与 `null` **不同**标记：`undefined` = 「没传这个键」，`null` = 「显式传了 null」，
  // Driver 侧对两者走不同路径（见文件头）。合并会让「显式传 null」被当成没变化而吃掉。
  if (value === undefined) return "undefined"
  const type = typeof value
  if (type === "function") return "fn"
  if (type === "number" || type === "boolean") return String(value)
  if (type === "string") return JSON.stringify(value)
  if (type === "bigint") return `${String(value)}n`
  if (type === "symbol") return String(value)

  const object = value as object
  if (isDomNode(object)) {
    let id = domIds.get(object)
    if (id === undefined) {
      nextDomId += 1
      id = nextDomId
      domIds.set(object, id)
    }
    return `dom#${id}`
  }
  if (seen.has(object)) return "cycle"
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      return `[${object.map((item) => serialize(item, seen)).join(",")}]`
    }
    const entries = Object.entries(object as Record<string, unknown>)
      // 键排序：`{a, b}` 与 `{b, a}` 是同一个选项
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, seen)}`)
    return `{${entries.join(",")}}`
  } finally {
    seen.delete(object)
  }
}

/**
 * 一份控件选项 → 变化键。
 *
 * 键里**刻意包含 `anchor` / `offset`**：它们也是「运行时可变」的选项，必须同一份 diff 覆盖，
 * 否则 anchor 变化会被漏掉（这正是 issue #41 要修的「位置不动态更新」）。
 */
export function optionKey(options: Record<string, unknown>): string {
  return serialize(options, new Set())
}

/** 两份选项之间**真的变了**的键（浅比较，逐键用 `optionKey` 的取值口径）。 */
export function changedOptionKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  const changed: string[] = []
  for (const key of keys) {
    if (optionKey({ value: previous[key] }) !== optionKey({ value: next[key] })) changed.push(key)
  }
  return changed
}
