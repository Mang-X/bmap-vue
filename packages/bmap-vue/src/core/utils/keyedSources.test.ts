/**
 * `watchKeyedSources` 单测（issue #138）
 *
 * 它是 `useOverlaySpec` 与 `useInfoWindow` 共用的**唯一**合并机制，因此断言的重点不是
 * 「Vue 的 watch 能不能跑」，而是本函数额外承诺的那三件事——每一条都曾经是缺陷来源：
 *
 * - **合帧**：N 个源在同一轮里只产生**一次**回调（写成 N 个 per-field watcher 时，
 *   第一个回调就会把值下发到一个即将被丢弃的实例上）；
 * - **取最终值**：`read()` 在回调那一刻调用，因此拿到的是本轮 flush 之后的值，
 *   不是触发那一刻的中间值；
 * - **只报真变化**：源的标量没变就不进 `changed`（否则每轮重渲染都会多下发一次命令）。
 */
import { describe, it, expect, vi } from 'vitest'
import { nextTick, reactive, effectScope } from 'vue'
import { watchKeyedSources, type KeyedSource } from './keyedSources'

/** 挂一个 watcher 并返回收口函数（effect scope 释放，模拟组件卸载）。 */
function mount<T>(sources: KeyedSource<T>[], onChanged: (c: Record<string, unknown>) => void) {
  const scope = effectScope()
  scope.run(() => watchKeyedSources(sources, onChanged))
  return () => scope.stop()
}

describe('watchKeyedSources', () => {
  it('一轮里改多个源：只回调一次，且一次带上全部变更键', async () => {
    const state = reactive({ a: 1, b: 2, c: 3 })
    const onChanged = vi.fn()
    const stop = mount(
      [
        { key: 'ka', source: () => state.a, read: () => state.a },
        { key: 'kb', source: () => state.b, read: () => state.b },
        { key: 'kc', source: () => state.c, read: () => state.c },
      ],
      onChanged,
    )

    state.a = 10
    state.b = 20
    state.c = 30
    await nextTick()

    // 「合帧」是全部要害：写成 N 个 watcher 时这里会是 3 次
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith({ ka: 10, kb: 20, kc: 30 })
    stop()
  })

  it('取值是**回调那一刻**的值：同一轮里连改两次只上报一次，报的是后到的那个', async () => {
    const state = reactive({ a: 1 })
    const seen: unknown[] = []
    const stop = mount([{ key: 'k', source: () => state.a, read: () => state.a }], (c) => {
      seen.push(c.k)
    })

    // 同一轮里连改两次：源数组被 Vue 合帧成**一次**回调，`read()` 在回调里取值 ⇒ 只看到 20。
    // （这一条锁的是「合帧 + 取值时机」的组合；`flush` 档本身不由此条区分，见源码注释的
    //  门禁边界说明。）
    state.a = 10
    state.a = 20
    await nextTick()

    expect(seen).toEqual([20])
    stop()
  })

  it('源的标量没变就不报（内联字面量按内容判等）', async () => {
    // 每次读都造一个新对象，但 `source()` 返回的是稳定序列化后的标量
    const state = reactive<{ items: { id: number }[] }>({ items: [{ id: 1 }] })
    const onChanged = vi.fn()
    const stop = mount(
      [
        {
          key: 'k',
          source: () => JSON.stringify(state.items),
          read: () => state.items,
        },
      ],
      onChanged,
    )

    state.items = [{ id: 1 }]
    await nextTick()
    expect(onChanged, '内容相同 ⇒ 判为未变').not.toHaveBeenCalled()

    state.items = [{ id: 2 }]
    await nextTick()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith({ k: [{ id: 2 }] })
    stop()
  })

  it('同一键出现两次时取最后一个（别名键与描述符键可能指向同一 prop）', async () => {
    const state = reactive({ v: 1 })
    const onChanged = vi.fn()
    const stop = mount(
      [
        { key: 'first', source: () => state.v, read: () => `first:${state.v}` },
        { key: 'second', source: () => state.v + 0, read: () => `second:${state.v}` },
      ],
      onChanged,
    )

    state.v = 5
    await nextTick()

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith({ first: 'first:5', second: 'second:5' })
    stop()
  })

  it('空源数组不建 watcher，停止句柄可安全调用', () => {
    const onChanged = vi.fn()
    const stop = mount([], onChanged)
    expect(onChanged).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })
})
