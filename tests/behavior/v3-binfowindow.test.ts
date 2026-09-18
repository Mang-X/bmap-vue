/**
 * M5-INFOWINDOW（issue #32）：detached host、状态机、归属与残留
 *
 * 沿用 #72 的两条用例（地图级 open/close + SDK close 回写），并按 issue #32 的「测试与验收」
 * 逐条补齐。每个 `describe` 对应 issue 里的一条验收口径，读数尽量选**能直接改变结论**的那一个：
 *
 * | 验收口径 | 读数 |
 * | --- | --- |
 * | prop/SDK/map-click 的竞态无重复开关回环 | `update:open` 的**条数**（重复回写会多一条） |
 * | 多窗口互斥 / 多地图隔离 / 迟到 callback | 每张地图 `infoWindow` 的身份 + 各自 `update:open` |
 * | 内容可见且 Vue slot 更新正确 | 内容节点在 SDK 的容器里、且文本随 slot 变化 |
 * | 尺寸变化每帧最多一次 redraw | `FakeV4InfoWindow.redrawCalls`（配合手动帧队列） |
 * | 卸载后 host / Observer / listener 无残留 | `[data-bmap-infowindow-content]` 是否仍连接、`browserShims().diagnostics()`、`leaks.*` |
 * | 重复挂载与实例重建 | `rebuild` / `destroy` 事件的代次 + 实例账本条数 |
 *
 * 状态机自身的竞态在 `packages/baidu-map-gl-vue/src/core/overlays/infoWindowMachine.test.ts` 里
 * 用纯函数覆盖；这里只验证「组件把事件正确地喂给了它」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BInfoWindow from '../../packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue'
import {
  INFO_WINDOW_DESCRIPTOR_KEYS,
  INFO_WINDOW_FIELDS,
  resolveInfoWindowOpenIntent,
} from '../../packages/baidu-map-gl-vue/src/core/overlays/InfoWindowSpec'
import { overlayPropertySpec } from '../../packages/baidu-map-gl-vue/src/driver/types/overlays'
import { useRequiredMapContext } from '../../packages/baidu-map-gl-vue/src/core/context/inject'
import type { MapContext } from '../../packages/baidu-map-gl-vue/src/core/context/types'
import type { BInfoWindowProps } from '../../packages/baidu-map-gl-vue/src/types/components'
import {
  browserShims,
  createFakeV4Harness,
  createManualFrames,
  FakeV4InfoWindow,
  type FakeBMapV4,
  type FakeV4Harness,
  type FakeV4Map,
  type ManualFrames,
} from '../../packages/test-utils'

let harness: FakeV4Harness
let fake: FakeBMapV4
let frames: ManualFrames
let shims: ReturnType<typeof browserShims>

const POSITION = { lng: 116.404, lat: 39.915 }
const POSITION_B = { lng: 121.5, lat: 31.2 }

beforeEach(() => {
  ;({ harness, fake } = createFakeV4Harness())
  shims = browserShims()
  // FrameScheduler 在**创建时**读一次全局 rAF，因此手动帧必须在挂载之前装好
  frames = createManualFrames()
  frames.install()
  probeContext.value = null
})

afterEach(() => {
  frames.restore()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function settle() {
  await flushPromises()
  await nextTick()
}

async function unmountAndSettle(wrapper: { unmount(): void }) {
  wrapper.unmount()
  await settle()
}

/** 最后创建的那张地图（用例必须已经挂载 `<BMap>`）。 */
function lastMap(): FakeV4Map {
  const map = fake.createdMaps.at(-1)
  if (!map) throw new Error('用例必须先创建地图（<BMap>）')
  return map
}

/** 当前地图上打开的气泡实例。 */
function currentInfoWindow(): FakeV4InfoWindow | null {
  return lastMap().infoWindow
}

/** 内容节点（开放出来的 DOM 契约）：谁在文档里就是当前显示的那块 host。 */
function contentNodes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-bmap-infowindow-content]')]
}

/** 当前**连在文档里**的内容节点（卸载 / 关闭后应当为空）。 */
function attachedContent(): HTMLElement | null {
  return contentNodes().find((node) => node.isConnected) ?? null
}

/** 地图容器里 SDK 自己的气泡宿主（替身建模了「SDK 把内容节点搬进自己的容器」）。 */
function bubbleHost(): HTMLElement | null {
  return lastMap().bubbleHost
}

