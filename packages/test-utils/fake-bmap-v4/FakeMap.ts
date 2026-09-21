/**
 * Fake BMap v4 Map（M3A2-MAP / issue #20）
 *
 * 行为依据：官方 JSAPI 4.0 `BMap.Map`（`v=4.0`）
 * - 构造参数 `new BMap.Map(idOrElement, options)`；`center` / `zoom` 也可在 options 中给出；
 * - 视野：`centerAndZoom` / `setCenter` / `setZoom` / `getCenter` / `getZoom` / `getBounds` / `getSize`；
 * - 旋转与倾斜：`setHeading` / `getHeading` / `setTilt` / `getTilt`；
 * - 交互：成对 `enable*` / `disable*` 方法（4.0 官方 API 参考里仍公开列出的运行时入口）；
 * - 投影：`pointToPixel` / `pixelToPoint`（不传 options 时按当前地图状态换算）；
 * - 资源释放：`destroy()` —— 清空 Map 自身监听器，但管不到子对象。
 *
 * 覆盖面刻意只到「Map Facet 会调用 + Capability Registry 会探测」的成员（`getViewport` / `setBounds`
 * 属后者：
 * `map.viewport` 能力要求 `getViewport` 与 `setViewport` 同时在位）。其余官方成员等真正有
 * Facet 或组件需要时再补，避免 Fake 先于实现膨胀；`FakeV4MapTypeId` 是例外——按**真实运行时**
 * 的形状整体给出（不是按类型声明，见其定义处的说明）。
 *
 * 与 `fake-bmapgl` 一致，**刻意不复刻** SDK 的数值归一化（heading 归一、tilt 截断）：
 * 这些是真实运行时的内部行为，Fake 只记录「传进去了什么」，跨 Fake 的共享契约因此只断言
 * 不依赖归一化的取值。真实数值行为由 M3A.3（#25）的浏览器 smoke 验证。
 *
 * 容器尺寸：happy-dom 没有布局引擎（`clientWidth` 恒为 0），因此 `getSize()` 从容器**内联样式**
 * 解析，`0` 表示零尺寸容器。这与「容器零尺寸时 create 不抛错、`checkResize()` 后按新尺寸重算」
 * 的验证目标一致。
 */
import { FakeV4EventTarget } from './event-target.ts'
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
import type { FakeV4Control, FakeV4Layer } from './controls-layers.ts'
import { FakeV4CustomOverlay } from './objects.ts'
import type { FakeV4ContextMenu, FakeV4InfoWindow, FakeV4Overlay } from './objects.ts'

/**
 * Fake 专用投影比例（像素/度）：以当前中心点为原点、`2 ** zoom` 线性映射。
 *
 * 不是真实墨卡托投影——只保证「往返精确」与「中心点落在容器中心」两条可断言性质，
 * 与 `fake-bmapgl` 使用同一公式，便于共享 Driver 契约在两个 Fake 上跑同一套断言。
 */
function fakePixelsPerDegree(zoom: number | null): number {
  return 2 ** (zoom ?? 12)
}

function readContainerSize(container: HTMLElement): FakeV4Size {
  const parse = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return new FakeV4Size(parse(container.style.width), parse(container.style.height))
}

/** 成对 `enable*` / `disable*` 方法名 → 交互状态键（与官方方法名逐一对应）。 */
export const FAKE_V4_INTERACTIONS = [
  'dragging',
  'inertialDragging',
  'scrollWheelZoom',
  'continuousZoom',
  'resizeOnCenter',
  'doubleClickZoom',
  'keyboard',
  'pinchToZoom',
  'rotate',
  'rotateGestures',
  'tilt',
  'tiltGestures',
] as const

export type FakeV4Interaction = (typeof FAKE_V4_INTERACTIONS)[number]

/**
 * 调用图层替身上的**可选摘除生命周期钩子**（`onDetached`）。
 *
 * 存在的理由：真实 SDK 的 `addLayer` / `removeLayer` 不只改账本，还会动**渲染**——DOMLayer 的
 * 节点就在 `removeLayer` 时从文档里被摘掉（issue #98 的 live 探针实测 `isConnected` 2 → 0）。
 * 替身若不建模这一条，「隐藏之后覆盖物仍在」这类断言会在**与真实相反**的方向上成立。
 *
 * ⚠️ **反向没有钩子**：重新 `addLayer` 真实 SDK **不会**重新渲染（同一个实例已经废了），
 * 所以这里也不提供「重挂载重渲染」——那正是内核「重新可见一律重建」要解决的。
 *
 * 钩子是**可选**的（不是每个替身都有渲染生命周期），所以用一次结构检查调用，而不是把它加进
 * `FakeV4Layer` 基类——基类加了就等于声称「所有图层都有这一步」。
 */
function callLayerHook(layer: FakeV4Layer, hook: "onDetached"): void {
  const candidate = (layer as unknown as Record<string, unknown>)[hook]
  if (typeof candidate === "function") (candidate as () => void).call(layer)
}

export class FakeV4Map extends FakeV4EventTarget {
  container: HTMLElement
  options: Record<string, unknown>
  center: FakeV4Point | null = null
  zoom: number | null = null
  heading = 0
  tilt = 0
  mapType: string | null = null
  mapStyle: Record<string, unknown> | null = null
  /** 交互开关的当前状态（键为官方方法名派生，见 `FAKE_V4_INTERACTIONS`）。 */
  readonly interactions: Record<string, boolean> = {}
  /** `startViewAnimation` 最近一次传入的实例，供 `cancelViewAnimation` 断言。 */
  lastAnimation: unknown = null
  canceledAnimation: unknown = null
  /** `centerAndZoom` / `setHeading` / `setTilt` 最近一次传入的 options。 */
  lastViewOptions: Record<string, unknown> | null = null
  resizeCalls = 0
  destroyed = false
  /** `load` 是否已经派发过（官方只在首次 `centerAndZoom` 后派发一次）。 */
  loadEmitted = false
  readonly callLog: string[] = []

