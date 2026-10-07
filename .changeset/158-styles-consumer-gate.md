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

## 计算样式（发布 CSS + happy-dom）

`tests/behavior/autocomplete-published-style.test.ts` 把**未改动的** `dist/bmap-vue.css`
注入 happy-dom，在真实渲染出来的 `<Autocomplete>` 输入框上读 `getComputedStyle`：
`position: absolute`、`z-index: 10`、`top/left: 10px`、`max-width: calc(100% - 20px)`、
`box-sizing: border-box`。不需要外网 / AK / Chromium，CI 的 `quality` job 就能跑。

发布 CSS 的选择器带构建期 scope hash（dist 与测试构建不同），用例的做法是 **CSS 一个字不改**，
把 dist 选择器里的 scope 属性按原值补到被测元素上；另有一条反证断言该规则**不**对没有 scope
属性的同类元素生效。

## 范围说明

- basic 与 UI 消费方的边界（根入口不静态拉进可选 UI Kit）已由
  `tests/behavior/ui-kit-entry.test.ts` 的真实 basic / UI 两次生产构建覆盖，本 PR 不重复一套
  更弱的：静态 re-export 会被 tree-shaking 藏起来，产物里看不出来。
- UI Kit 包装层的动态加载 / 事件 / 卸载继续由现有 `ui-kit-*` harness 覆盖（mock 明确标注，
  真实官方 widget 行为在 #45 验证）；npm README 用法由 #190 的文本 / 类型 / 运行三层覆盖。
