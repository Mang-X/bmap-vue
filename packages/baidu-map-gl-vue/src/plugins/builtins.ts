/**
 * 内置插件 definitions
 *
 * 将 v2 的字符串插件配置迁移为 typed plugin definitions。
 *
 * 每个内置插件:
 * - 锁定明确版本 URL,不使用浮动 unpkg latest
 * - 加载后就绪,可被 whenPlugin(name) 取到
 *
 * M3A3-07（issue #25）的两条调整，依据见 `compat-inventory.ts` 与 ADR
 * `2026-09-13-plugin-compat-inventory`：
 *
 * 1. **内置插件一律 optional**（`required` 一律 `false`）。`PluginRegistry` 的语义是
 *    `required !== false ⇒ 失败即抛`（`core/plugins/PluginRegistry.ts`），因此标成必需意味着
 *    「一个第三方 CDN 脚本的抖动能让整张地图失败」。此前 `TrackAnimation` 是 `required: true`，
 *    而它恰恰是四个插件里唯一被本库标为 `unsupported` 的（`service.track-animation`）——
 *    隔离口径要求必需功能不依赖任何插件脚本，所以这里把它改回 optional。
 * 2. 补齐 `GeoUtils` 工厂：URL 一直在 `BUILTIN_PLUGIN_URLS` 里，但既没有工厂、也不在
 *    `stringToPluginDefinitions` 的名字表里，于是 `plugins: ['GeoUtils']` 会被当成未知插件
 *    静默变成空实现。
 *
 * M8-PLUGIN-CORE（issue #42）的两条调整：
 *
 * 1. **名字 → definition 的映射搬到了 `catalog.ts`**（`BUILTIN_PLUGIN_CATALOG` /
 *    `resolvePluginDefinition` / `stringToPluginDefinitions`）。本文件只留工厂与 URL，
 *    不再持有名字表——一份清单放两处正是上面第 2 条那种漂移的来源。
 * 2. **未知名字不再降级成空实现**，改为抛 `BMAP_PLUGIN_UNKNOWN`。旧行为是「假支持」：
 *    拼错一个字母也会 `getStatus() === 'ready'`。
 */
import type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";

export interface PluginLoader {
  (src: string, exportName: string): Promise<unknown>;
}

/**
 * 插件脚本的加载超时（毫秒）—— `plugins/**` 这一条通道自己的默认值。
 *
 * ## 为什么它不复用 SDK 入口的 `timeout`（ADR `2026-09-13-official-first-loader-and-ui-kit`）
 *
 * 那个 `timeout` 是**官方 Loader 的参数**（`0` = 不超时），语义与实现都归官方包；插件通道是
 * 本库自建的第二条通道（第三条是显式高级路径的 `ScriptLoader`），把它挂到 SDK 入口的选项上
 * 会让「SDK 入口超时」这一条冻结语义凭空多管一件事。
 *
 * ## 为什么不是「直接复用 `ScriptLoader`」（issue #121 实施步骤 3 的判据）
 *
 * 两条通道的**契约不同**，不是「同一件事的两种写法」：
 *
 * | 维度 | `ScriptLoader`（`core/loader`） | 本文件（插件通道） |
 * | --- | --- | --- |
 * | 就绪信号 | `load` 事件的载荷 / `jsonp` 回调 / `exportGetter` + `assertReady` | 「注入 `<script>` 后读一个**文档级全局**」 |
 * | 去重键 | `src` + `mode` + 完整性属性 | **插件名**（`PluginHost` 那一层） |
 * | 短路 | 无（已成功的配置直接复用结果） | **全局已存在 ⇒ 不插脚本**（宿主 dispose 后的复用依赖它） |
 * | 内联注入 | 不支持 | **支持**（`Mapvgl` 分支要 `fetch` 后剥掉统计脚本再内联） |
 * | 属性面 | `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` | 刻意不接收（接收后忽略属于假支持） |
 *
 * 尤其「内联注入」与「全局已存在短路」是**消费者真的需要**的行为：为了统一而统一，就要给
 * `ScriptLoader` 加一条与 SDK 入口无关的 `inlineSource` 模式，或者把插件通道的两条既有语义搬走。
 * 因此本票**保持两条通道分离**，只把缺口（没有超时）补上。
 *
 * ## 取值依据（本轮实测的脚本体积）
 *
 * | 插件 | 体积 | 说明 |
 * | --- | --- | --- |
 * | `TrackAnimation` | 4.9 KB | `mapopen.bj.bcebos.com`（百度自托管 GitHub 镜像） |
 * | `DrawingManager` | 41.7 KB | 同上，且它会自己再注入两个脚本 |
 * | `GeoUtils` | 5.8 KB | 同上 |
 * | `Mapvgl` | 621 KB | `unpkg`，且走 `fetch` + 内联分支 |
 *
 * `Mapvgl` 是本值的主要约束：621 KB 在 ~20 KB/s 的链路上要约 30s。四个内置插件**都是 optional**
 * （`required: false`，见下），所以「超时」在这里的后果是「这个插件没有就绪 + 回执 `plugin-error`」，
 * 而不是「地图失败」——这正是这个默认值可以取「宁可宽松」的理由。
 *
 * 取值 `<= 0` 表示**关闭超时**（与 SDK 入口 `timeout` 的 `0` = 不超时是同一口径）。目前没有调用方
 * 这么用；实现里保留这个分支是因为常量将来可能被调小到 0，而「立刻超时」显然不是那时的本意。
 */
