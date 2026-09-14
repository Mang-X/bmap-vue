/**
 * Fake BMap v4 服务替身（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖面只到「Service Facet 会调用 + 共享契约会断言」的成员：六个基础服务的**唯一调用入口**
 * （`Geocoder#getPoint/getLocation`、`Convertor#translate`、`Boundary#get`、
 * `Geolocation#getCurrentPosition/getStatus`、`LocalCity#get`、`Autocomplete#search`）与
 * ViewAnimation 的构造选项。不补 getter 家族，避免 Fake 先于实现膨胀（同 `objects.ts` 口径）。
 *
 * 两条刻意建模的运行时事实：
 *
 * 1. **回包恒为异步**：真实服务是 JSONP，回调至少在下一个微任务才到。这既是真实语义，
 *    也让「取消 / 超时之后回包才到达」这类顺序敏感的场景可以被显式摆出来。
 * 2. **失败只回 `null`**：真实服务失败（配额 302 / Referer 限制）时回调参数就是 `null`，
 *    **没有**公开的错误码入口。Fake 因此**不再**提供 `_rd` 注册表与错误码注入
 *    （R25-C / #72）：那个面会诱导实现去嗅探 SDK 私有表，而本库只允许依赖公开回调参数。
 * 3. **手动时序**：`queue.auto = false` 时回调进入队列，由测试 `flush()` 触发，
 *    用来固定「取消 / 超时之后的迟到回包」这类顺序敏感的语义。
 */

/* ------------------------------------------------------------- 回包时序控制 */

import { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4EventTarget } from './event-target.ts'
import { FakeV4Bounds, FakeV4Point } from './geometry.ts'

/* -------------------------------------------------------------------------- */
/* 回调队列                                                                    */
/* -------------------------------------------------------------------------- */

export class FakeV4CallbackQueue {
  /** true（默认）：回包在下一个微任务自动触发；false：进入队列等 `flush()`。 */
  auto = true
  /**
   * 测试辅助：回包延迟（毫秒）。**不是**官方 API——真实 JSONP 的延迟由网络决定，这里把它变成
   * 可控输入，用来固定「迟到回包」「慢网络下的超时窗口」这类顺序敏感的语义。
   *
   * `0`（默认）= 下一个微任务（真实 JSONP 的最短延迟）；`> 0` = `setTimeout`，并计入诊断的
   * timer 口径（`activity.timersScheduled` / `timersPending`）。
   */
  delay = 0
  private queue: Array<() => void> = []
  private readonly diagnostics: FakeV4Diagnostics | undefined

  /** `diagnostics` 省略时回包不进诊断（独立构造服务实例的场景）。 */
  constructor(diagnostics?: FakeV4Diagnostics) {
    this.diagnostics = diagnostics
  }

  /** 手动模式（`auto === false`）下尚未触发的回包数。 */
  get pending(): number {
    return this.queue.length
  }

  dispatch(run: () => void): void {
    this.diagnostics?.callbackQueued()
    const settle = () => {
      this.diagnostics?.callbackSettled()
      run()
    }
    if (!this.auto) {
      this.queue.push(settle)
      return
    }
    if (this.delay > 0) {
      this.diagnostics?.timerScheduled()
      setTimeout(() => {
        this.diagnostics?.timerFired()
        settle()
      }, this.delay)
      return
    }
    queueMicrotask(settle)
  }

  /** 手动触发已排队的回包，返回触发数量。 */
  flush(): number {
    const queued = this.queue
    this.queue = []
    for (const run of queued) run()
    return queued.length
  }

  /** 只触发队列里指定的一个回包（「乱序回包」用例用）；索引越界返回 false。 */
  flushOne(index: number): boolean {
    if (index < 0 || index >= this.queue.length) return false
    const [run] = this.queue.splice(index, 1)
    if (run) run()
    return true
  }
}

/* ------------------------------------------------------------------- Geocoder */

export interface FakeV4PointLike {
  lng: number
  lat: number
}

export class FakeV4Geocoder {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** `getPoint` 的回包；`null` = 服务失败（真实 SDK 的失败形态：没有公开错误码入口） */
  pointResult: FakeV4PointLike | null = { lng: 116.404, lat: 39.915 }
  /** `getLocation` 的回包；`null` = 服务失败 */
  locationResult: Record<string, unknown> | null = {
    address: '北京市东城区天安门',
    point: { lng: 116.404, lat: 39.915 },
    business: '天安门',
    surroundingPois: [{ title: 'a' }, { title: 'b' }],
  }

  constructor(diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    // Geocoder 官方没有销毁入口 → 只进活动口径（见 diagnostics 的 leaks 说明）
    diagnostics?.serviceInstanceCreated()
  }

  getPoint(
    address: string,
    callback: (point: FakeV4PointLike | null) => void,
    city?: string,
  ): void {
    this.callLog.push(`getPoint:${address}:${city ?? ''}`)
    const result = this.pointResult
    this.queue.dispatch(() => callback(result))
  }

  getLocation(
    _point: unknown,
    callback: (result: Record<string, unknown> | null) => void,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push(`getLocation:${JSON.stringify(options ?? {})}`)
    const result = this.locationResult
    this.queue.dispatch(() => callback(result))
  }
}

/* ------------------------------------------------------------------ Convertor */

export class FakeV4Convertor {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** 回包状态码：0 = 成功 */
  status = 0
  /** 回包坐标；成功时官方只在 `status === 0` 提供 */
  points: FakeV4PointLike[] | null = [{ lng: 116.404, lat: 39.915 }]
  message: string | null = null

  constructor(diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    diagnostics?.serviceInstanceCreated()
  }

