/**
 * 插件脚本加载通道探针的页面（issue #121）
 *
 * ## 它要回答的三个问题（issue 实施步骤 1 / 2）
 *
 * 1. **挂起**：把插件 URL 指到一个「建立连接但永不响应」的地址后，`whenPlugin` 是不是真的永久挂起，
 *    挂起期间 `PluginRegistry.inspect()` 的 `status` / `consumers` 各是什么，地图本身是否照常 ready；
 * 2. **取消**：`AbortSignal` 分支在真实浏览器里真的会 `script.remove()` 吗；共享宿主里的**其它**消费者
 *    会怎样（AGENTS.md 的口径是「组件取消等待 = 解绑消费者 + 丢弃回包，不等于终止上游加载」）；
 * 3. 顺带量到「同一个 `plugins` 列表里，前一个插件挂起时后面的插件会怎样」（`loadPluginsInBackground`
 *    是顺序 `await`，所以这条要实测而不是推断）。
 *
 * ## 为什么页面只产出**读数**，不产出结论
 *
 * 判定是**纯函数**（`scripts/plugin-load-channel-report.mts`），可以用合成报告回归；
 * 放在浏览器里就只能靠「某一天真的跑真实浏览器」时人肉复查（#97/#104 的教训）。
 * 因此这里只记录事实：事件与时刻、`inspect()` 快照、文档里残留的 `<script>` 数、接收到的错误文本。
 *
 * ## 「永不响应的地址」是怎么造的
 *
 * Vite 的 `vite.config.ts` 里挂了一个中间件：`/__hang/...` **接受连接后永远不写响应**（也不关闭）。
 * 这样「pending」是**确定性**的，不靠外网、不靠 CDN 的某种抖动；而注入 `<script>` 的其余环节全部是
 * 本库的真实代码路径（`urlPluginDefinition` → `loadScriptWithExport` → `PluginHost` / `PluginRegistry`）。
 * 唯一被改动的输入是**插件 URL 表里的一项**（`env.urlPatched` 如实记录这一点）。
 *
 * ## 两条防自欺的守卫
 *
 * - **`control` 场景**：同一页面、同一路径，用**真实**内置 URL 加载同一个插件。它必须成功——
 *   否则「挂起场景里的失败」可能只是这条通道本来就不工作（那样的读数什么都证明不了）；
 * - **正证读数**：挂起场景在取消之前记录 `hangScriptsDuringLoad`，它必须 ≥ 1 ——
 *   「script 已被移除」只有在「script 真的被插入过」时才成立。
 */
import { createApp, defineComponent, h, type App } from "vue";
import { BMap, useBMapContext } from "../../../packages/baidu-map-gl-vue/src/index.ts";
import * as builtins from "../../../packages/baidu-map-gl-vue/src/plugins/builtins.ts";
import { createPluginHost } from "../../../packages/baidu-map-gl-vue/src/core/plugins/PluginHost.ts";

/** 同源、永不响应的地址（中间件见 vite.config.ts）。 */
const HANG_URL = "/__hang/plugin-load-channel";

const params = new URLSearchParams(location.search);
const SCENARIO = params.get("scenario") ?? "";
const AK = params.get("ak") ?? "";
const WAIT_MS = Number(params.get("wait") ?? "20000");

/** 真实内置 URL（在打补丁**之前**读一次，作为「同一段代码在真实 URL 上会怎样」的对照）。 */
const REAL_TRACK_ANIMATION_URL = (builtins.BUILTIN_PLUGIN_URLS as Record<string, string>)
  .trackAnimation;

/**
 * 插件的脚本超时常量。
 *
 * 用**命名空间**取而不是 `import { BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS }`：本探针要能在「还没有这个常量」的树上
 * 跑（那正是修复前的取证），而命名空间读缺失成员得到 `undefined`，具名导入会直接让整个模块加载失败。
 */
const BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS =
  (builtins as Record<string, unknown>).BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS ?? null;

