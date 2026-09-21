/**
 * Fake BMap v4 全景替身（M3A2-SERVICES-NATIVE / issue #23；#41 补齐组件路径的成员）
 *
 * 覆盖面只到「Panorama Facet 会调用 + 契约会断言」的成员：查看器的生命周期与视角、
 * 数据检索的重载（`getPanoramaById` / `getPanoramaByLocation(point)` /
 * `getPanoramaByLocation(point, radius)`），以及 #41 新增的读取面、场景切换、配置写回、
 * 滚轮缩放与标注（`PanoramaLabel`）。
 *
 * 三条刻意建模的边界：
 * - **重载必须可区分**：`getPanoramaByLocation` 有「带半径」与「不带半径」两种调用，
 *   Fake 把实参个数记进 `callLog`，否则「省略半径」与「传 undefined」这两种写法在测试里
 *   长得一样——而真实 SDK 上它们是不同的重载。
 * - **`destroy()` 重复调用不保证安全**：Fake 记录调用次数但不做幂等，让「Driver 自己记账」
 *   这条设计可断言（重复 `destroy(viewer)` 时 SDK 侧计数必须仍是 1）。
 * - **场景未加载时可以区分**：`id` / `position` 初始为空。真实 4.0 在**未加载场景**的实例上
 *   `destroy()` 会抛错（见 ADR 的 smoke 记录），这条由 `failNextDestroy` 注入而不是默认行为——
 *   默认抛错会让「组件正常销毁」的用例全都需要额外说明。
 */
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4EventTarget } from './event-target.ts'
import { FakeV4CallbackQueue } from './services.ts'
import { FakeV4Point } from './geometry.ts'

/** 官方 `PanoramaPOIType` 的取值集合：`setPanoramaPOIType` 用它做入参校验（真实 SDK 同样只认这几个）。 */
const POI_TYPES = ['hotel', 'catering', 'movie', 'transit', 'indoor_scene', 'none'] as const

export class FakeV4Panorama extends FakeV4EventTarget {
  readonly callLog: string[] = []
  readonly container: string | HTMLElement
  options: Record<string, unknown>
  visible = true
  zoom = 1
  pov: Record<string, unknown> = { heading: 0, pitch: 0 }
  position: { lng: number; lat: number } | null = null
  /** 当前场景 id；空表示**尚未加载任何场景**（真实 4.0 上这种实例 destroy 会抛错）。 */
  id: string | null = null
  sceneType: 'street' | 'inter' = 'street'
  poiType: string | null = null
  scrollWheelZoom = false
  destroyCalls = 0
  overlays: unknown[] = []
  /**
   * 测试故障注入：让**下一次** `destroy` 抛错。
   *
   * 真实 4.0 在**未加载场景**的实例上 `destroy()` 会抛
   * `TypeError: Cannot read properties of undefined (reading 'START')`（见 ADR 的 smoke 记录），
   * Fake 把这条故障路径建模出来，才能断言「失败不记账、可以重试」。
   */
  failNextDestroy: Error | null = null
  /** 测试重入：`destroy()` 一进来就调用（业务可能在销毁回调里再次 destroy 同一个实例）。 */
  onDestroy: (() => void) | null = null

  constructor(
    container: string | HTMLElement,
    options: Record<string, unknown> = {},
    stats: FakeV4Diagnostics,
  ) {
    super(stats)
    this.container = container
    // **拷一份**：真实 4.0 在构造期把选项读进内部状态，父级之后改自己那份对象不会影响查看器。
    // 直接持有调用方的引用会让 Fake 比真实「宽容」——「组件有没有把新值重新下发」这件事就永远
    // 观察不到（#95 评审第 2 轮的原地修改变体正是在这里被藏住的）。
    this.options = { ...options }
    this.stats.resourceCreated('panorama', this)
  }

  // -------------------------------------------------------------- 读取面
  getPosition(): { lng: number; lat: number } | null {
    return this.position
  }

