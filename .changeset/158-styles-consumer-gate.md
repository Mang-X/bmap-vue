---
"@mangax/bmap-vue": patch
---

`pnpm verify:package` 新增**样式消费生产构建**与**计算样式**验证（#158 工作包 D）。

## 生产构建（装出来的 tarball + Vite）

在消费 fixture 里跑两次真实 Vite 生产构建：

- 显式 `import '<pkg>/styles.css'` 的产物，CSS 必须含 Autocomplete 的
  `b-auto-complete-input` / `position:absolute` / `z-index:10` / `top:10px` / `left:10px`；
- 不 import 的产物必须**不含**这些规则 —— 本库不自动注入样式（#189 的边界），
  只有显式 import 才该出现。正向对照是产物里确实有本库代码。

## 计算样式（同一入口里，跑在装出来的包上）

`fixtures/consumer/styles/computed-style-runner.mjs` 在消费 fixture 里**导入发布包**，
用 happy-dom 真实渲染 `<Map>` / `<Autocomplete>`，然后：

1. 读输入框上**发布组件自己带出来的** `data-v-*` 属性（**不人工补任何属性**）；
2. 注入同一份 tarball 里的 `styles.css`（经 Node 解析，路径必须在 `node_modules` 内）；
3. 断言那个 scope 真的出现在发布 CSS 的选择器里（JS 与 CSS 来自同一次构建）；
4. 读 `getComputedStyle`：`position: absolute`、`z-index: 10`、`top/left: 10px`、
   `max-width: calc(100% - 20px)`、`box-sizing: border-box`；
5. 反证：没有 scope 属性的同类元素**不**命中那条规则。

于是「发布 JS 的 scope 与发布 CSS 的 scope 一致」是**被断言的事实**：发布组件丢了 scoped
绑定、或 JS / CSS 来自不一致的构建，这一步都会红（实测把安装产物里的 scope 改掉即判红）。

## 位置（为什么不放 `test:unit`）

这一整套都在 `verify:package` 消费路径里 —— 那条路径本来就先 `build:package` 再 pack。
`dist` 是 gitignore 的构建产物，而 `pnpm test:unit` 在干净检出上并不保证它存在
（会以「缺少发布样式」失败），所以计算样式不放 `test:unit`。

## 范围说明

- basic 与 UI 消费方的边界（根入口不静态拉进可选 UI Kit）已由
  `tests/behavior/ui-kit-entry.test.ts` 的真实 basic / UI 两次生产构建覆盖，本 PR 不重复一套
  更弱的：静态 re-export 会被 tree-shaking 藏起来，产物里看不出来。
- UI Kit 包装层的动态加载 / 事件 / 卸载继续由现有 `ui-kit-*` harness 覆盖（mock 明确标注，
  真实官方 widget 行为在 #45 验证）；npm README 用法由 #190 的文本 / 类型 / 运行三层覆盖。