const out: Record<string, any> = ((window as any).__PLUGIN_LOAD_CHANNEL__ = {
  scenario: SCENARIO,
  env: {
    akPresent: AK.length > 0,
    hangUrl: HANG_URL,
    waitMs: WAIT_MS,
    /** 本库当前的插件脚本超时常量；`null` = 还没有这个常量（修复前）。 */
    builtinPluginTimeoutMs: typeof BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS === "number" ? BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS : null,
    realTrackAnimationUrl: REAL_TRACK_ANIMATION_URL,
    /** 是否把内置 URL 表里的一项指到了永不响应的地址。 */
    urlPatched: false,
    userAgent: navigator.userAgent,
  },
  readings: {},
  done: false,
  fatal: null,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < ms) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

/** 文档里 src 属性以 `needle` 开头的 `<script>` 数（用 attribute，避开浏览器补全的绝对 URL）。 */
function countScripts(needle: string): number {
  let count = 0;
  for (const script of Array.from(document.querySelectorAll("script"))) {
    if ((script.getAttribute("src") ?? "").indexOf(needle) >= 0) count += 1;
  }
  return count;
}

/**
 * 记录「夹具就绪」类读数。
 *
 * **必须在 `unmount()` 之前调用**：地图卸载后 canvas 与 `status` 就都没了，在 `main()` 末尾统一读
 * 会读到「卸载之后的世界」（本探针第一版就是这么错的，结果是每个场景都报 `canvasCount=0`）。
 * 判定层把这两个读数当**前置条件**：不成立时整轮判 blocked，而不是把失败归给库。
 */
function recordSdkEnv(): void {
  out.env.sdkLoaded = typeof (window as any).BMap?.Map === "function";
  out.env.canvasCount = document.querySelectorAll("canvas").length;
}

function textOf(error: unknown): string {  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; cause?: unknown };
    const base = typeof candidate.message === "string" ? candidate.message : String(error);
    // 组件层会把原始错误包一层，原始错误在 `cause` 上（`BMapError` 的约定）。
    const cause = candidate.cause as { message?: unknown } | undefined;
    if (cause && typeof cause.message === "string") return base + " | cause: " + cause.message;
    return base;
  }
  return String(error);
}

interface MountedMap {
  app: App;
  events: Array<{ name: string | null; type: string; atMs: number; errorText: string | null }>;
  /** 地图就绪后从 `<BMap>` 内部 context 拿到的注册表（`inspect` 读数用）。 */
  plugins: () => any;
  status: () => unknown;
  unmount: () => void;
}

let capturedContext: any = null;

/** 子组件：借公开的 `useBMapContext()` 拿到地图自己的 `PluginRegistry`（`BMapExpose` 不含它）。 */
const ProbeTap = defineComponent({
  name: "ProbeTap",
  setup() {
    capturedContext = useBMapContext();
    return () => null;
  },
});

function mountBMap(plugins: string[]): MountedMap {
  capturedContext = null;
  const events: MountedMap["events"] = [];
  const t0 = performance.now();
  const mark = (name: string | null, type: string, errorText: string | null): void => {
    events.push({ name, type, atMs: Math.round(performance.now() - t0), errorText });
  };

  const root = defineComponent({
    name: "ProbeRoot",
    render: () =>
      h(
        BMap as never,
        {
          ak: AK,
          center: { lng: 116.404, lat: 39.915 },
          zoom: 13,
          height: "300px",
          plugins,
          onReady: () => mark(null, "ready", null),
          // kebab 事件名在 `h()` 里写 camelCase（Vue 的 `emit` 会 camelize 回退匹配）
          onPluginReady: (name: string) => mark(name, "plugin-ready", null),
          onPluginError: (payload: { name: string; error: unknown }) =>
            mark(payload.name, "plugin-error", textOf(payload.error)),
        } as never,
        { default: () => h(ProbeTap as never) },
      ),
  });

  const app = createApp(root);
  app.mount(document.getElementById("stage")!);
  return {
    app,
    events,
    plugins: () => capturedContext?.plugins ?? null,
    status: () => capturedContext?.status?.value ?? null,
    unmount: () => app.unmount(),
  };
}

function inspectOf(registry: any, names: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const inspection = registry?.inspect?.(name);
    result[name] = inspection
      ? {
          scope: inspection.scope,
          required: inspection.required,
          status: inspection.status,
          attempts: inspection.attempts,
          consumers: inspection.consumers,
          errorText: inspection.error === undefined ? null : textOf(inspection.error),
        }
      : null;
  }
  return result;
}

const trackAnimationPlugin = (builtins as Record<string, any>).trackAnimationPlugin as () => any;
const urlPluginDefinition = (builtins as Record<string, any>).urlPluginDefinition as (
  name: string,
  url: string,
  getter: () => unknown,
  options?: Record<string, unknown>,
) => any;

/* --------------------------------------------------------------- 场景：control */

/**
 * 正证：同一页面、同一路径、**真实**内置 URL，必须真的 ready。
 *
 * 没有它，「挂起场景里插件以失败结算」可能是「这条通道本来就加载不了任何东西」。
 */
async function runControl(): Promise<void> {
  const mounted = mountBMap(["TrackAnimation"]);
  await waitFor(
    () => mounted.events.some((event) => event.type !== "ready"),
    WAIT_MS,
  );
  out.readings.control = {
    events: mounted.events,
    mapReady: mounted.events.some((event) => event.type === "ready"),
    status: mounted.status(),
    inspected: inspectOf(mounted.plugins(), ["TrackAnimation"]),
    scriptCount: countScripts(REAL_TRACK_ANIMATION_URL),
    globalExposed: Boolean((window as any).BMapGLLib?.TrackAnimation),
  };
  recordSdkEnv();
  mounted.unmount();
}

