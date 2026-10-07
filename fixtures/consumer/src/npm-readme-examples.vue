<!--
  npm README 示例的**消费方编译对照**（issue #190）。

  这个文件存在的理由：`packages/bmap-vue/README.md` 里那几段示例必须能被
  **真实的发布 tarball** 编译通过——README 给一段抄不起来的代码，就等于写了一条
  跑不起来的命令。

  ## ⚠️ 本文件**挡不住** #190 那个具体缺陷（实测，别再指望它）

  把 `<BMapProvider :ak="ak">` 放进来跑 `vue-tsc --noEmit`，**退出码是 0**。
  原因：Vue 对未声明的 prop 不报错，它落进 `$attrs` 静默丢弃——`vue-tsc` 只检查
  **模板里用到的** prop 的类型，不检查「这个 prop 到底存不存在」。
  所以真正挡住 #190 的是**文本层**的 `scripts/check-doc-props.mts`（它把入包 README
  纳入了 prop 名扫描面），本文件挡的是**另一类**：示例里的 import 路径、变量与类型
  标注在真实 tarball 上是否成立（例如把只存在于 `./advanced` 的
  `BMapLoadOptions` 写成从根入口导入，这里会红）。

  ## 三层分工

  - 文本层（**这条缺陷的主防线**）：`scripts/check-doc-props.mts` 扫入包 README 的 prop 名；
  - 类型层：**本文件**由 `scripts/verify-package.mts` 对 tarball 跑 `vue-tsc`；
  - 运行层：`tests/behavior/npm-readme-provider-init.test.ts` 用 Fake 验初始化路径。

  下面几段把 README 的**三段示例合并进一个 SFC**（README 里它们各自独立），并只做一处
  必然的改写：包名 `@mangax/bmap-vue` → `bmap-vue`（`verify-package.mts` 的
  `rewriteFixturePackageName` 会在拷贝出来的副本里换回真实身份，fixture 源保持人可读）。
  import 路径、变量与类型标注逐字保留——改 README 时请一并改这里，
  否则「文档说的」与「真的能跑」会重新分叉。
-->
<script setup lang="ts">
// —— README「Usage」第一段：把 ak 写在 <Map> 上 ——
import { ref } from 'vue'
import { Map, Marker, NavigationControl } from 'bmap-vue'
import type { Point } from 'bmap-vue'

const ak = 'your Baidu Maps ak'
const center = ref<Point>({ lng: 116.404, lat: 39.915 })

// —— README「Provider 复用全局默认」第二段：<BMapProvider> **不传** ak ——
import { BMapProvider, ZoomControl } from 'bmap-vue'

// —— README「子树显式定义」第三段：provider + loadOptions ——
// `baiduJsapiV4Provider` 与 `BMapLoadOptions` 都在 `./advanced`（根入口按 #26/#44 的
// 出口冻结不导出 Provider factory 家族）——README 的 import 逐字对齐这里。
import { baiduJsapiV4Provider } from 'bmap-vue/advanced'
import type { BMapLoadOptions } from 'bmap-vue/advanced'

const provider = baiduJsapiV4Provider()
const loadOptions: BMapLoadOptions = { ak }

export { ak, center, provider, loadOptions }
</script>

<template>
  <!-- README 第一段 -->
  <Map :ak="ak" v-model:center="center" :zoom="12">
    <Marker :position="center" />
    <NavigationControl anchor="BMAP_ANCHOR_TOP_RIGHT" />
  </Map>

  <!-- README 第二段：Provider 不持 ak，只提供 Client 上下文 -->
  <BMapProvider>
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>

  <!-- README 第三段：子树自己的显式定义 -->
  <BMapProvider :provider="provider" :load-options="loadOptions">
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>
</template>