  translate(
    points: unknown[],
    from?: number,
    to?: number,
    callback?: (result: Record<string, unknown>) => void,
  ): void {
    this.callLog.push(`translate:${points.length}:${from ?? ''}->${to ?? ''}`)
    const payload: Record<string, unknown> = { status: this.status }
    if (this.status === 0 && this.points) payload.points = this.points
    if (this.message) payload.message = this.message
    this.queue.dispatch(() => callback?.(payload))
  }
}

/* ------------------------------------------------------------------- Boundary */

export class FakeV4Boundary {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** `boundaries` 为空数组 = 查无结果；`null` = 服务失败（没有公开错误码入口） */
  boundaries: string[] | null = ['116.30,39.90;116.31,39.91;116.30,39.90']

  constructor(diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    diagnostics?.serviceInstanceCreated()
  }

  get(name: string, callback: (result: { boundaries: string[] } | null) => void): void {
    this.callLog.push(`get:${name}`)
    const value = this.boundaries
    this.queue.dispatch(() => callback(value === null ? null : { boundaries: value }))
  }
}

/* ----------------------------------------------------------------- Geolocation */

export class FakeV4Geolocation {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** `getStatus()` 的回包；默认 0（BMAP_STATUS_SUCCESS） */
  status = 0
  /** `getCurrentPosition` 的回包；`null` = 无结果 */
  result: Record<string, unknown> | null = {
    point: { lng: 116.404, lat: 39.915 },
    accuracy: 30,
    address: { city: '北京市', district: '东城区' },
  }

  constructor(options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    diagnostics?.serviceInstanceCreated()
    this.callLog.push(`construct:${JSON.stringify(options)}`)
  }

  getCurrentPosition(
    callback: (result: Record<string, unknown> | null) => void,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push(`getCurrentPosition:${JSON.stringify(options ?? {})}`)
    const value = this.result
    this.queue.dispatch(() => callback(value))
  }

  getStatus(): number {
    return this.status
  }
}

/* ------------------------------------------------------------------- LocalCity */

export class FakeV4LocalCity {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  result: Record<string, unknown> | null = {
    name: '北京市',
    center: { lng: 116.404, lat: 39.915 },
    level: 12,
  }

  constructor(options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    diagnostics?.serviceInstanceCreated()
    this.callLog.push(`construct:${JSON.stringify(options)}`)
  }

  get(callback: (result: Record<string, unknown> | null) => void): void {
    this.callLog.push('get')
    const value = this.result
    this.queue.dispatch(() => callback(value))
  }
}

/* ---------------------------------------------------------------- Autocomplete */

/** 官方 `AutocompleteResult`：只有 `getNumPois` / `getPoi` 两个读法（`keyword` 是可选的）。 */
export class FakeV4AutocompleteResult {
  /** 检索关键字；`includeKeyword: false` 时不填充——用来验证「没有 keyword」的退化路径 */
  keyword?: string

  constructor(
    private readonly pois: Array<Record<string, unknown>>,
    keyword: string,
    includeKeyword = true,
  ) {
    if (includeKeyword) this.keyword = keyword
  }

  getNumPois(): number {
    return this.pois.length
  }

  getPoi(index: number): Record<string, unknown> | undefined {
    return this.pois[index]
  }
}

/**
 * 官方 `Autocomplete`：事件式服务，且**本身是 EventTarget**（`addEventListener` / `removeEventListener`），
 * Driver 的 EventDriver 正是通过这两个成员在它上面挂订阅——所以 Fake 也必须继承事件目标基类，
 * 否则「Service 释放时是否释放了 EventDriver 订阅」这条跨 Facet 路径在 Fake 上根本观察不到。
 */
export class FakeV4Autocomplete extends FakeV4EventTarget {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** 下一次 `search` 的结果条目 */
  pois: Array<Record<string, unknown>> = [
    { business: '天安门', province: '北京市', city: '北京市', district: '东城区' },
  ]
  /** `search()` 是否会回包（false = SDK 静默失败，用来验证超时 / 取消） */
  respond = true
  /** 回包是否带 `AutocompleteResult.keyword`（官方声明为可选，运行时是否填充未承诺） */
  includeKeyword = true
  /** 下一次 `dispose()` 抛出的错误（注入 SDK 销毁失败，用后即清） */
  failNextDispose: Error | null = null
  /** `dispose()` 期间同步执行的回调（用来注入「销毁钩子里重入 dispose」的场景） */
  onDispose: (() => void) | null = null

  readonly options: Record<string, unknown>

  /**
   * `diagnostics` 省略时自带一份**私有**诊断：`super()` 需要一个事件计数宿主，而这份影子
   * 对象不进任何 `createFakeBMapV4()` 的账（与其余服务「省略即不进诊断」的口径一致——
   * 生产路径上 `createFakeBMapV4` 一定会传入共享的那一份）。
   */
  constructor(options: Record<string, unknown> = {}, diagnostics = new FakeV4Diagnostics()) {
    super(diagnostics)
    this.queue = new FakeV4CallbackQueue(diagnostics)
    this.options = options
    this.callLog.push('construct')
    this.stats.resourceCreated('autocomplete', this)
  }

  search(keyword: string): void {
    this.callLog.push(`search:${keyword}`)
    if (!this.respond) return
    const results = new FakeV4AutocompleteResult(this.pois, keyword, this.includeKeyword)
    const onSearchComplete = this.options.onSearchComplete as
      | ((value: FakeV4AutocompleteResult) => void)
      | undefined
    this.queue.dispatch(() => onSearchComplete?.(results))
  }

  /** 官方 4.0.4 声明的实例更新入口；`ServiceDriver.setAutocompleteOptions` 的落点。 */
  setLocation(location: unknown): void {
    this.callLog.push(`setLocation:${String(location)}`)
    this.options.location = location
  }

