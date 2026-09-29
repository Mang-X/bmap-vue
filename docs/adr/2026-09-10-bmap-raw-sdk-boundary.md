# ADR 2026-09-10：BMap / raw SDK / 公共声明边界与 Capability Catalog

- 状态：已接受（Accepted）
- 日期：2026-09-10
- 计划键：`M3A0-BOUNDARY`（issue #15，追踪 #12）
- 取代：无
- 相关：[`2026-09-10-jsapi-v4-only-baseline`](./2026-09-10-jsapi-v4-only-baseline.md)

> **已随 4.0.5 变化（2026-09-24，issue #165）**：本 ADR 的决策**全部保持原样**，但两处事实陈述
> 需要按 4.0.5 重读：
>
> - 决策 3 的类型包版本现在是 **`4.0.5`**（git 依赖钉住 commit `5ba67f4`），不再是 `4.0.4`。
> - 决策 4「不把所有运行时扩展 API 一次性补入 augmentation」举例的 `PointCollection` / `Marker3D`
>   **在 4.0.5 里仍然没有声明**（全包 `grep` 零命中），因此该决策的例子仍然成立、口径不变。
>   另需注意 4.0.5 **新增**了 `visualization/` 命名空间（13 个类），它们既不需要 augmentation
>   （官方已提供声明），也不因为「有声明」就意味着运行时已加载。

## 背景

ADR 2026-09-10 已冻结「v3 Stable 只支持 JSAPI 4.0（`v=4.0`，全局 `BMap`）」，并接入官方类型包
`@baidumap/jsapi-v4-types@4.0.4`。但边界仍靠文字约定，缺少可执行门禁：

- 既有 `check-raw-sdk` 只识别 `BMapGL`，无法拦截 `window.BMap`、`new BMap.*` 与 `BMap.*` 类型；
- 没有任何门禁校验**发布产物**的 `.d.ts` 是否泄漏官方命名空间；
- 官方声明缺口的补丁缺少「上游版本 / 运行时依据 / 删除条件」治理模板；
- Capability 清单无法表达 `native` / `extended` / `experimental` / `unsupported`，也无法生成能力矩阵。

## 决策

1. **边界配置单一事实源**：`scripts/raw-sdk-boundary.mts`（命名空间、全局对象、禁区目录、白名单、官方类型包、glob 匹配）。
2. **检测引擎单一实现**：`scripts/raw-sdk-detector.mts` 供源码门禁与公共声明门禁共用，避免两套规则漂移。
3. **raw SDK 目录白名单**（相对 `packages/baidu-map-gl-vue/src`）：`driver/**`、`client/**`、`core/loader/**`、`plugins/**`；
   `packages/test-utils` 作为 Fake 边界位于扫描范围之外。其余目录为禁区。
4. **`check-raw-sdk` 双层模式**：
   - 默认扫描禁区目录（`components` / `composables` / `core/runtime`）；
   - `--src` 以白名单扫描整棵源码树；
   - 新增 `--print-boundary` 输出机器可读配置。
5. **新增公共声明门禁** `scripts/check-public-dts.mts`：扫描 `dist/**/*.d.ts`，禁止
   `namespace BMap(BMapGL)`、`declare global`、`BMap.*` 引用、`BMapGL`、官方类型包具名导入与三斜线引用，
   并禁止类型边界文件（`driver/jsapi-v4/**`）进入发布产物。
6. **augmentation 治理目录**：`src/driver/jsapi-v4/augmentations/`，每个 `.d.ts` 必须带
   `@augmentation` / `@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` / `@owner` 元数据；
   只补类型、禁止 `any`、禁止声明运行时值；`types-reference.d.ts` 退化为纯三斜线引用的入口。
7. **Capability Catalog 语义化**：`src/driver/capability/catalog.ts` 按
   `<family>.<capability>` 命名，family 覆盖 Map / Overlay / Layer / Service / Panorama / Runtime；
   增加 `status` 与 `runtimeOnly`；`status: "unsupported"` 的条目 `supports()` 恒为 `false`（用户 override 除外）。
8. **能力矩阵由数据生成**：`scripts/generate-capability-matrix.mts` 生成
   `docs/zh-CN/contributing/capability-matrix.md` 与 `docs/.vitepress/capability-catalog.json`，CI 用 `--check` 校验漂移。
9. **CI 门禁**：`.github/workflows/quality.yml` 的两个 job 都执行 raw SDK 双层扫描；构建后执行公共声明门禁；
   manifest 检查旁增加能力矩阵漂移检查。

## 后果

- 正面：边界从「文字约定」变成「可执行门禁」；公共声明不再泄漏官方命名空间，基础消费者无需安装官方类型包；
  augmentation 有明确的上游版本依据与删除条件；能力清单可机器读取并自动生成文档。
- 负面/成本：白名单需要按目录与用途持续审查——过宽会让 Driver 抽象失效，过窄会妨碍测试；
  公共声明门禁必须排在构建之后；新增能力必须同时更新 Catalog 并重跑矩阵生成。
- 回滚：门禁脚本可单独禁用，但**不应**通过放宽白名单解决告警。若需改变基线，应新开 ADR 取代本文件。

## 非目标

- 不实现具体 v4 Facet（属于 M3A.1~M3A.2）。
- 不让消费方必须安装官方类型包才能使用基础 API。
- 不把所有运行时扩展 API 一次性补入 augmentation（例如官方 4.0.4 未声明的 `PointCollection` / `Marker3D` 只做能力标注，不补类型）。

## 参考

- issue #15 `[M3A.0] 建立 BMap/raw SDK/公共声明边界与 Capability Catalog`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- `scripts/raw-sdk-boundary.mts`、`scripts/raw-sdk-detector.mts`
- `scripts/check-raw-sdk.mts`、`scripts/check-public-dts.mts`、`scripts/generate-capability-matrix.mts`
- `packages/baidu-map-gl-vue/src/driver/jsapi-v4/augmentations/README.md`
- `packages/baidu-map-gl-vue/src/driver/capability/catalog.ts`
- 官方类型包：<https://www.npmjs.com/package/@baidumap/jsapi-v4-types>
