/**
 * `useControllableState` 单测（M4-STATE / issue #27）
 *
 * 用例只写「受控 / 非受控 / 缺省」三态的领域语义，不碰组件与 SDK：
 * 组件侧的接线（哪次变化写哪条 SDK 命令）由 `tests/behavior/v3-bmap.test.ts` 覆盖。
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { effectScope, getCurrentScope, nextTick, ref, type EffectScope } from 'vue'
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

describe('告警去重集合的惰性创建（#137 复审九轮 P1）', () => {
  /**
   * 口径是「分配了几个 `Set`」。`Set` 是全局，可以直接 `vi.spyOn(globalThis, 'Set')` ——
   * 不像 `computed` 那样受 ESM 导出不可 spy 的限制。
   *
   * ⚠️ 只断言「告警次数」证明不了惰性（eager 版次数完全一样），必须数分配。
   */
  function countingSets() {
    const RealSet = globalThis.Set
    let allocated = 0
    // 用普通 function（箭头函数不可 new），并保留原型链与静态方法。
    function CountingSet(this: unknown, ...args: unknown[]) {
      allocated += 1
      return new RealSet(...(args as []))
    }
    CountingSet.prototype = RealSet.prototype
    Object.setPrototypeOf(CountingSet, RealSet)
    const spy = vi
      .spyOn(globalThis, 'Set')
      .mockImplementation(CountingSet as unknown as SetConstructor)
    // vitest / spy 自身也可能用 Set（`new Set(...)`、spy registry 等）——先测**基线**，
    // 用增量而不是绝对值，否则测的是 vitest 而不是被测代码。
    const baseline = allocated
    return {
      get baseline() {
        return baseline
      },
      get allocated() {
        return allocated
      },
      restore: () => spy.mockRestore(),
    }
  }

  it('无告警的正常路径不分配 Set；首次真实告警才分配一次，之后复用同一个', async () => {
    const warn = spyWarn()
    const counter = countingSets()
    try {
      const external = ref<number | undefined>(12)
      const fallbackDefault = ref<number | undefined>(8)
      const state = inScope(() =>
        useControllableState<number>({
          name: 'zoom',
          value: () => external.value,
          defaultValue: () => fallbackDefault.value,
          fallback: 14,
          equals: numbersEqual,
        }),
      )
      // 常规路径：受控值变化、提交、摘控**都不冲突** ⇒ 不该有任何告警。
      external.value = 13
      await nextTick()
      state.syncExternal(13)
      state.commit(15)
      await nextTick()
      expect(warnLines(warn).length, '这些操作本身不产生告警').toBe(0)
      expect(
        counter.allocated - counter.baseline,
        '无告警路径不应分配去重 Set',
      ).toBe(0)

      // 第一次**真实**告警：受控 → 非受控。
      state.syncExternal(undefined)
      expect(warnLines(warn).length, '受控→非受控应告警一次').toBe(1)
      expect(counter.allocated - counter.baseline, '首次告警才分配，且只分配一个').toBe(1)

      // 后续同类告警复用同一个 Set，不再分配。
      state.syncExternal(20)
      state.syncExternal(undefined)
      await nextTick()
      expect(counter.allocated - counter.baseline, '复用同一个去重 Set，不再分配').toBe(1)
      // 每种方向最多一次：受控→非受控 1 次；非受控→受控（值冲突）1 次。
      expect(warnLines(warn).filter((l) => l.includes('由受控切换为非受控')).length).toBe(1)
      expect(warnLines(warn).filter((l) => l.includes('由非受控切换为受控')).length).toBe(1)
    } finally {
      counter.restore()
      warn.mockRestore()
    }
  })

  it('warn: false 时即使触发模式/default 变化也永不分配 Set', async () => {
    const warn = spyWarn()
    const counter = countingSets()
    try {
      const external = ref<number | undefined>(12)
      const fallbackDefault = ref<number | undefined>(8)
      const state = inScope(() =>
        useControllableState<number>({
          name: 'zoom',
          value: () => external.value,
          defaultValue: () => fallbackDefault.value,
          fallback: 14,
          equals: numbersEqual,
          warn: false,
        }),
      )
      state.syncExternal(undefined)
      fallbackDefault.value = 9
      await nextTick()
      state.syncExternal(20)
      state.syncExternal(undefined)
      await nextTick()

      expect(warnLines(warn).length, 'warn:false 下静默').toBe(0)
      expect(counter.allocated - counter.baseline, 'warn:false 下永不分配去重 Set').toBe(0)
    } finally {
      counter.restore()
      warn.mockRestore()
    }
  })
})