  setTypes(types: string[]): void {
    this.callLog.push(`setTypes:${types.join(',')}`)
    this.options.types = types
  }

  /** 官方 `Autocomplete#dispose()`：Driver 的 dispose 入口会调用它 */
  dispose(): void {
    this.callLog.push('dispose')
    const reenter = this.onDispose
    const failure = this.failNextDispose
    if (failure) {
      this.failNextDispose = null
      throw failure
    }
    // 真实 SDK 的销毁流程可能触发业务回调（本仓库的 Map / Panorama 都已按「可能重入」防护）
    reenter?.()
    // 只有真的走完 dispose 才销账（失败路径保留账头，见 Panorama#destroy 同口径）；
    // 传实例：`dispose()` 每次都真的打到 SDK，重复 dispose 不能抵消别的实例的泄漏
    this.stats.resourceReleased('autocomplete', this)
  }
}


/* ----------------------------------------------------------------- LocalSearch */

/** 官方 `LocalResultPoi`：业务字段都可选，`marker` 只有 `onMarkersSet` 之后才可用。 */
export interface FakeV4LocalSearchPoiOptions {
  title?: string
  uid?: string
  point?: FakeV4Point
  address?: string
  city?: string
  province?: string
  phoneNumber?: string
  postcode?: string
  adcode?: string
  tags?: string[]
  isAccurate?: boolean
  url?: string
  detailUrl?: string
}

export class FakeV4LocalResultPoi {
  title: string
  uid: string
  point: FakeV4Point
  address?: string
  city?: string
  province?: string
  phoneNumber?: string
  postcode?: string
  adcode?: string
  tags?: string[]
  isAccurate?: boolean
  url?: string
  detailUrl?: string
  /** 官方声明里的标注对象：只有 `onMarkersSet` 之后才被赋上（本 Fake 不实现绘制） */
  marker?: unknown

  constructor(options: FakeV4LocalSearchPoiOptions = {}) {
    this.title = options.title ?? '未命名结果'
    this.uid = options.uid ?? 'fake-poi-' + this.title
    this.point = options.point ?? new FakeV4Point(116.404, 39.915)
    if (options.address !== undefined) this.address = options.address
    if (options.city !== undefined) this.city = options.city
    if (options.province !== undefined) this.province = options.province
    if (options.phoneNumber !== undefined) this.phoneNumber = options.phoneNumber
    if (options.postcode !== undefined) this.postcode = options.postcode
    if (options.adcode !== undefined) this.adcode = options.adcode
    if (options.tags !== undefined) this.tags = options.tags
    if (options.isAccurate !== undefined) this.isAccurate = options.isAccurate
    if (options.url !== undefined) this.url = options.url
    if (options.detailUrl !== undefined) this.detailUrl = options.detailUrl
  }
}

export interface FakeV4LocalResultOptions {
  keyword: string
  pois: FakeV4LocalResultPoi[]
  pageIndex?: number
  pageCapacity?: number
  city?: string
  province?: string
  center?: FakeV4Point
  radius?: number
  bounds?: FakeV4Bounds
  moreResultsUrl?: string
  suggestions?: string[]
  cityList?: Array<{ city: string; numResults: number }>
  /** `keyword` 是否随回包返回（官方声明为必填；这里留一个「运行时不回填」的开关） */
  includeKeyword?: boolean
}

/**
 * 官方 `LocalResult`：结果既可以用字段读（`keyword` / `city` / `radius` …），也必须能用
 * **官方声明的 getter 读**（`getPoi` / `getCurrentNumPois` / `getNumPois` / `getNumPages` /
 * `getPageIndex` / `getCityList` / `getCenter` / `getBounds`）——Driver 的投影走 getter，
 * 所以 Fake 不能只实现字段，否则测出来的是「投影读不到东西」而不是「SDK 没给数据」。
 *
 * 分页是**真的**：`getCurrentNumPois()` 只回本页条数、`getNumPois()` 回总数、
 * `getPageIndex()` 回当前页——翻页用例因此能断言「第 2 页只有剩下的那些」这类事实。
 */
export class FakeV4LocalResult {
  /** 本次检索的关键字（`includeKeyword === false` 时不填充） */
  keyword?: string
  city: string
  province: string
  center?: FakeV4Point
  radius?: number
  bounds?: FakeV4Bounds
  moreResultsUrl?: string
  suggestions?: string[]

  private readonly allPois: FakeV4LocalResultPoi[]
  private readonly pageCapacity: number
  private readonly cityList: Array<{ city: string; numResults: number }>
  /** 当前页码（0 基）：`gotoPage` 改写它，`getPoi` 的可见窗口随它移动 */
  pageIndex: number

  constructor(options: FakeV4LocalResultOptions) {
    if (options.includeKeyword !== false) this.keyword = options.keyword
    this.city = options.city ?? '北京市'
    this.province = options.province ?? '北京市'
    this.allPois = options.pois
    this.pageCapacity = options.pageCapacity ?? 10
    this.pageIndex = options.pageIndex ?? 0
    this.cityList = options.cityList ?? []
    if (options.center) this.center = options.center
    if (options.radius !== undefined) this.radius = options.radius
    if (options.bounds) this.bounds = options.bounds
    if (options.moreResultsUrl !== undefined) this.moreResultsUrl = options.moreResultsUrl
    if (options.suggestions !== undefined) this.suggestions = [...options.suggestions]
  }

  getNumPois(): number {
    return this.allPois.length
  }

  getCurrentNumPois(): number {
    return this.currentPage().length
  }

