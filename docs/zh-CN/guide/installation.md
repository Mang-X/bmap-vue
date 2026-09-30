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
  <!-- Import bmap-vue（锁定版本，见下方说明） -->
  <link rel="stylesheet" href="https://unpkg.com/bmap-vue@1/dist/bmap-vue.css" />
  <script src="https://unpkg.com/bmap-vue@1/dist/index.global.js"></script>
</head>
```

```html [jsDelivr]
<head>
  <!-- Import Vue 3 -->
  <script src="https://cdn.jsdelivr.net/npm/vue@3"></script>
  <!-- Import bmap-vue（锁定版本，见下方说明） -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bmap-vue@1/dist/bmap-vue.css" />
  <script src="https://cdn.jsdelivr.net/npm/bmap-vue@1/dist/index.global.js"></script>
</head>
```

:::

::: warning 锁定版本
上面的示例用 `@1` 跟随 1.x 的次版本，**生产环境请锁到精确版本**（例如 `bmap-vue@1.0.0`）。

不带版本的路径会跟随 `latest`。我们只支持 JSAPI 4.0，且公共出口按语义化版本演进，
锁版本可以避免将来发布更新时受到影响。

:::

::: warning `dist/bmap-vue.css` 目前只对 CDN 场景有效
它是 `<Autocomplete>` 输入框的样式（ESM 与 IIFE 两档构建都会产出这个文件）。

**包管理器安装时无法引用它**：`package.json#exports` 没有开放 CSS 子路径，
`import 'bmap-vue/dist/bmap-vue.css'` 会被 Node 判为 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
因此它目前只服务于上面 `<script>` 直引的 CDN 场景——用 `<link>` 引入是可行的。

该文件已在 `package.json#files` 里**按文件名显式声明**（`pnpm check:pack-contents` 会断言这一点），
所以它不是构建副产物。是否要让它对包管理器消费方也可引用（新增 `./styles.css` 出口），
会改动 #44 冻结的出口面，属独立决策。
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
