/**
 * 测试全局 setup:
 * - patch document.createElement:对百度脚本执行 callback,模拟 SDK 加载完成
 *
 * M3A3-REMOVE-LEGACY（issue #26）：这里原先还会在 `window.BMapGL` 上注入 Fake BMapGL 并重置它的
 * 统计。旧引擎删除后，测试环境不再预置任何**假 SDK 全局**——需要 v4 命名空间时由用例显式注入
 * （`createFakeV4Provider()` / `existingGlobalV4Provider()`），注入与还原都留在用例内，
 * 既避免「全局脏状态跨用例泄漏」，也让「默认路径不读全局」这条不变量在测试环境里同样成立。
 *
 * 保留的 createElement 桩只服务自研 `ScriptLoader` 的那条路径（`customScriptV4Provider` /
 * `existingGlobalV4Provider` 的离线脚本加载），与官方 Loader 无关。
 *
 * M4-HANDLE-UX（issue #29）：这里再加一层**浏览器能力替身**（`packages/test-utils/browser-shims`）。
 * happy-dom 的 `ResizeObserver` / `IntersectionObserver` 是空实现、`getBoundingClientRect()`
 * 恒为 0（没有布局引擎），而容器门禁与可见性策略正是靠这两样东西工作的。替身提供最小盒模型与
 * 可手动派发的观察器，并记录 `disconnect()` 次数 —— 于是「门禁读标准读数」与「释放真的发生」
 * 在测试里都可断言。
 */
import { afterEach, beforeEach, vi } from 'vitest'
import { browserShims } from '../packages/test-utils/browser-shims'

// 模块级缓存原始 createElement(避免 spy 链递归)
const origCreateElement = document.createElement.bind(document)

function isBMapScript(el: HTMLScriptElement): boolean {
  return el.src.includes('api.map.baidu.com')
}

beforeEach(() => {
  document.body.innerHTML = ''

  const shims = browserShims()
  shims.install()
  shims.reset()

  // 拦截 script 创建,让 SDK 加载 Promise 立即 resolve(模拟)
  vi.spyOn(document, 'createElement').mockImplementation((tag: any, options?: any) => {
    const el = origCreateElement(tag, options)
    if (tag === 'script') {
      setTimeout(() => {
        const src = (el as HTMLScriptElement).src
        if (src && isBMapScript(el as HTMLScriptElement)) {
          const key = src.match(/callback=([^&]+)/)?.[1]
          if (key && (window as any)[key]) {
            ;(window as any)[key]()
            delete (window as any)[key]
          }
        }
      }, 0)
    }
    return el
  })
})

afterEach(() => {
  browserShims().restore()
  vi.restoreAllMocks()
})
