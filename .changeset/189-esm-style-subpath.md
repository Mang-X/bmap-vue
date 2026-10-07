---
"@mangax/bmap-vue": patch
---

开放 ESM 样式入口 `@mangax/bmap-vue/styles.css`，让 `<Autocomplete>` 的样式在包管理器路径上可达（#189）

- 此前 `dist/bmap-vue.css` 在 tarball 里、CDN 用 `<link>` 能用，但 `exports` 没有 CSS
  子路径，包管理器消费方 `import` 它会被 Node 判 `ERR_PACKAGE_PATH_NOT_EXPORTED`
  ——**文件在包里不等于消费路径可达**。现在新增一个精确子路径
  `"./styles.css": "./dist/bmap-vue.css"`，用 `import '@mangax/bmap-vue/styles.css'`。
- 刻意**只开一个精确子路径**，不用 `"./*.css"` 后缀模式：实测模式出口会让 `dist/` 下
  任意 `.css` 都可解析，出口白名单会静默放宽成通配。也**不**为 CSS 造假 `.d.ts`。
- `sideEffects` 从 `false` 改为 `["./dist/bmap-vue.css"]`：样式与 JS 分开声明，JS 保持
  可 tree-shake。⚠️ 实测记录在 ADR 里：Vite 7/8 上三种写法**都**产出了该 CSS
  （本库没有 JS import 它），所以这是**声明正确性**的修复，不是「Vite 会因此改判」。
- 开出口后 attw 多报 4 条 `NoResolution`（四个解析档位各一条，成因是「资源出口不参与
  类型解析」，与既有的「缺 `typesVersions`」**不同**），登记为**独立**的显式例外；
  例外模型扩展为支持「一组档位」与 `per-resolution-kind` 清单，仍逐条全等比对。
- 门禁同步：`runtimeExportSubpaths` 收窄为「解析到 `.mjs`」；冻结面用例接受
  「裸字符串 → `dist/*.css`」这一支（按扩展名限定，不放宽成跳过）；
  `verify:package` 在装出来的 tarball 上断言样式可解析、内容含 Autocomplete 的
  `position: absolute` / `z-index: 10`，并反向断言深路径**仍**不可解析。
- 实测证据：Node 可解析；Vite 7.3.7 / 8.3.3 生产构建均产出该 CSS；浏览器里
  `<Autocomplete>` 计算样式为 `position: absolute`、相对 `<Map>` 偏移 10px/10px、
  `z-index: 10`；禁用该样式表后 `position` 退回 `static`（因果确认）。根入口 SSR 与
  `./ui-kit` 按需边界不退化，发布 tarball 条目 50 → 50 不变。

决策与全部依据见 ADR `2026-10-02-esm-style-subpath`（取代 ADR 2026-09-30 决策 4 中
「包管理器消费方无法引用 CSS」那一段）。
