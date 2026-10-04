/// <reference types="@baidumap/jsapi-v4-types" />
/// <reference path="./augmentations/bmap-4.0.4-gaps.d.ts" />

/**
 * JSAPI 4.0 官方类型接入边界（M3A.0 / issue #14；边界治理 issue #15）
 *
 * 约定：
 * 1. 本仓库只通过 `v=4.0` 加载器得到全局 `BMap` 命名空间，不具名导入
 *    `@baidumap/jsapi-v4-types`（该包是纯 `.d.ts`，没有运行时导出）。
 * 2. `BMap.*` 类型只允许出现在 v4 Driver/Provider、Fake SDK、本文件与
 *    `./augmentations/**` 的最小 augmentation；组件、composable、runtime 只能依赖
 *    项目领域类型与 Facet Driver 契约。
 * 3. 官方类型未覆盖的运行时成员，集中在 `./augmentations/` 做最小 augmentation，
 *    每个文件必须带 `@upstream` / `@upstreamVersion` / `@runtimeBasis` /
 *    `@deletionCondition` 元数据（治理规则见 `./augmentations/README.md`）；
 *    升级类型包后重新核对并删除已被官方覆盖的声明；禁止 `any` 或复制整套声明。
 * 4. 类型包只参与类型检查与声明生成，不进入运行时 bundle，也不是运行时依赖。
 *
 * 版本锁定：`@baidumap/jsapi-v4-types` 以精确版本声明在
 * `packages/bmap-vue/package.json`，并在
 * `packages/bmap-vue/tsconfig.build.json` 的 `compilerOptions.types`
 * 中显式接入。升级类型包后需重新验证 `skipLibCheck: false`。
 *
 * 本文件刻意写成模块（含 `export {}`）：它必须参与类型检查与声明 emit；
 * augmentation 会被声明打包器内联进公共 `dist/*.d.ts`，因此由构建配置在声明
 * 写入阶段剔除（保留编译输入、过滤发布产物），避免向消费者泄漏 `BMap.*`。
 * 发布产物由 `pnpm check:public-dts` 把关。
 *
 * 静态边界白名单（`BMap.*` 允许出现的目录）见 `scripts/raw-sdk-boundary.mts`。
 */

export {};