  getNumPages(): number {
    if (this.allPois.length === 0) return 0
    return Math.ceil(this.allPois.length / this.pageCapacity)
  }

  getPageIndex(): number {
    return this.pageIndex
  }

  getPoi(index: number): FakeV4LocalResultPoi | undefined {
    return this.currentPage()[index]
  }

  getCityList(): Array<{ city: string; numResults: number }> {
    return this.cityList
  }

  getCenter(): FakeV4Point | undefined {
    return this.center
  }

  getBounds(): FakeV4Bounds | undefined {
    return this.bounds
  }

  private currentPage(): FakeV4LocalResultPoi[] {
    const start = this.pageIndex * this.pageCapacity
    return this.allPois.slice(start, start + this.pageCapacity)
  }
}

/**
 * 官方 `LocalSearch`：**不绑输入框**的程序化检索服务。
 *
 * 三条刻意建模的运行时事实（与真实 SDK 一致，也是 Driver 归属契约的依据）：
 *
 * 1. 回包恒为异步（经 `FakeV4CallbackQueue`），因此「取消 / 超时之后回包才到达」可以显式摆出来；
 * 2. `getStatus()` 在**回包之前**就已被设好（Driver 在回调里读它）——失败时状态码非 0，而官方
 *    仍会触发 `onSearchComplete`（`gotoPage` 页码无效时状态是 5 = INVALID_REQUEST）；
 * 3. `pageCapacity` / `pageNum` 是构造选项，翻页真的按页切片。
 *
 * 与真实 SDK 的差异（**测试辅助**，非官方语义）都写在字段注释里：`respond` / `status` 用来
 * 摆出「不回包 / 服务失败」两种分支。
 */
export class FakeV4LocalSearch {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** 构造参数（`location` 与选项）：断言「构造字段变化才重建」时读它 */
  readonly options: Record<string, unknown>
  readonly location: unknown

  /** 测试辅助：检索词对应的结果点（分页由 `pageCapacity` 决定） */
  pois: FakeV4LocalSearchPoiOptions[] = [
    { title: '天安门', address: '北京市东城区东长安街', city: '北京市', province: '北京市' },
    { title: '故宫博物院', address: '北京市东城区景山前街4号', city: '北京市', province: '北京市' },
  ]
  /** 测试辅助：`search*` / `gotoPage` 是否回包（false = SDK 静默失败，用来验证超时 / 取消） */
  respond = true
  /** 测试辅助：回包结果是否带 `keyword`（官方声明为必填；运行时是否回填未承诺） */
  includeKeyword = true
  /** 测试辅助：注入的 `getStatus()` 值（回包前即生效） */
  status = 0
  /**
   * 测试辅助：强制下一次回包使用这个载荷。
   * `undefined` = 用检索结果（默认）；`null` = 「服务不可用」——官方仍会回调，只是参数为 null。
   */
  overridePayload?: FakeV4LocalResult | FakeV4LocalResult[] | null

  /** 测试辅助/内部：当前是否持有一份未清理的结果集（0→1 去重，见 `markResults`） */
  private hasResults = false
  /** 测试辅助：`clearResults()` 期间同步执行的回调（用后即清） */
  private reentered: (() => void) | null = null
  private readonly diagnostics: FakeV4Diagnostics | undefined
  /** 最近一次检索的载荷（`getResults()` 的返回值） */
  private lastPayload: FakeV4LocalResult | FakeV4LocalResult[] | null = null
  private lastCenter: FakeV4Point | null = null
  private lastRadius: number | null = null
  private lastBounds: FakeV4Bounds | null = null

