import { watch, type WatchStopHandle } from "vue";

/**
 * 一组**按下标对齐**的 watch 源，各自带一个「键」与一个「取值」函数。
 *
 * `source()` 的返回值就是 Vue 拿来做相等判定的那个**标量**——标量相等即视为未变
 * （`useOverlaySpec` / `useInfoWindow` 传进来的都是 `stableKeyOf` / 定形标量键的结果，
 * 因此内联字面量对象不会每轮重渲染都触发）。
 */
export interface KeyedSource<T> {
  /** 变更记录里用的键（下游据此决定重建还是就地写）。 */
  readonly key: string;
  /** 参与相等判定的标量。 */
  readonly source: () => T;
  /** 取**当前**值写入变更记录；在回调那一刻调用，因此拿到的是本轮最终值。 */
  readonly read: () => unknown;
}

/**
 * 把「N 个标量源 + 归算变更键」收成**一个**数组源 watcher（#138）。
 *
 * ## 为什么不写 N 个 per-field watcher
 *
 * 同一轮 flush 里 Vue 按**注册顺序**执行回调，第一个回调若同步排空，就会把值写到一个
 * **即将被丢弃**的实例上——「构造期字段要重建」与「就地字段要写在最终实例上」这两条
 * 同时被打破。单个数组源由 Vue 自己合帧，「一次提交改 N 个字段 ⇒ 一次回调」是调度器
 * 给的收益，不是我们合出来的（依据：ADR `2026-09-24-scheduler-batching-hot-path.md` §2）。
 *
 * ## 为什么固定 `flush: "post"`
 *
 * 回调在 post-flush 跑，`read()` 读到的是**本轮 flush 之后**的值。两点理由：
 * - 与 `useInfoWindow` 的意图 watcher（同一份机制的另一半）**对齐**，让「prop 驱动的收敛」
 *   与「事件驱动的收敛」落在同一个队列里（`useOverlaySpec` 的 `versioned` watcher 仍是
 *   `sync`，那是另一条 ADR 的结论，本 helper 不涉及）；
 * - 重建入参拿到的是本轮最终值，不会把一次多字段更新拆成两批下发。
 *
 * **如实说明门禁边界**：现有行为测试在 `flush` 改成 `pre` 时**仍然全绿**（实测）——本条
 * 目前是「与另一半对齐 + 少一批下发」的设计选择，不是会红的门禁。它一旦被改错，症状是
 * 「多出一次下发 / 收敛晚一拍」，属于性能与时序退化而非取值错误。
 *
 * @param sources 源数组；**不得**在 watcher 建立后增删（长度变了按下标对齐就不成立）。
 * @param onChanged 有键发生变化时调用，参数是 `{ [key]: 当前值 }`；无变化时不调用。
 * @returns 停止句柄（交给 `onScopeDispose` / effect scope 释放）。
 */
export function watchKeyedSources<T>(
  sources: readonly KeyedSource<T>[],
  onChanged: (changed: Record<string, unknown>) => void,
): WatchStopHandle {
  if (sources.length === 0) {
    // 没有源就没有 watcher；调用方本就以 `length > 0` 为门槛，这里只是不把空数组交给 Vue
    return () => {};
  }
  return watch(
    sources.map((entry) => entry.source),
    (next, prev) => {
      const changed: Record<string, unknown> = {};
      for (let i = 0; i < next.length; i++) {
        if (next[i] === prev[i]) continue;
        // 同一个 prop 出现两次时取最后一个（描述符键与别名键可能指向同一属性）
        changed[sources[i].key] = sources[i].read();
      }
      if (Object.keys(changed).length > 0) onChanged(changed);
    },
    { flush: "post" },
  );
}
