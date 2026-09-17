/**
 * Fake BMap v4 运行对象（Control / Layer）
 *
 * 覆盖面刻意只到「Control / Layer Facet 会调用 + 共享契约会断言」的成员：控件基类的
 * 停靠/偏移/显隐、各 kind 的字段级 setter、`CopyrightControl` 的版权家族，以及图层的
 * 家族标志位与各自的字段级 / 整袋 setter。**唯一硬规则是「只实现官方 `.d.ts` 里声明过的
 * 成员」**（因为「能力面与替身一致」本身是一条要断言的契约：Fake 比真实宽容 = 掩盖缺陷）；
 * 在这个前提下，成对的 getter（`getLevel` / `getVisible`…）跟着 setter 一起给，
 * 便于用例读回写入结果。M7-LAYERS（#40）之后图层一侧覆盖十种 kind。
 *
 * 与覆盖物替身分开成文件，是因为 issue #22 的 ADR 把「控件」与「图层」写成两节；
 * 覆盖物替身（`objects.ts`）已经很长，混在一起会让两节无法对照阅读。
 *
 * 行为依据（官方 4.0.4 类型包 + 官方 Skill `references/controls-and-context-menu.md`）：
 * - `map.addControl()` 内部会调用控件的 `initialize(map)` 取 DOM（自定义控件契约）；
 *   因此 `FakeV4Map.addControl` 也调用它——这是「自定义控件的 DOM 工厂真的被接上」的
 *   唯一可观察点；
 * - 图层经**统一** `map.addLayer/removeLayer` 管理（4.0 的 `addDistrictLayer` /
 *   `addTileLayer` 已标记 deprecated），家族由原型标志位（`isDistrictLayer` /
 *   `isTileLayer` / `isGeoJSONLayer` / `isCustomHtmlLayer`）表达；
 * - `PanoramaCoverageLayer` 在 4.0.4 类型包里**没有类声明**，属运行时能力——Fake 提供它，
 *   以便覆盖「真实运行时存在」的创建路径；「运行时缺失」的分支由测试自己裁掉该构造器；
 * - `GeoJSONLayer` / `DOMLayer` 的官方构造签名是**两参**（首参分别是 `layerName` 与
 *   `createDOM`），Fake 如实校验首参类型：拼错实参顺序会在夹具层直接暴露。
 */
import { FakeV4EventTarget } from './event-target.ts'
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4Size } from './geometry.ts'
import type { FakeV4Map } from './FakeMap.ts'

/* ------------------------------------------------------------------ Control */

/**
 * 控件基类（官方 `BMap.Control`）。
 *
 * 不逐类剔除官方未发布的成员：哪些 option 走哪条更新路径由 v4 Driver 的
 * `CONTROL_OPTION_SPECS` 决定，那是 Driver 侧的权威；Fake 只负责让「被调用的成员」可观察。
 */
export class FakeV4Control extends FakeV4EventTarget {
  options: Record<string, unknown>
  readonly callLog: string[] = []
  anchor: unknown = null
  offset: FakeV4Size | null = null
  visible = true
  /** 自定义控件契约：`initialize()` 之前就要存在。 */
  defaultAnchor: unknown = null
  defaultOffset: FakeV4Size | null = null
  initialize: ((map: unknown) => HTMLElement) | null = null
  /** 由 `FakeV4Map.addControl` 写入；`removeControl` 时按实例清除。 */
  attachedMap: FakeV4Map | null = null

  constructor(options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(stats)
    this.options = options
    this.anchor = options.anchor ?? null
    this.offset = (options.offset as FakeV4Size | undefined) ?? null
  }

  setAnchor(anchor: unknown): void {
    this.callLog.push('setAnchor')
    this.anchor = anchor
    /**
     * **`setAnchor()` 会把偏移重置回控件**自身**的默认值**。
     *
     * 这条不是猜的：官方参考实现 `huiyan-fe/react-bmap` 的控件工厂在首次同步选项时特意
     * **跳过** `setAnchor`，注释写的就是「构造函数已经设置了所有选项，首次 `setControlOptions`
     * 会调用 `setAnchor` 重置 SDK 默认 offset」。
     *
     * 本 Fake 不建模「默认值具体是多少」（那是 SDK 内部常量），只用 `null` 表达「已经不再是
     * 构造期那个值」。有了它，「成对写 anchor + offset」才是一个**可证伪**的不变量
     * （M7-CONTROL-PANORAMA / #41）：去掉成对写，10 个 Stable 控件的用例必须一起变红。
     */
    this.offset = null
  }

