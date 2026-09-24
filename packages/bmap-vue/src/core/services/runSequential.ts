/**
 * 顺序执行一批同类调用，并把每项的结果按原顺序收成数组（M7-SERVICE-CORE / issue #38）。
 *
 * 为什么是**顺序**而不是并发：百度服务有配额 / QPS 限制，批量并发是最容易被限流打回的用法；
 * 而且多数量级下调用方要的是「每一项各自的终态」而不是总耗时。
 *
 * 为什么值得抽成一个具名原语：它是「批量动作 + 部分成功」这条语义的落点——
 * `useGeocoder.getBatch` 与 `useGeocodeDetail.getBatch` 逐项返回
 * `{ …, status, error }`，两处都必须是**同一份**顺序 / 逐项口径，否则「部分成功」的
 * 语义会在两个服务之间漂移。
 */
export async function runSequential<TIn, TOut>(
  items: readonly TIn[],
  run: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results: TOut[] = [];
  for (const [index, item] of items.entries()) {
    results.push(await run(item, index));
  }
  return results;
}
