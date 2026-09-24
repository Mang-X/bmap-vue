# MapVGL 可视化

MapVGL，是一款基于 WebGL 的地理信息可视化库，可以用来展示大量基于 3D 的地理信息点线面数据。设计初衷主要是为了解决大数据量的三维地理数据展示问题及一些炫酷的三维效果。

::: danger 在 JSAPI 4.0 默认路径上不可用
`Mapvgl` 插件在 JSAPI 4.0 上**不兼容**（结论 `incompatible`），有两条相互独立的依据：
①它的 JSONP 传输层把 `BMapGL._rd` 当回调表（`BMapGL._rd["_cbk"+n] = fn` 并把它拼进 `callback=` 参数），
而 `_rd` 是 SDK 私有面，本库明令不得访问；
②它的 bmap 适配层要往 `map.getPanes().mapPane` 上挂视图容器，而 4.0 的 `getPanes()` 只返回
`floatPane` / `markerMouseTarget` / `floatShadow` / `labelPane` / `markerPane`，**没有 `mapPane`**
（所以 `new mapvgl.View(...)` 在 4.0 上直接抛 `Cannot read properties of undefined`）。
依据与复现命令见[插件兼容 inventory](../contributing/plugin-compat-inventory)。

本章节示例来自 v2 时代，**在当前默认路径下不能直接使用**；请改用 4.0 的原生图层
（`BPointShapeLayer` / `MarkerCluster` / `HeatmapLayer` / `LineLayer` / `FillLayer` 等）。
:::

本章节演示通过插件形式加载 MapVGL 资源，并展示几个官方图层示例。

## 结合方式：

使用 MapVGL 只需要注册 `Mapvgl` 插件：

### 1。通过组件库提供的插件形式 (内部以 cdn 方式加载)

全局配置插件：

```ts
// ...
app.use(baiduMap, {
  plugins: ['Mapvgl']
})
```

或者通过组件配置插件：

```vue
<template>
  <Map :plugins="['Mapvgl']"></Map>
</template>
```

因为资源是通过异步方式加载，所以需要监听 `plugin-ready` 事件（载荷为插件名字符串；v2 的 `@pluginReady` 已移除）：

```vue
<template>
  <Map :plugins="['Mapvgl']" @plugin-ready="handlePluginReady"></Map>
</template>
<script lang="ts" setup>
  function handlePluginReady(name: string) {
    // name === 'Mapvgl'
  }
</script>
```

:::warning 注意
MapVGL 使用 UMD 格式打包，通过插件形式加载可以避免手动管理脚本资源。
:::

## 示例

> 以下示例均来自 MapVGL 官方文档：https://mapv.baidu.com/gl/docs/index.html

### PointLayer 基础点层图

> https://mapv.baidu.com/gl/docs/PointLayer.html

:::demo
expand/mapvgl/pointLayer
:::

### HeatGridLayer 柱状热力图

> https://mapv.baidu.com/gl/docs/HeatGridLayer.html

:::demo
expand/mapvgl/heatGridLayer
:::

### LineLayer 动画线图层

> https://mapv.baidu.com/gl/docs/LineLayer.html

:::demo MapVGL 动画线图层
expand/mapvgl/lineLayer
:::