  getAnchor(): unknown {
    return this.anchor
  }

  setOffset(offset: FakeV4Size): void {
    this.callLog.push('setOffset')
    this.offset = offset
  }

  getOffset(): FakeV4Size | null {
    return this.offset
  }

  show(): void {
    this.callLog.push('show')
    this.visible = true
    this.emit('show')
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
    this.emit('hide')
  }

  isVisible(): boolean {
    return this.visible
  }
}

export class FakeV4NavigationControl extends FakeV4Control {
  type: unknown = null

  /**
   * 官方（真实 4.0 实测，见 ADR 的 smoke 记录）：平移缩放控件的内部滑块 DOM 在
   * `initialize()`（即 `map.addControl`）时才创建，**未挂载**调用 `setType` 会抛
   * `TypeError: Cannot read properties of undefined (reading 'show')`。
   *
   * Fake 把这条约束建模出来，是为了让「先挂载再改 kind 专属 option」成为可执行的约定，
   * 而不是只写在注释里。
   */
  setType(type: unknown): void {
    if (!this.attachedMap) {
      throw new TypeError(
        "setType: 控件尚未挂载（initialize 未执行，内部滑块 DOM 还不存在）",
      )
    }
    this.callLog.push('setType')
    this.type = type
  }
}

export class FakeV4ScaleControl extends FakeV4Control {
  unit: unknown = null

  setUnit(unit: unknown): void {
    this.callLog.push('setUnit')
    this.unit = unit
  }
}

/**
 * 地图类型切换控件（官方 `MapTypeControl`）。
 *
 * 唯一建模的成员是 `showStreetLayer(isShow)`：它是官方 4.0.4 上该控件**唯一**的字段级 setter，
 * 而且成员名不是 `set<Key>` 形状（`setOptions` 的结构逃生口抓不到）——Fake 把它做出来，
 * 这样「统一 adapter 真的把路网开关就地写下去了」才是可断言的
 * （M7-CONTROL-PANORAMA / issue #41）。
 */
export class FakeV4MapTypeControl extends FakeV4Control {
  streetLayer: boolean | null = null

  showStreetLayer(isShow: boolean): void {
    this.callLog.push(`showStreetLayer:${isShow === true ? 'on' : 'off'}`)
    this.streetLayer = isShow === true
  }
}

export class FakeV4CityListControl extends FakeV4Control {
  expanded = false
  cityName = ''

  open(): void {
    this.callLog.push('open')
    this.expanded = true
  }

  close(): void {
    this.callLog.push('close')
    this.expanded = false
  }

  toggle(): void {
    this.callLog.push('toggle')
    this.expanded = !this.expanded
  }

  getCityName(): string {
    return this.cityName
  }
}

export class FakeV4OverviewMapControl extends FakeV4Control {
  open = false
  size: FakeV4Size | null = null

  /**
   * 构造期选项**必须**被建模：`size` / `isOpen` 在真实 4.0 上只在构造期读取（没有幂等
   * setter，`isOpen` 甚至只有 `changeView()` 的切换语义）。Fake 不读它们的话，
   * 「统一 adapter 用重建来让构造期选项生效」这条路径就无法断言——重建出来的新实例读到的
   * 仍会是 `null`/`false`（M7-CONTROL-PANORAMA / issue #41 实测踩到）。
   */
  constructor(options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
    this.open = options.isOpen === true
    this.size = (options.size as FakeV4Size | undefined) ?? null
  }

  isOpen(): boolean {
    return this.open
  }

  /** 官方语义是**切换**（没有幂等 setter），因此 `setOptions({ isOpen })` 无法表达。 */
  changeView(): void {
    this.callLog.push('changeView')
    this.open = !this.open
  }

