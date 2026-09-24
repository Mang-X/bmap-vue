/**
 * `nativeLayersOf` 的收窄契约（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 这个助手存在的理由只有一条：**「当前引擎有没有这个面」不能是一句无条件的 `as`**。
 * 因此两条用例分别钉住两侧：
 *
 * - 正例：真实的 v4 Client（Fake 装的默认路径）能拿到面；
 * - 反例：Driver 没有该面时**显式失败**（`BMAP_CAPABILITY_UNSUPPORTED` + 点名 engine），
 *   而不是交出一个 undefined 让调用方在更远的地方崩。
 */
import { describe, expect, it } from "vitest";
import { createFakeV4Client } from "../../../../test-utils";
import { BMapError } from "../errors/BMapError";
import { createLayerRegistry } from "./LayerRegistry";
import { nativeLayersOf } from "./nativeLayerAccess";
import type { BMapClient } from "../../client/types";

describe("nativeLayersOf", () => {
  it("v4 Client 上能拿到原生数据图层面（create / add / setData 都在）", async () => {
    const { client } = await createFakeV4Client();
    const nativeLayers = nativeLayersOf(client);
    expect(typeof nativeLayers.create).toBe("function");
    expect(typeof nativeLayers.setData).toBe("function");
    // 与图层账本可以共存：原生图层句柄能登记进同一份账本（两个 Facet 的 kind 并集）
    const registry = createLayerRegistry();
    const handle = nativeLayers.create("point-shape", { idKey: "id" });
    const record = registry.register({ kind: "point-shape", handle, scope: createScope(), remove: () => {} });
    expect(registry.kinds()).toEqual(["point-shape"]);
    record.dispose();
    expect(registry.size).toBe(0);
  });

  it("Driver 没有该面时显式失败，并点名 engine", () => {
    const bare = { engine: "jsapi-v4", driver: {} } as unknown as BMapClient;
    let caught: unknown;
    try {
      nativeLayersOf(bare);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BMapError);
    expect((caught as BMapError).code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    expect((caught as BMapError).message).toContain("jsapi-v4");
    expect((caught as BMapError).message).toContain("原生数据图层面");
  });
});

/** 账本的最小 scope（本用例只验证「登记 / 销账」，不需要真实资源）。 */
function createScope() {
  return { dispose: () => {}, add: () => {}, isDisposed: false } as never;
}
