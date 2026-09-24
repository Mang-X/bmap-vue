/**
 * M5-INFOWINDOW（issue #32）组件级用例：宿主 / 收敛 / 互斥 / 尺寸重绘 / 重建释放 / 兼容别名。
 *
 * 每个 `describe` 对应 issue 的一条验收口径，读数选能直接改变结论的那一个（地图上的当前气泡身份、
 * 公开事件的条数、`redrawCalls`、`leaks.*`）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, watch, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Map from '../../packages/bmap-vue/src/components/map/Map.vue'
import InfoWindow from '../../packages/bmap-vue/src/components/overlays/InfoWindow.vue'
import {
  INFO_WINDOW_DESCRIPTOR_KEYS,
  INFO_WINDOW_FIELDS,
  resolveInfoWindowOpenIntent,
} from '../../packages/bmap-vue/src/core/overlays/InfoWindowSpec'
import { overlayPropertySpec } from '../../packages/bmap-vue/src/driver/types/overlays'
import { useRequiredMapContext } from '../../packages/bmap-vue/src/core/context/inject'
import type { MapContext } from '../../packages/bmap-vue/src/core/context/types'
import type { InfoWindowProps } from '../../packages/bmap-vue/src/types/components'
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

/** 最后创建的那张地图（用例必须已经挂载 `<Map>`）。 */
function lastMap(): FakeV4Map {
  const map = fake.createdMaps.at(-1)
  if (!map) throw new Error('用例必须先创建地图（<Map>）')
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
      components: { Map },
      setup() {
        return () => h(Map, { provider: harness.provider() }, () => [...children(), h(ContextProbe)])
      },
    }),
    { attachTo: host },
  )
}

function emittedOf(wrapper: { emitted: (name: string) => unknown }, name: string): unknown[][] {
  return (wrapper.emitted(name) as unknown[][] | undefined) ?? []
}

/* ------------------------------------------------------------------ 沿用 #72 */

describe('InfoWindow 的地图级打开 / 关闭（R25-C / #72 回归）', () => {
  it('opens and closes via open prop（desired 驱动，收敛到地图上）', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, open: open.value, title: 't' })],
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
    harness.assertIdle('InfoWindow 关闭后卸载')
  })
})

/* ------------------------------------------------------- detached host + Teleport */