  setSize(size: FakeV4Size): void {
    this.callLog.push('setSize')
    this.size = size
  }

  getSize(): FakeV4Size | null {
    return this.size
  }
}

export class FakeV4GeolocationControl extends FakeV4Control {
  /** `setOptions(options)` 被整袋写回的次数与内容（「options 袋」路径的可观察点）。 */
  readonly appliedBags: Record<string, unknown>[] = []
  address: unknown = null

  setOptions(options: Record<string, unknown>): void {
    this.callLog.push('setOptions')
    this.options = { ...this.options, ...options }
    this.appliedBags.push(options)
  }

  location(): void {
    this.callLog.push('location')
  }

  startLocation(): void {
    this.callLog.push('startLocation')
  }

  stopLocationTrace(): void {
    this.callLog.push('stopLocationTrace')
  }

  getAddressComponent(): unknown {
    return this.address
  }
}

export class FakeV4CopyrightControl extends FakeV4Control {
  /** 版权项按 id upsert（官方 `addCopyright` 的语义）。 */
  copyrights: { id: number; content?: string; bounds?: unknown }[] = []

  addCopyright(copyright: { id: number; content?: string; bounds?: unknown }): void {
    this.callLog.push('addCopyright')
    this.copyrights = [
      ...this.copyrights.filter((item) => item.id !== copyright.id),
      { ...copyright },
    ]
  }

  removeCopyright(id: number): void {
    this.callLog.push('removeCopyright')
    this.copyrights = this.copyrights.filter((item) => item.id !== id)
  }

  getCopyright(id: number): { id: number; content?: string; bounds?: unknown } | undefined {
    return this.copyrights.find((item) => item.id === id)
  }

  getCopyrightCollection(): { id: number; content?: string; bounds?: unknown }[] {
    return this.copyrights
  }
}

/* -------------------------------------------------------------------- Layer */

/** 图层基类：归属与监听器统计（4.0 的各个图层类没有共同基类，这里只抽取可观察部分）。 */
export class FakeV4Layer extends FakeV4EventTarget {
  options: Record<string, unknown>
  readonly callLog: string[] = []
  /** 由 `FakeV4Map.addLayer` 写入；`removeLayer` 时清除。 */
  attachedMap: FakeV4Map | null = null

  constructor(options: Record<string, unknown>, stats: FakeV4Diagnostics) {
    super(stats)
    this.options = options
  }
}

/** 行政区图层（官方 4.0.4 有类声明；`name` / `autoViewport` 等全部是构造选项，没有 setter）。 */
export class FakeV4DistrictLayer extends FakeV4Layer {
  readonly isDistrictLayer = true
}

/**
 * 瓦片图层（官方 `TileLayer`）。
 *
 * 声明成员逐条对应（`@baidumap/jsapi-v4-types@4.0.4`）：`setZIndex` / `addBoundary` /
 * `clearBoundary` / `clearCache` / `setZIndexTop` / `isTransparentPng` / `getTilesUrl`。
 * **不含** `show/hide`——官方 `TileLayer` 没有它们（`TrafficLayer` 继承自它，同样没有），
 * 因此「按声明造替身」的这条约束正好锁住「表层显隐只能靠挂载」这个结论。
 */
export class FakeV4TileLayer extends FakeV4Layer {
  readonly isTileLayer = true
  zIndex: number | null = null
  boundary: string | string[] | null = null
  clearedCache = 0
  zIndexTopCalls = 0
  /**
   * 测试故障注入：让**下一次** `setZIndex` 抛错（用后即清）。
   *
   * 用途是「同一次更新里，已经判定必须重建的状态不能被另一步的就地写入异常挡住」——
   * 需要一个「就地写入会失败」的注入点（与 `FakeV4DOMLayer.failNextSetStyleOptions` 同一手法）。
   */
  failNextSetZIndex: Error | null = null

  constructor(options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    if (this.failNextSetZIndex) {
      const error = this.failNextSetZIndex
      this.failNextSetZIndex = null
      throw error
    }
    this.zIndex = zIndex
  }

