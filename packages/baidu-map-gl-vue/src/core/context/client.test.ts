import { describe, it, expect, vi } from "vitest";
import { createClientContext } from "./client";
import type { BMapClient, BMapDriverFactory, CreateBMapClientOptions } from "../../client/types";
import type { BMapDriver } from "../../driver/types/bmap";
import { createLoadedJsapiV4 } from "../loader/providers";
import type { LoadedSdk } from "../loader/loaded";

/**
 * M3A3-REMOVE-LEGACY（#26）：`withMigrationDriver` 归一已删除，definition 直接交给
 * `createBMapClient`。本文件测的是 **Context 的生命周期**（loading/ready/error/retry/dispose），
 * 与具体 Driver 实现无关，因此这里注入一个 stub Driver 工厂，避免每条用例都要造一个完整
 * 的 v4 命名空间——加载结果仍必须是**完整**的结构化结果（`assertLoadedSdk` 是运行时边界，
 * 少 `version` / `load` 会被拒；用公开构造成型而不是手写字面量）。
 */
const stubDriver: BMapDriverFactory = () => ({ engine: "jsapi-v4" }) as unknown as BMapDriver;

function loaded(): LoadedSdk {
  return createLoadedJsapiV4({
    providerId: "existing-global-v4",
    mode: "existing-global",
    version: "4.0",
    versionSource: "global",
    options: {},
    fingerprint: "bmap-client-context-test",
    namespace: {},
  });
}

function definition(load: CreateBMapClientOptions["provider"]["load"]): CreateBMapClientOptions {
  return { provider: { load }, loadOptions: {}, driver: stubDriver };
}

function fakeClient(): BMapClient {
  return {
    id: Symbol("c"),
    engine: "jsapi-v4",
    libraryVersion: "test",
    sdkVersion: "test",
    version: "test",
    driver: {} as never,
    capabilities: {} as never,
    rawSdk: {},
  };
}

describe("BMapClientContext", () => {
  it("starts idle and transitions loading -> ready", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: definition(async () => {
        calls++;
        return loaded();
      }),
    });
    expect(ctx.status.value).toBe("idle");
    const p = ctx.load();
    expect(ctx.status.value).toBe("loading");
    const client = await p;
    expect(ctx.status.value).toBe("ready");
    expect(ctx.client.value).toEqual(client);
    expect(calls).toBe(1);
  });

  it("dedups concurrent load", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: definition(async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return loaded();
      }),
    });
    const [a, b] = await Promise.all([ctx.load(), ctx.load()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("records error and recovers via retry", async () => {
    let fail = true;
    const ctx = createClientContext({
      definition: definition(async () => {
        if (fail) throw new Error("sdk down");
        return loaded();
      }),
    });
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(ctx.status.value).toBe("error");
    expect(ctx.error.value).toBeTruthy();
    fail = false;
    const client = await ctx.retry();
    expect(ctx.status.value).toBe("ready");
    expect(client).toBeTruthy();
  });

  it("resolves immediately when constructed with a client", async () => {
    const c = fakeClient();
    const ctx = createClientContext({ client: c });
    expect(ctx.status.value).toBe("ready");
    await expect(ctx.load()).resolves.toBe(c);
  });

  it("throws a clear error without definition", async () => {
    const ctx = createClientContext({});
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_PARENT_CONTEXT_MISSING" });
  });

  it("dispose clears and rejects further loads", async () => {
    const ctx = createClientContext({ definition: definition(async () => loaded()) });
    await ctx.load();
    ctx.dispose();
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.client.value).toBeNull();
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });

  it("aborted signal rejects without error status", async () => {
    const controller = new AbortController();
    const ctx = createClientContext({
      definition: definition(async (_o, signal) => {
        await new Promise((_, rej) =>
          signal?.addEventListener("abort", () => rej(new Error("aborted"))),
        );
        return loaded();
      }),
    });
    const p = ctx.load(controller.signal);
    controller.abort(new Error("cancel"));
    await expect(p).rejects.toThrow();
    vi.useRealTimers();
  });
});
