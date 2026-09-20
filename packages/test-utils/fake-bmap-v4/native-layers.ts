/**
 * Fake BMap v4 原生数据图层替身（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 三个族，按官方 4.0 的公开面如实分：
 *
 * - **专页批量图层**（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）：
 *   共享数据、要素状态（`updateState` / `removeState` / `clearState` / `replaceAllState` /
 *   `getAllState`）、字段级 setter 族与 `setBaseOptions`；官方把拾取开关放在基础配置项里
 *   （`enablePicked`），因此这一族**没有** `setEnablePicked` / `hitTest`——Driver 的
 *   `supports()` 正是据此回答 `false`。
 * - **扩展 API 的点/聚合/热力**（`PointLayer` / `ClusterLayer` / `Heatmap`）：只有
 *   `setData` / `clearData` / `setOptions`（`PointLayer` 另有 `setEnablePicked` / `hitTest`）。
 * - **TrackLine**：只有 `setData` 与播放控制。
 *
 * 刻意不提供「扩展 API 其实没有的方法」（如 `setVisible` / `updateState`）：如果 Fake 慷慨地
 * 全给上，`supports()` 的断言就会变成空转——而「静默 no-op」正是本 Facet 要挡掉的东西。
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

  /**
   * ⚠️ **这里刻意没有 `clearData`。**
   *
   * 四类专页图层（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）在官方声明里
   * **只有** `setData` / `getData`（仓库内官方参考 `visualization-layers.md` 的清理清单也是
   * 「解绑事件 → `map.removeLayer`」）。替身**不得比真实契约宽容**：一旦这里补上 `clearData`，
   * 驱动表里那条不存在的 capability 就会被 CI 测绿（#106 评审的 P1 正是这么发生的），
   * 而真实运行时会报 `BMAP_SDK_CALL_FAILED`。扩展 API 那一族（`FakeV4RuntimeLayer`）保留
   * `clearData`，因为官方扩展 API 参考明确列出了它。
   */
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

  /**
   * 全量替换（官方 `replaceAllState(inputs)`）。
   *
   * 语义上等于 `clearState + 一次性写入`：**不是**合并——旧状态里没被覆盖到的 id 必须消失，
   * 否则「先清空再写」与「直接替换」两种调用方式在夹具上无法区分。
   */
  replaceAllState(inputs: Record<string, Record<string, unknown>>): void {
    this.callLog.push('replaceAllState')
    const next: Record<string, Record<string, unknown>> = {}
    for (const [key, state] of Object.entries(inputs)) next[key] = { ...state }
    this.state = next
  }

  /** 公开读回（官方 `getAllState()`）：返回快照，不是内部引用。 */
  getAllState(): Record<string, Record<string, unknown>> {
    this.callLog.push('getAllState')
    const snapshot: Record<string, Record<string, unknown>> = {}
    for (const [key, state] of Object.entries(this.state)) snapshot[key] = { ...state }
    return snapshot
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

/** 扩展 API 的公共部分：只有 `setOptions` 一族 + 数据。 */
export class FakeV4RuntimeLayer extends FakeV4Layer {
  data: unknown = null

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
