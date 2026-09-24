/**
 * `defineEmits` 的返回值 → **动态名转发器**（M5-VECTORS / issue #31）
 *
 * `OverlaySpec.events` 里的名字是字符串常量（既有矩阵派生的，也有覆盖项手写的），而
 * `defineEmits<T>()` 的返回值只接受**已声明的字面量键**。两者之间的桥只有一处类型断言——
 * 把它收进这个 5 行的函数，而不是在 9 个 SFC 里各写一遍 `as unknown as (…) => void`
 * （那 9 处写法还各自带一份注释，是典型的「同一件事说九遍」）。
 *
 * 运行期是恒等函数：Vue 的 `emit()` 按 `props[toHandlerKey(name)]` 查监听器，名字是字符串就够了。
 * 未声明的名字不会静默通过——`emit()` 会在开发期告警（`emitsOptions` 里没有它），因此
 * 「矩阵加了事件、SFC 忘了声明」由告警 + `overlay-suite.test.ts` 的 emits 门禁双重兜住。
 *
 * 自定义覆盖物的作者可以直接用它，不必自己写那一次断言。
 */
export function dynamicEmit(emit: unknown): (name: string, payload: unknown) => void {
  return emit as (name: string, payload: unknown) => void;
}