  /* ------------------------------------------------------------ 子资源容器（#21） */

  /** 当前挂在地图上的覆盖物（顺序即 `addOverlay` 顺序）。 */
  readonly overlays: FakeV4Overlay[] = []
  /** 当前打开的 InfoWindow（官方同一张地图同时只有一个）。 */
  infoWindow: FakeV4InfoWindow | null = null
  /**
   * 气泡内容节点的宿主（`data-fake-bubble-host`），首次打开时懒建。
   *
   * 建模真实 4.0 的「SDK 把内容节点搬进自己的容器」——见 `attachBubbleContent`。
   */
  bubbleHost: HTMLElement | null = null
  /**
   * 自定义覆盖物业务 DOM 的容器（`data-fake-overlay-pane`），首次挂载自定义覆盖物时懒建。
   *
   * 属于**地图**：组件卸载后容器仍在地图上（只是里面空了），与 `bubbleHost` 同一条口径。
   */
  overlayPane: HTMLElement | null = null
  /** 已挂载的右键菜单（官方入口是 `map.addContextMenu`）。 */
  readonly contextMenus: FakeV4ContextMenu[] = []
  /**
   * `destroy()` 被调用时仍挂在地图上的覆盖物数量。
   *
   * 跨 Facet 不变式（见 ADR 2026-09-11-jsapi-v4-map-facet 的「跨 Facet 交接风险」）：
   * 参考实现与 `MapRuntime.dispose()` 都要求**先摘掉子资源、再销毁 Map**，否则 SDK 的异步
   * 瓦片/raf 在 destroy 之后仍会访问已被释放的覆盖物数据。这个计数让「有没有先摘」可断言。
   */
  destroyedWithOverlays: number | null = null

  /* ------------------------------------------------------ 控件与图层容器（#22） */

  /** 当前挂在地图上的控件（顺序即 `addControl` 顺序）。 */
  readonly controls: FakeV4Control[] = []
  /** 当前挂在地图上的图层（顺序即 `addLayer` 顺序）。 */
  readonly layers: FakeV4Layer[] = []
  /** 同 `destroyedWithOverlays`：控件是否在销毁前被摘掉。 */
  destroyedWithControls: number | null = null
  /** 同 `destroyedWithOverlays`：图层是否在销毁前被摘掉。 */
  destroyedWithLayers: number | null = null
  /**
   * 测试故障注入：让**下一次** `addControl` / `addLayer` 抛错（用后即清）。
   *
   * 用途是驱动侧的「挂载失败后记账必须回滚」这条路径——真实 SDK 会在 `addControl` 内部调用
   * 业务控件的 `initialize()`，那一步抛错时资源并没有挂上（同 `FakeV4ViewAnimation.failNextCancel`
   * 的口径：故障路径也要能被模型出来，否则回归测试无从下手）。
   */
  failNextAddControl: Error | null = null
  failNextAddLayer: Error | null = null
  /**
   * 测试故障注入：让**下一次** `addLayer` **先真的挂上、再抛错**（用后即清）。
   *
   * 与 `failNextAddLayer`（抛在挂载之前）是两条不同的路径，必须分开建模：
   * 前者是「什么都没发生」，后者是「**副作用已经产生**但调用方收到异常」——真实 SDK 里
   * `addLayer` 会在内部访问地图与图层管理器，抛错可能发生在资源已经登记之后。
   * 把这条形状建出来的用途是：调用方的错误补偿必须**best-effort 摘除**，不能只看
   * 「调用成功返回」的记账（见 `useLayerResource` 的 mount 补偿）。
   */
  failNextAddLayerAfterAttach: Error | null = null
  /**
   * 测试故障注入：让**下一次** `removeLayer` **在摘掉之前**抛错（用后即清）。
   *
   * 形状与 `failNextAddLayerAfterAttach` 对偶，但方向更危险：`addLayer` 抛错时资源是「多了」，
   * 而 `removeLayer` 抛错时资源是「**摘不掉**」——真实 SDK 里 `removeLayer` 会访问地图与图层
   * 管理器，抛错可能发生在真正摘除之前，于是**图层仍在图上**。调用方如果按「调用过就复位记账」
   * 处理，之后再也没有第二次机会，SDK 上就留下孤儿。
   */
  failNextRemoveLayer: Error | null = null
  /**
   * 测试故障注入：让**下一次** `removeLayer` **先真的摘掉、再抛错**（用后即清）。
   *
   * 与 `failNextRemoveLayer`（摘之前抛）是**两条不同的状态机路径**，必须分开建模。
   *
   * 早先这里只建模了前者，理由是「已经摘掉再抛错时，重试 `removeLayer` 是无害 no-op」。那只看了
   * `removeLayer` 自己，没有看完整状态机：调用方**唯一能观测的**「挂没挂上」证据就是调用有没有
   * 成功返回。这条路径下 SDK 已经 detached，而调用方收到的却是异常 ⇒ 如果它把「还挂着」当成
   * 结论记下来，就再也挂不回来了（`visible: true → false → true` 之后图上什么都没有）。
   */
  failNextRemoveLayerAfterDetach: Error | null = null
  /**
   * **悲观契约模式**：让 `removeLayer` 在目标**不在图上**时抛错（**粘性**，不随调用清除）。
   *
   * 为什么需要一条粘性策略，而不只是一次性注入：官方对「`map.removeLayer()` 传入一个**已经摘掉**
   * 的图层」**没有任何说明**，而替身对「不在数组里的 layer」天然是 no-op——于是任何依赖「重复摘除
   * 是安全的」的算法都会被替身的宽容悄悄放行。
   *
   * 打开这个模式等于把契约换成**最悲观的那一侧**（重复摘除会抛错），让那条依赖显式暴露出来：
   * 三态收敛（`unknown` ⇒ 先 best-effort 摘一次、再挂）正是依赖它的一处。用例据此钉住
   * 「在悲观契约下退化到什么程度」，而不是让依赖只活在注释里。
   */
  failRemoveLayerWhenDetached: Error | null = null
  /**
   * 测试故障注入：让**下一次** `centerAndZoom()` 抛错（用后即清）。
   *
   * 用来驱动「建图成功、但 `initializeView()` 失败 → `retry()` 重建」这条路径（M4-EVENTS / #28）：
   * `MapRuntime` 的 `whenMapCreated` 注册必须在失败之后仍然有效，第二张图的 `load` 才收得到。
   */
  failNextCenterAndZoom: Error | null = null
  /**
   * 测试故障注入：让**下一次** `openInfoWindow` 抛错（用后即清）。抛在接管之前 ⇒ 没有 `open` 回调。
   */
  failNextOpenInfoWindow: Error | null = null
  /**
   * 测试故障注入：让**下一次** `closeInfoWindow` 抛错（用后即清）。抛在关闭之前 ⇒ 气泡仍开着，
   * 也没有 `close` 回调。
   */
  failNextCloseInfoWindow: Error | null = null

