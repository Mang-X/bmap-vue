/**
 * Playground 档位模式的行为契约（M3A3-04 / issue #25；M3A3-REMOVE-LEGACY / issue #26 收敛为两档）
 *
 * 这一档的价值全在「离线档到底走不走真路径」。`legacy-fake` 对照档随旧引擎删除，
 * 因此现在的断言变成两条：
 *
 * 1. `fake-v4` 档装出来的 Provider 走的是**生产同一条路径**（`existingGlobalV4Provider()`
 *    复用装上去的 Fake v4 全局），而不是「宽松 Provider 被归一」那条已经不存在的路；
 * 2. 真实 v4 档不注入任何假全局，用的确实是默认 Provider 家族。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  bootPlayground,
  resolvePlaygroundMode,
  type PlaygroundEnvLike,
} from "../../packages/test-utils/playground-modes";
import { createBMapClient } from "../../packages/bmap-vue/src/client/createBMapClient";
import { isJsapiV4Namespace } from "../../packages/bmap-vue/src/core/loader/providers/namespace";
import type { CreateBMapClientOptions } from "../../packages/bmap-vue/src/client/types";
import { createFakeV4Provider } from "../../packages/test-utils";

const boots: { restore(): void }[] = [];
afterEach(() => {
  while (boots.length > 0) boots.pop()!.restore();
});

/** 从插件返回的默认 definition 装出一个 Client，读它真实的 engine。 */
async function engineOf(plugin: ReturnType<typeof bootPlayground>["plugin"]): Promise<string> {
  const definition: CreateBMapClientOptions = {
    provider: plugin.config.provider,
    loadOptions: plugin.config.defaults,
  };
  const client = await createBMapClient(definition);
  return client.engine;
}

describe("档位解析", () => {
  it("两档各自的触发条件互不相同", () => {
    expect(resolvePlaygroundMode({ VITE_BMAP_AK: "real-ak" })).toBe("real-v4");
    expect(resolvePlaygroundMode({})).toBe("fake-v4");
  });

  it("空白值不算 AK；已被删除的 legacy-fake 档不再被识别（回落默认档）", () => {
    expect(resolvePlaygroundMode({ VITE_BMAP_AK: "   " })).toBe("fake-v4");
    // `VITE_BMAP_MODE` 曾用于切到 `legacy-fake` 对照档；旧引擎删除后该开关不再被读取
    expect(resolvePlaygroundMode({ VITE_BMAP_MODE: "legacy-fake" } as PlaygroundEnvLike)).toBe(
      "fake-v4",
    );
    expect(resolvePlaygroundMode({ VITE_BMAP_MODE: "unknown-mode" } as PlaygroundEnvLike)).toBe(
      "fake-v4",
    );
  });
});

describe("离线档走真实路径（本档的核心断言）", () => {
  it("fake-v4 档装出的 Client 是 jsapi-v4，且 Provider 不是默认家族那一份", async () => {
    const boot = bootPlayground({});
    boots.push(boot);

    expect(boot.mode).toBe("fake-v4");
    // 显式注入的 fake provider 与默认家族的那一份不是同一个对象（否则下面测的可能是默认路径）
    expect((boot.plugin.config.provider as { id?: string }).id).toBe("existing-global-v4");
    expect(await engineOf(boot.plugin)).toBe("jsapi-v4");
  });

  it("fake-v4 档把 Fake 命名空间按真实形状挂上（Map 就绪、BMapGL 是同一对象的别名）", () => {
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
  it("restore() 把注入前的全局还原（含原本不存在的情况）", () => {
    const scope = globalThis as unknown as { BMap?: unknown; BMapGL?: unknown };
    // M3A3-REMOVE-LEGACY（#26）：测试环境不再预置任何假 SDK 全局，因此「原本不存在」
    // 是常态；这条断言同时防止有人把全局假 SDK 又塞回 `tests/setup.ts`。
    expect(scope.BMap, "测试环境不应预置 Map").toBeUndefined();
    expect(scope.BMapGL, "测试环境不应预置 BMapGL").toBeUndefined();

    const handle = createFakeV4Provider();
    expect(scope.BMap).toBe(handle.fake.namespace);
    expect(scope.BMapGL).toBe(handle.fake.namespace);

    handle.restore();
    expect(scope.BMap).toBeUndefined();
    expect(scope.BMapGL).toBeUndefined();
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
