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
  BPlaceSearch,
} from "../../../packages/baidu-map-gl-vue/src/integrations/ui-kit/index.ts";
import { createFakeBMapV4 } from "../../../packages/test-utils/fake-bmap-v4/index.ts";
import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
import {
  assertSmoke,
  block,
  evaluateSmokeReport,
  fail,
  formatReport,
  redactAk,
  SmokeRun,
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
   * 图层挂载的可观察证据。
   *
   * - fixture：账本计数必须增长（精确断言）；
   * - live：真实 4.0 的 `Map` **没有** `getLayers()` 读数接口，且矢量图层画在 canvas 上、
   *   容器 DOM 不变 —— 因此只核对「能力表声明支持 + 这一步没有新的 `console.error`」，
   *   并把读数口径如实写进 detail。**这不是放宽门禁**：同一份能力在 fixture 档用账本做精确
   *   核对，两档差异收在这里，而不是把 live 的弱读数写成「通过」的替代品。
   */
  assertLayerAttached(input: LayerEvidenceInput): unknown;
  notes: Record<string, unknown>;
}

interface UnmountSnapshot {
  raw: Record<string, unknown> | null;
  container: HTMLElement;
  handle: unknown;
  client: unknown;
}

interface LayerEvidenceInput {
  countBefore: number;
  countAfter: number;
  signatureBefore: string;
  signatureAfter: string;
  /** 这一步新增的 `console.error` 条目。 */
  consoleErrors: string[];
  /** 能力表是否声明支持该图层（读不到能力表时为 `null`）。 */
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
      assertLayerAttached: (input) => {
        assertSmoke(
          input.countAfter > input.countBefore,
          "BMAP_LAYER_NOT_ATTACHED",
          `<BDistrictLayer> 后图层计数没有增长：${input.countBefore} → ${input.countAfter}`,
        );
        return { layers: input.countAfter, readApi: "fake-ledger" };
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
    assertLayerAttached: (input) => {
      assertSmoke(
        input.capabilitySupported === true,
        "BMAP_LAYER_CAPABILITY",
        `能力表没有声明支持 district 图层（读到的值：${String(input.capabilitySupported)}）`,
      );
      assertSmoke(
        input.consoleErrors.length === 0,
        "BMAP_LAYER_CONSOLE_ERROR",
        `<BDistrictLayer> 挂载期间出现 ${input.consoleErrors.length} 条 console.error`,
        { errors: input.consoleErrors.slice(0, 3) },
      );
      return {
        readApi: "capability + console（真实 4.0 无 getLayers() 读数接口，容器 DOM 也不变）",
        capabilitySupported: input.capabilitySupported,
        domChanged: input.signatureAfter !== input.signatureBefore,
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
  });
  const treeErrors: unknown[] = [];
  const mapRef = ref<unknown>(null);
  const infoRef = ref<unknown>(null);
  const autoRef = ref<unknown>(null);
  const searchRef = ref<unknown>(null);
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
    if (flags.placesearch) nodes.push(h(BPlaceSearch as never, { ref: searchRef }));
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
      const signatureBefore = uiSignature(ctx.mounted.container());
      const controlsBefore = descriptor.controls(ctx.mounted.raw());
      ctx.mounted.flags.zoom = true;
      await nextTick();
      await sleep(400);
      const controlsAfter = descriptor.controls(ctx.mounted.raw());
      if (controlsBefore >= 0) {
        assertSmoke(
          controlsAfter > controlsBefore,
          "BMAP_CONTROL_NOT_ATTACHED",
          `<BZoom> 后控件计数没有增长：${controlsBefore} → ${controlsAfter}`,
        );
        return { controls: controlsAfter, readApi: "ledger" };
      }
      const signatureAfter = uiSignature(ctx.mounted.container());
      assertSmoke(
        signatureAfter !== signatureBefore,
        "BMAP_CONTROL_NO_DOM",
        "<BZoom> 后地图容器的 DOM 没有任何变化，控件可能没有真正挂上",
        { before: signatureBefore.slice(0, 300), after: signatureAfter.slice(0, 300) },
      );
      return { domDelta: signatureAfter.length - signatureBefore.length, readApi: "container-dom" };
    },
  },

  "layer-district": {
    async run(ctx) {
      const mark = consoleRing.length;
      const signatureBefore = uiSignature(ctx.mounted.container());
      const countBefore = descriptor.layers(ctx.mounted.raw());
      ctx.mounted.flags.district = true;
      await nextTick();
      await sleep(600);
      return descriptor.assertLayerAttached({
        countBefore,
        countAfter: descriptor.layers(ctx.mounted.raw()),
        signatureBefore,
        signatureAfter: uiSignature(ctx.mounted.container()),
        consoleErrors: consoleErrorsSince(mark),
        capabilitySupported: capabilitySupported(ctx.mounted.client(), "layer.district"),
      });
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
      const point = await withTimeout(
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
      await withTimeout(api.search(KEYWORD), UI_MS, "autocomplete.search", "UIKIT_AUTO_SEARCH_TIMEOUT");
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
      await withTimeout(api.search(KEYWORD), UI_MS, "placesearch.search", "UIKIT_SEARCH_TIMEOUT");
      const hostEl = (ctx.mounted.searchRef.value as { $el?: HTMLElement }).$el;
      assertSmoke(hostEl, "UIKIT_SEARCH_NO_HOST", "拿不到 BPlaceSearch 的宿主元素");
      // 宿主里的 DOM 全部由官方 UI Kit 渲染：检索结算后必须有子节点（本库不渲染列表）。
      assertSmoke(
        hostEl!.childElementCount > 0,
        "UIKIT_SEARCH_NO_DOM",
        "检索结算后 BPlaceSearch 的宿主里没有任何 DOM，官方 UI Kit 可能没渲染结果列表",
        { html: (hostEl!.innerHTML ?? "").slice(0, 200) },
      );
      return { html: (hostEl!.innerHTML ?? "").slice(0, 120), children: hostEl!.childElementCount };
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
    // 挂载/前置阶段整体失败：登记成 blocked，让门禁给出「不可放行」而不是空报告。
    run.declare("harness-bootstrap", "smoke 前置（挂载地图）", "blocked", {
      reason: error instanceof Error ? error.message : String(error),
      detail: {
        diagnostics: smokeDiagnostics(mounted),
        loadErrors: mounted ? mounted.treeErrors.map((e) => String(e)) : [],
      },
    });
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