  getPov(): Record<string, unknown> {
    return this.pov
  }

  getZoom(): number {
    return this.zoom
  }

  getId(): string | null {
    return this.id
  }

  getSceneType(): 'street' | 'inter' {
    return this.sceneType
  }

  getVisible(): boolean {
    return this.visible
  }

  // -------------------------------------------------------------- 写入面
  setId(id: string, options?: unknown): void {
    this.callLog.push(`setId:${id}`)
    this.id = id
    void options
    // 官方在切换 id 后会派发 `id_changed`，且它的载荷**是一个字符串**（见
    // `src/driver/types/panorama.ts` 的注释），而本替身的 `emit` 只建模对象载荷
    // （对象会被展开成事件字段）。这里按现状转发并显式标注这个**建模缺口**：
    // 现无消费方读取该载荷（`BPanorama` 的回调是 `() => emit("idChange", getId(viewer))`），
    // 因此不去猜真实形状——要动它先取证，登记为已知缺口。
    this.emit('id_changed', id as unknown as Record<string, unknown>)
  }

  setPosition(position: { lng: number; lat: number }): void {
    this.callLog.push('setPosition')
    this.position = position
  }

  setPov(pov: Record<string, unknown>, options?: { animation?: boolean }): void {
    this.callLog.push(`setPov:${options?.animation === true ? 'animated' : 'instant'}`)
    this.pov = { ...this.pov, ...pov }
  }

  setZoom(zoom: number, options?: { noAnimation?: boolean }): void {
    this.callLog.push(`setZoom:${options?.noAnimation === true ? 'noAnimation' : 'animated'}`)
    this.zoom = zoom
  }

  setPanoramaPOIType(poiType: string): void {
    this.callLog.push(`setPanoramaPOIType:${poiType}`)
    if (!POI_TYPES.includes(poiType as (typeof POI_TYPES)[number])) {
      throw new TypeError(`不认识的 POI 类型: ${poiType}`)
    }
    this.poiType = poiType
  }

  enableScrollWheelZoom(): void {
    this.callLog.push('enableScrollWheelZoom')
    this.scrollWheelZoom = true
  }

  disableScrollWheelZoom(): void {
    this.callLog.push('disableScrollWheelZoom')
    this.scrollWheelZoom = false
  }

  show(): void {
    this.callLog.push('show')
    this.visible = true
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
  }

  setOptions(options: Record<string, unknown>): void {
    this.callLog.push('setOptions')
    this.options = { ...this.options, ...options }
  }

  // ---------------------------------------------------------- 标注覆盖物
  addOverlay(overlay: unknown): void {
    this.callLog.push('addOverlay')
    // **不做去重**：诊断把 `panoramaLabel` 归为「挂载类」（按次数销账），前提正是
    // 「SDK 不会替调用方去重、挂两次就要摘两次」。在这里去重会让计数与释放路径脱钩
    // （销账入口是 `removeOverlay`，见 diagnostics 的记账方式表）。
    this.overlays.push(overlay)
    this.stats.resourceCreated('panoramaLabel')
  }

  removeOverlay(overlay: unknown): void {
    this.callLog.push('removeOverlay')
    const index = this.overlays.indexOf(overlay)
    if (index < 0) return
    this.overlays.splice(index, 1)
    this.stats.resourceReleased('panoramaLabel')
  }

  clearOverlays(): void {
    this.callLog.push('clearOverlays')
    for (let index = this.overlays.length - 1; index >= 0; index -= 1) {
      this.stats.resourceReleased('panoramaLabel')
    }
    this.overlays = []
  }