  setZIndexTop(): void {
    this.callLog.push('setZIndexTop')
    this.zIndexTopCalls += 1
  }

  addBoundary(boundary: string | string[]): void {
    this.callLog.push('addBoundary')
    this.boundary = boundary
  }

  clearBoundary(): void {
    this.callLog.push('clearBoundary')
    this.boundary = null
  }

  clearCache(): void {
    this.callLog.push('clearCache')
    this.clearedCache += 1
  }

  isTransparentPng(): boolean {
    return this.options.transparentPng === true
  }

  getTilesUrl(): string {
    return ''
  }
}

/**
 * 路况图层（官方 `TrafficLayer extends TileLayer`）。
 *
 * 官方声明在继承之上多了 `setColors` / `setEdge`；两个都是**就地更新**（`setOptions` 的
 * `mutable` 分类），因此 Fake 把写入值留成可读字段，便于断言「真的调到了这个 setter」。
 */
export class FakeV4TrafficLayer extends FakeV4TileLayer {
  colors: string[] | null = null
  edge: boolean | null = null
  /**
   * 测试故障注入：让**下一次** `setEdge` 抛错（用后即清）。
   *
   * 建模的是「Driver 的 `setOptions` **不是事务**」这条形状：官方对 `TrafficLayer` 只给了
   * 两个字段级 setter，调用方传一个袋子时 Driver 只能**逐 setter** 调用，于是「`setColors`
   * 已经写进 SDK、`setEdge` 抛错」是真实可达的**部分成功**。调用方若把这批键当成原子的
   * 「要么全成功、要么全没发生」，第一个键就会在账本上凭空消失（第四轮评审发现 2）。
   */
  failNextSetEdge: Error | null = null

  setColors(colors: string[]): void {
    this.callLog.push('setColors')
    this.colors = [...colors]
  }

  setEdge(value: boolean): void {
    this.callLog.push('setEdge')
    if (this.failNextSetEdge) {
      const error = this.failNextSetEdge
      this.failNextSetEdge = null
      // 刻意**在写入之前**抛出：这一次 `setEdge` 没生效，但同批的 `setColors` 已经生效了。
      throw error
    }
    this.edge = value
  }
}

/**
 * 4.0 新增的「第三方标准瓦片服务」家族（`XYZLayer` / `RasterTileLayer` / `WMSLayer` /
 * `WMTSLayer`）共享的声明面：`setZIndex` + 掩膜 + 清缓存，**没有** `isTransparentPng` /
 * `getTilesUrl` / `setZIndexTop`（那是 `TileLayer` 自己的声明）。
 */
export class FakeV4StandardTileLayer extends FakeV4Layer {
  readonly isTileLayer = true
  zIndex: number | null = null
  boundary: string | string[] | null = null
  clearedCache = 0

  constructor(options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  addBoundary(boundary: string | string[]): void {
    this.callLog.push('addBoundary')
    this.boundary = boundary
  }

  clearBoundary(): void {
    this.callLog.push('clearBoundary')
    this.boundary = null
  }

  clearCache(): void {
    this.callLog.push('clearCache')
    this.clearedCache += 1
  }
}

/** XYZ 图层（官方 `XYZLayer`）：在标准瓦片家族之上多 `show` / `hide` / `isVisible`。 */
export class FakeV4XYZLayer extends FakeV4StandardTileLayer {
  visible = true

  show(): void {
    this.callLog.push('show')
    this.visible = true
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
  }