describe('内容宿主：SDK 持有节点、Vue Teleport 拥有渲染子树', () => {
  it('打开后内容节点被 SDK 搬进自己的容器，且 slot 内容渲染在里面', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [
        h(
          InfoWindow,
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
      () => [h(InfoWindow, { position: POSITION, open: false }, { default: () => 'hidden' })],
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
      () => [h(InfoWindow, { position: POSITION, open: true }, { default: () => text.value })],
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

describe('所有权与收敛：desired（open）→ 地图上的实际状态', () => {
  it('open=true ⇒ 打开；open=false ⇒ 关闭（prop 是唯一控制意图）', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    expect(currentInfoWindow(), 'desired=true ⇒ 地图上真的有气泡').toBeTruthy()
    const opens = lastMap().callLog.filter((c) => c === 'openInfoWindow').length

    open.value = false
    await settle()
    expect(currentInfoWindow(), 'desired=false ⇒ 收敛为关').toBeNull()
    expect(
      lastMap().callLog.filter((c) => c === 'closeInfoWindow').length,
      '关闭走地图级专用入口',
    ).toBe(1)
    expect(
      lastMap().callLog.filter((c) => c === 'openInfoWindow').length,
      '没有多余的重开',
    ).toBe(opens)

    await unmountAndSettle(wrapper)
    harness.assertIdle('open/close by prop')
  })

  it('同一 tick 的 open → false 被 SDK 吞掉：观测到它真开了之后仍要关掉（真机时序）', async () => {
    const el = harness.container()
    const open = ref(false)
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const map = lastMap()

    // 真机：`openInfoWindow()` 之后同一 tick 里 `getInfoWindow()` 仍是 null（异步生效）
    map.deferInfoWindowOpen = true
    open.value = true
    await settle()
    expect(map.hasPendingInfoWindow(), '对照组：打开请求已被挂起').toBe(true)
    expect(currentInfoWindow(), '对照组：还没真正打开').toBeNull()

    // 立刻改回 false：此刻「期望关 + 实际没开」⇒ 不该发命令（发下去也会被吞掉）
    const closesBefore = map.callLog.filter((c) => c === 'closeInfoWindow').length
    open.value = false
    await settle()
    expect(
      map.callLog.filter((c) => c === 'closeInfoWindow').length,
      '此刻没有可关的东西，不发多余的关闭命令',
    ).toBe(closesBefore)

    // ★ SDK 迟一步真的把它打开了 ⇒ 观测到「实际开着」后必须收敛回关
    expect(map.flushInfoWindowOpen(), '对照组：确实有一次被放行的接管').toBe(true)
    await settle()
    expect(currentInfoWindow(), '父级要的是「关」⇒ 迟到的接管也要被收敛掉').toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('同 tick 吞命令')
  })

  it('快速 open → false → true：每个意图各产生一次命令', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const child = wrapper.findComponent(InfoWindow)
    const map = lastMap()
    const before = map.callLog.filter((c) => c === 'openInfoWindow').length

    open.value = false
    await settle()
    open.value = true
    await settle()

    expect(currentInfoWindow(), '最终是开着的').toBeTruthy()
    expect(
      map.callLog.filter((c) => c === 'openInfoWindow').length,
      '重开一次（不多不少）',
    ).toBe(before + 1)
    expect(map.callLog.filter((c) => c === 'closeInfoWindow').length).toBe(1)
    expect(
      emittedOf(child, 'update:open'),
      'prop 驱动的变化不回写（受控语义）',
    ).toHaveLength(0)

    await unmountAndSettle(wrapper)
    harness.assertIdle('快速开关')
  })

  it('#138：一次事件驱动的收敛不多发命令', async () => {
    // 这里锁的是「不多发」：一个被 `echoedClosed` 挡住、或本可由 observed 读数挡住的空转，
    // 都会表现为「同一次事件多发一条 open/close」。
    //
    // **如实说明边界**：本条**不是**「单入口收敛」的门禁。把 post effect 改成连跑两次
    // `reconcile()`，本条照样通过——真正会红的是下面「关闭命令抛错」那条（第一次抛错、
    // 第二次成功 ⇒ 多发一次 `closeInfoWindow`，吃掉「失败保持事实不变」这条不变量）。
    // 单入口的证据在那条用例与 `useInfoWindow.ts` 的机制注释里，不在这里。
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, {
          position: POSITION,
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
        }),
      ],
      el,
    )
    await settle()
    const map = lastMap()
    const opens0 = map.callLog.filter((c) => c === 'openInfoWindow').length
    const closes0 = map.callLog.filter((c) => c === 'closeInfoWindow').length

    // 走真实关闭按钮的形状（`close` 先到、`clickclose` 后到；`close` 让读回变成「不是我」）
    expect(map.clickInfoWindowCloseButton({ shape: ['close', 'clickclose'] })).toBe(true)
    await settle()
    expect(open.value, '父级受控回写落地').toBe(false)
    expect(currentInfoWindow(), '最终地图上没有气泡').toBeNull()
    // 收敛只补**必要**的命令：用户点关闭按钮时 SDK 侧已经关掉了它，读回说「不在地图上」
    // ⇒ 收敛既不补 close 也不补 open。
    expect(map.callLog.filter((c) => c === 'closeInfoWindow').length).toBe(closes0)
    expect(map.callLog.filter((c) => c === 'openInfoWindow').length).toBe(opens0)

    // 父级已是 false 时再收到一条迟到的 `close`（同一实例重新打开后又关闭的形状）：
    // 零命令——observed 说不在地图上、desired 为假，两个分支都无事可做
    currentInfoWindow()?.emit('close')
    await settle()
    expect(map.callLog.filter((c) => c === 'closeInfoWindow').length).toBe(closes0)
    expect(map.callLog.filter((c) => c === 'openInfoWindow').length).toBe(opens0)

    await unmountAndSettle(wrapper)
    harness.assertIdle('post-flush 收敛的命令条数')
  })

  it('外部（别处）打开本组件拥有的实例：desired=false ⇒ 收敛为关，且如实转发 open', async () => {
    const el = harness.container()
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: false })], el)
    await settle()
    const child = wrapper.findComponent(InfoWindow)
    const raw = createdInfoWindows()[0]!

    // 别处调了 `map.openInfoWindow`，打开的就是这个实例 —— 它是**本组件的**实例
    lastMap().openInfoWindow(raw, POSITION)
    await settle()

    expect(emittedOf(child, 'open'), 'SDK 的 open 如实转发').toHaveLength(1)
    expect(
      emittedOf(child, 'update:open'),
      '外部控制不再被翻译成新的 v-model 意图（ownership 契约）',
    ).toHaveLength(0)
    expect(currentInfoWindow(), 'desired=false ⇒ 收敛回关：本库拥有该实例').toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('外部打开我们拥有的实例')
  })

  it('SDK 侧被关闭（desired 仍为开）⇒ 收敛把它重新打开；父级若处理 close 则可保持关闭', async () => {
    // 变体 1：父级只给 `open`（把它当「一直开着」）⇒ 受控语义：观测到关就重新断言
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const child = wrapper.findComponent(InfoWindow)
    const map = lastMap()

    map.closeInfoWindow() // SDK 自己关（点地图 / 别处调）
    await settle()
    expect(emittedOf(child, 'close'), 'SDK 的 close 如实转发').toHaveLength(1)
    expect(emittedOf(child, 'update:open'), '不再回写 update:open（不是第二套业务意图）').toHaveLength(0)
    expect(currentInfoWindow(), 'desired 仍是开 ⇒ 重新断言，气泡回到地图上').toBeTruthy()
    await unmountAndSettle(wrapper)
    harness.assertIdle('desired 重新断言')

    // 变体 2：父级处理 `close`（把 open 置 false，v-model 的常规用法）⇒ 不会再被拉开
    const el2 = harness.container()
    const open2 = ref(true)
    const wrapper2 = mountTree(
      () => [
        h(InfoWindow, {
          position: POSITION,
          open: open2.value,
          onClose: () => (open2.value = false),
        }),
      ],
      el2,
    )
    await settle()
    const map2 = lastMap()
    map2.closeInfoWindow()
    await settle()
    expect(open2.value, '父级跟着 SDK 的 close 收敛').toBe(false)
    expect(currentInfoWindow(), '父级也说关 ⇒ 不得被重新拉开').toBeNull()
    await unmountAndSettle(wrapper2)
    harness.assertIdle('父级跟着 close')
  })

  it('点地图关闭（enableCloseOnClick）+ 父级处理 close：用户关掉后不会被重新拉开', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, {
          position: POSITION,
          open: open.value,
          enableCloseOnClick: true,
          onClose: () => (open.value = false),
        }),
      ],
      el,
    )
    await settle()
    const map = lastMap()
    expect(map.infoWindow?.isOpen(), '对照组：气泡已经打开').toBe(true)

    // 「点地图关闭」在 SDK 侧就是它自己把当前气泡关掉（组件不参与），事件是 `close`
    map.closeInfoWindow()
    await settle()

    expect(open.value, '这是一次真实的关闭 ⇒ 父级应当收敛').toBe(false)
    expect(map.infoWindow, '地图上没有当前气泡').toBeNull()
    expect(
      map.callLog.filter((c) => c === 'openInfoWindow').length,
      '不得因为收敛而重开',
    ).toBe(1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('点地图关闭')
  })

  it('移动请求的迟到 open：父级已关闭 ⇒ 迟到接管也要被收敛为关（真机时序）', async () => {
    const el = harness.container()
    const open = ref(true)
    const position = ref(POSITION)
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: position.value, open: open.value })],
      el,
    )
    await settle()
    const map = lastMap()
    const raw = currentInfoWindow()!
    expect(raw.isOpen(), '对照组：气泡已经打开').toBe(true)

    // 让接下来的 open 异步生效（真机：同一 tick 里 getInfoWindow() 仍是 null）
    map.deferInfoWindowOpen = true
    // 位置变化 ⇒ 收下发一条 open（移动），夹具把它挂起
    position.value = POSITION_B
    await settle()
    expect(map.hasPendingInfoWindow(), '对照组：移动请求已被挂起').toBe(true)

    // 关：气泡确实开着 ⇒ 真正关闭并同步派发 close
    open.value = false
    await settle()
    expect(map.infoWindow, '对照组：关闭已经生效').toBeNull()

    // ★ 移动那条 open 这时才真正接管地图：父级要的是「关」⇒ 必须被收敛掉
    expect(map.flushInfoWindowOpen(), '对照组：确实有一次被放行的接管').toBe(true)
    await settle()
    expect(currentInfoWindow(), '最终地图上不得留下气泡').toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('迟到的移动 open')
  })

  it('打开命令挂起期间不得提前认领归属（open 是异步生效的）', async () => {
    const el = harness.container()
    const openA = ref(false)
    const openB = ref(false)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: POSITION, open: openA.value, title: 'A' }),
        h(InfoWindow, { position: POSITION_B, open: openB.value, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a] = wrapper.findAllComponents(InfoWindow)
    const map = lastMap()

    // A 的打开异步生效 ⇒ 命令已发出、但地图上还没有它
    map.deferInfoWindowOpen = true
    openA.value = true
    await settle()
    expect(map.hasPendingInfoWindow(), '对照组：A 的打开请求被挂起').toBe(true)
    expect(
      probeContext.value?.infoWindows?.current(),
      '命令发出不等于已经是当前项 ⇒ 账本此时不应认 A',
    ).toBeNull()

    // B 打开：A 从未真正打开过 ⇒ 不该收到 superseded
    map.deferInfoWindowOpen = false
    openB.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：B 是当前气泡').toBe('B')
    expect(emittedOf(a!, 'update:open'), 'A 从未实际打开过 ⇒ 不该被通知顶掉').toHaveLength(0)
    expect(emittedOf(a!, 'close')).toHaveLength(0)

    await unmountAndSettle(wrapper)
    harness.assertIdle('挂起的打开不提前认领归属')
  })

  it('关闭命令抛错：事实保持不变，且下一次触发仍会重试', async () => {
    const el = harness.container()
    const open = ref(true)
    const position = ref(POSITION)
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
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: position.value, open: open.value }), h(Probe)],
      el,
    )
    await settle()
    const map = lastMap()
    const manager = () => probeContext.value?.infoWindows
    expect(manager()?.current(), '对照组：已经打开').not.toBeNull()

    map.failNextCloseInfoWindow = new Error('close failed')
    open.value = false
    await settle()

    expect(errors.length, '失败必须上报（不静默）').toBeGreaterThan(0)
    expect(currentInfoWindow(), '失败保持事实不变：地图上仍开着').toBeTruthy()
    expect(manager()?.current(), '失败保持事实不变：账本仍认它是当前项').not.toBeNull()

    // 下一次触发（这里用位置变化）仍会重试关闭，并且这次成功
    position.value = POSITION_B
    await settle()
    expect(currentInfoWindow(), '重试后真的关掉了').toBeNull()
    expect(manager()?.current()).toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('关闭失败后重试')
  })

  it('用户点关闭按钮（clickclose）的四组事件形状：原样转发 + 回写一次 update:open(false)', async () => {
    // 四组形状模拟真实 4.0 的不同打开次数：`close` 恰好一条、`clickclose` 随打开次数累积，顺序不固定
    const shapes: Array<{ tag: string; shape: Array<'close' | 'clickclose'> }> = [
      { tag: '1 次打开 · close 在前', shape: ['close', 'clickclose'] },
      { tag: '1 次打开 · clickclose 在前', shape: ['clickclose', 'close'] },
      { tag: '2 次打开', shape: ['clickclose', 'close', 'clickclose'] },
      { tag: '3 次打开', shape: ['clickclose', 'close', 'clickclose', 'clickclose'] },
    ];

    for (const { tag, shape } of shapes) {
      const el = harness.container()
      const open = ref(true)
      const wrapper = mountTree(
        () => [
          h(InfoWindow, {
            position: POSITION,
            open: open.value,
            "onUpdate:open": (value: boolean) => (open.value = value),
          }),
        ],
        el,
      )
      await settle()
      const child = wrapper.findComponent(InfoWindow)
      const map = lastMap()

      expect(map.clickInfoWindowCloseButton({ shape }), `${tag}：对照组，确实点到了`).toBe(true)
      await settle()

      const clickcloses = shape.filter((n) => n === 'clickclose').length
      expect(emittedOf(child, 'clickclose').length, `${tag}：原样转发 ${clickcloses} 条`).toBe(clickcloses)
      expect(emittedOf(child, 'close').length, `${tag}：SDK 那条 close 也照转`).toBe(1)
      expect(emittedOf(child, 'update:open'), `${tag}：按用户意图回写一次`).toEqual([[false]])
      expect(open.value, `${tag}：受控父级跟着收敛`).toBe(false)
      expect(currentInfoWindow(), `${tag}：最终地图上没有气泡`).toBeNull()

      await unmountAndSettle(wrapper)
      harness.assertIdle(`${tag}：点关闭按钮`)
    }
  })

  it('clickclose 只表达用户意图：地图上仍开着它时，归属不得由这条事件清掉', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, open: true, title: 'A' })],
      el,
    )
    await settle()
    const a = wrapper.findComponent(InfoWindow)
    expect(currentInfoWindow()?.options.title, '对照组：A 打开').toBe('A')

    // 真实 4.0 实测：点击那一组回调里，`clickclose` 会先于「读回已经不是它」到达
    currentInfoWindow()!.emit('clickclose')
    await settle()

    expect(emittedOf(a, 'update:open'), '用户意图仍要回写一次').toEqual([[false]])
    expect(currentInfoWindow()?.options.title, '地图上仍然是 A').toBe('A')
    expect(probeContext.value?.infoWindows?.current(), '归属不得被这条事件清掉').not.toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('读回仍是自己时的 clickclose')
  })

  it('maximize / restore 只转发，不改变「打开」这一维', async () => {
    const el = harness.container()
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: true })], el)
    await settle()
    const child = wrapper.findComponent(InfoWindow)

    currentInfoWindow()!.emit('maximize', { type: 'maximize' })
    currentInfoWindow()!.emit('restore', { type: 'restore' })
    await settle()

    expect(emittedOf(child, 'maximize')).toHaveLength(1)
    expect(emittedOf(child, 'restore')).toHaveLength(1)
    expect(emittedOf(child, 'close'), '不是关闭').toHaveLength(0)
    expect(emittedOf(child, 'update:open')).toHaveLength(0)
    expect(currentInfoWindow(), '气泡仍然开着').toBeTruthy()

    await unmountAndSettle(wrapper)
    harness.assertIdle('maximize / restore')
  })

  it('命令抛错：上报 resource:error，且不假装打开（下一次触发仍会重试）', async () => {
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
    const open = ref(false)
    const wrapper = mount(
      defineComponent({
        components: { Map },
        setup() {
          return () =>
            h(Map, { provider: harness.provider() }, () => [
              h(InfoWindow, { position: POSITION, open: open.value }),
              h(Probe),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    const map = lastMap()

    map.failNextOpenInfoWindow = new Error('openInfoWindow failed')
    open.value = true
    await settle()

    expect(errors.length, '失败必须可观测（不静默）').toBeGreaterThan(0)
    expect(errors[0]?.code).toBe('BMAP_SDK_CALL_FAILED')
    expect(currentInfoWindow(), '没有假装打开').toBeNull()

    // 下一次触发（这里是父级再改一次意图）应当重新尝试，且这次成功
    open.value = false
    await settle()
    open.value = true
    await settle()
    expect(currentInfoWindow(), '重试成功：收敛到 desired=true').toBeTruthy()

    await unmountAndSettle(wrapper)
    harness.assertIdle('命令抛错')
  })

  it('资源账本跟随实际归属：本库打开后认它、收敛关闭后清掉', async () => {
    const el = harness.container()
    const open = ref(true)
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: open.value })], el)
    await settle()
    const manager = () => probeContext.value?.infoWindows
    expect(manager()?.current(), '打开之后账本认它是当前项').not.toBeNull()

    open.value = false
    await settle()
    expect(manager()?.current(), '收敛关闭之后账本必须跟着清掉').toBeNull()

    await unmountAndSettle(wrapper)
    harness.assertIdle('资源账本跟随归属')
  })
})