  /* ------------------------------------------------------------------ 覆盖物 */

  addOverlay(overlay: FakeV4Overlay): void {
    this.callLog.push('addOverlay')
    if (this.overlays.includes(overlay)) return
    this.overlays.push(overlay)
    overlay.attachedMap = this
    this.attachCustomOverlayDom(overlay)
    this.stats.resourceCreated('overlay')
  }

  /**
   * 注入一次 `removeOverlay` 失败（**摘除之前**抛：覆盖物仍留在 `overlays` 上）。
   *
   * 与 `failNextRemoveLayer` 同形。用途是「逐资源摘除」的**部分失败**：`clear()` 是逐条隔离的，
   * 注入之后会得到「一部分真的摘掉了、剩下的还在」的半拆状态 —— 这正是「旧引擎还能不能算被保留」
   * 的判别点。
   */
  failNextRemoveOverlay: Error | null = null
  /**
   * 与 `failNextRemoveOverlay` 对偶：**先摘掉、再抛错**（用后即清）。
   *
   * 用它区分「摘除失败」的两种合法形状 —— 摘之前抛（覆盖物仍在图上）与摘之后抛（已经不在了）。
   * 调用方在这种异常之后**无法判断**覆盖物还在不在，因此不能按「还在」处理（会留下一份幻影
   * 所有权），也不能按「不在」处理（会重复挂一份）。
   */
  failNextRemoveOverlayAfterDetach: Error | null = null

  removeOverlay(overlay: FakeV4Overlay): void {
    this.callLog.push('removeOverlay')
    if (this.failNextRemoveOverlay) {
      const error = this.failNextRemoveOverlay
      this.failNextRemoveOverlay = null
      throw error
    }
    const index = this.overlays.indexOf(overlay)
    if (index >= 0) {
      this.overlays.splice(index, 1)
      this.stats.resourceReleased('overlay')
    }
    if (overlay.attachedMap === this) overlay.attachedMap = null
    this.detachCustomOverlayDom(overlay)
    const afterDetach = (overlay as { failNextRemoveAfterDetach?: Error | null }).failNextRemoveAfterDetach
    if (afterDetach) {
      ;(overlay as { failNextRemoveAfterDetach?: Error | null }).failNextRemoveAfterDetach = null
      throw afterDetach
    }
  }

  /**
   * 把自定义覆盖物的业务 DOM 搬进本张地图的「覆盖物容器」（M5-CUSTOM-MENU / #33）。
   *
   * 真实 4.0 实测：`map.addOverlay(customOverlay)` 之后业务 DOM 位于 `bmap-container` **内部**
   * （不是顶层），`removeOverlay` 之后随之撤离。替身不建模这一步的话，「卸载后宿主不残留」
   * 在与真实相反的方向上也会成立——夹具比真实宽容就会掩盖缺陷（`AGENTS.md` 的既有教训，
   * 与 `attachBubbleContent` 同一条理由）。
   *
   * 只有 `CustomOverlay` 会带 `domCreate`（其它覆盖物的 DOM 由 SDK 自己造），因此这里按**构造器身份**
   * 分流，而不是按「有没有某个字段」猜。
   */
  private attachCustomOverlayDom(overlay: FakeV4Overlay): void {
    if (!(overlay instanceof FakeV4CustomOverlay)) return;
    const element = overlay.domCreate()
    if (!(element instanceof HTMLElement)) return
    if (!this.overlayPane) {
      this.overlayPane = document.createElement('div')
      this.overlayPane.setAttribute('data-fake-overlay-pane', '')
      this.container.appendChild(this.overlayPane)
    }
    this.overlayPane.appendChild(element)
    overlay.domElement = element
  }

  /** 摘除自定义覆盖物的业务 DOM（`removeOverlay` 的收尾；不销毁元素本身——它由组件拥有）。 */
  private detachCustomOverlayDom(overlay: FakeV4Overlay): void {
    if (!(overlay instanceof FakeV4CustomOverlay)) return;
    const element = overlay.domElement
    overlay.domElement = null
    if (!element) return
    if (element.parentElement === this.overlayPane) this.overlayPane?.removeChild(element)
  }

