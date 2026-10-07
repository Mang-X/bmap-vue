/**
 * npm README「To share one `ak` across a whole app, register the plugin once」第四段的
 * **独立**消费方对照（#190）。
 *
 * README 那一段是 `ts` 代码块（不是 SFC 模板），所以这里也用 `.ts`；它原先
 * `createApp(App)` 里的 `App` 是未定义标识符，本文件按修复后的 README 保留
 * `import App from './App.vue'`（实体见同目录 `App.vue`）。
 */
import { createApp } from 'vue'
import { createBMapPlugin } from 'bmap-vue'
import App from './App.vue'

const app = createApp(App)
app.use(createBMapPlugin({ ak: 'your Baidu Maps ak' }))
app.mount('#app')