describe('多窗口互斥 / 多地图隔离 / 迟到 callback', () => {
  it('同一地图两个气泡：后打开的顶掉前者并通知它（前者回写关闭，但不关掉后者）', async () => {
    const el = harness.container()
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: POSITION, open: true, title: 'A' }),
        h(InfoWindow, { position: POSITION_B, open: true, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a, b] = wrapper.findAllComponents(InfoWindow)

    expect(emittedOf(a!, 'update:open'), 'A 收到了「被顶掉」的通知').toEqual([[false]])
    expect(emittedOf(b!, 'update:open'), 'B 是当前气泡，不该被回写').toHaveLength(0)
    const opened = currentInfoWindow()
    expect(opened, 'A 的收盘不得把 B 的气泡关掉').toBeTruthy()
    expect((opened!.options.title as string) ?? '', 'B 才是当前气泡').toBe('B')
    expect(fake.diagnostics.snapshot().leaks.infoWindows, '同一时刻只有一个是「打开」').toBe(1)

    await unmountAndSettle(wrapper)
    harness.assertIdle('两窗口互斥')
  })

  it('双窗口乱序：迟到的接管成为当前项，被顶掉的 B 收到通知，且不产生反复顶替', async () => {
    const el = harness.container()
    const openA = ref(false)
    const openB = ref(false)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: POSITION, open: openA.value, title: 'A' }),
        h(InfoWindow, { position: POSITION_B, open: openB.value, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a, b] = wrapper.findAllComponents(InfoWindow)
    const map = lastMap()

    // 1) A 的打开异步生效（真机：同一 tick 里 getInfoWindow() 仍是 null）⇒ 请求被挂起
    map.deferInfoWindowOpen = true
    openA.value = true
    await settle()
    expect(map.hasPendingInfoWindow(), '对照组：A 的打开请求已被挂起').toBe(true)
    expect(currentInfoWindow(), '对照组：地图上还没有气泡（A 尚未接管）').toBeNull()

    // 2) B 同步打开并接管：A 的打开还挂起、从未成为当前项 ⇒ 不该通知 A 被顶掉
    map.deferInfoWindowOpen = false
    openB.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：B 是当前气泡').toBe('B')
    expect(emittedOf(a!, 'update:open'), 'A 从未实际打开过 ⇒ 不该被通知顶掉').toHaveLength(0)

    // 3) ★ A 的旧请求这时才真正接管地图：A 成为当前项并顶掉实际开着的 B。
    //    按 ownership 契约这里只回答「现在是谁」—— A 的 desired 也是「开」⇒ 不再下发命令。
    const opensBefore = map.callLog.filter((c) => c === 'openInfoWindow').length
    const closesBefore = map.callLog.filter((c) => c === 'closeInfoWindow').length
    expect(map.flushInfoWindowOpen(), '对照组：确实有一次被放行的接管').toBe(true)
    await settle()

    expect(currentInfoWindow()?.options.title, '迟到的接管成为当前气泡（desired 与 observed 一致）').toBe('A')
    expect(emittedOf(b!, 'update:open'), '真正被顶掉的 B 必须收到通知').toEqual([[false]])
    expect(
      probeContext.value?.infoWindows?.current(),
      '账本跟着实际归属：当前是 A',
    ).not.toBeNull()
    expect(
      map.callLog.filter((c) => c === 'openInfoWindow').length,
      '不得为了「抢回来」再打开一次',
    ).toBe(opensBefore)
    expect(
      map.callLog.filter((c) => c === 'closeInfoWindow').length,
      '也不得凭空关闭',
    ).toBe(closesBefore)

    await unmountAndSettle(wrapper)
    harness.assertIdle('双窗口乱序：迟到的接管')
  })

  it('迟到的 close 事件造成的陈旧账本：已经退出的 A 不该被顶替通知，也不该再也打不开', async () => {
    const el = harness.container()
    const openA = ref(true)
    const openB = ref(false)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: POSITION, open: openA.value, title: 'A' }),
        h(InfoWindow, { position: POSITION_B, open: openB.value, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a] = wrapper.findAllComponents(InfoWindow)
    const map = lastMap()
    expect(currentInfoWindow()?.options.title, '对照组：A 先打开').toBe('A')

    // 1) A 的关闭**副作用立即发生**，但 `close` 事件还没派发 ⇒ 账本仍短暂记着 A
    map.deferInfoWindowCloseEvent = true
    openA.value = false
    await settle()
    expect(currentInfoWindow(), '对照组：地图上已经没有 A').toBeNull()
    expect(map.hasPendingInfoWindowCloseEvent(), '对照组：A 的 close 事件还挂着').toBe(true)
    expect(
      probeContext.value?.infoWindows?.current(),
      '对照组：陈旧账本仍认 A',
    ).not.toBeNull()

    // 2) B 打开 ⇒ 账本以为「A 被顶掉」。但 A 早已退出竞争（desired=false），
    //    这次顶替是陈旧账本造成的假通知：不该 suppress，也不该再回写一条 update:open(false)
    map.deferInfoWindowCloseEvent = false
    openB.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：B 成为当前气泡').toBe('B')
    expect(
      emittedOf(a!, 'update:open'),
      'A 已经关闭（desired=false）⇒ 不该再收到一次「被顶掉」的回写',
    ).toHaveLength(0)

    // 3) 父级把 A 重新置为打开：A 必须真的能开（旧的 suppress 不得永久生效）
    openA.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, 'A 必须能重新打开').toBe('A')

    await unmountAndSettle(wrapper)
    harness.assertIdle('陈旧账本造成的顶替通知')
  })

  it('因缺位置退出竞争的 A 同样不该被顶替通知（判据是 desired，不只是 open）', async () => {
    const el = harness.container()
    const position = ref<typeof POSITION | undefined>(POSITION)
    const openB = ref(false)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: position.value, open: true, title: 'A' }),
        h(InfoWindow, { position: POSITION_B, open: openB.value, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a] = wrapper.findAllComponents(InfoWindow)
    const map = lastMap()
    expect(currentInfoWindow()?.options.title, '对照组：A 先打开').toBe('A')

    // 位置被摘掉 ⇒ 不再满足打开条件（desired=false）；收敛把它关掉，但 `close` 事件被推迟
    map.deferInfoWindowCloseEvent = true
    position.value = undefined
    await settle()
    expect(currentInfoWindow(), '对照组：地图上已经没有 A').toBeNull()
    expect(map.hasPendingInfoWindowCloseEvent(), '对照组：A 的 close 事件还挂着').toBe(true)

    // B 打开并接管：A 的 `open` 仍为 true，但缺位置 ⇒ 它本来就不在竞争里
    map.deferInfoWindowCloseEvent = false
    openB.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：B 成为当前气泡').toBe('B')
    expect(
      emittedOf(a!, 'update:open'),
      'A 没有满足打开条件 ⇒ 不该被当成「被顶掉」回写',
    ).toHaveLength(0)

    // 位置回来 ⇒ A 必须真的能重新打开
    position.value = POSITION
    await settle()
    expect(currentInfoWindow()?.options.title, '位置恢复后 A 必须能重新打开').toBe('A')

    await unmountAndSettle(wrapper)
    harness.assertIdle('缺位置退出竞争后的顶替')
  })

  it('迟到的旧 close 不得把「已经重新打开」的同一实例从归属里清掉', async () => {
    const el = harness.container()
    const openA = ref(true)
    const openB = ref(false)
    const wrapper = mountTree(
      () => [
        h(InfoWindow, { position: POSITION, open: openA.value, title: 'A' }, { default: () => 'x' }),
        h(InfoWindow, { position: POSITION_B, open: openB.value, title: 'B' }),
      ],
      el,
    )
    await settle()
    const [a] = wrapper.findAllComponents(InfoWindow)
    const map = lastMap()
    expect(currentInfoWindow()?.options.title, '对照组：A 先打开').toBe('A')

    // 1) 关闭的副作用立即发生，但 `close` 事件被暂存
    map.deferInfoWindowCloseEvent = true
    openA.value = false
    await settle()
    expect(map.hasPendingInfoWindowCloseEvent(), '对照组：旧 close 事件还挂着').toBe(true)

    // 2) 同一个实例重新打开
    openA.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：A 重新打开').toBe('A')

    // 3) 放出第 1 步那条旧 close：地图上现在仍然是 A ⇒ 归属与「开着」都不得被它改掉
    expect(map.flushInfoWindowCloseEvent(), '对照组：确实放出一条被推迟的 close').toBe(true)
    await settle()
    expect(currentInfoWindow()?.options.title, '地图上仍然是重新打开后的 A').toBe('A')
    expect(probeContext.value?.infoWindows?.current(), '归属必须仍然是 A').not.toBeNull()

    // 4) 仍然开着的实例必须继续重绘（`opened` 被清掉的话这里连帧都不会排）
    const content = attachedContent()!
    const iw = currentInfoWindow()!
    shims.setElementSize(content, { width: 200, height: 80 })
    frames.flush()
    const before = iw.redrawCalls
    shims.resize(content, { width: 260, height: 96 })
    expect(frames.pending(), '对照组：尺寸变化排了一帧').toBe(1)
    frames.flush()
    expect(iw.redrawCalls - before, '仍然开着的实例必须继续重绘').toBe(1)

    // 5) B 打开：A 必须正常收到「被顶掉」（账本里没有 A 的话它收不到）
    openB.value = true
    await settle()
    expect(currentInfoWindow()?.options.title, '对照组：B 成为当前气泡').toBe('B')
    expect(emittedOf(a!, 'update:open'), 'A 必须收到 superseded 回写').toEqual([[false]])

    await unmountAndSettle(wrapper)
    harness.assertIdle('迟到的旧 close 事件')
  })

  it('被顶掉的 A 卸载时不得关掉 B 的气泡', async () => {
    const el = harness.container()
    const showA = ref(true)
    const wrapper = mountTree(
      () => [
        showA.value ? h(InfoWindow, { position: POSITION, open: true, title: 'A' }) : null,
        h(InfoWindow, { position: POSITION_B, open: true, title: 'B' }),
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
      () => [h(InfoWindow, { position: POSITION, open: true, title: 'ours' })],
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
    const wrapperA = mountTree(() => [h(InfoWindow, { position: POSITION, open: true, title: 'A' })], hostA)
    const wrapperB = mountTree(() => [h(InfoWindow, { position: POSITION_B, open: true, title: 'B' })], hostB)
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
      () => [h(InfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    const first = createdInfoWindows()[0]!
    const child = wrapper.findComponent(InfoWindow)
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
      () => [h(InfoWindow, { position: POSITION, open: true }, { default: () => 'x' })],
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
      () => [h(InfoWindow, { position: POSITION, open: open.value }, { default: () => 'x' })],
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
      () => [h(InfoWindow, { position: POSITION, open: true, offset: offset.value })],
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
      () => [h(InfoWindow, { position: POSITION, open: true, width: width.value })],
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
  it('重建发出 destroy(旧代次) / rebuild(新代次)：资源与最终状态正确，事件如实转发', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    const child = wrapper.findComponent(InfoWindow)
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
    expect(
      emittedOf(child, 'close'),
      '旧实例的关闭发生在解绑事件之后 ⇒ 不会对外表现为「关了一次」',
    ).toHaveLength(0)
    // 新实例确实被重新打开；那一次打开**如实转发**成 `open`（SDK 事件原样转发，不做归属推断）。
    // 与旧实现的差异（旧实现把重建做成「对外完全原子、不发 open」）记在 ADR 行为变更一节。
    expect(emittedOf(child, 'open').length, '新实例重新打开 ⇒ 如实转发一次 open').toBe(openBefore + 1)
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
      () => [h(InfoWindow, { position: POSITION, open: true }, { default: () => 'bye' })],
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

  it('重建窗口内卸载：被放弃的那一代必须被它自己的释放路径收干净', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const kill = ref(false)
    // 测试自己的 post-flush watcher：在**同一个 flush 的 post 阶段**卸载组件。
    // 这会把 `useSdkResource` 逼进它的 stale 分支（create 已完成、`bind` 之前组件就没了），
    // 也就是「重建窗口内卸载」这条真实可达的时序。
    const wrapper = mount(
      defineComponent({
        components: { Map },
        setup() {
          watch(kill, () => wrapper.unmount(), { flush: 'post' })
          return () =>
            h(Map, { provider: harness.provider() }, () => [
              h(InfoWindow, { position: POSITION, open: true, offset: offset.value }),
              h(ContextProbe),
            ])
        },
      }),
      { attachTo: el },
    )
    await settle()
    expect(createdInfoWindows(), '对照组：第一代已经建好').toHaveLength(1)
    expect(fake.diagnostics.snapshot().leaks.infoWindows).toBe(1)

    // 同一个 tick：pre 阶段触发重建（第二代 create 完成、尚未 bind），post 阶段卸载
    offset.value = { x: 0, y: -4 }
    kill.value = true
    await settle()

    expect(createdInfoWindows(), '对照组：窗口内确实建出了第二代').toHaveLength(2)
    const abandoned = createdInfoWindows().at(-1)!
    // 真正的读数：被放弃的那一代不能泄漏 —— host 摘掉、气泡关掉、监听解绑、账本清空
    expect(
      (abandoned.content as HTMLElement).isConnected,
      '被放弃那代的 host 必须被摘掉（stale 释放路径要认它自己的 handle，而不是当它不存在）',
    ).toBe(false)
    expect((abandoned.content as HTMLElement).parentElement).toBeNull()
    expect(abandoned.isOpen()).toBe(false)
    expect(lastMap().infoWindow, '地图上不得留下气泡').toBeNull()
    expect(probeContext.value?.infoWindows?.size).toBe(0)
    harness.assertIdle('重建窗口内卸载')
  })

  it('重建是单飞的：连续变化合并成一次尾随重建，不会并发进入 replace()', async () => {
    const el = harness.container()
    const offset = ref({ x: 0, y: 0 })
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, open: true, offset: offset.value })],
      el,
    )
    await settle()
    expect(createdInfoWindows(), '对照组：初始一代').toHaveLength(1)

    // 10 次构造期变化，每次只让出一个微任务（不等待 flush 完成）——「连续变化」的最坏形态
    for (let i = 1; i <= 10; i += 1) {
      offset.value = { x: i, y: 0 }
      await Promise.resolve()
    }
    await settle()

    const created = createdInfoWindows()
    expect(created.length, '对照组：连续变化确实换过实例').toBeGreaterThan(1)
    expect(currentInfoWindow(), '当前气泡必须是最后建出来的那一代').toBe(created.at(-1))

    // 决定性读数（不依赖重建次数）：**最终存活的那一代必须是用最后一次变化的值建的** ——
    // 单飞的尾随重建一旦被丢掉，实例就会停在中间某一代上，这条会红。
    const finalOffset = created.at(-1)!.options.offset as
      | { width: number; height: number }
      | undefined
    expect(finalOffset?.width, '尾随重建不得被丢掉：最终实例必须按最后一次 offset 构建').toBe(10)

    // 更早的每一代都要释放干净（原子替换：中间不留孤儿）
    for (const older of created.slice(0, -1)) {
      expect(older.isOpen(), '被替换的每一代都必须关掉').toBe(false)
      expect((older.content as HTMLElement).isConnected, '被替换的每一代都必须摘掉宿主').toBe(false)
    }
    await unmountAndSettle(wrapper)
    harness.assertIdle('连续变化的合并重建')
  })

  it('反复挂载 / 卸载 20 轮：代次与账目都对得上', async () => {
    const el = harness.container()
    for (let round = 0; round < 20; round += 1) {
      const wrapper = mountTree(
        () => [h(InfoWindow, { position: POSITION, open: true, title: `round-${round}` })],
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
  it('`open` 是主状态；`show` 是兼容别名，两者表达同一个打开意图', async () => {
    const el = harness.container()
    const show = ref(true)
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, show: show.value })],
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

  it('使用 `show` 时经集中弃用层打印一次告警（稳定 code + 同实例一次）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = harness.container()
    const show = ref(true)
    const wrapper = mountTree(
      () => [h(InfoWindow, { position: POSITION, show: show.value })],
      el,
    )
    await settle()
    const deprecations = () =>
      warn.mock.calls.filter((call) => String(call[0]).includes('is deprecated'));
    const first = deprecations()
    expect(first, '旧名被使用时恰好告警一次').toHaveLength(1)
    // 文案与 code 都来自 `core/deprecations`（组件不自己拼）；正典名出现在文案里
    expect(String(first[0]![0])).toContain('`open`');
    expect(first[0]![1]).toMatchObject({ code: 'BMAP_DEPRECATED_PROP_ALIAS' });

    // 同实例一次：再改 prop、再渲染都不重复（去重在 warner 里）
    show.value = false
    await settle()
    expect(deprecations(), '同实例只警告一次').toHaveLength(1)

    await unmountAndSettle(wrapper)
  })


  it('只传正典 `open` 时不产生弃用告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = harness.container()
    const wrapper = mountTree(() => [h(InfoWindow, { position: POSITION, open: true })], el)
    await settle()
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes('is deprecated')),
      '没有用旧名就不该有弃用提示',
    ).toHaveLength(0)
    await unmountAndSettle(wrapper)
  })

  it('SSR 阶段不创建 host、不渲染内容、不抛错', () => {
    const html = renderToString(
      h(Map, { provider: harness.provider() }, () => [
        h(InfoWindow, { position: POSITION, open: true }, { default: () => 'ssr' }),
      ]),
    )
    expect(html).not.toContain('data-bmap-infowindow-content')
    expect(contentNodes()).toHaveLength(0)
    expect(fake.createdMaps).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 声明面核对 */

describe('属性面与 Driver 描述符一致', () => {
  it('fields 恰好覆盖 InfoWindowProps 的全部键', () => {
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
    // 这里只留一次类型层收窄，把声明面的键与 `keyof InfoWindowProps` 绑在一起
    const declared = Object.keys(INFO_WINDOW_FIELDS) as Array<keyof InfoWindowProps>
    expect(declared).toEqual(expect.arrayContaining(['position', 'open'] as Array<keyof InfoWindowProps>))
  })

  it('`options` / `recreate` 字段在描述符里真的是对应分类；`state` 字段不进描述符', () => {
    for (const [prop, update] of Object.entries(INFO_WINDOW_FIELDS) as Array<
      [string, 'state' | 'options' | 'recreate']
    >) {
      const declared = INFO_WINDOW_DESCRIPTOR_KEYS[prop as keyof InfoWindowProps]
      const descriptorKey = declared === undefined ? prop : declared
      if (update === 'state') {
        expect(descriptorKey, `${prop} 由组件收敛驱动，不得写进描述符`).toBeNull()
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
