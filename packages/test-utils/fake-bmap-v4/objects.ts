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
}

export class FakeV4Polygon extends FakeV4Polyline {}

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

  /** 官方 `Marker#setRank`：用于验证「描述符里没有的键走 set<Key> 逃生口」。 */
  setRank(rank: number): void {
    this.callLog.push('setRank')
    this.options = { ...this.options, rank }
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

  /** 官方 `MenuItem#disable`，由 `addContextMenuItem({ disabled: true })` 调用。 */
  disable(): void {
    this.disabled = true
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
