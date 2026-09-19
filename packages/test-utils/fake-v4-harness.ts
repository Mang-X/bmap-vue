/**
 * Fake v4 的客户端 / 组件级 harness
 *
 * 这是原 `driver-matrix.ts`（M3A3-FAKE-DUAL / issue #24）在旧引擎删除后的残留：
 * 当时它要回答的是「同一份组件代码在 webgl-v1 与 jsapi-v4 上是否给出同样的领域结果」，
 * 因此带跨引擎矩阵（`runDriverMatrix` / `expectSameDomainResult`）与两个引擎描述。
 * `#26` 删掉 webgl-v1 之后「跨引擎比较」不再存在，留下的是**组件级场景需要的那一份
 * 装配**：结构化 Provider、带尺寸的容器、基线重置、泄漏门禁与领域读数。
 *
 * 保留的三件事（都从原实现原样搬过来）：
 * 1. `createFakeV4Client()`：走**默认路径**装 Client（Provider 归一 → `assertLoadedSdk` →
 *    默认 Driver 工厂 → 组装），少一环就可能放过「Provider 归一坏了但 Driver 没问题」；
 * 2. `createFakeV4Harness()`：组件级场景的装配与读数（挂载计数按族划分、覆盖物位置投影、
 *    气泡活状态）；
 * 3. 泄漏门禁用 Fake v4 自己的诊断（`assertNoLeaks`），组件用例只写 `harness.assertIdle()`。
 */
import type { BMapClient, BMapProviderLike } from "../baidu-map-gl-vue/src/client/types";
import { createBMapClient } from "../baidu-map-gl-vue/src/client/createBMapClient";
import { createLoadedJsapiV4 } from "../baidu-map-gl-vue/src/core/loader/providers";
import {
  createFakeBMapV4,
  type FakeBMapV4,
  type FakeV4Layer,
  type FakeV4Map,
} from "./fake-bmap-v4/index.ts";

/**
 * 组件挂在 Map 上的子资源种类（**领域读数**用的三种挂载面）。
 *
 * 刻意不复用 Fake v4 的 `FakeV4ResourceKind`：那是诊断计数器的记账分类（含 Map / Panorama
 * 这类生命周期类资源），与「组件挂在哪儿」不是同一个维度。
 */
export type FakeV4MountKind = "overlay" | "control" | "layer";

/** 视野读数（领域口径）：最后一张地图当前的视野。 */
export interface FakeV4View {
  center: { lng: number; lat: number } | null;
  zoom: number | null;
  heading: number;
  tilt: number;
}

/** 视野**写入**次数（领域口径）：组件向 SDK 下发过多少次各条视野命令。 */
export interface FakeV4ViewWrites {
  centerAndZoom: number;
  setCenter: number;
  setZoom: number;
  setHeading: number;
  setTilt: number;
}

/** 模拟用户交互时的目标视野（只给需要变的字段）。 */
export interface FakeV4UserView {
  center?: { lng: number; lat: number };
  zoom?: number;
  heading?: number;
  tilt?: number;
}

