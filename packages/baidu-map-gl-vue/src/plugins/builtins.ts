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
      // 简单 script 加载(生产应经 ScriptLoader 实现 timeout/SRI)
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
    const script = document.createElement("script");
    // MapVGL bundles inject Baidu analytics scripts, which can be blocked by browser extensions.
    (window as any)._disable_hmt = true;
    script.async = true;
    script.onload = () => {
      const exported = exportGetter();
      if (exported) resolve(exported);
      else reject(new Error(`plugin did not expose export: ${url}`));
    };
    script.onerror = () => reject(new Error(`failed to load plugin: ${url}`));
    if (url.includes("mapvgl")) {
      fetch(url)
        .then((response) => response.text())
        .then((source) => {
          // MapVGL injects analytics on load; extensions commonly block that request.
          script.textContent = source.replace(
            /window\._disable_hmt\|\|\(window\._hmt[\s\S]*?\}\(\)\);?/g,
            "",
          );
          document.body.appendChild(script);
          const exported = exportGetter();
          if (exported) resolve(exported);
          else reject(new Error(`plugin did not expose export: ${url}`));
        })
        .catch(() => reject(new Error(`failed to load plugin: ${url}`)));
    } else {
      script.src = url;
      document.body.appendChild(script);
    }
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          script.remove();
          reject(new Error("plugin aborted"));
        },
        { once: true },
      );
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
