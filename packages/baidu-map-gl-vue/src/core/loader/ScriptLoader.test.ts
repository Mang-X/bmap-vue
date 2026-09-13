import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScriptLoader, getScriptKey } from "./ScriptLoader";
import {
  resetGlobalCallbackRegistryForTests,
  type ScriptLoaderOptions,
} from "./SharedLoadTask";

/** 非百度域名：避免 tests/setup.ts 对 api.map.baidu.com 的自动回调补丁。 */
const SRC = "https://sdk.example.com/bmap.js";
const SRC_WITH_CALLBACK = `${SRC}?callback=__cb_a`;

/**
 * 记录本次用例插入的 script，并把它挂到**脱离文档**的容器上，
 * 避免 happy-dom 在 appendChild 时真实拉取脚本、自动派发 load/error。
 */
function trackScripts(): HTMLScriptElement[] {
  const created: HTMLScriptElement[] = [];
  const container = document.createElement("div");
  Object.defineProperty(document, "body", { value: container, configurable: true });
  const realAppend = Node.prototype.appendChild;
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
    if (node instanceof HTMLScriptElement) created.push(node);
    return realAppend.call(this, node as never) as never;
  });
  return created;
}

/** 脱离文档的容器里，用 parentNode 判断 script 是否仍在 DOM。 */
function isAttached(script: HTMLScriptElement): boolean {
  return script.parentNode !== null;
}

function jsonpOptions(): ScriptLoaderOptions {
  return {
    mode: "jsonp",
    src: SRC_WITH_CALLBACK,
    callbackName: "__cb_a",
    exportGetter: () => "sdk",
  };
}

