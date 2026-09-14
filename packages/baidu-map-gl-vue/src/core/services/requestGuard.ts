/**
 * 请求序列守卫（M7-SERVICE-CORE / issue #38）
 *
 * 「旧请求不得覆盖新结果」是 issue 的硬要求，而它在六个 composable 里的实现完全一样：
 * 每次发起递增一个序列号，回包落地前比对「我是不是最新的那个」。写成一份的好处是
 * **口径只有一个**——否则很容易出现某处用 `>=`、某处忘了在卸载时失效。
 *
 * 两条语义：
 * - `next()` **使之前所有在飞请求失效**（最新者胜）；
 * - `invalidate()` 只失效、不产生新序列号（取消 / 重置 / 卸载时用）。
 *
 * 守卫本身不认识 Promise，也不做取消——它只回答「这个结果还算数吗」。真正的放弃请求
 * （`ServiceCall.cancel()`）由调用方执行，因为只有它知道怎么取消。
 */
export interface RequestGuard {
  /** 开启一轮新请求；返回本次的序列号（旧的在飞请求就此失效）。 */
  next(): number;
  /** 该序列号是否仍是当前最新的一轮。 */
  isCurrent(id: number): boolean;
  /** 使当前在飞请求失效（不改变「下一个」的取值来源）。 */
  invalidate(): void;
  /** 当前序列号。 */
  readonly current: number;
}

export function createRequestGuard(): RequestGuard {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(id) {
      return id === current;
    },
    invalidate() {
      current += 1;
    },
    get current() {
      return current;
    },
  };
}