function createdInfoWindows(): FakeV4InfoWindow[] {
  return fake.createdOverlays.filter((item): item is FakeV4InfoWindow =>
    item instanceof FakeV4InfoWindow,
  )
}

const probeContext: { value: MapContext | null } = { value: null }

/** 探针：读一次 MapContext（气泡账本挂在它上面）。 */
const ContextProbe = defineComponent({
  setup() {
    probeContext.value = useRequiredMapContext()
    return () => null
  },
})

function mountTree(children: () => VNode[], host: HTMLElement) {
  return mount(
    defineComponent({
      components: { BMap },
      setup() {
        return () => h(BMap, { provider: harness.provider() }, () => [...children(), h(ContextProbe)])
      },
    }),
    { attachTo: host },
  )
}

function emittedOf(wrapper: { emitted: (name: string) => unknown }, name: string): unknown[][] {
  return (wrapper.emitted(name) as unknown[][] | undefined) ?? []
}

/* ------------------------------------------------------------------ 沿用 #72 */

describe('BInfoWindow 的地图级打开 / 关闭（R25-C / #72 回归）', () => {
  it('opens and closes via open prop, respecting state machine', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: open.value, title: 't' })],
      el,
    )
    await settle()
    // 气泡是**地图级** API：打开经 map.openInfoWindow(win, point)，不进 addOverlay 的账
    expect(currentInfoWindow()?.isOpen()).toBe(true)
    expect(fake.diagnostics.snapshot().activity.overlaysAttached).toBe(0)

    open.value = false
    await settle()
    expect(currentInfoWindow()).toBeNull()
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(0)
    await unmountAndSettle(wrapper)
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    harness.assertIdle('BInfoWindow 关闭后卸载')
  })

  it('SDK close event writes update:open false', async () => {
    const el = harness.container()
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: true, title: 't' })], el)
    await settle()
    const iw = currentInfoWindow()
    expect(iw, '对照组：气泡必须已经打开').toBeTruthy()
    iw!.emit('close', { type: 'close' })
    await nextTick()
    const child = wrapper.findComponent(BInfoWindow)
    expect(emittedOf(child, 'update:open')).toContainEqual([false])
    await unmountAndSettle(wrapper)
  })
})

/* ------------------------------------------------------- detached host + Teleport */

describe('内容宿主：SDK 持有节点、Vue Teleport 拥有渲染子树', () => {
  it('打开后内容节点被 SDK 搬进自己的容器，且 slot 内容渲染在里面', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [
        h(
          BInfoWindow,
          {
            position: POSITION,
            open: true,
            class: 'host-content-shell',
            'data-probe': 'yes',
          },
          { default: () => 'host-content' },
        ),
      ],
      el,
    )
    await settle()

    const host = attachedContent()
    expect(host, '打开后必须能在文档里定位到内容宿主').toBeTruthy()
    expect(host!.parentElement, '宿主由 SDK 搬进它自己的容器（不是 Vue 的原始位置）').toBe(
      bubbleHost(),
    )
    expect(host!.parentElement).not.toBe(el)
    expect(host!.textContent).toContain('host-content')
    // `$attrs` 落在 host 内部的包装节点上（class/style 仍可按旧方式使用）
    const shell = host!.querySelector('.b-info-window-content')
    expect(shell).toBeTruthy()
    expect(shell!.className).toContain('host-content-shell')
    expect(shell!.getAttribute('data-probe'), '自定义属性也一并落到包装节点').toBe('yes')
    expect(host!.getAttribute('data-probe'), 'host 本身只承载 SDK 的内容，不带组件 attrs').toBeNull()

    await unmountAndSettle(wrapper)
    expect(attachedContent(), '卸载后内容宿主不得留在文档里').toBeNull()
  })

  it('关闭前（未打开）宿主不在文档里：没有可显示的气泡', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: false }, { default: () => 'hidden' })],
      el,
    )
    await settle()
    expect(attachedContent()).toBeNull()
    expect(contentNodes().length, 'host 元素本身可以存在，但不得连在文档里').toBeGreaterThanOrEqual(0)
    await unmountAndSettle(wrapper)
  })

  it('slot 内容更新反映到宿主里（Vue 仍然是渲染子树的拥有者）', async () => {
    const el = harness.container()
    const text = ref('first')
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true }, { default: () => text.value })],
      el,
    )
    await settle()
    expect(attachedContent()!.textContent).toContain('first')

    text.value = 'second'
    await settle()
    const host = attachedContent()!
    expect(host.textContent).toContain('second')
    expect(host.textContent, '旧内容必须被替换掉，而不是叠加').not.toContain('first')
    await unmountAndSettle(wrapper)
  })
})

