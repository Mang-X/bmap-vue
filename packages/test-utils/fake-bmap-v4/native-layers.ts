/**
 * Fake BMap v4 原生数据图层替身（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 三个族，按官方 4.0 的公开面如实分：
 *
 * - **专页批量图层**（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）：
 *   共享数据、要素状态、字段级 setter 族与 `setBaseOptions`；官方把拾取开关放在基础配置项里
 *   （`enablePicked`），因此这一族**没有** `setEnablePicked` / `hitTest`——Driver 的
 *   `supports()` 正是据此回答 `false`。
 * - **扩展 API 的点/聚合/热力**（`PointLayer` / `ClusterLayer` / `Heatmap`）：只有
 *   `setData` / `clearData` / `setOptions`（`PointLayer` 另有 `setEnablePicked` / `hitTest`），
 *   外加**从共享基类继承**的 `setVisible` / `getVisible`。
 * - **TrackLine**：只有 `setData` 与播放控制。
 *
 * ⚠️ 关于 `setVisible` 的一次更正（issue #35，2026-09-19）：本文件此前写着「刻意不提供
 * `setVisible`，因为扩展 API 其实没有这个方法」——**那句话是错的**。真实 4.0 的 `PointLayer` /
 * `ClusterLayer` 从共享基类继承了 `setVisible` / `getVisible`，探针
 * （`scripts/probe-native-point-cluster.mts`）实测 `setVisible(false)` 之后
 * `getVisible() === false`、恢复也成立；旧结论的依据只是「官方扩展 API 专页没列它」。
 * 夹具比真实更窄会**掩盖** Driver 的 `supports()` 说假话（这里恰好相反：是 `supports()`
 * 太保守，而夹具让「放开」这条改动无法被验证）。因此这一对成员现在如实建模。
 *
 * 仍然刻意不提供的（`supports()` 也回答不支持）：`setOpacity` / `setZIndex` / `setMinZoom` /
 * `setMaxZoom` / 状态 API —— 它们在真实运行时同样继承自基类，但本库按官方专页口径不把它们
 * 当契约，且当前没有消费者。**要放开必须像 `setVisible` 一样先取证**，不能只因为运行时存在。
 *
 * 所有替身都继承 `FakeV4Layer`：`FakeV4Map.addLayer/removeLayer` 的容器只认它，
 * 这也让「先摘子资源再 destroy 地图」的不变式在原生图层上同样可断言。
 */
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4Layer } from './controls-layers.ts'

/* -------------------------------------------------- 专页批量图层（声明的四类） */

/** 共享的数据 / 状态 / 层级记账：测试直接读字段就能观察「调用真的落地了」。 */
export class FakeV4NativeLayerBase extends FakeV4Layer {
  data: unknown = null
  styleOptions: Record<string, unknown> = {}
  baseOptions: Record<string, unknown> = {}
  visible = true
  opacity = 1
  zIndex = 0
  minZoom: number | null = null
  maxZoom: number | null = null
  state: Record<string, Record<string, unknown>> = {}
  drawCount = 0

  setData(data: unknown): void {
    this.callLog.push('setData')
    this.data = data
  }

  getData(): unknown {
    return this.data
  }

  clearData(): void {
    this.callLog.push('clearData')
    this.data = null
  }

  updateState(
    keys: string | number | Array<string | number>,
    params: Record<string, unknown>,
    ifAppend = false,
  ): void {
    this.callLog.push(`updateState:${ifAppend ? 'append' : 'replace'}`)
    const list = Array.isArray(keys) ? keys : [keys]
    for (const key of list) {
      const current = ifAppend ? (this.state[String(key)] ?? {}) : {}
      this.state[String(key)] = { ...current, ...params }
    }
  }

  removeState(keys: string | number | Array<string | number>): void {
    this.callLog.push('removeState')
    const list = Array.isArray(keys) ? keys : [keys]
    for (const key of list) delete this.state[String(key)]
  }

  clearState(): void {
    this.callLog.push('clearState')
    this.state = {}
  }

  setStyleOptions(options: Record<string, unknown>): void {
    this.callLog.push('setStyleOptions')
    this.styleOptions = { ...this.styleOptions, ...options }
  }

  setBaseOptions(options: Record<string, unknown>): void {
    this.callLog.push('setBaseOptions')
    this.baseOptions = { ...this.baseOptions, ...options }
  }

  /** 官方：样式更新后不会自动重绘，需要显式调用；计数让「Driver 到底调没调」可断言。 */
  doOnceDraw(): void {
    this.callLog.push('doOnceDraw')
    this.drawCount += 1
  }

  setVisible(visible: boolean): void {
    this.callLog.push('setVisible')
    this.visible = visible
  }

  getVisible(): boolean {
    return this.visible
  }

  setOpacity(opacity: number): void {
    this.callLog.push('setOpacity')
    this.opacity = Math.min(1, Math.max(0, opacity))
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  getZIndex(): number {
    return this.zIndex
  }

  setMinZoom(zoom: number): void {
    this.callLog.push('setMinZoom')
    this.minZoom = zoom
  }

  setMaxZoom(zoom: number): void {
    this.callLog.push('setMaxZoom')
    this.maxZoom = zoom
  }
}

export class FakeV4PointIconLayer extends FakeV4NativeLayerBase {
  readonly isPointIconLayer = true
}

export class FakeV4PointShapeLayer extends FakeV4NativeLayerBase {
  readonly isPointShapeLayer = true
}

export class FakeV4LineLayer extends FakeV4NativeLayerBase {
  readonly isLineLayer = true
}

export class FakeV4FillLayer extends FakeV4NativeLayerBase {
  readonly isFillLayer = true
}

/* ------------------------------------------------- 扩展 API（未声明的运行时类） */

/** 扩展 API 的公共部分：只有 `setOptions` 一族 + 数据 + 继承来的 `setVisible`。 */
export class FakeV4RuntimeLayer extends FakeV4Layer {
  data: unknown = null
  /** 继承自共享基类（真实 4.0 实测可读写，见文件头）：Driver 对 `point` / `cluster` 已放开 `setVisible`。 */
  visible = true

  constructor(options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
  }

  setData(data: unknown): void {
    this.callLog.push('setData')
    this.data = data
  }

  getData(): unknown {
    return this.data
  }

  clearData(): void {
    this.callLog.push('clearData')
    this.data = null
  }

  setOptions(options: Record<string, unknown>): void {
    this.callLog.push('setOptions')
    this.options = { ...this.options, ...options }
  }

  setVisible(visible: boolean): void {
    this.callLog.push('setVisible')
    this.visible = visible
  }

  getVisible(): boolean {
    return this.visible
  }
}

export class FakeV4PointLayer extends FakeV4RuntimeLayer {
  enablePicked = false
  /** `hitTest` 的回包；`null` = 未命中 */
  hitResult: { dataIndex: number; dataItem: unknown } | null = {
    dataIndex: 0,
    dataItem: { properties: { id: 'point-1' } },
  }

  setEnablePicked(enabled: boolean): void {
    this.callLog.push('setEnablePicked')
    this.enablePicked = enabled
  }

  hitTest(x: number, y: number): { dataIndex: number; dataItem: unknown } | null {
    this.callLog.push(`hitTest:${x},${y}`)
    return this.hitResult
  }
}

export class FakeV4ClusterLayer extends FakeV4RuntimeLayer {}

export class FakeV4Heatmap extends FakeV4RuntimeLayer {}

export class FakeV4TrackLine extends FakeV4RuntimeLayer {}
