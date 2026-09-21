/**
 * tree-shaking 对照入口 A：**只用** `./advanced`（issue #43）
 *
 * `verify-package.mts` 会用它跑一次真实打包，断言产物闭包里**没有**组件标记。
 * 判据与共用实现见 `scripts/advanced-bundle-shake.mts`。
 *
 * ⚠️ 必须写成**顶层副作用**（而不是只有一个 `export const`）：打包器会把「没有任何人 import 的
 * 入口导出」整体摇掉，结果是 0 字节的产物 —— 那样「闭包里没有组件」就成了恒真，判据失去区分力。
 */
import { CAPABILITY_CATALOG, createHandle, unwrapRaw } from 'baidu-map-gl-vue/advanced'

const handle = createHandle('map', { probe: true })

globalThis.__advancedOnlyProbe = {
  raw: unwrapRaw(handle),
  capabilityCount: Object.keys(CAPABILITY_CATALOG).length,
}