  isVisible(): boolean {
    return this.visible
  }
}

/** 栅格瓦片图层（官方 `RasterTileLayer`）：只有标准瓦片家族那一份声明面。 */
export class FakeV4RasterTileLayer extends FakeV4StandardTileLayer {}

/** WMS 图层（官方 `WMSLayer`）：只有标准瓦片家族那一份声明面。 */
export class FakeV4WMSLayer extends FakeV4StandardTileLayer {}

/** WMTS 图层（官方 `WMTSLayer`）：只有标准瓦片家族那一份声明面。 */
export class FakeV4WMTSLayer extends FakeV4StandardTileLayer {}

/**
 * GeoJSON 覆盖物组合图层（官方 `GeoJSONLayer`）。
 *
 * 官方构造签名是 `(layerName, options)`——**首参是图层名而不是选项**。Fake 如实建模（首参
 * 不是非空字符串就抛错），这样「Driver 把两个实参拼错顺序」会在夹具层立刻暴露，而不是变成
 * 一个永远画不出东西的图层。
 */
export class FakeV4GeoJSONLayer extends FakeV4Layer {
  readonly isGeoJSONLayer = true
  readonly layerName: string
  /** 最近一次 `setData` 的数据（`null` = 已清空）。 */
  data: object | null = null
  level: number
  visible: boolean
  resetStyleCalls = 0
  destroyCalls = 0

  constructor(layerName: string, options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new TypeError('GeoJSONLayer: 第一个参数必须是图层名（官方签名是 (layerName, options)）')
    }
    this.layerName = layerName
    this.level = typeof options.level === 'number' ? options.level : -99
    this.visible = options.visible !== false
    if (options.dataSource !== undefined) this.data = options.dataSource as object
  }

  setData(geojson: object): void {
    this.callLog.push('setData')
    if (!geojson || (geojson as { type?: unknown }).type !== 'FeatureCollection') {
      throw new TypeError('GeoJSONLayer.setData: 只接受 GeoJSON FeatureCollection')
    }
    this.data = geojson
  }

  getData(): unknown[] {
    return []
  }

  clearData(): void {
    this.callLog.push('clearData')
    this.data = null
  }

  resetStyle(): void {
    this.callLog.push('resetStyle')
    this.resetStyleCalls += 1
  }

  pickOverlays(): unknown[] | null {
    return null
  }

  setLevel(z: number): void {
    this.callLog.push('setLevel')
    this.level = z
  }

  getLevel(): number {
    return this.level
  }

  setVisible(v: boolean): void {
    this.callLog.push('setVisible')
    this.visible = v
  }

  getVisible(): boolean {
    return this.visible
  }

  /** 官方 `destroy()`：清空覆盖物数据并解除与 Map 的关联。 */
  destroy(): void {
    this.callLog.push('destroy')
    this.destroyCalls += 1
    this.data = null
  }
}

/**
 * 自定义 DOM 覆盖物图层（官方 `DOMLayer`）。
 *
 * 官方构造签名是 `(createDOM, options)`；`setStyleOptions(partial)` 是**整袋**
 * 更新构造项（没有逐字段 setter），Fake 把每次收到的袋子都记下来，让
 * 「`bagSetters` 走的是整袋入口」这件事可断言。
 */
export class FakeV4DOMLayer extends FakeV4Layer {
  readonly isCustomHtmlLayer = true
  /**
   * 官方 4.0.4 的 `DOMLayer` **只有** `addEventListener`、没有 `removeEventListener`
   * （逐成员核对 `layer/DOMLayer.d.ts`）。替身必须同样缺这一半，否则会掩盖一类真实缺陷：
   * `EventDriver.on()` 要求两个入口同时存在，缺一个就 warn + no-op，而 Fake 从基类继承来的
   * `removeEventListener` 会让「组件公开了事件、真实契约下订阅不到」这种问题**测试全绿**。
   *
   * 用 `Object.defineProperty` 把继承来的原型方法在本实例上遮蔽为 `undefined`
   * （写成类字段会与基类方法签名冲突，类型层不通过）。
   */
  private static readonly HIDE_REMOVE_EVENT_LISTENER = true
  /**
   * 测试故障注入：让**下一次** `setStyleOptions` 抛错（用后即清）。
   *
   * 用来锁住「applied 记账必须在 SDK 调用**成功返回之后**才提交」这条不变式——
   * 少了它，一次失败的整袋更新会被记成已完成，后续同值更新被指纹跳过、永不重试。
   */
  failNextSetStyleOptions: Error | null = null
  /**
   * 测试故障注入：让**下一次** `setStyleOptions` **先真的写进去、再抛错**（用后即清）。
   *
   * 与 `failNextSetStyleOptions`（写之前抛）对偶，形状同 `FakeV4Map.failNextAddLayerAfterAttach`。
   * 它建模的是内核**无法区分**的那一类：调用方收到异常，但 SDK 侧的状态**已经变了**。这正是
   * 「移除检测必须用『尝试过写入』的账本、不能用『成功写入过』的账本」这条不变式的用武之地——
   * 按成功记账的话，这个已经生效的 `minZoom` 在账本上不存在，之后把它置回未表态就不会重建，
   * SDK 永久保留旧值（第四轮评审发现 2）。
   */
  failNextSetStyleOptionsAfterApply: Error | null = null
  readonly createDOM: (properties: object, point: { lng: number; lat: number }) => HTMLElement
  /** 每次 `setStyleOptions` 收到的袋子（顺序即调用顺序）。 */
  readonly appliedStyleBags: Record<string, unknown>[] = []
  data: object | null = null
  visible: boolean
  readonly customOverlays: object[] = []