  /**
   * 把气泡内容节点搬进本张地图的「气泡容器」。
   *
   * 真实 4.0 在打开时会把传入的内容节点挂进自己的容器（这也是「Vue 不该把 SDK 会搬走的节点
   * 当成自己的 shell」这条设计约束的**唯一后果**）。替身若不建模它，
   * 「卸载后 host 无残留」「内容可见」这两条在与真实相反的方向上也会成立 —— 那正是
   * `AGENTS.md` 说的「夹具比真实宽容会掩盖缺陷」。
   */
  private attachBubbleContent(content: string | HTMLElement): void {
    if (!(content instanceof HTMLElement)) return;
    if (!this.bubbleHost) {
      this.bubbleHost = document.createElement("div");
      // 气泡容器属于**地图**，不属于任何组件：组件卸载时它仍在地图上（没有气泡内容而已）
      this.bubbleHost.setAttribute("data-fake-bubble-host", "");
      this.container.appendChild(this.bubbleHost);
    }
    this.bubbleHost.appendChild(content);
  }

  /**
   * 关闭气泡：SDK 拆掉的是**自己的容器**，而**不**负责回收我们交给它的内容节点。
   *
   * 这条刻意的悲观建模让「宿主由谁释放」变成可区分的读数（`content.parentElement === null`
   * 只可能由**我们**的释放路径产生）：真实 4.0 是否会在关闭时把传入的节点摘掉没有公开承诺，
   * 夹具按「不会」建模 —— 组件因此必须自己 `remove()`，否则节点会留在（已脱离文档的）容器里。
   */
  private teardownBubbleHost(): void {
    this.bubbleHost?.remove();
    this.bubbleHost = null;
  }

  /**
   * 让 `openInfoWindow` 变成**异步生效**（真机语义）。
   *
   * ADR 2026-09-11 的真实 AK 实测：`map.openInfoWindow()` 之后**同一 tick**
   * `map.getInfoWindow()` 仍是 `null`（约 100ms 后才变成该实例），因此同一 tick 里的
   * `map.closeInfoWindow()` 是 **no-op**。默认关闭这条行为（同步接管），需要复现那个时序的
   * 用例打开它，再调 `flushInfoWindowOpen()` 放行。
   */
  deferInfoWindowOpen = false
  /** 已经请求打开、但还没被 SDK 接管的气泡（`deferInfoWindowOpen` 打开时才有值）。 */
  private pendingInfoWindow: { infoWnd: FakeV4InfoWindow; point: FakeV4Point } | null = null

  /**
   * 让 `closeInfoWindow()` 的 `close` 事件延迟派发（关闭副作用立即发生）。
   * 只暂存事件，并把当时被关掉的那个实例记下来供 `flushInfoWindowCloseEvent()` 放行。
   */
  deferInfoWindowCloseEvent = false
  /** 被暂存起来、等着晚一点派发 `close` 的那个实例（`deferInfoWindowCloseEvent` 打开时才有值）。 */
  private pendingInfoWindowClose: { infoWnd: FakeV4InfoWindow } | null = null

  openInfoWindow(infoWnd: FakeV4InfoWindow, point: FakeV4Point): void {
    this.callLog.push('openInfoWindow')
    if (this.failNextOpenInfoWindow) {
      const error = this.failNextOpenInfoWindow
      this.failNextOpenInfoWindow = null
      // 刻意**在接管之前**抛出：气泡没有被打开，也不会有 `open` 回调（见该字段的说明）。
      throw error
    }
    if (this.deferInfoWindowOpen) {
      // 异步生效：这一刻只记下请求，地图的「当前气泡」与事件都还没变
      this.pendingInfoWindow = { infoWnd, point }
      return
    }
    this.adoptInfoWindow(infoWnd, point)
  }

  /** 放行一次挂起的打开（模拟 SDK 迟一步接管）。没有挂起请求时是 no-op。 */
  flushInfoWindowOpen(): boolean {
    const pending = this.pendingInfoWindow
    this.pendingInfoWindow = null
    if (!pending) return false
    this.adoptInfoWindow(pending.infoWnd, pending.point)
    return true
  }

  /** 当前有没有「已请求打开、尚未接管」的气泡。 */
  hasPendingInfoWindow(): boolean {
    return this.pendingInfoWindow !== null
  }

  /** 放行一条被推迟的 `close` 事件（只派发事件，不改地图状态）。 */
  flushInfoWindowCloseEvent(): boolean {
    const pending = this.pendingInfoWindowClose
    this.pendingInfoWindowClose = null
    if (!pending) return false
    pending.infoWnd.emit('close')
    return true
  }

  /** 当前有没有「已生效、但 `close` 事件尚未派发」的关闭。 */
  hasPendingInfoWindowCloseEvent(): boolean {
    return this.pendingInfoWindowClose !== null
  }

  /** SDK 真正接管气泡：改「当前气泡」、挂内容节点、派发 `open`。 */
  private adoptInfoWindow(infoWnd: FakeV4InfoWindow, point: FakeV4Point): void {
    const previous = this.infoWindow
    // 官方同一张地图只有一个气泡处于打开状态：换一个实例就先把上一个销账，
    // 否则诊断会把「被顶掉的那个」永久记成泄漏（见 diagnostics 的 leaks.infoWindows 口径）
    if (previous && previous !== infoWnd) {
      this.stats.resourceReleased('infoWindow')
      // 被顶掉的气泡容器也要拆掉：同一时刻地图上只显示一个气泡
      this.teardownBubbleHost()
    }
    const isNew = previous !== infoWnd
    this.infoWindow = infoWnd
    infoWnd.openedAt = point
    infoWnd.open = true
    // 记下「它现在在哪张地图上」：官方 4.0 的实例级 `InfoWindow#close()` 需要这个信息
    infoWnd.enclosingMap = this
    this.attachBubbleContent(infoWnd.content)
    if (isNew) this.stats.resourceCreated('infoWindow')
    infoWnd.emit('open')
  }

