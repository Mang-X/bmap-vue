/**
 * 插件失败隔离的**组件级**契约（M3A3-07 / issue #25；评审 #85 P1-2 重写）
 *
 * `PluginRegistry` 那一层已经有用例证明「optional 插件失败只发事件、不抛」。组件层还要钉三件事：
 *
 * 1. **失败不得阻断地图** —— `Map.vue` 的承诺是「ready 不等插件」（`loadPluginsInBackground`）；
 * 2. **失败不得被回执成成功** —— 对 optional 插件，注册表在失败时是以 `null` **resolve** 的
 *    （`PluginRegistry.loadPlugin`），所以 `await` 拿到返回值**不等于**成功；
 * 3. **但 `null` 之外的值也不等于失败**（评审 #85 P1-2 抓到的反向错误）—— 只注入副作用、不产出
 *    资源的「void 插件」`load` 出 `undefined` 本来就是合法形态。曾用 `loaded == null` 判失败，
 *    会把它们一起否掉；正确判据是**注册表状态**（`getStatus(name) === "ready"`）。
 *
 * ## 为什么不用 `vi.mock` 造失败样本
 *
 * 第一版用 `vi.mock("…/plugins/builtins")` 返回受控 definition，加计数器后发现 **`mock calls: 0`**
 * —— mock 拦不住 `.vue` 里那句相对导入（specifier 带不带 `.ts` 都试过），于是组件实际用的是真实
 * 名字表，而「未知插件 → noop → resolve undefined」被误读成「我的修复没生效」。
 *
 * 现在改成走**真实代码路径**造两种样本，全程不 mock 模块：
 * - **失败**：挑一个**真工厂**（`TrackAnimation`；不能挑 `Mapvgl` —— 它走的是
 *   `fetch(url)` + 内联的 `mapvgl` 专用分支，根本不产生带 `src` 的 `<script>`，打桩拦不到），
 *   并在测试里把 `document.createElement` 对非百度脚本的
 *   `<script>` 打成「派发 `error`」——`loadScriptWithExport` 的 `onerror` 分支因此真的 reject，
 *   这是**确定性、不碰网络**的真实失败；
 * - **成功**：预置 `window.BMapGLLib.GeoUtils`。这是 `loadScriptWithExport` 的
 *   「导出已存在就直接 resolve」分支，等价于「宿主已经加载过这个脚本」的真实场景。
 *
 *   注（M8-PLUGIN-CORE / #42）：这一半原先用的是**未知插件名**（名字表当时给它一个 noop 空实现，
 *   resolve `undefined`，状态 `ready`），用来钉「`undefined` 不等于失败」。
 *   那条行为已经作为「假支持」被删除 —— 未知名字现在抛 `BMAP_PLUGIN_UNKNOWN`
 *   （组件层回执 `plugin-error`，见 `v3-plugin-catalog-scope.test.ts`）。
 *   「void 插件是成功」这条语义因此搬到它真正能被表达的层级：
 *   `PluginRegistry.test.ts` 里直接注册一个 `load: async () => undefined` 的 definition。
 *
 * 两个样本互为对照：把判据写回 `loaded == null`，两条用例都会红。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import { disposeDefaultPluginHost } from "../../packages/bmap-vue/src/core/plugins/PluginHost";
import { BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS } from "../../packages/bmap-vue/src/plugins/builtins";

// #26 后 Provider 必须是结构化 v4 形状：harness.provider() 自述 engine + namespace。
const { harness } = createFakeV4Harness();

/**
 * 模块级缓存原始 `createElement`。
 *
 * 必须在**任何 spy 安装之前**取一次：`vi.spyOn` 对同一个 (对象, 方法) 会返回**同一个 spy**，
 * 所以在用例里再 `document.createElement.bind(document)` 拿到的其实是「被替换后的那份」，
 * 于是 `mockImplementation` 里再调它 = 自递归（`Maximum call stack size exceeded`）。
 * `tests/setup.ts` 出于同样原因也是模块级缓存。
 */
