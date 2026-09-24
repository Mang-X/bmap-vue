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
  DistrictLayer,
  GeoJSONLayer,
  InfoWindow,
  Map,
  MapTypeControl,
  Marker,
  NavigationControl,
  OverviewMapControl,
  Panorama,
  Polyline,
  Rectangle,
  TileLayer,
  TrafficLayer,
  ZoomControl,
  // M5-CUSTOM-MENU / #33
  CustomOverlay,
  ContextMenu,
  MenuItem,
  MenuSeparator,
  useGeocoder,
} from "../../../packages/bmap-vue/src/index.ts";
import { existingGlobalV4Provider } from "../../../packages/bmap-vue/src/core/index.ts";
import {
  PlaceAutocomplete,
  PlaceDetail,
  PlaceSearch,
  RoutePlan,
} from "../../../packages/bmap-vue/src/integrations/ui-kit/index.ts";
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
/**
 * `TileLayer` 检查用的瓦片源：百度自己的瓦片主机（与 JSAPI 内部请求同源）。
 *
 * 刻意**不**用「随便一个第三方域名」当占位：那会让 live 档刷出一堆与库无关的网络错误，
 * 把「检查失败」和「瓦片源不可达」混成一件事。本检查断言的是「组件 → Driver → 真实
 * `Map.addLayer` 的调用发生了、且没有 `console.error`」，**瓦片是否真的画出来不由本库保证**。
 */
const SMOKE_TILE_ORIGIN = "https://maponline0.bdimg.com/tile";
const POINT = { lng: 116.44, lat: 39.93 };
/** `overlay-rectangle` 的对角两点（#31）：与 CENTER / POINT 都不同，回读才有区分力。 */
const RECTANGLE_SW = { lng: 116.37, lat: 39.885 };
const RECTANGLE_NE = { lng: 116.4, lat: 39.905 };
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

/**
 * 等一条事件流**停下来**：直到 `quietMs` 内没有新事件，或到 `maxMs` 上限。
 *
 * 「读一个事件序列」的检查都需要它：只等某个状态成立（例如「地图上没有当前气泡」）之后，
 * SDK 可能还在继续派发；此时去点数会把**半截序列**当成最终形状
 * （`infowindow-close-button-pair` 第一次接上时就栽在这里）。
 */
async function settleEvents<T>(marks: T[], quietMs: number, maxMs: number): Promise<T[]> {
  const started = performance.now();
  let seen = marks.length;
  for (;;) {
    await sleep(quietMs);
    if (marks.length === seen || performance.now() - started > maxMs) return marks;
    seen = marks.length;
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
  /** 传给 `<Map>` 的 provider；`live` 档刻意**不传**，以走默认入口。 */
  provider: unknown;
  /**
   * 覆盖物**列表**读数：真实 SDK 走 `getOverlays()`，Fake 走自己的账本。
   *
   * 比计数更强：`overlay-rectangle`（M5-VECTORS / #31）要断言「矩形真的按传进去的对角两点
   * 画出来」，只能从实例上读回几何。两个档各自知道「怎么列出覆盖物」，检查体不必知道。
   */
  overlayInstances(raw: Record<string, unknown>): Array<Record<string, unknown>>;
  /** 覆盖物计数读数（= `overlayInstances().length`）。 */
  overlays(raw: Record<string, unknown>): number;
  /** 控件/图层读数：Fake 有账本；真实 4.0 的 Map 没有读数接口，返回 `-1` 表示改用 DOM 增量。 */
  controls(raw: Record<string, unknown>): number;
  layers(raw: Record<string, unknown>): number;
  /**
   * 全景查看器读数（M7-CONTROL-PANORAMA / #41）：Fake 有实例账本；live 档没有公开读数面，
   * 返回 `-1`（`panorama-viewer` 因此**只登记在 fixture 档**）。
   */
  panoramas(): number;
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
    (globalThis as unknown as { Map?: unknown }).BMap = fake.namespace;
    const ledger = (raw: Record<string, unknown>): Record<string, unknown[]> =>
      raw as unknown as Record<string, unknown[]>;
    return {
      live: false,
      provider: existingGlobalV4Provider(),
      overlayInstances: (raw) => ledger(raw).overlays,
      overlays: (raw) => ledger(raw).overlays.length,
      controls: (raw) => ledger(raw).controls.length,
      layers: (raw) => ledger(raw).layers.length,
      panoramas: () => fake!.createdPanoramas.length,
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

  const readList = (target: Record<string, unknown>, member: string): unknown[] => {
    const fn = target[member];
    if (typeof fn !== "function") {
      // 成员**不存在**与「返回形状不对」必须分开：合成一个结果会让「SDK 补了读数接口但读错
      // 形状」永远不红（门禁空转）。`getOverlays` 是 4.0.4 声明的既有成员。
      fail("SDK_NO_READ_API", `v4 Map 缺少 ${member}()，读数无法核对`);
    }
    const value = (fn as () => unknown).call(target);
    assertSmoke(Array.isArray(value), "SDK_READ_SHAPE", `map.${member}() 返回值不是数组`);
    return value as unknown[];
  };
  return {
    live: true,
    provider: undefined,
    overlayInstances: (target) => readList(target, "getOverlays") as Array<Record<string, unknown>>,
    overlays: (target) => readList(target, "getOverlays").length,
    // 4.0.4 的 `Map` **没有** `getControls()` / `getLayers()`（官方类型包里逐个成员核对过），
    // 因此控件/图层改用容器 DOM 增量核对。
    controls: () => -1,
    layers: () => -1,
    panoramas: () => -1,
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
  /** `<Map>` 默认插槽给出的运行时状态（`idle` / `loading` / `ready` / `error` …）。 */
  status(): unknown;
  handle(): unknown;
  snapshot(): UnmountSnapshot;
  ready: Promise<unknown>;
  treeErrors: unknown[];
  flags: Record<string, boolean>;
  /**
   * 气泡的受控打开状态（`v-model:open`）。
   *
   * `infowindow-visible` 检查要用它证明**关闭**这一半：只测「打开可见」的话，
   * 「关了以后还留在地图上」这类缺陷（正是 #32 的 detached host 要防的）永远测不出来。
   */
  infoOpen: { value: boolean };
  /**
   * `<InfoWindow>` 回写的 `update:open` 序列。
   *
   * `infowindow-close-button-pair` 用它证明「用户点了关闭按钮」这件事**真的到达了本库模型**
   * （而不只是 SDK 那边把气泡关了）。
   */
  infoEvents: { updates: boolean[] };
  autoRef: { value: unknown };
  searchRef: { value: unknown };
  detailRef: { value: unknown };
  routeRef: { value: unknown };
  /**
   * 新增 Stable 控件的可改 props（`controls-stable-set` 要证明 anchor 真的会动态下发）。
   * 初始值刻意两两不同，改动后统一落到 `BMAP_ANCHOR_BOTTOM_LEFT`，这样「三个都变了」是可断言的。
   */
  controlProps: { navigationAnchor: string; mapTypeAnchor: string; overviewAnchor: string };
  /** 四个 wrapper 的状态输入（`PlaceDetail` 的 `uid` 由真实检索结果喂进来，不硬编码）。 */
  uiKit: { placeUid: string };
  /** wrapper 事件落点：检查体靠它断言「事件真的到达」，而不是只看返回值。 */
  uiKitEvents: {
    searchLoad: unknown[];
    searchSelect: unknown[];
    detailLoad: unknown[];
    routeResult: unknown[];
    routeError: unknown[];
  };
  /* --------------------------------------------- M5-CUSTOM-MENU / #33 的可改状态 */
  /** `<CustomOverlay>` 的可改 props（检查要证明「换位置不重建 DOM」「隐藏不摘资源」）。 */
  customOverlay: { position: { lng: number; lat: number }; visible: boolean };
  /** `<CustomOverlay>` 的事件落点。 */
  customOverlayEvents: { clicks: number };
  /** `<ContextMenu>` 的输入与事件落点（`items` 为正典；`menuItems` 由别名用例单独构造）。 */
  menu: {
    items: Array<{ text: string; disabled?: boolean } | "-">;
    events: { open: number; close: number; selects: unknown[] };
  };
  /** marker 级菜单的 `open` 落点（live 档右键标注时用它证明「真的打开了」）。 */
  markerMenuOpen: { count: number };
  unmount(): Promise<void>;
}

function mountTree(): Mounted {
  const host = document.createElement("div");
  host.style.cssText = "width:360px;height:280px";
  document.getElementById("stage")!.appendChild(host);

  const flags = reactive<Record<string, boolean>>({
    marker: false,
    polyline: false,
    rectangle: false,
    info: false,
    zoom: false,
    district: false,
    tile: false,
    traffic: false,
    geojson: false,
    navigation: false,
    maptype: false,
    overview: false,
    panorama: false,
    autocomplete: false,
    placesearch: false,
    placedetail: false,
    routeplan: false,
    // M5-CUSTOM-MENU / #33
    customOverlay: false,
    menu: false,
    markerMenu: false,
  });
  const treeErrors: unknown[] = [];
  const mapRef = ref<unknown>(null);
  const infoOpen = ref(true);
  const autoRef = ref<unknown>(null);
  const searchRef = ref<unknown>(null);
  const detailRef = ref<unknown>(null);
  const routeRef = ref<unknown>(null);
  const controlProps = reactive({
    navigationAnchor: "BMAP_ANCHOR_TOP_LEFT",
    mapTypeAnchor: "BMAP_ANCHOR_TOP_RIGHT",
    overviewAnchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  });
  const uiKit = reactive({ placeUid: "" });
  const infoEvents: Mounted["infoEvents"] = { updates: [] };
  const customOverlay = reactive({ position: { ...POINT }, visible: true });
  const customOverlayEvents: Mounted["customOverlayEvents"] = { clicks: 0 };
  const menu = reactive<Mounted["menu"]>({
    items: [
      { text: "smoke-menu-a" },
      "-",
      { text: "smoke-menu-b", disabled: true },
    ],
    events: { open: 0, close: 0, selects: [] },
  });
  const markerMenuOpen: Mounted["markerMenuOpen"] = { count: 0 };
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
      const geocoder = useGeocoder();
      (globalThis as unknown as { __smokeGeocoder?: unknown }).__smokeGeocoder = geocoder;
      return () => h("div", { class: "smoke-geo-probe" });
    },
  });

  const children = (): VNode[] => {
    const nodes: VNode[] = [];
    if (flags.marker) nodes.push(h(Marker, { position: POINT, title: "smoke-marker" }));
    if (flags.polyline)
      nodes.push(h(Polyline, { path: [CENTER, POINT], strokeColor: "#ff0000", strokeWeight: 3 }));
    // M5-VECTORS / #31：v4 新增的矩形（对角两点定义）。几何回读要读它的实例，因此范围刻意取
    // 一个与 marker/polyline 都不同的坐标。
    if (flags.rectangle)
      nodes.push(
        h(Rectangle, {
          bounds: { southwest: RECTANGLE_SW, northeast: RECTANGLE_NE },
          strokeColor: "#1677ff",
          fillOpacity: 0.25,
        }),
      );
    if (flags.info)
      nodes.push(
        h(
          InfoWindow,
          {
            open: infoOpen.value,
            position: POINT,
            title: "smoke",
            // 受控父级的常规用法：接到回写就把自己的状态跟上（`v-model:open` 的语义）。
            // 少了这一步，「用户点了关闭按钮」之后本库会按**仍然是 true 的**意图把气泡重新打开
            // —— 那样这条检查断言的「最终地图上没有气泡」永远不成立。
            "onUpdate:open": (value: boolean) => {
              infoEvents.updates.push(value);
              infoOpen.value = value;
            },
          },
          { default: () => "smoke-infowindow-content" },
        ),
      );
    if (flags.zoom) nodes.push(h(ZoomControl, {}));
    if (flags.district) nodes.push(h(DistrictLayer, { name: "北京市" }));
    // M7-LAYERS（#40）的三条图层检查：瓦片模板指向百度自己的瓦片服务（与 SDK 内部同源），
    // 因此 live 档的瓦片请求不会因为「指向一个不存在的域名」而刷出网络错误。
    if (flags.tile)
      nodes.push(
        h(TileLayer, {
          tileUrlTemplate: `${SMOKE_TILE_ORIGIN}/?qt=tile&x={X}&y={Y}&z={Z}&styles=pl&scaler=1`,
          opacity: 0.9,
          zIndex: 3,
        }),
      );
    if (flags.traffic) nodes.push(h(TrafficLayer, {}));
    if (flags.geojson)
      nodes.push(
        h(GeoJSONLayer, {
          layerName: "smoke-geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: [CENTER, POINT] },
                properties: { name: "smoke-line" },
              },
            ],
          },
        }),
      );
    // #41 新增的三个 Stable 控件：锚点绑到 `controlProps`，用来断言「改 props 真的下发」
    if (flags.navigation) nodes.push(h(NavigationControl, { anchor: controlProps.navigationAnchor }));
    if (flags.maptype) nodes.push(h(MapTypeControl, { anchor: controlProps.mapTypeAnchor }));
    if (flags.overview) nodes.push(h(OverviewMapControl, { anchor: controlProps.overviewAnchor }));
    if (flags.panorama) {
      nodes.push(
        h(Panorama, {
          point: POINT,
          pov: { heading: 90, pitch: -10 },
          zoom: 1,
          style: "width: 200px; height: 140px",
        }),
      );
    }
    if (flags.autocomplete) nodes.push(h(PlaceAutocomplete as never, { ref: autoRef, location: CITY }));
    if (flags.placesearch) {
      nodes.push(
        h(PlaceSearch as never, {
          ref: searchRef,
          onLoad: (pois: unknown) => uiKitEvents.searchLoad.push(pois),
          onSelect: (poi: unknown) => uiKitEvents.searchSelect.push(poi),
        }),
      );
    }
    if (flags.placedetail) {
      nodes.push(
        h(PlaceDetail as never, {
          ref: detailRef,
          // `uid` 由真实检索结果喂进来（见 `ui-kit-placesearch-load`），不硬编码某个 POI。
          uid: uiKit.placeUid || undefined,
          onLoad: (detail: unknown) => uiKitEvents.detailLoad.push(detail),
        }),
      );
    }
    if (flags.routeplan) {
      nodes.push(
        h(RoutePlan as never, {
          ref: routeRef,
          onResult: (result: unknown) => uiKitEvents.routeResult.push(result),
          onError: (error: unknown) => uiKitEvents.routeError.push(error),
        }),
      );
    }
    nodes.push(h(GeoProbe));
    // M5-CUSTOM-MENU / #33：DOM 覆盖物放在**最后**——`overlayInstances()` 的末位就是它
    // （与单测里的 `currentOverlay()` 同一读法），这样检查体不必按特征识别实例。
    if (flags.customOverlay) {
      nodes.push(
        h(
          CustomOverlay,
          {
            position: customOverlay.position,
            visible: customOverlay.visible,
            offset: { x: 0, y: -12 },
            onClick: () => {
              customOverlayEvents.clicks += 1;
            },
          },
          { default: () => h("div", { class: "smoke-custom-overlay" }, "smoke-custom-overlay-content") },
        ),
      );
    }
    if (flags.menu) {
      nodes.push(
        h(ContextMenu as never, {
          items: menu.items as never,
          width: 140,
          onOpen: () => {
            menu.events.open += 1;
          },
          onClose: () => {
            menu.events.close += 1;
          },
          onSelect: (payload: unknown) => menu.events.selects.push(payload),
        }),
      );
    }
    if (flags.markerMenu) {
      // 挂在 <Marker> 里的菜单（target = marker）
      nodes.push(
        h(Marker as never, { position: CENTER }, () =>
          h(
            ContextMenu as never,
            {
              width: 160,
              onOpen: () => {
                markerMenuOpen.count += 1;
              },
            },
            () => [h(MenuItem as never, { text: "smoke-marker-menu" }), h(MenuSeparator as never)],
          ),
        ),
      );
    }
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
        Map as never,
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
    assertSmoke(el, "HARNESS_NO_CONTAINER", "拿不到 <Map> 的容器元素");
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
    controlProps,
    infoOpen,
    infoEvents,
    autoRef,
    searchRef,
    detailRef,
    routeRef,
    uiKit,
    uiKitEvents,
    customOverlay,
    customOverlayEvents,
    menu,
    markerMenuOpen,
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

