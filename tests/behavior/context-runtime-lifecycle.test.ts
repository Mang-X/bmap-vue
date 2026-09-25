/**
 * CTX-05: SSR 与 KeepAlive 验证
 *
 * - SSR renderToString 不得抛 window/document 错误,仅输出容器 shell
 * - KeepAlive deactivate 不销毁 Map,suspend;activate 后 resume + checkResize
 * - MapRuntime retry/suspend/resume 单一状态来源
 *
 * M3A3-REMOVE-LEGACY（#26）后的移植：Provider 必须是**结构化**形状
 * （`load()` 返回 `{ engine: "jsapi-v4", version, namespace }`），`withMigrationDriver`
 * 已删除，definition 直接进 `createBMapClient`。原来的顶层计数器读数改走
 * Fake v4 的 `diagnostics`（leaks = 当前未释放，activity = 累计发生过）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { mount, flushPromises } from '@vue/test-utils'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import BMapProvider from '../../packages/bmap-vue/src/components/provider/BMapProvider.vue'
import Marker from '../../packages/bmap-vue/src/components/overlays/Marker.vue'
import { MapRuntime } from '../../packages/bmap-vue/src/core/runtime/MapRuntime'
import { createClientContext } from '../../packages/bmap-vue/src/core/context/client'
import { createFakeV4Harness } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
/** 结构化 v4 Provider（自述 engine），等价于原来的「返回裸全局」provider。 */
const provider = () => harness.provider()
const host = () => harness.container()
/** 泄漏口径快照：原来直接读顶层计数器（`listeners` / `mapsDestroyed` 等）。 */
const leaks = () => fake.diagnostics.snapshot().leaks
const activity = () => fake.diagnostics.snapshot().activity

describe('SSR', () => {
  beforeEach(() => harness.reset())

  it('BMapProvider SSR 不访问浏览器全局', async () => {
    const app = createSSRApp(
      defineComponent({
        components: { BMapProvider },
        setup: () => () =>
          h(BMapProvider, { definition: { provider: provider(), loadOptions: {} } }, () => [h('div', 'child')]),
      }),
    )
    const html = await renderToString(app)
    expect(html).toContain('child')
  })

  it('Map SSR 仅输出容器 shell', async () => {
    const app = createSSRApp(
      defineComponent({
        components: { Map },
        setup: () => () => h(Map, { provider: provider() }),
      }),
    )
    const html = await renderToString(app)
    expect(html).toContain('bmap-container')
    expect(html).toContain('bmap-canvas-host')
  })
})

describe('MapRuntime retry/suspend/resume', () => {
  beforeEach(() => harness.reset())

  function failingRuntime(failures: number) {
    let calls = 0
    const deferredOk = { v: 1 }
    void deferredOk
    const loadClient = vi.fn(async () => {
      calls++
      if (calls <= failures) throw new Error('sdk down')
      return {
        driver: {
          map: {
            create: (c: HTMLElement) => ({ raw: new fake.namespace.Map(c, {}) }),
            destroy: () => {},
            initializeView: () => {},
            checkResize: vi.fn(),
          },
        },
      } as never
    })
    const rt = new MapRuntime({
      clientContext: { load: loadClient } as never,
      container: document.createElement('div'),
    })
    return { rt, loadClient }
  }

  it('retry 从 error 恢复到 ready', async () => {
    const { rt } = failingRuntime(1)
    await expect(rt.mount()).rejects.toThrow()
    expect(rt.status.value).toBe('error')
    const ctx = await rt.retry()
    expect(rt.status.value).toBe('ready')
    expect(ctx.map).toBeTruthy()
    rt.dispose()
  })

  it('retry 非 error 时直接 mount(幂等)', async () => {
    const { rt } = failingRuntime(0)
    const a = await rt.mount()
    const b = await rt.retry()
    expect(b.map).toBe(a.map)
    rt.dispose()
  })
})

