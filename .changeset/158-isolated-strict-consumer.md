---
"@mangax/bmap-vue": patch
---

发布包新增**仓库外隔离项目**的严格类型消费验证（#158 工作包 A）。

`pnpm verify:package` 现在会把正式 tarball 装进一个操作系统临时目录里的裸项目（手写
`package.json` + `npm install`，不是 pnpm 工作区成员），再按 `bundler` 与 `node16` 两档各
编译一次 `fixtures/consumer/strict/probe.ts`，两档都是 `skipLibCheck: false`。

隔离是判据的一部分：脚本自己断言「临时项目到磁盘根之间没有 `node_modules`」「不是 pnpm
工作区成员」「没有装官方类型包」「包解析在本项目内」。少了这些，「包缺件」会被依赖提升或
工作区根的 `node_modules` 补回来，门禁看起来是绿的。

探针同时补上**关键泛型**的判别力：`useControllableState<T>` 的类型参数必须真的传导到
`value` / `internal` / `initial`，`useMapEvent<K>` 的事件名必须真的决定回调载荷（表内精确、
表外退化为公共底座，两者都不是 `any`）。正反两侧都有断言，泛型被擦成 `any` 时会红。
