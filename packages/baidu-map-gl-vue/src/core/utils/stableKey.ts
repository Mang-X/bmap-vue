/**
 * 稳定序列化（stable key）
 *
 * 用途：**响应式 watch 的源**。Vue 的 `watch(() => props.icon, ...)` 按引用比较，而父级每次渲染
 * 传内联对象字面量时引用都会变——于是「内容完全没变」也会被当成一次更新，对覆盖物就是一条多余
 * 的 SDK 命令（重建 Instance / `setIcon` / `setOffset`）。把源换成「按内容生成的稳定字符串」之后，
 * 只有真的变了才唤醒。
 *
 * 规则（与官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 同源）：
 * - 对象按 key **字典序**排列，因此 `{a:1,b:2}` 与 `{b:2,a:1}` 得到同一个 key；
 * - 函数折叠成 `"fn"`：内联回调每次渲染都是新函数，参与比较只会制造无意义的重建；
 * - `undefined` / 循环引用有各自的占位符（`[undefined]` / `[circular]`），不会与真实值撞车；
 * - 循环引用按**路径**判定：同一个对象在两个兄弟分支里各出现一次不算循环。
 *
 * 不做什么：不做深比较、不缓存结果（调用方是 watch 源，每次求值一次即可）。
 */
export function stableKeyOf(value: unknown): string {
  const stack = new Set<object>();

  const normalize = (input: unknown): unknown => {
    if (typeof input === "function") return "fn";
    if (input === undefined) return "[undefined]";
    if (typeof input !== "object" || input === null) return input;
    const target = input as object;
    if (stack.has(target)) return "[circular]";
    stack.add(target);
    try {
      if (Array.isArray(input)) return input.map(normalize);
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) out[key] = normalize(source[key]);
      return out;
    } finally {
      stack.delete(target);
    }
  };

  const serialized = JSON.stringify(normalize(value));
  // `JSON.stringify(undefined)` 是 `undefined`（不是字符串）：这里给出稳定的字符串形态。
  return serialized === undefined ? String(normalize(value)) : serialized;
}
