/**
 * 插件 Catalog 与作用域的**组件级**契约（M8-PLUGIN-CORE / issue #42）
 *
 * 这一层要钉的是 issue 里几条只有走到 `<BMap>` 才能观察的验收点：
 *
 * 1. **unknown 名字明确失败，但不阻断地图**（issue 实施步骤 2 + 非目标「不让所有插件故障都被忽略」）。
 *    此前未知名字会被降级成一个永远成功的空实现 ⇒ `plugin-ready` 照发、`getStatus()` 是 `ready`。
 *    现在要发 `plugin-error`（`BMAP_PLUGIN_UNKNOWN`），地图照常 ready，同一 `plugins` 列表里的
 *    其它插件照常加载。判据刻意用**同一个列表里既有错名字又有好名字**来构造：只测「全是错名字」
 *    或「全是好名字」都分不清「整体失败」与「逐项失败」。
 * 2. **global 插件跨地图共享同一次加载**（issue 实施步骤 3）：同页面两张 `<BMap>`，脚本只注入一次。
 * 3. **地图卸载不释放 global 资源**（issue 实施步骤 4 + AGENTS.md「不得删除/改写上游注入的
 *    script」）：卸载其中一张后，共享条目仍是 ready，另一张地图不被牵连。
 *
 * 两个样本都不碰网络：
 * - **成功**：预置 `window.BMapGLLib.TrackAnimation` —— `loadScriptWithExport` 的
 *   「导出已存在就直接 resolve」分支，正是真实场景里「宿主已经加载过这个脚本」的那条路；
 * - **失败**：把非百度脚本的 `<script>` 打成派发 `error`（与 `v3-plugin-failure-isolation.test.ts`
 *   同一手法），用来观察「第二张地图是**加入**了同一次在飞加载，还是又发起了一次」。
 *
 * 刻意不用 `vi.mock`：mock 拦不住 `.vue` 里的相对导入，会让用例测到真实名字表却以为测到了替身。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import { createFakeV4Harness } from "../../packages/test-utils";
import {
  disposeDefaultPluginHost,
  getDefaultPluginHost,
} from "../../packages/baidu-map-gl-vue/src/core/plugins/PluginHost";

const { harness } = createFakeV4Harness();

/**
 * 必须在**任何 spy 安装之前**取一次原始实现。
 *
 * `vi.spyOn` 对同一个 (对象, 方法) 返回同一个 spy，用例里再取会拿到「已被替换的那份」⇒
 * `mockImplementation` 里再调它就是自递归（`Maximum call stack size exceeded`）。
 */
const realCreateElement = document.createElement.bind(document);

/** 让插件脚本「已经加载过」：`loadScriptWithExport` 走不碰网络的短路分支。 */
function presetPluginGlobal(name: "TrackAnimation" | "DrawingManager" | "GeoUtils"): void {
  (window as any).BMapGLLib = { ...((window as any).BMapGLLib ?? {}), [name]: { fake: true } };
}

/**
 * 让**非百度**脚本的 `<script>` 注入确定性失败（派发 `error`），并记录被注入的 URL。
 *
 * 返回的数组就是「真的插了几份脚本」这个读数——共享失效时它会变成 2。
 */
function failThirdPartyScripts(): string[] {
  const created: string[] = [];
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: unknown) => {
    const element = realCreateElement(tag as never, options as never) as HTMLElement;
    if (tag === "script") {
      setTimeout(() => {
        const script = element as HTMLScriptElement;
        if (script.src && !script.src.includes("api.map.baidu.com")) {
          created.push(script.src);
          script.dispatchEvent(new Event("error"));
        }
      }, 0);
    }
    return element;
  }) as never);
  return created;
}

interface Mounted {
  wrapper: ReturnType<typeof mount>;
  readyCount: () => number;
  readyNames: () => string[];
  errors: () => { name: string; error: { code?: string; plugin?: string; cause?: unknown } }[];
}

function mountMap(plugins: string[]): Mounted {
  const wrapper = mount(
    defineComponent({
      render: () => h(BMap, { plugins, provider: harness.provider() } as never),
    }),
    { attachTo: harness.container() },
  );
  const inner = wrapper.findComponent(BMap);
  return {
    wrapper,
    readyCount: () => (inner.emitted("ready") ?? []).length,
    readyNames: () => (inner.emitted("plugin-ready") ?? []).map((args) => String(args[0])),
    errors: () =>
      ((inner.emitted("plugin-error") ?? []) as unknown[][]).map(
        (args) => args[0] as ReturnType<Mounted["errors"]>[number],
      ),
  };
}