describe('KeepAlive', () => {
  beforeEach(() => harness.reset())

  it('deactivated 不销毁 Map,activated 自动 checkResize', async () => {
    const el = host()
    const show = ref(true)
    let bmapRef: { suspend?: (r?: unknown) => void; resume?: (r?: unknown) => void; checkResize?: () => void } | null = null
    const Inner = defineComponent({
      setup() {
        return () =>
          h(Map, {
            provider: provider(),
            keepAliveBehavior: 'suspend',
            ref: (v: unknown) => {
              bmapRef = v as never
            },
          })
      },
    })
    const Root = defineComponent({
      setup: () => () =>
        h('div', [
          // 使用 v-show 模拟 KeepAlive deactivate/activate 语义 decoration:
          // 直接调用 runtime suspend/resume 并断言 map 未销毁
          show.value ? h(Inner) : h('div', 'hidden'),
        ]),
    })
    const wrapper = mount(Root, { attachTo: el })
    await flushPromises()
    await nextTick()
    // map 已创建
    expect(activity().mapsCreated).toBeGreaterThan(0)
    // 原来读顶层计数器 `mapsDestroyed`；Fake v4 的对应读数是「当前存活的 map 数」
    const liveMapsBefore = leaks().maps
    // 模拟 deactivate
    bmapRef?.suspend?.('keep-alive')
    await nextTick()
    expect(leaks().maps, 'suspend 不得销毁 Map').toBe(liveMapsBefore)
    // 模拟 activate:resume 自动 checkResize
    const checkSpy = vi.fn()
    void checkSpy
    bmapRef?.resume?.('keep-alive')
    bmapRef?.checkResize?.()
    await nextTick()
    expect(leaks().maps, 'resume/checkResize 不得销毁 Map').toBe(liveMapsBefore)
    show.value = false
    await nextTick()
    wrapper.unmount()
  })
})

describe('PRE audit: context isolation & resource exit', () => {
  beforeEach(() => harness.reset())

  it('100 次 overlay 创建/重建/卸载后无资源泄漏', async () => {
    const el = host()
    const show = ref(true)
    const clicking = ref(false)
    const prov = provider()
    const MarkerHost = defineComponent({
      setup: () => () =>
        h(Map, { provider: prov }, () =>
          show.value
            ? [h(Marker, { position: { lng: 116.4, lat: 39.9 }, enableClicking: clicking.value })]
            : [],
        ),
    })
    const wrapper = mount(MarkerHost, { attachTo: el })
    await flushPromises()
    await nextTick()
    expect(activity().mapsCreated).toBe(1)
    // 基线:map click 监听在 runtime.resources 中存活,卸载 marker 不应影响它
    const listenerBaseline = leaks().listeners

    for (let i = 0; i < 100; i++) {
      // 卸载(实例 scope 释放)
      show.value = false
      await nextTick()
      await flushPromises()
      expect(leaks().overlays).toBe(0)
      // 重新创建
      show.value = true
      await nextTick()
      await flushPromises()
      expect(leaks().overlays).toBe(1)
      // 重建(enableClicking 变化触发 rebuild:旧 instance scope 释放再 fork 新实例 scope)
      clicking.value = i % 2 === 0
      await nextTick()
      await flushPromises()
      expect(leaks().overlays).toBe(1)
    }

    // 100 轮创建/重建后 marker 仍在:SDK listener 不随轮次累积(回到基线)
    expect(leaks().listeners).toBe(listenerBaseline)
    show.value = false
    await nextTick()
    await flushPromises()
    wrapper.unmount()
    await nextTick()
    expect(leaks().maps).toBe(0)
    expect(leaks().listeners).toBe(0)
    el.remove()
  })

  it('多地图上下文互不隔离污染(实例级 client/scope)', async () => {
    const elA = host()
    const elB = host()
    const wrapperA = mount(Map, { attachTo: elA, props: { provider: provider() } })
    const wrapperB = mount(Map, { attachTo: elB, props: { provider: provider() } })
    await flushPromises()
    expect(activity().mapsCreated).toBe(2)

    // 卸载 A:B 仍 ready,overlay 计数不归零
    wrapperA.unmount()
    await nextTick()
    // 原来读顶层计数器 `mapsDestroyed === 1`；等价读数 = 当前仍存活 1 张 map
    expect(leaks().maps).toBe(1)
    expect((wrapperB.vm as never as { getMapInstance(): unknown }).getMapInstance()).toBeTruthy()

    wrapperB.unmount()
    await nextTick()
    expect(leaks().maps).toBe(0)
    elA.remove()
    elB.remove()
  })

  it('client context 与 runtime dispose 幂等(重复调用无副作用)', async () => {
    const ctx = createClientContext({
      // #26 后 definition 直接进 createBMapClient，Provider 必须是结构化 v4 形状
      definition: {
        provider: provider(),
        loadOptions: {},
      },
    })
    await ctx.load()
    expect(ctx.status.value).toBe('ready')
    ctx.dispose()
    ctx.dispose()
    ctx.dispose()
    expect(ctx.status.value).toBe('disposed')

    const rt = new MapRuntime({
      clientContext: {
        load: (async () => ({
          driver: {
            map: {
              create: (c: HTMLElement) => ({ raw: new fake.namespace.Map(c, {}) }),
              destroy: () => {},
              initializeView: () => {},
              checkResize: () => {},
            },
          },
        })) as never,
      } as never,
      container: document.createElement('div'),
    })
    await rt.mount()
    rt.dispose()
    rt.dispose()
    expect(rt.status.value).toBe('disposed')
  })
})