  constructor(
    location: unknown,
    options: Record<string, unknown> = {},
    diagnostics?: FakeV4Diagnostics,
  ) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    this.diagnostics = diagnostics
    this.location = location
    this.options = options
    this.callLog.push('construct:' + JSON.stringify(options))
    // 官方 `LocalSearch` **没有** `dispose()`，因此实例本身不进泄漏门禁（随 GC 回收），只进活动
    // 口径（与 Geocoder / Boundary 等「无释放入口的服务」同档）；真正的资源是它**交付出去的结果集**
    // （含画在地图上的标注 / 结果面板），由 `clearResults()` 释放 —— 见 `markResults()`。
    diagnostics?.serviceInstanceCreated()
  }

  search(keyword: string | string[], option?: { forceLocal?: boolean }): void {
    this.callLog.push('search:' + String(keyword) + ':' + String(option?.forceLocal ?? ''))
    this.dispatchResult(keyword)
  }

  searchNearby(keyword: string | string[], center: unknown, radius: number): void {
    this.callLog.push('searchNearby:' + String(keyword) + ':' + String(center) + ':' + radius)
    if (center instanceof FakeV4Point) {
      this.lastCenter = center
      this.lastRadius = radius
    } else {
      // 官方语义：center 为字符串（城市名）时忽略 radius
      this.lastCenter = null
      this.lastRadius = null
    }
    this.dispatchResult(keyword)
  }

  searchInBounds(keyword: string | string[], bounds: unknown): void {
    this.callLog.push('searchInBounds:' + String(keyword) + ':' + String(bounds))
    this.lastBounds = bounds instanceof FakeV4Bounds ? bounds : null
    this.dispatchResult(keyword)
  }

  gotoPage(page: number): void {
    this.callLog.push('gotoPage:' + page)
    const results = this.currentResults()
    if (results.length === 0) {
      // 官方语义：页码无效（含「还没有任何结果」这种）时**仍会触发** `onSearchComplete`，
      // 并把状态设为 INVALID_REQUEST(5)。Fake 早期在这里直接 return，会把「首次翻页」建模成
      // timeout —— 照 Fake 推导就会得到错误结论（PR #89 复审 P2）。
      this.status = 5
      this.dispatchPayload(null)
      return
    }
    const total = Math.max(...results.map((result) => result.getNumPages()))
    // 官方：页码无效时仍触发 onSearchComplete，并把状态设为 INVALID_REQUEST(5)
    if (!Number.isInteger(page) || page < 0 || page >= total) {
      this.status = 5
      this.dispatchPayload(this.lastPayload)
      return
    }
    this.status = 0
    for (const result of results) result.pageIndex = page
    this.dispatchPayload(this.lastPayload)
  }

  getResults(): FakeV4LocalResult | FakeV4LocalResult[] | null {
    return this.lastPayload
  }

  /**
   * 官方 `LocalSearch#clearResults()`：清除最近一次检索的结果，**同时清除地图上的标注和结果面板**。
   *
   * 这是 LocalSearch 唯一的公开清理入口（官方声明里没有 `dispose()`），因此 Fake 把它建模成
   * 「释放已交付的结果集」——泄漏门禁的销账点。
   *
   * 测试辅助：`failNextClearResults` 注入一次失败（验证「失败不记账、可重试」）；
   * `onClearResults` 用来注入「清理期间重入释放」的重入场景。
   */
  clearResults(): void {
    this.callLog.push('clearResults')
    const failure = this.failNextClearResults
    if (failure) {
      this.failNextClearResults = null
      throw failure
    }
    this.lastPayload = null
    this.reentered = this.onClearResults
    this.reentered?.()
    this.releaseResults()
  }

  /** 测试辅助：下一次 `clearResults()` 抛出的错误（用后即清） */
  failNextClearResults: Error | null = null
  /** 测试辅助：`clearResults()` 期间同步执行的回调（注入「清理钩子里重入释放」） */
  onClearResults: (() => void) | null = null

  getStatus(): number {
    return this.status
  }

  setPageCapacity(capacity: number): void {
    this.callLog.push('setPageCapacity:' + capacity)
    this.options.pageCapacity = capacity
  }

  getPageCapacity(): number {
    return typeof this.options.pageCapacity === 'number' ? this.options.pageCapacity : 10
  }

  setPageNum(pageNum: number): void {
    this.callLog.push('setPageNum:' + pageNum)
  }

  getPageNum(): number {
    return 0
  }

  private currentResults(): FakeV4LocalResult[] {
    const payload = this.lastPayload
    if (!payload) return []
    return Array.isArray(payload) ? payload : [payload]
  }

  private dispatchResult(keyword: string | string[]): void {
    const keywords = Array.isArray(keyword) ? keyword : [keyword]
    const capacity = this.getPageCapacity()
    const results = keywords.map((item, index) =>
      this.createResult(item, index, capacity),
    )
    this.lastPayload = Array.isArray(keyword) ? results : results[0]!
    this.dispatchPayload(this.lastPayload)
  }

  private createResult(keyword: string, index: number, capacity: number): FakeV4LocalResult {
    return new FakeV4LocalResult({
      keyword,
      pois: this.pois.map((poi) => new FakeV4LocalResultPoi(poi)),
      pageCapacity: capacity,
      includeKeyword: this.includeKeyword,
      center: index === 0 ? this.lastCenter ?? undefined : undefined,
      radius: index === 0 ? this.lastRadius ?? undefined : undefined,
      bounds: index === 0 ? this.lastBounds ?? undefined : undefined,
      moreResultsUrl: 'https://map.baidu.com/search/' + keyword,
      suggestions: [keyword + ' 的结果建议'],
    })
  }

  /**
   * 交付一份结果集 ⇒ 记一笔「未清理的检索结果」。
   *
   * 同一实例任意时刻只可能有**一份**当前结果集（新检索会重画），因此用 `hasResults` 做 0→1 去重：
   * 诊断的 `resourceCreated` 是按次数累计的，重复登记会把同一份结果算成两份。
   */
  private markResults(): void {
    if (this.hasResults) return
    this.hasResults = true
    this.diagnostics?.resourceCreated('localSearchResults', this)
  }

  /** 结果集被清掉（`clearResults()`）：销账一次。 */
  private releaseResults(): void {
    if (!this.hasResults) return
    this.hasResults = false
    this.diagnostics?.resourceReleased('localSearchResults', this)
  }

  private dispatchPayload(payload: FakeV4LocalResult | FakeV4LocalResult[] | null): void {
    if (!this.respond) return
    const outgoing = this.overridePayload === undefined ? payload : this.overridePayload
    if (outgoing !== null && outgoing !== undefined) this.markResults()
    const onSearchComplete = this.options.onSearchComplete as
      | ((value: FakeV4LocalResult | FakeV4LocalResult[] | null) => void)
      | undefined
    this.queue.dispatch(() => onSearchComplete?.(outgoing))
  }
}

/* ------------------------------------------------------------------ 路线规划 */
/* M7-ROUTES / issue #39：DrivingRoute / WalkingRoute / RidingRoute / TransitRoute */

/** 结果里的端点（官方 `LocalResultPoi` 的最小子集：`title` / `point` / `uid`）。 */
export class FakeV4RoutePoi {
  title: string
  point: FakeV4Point
  uid: string

  constructor(options: { title?: string; point?: FakeV4Point; uid?: string } = {}) {
    this.title = options.title ?? '未命名地点'
    this.point = options.point ?? new FakeV4Point(116.404, 39.915)
    this.uid = options.uid ?? 'fake-route-poi-' + this.title
  }
}

/**
 * 官方 `Step`：**只实现投影真正读的成员**（`getIndex` / `getPosition` / `getDescription` /
 * `getDistance` / `getRouteIndex` / `getPlanIndex`），不补 getter 家族。
 *
 * `getDistance(format)` 与官方一致地按 `format` 返回数值 / 文本——投影两个都读，因此 Fake 必须
 * 两个都给，否则测出来的是「投影读不到」而不是「SDK 没给数据」。
 */
