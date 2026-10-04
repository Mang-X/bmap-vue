/**
 * JSAPI 4.0 Providers（M3A1-PROVIDERS / issue #17；默认在线路径见 R25-B / issue #71）
 *
 * 三个 Provider 共用一份测试主体，便于把「同一冲突域」的跨 Provider 行为写在一起断言：
 * 相同配置复用同一任务、不同 AK / 版本产生结构化冲突。
 *
 * R25-B 之后，`BaiduJsapiV4Provider` **不再自己加载 script**——它委托官方
 * `@baidumap/jsapi-loader`。因此这一份里它的用例一律注入**官方 load 的替身**
 * （`OfficialJsapiLoader`），只断言本库该负责的四件事：配置映射 / 冲突 / 按消费者取消 /
 * LoadedJsapiV4 归一化。真实的官方 loader（DOM、script 注入、单例、JSONP 回调）由
 * `tests/behavior/official-loader-default.test.ts` 用真实模块驱动。
 *
 * `CustomScriptV4Provider` 仍走自研 `ScriptLoader` + happy-dom（手工触发就绪信号），
 * 因此这里的 script 追踪辅助函数继续服务它。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ScriptLoader } from "../ScriptLoader";
import { resetGlobalCallbackRegistryForTests } from "../SharedLoadTask";
import type {
  ScriptJsonpModeOptions,
  ScriptLoadModeOptions,
  ScriptLoaderOptions,
} from "../SharedLoadTask";
import { SdkRegistry, resetProcessSdkRegistryForTests } from "../SdkRegistry";
import { DEFAULT_API_URL } from "../url";
import { BMapError } from "../../errors/BMapError";
import { BaiduJsapiV4Provider, baiduJsapiV4Provider } from "./BaiduJsapiV4Provider";
import { existingGlobalV4Provider } from "./ExistingGlobalV4Provider";
import { CustomScriptV4Provider, customScriptV4Provider } from "./CustomScriptV4Provider";
import { loadJsapiV4Script } from "./load";
import { isRejectedJsapiV4Global, resetRejectedJsapiV4GlobalsForTests } from "./namespace";
import {
  OFFICIAL_LOADER_UNSUPPORTED_KEYS,
  type OfficialJsapiLoadOptions,
  type OfficialJsapiLoader,
  type OfficialLoaderUnsupportedKey,
} from "./official";

const COMPLETE_NAMESPACE = { Map: () => {}, Point: () => {}, Marker: () => {} };
const AK = "ak-abcdef123456";
/** 非 api.map.baidu.com 入口：测试里不会自动触发回调，便于手工控制就绪时机。 */
const REMOTE_SRC = "https://sdk.example.com/api";

/** 清单里每个「上游没有入口」的配置各给一个代表性取值（穷尽性由类型保证）。 */
const UNSUPPORTED_SAMPLE: Record<OfficialLoaderUnsupportedKey, string> = {
  nonce: "n-1",
  integrity: "sha384-x",
  crossOrigin: "anonymous",
  referrerPolicy: "no-referrer",
  apiUrl: REMOTE_SRC,
  callbackParam: "cb",
  language: "zh-CN",
};

function installGlobal(value: unknown): void {
  (globalThis as { BMap?: unknown }).BMap = value;
}

function readGlobal(): unknown {
  return (globalThis as { BMap?: unknown }).BMap;
}

/**
 * 官方 `load` 的替身：只记录参数、返回调用方给的值。
 *
 * 刻意**不**模仿官方的单例 / 冲突判定——那是官方自己的契约，重复实现一份只会让测试
 * 锁死在想象的实现上（官方行为由真实模块的集成用例覆盖）。
 */
function createOfficialLoaderStub(respond?: () => unknown) {
  const load = vi.fn(async (options: OfficialJsapiLoadOptions) => {
    void options;
    return respond ? respond() : COMPLETE_NAMESPACE;
  });
  return { load, loader: { load } as OfficialJsapiLoader };
}

/**
 * 把 `document.body` 换成脱离文档的容器，并记录插入的 `<script>`。
 * 浏览器/happy-dom 会真的去加载 script，这里只需要观察与手动触发就绪信号。
 */
function trackScripts(): HTMLScriptElement[] {
  const created: HTMLScriptElement[] = [];
  Object.defineProperty(document, "body", {
    value: document.createElement("div"),
    configurable: true,
  });
  const realAppend = Node.prototype.appendChild;
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
    if (node instanceof HTMLScriptElement) created.push(node);
    return realAppend.call(this, node as never) as never;
  });
  return created;
}

