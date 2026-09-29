/**
 * useGeolocation 验证（issue #165 §3.6：与官方 `BMap.Geolocation` 逐成员对齐）
 *
 * 三组断言：
 * 1. **命名对齐**：方法叫官方那个名字（`getCurrentPosition`），v2 习惯别名（`get` / `location`）
 *    已经**删掉**（不是标记废弃——保留会让「有两个名字」成为长期事实）。
 * 2. **构造选项真的到达 SDK**：官方 `PositionOptions.SDKLocation` 的键名是 `SDKLocation`
 *    （不是 `enableSDKLocation`），因此本库自己的键名必须与它一致，否则选项被静默丢弃。
 * 3. **状态码**：`getStatus()` 的 `BMAP_STATUS_*` 失败码同时进 `status` / `error.code` /
 *    `sdkStatus`（Driver 侧 `readServiceStatus` 的口径）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted, nextTick, ref } from 'vue'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import { useGeolocation } from '../../packages/bmap-vue/src/composables/useGeolocation'
import type { GeolocationOptions } from '../../packages/bmap-vue/src/driver/types/services'
import { createFakeV4Harness, stripComments } from '../../packages/test-utils'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

let harness: ReturnType<typeof createFakeV4Harness>['harness']
let fake: ReturnType<typeof createFakeV4Harness>['fake']

/**
 * 捕获 hook 实例（行为测试要在 setup 之后继续驱动它）。
 *
 * **刻意用闭包变量而不是 `ref`**：hook 的返回对象里装的是 `Readonly<ShallowRef>`，而 `ref()`
 * 会把对象转成**深响应式**代理，读取时自动解包内层 ref（`hook.data` 变成值本身而不是 ref）——
 * 那样断言的就不再是调用方真正拿到的东西了。
 */
function capture<T>(): { hook: () => T; set: (value: T) => void } {
  let current: T | null = null
  return {
    hook: () => {
      if (current === null) throw new Error('hook 尚未创建')
      return current
    },
    set: (value: T) => {
      current = value
    },
  }
}

/** 在 `<Map>` 子树里挂一个用 `useGeolocation` 的组件。 */
function mountInMap<T>(
  useHook: () => T,
  run: (hook: T) => void | Promise<void>,
) {
  const Child = defineComponent({
    setup() {
      const hook = useHook()
      void Promise.resolve(run(hook))
      return () => h('div', 'geo')
    },
  })
  return mount(
    defineComponent({
      components: { Map, Child },
      setup: () => () => h(Map, { provider: harness.provider() }, () => [h(Child)]),
    }),
    { attachTo: harness.container() },
  )
}

