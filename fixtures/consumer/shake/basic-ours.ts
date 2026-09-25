/**
 * 包体对照入口：bmap-vue 侧「基本路径」（issue #140 · 指标 8）
 *
 * 「基本路径」的口径必须在**两侧完全一致**，否则数字没有可比性。这里取
 * **场景 1（Map 冷挂载）+ 场景 2（Marker）+ 场景 8（InfoWindow）** 用到的公开面：
 * 一个 Provider、三个组件。理由：
 *
 * - 三者合起来是一条**真实最小可用路径**（挂一张图、放一个标注、开一个信息窗），
 *   只比 `Map` 单个组件会低估本库（`Marker` / `InfoWindow` 共用 overlay 通道）；
 * - 官方侧用**完全同名**的组件（`BMapProvider` / `Map` / `Marker` / `InfoWindow`）
 *   —— 官方就是这么用的，不挑它的轻量替代品，否则是在给自己挑赢的样本；
 * - 都不含路由 / 5 万点图层 / UI Kit——那些是**别的场景**的入口（场景 9/6/7），
 *   混进「基本路径」会把两库的能力差算成包体差。
 *
 * ⚠️ 必须写成**顶层副作用**：入口导出的常量若无人引用，打包器会整体摇掉，
 * 产物变成 0 字节 —— 那样量到的「包体」是「什么都没打包」，不是组件代价。
 *
 * 官方侧入口：`basic-official.ts`（同名组件、同一个 shape）。
 */
import { BMapProvider, InfoWindow, Map, Marker } from 'bmap-vue'

globalThis.__basicOursProbe = [BMapProvider, Map, Marker, InfoWindow]
