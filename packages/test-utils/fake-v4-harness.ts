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
import { createFakeBMapV4, type FakeBMapV4, type FakeV4Map } from "./fake-bmap-v4/index.ts";

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
  /** 最后一张地图上挂载的覆盖物位置（不含图层），按挂载顺序；无位置记为 `null`。 */
  overlayPositions(): Array<{ lng: number; lat: number } | null>;
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
    },
  };
}
