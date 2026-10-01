---
"@mangax/bmap-vue": patch
---

#165 返工：把 `map.screenshot` / `map.fly-to` / `map.viewport` 从「删条目」改回「补实现」

## 背景：上一轮的 Class 5 处置过头了

Class 5 按「兑现不了的承诺就删条目」处理，把这三个能力目录条目**整条删除**了
（理由：官方声明里有，但 `MapDriver` 从不调用）。

**live 探针证伪了这个前提**（`scripts/probe-runtime-members.mts`，2026-09-26，两次独立读数）：
`Map#getScreenshot` / `#flyTo` / `#getViewport` 在**真实运行时全部存在**。
能力是我们没接，不是它没有 ⇒ 按 §3.3「不得无理由裁剪能力」，该做的是补实现。

## 补上的三个成员

| 成员 | 官方声明 | 说明 |
| --- | --- | --- |
| `getViewport(view, viewportOptions?)` | `core/Map.d.ts:508` | 投影成领域 `Viewport { center, zoom }`，**逐字段校验**，缺字段抛 `BMAP_SDK_CALL_FAILED` 而不是回半个对象。`view` 的两种形态（点数组 / `Bounds`）按 `Array.isArray` 分派 |
| `flyTo(center, zoom, options?)` | `core/Map.d.ts:634` | 新领域 `FlyToOptions`（`noAnimation` / `callback`）。**调 `flyTo` 本身**——`flyTo`（平滑飞行）与 `panTo`（瞬移）是两个成员，回归用例显式断言 SDK 日志里有 `flyTo` 且**没有** `panTo` |
| `getScreenshot()` | `core/Map.d.ts:1024` | 返回非字符串即抛错 |

三者都接到 `<Map>` 的 ref 命令面（`MapCommands`，`MapExpose` 继承），
沿用既有 `read`/`write` 约定：读在已释放时返回 `null`，驱动门在触碰 SDK 对象前抛
`BMAP_RESOURCE_DISPOSED`（**显式失败，不静默 no-op**）。

## ⚠️ `getScreenshot` 的两个前提，库这边都做不到

官方文档：「地球模式不支持。需要初始化地图配置 `preserveDrawingBuffer: true`，否则是黑屏」。

- `preserveDrawingBuffer` 在 4.0.5 声明里**只出现在这段散文里**，`MapOptions` **没有**这个键
  （实测 `grep -c preserveDrawingBuffer core/MapOptions.d.ts` = 0）。
  因此**没有**把它加进 `PASSTHROUGH_OPTION_KEYS`（那等于断言一个上游不存在的声明），
  也**没有**给 `InitialMapOptions` 加对应类型字段（那是对未验证选项的类型级主张）。
- **后果要说清楚**：`<Map>` 目前**没有任何途径**设置它（`Map.vue` 的 `mapOptions` 由固定几个
  prop 组装），所以**组件用户调 `getScreenshot()` 恒得一张纯黑图且无报错**；
  只有 `client.driver.map.create()` 这条路能开。两个前提（地球模式、`preserveDrawingBuffer`）
  运行时都探测不到，无法在命令层拦截。

⇒ 已在驱动成员、命令、目录 description 三处都写明该前提。**是否给 `<Map>` 加这个 prop、
或把该命令挂在显式 opt-in 之后，留给维护者裁决**——照现状暴露它，比不存在更隐蔽。

## 目录条目：恢复并改为诚实状态

| 条目 | 之前（Class 5） | 现在 |
| --- | --- | --- |
| `map.screenshot` | 已删除 | `native` + `runtimeOnly`，`rawMembers: ["getScreenshot"]` |
| `map.fly-to` | 已删除 | `native` + `runtimeOnly`，`rawMembers: ["flyTo"]`（此前是 `["panTo"]`，张冠李戴） |
| `map.viewport` | `rawMembers: ["setViewport"]` | `["getViewport", "setViewport"]` |

能力数 61 → 63。原先论证删除的那段注释已替换为 live 探针证据。

## 测试

`tests/behavior/capability-catalog.test.ts` 里断言「三条目**不存在**」的用例已被
**重写为断言诚实状态**（它们编码的是已被证伪的决定）。新增：`map.fly-to` 探测
`flyTo` 且不含 `panTo`；三条目均为 `native` + `runtimeOnly`；注册理由不再是
`unlisted-capability`；`map.viewport` 两个成员都探测；**并额外断言每个 `rawMembers`
条目在实现里可达**——防止目录再次退化成「兑现不了的承诺」。

## 顺带收紧

`setViewport` 的选项从 `Record<string, unknown>` 收紧为 `ViewportOptions`，
`callOptional` 改为 `callRequired`：`getViewport` 回到 `rawMembers` 后，
宽松的成员探测会让「成员缺失」静默通过门禁、然后静默 no-op。

## 附：修正一处**我**引入的回归

`tests/type-contracts/overlay-zindex.type-test.ts` 仍用 Class 1 改名前的 `path` prop
（我合并 Class 3 时只修了 `.test.ts` 兄弟，漏了这个 `type-contracts` 文件），
导致 `pnpm typecheck:type-contracts` 红。已改为 `points`。
（子代理曾把它报成「既有问题」，用 `git log --diff-filter=A` 核对后确认是本轮引入。）
