/**
 * Fake BMap v4 运行对象（Overlay）
 *
 * 覆盖面刻意只到「Overlay Facet 会调用 + Capability Registry 会探测」的成员：setter 与
 * `show/hide/isOpen` 一类的状态入口，**不补 getter 家族**（Facet 不读它们），避免 Fake 先于
 * 实现膨胀（同 `FakeMap` 的口径）。
 *
 * 例外是**构造选项**：官方语义里 `new Marker(pt, { rotation })` 会立刻生效，因此构造器把
 * 官方 `*Options` 里被建模的那几项落进实例字段（否则「初始 rotation / draggable / zIndex」
 * 这类只能经构造期设置的属性在夹具上读不到，组件少传一项也测不出来——夹具比真实宽容会掩盖缺陷）。
 *
 * 也不复刻 SDK 的隐式行为：覆盖物只记录「传进去了什么」与「哪个 setter 被调用」，不实现真实绘制、
 * 坐标系回转与默认主题色。真实数值行为由 M3A.3（#25）的浏览器 smoke 验证。
 *
 * 事件：全部继承 `FakeV4EventTarget`，因此 `show/hide` 造成的可见性变化、`remove` 等事件由测试
 * 自行 `emit`（真实 SDK 由渲染链派发），与 `fake-bmapgl` 口径一致。
 */
import { FakeV4EventTarget } from './event-target.ts'
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4Bounds, FakeV4Point, FakeV4Size } from './geometry.ts'
import type { FakeV4Map } from './FakeMap.ts'

/** 覆盖物基类：可见性、归属与监听器统计。 */
export class FakeV4Overlay extends FakeV4EventTarget {
  options: Record<string, unknown>
  readonly callLog: string[] = []
  visible = true
  /** 由 `FakeV4Map.addOverlay` 写入；`removeOverlay` 时按实例清除。 */
  attachedMap: FakeV4Map | null = null
  /**
   * 注入一次 `show()` / `hide()` 失败（**写之前**抛，状态不变）。
   *
   * 口径同 `FakeV4Map.failNextRemoveLayer`：显隐是「宿主**逐资源**写入」的循环，一次失败会留下
   * 「部分已对齐、部分没对齐」的状态 —— 那种状态只有在夹具能注入失败时才可断言。
   */
  failNextShow: Error | null = null
  failNextHide: Error | null = null
  /**
   * 注入一次「**先从图上摘掉、再抛错**」的覆盖物移除（与 `FakeV4Map.failNextRemoveOverlay`
   * 的「摘之前抛」是两条不同的状态机路径，必须分开建模 —— 理由同
   * `FakeV4Map.failNextRemoveLayerAfterDetach`：调用方唯一能观测的「还在不在」证据就是调用
   * 有没有成功返回，这条路径下覆盖物已经摘掉而调用方收到的是异常）。
   *
   * ⚠️ 由宿主（`FakeV4Map.removeOverlay`）驱动，而不是覆盖物自己的方法。
   */
  failNextRemoveAfterDetach: Error | null = null

  constructor(options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(stats)
    this.options = options
  }

  /** 官方 `Overlay#show/hide`：所有内置覆盖物都继承，是 `OverlayDriver.show/hide` 的落点。 */
  show(): void {
    this.callLog.push('show')
    if (this.failNextShow) {
      const error = this.failNextShow
      this.failNextShow = null
      throw error
    }
    this.visible = true
    this.emit('show')
  }

  hide(): void {
    this.callLog.push('hide')
    if (this.failNextHide) {
      const error = this.failNextHide
      this.failNextHide = null
      throw error
    }
    this.visible = false
    this.emit('hide')
  }
}

/**
 * 官方图形类（Polyline / Polygon / Rectangle / Circle / BezierCurve）共用的样式与开关 setter。
 *
 * Fake 刻意**不逐类剔除官方未发布的 setter**（例如 Polyline 没有 fill、Prism / BezierCurve 没有
 * 编辑能力）：哪些键允许走哪条路径由 `OVERLAY_DESCRIPTORS` 决定，那是 Driver 侧的权威；
 * Fake 只负责让「被调用的 setter」可观察。
 */
class FakeV4Shape extends FakeV4Overlay {
  strokeColor = ''
  strokeWeight = 0
  strokeOpacity = 1
  strokeStyle = 'solid'
  fillColor = ''
  fillOpacity = 1
  zIndex: number | null = null
  editing = false
  massClear = true

