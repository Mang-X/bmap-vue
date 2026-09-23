---
"baidu-map-gl-vue": minor
---

`BTrackLineLayer` 的播放命令面、进度观察与页面可见性联动（#110）。

**为什么做这件事**：M6（#36）交付的 `BTrackLineLayer` 只有 `data` / `visible` 基线——播放控制与页面
可见性被刻意切出去，因为官方类型包**没有** `TrackLine` 类声明，方法名必须先由真实运行时探针取证
（2026-09-19 的范围纠正）。#110 的 live 探针（`scripts/probe-track-line.mts`，2026-09-23，exit 0）
取证了七个方法、`progress` / `statuschange` 载荷形状、以及「SDK 不会在页面 hidden 时自行暂停」。

**新增的组件面**：

| 面 | 说明 |
| --- | --- |
| `ref.playback` | 六条命令：`start` / `pause` / `resume` / `stop` / `setSpeed` / `setProcess`。参数在 SDK 调用**之前**校验（`BMAP_INVALID_ARGUMENT`）；未就绪告警一次并跳过（不排队） |
| `ref.observed` | 事件派生的只读读数（`process` / `elapsed` / `distance` / `point` / `angle` + `status` / `statusName`）。**不是**内部播放状态机 |
| `@progress` / `@statuschange` | 与 `observed` 同源的组件事件 |
| `pauseOnHidden`（prop，默认 `false`） | 页面 hidden 时的可见性策略：**默认只停本库自己的观察**（SDK 继续播，探针实测）；opt-in 才自动 pause/resume，且只对**已送达 start/resume 且 handle 匹配**的实例（not-ready/抛错不留意图；stop/idle/跨代不被反向启动）；prop 变化按当前 `visibilityState` 立即收敛（hidden 中 opt-out 会 resume 本库造成的 pause） |

**驱动层**：`NativeLayerDriver` 增加六条归一化方法（与 Fake v4 的 `FakeV4TrackLine` 一一对应）；
`NativeLayerOperation` 相应扩充 `track-line` 的登记操作。

**公开类型新增**：`BTrackLineObserved`、`BTrackLineLayerExpose`；`BTrackLineLayerProps` 增加
`pauseOnHidden`。

**刻意不做的**：

- 不建内部播放状态机（镜像 SDK 是 #110 的非目标）；
- 不碰旧的 `BMapGLLib.TrackAnimation` 私有面；
- 默认策略**不**自动 pause/resume——那是 opt-in，不是基础默认。

**取数依据**：`scripts/probe-track-line.mts` + `tests/behavior/fixtures/probe-track-line.live.json`
（exit 0，方法名与事件键均来自真实 4.0 读数）；组件行为由 `tests/behavior/v3-native-data-layers.test.ts`
的 §5 钉住（默认可见性、opt-in、用户意图优先）。