export const PLUGIN_SCRIPT_TIMEOUT_MS = 30_000;

/**
 * 从 URL 加载脚本并返回全局导出。
 *
 * `scope` 的缺省是 **`"global"`**，与 `BMapPluginDefinition.scope` 的缺省（`"map"`）**不同**，
 * 这是刻意的：本工厂产出的都是「注入 `<script>` + 读一个文档级全局」的插件，资源本来就是
 * 文档级的；手写 definition 则保守按 `map` 处理（不改变既有自定义插件的行为）。
 * 两个缺省各有各的道理，别把它们当成一个。
 */
export function urlPluginDefinition<T>(
  name: string,
  url: string,
  exportGetter: () => unknown,
  options: { required?: boolean; scope?: "global" | "map"; dependencies?: readonly string[] } = {},
): BMapPluginDefinition<T> {
  return {
    name,
    scope: options.scope ?? "global",
    required: options.required ?? false,
    dependencies: options.dependencies,
    async load(_context, signal) {
      if (signal?.aborted) {
        throw new Error(`plugin "${name}" aborted`);
      }
      // 走本文件自己的加载通道（超时由 `PLUGIN_SCRIPT_TIMEOUT_MS` 兜底）；为什么不复用
      // `ScriptLoader` 见 `PLUGIN_SCRIPT_TIMEOUT_MS` 的说明。
      const exported = await loadScriptWithExport(url, exportGetter, signal);
      return exported as T;
    },
  };
}

function loadScriptWithExport(
  url: string,
  exportGetter: () => unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("plugin load requires a browser environment"));
      return;
    }
    if (signal?.aborted) {
      reject(new Error("plugin aborted"));
      return;
    }
    const existing = exportGetter();
    if (existing) {
      resolve(existing);
      return;
    }

    /**
     * 本次加载是否已经结算。
     *
     * 三个出口（成功 / 失败 / 取消）都要过它：
     * - **超时 / 取消之后的迟到回包**不得再改动任何状态（旧实现里 `Mapvgl` 那条分支会在
     *   `fetch` 之后再 `appendChild`，于是「已经取消掉的加载」照样会往文档里插一个内联脚本）；
     * - `script.onload` 与定时器可能在同一轮事件循环里竞争，先到者胜。
     */
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const script = document.createElement("script");
    // MapVGL bundles inject Baidu analytics scripts, which can be blocked by browser extensions.
    (window as any)._disable_hmt = true;
    script.async = true;

    /** 收尾：清计时器与 abort 监听、摘掉事件处理器；`removeScript` 时把 `<script>` 也摘掉。 */
    function cleanup(removeScript: boolean): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
      script.onload = null;
      script.onerror = null;
      if (removeScript) script.remove();
    }

    /** 成功：保留 `<script>`（与既有行为一致——宿主页面上这个脚本本来就该继续存在）。 */
    function succeed(value: unknown): void {
      if (settled) return;
      settled = true;
      cleanup(false);
      resolve(value);
    }

    /** 失败（`error` 事件 / 全局没暴露 / `fetch` 失败）：错误如实上报，**元素的处理沿用既有语义**。 */
    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup(false);
      reject(error);
    }

    /**
     * 作废（超时 / 取消）：错误如实上报，并**摘掉 `<script>`**。
     *
     * 与 `fail` 分开是为了让本票的行为增量可核对：既有实现只在取消时摘脚本，本次把**超时**并到
     * 同一条清理上（一个永不响应的请求留在文档里除了占着连接没有别的用途），
     * 而 `error` / 「脚本加载成功但没暴露全局」这两条既有路径的元素处理**保持不变**。
     */
    function discard(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(error);
    }

    function readExportOrFail(): void {
      const exported = exportGetter();
      if (exported) succeed(exported);
      else fail(new Error(`plugin did not expose export: ${url}`));
    }

    function onAbort(): void {
      discard(new Error("plugin aborted"));
    }

    // 计时器必须在**任何异步动作之前**起：`Mapvgl` 分支先 `fetch` 再内联，超时同样要覆盖那段。
    if (PLUGIN_SCRIPT_TIMEOUT_MS > 0) {
      timer = setTimeout(() => {
        discard(new Error(`plugin load timed out after ${PLUGIN_SCRIPT_TIMEOUT_MS}ms: ${url}`));
      }, PLUGIN_SCRIPT_TIMEOUT_MS);
    }

    script.onload = () => readExportOrFail();
    script.onerror = () => fail(new Error(`failed to load plugin: ${url}`));
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    if (url.includes("mapvgl")) {
      fetch(url)
        .then((response) => response.text())
        .then((source) => {
          // 超时 / 取消之后不再插脚本（否则「已经作废的加载」会往文档里注入一个内联脚本）
          if (settled) return;
          // MapVGL injects analytics on load; extensions commonly block that request.
          script.textContent = source.replace(
            /window\._disable_hmt\|\|\(window\._hmt[\s\S]*?\}\(\)\);?/g,
            "",
          );
          document.body.appendChild(script);
          readExportOrFail();
        })
        .catch(() => fail(new Error(`failed to load plugin: ${url}`)));
    } else {
      script.src = url;
      document.body.appendChild(script);
    }
  });
}