/* ------------------------------------------------------------------ 场景：hang */

/**
 * 把内置 `TrackAnimation` 的 URL 指到永不响应的地址。
 *
 * 这是本探针**唯一**被替换的输入（`env.urlPatched` 如实记录）：`plugins: [...]` 只接受名字，
 * 名字经 Catalog 解析成工厂产出的 definition，因此「让内置插件走另一个 URL」只能改这张 URL 表。
 * 其余环节（注入 `<script>`、读全局导出、注册表 / 宿主记账、取消语义）都是候选提交的真实代码路径。
 */
function patchPluginUrl(): void {
  (builtins.BUILTIN_PLUGIN_URLS as Record<string, string>).trackAnimation = HANG_URL;
  out.env.urlPatched = true;
}

/**
 * 挂起：把内置 `TrackAnimation` 的 URL 指到永不响应的地址，观察
 * ① 地图是否照常 ready；② 挂起的插件何时（以及以什么形态）结算；③ 列表里**下一个**插件会怎样。
 */
async function runHang(): Promise<void> {
  patchPluginUrl();

  const names = ["TrackAnimation", "GeoUtils"];
  const mounted = mountBMap(names);
  await waitFor(() => mounted.events.some((event) => event.type === "ready"), 15000);

  // 正证读数：挂起是真的发生了（script 已插入且一直没结算），而不是「根本没插进去」。
  await waitFor(() => countScripts(HANG_URL) > 0, 2000);
  const mapReadyAtMs =
    mounted.events.find((event) => event.type === "ready")?.atMs ?? null;
  const scriptsWhileHanging = countScripts(HANG_URL);
  // 挂起**期间**的注册表快照（结算之前）：issue 要的正是「挂了之后 status / consumers 是什么」。
  // 与末尾的 `inspected`（结算之后）成对 —— 两者合起来才说明「挂起 -> 结算」这条转移。
  const inspectedWhileHanging = inspectOf(mounted.plugins(), names);

  // 等「第一次非 ready 事件」或等满窗口：窗口由 orchestrator 按超时常量给（无常量时给固定 20s）。
  const settled = await waitFor(
    () => mounted.events.some((event) => event.type !== "ready"),
    WAIT_MS,
  );
  const hangEvent =
    mounted.events.find(
      (event) => event.type !== "ready" && (event.name === "TrackAnimation" || event.type === "plugin-error"),
    ) ?? null;

  out.readings.hang = {
    events: mounted.events,
    mapReady: mapReadyAtMs !== null,
    mapReadyAtMs,
    /** 挂起的插件是否在窗口内结算（`false` = 永久挂起）。 */
    settledWithinWindow: settled,
    hangSettledAtMs: hangEvent ? hangEvent.atMs : null,
    hangSettleType: hangEvent ? hangEvent.type : null,
    hangErrorText: hangEvent ? hangEvent.errorText : null,
    /** 挂起期间（结算之前）的注册表快照。 */
    inspectedWhileHanging,
    /** 结算之后的注册表快照。 */
    inspected: inspectOf(mounted.plugins(), names),
    scriptsWhileHanging,
    /** 结算之后那个挂着的 `<script>` 还在不在（超时应把它摘掉）。 */
    hangScriptsAtEnd: countScripts(HANG_URL),
    /**
     * 列表里第二个插件**是否被真的请求过**（`attempts >= 1`）—— 「挂起是否永久阻塞了后续插件」的
     * **确定性**读数：它只取决于顺序 `await` 有没有被放开，不取决于那 5.8 KB 脚本下载多快。
     */
    secondPluginAttempts:
      (mounted.plugins()?.inspect?.("GeoUtils")?.attempts as number | undefined) ?? null,
    /** 第二个插件最终是否就绪 —— **读数而非门禁**（它包含 CDN 的耗时，窗口内未必到得了）。 */
    secondPluginReady: mounted.events.some(
      (event) => event.type === "plugin-ready" && event.name === "GeoUtils",
    ),
    /** 地图状态：插件不阻塞 ready 是既有口径，这里如实读数。 */
    status: mounted.status(),
  };
  recordSdkEnv();
  mounted.unmount();
}

/* ---------------------------------------------------------------- 场景：cancel */

/**
 * 取消语义：三条都是**既有的** AGENTS.md 口径，本场景是它们的回归守卫。
 *
 * | 入口 | 期望 |
 * | --- | --- |
 * | `map` 作用域插件的 signal abort | 消费者 reject，且**真的** `script.remove()` |
 * | `global` 插件的一个消费者 abort（共享宿主） | 只解绑自己；共享任务保留、`<script>` 仍在、其它消费者不受影响 |
 * | 宿主 `dispose()`（纪元重置） | 在飞加载 abort ⇒ `<script>` 移除、等待者结算 |
 */
