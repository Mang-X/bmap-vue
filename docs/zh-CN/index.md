---
layout: home
title: bmap-vue

hero:
  name: bmap-vue
  text: Vue 3 的百度地图组件与 hooks
  tagline: 面向 JSAPI 4.0 · Vue-native · 生产就绪
  image:
    src: /logo.svg
    alt: bmap-vue
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-CN/guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/Mang-X/bmap-vue

features:
  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Rocket.png" alt="Rocket" width="25" height="25" />
    title: 只做 JSAPI 4.0
    details: 不做多引擎分派。默认路径经官方 @baidumap/jsapi-loader 加载，你只面对 4.0 一套语义

  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Package.png" alt="Package" width="25" height="25" />
    title: 覆盖物、控件、图层、全景
    details: 52 个组件，按「覆盖物 / 控件 / 图层 / 数据与批量可视化 / 全景 / 检索」分组

  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Triangular%20Ruler.png" alt="Triangular Ruler" width="25" height="25" />
    title: Vue-native
    details: v-model 双向绑定、具名插槽、shallowRef + markRaw、每一条监听都有释放路径

  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/High%20Voltage.png" alt="High Voltage" width="25" height="25" />
    title: 大数据是 SDK 的活
    details: 原生批量图层（线/面/热力/轨迹线 + 要素状态 + 拾取），渲染留在 SDK 内部

  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Hammer.png" alt="Hammer" width="25" height="25" />
    title: 不是 AnyScript
    details: 完整 TypeScript 声明，公共出口冻结，Volar 组件补全

  - icon: <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Light%20Bulb.png" alt="Light Bulb" width="25" height="25" />
    title: 标准 UI 交给官方
    details: 建议、结果列表、翻页、路线面板用官方 @baidumap/jsapi-ui-kit，本库不复制官方 UI
---

<script lang="ts" setup>
  import { onMounted } from 'vue'
  import VanillaTilt from 'vanilla-tilt';


  onMounted(() => {
    const element = document.querySelector('.image')
    VanillaTilt.init(element, { reverse: true, transition: true })
  })
</script>