const realCreateElement = document.createElement.bind(document);

function makeGlobalProvider() {
  // 原来是「把裸 fake 挂到 window.BMapGL 再返回它」；现在结构化 Provider 直接给出
  // `{ engine: "jsapi-v4", version, namespace }`，不再经全局。
  return harness.provider();
}

function createHost(): HTMLElement {
  return harness.container();
}

/**
 * 让**非百度**脚本的 `<script>` 注入确定性失败（派发 `error`），从而走真实 reject 分支。
 *
 * 百度入口脚本不受影响（本用例也不需要它：provider 直接给 fake SDK）。
 */
function failThirdPartyScripts(): void {
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: unknown) => {
    const element = realCreateElement(tag as never, options as never) as HTMLElement;
    if (tag === "script") {
      setTimeout(() => {
        const script = element as HTMLScriptElement;
        if (script.src && !script.src.includes("api.map.baidu.com")) {
          script.dispatchEvent(new Event("error"));
        }
      }, 0);
    }
    return element;
  }) as never);
}

/**
 * 让**第三方**脚本的 `<script>` 既不 `load` 也不 `error` —— 「服务器建立连接但不响应」的替身。
 *
 * 不能靠「一个不存在的 URL」来造挂起：happy-dom 会在 `appendChild` 时**同步**给不可达的
 * `<script src>` 派发 `error`（实测事件顺序是 `error → after-appendChild`），于是挂起变成了失败。
 * 因此这里把 `createElement("script")` 换成普通元素：`loadScriptWithExport` 用到的
 * `src` / `async` / `onload` / `onerror` / `remove` 它都有，但不会有任何事件被派发。
 */
function hangThirdPartyScripts(): void {
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: unknown) => {
    if (tag === "script") return realCreateElement("div", options as never) as never;
    return realCreateElement(tag as never, options as never) as never;
  }) as never);
}

function mountMap(plugins: string[]) {
  const wrapper = mount(
    defineComponent({
      render: () => h(Map, { plugins, provider: makeGlobalProvider() } as never),
    }),
    { attachTo: createHost() },
  );
  const inner = wrapper.findComponent(Map);
  return {
    wrapper,
    readyEvents: () => inner.emitted("ready") ?? [],
    readyNames: () => (inner.emitted("plugin-ready") ?? []).map((args) => args[0]),
    errorEvents: () =>
      ((inner.emitted("plugin-error") ?? []) as unknown[][]).map(
        (args) => args[0] as { name: string; error: { cause?: unknown } },
      ),
  };
}

