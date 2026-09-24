import { it, expect } from 'vitest'
import { createFakeV4Harness } from '../packages/test-utils'

/**
 * Fake v4 健全性 smoke：证明测试替身本身可用。
 *
 * 原来是对 Fake BMapGL 的监听器 / 覆盖物 / 地图计数器做同样的自检；Fake BMapGL 已随 #26 删除，
 * 这里换成 Fake v4 的口径：
 * `leaks`（当前未释放）逐项归零 + `harness.assertIdle()` 汇总门禁。
 */
it('fake bmap v4 sanity: map create/destroy + listener & resource accounting', () => {
  const { harness, fake } = createFakeV4Harness()
  harness.reset()

  const host = harness.container()
  const map = new fake.namespace.Map(host)
  expect(fake.diagnostics.snapshot().leaks.maps).toBe(1)

  const listener = () => {}
  map.addEventListener('click', listener)
  expect(fake.diagnostics.snapshot().leaks.listeners).toBe(1)
  map.removeEventListener('click', listener)
  expect(fake.diagnostics.snapshot().leaks.listeners).toBe(0)

  const marker = new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9))
  map.addOverlay(marker)
  expect(fake.diagnostics.snapshot().leaks.overlays).toBe(1)
  map.removeOverlay(marker)
  expect(fake.diagnostics.snapshot().leaks.overlays).toBe(0)

  map.destroy()
  expect(fake.diagnostics.snapshot().leaks.maps).toBe(0)

  // 汇总门禁：任一种类未释放都会在这里失败
  harness.assertIdle('fake v4 健全性 smoke')
})
