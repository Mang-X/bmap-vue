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
export const LIBRARY_VERSION = "1.0.0-rc.0";
