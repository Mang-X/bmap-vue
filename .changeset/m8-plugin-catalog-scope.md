---
"baidu-map-gl-vue": patch
---

收口外部插件 Catalog、`global` / `map` 作用域与依赖调度（`M8-PLUGIN-CORE`，issue #42）。

**插件名字与作用域的表现变了**（`plugins: [...]` 与 `PluginRegistry`）：

- **未知插件名不再静默降级**：`resolvePluginDefinition` / `stringToPluginDefinitions` 对不认识的名字
  抛 `BMAP_PLUGIN_UNKNOWN`（新增错误码）。此前它会返回一个「永远成功」的空实现 ——
  `plugins: ['TrackAnimatino']` 既没有报错、`getStatus()` 还是 `ready`。
  组件层仍然**不阻断地图**：未知名字发 `plugin-error`（载荷里的 `error.code` 是
  `BMAP_PLUGIN_UNKNOWN`），同一列表里的其它插件照常加载。未知名字**不进注册表**，所以
  `getStatus(name)` / `inspect(name)` 是 `undefined`（而不是 `'error'` —— 那是「认得名字但加载失败」
  的形状）。`plugins` 里重复写同一个名字不再报错，而是按一次处理、只回执一次。
- **`global` 作用域插件改成文档级共享**：内置四个插件（`TrackAnimation` / `DrawingManager` /
  `GeoUtils` / `Mapvgl`）显式标了 `scope: 'global'`，由进程级宿主持有 —— 同页面多张地图
  **共享同一次加载**（此前每张地图各插一份 `<script>`），并且**地图卸载不再释放它**
  （上游没有卸载入口；此前卸载还可能取消别的地图正在等的加载）。
  `baidu-map-gl-vue/plugins` 的 `disposeDefaultPluginHost()` 只能清掉宿主缓存的资源与在飞的等待：
  它**不卸载**第三方脚本、也不抹 `window.BMapGLLib.*`，所以之后重新取用会命中「导出已存在」的短路、
  复用同一个全局对象（**不会**重新拉脚本）。要真正的干净起点只能刷新文档。
  **手写 definition 不写 `scope` 时仍按 `'map'` 处理**（与之前一样由单张地图持有）。
- **卸载时仍在飞的插件不再「复活」记录**：`PluginRegistry.dispose()` 之后晚到的结算被丢弃
  （不改状态、不广播事件），`map` 作用域那条晚到的实例会被**就地释放**；`PluginHost` 用纪元号
  隔离「上一轮 dispose 之前的在飞任务」，不会误删同名的新条目。此前一次卸载之后才下载完的插件
  会把状态从 `disposed` 改回 `ready` 并往已销毁的地图上发事件。
- **`whenPlugin(name, signal)` 的 signal 现在真的生效**：它只结算**这一次等待**
  （以 `BMAP_PROVIDER_ABORTED` 拒绝），共享的加载继续跑、结果留给后来的消费者；
  取消**不会**把插件状态写成 `error`。此前这个参数被完全忽略。
- **optional 插件失败 resolve `null`**（此前是 `undefined`）：`undefined` 保留给「void 插件」
  （`load` 出 `undefined`）这一合法成功值，两者不再撞车。
- **依赖按层并行**：拓扑排序后同层 `Promise.all`，不再逐个 `await`；层内顺序仍然可复现。
- 新增 `PluginRegistry.inspect(name)` 读数：`{ scope, required, status, attempts, consumers, error }`；
  失败重试成功后 `getError()` 会被清空（此前会一直留着上一次的错误）。

其余：`stringToPluginDefinitions` 从 `src/plugins/builtins.ts` 迁到 `src/plugins/catalog.ts`
（公共导出路径不变）；`scope` / `name` 在注册期做运行时校验（JS 调用方的唯一防线）。