  /**
   * 构造选项落进实例字段（与 `FakeV4Marker` 同一手法，见文件头）。
   *
   * 没有它，**读回**（#165 Class 3 的 `getStrokeColor()` / `getFillColor()` …）会永远返回
   * 字段初值而不是「用户传进来的那个值」——于是「组件把 prop 交给了 SDK」与「SDK 读回了
   * 用户给的值」这两件事在替身上会分叉。夹具比真实宽容就会掩盖缺陷。
   */
  constructor(options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    if (typeof options.strokeColor === 'string') this.strokeColor = options.strokeColor
    if (typeof options.strokeWeight === 'number') this.strokeWeight = options.strokeWeight
    if (typeof options.strokeOpacity === 'number') this.strokeOpacity = options.strokeOpacity
    if (typeof options.strokeStyle === 'string') this.strokeStyle = options.strokeStyle
    if (typeof options.fillColor === 'string') this.fillColor = options.fillColor
    if (typeof options.fillOpacity === 'number') this.fillOpacity = options.fillOpacity
    if (typeof options.zIndex === 'number') this.zIndex = options.zIndex
    if (options.enableEditing === true) this.editing = true
    if (options.enableMassClear === false) this.massClear = false
  }

  setStrokeColor(color: string): void {
    this.callLog.push('setStrokeColor')
    this.strokeColor = color
  }

  setStrokeWeight(weight: number): void {
    this.callLog.push('setStrokeWeight')
    this.strokeWeight = weight
  }

  setStrokeOpacity(opacity: number): void {
    this.callLog.push('setStrokeOpacity')
    this.strokeOpacity = opacity
  }

  setStrokeStyle(style: string): void {
    this.callLog.push('setStrokeStyle')
    this.strokeStyle = style
  }

  setFillColor(color: string): void {
    this.callLog.push('setFillColor')
    this.fillColor = color
  }

  setFillOpacity(opacity: number): void {
    this.callLog.push('setFillOpacity')
    this.fillOpacity = opacity
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  /** 官方图形族的描边 / 填充读回（`Circle` / `Rectangle` / `Polygon` / `Polyline` 各自声明了其中几个）。 */
  getStrokeColor(): string {
    return this.strokeColor
  }

  getStrokeWeight(): number {
    return this.strokeWeight
  }

  getStrokeOpacity(): number {
    return this.strokeOpacity
  }

  getStrokeStyle(): string {
    return this.strokeStyle
  }

  getFillColor(): string {
    return this.fillColor
  }

  getFillOpacity(): number {
    return this.fillOpacity
  }

  enableEditing(): void {
    this.callLog.push('enableEditing')
    this.editing = true
  }

  disableEditing(): void {
    this.callLog.push('disableEditing')
    this.editing = false
  }

  enableMassClear(): void {
    this.callLog.push('enableMassClear')
    this.massClear = true
  }

  disableMassClear(): void {
    this.callLog.push('disableMassClear')
    this.massClear = false
  }
}

/** 带路径的图形：Polyline / Polygon / BezierCurve 共用 `setPath`。 */
export class FakeV4Polyline extends FakeV4Shape {
  path: FakeV4Point[]

  constructor(path: FakeV4Point[], options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.path = path
  }

  setPath(path: FakeV4Point[]): void {
    this.callLog.push('setPath')
    this.path = path
  }

  /**
   * 官方 `Polyline#setPositionAt(index: number, point: Point): void`。
   *
   * 刻意**只**记两个参数：官方 `Polygon` 的同名方法是**三个**（多一个 `deep`），
   * 两者由 `FakeV4Polygon` 各自建模——`deep` 的第三个参数要能被断言（见下面那条）。
   */
  setPositionAt(index: number, point: FakeV4Point): void {
    this.callLog.push('setPositionAt')
    this.positionAtArgs = [index, point]
    const current = this.path[index]
    if (current) {
      this.path[index] = point
    } else {
      this.path.push(point)
    }
  }

  /** 最近一次 `setPositionAt` 的参数（**按实参数**记录，`deep` 有没有被传一眼可见）。 */
  positionAtArgs: unknown[] = []

  getPath(): FakeV4Point[] {
    return this.path
  }
}

export class FakeV4Polygon extends FakeV4Polyline {
  /**
   * 官方 `Polygon#setPositionAt(index: number, point: Point, deep?: number): void`。
   *
   * `Polygon` 的路径是**多环**（`Array<Point> | Array<Array<Point>>`），`deep` 指定第几层环。
   * 本 Fake 按**单环**建模（`FakeV4Polygon` 直接继承 `FakeV4Polyline` 的 `path`），
   * 但**照样把 `deep` 记进 `positionAtArgs`**——要断言的正是「第三个参数被原样传下去了」。
   */
  override setPositionAt(index: number, point: FakeV4Point, deep?: number): void {
    this.callLog.push('setPositionAt')
    this.positionAtArgs = deep === undefined ? [index, point] : [index, point, deep]
    const current = this.path[index]
    if (current) {
      this.path[index] = point
    } else {
      this.path.push(point)
    }
  }
}

export class FakeV4Rectangle extends FakeV4Shape {
  bounds: FakeV4Bounds

