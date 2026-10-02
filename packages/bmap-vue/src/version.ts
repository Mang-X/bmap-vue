/**
 * 组件库版本（library version）
 *
 * 仓库里同时存在三种「版本」（见 ADR 2026-09-10-jsapi-v4-only-baseline）：
 * - **组件库版本**：本文件的 `LIBRARY_VERSION`（= `package.json` 的 `version`）；
 * - **SDK engine**：内部驱动枚举，仅有 `jsapi-v4`（旧引擎已在 #26 删除）；
 * - **SDK version**：百度地图 JSAPI 运行时版本（来自 Provider 的结构化加载结果）。
 *
 * `BMapClient.libraryVersion` 报告这里的值，`BMapClient.sdkVersion` 报告 SDK 运行时版本，
 * 两者不得互相替代。`version.test.ts` 直接读 `package.json` 做一致性断言，防止漂移。
 */
declare const __VERSION__: string
declare const __PKG_NAME__: string

export const LIBRARY_VERSION = __VERSION__

/**
 * 本库的 npm 包名（构建期从 `package.json#name` 注入）。
 *
 * 用途只有一个：`BMapResolver` 返回的组件 `from`。它必须是**真值**而不是写死的字符串——
 * unplugin-vue-components 会把那句话原样写进用户的源码，写错了用户就要手工改。
 * 而 `bmap-vue` 这个无 scope 名在 npm 上属于另一位作者，写死它不会「找不到包」，
 * 会**解析到错误的项目**（1.0 迁到 `@mangax/bmap-vue` 时踩到，见 #45 评审 P1）。
 *
 * 构建期注入而非运行时读 `package.json`：本文件会被打进浏览器 bundle，运行时没有
 * `node:fs`，也没有可靠的「我被装在哪个包里」的信息。
 */
export const LIBRARY_PACKAGE_NAME = __PKG_NAME__
