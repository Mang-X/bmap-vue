/**
 * Playground mock provider:在无外网/AK 环境用 fake BMapGL 跑通 v3 组件。
 * 生产环境请用 `createBMapPlugin({ ak })`（默认走官方 `@baidumap/jsapi-loader` 加载 v4），
 * 或显式传入 `baiduJsapiV4Provider()`；fake v4 模式属 M3A3-04。
 */
import { createFakeBMapGl } from '@test-utils'

let fakeApi: ReturnType<typeof createFakeBMapGl> | null = null

export function mockProvider() {
  if (!fakeApi) {
    fakeApi = createFakeBMapGl()
    // 暴露到 window,供组件 SDK 边界读取
    ;(window as any).BMapGL = fakeApi
  }
  return {
    id: 'mock',
    load: async () => {
      ;(window as any).BMapGL = fakeApi
      return fakeApi
    },
  }
}