/* --------------------------------------------------------------- 竞态与回环 */

describe('prop / SDK / map-click 的竞态无重复开关回环', () => {
  it('受控闭环：SDK 关闭 → 一条 update:open false；父级写回后不再产生第二条', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    expect(emittedOf(child, 'update:open'), '对照组：打开过程不得回写').toHaveLength(0)

    // 用户点地图关闭（SDK 侧）→ 组件回写一次
    currentInfoWindow()!.emit('close', { type: 'close' })
    await settle()
    expect(emittedOf(child, 'update:open')).toEqual([[false]])

    // 受控父级消费这次回写（v-model 的正常闭环）
    open.value = false
    await settle()
    expect(emittedOf(child, 'update:open'), '父级写回不得再产生一条回写（无回环）').toEqual([[false]])
    expect(emittedOf(child, 'close')).toHaveLength(1)
    await unmountAndSettle(wrapper)
  })

  it('快速 open → false → true：关闭与重开各一次，且不产生多余的回写', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    const map = lastMap()
    const openCalls = () => map.callLog.filter((entry) => entry === 'openInfoWindow').length

    expect(openCalls()).toBe(1)
    open.value = false
    await settle()
    open.value = true
    await settle()

    expect(openCalls(), '重开恰好一次：重复的同值意图不得再下发命令').toBe(2)
    expect(emittedOf(child, 'open')).toHaveLength(2)
    expect(emittedOf(child, 'close')).toHaveLength(1)
    await unmountAndSettle(wrapper)
    harness.assertIdle('快速 open/close')
  })

  it('同一 tick 的 open → close 被 SDK 吞掉：观测到 open 后必须再关一次（真机时序的端到端复现）', async () => {
    const el = harness.container()
    const open = ref(false)
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const map = lastMap()
    const iw = createdInfoWindows().at(-1)!
    // 让**这一次**打开异步生效：真机上 openInfoWindow() 之后同一 tick 里
    // `map.getInfoWindow()` 仍是 null，因此同一 tick 的 closeInfoWindow() 是 no-op
    map.deferInfoWindowOpen = true
    const closeCalls = () => map.callLog.filter((entry) => entry === 'closeInfoWindow').length

    open.value = true
    await settle()
    expect(map.hasPendingInfoWindow(), '对照：打开请求已经发出、SDK 还没接管').toBe(true)
    expect(currentInfoWindow(), '对照：地图上还没有气泡').toBeNull()

    // 立刻关闭：这条命令会被 SDK 吞掉（真机上就是 no-op）
    open.value = false
    await settle()
    expect(closeCalls(), '确实下发了关闭命令').toBe(1)
    expect(currentInfoWindow()).toBeNull()

    // SDK 迟一步真的接管了 ⇒ 组件必须再下发一次关闭，否则「点了关闭，气泡却留在地图上」
    expect(map.flushInfoWindowOpen(), '对照：确实有一次被放行的接管').toBe(true)
    await settle()
    expect(closeCalls(), '接管之后必须再关一次').toBe(2)
    expect(currentInfoWindow(), '最终地图上没有气泡').toBeNull()
    expect(iw.isOpen()).toBe(false)
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(0)

    await unmountAndSettle(wrapper)
    harness.assertIdle('同 tick 开关')
  })

  it('点地图关闭（enableCloseOnClick）：SDK 自己关 ⇒ 模型收敛并回写 update:open false', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, enableCloseOnClick: true })],
      el,
    )
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    const map = lastMap()
    expect(map.infoWindow?.isOpen(), '对照组：气泡已经打开').toBe(true)

    // 「点地图关闭」在 SDK 侧就是它自己把当前气泡关掉（组件不参与），事件是 `close`
    map.closeInfoWindow()
    await settle()

    expect(map.infoWindow, '地图上没有当前气泡').toBeNull()
    expect(emittedOf(child, 'update:open'), '这是一次未经请求的关闭 ⇒ 回写').toEqual([[false]])
    expect(emittedOf(child, 'close')).toHaveLength(1)
    expect(map.callLog.filter((entry) => entry === 'openInfoWindow').length, '不得因为回写而重开').toBe(1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('点地图关闭')
  })

  it('SDK 自己打开（未经请求）⇒ 回写 update:open true', async () => {
    const el = harness.container()
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: false })], el)
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    // 模拟「别处调了 map.openInfoWindow 打开的就是这个实例」
    lastMap().openInfoWindow(createdInfoWindows()[0]!, POSITION)
    await settle()
    expect(emittedOf(child, 'update:open')).toEqual([[true]])
    await unmountAndSettle(wrapper)
  })

  it('clickclose（点关闭按钮）与 close 走同一套归属，且额外转发 clickclose 事件', async () => {
    const el = harness.container()
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, open: true })], el)
    await settle()
    const child = wrapper.findComponent(BInfoWindow)

    // 点关闭按钮：SDK 派发 `clickclose`（真实 4.0 会同时把气泡关掉，替身只派发事件）
    currentInfoWindow()!.emit('clickclose', { type: 'clickclose' })
    await settle()
    expect(emittedOf(child, 'clickclose'), '额外把「是谁关的」告诉调用方').toHaveLength(1)
    expect(emittedOf(child, 'update:open')).toEqual([[false]])
    expect(emittedOf(child, 'close')).toHaveLength(1)

    await unmountAndSettle(wrapper)
    expect(fake.diagnostics.snapshot().leaks.infoWindows, '卸载必须把 SDK 侧的气泡一并收掉').toBe(0)
    harness.assertIdle('clickclose 后卸载')
  })

  it('maximize / restore 只转发，不改变「打开」这一维', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, enableMaximize: true })],
      el,
    )
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    const iw = currentInfoWindow()!

    iw.emit('maximize', { type: 'maximize' })
    await settle()
    iw.emit('restore', { type: 'restore' })
    await settle()

    expect(emittedOf(child, 'maximize')).toHaveLength(1)
    expect(emittedOf(child, 'restore')).toHaveLength(1)
    expect(emittedOf(child, 'update:open'), '界面状态不是「打开」这一维').toHaveLength(0)
    expect(emittedOf(child, 'close')).toHaveLength(0)
    expect(currentInfoWindow()!.isOpen(), '气泡仍然打开着').toBe(true)

    await unmountAndSettle(wrapper)
    harness.assertIdle('maximize / restore')
  })

  it('没有 position 时 open=true ⇒ 报一次 BMAP_INVALID_ARGUMENT，且不上报打开', async () => {
    const el = harness.container()
    const errors: Array<{ code?: string }> = []
    const Probe = defineComponent({
      setup() {
        const ctx = useRequiredMapContext()
        ctx.events.on('resource:error', (payload) => {
          errors.push((payload as { error?: { code?: string } })?.error ?? {})
        })
        return () => null
      },
    })
    const wrapper = mount(
      defineComponent({
        components: { BMap },
        setup() {
          return () =>
            h(BMap, { provider: harness.provider() }, () => [
              h(BInfoWindow, { open: true }),
              h(Probe),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    expect(errors.map((e) => e.code)).toEqual(['BMAP_INVALID_ARGUMENT'])
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(0)
    await unmountAndSettle(wrapper)
    harness.assertIdle('缺 position')
  })
})

/* ----------------------------------------------------------- 互斥与多地图隔离 */

describe('多窗口互斥 / 多地图隔离 / 迟到 callback', () => {
  it('同一地图两个气泡：后打开的顶掉前者并通知它（前者回写关闭，但不关掉后者）', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [
        h(BInfoWindow, { position: POSITION, open: true, title: 'A' }),
        h(BInfoWindow, { position: POSITION_B, open: true, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a, b] = wrapper.findAllComponents(BInfoWindow)

    expect(emittedOf(a!, 'update:open'), 'A 收到了「被顶掉」的通知').toEqual([[false]])
    expect(emittedOf(b!, 'update:open'), 'B 是当前气泡，不该被回写').toHaveLength(0)
    const opened = currentInfoWindow()
    expect(opened, 'A 的收盘不得把 B 的气泡关掉').toBeTruthy()
    expect((opened!.options.title as string) ?? '', 'B 才是当前气泡').toBe('B')
    expect(fake.diagnostics.snapshot().leaks.infoWindows, '同一时刻只有一个是「打开」').toBe(1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('两窗口互斥')
  })

  it('被顶掉的 A 卸载时不得关掉 B 的气泡', async () => {
    const el = harness.container()
    const showA = ref(true)
    const wrapper = mountTree(
      () => [
        showA.value ? h(BInfoWindow, { position: POSITION, open: true, title: 'A' }) : null,
        h(BInfoWindow, { position: POSITION_B, open: true, title: 'B' }),
      ],
      el,
    )
    await settle()
    expect(currentInfoWindow()!.options.title).toBe('B')

    showA.value = false
    await settle()
    expect(currentInfoWindow(), 'A 的卸载不得动 B 的气泡').toBeTruthy()
    expect(currentInfoWindow()!.options.title).toBe('B')
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('被顶掉的一方卸载')
  })

  it('地图上存在「别人的」气泡时（例如官方 UI Kit 的详情气泡），卸载不得关掉它', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, title: 'ours' })],
      el,
    )
    await settle()
    const ours = currentInfoWindow()
    expect(ours?.options.title, '对照组：我们的气泡是当前气泡').toBe('ours')

    // 模拟官方 UI Kit 自己在这个地图上打开的气泡：绕过本组件，直接在 raw 层打开
    const foreign = new FakeV4InfoWindow(document.createElement('div'), {}, fake.diagnostics)
    lastMap().openInfoWindow(foreign, POSITION)
    expect(currentInfoWindow(), '对照组：当前气泡已经换成别人的').toBe(foreign)

    await unmountAndSettle(wrapper)

    expect(
      currentInfoWindow(),
      '本层不接管别人的气泡（UI Kit 的 widget 内部资源不归我们管）',
    ).toBe(foreign)
    expect(foreign.isOpen()).toBe(true)
    expect(fake.diagnostics.snapshot().leaks.infoWindows, '只销我们自己的那一个').toBe(1)
    // 清掉外来气泡，让泄漏门禁回到基线
    lastMap().closeInfoWindow()
    harness.assertIdle('别人的气泡不受影响')
  })

  it('两张地图各自独立：A 图的气泡与账本不受 B 图影响', async () => {
    const hostA = harness.container()
    const hostB = harness.container()
    const wrapperA = mountTree(() => [h(BInfoWindow, { position: POSITION, open: true, title: 'A' })], hostA)
    const wrapperB = mountTree(() => [h(BInfoWindow, { position: POSITION_B, open: true, title: 'B' })], hostB)
    await settle()

    const maps = fake.createdMaps
    expect(maps).toHaveLength(2)
    expect(maps.map((map) => map.infoWindow?.isOpen() ?? false)).toEqual([true, true])
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(2)

    await unmountAndSettle(wrapperA)
    expect(maps[0]!.infoWindow, 'A 的气泡随 A 的卸载关闭').toBeNull()
    expect(maps[1]!.infoWindow?.isOpen(), 'B 的气泡不受影响').toBe(true)

    await unmountAndSettle(wrapperB)
    harness.assertIdle('两图隔离')
  })

  it('迟到 callback：旧实例的 close 不影响重建后的新实例', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    const first = createdInfoWindows()[0]!
    const child = wrapper.findComponent(BInfoWindow)
    expect(first.content, '对照组：夹具把内容节点如实存下来了').toBeInstanceOf(HTMLElement)

    // 构造期属性变化 ⇒ 重建（offset 在描述符里是 recreate）
    offset.value = { x: 0, y: -10 }
    await settle()
    expect(createdInfoWindows(), '重建了一次').toHaveLength(2)
    expect(currentInfoWindow()).not.toBe(first)
    const changes = emittedOf(child, 'update:open').length

    // 旧实例的 close 迟到到达（真实 SDK 的销毁链路上会派发）
    first.emit('close', { type: 'close' })
    await settle()
    expect(emittedOf(child, 'update:open').length, '旧实例的回调必须被丢弃').toBe(changes)
    expect(currentInfoWindow()!.isOpen(), '新实例仍然是打开状态').toBe(true)

    await unmountAndSettle(wrapper)
    harness.assertIdle('迟到 callback')
  })
})

