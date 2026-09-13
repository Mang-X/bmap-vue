/**
 * 官方包发布契约探针（R25-A / issue #70）
 *
 * 目的：把「官方 `@baidumap/jsapi-loader` / `@baidumap/jsapi-ui-kit` 的发布契约」从
 * 猜测变成实测。结论写进 `docs/zh-CN/contributing/official-packages.md`，并作为
 * R25-B/C/D（#71 / #72 / #73）的契约基线。
 *
 * 契约（与 `scripts/probe-official-packages.mts` 的读法绑定）：
 * - 结果写进 `window.__PROBE__`，由 orchestrator 经 CDP 读取；
 * - 每个探针独立 try/catch，一步失败不中断整轮；
 * - 探针状态只有三种：`pass` / `fail` / `blocked`（前置未满足）；
 * - 需要真实网络的探针必须自带「已知会成功的对照组」，对照组失败则整轮标 `blocked`。
 *
 * 记账口径（踩过坑，别简化）：
 * - `document` 级监听必须**按来源分类**。真实 SDK（`api.map.baidu.com/getscript`）与百度
 *   反作弊脚本（`dlswbr.baidu.com/heicha`）都会自己往 `document` 上挂监听，而且是在
 *   widget 构造/destroy 的窗口内异步落地的。只数「净增」会把这些算成 UI Kit 的泄漏。
 * - 栈帧里会出现带 `ak=` 的 getscript URL → 落盘前必须脱敏。
 *
 * 本文件**不 import vitest / node 内置模块**：它要在浏览器里跑。
 */

export interface ProbeCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "blocked";
  detail?: unknown;
  error?: string;
}

export interface SdkSnapshot {
  bmap: boolean;
  bmapgl: boolean;
  same: boolean;
  versionLike: string;
}

export interface ProbeReport {
  ak: boolean;
  ua: string;
  /** 加载成功当时的命名空间快照（`loader.proxy-mode` 会 `reset()`，末尾再测就没有意义）。 */
  sdk: SdkSnapshot;
  /** 最后一轮 `reset()` 之后的状态，用来固定「reset 会删全局」这一条契约。 */
  sdkAfterProxyReset: SdkSnapshot;
  checks: ProbeCheck[];
  verdicts: Record<string, "pass" | "fail" | "blocked">;
}

declare global {
  interface Window {
    __PROBE__?: ProbeReport;
  }
}

/* ------------------------------------------------------------------ */
/* 脱敏                                                                */
/* ------------------------------------------------------------------ */

/** `ak` 会出现在 getscript URL / 注入的 script src 里；任何入库文案都必须先过这一层。 */
export function redactAk(text: string): string {
  return text.replace(/([?&]ak=)[^&#\s"')]+/gi, "$1<redacted>");
}

/* ------------------------------------------------------------------ */
/* 记账：document 级监听与 SDK script 节点                              */
/* ------------------------------------------------------------------ */

type ListenerOrigin = "ui-kit" | "sdk" | "other";

interface ListenerSite {
  origin: ListenerOrigin;
  frames: string;
}

interface Ledger {
  sdkScripts: number;
  added: ListenerSite[];
  removed: ListenerSite[];
}

/** 栈帧归因：只有出现在 UI Kit bundle 里的调用点才算「本库挂的」。 */
function classifyOrigin(stack: string): ListenerOrigin {
  // Vite 预打包会把包名压平成 `@baidumap_jsapi-ui-kit.js`（只替换 `/`），
  // 所以这里要同时容忍 `-` 与 `_` 两种分隔，否则归因会静默失配（见下面的正证守卫）。
  if (/jsapi[-_]ui[-_]kit/.test(stack)) return "ui-kit";
  if (/api\.map\.baidu\.com|dlswbr\.baidu\.com|heicha|map\.baidu\.com|hm\.baidu\.com/.test(stack)) {
    return "sdk";
  }
  return "other";
}

function captureSite(): ListenerSite {
  const stack = (new Error().stack ?? "")
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/^at\s+/, "").replace(/https?:\/\/localhost:\d+/g, ""))
    .join(" <- ");
  const redacted = redactAk(stack);
  return { origin: classifyOrigin(redacted), frames: redacted.slice(0, 400) };
}

