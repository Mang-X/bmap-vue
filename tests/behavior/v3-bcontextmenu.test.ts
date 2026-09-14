/**
 * BContextMenu 迁移验证
 *
 * ★ v4 语义差异（迁移的关键）：BMapGL 上右键菜单可以挂到**父 Marker**（`BMarker` 提供
 * TargetContext，`marker.addContextMenu/removeContextMenu`）；v4 的
 * `OverlayDriver.attachContextMenu` 只接受 `target.kind === "map"`（4.0 的 ContextMenu
 * 一律经 `map.addContextMenu` 挂在 Map 上，没有 Marker 级入口）。而 BContextMenu 组件
 * 传的是 `{ kind: "overlay", handle }`，因此这条挂载路径在 v4 上被**显式拒绝**
 * （Driver 记 `BMAP_CAPABILITY_UNSUPPORTED` 并发一条拒绝告警，组件 catch 后菜单不落图）。
 *
 * 迁移策略：保留每个用例与其意图（菜单按 items 构建、menuItems 重建时旧实例的监听归零、
 * 卸载后无残留），但把「挂到了父 Marker」换成 v4 上**真实可观察**的等价事实：
 * 菜单实例已按 items 构建，且未挂到 Map（`map.contextMenus` 为空）+ Driver 发出了拒绝告警。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import BMap from '../../packages/baidu-map-gl-vue/src/components/map/BMap.vue'
import BMarker from '../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue'
import BContextMenu from '../../packages/baidu-map-gl-vue/src/components/overlays/BContextMenu.vue'
import { createFakeV4Harness, FakeV4ContextMenu } from '../../packages/test-utils'

const { harness, fake } = createFakeV4Harness()
const provider = () => harness.provider()
const host = () => harness.container()

/**
 * 本用例期间创建的 ContextMenu 实例。
 *
 * BMapGL fake 有 `fake.createdContextMenus`；Fake v4 把它们并进 `createdOverlays`，
 * 且 `harness.reset()` **不**清空 `created*` 数组（跨用例累积），因此调用方要自己扣基线。
 */
function createdMenus(): FakeV4ContextMenu[] {
  return fake.createdOverlays.filter((o): o is FakeV4ContextMenu => o instanceof FakeV4ContextMenu)
}

/** 挂一棵 `<BMap>` + 子节点，等就绪。 */
async function mountTree(children: () => unknown, host: HTMLElement) {
  const wrapper = mount(
    defineComponent({
      components: { BMap },
      setup: () => () => h(BMap, { provider: provider() }, children as never),
    }),
    { attachTo: host },
  )
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('BContextMenu v3', () => {
  beforeEach(() => harness.reset())
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('menu 按 items 构建，但 v4 拒绝把它挂到父 Marker（4.0 的菜单只能挂 Map）', async () => {
    const el = host()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const menuBase = createdMenus().length
    const wrapper = await mountTree(
      () => [
        h(BMarker, { position: { lng: 116.4, lat: 39.9 } }, () => [
          h(BContextMenu, { width: 120, menuItems: [{ text: 'a', callback: () => {} }, '-'] }),
        ]),
      ],
      el,
    )

    // 菜单实例仍被创建并按 menuItems 填充（原用的 marker.addContextMenu 调用点不存在了）
    const menus = createdMenus()
    expect(menus.length - menuBase).toBe(1)
    const menu = menus[menus.length - 1]!
    expect(menu.items.map((item) => (typeof item === 'string' ? item : item.text))).toEqual(['a', '-'])

    const map = fake.createdMaps[fake.createdMaps.length - 1]!
    // v4 上 overlay target 被显式拒绝：菜单没有挂到 Map，Driver 发出拒绝告警
    expect(map.contextMenus).toHaveLength(0)
    const warned = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(warned).toContain('attachContextMenu')
    expect(warned).toContain('没有运行时入口')

    wrapper.unmount()
    await nextTick()
    // 卸载同样走 overlay target（被拒绝），不会出现 BMapGL 上的 removeContextMenu
    expect(map.contextMenus).toHaveLength(0)
    harness.assertIdle('BContextMenu 卸载')
  })

  it('menuItems 重建释放旧菜单实例 child scope(listener 不随重建累积)', async () => {
    const el = host()
    const menuItems = ref<(Record<string, unknown> | string)[]>([{ text: 'a', callback: () => {} }])
    const menuBase = createdMenus().length
    const wrapper = await mountTree(
      () => [
        h(BMarker, { position: { lng: 116.4, lat: 39.9 } }, () => [
          h(BContextMenu, { width: 120, menuItems: menuItems.value as never }),
        ]),
      ],
      el,
    )
    // 基线:marker 事件 + context menu open/close(菜单已接入 fake 的监听器计数)
    const baseline = fake.diagnostics.snapshot().leaks.listeners
    expect(baseline).toBeGreaterThan(0)
    expect(createdMenus().length - menuBase).toBe(1)
    const firstMenu = createdMenus()[menuBase]!
    // 当前菜单持有 open/close 两个监听
    expect(firstMenu.getListenerCount()).toBe(2)

    const seenMenus: FakeV4ContextMenu[] = [firstMenu]
    for (let i = 0; i < 10; i++) {
      menuItems.value = [{ text: `item-${i}`, callback: () => {} }]
      await nextTick()
      await flushPromises()
      // 每次原子重建产出新菜单实例,旧实例监听被释放,新实例持有 2 个监听
      expect(createdMenus().length - menuBase).toBe(i + 2)
      const currentMenu = createdMenus()[createdMenus().length - 1]!
      expect(seenMenus[seenMenus.length - 1]).not.toBe(currentMenu)
      seenMenus.push(currentMenu)
      expect(currentMenu.getListenerCount()).toBe(2)
      for (const old of seenMenus.slice(0, -1)) {
        expect(old.getListenerCount()).toBe(0)
      }
    }
    // 全局 listener 总数稳定,不随轮次累积
    expect(fake.diagnostics.snapshot().leaks.listeners).toBe(baseline)

    wrapper.unmount()
    await nextTick()
    // 原口径是 fake.stats.listeners === 0；v4 用泄漏门禁一次覆盖「监听 + 资源」
    harness.assertIdle('BContextMenu 重建卸载')
  })
})
