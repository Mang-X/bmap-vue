---
"bmap-vue": major
---

Clean-slate 1.0：删除 fork / 迁移 / 兼容包袱（#136）。本库 1.0 **不提供旧版迁移路径**——只支持 JSAPI 4.0，不保留任何为「从更早版本升级」而存在的兼容层。

**删除的公共 API（破坏性）**

- 集中弃用层整层删除（`core/deprecations/**`）：`OVERLAY_PROP_ALIASES` / `OVERLAY_EVENT_ALIASES` / `propAliasesOf()` / `describeDeprecation()` / `createDeprecationWarner()` / `DEPRECATED_PROP_ALIAS_CODE` / `DEPRECATED_EVENT_ALIAS_CODE` 一并从根入口与 `./core` 出口移除。
- 旧 prop 写法删除：`InfoWindow` 的 `show` / `v-model:show`、`GroundOverlay` 的 `startPoint` + `endPoint`、`ContextMenu` 的 `menuItems`。正典分别是 `open`、`bounds`、`items`。
- `GroundOverlayProps.bounds` 由**可选改为必填**：删掉两个旧角点 prop 后它是唯一几何入口，运行时缺失即抛错、文档也标 `required`，类型层不再接受「不传」。
- 旧事件名删除：`Marker` 不再发 `drag-end`（SDK 名 `dragend` 原样转发）；`<Map>` 不再发 `initd`（用 `ready`）。无损双拼写的 `MAP_EVENT_EMIT_ALIASES`（`style_loaded` ↔ `style-loaded` 等）**保留**，它不是弃用别名。
- 组件级事件别名机制整层删除（`BMAP_COMPONENT_EVENT_ALIASES` / `BMAP_COMPONENT_EVENT_EMIT_ALIASES` / `MapComponentEventAliasName` / `MapComponentEmitName`）：`initd` 是它唯一的占用者，别名通道随之空掉，按「不留没有消费者的扩展面」一并删。
- `BMapClient.version`（`sdkVersion` 的 `@deprecated` 别名）删除；请按语义选 `libraryVersion` / `sdkVersion`。
- 覆盖物字段策略 `"alias"` 从 `OverlayFieldUpdate` 联合中删除，`assertOverlayFieldDeclarations()` 变成一元函数。
- `createBMapPlugin` 不再向 `app.config.globalProperties` 写 `$baiduMapAk` / `$baiduMapApiUrl`。配置一律经 `<BMapProvider>` 或 `createBMapPlugin({ ak })` 的默认 Client definition。
- `OverlayFieldMap` / `InfoWindowFieldMap` 是穷尽映射，实现自定义覆盖物时按新键集重编。

**随附的仓库清理**（不面向消费方）

- `check:no-bmapgl` 门禁并入 `check:raw-sdk`（新增 `check:raw-sdk:declarations`），三份独家覆盖（白名单目录的 `BMapGL`、公共声明的 engine 取值、范围为空的 fail-closed）全部保留。
- 删除 v2→v3 codemod、三个失效 npm 脚本、三篇迁移/破坏变更文档、CI 空步骤与 81 个 `v3-` 前缀测试文件。
- 官方事实一律保留：`BMapGLLib` 插件命名空间、JSAPI 4.0 挂的 `BMapGL` 同对象别名、`docs/adr/**` 工程史、以及 `NOTICE.md` / `README.md` 的来源归属。
