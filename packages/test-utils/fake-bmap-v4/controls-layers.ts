/**
 * Fake BMap v4 运行对象（Control / Layer）
 *
 * 覆盖面刻意只到「Control / Layer Facet 会调用 + 共享契约会断言」的成员：控件基类的
 * 停靠/偏移/显隐、各 kind 的字段级 setter、`CopyrightControl` 的版权家族，以及图层的
 * 家族标志位与 `TileLayer#setZIndex`。**不补 getter 家族**（Facet 不读它们），避免
 * Fake 先于实现膨胀（同 `objects.ts` / `FakeMap.ts` 的口径）。
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
 *   `isTileLayer`）表达；
 * - `PanoramaCoverageLayer` 在 4.0.4 类型包里**没有类声明**，属运行时能力——Fake 提供它，
 *   以便覆盖「真实运行时存在」的创建路径；「运行时缺失」的分支由测试自己裁掉该构造器。
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

/** 瓦片图层（官方 `TileLayer`）：`setZIndex` 是唯一的字段级 setter。 */
export class FakeV4TileLayer extends FakeV4Layer {
  readonly isTileLayer = true
  zIndex: number | null = null

  constructor(options: Record<string, unknown> = {}, stats: FakeV4Diagnostics) {
    super(options, stats)
  }

  setZIndex(zIndex: number): void {
    this.callLog.push('setZIndex')
    this.zIndex = zIndex
  }

  isTransparentPng(): boolean {
    return this.options.transparentPng === true
  }

  getTilesUrl(): string {
    return ''
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