export interface FakeV4Harness {
  /** 组件路径的 Provider（结构化：自述 `engine: "jsapi-v4"`）。 */
  provider(): BMapProviderLike;
  /**
   * 加载**挂起**的 Provider：`load()` 一直不 resolve，直到 `releaseProvider()` 被调用。
   *
   * 用来在「SDK 尚未就绪」的窗口里改变 props / 观察中间状态（#27 评审 P1 的延迟加载场景）。
   */
  deferredProvider(): BMapProviderLike;
  /** 放行所有由 `deferredProvider()` 发起的加载（幂等：放行后再次调用是 no-op）。 */
  releaseProvider(): void;
  /** 每个用例一份的挂载容器（已 attach 到 document 并带内联尺寸）。 */
  container(): HTMLElement;
  /** 用例开头重置 Fake 的生命周期诊断基线与运行时注入成员。 */
  reset(): void;
  /** 断言「当前没有任何未释放的 SDK 侧资源」。 */
  assertIdle(label?: string): void;
  /** 当前挂在**最后一张创建的 Map** 上的子资源数。 */
  attached(kind: FakeV4MountKind): number;
  /**
   * 最后一张地图上当前**可见**的控件数（M7-CONTROL-PANORAMA / #41）。
   *
   * 控件的 `visible` 在 #41 定型为 SDK 基类的 `show()` / `hide()`：控件始终挂载，
   * 只是可见性变化。因此「显隐」需要一个与 `attached("control")` **不同**的读数——
   * 用挂载计数读显隐会把「藏起来了」与「摘掉了」混成一件事。
   */
  visibleControls(): number;
  /** 最后一张地图上挂载的覆盖物位置（不含图层），按挂载顺序；无位置记为 `null`。 */
  overlayPositions(): Array<{ lng: number; lat: number } | null>;
  /**
   * 最后一张地图上当前**可见**的覆盖物数（`Overlay#show/hide` 的读数）。
   *
   * 与「挂载了几个」是两个口径：数据组件的 `visible=false` 用 `hide()` 表达
   * （不摘掉资源、不丢数据），只数挂载数会让「藏起来了」与「还在图上」混成一件事。
   */
  visibleOverlays(): number;
  /**
   * 模拟 SDK 在某个覆盖物上派发 `click`（用户点了那个 Marker）。
   *
   * 索引落在**已创建**的覆盖物账本上（负索引语义同 `subscribedEventsOf`：`-1` = 最后一个）。
   */
  clickOverlay(index?: number): void;
  /**
   * 注入一次 `removeOverlay` 失败（**摘除之前**抛，覆盖物仍留在图上）。
   *
   * 用途是「逐资源摘除」的**部分失败**：`DataLayerManager.clear()` 逐条隔离，注入之后会得到
   * 「一部分真的摘掉了、剩下的还在」的半拆状态。
   */
  failNextRemoveOverlay(error?: Error): void;
  /**
   * 与 `failNextRemoveOverlay` 对偶：**先摘掉、再抛错**（用后即清，挂在指定覆盖物上）。
   *
   * 「摘除失败」的两种合法形状必须分开测：摘之前抛 ⇒ 资源仍在图上；摘之后抛 ⇒ 资源已经不在了。
   * 后者的关键读数是「调用方不能把它当成 `attached`」——那会留下幻影所有权。
   */
  failNextRemoveOverlayAfterDetach(error?: Error, index?: number): void;
  /**
   * 与 `failNextRemoveLayer` 对偶：**先摘掉、再抛错**（用后即清）。
   *
   * 同形的既有 knob 一直在 `FakeV4Map` 上（`failNextRemoveLayerAfterDetach`），此前只是没有
   * 暴露到这里 —— 于是「替换路径的失败只覆盖了「副作用之前抛」这一种形状」这件事在测试里看不出来。
   */
  failNextRemoveLayerAfterDetach(error?: Error): void;
  /**
   * 注入一次第 `index` 个覆盖物的 `hide()` / `show()` 失败（**写之前**抛，`visible` 不变）。
   *
   * 索引口径同 `clickOverlay`（**已创建**的覆盖物账本，负索引从后数）。
   */
  failNextOverlayHide(error?: Error, index?: number): void;
  failNextOverlayShow(error?: Error, index?: number): void;
  /** 最后一张地图上当前**真的可见**的覆盖物索引（读数用：显隐是否逐资源对齐）。 */
  overlayVisibility(): boolean[];
  /** 最后一张地图上当前打开的气泡数。 */
  openInfoWindows(): number;
  /** 本用例内累计创建的地图数（`0` 表示 SDK 还没就绪）。 */
  mapsCreated(): number;
  /**
   * 让**下一张**地图的首次 `initializeView()` 失败（建图成功、初始化视野抛错）。
   *
   * 用来驱动「失败 → `retry()` 重建」这条路径（`whenMapCreated` 的注册必须在失败后仍然有效）。
   */
  failNextInitializeView(error?: Error): void;
  /** 最后一张地图当前的视野（M4-STATE / #27 的领域读数）。 */
  view(): FakeV4View;
  /** 最后一张地图收到的视野命令次数（按字段分开计数）。 */
  viewWrites(): FakeV4ViewWrites;
  /**
   * 模拟用户交互：SDK 内部状态变化 + 派发对应的**结束**事件
   * （`moveend` / `zoomend` / `headingchange` / `tiltchange`）。
   *
   * 刻意**不经过** `setCenter` 一类命令入口，因此「用户操作没有触发额外写入」可以被断言。
   */
  simulateUserView(next: FakeV4UserView): void;
  /** 最后一张地图当前订阅的事件类型。 */
  subscribedEvents(): string[];
  /**
   * 第 `mapIndex` 张地图当前订阅的事件类型（多地图场景）。
   *
   * 索引落在**实例账本**（`fake.createdMaps`）上，而 `reset()` 只重置诊断计数、不清账本——
   * 因此跨用例安全的写法是**负索引**：`-1` = 最后一张、`-2` = 倒数第二张。
   */
  subscribedEventsOf(mapIndex: number): string[];
  /**
   * 向**最后一张**地图派发一个 SDK 事件（模拟 SDK 自己派发）。
   *
   * `payload` 是 raw 事件上的字段（如 `{ point: { lng, lat } }`）；省略时只有 `{ type }`。
   */
  dispatch(name: string, payload?: Record<string, unknown>): void;
  /** 向**第 `mapIndex` 张**地图派发事件（负索引语义同 `subscribedEventsOf`）。 */
  dispatchTo(mapIndex: number, name: string, payload?: Record<string, unknown>): void;
  /** 监听相关的两个口径：`calls` = 累计订阅次数（活动），`pending` = 当前未释放（门禁）。 */
  listenActivity(): { calls: number; pending: number };
  /**
   * 最后一张地图收到的 `checkResize` 次数（M4-HANDLE-UX / #29 的容器门禁读数）。
   *
   * 用它断言「合帧：同一帧内多次尺寸变化只下发一次」与「暂停期间一次都不下发」——
   * 领域读数是次数，不是「有没有调用过」。
   */
  checkResizeCalls(mapIndex?: number): number;
  /* ------------------------------------------- 图层读数（M7-LAYERS / #40） */