async function runCancel(): Promise<void> {
  // 共享宿主那一段同样要用「永不响应」的 URL，否则脚本会真的加载完、根本没有在飞加载可观察。
  patchPluginUrl();
  const readings: Record<string, unknown> = {};

  /* (a) map 作用域：abort 是否真的摘掉 script */
  const mapScoped = urlPluginDefinition(
    "MapScopedHang",
    HANG_URL,
    () => (window as any).BMapGLLib?.TrackAnimation,
    { scope: "map" },
  );
  const mapAbort = new AbortController();
  let mapScopeRejected: string | null = null;
  const mapScopedPromise = mapScoped
    .load({ api: {}, map: null, client: null }, mapAbort.signal)
    .then(() => {
      mapScopeRejected = "__resolved__";
    })
    .catch((error: unknown) => {
      mapScopeRejected = textOf(error);
    });
  await sleep(400);
  const duringLoad = countScripts(HANG_URL);
  mapAbort.abort();
  await mapScopedPromise;
  await sleep(200);
  readings.mapScopedAbort = {
    rejectedText: mapScopeRejected,
    scriptsDuringLoad: duringLoad,
    scriptsAfterAbort: countScripts(HANG_URL),
  };

  /* (b) + (c) global 共享宿主：一个消费者取消 vs 另一个继续等 vs 宿主 dispose */
  const host = createPluginHost("probe-plugin-load-channel");
  const context = { api: {}, map: null, client: null } as never;
  const aAbort = new AbortController();
  let aText: string | null = null;
  let bText: string | null = null;
  const aPromise = host
    .acquire("TrackAnimation", trackAnimationPlugin(), context, aAbort.signal)
    .then(() => {
      aText = "__resolved__";
    })
    .catch((error: unknown) => {
      aText = textOf(error);
    });
  const bPromise = host
    .acquire("TrackAnimation", trackAnimationPlugin(), context)
    .then(() => {
      bText = "__resolved__";
    })
    .catch((error: unknown) => {
      bText = textOf(error);
    });
  await sleep(400);
  const entryBeforeCancel = host.inspect("TrackAnimation") ?? null;
  const scriptsBeforeCancel = countScripts(HANG_URL);
  aAbort.abort();
  await aPromise;
  await sleep(200);
  const bSettledBeforeDispose = bText !== null;
  readings.sharedHost = {
    entryBeforeCancel,
    scriptsBeforeCancel,
    aRejectedText: aText,
    entryAfterACancel: host.inspect("TrackAnimation") ?? null,
    scriptsAfterACancel: countScripts(HANG_URL),
    bSettledBeforeDispose,
    bTextBeforeDispose: bText,
  };

  host.dispose();
  await bPromise;
  await sleep(200);
  readings.sharedHost = Object.assign(readings.sharedHost as object, {
    bRejectedTextAfterDispose: bText,
    entryAfterDispose: host.inspect("TrackAnimation") ?? null,
    scriptsAfterDispose: countScripts(HANG_URL),
  });

  out.readings.cancel = readings;
  // 本场景刻意不建图（验的是插件通道自身的取消语义），canvasCount 为 0 属预期，
  // 判定层也不会拿它当 `cancel` 的前置。
  recordSdkEnv();
}

/* ------------------------------------------------------------------- 主流程 */

/**
 * 把报告同时写到页面上（给人看）。
 *
 * CDP 读的是 `window.__PLUGIN_LOAD_CHANNEL__`；这里只是让「手工打开页面」也能看到同一份读数。
 * 刻意**不用**定时器轮询：本探针要观察的就是「计时器 / 在飞请求」这类资源，页面自己再挂一个
 * 永不释放的 interval 会让读数与自述都变脏。
 */
function renderReport(): void {
  const node = document.getElementById("report");
  if (node) {
    node.textContent = JSON.stringify(
      { scenario: out.scenario, env: out.env, readings: out.readings },
      null,
      2,
    );
  }
}

async function main(): Promise<void> {
  if (SCENARIO === "control") await runControl();
  else if (SCENARIO === "hang") await runHang();
  else if (SCENARIO === "cancel") await runCancel();
  else out.fatal = "unknown scenario: " + SCENARIO;
  // 夹具读数（SDK / canvas）由各场景在 `unmount()` **之前**记录，见 `recordSdkEnv()`。
  out.done = true;
  renderReport();
}

main().catch((error: unknown) => {
  out.fatal = textOf(error);
  out.done = true;
  renderReport();
});
