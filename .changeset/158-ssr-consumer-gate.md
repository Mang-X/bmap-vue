---
"@mangax/bmap-vue": patch
---

`pnpm verify:package` 新增**纯 Node 的真实 SFC SSR** 验证（#158 工作包 B）。

消费 fixture 里的 `ssr/App.vue` 是**真的 SFC**（不是 `h(Map)` 手搓）：在无 happy-dom /
jsdom 的 Node 子进程里用 `@vue/compiler-sfc` 编译、执行，再用 `renderToString` 渲染含
`<Map>` 的组件。核对六组事实：环境真的没有 `window` / `document`、`vue` 与显式声明的
`@vue/server-renderer` / `@vue/compiler-sfc` 三者同版本、容器 shell 渲染出来、
`status=idle` 且服务端 `map === null`（没有建图）、DOM 访问增量为 0、官方 loader 仍是
`notload` 且全局无 `BMap`（服务端没有装配 SDK）。

DOM 访问记账扣掉了 Vue 自身的探测基线（`createSSRApp` 会读
`window.__VUE_DEVTOOLS_GLOBAL_HOOK__`），所以「增量 0」是本库与它的依赖的真实读数。
`navigator` 刻意不记账——Node 21+ 自带 Web 标准的 `navigator`，它的存在不是 DOM 证据。

`./ui-kit` 的无 DOM import 检查保持不变：本库安全包装入口在无 DOM 时可加载，而上游
`@baidumap/jsapi-ui-kit` 是浏览器实现（无 DOM 时求值即崩）。两者是不同结论。