  /**
   * 本用例内**累计创建**过的图层实例数。
   *
   * 「重建」的领域读数就是它：URL / 构造选项变化 ⇒ +1；`visible` / `data` / `zIndex` 变化 ⇒ 不变。
   * 与 `attached('layer')`（当前挂在图上的数量）是两个口径，用例通常两个都要断言。
   */
  layersCreated(): number;
  /**
   * 第 `index` 个创建过的图层收到的 **SDK 调用日记**（官方方法名，按调用顺序）。
   *
   * 这就是「这一代图层被要求做了什么」的全部可观察事实：`zIndex` 就走 `setZIndex`、
   * `data` 走 `setData` / `clearData`、`DOMLayer` 的构造项走 `setStyleOptions`。
   */
  layerCalls(index?: number): string[];
  /**
   * 第 `index` 个创建过的图层收到的**构造选项**（SDK 侧真正拿到的参数）。
   *
   * 用途是断言「参数生成」（XYZ / WMS / WMTS 的 URL 与参数、别名改名）——那是这些图层的
   * 公开契约本身，而不是实现细节。
   */
  layerOptions(index?: number): Record<string, unknown>;
  /** 第 `index` 个创建过的图层当前是否还挂在地图上（重建后旧实例必须为 `false`）。 */
  layerAttached(index?: number): boolean;

  /* ------------------------------- 原生批量图层读数（M6-MARKER-POINTCOLLECTION / #34） */

