import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  BUILTIN_PLUGIN_URLS,
  PLUGIN_SCRIPT_TIMEOUT_MS,
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

/**
 * 插件脚本加载超时（issue #121）
 *
 * 缺陷形态：`loadScriptWithExport` 只有 `<script>` + 全局导出短路 + `AbortSignal`，**没有超时** ——
 * 脚本服务器「建立连接但不响应」时 `whenPlugin` 会永久挂着（`PluginRegistry` 的 `status` 停在
 * `loading`、`consumers` 不归零，同一个 `plugins` 列表里后面的插件永远不会被请求）。
 * 真实浏览器读数见 `scripts/probe-plugin-load-channel.mts`。
 *
 * ## 为什么用「普通元素」当替身造挂起
 *
 * happy-dom 会在 `appendChild` 时**同步**给不可达的 `<script src>` 派发 `error`（实测事件顺序是
 * `error → after-appendChild`），所以「既不 load 也不 error」的挂起用真 `src` 造不出来。
 * 这里把 `createElement("script")` 换成一个普通元素（只保留 `src` / `onload` / `onerror` / `remove`
 * 这些真的被用到的成员），于是挂起是一个**确定性**状态，而超时语义仍然是真实代码路径。
 * 断言随之改成「元素在不在文档里」（`document.body.contains`）而不是 `document.scripts`。
 *
 * 用假计时器把「等 30 秒」变成一步，并**成对**断言：计时器真的起了（否则「到点拒绝」可能是别的
 * 原因）→ 到点以可识别的超时错误拒绝 → 收尾把计时器与元素都清干净。
 */
