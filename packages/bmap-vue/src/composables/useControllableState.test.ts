/**
 * `useControllableState` 单测（M4-STATE / issue #27）
 *
 * 用例只写「受控 / 非受控 / 缺省」三态的领域语义，不碰组件与 SDK：
 * 组件侧的接线（哪次变化写哪条 SDK 命令）由 `tests/behavior/v3-bmap.test.ts` 覆盖。
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useControllableState, type EqualFn, type UseControllableStateOptions } from './useControllableState'
import { numbersEqual } from '../core/utils/equality'

/** 一次性的 effect scope：被测 composable 会注册 watcher，测试要能整批停掉。 */
let scopes: EffectScope[] = []

function inScope<T>(factory: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(factory) as T
}

afterEach(() => {
  for (const scope of scopes) scope.stop()
  scopes = []
})

function numberState(
  options: {
    value?: () => number | undefined
    defaultValue?: () => number | undefined
    fallback?: number
    equals?: EqualFn<number>
    warn?: boolean
    name?: string
  } = {},
) {
  const opts: UseControllableStateOptions<number> = {
    name: options.name ?? 'zoom',
    value: options.value ?? (() => undefined),
    defaultValue: options.defaultValue,
    fallback: options.fallback ?? 14,
    equals: options.equals ?? numbersEqual,
    warn: options.warn,
  }
  return inScope(() => useControllableState<number>(opts))
}