  /**
   * 本用例内**累计创建**过的原生批量图层数（官方 `PointShapeLayer` / `PointIconLayer` …）。
   *
   * 「批量点组件不是逐点 Marker」的领域读数就是它 + `attached('overlay')`：
   * 一个 `BPointShapeLayer` 无论多少数据都只创建 **1** 个图层、**0** 个覆盖物。
   */
  nativeLayersCreated(): number;
  /** 第 `index` 个原生图层收到的 **SDK 调用日记**（官方方法名，按调用顺序）。 */
  nativeLayerCalls(index?: number): string[];
  /** 第 `index` 个原生图层的**构造选项**（`idKey` / `enablePicked` 等构造期项）。 */
  nativeLayerOptions(index?: number): Record<string, unknown>;
  /**
   * 第 `index` 个原生图层最后一次 `setStyleOptions()` 收到的**样式袋**（声明面的批量图层）。
   *
   * 与 `nativeLayerOptions()` 分开读，是因为两条写入路径确实不同：声明面走 `setStyleOptions`
   * （+ `doOnceDraw`），扩展 API 走整袋 `setOptions`（落在 `nativeLayerOptions()` 里）。
   */
  nativeLayerStyle(index?: number): Record<string, unknown>;
  /** 第 `index` 个原生图层最后一次 `setData()` 收到的数据（GeoJSON `FeatureCollection`）。 */
  nativeLayerData(index?: number): unknown;
  /** 第 `index` 个原生图层当前是否还挂在地图上。 */
  nativeLayerAttached(index?: number): boolean;
  /** 第 `index` 个原生图层的显隐读数（`setVisible` 是否真的落地）。 */
  nativeLayerVisible(index?: number): boolean;
  /**
   * 注入**一次**地图级 `removeLayer` 失败（**摘除之前**抛：图层仍留在图上）。
   *
   * 重建 / 换引擎路径的判别力全在这条上：`removeLayer` 抛错时，「旧实例到底摘掉了没有」在
   * SDK 侧没有第二次机会告诉你，所以内核必须**放弃这次替换**并保留旧实例；若它把失败当成
   * 成功继续建新实例，就会出现两套资源同图。
   */
  failNextRemoveLayer(error?: Error): void;
  /**
   * 粘性策略：对**已经不在图上**的图层再 `removeLayer` 会抛错（官方没有承诺重复摘除安全）。
   *
   * 与 `failNextRemoveLayer`（一次性注入）不同，它描述的是一种**契约分支**：开启之后整段用例
   * 都处在「重复摘除会失败」的世界里，因此可以断言「每代实例恰好摘一次」——而这正是
   * 「不依赖重复摘除安全」的机器证据。
   */
  failRemoveLayerWhenDetached(error?: Error): void;
  /**
   * 地图上的**图层挂 / 摘调用序列**（`addLayer` / `removeLayer`，按到达顺序）。
   *
   * 「只摘一次」这类顺序断言只能落在动作序列上：两次 remove 与一次 remove 在**最终数量**上
   * 看不出差别（替身不去重，第二次摘一个不在图上的图层是无害 no-op），只有序列能区分。
   */
  layerOps(): string[];
  /**
   * 注入**一次**第 `index` 个原生图层的 `setVisible` 失败（**写之前**抛）。
   *
   * 显隐是一条独立于其它 props 的更新路径（组件侧由单独的 watcher 驱动），需要它自己的
   * 「失败仍走统一 `resource:error` 出口」回归。
   */
  failNextNativeLayerSetVisible(error?: Error, index?: number): void;
  /**
   * 模拟用户在原生批量图层上点了一下（SDK 侧派发 `click`）。
   *
   * 刻意**照着官方派发的形状**造载荷：`{ value: { dataIndex, dataItem: { properties } }, latLng, pixel }`。
   * `properties` 缺省时从该图层自己收到的 `setData()` 数据里按 `dataIndex` 取出来
   * ——这正是 SDK 的行为（回传命中要素的 properties），因此用例写「点第 2 个要素」就够，
   * 不必自己拼 properties。`dataIndex = -1` 表示**未命中**（官方未命中也派发事件，
   * `value` 是 `{ dataIndex: -1, dataItem: undefined }`）。
   */
  simulateNativePick(
    payload: {
      dataIndex: number;
      properties?: Record<string, unknown>;
      latLng?: { lng: number; lat: number };
      pixel?: { x: number; y: number };
    },
    index?: number,
  ): void;
  /**
   * 模拟在原生**扩展 API**（`PointLayer`）上点了一下。
   *
   * 形状依据：探针实测（`scripts/probe-native-point-cluster.mts`，2026-09-19）——
   * `PointLayer` 的命中载荷是 `{ lng, lat, size, scale, offset, id, index, properties, feature }`，
   * **没有** `dataIndex` / `dataItem`。夹具照这个形状造，否则「扩展 API 的拾取面」在单测里
   * 会以声明面的形状被验证通过（夹具比真实宽容 = 掩盖缺陷）。
   */
  simulateNativeExtensionPick(
    payload: {
      key: PropertyKey;
      idKey?: string;
      latLng?: { lng: number; lat: number };
      pixel?: { x: number; y: number };
    },
    index?: number,
  ): void;
  /**
   * 模拟点击原生聚合的**簇**（`ClusterLayer`）。
   *
   * 形状依据：同一次探针实测 —— 簇命中只有元数据
   * `{ isCluster: true, clusterId, parentId, pointCount, latLng, bbox, properties }`，
   * **没有任何业务身份**。夹具刻意不提供「簇里有哪几个要素」，因为真实 SDK 也不提供。
   */
  simulateNativeClusterHit(
    payload: {
      clusterId: number;
      pointCount: number;
      latLng?: { lng: number; lat: number };
      pixel?: { x: number; y: number };
    },
    index?: number,
  ): void;
  /** 模拟点击原生聚合里**未聚合的单点**（实测形状：业务键在 `value.id` 上）。 */
  simulateNativeClusterSingleHit(
    payload: { key: PropertyKey; latLng?: { lng: number; lat: number }; pixel?: { x: number; y: number } },
    index?: number,
  ): void;
  /**
   * 模拟原生聚合派发 `change`（实测形状：`value = { singles, clusters, zoom }`，前两个是**数组**）。
   *
   * 用数量而不是「造 N 个假簇对象」：本库只读它们的长度（见 `nativeClusterEngine` 的
   * `handleChange`），多造几个对象只会让夹具看起来更真、实际上没有额外的判别力。
   */
  simulateNativeClusterChange(
    payload: { clusters: number; singles: number; zoom?: number },
    index?: number,
  ): void;
  /**
   * 派发一个**字段不完整**的簇命中载荷（`value` 原样透传）。
   *
   * 现实里它对应「SDK 的载荷不是我们取过证的那个形状」。这里刻意**不由夹具编造**缺哪些字段：
   * 用例要验证的正是「缺字段时组件不伪造占位值」，所以缺什么由用例明确写出来。
   */
  simulateMalformedNativeClusterHit(value: Record<string, unknown>, index?: number): void;
  /**
   * 让第 `index` 个原生图层在**摘除期间**（`removeLayer` 内）同步派发一次事件。
   *
   * 建模真实 SDK 的行为：`removeLayer` 会同步派发事件（`tileload` 一类）。这让
   * 「**先解绑业务监听、再摘资源**」这条顺序不变式有了可观察的后果 —— 监听还活着时，
   * 那次事件会打到已经在拆解的业务回调上（组件会把它当成一次真实命中）。
   */
  dispatchNativeLayerEventOnDetach(index: number, type: string, value: unknown): void;
}

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 取「最后一张创建的 Map」：读数都以它为准（用例必须先过 `<BMap>`）。 */
function lastCreatedMap<T>(maps: readonly T[], label: string): T {
  const map = maps[maps.length - 1];
  if (!map) throw new Error(`${label}：用例必须先创建地图（BMap 组件）`);
  return map;
}

