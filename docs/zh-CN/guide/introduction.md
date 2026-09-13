# Vue3 BaiduMap Gl

<div style="width: 100%; display:flex;justify-content:flex-start;flex-wrap:wrap; margin-top:15px;gap:10px;">
<img src="https://img.shields.io/github/license/Mang-X/bmap-vue?style=flat-square" alt="" />
<img src="https://img.shields.io/github/package-json/v/Mang-X/bmap-vue?color=f90&style=flat-square" alt="GitHub package.json version (subfolder of monorepo)"/>
<img alt="npm" src="https://img.shields.io/npm/dm/baidu-map-gl-vue?logo=npm&style=flat-square" />
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/Mang-X/bmap-vue?style=flat-square&color=%23daaa3f">
<img alt="GitHub issues" src="https://img.shields.io/github/issues/Mang-X/bmap-vue?style=flat-square" />
<img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/Mang-X/bmap-vue?style=flat-square">
</div>

基于百度地图 JavaScript GL 版 (使用了 WebGL 对地图、覆盖物等进行渲染，支持 3D 视角展示地图) API 封装设计的 Vue3 组件库，开发体验良好，以优雅的方式完成百度地图的接入。

## 特性

- 🚀 自动加载百度地图 SDK，将百度地图繁琐的 Api 封装进组件，你只需关注组件本身
- 📦 20+ 高质量的开箱即用 Vue 3 组件以及 8+ hooks 封装
- 📐 遵循直觉的、简约的 Api 设计
- ⚡ Composition Api，更好的性能
- 🔨 完整的 TypeScript 支持，更好的体验
- 🧩 tree shaking 支持，模块分包，只打包你想要的的
- 🌏 基于百度地图 Gl 版 SDK，通过 WebGL 对地图、覆盖物等进行渲染，支持 3D 视角展示地图
- 🚀 支持 volar，组件提供完善的代码提示

## 环境支持

### 组件库

Vue3 BaiduMap GL 可以在支持 [ES2018](https://caniuse.com/?feats=mdn-javascript_builtins_regexp_dotall,mdn-javascript_builtins_regexp_lookbehind_assertion,mdn-javascript_builtins_regexp_named_capture_groups,mdn-javascript_builtins_regexp_property_escapes,mdn-javascript_builtins_symbol_asynciterator,mdn-javascript_functions_method_definitions_async_generator_methods,mdn-javascript_grammar_template_literals_template_literal_revision,mdn-javascript_operators_destructuring_rest_in_objects,mdn-javascript_operators_spread_spread_in_destructuring,promise-finally) 的浏览器上运行。如果您确实需要支持旧版本的浏览器，请自行添加 [Babel](https://babeljs.io/) 和相应的 Polyfill。

由于 Vue 3 不再支持 IE11，该组件库是基于 Vue3 封装，自然也不再支持 IE 浏览器。
| ![IE](https://cdn.jsdelivr.net/npm/@browser-logos/edge/edge_32x32.png) | ![Firefox](https://cdn.jsdelivr.net/npm/@browser-logos/firefox/firefox_32x32.png) | ![Chrome](https://cdn.jsdelivr.net/npm/@browser-logos/chrome/chrome_32x32.png) | ![Safari](https://cdn.jsdelivr.net/npm/@browser-logos/safari/safari_32x32.png) |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Edge ≥ 79 | Firefox ≥ 78 | Chrome ≥ 64 | Safari ≥ 12 |

### Baidu Map GL Api 兼容性

JavaScript API GL v1.0 基于 WebGL 开发，对于用户的浏览器环境有兼容性要求。需要完整支持 WebGL 的现代浏览器来支持渲染。对于 WebGL 支持欠佳的浏览器会降级为 Canvas 绘制，若仍然存在兼容性问题，则会降级到瓦片图渲染，确保不同浏览器环境的用户都可以完成地图的基本渲染。

<script lang="ts" setup>
import { ref } from 'vue'
import { VPTeamMembers } from 'vitepress/theme'

const members = ref<any[]>([])
const isLoading = ref(true)
fetch('https://api.github.com/repos/Mang-X/bmap-vue/contributors?anon=1').then(res => res.json()).then(res => {
  isLoading.value = false
  members.value = res.map(({ avatar_url, login, html_url }, index) => {
    return {
      avatar: avatar_url,
      name: login,
      title: index === 0 ? 'Creator' : 'Contributor',
      links: [
        { icon: 'github', link: html_url },
      ]
    }
  })
})
</script>

## 贡献者

<div v-if="isLoading">Loading Contributors...</div>
<VPTeamMembers v-else size="small" :members="members" />

## License

[MIT licenses](https://opensource.org/licenses/MIT)