  constructor(bounds: FakeV4Bounds, options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.bounds = bounds
  }

  setBounds(bounds: FakeV4Bounds): void {
    this.callLog.push('setBounds')
    this.bounds = bounds
  }

  /**
   * 官方 `Rectangle#getBounds()`（4.0.4 的 `overlay/Rectangle.d.ts` 声明了它）。
   *
   * 建模它是因为**检查要读几何**：`overlay-rectangle`（M5-VECTORS / #31）断言「矩形真的按传进去的
   * 对角两点画出来」——只数覆盖物个数证明不了这一点。夹具缺这个读数时，那条检查只能在真实档跑，
   * 于是它在一个本地跑不到的档里，等于没有门禁（夹具要与契约同形，而不是「只建模驱动会调的东西」）。
   */
  getBounds(): FakeV4Bounds {
    return this.bounds
  }
}

export class FakeV4Circle extends FakeV4Shape {
  center: FakeV4Point
  radius: number

  constructor(
    point: FakeV4Point,
    radius: number,
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    this.center = point
    this.radius = radius
  }

  setCenter(point: FakeV4Point): void {
    this.callLog.push('setCenter')
    this.center = point
  }

  setRadius(radius: number): void {
    this.callLog.push('setRadius')
    this.radius = radius
  }

  /** 官方 `Circle#getCenter()` / `#getRadius()`。 */
  getCenter(): FakeV4Point {
    return this.center
  }

  getRadius(): number {
    return this.radius
  }

  /**
   * 官方 `Circle#getBounds()`。
   *
   * 模型取**轴对齐外接矩形**（center ± radius 经度、± radius/cos(lat) 纬度会引入纬度相关的
   * 坐标系换算，而替身不做坐标系回转——`objects.ts` 文件头的口径）。这里取经纬度各 ± radius
   * 的简单方框，足够让「返回的是 Bounds 而不是 Point」这条断言有判别力。
   */
  getBounds(): FakeV4Bounds {
    return new FakeV4Bounds(
      new FakeV4Point(this.center.lng - this.radius, this.center.lat - this.radius),
      new FakeV4Point(this.center.lng + this.radius, this.center.lat + this.radius),
    )
  }
}

export class FakeV4Label extends FakeV4Overlay {
  content: string
  position: FakeV4Point | null = null
  offset: FakeV4Size | null = null
  styles: object | null = null
  opacity = 1
  zIndex: number | null = null
  title = ''
  anchor: unknown = null
  massClear = true

  constructor(content: string, options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.content = content
  }

  setContent(content: string): void {
    this.callLog.push('setContent')
    this.content = content
  }

  setPosition(point: FakeV4Point): void {
    this.callLog.push('setPosition')
    this.position = point
  }

  setOffset(size: FakeV4Size): void {
    this.callLog.push('setOffset')
    this.offset = size
  }

  /** 官方 4.0 是**复数** `setStyles`（BMapGL 是单数 `setStyle`）。 */
  setStyles(styles: object): void {
    this.callLog.push('setStyles')
    this.styles = styles
  }

  setOpacity(opacity: number): void {
    this.callLog.push('setOpacity')
    this.opacity = opacity
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  setTitle(title: string): void {
    this.callLog.push('setTitle')
    this.title = title
  }

  setAnchor(anchor: unknown): void {
    this.callLog.push('setAnchor')
    this.anchor = anchor
  }

  enableMassClear(): void {
    this.callLog.push('enableMassClear')
    this.massClear = true
  }

  disableMassClear(): void {
    this.callLog.push('disableMassClear')
    this.massClear = false
  }
}

export class FakeV4Marker extends FakeV4Overlay {
  position: FakeV4Point
  icon: unknown = null
  offset: FakeV4Size | null = null
  title = ''
  zIndex: number | null = null
  rotation: number | null = null
  dragging = false
  massClear = true

  constructor(point: FakeV4Point, options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.position = point
    // 构造选项要**落进实例状态**（M5-SPEC-MARKER / #30）。
    //
    // 真实 SDK 就是这么做的：`new BMap.Marker(pt, { rotation: 45 })` 之后 `getRotation()` 返回 45。
    // 此前 Fake 只把 options 原样存进 `this.options`，于是「初始 rotation / zIndex / draggable」
    // 这类**只能经构造期设置**的属性在夹具上根本读不到——组件少传一项也测不出来（夹具比真实宽容
    // 就会掩盖缺陷）。这里按官方 `MarkerOptions` 的语义逐项落库，读法仍是实例字段。
    if (options.offset) this.offset = options.offset as FakeV4Size
    if (options.icon !== undefined) this.icon = options.icon
    if (typeof options.title === 'string') this.title = options.title
    if (typeof options.zIndex === 'number') this.zIndex = options.zIndex
    if (typeof options.rotation === 'number') this.rotation = options.rotation
    if (options.enableDragging === true) this.dragging = true
    if (options.enableMassClear === false) this.massClear = false
  }

