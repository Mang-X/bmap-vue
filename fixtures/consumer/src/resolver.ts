// #221 消费端契约：把本库 resolver 交给**真实目标插件**编译。
//
// 这条探针走的是**发布包**（`bmap-vue/resolver` 子入口 → 由 tarball 的
// `exports["./resolver"].types` 解析），不是仓库内源码 —— 只对着 `src` 编译的话，
// `dist/resolver.d.ts` 或 exports 的 `types` 回归了也照样绿（#222 评审 P2）。
//
// 配置形态照 `docs/zh-CN/expand/resolver.md`：`unplugin-vue-components` 的 Vite 插件。
import Components from 'unplugin-vue-components/vite'
import { BMapResolver } from 'bmap-vue/resolver'

Components({ resolvers: [BMapResolver()] })

export {};
