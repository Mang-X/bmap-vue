/**
 * M7: v3 入口与安装器 smoke
 *
 * M3A3-REMOVE-LEGACY（#26）：根入口不再导出旧引擎的 Provider factory（`baiduCdnProvider`
 * 家族随 `core/loader/Provider.ts` 一起删除）。v4 Provider 家族从 `bmap-vue/core`
 * 子入口公开（既有入口，不因为这次删除而改变）。
 */
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createBMapPlugin, Vue3BaiduMapGlResolver, useGeolocation, useControllableState } from '../../packages/bmap-vue/src'
import * as root from '../../packages/bmap-vue/src'
import * as advanced from '../../packages/bmap-vue/src/advanced'

describe('v3 public entry', () => {
  it('exposes createBMapPlugin', () => {
    expect(typeof createBMapPlugin).toBe('function')
  })

  it('根入口不再导出旧引擎的 Provider factory（#26）', () => {
    for (const name of [
      'baiduCdnProvider',
      'customScriptProvider',
      'existingGlobalProvider',
      'createLegacyBMapClient',
      'withMigrationDriver',
    ]) {
      expect(root, `根入口仍在导出 ${name}`).not.toHaveProperty(name)
    }
  })

  /**
   * M4-HANDLE-UX（#29）冻结的边界：raw SDK 逃生口**只在 `./advanced`**。
   *
   * 正向与负向成对：只断言「根入口没有 `unwrapRaw`」是恒真也可能恒假的空断言
   * （改个名字就绕过），因此同时断言 `./advanced` **确实**导出它们 —— 三个名字是
   * 「这次真的查了这条规则」的守卫。
   */
  it('raw SDK 逃生口只在 ./advanced（根入口不导出 unwrapRaw / createHandle / HANDLE_BRAND）', () => {
    for (const name of ['unwrapRaw', 'createHandle', 'HANDLE_BRAND']) {
      expect(advanced, `./advanced 必须仍然导出 ${name}`).toHaveProperty(name)
      expect(root, `根入口不得导出 ${name}`).not.toHaveProperty(name)
    }
    // `MapHandle` 类型仍从根入口公开（`ready` 载荷 / `getMapInstance()` 用到它），
    // 但它只是「品牌 + raw: unknown」，真正的 raw 取值函数在 `./advanced`。
    const probe = advanced.createHandle('probe', { ok: true })
    expect(advanced.unwrapRaw(probe)).toEqual({ ok: true })
  })

  it('Map 命令面与暂停原因常量从根入口公开（#29）', () => {
    expect(root.MAP_SUSPEND_REASONS).toEqual({
      user: 'user',
      keepAlive: 'keep-alive',
      document: 'document',
      offscreen: 'offscreen',
      disposed: 'disposed',
    })
  })

  it('installs via app.use and registers global components', () => {
    const app = createApp({ template: '<div />' })
    const plugin = createBMapPlugin({ ak: 'test' })
    app.use(plugin)
    // 组件已注册
    expect(app.component('Map')).toBeTruthy()
    expect(app.component('ZoomControl')).toBeTruthy()
  })

  it('resolver resolves official component names to components path', () => {
    const resolver = Vue3BaiduMapGlResolver()
    const r = resolver.resolve('Map')
    expect(r).toEqual({ name: 'Map', from: 'bmap-vue/components' })
    // 非组件名不解析
    expect(resolver.resolve('FooBar')).toBeUndefined()
  })

  it('exports composables from root', () => {
    expect(typeof useGeolocation).toBe('function')
    // M4-STATE / #27：受控/非受控状态原语是公开 composable（组件与业务侧同一套规则）
    expect(typeof useControllableState).toBe('function')
  })
})
