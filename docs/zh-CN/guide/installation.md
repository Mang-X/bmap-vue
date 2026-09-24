# 安装

## 使用包管理器

我们建议使用包管理器（如 npm、Yarn 或 pnpm）安装 `bmap-vue`，然后使用 Vite、webpack 等打包工具。

::: code-group

```bash [pnpm]
pnpm add bmap-vue
```

```bash [yarn]
yarn add bmap-vue
```

```bash [npm]
npm install bmap-vue
```

:::

## 浏览器直接引入 <Badge type="tip" text="^0.0.21" />

直接通过浏览器的 HTML 标签引入 `bmap-vue`，然后使用全局变量 `BMapVue`。

不同的 CDN 提供商有不同的引入方式，我们在这里以 [unpkg](https://unpkg.com) 和 [jsDelivr](https://www.jsdelivr.com) 举例。你也可以使用其它的 CDN 供应商。

::: code-group

```html [unpkg]
<head>
  <meta charset="utf-8" />
  <!-- Import Vue -->
  <script src="https://unpkg.com/vue@3"></script>
  <!-- Import bmap-vue -->
  <!-- 生产环境请锁定版本 -->
  <script src="https://unpkg.com/bmap-vue"></script>
</head>
```

```html [jsDelivr]
<head>
  <!-- Import Vue 3 -->
  <script src="https://cdn.jsdelivr.net/npm/vue@3"></script>
  <!-- Import bmap-vue -->
  <script src="https://cdn.jsdelivr.net/npm/bmap-vue"></script>
</head>
```

:::

::: tip 提示
我们建议使用 CDN 引入 `bmap-vue` 的用户锁定版本，以免将来发布更新时受到非兼容性更新的影响。
:::

## Hello World

[在线演示](https://codepen.io/yue1123/pen/oNyQWeP)

<iframe allow="accelerometer; camera; encrypted-media; display-capture; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write;" allowfullscreen="true" allowpaymentrequest="true" height="500" style="width: 100%;" scrolling="no" title="bmap-vue" src="https://codepen.io/yue1123/embed/oNyQWeP?default-tab=html%2Cresult&theme-id=light" frameborder="no" loading="lazy">
</iframe>