function spyWarn(): MockInstance {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

/** 只看 `console.warn` 的**首参**：`logger.warn` 把 context 作为第二参附加。 */
function warnLines(warn: MockInstance): string[] {
  return warn.mock.calls.map((call) => String(call[0]))
}

describe('useControllableState', () => {
  it('受控：生效值取外部值，外部值变化同步进内部镜像', () => {
    const external = ref<number | undefined>(12)
    const state = numberState({ value: () => external.value })

    expect(state.isControlled.value).toBe(true)
    expect(state.value.value).toBe(12)

    external.value = 13
    expect(state.value.value).toBe(13)

    state.syncExternal(13)
    expect(state.internal.value).toBe(13)
  })

  it('非受控：初值取自 defaultValue，default 后续变化不覆盖内部状态并告警', async () => {
    const fallbackDefault = ref<number | undefined>(8)
    const warn = spyWarn()
    const state = numberState({ defaultValue: () => fallbackDefault.value })

    expect(state.isControlled.value).toBe(false)
    expect(state.initial).toBe(8)
    expect(state.value.value).toBe(8)

    fallbackDefault.value = 9
    await nextTick()

    expect(state.value.value, 'default 变化不得覆盖内部状态').toBe(8)
    expect(state.internal.value).toBe(8)
    expect(warnLines(warn).some((line) => line.includes('只在首次解析时生效'))).toBe(true)
  })

  it('非受控：default 只改了浮点抖动范围内的值时不告警', async () => {
    const fallbackDefault = ref<number | undefined>(8)
    const warn = spyWarn()
    numberState({ defaultValue: () => fallbackDefault.value })

    fallbackDefault.value = 8 + 1e-9
    await nextTick()

    expect(warnLines(warn).some((line) => line.includes('只在首次解析时生效'))).toBe(false)
  })

  it('缺省：既无受控值也无 default 时用库默认值做首次解析', () => {
    const state = numberState({ fallback: 14 })

    expect(state.isControlled.value).toBe(false)
    expect(state.initial).toBe(14)
    expect(state.value.value).toBe(14)
  })

  it('commit：容差内判等 → 不更新（抑制浮点抖动带来的重复回写）', () => {
    const state = numberState({ fallback: 14 })

    expect(state.commit(14 + 1e-9)).toBe(false)
    expect(state.internal.value).toBe(14)

    expect(state.commit(15)).toBe(true)
    expect(state.internal.value).toBe(15)

    expect(state.commit(15)).toBe(false)
  })

  it('syncExternal：非受控 → 受控且值冲突时告警一次，同向重复不重复告警', () => {
    const external = ref<number | undefined>(undefined)
    const warn = spyWarn()
    const state = numberState({ value: () => external.value, fallback: 14 })

    expect(state.isControlled.value).toBe(false)

    external.value = 16
    state.syncExternal(16)

    expect(state.isControlled.value).toBe(true)
    expect(state.internal.value).toBe(16)
    expect(warnLines(warn).filter((line) => line.includes('由非受控切换为受控')).length).toBe(1)

    external.value = 17
    state.syncExternal(17)
    expect(warnLines(warn).filter((line) => line.includes('由非受控切换为受控')).length).toBe(1)
  })

  it('syncExternal：非受控 → 受控但值与内部状态一致时不告警（v-model 首帧回写）', () => {
    const external = ref<number | undefined>(undefined)
    const warn = spyWarn()
    const state = numberState({ value: () => external.value, fallback: 14 })

    // 用户先交互：内部状态跟随 SDK
    expect(state.commit(16)).toBe(true)

    // 父级把同一个值写进受控 prop（`v-model` 的正常首帧），语义上没有发生模式切换
    external.value = 16
    state.syncExternal(16)

    expect(state.isControlled.value).toBe(true)
    expect(warnLines(warn).some((line) => line.includes('切换'))).toBe(false)
  })

  it('syncExternal：受控 → 非受控保留最后一次外部值，并告警', () => {
    const external = ref<number | undefined>(20)
    const warn = spyWarn()
    const state = numberState({ value: () => external.value, fallback: 14 })

    expect(state.isControlled.value).toBe(true)

    external.value = undefined
    state.syncExternal(undefined)

    expect(state.isControlled.value).toBe(false)
    expect(state.value.value, '内部状态接管时保留最后的外部值').toBe(20)
    expect(warnLines(warn).filter((line) => line.includes('由受控切换为非受控')).length).toBe(1)
  })

  it('copy：初值、外部同步与 SDK 回写都持有独立拷贝（原地 mutation 不改内部状态）', () => {
    interface Spot {
      lng: number
      lat: number
    }
    const spotEquals = (a: Spot, b: Spot) => a.lng === b.lng && a.lat === b.lat
    const cloneSpot = (value: Spot): Spot => ({ lng: value.lng, lat: value.lat })

    const external: Spot = { lng: 1, lat: 2 }
    const state = inScope(() =>
      useControllableState<Spot>({
        name: 'center',
        value: () => external,
        fallback: { lng: 0, lat: 0 },
        equals: spotEquals,
        copy: cloneSpot,
      }),
    )

    // ① 暴露的初值与内部状态各自独立，且都不是调用方那个对象
    expect(state.initial).not.toBe(external)
    expect(state.initial).toEqual(external)
    expect(state.internal.value).not.toBe(state.initial)
    expect(state.internal.value).toEqual(external)

    // ② 调用方原地改自己的对象：内部状态不受影响（1,2 仍然是当前值 ⇒ 不算「变化」）
    external.lng = 99
    expect(state.commit({ lng: 1, lat: 2 }), '内部状态未被 mutation 改写').toBe(false)

    // ③ 外部同步存的是拷贝
    const nextExternal: Spot = { lng: 5, lat: 6 }
    state.syncExternal(nextExternal)
    nextExternal.lng = 77
    expect(state.internal.value).toEqual({ lng: 5, lat: 6 })

    // ④ SDK 回写也存拷贝（事件载荷与内部状态解耦）
    const fromSdk: Spot = { lng: 7, lat: 8 }
    expect(state.commit(fromSdk)).toBe(true)
    fromSdk.lng = 70
    expect(state.internal.value).toEqual({ lng: 7, lat: 8 })
    expect(state.commit({ lng: 7, lat: 8 })).toBe(false)
  })

  it('非受控：default 从无到有也不生效，但必须告警一次（第三轮 P2）', async () => {
    const fallbackDefault = ref<number | undefined>(undefined)
    const warn = spyWarn()
    const state = numberState({
      value: () => undefined,
      defaultValue: () => fallbackDefault.value,
      fallback: 14,
    })

    expect(state.value.value).toBe(14)
    expect(warnLines(warn).length).toBe(0)

    // 首次解析时没有 default，之后异步传入 ⇒ 值不生效，但这种「最需要提示的误用」不能静默
    fallbackDefault.value = 9
    await nextTick()

    expect(state.value.value, '之后传入的 default 不得覆盖内部状态').toBe(14)
    expect(warnLines(warn).filter((line) => line.includes('只在首次解析时生效')).length).toBe(1)
  })

  it('reset：把内部状态恢复为首次解析的初值（不通知）', () => {
    const state = numberState({ fallback: 14 })

    expect(state.commit(20)).toBe(true)
    expect(state.internal.value).toBe(20)

    state.reset()
    expect(state.internal.value, 'reset 回到 initial').toBe(14)
    // 回到初值之后再「交互到 14」不算变化（内部状态已经是 14）
    expect(state.commit(14)).toBe(false)
  })

  it('copy：reset 恢复的初值也是独立拷贝', () => {
    interface Spot {
      lng: number
      lat: number
    }
    const cloneSpot = (value: Spot): Spot => ({ lng: value.lng, lat: value.lat })
    const state = inScope(() =>
      useControllableState<Spot>({
        name: 'center',
        value: () => undefined,
        fallback: { lng: 0, lat: 0 },
        equals: (a, b) => a.lng === b.lng && a.lat === b.lat,
        copy: cloneSpot,
      }),
    )

    expect(state.commit({ lng: 5, lat: 6 })).toBe(true)
    state.reset()
    expect(state.internal.value).toEqual({ lng: 0, lat: 0 })
    expect(state.internal.value).not.toBe(state.initial)
  })

  it('warn: false 时模式切换与 default 失效都静默', async () => {
    const external = ref<number | undefined>(undefined)
    const fallbackDefault = ref<number | undefined>(1)
    const warn = spyWarn()
    const state = numberState({
      value: () => external.value,
      defaultValue: () => fallbackDefault.value,
      warn: false,
    })

    external.value = 99
    state.syncExternal(99)
    external.value = undefined
    state.syncExternal(undefined)
    fallbackDefault.value = 2
    await nextTick()

    expect(warnLines(warn).length).toBe(0)
  })
})

describe('isControlled 的惰性创建（#137 复审八轮 P1）', () => {
  /**
   * 惰性与否的可观察口径是「**分配了几个 computed**」，而**不是** effect 数 ——
   * `computed` 懒求值、不挂 scope，从来不计入 `getCurrentScope().effects.length`
   * （ADR §6.2 记录的盲区：effect gate 看不见这一类对象）。
   *
   * ⚠️ 这也是本组用例存在的理由：**把实现改回 eager，这些用例必须变红**。已实测：
   * 只断言「重复访问是同一实例」时，eager 版照样全过 —— 也就是说「缓存命中」证明不了
   * 「惰性」。唯一能判别的办法是直接数分配。
   */
  it('构造时**不**分配 `isControlled` 的 computed；首次访问才分配且此后命中缓存', async () => {
    // ESM 的导出不可 spy，所以用 `vi.doMock` 换掉本模块看到的 `vue`（保留真实实现，只数次数）。
    const vue = await import('vue')
    let computedCount = 0
    vi.resetModules()
    vi.doMock('vue', async () => {
      const actual = await vi.importActual<typeof import('vue')>('vue')
      return {
        ...actual,
        computed: ((...args: Parameters<typeof actual.computed>) => {
          computedCount += 1
          return actual.computed(...args)
        }) as typeof actual.computed,
      }
    })
    try {
      // 重新加载，让被测模块拿到被计数的 `computed`。
      const mod = await import('./useControllableState')
      const external = ref<number | undefined>(undefined)
      const state = inScope(() =>
        mod.useControllableState<number>({
          name: 'zoom',
          value: () => external.value,
          fallback: 14,
          equals: numbersEqual,
        }),
      )
      // 此刻零消费者：`<Map>` 从不读它 ⇒ **不该**为它分配任何 computed。
      const beforeAccess = computedCount

      const first = state.isControlled
      const afterFirstAccess = computedCount
      const second = state.isControlled

      expect(
        afterFirstAccess - beforeAccess,
        '首次访问 isControlled 才分配（构造时那次 eager 分配会让这个差为 0）',
      ).toBe(1)
      expect(computedCount, '重复访问不得再分配').toBe(afterFirstAccess)
      expect(first, '重复访问必须命中缓存').toBe(second)
      expect(first.value).toBe(false)
      external.value = 7
      expect(first.value, '受控后变 true').toBe(true)
      void vue
    } finally {
      vi.doUnmock('vue')
      vi.resetModules()
    }
  })

  it('公共返回形状未变：isControlled 仍是可直接赋给 ComputedRef<boolean> 的成员', () => {
    const state = numberState()
    // 静态形状断言：把它删掉、或改成非 `ComputedRef`，这行都会编译失败。
    const controlled: import('vue').ComputedRef<boolean> = state.isControlled
    expect(controlled.value).toBe(false)
  })
})
