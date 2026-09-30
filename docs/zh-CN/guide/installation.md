# 安装

## 用包管理器

我们建议使用包管理器（pnpm / yarn / npm）安装 `bmap-vue`：

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

### 同级依赖

`vue`（`^3.5.0`）是 peer 依赖。地图 SDK 由本库默认通过官方
[`@baidumap/jsapi-loader`](https://www.npmjs.com/package/@baidumap/jsapi-loader) 加载，
**不需要**你手动引入 SDK 脚本。

标准 UI（建议、结果列表、翻页、路线面板、详情面板）由官方
[`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit) 提供，
它是 **optional peer**——只有用 `bmap-vue/ui-kit` 时才需要装，见[官方 UI Kit 集成](./ui-kit)。

::: code-group

```bash [需要 UI Kit]
pnpm add @baidumap/jsapi-ui-kit
```

:::

## 浏览器直接引入

通过 CDN 引入时用全局变量 `BMapVue`（IIFE 产物，已把 Vue 作为外部依赖）。
**生产环境请锁定版本**。

::: code-group

```html [unpkg]
<head>
  <meta charset="utf-8" />
  <!-- Import Vue -->
  <script src="https://unpkg.com/vue@3"></script>
  <!-- Import bmap-vue -->
  <link rel="stylesheet" href="https://unpkg.com/bmap-vue/dist/bmap-vue.css" />
  <script src="https://unpkg.com/bmap-vue"></script>
</head>
```

```html [jsDelivr]
<head>
  <!-- Import Vue 3 -->
  <script src="https://cdn.jsdelivr.net/npm/vue@3"></script>
  <!-- Import bmap-vue -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bmap-vue/dist/bmap-vue.css" />
  <script src="https://cdn.jsdelivr.net/npm/bmap-vue"></script>
</head>
```

:::

::: warning 锁定版本
CDN 的不带版本路径会跟随 latest。我们只支持 JSAPI 4.0，且公共出口按语义化版本演进，
**请锁定版本号**（例如 `bmap-vue@1`），避免将来发布更新时受到影响。
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