function jsonpCallbackNameOf(script: HTMLScriptElement): string {
  const name = new URL(script.src).searchParams.get("callback");
  if (!name) throw new Error("expected a JSONP callback parameter on the script URL");
  return name;
}

function invokeGlobalCallback(name: string): void {
  (window as unknown as Record<string, () => void>)[name]();
}

function globalCallback(name: string): unknown {
  return (window as Record<string, unknown>)[name];
}

/**
 * 假 `ScriptLoader`：去掉 DOM 时序，`onReady` 模拟「脚本就绪后全局可用」。
 * 只服务仍走自研 transport 的 CustomScript。
 */
function createFakeLoader(onReady?: () => void) {
  const load = vi.fn(async (options: ScriptLoaderOptions) => {
    void options;
    onReady?.();
  });
  // `clear` 属于 ScriptLoader 的公开面（Provider 在失败时用它失效过期缓存）。
  const clear = vi.fn();
  return { load, clear, loader: { load, clear } as unknown as ScriptLoader };
}

function newDomain(): SdkRegistry {
  return new SdkRegistry({ domain: "BMap" });
}

afterEach(() => {
  delete (globalThis as { BMap?: unknown }).BMap;
  delete (document as unknown as Record<string, unknown>).body;
  resetGlobalCallbackRegistryForTests();
  // 残留标记是 realm 级 WeakSet：用例之间清空，避免互相影响。
  resetRejectedJsapiV4GlobalsForTests();
});