  destroy(): void {
    this.callLog.push('destroy')
    this.onDestroy?.()
    if (this.failNextDestroy) {
      const error = this.failNextDestroy
      this.failNextDestroy = null
      throw error
    }
    this.destroyCalls += 1
    // 失败路径**不**销账：诊断因此能表达「销毁没成功、账还挂着、可以重试」。
    // 传实例：本 Fake 刻意保留「重复 destroy 每次都真的打到 SDK」的语义（`destroyCalls` 记数），
    // 诊断必须按实例去重，否则重复销毁一个实例会抵消另一个实例的泄漏（PR #66 复审 P2-1）。
    this.stats.resourceReleased('panorama', this)
  }
}

/**
 * 全景标注（官方 `BMap.PanoramaLabel`）。
 *
 * 覆盖面 = 官方 4.0.4 声明里的成员：构造参数（`content` + `PanoramaLabelOptions`）、
 * `setPosition` / `setContent` / `setAltitude`（这三个有 setter 与 getter）、`getPov`、
 * `show` / `hide`，以及 `click` 事件（`FakeV4EventTarget` 提供）。
 *
 * **刻意没有 `setDisplayDistance`**：官方声明里没有这个成员——建出来会让「构造期项」这条分类
 * 变成一句空话（M7-CONTROL-PANORAMA / #41）。
 */
export class FakeV4PanoramaLabel extends FakeV4EventTarget {
  readonly callLog: string[] = []
  content: string
  options: Record<string, unknown>
  position: { lng: number; lat: number } | null = null
  altitude: number
  visible = true

  constructor(content: string, options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(stats)
    this.content = content
    this.options = options
    const position = options.position as FakeV4Point | { lng: number; lat: number } | undefined
    this.position = position ? { lng: position.lng, lat: position.lat } : null
    this.altitude = typeof options.altitude === 'number' ? options.altitude : 2
  }

  setPosition(position: { lng: number; lat: number }): void {
    this.callLog.push('setPosition')
    this.position = position
  }

  getPosition(): { lng: number; lat: number } | null {
    return this.position
  }

  getPov(): Record<string, unknown> {
    return { heading: 0, pitch: 0 }
  }

  setContent(content: string): void {
    this.callLog.push('setContent')
    this.content = content
  }

  getContent(): string {
    return this.content
  }

  setAltitude(altitude: number): void {
    this.callLog.push('setAltitude')
    this.altitude = altitude
  }

  getAltitude(): number {
    return this.altitude
  }

  show(): void {
    this.callLog.push('show')
    this.visible = true
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
  }
}

export class FakeV4PanoramaService {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** `getPanoramaById` 的回包；`null` = 查不到 */
  byId: Record<string, unknown> | null = {
    id: 'pano-1',
    description: '天安门全景',
    position: { lng: 116.404, lat: 39.915 },
  }
  /** `getPanoramaByLocation` 的回包；`null` = 查不到 */
  byLocation: Record<string, unknown> | null = {
    id: 'pano-2',
    description: '附近全景',
    position: { lng: 116.41, lat: 39.92 },
  }

  /** `diagnostics` 省略时回包不进诊断（独立构造检索实例的场景）。 */
  constructor(diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    // 全景检索与基础服务同族：官方没有销毁入口，因此只进活动口径（不进泄漏门禁）
    diagnostics?.serviceInstanceCreated()
  }

  getPanoramaById(id: string, callback: (data: Record<string, unknown> | null) => void): void {
    this.callLog.push(`getPanoramaById:${id}`)
    const value = this.byId
    this.queue.dispatch(() => callback(value))
  }

  getPanoramaByLocation(
    point: unknown,
    radiusOrCallback: number | ((data: Record<string, unknown> | null) => void),
    maybeCallback?: (data: Record<string, unknown> | null) => void,
  ): void {
    const withRadius = typeof radiusOrCallback === 'number'
    this.callLog.push(`getPanoramaByLocation:args=${withRadius ? 3 : 2}`)
    const callback = withRadius ? maybeCallback : radiusOrCallback
    const value = this.byLocation
    this.queue.dispatch(() => callback?.(value))
  }
}
