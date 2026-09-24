---
"bmap-vue": minor
---

插件迁移结论定型与 `./advanced` 冻结（#43 / M8-ADAPTERS-ADVANCED）。

**为什么做这件事**：`#25` 留下的插件结论表只到「`no-declaration-gap` ≠ 兼容」这一步，
读者读完仍然不知道**该用什么**；而 `./advanced` 与 `./core` 谁是「承诺维护的扩展契约」从没被写下来过。
本票按 `#43` 的开工前范围纠正（先判定、再适配）只交付**结论 + 边界 + 证据**，不写适配层。

**破坏性变更（插件结论表）**

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `PluginVerdict` 取值 | `incompatible` / `no-declaration-gap` / `undetermined` | 五值：`native` / `compatible` / `adapter` / `incompatible` / `unverified`（`PLUGIN_VERDICT_MEANING` 同步；`PLUGIN_VERDICTS` 是新导出） |
| 每条结论 | 只有 `verdict` 与 `summary` | 新增 `migrationPath`（`kind` = `native` / `plugin` / `none` + `target` + 说明；`native` 还要给出真实存在的组件名，由门禁对照 manifest 核对） |
| 版本 | 只记 URL | 新增 `versionLock`（三个 `BMapGLLib/*` URL **没有版本号**）与 `artifactDigest`（`sha256`，`probe:plugin-compat` 每次核对，变了就红） |
| 运行时读数 | `{ status, detail }` | `{ status, detail, covered[], uncovered[] }`——「已验证」有明确范围，没覆盖的也写出来 |

四个内置插件的**实际结论**（细节与依据见[插件兼容 inventory](../docs/zh-CN/contributing/plugin-compat-inventory.md)）：

| 插件 | 结论 | 迁移路径 |
| --- | --- | --- |
| `TrackAnimation` | `native` | 改用原生 `<BTrackLineLayer>`（播放命令面见 #110）；本库不再为它提供封装 |
| `DrawingManager` | `compatible` | 无原生替代，按官方文档直接用（本库只加载脚本）；真实 4.0 上已用真实指针序列画出多边形 |
| `GeoUtils` | `compatible` | 纯谓词集合，按官方文档直接用 |
| `Mapvgl` | `incompatible` | 无迁移路径：依赖 `_rd` 私有回调表，且要挂 `getPanes().mapPane`（4.0 没有）；改用原生图层 |

（`adapter` 是合法取值但**当前无条目**，这条由门禁显式断言下来：要新增必须同时给出消费者与落点。）

**新增的公共面**：`PLUGIN_VERDICTS`、类型 `PluginMigrationPath` / `PluginRuntimeReading` / `PluginVersionLock`；
`./advanced` 的导出**没有变化**，只是从此被门禁钉住（内部实现不得进入扩展契约）。

**行为不变但口径写清的**：

- `./core` 是**内部实现面**（Provider 家族在那里，但本库不承诺它的稳定性）；第三方扩展走 `./advanced`。
- 可选插件的运行时结论现在**单独**在 nightly 核对（新 job `plugin-runtime`），与必需 smoke 完全分离；
  同时修正判定规则：**已登记的 `threw` 是结论、不算 fail**（MapVGL 就是这种情况），
  只有未登记过期望值的 `threw` 才退 1（原因与取舍见 ADR `2026-09-21-plugin-verdicts-and-advanced-freeze`）。
