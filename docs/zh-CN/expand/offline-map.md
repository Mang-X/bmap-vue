# 离线地图

离线地图需要自建百度地图 api，并将自建的 api 地址通过 [`apiUrl`](../guide/config) 配置传给组件库。

除此之外，还有一个很重要的处理，需要全局初始化一个回调函数，用于通知地图初始化。

```js
window.BMapGL.apiLoad = function () {
  delete window.BMapGL.apiLoad
  if (typeof window._initBMap_ == 'function') {
    window._initBMap_()
  }
}
```

下面是一个离线地图 api 加载入口文件示例，是根据原版在线 api 的改动的，其中请求的 `bmapgl.min.js` 就是地图 api，这个资源地址需要自建。

```js
// getApiScripts.js
;(function () {
  var offmapcfg = (window.offmapcfg = {})
  var JS__FILE__ = document.currentScript
    ? document.currentScript.src
    : document.scripts[document.scripts.length - 1].src
  offmapcfg.home = JS__FILE__.substr(0, JS__FILE__.lastIndexOf('/') + 1) //地图API主目录

  window.BMapGL_loadScriptTime = new Date().getTime()
  window.BMapGL = window.BMapGL || {}
  window.BMapGL.apiLoad = function () {
    delete window.BMapGL.apiLoad
    if (typeof window._initBMap_ == 'function') {
      window._initBMap_()
    }
  }

  var s = document.createElement('script')
  var link = document.createElement('link')

  s.src = offmapcfg.home + '/bmapgl.min.js'
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('type', 'text/css')
  link.setAttribute('href', offmapcfg.home + '/css/bmap.css')
  document.body.appendChild(s)
  document.getElementsByTagName('head')[0].appendChild(link)
})()
```

```vue
<script setup lang="ts">
  import { Map, Marker } from 'bmap-vue'
  // 自建入口经 v4 Provider 表达（`apiUrl` 在默认路径下会在加载前报错）
  import { customScriptV4Provider } from 'bmap-vue/core'

  const offlineProvider = customScriptV4Provider('自建地址/getApiScripts.js')
</script>

<template>
  <Map
    :center="{ lng: 106.53637853629937, lat: 29.464275891815767 }"
    enableScrollWheelZoom
    :provider="offlineProvider"
  >
    <Marker :position="{ lng: 121.56847909, lat: 29.8100979777 }"></Marker>
  </Map>
</template>
```

::: tip v3 推荐写法
自建入口**不**通过 `apiUrl` 表达：默认路径的入口由官方 Loader 决定，`apiUrl` 在上游没有这个入口。

- `<Map api-url="...">` / `createBMapPlugin({ apiUrl })` 会在加载前显式报 `BMAP_INVALID_ARGUMENT`
  （`apiUrl` 只对显式传入的 legacy Provider 有意义）；
- 正确做法是用 `customScriptV4Provider(scriptSrc)` 构造 Provider，经 `createBMapPlugin({ provider })`
  或 Client 定义传入，见[配置](../guide/config#更换插件资源链接)。

如果 SDK 由宿主页面自己加载好（例如已有的离线入口脚本），改用 `existingGlobalV4Provider()`
即可，本库只消费全局、不另插 script。
:::
