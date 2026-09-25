---
title: 服务端渲染与生命周期
lang: zh-CN
---

# 服务端渲染与生命周期

## 服务端渲染

本库在模块求值期**不访问** `window` / `document`——所有 SDK 交互都发生在组件挂载之后。
所以 `import { Map } from 'bmap-vue'` 在 Node 侧是安全的。

真正需要注意的是**渲染**：地图要在浏览器里才有意义。
服务端渲染时请让 `<Map>` 只在客户端渲染：

```vue
<template>
  <ClientOnly>
    <Map :ak="ak" :zoom="12" />
    <template #fallback>地图加载中…</template>
  </ClientOnly>
</template>
```

### `./ui-kit` 的特殊约束

官方 `@baidumap/jsapi-ui-kit` 在**模块求值期**就访问 `document`，在 Node 侧 `import` 直接崩。
本库的 `./ui-kit` 入口把上游包放在**动态 import** 后面，因此 `import { PlaceSearch } from 'bmap-vue/ui-kit'`
本身是 SSR 安全的。

但**服务端渲染这些组件没有意义**——它们依赖真实 DOM 与地图实例。
`./ui-kit` 也**不能**进根入口或任何 SSR 可达的静态模块图。

## 容器尺寸：地图创建的前置条件

地图在容器拿到**非零尺寸**之前不会创建。容器尺寸是 0 时：

- `<Map>` 的 `status` 停在 `idle`（不是 `loading`）；
- `loading` 插槽的默认文案是 `waiting for container size...`。

最常见的触发场景是折叠面板、未展开的 Tab、`display:none` 的父元素。
给容器一个确定的高度，或等它展开再渲染：

```vue
<Map v-if="panelOpen" :ak="ak" />
```

`loading` 与 `error` 插槽的载荷完全相同：`{ status, error, containerReady, retry }`。

## 组件卸载 ≠ 取消上游加载

这两件事经常被混为一谈，结论不同：

| | 行为 |
| --- | --- |
| 组件卸载 | 解绑消费者、**丢弃回包** |
| 官方 SDK 加载 | **继续跑到底** |

官方没有公开的取消接口。**全部**消费者都取消之后，在飞的加载任务会被**保留**，
且**不会**为后续请求另插重复的 `<script>`——SDK 全局是进程级的，重复注入既浪费又会撞配置。

想「卸载后重新加载」，正确做法是重新创建 Client（`retry()` 或重建 `<BMapProvider>`），
而不是去动已经注入的脚本。

## 本库不会做的事

- **不调用官方的 `reset()`**。它会删除进程级的 SDK 全局对象，
  影响同一页面里其它使用方。本库只在测试与热更新场景里用到它。
- **不删除或改写**上游注入的 `<script>`、回调全局与命名空间。
- **不静默忽略**上游没有的脚本属性。`nonce` / `integrity` / `crossOrigin` / `referrerPolicy`
  在上游没有入口，传了会**显式报错**而不是接收后忽略——接收后忽略属于假支持。
  需要它们请在外部预加载 SDK，再用 `existingGlobalV4Provider()` 接管。

## 资源释放

以下资源每一条都有释放路径，组件卸载时统一回收：

监听器 · 覆盖物 · 控件 · 图层 · 服务结果 · Observer · 定时器 · 动画帧。

服务类 composable 的两档归属决定了释放方式：

- **简单档**（地址解析、坐标转换等）走无状态通道，没有实例要销毁；
- **独占档**（`useLocalSearch` 与四个路线 composable）有官方提供的实例释放入口，
  因此额外暴露 `invalidateService`。

判据是「**该服务的 SDK 实例有没有公开的释放入口**」，不是「哪个服务看起来复杂」。
完整名单见 [Headless 服务](./services)。

## 排查

| 现象 | 先看 |
| --- | --- |
| SSR 报 `window is not defined` | 是否静态引入了 `bmap-vue/ui-kit`（必须动态 import） |
| 地图空白、停在 `idle` | 容器尺寸是不是 0，见上文 |
| 反复进入页面时 SDK 重复加载 | 本库不会重复注入；检查是否有多处各自 `createBMapPlugin` |
| 错误码不认识 | [错误码与排障](./errors) |