  /** 官方语义：关闭本张地图**当前**打开的气泡（不接收实例参数）。 */
  closeInfoWindow(): void {
    this.callLog.push('closeInfoWindow')
    if (this.failNextCloseInfoWindow) {
      const error = this.failNextCloseInfoWindow
      this.failNextCloseInfoWindow = null
      throw error
    }
    // 副作用立即发生（没有当前气泡时是 no-op）
    const closed = this.applyInfoWindowClose()
    if (this.deferInfoWindowCloseEvent && closed) {
      // **只有事件**被推迟：记下当时被关掉的那个实例，等用例放行时再派发它的 `close`
      this.pendingInfoWindowClose = { infoWnd: closed }
      return
    }
    closed?.emit('close')
  }

  /** 真正执行一次关闭：改「当前气泡」、拆容器、置 `open = false`。返回被关掉的那个实例。 */
  private applyInfoWindowClose(): FakeV4InfoWindow | null {
    const current = this.infoWindow
    this.infoWindow = null
    if (!current) return null
    this.stats.resourceReleased('infoWindow')
    this.teardownBubbleHost()
    current.open = false
    current.enclosingMap = null
    return current
  }

  /**
   * 模拟用户点击气泡的关闭按钮：立即清掉当前气泡，并按 `shape` 派发事件序列。
   * 真实 4.0 的形状是「`close` 恰好一条 + `clickclose` 随打开次数累积」，顺序不固定。
   */
  clickInfoWindowCloseButton(
    options: { shape?: Array<"close" | "clickclose"> } = {},
  ): boolean {
    const current = this.infoWindow
    if (!current) return false
    this.applyInfoWindowClose()
    for (const name of options.shape ?? ["close", "clickclose"]) {
      current.emit(name)
    }
    return true
  }

  getInfoWindow(): FakeV4InfoWindow | null {
    return this.infoWindow
  }

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

  /* ------------------------------------------------------------------ 控件 */

  /**
   * 挂载控件。
   *
   * 与官方一致：内部调用控件的 `initialize(map)` 取 DOM（自定义控件契约），
   * **成功之后才登记**（`initialize` 抛错时 DOM 都没建出来，控件并没有挂上——这条顺序是
   * 「挂载失败后 Driver 必须回滚记账」那条路径的前提，见 `failNextAddControl`）。
   *
   * **不**去重：「同一实例只添加一次」是调用方的责任（官方「常见错误」之一），Driver 侧据此
   * 自己记账；Fake 若顺手去重就会把 Driver 的记账错误掩盖成「看起来对」。
   */
  addControl(control: FakeV4Control): void {
    this.callLog.push('addControl')
    if (this.failNextAddControl) {
      const error = this.failNextAddControl
      this.failNextAddControl = null
      throw error
    }
    control.initialize?.(this)
    this.controls.push(control)
    control.attachedMap = this
    this.stats.resourceCreated('control')
  }

  /** 官方 `removeControl`：移除容器，控件实例本身保留（可再次 `addControl`）。 */
  removeControl(control: FakeV4Control): void {
    this.callLog.push('removeControl')
    const index = this.controls.indexOf(control)
    if (index >= 0) {
      this.controls.splice(index, 1)
      this.stats.resourceReleased('control')
    }
    if (control.attachedMap === this) control.attachedMap = null
  }

  /* ------------------------------------------------------------------ 图层 */

  /**
   * 统一图层挂载入口（官方 4.0 的 `addLayer`；`addDistrictLayer` / `addTileLayer` 已 deprecated）。
   *
   * 与 `addControl` 一样**不**去重、也不按家族标志位分发：去重会把「Driver 是否自己记账」
   * 这件事掩盖成「看起来对」，而按标志位分发会把「Driver 是否用了正确的统一入口」藏起来。
   * 官方手册也把「同一图层重复添加」列为调用方的误用。
   */
  addLayer(layer: FakeV4Layer): void {
    this.callLog.push('addLayer')
    if (this.failNextAddLayer) {
      const error = this.failNextAddLayer
      this.failNextAddLayer = null
      throw error
    }
    this.layers.push(layer)
    layer.attachedMap = this
    this.stats.resourceCreated('layer')
    // 刻意**不**调用任何「重挂载重渲染」钩子：真实 4.0 的 removeLayer 会清空图层持有的 Map 引用，
    // 之后再 addLayer 不会重新渲染（issue #98 的 live 读数），补 setData 还会内部抛错。
    // 也就是说「摘掉之后再挂上」只能靠**换新实例**——内核因此改成重建，替身这里不补钩子。
    if (this.failNextAddLayerAfterAttach) {
      const error = this.failNextAddLayerAfterAttach
      this.failNextAddLayerAfterAttach = null
      throw error
    }
  }

  removeLayer(layer: FakeV4Layer): void {
    this.callLog.push('removeLayer')
    if (this.failNextRemoveLayer) {
      const error = this.failNextRemoveLayer
      this.failNextRemoveLayer = null
      // 刻意**在摘除之前**抛出：图层仍然留在 `this.layers` 上（见该字段的说明）。
      throw error
    }
    const index = this.layers.indexOf(layer)
    if (index < 0 && this.failRemoveLayerWhenDetached) {
      // 悲观契约：目标不在图上 ⇒ 抛错（粘性，见该字段说明）。
      throw this.failRemoveLayerWhenDetached
    }
    if (index >= 0) {
      this.layers.splice(index, 1)
      this.stats.resourceReleased('layer')
      // 摘挂的渲染生命周期（实测建模）：真实 4.0 的 removeLayer 会把图层渲染出来的东西摘掉
      // —— DOMLayer 的节点会从文档移除（#98 live 探针：isConnected 2 → 0）。
      // 只在**真的在图上**时调用；对已经摘下的实例重复 removeLayer 不产生副作用（与实测一致）。
      callLayerHook(layer, "onDetached")
    }
    if (layer.attachedMap === this) layer.attachedMap = null
    if (this.failNextRemoveLayerAfterDetach) {
      const error = this.failNextRemoveLayerAfterDetach
      this.failNextRemoveLayerAfterDetach = null
      // 摘除**已经生效**，调用方却收到异常（见该字段的说明）。
      throw error
    }
  }