describe("插件名字解析：unknown 明确失败但不阻断地图", () => {
  beforeEach(() => {
    harness.reset();
    disposeDefaultPluginHost();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).BMapGLLib;
    disposeDefaultPluginHost();
  });

  it("同一列表里混着错名字与好名字：错的发 plugin-error，好的照常 ready", async () => {
    presetPluginGlobal("TrackAnimation");
    const mounted = mountMap(["TrackAnimatino", "TrackAnimation"]);
    await flushPromises();

    expect(mounted.readyCount(), "未知插件名不得阻断地图 ready").toBeGreaterThan(0);

    const errors = mounted.errors();
    expect(errors, "错名字必须明确失败，不能静默成功").toHaveLength(1);
    expect(errors[0]!.name).toBe("TrackAnimatino");
    expect(errors[0]!.error.code).toBe("BMAP_PLUGIN_UNKNOWN");
    expect(errors[0]!.error.plugin).toBe("TrackAnimatino");

    // 同一列表里的好名字不受连累
    expect(mounted.readyNames()).toEqual(["TrackAnimation"]);
    mounted.wrapper.unmount();
  });

  it("反证：把同样的列表换成全对的名字，不该有任何 plugin-error", async () => {
    // 没有这一半，上面那条「恰好一条错」可能只是因为错误计数根本不工作
    presetPluginGlobal("TrackAnimation");
    const mounted = mountMap(["TrackAnimation"]);
    await flushPromises();

    expect(mounted.readyNames()).toEqual(["TrackAnimation"]);
    expect(mounted.errors()).toEqual([]);
    mounted.wrapper.unmount();
  });

  it("重复写同一个名字只回执一次（注册表会拒绝重复注册，组件层不该把它变成错误）", async () => {
    presetPluginGlobal("TrackAnimation");
    const mounted = mountMap(["TrackAnimation", "TrackAnimation"]);
    await flushPromises();

    expect(mounted.readyNames()).toEqual(["TrackAnimation"]);
    expect(mounted.errors()).toEqual([]);
    mounted.wrapper.unmount();
  });
});

describe("global 插件的作用域：跨地图共享、地图卸载不释放", () => {
  beforeEach(() => {
    harness.reset();
    disposeDefaultPluginHost();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).BMapGLLib;
    disposeDefaultPluginHost();
  });

  it("两张地图同时在飞：只注入**一份**脚本（第二张加入同一次加载，而不是又发起一次）", async () => {
    const created = failThirdPartyScripts();
    const first = mountMap(["TrackAnimation"]);
    const second = mountMap(["TrackAnimation"]);

    await flushPromises();
    await flushPromises();

    expect(created, "global 插件是文档级资源，同页面只能加载一份").toHaveLength(1);
    // 一次失败的加载要如实广播给两个消费者，而不是让其中一个静默成功
    expect(first.errors().map((e) => e.name)).toEqual(["TrackAnimation"]);
    expect(second.errors().map((e) => e.name)).toEqual(["TrackAnimation"]);

    first.wrapper.unmount();
    second.wrapper.unmount();
  });

  it("加载成功后两次挂载只发生一次加载；卸载一张地图不释放共享资源", async () => {
    presetPluginGlobal("TrackAnimation");
    const first = mountMap(["TrackAnimation"]);
    await flushPromises();
    const second = mountMap(["TrackAnimation"]);
    await flushPromises();

    expect(first.readyNames()).toEqual(["TrackAnimation"]);
    expect(second.readyNames()).toEqual(["TrackAnimation"]);
    expect(getDefaultPluginHost().inspect("TrackAnimation")?.attempts).toBe(1);

    first.wrapper.unmount();
    await flushPromises();

    expect(
      getDefaultPluginHost().inspect("TrackAnimation")?.status,
      "地图卸载无权释放文档级资源（上游没有卸载入口，删 script / 抹全局会波及别的代码）",
    ).toBe("ready");
    // 第二张地图仍在用，卸载第一张不该把它牵连进去
    expect(second.readyNames()).toEqual(["TrackAnimation"]);
    second.wrapper.unmount();
  });
});
