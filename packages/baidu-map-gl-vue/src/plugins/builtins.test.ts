import { describe, it, expect } from "vitest";
import {
  BUILTIN_PLUGIN_URLS,
  drawingManagerPlugin,
  geoUtilsPlugin,
  mapVglPlugin,
  trackAnimationPlugin,
  urlPluginDefinition,
} from "./builtins";
// `stringToPluginDefinitions` 随 M8-PLUGIN-CORE（#42）搬到 catalog：未知名字不再降级成空实现，
// 因此它属于「名字 → definition」那个模块。完整语义（含未知名字抛错）在 `catalog.test.ts`。
import { stringToPluginDefinitions } from "./catalog";
import { createPluginHost } from "../core/plugins/PluginHost";
import { PLUGIN_COMPAT_BY_ID } from "./compat-inventory";

describe("plugin definitions", () => {
  it("converts legacy string[] config to plugin definitions", () => {
    const defs = stringToPluginDefinitions(["TrackAnimation", "Mapvgl", "DrawingManager", "GeoUtils"]);
    expect(defs.map((d) => d.name)).toEqual([
      "TrackAnimation",
      "Mapvgl",
      "DrawingManager",
      "GeoUtils",
    ]);
    // 内置插件一律 optional（隔离口径），旧断言 `defs[4].required === false` 依赖的
    // 「未知插件被降级成一个 optional 空实现」这条行为已在 #42 删除 —— 现在未知名字抛错。
    for (const def of defs) expect(def.required, `${def.name} 应为 optional`).toBe(false);
  });

  /**
   * M3A3-07（issue #25）：内置插件**一律** optional。
   *
   * `PluginRegistry` 的语义是 `required !== false ⇒ 失败即抛`，所以这条断言等价于
   * 「一个第三方 CDN 脚本下载失败不得让地图失败」。反证写在
   * `tests/behavior/v3-plugin-compat-inventory.test.ts`（把 required 改成 true，隔离用例必须红）。
   */
  it("内置插件一律 optional，必需功能不依赖插件脚本", () => {
    const builtins = [
      trackAnimationPlugin(),
      mapVglPlugin(),
      drawingManagerPlugin(),
      geoUtilsPlugin(),
    ];
    expect(builtins.map((d) => d.name)).toEqual([
      "TrackAnimation",
      "Mapvgl",
      "DrawingManager",
      "GeoUtils",
    ]);
    // 先证明这四条断言不是空的：名字确实取到了，才谈得上 required 的值
    expect(new Set(builtins.map((d) => d.name)).size).toBe(4);
    for (const def of builtins) {
      expect(def.required, `${def.name} 应为 optional`).toBe(false);
    }
  });

  it("每个内置插件都在兼容 inventory 里有条目，且 URL 与 BUILTIN_PLUGIN_URLS 同源", () => {
    for (const [name, key] of [
      ["TrackAnimation", "trackAnimation"],
      ["Mapvgl", "mapvgl"],
      ["DrawingManager", "drawingManager"],
      ["GeoUtils", "geoUtils"],
    ] as const) {
      const entry = PLUGIN_COMPAT_BY_ID[name];
      expect(entry, `${name} 缺少 inventory 条目`).toBeDefined();
      expect(entry.urlKey).toBe(key);
      expect(BUILTIN_PLUGIN_URLS[key]).toMatch(/^https:\/\//);
    }
  });

  it("urlPluginDefinition 的 scope 缺省是 global（脚本插件），且可显式覆盖成 map", () => {
    // 两个缺省各有各的道理，别把它们当成一个：`urlPluginDefinition` 产出的是「注入 `<script>`
    // + 读文档级全局」，本来就该是 global；手写 definition 的缺省是 map（见 PluginRegistry.ts）。
    const scriptPlugin = urlPluginDefinition("X", "https://example.com/x.js", () => undefined);
    const mapScoped = urlPluginDefinition("Y", "https://example.com/y.js", () => undefined, {
      scope: "map",
    });
    expect(scriptPlugin.scope, "脚本插件缺省是文档级资源").toBe("global");
    expect(mapScoped.scope, "需要按地图隔离时必须能显式覆盖").toBe("map");
    // 反证：这条判据不能对任何输入都返回同一个值
    expect(scriptPlugin.scope).not.toBe(mapScoped.scope);
  });

  it("urlPluginDefinition resolves existing global export without loading script", async () => {    // 预置全局导出,避免真正请求网络
    (window as any).__fakePlugin = { v: 1 };
    const def = urlPluginDefinition(
      "Fake",
      "https://example.com/x.js",
      () => (window as any).__fakePlugin,
    );
    const res = await def.load({ api: {}, map: {}, client: null } as any, new AbortController().signal);
    expect(res).toEqual({ v: 1 });
    delete (window as any).__fakePlugin;
  });

  it("urlPluginDefinition rejects when export missing after (mock) load", async () => {
    const def = urlPluginDefinition("Missing", "https://example.com/x.js", () => undefined);
    // 无全局导出且无 script 环境,应 reject
    await expect(
      def.load({ api: {}, map: {}, client: null } as any, new AbortController().signal),
    ).rejects.toThrow();
  });

  /**
   * 评审 #88 文档项：`disposeDefaultPluginHost()` **不是**内置脚本插件的「干净起点」。
   *
   * 它只清宿主的缓存与纪元。`loadScriptWithExport` 的第一件事就是读 `exportGetter()` ——
   * 真实脚本一旦跑过，`window.BMapGLLib.GeoUtils` 就一直在那儿（上游没有卸载入口，
   * 本库也不许删它，见 ADR 决策 4），于是**下一次 acquire 直接命中短路分支**：
   * 复用同一个全局对象，既不重新拉脚本，也不会「重新初始化」。文档必须这么写。
   */
  it("宿主 dispose 之后重新取用内置插件：命中「导出已存在」的短路，不再拉脚本", async () => {
    const host = createPluginHost();
    (window as any).BMapGLLib = { GeoUtils: { fake: true } };
    const pluginsBefore = document.querySelectorAll("script").length;
    const context = { api: {}, map: {}, client: null } as never;

    const first = await host.acquire("GeoUtils", geoUtilsPlugin(), context);
    host.dispose();
    const second = await host.acquire("GeoUtils", geoUtilsPlugin(), context);

    expect(second, "已存在的全局被复用，而不是重新加载").toBe(first);
    expect(document.querySelectorAll("script").length, "dispose 不卸载脚本，重新取用也不新插脚本")
      .toBe(pluginsBefore);

    delete (window as any).BMapGLLib;
    host.dispose();
  });
});