  setPosition(point: FakeV4Point): void {
    this.callLog.push('setPosition')
    this.position = point
  }

  setIcon(icon: unknown): void {
    this.callLog.push('setIcon')
    this.icon = icon
  }

  setOffset(size: FakeV4Size): void {
    this.callLog.push('setOffset')
    this.offset = size
  }

  setTitle(title: string): void {
    this.callLog.push('setTitle')
    this.title = title
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  setRotation(rotation: number): void {
    this.callLog.push('setRotation')
    this.rotation = rotation
  }

  /**
   * 官方 `Marker#setRank(rank: number): void` / `Marker#getRank(): number`（#165 Class 3）。
   *
   * 此前它只记 `options`、**没有可读回的状态**——那条路径本是给「描述符里没有的键走
   * `set<Key>` 逃生口」做验证的。命令面（`markerCommands()`）落地后 `getRank` 成为真实
   * 消费者，因此 `rank` 落进实例字段（与 `rotation` / `zIndex` 同一手法）。
   */
  rank = 0

  /** 官方 `Marker#setRotationOrigin(angle: number): void`（正北方向顺时针角度，0–360）。 */
  rotationOrigin: number | null = null

  setRank(rank: number): void {
    this.callLog.push('setRank')
    this.rank = rank
    this.options = { ...this.options, rank }
  }

  getRank(): number {
    return this.rank
  }

  setRotationOrigin(angle: number): void {
    this.callLog.push('setRotationOrigin')
    this.rotationOrigin = angle
  }

  /** 官方 `Marker#getTitle()` / `#getOffset()` / `#getRotation()` / `#getPosition()`。 */
  getTitle(): string {
    return this.title
  }

  getOffset(): FakeV4Size {
    return this.offset ?? new FakeV4Size(0, 0)
  }

  getRotation(): number {
    return this.rotation ?? 0
  }

  getPosition(): FakeV4Point {
    return this.position
  }

  /**
   * 官方 `Marker#setLabel(label: Label): void` / `#getLabel(): Label`（#165 第三批）。
   *
   * 此前替身**没有**这两个成员，于是 `<Marker label>` 的 `mutable` 路径在本库里**测不到**：
   * `OverlayDriver.setOptions` 撞到「声明为 mutable 但当前实例没有该方法」只会告警一次
   * 然后忽略（见 `driver/jsapi-v4/overlays.ts`）——那是一条**静默**路径，而替身比真实窄
   * 就会把「它真的生效」变成「没人验证过」。
   *
   * `label` 存的是**入参原样**（真实 SDK 收到的是 Driver 在边界内造的 `BMap.Label`），
   * 断言因此可以读 `label` 的内容来确认「换的是新值」，与真实链路上 `getLabel()` 的
   * 可观察效果同构。
   */
  label: unknown = null

  setLabel(label: unknown): void {
    this.callLog.push('setLabel')
    this.label = label
  }

  getLabel(): unknown {
    return this.label
  }

  /**
   * 官方 `Marker#closePlaceDetail(): void`。
   *
   * 配套的 `openPlaceDetail(placeDetail)` **刻意不建模**：它的入参是 raw
   * `BMap.PlaceDetail`，而本库没有这个 Driver 资源（见 `driver/types/overlays.ts` 的
   * `MarkerReadBackApi.openPlaceDetail` 注释）。替身也不该有一个业务面永远用不到的成员。
   */
  closePlaceDetail(): void {
    this.callLog.push('closePlaceDetail')
  }

  enableDragging(): void {
    this.callLog.push('enableDragging')
    this.dragging = true
  }

  disableDragging(): void {
    this.callLog.push('disableDragging')
    this.dragging = false
  }

  enableMassClear(): void {
    this.callLog.push('enableMassClear')
    this.massClear = true
  }

  disableMassClear(): void {
    this.callLog.push('disableMassClear')
    this.massClear = false
  }

  /** 官方 `Marker#setOptions`（整体覆盖） */
  setOptions(options: Record<string, unknown>): void {
    this.callLog.push('setOptions')
    this.options = { ...this.options, ...options }
  }

  /**
   * 官方 `Marker#addContextMenu(menu)` / `#removeContextMenu(menu)`（M5-CUSTOM-MENU / #33）。
   *
   * 建模**实测到的运行时形状**（真实 AK 探针，读数见 ADR `2026-09-19-custom-overlay-and-context-menu`）：
   *
   * - 成员在 `Marker.prototype` 上存在，但**不在** `@baidumap/jsapi-v4-types@4.0.4` 的声明里；
   * - 同一个菜单挂三次仍然只算「挂上一次」：一次右键只派发一条菜单 `open`；
   * - 摘除一次即彻底失效：之后的右键不再派发 `open`（因此 `contextMenus` 可以作为「挂上了没有」
   *   的读数，与 `FakeV4Map.contextMenus` 同形）。
   *
   * 销账按**实际新增**计（去重后），与 `FakeV4Map.addContextMenu` 一致——否则重复挂载会把
   * `contextMenus` 泄漏计数打成负数。
   */
  readonly contextMenus: FakeV4ContextMenu[] = []

  addContextMenu(menu: FakeV4ContextMenu): void {
    this.callLog.push('addContextMenu')
    if (this.contextMenus.includes(menu)) return
    this.contextMenus.push(menu)
    this.stats.resourceCreated('contextMenu')
  }

  removeContextMenu(menu: FakeV4ContextMenu): void {
    this.callLog.push('removeContextMenu')
    const index = this.contextMenus.indexOf(menu)
    if (index >= 0) {
      this.contextMenus.splice(index, 1)
      this.stats.resourceReleased('contextMenu')
    }
  }
}

export class FakeV4InfoWindow extends FakeV4Overlay {
  content: string | HTMLElement
  open = false
  /** 最近一次「地图侧打开」传入的位置（`map.openInfoWindow(iw, point)`）。 */
  openedAt: FakeV4Point | null = null
  /** 当前承载它的地图（被接管时记下、关闭时清掉），供实例级 `close()` 使用。 */
  enclosingMap: FakeV4Map | null = null
  width: number | null = null
  height: number | null = null
  redrawCalls = 0