/** 取第 `index` 张创建的 Map（`-1` = 最后一张）：多地图场景用。 */
function createdMapAt<T>(maps: readonly T[], index: number, label: string): T {
  const resolved = index < 0 ? maps.length + index : index;
  const map = maps[resolved];
  if (!map) {
    throw new Error(`${label}：没有第 ${index} 张地图（已创建 ${maps.length} 张）`);
  }
  return map;
}

/** 覆盖物位置投影：Fake v4 用「实例上的 `position` 字段」表达位置。 */
function toPositions(overlays: Iterable<unknown>): Array<{ lng: number; lat: number } | null> {
  return [...overlays].map((overlay) => {
    const position = (overlay as { position?: { lng: number; lat: number } }).position;
    return position ? { lng: position.lng, lat: position.lat } : null;
  });
}


/** 视野命令计数：`centerAndZoom` 一次性与四个字段级 `setXxx` 分开数。 */
function countViewWrites(callLog: readonly string[]): FakeV4ViewWrites {
  const count = (command: string): number =>
    callLog.filter((entry) => entry.startsWith(command)).length;
  return {
    centerAndZoom: count("centerAndZoom"),
    setCenter: count("setCenter"),
    setZoom: count("setZoom"),
    setHeading: count("setHeading"),
    setTilt: count("setTilt"),
  };
}

/**
 * 模拟用户交互：直接改 SDK 内部状态再派发**结束**事件（真实 SDK 由地图内部完成这两步）。
 *
 * 用 `FakeV4Point` 而不是普通对象字面量：真实 SDK 交出的就是它自己的 `Point` 实例，
 * 夹具如实照做，免得「组件依赖了某个只在字面量上成立的性质」这类差异被藏住。
 */
function simulateUserView(map: FakeV4Map, fake: FakeBMapV4, next: FakeV4UserView): void {
  if (next.center) {
    map.center = new fake.namespace.Point(next.center.lng, next.center.lat);
    map.emit("moveend");
  }
  if (next.zoom !== undefined) {
    map.zoom = next.zoom;
    map.emit("zoomend");
  }
  if (next.heading !== undefined) {
    map.heading = next.heading;
    map.emit("headingchange");
  }
  if (next.tilt !== undefined) {
    map.tilt = next.tilt;
    map.emit("tiltchange");
  }
}

/**
 * 用 Fake v4 装出**默认路径**的 v4 Client：结构化 Provider + `createBMapClient`。
 *
 * 刻意不走 `createJsapiV4Driver` 直连：契约要验证的是组件默认路径真的会拿到的那条链
 * （Provider 归一 → `assertLoadedSdk` → 默认 Driver 工厂 → Client 组装）。
 */