/* ------------------------------------------------------------- 尺寸与合帧重绘 */

describe('尺寸变化：每帧最多一次 redraw，且不自激', () => {
  /** 打开一个气泡并返回宿主 + 组件 wrapper。 */
  async function openWindow(host: HTMLElement) {
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true }, { default: () => 'x' })],
      host,
    )
    await settle()
    const content = attachedContent()
    expect(content, '对照组：气泡必须已经打开且内容节点在文档里').toBeTruthy()
    shims.setElementSize(content!, { width: 200, height: 80 })
    return { wrapper, content: content! }
  }

  it('一帧内多次尺寸通知只做一次重绘', async () => {
    const el = harness.container()
    const { wrapper, content } = await openWindow(el)
    const iw = currentInfoWindow()!
    const before = iw.redrawCalls

    shims.resize(content, { width: 201, height: 80 })
    shims.resize(content, { width: 202, height: 80 })
    shims.resize(content, { width: 203, height: 90 })
    expect(frames.pending(), '三次通知合帧成一个待执行任务').toBe(1)
    frames.flush()
    expect(iw.redrawCalls - before).toBe(1)

    await unmountAndSettle(wrapper)
  })

  it('尺寸没变不重绘；由重绘自身引起的通知被吞掉（不自激）', async () => {
    const el = harness.container()
    const { wrapper, content } = await openWindow(el)
    const iw = currentInfoWindow()!

    shims.resize(content, { width: 300, height: 120 })
    frames.flush()
    const after = iw.redrawCalls
    expect(after).toBeGreaterThan(0)

    // 同一个尺寸再通知一次：不再重绘，也不再排帧
    shims.notifyResize(content)
    expect(frames.pending()).toBe(0)
    frames.flush()
    expect(iw.redrawCalls, '同尺寸不得再次重绘').toBe(after)

    await unmountAndSettle(wrapper)
  })

  it('未打开（open=false）时尺寸变化不重绘', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: open.value }, { default: () => 'x' })],
      el,
    )
    await settle()
    const iw = createdInfoWindows()[0]!
    const content = attachedContent()!
    open.value = false
    await settle()
    const before = iw.redrawCalls

    shims.resize(content, { width: 320, height: 200 })
    expect(frames.pending(), '关着的气泡不该排帧').toBe(0)
    frames.flush()
    expect(iw.redrawCalls, '关着的气泡不需要重绘').toBe(before)

    // 重新打开后，同一尺寸仍然能触发一次重绘（守卫不是「永久静音」）
    open.value = true
    await settle()
    shims.resize(content, { width: 321, height: 200 })
    expect(frames.pending()).toBe(1)
    frames.flush()
    expect(iw.redrawCalls).toBeGreaterThan(before)

    await unmountAndSettle(wrapper)
  })

  it('排队中的 redraw 在卸载 / 重建时被丢弃（旧实例不再重绘）', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    const first = createdInfoWindows()[0]!
    const content = attachedContent()!

    // 排一帧重绘但先不放行
    shims.resize(content, { width: 260, height: 90 })
    expect(frames.pending(), '对照：确实排了一帧').toBe(1)

    // 重建（构造期属性变化）⇒ 旧实例排的那一帧必须被丢弃
    offset.value = { x: 0, y: -6 }
    await settle()
    const before = first.redrawCalls
    frames.flush()
    expect(first.redrawCalls, '旧实例的重绘不得执行').toBe(before)

    // 卸载时同理：排一帧再卸载
    shims.resize(attachedContent()!, { width: 300, height: 120 })
    const pendingBefore = frames.pending()
    await unmountAndSettle(wrapper)
    frames.flush()
    expect(pendingBefore, '对照：卸载前确实有排队的帧').toBeGreaterThan(0)
    expect(first.redrawCalls).toBe(before)
    harness.assertIdle('丢弃排队重绘')
  })

  it('title / width 更新后补一次重绘（选项变化不会改到我们观察的宿主尺寸）', async () => {
    const el = harness.container()
    const width = ref(200)
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, width: width.value })],
      el,
    )
    await settle()
    const iw = currentInfoWindow()!
    const before = iw.redrawCalls

    width.value = 320
    await settle()
    expect(iw.width).toBe(320)
    expect(iw.redrawCalls - before).toBe(1)

    await unmountAndSettle(wrapper)
  })
})