describe('useGeolocation', () => {
  beforeEach(() => {
    const created = createFakeV4Harness()
    harness = created.harness
    fake = created.fake
  })

  it('locates after map ready and returns a point (as Map child)', async () => {
    const el = harness.container()
    const located = ref<{ lng: number; lat: number } | null>(null)
    const Child = defineComponent({
      setup() {
        const geo = useGeolocation()
        onMounted(async () => {
          await geo.getCurrentPosition()
          if (geo.data.value) {
            located.value = geo.data.value.point
          }
        })
        return () => h('div', 'geo')
      },
    })
    const wrapper = mount(
      defineComponent({
        components: { Map, Child },
        setup: () => () => h(Map, { provider: harness.provider() }, () => [h(Child)]),
      }),
      { attachTo: el },
    )
    await flushPromises()
    await nextTick()
    // 原来是 fake BMapGL 的 116.4；Fake v4 的 Geolocation 回包是 116.404（FakeV4Geolocation.result）
    expect(located.value?.lng).toBe(116.404)
    wrapper.unmount()
    await nextTick()
  })

  /* ------------------------------------------------------------------ 命名对齐 */

  it('方法名是官方的 getCurrentPosition；v2 习惯别名 get / location 已删除', async () => {
    const slot = capture<ReturnType<typeof useGeolocation>>()
    const wrapper = mountInMap(() => useGeolocation(), (hook) => slot.set(hook))
    await flushPromises()

    const hook = slot.hook()
    expect(typeof hook.getCurrentPosition).toBe('function')
    // 别名**删掉**而不是标记废弃：issue #165 §3.6 的口径
    expect('get' in hook).toBe(false)
    expect('location' in hook).toBe(false)
    // data 是唯一的结果读取口
    expect(hook.data.value).toBeNull()

    wrapper.unmount()
    await flushPromises()
  })

  it('单次调用可覆盖 PositionOptions（官方 getCurrentPosition(callback, opts?) 的第二个参数）', async () => {
    const slot = capture<ReturnType<typeof useGeolocation>>()
    const wrapper = mountInMap(
      () => useGeolocation({ enableHighAccuracy: false }),
      (hook) => slot.set(hook),
    )
    await flushPromises()

    const result = await slot.hook().getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 3000,
    })
    expect(result.status).toBe('success')
    // 逐次选项真的到了 SDK 的 getCurrentPosition 第二参数（不是被静默丢弃）
    expect(fake.createdGeolocations[0]?.callLog).toContain(
      'getCurrentPosition:{"enableHighAccuracy":true,"timeout":3000}',
    )

    wrapper.unmount()
    await flushPromises()
  })

  /* ------------------------------------------------------- PositionOptions 对齐 */

  it('构造选项用官方的键名 SDKLocation（写错键名 = 选项被 SDK 静默丢弃 = 假支持）', async () => {
    const slot = capture<ReturnType<typeof useGeolocation>>()
    const wrapper = mountInMap(
      () => useGeolocation({ SDKLocation: true, enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }),
      (hook) => slot.set(hook),
    )
    await flushPromises()
    await slot.hook().getCurrentPosition()

    const raw = fake.createdGeolocations[0]!
    const constructed = raw.callLog.find((entry) => entry.startsWith('construct:'))!
    // 官方 `PositionOptions` 的成员名逐个原样透传
    expect(constructed).toContain('"SDKLocation":true')
    expect(constructed).toContain('"enableHighAccuracy":true')
    expect(constructed).toContain('"timeout":5000')
    expect(constructed).toContain('"maximumAge":60000')
    // 反证：旧的本库键名不得再出现（它不是官方成员，留着只会静默丢弃）
    expect(stripComments(readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/bmap-vue/src/composables/useGeolocation.ts'),
      'utf8',
    ))).not.toContain('enableSDKLocation')

    wrapper.unmount()
    await flushPromises()
  })

  /* -------------------------------------------------------------- 状态码口径 */

  it('getStatus() 的失败码同时进 status / error.code / sdkStatus', async () => {
    const slot = capture<ReturnType<typeof useGeolocation>>()
    const wrapper = mountInMap(() => useGeolocation(), (hook) => slot.set(hook))
    await flushPromises()

    // 实例是**首次调用时**才建的（简单档按 Client 缓存）⇒ 先成功一次把它建出来
    await slot.hook().getCurrentPosition()
    // 官方 `BMAP_STATUS_PERMISSION_DENIED`：用户拒绝授权
    fake.createdGeolocations[0]!.status = 6
    const result = await slot.hook().getCurrentPosition()

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe(6)
    expect(result.sdkStatus).toBe(6)
    expect(slot.hook().status.value).toBe('failed')
    expect(slot.hook().sdkStatus.value).toBe(6)

    wrapper.unmount()
    await flushPromises()
  })
})

/* -------------------------------------------------------------------------- */
/* 与官方声明的逐成员对齐（反射断言）                                          */
/* -------------------------------------------------------------------------- */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function upstreamService(fileName: string): string {
  return readFileSync(
    join(PACKAGE_ROOT, 'packages/bmap-vue/node_modules/@baidumap/jsapi-v4-types/service', fileName),
    'utf8',
  )
}