  constructor(
    createDOM: (properties: object, point: { lng: number; lat: number }) => HTMLElement,
    options: Record<string, unknown> = {},
    stats: FakeV4Diagnostics,
  ) {
    super(options, stats)
    if (FakeV4DOMLayer.HIDE_REMOVE_EVENT_LISTENER) {
      Object.defineProperty(this, 'removeEventListener', { value: undefined, configurable: true })
    }
    if (typeof createDOM !== 'function') {
      throw new TypeError('DOMLayer: 第一个参数必须是 createDOM 函数（官方签名是 (createDOM, options)）')
    }
    this.createDOM = createDOM
    this.visible = options.visible !== false
    if (options.data !== undefined) this.data = options.data as object
  }

  setData(data: object | null): void {
    this.callLog.push('setData')
    if (data !== null && (data as { type?: unknown }).type !== 'FeatureCollection') {
      throw new TypeError('DOMLayer.setData: 只接受 GeoJSON FeatureCollection（或 null）')
    }
    this.data = data
    // 官方口径（`.agents/skills/bmap-jsapi-v4/references/data-layers.md`）：`setData(null)` 只清空
    // 数据引用，**不会**移除已经渲染出来的 overlays；清空必须显式 `removeAllOverlays()`。
    // 替身按这条建模：每次喂数据都重建这批覆盖物，`data = null` 时保留现状。
    if (data !== null) {
      const features = (data as { features?: unknown[] }).features ?? []
      this.customOverlays.splice(
        0,
        this.customOverlays.length,
        ...features.map((feature, index) => ({ id: index, feature })),
      )
    }
  }

  show(): void {
    this.callLog.push('show')
    this.visible = true
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
  }

  setStyleOptions(options: Partial<Record<string, unknown>>): void {
    this.callLog.push('setStyleOptions')
    if (this.failNextSetStyleOptions) {
      const error = this.failNextSetStyleOptions
      this.failNextSetStyleOptions = null
      throw error
    }
    this.appliedStyleBags.push({ ...options })
    this.options = { ...this.options, ...options }
    if (this.failNextSetStyleOptionsAfterApply) {
      const error = this.failNextSetStyleOptionsAfterApply
      this.failNextSetStyleOptionsAfterApply = null
      throw error
    }
  }

  removeAllOverlays(): void {
    this.callLog.push('removeAllOverlays')
    this.customOverlays.length = 0
  }

  removeOverlay(cusItem: object | string): void {
    this.callLog.push('removeOverlay')
    const index = this.customOverlays.indexOf(cusItem as object)
    if (index >= 0) this.customOverlays.splice(index, 1)
  }

  getCustomOverlays(): object[] {
    return this.customOverlays
  }
}

/**
 * 全景覆盖图层。
 *
 * 官方 4.0.4 类型包**没有** `PanoramaCoverageLayer` 的类声明，但 4.0 运行时公开该构造器
 * （官方 Skill `references/tile-and-service-layers.md`）——因此 Fake 提供它，
 * 用来覆盖「真实运行时存在」的创建路径。
 */
export class FakeV4PanoramaCoverageLayer extends FakeV4Layer {
  constructor(stats: FakeV4Diagnostics) {
    super({}, stats)
  }
}
