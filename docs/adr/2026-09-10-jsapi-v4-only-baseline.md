# ADR 2026-09-10：冻结 JSAPI 4.0 单引擎基线

- 状态：已接受（Accepted）
- 日期：2026-09-10
- 计划键：`M3A0-BASELINE`（issue #14，追踪 #12）
- 取代：无
- 相关：`packages/baidu-map-gl-vue/src/driver/types/bmap.ts`

## 背景

组件库 v2/v3 beta 的运行时长期建立在百度地图 JavaScript API **GL 版**（`type=webgl&v=1.0`，全局 `BMapGL`）之上。v3 已经把 raw SDK 调用收敛到 `src/driver`、`src/client` 与 Loader/Provider 边界，但尚未正式冻结「Stable 只支持哪个 SDK」。

百度地图开放平台当前主推 JavaScript API **4.0**（`v=4.0`，全局 `BMap`），并提供官方 TypeScript 声明包 `@baidumap/jsapi-v4-types` 与官方 Agent Skill `bmap-jsapi-v4`。继续维持 GL v1 会让类型、文档、示例、真机验证与官方资料脱节。

因此需要在本阶段（M3A.0）把 v3 Stable 的 SDK 基线一次性决策并落盘，避免后续 Loader、Driver、Vue API 各阶段反复摇摆。

## 决策

1. **v3 Stable 的唯一默认且受支持的 SDK 基线是百度地图 JavaScript API 4.0**：
   - 加载参数为 `v=4.0`；
   - 运行时命名空间为全局 `BMap`；
   - `BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK、官方类型边界与最小 augmentation。
2. **不承诺 v3 主包长期双引擎支持**。GL v1（`BMapGL`）在迁移期仅作为过渡实现存在，将在 M3A.3（issue #26）删除。
3. **官方类型包 `@baidumap/jsapi-v4-types` 是本仓库的开发期依赖，不是运行时依赖**：
   - 精确锁定版本（当前 `4.0.4`），不加 `^`/`~`；
   - 通过 `packages/baidu-map-gl-vue/tsconfig.build.json` 的 `compilerOptions.types` 显式接入；
   - 不进入运行时 bundle，不允许在业务代码中具名导入。
4. **官方 Skill `bmap-jsapi-v4` 是开发知识来源，不是依赖**：通过 `skills` CLI 安装，仅用于编码/评审/排障时的 API 参考；不得复制进源码或打包产物。
5. **保持 `skipLibCheck: false`**：官方 `4.0.4` 声明存在少量缺口（`MapTypeOptions`、`Projection`、`RoutePolylineStyle`），以最小 augmentation 补齐，而不是用 `skipLibCheck` 或 `any` 绕过。

## 版本模型

仓库里同时存在三种「版本」，必须区分：

| 维度 | 含义 | 当前取值 | 载体 |
| --- | --- | --- | --- |
| 组件库版本 | `baidu-map-gl-vue` 包版本 | `3.0.0-beta.x` | `packages/baidu-map-gl-vue/package.json` |
| SDK engine | 项目内部抽象的驱动引擎枚举 | `webgl-v1` / `jsapi-v3` / `jsapi-v4` | `driver/types/bmap.ts` 的 `BMapEngine` |
| SDK version | 百度地图 JSAPI 运行时版本 | Stable 目标 `4.0` | 加载 URL 的 `v=4.0` |
| 官方类型包版本 | `@baidumap/jsapi-v4-types` | `4.0.4`（精确锁定） | `packages/baidu-map-gl-vue/package.json` |

- 讨论「升级」时必须说明是哪一种版本。
- `BMapEngine` 是内部实现细节；面向使用者的公共 API 不得泄漏 `BMap.*` 或 engine 枚举。

## 组件库与 SDK 支持政策

| 组件库版本 | SDK 基线 | 支持状态 |
| --- | --- | --- |
| `baidu-map-gl-vue@2.x` | JSAPI GL v1（`BMapGL`） | 仅安全/关键修复，不再新增功能 |
| `baidu-map-gl-vue@3.0.0-beta.x` | 迁移期：GL v1 过渡 + JSAPI 4.0 目标 | 开发中，API 未冻结 |
| `baidu-map-gl-vue@3.0.0`（Stable） | JSAPI 4.0（`BMap`） | 唯一稳定基线，单引擎 |

- v3 Stable 不提供 `BMapGL` 回退开关；需要 `BMapGL` 的用户应停留在 2.x。
- 从 3.0.0-beta 升级到 Stable 会移除 `BMapGL`/`webgl-v1` 相关能力，属于迁移说明覆盖范围。

## 官方类型接入细则

- 精确版本：`"@baidumap/jsapi-v4-types": "4.0.4"`。
- 接入位置：`packages/baidu-map-gl-vue/tsconfig.build.json` → `compilerOptions.types`。
- 边界文件：`packages/baidu-map-gl-vue/src/driver/jsapi-v4/types-reference.d.ts`。
  - 以 `/// <reference types="@baidumap/jsapi-v4-types" />` 声明唯一合法的全局 `BMap` 来源；
  - 集中存放官方声明缺口的最小 augmentation，并注明「升级后重新核对、官方补齐即删除」；
  - 保留在声明构建的编译输入中（不得用 `exclude` 将其移出 Program），仅在声明写入阶段过滤，避免公共 `dist/*.d.ts` 泄漏 `BMap.*` 或官方类型包引用。