/** 给 `document` 的 add/removeEventListener 装一个只读计数器（其它目标不计数）。 */
function installListenerLedger(): Ledger {
  const ledger: Ledger = { sdkScripts: 0, added: [], removed: [] };
  const target = EventTarget.prototype;
  const add = target.addEventListener;
  const remove = target.removeEventListener;
  target.addEventListener = function patchedAdd(this: EventTarget, ...args: unknown[]) {
    if (this === document) ledger.added.push(captureSite());
    return (add as (...a: unknown[]) => void).apply(this, args);
  } as typeof target.addEventListener;
  target.removeEventListener = function patchedRemove(this: EventTarget, ...args: unknown[]) {
    if (this === document) ledger.removed.push(captureSite());
    return (remove as (...a: unknown[]) => void).apply(this, args);
  } as typeof target.removeEventListener;
  return ledger;
}

function countOrigin(sites: ListenerSite[], origin: ListenerOrigin): number {
  return sites.filter((site) => site.origin === origin).length;
}

/** 页面里 `script[src*="api.map.baidu.com/api"]` 的数量（官方 Loader/UI Kit 共用这条判据）。 */
function sdkScriptCount(): number {
  return document.querySelectorAll('script[src*="api.map.baidu.com/api"]').length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* 探针骨架                                                            */
/* ------------------------------------------------------------------ */

const checks: ProbeCheck[] = [];
let akPresent = false;
let sdkReady = false;
let sdkSnapshot: SdkSnapshot = { bmap: false, bmapgl: false, same: false, versionLike: "" };

/**
 * 前置未满足但**不是**被测对象的错：记 `blocked` 而不是 `fail`。
 *
 * 这个区分是硬要求（见 `docs/zh-CN/contributing/official-packages.md`）：配额 / 网络 / AK 权限
 * 造成的失败必须与「官方契约不成立」分开，否则一次环境抖动就会把整轮结论染成红色，
 * 或者反过来用「环境问题」把真实回归写成 pass。orchestrator 靠它决定退出码 3 还是 1。
 */
class BlockedError extends Error {}

function blocked(reason: string): never {
  throw new BlockedError(reason);
}

/** 读一次当前全局命名空间形状。 */
function readSdkSnapshot(): SdkSnapshot {
  const w = window as unknown as { BMap?: unknown; BMapGL?: unknown };
  return {
    bmap: typeof w.BMap === "object" && w.BMap !== null,
    bmapgl: typeof w.BMapGL === "object" && w.BMapGL !== null,
    same: w.BMap !== undefined && w.BMap === w.BMapGL,
    versionLike: String((w.BMap as { version?: unknown } | undefined)?.version ?? ""),
  };
}

/**
 * 前置未满足时不执行探针体，直接记 `blocked` —— 与 #25 的
 * 「blocked/skipped 不得放行」口径一致：blocked 是结论，不是放行。
 */
async function probe(
  id: string,
  name: string,
  requires: "ak" | "sdk" | null,
  body: () => Promise<unknown>,
): Promise<void> {
  if (requires === "ak" && !akPresent) {
    checks.push({ id, name, status: "blocked", error: "缺少 AK（?ak= 未传）" });
    return;
  }
  if (requires === "sdk" && !sdkReady) {
    checks.push({ id, name, status: "blocked", error: "SDK 未就绪（依赖前置探针）" });
    return;
  }
  try {
    checks.push({ id, name, status: "pass", detail: await body() });
  } catch (error) {
    checks.push({
      id,
      name,
      status: error instanceof BlockedError ? "blocked" : "fail",
      error: redactAk(String((error as Error)?.message ?? error)).slice(0, 300),
    });
  }
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** 期待一段代码抛错/拒绝，返回脱敏后的错误文案；没抛错本身是失败。 */
async function expectThrow(body: () => unknown): Promise<string> {
  try {
    await body();
  } catch (error) {
    return redactAk(String((error as Error)?.message ?? error)).slice(0, 200);
  }
  throw new Error("预期抛错/拒绝，但成功了");
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const ak = params.get("ak") ?? "";
  akPresent = ak.length > 0;

  const ledger = installListenerLedger();
  const scriptCountAtStart = sdkScriptCount();

  /* --- 1. 打包形态：两个入口能不能在浏览器里 eval ------------------ */

  await probe("loader.esm-import", "jsapi-loader ESM 入口可在浏览器 eval，导出形状完整", null, async () => {
    const mod = (await import("@baidumap/jsapi-loader")) as Record<string, unknown>;
    const keys = Object.keys(mod).sort();
    expect(typeof mod.load === "function", "缺少具名导出 load");
    expect(typeof mod.reset === "function", "缺少具名导出 reset");
    expect(typeof mod.getStatus === "function", "缺少具名导出 getStatus");
    const def = mod.default as Record<string, unknown> | undefined;
    expect(def && typeof def.load === "function", "default 导出缺少 load");
    return { keys };
  });

  const loader = (await import("@baidumap/jsapi-loader")) as {
    load: (options?: Record<string, unknown>) => Promise<unknown>;
    reset: () => void;
    getStatus: () => string;
  };

  await probe("loader.status-initial", "加载前状态机为 notload 且全局命名空间不存在", null, async () => {
    expect(loader.getStatus() === "notload", `初始状态为 ${loader.getStatus()}`);
    expect(
      (window as unknown as { BMap?: unknown }).BMap === undefined,
      "加载前 window.BMap 已存在（复用路径会掩盖真实加载）",
    );
    return { status: loader.getStatus(), scriptCount: sdkScriptCount() };
  });

  await probe("uikit.esm-import", "jsapi-ui-kit ESM 入口可在浏览器 eval，四个 widget 都在", null, async () => {
    const mod = (await import("@baidumap/jsapi-ui-kit")) as Record<string, unknown>;
    for (const name of ["PlaceSearch", "PlaceDetail", "PlaceAutocomplete", "RoutePlan"]) {
      expect(typeof mod[name] === "function", `缺少导出 ${name}`);
    }
    expect(typeof mod.applyTheme === "function", "缺少导出 applyTheme");
    expect(typeof mod.registerTheme === "function", "缺少导出 registerTheme");
    return { keys: Object.keys(mod).sort() };
  });

  await probe("uikit.css-separate", "JS 入口不注入样式：CSS 必须由消费方单独引入", null, async () => {
    const styleNodes = document.querySelectorAll("style,link[rel=stylesheet]");
    const own = Array.from(styleNodes).filter((el) =>
      /bmap-ui|jsapi-ui-kit/.test(el.textContent ?? ""),
    );
    expect(own.length === 0, `JS 入口注入了 ${own.length} 个 UI Kit 样式节点`);
    return { totalStyleNodes: styleNodes.length, uiKitStyleNodes: own.length };
  });

  await probe("uikit.css-import", "CSS 子路径可被 bundler 解析（包内无 exports 限制）", null, async () => {
    await import("@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css");
    await sleep(80);
    const styleNodes = document.querySelectorAll("style,link[rel=stylesheet]");
    const own = Array.from(styleNodes).filter((el) =>
      /bmap-ui|jsapi-ui-kit/.test(el.textContent ?? ""),
    );
    expect(own.length > 0, "引入 CSS 后仍找不到 UI Kit 样式节点");
    return { totalStyleNodes: styleNodes.length, uiKitStyleNodes: own.length };
  });

  /* --- 2. 官方 Loader：前置校验（不发网络） ------------------------ */

  await probe("loader.validate-ak", "缺 ak 且无 serviceHost 时明确拒绝", null, async () => {
    return { message: await expectThrow(() => loader.load({ version: "4.0" })) };
  });

  await probe("loader.validate-version", "不支持的 version 明确拒绝并列出可选值", null, async () => {
    return { message: await expectThrow(() => loader.load({ ak: "x", version: "1.0" })) };
  });

  /* --- 3. 官方 Loader：真实加载（AK） ----------------------------- */

  await probe("loader.load-4.0", "真实加载 v=4.0 并 resolve 出命名空间", "ak", async () => {
    const ns = (await loader.load({ ak, version: "4.0" })) as Record<string, unknown>;
    sdkSnapshot = readSdkSnapshot();
    sdkReady = sdkSnapshot.bmap;
    return {
      status: loader.getStatus(),
      resolvedIsWindowBMap: ns === (window as unknown as { BMap?: unknown }).BMap,
      ...sdkSnapshot,
      hasVersionKey: "VERSION" in ((window as { BMap?: object }).BMap ?? {}),
    };
  });

  await probe("loader.script-ledger", "注入的 script 带 ak 与 callback，且只注入一次、加载后仍在 DOM 里", "ak", async () => {
    const tags = Array.from(document.querySelectorAll('script[src*="api.map.baidu.com/api"]'));
    const src = tags[0]?.getAttribute("src") ?? "";
    expect(tags.length === 1, `期望 1 个 SDK script，实际 ${tags.length}`);
    return {
      count: tags.length,
      hasAk: /[?&]ak=/.test(src),
      hasCallback: /[?&]callback=/.test(src),
      stillInDom: tags[0]?.isConnected ?? null,
      srcShape: redactAk(src),
    };
  });

  await probe("loader.singleton", "同配置二次调用复用同一 Promise，不新增 script", "ak", async () => {
    const before = sdkScriptCount();
    const p1 = loader.load({ ak, version: "4.0" });
    const p2 = loader.load({ ak, version: "4.0" });
    await Promise.all([p1, p2]);
    expect(p1 === p2, "两次 load 返回了不同的 Promise");
    expect(sdkScriptCount() === before, "复用路径又插入了 script");
    return { samePromise: true, scriptDelta: sdkScriptCount() - before };
  });

  await probe("loader.conflict-version", "异 version 调用被拒绝并给出可读原因", "ak", async () => {
    return { message: await expectThrow(() => loader.load({ ak, version: "gl" })) };
  });

  await probe("loader.conflict-ak", "异 ak 调用被拒绝并给出可读原因", "ak", async () => {
    return { message: await expectThrow(() => loader.load({ ak: "another-ak", version: "4.0" })) };
  });

  /* --- 4. UI Kit：构造前提 ---------------------------------------- */

  interface WidgetModule {
    PlaceSearch: new (container: HTMLElement | string, options: Record<string, unknown>) => unknown;
    PlaceDetail: new (container: HTMLElement | string, options: Record<string, unknown>) => unknown;
    PlaceAutocomplete: new (
      container: HTMLElement | string,
      options: Record<string, unknown>,
    ) => unknown;
    RoutePlan: new (container: HTMLElement | string, options: Record<string, unknown>) => unknown;
  }

  const uikit = (await import("@baidumap/jsapi-ui-kit")) as unknown as WidgetModule &
    Record<string, unknown>;

  const widgetNames = ["PlaceSearch", "PlaceDetail", "PlaceAutocomplete", "RoutePlan"] as const;
  const hostIds = {
    PlaceSearch: "host-search",
    PlaceDetail: "host-detail",
    PlaceAutocomplete: "host-autocomplete",
    RoutePlan: "host-route",
  } as const;

  for (const name of widgetNames) {
    await probe(`uikit.${name}.map-required`, `${name} 构造时强制要求 options.map`, null, async () => {
      const Ctor = uikit[name];
      return {
        message: await expectThrow(() => new Ctor(document.getElementById(hostIds[name])!, {})),
      };
    });
  }

  /* --- 5. UI Kit：四个 widget 的构造 / 释放 ------------------------ */

  const map = sdkReady
    ? new ((window as unknown as { BMap: { Map: new (id: string) => unknown } }).BMap.Map)("map")
    : null;

  interface WidgetHandle {
    name: string;
    instance: unknown;
    host: HTMLElement;
    childrenBefore: number;
    uiKitListenersAdded: number;
  }
  const handles: WidgetHandle[] = [];

  for (const name of widgetNames) {
    await probe(`uikit.${name}.construct`, `${name} 在真实 v4 上构造并挂载 DOM`, "sdk", async () => {
      const host = document.getElementById(hostIds[name])!;
      const childrenBefore = host.children.length;
      const addedMark = ledger.added.length;
      const instance = new uikit[name](host, { map });
      const addedSites = ledger.added.slice(addedMark);
      const byUiKit = countOrigin(addedSites, "ui-kit");
      // 正证守卫：PlaceAutocomplete 在构造期**确定**会挂 1 个 document 级监听（外点关闭）。
      // 没有这条守卫，一旦归因正则与打包后的模块路径失配（例如 Vite 改了预打包目录），
      // 计数会静默变成 0/0，「监听是否归还」的门禁就成了空转。
      if (name === "PlaceAutocomplete") {
        expect(
          byUiKit >= 1,
          "监听归因失配：PlaceAutocomplete 构造期的 document 监听没有被归到 UI Kit",
        );
      }
      handles.push({
        name,
        instance,
        host,
        childrenBefore,
        uiKitListenersAdded: byUiKit,
      });
      return {
        hostChildDelta: host.children.length - childrenBefore,
        documentListenersAddedByUiKit: byUiKit,
        documentListenersAddedByNonUiKit:
          countOrigin(addedSites, "sdk") + countOrigin(addedSites, "other"),
        uiKitAddSites: addedSites.filter((s) => s.origin === "ui-kit").map((s) => s.frames),
      };
    });
  }

  await probe("uikit.RoutePlan.modes", "RoutePlan 锁定版本只开放驾车，其它类型 warn + no-op", "sdk", async () => {
    const route = handles.find((h) => h.name === "RoutePlan")?.instance as
      | { switchType: (t: string) => void; getCurrentType: () => string }
      | undefined;
    if (!route) throw new Error("RoutePlan 未构造成功");
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const before = route.getCurrentType();
      route.switchType("walking");
      route.switchType("riding");
      route.switchType("transit");
      expect(warnings.length === 3, `期望 3 条「未启用」告警，实际 ${warnings.length}`);
      expect(route.getCurrentType() === before, `类型被改成了 ${route.getCurrentType()}`);
      return { currentType: route.getCurrentType(), warnings };
    } finally {
      console.warn = originalWarn;
    }
  });

  // 逐 widget 释放：DOM 归位是 `destroy()` 的公开契约（必须成立）；
  // UI Kit 自己挂的 document 级监听必须同数归还（按来源归因，不含 SDK 与百度统计脚本）。
  for (const handle of handles) {
    await probe(`uikit.${handle.name}.destroy`, `${handle.name} destroy 后撤除自身 DOM 且归还自己的 document 监听`, "sdk", async () => {
      const removedMark = ledger.removed.length;
      (handle.instance as { destroy: () => void }).destroy();
      await sleep(150);
      const hostChildrenAfter = handle.host.children.length;
      expect(
        hostChildrenAfter === handle.childrenBefore,
        `destroy 后宿主容器子节点为 ${hostChildrenAfter}，期望 ${handle.childrenBefore}`,
      );
      const removedByUiKit = countOrigin(ledger.removed.slice(removedMark), "ui-kit");
      return {
        hostChildrenAfter,
        expectedHostChildren: handle.childrenBefore,
        uiKitListenersAddedAtConstruct: handle.uiKitListenersAdded,
        uiKitListenersRemovedByDestroy: removedByUiKit,
      };
    });
  }

  await probe("uikit.destroy-summary", "全部释放后的全局账本：SDK script 与全局对象仍在（官方语义）", "sdk", async () => {
    return {
      hostChildren: handles.map((h) => ({ name: h.name, children: h.host.children.length })),
      documentListenersAddedByUiKit: countOrigin(ledger.added, "ui-kit"),
      documentListenersRemovedByUiKit: countOrigin(ledger.removed, "ui-kit"),
      documentListenersAddedByOther: countOrigin(ledger.added, "other"),
      documentListenersAddedBySdkOrTelemetry: countOrigin(ledger.added, "sdk"),
      nonUiKitAddSites: ledger.added
        .filter((s) => s.origin !== "ui-kit")
        .map((s) => `${s.origin}: ${s.frames.split(" <- ").slice(1, 3).join(" <- ")}`)
        .slice(0, 8),
      scriptCountAfterDestroy: sdkScriptCount(),
      scriptCountAtStart,
      globalStillPresent: typeof (window as unknown as { BMap?: unknown }).BMap === "object",
    };
  });

  /* --- 6. 真实网络：控件必须自带「已知会成功」的对照组 --------------- */

  const searchHost = document.getElementById(hostIds.PlaceSearch)!;
  let firstUid = "";
  const control = await (async () => {
    if (!ak || !sdkReady || !map) return null;
    const instance = new uikit.PlaceSearch(searchHost, { map }) as {
      search: (keyword: string, option?: { city?: string }) => Promise<void>;
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      destroy: () => void;
    };
    let payload: unknown = null;
    instance.on("load", (data) => {
      payload = data;
    });
    try {
      await instance.search("百度大厦", { city: "北京" });
      return { instance, payload: payload as unknown[] | null };
    } catch (error) {
      return { instance, error: redactAk(String((error as Error)?.message ?? error)) };
    }
  })();

  const controlPois =
    control && !("error" in control) && Array.isArray(control.payload) ? control.payload : null;
  if (controlPois && controlPois.length > 0) {
    firstUid = String((controlPois[0] as { uid?: unknown }).uid ?? "");
  }

  await probe("uikit.PlaceSearch.search", "PlaceSearch 关键字检索（对照组：回包必须非空）", "sdk", async () => {
    expect(ak, "缺少 AK");
    if (!control) blocked("对照组控件未能构造（AK / SDK / 地图缺失）");
    if ("error" in control) throw new Error(`对照组检索抛错：${control.error}`);
    // 回包为空只说明环境（配额 / AK 权限 / 网络）不成立，因此是 blocked 而不是 fail。
    if (!controlPois || controlPois.length === 0) blocked("对照组回包为空 → 本轮网络结论无法判定");
    return {
      poiCount: controlPois.length,
      first: (controlPois[0] as { title?: unknown }).title ?? null,
    };
  });

  /** 对照组失败时，其余依赖回包的探针必须记 `blocked`，不能静默跳过、也不能算 fail。 */
  const networkGate = (): void => {
    if (!controlPois || controlPois.length === 0) {
      blocked("对照组 PlaceSearch.search 未回包 → 本轮网络结论无法判定");
    }
  };

  await probe("uikit.PlaceAutocomplete.suggest", "PlaceAutocomplete 真实建议回包", "sdk", async () => {
    networkGate();
    const host = document.createElement("div");
    host.style.cssText = "width:320px;height:200px";
    document.body.appendChild(host);
    const instance = new uikit.PlaceAutocomplete(host, { map }) as {
      search: (keyword: string) => void;
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      destroy: () => void;
    };
    let suggestions: unknown = null;
    instance.on("suggest", (data) => {
      suggestions = data;
    });
    instance.search("百度大厦");
    for (let i = 0; i < 60 && suggestions === null; i += 1) await sleep(500);
    const count = Array.isArray(suggestions) ? suggestions.length : -1;
    instance.destroy();
    host.remove();
    expect(count > 0, `suggest 回包为空（${JSON.stringify(suggestions)?.slice(0, 80) ?? "null"}）`);
    return {
      suggestionCount: count,
      first: (suggestions as { name?: unknown }[])[0]?.name ?? null,
    };
  });

  await probe("uikit.PlaceDetail.setPlace", "PlaceDetail 按 uid 拉取详情", "sdk", async () => {
    networkGate();
    expect(firstUid, "对照组未给出可用的 POI uid");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const instance = new uikit.PlaceDetail(host, { map }) as {
      setPlace: (uid: string) => void;
      on: (event: string, handler: (payload: unknown) => void) => unknown;
      destroy: () => void;
    };
    let detail: unknown = null;
    instance.on("load", (data) => {
      detail = data;
    });
    instance.setPlace(firstUid);
    for (let i = 0; i < 60 && detail === null; i += 1) await sleep(500);
    instance.destroy();
    host.remove();
    expect(detail, "detail 回包为空");
    return {
      title: (detail as { title?: unknown }).title ?? null,
      hasUid: Boolean((detail as { uid?: unknown }).uid),
    };
  });

  await probe("uikit.RoutePlan.search", "RoutePlan 驾车路线检索", "sdk", async () => {
    networkGate();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const instance = new uikit.RoutePlan(host, { map }) as {
      search: (options: Record<string, unknown>) => Promise<unknown>;
      destroy: () => void;
    };
    const BMap = (window as unknown as { BMap: { Point: new (lng: number, lat: number) => unknown } })
      .BMap;
    const result = (await instance.search({
      start: new BMap.Point(116.404, 39.915),
      end: new BMap.Point(116.305, 39.982),
    })) as { plans?: unknown[]; routeType?: unknown } | null;
    instance.destroy();
    host.remove();
    expect(result && Array.isArray(result.plans) && result.plans.length > 0, "路线回包为空");
    return { routeType: result!.routeType, planCount: result!.plans!.length };
  });

  /* --- 7. 代理模式：会改写全局并让后续加载失败，放最后 --------------- */

  await probe("loader.proxy-mode", "serviceHost 模式：自动补斜杠 + 声明 _BMapSecurityConfig + URL 不带 ak", null, async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    loader.reset();
    const pending = loader.load({ serviceHost: "https://example.invalid/_BMapService", version: "4.0" });
    const securityConfig = (window as unknown as { _BMapSecurityConfig?: unknown })
      ._BMapSecurityConfig;
    const src = redactAk(
      document.querySelector('script[src*="_BMapService"]')?.getAttribute("src") ?? "",
    );
    const settled = await pending.then(
      () => "resolved",
      (error: Error) => `rejected: ${redactAk(String(error.message)).slice(0, 60)}`,
    );
    console.warn = originalWarn;
    expect(securityConfig, "未声明 window._BMapSecurityConfig");
    expect(!/[?&]ak=/.test(src), "代理模式 URL 仍带 ak");
    loader.reset();
    return {
      warnings,
      securityConfig,
      secretHostUrl: src,
      settled,
      statusAfterReset: loader.getStatus(),
      globalsAfterReset: {
        bmap: typeof (window as unknown as { BMap?: unknown }).BMap,
        bmapgl: typeof (window as unknown as { BMapGL?: unknown }).BMapGL,
      },
    };
  });

  const verdicts: Record<string, "pass" | "fail" | "blocked"> = {};
  for (const widget of widgetNames) {
    // 「构造时挂上的 document 级监听是否在 destroy 时同数归还」单独判一次，
    // 不混进 destroy 探针：DOM 归位与监听归还是两条独立契约。
    const release = checks.find((c) => c.id === `uikit.${widget}.destroy`)?.detail as
      | { uiKitListenersAddedAtConstruct?: number; uiKitListenersRemovedByDestroy?: number }
      | undefined;
    if (release) {
      const added = release.uiKitListenersAddedAtConstruct ?? 0;
      const released = release.uiKitListenersRemovedByDestroy ?? 0;
      if (added > released) {
        checks.push({
          id: `uikit.${widget}.listener-leak`,
          name: `${widget} destroy 未归还 ${added - released} 个自己挂的 document 级监听`,
          status: "fail",
          detail: release,
        });
      }
    }
    const own = checks.filter((c) => c.id.startsWith(`uikit.${widget}.`));
    verdicts[widget] = own.some((c) => c.status === "fail")
      ? "fail"
      : own.some((c) => c.status === "blocked")
        ? "blocked"
        : "pass";
  }

  const report: ProbeReport = {
    ak: akPresent,
    ua: navigator.userAgent,
    sdk: sdkSnapshot,
    sdkAfterProxyReset: readSdkSnapshot(),
    checks,
    verdicts,
  };

  window.__PROBE__ = report;
  const pre = document.getElementById("report");
  if (pre) pre.textContent = redactAk(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  window.__PROBE__ = {
    ak: false,
    ua: navigator.userAgent,
    sdk: { bmap: false, bmapgl: false, same: false, versionLike: "" },
    sdkAfterProxyReset: { bmap: false, bmapgl: false, same: false, versionLike: "" },
    checks: [
      {
        id: "harness",
        name: "探针脚手架本身未抛错",
        status: "fail",
        error: redactAk(String((error as Error)?.stack ?? error)).slice(0, 500),
      },
    ],
    verdicts: {},
  };
  const pre = document.getElementById("report");
  if (pre) pre.textContent = redactAk(JSON.stringify(window.__PROBE__, null, 2));
});