  constructor(
    container: string | HTMLElement,
    options: Record<string, unknown> = {},
    stats: FakeV4Diagnostics,
  ) {
    super(stats)
    this.container =
      typeof container === 'string'
        ? document.getElementById(container) ?? document.createElement('div')
        : container
    this.options = options
    // 生命周期类：传实例，让「同一实例重复销毁」与「另一个实例真的被释放」可区分
    this.stats.resourceCreated('map', this)
  }

  /* ---------------------------------------------------------------- 容器与尺寸 */

  getSize(): FakeV4Size {
    return readContainerSize(this.container)
  }

  /**
   * 官方 `Map#getContainer()`：自定义控件的 `initialize(map)` 通过它拿挂载容器
   * （官方 Skill `references/controls-and-context-menu.md` 的自定义控件示例即如此）。
   */
  getContainer(): HTMLElement {
    return this.container
  }

  checkResize(): void {
    this.callLog.push('checkResize')
    this.resizeCalls++
  }

  /* ------------------------------------------------------------------ 视野 */

  centerAndZoom(
    point: FakeV4Point | string,
    zoom?: number,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push('centerAndZoom')
    if (this.failNextCenterAndZoom) {
      const error = this.failNextCenterAndZoom
      this.failNextCenterAndZoom = null
      throw error
    }
    this.center = typeof point === 'string' ? new FakeV4Point(0, 0) : point
    if (typeof zoom === 'number') this.zoom = zoom
    this.lastViewOptions = options ?? null
    // 官方语义：`load` 在**首次** centerAndZoom 之后派发一次（后续 centerAndZoom 不再派发）。
    // 夹具照实建模，否则「订阅者能不能收到 load」这件事在单测里无法验证（#28 评审 P1）。
    if (!this.loadEmitted) {
      this.loadEmitted = true
      this.emit('load', { point: this.center, zoom: this.zoom })
    }
  }

  setCenter(point: FakeV4Point | string, options?: Record<string, unknown>): void {
    this.callLog.push('setCenter')
    this.center = typeof point === 'string' ? new FakeV4Point(0, 0) : point
    if (options) this.lastViewOptions = options
  }

  getCenter(): FakeV4Point | null {
    return this.center
  }

  setZoom(zoom: number, options?: Record<string, unknown>): void {
    this.callLog.push('setZoom')
    this.zoom = zoom
    if (options) this.lastViewOptions = options
  }

  getZoom(): number | null {
    return this.zoom
  }

  /** 按中心点与级别推导的可视范围（空范围 = 尚未初始化，与官方 `getBounds()` 语义一致）。 */
  getBounds(): FakeV4Bounds {
    if (!this.center || this.zoom === null) return new FakeV4Bounds()
    const halfLng = 180 / 2 ** this.zoom
    const halfLat = halfLng / 2
    return new FakeV4Bounds(
      new FakeV4Point(this.center.lng - halfLng, this.center.lat - halfLat),
      new FakeV4Point(this.center.lng + halfLng, this.center.lat + halfLat),
    )
  }

  /**
   * 官方 `Map#setBounds(bounds)`：把视野设到给定范围。
   *
   * 这个成员**不是任何 Facet 调用的**，补它是因为 Capability Catalog 的 `map.bounds`
   * 把 `setBounds` 列进了 `rawMembers`（「会探测」那一类）。缺它会让
   * `supports("map.bounds")` 在 fixture 档报 false、与真实引擎的读数不一致
   * ——「夹具与真实不一致」正是 #74 那条教训要消掉的东西（#29 评审 P1）。
   *
   * 换算与 `getBounds()` 近似互逆（一半经度跨度 = `180 / 2 ** zoom`）；Fake 不复刻 SDK 的
   * 数值归一化，只保证「调用发生后视野确实变了」。
   */
  setBounds(bounds: FakeV4Bounds): void {
    this.callLog.push("setBounds")
    const center = bounds.getCenter()
    if (!center) return
    this.center = center
    const span = bounds.toSpan().lng
    if (span > 0) this.zoom = Math.log2(360 / span)
  }

  setViewport(view: FakeV4Point[] | FakeV4Point | { center?: FakeV4Point; zoom?: number }, options?: unknown): void {
    this.callLog.push('setViewport')
    void options
    if (Array.isArray(view) && view.length > 0) {
      const lngs = view.map((point) => point.lng)
      const lats = view.map((point) => point.lat)
      this.center = new FakeV4Point(
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      )
      this.zoom = 12
      return
    }
    const viewport = view as { center?: FakeV4Point; zoom?: number }
    if (viewport.center) this.center = viewport.center
    if (typeof viewport.zoom === 'number') this.zoom = viewport.zoom
  }

  getViewport(view: FakeV4Point[] | FakeV4Bounds): { center: FakeV4Point; zoom: number } {
    this.callLog.push('getViewport')
    if (Array.isArray(view) && view.length > 0) {
      const lngs = view.map((point) => point.lng)
      const lats = view.map((point) => point.lat)
      return {
        center: new FakeV4Point(
          (Math.min(...lngs) + Math.max(...lngs)) / 2,
          (Math.min(...lats) + Math.max(...lats)) / 2,
        ),
        zoom: 12,
      }
    }
    const bounds = view as FakeV4Bounds
    return { center: bounds.getCenter() ?? new FakeV4Point(0, 0), zoom: 12 }
  }

  panTo(point: FakeV4Point, options?: Record<string, unknown>): void {
    this.callLog.push('panTo')
    this.center = point
    if (options) this.lastViewOptions = options
  }

  panBy(x: number, y: number, options?: Record<string, unknown>): void {
    this.callLog.push(`panBy:${x},${y}`)
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    this.center = new FakeV4Point(center.lng + x / scale, center.lat - y / scale)
    if (options) this.lastViewOptions = options
  }

