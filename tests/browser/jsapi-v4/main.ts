/**
 * JSAPI 4.0 required smoke：默认官方链路 + Vue 基础组件 + 官方 UI Kit（R25-E / issue #74）
 *
 * 与 `tests/browser/official-packages/main.ts` 的分工：那一份探的是**官方包自身的发布契约**，
 * 这一份探的是**本库**——默认入口是否真的走官方 Loader、基础组件在真实 SDK 上是否可用、
 * 官方 UI Kit 的两个薄封装是否检索/事件/样式/销毁都成立、卸载后本库资源是否清干净。
 *
 * 两档（`?mode=`）：
 *
 * | 档 | 前置 | 用途 |
 * | --- | --- | --- |
 * | `live` | 真实 AK + 外网 | nightly / 人工验收的 required smoke（issue #74 的验收证据） |
 * | `fixture` | 无（注入 Fake v4 命名空间） | PR 门禁：跑同一份组件树，结论确定、不依赖网络 |
 *
 * 两档的差异**全部收在 `ModeDescriptor` 里**（provider 形状、覆盖物/控件/图层的读数方式、
 * 泄漏门禁口径）；检查体只写领域语言。**本档不适用的检查不登记**（登记表即单一事实源），
 * 而不是登记成 `skipped`——后者会阻止放行，把「档内不适用」和「该跑没跑」混成一件事。
 *
 * 本文件**不 import vitest / node 内置模块**：它要在浏览器里跑。
 */
import { createApp, defineComponent, h, nextTick, reactive, ref, type App, type VNode } from "vue";
import {
  BDistrictLayer,
  BInfoWindow,
  BMap,
  BMarker,
  BPolyline,
  BZoom,
  useBMapGeocoder,
} from "../../../packages/baidu-map-gl-vue/src/index.ts";
import { existingGlobalV4Provider } from "../../../packages/baidu-map-gl-vue/src/core/index.ts";
import {
  BPlaceAutocomplete,
  BPlaceDetail,
  BPlaceSearch,
  BRoutePlan,
} from "../../../packages/baidu-map-gl-vue/src/integrations/ui-kit/index.ts";
import { createFakeBMapV4 } from "../../../packages/test-utils/fake-bmap-v4/index.ts";
import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
import {
  assertSmoke,
  block,
  bootstrapDeclarations,
  checkReportEnvelope,
  classifyBootstrapFailure,
  evaluateSmokeReport,
  fail,
  formatReport,
  redactAk,
  SmokeRun,
  withBlockedTimeout,
  withTimeout,
  type SmokeMode,
  type SmokeReport,
  type SmokeUnhandledEntry,
} from "./report.mts";
import { SMOKE_CHECKS, UNATTRIBUTED_WHITELIST } from "./registry.mts";

declare global {
  interface Window {
    __SMOKE__?: SmokeReport;
  }
}

/* ------------------------------------------------------------------ 参数 */

const params = new URLSearchParams(location.search);
const MODE: SmokeMode = params.get("mode") === "live" ? "live" : "fixture";
const RUN_ID = params.get("run") ?? "unset";
const AK = params.get("ak") ?? "";
const READY_MS = Number(params.get("readyMs") ?? (MODE === "live" ? 40_000 : 15_000));
const SERVICE_MS = Number(params.get("serviceMs") ?? (MODE === "live" ? 20_000 : 5_000));
const UI_MS = Number(params.get("uiMs") ?? (MODE === "live" ? 20_000 : 5_000));

const CENTER = { lng: 116.404, lat: 39.915 };
const POINT = { lng: 116.44, lat: 39.93 };
const CITY = "北京";
const KEYWORD = "中关村";
/** 驾车路线起终点（中关村 → 望京）：距离足够产生真实方案，且不依赖某个 POI 的 uid。 */
const DRIVE_FROM = { lng: 116.404, lat: 39.915 };
const DRIVE_TO = { lng: 116.4707, lat: 39.9968 };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询直到条件成立；超时按带原因码的失败结算，绝不让整轮 smoke 挂死。 */
async function until<T>(
  probe: () => T | null | undefined | false,
  ms: number,
  code: string,
  label: string,
): Promise<T> {
  const deadline = performance.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined && value !== false) return value as T;
    if (performance.now() > deadline) fail(code, `${label} 在 ${ms}ms 内没有出现`);
    await sleep(50);
  }
}

/* ------------------------------------------------------------------ 未处理异常 */

const unhandled: SmokeUnhandledEntry[] = [];

/**
 * 页面控制台环形缓冲。
 *
 * 真实 SDK 的失败往往只落在 `console`（tile 403、verify 失败），既不抛错也不走 `onError`；
 * 没有它，「ready 超时」只能得到一个 40 秒的等待结论。
 */
const consoleRing: string[] = [];
for (const level of ["error", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    consoleRing.push(`[${level}] ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")}`);
    if (consoleRing.length > 60) consoleRing.shift();
    original(...args);
  };
}

/** 从某个水位起新出现的 `console.error` 条目：真实 SDK 的失败常常只落在这里。 */
function consoleErrorsSince(mark: number): string[] {
  return consoleRing.slice(mark).filter((line) => line.startsWith("[error]"));
}

/**
 * 归因：只有**同源**（Vite 提供的源码 / 预打包依赖，堆栈里带本轮 origin）的异常才算本库的。
 * 跨域脚本只能给出 `"Script error."`（无堆栈、无 source），签名按 host 推导——
 * 「归因不了」由门禁处理（默认不放行），这里只如实记录。
 */
function signatureFor(source: string): string {
  if (!source) return "cross-origin-script-error";
  try {
    return `cross-origin@${new URL(source).host}`;
  } catch {
    return "cross-origin-unknown-source";
  }
}