  constructor(
    content: string | HTMLElement,
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    this.content = content
    if (options.offset) this.offset = options.offset as FakeV4Size
  }

  setContent(content: string | HTMLElement): void {
    this.callLog.push('setContent')
    this.content = content
  }

  setTitle(title: string | HTMLElement): void {
    this.callLog.push('setTitle')
    this.options = { ...this.options, title }
  }

  setWidth(width: number): void {
    this.callLog.push('setWidth')
    this.width = width
  }

  setHeight(height: number): void {
    this.callLog.push('setHeight')
    this.height = height
  }

  setMaxWidth(width: number): void {
    this.callLog.push('setMaxWidth')
    this.options = { ...this.options, maxWidth: width }
  }

  setMaxContent(content: string): void {
    this.callLog.push('setMaxContent')
    this.options = { ...this.options, maxContent: content }
  }

  enableMaximize(): void {
    this.callLog.push('enableMaximize')
  }

  disableMaximize(): void {
    this.callLog.push('disableMaximize')
  }

  enableAutoPan(): void {
    this.callLog.push('enableAutoPan')
  }

  disableAutoPan(): void {
    this.callLog.push('disableAutoPan')
  }

  enableCloseOnClick(): void {
    this.callLog.push('enableCloseOnClick')
  }

  disableCloseOnClick(): void {
    this.callLog.push('disableCloseOnClick')
  }

  /** 官方：气泡未打开时 `redraw()` 直接返回（不会顺带打开）。 */
  redraw(): void {
    this.callLog.push('redraw')
    if (!this.open) return
    this.redrawCalls++
  }

  /** 官方公开的状态查询入口；Driver 不得用私有字段判断打开状态。 */
  isOpen(): boolean {
    return this.open
  }

  /* ---- 读回 / 动作（#165 Class 3 / TASK 2c；官方 `overlay/InfoWindow.d.ts`） ---- */

  /** 官方 `InfoWindow#getTitle(): string | HTMLElement`。 */
  getTitle(): string | HTMLElement {
    return (this.options.title as string | HTMLElement) ?? ''
  }

  /** 官方 `InfoWindow#getContent(): string | HTMLElement`。 */
  getContent(): string | HTMLElement {
    return this.content
  }

  /**
   * 官方 `InfoWindow#getOffset(): Size`。
   *
   * 模型取**构造期**的 `offset`：`InfoWindow` 官方只有 `getOffset()` 没有 `setOffset`
   * （见 `OVERLAY_DESCRIPTORS["info-window"].offset` 的 `recreate` 分类），所以偏移一旦
   * 构造完就固定了——替身只读构造值，不实现运行期改写。
   */
  offset: FakeV4Size | null = null

  getOffset(): FakeV4Size {
    return this.offset ?? new FakeV4Size(0, 0)
  }

  /** 官方 `InfoWindow#maximize()` / `#restore()`（`enableMaximize` 打开后才有效果）。 */
  maximized = false

  maximize(): void {
    this.callLog.push('maximize')
    this.maximized = true
  }

  restore(): void {
    this.callLog.push('restore')
    this.maximized = false
  }