/**
 * 气泡内容宿主的**直接读数**（M5-INFOWINDOW / #32）。
 *
 * `<InfoWindow>` 的组件根是 `<Teleport>`，因此 `$el` 不再指向内容节点 —— 宿主页/探针要从
 * 开放出来的 DOM 契约 `[data-bmap-infowindow-content]` 定位。这条读数直接回答两个问题：
 * 「内容在不在文档里」（可见性）与「关闭/卸载后有没有残留」（`null`）。
 */
function contentHost(): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>("[data-bmap-infowindow-content]");
  for (const node of nodes) if (node.isConnected) return node;
  return null;
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

/**
 * 读「这个覆盖物当前是不是隐藏的」。
 *
 * 真实 4.0 的 `CustomOverlay` 有 `isVisible()`（实例方法），而 Fake 把可见性落成 `visible` 字段
 * （与真实 SDK 的字段同名）——两档各读各的那一份，检查体不必知道差异。读不到时返回 `null`，
 * 由调用方如实记为失败而不是「大概没隐藏」。
 */
function readOverlayHidden(instance: Record<string, unknown>): boolean | null {
  const isVisible = instance.isVisible;
  if (typeof isVisible === "function") {
    try {
      return (isVisible as () => unknown).call(instance) === false;
    } catch {
      return null;
    }
  }
  if (typeof instance.visible === "boolean") return instance.visible === false;
  return null;
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

/**
 * 在**原始 map 实例**上直连官方 `cancelViewAnimation`，把「抛没抛 / 抛了什么」记成读数。
 *
 * `view-animation-cancel-window` 要断言的就是「这个窗口里取消一定抛错」——抛错本身是结论，
 * 所以必须先把它捕获成结构化读数，而不是让整条检查以一个未捕获异常结束。
 *
 * ⚠️ **成员缺失不是「取消抛错」**：官方把该成员改名/删掉时，若这里回一个「特殊字符串」再让调用方
 * 用「抛了点什么」判通过，这条 required gate 会**静默变绿**（而生产侧 `callOptional` 对缺成员是
 * 静默 no-op，这是该故障唯一的防线）。所以成员存在性单独断言，且返回的是带 `name` 的结构化读数，
 * 便于断言「抛的确实是 `TypeError`」——`registry.mts` 与文档承诺的就是这个类型。
 */
interface CancelAttempt {
  threw: boolean;
  name: string | null;
  message: string | null;
}

function readCancelAttempt(raw: Record<string, unknown>, animation: unknown): CancelAttempt {
  const member = raw.cancelViewAnimation;
  assertSmoke(
    typeof member === "function",
    "BMAP_VIEWANIMATION_NO_CANCEL_MEMBER",
    "原始 Map 上没有 `cancelViewAnimation`（或不是函数）：这条检查的前提已经不成立，" +
      "生产侧 `callOptional` 会把它静默吞掉，必须在这里红",
    { candidates: Object.keys(raw).filter((key) => /anim|cancel/i.test(key)) },
  );
  const cancel = member as (target: unknown) => void;
  try {
    cancel.call(raw, animation);
    return { threw: false, name: null, message: null };
  } catch (error) {
    return {
      threw: true,
      name: (error as Error)?.name ?? "Unknown",
      message: (error as Error)?.message ?? String(error),
    };
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
        typeof (globalThis as { Map?: { Map?: unknown } }).BMap?.Map === "function",
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
        (globalThis as { Map?: unknown }).BMap,
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

  /**
   * 视角动画的**启动窗口**（#104 审计表 F-1 的 live gate）。
   *
   * 为什么它必须是一条 **live** 检查：`MapDriver` 的动画簿记（`AnimationRecord` 的
   * `started` / `cancelRequested`、把取消推迟到 `animationstart` 之后的微任务、销毁时按
   * 「先取消再销毁」排序、0ms 兜底）整条正确性都建立在三条**只有真实 SDK 能证伪**的前提上：
   *
   * 1. 启动窗口真实存在 —— 动画还没进可取消窗口时调 `Map#cancelViewAnimation` 会抛 `TypeError`
   *    （在 `animationstart` 派发期间也一样，因为内部控制器那时还没构造）；
   * 2. 那个窗口**是可关闭的** —— `animationstart` 之后的微任务里取消成功，并且真的让视图停下；
   * 3. **待启动旧段的「起播前清场」只能延后交付**（#122 评审 P1）：`startViewAnimation` 提交新段时
   *    旧段的取消还交付不了，它落在旧段**自己的** `animationstart` 上；这条路径的代价（旧段会不会
   *    在被取消前推进视角）必须实测，因为「提交新段前图上一段不剩」是做不到的。
   *
   * 用原始实例直连官方命令（不经过本库），因为要核对的正是**官方行为**本身；本库自己对这些读数的
   * 反应由 Fake 上的 Facet 用例覆盖。第一次跑通这四条读数见
   * `docs/zh-CN/contributing/architecture-ownership-audit.md` 的 F-1 行（2026-09-21）。
   *
   * 顺序刻意如此：先跑**正证控件**（一段正常播放真的推动了视图），后面的「取消之后视图没动」
   * 才有区分力 —— 少了它，一个「什么都没发生」的环境也会让四条断言全绿。
   */
  "view-animation-cancel-window": {
    async run(ctx) {
      const raw = ctx.mounted.raw();
      const namespace = (globalThis as { Map?: { ViewAnimation?: unknown } }).BMap;
      const AnimationCtor = namespace?.ViewAnimation;
      assertSmoke(
        typeof AnimationCtor === "function",
        "BMAP_VIEWANIMATION_MISSING",
        "全局命名空间上没有 `ViewAnimation` 构造器：无法在真实 SDK 上核对启动窗口",
      );

      const getZoom = raw.getZoom as undefined | (() => number);
      const getCenter = raw.getCenter as undefined | (() => { lng: number; lat: number });
      const startAnimation = raw.startViewAnimation as undefined | ((animation: unknown) => void);
      const setZoom = raw.setZoom as undefined | ((zoom: number) => void);
      assertSmoke(
        typeof getZoom === "function" &&
          typeof getCenter === "function" &&
          typeof startAnimation === "function",
        "BMAP_VIEWANIMATION_MISSING_API",
        "原始 Map 缺少 getZoom / getCenter / startViewAnimation：这条检查无法进行",
        { members: Object.keys(raw).filter((key) => /anim|zoom|center/i.test(key)) },
      );
      const from = getZoom!.call(raw);
      const to = from + 3;

      /** `target` 默认末帧 `to`；传别的值可以让两段动画朝**相反**方向走，轨迹才有判别力。 */
      const make = (options: Record<string, unknown>, target = to) =>
        new (AnimationCtor as new (frames: unknown[], options: Record<string, unknown>) => {
          addEventListener: (name: string, fn: () => void) => void;
        })(
          [
            { center: getCenter!.call(raw), zoom: from, percentage: 0 },
            { center: getCenter!.call(raw), zoom: target, percentage: 1 },
          ],
          options,
        );

      const marks: string[] = [];
      const observe = (
        animation: { addEventListener: (name: string, fn: () => void) => void },
        sink: string[] = marks,
      ) => {
        for (const name of ["animationstart", "animationend", "animationcancel"]) {
          animation.addEventListener(name, () => sink.push(name));
        }
      };

      /**
       * 每个子场景都从**同一个已知视野**开始。
       *
       * 不复用上一个子场景留下的视野：动画起播时会**立即应用首帧**（实测），于是「取消之后
       * `getZoom()` 落在哪里」这件事只有在前置视野确定时才可读 —— 第一次接这条检查时正是栽在
       * 这里：取消前视野是上一段留下的 16.97，取消后落到本段的**首帧** 14，被误判成「仍在推进」。
       */
      const resetView = async () => {
        setZoom!.call(raw, from);
        await sleep(150);
      };

      /* ── 正证控件：一段正常播放必须真的推动视图 ── */
      await resetView();
      marks.length = 0;
      const normal = make({ duration: 500, delay: 0 });
      observe(normal);
      startAnimation!.call(raw, normal);
      /* ── 前提 0：启动窗口相对**调用返回**是异步的（同任务内还不该派发） ── */
      const dispatchedBeforeReturn = marks.includes("animationstart");
      assertSmoke(
        !dispatchedBeforeReturn,
        "BMAP_VIEWANIMATION_SYNC_DISPATCH",
        "`startViewAnimation()` 返回时 `animationstart` 已经派发 —— 它变成同步的了；" +
          "本库「启动前取消会抛错、要等安全窗口」的整条推理要从头复核",
      );
      await until(
        () => (marks.includes("animationend") ? true : null),
        5_000,
        "BMAP_VIEWANIMATION_NO_END",
        "正常播放的 animationend",
      );
      const zoomAfterNormal = getZoom!.call(raw);
      assertSmoke(
        zoomAfterNormal >= to - 0.5,
        "BMAP_VIEWANIMATION_NOT_DRIVING",
        `正常播放的动画没有把视图推到末帧（${zoomAfterNormal} / 期望 ${to}）——` +
          "后面「取消之后视图没动」的读数就失去区分力",
        { from, to, zoomAfterNormal },
      );

      /* ── 前提 1：启动窗口真实存在（未起播的实例上取消抛错） ── */
      const neverStarted = make({ duration: 400, delay: 0 });
      const beforeStart = readCancelAttempt(raw, neverStarted);
      assertSmoke(
        beforeStart.threw && beforeStart.name === "TypeError",
        "BMAP_VIEWANIMATION_CANCEL_BEFORE_START",
        "未起播的实例上 `cancelViewAnimation` 没有抛 `TypeError`（读数 " +
          `${JSON.stringify(beforeStart)}）：启动窗口的假设已经不成立`,
        beforeStart,
      );

      /* ── 前提 1 的另一半：派发期间同步取消同样抛错（内部控制器还没建） ── */
      await resetView();
      marks.length = 0;
      const during = make({ duration: 700, delay: 0 });
      observe(during);
      // 用数组收集而不是「赋给局部变量」：回调里的赋值不在 TS 的控制流里，断言时会被收窄成 `never`
      const duringAttempts: CancelAttempt[] = [];
      during.addEventListener("animationstart", () => {
        duringAttempts.push(readCancelAttempt(raw, during));
      });
      startAnimation!.call(raw, during);
      await until(
        () => (marks.includes("animationend") ? true : null),
        5_000,
        "BMAP_VIEWANIMATION_DURING_NO_END",
        "派发期间取消之后动画仍跑完的 animationend",
      );
      const zoomAfterDuring = getZoom!.call(raw);
      // 派发期间那次取消的读数（回调必须真的跑过，否则这里是 null → 下面的断言会红）
      const duringAttempt = duringAttempts[0] ?? null;
      assertSmoke(
        duringAttempt !== null && duringAttempt.threw && duringAttempt.name === "TypeError",
        "BMAP_VIEWANIMATION_CANCEL_DURING_DISPATCH",
        "在 `animationstart` 处理器里同步取消没有抛 `TypeError`（读数 " +
          `${JSON.stringify(duringAttempt)}）—— 内部控制器可能已经提前建好，` +
          "本库「派发期间必须走延迟取消」的前提不再成立",
        duringAttempt,
      );
      // 那次取消没生效：动画照旧跑到末帧。这是「派发期间不能取消」的**行为**证据（不是只看抛错）
      assertSmoke(
        zoomAfterDuring >= to - 0.5,
        "BMAP_VIEWANIMATION_DURING_INEFFECTIVE",
        `派发期间那次取消居然生效了（视图停在 ${zoomAfterDuring} / 末帧 ${to}）：与上一条读数矛盾`,
        { zoomAfterDuring, to },
      );

      /* ── 前提 2：安全窗口可关闭它 —— 微任务里取消成功且视图不推进 ── */
      await resetView();
      marks.length = 0;
      const safe = make({ duration: 1_200, delay: 0 });
      observe(safe);
      const zoomBeforeSafe = getZoom!.call(raw);
      const safeAttempts: CancelAttempt[] = [];
      safe.addEventListener("animationstart", () => {
        void Promise.resolve().then(() => {
          safeAttempts.push(readCancelAttempt(raw, safe));
        });
      });
      startAnimation!.call(raw, safe);
      await until(
        () => (marks.includes("animationcancel") ? true : null),
        5_000,
        "BMAP_VIEWANIMATION_NO_CANCEL_EVENT",
        "微任务取消后的 animationcancel",
      );
      await sleep(300);
      const zoomAfterSafe = getZoom!.call(raw);
      const safeAttempt = safeAttempts[0] ?? null;
      assertSmoke(
        safeAttempt !== null && !safeAttempt.threw,
        "BMAP_VIEWANIMATION_MICROTASK_CANCEL",
        `在 animationstart 之后的微任务里取消抛错了（读数 ${JSON.stringify(safeAttempt)}）——` +
          "本库的「安全窗口 = 派发之后的微任务」不再成立",
        safeAttempt,
      );
      // 判据是「停在**起始帧**、没有推进到末帧」：SDK 起播时会立即应用首帧，所以不能拿
      // 「取消前后的视野差」当判据（那是取消失效与首帧生效的混合读数）。
      assertSmoke(
        Math.abs(zoomAfterSafe - from) <= 0.5,
        "BMAP_VIEWANIMATION_CANCEL_INEFFECTIVE",
        `微任务取消之后视图仍推进了（${zoomBeforeSafe} → ${zoomAfterSafe}；起始帧 ${from} / 末帧 ${to}）：` +
          "取消没有真的生效",
        { zoomBeforeSafe, zoomAfterSafe, from, to },
      );

      /* ── 前提 3（#122 评审 P1）：待启动旧段的「清场」只能延后交付，且旧段来不及推进视角 ──
       *
       * 这是本库 `startViewAnimation` 的真实路径：旧段还没进安全窗口时取消**交付不了**
       * （`cancelViewAnimation` 必抛），只能登记请求，而新段紧接着就被提交给 SDK。
       * 真实 4.0 上的形状（实测）：旧段的取消落在**它自己的 `animationstart`**（相隔 0.0–0.3ms），
       * 新段不被排队到旧段之后，且**旧段来不及驱动视角**。
       *
       * 两段朝**相反**方向走（旧段缩小、新段放大），所以「轨迹有没有朝旧段的末帧掉」是可判别的。
       */
      await resetView();
      const oldMarks: string[] = [];
      const newMarks: string[] = [];
      const oldSegment = make({ duration: 1_500, delay: 0 }, from - 4);
      const newSegment = make({ duration: 1_500, delay: 0 });
      observe(oldSegment, oldMarks);
      observe(newSegment, newMarks);

      // 旧段仍在启动窗口内：此刻取消拿不到交付（本库只能登记请求，稍后在安全窗口交付）
      // 数组收集而不是「赋给局部变量」：回调里的赋值不在 TS 的控制流里，断言时会被收窄成 `never`
      const safePointCancels: CancelAttempt[] = [];
      oldSegment.addEventListener("animationstart", () => {
        void Promise.resolve().then(() => {
          safePointCancels.push(readCancelAttempt(raw, oldSegment));
        });
      });
      startAnimation!.call(raw, oldSegment);
      // **关键**：这一次读数必须落在 `startViewAnimation(A)` **返回之后**、`animationstart` **到达之前**
      // —— 那才是 Driver 依赖的窗口（“从未 start 过”的实例由前面的 `neverStarted` 子场景覆盖，
      // 拿它顶替的话，SDK 哪天允许“start 之后、事件之前”取消，这条 gate 也照样全绿。#122 复审 P1）
      const dispatchedBeforeThisCancel = oldMarks.includes("animationstart");
      const pendingCancel = readCancelAttempt(raw, oldSegment);
      // 局部前提断言：让「这一次读数确实在窗口内」自证，不靠 ① 那条读数的旁证
      assertSmoke(
        !dispatchedBeforeThisCancel,
        "BMAP_VIEWANIMATION_PENDING_WINDOW_MISSED",
        "读这次取消的时候 `animationstart` 已经派发 —— 测到的不是「start 已返回、事件未到」那个窗口",
        { oldMarks },
      );
      // 旧段还没起播，新段就被提交 —— 这正是被评审指出的那条路径
      startAnimation!.call(raw, newSegment);

      // 逐点采样：旧段若真的推动了视角，轨迹会朝 `from - 4` 掉下去
      let minZoomWhileOverlapping = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 12; i += 1) {
        await sleep(60);
        minZoomWhileOverlapping = Math.min(minZoomWhileOverlapping, getZoom!.call(raw));
      }
      await until(
        () => (newMarks.includes("animationend") ? true : null),
        5_000,
        "BMAP_VIEWANIMATION_PENDING_NO_END",
        "提交新段之后它自己的 animationend",
      );
      const zoomAfterNewSegment = getZoom!.call(raw);
      // 旧段那次安全窗口取消的读数（回调必须真的跑过，否则这里是 null → 下面第一条断言会红）
      const safePointCancel = safePointCancels[0] ?? null;

      assertSmoke(
        pendingCancel.threw && pendingCancel.name === "TypeError",
        "BMAP_VIEWANIMATION_PENDING_NOT_CANCELLABLE",
        "`startViewAnimation` 已返回、`animationstart` 还没到的时候取消，没有抛 `TypeError`" +
          `（读数 ${JSON.stringify(pendingCancel)}）—— 这条路径的前提已经变了：` +
          "本库「该窗口内只能登记请求（`deferred`）」的契约随之失效",
        pendingCancel,
      );
      // 旧段必须以「先 animationstart、再 animationcancel」收场。顺序用 indexOf 比较，但**先要求都存在**
      // —— 少一个时 indexOf 返回 -1，直接比大小会恒真。
      const oldStartedAt = oldMarks.indexOf("animationstart");
      const oldCancelledAt = oldMarks.indexOf("animationcancel");
      assertSmoke(
        oldStartedAt >= 0 && oldCancelledAt > oldStartedAt,
        "BMAP_VIEWANIMATION_PENDING_NOT_SETTLED",
        `旧段没有按「先 animationstart 再 animationcancel」收场（旧段事件=${oldMarks.join(" → ")}）——` +
          "登记下来的取消没有在它自己的安全窗口交付",
        { oldMarks },
      );
      // ★ 这条**不能**由 ④ 替代（#122 复审 P1）：④ 只证明「单独一段动画」能在派发后的微任务里取消；
      // 这里要证明的是组合条件 —— **B 已经先提交之后**，A 的 deferred 请求仍由本库成功交付。
      // 少了它，SDK 哪天改成「B 存在时自己把 A 结束掉并派发 animationcancel」，本库的交付失败而
      // 上面那条（只查事件到没到）照样全绿 —— 那正是这条 gate 要钉的契约。
      assertSmoke(
        safePointCancel !== null && !safePointCancel.threw,
        "BMAP_VIEWANIMATION_PENDING_SAFE_CANCEL_FAILED",
        `旧段进入自己的安全窗口后，本库这一次取消没有成功（读数 ${JSON.stringify(safePointCancel)}）——` +
          "deferred 请求没有被真正交付",
        safePointCancel,
      );
      // 核心断言：旧段**来不及**驱动视角（判据是轨迹方向，不是「有没有抛错」）
      assertSmoke(
        minZoomWhileOverlapping >= from - 0.5,
        "BMAP_VIEWANIMATION_PENDING_OVERLAP",
        `待启动旧段在被取消前推动了视角（重叠期最低 zoom=${minZoomWhileOverlapping}，` +
          `旧段末帧=${from - 4}）——「清场只能延后交付」这条路径的代价比实测的大`,
        { minZoomWhileOverlapping, from, to, oldMarks, newMarks },
      );
      // 正证控件：新段确实跑到了自己的末帧（否则上面那条「没掉下去」是空转）
      assertSmoke(
        zoomAfterNewSegment >= to - 0.5,
        "BMAP_VIEWANIMATION_PENDING_NEW_NOT_DRIVING",
        `提交的新段没有跑到自己的末帧（${zoomAfterNewSegment} / 期望 ${to}）`,
        { zoomAfterNewSegment, to },
      );

      // 收尾：把视野还原，别把这一条检查改过的视图留给后面的检查（尽力而为）
      try {
        setZoom!.call(raw, from);
      } catch {
        /* 还原是尽力而为，失败不该让整条检查变红 */
      }

      return {
        from,
        to,
        dispatchedBeforeReturn,
        zoomAfterNormal,
        beforeStart,
        duringAttempt,
        zoomAfterDuring,
        zoomBeforeSafe,
        zoomAfterSafe,
        pendingCancel: pendingCancel.name,
        dispatchedBeforeThisCancel,
        safePointCancel,
        minZoomWhileOverlapping,
        zoomAfterNewSegment,
        oldMarks,
        newMarks,
      };
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

  "overlay-rectangle": {
    async run(ctx) {
      // M5-VECTORS / #31：v4 新增的 `Rectangle` 在**真实 SDK** 上必须可用，而且必须真的
      // 按传进去的对角两点画出来——只数「覆盖物又多了几个」证明不了几何（那只能证明挂了东西）。
      // **按实例身份**找出这个矩形：先记下设置 flag 之前图上有哪些覆盖物（marker + polyline），
      // 之后新出现的那个就是它。
      //
      // 这里刻意**不**用 `typeof overlay.getBounds === "function"` 之类的特征识别——live 档
      // 第一次跑就是这样失败的（`BMAP_RECTANGLE_AMBIGUOUS`：真实 SDK 上不止一个覆盖物有
      // `getBounds`，而夹具里只有 Rectangle 建模了它）。「夹具比真实更窄」同样会掩盖缺陷，
      // 只是方向相反：夹具里通过、真实里测错对象。
      const before = new Set(descriptor.overlayInstances(ctx.mounted.raw()));
      ctx.mounted.flags.rectangle = true;
      await nextTick();
      await sleep(120);
      const overlays = await until(
        () => {
          const instances = descriptor.overlayInstances(ctx.mounted.raw());
          return instances.length > ctx.baseline.overlays + 2 ? instances : null;
        },
        3_000,
        "BMAP_RECTANGLE_NOT_ATTACHED",
        "覆盖物计数增量",
      );

      const added = overlays.filter((overlay) => !before.has(overlay));
      assertSmoke(
        added.length === 1,
        "BMAP_RECTANGLE_AMBIGUOUS",
        `本次新增的覆盖物应有 1 个（矩形），实际 ${added.length} 个`,
        { before: before.size, after: overlays.length },
      );
      const rectangle = added[0]!;
      assertSmoke(
        typeof rectangle.getBounds === "function",
        "BMAP_RECTANGLE_NO_READ_API",
        "矩形的实例上没有 getBounds()（4.0.4 的 Rectangle 声明了它），几何无法核对",
        { members: Object.keys(rectangle).slice(0, 24) },
      );
      const readCorner = (member: string): { lng?: number; lat?: number } | null => {
        const bounds = (rectangle.getBounds as () => Record<string, unknown>).call(rectangle);
        const corner = bounds?.[member];
        if (typeof corner !== "function") return null;
        const value = (corner as () => { lng?: number; lat?: number }).call(bounds);
        return typeof value?.lng === "number" && typeof value?.lat === "number" ? value : null;
      };
      const sw = readCorner("getSouthWest");
      const ne = readCorner("getNorthEast");
      assertSmoke(
        sw !== null && ne !== null,
        "BMAP_RECTANGLE_NO_GEOMETRY",
        "矩形的 getBounds() 读不回对角两点（getSouthWest / getNorthEast）",
      );
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      assertSmoke(
        near(sw!.lng, RECTANGLE_SW.lng) &&
          near(sw!.lat, RECTANGLE_SW.lat) &&
          near(ne!.lng, RECTANGLE_NE.lng) &&
          near(ne!.lat, RECTANGLE_NE.lat),
        "BMAP_RECTANGLE_BOUNDS_MISMATCH",
        `矩形几何与传入的 bounds 不一致：读到 sw=${JSON.stringify(sw)} ne=${JSON.stringify(ne)}`,
        { expected: { southwest: RECTANGLE_SW, northeast: RECTANGLE_NE }, actual: { sw, ne } },
      );
      return { overlays: overlays.length, southwest: sw, northeast: ne };
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
          label: "<ZoomControl>",
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

  "controls-stable-set": {
    async run(ctx) {
      // M7-CONTROL-PANORAMA / #41：新增的三个 Stable 控件在**真实 SDK** 上真的挂上，
      // 而且 `anchor` 改 props 之后真的下发（`getAnchor()` 从拦截到的实例上读回）。
      const recorder = recordRawCalls(ctx.mounted.raw(), "addControl");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const countBefore = descriptor.controls(ctx.mounted.raw());
        const mark = consoleRing.length;
        ctx.mounted.flags.navigation = true;
        ctx.mounted.flags.maptype = true;
        ctx.mounted.flags.overview = true;
        await nextTick();
        await sleep(400);

        assertSmoke(
          recorder.calls.length >= 3,
          "BMAP_CONTROL_STABLE_SET_PARTIAL",
          `三个 Stable 控件只发生了 ${recorder.calls.length} 次 Map.addControl（应为 3）`,
          { rawCalls: recorder.calls.length },
        );

        // 三个 anchor 一起改成一个谁都没有过的值（初始是 TOP_LEFT / TOP_RIGHT / BOTTOM_RIGHT）
        ctx.mounted.controlProps.navigationAnchor = "BMAP_ANCHOR_BOTTOM_LEFT";
        ctx.mounted.controlProps.mapTypeAnchor = "BMAP_ANCHOR_BOTTOM_LEFT";
        ctx.mounted.controlProps.overviewAnchor = "BMAP_ANCHOR_BOTTOM_LEFT";
        await nextTick();
        await sleep(200);

        const recent = recorder.calls.slice(-3).map((args) => args[0] as Record<string, unknown>);
        const anchors = recent.map((control) => {
          const read = control?.getAnchor;
          assertSmoke(
            typeof read === "function",
            "BMAP_CONTROL_NO_ANCHOR_READER",
            "拦截到的控件实例没有 getAnchor()，anchor 动态更新无法核对",
          );
          return (read as () => unknown).call(control);
        });
        // `BMAP_ANCHOR_BOTTOM_LEFT` 在官方常量表里是 2
        assertSmoke(
          anchors.every((value) => value === 2),
          "BMAP_CONTROL_ANCHOR_NOT_UPDATED",
          `改 anchor 后三个控件的 getAnchor() 应全为 2（BOTTOM_LEFT），实际 ${JSON.stringify(anchors)}`,
          { anchors },
        );

        return descriptor.assertAttached({
          kind: "control",
          code: "BMAP_CONTROL_NOT_ATTACHED",
          label: "<NavigationControl> / <MapTypeControl> / <OverviewMapControl>",
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

  "panorama-viewer": {
    async run(ctx) {
      // 只在 fixture 档登记：live 档的查看器需要真实全景场景与网络，属 nightly 的观察项
      // （`descriptor.panoramas()` 在 live 档恒为 -1，登记进来只会得到一条假失败）。
      const countBefore = descriptor.panoramas();
      const mark = consoleRing.length;
      ctx.mounted.flags.panorama = true;
      await nextTick();
      await sleep(600);
      const countAfter = descriptor.panoramas();
      assertSmoke(
        countAfter > countBefore,
        "BMAP_PANORAMA_NOT_CREATED",
        `挂载 <Panorama> 后查看器计数没有增长：${countBefore} → ${countAfter}`,
        { countBefore, countAfter },
      );
      assertSmoke(
        consoleErrorsSince(mark).length === 0,
        "BMAP_PANORAMA_CONSOLE_ERROR",
        "<Panorama> 挂载期间出现 console.error",
        { errors: consoleErrorsSince(mark).slice(0, 3) },
      );
      return { readApi: "fake-ledger (createdPanoramas)", countBefore, countAfter };
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
          label: "<DistrictLayer>",
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

  "layer-tile": {
    async run(ctx) {
      const recorder = recordRawCalls(ctx.mounted.raw(), "addLayer");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const mark = consoleRing.length;
        const countBefore = descriptor.layers(ctx.mounted.raw());
        ctx.mounted.flags.tile = true;
        await nextTick();
        await sleep(600);
        return descriptor.assertAttached({
          kind: "layer",
          code: "BMAP_LAYER_NOT_ATTACHED",
          label: "<TileLayer>",
          rawMethod: "addLayer",
          rawCalls: recorder.calls.length,
          countBefore,
          countAfter: descriptor.layers(ctx.mounted.raw()),
          domChanged: uiSignature(ctx.mounted.container()) !== signatureBefore,
          consoleErrors: consoleErrorsSince(mark),
          capabilityId: "layer.tile",
          capabilitySupported: capabilitySupported(ctx.mounted.client(), "layer.tile"),
        });
      } finally {
        recorder.restore();
      }
    },
  },

  "layer-traffic": {
    async run(ctx) {
      const recorder = recordRawCalls(ctx.mounted.raw(), "addLayer");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const mark = consoleRing.length;
        const countBefore = descriptor.layers(ctx.mounted.raw());
        ctx.mounted.flags.traffic = true;
        await nextTick();
        await sleep(600);
        return descriptor.assertAttached({
          kind: "layer",
          code: "BMAP_LAYER_NOT_ATTACHED",
          label: "<TrafficLayer>",
          rawMethod: "addLayer",
          rawCalls: recorder.calls.length,
          countBefore,
          countAfter: descriptor.layers(ctx.mounted.raw()),
          domChanged: uiSignature(ctx.mounted.container()) !== signatureBefore,
          consoleErrors: consoleErrorsSince(mark),
          capabilityId: "layer.traffic",
          capabilitySupported: capabilitySupported(ctx.mounted.client(), "layer.traffic"),
        });
      } finally {
        recorder.restore();
      }
    },
  },

  "layer-geojson": {
    async run(ctx) {
      const recorder = recordRawCalls(ctx.mounted.raw(), "addLayer");
      try {
        const signatureBefore = uiSignature(ctx.mounted.container());
        const mark = consoleRing.length;
        const countBefore = descriptor.layers(ctx.mounted.raw());
        ctx.mounted.flags.geojson = true;
        await nextTick();
        await sleep(600);
        return descriptor.assertAttached({
          kind: "layer",
          code: "BMAP_LAYER_NOT_ATTACHED",
          label: "<GeoJSONLayer>",
          rawMethod: "addLayer",
          rawCalls: recorder.calls.length,
          countBefore,
          countAfter: descriptor.layers(ctx.mounted.raw()),
          domChanged: uiSignature(ctx.mounted.container()) !== signatureBefore,
          consoleErrors: consoleErrorsSince(mark),
          capabilityId: "layer.geojson",
          capabilitySupported: capabilitySupported(ctx.mounted.client(), "layer.geojson"),
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
      const host = contentHost();
      assertSmoke(
        host,
        "BMAP_INFOWINDOW_NO_CONTENT_HOST",
        "打开后定位不到内容宿主（`[data-bmap-infowindow-content]`）——detached host 没有被 SDK 挂进文档",
      );
      const style = getComputedStyle(host!);
      assertSmoke(
        style.display !== "none" && style.visibility !== "hidden",
        "BMAP_INFOWINDOW_HIDDEN",
        `气泡内容节点仍然不可见（display=${style.display} visibility=${style.visibility}）——#72 的可见性回归`,
        { display: style.display, visibility: style.visibility },
      );
      assertSmoke(
        (host!.textContent ?? "").includes("smoke-infowindow-content"),
        "BMAP_INFOWINDOW_EMPTY",
        "气泡内容节点里没有渲染出内容",
        { text: host!.textContent },
      );
      // 宿主必须由 **SDK** 接管（内容节点由 SDK 持有、渲染子树由 Vue Teleport 拥有）：
      // 它不该还停在地图容器的顶层（那是本库创建它时的位置）
      assertSmoke(
        host!.parentElement !== ctx.mounted.container(),
        "BMAP_INFOWINDOW_HOST_NOT_MOVED",
        "内容宿主仍停在地图容器顶层：SDK 没有接管它（detached host 未生效）",
        { parentClass: host!.parentElement?.className ?? null },
      );
      const parentWhenOpen = host!.parentElement;

      // **关闭**这一半：只测「打开可见」的话，「关了以后还留在地图上」永远测不出来。
      // 这里读的是**本库的承诺**：关闭命令下发给地图级 API 之后，地图上不再有当前气泡。
      ctx.mounted.infoOpen.value = false;
      await nextTick();
      await until(
        () => {
          const raw = ctx.mounted.raw();
          const getInfoWindow = raw.getInfoWindow as undefined | (() => unknown);
          const current = typeof getInfoWindow === "function" ? getInfoWindow.call(raw) : null;
          return current ? null : true;
        },
        5_000,
        "BMAP_INFOWINDOW_NOT_CLOSED",
        "气泡关闭",
      );
      assertSmoke(
        getComputedStyle(host!).display === "none" ||
          !host!.isConnected ||
          host!.parentElement !== parentWhenOpen,
        "BMAP_INFOWINDOW_RESIDUE",
        "关闭后内容宿主仍然可见（既没有随 SDK 的容器撤下，也没有被隐藏）",
        { connected: host!.isConnected, display: getComputedStyle(host!).display },
      );
      return { text: host!.textContent, closed: true };
    },
  },

  /**
   * 点关闭按钮的事件形状与收敛（M5-INFOWINDOW / #32）：断言 `close` 恰好一条、
   * `clickclose` 至少一条、且本库模型收敛为关；具体条数与顺序作为读数带回报告。
   */
  "infowindow-close-button-pair": {
    async run(ctx) {
      ctx.mounted.flags.info = true;
      ctx.mounted.infoOpen.value = true;
      ctx.mounted.infoEvents.updates.length = 0;
      await nextTick();
      const raw = ctx.mounted.raw();
      const readCurrent = (): unknown => {
        const getInfoWindow = raw.getInfoWindow as undefined | (() => unknown);
        if (typeof getInfoWindow === "function") return getInfoWindow.call(raw) ?? null;
        return null;
      };
      const opened = await until(readCurrent, 5_000, "BMAP_INFOWINDOW_NOT_OPEN", "地图的当前气泡");

      // 在**原始实例**上记录这一对事件：顺序与数量就是被测读数
      const marks: Array<{ name: string; at: number }> = [];
      const target = opened as { addEventListener?: (name: string, fn: () => void) => void };
      assertSmoke(
        typeof target.addEventListener === "function",
        "BMAP_INFOWINDOW_NO_LISTENER",
        "`map.getInfoWindow()` 返回的实例没有 addEventListener —— 无法观测这对事件",
        { keys: Object.keys(opened as object).slice(0, 24) },
      );
      for (const name of ["close", "clickclose"]) {
        target.addEventListener!(name, () => marks.push({ name, at: performance.now() }));
      }

      // 关闭按钮是气泡右上角那个 `×`：`.BMap_bubble_buttons` 的最后一个子节点
      // （前一个是最小化/最大化的 `+`，`enableMaximize` 时才显示）。
      const button = ctx
        .mounted
        .container()
        .querySelector<HTMLElement>(".BMap_bubble_buttons > div:last-child");
      assertSmoke(
        button,
        "BMAP_INFOWINDOW_NO_CLOSE_BUTTON",
        "找不到气泡的关闭按钮（`.BMap_bubble_buttons` 的最后一个子节点）—— SDK 的 DOM 结构可能变了",
        { html: ctx.mounted.container().querySelector(".BMap_bubble_pop")?.outerHTML.slice(0, 400) },
      );
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      await until(
        () => (readCurrent() ? null : true),
        5_000,
        "BMAP_INFOWINDOW_NOT_CLOSED",
        "点关闭按钮之后地图上没有当前气泡",
      );

      // 等事件流**停下来**：`until` 只等到「地图上没有当前气泡」，那之后 SDK 可能还在派发。
      // 不稳住就点数会把「还在陆续到达」的序列当成最终形状（第一次接这条检查时正是这么错的）。
      await settleEvents(marks, 600, 4_000);

      const counts = { close: 0, clickclose: 0 };
      for (const mark of marks) counts[mark.name as "close" | "clickclose"] += 1;
      const first = marks[0]?.at ?? performance.now();
      const order = marks.map((m) => `${m.name}+${(m.at - first).toFixed(1)}ms`).join(" > ");
      // 只断言稳定项：`close` 恰好一次、`clickclose` 至少一次（后者条数随打开次数累积，只作读数）
      assertSmoke(
        counts.close === 1 && counts.clickclose >= 1,
        "BMAP_INFOWINDOW_CLOSE_PAIR_SHAPE",
        `点关闭按钮的事件形状变了：${JSON.stringify({ counts, order })}` +
          "（期望 `close` 恰好一次、`clickclose` 至少一次）",
        { order, counts },
      );
      assertSmoke(
        ctx.mounted.infoEvents.updates.includes(false),
        "BMAP_INFOWINDOW_CLOSE_NOT_ECHOED",
        "用户点了关闭按钮，但本库没有回写 `update:open false` —— 模型没跟着收敛",
        { updates: ctx.mounted.infoEvents.updates },
      );

      // 收尾：父级回声这次关闭，别给后面的检查留一个「父级要开、模型是关」的分叉状态
      ctx.mounted.infoOpen.value = false;
      await nextTick();
      return { order, counts, updates: ctx.mounted.infoEvents.updates.length };
    },
  },

  /**
   * `<CustomOverlay>`（M5-CUSTOM-MENU / #33）——两档共用。
   *
   * 断言的都是**与实现方式无关**的事实：宿主被 SDK 搬进自己的容器、slot 内容在宿主里、
   * 换位置之后仍然只有一个宿主且它还在文档里、隐藏之后宿主仍连着（`hide` 不摘资源）。
   */
  "custom-overlay-visible": {
    async run(ctx) {
      ctx.mounted.flags.customOverlay = true;
      await nextTick();
      await sleep(120);

      const container = ctx.mounted.container();
      const hosts = (): HTMLElement[] =>
        [...document.querySelectorAll<HTMLElement>("[data-bmap-custom-overlay]")];
      const host = await until(
        () => hosts()[0] ?? null,
        5_000,
        "BMAP_CUSTOM_OVERLAY_NO_HOST",
        "自定义覆盖物的宿主元素",
      );
      assertSmoke(
        (host.textContent ?? "").includes("smoke-custom-overlay-content"),
        "BMAP_CUSTOM_OVERLAY_EMPTY",
        "宿主里没有渲染出 slot 内容",
        { text: host.textContent },
      );
      // 宿主由 **SDK** 接管：它不该还停在地图容器的顶层（那是本库创建它时的位置）
      assertSmoke(
        host.parentElement !== container,
        "BMAP_CUSTOM_OVERLAY_HOST_NOT_MOVED",
        "宿主仍停在地图容器顶层：SDK 没有接管它",
        { parentClass: host.parentElement?.className ?? null },
      );
      assertSmoke(host.isConnected, "BMAP_CUSTOM_OVERLAY_HOST_DETACHED", "宿主不在文档里");

      // 换位置：**不重建 DOM**（宿主还是同一个、仍然只有一个、仍在文档里）
      ctx.mounted.customOverlay.position = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
      await nextTick();
      await sleep(120);
      const afterMove = hosts();
      assertSmoke(
        afterMove.length === 1 && afterMove[0] === host,
        "BMAP_CUSTOM_OVERLAY_HOST_REPLACED",
        `换位置后宿主被换掉了或出现了多个（数量 ${afterMove.length}）——setPoint 应当只位移`,
        { count: afterMove.length, same: afterMove[0] === host },
      );
      assertSmoke(host.isConnected, "BMAP_CUSTOM_OVERLAY_HOST_DETACHED_AFTER_MOVE", "换位置后宿主离开了文档");

      // 隐藏：实例仍挂在地图上（`hide()` 而不是摘除）
      const overlaysBefore = descriptor.overlays(ctx.mounted.raw());
      ctx.mounted.customOverlay.visible = false;
      await nextTick();
      await sleep(120);
      assertSmoke(
        descriptor.overlays(ctx.mounted.raw()) === overlaysBefore,
        "BMAP_CUSTOM_OVERLAY_HIDDEN_UNMOUNTED",
        "`visible=false` 把覆盖物摘掉了：应当用 show/hide（实例留在图上）",
        { before: overlaysBefore, after: descriptor.overlays(ctx.mounted.raw()) },
      );
      const instance = descriptor.overlayInstances(ctx.mounted.raw()).at(-1) ?? {};
      const hidden = readOverlayHidden(instance);
      assertSmoke(
        hidden === true,
        "BMAP_CUSTOM_OVERLAY_NOT_HIDDEN",
        "`visible=false` 之后读不到「已隐藏」",
        { hidden, keys: Object.keys(instance).slice(0, 24) },
      );
      assertSmoke(host.isConnected, "BMAP_CUSTOM_OVERLAY_HOST_REMOVED_ON_HIDE", "隐藏后宿主被撤掉了");

      // 还原，别给后面的检查留一个隐藏的覆盖物
      ctx.mounted.customOverlay.visible = true;
      await nextTick();
      await sleep(120);
      return { hosts: hosts().length, hiddenWas: hidden };
    },
  },

  /**
   * `<ContextMenu>` 的组件级行为（M5-CUSTOM-MENU / #33）——**只登记在 fixture 档**。
   *
   * 它读的是 Fake 的**挂载账本**（`map.contextMenus` / `Marker#contextMenu` 账本）：
   * 真实 4.0 的 `Map` 没有「已挂载菜单列表」的读回接口，因此 live 档这条读不出来
   * （live 档由 `context-menu-marker-target` 用真实 DOM 与事件来证）。
   */
  "context-menu-attached": {
    async run(ctx) {
      assertSmoke(!descriptor.live, "HARNESS_MODE", "本检查只登记在 fixture 档（它读 Fake 账本）");
      const raw = ctx.mounted.raw() as unknown as { contextMenus: unknown[] };
      ctx.mounted.flags.menu = true;
      await nextTick();
      await sleep(120);

      assertSmoke(
        raw.contextMenus.length === 1,
        "BMAP_CONTEXT_MENU_NOT_ATTACHED",
        `地图上挂着的右键菜单数应为 1，实际 ${raw.contextMenus.length}`,
        { attached: raw.contextMenus.length },
      );
      const menu = raw.contextMenus[0] as {
        items: Array<string | { text: string; disabled?: boolean }>;
      };
      const texts = menu.items.map((item) => (typeof item === "string" ? "-" : item.text));
      assertSmoke(
        JSON.stringify(texts) === JSON.stringify(["smoke-menu-a", "-", "smoke-menu-b"]),
        "BMAP_CONTEXT_MENU_ITEMS",
        `菜单项与 items 不一致：${JSON.stringify(texts)}`,
        { texts },
      );
      assertSmoke(
        (menu.items[2] as { disabled?: boolean }).disabled === true,
        "BMAP_CONTEXT_MENU_DISABLED",
        "`disabled: true` 的菜单项没有被禁用",
      );

      // target 切换：把菜单挂到 <Marker> 上再挂回来，任何时刻都只有一个、且不会同时挂两处
      const before = raw.contextMenus.length;
      ctx.mounted.flags.markerMenu = true;
      await nextTick();
      await sleep(120);
      // ⚠️ 不能 `.find(...)`：前面的检查已经在地图上留了别的标注（它们也带 `contextMenus` 字段，
      // 只是长度为 0），`find` 会挑中**第一个**。这里按「全部标注上的菜单总数」断言。
      const markerMenus = (): number =>
        descriptor
          .overlayInstances(ctx.mounted.raw())
          .filter((instance) => Array.isArray((instance as { contextMenus?: unknown[] }).contextMenus))
          .reduce((sum, instance) => sum + ((instance as { contextMenus: unknown[] }).contextMenus).length, 0);
      await until(
        () => (markerMenus() === 1 ? true : null),
        3_000,
        "BMAP_CONTEXT_MENU_MARKER_NOT_ATTACHED",
        "菜单挂到标注上",
      ).catch(() => null);
      assertSmoke(
        markerMenus() === 1,
        "BMAP_CONTEXT_MENU_MARKER_DUPLICATE",
        `标注上挂着的菜单总数应为 1，实际 ${markerMenus()}`,
        { markerMenus: markerMenus() },
      );
      assertSmoke(
        raw.contextMenus.length === before,
        "BMAP_CONTEXT_MENU_MAP_DUPLICATE",
        "marker 级菜单不该影响地图级菜单的挂载数",
      );

      // 菜单项被选中：SDK 的回调 → 组件的 `select`（数据 API 与声明式都应到达同一个出口）
      const select = (menu.items[0] as { callback?: (p: unknown, x: unknown) => void }).callback;
      assertSmoke(typeof select === "function", "BMAP_CONTEXT_MENU_NO_CALLBACK", "菜单项没有回调");
      select!({ lng: CENTER.lng, lat: CENTER.lat }, { x: 1, y: 2 });
      await nextTick();
      assertSmoke(
        ctx.mounted.menu.events.selects.length === 1,
        "BMAP_CONTEXT_MENU_SELECT",
        `组件没有收到 select 事件（收到 ${ctx.mounted.menu.events.selects.length} 条）`,
      );
      const payload = ctx.mounted.menu.events.selects[0] as { item?: { text?: string }; index?: number };
      assertSmoke(
        payload.item?.text === "smoke-menu-a" && payload.index === 0,
        "BMAP_CONTEXT_MENU_SELECT_PAYLOAD",
        "select 载荷里的菜单项/序号不对",
        { payload },
      );

      // 卸载后不留残留（由 `unmount-release` 统一核对，这里先把挂载数撤回去）
      ctx.mounted.flags.markerMenu = false;
      await nextTick();
      await sleep(120);
      assertSmoke(
        raw.contextMenus.length === 1,
        "BMAP_CONTEXT_MENU_RESTORE",
        "撤掉 marker 级菜单之后地图级菜单应当仍在",
      );
      return { mapMenus: raw.contextMenus.length, selects: ctx.mounted.menu.events.selects.length };
    },
  },

  /**
   * `<ContextMenu>` 挂在 `<Marker>` 上**真的能打开**（M5-CUSTOM-MENU / #33）——**只登记在 live 档**。
   *
   * 验的是真实 SDK 的运行时成员（`Marker#addContextMenu`，官方类型包未声明）与真实 DOM：
   * 右键标注的 DOM ⇒ 菜单派发 `open`、菜单 DOM 里能看到我们声明的项。
   * 依据与探针读数见 ADR `2026-09-19-custom-overlay-and-context-menu`。
   */
  "context-menu-marker-target": {
    async run(ctx) {
      assertSmoke(descriptor.live, "HARNESS_MODE", "本检查只登记在 live 档");
      ctx.mounted.flags.markerMenu = true;
      await nextTick();
      await sleep(120);

      const mark = ctx.mounted.markerMenuOpen.count;
      // ⚠️ 取**最后**一个标注：前面的检查已经往地图上加过标注了，`querySelector` 会拿到第一个
      // （那个标注上没有菜单，右键它当然不会 `open`）。挂载顺序 = SDK 的 DOM 追加顺序，
      // 因此本检查新加的这个标注是最后一个。
      const markerDom = await until(
        () => {
          const all = [...ctx.mounted.container().querySelectorAll<HTMLElement>(".BMap_Marker")];
          return all.length > 0 ? all[all.length - 1]! : null;
        },
        5_000,
        "BMAP_MARKER_DOM_MISSING",
        "标注的 DOM 元素",
      );
      const rect = markerDom.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (const type of ["mousedown", "mouseup", "contextmenu"]) {
        markerDom.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            button: 2,
            buttons: 2,
          }),
        );
      }
      await until(
        () => (ctx.mounted.markerMenuOpen.count > mark ? true : null),
        8_000,
        "BMAP_CONTEXT_MENU_MARKER_NOT_OPEN",
        "右键标注之后菜单的 open 事件",
      );
      const itemTexts = [...document.querySelectorAll(".BMap_cmItem")].map(
        (el) => el.textContent ?? "",
      );
      assertSmoke(
        itemTexts.some((text) => text.includes("smoke-marker-menu")),
        "BMAP_CONTEXT_MENU_MARKER_ITEM_MISSING",
        `菜单 DOM 里没有我们声明的项（找到 ${JSON.stringify(itemTexts)}）`,
        { itemTexts },
      );
      return { opens: ctx.mounted.markerMenuOpen.count - mark, itemTexts };
    },
  },

  "service-geocode": {
    async run() {
      const geocoder = (
        globalThis as { __smokeGeocoder?: { get: (a: string, c: string) => Promise<unknown> } }
      ).__smokeGeocoder;
      assertSmoke(geocoder, "HARNESS_NO_GEOCODER", "geocode 探针没有拿到 useGeocoder 实例");
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
        "PlaceAutocomplete ready",
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
      assertSmoke(hostEl, "UIKIT_AUTO_NO_HOST", "拿不到 PlaceAutocomplete 的宿主元素");
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
        "卸载 PlaceAutocomplete 之后宿主子树仍留在文档里，回收路径没有生效",
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
        "PlaceSearch ready",
      )) as unknown as { search(keyword: string): Promise<void> };
      await withBlockedTimeout(
        api.search(KEYWORD),
        UI_MS,
        "placesearch.search",
        "UIKIT_SEARCH_TIMEOUT",
      );
      const hostEl = (ctx.mounted.searchRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_SEARCH_NO_HOST", "拿不到 PlaceSearch 的宿主元素");
      // 宿主里的 DOM 全部由官方 UI Kit 渲染：检索结算后必须有子节点（本库不渲染列表）。
      assertSmoke(
        hostEl!.childElementCount > 0,
        "UIKIT_SEARCH_NO_DOM",
        "检索结算后 PlaceSearch 的宿主里没有任何 DOM，官方 UI Kit 可能没渲染结果列表",
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
        "PlaceSearch 的 load 事件载荷",
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
        "PlaceDetail ready",
      )) as unknown as { status: string };
      assertSmoke(api.status === "ready", "UIKIT_DETAIL_STATUS", `状态应为 ready，实际 ${api.status}`);
      // `load` 到达 = 详情真的取回来了（该 wrapper 刻意不合成 error 事件，见组件文件头）。
      const detail = await withBlockedTimeout(
        until(
          () => ctx.mounted.uiKitEvents.detailLoad.at(-1) ?? null,
          UI_MS,
          "UIKIT_DETAIL_NO_LOAD_EVENT",
          "PlaceDetail 的 load 事件",
        ),
        UI_MS,
        "placedetail.load",
        "UIKIT_DETAIL_TIMEOUT",
      );
      const hostEl = (ctx.mounted.detailRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_DETAIL_NO_HOST", "拿不到 PlaceDetail 的宿主元素");
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
        "卸载 PlaceDetail 之后宿主子树仍留在文档里",
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
        "RoutePlan ready",
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
      assertSmoke(hostEl, "UIKIT_ROUTE_NO_HOST", "拿不到 RoutePlan 的宿主元素");
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
        "卸载 RoutePlan 之后宿主子树仍留在文档里",
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
        await withTimeout(second.ready, READY_MS, "第二个 <Map> ready", "BMAP_SECOND_READY_TIMEOUT");
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
      const globalBefore = (globalThis as { Map?: unknown }).BMap;
      await ctx.mounted.unmount();
      await sleep(300);
      descriptor.assertNoLeaks(snapshot);
      const globalAfter = (globalThis as { Map?: unknown }).BMap;
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
      const again = await mountFresh(READY_MS, "重挂载 <Map> ready");
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

  /**
   * 容器门禁与精简命令面（M4-HANDLE-UX / #29）。
   *
   * 为什么必须在浏览器档里跑：单测里的「容器尺寸」来自替身的最小盒模型，而这条验收在真实环境里
   * 依赖**真实布局** —— `display:none` 的元素真的没有盒子、`ResizeObserver` 真的会因 `display`
   * 变化而派发。Fake 与替身都证不了这两点，而「零尺寸建图」在真实浏览器上会得到一个 0×0 的
   * WebGL 画布（Tab / Drawer 展开前正是这个状态）。
   *
   * 这条检查**自己挂一棵树**（自带宿主），因此它不依赖 `ctx.mounted`，也就不受前面
   * `unmount-release` 拆树的影响；排在最后执行。
   */
  "map-container-gate": {
    async run() {
      const mark = consoleRing.length;
      const host = document.createElement("div");
      host.style.cssText = "width:340px;height:260px;display:none";
      document.getElementById("stage")!.appendChild(host);

      const apiRef = ref<unknown>(null);
      const statusRef = ref<string>("");
      const treeErrors: unknown[] = [];
      const mapProps: Record<string, unknown> = {
        ref: apiRef,
        center: { ...CENTER },
        zoom: 12,
        onError: (error: unknown) => treeErrors.push(error),
      };
      if (descriptor.provider) {
        mapProps.provider = descriptor.provider;
        mapProps.loadOptions = { ak: "fixture-no-network" };
      } else {
        // live：只给 ak，走**默认入口**（与 `mountTree` 同一口径）
        mapProps.ak = AK;
      }

      const app = createApp(
        defineComponent({
          name: "SmokeContainerGate",
          render: () =>
            h(
              Map as never,
              mapProps,
              {
                default: (slotProps: { status?: unknown }) => {
                  statusRef.value = String(slotProps?.status ?? "");
                  return h("span", { class: "gate-probe" });
                },
              } as never,
            ),
        }),
      );
      app.config.errorHandler = (error) => treeErrors.push(error);
      app.mount(host);

      interface GateApi {
        isContainerReady(): boolean;
        getMapInstance(): unknown;
        getCenter(): { lng: number; lat: number } | null;
        getZoom(): number | null;
        setZoom(zoom: number): void;
        supports(capability: string): boolean;
        isSuspended(): boolean;
        suspendReasons(): readonly string[];
        suspend(reason?: string): void;
        resume(reason?: string): void;
        checkResize(): void;
      }
      const api = apiRef.value as GateApi | null;
      assertSmoke(api, "MAP_EXPOSE_MISSING", "挂载后拿不到 <Map> 的 expose（defineExpose 没有生效）");

      try {
        // ① 零尺寸阶段：给一个明确的观察窗口，再断言「真的没有建图」
        await sleep(MODE === "live" ? 1200 : 300);
        assertSmoke(
          api!.isContainerReady() === false,
          "MAP_GATE_OPEN_WITHOUT_SIZE",
          "容器零尺寸时门禁已放行（应当停在未放行）",
        );
        assertSmoke(
          api!.getMapInstance() === null,
          "MAP_GATE_CREATED_WITHOUT_SIZE",
          "容器零尺寸时创建了地图：真实浏览器上会得到一个 0×0 的 WebGL 画布",
          { status: statusRef.value },
        );
        assertSmoke(
          treeErrors.length === 0,
          "MAP_GATE_ERROR_BEFORE_SIZE",
          "容器零尺寸阶段出现了错误（加载流程不该被启动）",
          { errors: treeErrors.slice(0, 2) },
        );

        // ② 展开：真实布局变化 → ResizeObserver 派发 → 门禁放行 → 建图
        host.style.display = "block";
        await until(
          () => api!.isContainerReady() === true,
          READY_MS,
          "MAP_GATE_OPEN_TIMEOUT",
          "容器由零尺寸变为非零后门禁放行",
        );
        await until(
          () => api!.getMapInstance() !== null,
          READY_MS,
          "MAP_GATE_MAP_TIMEOUT",
          "门禁放行后建图",
        );

        // ③ 命令面在真实 SDK 上可用：读命令读回真实读数、写命令真的改到 SDK
        const center = api!.getCenter();
        assertSmoke(
          center !== null &&
            Math.abs(center.lng - CENTER.lng) < 1e-4 &&
            Math.abs(center.lat - CENTER.lat) < 1e-4,
          "MAP_GATE_CENTER_MISMATCH",
          "放行后的地图中心与传入的 center 不一致",
          { center },
        );
        const zoomBefore = api!.getZoom();
        api!.setZoom(15);
        await sleep(MODE === "live" ? 400 : 60);
        const zoomAfter = api!.getZoom();
        assertSmoke(
          Math.abs((zoomAfter ?? 0) - 15) < 1e-6,
          "MAP_GATE_ZOOM_WRITE",
          `setZoom(15) 之后读回 ${String(zoomAfter)}：写命令没有到达 SDK`,
          { zoomBefore, zoomAfter },
        );
        // ⑤ 能力查询：`supports()` 是 #29 公开命令面的一部分，必须走真的 Capability Registry，
        //    而且在**真实引擎**上必须可信（评审 P1 的判据）。
        //
        //    三条在两档都必须是 true：
        //    - `overlay.marker`：命名空间顶层构造器；
        //    - `map.zoom`：真实 4.0 的 `setZoom` 是**实例自有**成员、不在 `Map.prototype` 上 ——
        //      只查「命名空间 + 原型」时它在 live 档是 false（假阴性，与 fixture 档相反）。
        //      现在 Map Facet 在建图成功后登记实例成员（`observeInstanceMembers`），两档一致；
        //    - `map.bounds`：真实引擎上 `getBounds` / `setBounds` 都在原型上；Fake 侧补了 `setBounds`
        //      （它本来就在 Fake 的覆盖面规则里：能力探测会查的成员）。
        //    这条检查在 live 档**恰好就是**P1 的回归门禁：哪天探测又退回只查原型，它会立刻红。
        const capabilityReadings = {
          overlayMarker: api!.supports("overlay.marker"),
          mapZoom: api!.supports("map.zoom"),
          mapBounds: api!.supports("map.bounds"),
        };
        assertSmoke(
          capabilityReadings.overlayMarker &&
            capabilityReadings.mapZoom &&
            capabilityReadings.mapBounds,
          "MAP_GATE_SUPPORTS",
          `能力查询在真实 SDK 上应报 true（mode=${MODE}）`,
          capabilityReadings,
        );

        // ④ 暂停策略：按**原因**记账（不是「恢复一切」）。
        //    这里刻意不断言 `isSuspended() === false` —— 真实页面里宿主可能就在视口之外，
        //    此时 `offscreen` 原因本就该留着；要断言的是「user 被精确地摘掉」+「两者一致」。
        const reasonsBefore = api!.suspendReasons();
        api!.suspend("user");
        assertSmoke(
          api!.suspendReasons().includes("user"),
          "MAP_GATE_SUSPEND",
          "expose 的 suspend(\"user\") 没有反映到暂停原因上",
          { reasonsBefore, reasonsAfter: api!.suspendReasons() },
        );
        api!.resume("user");
        const reasonsAfter = api!.suspendReasons();
        assertSmoke(
          !reasonsAfter.includes("user"),
          "MAP_GATE_RESUME",
          "resume(\"user\") 之后 user 原因仍在（暂停原因没有按原因增减）",
          { reasonsAfter },
        );
        assertSmoke(
          api!.isSuspended() === reasonsAfter.length > 0,
          "MAP_GATE_SUSPEND_CONSISTENT",
          "isSuspended() 与 suspendReasons() 不一致",
          { reasonsAfter, isSuspended: api!.isSuspended() },
        );

        assertSmoke(
          consoleErrorsSince(mark).length === 0,
          "MAP_GATE_CONSOLE_ERROR",
          "容器门禁 / 命令面期间出现 console.error",
          { errors: consoleErrorsSince(mark).slice(0, 3) },
        );
        return {
          gate: "display:none → block",
          center,
          zoomBefore,
          zoomAfter,
          containerReady: api!.isContainerReady(),
          suspendReasons: reasonsAfter,
          // 把能力读数放进**通过时也可见**的 detail：它是 P1 那条修复的 live 侧证据
          // （修复前 live 档 `mapZoom` 是 false）
          capabilities: capabilityReadings,
        };
      } finally {
        app.unmount();
        await nextTick();
        host.remove();
      }
    },
  },
};

/* ------------------------------------------------------------------ 主流程 */

/**
 * 前置失败时的诊断快照。
 *
 * 没有它，「<Map> ready 超时」只能得到一个 40 秒的等待结论——分不清是入口 script 没注入、
 * AK 被拒、还是容器/组件层的问题。字段全部经 `redactAk`，不外泄凭据。
 */
function smokeDiagnostics(mounted: Mounted | null): Record<string, unknown> {
  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) =>
    redactAk(s.src),
  );
  const bmap = (globalThis as { Map?: Record<string, unknown> }).BMap;
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
    await withTimeout(mounted.ready, READY_MS, "<Map> ready", "BMAP_READY_TIMEOUT");
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
