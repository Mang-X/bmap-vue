import { describe, it, expect } from "vitest";
import {
  BUILTIN_PLUGIN_URLS,
  drawingManagerPlugin,
  geoUtilsPlugin,
  mapVglPlugin,
  stringToPluginDefinitions,
  trackAnimationPlugin,
  urlPluginDefinition,
} from "./builtins";
import { PLUGIN_COMPAT_BY_ID } from "./compat-inventory";

describe("plugin definitions", () => {
  it("converts legacy string[] config to plugin definitions", () => {
    const defs = stringToPluginDefinitions([
      "TrackAnimation",
      "Mapvgl",
      "DrawingManager",
      "GeoUtils",
      "UnknownPlugin",
    ]);
    expect(defs.map((d) => d.name)).toEqual([
      "TrackAnimation",
      "Mapvgl",
      "DrawingManager",
      "GeoUtils",
      "UnknownPlugin",
    ]);
    // 未知插件 optional,不阻断
    expect(defs[4].required).toBe(false);
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

  it("urlPluginDefinition resolves existing global export without loading script", async () => {
    // 预置全局导出,避免真正请求网络
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
});