  /**
   * 运行时成员（**不在** 4.0.4 类型包里声明）：无位置打开时 Driver 会走这条结构性回退。
   */
  openInfoWindow(point?: FakeV4Point): void {
    this.callLog.push('infoWindow.openInfoWindow')
    this.open = true
    if (point) this.openedAt = point
    this.emit('open')
  }

  /** 实例级关闭：挂在地图上就交给地图关（摘掉「当前气泡」并派发 `close`）。 */
  close(): void {
    this.callLog.push('close')
    if (this.enclosingMap?.infoWindow === this) {
      this.enclosingMap.closeInfoWindow()
      return
    }
    this.open = false
    this.emit('close')
  }
}

export class FakeV4GroundOverlay extends FakeV4Overlay {
  bounds: FakeV4Bounds
  url: string | null = null
  opacity = 1
  displayOnMinLevel: number | null = null
  displayOnMaxLevel: number | null = null
  zIndex: number | null = null

  constructor(bounds: FakeV4Bounds, options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.bounds = bounds
  }

  setBounds(bounds: FakeV4Bounds): void {
    this.callLog.push('setBounds')
    this.bounds = bounds
  }

  /** 官方 `setImage(url, bounds?)`（`setImageURL` 是同义入口）。 */
  setImage(url: string): void {
    this.callLog.push('setImage')
    this.url = url
  }

  setOpacity(opacity: number): void {
    this.callLog.push('setOpacity')
    this.opacity = opacity
  }

  setDisplayOnMinLevel(level: number): void {
    this.callLog.push('setDisplayOnMinLevel')
    this.displayOnMinLevel = level
  }

  setDisplayOnMaxLevel(level: number): void {
    this.callLog.push('setDisplayOnMaxLevel')
    this.displayOnMaxLevel = level
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }
}

/**
 * `FakeV4GroundPoint`（issue #178）
 *
 * 官方 `overlay/GroundPoint.d.ts:5` 是 `class GroundPoint extends GroundOverlay`，构造签名
 * `constructor(point: Point, opts?: GroundPointOptions)`——**几何是位置参数**，与
 * `FakeV4GroundOverlay` 的 `constructor(bounds, …)` 是两件不同的事，因此单独建类而不复用。
 *
 * setter 集合**严格照官方实例方法表**（不实现 `setLevel` / `setTop` / `setEnableClicking`）：
 * GroundPoint 自己的 6 个（`setPoint` / `setScale` / `setSize` / `setRotation` / `setAnchor` /
 * `setOffset`）+ 从 GroundOverlay 继承的（`setImage` / `setOpacity` / `setDisplayOnMinLevel` /
 * `setDisplayOnMaxLevel` / `setZIndex` / `enableMassClear` / `disableMassClear`）。
 * 刻意**不**给缺失的成员提供兜底：若某个 `recreate` 键被误写成 `options`，Fake 在这里就会
 * 抛「成员不存在」，用例因此能红——这正是分类错误要暴露的行为。
 */
export class FakeV4GroundPoint extends FakeV4Overlay {
  point: FakeV4Point
  size: { width: number; height: number } | null = null
  anchor: { width: number; height: number } | null = null
  offset: { width: number; height: number } | null = null
  scale: number | null = null
  rotation: number | null = null
  url: string | null = null
  opacity = 1
  displayOnMinLevel: number | null = null
  displayOnMaxLevel: number | null = null
  zIndex: number | null = null
  massClear = true

  constructor(
    point: FakeV4Point,
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    this.point = point
  }

  /** 官方是 `setPoint`（**不是** `setPosition`）：见 `GroundPoint.d.ts:29`。 */
  setPoint(point: FakeV4Point): void {
    this.callLog.push('setPoint')
    this.point = point
  }

  setScale(scale: number): void {
    this.callLog.push('setScale')
    this.scale = scale
  }

  setSize(size: { width: number; height: number }): void {
    this.callLog.push('setSize')
    this.size = size
  }

  setRotation(rotation: number): void {
    this.callLog.push('setRotation')
    this.rotation = rotation
  }

  setAnchor(anchor: { width: number; height: number }): void {
    this.callLog.push('setAnchor')
    this.anchor = anchor
  }

  setOffset(offset: { width: number; height: number }): void {
    this.callLog.push('setOffset')
    this.offset = offset
  }

  setImage(url: string): void {
    this.callLog.push('setImage')
    this.url = url
  }

  setOpacity(opacity: number): void {
    this.callLog.push('setOpacity')
    this.opacity = opacity
  }

  setDisplayOnMinLevel(level: number): void {
    this.callLog.push('setDisplayOnMinLevel')
    this.displayOnMinLevel = level
  }

  setDisplayOnMaxLevel(level: number): void {
    this.callLog.push('setDisplayOnMaxLevel')
    this.displayOnMaxLevel = level
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  enableMassClear(): void {
    this.callLog.push('enableMassClear')
    this.massClear = true
  }

  disableMassClear(): void {
    this.callLog.push('disableMassClear')
    this.massClear = false
  }
}

export class FakeV4Prism extends FakeV4Overlay {
  path: FakeV4Point[]
  altitude: number
  zIndex: number | null = null

