/**
 * 包体对照入口：官方 `@baidumap/vue-bmap` 侧「基本路径」（issue #140 · 指标 8）
 *
 * 与 `basic-ours.ts` **同名组件、同一个 shape**（`BMapProvider` / `Map` / `Marker` /
 * `InfoWindow`）。两侧入口只有 import 的包名不同，因此「基本路径」这个口径
 * 是真的同一份任务，不是各挑各的轻量面。
 *
 * 为什么官方**也是**四个都进：官方这四个恰好都在它的**单文件产物**里
 * （`dist/index.js` 一个文件装全），所以这里量到的是「引了其中任意一个会带进多少」，
 * 而不是可 tree-shake 的细粒度闭包——这是官方当前的打包形态，读数要按这个事实读
 * （见 `scripts/collect-bundle-contrast.mts` 的 `notes`）。
 */
import { BMapProvider, InfoWindow, Map, Marker } from '@baidumap/vue-bmap'

globalThis.__basicOfficialProbe = [BMapProvider, Map, Marker, InfoWindow]