  /* ------------------------------------------------------------ 旋转与倾斜 */

  setHeading(heading: number, options?: Record<string, unknown>): void {
    this.callLog.push('setHeading')
    this.heading = heading
    if (options) this.lastViewOptions = options
  }

  getHeading(): number {
    return this.heading
  }

  setTilt(tilt: number, options?: Record<string, unknown>): void {
    this.callLog.push('setTilt')
    this.tilt = tilt
    if (options) this.lastViewOptions = options
  }

  getTilt(): number {
    return this.tilt
  }

  /* ------------------------------------------------------------ 底图与样式 */

  setMapType(mapType: string): void {
    this.callLog.push(`setMapType:${String(mapType)}`)
    this.mapType = mapType
  }

  setMapStyle(config: Record<string, unknown>): void {
    this.callLog.push('setMapStyle')
    this.mapStyle = config
  }

  /* ------------------------------------------------------------------ 投影 */

  pointToPixel(point: FakeV4Point): FakeV4Pixel {
    this.callLog.push('pointToPixel')
    const size = this.getSize()
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    return new FakeV4Pixel(
      size.width / 2 + (point.lng - center.lng) * scale,
      size.height / 2 - (point.lat - center.lat) * scale,
    )
  }

  pixelToPoint(pixel: FakeV4Pixel): FakeV4Point {
    this.callLog.push('pixelToPoint')
    const size = this.getSize()
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    return new FakeV4Point(
      center.lng + (pixel.x - size.width / 2) / scale,
      center.lat - (pixel.y - size.height / 2) / scale,
    )
  }

  /* -------------------------------------------------------------- 视角动画 */

  startViewAnimation(animation: unknown): void {
    this.callLog.push('startViewAnimation')
    this.lastAnimation = animation
    // 官方由 Map 内部按 delay 调度启动；这里交给动画实例自己建模异步窗口
    ;(animation as { scheduleStart?: () => void } | null)?.scheduleStart?.()
  }

  cancelViewAnimation(animation: unknown): void {
    this.callLog.push('cancelViewAnimation')
    this.canceledAnimation = animation
    // 内部对象未创建时抛 TypeError（官方行为，见 FakeV4ViewAnimation 注释）
    ;(animation as { cancel?: () => void } | null)?.cancel?.()
  }

  /* ---------------------------------------------------------- 交互开关（成对方法） */

  private setInteraction(name: FakeV4Interaction, enabled: boolean): void {
    this.callLog.push(`${enabled ? 'enable' : 'disable'}${name[0].toUpperCase()}${name.slice(1)}`)
    this.interactions[name] = enabled
  }

  enableDragging(): void {
    this.setInteraction('dragging', true)
  }
  disableDragging(): void {
    this.setInteraction('dragging', false)
  }
  enableInertialDragging(): void {
    this.setInteraction('inertialDragging', true)
  }
  disableInertialDragging(): void {
    this.setInteraction('inertialDragging', false)
  }
  enableScrollWheelZoom(): void {
    this.setInteraction('scrollWheelZoom', true)
  }
  disableScrollWheelZoom(): void {
    this.setInteraction('scrollWheelZoom', false)
  }
  enableContinuousZoom(): void {
    this.setInteraction('continuousZoom', true)
  }
  disableContinuousZoom(): void {
    this.setInteraction('continuousZoom', false)
  }
  enableResizeOnCenter(): void {
    this.setInteraction('resizeOnCenter', true)
  }
  disableResizeOnCenter(): void {
    this.setInteraction('resizeOnCenter', false)
  }
  enableDoubleClickZoom(): void {
    this.setInteraction('doubleClickZoom', true)
  }
  disableDoubleClickZoom(): void {
    this.setInteraction('doubleClickZoom', false)
  }
  enableKeyboard(): void {
    this.setInteraction('keyboard', true)
  }
  disableKeyboard(): void {
    this.setInteraction('keyboard', false)
  }
  enablePinchToZoom(): void {
    this.setInteraction('pinchToZoom', true)
  }
  disablePinchToZoom(): void {
    this.setInteraction('pinchToZoom', false)
  }
  enableRotate(): void {
    this.setInteraction('rotate', true)
  }
  disableRotate(): void {
    this.setInteraction('rotate', false)
  }
  enableRotateGestures(): void {
    this.setInteraction('rotateGestures', true)
  }
  disableRotateGestures(): void {
    this.setInteraction('rotateGestures', false)
  }
  enableTilt(): void {
    this.setInteraction('tilt', true)
  }
  disableTilt(): void {
    this.setInteraction('tilt', false)
  }
  enableTiltGestures(): void {
    this.setInteraction('tiltGestures', true)
  }
  disableTiltGestures(): void {
    this.setInteraction('tiltGestures', false)
  }

  /* ------------------------------------------------------------------ 释放 */

  destroy(): void {
    // 每次调用都记录：便于断言「Driver 是否真的让 SDK 执行了销毁」（PR #60 评审 P2）
    this.callLog.push('destroy')
    if (this.destroyed) return
    this.destroyed = true
    // 记录销毁时仍挂着的子资源数量（跨 Facet 不变式，见字段注释）
    this.destroyedWithOverlays = this.overlays.length
    this.destroyedWithControls = this.controls.length
    this.destroyedWithLayers = this.layers.length
    // 官方语义：destroy 会清空 Map 自身残留监听器，但管不到子对象
    this.clearAllListeners()
    // 只有 Map 自己销账：子资源不会随 destroy 消失（漏摘的覆盖物/控件/图层会留在诊断里，
    // 这正是「先摘子资源再销毁」那条不变式的门禁依据）
    this.stats.resourceReleased('map', this)
  }
}