window.addEventListener("error", (event) => {
  const source = event.filename ?? "";
  const attributed = source.startsWith(location.origin);
  unhandled.push({
    kind: "error",
    message: event.message || String(event.error ?? "unknown error"),
    source,
    attributed,
    signature: attributed ? "own-origin-error" : signatureFor(source),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const stack = reason instanceof Error ? (reason.stack ?? "") : "";
  const attributed = stack.includes(location.origin);
  unhandled.push({
    kind: "rejection",
    message: reason instanceof Error ? reason.message : String(reason),
    source: attributed ? location.origin : "",
    attributed,
    signature: attributed ? "own-origin-rejection" : "unhandled-rejection",
  });
});

/* ------------------------------------------------------------------ 档位描述 */

interface ModeDescriptor {
  live: boolean;
  /** 传给 `<BMap>` 的 provider；`live` 档刻意**不传**，以走默认入口。 */
  provider: unknown;
  /** 覆盖物读数：真实 SDK 走 `getOverlays()`，Fake 走自己的账本。 */
  overlays(raw: Record<string, unknown>): number;
  /** 控件/图层读数：Fake 有账本；真实 4.0 的 Map 没有读数接口，返回 `-1` 表示改用 DOM 增量。 */
  controls(raw: Record<string, unknown>): number;
  layers(raw: Record<string, unknown>): number;
  /** 卸载后的泄漏门禁：真实 SDK 只能核对可观察量，Fake 有精确诊断。 */
  assertNoLeaks(snapshot: UnmountSnapshot): void;
  /** 「地图真的初始化了」的可观察证据：真实 SDK 有容器 DOM，Fake 有可读账本。 */
  assertMapInitialized(raw: Record<string, unknown>, container: HTMLElement): unknown;
  /**
   * 控件 / 图层挂载的可观察证据。
   *
   * 真实 4.0 的 `Map` **没有** `getControls()` / `getLayers()` 读数接口，矢量图层也不落 DOM，
   * 所以 live 档的主要证据是**拦截真实 `Map.addControl` / `Map.addLayer`**：它能证明
   * 「组件 → Driver → 真实 SDK」这条链路真的发生过，而不是「调用没抛错所以大概挂上了」
   * （第 1 轮评审 P1：只断言能力表 + 无 console.error 会在图层静默 no-op 时假绿）。
   *
   * **这条证据的边界**（如实声明）：拦截只能证明调用发生了，不能证明 SDK **采纳**了它。
   * 要证明采纳需要 SDK 提供读数入口，上游 4.0.4 没有。
   */
  assertAttached(input: AttachEvidenceInput): unknown;
  notes: Record<string, unknown>;
}

interface UnmountSnapshot {
  raw: Record<string, unknown> | null;
  container: HTMLElement;
  handle: unknown;
  client: unknown;
}

interface AttachEvidenceInput {
  kind: "control" | "layer";
  /** 失败时使用的原因码（`BMAP_CONTROL_NOT_ATTACHED` / `BMAP_LAYER_NOT_ATTACHED`）。 */
  code: string;
  /** 组件名，仅用于文案。 */
  label: string;
  /** 被拦截的真实 SDK 方法名（`addControl` / `addLayer`）。 */
  rawMethod: string;
  /** 该方法的调用次数（0 = 链路没有发生）。 */
  rawCalls: number;
  /** 账本计数（fixture 有账本；live 为 `-1`）。 */
  countBefore: number;
  countAfter: number;
  domChanged: boolean;
  /** 这一步新增的 `console.error` 条目。 */
  consoleErrors: string[];
  /**
   * 能力表里的对应 id（`layer.district`）；**控件在 Catalog 里没有 id**，此时传 `null`，
   * live 档就不做能力断言——不然会拿一个不存在的 id 去 `supports()` 得到 `false` 而假红。
   */
  capabilityId: string | null;
  /** 能力表是否声明支持（读不到能力表或 `capabilityId` 为 `null` 时为 `null`）。 */
  capabilitySupported: boolean | null;
}

let descriptor: ModeDescriptor;
let fake: ReturnType<typeof createFakeBMapV4> | null = null;

function createDescriptor(): ModeDescriptor {
  if (MODE === "fixture") {
    fake = createFakeBMapV4();
    // 「宿主已加载」路径：全局就位后再用 existingGlobalV4Provider 复用，全程零外部请求。
    (globalThis as unknown as { BMap?: unknown }).BMap = fake.namespace;
    const ledger = (raw: Record<string, unknown>): Record<string, unknown[]> =>
      raw as unknown as Record<string, unknown[]>;
    return {
      live: false,
      provider: existingGlobalV4Provider(),
      overlays: (raw) => ledger(raw).overlays.length,
      controls: (raw) => ledger(raw).controls.length,
      layers: (raw) => ledger(raw).layers.length,
      assertNoLeaks: () => fake!.diagnostics.assertNoLeaks("jsapi-v4 browser smoke (fixture)"),
      assertMapInitialized: (raw) => {
        assertSmoke(
          typeof raw.addOverlay === "function" && Array.isArray(raw.overlays),
          "BMAP_FAKE_LEDGER_MISSING",
          "fixture 档拿到的不像 Fake v4 Map（账本 addOverlay/overlays 缺失）",
          { keys: Object.keys(raw).slice(0, 24) },
        );
        return { readApi: "fake-ledger" };
      },
      assertAttached: (input) => {
        assertSmoke(
          input.rawCalls > 0,
          `${input.code}_NO_RAW_CALL`,
          `${input.label} 卸载/挂载路径没有调用 SDK 的 ${input.rawMethod}`,
        );
        assertSmoke(
          input.countAfter > input.countBefore,
          input.code,
          `${input.label} 后账本计数没有增长：${input.countBefore} → ${input.countAfter}`,
        );
        return {
          readApi: `fake-ledger + 拦截 ${input.rawMethod}`,
          rawCalls: input.rawCalls,
          count: input.countAfter,
        };
      },
      notes: { provider: "existingGlobalV4Provider + Fake v4 命名空间", overlaysReadApi: "fake-ledger" },
    };
  }

  const readArray = (target: Record<string, unknown>, member: string): number => {
    const fn = target[member];
    if (typeof fn !== "function") {
      // 成员**不存在**与「返回形状不对」必须分开：合成一个结果会让「SDK 补了读数接口但读错
      // 形状」永远不红（门禁空转）。`getOverlays` 是 4.0.4 声明的既有成员。
      fail("SDK_NO_READ_API", `v4 Map 缺少 ${member}()，读数无法核对`);
    }
    const value = (fn as () => unknown).call(target);
    assertSmoke(Array.isArray(value), "SDK_READ_SHAPE", `map.${member}() 返回值不是数组`);
    return (value as unknown[]).length;
  };
  return {
    live: true,
    provider: undefined,
    overlays: (target) => readArray(target, "getOverlays"),
    // 4.0.4 的 `Map` **没有** `getControls()` / `getLayers()`（官方类型包里逐个成员核对过），
    // 因此控件/图层改用容器 DOM 增量核对。
    controls: () => -1,
    layers: () => -1,
    assertNoLeaks: (snapshot) => {
      const canvasHost =
        (snapshot.container.querySelector(".bmap-canvas-host") as HTMLElement | null) ??
        snapshot.container;
      assertSmoke(
        canvasHost.childElementCount === 0,
        "DOM_RESIDUE",
        "卸载地图后 SDK 的 map DOM 仍留在容器里",
        { canvasHostChildren: canvasHost.childElementCount },
      );
      const driver = (snapshot.client as { driver?: { map?: { getZoom?: (h: unknown) => number } } })
        ?.driver;
      assertSmoke(driver?.map?.getZoom, "HARNESS_NO_DRIVER", "拿不到 client.driver.map");
      let code: string | null = null;
      try {
        driver!.map!.getZoom!(snapshot.handle);
      } catch (error) {
        code = (error as { code?: string }).code ?? "UNKNOWN";
      }
      assertSmoke(
        code === "BMAP_RESOURCE_DISPOSED",
        "HANDLE_NOT_DISPOSED",
        `卸载后 getZoom 的错误码应为 BMAP_RESOURCE_DISPOSED，实际 ${String(code)}`,
        { code },
      );
    },
    assertMapInitialized: (_raw, container) => {
      assertSmoke(
        container.childElementCount > 0,
        "BMAP_NO_CONTAINER_DOM",
        "地图容器里没有任何 SDK DOM，地图可能没有真正初始化",
        { children: container.childElementCount },
      );
      return {
        children: container.childElementCount,
        firstChild: container.firstElementChild?.className ?? "",
      };
    },
    assertAttached: (input) => {
      // 主要证据：真实 SDK 的那次挂载调用真的发生过（而不是「没抛错所以大概挂上了」）。
      assertSmoke(
        input.rawCalls > 0,
        input.code,
        `真实 Map.${input.rawMethod} 在 ${input.label} 挂载期间没有被调用：组件 → Driver → SDK 的链路没有发生`,
        { rawCalls: input.rawCalls, rawMethod: input.rawMethod },
      );
      assertSmoke(
        input.capabilityId === null || input.capabilitySupported === true,
        `${input.code}_CAPABILITY`,
        `能力表没有声明支持 ${String(input.capabilityId)}（读到的值：${String(input.capabilitySupported)}）`,
      );
      assertSmoke(
        input.consoleErrors.length === 0,
        `${input.code}_CONSOLE_ERROR`,
        `${input.label} 挂载期间出现 ${input.consoleErrors.length} 条 console.error`,
        { errors: input.consoleErrors.slice(0, 3) },
      );
      return {
        readApi: `拦截真实 Map.${input.rawMethod}（4.0 没有控制/图层读数接口）`,
        rawCalls: input.rawCalls,
        domChanged: input.domChanged,
        capabilityId: input.capabilityId,
        capabilitySupported: input.capabilitySupported,
      };
    },
    notes: { provider: "默认入口（baiduJsapiV4Provider → 官方 jsapi-loader）", overlaysReadApi: "getOverlays" },
  };
}
/* ------------------------------------------------------------------ 挂载助手 */

interface Mounted {
  host: HTMLElement;
  app: App;
  container(): HTMLElement;
  raw(): Record<string, unknown>;
  client(): unknown;
  /** `<BMap>` 默认插槽给出的运行时状态（`idle` / `loading` / `ready` / `error` …）。 */
  status(): unknown;
  handle(): unknown;
  snapshot(): UnmountSnapshot;
  ready: Promise<unknown>;
  treeErrors: unknown[];
  flags: Record<string, boolean>;
  infoRef: { value: unknown };
  autoRef: { value: unknown };
  searchRef: { value: unknown };
  detailRef: { value: unknown };
  routeRef: { value: unknown };
  /** 四个 wrapper 的状态输入（`BPlaceDetail` 的 `uid` 由真实检索结果喂进来，不硬编码）。 */
  uiKit: { placeUid: string };
  /** wrapper 事件落点：检查体靠它断言「事件真的到达」，而不是只看返回值。 */
  uiKitEvents: {
    searchLoad: unknown[];
    searchSelect: unknown[];
    detailLoad: unknown[];
    routeResult: unknown[];
    routeError: unknown[];
  };
  unmount(): Promise<void>;
}

function mountTree(): Mounted {
  const host = document.createElement("div");
  host.style.cssText = "width:360px;height:280px";
  document.getElementById("stage")!.appendChild(host);

  const flags = reactive<Record<string, boolean>>({
    marker: false,
    polyline: false,
    info: false,
    zoom: false,
    district: false,
    autocomplete: false,
    placesearch: false,
    placedetail: false,
    routeplan: false,
  });
  const treeErrors: unknown[] = [];
  const mapRef = ref<unknown>(null);
  const infoRef = ref<unknown>(null);
  const autoRef = ref<unknown>(null);
  const searchRef = ref<unknown>(null);
  const detailRef = ref<unknown>(null);
  const routeRef = ref<unknown>(null);
  const uiKit = reactive({ placeUid: "" });
  const uiKitEvents: Mounted["uiKitEvents"] = {
    searchLoad: [],
    searchSelect: [],
    detailLoad: [],
    routeResult: [],
    routeError: [],
  };
  let settleReady: (value: unknown) => void = () => {};
  const ready = new Promise<unknown>((resolve) => {
    settleReady = resolve;
  });
  let capturedClient: unknown = null;
  let capturedStatus: unknown = null;

  const GeoProbe = defineComponent({
    name: "SmokeGeoProbe",
    setup() {
      const geocoder = useBMapGeocoder();
      (globalThis as unknown as { __smokeGeocoder?: unknown }).__smokeGeocoder = geocoder;
      return () => h("div", { class: "smoke-geo-probe" });
    },
  });

  const children = (): VNode[] => {
    const nodes: VNode[] = [];
    if (flags.marker) nodes.push(h(BMarker, { position: POINT, title: "smoke-marker" }));
    if (flags.polyline)
      nodes.push(h(BPolyline, { path: [CENTER, POINT], strokeColor: "#ff0000", strokeWeight: 3 }));
    if (flags.info)
      nodes.push(
        h(
          BInfoWindow,
          { ref: infoRef, open: true, position: POINT, title: "smoke" },
          { default: () => "smoke-infowindow-content" },
        ),
      );
    if (flags.zoom) nodes.push(h(BZoom, {}));
    if (flags.district) nodes.push(h(BDistrictLayer, { name: "北京市" }));
    if (flags.autocomplete) nodes.push(h(BPlaceAutocomplete as never, { ref: autoRef, location: CITY }));
    if (flags.placesearch) {
      nodes.push(
        h(BPlaceSearch as never, {
          ref: searchRef,
          onLoad: (pois: unknown) => uiKitEvents.searchLoad.push(pois),
          onSelect: (poi: unknown) => uiKitEvents.searchSelect.push(poi),
        }),
      );
    }
    if (flags.placedetail) {
      nodes.push(
        h(BPlaceDetail as never, {
          ref: detailRef,
          // `uid` 由真实检索结果喂进来（见 `ui-kit-placesearch-load`），不硬编码某个 POI。
          uid: uiKit.placeUid || undefined,
          onLoad: (detail: unknown) => uiKitEvents.detailLoad.push(detail),
        }),
      );
    }
    if (flags.routeplan) {
      nodes.push(
        h(BRoutePlan as never, {
          ref: routeRef,
          onResult: (result: unknown) => uiKitEvents.routeResult.push(result),
          onError: (error: unknown) => uiKitEvents.routeError.push(error),
        }),
      );
    }
    nodes.push(h(GeoProbe));
    return nodes;
  };

  const root = defineComponent({
    name: "SmokeRoot",
    render() {
      const mapProps: Record<string, unknown> = {
        ref: mapRef,
        center: { ...CENTER },
        zoom: 14,
        height: "280px",
        onReady: (payload: unknown) => settleReady(payload),
        onError: (error: unknown) => treeErrors.push(error),
      };
      if (descriptor.provider) {
        mapProps.provider = descriptor.provider;
        mapProps.loadOptions = { ak: "fixture-no-network" };
      } else {
        // live：只给 ak，走**默认入口**（这正是本档要证明的东西，不能显式传 provider）。
        mapProps.ak = AK;
      }
      return h(
        BMap as never,
        mapProps,
        {
          default: (slotProps: { client?: unknown; status?: unknown }) => {
            if (slotProps) {
              capturedClient = slotProps.client ?? capturedClient;
              capturedStatus = slotProps.status ?? capturedStatus;
            }
            return children();
          },
        } as never,
      );
    },
  });

  const app = createApp(root);
  app.mount(host);

  const containerFn = (): HTMLElement => {
    const api = mapRef.value as { getContainer?: () => HTMLElement } | null;
    const el = api?.getContainer?.();
    assertSmoke(el, "HARNESS_NO_CONTAINER", "拿不到 <BMap> 的容器元素");
    return el!;
  };
  const handleFn = (): unknown => {
    const api = mapRef.value as { getMapInstance?: () => unknown } | null;
    return api?.getMapInstance?.() ?? null;
  };
  const rawFn = (): Record<string, unknown> =>
    ((handleFn() as { raw?: Record<string, unknown> } | null)?.raw ?? {}) as Record<string, unknown>;

  return {
    host,
    app,
    container: containerFn,
    raw: rawFn,
    client: () => capturedClient,
    status: () => capturedStatus,
    handle: handleFn,
    snapshot: () => ({
      raw: rawFn(),
      container: containerFn(),
      handle: handleFn(),
      client: capturedClient,
    }),
    ready,
    treeErrors,
    flags,
    infoRef,
    autoRef,
    searchRef,
    detailRef,
    routeRef,
    uiKit,
    uiKitEvents,
    async unmount() {
      app.unmount();
      await nextTick();
      host.remove();
    },
  };
}

/** 容器内 DOM 的「形状签名」：控件/图层在 4.0.4 上没有读数接口，改用容器 DOM 增量核对。 */
function uiSignature(container: HTMLElement): string {
  return [...container.querySelectorAll("*")]
    .map((el) => `${el.tagName}.${el.className}`)
    .sort()
    .join("|");
}

interface RawCallRecorder {
  /** 每次调用记录一份实参（浅拷贝），供检查断言「链路真的发生过」。 */
  readonly calls: unknown[][];
  restore(): void;
}

/**
 * 临时包装真实 `rawMap` 上的一个写入方法，记录调用参数后再转调原实现。
 *
 * 为什么需要它：真实 4.0 的 `Map` 没有控制 / 图层读数接口，容器 DOM 又可能因为别的原因变化，
 * 于是「没抛错」成了唯一的证据 —— 图层静默 no-op 时会假绿。拦截真实调用把证据换成
 * 「SDK 的那次方法调用确实发生了」。**调用方必须 `finally { restore() }`**，否则包装会留在
 * 地图对象上影响后续检查。
 */
function recordRawCalls(raw: Record<string, unknown>, method: string): RawCallRecorder {
  const original = raw[method];
  const calls: unknown[][] = [];
  if (typeof original !== "function") {
    // 引擎没有这个入口：`calls` 保持为空，由检查如实报「调用没发生」，而不是在这里悄悄放过。
    return { calls, restore: () => {} };
  }
  raw[method] = function (this: unknown, ...args: unknown[]): unknown {
    calls.push(args);
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  return {
    calls,
    restore: () => {
      raw[method] = original;
    },
  };
}

/** 读能力表；读不到（没有 capabilities / 抛错）时返回 `null`，由检查如实记录而不是当通过。 */
function capabilitySupported(client: unknown, capability: string): boolean | null {
  const capabilities = (client as { driver?: { capabilities?: { supports?: (c: string) => boolean } } })
    ?.driver?.capabilities;
  if (typeof capabilities?.supports !== "function") return null;
  try {
    return capabilities.supports(capability);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 检查实现 */

interface Ctx {
  mounted: Mounted;
  baseline: { overlays: number };
  containerSignature: string;
}

interface CheckImpl {
  run(ctx: Ctx): Promise<unknown> | unknown;
}

async function mountFresh(readyMs: number, label: string): Promise<Mounted> {
  // 刻意分两步：超时也要留住 `fresh`，否则前置失败时连诊断都拿不到（`mounted` 会是 null）。
  const fresh = mountTree();
  await withTimeout(fresh.ready, readyMs, label, "BMAP_READY_TIMEOUT");
  await sleep(MODE === "live" ? 400 : 50);
  return fresh;
}

const CHECKS: Record<string, CheckImpl> = {
  "provider-default-delegation": {
    run() {
      // 只数**官方 Loader 注入的那个入口** `api?...`：SDK 自己随后拉的 `getscript?...` 不算
      // （它是 SDK 的内部行为，换一次版本就可能变）。
      const entries = [
        ...document.querySelectorAll<HTMLScriptElement>('script[src*="api.map.baidu.com/api?"]'),
      ];
      assertSmoke(
        entries.length === 1,
        "BMAP_ENTRY_SCRIPT_COUNT",
        `官方 Loader 的入口 script 应恰好 1 个，实际 ${entries.length}`,
        { count: entries.length, srcs: entries.map((el) => redactAk(el.src)) },
      );
      const src = entries[0]!.src;
      assertSmoke(src.includes("v=4.0"), "BMAP_ENTRY_URL", "官方入口 URL 缺少 v=4.0", {
        src: redactAk(src),
      });
      // 「默认路径真的走官方实现」的**形状证据**：回调全局名是官方 Loader 自己起的
      // （`__bmapJSApiOnLoad_<n>`），自研 transport 只会用自己那套名字。
      // 契约行见 docs/zh-CN/contributing/official-packages.md「入口 URL」一行。
      assertSmoke(
        /[?&]callback=__bmapJSApiOnLoad_\d+/.test(src),
        "BMAP_ENTRY_CALLBACK_SHAPE",
        "入口 URL 的 callback 不是官方 Loader 的 `__bmapJSApiOnLoad_<n>`，默认路径可能没在委托官方实现",
        { src: redactAk(src) },
      );
      assertSmoke(
        typeof (globalThis as { BMap?: { Map?: unknown } }).BMap?.Map === "function",
        "BMAP_NAMESPACE",
        "入口 script 执行后 globalThis.BMap.Map 仍不是构造器",
      );
      return {
        entries: entries.length,
        src: redactAk(src),
        getscript: document.querySelectorAll('script[src*="api.map.baidu.com/getscript"]').length,
      };
    },
  },

  "fixture-namespace-reused": {
    run() {
      const scripts = document.querySelectorAll('script[src*="api.map.baidu.com"]');
      assertSmoke(
        scripts.length === 0,
        "FIXTURE_NETWORK_LEAK",
        `fixture 档不应出现官方入口 script，实际 ${scripts.length} 个`,
      );
      assertSmoke(
        (globalThis as { BMap?: unknown }).BMap,
        "FIXTURE_NO_NAMESPACE",
        "fixture 档没有注入 v4 命名空间",
      );
      return { scripts: scripts.length, provider: "existingGlobalV4Provider" };
    },
  },

  "map-ready": {
    run(ctx) {
      const handle = ctx.mounted.handle();
      assertSmoke(handle, "BMAP_NO_HANDLE", "ready 之后拿不到 MapHandle");
      return descriptor.assertMapInitialized(ctx.mounted.raw(), ctx.mounted.container());
    },
  },

  "map-view-round-trip": {
    run(ctx) {
      const raw = ctx.mounted.raw();
      const getCenter = raw.getCenter as undefined | (() => { lng: number; lat: number });
      const getZoom = raw.getZoom as undefined | (() => number);
      assertSmoke(
        typeof getCenter === "function" && typeof getZoom === "function",
        "SDK_NO_READ_API",
        "v4 Map 缺少 getCenter/getZoom",
      );
      const center = getCenter!.call(raw);
      const zoom = getZoom!.call(raw);
      assertSmoke(
        Math.abs(center.lng - CENTER.lng) < 0.01 && Math.abs(center.lat - CENTER.lat) < 0.01,
        "BMAP_VIEW_MISMATCH",
        `初次视野与传入的 center 不一致：${JSON.stringify(center)}`,
        { center, zoom },
      );
      assertSmoke(zoom === 14, "BMAP_ZOOM_MISMATCH", `初次 zoom 应为 14，实际 ${zoom}`, { zoom });
      return { center, zoom };
    },
  },

  "overlay-marker": {
    async run(ctx) {
      ctx.mounted.flags.marker = true;
      await nextTick();
      await sleep(120);
      return {
        overlays: await until(
          () => {
            const count = descriptor.overlays(ctx.mounted.raw());
            return count > ctx.baseline.overlays ? count : null;
          },
          3_000,
          "BMAP_MARKER_NOT_ATTACHED",
          "覆盖物计数增量",
        ),
      };
    },
  },

  "overlay-polyline": {
    async run(ctx) {
      ctx.mounted.flags.polyline = true;
      await nextTick();
      await sleep(120);
      return {
        overlays: await until(
          () => {
            const count = descriptor.overlays(ctx.mounted.raw());
            return count > ctx.baseline.overlays + 1 ? count : null;
          },
          3_000,
          "BMAP_POLYLINE_NOT_ATTACHED",
          "覆盖物计数增量",
        ),
      };
    },
  },

  "control-zoom": {
    async run(ctx) {
      const recorder = recordRawCalls(ctx.mounted.raw(), "addControl");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const countBefore = descriptor.controls(ctx.mounted.raw());
        const mark = consoleRing.length;
        ctx.mounted.flags.zoom = true;
        await nextTick();
        await sleep(400);
        return descriptor.assertAttached({
          kind: "control",
          code: "BMAP_CONTROL_NOT_ATTACHED",
          label: "<BZoom>",
          rawMethod: "addControl",
          rawCalls: recorder.calls.length,
          countBefore,
          countAfter: descriptor.controls(ctx.mounted.raw()),
          domChanged: uiSignature(ctx.mounted.container()) !== signatureBefore,
          consoleErrors: consoleErrorsSince(mark),
          capabilityId: null,
          capabilitySupported: null,
        });
      } finally {
        recorder.restore();
      }
    },
  },

  "layer-district": {
    async run(ctx) {
      const recorder = recordRawCalls(ctx.mounted.raw(), "addLayer");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const mark = consoleRing.length;
        const countBefore = descriptor.layers(ctx.mounted.raw());
        ctx.mounted.flags.district = true;
        await nextTick();
        await sleep(600);
        return descriptor.assertAttached({
          kind: "layer",
          code: "BMAP_LAYER_NOT_ATTACHED",
          label: "<BDistrictLayer>",
          rawMethod: "addLayer",
          rawCalls: recorder.calls.length,
          countBefore,
          countAfter: descriptor.layers(ctx.mounted.raw()),
          domChanged: uiSignature(ctx.mounted.container()) !== signatureBefore,
          consoleErrors: consoleErrorsSince(mark),
          capabilityId: "layer.district",
          capabilitySupported: capabilitySupported(ctx.mounted.client(), "layer.district"),
        });
      } finally {
        recorder.restore();
      }
    },
  },

  "infowindow-visible": {
    async run(ctx) {
      ctx.mounted.flags.info = true;
      await nextTick();
      // 真实 4.0 的 openInfoWindow 是**异步生效**的（同 tick 仍为 null），必须轮询活状态。
      await until(
        () => {
          const raw = ctx.mounted.raw();
          const getInfoWindow = raw.getInfoWindow as undefined | (() => unknown);
          if (typeof getInfoWindow === "function") return getInfoWindow.call(raw) ?? null;
          return (raw as { infoWindow?: unknown }).infoWindow ?? null;
        },
        5_000,
        "BMAP_INFOWINDOW_NOT_OPEN",
        "地图的当前气泡",
      );
      const shell = (ctx.mounted.infoRef.value as { $el?: HTMLElement } | null)?.$el;
      assertSmoke(shell, "HARNESS_NO_INFOWINDOW_SHELL", "拿不到 <BInfoWindow> 的内容节点");
      const style = getComputedStyle(shell!);
      assertSmoke(
        style.display !== "none" && style.visibility !== "hidden",
        "BMAP_INFOWINDOW_HIDDEN",
        `气泡内容节点仍然不可见（display=${style.display} visibility=${style.visibility}）——#72 的可见性回归`,
        { display: style.display, visibility: style.visibility },
      );
      assertSmoke(
        (shell!.textContent ?? "").includes("smoke-infowindow-content"),
        "BMAP_INFOWINDOW_EMPTY",
        "气泡内容节点里没有渲染出内容",
        { text: shell!.textContent },
      );
      return { text: shell!.textContent };
    },
  },

  "service-geocode": {
    async run() {
      const geocoder = (
        globalThis as { __smokeGeocoder?: { get: (a: string, c: string) => Promise<unknown> } }
      ).__smokeGeocoder;
      assertSmoke(geocoder, "HARNESS_NO_GEOCODER", "geocode 探针没有拿到 useBMapGeocoder 实例");
      const point = await withBlockedTimeout(
        geocoder!.get("北京市海淀区中关村", CITY),
        SERVICE_MS,
        "Geocoder.getPoint",
        "SERVICE_GEOCODE_TIMEOUT",
      );
      // 服务侧配额 / Referer 限制时官方只回 null（#72 的处置：不嗅探私有面）。
      // 这是**前置不成立**（AK 权限 / 配额 / 网络），本轮无法得出结论 ⇒ 记 `blocked`（退出码 3，
      // 仍然不可放行），而不是 `fail`（那会把一次配额抖动写成「库回归」）。
      if (point === null) {
        block(
          "SERVICE_GEOCODE_EMPTY",
          "Geocoder 回包为空：AK 权限 / 配额 / 网络不成立，本轮无法判定",
        );
      }
      return point;
    },
  },

  "ui-kit-autocomplete-search": {
    async run(ctx) {
      const mark = consoleRing.length;
      ctx.mounted.flags.autocomplete = true;
      ctx.mounted.treeErrors.length = 0;
      await nextTick();
      const api = (await until(
        () => {
          const value = ctx.mounted.autoRef.value as { status?: string } | null;
          return value?.status === "ready" ? value : null;
        },
        UI_MS,
        "UIKIT_AUTO_NOT_READY",
        "BPlaceAutocomplete ready",
      )) as unknown as {
        search(keyword: string): Promise<void>;
        getInputValue(): Promise<string>;
      };
      // 官方 UI Kit 的检索是网络阶段：超时按 blocked（外部前置），promise 自身拒绝照原样透传。
      await withBlockedTimeout(
        api.search(KEYWORD),
        UI_MS,
        "autocomplete.search",
        "UIKIT_AUTO_SEARCH_TIMEOUT",
      );
      const inputValue = await api.getInputValue();
      const hostEl = (ctx.mounted.autoRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_AUTO_NO_HOST", "拿不到 BPlaceAutocomplete 的宿主元素");
      assertSmoke(
        hostEl!.querySelector("input"),
        "UIKIT_AUTO_NO_INPUT",
        "宿主元素里没有官方 UI Kit 渲染的输入框（模块或样式可能没加载）",
        { html: hostEl!.innerHTML.slice(0, 200) },
      );
      assertSmoke(
        inputValue === KEYWORD,
        "UIKIT_AUTO_INPUT_VALUE",
        `检索后输入框值应为 ${KEYWORD}，实际 ${String(inputValue)}`,
      );

      // 回收路径（#72 欠账 3「Autocomplete 回收干净」）：卸载后整棵子树必须从文档里撤走。
      // 精确的「destroy 被调用 / 监听解绑」记账由 `v3-ui-kit-lifecycle.test.ts` 的假 widget 负责
      // （浏览器里没有字节级的 widget 账本）；这里证明的是**真实链路下的可观察结果**。
      ctx.mounted.flags.autocomplete = false;
      await nextTick();
      await sleep(300);
      assertSmoke(
        !document.body.contains(hostEl!),
        "UIKIT_AUTO_HOST_RESIDUE",
        "卸载 BPlaceAutocomplete 之后宿主子树仍留在文档里，回收路径没有生效",
      );
      assertSmoke(
        ctx.mounted.treeErrors.length === 0,
        "UIKIT_AUTO_TREE_ERROR",
        `卸载 Autocomplete 期间地图组件报错 ${ctx.mounted.treeErrors.length} 次`,
        { errors: ctx.mounted.treeErrors.slice(0, 2).map((e) => String(e)) },
      );
      assertSmoke(
        consoleErrorsSince(mark).length === 0,
        "UIKIT_AUTO_CONSOLE_ERROR",
        "Autocomplete 检索 / 卸载期间出现 console.error",
        { errors: consoleErrorsSince(mark).slice(0, 3) },
      );
      return {
        inputValue,
        hostDetached: true,
        stylesheetRules: [...document.styleSheets].length,
      };
    },
  },

  "ui-kit-placesearch-load": {
    async run(ctx) {
      ctx.mounted.flags.placesearch = true;
      await nextTick();
      const api = (await until(
        () => {
          const value = ctx.mounted.searchRef.value as { status?: string } | null;
          return value?.status === "ready" ? value : null;
        },
        UI_MS,
        "UIKIT_SEARCH_NOT_READY",
        "BPlaceSearch ready",
      )) as unknown as { search(keyword: string): Promise<void> };
      await withBlockedTimeout(
        api.search(KEYWORD),
        UI_MS,
        "placesearch.search",
        "UIKIT_SEARCH_TIMEOUT",
      );
      const hostEl = (ctx.mounted.searchRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_SEARCH_NO_HOST", "拿不到 BPlaceSearch 的宿主元素");
      // 宿主里的 DOM 全部由官方 UI Kit 渲染：检索结算后必须有子节点（本库不渲染列表）。
      assertSmoke(
        hostEl!.childElementCount > 0,
        "UIKIT_SEARCH_NO_DOM",
        "检索结算后 BPlaceSearch 的宿主里没有任何 DOM，官方 UI Kit 可能没渲染结果列表",
        { html: (hostEl!.innerHTML ?? "").slice(0, 200) },
      );
      // 必需事件必须真的到达（不能只看 `search()` 结算）：`load` 是「一轮检索完成」的公开出口。
      const pois = await until(
        () => {
          const last = ctx.mounted.uiKitEvents.searchLoad.at(-1);
          return Array.isArray(last) && last.length > 0 ? (last as { uid?: string }[]) : null;
        },
        UI_MS,
        "UIKIT_SEARCH_NO_LOAD_EVENT",
        "BPlaceSearch 的 load 事件载荷",
      );
      // 顺手把真实 uid 交给下一条检查（详情面板），避免硬编码某个 POI。
      const withUid = pois.find((poi) => typeof poi.uid === "string" && poi.uid.length > 0);
      assertSmoke(
        withUid?.uid,
        "UIKIT_SEARCH_NO_UID",
        "检索结果里没有可用 uid，详情面板无法用真实数据验证",
        { sample: pois.slice(0, 2) },
      );
      ctx.mounted.uiKit.placeUid = withUid!.uid!;
      return {
        html: (hostEl!.innerHTML ?? "").slice(0, 120),
        children: hostEl!.childElementCount,
        pois: pois.length,
        uid: withUid!.uid,
      };
    },
  },

  /** 第三个 wrapper：详情面板 —— 用上一步真实检索到的 uid 打开，并验证回收路径。 */
  "ui-kit-placedetail-load": {
    async run(ctx) {
      const mark = consoleRing.length;
      const uid = ctx.mounted.uiKit.placeUid;
      assertSmoke(uid, "UIKIT_DETAIL_NO_UID", "上一步没有拿到 uid（详情检查的前置）");
      ctx.mounted.uiKitEvents.detailLoad.length = 0;
      ctx.mounted.flags.placedetail = true;
      await nextTick();
      const api = (await until(
        () => {
          const value = ctx.mounted.detailRef.value as { status?: string } | null;
          return value?.status === "ready" ? value : null;
        },
        UI_MS,
        "UIKIT_DETAIL_NOT_READY",
        "BPlaceDetail ready",
      )) as unknown as { status: string };
      assertSmoke(api.status === "ready", "UIKIT_DETAIL_STATUS", `状态应为 ready，实际 ${api.status}`);
      // `load` 到达 = 详情真的取回来了（该 wrapper 刻意不合成 error 事件，见组件文件头）。
      const detail = await withBlockedTimeout(
        until(
          () => ctx.mounted.uiKitEvents.detailLoad.at(-1) ?? null,
          UI_MS,
          "UIKIT_DETAIL_NO_LOAD_EVENT",
          "BPlaceDetail 的 load 事件",
        ),
        UI_MS,
        "placedetail.load",
        "UIKIT_DETAIL_TIMEOUT",
      );
      const hostEl = (ctx.mounted.detailRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_DETAIL_NO_HOST", "拿不到 BPlaceDetail 的宿主元素");
      const rendered = hostEl!.childElementCount > 0;
      assertSmoke(
        rendered,
        "UIKIT_DETAIL_NO_DOM",
        "详情面板的宿主里没有任何 DOM，官方 UI Kit 可能没渲染详情",
        { html: (hostEl!.innerHTML ?? "").slice(0, 200) },
      );
      assertSmoke(
        detail && typeof detail === "object" && Object.keys(detail as object).length > 0,
        "UIKIT_DETAIL_EMPTY",
        "详情载荷是空对象，形状无法核对",
        { detail },
      );
      // 回收路径（与另两个 wrapper 同口径）。
      ctx.mounted.flags.placedetail = false;
      await nextTick();
      await sleep(300);
      assertSmoke(
        !document.body.contains(hostEl!),
        "UIKIT_DETAIL_HOST_RESIDUE",
        "卸载 BPlaceDetail 之后宿主子树仍留在文档里",
      );
      assertSmoke(
        consoleErrorsSince(mark).length === 0,
        "UIKIT_DETAIL_CONSOLE_ERROR",
        "详情加载 / 卸载期间出现 console.error",
        { errors: consoleErrorsSince(mark).slice(0, 3) },
      );
      return { uid, hostDetached: true, detailKeys: Object.keys(detail as object).slice(0, 8) };
    },
  },

  /** 第四个 wrapper：路线面板 —— 真实驾车检索（锁定版本只开放驾车，见组件文件头）。 */
  "ui-kit-routeplan-search": {
    async run(ctx) {
      const mark = consoleRing.length;
      ctx.mounted.uiKitEvents.routeResult.length = 0;
      ctx.mounted.uiKitEvents.routeError.length = 0;
      ctx.mounted.flags.routeplan = true;
      await nextTick();
      const api = (await until(
        () => {
          const value = ctx.mounted.routeRef.value as { status?: string } | null;
          return value?.status === "ready" ? value : null;
        },
        UI_MS,
        "UIKIT_ROUTE_NOT_READY",
        "BRoutePlan ready",
      )) as unknown as {
        search(options: {
          start: { lng: number; lat: number };
          end: { lng: number; lat: number };
          startName?: string;
          endName?: string;
        }): Promise<{ type: string; plans: { distance: number; duration: number }[] }>;
        getCurrentType(): Promise<string>;
      };
      assertSmoke(
        (await api.getCurrentType()) === "driving",
        "UIKIT_ROUTE_TYPE",
        "锁定版本的当前规划类型应为 driving",
      );
      const result = await withBlockedTimeout(
        api
          .search({ start: DRIVE_FROM, end: DRIVE_TO, startName: "中关村", endName: "望京" })
          .catch((error: { code?: string; message?: string }) => {
            // 服务类失败（`BMAP_SERVICE_FAILED`）= 外部前置（配额 / 权限 / 网络），与
            // `service-geocode` 同口径记 blocked；结构性错误继续按 fail 冒泡。
            if (error?.code === "BMAP_SERVICE_FAILED") {
              block("UIKIT_ROUTE_SERVICE_FAILED", `路线服务未返回可用结果：${error.message ?? ""}`);
            }
            throw error;
          }),
        UI_MS,
        "routeplan.search",
        "UIKIT_ROUTE_TIMEOUT",
      );
      assertSmoke(
        Array.isArray(result.plans) && result.plans.length > 0,
        "UIKIT_ROUTE_NO_PLAN",
        "驾车检索没有返回任何方案",
        { type: result.type, plans: result.plans?.length ?? null },
      );
      const hostEl = (ctx.mounted.routeRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_ROUTE_NO_HOST", "拿不到 BRoutePlan 的宿主元素");
      assertSmoke(
        hostEl!.childElementCount > 0,
        "UIKIT_ROUTE_NO_DOM",
        "路线面板的宿主里没有任何 DOM，官方 UI Kit 可能没渲染面板",
        { html: (hostEl!.innerHTML ?? "").slice(0, 200) },
      );
      // 事件与返回值同源（`result` 事件载荷与 `search()` 的 Promise 结果是同一形状）。
      assertSmoke(
        ctx.mounted.uiKitEvents.routeResult.length > 0,
        "UIKIT_ROUTE_NO_RESULT_EVENT",
        "`result` 事件没有到达（返回值有结果但事件没发，说明事件绑定断了）",
      );
      assertSmoke(
        ctx.mounted.uiKitEvents.routeError.length === 0,
        "UIKIT_ROUTE_ERROR_EVENT",
        "路线检索期间收到了 error 事件",
        { errors: ctx.mounted.uiKitEvents.routeError.slice(0, 2) },
      );
      // 回收路径。
      ctx.mounted.flags.routeplan = false;
      await nextTick();
      await sleep(300);
      assertSmoke(
        !document.body.contains(hostEl!),
        "UIKIT_ROUTE_HOST_RESIDUE",
        "卸载 BRoutePlan 之后宿主子树仍留在文档里",
      );
      assertSmoke(
        consoleErrorsSince(mark).length === 0,
        "UIKIT_ROUTE_CONSOLE_ERROR",
        "路线检索 / 卸载期间出现 console.error",
        { errors: consoleErrorsSince(mark).slice(0, 3) },
      );
      return {
        type: result.type,
        plans: result.plans.length,
        firstPlan: result.plans[0],
        events: ctx.mounted.uiKitEvents.routeResult.length,
      };
    },
  },

  "second-provider-reuses-sdk": {
    async run() {
      const before = document.querySelectorAll('script[src*="api.map.baidu.com/api?"]').length;
      const second = mountTree();
      try {
        await withTimeout(second.ready, READY_MS, "第二个 <BMap> ready", "BMAP_SECOND_READY_TIMEOUT");
        await sleep(200);
        const after = document.querySelectorAll('script[src*="api.map.baidu.com/api?"]').length;
        assertSmoke(
          after === before,
          "BMAP_DUPLICATE_ENTRY_SCRIPT",
          `第二个入口重复注入了 SDK script：${before} → ${after}`,
        );
        return { scriptsBefore: before, scriptsAfter: after };
      } finally {
        await second.unmount();
      }
    },
  },

  "unmount-release": {
    async run(ctx) {
      const snapshot = ctx.mounted.snapshot();
      // 取**引用**而不是 `typeof`：`globalThis.BMap = {}` 之后 `typeof` 仍是 `"object"`，
      // 只比 typeof 发现不了「全局被改写」，而「不得改写上游全局」正是这条要守的契约。
      const globalBefore = (globalThis as { BMap?: unknown }).BMap;
      await ctx.mounted.unmount();
      await sleep(300);
      descriptor.assertNoLeaks(snapshot);
      const globalAfter = (globalThis as { BMap?: unknown }).BMap;
      assertSmoke(
        globalAfter === globalBefore,
        "GLOBAL_REPLACED",
        "卸载后官方全局被删除或改写：本库没有任何组件有权处置上游注入的全局",
        { removed: globalAfter === undefined, typeBefore: typeof globalBefore },
      );
      return { sameNamespace: true };
    },
  },

  "remount-after-unmount": {
    async run() {
      const again = await mountFresh(READY_MS, "重挂载 <BMap> ready");
      try {
        await nextTick();
        assertSmoke(again.handle(), "BMAP_REMOUNT_NO_HANDLE", "重挂载后拿不到 MapHandle");
        const raw = again.raw();
        const zoom = (raw.getZoom as undefined | (() => number))?.call(raw);
        assertSmoke(zoom === 14, "BMAP_REMOUNT_ZOOM", `重挂载后 zoom 应为 14，实际 ${String(zoom)}`);
        return { zoom };
      } finally {
        await again.unmount();
      }
    },
  },
};

/* ------------------------------------------------------------------ 主流程 */

/**
 * 前置失败时的诊断快照。
 *
 * 没有它，「<BMap> ready 超时」只能得到一个 40 秒的等待结论——分不清是入口 script 没注入、
 * AK 被拒、还是容器/组件层的问题。字段全部经 `redactAk`，不外泄凭据。
 */
function smokeDiagnostics(mounted: Mounted | null): Record<string, unknown> {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) =>
    redactAk(s.src),
  );
  const bmap = (globalThis as { BMap?: Record<string, unknown> }).BMap;
  return {
    entryScripts: scripts.filter((src) => src.includes("api.map.baidu.com")),
    scriptCount: scripts.length,
    bmapType: typeof bmap,
    bmapMapCtor: typeof bmap?.Map,
    // MapType 常量在真实 4.0 上到底挂在哪一层（`MapTypeId` 静态成员 / 命名空间自身 / 全局），
    // 是「默认入口能不能 ready」的直接证据，所以固定记下来而不是靠猜。
    mapTypeId: bmap?.MapTypeId
      ? { keys: Object.keys(bmap.MapTypeId as object).slice(0, 12) }
      : "missing",
    globalMapTypeConstants: ["BMAP_NORMAL_MAP", "BMAP_SATELLITE_MAP", "BMAP_EARTH_MAP"].filter(
      (name) => name in (globalThis as Record<string, unknown>),
    ),
    mapStatus: mounted ? mounted.status() : null,
    mapHandle: mounted ? Boolean(mounted.handle()) : null,
    containerChildren: (() => {
      try {
        return mounted ? mounted.container().childElementCount : null;
      } catch {
        return "no-container";
      }
    })(),
    consoleTail: consoleRing.slice(-12),
    hostHtml: mounted ? mounted.host.innerHTML.slice(0, 300) : null,
  };
}

async function main(): Promise<void> {
  console.log(`[smoke] mode=${MODE} run=${RUN_ID} ak=${AK ? "yes" : "no"}`);
  descriptor = createDescriptor();

  const run = new SmokeRun({
    mode: MODE,
    runId: RUN_ID,
    akUsed: MODE === "live" && AK.length > 0,
    env: {
      ua: navigator.userAgent,
      href: `${location.origin}${location.pathname}`,
      ...descriptor.notes,
    },
  });

  let mounted: Mounted | null = null;
  try {
    mounted = mountTree();
    await withTimeout(mounted.ready, READY_MS, "<BMap> ready", "BMAP_READY_TIMEOUT");
    await sleep(MODE === "live" ? 400 : 50);
    const ctx: Ctx = {
      mounted,
      baseline: { overlays: descriptor.overlays(mounted.raw()) },
      containerSignature: uiSignature(mounted.container()),
    };
    for (const spec of SMOKE_CHECKS[MODE].checks) {
      const impl = CHECKS[spec.id];
      if (!impl) {
        // 登记表与实现漂移：显式登记为 blocked，绝不让「登记的检查没跑」静默通过。
        run.declare(spec.id, spec.name, "blocked", {
          reason: "登记表里的检查在页面里没有实现（表与实现漂移）",
        });
        continue;
      }
      await run.check(spec.id, spec.name, () => impl.run(ctx));
    }
  } catch (error) {
    // 初始挂载失败：**必须区分「外部前置」与「实现回归」**（第 1 轮评审 P1）。
    // 前者把所有 required 逐条登记成 blocked（结论 = 不可放行，退出码 3）；后者只登记一条 fail
    // 并让 required 保持缺席（`REQUIRED_CHECK_MISSING` ⇒ 退出码 1）。
    const treeErrors = (mounted ? mounted.treeErrors : []).map((entry) => {
      const e = entry as { code?: string; message?: string };
      return { code: typeof e?.code === "string" ? e.code : undefined, message: e?.message };
    });
    const verdict = classifyBootstrapFailure(treeErrors);
    const detail = {
      verdict,
      diagnostics: smokeDiagnostics(mounted),
      loadErrors: treeErrors.map((e) => `${e.code ?? "?"}: ${e.message ?? ""}`),
      thrown: error instanceof Error ? error.message : String(error),
    };
    if (verdict.kind === "external") {
      for (const declaration of bootstrapDeclarations(verdict, SMOKE_CHECKS[MODE].checks)) {
        run.declare(declaration.id, declaration.name, "blocked", { reason: declaration.reason, detail });
      }
    } else {
      await run.check("harness-bootstrap", "smoke 前置（挂载地图）", () => {
        fail(
          verdict.code,
          `初始挂载失败且可归属到实现/上游契约：${verdict.reason}`,
          detail,
        );
      });
    }
  } finally {
    // 尽力回收：前置失败时 `mounted` 可能已经挂上（超时分支），不释放会把宿主 DOM 留到浏览器关闭。
    try {
      await mounted?.unmount();
    } catch {
      /* 卸载失败不影响结论：orchestrator 随后会杀掉整个浏览器进程 */
    }
  }

  const report = run.finish(unhandled);
  const gate = evaluateSmokeReport(report, {
    required: [...SMOKE_CHECKS[MODE].required],
    whitelist: UNATTRIBUTED_WHITELIST,
  });
  window.__SMOKE__ = report;
  const text = `${formatReport(report, gate)}\n--- gate(summary) ok=${gate.ok} exit=${gate.exitCode}`;
  document.getElementById("report")!.textContent = redactAk(text);
  console.log(redactAk(text));
}

await main();
