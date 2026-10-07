---
"@mangax/bmap-vue": patch
---

`pnpm verify:package` 新增**纯 Node 的真实 SFC SSR** 验证（#158 工作包 B）。

消费 fixture 里的 `ssr/App.vue` 是**真的 SFC**（不是 `h(Map)` 手搓）：在无 happy-dom /
jsdom 的 Node 里用 `@vue/compiler-sfc` 编译、执行，再用 `renderToString` 渲染含 `<Map>`
的组件。核对：`vue` 与显式声明的 `@vue/server-renderer` / `@vue/compiler-sfc` 三者同版本、
容器 shell 渲染出来、`status=idle` 且服务端 `map === null`（没有建图）、官方 loader 仍是
`notload` 且全局无 `BMap`（服务端没有装配 SDK）。

## 两遍取证（`bare` / `instrument`）

「真实纯 Node 能渲染」与「没有 DOM 访问」是两个结论，取证方式互相冲突，所以跑在**两个
独立进程**里：

- `bare`：**一个全局都不注入**，忠实于真实消费者。环境判据看六条证据 —— `typeof`、
  `'window' in globalThis` 与 `Object.hasOwn(globalThis, 'window')` 都必须指向「不存在」。
  只报 `typeof` 区分不出「注入了一个返回 undefined 的 getter」，那样已经不再是纯 Node。
- `instrument`：注入记账 getter，只统计访问。`document` **一次都不许被读**，**渲染阶段**
  不许有任何访问；import 阶段允许 `window` 的守卫式读取。

同进程「先注入再删除」救不回 `bare`：module cache 已经热了，`bmap-vue` 与它依赖的模块求值
不会再发生。`@vueuse/core` 因此**不预加载**，让它随真实 import closure 首次求值；它在
模块求值期的守卫式 `typeof window` 会出现在 import 阶段的记录里。

`navigator` 刻意不记账——Node 21+ 自带 Web 标准的 `navigator`，它的存在不是 DOM 证据。

`./ui-kit` 的无 DOM import 检查保持不变：本库安全包装入口在无 DOM 时可加载，而上游
`@baidumap/jsapi-ui-kit` 是浏览器实现（无 DOM 时求值即崩）。两者是不同结论。