export class FakeV4RouteStep {
  constructor(
    private readonly index: number,
    private readonly point: FakeV4Point,
    private readonly distance: number,
    private readonly routeIndex: number,
    private readonly planIndex: number,
  ) {}

  getIndex(): number {
    return this.index
  }

  getPosition(): FakeV4Point {
    return this.point
  }

  getDescription(includeHtml: boolean): string {
    return includeHtml ? `<b>第${this.index}段</b>` : `第${this.index}段`
  }

  getDistance(format = true): string | number {
    return format ? `${this.distance}米` : this.distance
  }

  getRouteIndex(): number {
    return this.routeIndex
  }

  getPlanIndex(): number {
    return this.planIndex
  }
}

/** 官方 `Route`：驾车 / 步行 / 骑行方案里的路线，以及公交换乘里的步行段。 */
export class FakeV4Route {
  constructor(
    private readonly index: number,
    private readonly planIndex: number,
    private readonly distance: number,
    private readonly path: FakeV4Point[],
    private readonly stepCount: number,
    /** 官方 `BMAP_ROUTE_TYPE_*`：2 步行 / 3 驾车 / 6 骑行 */
    private readonly routeType: number,
  ) {}

  getIndex(): number {
    return this.index
  }

  getPlanIndex(): number {
    return this.planIndex
  }

  getRouteType(): number {
    return this.routeType
  }

  getDistance(format = true): string | number {
    return format ? `${(this.distance / 1000).toFixed(1)}公里` : this.distance
  }

  getPath(): FakeV4Point[] {
    return this.path
  }

  getNumSteps(): number {
    return this.stepCount
  }

  getStep(i: number): FakeV4RouteStep | undefined {
    if (i < 0 || i >= this.stepCount) return undefined
    return new FakeV4RouteStep(i, this.path[i] ?? this.path[0]!, 100 + i, this.index, this.planIndex)
  }
}

/** 官方 `RoutePlan`：`getNumRoutes` / `getRoute` / `getDistance` / `getDuration` / `getDragPois` / `getTaxiFare`。 */
export class FakeV4RoutePlan {
  constructor(
    private readonly routes: FakeV4Route[],
    private readonly distance: number,
    private readonly duration: number,
    private readonly options: { toll?: number; tollDistance?: number; taxiFare?: Record<string, unknown> } = {},
  ) {}

  getNumRoutes(): number {
    return this.routes.length
  }

  getRoute(i: number): FakeV4Route | undefined {
    return this.routes[i]
  }

  getDistance(format = true): string | number {
    return format ? `${(this.distance / 1000).toFixed(1)}公里` : this.distance
  }

  getDuration(format = true): string | number {
    return format ? `${Math.round(this.duration / 60)}分钟` : this.duration
  }

  getDragPois(): FakeV4RoutePoi[] {
    return []
  }

  getTaxiFare(): Record<string, unknown> | null {
    return this.options.taxiFare ?? null
  }

  /** 官方 `DrivingRoutePlan` 接口里的成员（4.0.4 的 `RoutePlan` 声明里没有）——可选读取的验证点。 */
  getToll(): number {
    return this.options.toll ?? 0
  }

  getTollDistance(): number {
    return this.options.tollDistance ?? 0
  }
}

/** 官方 `Line`：公交 / 地铁 / 火车 / 飞机 / 大巴线路。 */
export class FakeV4TransitLine {
  title: string

  constructor(
    title: string,
    private readonly lineType: number,
    private readonly viaStops: number,
    private readonly path: FakeV4Point[],
    private readonly distance: number,
  ) {
    this.title = title
  }

  getTitle(): string {
    return this.title
  }

  /** 官方把线路类型同时暴露成字段与 `getTitle()`；`type` 是字段（`Line#type`）。 */
  get type(): number {
    return this.lineType
  }

  getNumViaStops(): number {
    return this.viaStops
  }

  getGetOnStop(): FakeV4RoutePoi {
    return new FakeV4RoutePoi({ title: `${this.title}·上车站` })
  }

  getGetOffStop(): FakeV4RoutePoi {
    return new FakeV4RoutePoi({ title: `${this.title}·下车站` })
  }

  getDistance(format = true): string | number {
    return format ? `${(this.distance / 1000).toFixed(1)}公里` : this.distance
  }

  getPath(): FakeV4Point[] {
    return this.path
  }
}

/**
 * 官方 `TransitRoutePlan`。
 *
 * `getTotalType(i)` / `getTotal(i)` 是**官方的判别入口**（0 = `Route` / 1 = `Line`），Fake 如实
 * 建模两者的一致性：投影按 `getTotalType` 分流，`getTotal` 给出对应的那个对象。
 */
export class FakeV4TransitRoutePlan {
  constructor(
    private readonly segments: Array<{ type: 0 | 1; value: FakeV4Route | FakeV4TransitLine }>,
    private readonly distance: number,
    private readonly duration: number,
  ) {}

  getNumLines(): number {
    return this.segments.filter((segment) => segment.type === 1).length
  }

  getLine(i: number): FakeV4TransitLine | undefined {
    return this.segments.filter((segment) => segment.type === 1)[i]?.value as FakeV4TransitLine
  }

  getNumRoutes(): number {
    return this.segments.filter((segment) => segment.type === 0).length
  }

  getRoute(i: number): FakeV4Route | undefined {
    return this.segments.filter((segment) => segment.type === 0)[i]?.value as FakeV4Route
  }

