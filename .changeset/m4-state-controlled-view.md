---
"baidu-map-gl-vue": minor
---

`<BMap>` 的 `center` / `zoom` / `heading` / `tilt` 改为受控 / 非受控双模，并支持 `v-model:center` 等多 model 绑定。

**三种来源**，优先级固定为「受控值 > `default*` 初值 > 库默认视野」：

- **受控**（传了该字段）：外部值变化写 SDK；用户拖拽 / 缩放 / 旋转 / 倾斜（`moveend` / `zoomend` / `headingchange` / `tiltchange`）回写内部状态并 emit `update:center` / `update:zoom` / `update:heading` / `update:tilt`。
- **非受控**（只传 `defaultCenter` / `defaultZoom` / `defaultHeading` / `defaultTilt`）：初值只在**首次创建视野**时生效，之后的变化不会覆盖当前状态（dev 期告警一次）。
- **缺省**（都不传）：与之前一致（`center` 北京、`zoom` 14、`heading` / `tilt` 0），初始化仍然只做一次 `centerAndZoom`。

配套变化：

- **SDK 就绪之前到达的受控值不再丢失**：`runtime.mount()` 返回后、`ready` / `initd` 之前会把
  **当前生效值**（受控时外部值、非受控时内部状态）收敛一次（走字段级命令，不重跑 `centerAndZoom`），
  因此 `:center="loaded ? spot : undefined"` 这类「异步数据到达后才开始受控」的写法是安全的，
  加载途中在受控与非受控之间切换过也不会让地图与状态分叉。
- 受控写入前会**读回地图当前值**做容差判等，因此「父级回写同一值」「相同值不同引用」「SDK 读回 ±1e-9 抖动」都不再产生多余的 SDK 命令；容差为 `center` 1e-7 度、`zoom` 1e-6、`heading` / `tilt` 0.01 度。
- `heading` 按 **360 环绕**判等：`-90` 与 `270` 是同一朝向（v4 的 `getHeading()` 返回带符号角），不会再为此产生假的 `update:heading`。
- 后续 `center` 变化仍然只走 `setCenter`（不重跑 `centerAndZoom`，因此不会重置 `zoom`）。
- **`resetView()` 同时重置四个状态**：重置之后再拖回「重置前的那个值」仍然会正常 emit（此前非受控档会因为内部状态没跟着重置而把那次真实操作判成「没变化」）。顺带冻结语义：重置之后「受控 → 非受控」接管的是**重置值**，地图不会被拉回重置前的位置。
- SDK 就绪时的视野收敛统一为**一条路径**：每个字段至多下发一条命令（字符串形态的 `center` 此前会被写两次；`center="北京市"` 且未变过时不再多出一条 `setCenter`）。
- 受控 / 非受控模式切换会给出明确告警（每字段每方向一次），但**不拒绝**；非受控 → 受控且外部值与内部状态冲突时告警，受控 → 非受控时内部状态接管并保留最后一次外部值。`default*` 的**任何**后续写入（含从无到有 / 从有到无）也都会告警一次。告警只在**非生产环境**输出：判定读 `process.env.NODE_ENV`，**留给消费方的打包器 / 运行时**折叠，因此在你的 dev server 里能看到、生产构建里会被消除（`<script>` 直引的 `index.global.js` 固定按生产处理）。
- `<BMap>` 对传入的 `center` / `defaultCenter` **做防御性拷贝**：父级原地修改自己的点对象不会污染内部状态、`default*` 初值与 `resetView()` 的首次快照（请仍按 Vue 常规语义「换引用」更新 props）。
- 新增公开 composable `useControllableState`（`<BMap>` 内部用的就是它的三态规则），可复用于业务侧自建受控字段；传可变对象时用 `copy` 选项声明拷贝方式。
- **破坏性变更：无。** 只订阅视野的**结束**事件（不订阅 `moving` / `zooming`），既有事件与 props 语义保持不变。
