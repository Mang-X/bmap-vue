---
"baidu-map-gl-vue": minor
---

`<BMap>` 的 `center` / `zoom` / `heading` / `tilt` 改为受控 / 非受控双模，并支持 `v-model:center` 等多 model 绑定。

**三种来源**，优先级固定为「受控值 > `default*` 初值 > 库默认视野」：

- **受控**（传了该字段）：外部值变化写 SDK；用户拖拽 / 缩放 / 旋转 / 倾斜（`moveend` / `zoomend` / `headingchange` / `tiltchange`）回写内部状态并 emit `update:center` / `update:zoom` / `update:heading` / `update:tilt`。
- **非受控**（只传 `defaultCenter` / `defaultZoom` / `defaultHeading` / `defaultTilt`）：初值只在**首次创建视野**时生效，之后的变化不会覆盖当前状态（dev 期告警一次）。
- **缺省**（都不传）：与之前一致（`center` 北京、`zoom` 14、`heading` / `tilt` 0），初始化仍然只做一次 `centerAndZoom`。

配套变化：

- 受控写入前会**读回地图当前值**做容差判等，因此「父级回写同一值」「相同值不同引用」「SDK 读回 ±1e-9 抖动」都不再产生多余的 SDK 命令；容差为 `center` 1e-7 度、`zoom` 1e-6、`heading` / `tilt` 0.01 度。
- `heading` 按 **360 环绕**判等：`-90` 与 `270` 是同一朝向（v4 的 `getHeading()` 返回带符号角），不会再为此产生假的 `update:heading`。
- 后续 `center` 变化仍然只走 `setCenter`（不重跑 `centerAndZoom`，因此不会重置 `zoom`）。
- 受控 / 非受控模式切换会给出明确告警（每字段每方向一次），但**不拒绝**；非受控 → 受控且外部值与内部状态冲突时告警，受控 → 非受控时内部状态接管并保留最后一次外部值。
- 新增公开 composable `useControllableState`（`<BMap>` 内部用的就是它的三态规则），可复用于业务侧自建受控字段。
- **破坏性变更：无。** 只订阅视野的**结束**事件（不订阅 `moving` / `zooming`），既有事件与 props 语义保持不变。
