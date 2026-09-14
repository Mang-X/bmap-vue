/**
 * M7: v3 入口与安装器 smoke
 *
 * M3A3-REMOVE-LEGACY（#26）：根入口不再导出旧引擎的 Provider factory（`baiduCdnProvider`
 * 家族随 `core/loader/Provider.ts` 一起删除）。v4 Provider 家族从 `baidu-map-gl-vue/core`
 * 子入口公开（既有入口，不因为这次删除而改变）。
 */
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createBMapPlugin, Vue3BaiduMapGlResolver, useBMapGeolocation, useControllableState } from '../../packages/baidu-map-gl-vue/src'
import * as root from '../../packages/baidu-map-gl-vue/src'

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

  it('installs via app.use and registers global components', () => {
    const app = createApp({ template: '<div />' })
    const plugin = createBMapPlugin({ ak: 'test' })
    app.use(plugin)
    // 组件已注册
    expect(app.component('BMap')).toBeTruthy()
    expect(app.component('BZoom')).toBeTruthy()
  })

  it('resolver resolves B-prefixed components to components path', () => {
    const resolver = Vue3BaiduMapGlResolver()
    const r = resolver.resolve('BMap')
    expect(r).toEqual({ name: 'BMap', from: 'baidu-map-gl-vue/components' })
    // 非组件名不解析
    expect(resolver.resolve('FooBar')).toBeUndefined()
  })

  it('exports composables from root', () => {
    expect(typeof useBMapGeolocation).toBe('function')
    // M4-STATE / #27：受控/非受控状态原语是公开 composable（组件与业务侧同一套规则）
    expect(typeof useControllableState).toBe('function')
  })
})