describe('Geolocation 与官方 4.0.4 声明对齐', () => {
  /**
   * 从官方 `.d.ts` 里解析出**方法**成员名。
   *
   * 正证守卫：`Geolocation` 的解析结果必须非空——否则「全部成员都判成缺口」这种空转也会变绿。
   * 反射对象的是**发布产物里的声明文件**（deps 的一部分，随版本升级），不是文档站。
   */
  function officialMembers(fileName: string, className: string): string[] {
    const source = upstreamService(fileName)
    const body = source.slice(source.indexOf(`class ${className} {`))
    return [...body.matchAll(/^\s{4}(?:get\w+|[a-z]\w*)\(/gm)]
      .map((match) => match[0].trim().replace('(', ''))
      // `constructor` 是类的隐式入口，不是官方给出的**能力**成员
      .filter((name) => name !== 'constructor')
  }

  it('官方 Geolocation 的方法成员清单可被解析（正证：不是空转）', () => {
    const members = officialMembers('Geolocation.d.ts', 'Geolocation')
    expect(members.sort()).toEqual([
      'disableSDKLocation',
      'enableSDKLocation',
      'getCurrentPosition',
      'getStatus',
    ])
  })

  it('公开面逐个成员都有明确处置：要么同名可达，要么登记为有理由的缺口', () => {
    const members = officialMembers('Geolocation.d.ts', 'Geolocation')

    /**
     * 处置表。**每个缺口都必须写理由**——「不暴露」而无理由的条目不允许进这张表，
     * 否则它会退化成一张谁都能往上加的免责清单。
     */
    const disposition: Record<string, 'aligned' | { gap: string }> = {
      // 官方 `getCurrentPosition(callback, opts?)` ⇒ 我们的 `getCurrentPosition(opts?)`（名字与逐次选项都对齐）
      getCurrentPosition: 'aligned',
      // 官方 `getStatus(): ServiceStatus` ⇒ 我们的 `sdkStatus`（Driver 的 `readServiceStatus` 真读了它）
      getStatus: 'aligned',
      enableSDKLocation: {
        gap:
          '能力已由**构造选项** `SDKLocation` 覆盖（官方 `PositionOptions` 的成员，同一语义）。' +
          '方法形态需要 Driver 上一个「操作当前 Geolocation 实例」的成员——' +
          '简单档实例不对 composable 暴露句柄（`useSimpleServiceTask` 无 `invalidateService`），' +
          '因此在禁区里无法正确实现；补一个空方法就是 #165 §3.8 禁止的假支持。',
      },
      disableSDKLocation: {
        gap:
          '与 `enableSDKLocation` 同因：不设 `SDKLocation` 即为关闭，不需要额外的运行时开关。' +
          '方法形态需要一个 Driver 成员，而简单档没有实例句柄的出口。',
      },
    }

    // 双向：官方每个成员都有处置，且处置表没有「官方已删」的多余条目
    expect(new Set(Object.keys(disposition))).toEqual(new Set(members))
    for (const name of members) {
      const entry = disposition[name]!
      if (entry !== 'aligned') {
        // 缺口必须带理由，且理由里要点名具体机制而不是「不支持」
        expect(entry.gap.length, `${name} 的缺口理由`).toBeGreaterThan(20)
      }
    }
  })

  it('已对齐的成员在运行时真的可达（处置表不是一张纸面声明）', async () => {
    const slot = capture<ReturnType<typeof useGeolocation>>()
    const wrapper = mountInMap(() => useGeolocation(), (hook) => slot.set(hook))
    await flushPromises()
    await slot.hook().getCurrentPosition()
    expect(fake.createdGeolocations[0]?.callLog.some((e) => e.startsWith('getCurrentPosition:'))).toBe(true)
    // 官方 `getStatus()` 的返回值真的进了 `sdkStatus`（Driver 的 `readServiceStatus`）
    expect(slot.hook().sdkStatus.value).toBe(0)
    wrapper.unmount()
    await flushPromises()
  })

  it('PositionOptions 的四个成员在本库构造选项里逐个存在（不增不减）', () => {
    const source = upstreamService('PositionOptions.d.ts')
    const official = [...source.matchAll(/^\s{4}(\w+)\?:/gm)].map((m) => m[1]!).sort()
    // 官方 `PositionOptions` 的四个成员
    expect(official).toEqual(['SDKLocation', 'enableHighAccuracy', 'maximumAge', 'timeout'])

    // 本库构造选项的**类型**就是官方四个键名的并集——用类型层断言，而不是正则反射本库源码。
    // 反射 `driver/types/services.ts` 会把「interface 还是 type alias」「缩进几个空格」也钉死：
    // 那些是实现形状，与「这四个键在不在公开面上」这个事实无关，重构时会给出与事实无关的红
    // （仓库规则：不以源码/注释正则固定实现形状，见 architecture-ownership-audit.md）。
    type LibraryKeys = keyof GeolocationOptions
    const library: LibraryKeys[] = ['SDKLocation', 'enableHighAccuracy', 'maximumAge', 'timeout']
    // 官方键名逐个存在于本库选项上（`satisfies` 在 `pnpm typecheck:tests` 时才真正求值）
    const _covers: [LibraryKeys, ...LibraryKeys[]] = library as unknown as [
      LibraryKeys,
      ...LibraryKeys[],
    ]
    expect(library.sort()).toEqual(official)
    void _covers
  })

  it('timestamp 来自回包，不在投影时编造 Date.now()', async () => {
    // D3：官方 `GeolocationResult.timestamp` 是「设备定位时刻」。之前的实现在 composable
    // 投影里写 `Date.now()`，注释还声称「Driver 只投影 SDK 回包内容」——那对 status/source
    // 成立，对 timestamp 不成立。Fake 的默认回包没有 timestamp，所以这里断言的是
    // 「没有就老实是 null」，不是「恰好等于某个数」。
    const found = ref<{ timestamp: number | null } | null>(null)
    const Child = defineComponent({
      setup() {
        const geo = useGeolocation()
        onMounted(async () => {
          await geo.getCurrentPosition()
          if (geo.data.value) found.value = { timestamp: geo.data.value.timestamp }
        })
        return () => h('div', 'geo')
      },
    })
    const wrapper = mount(
      defineComponent({
        components: { Map, Child },
        setup: () => () => h(Map, { provider: harness.provider() }, () => [h(Child)]),
      }),
      { attachTo: harness.container() },
    )
    await flushPromises()
    expect(found.value?.timestamp).toBeNull()
    wrapper.unmount()
    await nextTick()
  })
})