  constructor(
    path: FakeV4Point[],
    altitude: number,
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    this.path = path
    this.altitude = altitude
  }

  setPath(path: FakeV4Point[]): void {
    this.callLog.push('setPath')
    this.path = path
  }

  setAltitude(altitude: number): void {
    this.callLog.push('setAltitude')
    this.altitude = altitude
  }

  setTopFillColor(color: string): void {
    this.callLog.push('setTopFillColor')
    this.options = { ...this.options, topFillColor: color }
  }

  setTopFillOpacity(opacity: number): void {
    this.callLog.push('setTopFillOpacity')
    this.options = { ...this.options, topFillOpacity: opacity }
  }

  setSideFillColor(color: string): void {
    this.callLog.push('setSideFillColor')
    this.options = { ...this.options, sideFillColor: color }
  }

  setSideFillOpacity(opacity: number): void {
    this.callLog.push('setSideFillOpacity')
    this.options = { ...this.options, sideFillOpacity: opacity }
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }
}

export class FakeV4BezierCurve extends FakeV4Polyline {
  controlPoints: FakeV4Point[][]

  constructor(
    path: FakeV4Point[],
    controlPoints: FakeV4Point[][],
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(path, options, stats)
    this.controlPoints = controlPoints
  }

  setControlPoints(controlPoints: FakeV4Point[][]): void {
    this.callLog.push('setControlPoints')
    this.controlPoints = controlPoints
  }
}

export class FakeV4CustomOverlay extends FakeV4Overlay {
  /** 业务 DOM 工厂（官方 `domCreate`）：被调用一次即表示重建过一次 DOM。 */
  readonly domCreate: () => HTMLElement
  point: FakeV4Point | null
  rotation: number | null = null
  properties: unknown = null
  /** DOM 工厂被调用的次数 —— 「重建 DOM」的可观察计数。 */
  domCreateCalls = 0
  /**
   * 当前这份业务 DOM（由 `FakeV4Map.addOverlay` 经工厂取得并搬进地图容器，`removeOverlay` 时撤掉）。
   *
   * 与真实 4.0 一致（真实 AK 实测：业务 DOM 被搬进 `bmap-container` 内部、摘除时随之下线）：
   * 替身若不建模「SDK 会搬走这块元素」，「卸载后不残留」这条在与真实相反的方向上也会成立 ——
   * 那正是 `AGENTS.md` 说的「夹具比真实宽容会掩盖缺陷」。
   */
  domElement: HTMLElement | null = null

  constructor(
    domCreate: () => HTMLElement,
    options: Record<string, unknown>,
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    this.domCreate = domCreate
    this.point = (options.point as FakeV4Point | undefined) ?? null
    this.rotation = (options.rotationInit as number | undefined) ?? null
    this.properties = options.properties ?? null
  }

  /** 官方：第二参数默认 false，会**重建 DOM**；只位移时传 true。 */
  setPoint(point: FakeV4Point, noReCreate = false): void {
    this.callLog.push(noReCreate ? 'setPoint:noReCreate' : 'setPoint')
    this.point = point
    if (!noReCreate && this.domCreate) {
      this.domCreateCalls++
      // 真实 SDK 会拿工厂返回的新元素替换旧的。这里只建模「工厂被再次调用」这一可观察事实：
      // 本库的工厂始终返回**同一个**宿主元素，因此元素替换在替身上退化为 no-op（注释即是边界）。
      this.domCreate()
    }
  }

  setRotation(rotation: number): void {
    this.callLog.push('setRotation')
    this.rotation = rotation
  }

  setProperties(properties: unknown): void {
    this.callLog.push('setProperties')
    this.properties = properties
  }
}

export class FakeV4MenuItem {
  text: string
  callback: (...args: unknown[]) => void
  options: Record<string, unknown>
  disabled = false

  constructor(
    text: string,
    callback: (...args: unknown[]) => void,
    options: Record<string, unknown> = {},
  ) {
    this.text = text
    this.callback = callback
    this.options = options
  }

  /** 官方 `MenuItem#disable()`，由 `addContextMenuItem({ disabled: true })` 调用。 */
  disable(): void {
    this.disabled = true
  }

