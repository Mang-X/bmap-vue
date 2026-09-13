/**
 * Playground 三档模式的行为契约（M3A3-04 / issue #25）
 *
 * 这一档的价值全在「离线档到底走不走 v4 Driver」。原实现（无 AK 档 = Fake BMapGL + 宽松 Provider）
 * 让 playground 在离线时**永远踩不到 v4 Driver**，于是一个只在新 Driver 上出现的缺陷本地全绿。
 * 因此这里的断言必须能区分「两档真的走了不同 engine」，而不是只断言「没抛错」。
 */
import { afterEach, describe, expect, it } from "vitest";
import { bootPlayground, resolvePlaygroundMode } from "../../packages/test-utils/playground-modes";
import { createBMapClient } from "../../packages/baidu-map-gl-vue/src/client/createBMapClient";
import { withMigrationDriver } from "../../packages/baidu-map-gl-vue/src/client/migration";
import { isJsapiV4Namespace } from "../../packages/baidu-map-gl-vue/src/core/loader/providers/namespace";
import { createFakeV4Provider } from "../../packages/test-utils";

const boots: { restore(): void }[] = [];
afterEach(() => {
  while (boots.length > 0) boots.pop()!.restore();
});

/** 从插件返回的默认 definition 装出一个 Client，读它真实的 engine。 */
async function engineOf(plugin: ReturnType<typeof bootPlayground>["plugin"]): Promise<string> {
  const definition = withMigrationDriver({
    provider: plugin.config.provider,
    loadOptions: plugin.config.defaults,
  });
  const client = await createBMapClient(definition);
  return client.engine;
}

describe("档位解析", () => {
  it("三档各自的触发条件互不相同", () => {
    expect(resolvePlaygroundMode({ VITE_BMAP_AK: "real-ak" })).toBe("real-v4");
    expect(resolvePlaygroundMode({})).toBe("fake-v4");
    expect(resolvePlaygroundMode({ VITE_BMAP_MODE: "legacy-fake" })).toBe("legacy-fake");
  });

  it("AK 优先于模式开关，空白值不算 AK，未知模式退回默认档", () => {
    expect(resolvePlaygroundMode({ VITE_BMAP_AK: "a", VITE_BMAP_MODE: "legacy-fake" })).toBe(
      "real-v4",
    );
    expect(resolvePlaygroundMode({ VITE_BMAP_AK: "   " })).toBe("fake-v4");
    expect(resolvePlaygroundMode({ VITE_BMAP_MODE: "unknown-mode" })).toBe("fake-v4");
  });
});

describe("离线两档走不同的 engine（本档的核心断言）", () => {
  it("fake-v4 走 jsapi-v4，legacy-fake 走 webgl-v1 —— 同一份场景、两个 Driver", async () => {
    const fakeV4 = bootPlayground({});
    boots.push(fakeV4);
    const legacy = bootPlayground({ VITE_BMAP_MODE: "legacy-fake" });
    boots.push(legacy);

    expect(fakeV4.mode).toBe("fake-v4");
    expect(legacy.mode).toBe("legacy-fake");

    // 先证明两次 boot 的 provider 真的不同（否则下面的 engine 断言可能是在比同一个东西）
    expect(fakeV4.plugin.config.provider).not.toBe(legacy.plugin.config.provider);

    expect(await engineOf(fakeV4.plugin)).toBe("jsapi-v4");
    expect(await engineOf(legacy.plugin)).toBe("webgl-v1");
  });

  it("fake-v4 档把 Fake 命名空间按真实形状挂上（BMap 就绪、BMapGL 是同一对象的别名）", () => {
    const boot = bootPlayground({});
    boots.push(boot);

    const scope = globalThis as unknown as { BMap?: unknown; BMapGL?: unknown };
    expect(isJsapiV4Namespace(scope.BMap), "fake-v4 档必须让 v4 命名空间就绪").toBe(true);
    // 真实 4.0 入口把 BMapGL 作为别名挂上；UI Kit 也从它取配置，所以两处必须是同一个对象
    expect(scope.BMapGL).toBe(scope.BMap);
  });

  it("真实 v4 档不注入任何假全局，且用的是默认 Provider 家族", () => {
    const boot = bootPlayground({ VITE_BMAP_AK: "real-ak" });
    boots.push(boot);

    expect(boot.mode).toBe("real-v4");
    expect((boot.plugin.config.provider as { id?: string }).id).toBe("baidu-jsapi-v4");
    const scope = globalThis as unknown as { BMap?: unknown };
    expect(scope.BMap, "真实档不该注入假命名空间").toBeUndefined();
  });
});

describe("Fake v4 Provider 的注入与还原", () => {
  it("restore() 把注入前的全局还原（含原本就存在的那一份）", () => {
    const scope = globalThis as unknown as { BMap?: unknown; BMapGL?: unknown };
    const preexisting = scope.BMapGL;
    expect(preexisting, "测试 setup 里已注入 legacy Fake，本用例依赖它作为「原本存在」的样本").toBeDefined();

    const handle = createFakeV4Provider();
    expect(scope.BMap).toBe(handle.fake.namespace);
    expect(scope.BMapGL).toBe(handle.fake.namespace);

    handle.restore();
    expect(scope.BMap).toBeUndefined();
    expect(scope.BMapGL).toBe(preexisting);
  });

  it("每次构造的指纹不同（否则第二个 Fake 会拿到第一个的缓存命名空间）", () => {
    const a = createFakeV4Provider();
    const b = createFakeV4Provider();
    expect(a.loadOptions.ak).not.toBe(b.loadOptions.ak);
    expect(a.fake.namespace).not.toBe(b.fake.namespace);
    a.restore();
    b.restore();
  });

  it("走 existingGlobalV4Provider：provider id 与真实路径一致", () => {
    const handle = createFakeV4Provider();
    expect((handle.provider as { id?: string }).id).toBe("existing-global-v4");
    handle.restore();
  });
});
