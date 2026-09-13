/**
 * 插件失败隔离的**组件级**契约（M3A3-07 / issue #25）
 *
 * `PluginRegistry` 那一层已有用例证明「optional 插件失败只发事件、不抛」。但组件还可能在两处把
 * 结论说反：
 *
 * 1. **把 map ready 挂在插件上** —— `BMap.vue` 的承诺是「ready 不等插件」（`loadPluginsInBackground`）；
 * 2. **把失败回执成成功** —— 对 optional 插件，注册表在失败时是以 `undefined` **resolve** 的
 *    （失败策略见 `PluginRegistry.loadPlugin`），所以 `await` 拿到返回值**不等于**成功。
 *    此处曾经据此发 `plugin-ready`：插件没加载起来，组件 API 上却报「加载成功」。
 *    内置插件一律改 optional（M3A3-07）之后，这个坑的暴露面从两个插件扩到四个，必须一起修。
 *
 * 本文件刻意**不用 `vi.mock`**：`BMap.vue` 里那句 `stringToPluginDefinitions(props.plugins)` 是
 * 相对 `.vue` 文件的导入，mock 的 specifier 要从测试文件解析到同一个模块 id，很容易看着生效、
 * 实则没拦住（第一版就是这么写错的）。改成走**真实代码路径**：
 *
 * - 加载成功：`loadScriptWithExport` 会先看全局导出在不在，在就直接 resolve（不碰网络）——
 *   预置 `window.mapvgl` 就能确定性地拿到「成功」这一半；
 * - 加载失败：用一个**未知插件名**（`stringToPluginDefinitions` 对它返回 optional 空实现，
 *   resolve `undefined`）——这正是上面第 2 条的触发形态。
 *
 * 两半都在同一个 `describe` 里，互为对照：如果组件干脆不看注册表状态、只按返回值回执，
 * 第一半仍会绿、第二半会红。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import { getFakeBMapGl, resetLifecycleState } from "../../packages/test-utils";

const fake = getFakeBMapGl();

function makeGlobalProvider() {
  return {
    load: async () => {
      (window as unknown as { BMapGL: unknown }).BMapGL = fake;
      return fake;
    },
  };
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.width = "300px";
  host.style.height = "300px";
  document.body.appendChild(host);
  return host;
}

function mountMap(plugins: string[]) {
  const wrapper = mount(
    defineComponent({
      render: () => h(BMap, { plugins, provider: makeGlobalProvider() } as never),
    }),
    { attachTo: createHost() },
  );
  const inner = wrapper.findComponent(BMap);
  return {
    wrapper,
    readyEvents: () => inner.emitted("ready") ?? [],
    readyNames: () => inner.emitted("plugin-ready") ?? [],
    // `emitted()` 返回的是「每次 emit 的参数数组」，所以每条事件取 args[0]
    errorEvents: () =>
      ((inner.emitted("plugin-error") ?? []) as unknown[][]).map(
        (args) => args[0] as { name: string; error: unknown },
      ),
  };
}

describe("插件失败不阻断地图，且失败不被回执成成功", () => {
  beforeEach(() => {
    resetLifecycleState();
    fake.stats.reset();
  });

  afterEach(() => {
    // 预置的全局导出要还原：否则会漏进别的用例，让「加载成功」变成假象
    delete (window as unknown as { mapvgl?: unknown }).mapvgl;
  });

  it("加载成功（全局导出已存在 ⇒ 不碰网络）：发 plugin-ready，不发 plugin-error", async () => {
    (window as unknown as { mapvgl: unknown }).mapvgl = { fake: true };
    const mounted = mountMap(["Mapvgl"]);
    await flushPromises();

    expect(mounted.readyEvents().length, "地图本身必须 ready").toBeGreaterThan(0);
    expect(mounted.readyNames().map((args) => args[0])).toEqual(["Mapvgl"]);
    expect(mounted.errorEvents()).toEqual([]);
    mounted.wrapper.unmount();
  });

  it("加载失败（未知插件 = optional 空实现）：ready 照发，回执 plugin-error 而不是 plugin-ready", async () => {
    const mounted = mountMap(["NoSuchPlugin"]);
    await flushPromises();

    // 隔离：插件失败不得阻断地图
    expect(mounted.readyEvents().length, "插件失败不得阻断 map ready").toBeGreaterThan(0);
    // 不许把失败报成成功：注册表对它 resolve 的是 `undefined`、status 也不是 ready
    expect(mounted.readyNames(), "optional 失败不得回执 plugin-ready").toEqual([]);
    const errors = mounted.errorEvents();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.name).toBe("NoSuchPlugin");
    mounted.wrapper.unmount();
  });

  it("两种插件的回执互不相同（证明上面两条不是同一件事的两种说法）", async () => {
    (window as unknown as { mapvgl: unknown }).mapvgl = { fake: true };
    const ok = mountMap(["Mapvgl"]);
    await flushPromises();
    const failed = mountMap(["NoSuchPlugin"]);
    await flushPromises();

    expect(ok.readyNames().length).toBe(1);
    expect(ok.errorEvents().length).toBe(0);
    expect(failed.readyNames().length).toBe(0);
    expect(failed.errorEvents().length).toBeGreaterThan(0);

    ok.wrapper.unmount();
    failed.wrapper.unmount();
  });
});