describe("插件失败不阻断地图，且失败不被回执成成功", () => {
  beforeEach(() => {
    harness.reset();
    // 默认宿主是模块级单例：不清掉的话，前一个用例加载成功的插件会被后一个用例复用，
    // 「这次失败了吗」就变成了「取决于用例顺序」（M8-PLUGIN-CORE / #42）。
    disposeDefaultPluginHost();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).BMapGLLib;
    disposeDefaultPluginHost();
  });

  it("真实失败（脚本注入 error）：ready 照发，回执 plugin-error 而不是 plugin-ready", async () => {
    failThirdPartyScripts();
    const mounted = mountMap(["TrackAnimation"]);
    await flushPromises();
    await flushPromises();

    expect(mounted.readyEvents().length, "插件失败不得阻断 map ready").toBeGreaterThan(0);
    expect(mounted.readyNames(), "真实失败不得回执 plugin-ready").toEqual([]);
    const errors = mounted.errorEvents();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.name).toBe("TrackAnimation");
    // 原始错误经 PluginRegistry.getError() 带出来，而不是另造一个没有 cause 的替代品
    const cause = errors[0]!.error.cause as Error | undefined;
    expect(cause, "cause 应当是插件加载的真实错误").toBeInstanceOf(Error);
    expect(String(cause!.message)).toMatch(/plugin/i);
    mounted.wrapper.unmount();
  });

  it("真实成功（脚本已加载过）：回执 plugin-ready，绝不报错", async () => {
    // 「导出已存在就直接 resolve」是 `loadScriptWithExport` 的不碰网络分支，
    // 等价于宿主页面上这个脚本早就加载好了。
    (window as any).BMapGLLib = { GeoUtils: { fake: true } };
    const mounted = mountMap(["GeoUtils"]);
    await flushPromises();

    expect(mounted.readyEvents().length).toBeGreaterThan(0);
    expect(mounted.readyNames(), "成功的插件必须回执 plugin-ready").toEqual(["GeoUtils"]);
    expect(mounted.errorEvents(), "成功不是失败").toEqual([]);
    mounted.wrapper.unmount();
  });

  it("两种样本的回执互不相同（证明上面两条不是同一件事的两种说法）", async () => {
    failThirdPartyScripts();
    const failing = mountMap(["TrackAnimation"]);
    await flushPromises();
    await flushPromises();
    (window as any).BMapGLLib = { GeoUtils: { fake: true } };
    const succeeding = mountMap(["GeoUtils"]);
    await flushPromises();

    expect(failing.readyNames()).toEqual([]);
    expect(failing.errorEvents().length).toBeGreaterThan(0);
    expect(succeeding.readyNames()).toEqual(["GeoUtils"]);
    expect(succeeding.errorEvents()).toEqual([]);

    failing.wrapper.unmount();
    succeeding.wrapper.unmount();
  });

  /**
   * #121：脚本服务器「建立连接但不响应」时的第三条隔离场景 —— **挂起**。
   *
   * 前两条覆盖的是「失败被隔离」；挂起此前不在隔离口径里
   * （#25 ADR 的已知限制：「插件加载没有超时」）。契约有三条，都由本用例钉住：
   *
   * 1. 「还没结算」既不是成功也不是失败：不回执 `plugin-ready`，也不该在超时窗口之前报错；
   * 2. 超时窗口走完之后**如实回执 `plugin-error`**，且原因可识别为超时（排查时唯一的抓手）；
   * 3. 同一个 `plugins` 列表里**后面的插件继续加载** —— `loadPluginsInBackground` 是顺序 `await`，
   *    没有超时的话它会永远停在第一个插件上（真实读数见 `scripts/probe-plugin-load-channel.mts`：
   *    挂起 25s 时后一个插件的 `attempts` 是 0）。
   */
  it("脚本永不结算（挂起）：超时后如实回执 plugin-error，且列表里后面的插件照常加载", async () => {
    vi.useFakeTimers();
    try {
      hangThirdPartyScripts();
      // 后一个插件走「导出已存在 ⇒ 直接 resolve」的短路分支，于是「它有没有被请求到」可观察
      (window as any).BMapGLLib = { GeoUtils: { fake: true } };
      const mounted = mountMap(["TrackAnimation", "GeoUtils"]);
      await flushPromises();
      await flushPromises();

      expect(mounted.readyEvents().length, "插件挂起不得阻断 map ready").toBeGreaterThan(0);
      expect(mounted.readyNames(), "还没结算就不该回执 plugin-ready").toEqual([]);
      expect(mounted.errorEvents(), "超时窗口没走完就不该报错").toEqual([]);

      await vi.advanceTimersByTimeAsync(BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS);
      await flushPromises();

      const errors = mounted.errorEvents();
      expect(errors.length, "超时必须如实回执 plugin-error，而不是停在 loading").toBe(1);
      expect(errors[0]!.name).toBe("TrackAnimation");
      const cause = errors[0]!.error.cause as Error | undefined;
      expect(cause, "cause 应当是插件加载的真实错误").toBeInstanceOf(Error);
      expect(String(cause!.message)).toMatch(/timed out/i);

      expect(mounted.readyNames(), "前一个插件超时之后，后面的插件仍然会被请求").toEqual(["GeoUtils"]);
      mounted.wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