  getDistance(format = true): string | number {
    return format ? `${(this.distance / 1000).toFixed(1)}公里` : this.distance
  }

  getDuration(format = true): string | number {
    return format ? `${Math.round(this.duration / 60)}分钟` : this.duration
  }

  getDescription(includeHtml: boolean): string {
    return includeHtml ? '<b>换乘一次</b>' : '换乘一次'
  }

  getLinesTitle(): string {
    const lines = this.segments.filter((segment) => segment.type === 1)
    return lines.map((segment) => (segment.value as FakeV4TransitLine).title).join(' → ')
  }

  getWalkDistance(): string {
    return '0.4公里'
  }

  getTotalType(i: number): 0 | 1 | undefined {
    return this.segments[i]?.type
  }

  getTotal(i: number): FakeV4Route | FakeV4TransitLine | undefined {
    return this.segments[i]?.value
  }

  getNumTotal(): number {
    return this.segments.length
  }
}

/** 官方路线结果（驾车 / 步行 / 骑行共用形状；`policy` 是**字段**）。 */
export class FakeV4RouteResult<TPlan> {
  policy: number

  constructor(
    private readonly start: FakeV4RoutePoi,
    private readonly end: FakeV4RoutePoi,
    private readonly plans: TPlan[],
    policy: number,
  ) {
    this.policy = policy
  }

  getStart(): FakeV4RoutePoi {
    return this.start
  }

  getEnd(): FakeV4RoutePoi {
    return this.end
  }

  getNumPlans(): number {
    return this.plans.length
  }

  getPlan(i: number): TPlan | undefined {
    return this.plans[i]
  }
}

/** 官方 `TransitRouteResult`：多一个 `getTransitType()`。 */
export class FakeV4TransitRouteResult extends FakeV4RouteResult<FakeV4TransitRoutePlan> {
  constructor(
    start: FakeV4RoutePoi,
    end: FakeV4RoutePoi,
    plans: FakeV4TransitRoutePlan[],
    policy: number,
    private readonly transitType: number,
  ) {
    super(start, end, plans, policy)
  }

  getTransitType(): number {
    return this.transitType
  }
}

/** 四个路线服务共用的替身基类（官方声明里它们的方法面几乎一致）。 */
export abstract class FakeV4RouteService {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** 构造参数（`location` 与选项）：断言「构造字段变化才重建」时读它 */
  readonly options: Record<string, unknown>
  readonly location: unknown

  /** 测试辅助：`search` 是否回包（false = SDK 静默失败，用来验证超时 / 取消） */
  respond = true
  /** 测试辅助：注入的 `getStatus()` 值（回包前即生效，与 LocalSearch 同口径） */
  status = 0
  /** 测试辅助：回包里的方案数（0 = 合法回包但没有路线 ⇒ Driver 应结算成 `empty`） */
  planCount = 1
  /** 测试辅助：强制下一次回包使用这个载荷（`null` = 服务不可用） */
  overridePayload?: unknown
  /** 测试辅助：下一次 `clearResults()` 抛出的错误（用后即清） */
  failNextClearResults: Error | null = null
  /** 测试辅助：`clearResults()` 期间同步执行的回调（注入「清理钩子里重入释放」） */
  onClearResults: (() => void) | null = null

  /** 测试辅助：`setPolylineStyle()` 的调用记录（Driver 目前不调用它；保留给形状探针） */
  readonly polylineStyles: unknown[] = []

  private hasResults = false
  private readonly diagnostics: FakeV4Diagnostics | undefined
  private readonly routeType: number

  constructor(
    location: unknown,
    options: Record<string, unknown> = {},
    diagnostics?: FakeV4Diagnostics,
    routeType = 3,
  ) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    this.diagnostics = diagnostics
    this.location = location
    this.options = options
    this.routeType = routeType
    this.callLog.push('construct:' + JSON.stringify(options))
    // 官方四个路线服务都**没有** `dispose()`，实例本身不进泄漏门禁（随 GC 回收），只进活动口径；
    // 真正的资源是它**交付出去的结果集**（地图上的折线 / 标注、写进 panel 的 DOM），
    // 由公开的 `clearResults()` 释放 —— 见 `markResults()`。
    diagnostics?.serviceInstanceCreated()
  }

  /** 官方 `search`：起终点 + （驾车才有的）选项。 */
  search(start: unknown, end: unknown, options?: Record<string, unknown>): void {
    this.callLog.push('search:' + JSON.stringify({ start, end, options: options ?? null }))
    if (!this.respond) return
    const payload = this.buildResult(start, end)
    if (payload === null) return
    const outgoing = this.overridePayload === undefined ? payload : this.overridePayload
    if (outgoing !== null && outgoing !== undefined) this.markResults()
    const onSearchComplete = this.options.onSearchComplete as
      | ((value: unknown) => void)
      | undefined
    this.queue.dispatch(() => onSearchComplete?.(outgoing))
  }

  getResults(): unknown {
    return null
  }

  getStatus(): number {
    return this.status
  }

  setPolylineStyle(style: unknown): void {
    this.callLog.push('setPolylineStyle')
    this.polylineStyles.push(style)
  }

  enableAutoViewport(): void {
    this.callLog.push('enableAutoViewport')
  }

  disableAutoViewport(): void {
    this.callLog.push('disableAutoViewport')
  }

  /**
   * 官方 `clearResults()`：清除最近一次检索的结果，**同时清除地图上的路线和标注**。
   *
   * 它是四个路线服务唯一的公开清理入口（官方声明里没有 `dispose()`），因此 Fake 把它建模成
   * 「释放已交付的结果集」——泄漏门禁的销账点。
   */
  clearResults(): void {
    this.callLog.push('clearResults')
    const failure = this.failNextClearResults
    if (failure) {
      this.failNextClearResults = null
      throw failure
    }
    this.releaseResults()
    this.onClearResults?.()
  }

  /** 回包不可用时返回 `null`（本 Fake 只在构造「无方案」时用到）。 */
  protected abstract buildResult(start: unknown, end: unknown): unknown | null

  /** 起终点原样回显（点 / 我们的 POI 引用都照读），用来断言「端点真的被转发到了 SDK」。 */
  protected echoEndpoint(value: unknown, fallbackTitle: string): FakeV4RoutePoi {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const point = record.point instanceof FakeV4Point
        ? record.point
        : record instanceof FakeV4Point
          ? record
          : new FakeV4Point(
              typeof record.lng === 'number' ? record.lng : 116.404,
              typeof record.lat === 'number' ? record.lat : 39.915,
            )
      const title = typeof record.title === 'string' ? record.title : fallbackTitle
      const uid = typeof record.uid === 'string' ? record.uid : undefined
      return new FakeV4RoutePoi(uid === undefined ? { title, point } : { title, point, uid })
    }
    return new FakeV4RoutePoi({ title: typeof value === 'string' ? value : fallbackTitle })
  }

  protected routeFor(planIndex: number, routeIndex: number, stepCount = 2): FakeV4Route {
    const path = Array.from({ length: stepCount }, (_, i) => new FakeV4Point(116.4 + i / 100, 39.9 + i / 100))
    return new FakeV4Route(routeIndex, planIndex, (planIndex + 1) * 1000, path, stepCount, this.routeType)
  }

  private markResults(): void {
    if (this.hasResults) return
    this.hasResults = true
    this.diagnostics?.resourceCreated('routeResults', this)
  }

  private releaseResults(): void {
    if (!this.hasResults) return
    this.hasResults = false
    this.diagnostics?.resourceReleased('routeResults', this)
  }
}