describe('defaultValue 告警 watcher 的注册条件（#137 复审十轮 P1）', () => {
  /**
   * 口径是「注册了几个 `ReactiveEffect`」——这正是原型 `mapModel.prototype.test.ts` 用的
   * 同一套口径（`getCurrentScope().effects.length`，由 Vue 自己记账）。
   *
   * ⚠️ 只断言「有没有告警输出」证明不了注册与否：production 下 `devWarn` 早退，eager 版
   * **一条也不会打印**，但那个 effect 照样常驻。必须数 effect。
   */
  function effectsWith(options: { warn?: boolean; withDefault?: boolean } = {}): number {
    return effectScope().run(() => {
      const external = ref<number | undefined>(12)
      useControllableState<number>({
        name: 'zoom',
        value: () => external.value,
        defaultValue: options.withDefault === false ? undefined : () => 8,
        fallback: 14,
        equals: numbersEqual,
        warn: options.warn,
      })
      // `useControllableState` 只注册 defaultValue 告警 watcher，所以这个数就是它的个数。
      return getCurrentScope()!.effects.length
    })!
  }

  it('warn: false ⇒ 不注册 defaultValue 告警 watcher', () => {
    expect(effectsWith({ warn: false }), 'warn:false 不该注册任何 effect').toBe(0)
  })

  it('development + warn:true ⇒ 注册（告警契约仍在）', async () => {
    expect(effectsWith({ warn: true }), '开发期要注册').toBe(1)
  })

  it('development 下 default* 后续变化仍告警恰好一次', async () => {
    const warn = spyWarn()
    const fallbackDefault = ref<number | undefined>(8)
    try {
      const state = numberState({ defaultValue: () => fallbackDefault.value })
      fallbackDefault.value = 9
      await nextTick()
      fallbackDefault.value = 10
      await nextTick()
      expect(warnLines(warn).filter((l) => l.includes('只在首次解析时生效')).length).toBe(1)
      void state
    } finally {
      warn.mockRestore()
    }
  })
})