/* ------------------------------------------------------------- 重建与残留 */

describe('重复挂载与实例重建：账目与释放', () => {
  it('重建发出 destroy(旧代次) / rebuild(新代次)，且对外原子（不产生 close/open）', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    const child = wrapper.findComponent(BInfoWindow)
    expect(emittedOf(child, 'rebuild'), '首次创建不是「重建」，不发 rebuild').toEqual([])
    const openBefore = emittedOf(child, 'open').length
    const openCalls = () => lastMap().callLog.filter((entry) => entry === 'openInfoWindow').length
    expect(openCalls()).toBe(1)
    // 观察者账：气泡自己一份（地图的容器门禁另有自己的那份，因此只看**不增长**）
    const observersBefore = shims.diagnostics().resizeObservers
    const disconnectsBefore = shims.diagnostics().resizeDisconnects

    offset.value = { x: 4, y: 4 }
    await settle()
    expect(emittedOf(child, 'destroy'), '载荷是被释放的那一代').toEqual([[1]])
    expect(emittedOf(child, 'rebuild'), '载荷是新的一代').toEqual([[2]])
    expect(emittedOf(child, 'close'), '重建不得对外表现为「关了一次」').toHaveLength(0)
    expect(
      emittedOf(child, 'open').length,
      '重建不得对外表现为「又开了一次」：期望状态没变，对外只有 destroy/rebuild',
    ).toBe(openBefore)
    expect(openCalls(), '新实例必须真的被重新打开').toBe(2)

    // 实例账：新实例是当前打开的那个，旧实例的宿主已摘掉
    const [first, second] = createdInfoWindows()
    expect(currentInfoWindow()).toBe(second)
    expect((first!.content as HTMLElement).isConnected, '旧实例的宿主必须被摘掉').toBe(false)
    expect(attachedContent()).toBe(second!.content)
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1)
    // host 重建时旧目标被解绑：观察者不新增，且旧目标真的被 disconnect 过
    expect(shims.diagnostics().resizeObservers, '重建不得堆积观察者').toBe(observersBefore)
    expect(
      shims.diagnostics().resizeDisconnects,
      'host 换目标时恰好解绑一次旧目标（这正是「观察的是当前那块 host」的证据）',
    ).toBe(disconnectsBefore + 1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('重建之后卸载')
  })

  it('卸载后 host / Observer / listener / 账本全部归零', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, open: true }, { default: () => 'bye' })],
      el,
    )
    await settle()
    const host = attachedContent()!
    expect(probeContext.value?.infoWindows?.size, '对照组：账本里有 1 个气泡').toBe(1)
    const disconnectsBefore = shims.diagnostics().resizeDisconnects

    await unmountAndSettle(wrapper)

    expect(host.isConnected, 'host 必须从文档里摘掉').toBe(false)
    // SDK 关闭时会拆掉**自己的**容器（那一步也会让 host 脱离文档），因此必须再看一级：
    // 只有我们自己的释放路径会让 host 连 parentElement 都没有
    expect(host.parentElement, 'host 必须由本库摘掉，而不是留在 SDK 的容器里').toBeNull()
    expect(contentNodes().length, 'host 必须从文档里彻底摘掉（不是留在原地隐藏）').toBe(0)
    // `=== 0` 是这一步的强读数（整棵树卸载后一个观察者都不剩）；断开次数只作为轨迹记录
    // —— 同一棵树上的地图容器门禁也有一份观察者，它也会在这次卸载里断开，因此不能写成 +1
    expect(shims.diagnostics().resizeObservers, 'Observer 必须断开').toBe(0)
    expect(shims.diagnostics().resizeDisconnects).toBeGreaterThan(disconnectsBefore)
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)
    expect(probeContext.value?.infoWindows?.size).toBe(0)
    harness.assertIdle('卸载')
  })

  it('反复挂载 / 卸载 20 轮：代次与账目都对得上', async () => {
    const el = harness.container()
    for (let round = 0; round < 20; round += 1) {
      const wrapper = mountTree(
        () => [h(BInfoWindow, { position: POSITION, open: true, title: `round-${round}` })],
        el,
      )
      await settle()
      expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1)
      await unmountAndSettle(wrapper)
    }
    expect(probeContext.value?.infoWindows?.size).toBe(0)
    const { activity } = fake.diagnostics.snapshot()
    expect(activity.infoWindowsOpened, '20 轮各开一次，不多不少').toBe(20)
    expect(activity.infoWindowsReleased).toBe(activity.infoWindowsOpened)
    harness.assertIdle('20 轮气泡挂载/卸载')
  })
})

