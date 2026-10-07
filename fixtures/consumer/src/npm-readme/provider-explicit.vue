<!--
  npm README「子树显式定义」第三段的**独立**消费方对照（#190）。

  ⚠️ 这一段就是评审 P1 的原始现场：模板用了 `<Map>`，而 `<script setup>` 只导入了
  `BMapProvider, ZoomControl`——用户若没做全局组件注册，照抄就是未解析的 `<Map>`。

  本文件按修复后的 README 保留 `Map` 的 import。**但要注意它挡不住这个缺陷本身**：
  实测 `vue-tsc` 对未解析的**组件标签**退出码是 0（`<DefinitelyNotARealComponent />`
  也照样通过），它只对未定义的**脚本标识符**报错（删掉下面的
  `baiduJsapiV4Provider` → `TS2304`，退出码 2）。
  所以「模板用了 `<Map>` 却漏 import」由 `scripts/check-snippet-consistency.mts` 的
  `selfContainedBlocks()` 在**文本层**兜住；本文件负责脚本符号这一层。

  一个 README `vue` 块 = 一个 SFC，理由见同目录 `usage.vue` 的文件头（合并会让后一段
  继承前一段的 import，把脚本符号的漏检遮掉）。
-->
<script setup lang="ts">
import { BMapProvider, Map, ZoomControl } from 'bmap-vue'
import { baiduJsapiV4Provider } from 'bmap-vue/advanced'

const ak = 'your Baidu Maps ak'
const provider = baiduJsapiV4Provider()
// `loadOptions` 只在**同时**传了 `provider` 时被读取
const loadOptions = { ak }
</script>

<template>
  <BMapProvider :provider="provider" :load-options="loadOptions">
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>
</template>
