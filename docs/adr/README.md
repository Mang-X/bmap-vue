# 架构决策记录（ADR）

本目录记录影响组件库长期形态的决策。每条 ADR 一经接受即“冻结”，后续变更应新增 ADR 取代，而不是在原文件里改写历史。

| 日期 | 标题 | 状态 |
| --- | --- | --- |
| [2026-09-10](./2026-09-10-jsapi-v4-only-baseline.md) | 冻结 JSAPI 4.0 单引擎基线 | Accepted |
| [2026-09-10](./2026-09-10-bmap-raw-sdk-boundary.md) | BMap / raw SDK / 公共声明边界与 Capability Catalog | Accepted |
| [2026-09-10](./2026-09-10-sdk-conflict-domain.md) | 进程级 SDK 冲突域与迁移期分阶段域划分 | Accepted |
| [2026-09-11](./2026-09-11-loaded-sdk-client-boundary.md) | LoadedSdk 客户端收口与迁移期 Driver 分派 | Accepted |
| [2026-09-11](./2026-09-11-jsapi-v4-driver-foundation.md) | v4 Driver 基础边界（Namespace / Handle Registry / Geometry / Event） | Accepted |
| [2026-09-11](./2026-09-11-jsapi-v4-map-facet.md) | v4 Map Facet（构造选项映射 / 初次视野 / 交互开关 / 释放语义） | Accepted |
| [2026-09-11](./2026-09-11-jsapi-v4-overlay-facet.md) | v4 Overlay Facet（覆盖物构造 / mutable-recreate 分类 / InfoWindow 与 Target） | Accepted |
| [2026-09-11](./2026-09-11-jsapi-v4-control-layer-facets.md) | v4 Control / Layer Facet（停靠常量表 / option 更新分类 / 统一 addLayer 与 Target） | Accepted |
| [2026-09-12](./2026-09-12-jsapi-v4-service-panorama-native-layers.md) | v4 Service / Panorama / Native Layer Facet（归一化服务调用 / 运行时注入探测 / 装配收口） | Accepted |
| [2026-09-12](./2026-09-12-fake-v4-diagnostics-and-dual-driver-matrix.md) | Fake v4 诊断口径与迁移期双 Driver 矩阵（诊断门禁 / 领域结果比对） | Accepted |
| [2026-09-13](./2026-09-13-upstream-types-case-patch.md) | 上游类型包大小写引用缺陷的补丁处置（精确版本 + pnpm patch / 重新纳入 CI） | Accepted |

## 约定

- 文件命名：`YYYY-MM-DD-<slug>.md`，日期为决策落盘日；同日多条用 `<slug>` 区分。
- 必须包含：背景、决策、后果（含回滚）、非目标、参考。
- 涉及 SDK 基线、公共 API 契约、包发布策略的改动必须先有 ADR。