/**
 * Fake 版 `BMap.MapTypeId`。
 *
 * **形状按真实运行时造，不按类型声明造**（#71 的教训，R25-E / #74 的真实 AK smoke 实测确认）：
 * 真实 `v=4.0` 的 `BMap.MapTypeId` 是 `{ NORMAL, EARTH, SATELLITE }`；上游
 * `@baidumap/jsapi-v4-types@4.0.4` 里声明的 `BMAP_*_MAP` 静态成员**在运行时并不存在**
 * （带该前缀的常量挂在全局 `globalThis.BMAP_*_MAP` 上）。
 *
 * 刻意**不**同时提供两套名字：夹具比真实 SDK 宽容时，「只读声明名」的实现会在单测里一路绿、
 * 直到真实 smoke 才炸。夹具的首要职责是如实——这里的取值就是运行时那些成员的值。
 */
export class FakeV4MapTypeId {
  static readonly NORMAL = 'normal'
  static readonly SATELLITE = 'satellite'
  static readonly EARTH = 'earth'
}

export interface FakeV4AnimationOptions {
  delay?: number
  duration?: number
  /** 官方拼写是 `interation`（不是 iteration），数字或 `'INFINITE'` */
  interation?: number | 'INFINITE'
}

/**
 * Fake BMap v4 `ViewAnimation`
 *
 * 行为依据：官方 Skill `references/view-animation.md`（PR #60 评审 P1/P2 复现所需），
 * 以及 **2026-09-21 的真实 AK 读数**（#104 审计表 F-1，live gate `view-animation-cancel-window`）：
 * - `map.startViewAnimation()` 内部按 `delay` 调度异步启动，没有公开的定时器句柄；
 * - `animationstart` 在**内部 Animation 构造之前**同步派发，因此在该监听器里同步 cancel 太早，
 *   至少要等到微任务（实测：派发期间同步 cancel 抛 `reading 'cancel' of undefined`，
 *   派发后的微任务里 cancel 成功并派发 `animationcancel`）；
 * - 内部对象存在之前调用 `map.cancelViewAnimation()` 一律抛 `TypeError`（不只是 cancel）；
 * - `animationend` = 正常结束、`animationcancel` = 被取消；`'INFINITE'` 永不派发 `animationend`。
 *
 * ⚠️ **时序上的刻意简化**：本 Fake 把 `delay: 0` 建模成「一个 0ms 定时器后启动」，而真实 4.0 在
 * `delay: 0` 下也要 **5–120ms** 才派发 `animationstart`（F-1 读数）。这个简化让「把清理推迟到安全
 * 窗口」这条路径**可测**（否则用例要等真实时间、会脆），代价是：`delay: 0` 下「先取消再销毁」这条
 * 用例证明的是**本库的排序逻辑**，不是真实运行时的必然顺序（真实排序见 ADR 已知限制）。
 *
 * 这个 Fake 刻意把「异步启动窗口」显式建模出来，因为 Driver 的动画生命周期正确性完全取决于它。
 */
export class FakeV4ViewAnimation extends FakeV4EventTarget {
  readonly keyFrames: unknown[]
  readonly options: FakeV4AnimationOptions
  /** 内部 Animation：start 之后才存在（cancel 的前置条件）。 */
  private internal: { canceled: boolean } | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  started = false
  settled = false
  cancelCalls = 0
  /** 测试故障注入：让下一次 cancel 抛错（用于「取消失败后重试」） */
  failNextCancel = false
  /**
   * 测试辅助：让 `cancel()` **成功但不派发 `animationcancel`**。
   *
   * 真实 SDK 会不会在这种情况下不回调仍**未证**（#104 审计表 F-1 只测到了「成功取消**会**派发」
   * 这一侧）——这个开关不是为了声明官方行为，而是给「生产实现不能依赖该事件才交回所有权」
   * 留一条防御性用例。
   */
  suppressCancelEvent = false

  constructor(
    keyFrames: unknown[],
    options: FakeV4AnimationOptions = {},
    stats: FakeV4Diagnostics,
  ) {
    super(stats)
    this.keyFrames = keyFrames
    this.options = options
  }

  /** 由 `Map.startViewAnimation` 调用：按 delay 异步启动（模拟官方内部 setTimeout，无公开句柄）。 */
  scheduleStart(): void {
    const delay = this.options.delay ?? 0
    this.stats.timerScheduled()
    this.startTimer = setTimeout(() => this.startInternal(), delay)
  }

  private startInternal(): void {
    this.startTimer = null
    // 定时器已经落地（无论动画是否已被取消）——诊断里 `timersPending` 因此回到 0，
    // 让「有一个 start 定时器还挂着」成为可断言的状态
    this.stats.timerFired()
    if (this.settled) return
    this.started = true
    // 官方顺序：先**同步**派发 animationstart（此时内部 Animation 还没建），再构造内部对象
    this.emit('animationstart')
    this.internal = { canceled: false }
  }

  /** 由 `Map.cancelViewAnimation` 调用。 */
  cancel(): void {
    this.cancelCalls++
    if (this.failNextCancel) {
      this.failNextCancel = false
      throw new Error('cancelViewAnimation failed')
    }
    if (!this.internal) {
      throw new TypeError(
        'cancelViewAnimation: 内部 Animation 尚未创建（animationstart 之后才可安全取消）',
      )
    }
    if (this.internal.canceled) return
    this.internal.canceled = true
    this.settled = true
    if (!this.suppressCancelEvent) this.emit('animationcancel')
  }

  /** 测试辅助：模拟动画正常结束（`animationend`）。 */
  finish(): void {
    if (!this.internal || this.settled) return
    this.settled = true
    this.emit('animationend')
  }

  /** 测试辅助：启动定时器是否还在等待（未被清理）。 */
  get hasPendingStart(): boolean {
    return this.startTimer !== null
  }
}
