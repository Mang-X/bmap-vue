/**
 * CDN/global build smoke
 *
 * 验证 dist/index.global.js:
 * - 存在
 * - Vue 完全 external(通过参数注入,而非打包)
 * - 全局变量名 BMapVue
 * - 可直接在 script 标签使用(仅依赖 window.Vue)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const globalPath = resolve(
  import.meta.dirname,
  '../../packages/bmap-vue/dist/index.global.js',
)

describe('global build', () => {
  it('produces dist/index.global.js', () => {
    expect(existsSync(globalPath)).toBe(true)
  })

  it('exposes window global BMapVue', () => {
    const src = readFileSync(globalPath, 'utf8')
    expect(src).toContain('var BMapVue')
  })

  it('externalizes Vue (no bundled vue, injected as parameter)', () => {
    const src = readFileSync(globalPath, 'utf8')
    // iife 结尾应该注入 Vue 参数(压缩后无空格)
    expect(src).toMatch(/\(\{\},Vue\)/)
    // 不应自行定义 Vue
    expect(src).not.toContain('var Vue =')
  })

  it('exports BMap / createBMapPlugin on the global namespace', () => {
    const src = readFileSync(globalPath, 'utf8')
    expect(src).toContain('createBMapPlugin')
    expect(src).toContain('BMap')
  })
})
