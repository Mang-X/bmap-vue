/**
 * tree-shaking 对照入口 B：只用**根入口**（issue #43）
 *
 * 它是上一条判据的**正证**：同一个「闭包里有没有组件标记」的判据，在这里**必须**命中。
 * 没有这条对照，「advanced 的闭包里没有组件」可能只是判据没生效。
 *
 * ⚠️ 与 A 一样必须是**顶层副作用**，否则打包器会把整个入口摇成 0 字节，
 * 这条对照就变成了「什么都没打包」而不是「打包了组件」。
 */
import { BInfoWindow, BMap } from 'bmap-vue'

globalThis.__rootEntryProbe = [BMap, BInfoWindow]