/** 官方 `DrivingRoute`（`search(start, end, { waypoints })`，**不接受字符串地址**）。 */
export class FakeV4DrivingRoute extends FakeV4RouteService {
  constructor(location: unknown, options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    super(location, options, diagnostics, 3)
  }

  protected buildResult(start: unknown, end: unknown): FakeV4RouteResult<FakeV4RoutePlan> {
    const plans = Array.from({ length: Math.max(0, this.planCount) }, (_, i) =>
      new FakeV4RoutePlan([this.routeFor(i, 0), this.routeFor(i, 1)], 1000 + i * 100, 600 + i * 60, {
        toll: i === 0 ? 10 : 0,
        tollDistance: i === 0 ? 500 : 0,
      }),
    )
    const policy = typeof this.options.policy === 'number' ? this.options.policy : 0
    return new FakeV4RouteResult(this.echoEndpoint(start, '起点'), this.echoEndpoint(end, '终点'), plans, policy)
  }
}

/** 官方 `WalkingRoute` / `RidingRoute`（`search(start, end)` 两参数签名）。 */
export class FakeV4WalkingRoute extends FakeV4RouteService {
  constructor(location: unknown, options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    super(location, options, diagnostics, 2)
  }

  protected buildResult(start: unknown, end: unknown): FakeV4RouteResult<FakeV4RoutePlan> {
    const plans = Array.from({ length: Math.max(0, this.planCount) }, (_, i) =>
      new FakeV4RoutePlan([this.routeFor(i, 0)], 800 + i * 100, 400 + i * 30),
    )
    return new FakeV4RouteResult(this.echoEndpoint(start, '起点'), this.echoEndpoint(end, '终点'), plans, 0)
  }
}

export class FakeV4RidingRoute extends FakeV4RouteService {
  constructor(location: unknown, options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    super(location, options, diagnostics, 6)
  }

  protected buildResult(start: unknown, end: unknown): FakeV4RouteResult<FakeV4RoutePlan> {
    const plans = Array.from({ length: Math.max(0, this.planCount) }, (_, i) =>
      new FakeV4RoutePlan([this.routeFor(i, 0)], 1200 + i * 100, 500 + i * 30),
    )
    return new FakeV4RouteResult(this.echoEndpoint(start, '起点'), this.echoEndpoint(end, '终点'), plans, 0)
  }
}

/** 官方 `TransitRoute`（`search(start, end)`；方案是「步行段 + 乘车段」序列）。 */
export class FakeV4TransitRoute extends FakeV4RouteService {
  /** 测试辅助：回包里跨城方案的交通方式策略 */
  transitTypePolicy: number | undefined
  /** 测试辅助：`getTransitType()` 的取值（0 市内 / 1 跨城） */
  transitType = 0

  constructor(location: unknown, options: Record<string, unknown> = {}, diagnostics?: FakeV4Diagnostics) {
    super(location, options, diagnostics, 3)
  }

  protected buildResult(start: unknown, end: unknown): FakeV4TransitRouteResult {
    const plans = Array.from({ length: Math.max(0, this.planCount) }, (_, i) => {
      const walk = this.routeFor(i, 0, 2)
      const line = new FakeV4TransitLine(`快速公交 ${i + 1} 号线`, 0, 5, [new FakeV4Point(116.41, 39.91)], 3000)
      return new FakeV4TransitRoutePlan(
        [
          { type: 0, value: walk },
          { type: 1, value: line },
        ],
        3000 + i * 500,
        900 + i * 60,
      )
    })
    const policy = typeof this.options.policy === 'number' ? this.options.policy : 0
    return new FakeV4TransitRouteResult(
      this.echoEndpoint(start, '起点'),
      this.echoEndpoint(end, '终点'),
      plans,
      policy,
      this.transitType,
    )
  }
}