export async function createFakeV4Client(
  fake: FakeBMapV4 = createFakeBMapV4(),
): Promise<{ client: BMapClient; fake: FakeBMapV4 }> {
  const client = await createBMapClient({
    provider: {
      id: "fake-bmap-v4",
      getCacheKey: () => "fake-bmap-v4",
      load: async () =>
        createLoadedJsapiV4({
          providerId: "custom-script-v4",
          mode: "jsonp",
          version: fake.namespace.VERSION,
          versionSource: "url",
          options: { ak: "fake-ak" },
          fingerprint: "fake-bmap-v4",
          namespace: fake.namespace,
          loadedAt: 0,
        }),
    },
    loadOptions: { ak: "fake-ak" },
    // 默认 `unsupported: "warn"`：调用方需要 "throw" 时在用例里自己拼 definition，
    // 不为「可能有人要传」预留一个没人用的参数。
  });
  return { client, fake };
}

/**
 * 组件级 harness：一份 Fake 命名空间 + 结构化 Provider + 领域读数。
 *
 * `reset()` 会把运行时注入成员装回（否则一个忘了恢复的用例会把「命名空间缺成员」带进
 * 后续用例，而那类失败会伪装成「Driver 探测错了」）。
 */
export function createFakeV4Harness(fake: FakeBMapV4 = createFakeBMapV4()): {
  harness: FakeV4Harness;
  fake: FakeBMapV4;
} {
  const lastMap = () => lastCreatedMap(fake.createdMaps, "fake-v4 harness");
  /** 取第 `index` 个**创建过**的覆盖物（`-1` = 最后创建的那个）；口径同 `clickOverlay`。 */
  const overlayAt = (index: number) => {
    const overlays = fake.createdOverlays;
    const resolved = index < 0 ? overlays.length + index : index;
    const overlay = overlays[resolved];
    if (!overlay) {
      throw new Error(`fake-v4 harness：没有第 ${index} 个覆盖物（已创建 ${overlays.length} 个）`);
    }
    return overlay;
  };
  /**
   * 取第 `index` 个**创建过**的图层（`-1` = 最后创建的那个）。
   *
   * 索引落在实例账本（`fake.createdLayers`）上，而 `reset()` 只重置诊断计数、不清账本——
   * 因此**跨用例安全**的写法是负索引：`-1` = 最后一个、`-2` = 倒数第二个。
   */
  const layerAt = (index: number) => {
    const layers = fake.createdLayers;
    const resolved = index < 0 ? layers.length + index : index;
    const layer = layers[resolved];
    if (!layer) {
      throw new Error(`fake-v4 harness：没有第 ${index} 个图层（已创建 ${layers.length} 个）`);
    }
    return layer;
  };
  /**
   * 取第 `index` 个**创建过**的原生批量图层（`-1` = 最后一个）。
   *
   * 与 `layerAt` 同一个索引口径（负索引跨用例安全），但读的是**另一个**实例账本：
   * 原生图层（`FakeV4PointShapeLayer` 一族）与底图图层（`FakeV4TileLayer` 一族）在 Fake 里
   * 分属两个构造工厂，混用一个账本会让「BPointShapeLayer 到底建了几个」读成两个组件的总数。
   */
  const nativeLayerAt = (index: number) => {
    const layers = fake.createdNativeLayers;
    const resolved = index < 0 ? layers.length + index : index;
    const layer = layers[resolved];
    if (!layer) {
      throw new Error(`fake-v4 harness：没有第 ${index} 个原生图层（已创建 ${layers.length} 个）`);
    }
    return layer;
  };
  /** 挂起中的 `deferredProvider().load()` 放行函数（放行一次即清空）。 */
  const pendingLoads: Array<() => void> = [];
  return {
    fake,
    harness: {
      provider: () => ({
        id: "fake-bmap-v4",
        // 用 `createLoadedJsapiV4` 而不是手写 `{ engine, version, namespace }`：加载结果是
        // 结构化契约（含 load metadata），手写对象会在类型层少字段、在运行期少信息。
        load: async () =>
          createLoadedJsapiV4({
            providerId: "existing-global-v4",
            mode: "existing-global",
            version: fake.namespace.VERSION,
            versionSource: "global",
            options: { ak: "fake-ak" },
            fingerprint: "fake-v4-harness",
            namespace: fake.namespace,
            loadedAt: 0,
          }),
      }),
      deferredProvider: () => ({
        id: "fake-bmap-v4-deferred",
        load: async () => {
          await new Promise<void>((resolve) => pendingLoads.push(resolve));
          return createLoadedJsapiV4({
            providerId: "existing-global-v4",
            mode: "existing-global",
            version: fake.namespace.VERSION,
            versionSource: "global",
            options: { ak: "fake-ak" },
            fingerprint: "fake-v4-harness-deferred",
            namespace: fake.namespace,
            loadedAt: 0,
          });
        },
      }),
      releaseProvider: () => {
        for (const resolve of pendingLoads.splice(0)) resolve();
      },
      container: sizedContainer,
      reset: () => {
        fake.diagnostics.reset();
        fake.runtimeExtensions.restoreAll();
      },
      assertIdle: (label = "fake-v4 harness") => fake.diagnostics.assertNoLeaks(label),
      attached: (kind) => {
        const map = lastMap();
        if (kind === "overlay") return map.overlays.length;
        if (kind === "control") return map.controls.length;
        return map.layers.length;
      },
      overlayPositions: () => toPositions(lastMap().overlays),
      visibleOverlays: () =>
        lastMap().overlays.filter((overlay) => (overlay as { visible?: boolean }).visible !== false).length,
      clickOverlay: (index = -1) => {
        const overlays = fake.createdOverlays as Array<{ emit?: (type: string) => void }>;
        const resolved = index < 0 ? overlays.length + index : index;
        const overlay = overlays[resolved];
        if (!overlay?.emit) {
          throw new Error(`fake-v4 harness：没有第 ${index} 个覆盖物（已创建 ${overlays.length} 个）`);
        }
        overlay.emit("click");
      },
      failNextRemoveOverlay: (error) => {
        lastMap().failNextRemoveOverlay = error ?? new Error("harness: failNextRemoveOverlay");
      },
      failNextRemoveOverlayAfterDetach: (error, index = -1) => {
        (overlayAt(index) as { failNextRemoveAfterDetach?: Error | null }).failNextRemoveAfterDetach =
          error ?? new Error("harness: failNextRemoveOverlayAfterDetach");
      },
      failNextRemoveLayerAfterDetach: (error) => {
        lastMap().failNextRemoveLayerAfterDetach =
          error ?? new Error("harness: failNextRemoveLayerAfterDetach");
      },
      failNextOverlayHide: (error, index = -1) => {
        (overlayAt(index) as { failNextHide?: Error | null }).failNextHide =
          error ?? new Error("harness: failNextOverlayHide");
      },
      failNextOverlayShow: (error, index = -1) => {
        (overlayAt(index) as { failNextShow?: Error | null }).failNextShow =
          error ?? new Error("harness: failNextOverlayShow");
      },
      overlayVisibility: () => lastMap().overlays.map((overlay) => overlay.visible !== false),
      visibleControls: () => lastMap().controls.filter((control) => control.isVisible()).length,
      openInfoWindows: () => (lastMap().infoWindow ? 1 : 0),
      mapsCreated: () => fake.diagnostics.snapshot().activity.mapsCreated,
      failNextInitializeView: (error) => fake.failNextInitializeView(error),
      view: () => {
        const map = lastMap();
        return {
          center: map.center ? { lng: map.center.lng, lat: map.center.lat } : null,
          zoom: map.zoom,
          heading: map.heading,
          tilt: map.tilt,
        };
      },
      viewWrites: () => countViewWrites(lastMap().callLog),
      simulateUserView: (next) => simulateUserView(lastMap(), fake, next),
      subscribedEvents: () => lastMap().getListenerTypes(),
      subscribedEventsOf: (mapIndex) =>
        createdMapAt(fake.createdMaps, mapIndex, "fake-v4 harness").getListenerTypes(),
      dispatch: (name, payload) => lastMap().emit(name, payload ?? {}),
      dispatchTo: (mapIndex, name, payload) =>
        createdMapAt(fake.createdMaps, mapIndex, "fake-v4 harness").emit(name, payload ?? {}),
      listenActivity: () => {
        const snapshot = fake.diagnostics.snapshot();
        return { calls: snapshot.activity.listenCalls, pending: snapshot.leaks.listeners };
      },
      checkResizeCalls: (mapIndex = -1) =>
        createdMapAt(fake.createdMaps, mapIndex, "fake-v4 harness").resizeCalls,
      layersCreated: () => fake.createdLayers.length,
      layerCalls: (index = -1) => [...layerAt(index).callLog],
      layerOptions: (index = -1) => ({ ...layerAt(index).options }),
      layerAttached: (index = -1) => layerAt(index).attachedMap !== null,
      nativeLayersCreated: () => fake.createdNativeLayers.length,
      nativeLayerCalls: (index = -1) => [...nativeLayerAt(index).callLog],
      nativeLayerOptions: (index = -1) => ({ ...nativeLayerAt(index).options }),
      nativeLayerStyle: (index = -1) => ({
        ...((nativeLayerAt(index) as { styleOptions?: Record<string, unknown> }).styleOptions ?? {}),
      }),
      nativeLayerData: (index = -1) => (nativeLayerAt(index) as { data?: unknown }).data,
      nativeLayerAttached: (index = -1) => nativeLayerAt(index).attachedMap !== null,
      nativeLayerVisible: (index = -1) => Boolean((nativeLayerAt(index) as { visible?: unknown }).visible),
      failNextRemoveLayer: (error) => {
        lastMap().failNextRemoveLayer = error ?? new Error("harness: failNextRemoveLayer");
      },
      failRemoveLayerWhenDetached: (error) => {
        lastMap().failRemoveLayerWhenDetached = error ?? new Error("harness: 重复摘除");
      },
      layerOps: () =>
        lastMap().callLog.filter((entry) => entry === "addLayer" || entry === "removeLayer"),
      failNextNativeLayerSetVisible: (error, index = -1) => {
        const layer = nativeLayerAt(index) as { failNextSetVisible?: Error | null };
        layer.failNextSetVisible = error ?? new Error("harness: failNextSetVisible");
      },
      simulateNativePick: (payload, index = -1) => {
        const layer = nativeLayerAt(index);
        const properties =
          payload.properties ??
          featurePropertiesAt((layer as { data?: unknown }).data, payload.dataIndex);
        layer.emit("click", {
          value: payload.dataIndex === -1 ? { dataIndex: -1, dataItem: undefined } : { dataIndex: payload.dataIndex, dataItem: { properties } },
          latLng: payload.latLng ?? { lng: 0, lat: 0 },
          pixel: payload.pixel ?? { x: 0, y: 0 },
        });
      },
      simulateNativeExtensionPick: (payload, index = -1) => {
        const layer = nativeLayerAt(index);
        // 扩展 API 的命中载荷：业务键在 value.properties[idKey] / value.id 上，**没有** dataIndex。
        layer.emit("click", {
          value: {
            lng: payload.latLng?.lng ?? 0,
            lat: payload.latLng?.lat ?? 0,
            index: 0,
            id: payload.key,
            properties: { [payload.idKey ?? "id"]: payload.key },
          },
          latLng: payload.latLng ?? { lng: 0, lat: 0 },
          pixel: payload.pixel ?? { x: 0, y: 0 },
        });
      },
      simulateNativeClusterHit: (payload, index = -1) => {
        const layer = nativeLayerAt(index);
        layer.emit("click", {
          value: {
            isCluster: true,
            clusterId: payload.clusterId,
            parentId: -1,
            pointCount: payload.pointCount,
            latLng: payload.latLng ?? { lng: 0, lat: 0 },
            bbox: [0, 0, 0, 0],
            properties: {
              isCluster: true,
              clusterId: payload.clusterId,
              pointCount: payload.pointCount,
            },
          },
          latLng: payload.latLng ?? { lng: 0, lat: 0 },
          pixel: payload.pixel ?? { x: 0, y: 0 },
        });
      },
      simulateNativeClusterSingleHit: (payload, index = -1) => {
        const layer = nativeLayerAt(index);
        layer.emit("click", {
          value: { id: payload.key, isCluster: false, properties: { id: payload.key } },
          latLng: payload.latLng ?? { lng: 0, lat: 0 },
          pixel: payload.pixel ?? { x: 0, y: 0 },
        });
      },
      simulateNativeClusterChange: (payload, index = -1) => {
        const layer = nativeLayerAt(index);
        layer.emit("change", {
          value: {
            clusters: Array.from({ length: payload.clusters }, (_, i) => ({ clusterId: i })),
            singles: Array.from({ length: payload.singles }, (_, i) => ({ id: `single-${i}` })),
            zoom: payload.zoom ?? 11,
          },
        });
      },
      simulateMalformedNativeClusterHit: (value, index = -1) => {
        nativeLayerAt(index).emit("click", { value, latLng: { lng: 0, lat: 0 }, pixel: { x: 0, y: 0 } });
      },
      dispatchNativeLayerEventOnDetach: (index, type, value) => {
        const layer = nativeLayerAt(index) as { onDetached?: () => void };
        layer.onDetached = () => layer.emit(type, { value });
      },
    },
  };
}

/** 从 `setData()` 收到的 GeoJSON 里取第 `index` 个要素的 properties（SDK 回传形状）。 */
function featurePropertiesAt(data: unknown, index: number): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || index < 0) return undefined;
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) return undefined;
  const feature = features[index] as { properties?: Record<string, unknown> } | undefined;
  return feature?.properties;
}
