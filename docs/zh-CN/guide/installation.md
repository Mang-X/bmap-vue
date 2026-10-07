# 安装

## 用包管理器

我们建议使用包管理器（pnpm / yarn / npm）安装 `@mangax/bmap-vue`：

::: code-group

```bash [pnpm]
pnpm add @mangax/bmap-vue
```

```bash [yarn]
yarn add @mangax/bmap-vue
```

```bash [npm]
npm install @mangax/bmap-vue
```

:::

### 同级依赖

`vue`（`^3.5.0`）是 peer 依赖。地图 SDK 由本库默认通过官方
[`@baidumap/jsapi-loader`](https://www.npmjs.com/package/@baidumap/jsapi-loader) 加载，
**不需要**你手动引入 SDK 脚本。

标准 UI（建议、结果列表、翻页、路线面板、详情面板）由官方
[`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit) 提供，
它是 **optional peer**——只有用 `@mangax/bmap-vue/ui-kit` 时才需要装，见[官方 UI Kit 集成](./ui-kit)。

::: code-group

```bash [需要 UI Kit]
pnpm add @baidumap/jsapi-ui-kit
```

:::

### 样式

`<Autocomplete>` 的输入框样式单独发布为一个样式子路径，按需引入一次即可（通常放在入口文件）：

```ts
import "@mangax/bmap-vue/styles.css";
```

只有用到 `<Autocomplete>` 时才需要它。样式入口**不注入**任何运行时逻辑，按上面的写法引入是纯 CSS，
不影响 SSR；不引入它时其余组件照常工作，但 `<Autocomplete>` 的输入框会退回浏览器默认外观。

## 浏览器直接引入

通过 CDN 引入时用全局变量 `BMapVue`（IIFE 产物，已把 Vue 作为外部依赖）。
**生产环境请锁定版本**。

::: code-group

```html [unpkg]
<head>
  <meta charset="utf-8" />
  <!-- Import Vue -->
  <script src="https://unpkg.com/vue@3"></script>
  <!-- Import @mangax/bmap-vue（锁定版本，见下方说明） -->
  <link rel="stylesheet" href="https://unpkg.com/@mangax/bmap-vue@1/dist/bmap-vue.css" />
  <script src="https://unpkg.com/@mangax/bmap-vue@1/dist/index.global.js"></script>
</head>
```

```html [jsDelivr]
<head>
  <!-- Import Vue 3 -->
  <script src="https://cdn.jsdelivr.net/npm/vue@3"></script>
  <!-- Import @mangax/bmap-vue（锁定版本，见下方说明） -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mangax/bmap-vue@1/dist/bmap-vue.css" />
  <script src="https://cdn.jsdelivr.net/npm/@mangax/bmap-vue@1/dist/index.global.js"></script>
</head>
```

:::

::: warning 锁定版本
上面的示例用 `@1` 跟随 1.x 的次版本，**生产环境请锁到精确版本**（例如 `@mangax/bmap-vue@1.0.0`）。

不带版本的路径会跟随 `latest`。我们只支持 JSAPI 4.0，且公共出口按语义化版本演进，
锁版本可以避免将来发布更新时受到影响。

:::

::: tip CDN 与包管理器用的是同一份样式
`<link>` 指向的 `dist/bmap-vue.css` 与包管理器引入的
`@mangax/bmap-vue/styles.css` 是**同一个文件**（`exports["./styles.css"]` 直接指向它），
不存在两套样式。该文件在 `package.json#files` 里按文件名显式声明，且 `sideEffects`
只声明了它一个——其余 JavaScript 仍可被 tree-shake。
:::

## 下一步

- [快速开始](./quick-start) —— 从零跑通第一张地图
- [配置与插件](./config) —— ak、Client 查找顺序、插件
- [Headless 服务](./services) —— 地址解析、路线规划、检索

## 遇到问题

- **地图不显示**：先确认 `ak` 有效，再用[错误码与排障](./errors)对症。
- **`getMapInstance` 之类的方法找不到**：本库不再暴露这类实例方法，
  请用组件 `ref` 暴露的命令面，详见 [Map 地图](/zh-CN/components/map)。
- **仍解决不了**：[FAQ](./faq)。