describe("插件脚本加载超时（issue #121）", () => {
  const context = { api: {}, map: {}, client: null } as never;
  const HANG_URL = "https://example.com/never-responds.js";

  /**
   * 模块级缓存原始 `createElement`：必须在**任何 spy 安装之前**取一次，否则
   * `mockImplementation` 里再调 `document.createElement` 会自递归（`Maximum call stack`）。
   */
  const realCreateElement = document.createElement.bind(document);

  /**
   * 把「成功或失败」统一收敛成 `Error`：失败就是原始错误，成功则交给 `__resolved__` 哨兵
   * （断言里能区分「结算成功」与「结算失败但消息恰好匹配」）。显式标类型是为了让 `await` 之后
   * 拿到的是 `Error` 而不是 `unknown`（`def.load` 的返回类型是 `Promise<unknown>`）。
   */
  function settledAsError(pending: Promise<unknown>): Promise<Error> {
    return pending.then(
      () => new Error("__resolved__"),
      (error: unknown) => error as Error,
    );
  }

  function stubScriptCreation(): HTMLElement[] {
    const created: HTMLElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: unknown) => {
      if (tag === "script") {
        // 普通元素冒充 `<script>`：happy-dom 不会为它触发任何 load / error
        const element = realCreateElement("div", options as never) as unknown as HTMLElement;
        created.push(element);
        return element as never;
      }
      return realCreateElement(tag as never, options as never) as never;
    }) as never);
    return created;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("常量为有限正数（否则下面几条「到点超时」的断言会静默空转）", () => {
    expect(Number.isFinite(PLUGIN_SCRIPT_TIMEOUT_MS)).toBe(true);
    expect(PLUGIN_SCRIPT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("永不响应的脚本：到点以超时错误拒绝，并摘掉那个脚本元素", async () => {
    const created = stubScriptCreation();
    const def = urlPluginDefinition("Hang", HANG_URL, () => undefined);
    const pending = def.load(context, new AbortController().signal);
    const settled = settledAsError(pending);

    // 正证：元素真的插进去了、计时器真的起了 —— 否则「被摘掉」与「到点拒绝」都可能是恒真
    expect(created.length, "应当创建一个脚本元素").toBe(1);
    expect(document.body.contains(created[0]!), "脚本元素应当被插入文档").toBe(true);
    expect(vi.getTimerCount(), "应当已经武装了超时计时器").toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(PLUGIN_SCRIPT_TIMEOUT_MS);
    const error = await settled;
    expect(String(error.message)).toMatch(/timed out/i);
    expect(String(error.message)).toContain(String(PLUGIN_SCRIPT_TIMEOUT_MS));

    expect(document.body.contains(created[0]!), "超时必须摘掉脚本元素").toBe(false);
    expect(vi.getTimerCount(), "结算后不得留下计时器").toBe(0);
  });

  it("脚本正常 onload：立即成功，不等到超时、也不判超时", async () => {
    const created = stubScriptCreation();
    const url = "https://example.com/ok.js";
    // 刻意**不**预置导出：预置会让「导出已存在」的短路生效，根本不会插脚本（那测的是另一条分支）
    let exposed: unknown;
    const def = urlPluginDefinition("Ok", url, () => exposed);
    const pending = def.load(context, new AbortController().signal);
    expect(created.length).toBe(1);
    expect(vi.getTimerCount(), "加载期间计时器应当在飞").toBeGreaterThan(0);

    exposed = { v: 1 };
    created[0]!.dispatchEvent(new Event("load"));

    await expect(pending).resolves.toEqual({ v: 1 });
    // 收尾：计时器必须被清掉（否则 30s 后会有一个无人认领的 reject）
    expect(vi.getTimerCount(), "成功后不得留下计时器").toBe(0);
    expect(document.body.contains(created[0]!), "成功保留脚本元素（既有行为）").toBe(true);
  });

  it("脚本加载成功但导出缺失：报「没有暴露导出」，与超时原因可区分", async () => {
    const created = stubScriptCreation();
    const def = urlPluginDefinition("NoExport", "https://example.com/no-export.js", () => undefined);
    const pending = def.load(context, new AbortController().signal);
    const settled = settledAsError(pending);

    created[0]!.dispatchEvent(new Event("load"));
    const error = await settled;
    expect(String(error.message)).toMatch(/did not expose export/i);
    expect(String(error.message)).not.toMatch(/timed out/i);
    expect(vi.getTimerCount(), "结算后不得留下计时器").toBe(0);
  });

  it("abort 仍然摘掉脚本元素并拒绝（既有取消语义的回归）", async () => {
    const created = stubScriptCreation();
    const def = urlPluginDefinition("Aborted", HANG_URL, () => undefined);
    const controller = new AbortController();
    const pending = def.load(context, controller.signal);
    const settled = settledAsError(pending);
    expect(document.body.contains(created[0]!)).toBe(true);

    controller.abort();
    const error = await settled;
    expect(String(error.message)).toMatch(/aborted/i);
    expect(document.body.contains(created[0]!), "取消必须摘掉脚本元素").toBe(false);
    expect(vi.getTimerCount(), "取消后不得留下计时器").toBe(0);
  });

  it("Mapvgl 分支：取消之后迟到的 fetch 不得再往文档里插脚本", async () => {
    // 这一条是本次顺带修掉的既有洞：该分支的脚本是**内联**注入（没有 `src`），元素要等 `fetch`
    // 回来才 `appendChild` —— 期间取消的话，旧实现照样会把脚本插进去。
    const created = stubScriptCreation();
    const source = "window.mapvgl = { View: function () {} };";
    // 用**数组收集**而不是 `let resolveFetch: T | null`：TS 会把「只在回调里赋值」的变量收窄成
    // `never`（赋了也看不见），于是 `resolveFetch?.(...)` 报 TS2349（#122 的同一形态）。
    const fetchResolvers: Array<(value: unknown) => void> = [];
    const fetchStub = vi.fn(
      () =>
        new Promise((resolve) => {
          fetchResolvers.push(resolve as (value: unknown) => void);
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      const def = urlPluginDefinition(
        "Vgl",
        "https://unpkg.com/mapvgl@1.0.0-beta.188/dist/mapvgl.min.js",
        () => undefined,
      );
      const controller = new AbortController();
      const pending = def.load(context, controller.signal);
      const settled = settledAsError(pending);
      // 让 `fetch(...)` 那一跳先挂上去
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchStub, "Mapvgl 分支必须先 fetch 再内联").toHaveBeenCalledTimes(1);
      expect(document.body.contains(created[0]!), "fetch 回来之前不得插入脚本").toBe(false);

      controller.abort();
      expect(String((await settled).message)).toMatch(/aborted/i);

      expect(fetchResolvers.length, "应当挂上一次 fetch").toBe(1);
      fetchResolvers[0]!({ text: async () => source });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      expect(
        document.body.contains(created[0]!),
        "已经作废的加载不得再插入内联脚本",
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