// 内置插件 URL(锁定版本,不用 latest)
export const BUILTIN_PLUGIN_URLS = {
  trackAnimation:
    "https://mapopen.bj.bcebos.com/github/BMapGLLib/TrackAnimation/src/TrackAnimation.min.js",
  drawingManager:
    "https://mapopen.bj.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js",
  geoUtils: "https://mapopen.bj.bcebos.com/github/BMapGLLib/GeoUtils/src/GeoUtils.min.js",
  mapvgl: "https://unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js",
} as const;

/**
 * TrackAnimation 插件:暴露 window.BMapGLLib.TrackAnimation
 *
 * **optional**（M3A3-07）：它对应 `service.track-animation`，而后者在 Capability Catalog 里是
 * `unsupported`（4.0 的替代能力是原生图层 `layer.track-line`）。把它标成必需会让「地图能不能起」
 * 取决于一个本库明确不支持的第三方脚本能否下载成功。
 *
 * **scope `global`**（#42）：注入的是文档级脚本、暴露的是文档级全局，所以它由共享宿主持有、
 * 跨地图只加载一次，且地图卸载不释放。四个内置插件都**显式**写出来，不靠工厂缺省 ——
 * 「它是 global 的」这件事值得在每一处都看得见（工厂缺省恰好也是 global，但那是巧合，不是依据）。
 */
export function trackAnimationPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(
    "TrackAnimation",
    BUILTIN_PLUGIN_URLS.trackAnimation,
    () => (window as any).BMapGLLib?.TrackAnimation,
    { scope: "global" },
  );
}

/** Mapvgl 插件:暴露 window.mapvgl（文档级脚本，`scope: "global"`） */
export function mapVglPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition("Mapvgl", BUILTIN_PLUGIN_URLS.mapvgl, () => (window as any).mapvgl, {
    required: false,
    scope: "global",
  });
}

/** DrawingManager 插件:暴露 window.BMapGLLib.DrawingManager（文档级脚本，`scope: "global"`） */
export function drawingManagerPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(
    "DrawingManager",
    BUILTIN_PLUGIN_URLS.drawingManager,
    () => (window as any).BMapGLLib?.DrawingManager,
    { scope: "global" },
  );
}

/** GeoUtils 插件:暴露 window.BMapGLLib.GeoUtils（M3A3-07 补的工厂，此前只有 URL） */
export function geoUtilsPlugin(): BMapPluginDefinition<unknown> {
  return urlPluginDefinition(
    "GeoUtils",
    BUILTIN_PLUGIN_URLS.geoUtils,
    () => (window as any).BMapGLLib?.GeoUtils,
    { scope: "global" },
  );
}