- 迁移期冲突处理：构建 tsconfig 的 `include` 暂时收窄为 `types/shared/**/*.d.ts`，避免旧 `types/BMapGL` 的全局常量与官方 `BMap` 声明冲突；`types/BMapGL` 将在 M3A.3 删除。
- 已验证：`pnpm typecheck:v3` 在 `skipLibCheck: false` 下通过；类型包为纯 `.d.ts`，构建产物与 npm tarball 均不含其运行时代码或 `BMap.*` 声明，consumer 包类型检查通过。
  - **平台前提（2026-09-13 更正）**：`4.0.4` 的入口存在一处文件名大小写缺陷（`core/displayOptions.d.ts`），因此上述验证当时**只在大小写不敏感的文件系统（macOS APFS）上成立**，Linux 上会失败。现由 `patches/@baidumap__jsapi-v4-types@4.0.4.patch` 修补，并重新纳入 CI；见 [ADR 2026-09-13](./2026-09-13-upstream-types-case-patch.md)（issue #50）。

## Skill 使用细则

- 安装（项目级、由 `skills-lock.json` 锁定）：

  ```bash
  npx skills add baidu-maps/jsapi-skills --skill bmap-jsapi-v4
  ```

- 使用规则：
  - 只把它当作 `v=4.0` + 全局 `BMap` 的 API 参考，禁止混用其他版本的加载参数或命名空间；
  - 依赖 AK、在线服务、CORS、WebGL 或真实数据的结果必须在真实浏览器验证，类型检查通过不代表运行成功；
  - 监听器、覆盖物、控件、图层、服务结果、动画、全景与 `Map` 必须有明确解绑/移除/取消/销毁路径。

## 后果

- 正面：SDK、类型、官方资料与文档统一到 4.0；公共 API 不泄漏 `BMap.*`；类型检查保持严格。
- 负面/成本：迁移期同时存在旧 `types/BMapGL` 与官方声明，需要显式隔离；官方类型包升级可能引入新的声明缺口，需要维护最小 augmentation。
- 回滚：本 ADR 只冻结决策与类型底座，不回滚具体实现。若需放弃 4.0 基线，应新开 ADR 取代本文件，而不是在实现 PR 中临时改回。

## 非目标

- 不在本决策中实现 v4 Loader、Provider、Driver 或 Vue API（分别属于 M3A.1~M4）。
- 不把 Skill 或官方类型包作为运行时依赖。
- 不承诺 `jsapi-v3` engine 的支持。

## 参考

- issue #14 `[M3A.0] 冻结 JSAPI 4.0 单引擎基线并接入官方类型与 Skill`
- 追踪 issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- `@baidumap/jsapi-v4-types`：<https://www.npmjs.com/package/@baidumap/jsapi-v4-types>
- 官方 Skill：<https://skills.sh/baidu-maps/jsapi-skills/bmap-jsapi-v4>
- 官方文档：<https://lbs.baidu.com/docs/jsapi?title=jsapi4/index>
