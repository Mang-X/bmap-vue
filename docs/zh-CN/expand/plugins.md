# 插件

百度地图的第三方插件（绘制、轨迹动画、几何工具、可视化）在 JSAPI 4.0 上是**独立脚本**，
按需加载。本库把它们接到 Vue 的配置面上。

## 注册

在 `createBMapPlugin` 的 `plugins` 里按名字声明：

```ts
import { createApp } from 'vue'
import { createBMapPlugin } from 'bmap-vue'

const app = createApp(App)
app.use(
  createBMapPlugin({
    ak: '百度地图ak',
    plugins: ['DrawingManager'],
  }),
)
app.mount('#app')
```

也可以在 `<BMapProvider>` 上按子树声明——只在用到插件的页面加载它：

```vue
<BMapProvider :ak="ak" :plugins="['DrawingManager']">
  <RouterView />
</BMapProvider>
```

## 内置插件目录

| 名字 | 用途 |
| --- | --- |
| `DrawingManager` | 鼠标绘制 |
| `TrackAnimation` | 轨迹动画 |
| `GeoUtils` | 几何计算 |
| `Mapvgl` | MapVGL 可视化 |

`Mapvgl` 在 JSAPI 4.0 上默认路径**不可用**，它的替代方案是 4.0 原生的
[批量可视化图层](/zh-CN/components/layer/native-visual-layers)，
见 [MapVGL 迁移说明](./mapvgl)。

## 插件加载失败不会让地图失败

**内置插件一律 optional**：脚本加载失败只派发 `plugin-error` 事件，地图照常工作。
这符合「官方已提供的能力不自研、也不因为某个插件拖垮主路径」的取舍。

```vue
<BMapProvider :ak="ak" :plugins="['DrawingManager']" @plugin-error="onPluginError">
```

要判断某个插件能不能用，看它在 JSAPI 4.0 上的**实测**结论：
[插件兼容 inventory](/zh-CN/contributing/plugin-compat-inventory)。

## 超时

插件走自己的脚本通道，**不复用** SDK 加载器，因此它有独立的 `timeout`。
超时按失败处理（派发 `plugin-error`），不会无限期挂起。

::: warning 不支持的脚本属性
上游没有公开的 `nonce` / `integrity` / `crossOrigin` / `referrerPolicy`。
传了会被**明确拒绝**而不是静默忽略——接收后忽略属于假支持。
需要这些属性时请在外部预加载。
:::

## 第三方插件

自定义插件用 `urlPluginDefinition` 声明名称、脚本地址与取全局导出的方式：

```ts
import { urlPluginDefinition } from 'bmap-vue/plugins'

const myPlugin = urlPluginDefinition<MyPluginGlobal>(
  'MyPlugin',
  'https://example.com/my-plugin.js',
  // 脚本加载后从全局取导出物
  () => (window as unknown as { MyPlugin: MyPluginGlobal }).MyPlugin,
  { required: false, scope: 'global' },
)
```

| 参数 | 说明 |
| --- | --- |
| `name` | 插件名，出现在 `plugin-error` 事件与 `plugins` 数组里 |
| `url` | 脚本地址 |
| `exportGetter` | 加载后取出插件导出物的函数（插件通常挂在 `window` 上） |
| `options.required` | `false`（默认）= 加载失败只派发事件；`true` = 让初始化失败 |
| `options.scope` | 插件产物的作用域：`global` 挂全局，`map` 挂到地图实例 |
| `options.dependencies` | 依赖的其它插件名 |

然后在配置里引用它。插件在 JSAPI 4.0 上能否工作取决于它自身是否用了已删除的旧引擎面，
本库不做保证——先看它的源码。
