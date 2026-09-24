/**
 * 插件 Catalog（M8-PLUGIN-CORE / issue #42）
 *
 * Catalog 要回答的是**一个名字对应哪个 definition**，以及**名字不认识时怎么办**。
 * 后者是本票要修的真缺口：`stringToPluginDefinitions` 曾经给未知名字返回
 * `{ required: false, load: async () => undefined }` —— 一个永远成功的空实现，于是
 * `plugins: ['TrackAnimatino']`（拼错一个字母）既没有报错、`getStatus()` 也是 `ready`，
 * 调用方拿到的「成功」是假的。
 *
 * 三条约定，各配一条会红的反证：
 *
 * 1. 每个名字对应**确定的工厂**——判据用函数同一性（`create === trackAnimationPlugin`），
 *    而不是「有没有 scope 字段」这类特征。特征判据挡不住「把工厂换成另一个也叫这名字的
 *    noop」，同一性判据挡得住。
 * 2. 名字不认识就**明确失败**（`BMAP_PLUGIN_UNKNOWN`），并带上「认得的名字有哪些」这个
 *    可操作信息。它与 `BMAP_PLUGIN_LOAD_FAILED`（认得名字、但脚本/依赖加载失败）必须分开：
 *    前者重试没有意义，后者才有。
 * 3. Catalog 与兼容清单（`PLUGIN_COMPAT_INVENTORY`）的**名字集合双向相等**。两边各有一份
 *    名字清单，只靠类型是锁不住的（类型只保证 `BuiltinPluginName` 这个联合里有谁，
 *    不保证 catalog 的键用它）。
 */
import { describe, it, expect } from "vitest";
import {
  BUILTIN_PLUGIN_CATALOG,
  resolvePluginDefinition,
  stringToPluginDefinitions,
} from "./catalog";
import {
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  geoUtilsPlugin,
} from "./builtins";
import { PLUGIN_COMPAT_INVENTORY, type BuiltinPluginName } from "./compat-inventory";
import type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";
import { BMapError } from "../core/errors/BMapError";

/** 名字 → 它必须对应的工厂。写成表而不是四条 if，加入新插件时漏一条会立刻显形。 */
const EXPECTED_FACTORIES: ReadonlyArray<
  readonly [BuiltinPluginName, () => BMapPluginDefinition<unknown>]
> = [
  ["TrackAnimation", trackAnimationPlugin],
  ["DrawingManager", drawingManagerPlugin],
  ["GeoUtils", geoUtilsPlugin],
  ["Mapvgl", mapVglPlugin],
];

describe("插件 Catalog：名字 → 确定的工厂", () => {
  it("catalog 的键与兼容清单的 id **双向相等**（不多不少）", () => {
    const catalogNames = Object.keys(BUILTIN_PLUGIN_CATALOG).sort();
    const inventoryNames = PLUGIN_COMPAT_INVENTORY.map((entry) => entry.id).sort();
    // 先证明两边都非空，否则两个空数组比相等恒真
    expect(inventoryNames.length).toBeGreaterThan(0);
    expect(catalogNames).toEqual(inventoryNames);
  });

  it("每个名字对应**同一个**工厂函数（同一性判据，不是特征判据）", () => {
    for (const [name, factory] of EXPECTED_FACTORIES) {
      expect(BUILTIN_PLUGIN_CATALOG[name]?.create, `${name} 挂到了别的工厂`).toBe(factory);
    }
    // 反证：这条判据必须真的能响 —— 拿另一个工厂冒充同一个名字必须不相等
    expect(BUILTIN_PLUGIN_CATALOG.TrackAnimation?.create).not.toBe(mapVglPlugin);
  });

  it("resolvePluginDefinition 返回该工厂产出的 definition（名字/作用域/必需性一致）", () => {
    for (const [name] of EXPECTED_FACTORIES) {
      const definition = resolvePluginDefinition(name);
      expect(definition.name, "definition 的名字必须等于被解析的名字").toBe(name);
      expect(definition.scope, `${name} 是脚本插件，作用域必须是 global`).toBe("global");
      // 兼容清单把 required 钉成字面量 false：必需功能不得依赖任何插件脚本
      expect(definition.required).toBe(false);
      expect(typeof definition.load).toBe("function");
    }
  });

  it("每次解析都拿到**新**的 definition 对象（工厂被真的调用，而不是复用同一份缓存）", () => {
    const first = resolvePluginDefinition("GeoUtils");
    const second = resolvePluginDefinition("GeoUtils");
    expect(first).not.toBe(second);
    expect(first.name).toBe(second.name);
  });
});

describe("插件 Catalog：unknown 名字明确失败", () => {
  it("未知名字抛 BMAP_PLUGIN_UNKNOWN，并把名字与已知名字都写进消息", () => {
    let caught: unknown;
    try {
      resolvePluginDefinition("TrackAnimatino"); // 少一个 n
    } catch (error) {
      caught = error;
    }
    expect(caught, "未知名字必须抛错，不能返回空实现").toBeInstanceOf(BMapError);
    const error = caught as BMapError;
    expect(error.code).toBe("BMAP_PLUGIN_UNKNOWN");
    // 结构化上下文：错误面板/日志里能直接看到是哪个名字
    expect(error.plugin).toBe("TrackAnimatino");
    expect(error.message).toContain("TrackAnimatino");
    // 可操作性：消息里必须列出认得的名字，否则调用方只能去翻源码
    expect(error.message).toContain("TrackAnimation");
    expect(error.message).toContain("GeoUtils");
  });

  it("未知名字**不是** retryable（配置错误重试没有意义），且与加载失败可区分", () => {
    try {
      resolvePluginDefinition("NoSuchPlugin");
      throw new Error("unreachable: 未知名字必须抛错");
    } catch (error) {
      expect((error as BMapError).retryable).toBe(false);
      expect((error as BMapError).code).not.toBe("BMAP_PLUGIN_LOAD_FAILED");
    }
  });

  it("stringToPluginDefinitions：已知名字按原顺序解析", () => {
    const definitions = stringToPluginDefinitions(["Mapvgl", "GeoUtils"]);
    expect(definitions.map((d) => d.name)).toEqual(["Mapvgl", "GeoUtils"]);
    expect(definitions[0]).toBeTypeOf("object");
  });

  it("stringToPluginDefinitions：任何一个未知名字都整体抛错（不做部分成功）", () => {
    // 「部分成功」比整体失败更糟：调用方会以为列表里的插件都装上了
    expect(() => stringToPluginDefinitions(["GeoUtils", "Nope"])).toThrow(BMapError);
    try {
      stringToPluginDefinitions(["GeoUtils", "Nope"]);
    } catch (error) {
      expect((error as BMapError).code).toBe("BMAP_PLUGIN_UNKNOWN");
      expect((error as BMapError).plugin).toBe("Nope");
    }
  });

  it("空列表是合法的（不是错误）", () => {
    expect(stringToPluginDefinitions([])).toEqual([]);
  });
});