describe("ScriptLoader — 显式 load/jsonp 模式", () => {
  let created: HTMLScriptElement[];

  beforeEach(() => {
    created = trackScripts();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__cb_a;
    delete (window as unknown as Record<string, unknown>).__cb_readonly;
    delete (window as unknown as Record<string, unknown>).__cb_shared;
    delete (window as unknown as Record<string, unknown>).__cb_ext;
    delete (window as unknown as Record<string, unknown>).__ready_a;
    delete (window as unknown as Record<string, unknown>).__ready_b;
    delete (document as unknown as Record<string, unknown>).body;
    resetGlobalCallbackRegistryForTests();
    vi.restoreAllMocks();
  });

  it("并发 20 个同配置调用只插入一个 script", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const promises = Array.from({ length: 20 }, () => loader.load(options));

    expect(created).toHaveLength(1);
    expect(loader.inFlightCount).toBe(1);

    (window as unknown as Record<string, () => void>).__cb_a();
    const results = await Promise.all(promises);

    expect(results).toHaveLength(20);
    expect(results.every((r) => r === "sdk")).toBe(true);
    expect(loader.inFlightCount).toBe(0);
    expect(loader.completedCount).toBe(1);
    expect((window as unknown as Record<string, unknown>).__cb_a).toBeUndefined();
  });

  it("取消 19 个消费者不影响剩余消费者成功", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const promises = controllers.map((c) => loader.load(options, c.signal));

    expect(created).toHaveLength(1);
    controllers.slice(0, 19).forEach((c) => c.abort());
    const settled = await Promise.allSettled(promises.slice(0, 19));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect((settled[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "BMAP_PROVIDER_ABORTED",
    });

    // 底层任务未被取消：仍有 1 个消费者在工作。
    expect(isAttached(created[0])).toBe(true);
    expect(loader.inFlightCount).toBe(1);

    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promises[19]).resolves.toBe("sdk");
    expect(isAttached(created[0])).toBe(true);
  });

  it("最后一个消费者离开时取消底层任务，随后可重试", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const controllers = [new AbortController(), new AbortController()];
    const promises = controllers.map((c) => loader.load(options, c.signal));

    controllers.forEach((c) => c.abort());
    await Promise.allSettled(promises);

    expect(isAttached(created[0])).toBe(false);
    expect((window as unknown as Record<string, unknown>).__cb_a).toBeUndefined();
    expect(loader.inFlightCount).toBe(0);

    const retry = loader.load(options);
    expect(created).toHaveLength(2);
    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(retry).resolves.toBe("sdk");
  });

  it("jsonp 模式不依赖 script load 事件就绪", async () => {
    const loader = new ScriptLoader();
    let settled = false;
    const promise = loader.load(jsonpOptions()).then((value) => {
      settled = true;
      return value;
    });

    created[0].dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(settled).toBe(false);

    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promise).resolves.toBe("sdk");
  });

  it("load 模式以 script load 事件就绪，不安装全局回调", async () => {
    const loader = new ScriptLoader();
    const promise = loader.load({ mode: "load", src: SRC, exportGetter: () => "sdk" });
    expect(created).toHaveLength(1);
    created[0].dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBe("sdk");
  });

  it("error 后移除失败缓存并可重试", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = { mode: "load", src: SRC, exportGetter: () => "sdk" };
    const first = loader.load(options);
    created[0].dispatchEvent(new Event("error"));
    await expect(first).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(loader.inFlightCount).toBe(0);

    const second = loader.load(options);
    expect(created).toHaveLength(2);
    created[1].dispatchEvent(new Event("load"));
    await expect(second).resolves.toBe("sdk");
  });

  it("error 文案里的 AK 必须脱敏（自研 transport 同样不得经错误文本外泄）", async () => {
    const loader = new ScriptLoader();
    const src = `${SRC}?v=4.0&ak=secretak123456&callback=cb_leak`;
    const first = loader.load({ mode: "load", src, exportGetter: () => "sdk" });
    created[0].dispatchEvent(new Event("error"));
    const error = (await first.catch((e: unknown) => e)) as { message: string };

    // 失败文案会带上入口 URL，而入口 URL 带 `ak=`：这条路径必须与官方路径同一口径地脱敏。
    expect(error.message).toContain("Failed to load script");
    expect(error.message).not.toContain("secretak123456");
    expect(error.message).toContain("ak=***3456");
  });

  it("error 文案里的 userinfo 必须脱敏（自托管入口可能带 HTTP 认证凭据）", async () => {
    const loader = new ScriptLoader();
    const src = "https://agent:s3cret@corp.example.com/api?v=4.0";
    const first = loader.load({ mode: "load", src, exportGetter: () => "sdk" });
    created[0].dispatchEvent(new Event("error"));
    const error = (await first.catch((e: unknown) => e)) as { message: string };

    expect(error.message).toContain("Failed to load script");
    expect(error.message).not.toContain("s3cret");
    expect(error.message).not.toContain("agent:");
    expect(error.message).toContain("***@corp.example.com");
  });

  it("timeout 后移除失败缓存并可重试", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = {
      mode: "load",
      src: SRC,
      timeout: 15,
      exportGetter: () => "sdk",
    };
    await expect(loader.load(options)).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_TIMEOUT" });
    expect(isAttached(created[0])).toBe(false);
    expect(loader.inFlightCount).toBe(0);

    const retry = loader.load(options);
    expect(created).toHaveLength(2);
    created[1].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe("sdk");
  });

  it("透传 nonce/integrity/crossOrigin/referrerPolicy，remove-after-load 成功后移除 script", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = {
      mode: "load",
      src: SRC,
      nonce: "n1",
      integrity: "sha384-x",
      crossOrigin: "anonymous",
      referrerPolicy: "no-referrer",
      retention: "remove-after-load",
      exportGetter: () => "sdk",
    };
    const promise = loader.load(options);
    expect(created[0].nonce).toBe("n1");
    expect(created[0].integrity).toBe("sha384-x");
    expect(created[0].crossOrigin).toBe("anonymous");
    expect(created[0].referrerPolicy).toBe("no-referrer");
    created[0].dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBe("sdk");
    expect(isAttached(created[0])).toBe(false);
  });

  it("同名全局 callback 冲突时，加载完成后恢复原值", async () => {
    const loader = new ScriptLoader();
    const existing = () => "existing";
    (window as unknown as Record<string, unknown>).__cb_a = existing;

    const promise = loader.load(jsonpOptions());
    expect((window as unknown as Record<string, unknown>).__cb_a).not.toBe(existing);
    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promise).resolves.toBe("sdk");
    expect((window as unknown as Record<string, unknown>).__cb_a).toBe(existing);
  });

  it("成功结果复用：再次 load 不创建新 script", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const promise = loader.load(options);
    (window as unknown as Record<string, () => void>).__cb_a();
    await promise;

    await expect(loader.load(options)).resolves.toBe("sdk");
    expect(created).toHaveLength(1);
  });

  it("SSR（无 window/document）直接拒绝且不创建 script", async () => {
    const loader = new ScriptLoader();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try {
      await expect(loader.load({ mode: "load", src: SRC })).rejects.toMatchObject({
        code: "BMAP_SDK_LOAD_FAILED",
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(created).toHaveLength(0);
  });

  // ── 评审回归：初始化异常、回调交叠、模式隔离、取消优先级 ──────────────────

  it("[F1] 回调安装失败（只读全局属性）进入失败路径，不挂起并可重试", async () => {
    const loader = new ScriptLoader();
    const name = "__cb_readonly";
    Object.defineProperty(window, name, {
      value: undefined,
      writable: false,
      configurable: true,
    });
    const options: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?callback=${name}`,
      callbackName: name,
      timeout: 10,
      exportGetter: () => "sdk",
    };

    await expect(loader.load(options)).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    // 关键：任务没有停留在 loading，in-flight 已清除；脚本也未插入。
    expect(loader.inFlightCount).toBe(0);
    expect(created).toHaveLength(0);
    expect((window as unknown as Record<string, unknown>)[name]).toBeUndefined();

    // 冲突解除后能够重新加载（而不是复用挂起的任务）。
    Reflect.deleteProperty(window as unknown as object, name);
    const retry = loader.load(options);
    expect(created).toHaveLength(1);
    (window as unknown as Record<string, () => void>)[name]();
    await expect(retry).resolves.toBe("sdk");
  });

  it("[F2] 两个任务交叠、先安装者先失败：不残留失效回调", async () => {
    const loader = new ScriptLoader();
    const name = "__cb_shared";
    const optionsA: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?task=a&callback=${name}`,
      callbackName: name,
      exportGetter: () => "A",
    };
    const optionsB: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?task=b&callback=${name}`,
      callbackName: name,
      exportGetter: () => "B",
    };

    const a = loader.load(optionsA);
    const b = loader.load(optionsB);
    expect(created).toHaveLength(2);

    created[0].dispatchEvent(new Event("error")); // A 先失败
    await expect(a).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    // A 失败时全局回调属于 B，不能被删除；B 仍可用。
    expect(typeof (window as unknown as Record<string, unknown>)[name]).toBe("function");
    (window as unknown as Record<string, () => void>)[name]();
    await expect(b).resolves.toBe("B");
    expect((window as unknown as Record<string, unknown>)[name]).toBeUndefined();
  });

  it("[F2] 两个任务交叠、先安装者后失败：不得恢复已失效 handler", async () => {
    const loader = new ScriptLoader();
    const name = "__cb_shared";
    const optionsA: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?task=a&callback=${name}`,
      callbackName: name,
      exportGetter: () => "A",
    };
    const optionsB: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?task=b&callback=${name}`,
      callbackName: name,
      exportGetter: () => "B",
    };

    const a = loader.load(optionsA);
    const b = loader.load(optionsB);
    expect(created).toHaveLength(2);

    created[1].dispatchEvent(new Event("error")); // B 先失败
    await expect(b).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    // 回退到仍然存活的 A handler。
    expect(typeof (window as unknown as Record<string, unknown>)[name]).toBe("function");

    created[0].dispatchEvent(new Event("error")); // A 后失败
    await expect(a).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    // 不得把已失效的 A handler 留在全局。
    expect((window as unknown as Record<string, unknown>)[name]).toBeUndefined();
    expect(loader.size).toBe(0);
  });

  it("[F3] load 模式不合并仅有 callback 查询值不同的请求", async () => {
    const loader = new ScriptLoader();
    const a = loader.load({
      mode: "load",
      src: `${SRC}?callback=initA`,
      exportGetter: () => "A",
    });
    const b = loader.load({
      mode: "load",
      src: `${SRC}?callback=initB`,
      exportGetter: () => "B",
    });

    expect(created).toHaveLength(2);
    created[0].dispatchEvent(new Event("load"));
    created[1].dispatchEvent(new Event("load"));
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("[F4] 命中成功缓存时，已取消的 signal 仍被拒绝且缓存保留", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const first = loader.load(options);
    (window as unknown as Record<string, () => void>).__cb_a();
    await first;

    const controller = new AbortController();
    controller.abort();
    await expect(loader.load(options, controller.signal)).rejects.toMatchObject({
      code: "BMAP_PROVIDER_ABORTED",
    });

    // 共享缓存不清除：正常消费者仍可命中，不创建新 script。
    await expect(loader.load(options)).resolves.toBe("sdk");
    expect(created).toHaveLength(1);
  });

  it("[F6] 外部接管回调后任务失败，重试成功仍保留外部回调", async () => {
    const loader = new ScriptLoader();
    const name = "__cb_ext";
    const options: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?callback=${name}`,
      callbackName: name,
      exportGetter: () => "sdk",
    };

    const first = loader.load(options);
    // 其它脚本接管全局回调名。
    const externalNew = () => "externalNew";
    (window as unknown as Record<string, unknown>)[name] = externalNew;

    created[0].dispatchEvent(new Event("error"));
    await expect(first).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect((window as unknown as Record<string, unknown>)[name]).toBe(externalNew);
    expect(loader.size).toBe(0);

    // 重试：不得删除外部值，也不得把更早的外部值恢复回来。
    const retry = loader.load(options);
    expect(created).toHaveLength(2);
    (window as unknown as Record<string, () => void>)[name]();
    await expect(retry).resolves.toBe("sdk");
    expect((window as unknown as Record<string, unknown>)[name]).toBe(externalNew);
  });

  it.each(["error", "timeout", "abort"] as const)(
    "[F6] 外部接管后任务以 %s 结束，重试恢复“最新”外部回调而非更早的值",
    async (mechanism) => {
      const loader = new ScriptLoader();
      const name = "__cb_ext";
      const externalOld = () => "externalOld";
      (window as unknown as Record<string, unknown>)[name] = externalOld;
      const options: ScriptLoaderOptions = {
        mode: "jsonp",
        src: `${SRC}?callback=${name}`,
        callbackName: name,
        exportGetter: () => "sdk",
        ...(mechanism === "timeout" ? { timeout: 10 } : {}),
      };

      const controller = new AbortController();
      const first = loader.load(options, mechanism === "abort" ? controller.signal : undefined);
      // 任务已接管全局名。
      expect((window as unknown as Record<string, unknown>)[name]).not.toBe(externalOld);
      const externalNew = () => "externalNew";
      (window as unknown as Record<string, unknown>)[name] = externalNew;

      if (mechanism === "error") created[0].dispatchEvent(new Event("error"));
      if (mechanism === "abort") controller.abort();
      const expectedCode =
        mechanism === "timeout"
          ? "BMAP_SDK_LOAD_TIMEOUT"
          : mechanism === "abort"
            ? "BMAP_PROVIDER_ABORTED"
            : "BMAP_SDK_LOAD_FAILED";
      await expect(first).rejects.toMatchObject({ code: expectedCode });
      expect((window as unknown as Record<string, unknown>)[name]).toBe(externalNew);

      const retry = loader.load(options);
      expect(created).toHaveLength(2);
      (window as unknown as Record<string, () => void>)[name]();
      await expect(retry).resolves.toBe("sdk");
      // 关键：恢复的是最新外部值 externalNew，不是更早的 externalOld。
      expect((window as unknown as Record<string, unknown>)[name]).toBe(externalNew);
    },
  );

  it("[F6] 外部接管后新任务接管同名回调，两个任务都结束后恢复外部值", async () => {
    const loader = new ScriptLoader();
    const name = "__cb_ext";
    const optionsA: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?task=a&callback=${name}`,
      callbackName: name,
      exportGetter: () => "A",
    };
    const optionsB: ScriptLoaderOptions = {
      ...optionsA,
      src: `${SRC}?task=b&callback=${name}`,
      exportGetter: () => "B",
    };

    const a = loader.load(optionsA);
    const externalNew = () => "externalNew";
    (window as unknown as Record<string, unknown>)[name] = externalNew; // 外部接管
    const b = loader.load(optionsB); // B 覆盖外部值，需重新捕获 externalNew
    expect(created).toHaveLength(2);

    created[0].dispatchEvent(new Event("error")); // A 非所有者，不触碰全局
    await expect(a).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });

    (window as unknown as Record<string, () => void>)[name](); // B 就绪
    await expect(b).resolves.toBe("B");
    // 两个任务都结束：恢复的应是 externalNew，而不是删除或更早的值。
    expect((window as unknown as Record<string, unknown>)[name]).toBe(externalNew);
  });

  it("[F7] 自定义 callbackParam 的 jsonp 请求不合并 callback 不同的 URL", async () => {
    const loader = new ScriptLoader();
    const base: ScriptLoaderOptions = {
      mode: "jsonp",
      src: `${SRC}?callback=profileA&done=__ready_a`,
      callbackName: "__ready_a",
      callbackParam: "done",
      exportGetter: () => "A",
    };
    const optionsB: ScriptLoaderOptions = {
      ...base,
      src: `${SRC}?callback=profileB&done=__ready_b`,
      callbackName: "__ready_b",
      exportGetter: () => "B",
    };

    const a = loader.load(base);
    const b = loader.load(optionsB);
    expect(created).toHaveLength(2);

    (window as unknown as Record<string, () => void>).__ready_a();
    (window as unknown as Record<string, () => void>).__ready_b();
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });
});

describe("getScriptKey", () => {
  it("忽略 callback 名，保留其它 query", () => {
    const a = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=abc&callback=cb_1`,
      callbackName: "cb_1",
    });
    const b = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=abc&callback=cb_2`,
      callbackName: "cb_2",
    });
    const c = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=zzz&callback=cb_1`,
      callbackName: "cb_1",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("区分模式与完整性策略", () => {
    const load = getScriptKey({ mode: "load", src: SRC });
    const jsonp = getScriptKey({ mode: "jsonp", src: SRC, callbackName: "cb" });
    const sri = getScriptKey({ mode: "load", src: SRC, integrity: "sha384-x" });
    expect(load).not.toBe(jsonp);
    expect(load).not.toBe(sri);
  });

  it("相对 src 归一后参与去重", () => {
    const key = getScriptKey({ mode: "load", src: "/bmap/sdk.js" });
    expect(key).toContain("/bmap/sdk.js");
  });

  it("[F3] load 模式保留 callback 查询值，仅 jsonp 模式归一化回调参数", () => {
    const loadA = getScriptKey({ mode: "load", src: `${SRC}?callback=initA` });
    const loadB = getScriptKey({ mode: "load", src: `${SRC}?callback=initB` });
    expect(loadA).not.toBe(loadB);

    const jsonpA = getScriptKey({ mode: "jsonp", src: `${SRC}?callback=a`, callbackName: "a" });
    const jsonpB = getScriptKey({ mode: "jsonp", src: `${SRC}?callback=b`, callbackName: "b" });
    expect(jsonpA).toBe(jsonpB);
  });

  it("[F7] jsonp 自定义 callbackParam 只剔除该参数，保留 callback 查询值", () => {
    const profileA = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?callback=profileA&done=ready`,
      callbackName: "ready",
      callbackParam: "done",
    });
    const profileB = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?callback=profileB&done=ready`,
      callbackName: "ready",
      callbackParam: "done",
    });
    expect(profileA).not.toBe(profileB);

    // 自己管理的 done 仍被归一化：只有 done 取值不同的两个请求共享任务。
    const doneA = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?callback=profileA&done=readyA`,
      callbackName: "readyA",
      callbackParam: "done",
    });
    const doneB = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?callback=profileA&done=readyB`,
      callbackName: "readyB",
      callbackParam: "done",
    });
    expect(doneA).toBe(doneB);
  });
});