describe("BaiduJsapiV4Provider（默认在线路径，委托官方 Loader）", () => {
  it("把配置映射给官方 load，并按加载结果组装 LoadedJsapiV4（metadata 已脱敏）", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    const loaded = await provider.load({ ak: AK, timeout: 1234 });

    // 官方收到的是映射后的选项：version 收敛到 4.0、timeout 原样。
    expect(official.load).toHaveBeenCalledTimes(1);
    expect(official.load.mock.calls[0]![0]).toEqual({ ak: AK, version: "4.0", timeout: 1234 });

    expect(loaded.engine).toBe("jsapi-v4");
    expect(loaded.version).toBe("4.0");
    expect(loaded.namespace).toBe(COMPLETE_NAMESPACE);
    expect(loaded.load).toMatchObject({
      providerId: "baidu-jsapi-v4",
      domain: "BMap",
      mode: "jsonp",
      versionSource: "url",
      akRef: "***3456",
    });
    expect(loaded.load.apiUrl).toContain("v=4.0");
    expect(loaded.load.apiUrl).not.toContain(AK);
  });

  it("页面已有 v4 全局时仍交给官方判定复用，metadata 标 existing-global + 全局自述版本", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0" });
    const official = createOfficialLoaderStub(() => readGlobal());
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    const loaded = await provider.load({ ak: AK });

    // 「有没有全局、要不要插 script」是官方 Loader 的判定，本库不另建一套状态机。
    expect(official.load).toHaveBeenCalledTimes(1);
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.versionSource).toBe("global");
    expect(loaded.version).toBe("4.0");
  });

  it("宿主已加载的**真实形状** 4.0 全局（无 VERSION、version === 'gl'）不会被误判失败", async () => {
    // 真实 4.0 的 `BMap.version` 是构建标记 `gl`（#70 实测）。把它当版本号会让
    // 「宿主已加载 / 同页复用」这条路径整条失败。
    const host = { ...COMPLETE_NAMESPACE, version: "gl" };
    installGlobal(host);
    const official = createOfficialLoaderStub(() => readGlobal());
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    const loaded = await provider.load({ ak: AK });

    expect(official.load).toHaveBeenCalledTimes(1);
    expect(loaded.namespace).toBe(host);
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.versionSource).toBe("declared");
  });

  it("配置不可表达时在进入冲突域之前失败，不被别处的在飞任务改写错误码", async () => {
    let deliver!: (value: unknown) => void;
    const load = vi.fn(() => new Promise<unknown>((resolve) => (deliver = resolve)));
    const provider = baiduJsapiV4Provider({
      loader: { load } as OfficialJsapiLoader,
      registry: newDomain(),
    });

    const inflight = provider.load({ ak: AK });
    await Promise.resolve();

    // 这份配置与在飞任务不同（含 apiUrl），若先进入域就会得到 CONFIG_CONFLICT——
    // 而它真正的问题是「官方路径表达不了这个配置」。
    const error = (await provider
      .load({ ak: "ak-other-123456", apiUrl: REMOTE_SRC } as never)
      .catch((e: unknown) => e)) as BMapError;
    expect(error.code).toBe("BMAP_INVALID_ARGUMENT");

    deliver(COMPLETE_NAMESPACE);
    await expect(inflight).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("官方超时 / 失败收敛成结构化错误，且错误信息不含 AK", async () => {
    const timeout = createOfficialLoaderStub();
    timeout.load.mockRejectedValueOnce(
      new Error(`[bmap-loader] JSAPI 加载超时(5ms) https://api.map.baidu.com/api?v=4.0&ak=${AK}`),
    );
    const provider = baiduJsapiV4Provider({ loader: timeout.loader, registry: newDomain() });

    const error = (await provider.load({ ak: AK }).catch((e: unknown) => e)) as BMapError;
    expect(error).toBeInstanceOf(BMapError);
    expect(error.code).toBe("BMAP_SDK_LOAD_TIMEOUT");
    expect(error.message).not.toContain(AK);

    const failed = createOfficialLoaderStub();
    failed.load.mockRejectedValueOnce(new Error("[bmap-loader] JSAPI 脚本加载失败"));
    const second = (await baiduJsapiV4Provider({
      loader: failed.loader,
      registry: newDomain(),
    })
      .load({ ak: AK })
      .catch((e: unknown) => e)) as BMapError;
    expect(second.code).toBe("BMAP_SDK_LOAD_FAILED");
  });

  it("上游没有入口的配置在加载前就失败，官方 load 不曾被调用", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    // 逐项按清单构造（`Record` 类型保证不漏项）：清单是单一事实源，新增一项就必须在这里给样值。
    for (const key of OFFICIAL_LOADER_UNSUPPORTED_KEYS) {
      const error = (await provider
        .load({ ak: AK, [key]: UNSUPPORTED_SAMPLE[key] } as never)
        .catch((e: unknown) => e)) as BMapError;
      expect(error.code, `${key} 必须显式报错`).toBe("BMAP_INVALID_ARGUMENT");
    }
    expect(official.load).not.toHaveBeenCalled();
  });

  it("拒绝非 4.x 与非 '4.0' 的显式版本，官方 load 未被调用", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK, version: "1.0" })).rejects.toThrow(/not JSAPI 4\.0/);
    await expect(provider.load({ ak: AK, version: "4.1" })).rejects.toThrow(/只支持.*4\.0/);
    expect(official.load).not.toHaveBeenCalled();
  });

  it("官方 resolve 了但命名空间不可用：失败、登记残留，且不删除任何全局对象", async () => {
    const partial = { Map: () => {}, Point: () => {} };
    // 残缺全局是**本次加载期间**出现的（真实场景里由官方注入的 script 产生），
    // 而不是加载前就存在——只有前者才该被登记为本库残留。
    const official = createOfficialLoaderStub(() => {
      installGlobal(partial);
      return partial;
    });
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK })).rejects.toThrow(/Marker/);
    // 宿主 / 本次加载留下的对象都没有被本库删除。
    expect(readGlobal()).toBe(partial);
    // 登记为「本库本次加载的残缺残留」：否则同一份对象会被后续复用路径当成宿主全局，
    // 永久挡住重试（见 reuse.ts）。
    expect(isRejectedJsapiV4Global(partial)).toBe(true);
  });

  it("官方 resolve 出空值而全局可用时视为成功（结算值不是唯一判据）", async () => {
    installGlobal(COMPLETE_NAMESPACE);
    const official = createOfficialLoaderStub(() => undefined);
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK })).resolves.toMatchObject({
      namespace: COMPLETE_NAMESPACE,
    });
  });

  it("官方加载失败后允许重试，且不残留失败条目", async () => {
    const domain = newDomain();
    const official = createOfficialLoaderStub();
    official.load.mockRejectedValueOnce(new BMapError("BMAP_SDK_LOAD_FAILED", "boom"));
    const provider = new BaiduJsapiV4Provider({ loader: official.loader, registry: domain });

    await expect(provider.load({ ak: AK })).rejects.toThrow("boom");
    expect(domain.size).toBe(0);
    expect(domain.activeFingerprint).toBeUndefined();

    const loaded = await provider.load({ ak: AK });
    expect(loaded.namespace).toBe(COMPLETE_NAMESPACE);
    expect(official.load).toHaveBeenCalledTimes(2);
  });

  it("不同 AK 产生结构化配置冲突，不重复加载", async () => {
    const domain = newDomain();
    const official = createOfficialLoaderStub();
    const provider = new BaiduJsapiV4Provider({ loader: official.loader, registry: domain });

    await provider.load({ ak: AK });
    const conflict = await provider
      .load({ ak: "ak-zzzzzzzzzzzz" })
      .catch((error: unknown) => error as BMapError);

    expect(conflict).toBeInstanceOf(BMapError);
    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(official.load).toHaveBeenCalledTimes(1);
  });

  it("代理模式：serviceHost 透传给官方，且不同代理算不同配置", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    await provider.load({ serviceHost: "https://proxy-a.example/_BMapService" });
    expect(official.load.mock.calls[0]![0]).toMatchObject({
      version: "4.0",
      serviceHost: "https://proxy-a.example/_BMapService",
    });

    // 换一个代理就是另一份 SDK 配置：必须按冲突拒绝，而不是静默复用上一个代理的全局。
    const conflict = (await provider
      .load({ serviceHost: "https://proxy-b.example/_BMapService" })
      .catch((error: unknown) => error)) as BMapError;
    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(official.load).toHaveBeenCalledTimes(1);
  });

  it("代理模式的 metadata 指向代理入口且不带 ak（akRef 记 none）", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    // 只给 serviceHost：接口本身不需要 ak。
    const only = await provider.load({ serviceHost: "https://proxy.example/_BMapService/" });
    expect(only.load.apiUrl).toBe("https://proxy.example/_BMapService/api?v=4.0");
    expect(only.load.apiUrl).not.toContain("ak=");
    expect(only.load.akRef).toBe("none");

    // ak + serviceHost：代理模式下 ak 不参与入口，metadata 不能假装它参与了。
    const both = await baiduJsapiV4Provider({
      loader: createOfficialLoaderStub().loader,
      registry: newDomain(),
    }).load({ ak: AK, serviceHost: "https://proxy.example/_BMapService/" });
    expect(both.load.apiUrl).toBe("https://proxy.example/_BMapService/api?v=4.0");
    expect(both.load.akRef).toBe("none");
  });

  it("同配置的并发消费者只调用一次官方 load", async () => {
    const official = createOfficialLoaderStub();
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    const [a, b] = await Promise.all([provider.load({ ak: AK }), provider.load({ ak: AK })]);
    expect(official.load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("取消一个消费者不影响另一个：两者共用同一次官方调用", async () => {
    let deliver!: (value: unknown) => void;
    const load = vi.fn(() => new Promise<unknown>((resolve) => (deliver = resolve)));
    const provider = baiduJsapiV4Provider({
      loader: { load } as OfficialJsapiLoader,
      registry: newDomain(),
    });
    const c1 = new AbortController();

    const a = provider.load({ ak: AK }, c1.signal);
    const b = provider.load({ ak: AK });
    await Promise.resolve();

    c1.abort();
    await expect(a).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    deliver(COMPLETE_NAMESPACE);
    await expect(b).resolves.toMatchObject({ engine: "jsapi-v4" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("全部消费者取消后：不可取消的官方任务被保留，再次订阅复用同一任务而不是重发", async () => {
    let deliver!: (value: unknown) => void;
    const load = vi.fn(() => new Promise<unknown>((resolve) => (deliver = resolve)));
    const domain = newDomain();
    const provider = baiduJsapiV4Provider({
      loader: { load } as OfficialJsapiLoader,
      registry: domain,
    });
    const c1 = new AbortController();

    const first = provider.load({ ak: AK }, c1.signal);
    await Promise.resolve();
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 官方 Loader 没有取消接口 ⇒ 消费者全走了也不释放条目 / 占用 / 任务。
    expect(domain.size).toBe(1);

    // 另一份配置在它结算前就被冲突拒绝：不会出现「已取消但仍在飞」与另一份配置
    // 同时进入同一全局冲突域。
    await expect(provider.load({ ak: "ak-other-000000" })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });

    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    deliver(COMPLETE_NAMESPACE);
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
    // 任务真正成功：记账落在它身上（真实成功不会被遗忘）。
    expect(domain.activeFingerprint).toBe(provider.getCacheKey({ ak: AK }));
    await expect(provider.load({ ak: AK })).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("页面已有的全局属于「宿主提供」时不因本次失败被删除（失败只登记、不清理）", async () => {
    const host = { Map: () => {}, Point: () => {}, Marker: () => {} };
    installGlobal(host);
    const official = createOfficialLoaderStub();
    official.load.mockRejectedValueOnce(new Error("network down"));
    const provider = baiduJsapiV4Provider({ loader: official.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK })).rejects.toThrow(/network down/);
    expect(readGlobal()).toBe(host);
    // 宿主对象不会被标成「本库残留」：它是本次加载前就在的。
    expect(isRejectedJsapiV4Global(host)).toBe(false);
  });

  it("getCacheKey 只由影响全局 SDK 的配置决定", () => {
    const provider = baiduJsapiV4Provider({ registry: newDomain() });

    // script 级细节不参与身份判定：超时不同不该被当成另一份 SDK 配置。
    expect(provider.getCacheKey({ ak: AK, timeout: 10_000 })).toBe(
      provider.getCacheKey({ ak: AK }),
    );
    // 影响全局语义的配置必须改变身份，否则冲突检测会漏判。
    expect(provider.getCacheKey({ ak: AK })).not.toBe(provider.getCacheKey({ ak: "ak-other" }));
    expect(provider.getCacheKey({ ak: AK })).not.toBe(
      provider.getCacheKey({ ak: AK, version: "4.1" }),
    );
  });

  it("不同 Provider 的相同配置复用同一任务", async () => {
    const domain = newDomain();
    const official = createOfficialLoaderStub();
    const customFake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const cdn = new BaiduJsapiV4Provider({ loader: official.loader, registry: domain });
    // 自托管入口指向同一地址 → 与 CDN 指纹一致，落在同一冲突域。
    const custom = new CustomScriptV4Provider(DEFAULT_API_URL, {
      loader: customFake.loader,
      registry: domain,
    });

    const first = await cdn.load({ ak: AK });
    const second = await custom.load({ ak: AK });

    expect(official.load).toHaveBeenCalledTimes(1);
    expect(customFake.load).not.toHaveBeenCalled();
    expect(second.namespace).toBe(first.namespace);
    expect(second.load.fingerprint).toBe(first.load.fingerprint);
  });

  it("[T1] 失败残留标记跨库副本共享，另一份副本不会被残缺全局挡住", async () => {
    resetProcessSdkRegistryForTests();
    const partial = { Map: () => {}, Point: () => {} };
    // 残缺全局在本次加载期间才出现（真实场景：官方注入的 script 只补了部分成员）。
    const official = createOfficialLoaderStub(() => {
      installGlobal(partial);
      return partial;
    });

    // 副本 A：独立求值的模块图（模拟同页两份独立打包的库副本），共用进程级 BMap 域。
    vi.resetModules();
    const namespaceA = await import("./namespace");
    const providerA = (await import("./BaiduJsapiV4Provider")).baiduJsapiV4Provider({
      loader: official.loader,
      registry: newDomain(),
    });
    await expect(providerA.load({ ak: AK })).rejects.toThrow(/Marker/);
    expect(namespaceA.isRejectedJsapiV4Global(partial)).toBe(true);

    // 副本 B：同一 realm、同一进程级 Registry，必须认识 A 留下的残留。
    vi.resetModules();
    const namespaceB = await import("./namespace");
    expect(namespaceB.isRejectedJsapiV4Global(partial)).toBe(true);
    // 复用的是「本库残留」而不是「宿主全局」：即便全局仍残缺，重试路径也不会被直接拒绝。
    installGlobal(COMPLETE_NAMESPACE);
    const providerB = (await import("./BaiduJsapiV4Provider")).baiduJsapiV4Provider({
      loader: createOfficialLoaderStub(() => readGlobal()).loader,
      registry: newDomain(),
    });
    await expect(providerB.load({ ak: AK })).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("SSR（无 window/document）导入安全，且加载被官方拒绝", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try {
      // 动态重新导入：模块顶层不得访问 document / window。
      vi.resetModules();
      const mod = await import("./BaiduJsapiV4Provider");
      const provider = mod.baiduJsapiV4Provider({ registry: new SdkRegistry({ domain: "BMap" }) });

      expect(provider.getCacheKey({ ak: AK })).toContain("v:4.0");
      const error = (await provider.load({ ak: AK }).catch((e: unknown) => e)) as BMapError;
      // `vi.resetModules()` 之后是另一个模块副本，`instanceof` 判不得；按稳定 code / message 断言。
      expect(error.code).toBe("BMAP_SDK_LOAD_FAILED");
      expect(error.message).toMatch(/只能在浏览器环境使用/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("loadJsapiV4Script（自研 transport 的共享编排，仅 CustomScript 使用）", () => {
  it("取消一个共享消费者不会删掉其它消费者的任务登记，也不重复插入 script", async () => {
    const created = trackScripts();
    const loader = new ScriptLoader();
    const base = { mode: "jsonp" as const, src: REMOTE_SRC };
    const c1 = new AbortController();

    const p1 = loadJsapiV4Script({
      loader,
      providerId: "custom-script-v4",
      signal: c1.signal,
      loadOptions: { ...base, callbackName: "__cb_shared_a" },
    });
    const p2 = loadJsapiV4Script({
      loader,
      providerId: "custom-script-v4",
      loadOptions: { ...base, callbackName: "__cb_shared_a" },
    });
    expect(created).toHaveLength(1);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(loader.inFlightCount).toBe(1);

    // 第三个同配置消费者仍然复用进行中的任务，不能因为前一个消费者取消而重复插入。
    const p3 = loadJsapiV4Script({
      loader,
      providerId: "custom-script-v4",
      loadOptions: { ...base, callbackName: "__cb_shared_b" },
    });
    await Promise.resolve();
    expect(created).toHaveLength(1);

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback("__cb_shared_a");
    await expect(p2).resolves.toBe(COMPLETE_NAMESPACE);
    await expect(p3).resolves.toBe(COMPLETE_NAMESPACE);
  });
});

describe("Provider 调用点：`cancellable` 契约（复用既有全局的同步捷径）", () => {

  it("声明 cancellable:true 的 Provider 必须先尊重聚合 signal，再走「复用已有全局」这条同步捷径", async () => {
    // `reuseExistingJsapiV4()` 是同步成功返回的：若不先看 signal，它会在这个 microtask 里
    // 「成功」——而此时 registry 早已按 cancellable:true 同步释放了条目与占用，于是
    // 「被取消的任务 + 另一份配置」会同时成功，域只记得住其中一个。
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0" });
    const domain = newDomain();
    const provider = customScriptV4Provider(REMOTE_SRC, { registry: domain });
    const c1 = new AbortController();

    const first = provider.load({ ak: AK }, c1.signal);
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 被取消的任务不得把域记到自己头上：另一份配置必须能正常复用同一份全局。
    await expect(provider.load({ ak: "ak-other-000000" })).resolves.toMatchObject({
      engine: "jsapi-v4",
    });
    expect(domain.activeFingerprint).toBe(provider.getCacheKey({ ak: "ak-other-000000" }));
  });


  it("ExistingGlobal 同样在复用前尊重聚合 signal（它没有任何可取消的底层工作）", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0" });
    const domain = newDomain();
    const provider = existingGlobalV4Provider({ registry: domain });
    const c1 = new AbortController();

    const first = provider.load({ ak: AK }, c1.signal);
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    await expect(provider.load({ ak: "ak-other-000000" })).resolves.toMatchObject({
      engine: "jsapi-v4",
    });
    expect(domain.activeFingerprint).toBe(provider.getCacheKey({ ak: "ak-other-000000" }));
  });


  it("两个只有 userinfo 不同的自托管入口是不同配置，但冲突文本不含原始凭据", async () => {
    const domain = newDomain();
    const alice = customScriptV4Provider("https://alice:s3cret@corp.example.com/api", {
      registry: domain,
    });
    const bob = customScriptV4Provider("https://bob:s3cret@corp.example.com/api", {
      registry: domain,
    });
    const fpAlice = alice.getCacheKey({});
    const fpBob = bob.getCacheKey({});

    // 凭据不同 ⇒ 入口不同 ⇒ 配置身份不同（否则冲突会被漏判）；但身份里不留原文。
    expect(fpAlice).not.toBe(fpBob);
    expect(fpAlice).not.toContain("s3cret");

    // 冲突文本由 fingerprint 拼成（`SdkRegistry.conflictError`），因此这里直接用域构造，
    // 避免在单元测试里真的插 script。
    let settle!: (value: string) => void;
    const inflight = domain.load({
      fingerprint: fpAlice,
      loader: () => new Promise<string>((resolve) => (settle = resolve)),
    });
    const conflict = (await domain
      .load({ fingerprint: fpBob, loader: async () => "bob" })
      .catch((error: unknown) => error)) as BMapError;

    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(conflict.message).not.toContain("s3cret");
    expect(conflict.message).not.toContain("alice:");
    expect(conflict.message).not.toContain("bob:");

    settle("alice");
    await expect(inflight).resolves.toBe("alice");
  });

});

describe("ExistingGlobalV4Provider", () => {
  it("全局缺失时失败（可重试）", async () => {
    const provider = existingGlobalV4Provider({ registry: newDomain() });
    const error = await provider
      .load({ ak: AK })
      .catch((e: unknown) => e as BMapError);
    expect(error).toBeInstanceOf(BMapError);
    expect(error.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(error.retryable).toBe(true);
  });

  it("全局缺少关键成员时失败并列出缺失成员", async () => {
    installGlobal({ Map: () => {}, Point: () => {}, Marker: undefined });
    const provider = existingGlobalV4Provider({ registry: newDomain() });
    await expect(provider.load({ ak: AK })).rejects.toThrow(/Marker/);
  });

  it("全局暴露 4.x 版本时标注 versionSource=global", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0.4" });
    const loaded = await existingGlobalV4Provider({ registry: newDomain() }).load({ ak: AK });
    expect(loaded.version).toBe("4.0.4");
    expect(loaded.load.versionSource).toBe("global");
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.apiUrl).toBe("existing-global");
  });

  it("真实 4.0 全局（version === 'gl'）按 declared 处理而不是失败", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, version: "gl" });
    const loaded = await existingGlobalV4Provider({ registry: newDomain() }).load({ ak: AK });
    expect(loaded.version).toBe("4.0");
    expect(loaded.load.versionSource).toBe("declared");
  });

  it("全局暴露非 4.x 版本时失败", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "2.0" });
    await expect(existingGlobalV4Provider({ registry: newDomain() }).load({ ak: AK })).rejects.toThrow(
      /not JSAPI 4\.0/,
    );
  });

  it("与同一域内的其它 Provider 共享冲突判定", async () => {
    installGlobal(COMPLETE_NAMESPACE);
    const domain = newDomain();
    const provider = existingGlobalV4Provider({ registry: domain });
    await provider.load({ ak: AK });

    const cdn = new BaiduJsapiV4Provider({
      loader: createOfficialLoaderStub().loader,
      registry: domain,
    });
    await expect(cdn.load({ ak: "ak-zzzzzzzzzzzz" })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });
  });
});

describe("CustomScriptV4Provider", () => {
  it("默认按 script load 事件就绪，并把相对入口归一化为绝对 URL", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    });

    const loaded = await provider.load({ ak: AK });
    const options = fake.load.mock.calls[0][0] as ScriptLoadModeOptions;
    expect(options.mode).toBe("load");
    expect(options.src).toBe("./bmap-v4.js");
    expect(loaded.load.mode).toBe("load");
    // metadata 记录的是归一化后的绝对入口，而不是原样透传的相对路径。
    expect(loaded.load.apiUrl).not.toBe("./bmap-v4.js");
    expect(loaded.load.apiUrl).toMatch(/^https?:\/\/.+\/bmap-v4\.js$/);
  });

  it("就绪信号只能显式指定：传 apiUrl 不会自动切成 JSONP", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    });

    await provider.load({ ak: AK, apiUrl: "https://corp.example.com/bmap/api" });
    expect((fake.load.mock.calls[0][0] as ScriptLoadModeOptions).mode).toBe("load");
  });

  it("显式 jsonp 时把回调名写进入口 URL，并支持自定义 callback 参数名", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("https://corp.example.com/bmap/api", {
      loader: fake.loader,
      registry: newDomain(),
      mode: "jsonp",
    });

    const loaded = await provider.load({ ak: AK, callbackParam: "cb" });
    const options = fake.load.mock.calls[0][0] as ScriptJsonpModeOptions;
    expect(options.mode).toBe("jsonp");
    expect(new URL(options.src).searchParams.get("cb")).toBe(options.callbackName);
    expect(loaded.load.mode).toBe("jsonp");
    // metadata 中的入口 URL 已剔除回调参数。
    expect(loaded.load.apiUrl).not.toContain(options.callbackName);
  });

  it("load 模式下普通 callback 参数参与配置身份，jsonp 模式下由 Loader 接管", () => {
    const loadA = customScriptV4Provider("/sdk.js?callback=tenantA", { registry: newDomain() });
    const loadB = customScriptV4Provider("/sdk.js?callback=tenantB", { registry: newDomain() });
    // load 模式没有库管理的回调，该参数只是普通 query：不同入口必须是不同配置。
    expect(loadA.getCacheKey({})).not.toBe(loadB.getCacheKey({}));

    const jsonpA = customScriptV4Provider("/sdk.js?callback=tenantA", {
      registry: newDomain(),
      mode: "jsonp",
    });
    const jsonpB = customScriptV4Provider("/sdk.js?callback=tenantB", {
      registry: newDomain(),
      mode: "jsonp",
    });
    // jsonp 模式下该参数会被本次回调名覆盖，因此不参与身份判定。
    expect(jsonpA.getCacheKey({})).toBe(jsonpB.getCacheKey({}));
  });

  it("空 scriptSrc 直接拒绝", () => {
    expect(() => customScriptV4Provider("")).toThrow(BMapError);
    expect(() => customScriptV4Provider("")).toThrow(/non-empty scriptSrc/);
  });

  it("自托管入口的版本校验也发生在成功提交之前（失败可重试）", async () => {
    const created = trackScripts();
    const provider = customScriptV4Provider("https://sdk.example.com/api?v=4.0", {
      registry: newDomain(),
      mode: "load",
    });

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    // 成员完整但版本不是 4.x：必须在底层提交成功之前被拒绝。
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "3.0" });
    created[0].dispatchEvent(new Event("load"));
    await expect(first).rejects.toThrow(/not JSAPI 4\.0/);
    expect(created[0].parentNode).toBeNull();

    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    created[1].dispatchEvent(new Event("load"));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("自托管入口的版本以全局自述为准", async () => {
    const fake = createFakeLoader(() => installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0.4" }));
    const loaded = await customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    }).load({ ak: AK });

    expect(loaded.version).toBe("4.0.4");
    expect(loaded.load.versionSource).toBe("global");
  });

  it("自建入口的失败残留不阻断重试，也不会被删除", async () => {
    const created = trackScripts();
    const provider = customScriptV4Provider(REMOTE_SRC, {
      registry: newDomain(),
      mode: "jsonp",
    });
    const partial = { Map: () => {}, Point: () => {} };

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    installGlobal(partial);
    invokeGlobalCallback(jsonpCallbackNameOf(created[0]));
    await expect(first).rejects.toThrow(/Marker/);
    expect(created[0].parentNode).toBeNull();
    expect(isRejectedJsapiV4Global(partial)).toBe(true);

    // 不手动清理全局：第二次调用仍须有机会重新插入 script。
    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
    // 宿主 / 外部对象没有被本库删除。
    expect(partial).toBeDefined();
  });

  it("超时退出（未到就绪回调）也登记本次残留，重试可重新插入 script", async () => {
    const created = trackScripts();
    const provider = customScriptV4Provider(REMOTE_SRC, {
      registry: newDomain(),
      mode: "jsonp",
    });
    const partial = { Map: () => {}, Point: () => {} };

    const first = provider.load({ ak: AK, timeout: 5 });
    await Promise.resolve();
    // 脚本已建好残缺全局，但回调始终不来 → 超时退出。
    installGlobal(partial);
    await expect(first).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_TIMEOUT" });
    expect(created[0].parentNode).toBeNull();

    // 不手动清理全局：重试必须能进入加载路径。
    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("取消退出（未到就绪回调）也登记本次残留，且不打掉立即重试的任务登记", async () => {
    const created = trackScripts();
    const loader = new ScriptLoader();
    const provider = customScriptV4Provider(REMOTE_SRC, {
      registry: newDomain(),
      loader,
      mode: "jsonp",
    });
    const partial = { Map: () => {}, Point: () => {} };
    const c1 = new AbortController();

    const first = provider.load({ ak: AK }, c1.signal);
    await Promise.resolve();
    installGlobal(partial);
    c1.abort();
    // 同一同步回合内立即重试：不能被残留全局挡住，也不能被过期清理打掉登记。
    const retry = provider.load({ ak: AK });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    expect(loader.inFlightCount).toBe(1);

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(retry).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("宿主预先存在的残缺全局明确失败，且不插入 script", async () => {
    installGlobal({ Map: () => {}, Point: () => {} });
    const fake = createFakeLoader();
    const provider = new CustomScriptV4Provider(REMOTE_SRC, {
      loader: fake.loader,
      registry: newDomain(),
    });

    await expect(provider.load({ ak: AK })).rejects.toThrow(/Marker/);
    expect(fake.load).not.toHaveBeenCalled();
  });
});