describe('production 下不为开发期提示付出 runtime（#137 复审十轮 P1）', () => {
  /**
   * `isDev()` 读 `process.env.NODE_ENV`，而判定**必须留在消费方**（见 logger 的注释）。
   * 所以这里改的是**运行时的环境变量**，不是构建期替换 —— 与「库在发布构建里不该把它定死」
   * 是同一件事的两面：这里模拟「消费方的 bundler 已折叠成 production」。
   */
  function withNodeEnv<T>(value: string | undefined, body: () => T): T {
    const original = process.env.NODE_ENV
    if (value === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = value
    try {
      return body()
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  }

  function effectsInProduction(options: { warn?: boolean } = {}): number {
    return withNodeEnv('production', () =>
      effectScope().run(() => {
        const external = ref<number | undefined>(12)
        useControllableState<number>({
          name: 'zoom',
          value: () => external.value,
          defaultValue: () => 8,
          fallback: 14,
          equals: numbersEqual,
          warn: options.warn,
        })
        return getCurrentScope()!.effects.length
      })!,
    )
  }

  it('production：即使 warn 默认 true 也不注册 defaultValue 告警 watcher', () => {
    expect(effectsInProduction(), 'production 下不该常驻开发期 watcher').toBe(0)
  })

  it('production：模式切换不分配 warned 去重 Set（short-circuit 在分配之前）', () => {
    const RealSet = globalThis.Set
    let allocated = 0
    function CountingSet(this: unknown, ...args: unknown[]) {
      allocated += 1
      return new RealSet(...(args as []))
    }
    CountingSet.prototype = RealSet.prototype
    Object.setPrototypeOf(CountingSet, RealSet)
    const spy = vi
      .spyOn(globalThis, 'Set')
      .mockImplementation(CountingSet as unknown as SetConstructor)
    const warn = spyWarn()
    try {
      const baseline = allocated
      withNodeEnv('production', () => {
        const external = ref<number | undefined>(12)
        const state = effectScope().run(() =>
          useControllableState<number>({
            name: 'zoom',
            value: () => external.value,
            defaultValue: () => 8,
            fallback: 14,
            equals: numbersEqual,
          }),
        )!
        // 受控 → 非受控：在 dev 下会告警一次并分配去重 Set；production 下应完全短路。
        external.value = undefined
        state.syncExternal(undefined)
        state.syncExternal(20)
        state.syncExternal(undefined)
      })
      expect(warnLines(warn).length, 'production 下不打印').toBe(0)
      expect(allocated - baseline, 'production 下连去重 Set 都不该分配').toBe(0)
    } finally {
      spy.mockRestore()
      warn.mockRestore()
    }
  })
})

describe('mode 是纯告警状态，告警关闭时连它都不存在（#137 复审十轮 P1）', () => {
  /**
   * 口径是 **`value()` getter 的调用次数**，理由与前两轮一致：行为断言和 effect 计数都
   * 分辨不出「惰性 / 急切」，必须直接数**分配 / 读取**。
   *
   * `mode` 的唯一消费者是「受控 ↔ 非受控」那条开发期告警——它不参与 `value` / `internal` /
   * 容差相等 / `reset()` / SDK reconcile。所以 production 或 `warn:false` 下：
   * - 构造期**不该**为它多读一次 `value()`（`model` 是 `computed`，懒求值，不读）；
   * - `syncExternal()` **不该**继续维护它（写一个只在告警里读的状态）。
   *
   * 改回 eager 初始化（`let mode = value() === undefined ? …`）会让下面的计数 +1。
   */
  function valueReadsIn(options: { warn?: boolean } = {}): number {
    const external = ref<number | undefined>(12)
    let reads = 0
    effectScope().run(() => {
      useControllableState<number>({
        name: 'zoom',
        value: () => {
          reads += 1
          return external.value
        },
        defaultValue: () => 8,
        fallback: 14,
        equals: numbersEqual,
        warn: options.warn,
      })
    })
    return reads
  }

  function withNodeEnv<T>(value: string | undefined, body: () => T): T {
    const original = process.env.NODE_ENV
    if (value === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = value
    try {
      return body()
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  }

  it('production：构造期只读一次 value()（仅为 initial 解析），不为 mode 再读一次', () => {
    expect(
      withNodeEnv('production', () => valueReadsIn()),
      'production 下 mode 不存在，构造期不应多读一次 value()',
    ).toBe(1)
  })

  it('warn: false：同样只读一次（显式声明「永不告警」时 mode 也没有消费者）', () => {
    expect(valueReadsIn({ warn: false }), 'warn:false 下 mode 不存在').toBe(1)
  })

  it('development + warn:true：mode 存在，构造期读两次（initial 解析 + 档位判定）', () => {
    expect(valueReadsIn(), '开发期要判定档位，mode 必须存在').toBe(2)
  })

  it('告警关闭时 syncExternal 不再维护 mode（无写入、无额外读取）', () => {
    const warn = spyWarn()
    try {
      const external = ref<number | undefined>(12)
      let reads = 0
      const state = withNodeEnv('production', () =>
        effectScope().run(() =>
          useControllableState<number>({
            name: 'zoom',
            value: () => {
              reads += 1
              return external.value
            },
            defaultValue: () => 8,
            fallback: 14,
            equals: numbersEqual,
          }),
        ),
      )!
      const before = reads
      external.value = undefined
      state.syncExternal(undefined)
      state.syncExternal(20)
      state.syncExternal(undefined)
      expect(reads, 'syncExternal 只吃 next，不再回头读 value() 判档位').toBe(before)
      // 守卫生效性：档位判定的唯一读点在 mode 初始化处，这里若 mode 被急切初始化，
      // 构造期计数就会是 2（见上面那条 development 用例）。
      expect(warnLines(warn).length, 'production 下不打印').toBe(0)
    } finally {
      warn.mockRestore()
    }
  })
})