/* ------------------------------------------------------------------- 兼容与 SSR */

describe('唯一主模型与兼容别名', () => {
  it('`open` 是主状态；`show` 是兼容别名，两者都驱动同一个状态机', async () => {
    const el = harness.container()
    const show = ref(true)
    const wrapper = mountTree(
      () => [h(BInfoWindow, { position: POSITION, show: show.value })],
      el,
    )
    await settle()
    expect(currentInfoWindow()?.isOpen()).toBe(true)
    show.value = false
    await settle()
    expect(currentInfoWindow()).toBeNull()
    await unmountAndSettle(wrapper)
  })

  it('`show` 只在显式给出时覆盖 `open`（`undefined` = 不表态）', () => {
    expect(resolveInfoWindowOpenIntent({ open: true })).toBe(true)
    expect(resolveInfoWindowOpenIntent({ open: false })).toBe(false)
    expect(resolveInfoWindowOpenIntent({})).toBe(false)
    expect(resolveInfoWindowOpenIntent({ open: false, show: true })).toBe(true)
    expect(resolveInfoWindowOpenIntent({ open: true, show: false })).toBe(false)
  })

  it('使用 `show` 时打印一次集中告警（每个组件一次）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = harness.container()
    const wrapper = mountTree(() => [h(BInfoWindow, { position: POSITION, show: false })], el)
    await settle()
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes('`show` 是 `open` 的兼容别名'))).toHaveLength(1)
    await unmountAndSettle(wrapper)
  })

  it('SSR 阶段不创建 host、不渲染内容、不抛错', () => {
    const html = renderToString(
      h(BMap, { provider: harness.provider() }, () => [
        h(BInfoWindow, { position: POSITION, open: true }, { default: () => 'ssr' }),
      ]),
    )
    expect(html).not.toContain('data-bmap-infowindow-content')
    expect(contentNodes()).toHaveLength(0)
    expect(fake.createdMaps).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 声明面核对 */

describe('属性面与 Driver 描述符一致', () => {
  it('fields 恰好覆盖 BInfoWindowProps 的全部键', () => {
    // 类型层：漏一个 prop 时 `InfoWindowFieldMap` 就赋不上值（编译期），这里再逐项点名一次
    expect(Object.keys(INFO_WINDOW_FIELDS).sort()).toEqual(
      [
        'position',
        'title',
        'width',
        'height',
        'offset',
        'open',
        'show',
        'enableMaximize',
        'enableAutoPan',
        'enableCloseOnClick',
      ].sort(),
    )
    // 反向（不能有 props 上不存在的键）由上面那条「与手写清单逐项相等」隐含；
    // 这里只留一次类型层收窄，把声明面的键与 `keyof BInfoWindowProps` 绑在一起
    const declared = Object.keys(INFO_WINDOW_FIELDS) as Array<keyof BInfoWindowProps>
    expect(declared).toEqual(expect.arrayContaining(['position', 'open'] as Array<keyof BInfoWindowProps>))
  })

  it('`options` / `recreate` 字段在描述符里真的是对应分类；`state` 字段不进描述符', () => {
    for (const [prop, update] of Object.entries(INFO_WINDOW_FIELDS) as Array<
      [string, 'state' | 'options' | 'recreate']
    >) {
      const declared = INFO_WINDOW_DESCRIPTOR_KEYS[prop as keyof BInfoWindowProps]
      const descriptorKey = declared === undefined ? prop : declared
      if (update === 'state') {
        expect(descriptorKey, `${prop} 由状态机驱动，不得写进描述符`).toBeNull()
        continue
      }
      expect(descriptorKey, `${prop} 必须写明描述符键`).not.toBeNull()
      const spec = overlayPropertySpec('info-window', descriptorKey as string)
      expect(spec, `${prop} → 描述符里必须存在 ${descriptorKey}`).toBeTruthy()
      const expected = update === 'options' ? 'mutable' : 'recreate'
      expect(spec!.policy, `${prop} 声明为 ${update}，描述符必须是 ${expected}`).toBe(expected)
    }
    // 反向：不是每种策略都被允许落进描述符 —— `state` 类的三项必须真的没有可写入口
    expect(overlayPropertySpec('info-window', 'position')!.policy).toBe('unsupported')
  })
})