  /**
   * 官方 `MenuItem#enable()`（`context-menu/MenuItem.d.ts`）。
   *
   * #165 Class 3 / TASK 2e：此前 `enable()` **不可达**——`<MenuItem disabled>` 走的是
   * 「`disabled: false` ⇒ 整菜单重建」，因此一个 `MenuItem` 实例从生到死只会是「启用」
   * 或「永久禁用」两种状态。命令面让「运行时把一条项解禁」成为一条真实的 SDK 调用。
   */
  enable(): void {
    this.enabled = true
    // 官方 `MenuItem#enable()` 的语义就是「解除禁用」⇒ `disabled` 必须一起回落。
    // 只记一个 `enabled` 标记会让「解禁了但 `disabled` 仍为 true」在替身上恒成立，
    // 于是这条命令路径的用例根本测不出它有没有真的解禁。
    this.disabled = false
  }

  /** `enable()` 有没有被调过（`disabled` 的初始值由构造参数决定，因此要单独记）。 */
  enabled = false

  /**
   * 官方 `MenuItem#setText(text: string): void`。
   *
   * 官方 `MenuItem` 上**没有任何 getter**（只有 `setText` / `enable` / `disable`）——
   * 这正是本库的菜单命令面改成「按序号 + 本库条目模型」的原因（见
   * `core/overlays/ContextMenuSpec.ts` 的说明）：读回只可能来自本库模型。
   */
  setText(text: string): void {
    this.text = text
  }
}

export class FakeV4ContextMenu extends FakeV4Overlay {
  readonly items: (FakeV4MenuItem | '-')[] = []

  constructor(options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(options, stats)
  }

  addItem(item: FakeV4MenuItem, insertIndex?: number): void {
    this.callLog.push('addItem')
    if (typeof insertIndex === 'number') this.items.splice(insertIndex, 0, item)
    else this.items.push(item)
  }

  addSeparator(insertIndex?: number): void {
    this.callLog.push('addSeparator')
    if (typeof insertIndex === 'number') this.items.splice(insertIndex, 0, '-')
    else this.items.push('-')
  }

  /**
   * 官方 `ContextMenu#getItem(index: number): MenuItem`。
   *
   * 建模它是因为**逐条删改**（#165 Class 3 / TASK 2d）需要「拿到第 i 条」的入口。
   * ⚠️ 官方签名返回 raw `MenuItem`；本库的**公共命令面不交出它**，改按序号返回本库的
   * 条目模型（见 `core/overlays/ContextMenuSpec.ts`）——`MenuItem` 上没有任何 getter，
   * 把它交出去等于把一个「调用方读不到任何东西」的对象发到用户手里。
   */
  getItem(index: number): FakeV4MenuItem {
    const item = this.items[index]
    if (!(item instanceof FakeV4MenuItem)) {
      throw new Error(`getItem(${index}): 越界或该位置是分隔线`)
    }
    return item
  }

  /**
   * 官方 `ContextMenu#removeItem(item: MenuItem): void`。
   *
   * 官方按**实例**删（不是按序号）：它的入参就是那个 `MenuItem` 对象。替身按身份删
   * （`indexOf`），与官方语义一致——这也让「传错实例」在替身上立刻可见。
   */
  removeItem(item: FakeV4MenuItem): void {
    this.callLog.push('removeItem')
    const index = this.items.indexOf(item)
    if (index >= 0) this.items.splice(index, 1)
  }

  /** 官方 `ContextMenu#removeSeparator(index: number): void`。 */
  removeSeparator(index: number): void {
    this.callLog.push('removeSeparator')
    if (this.items[index] === '-') this.items.splice(index, 1)
  }

  /**
   * 官方 `ContextMenu#getDom(): HTMLElement`（菜单的根 DOM）。
   *
   * 建模它是因为 `ContextMenu` 的 DOM **由 SDK 自己渲染**（`.BMap_cmItem`）——本库
   * 没有任何 Vue 渲染的菜单 DOM，因此「拿 DOM」只能从 SDK 要。
   */
  dom: HTMLElement | null = null

  getDom(): HTMLElement {
    if (!this.dom) this.dom = document.createElement('div')
    return this.dom
  }

  /** 官方 `ContextMenu#setCursor(cursor: string): void`（鼠标悬停时的光标）。 */
  cursor: string | null = null

  setCursor(cursor: string): void {
    this.callLog.push('setCursor')
    this.cursor = cursor
  }
}

export class FakeV4Icon {
  image: string | HTMLCanvasElement | HTMLImageElement
  size: FakeV4Size
  anchor: FakeV4Size | null
  imageOffset: FakeV4Size | null
  imageSize: FakeV4Size | null

  constructor(
    image: string | HTMLCanvasElement | HTMLImageElement,
    size: FakeV4Size,
    opts: Record<string, unknown> = {},
  ) {
    this.image = image
    this.size = size
    this.anchor = (opts.anchor as FakeV4Size | undefined) ?? null
    this.imageOffset = (opts.imageOffset as FakeV4Size | undefined) ?? null
    this.imageSize = (opts.imageSize as FakeV4Size | undefined) ?? null
  }

  get imageUrl(): string {
    return typeof this.image === 'string' ? this.image : ''
  }
}
