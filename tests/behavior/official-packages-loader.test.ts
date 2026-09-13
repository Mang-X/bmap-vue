/**
 * 官方 `@baidumap/jsapi-loader` 发布契约锁（R25-A / issue #70）
 *
 * 目的：把 #70 从官方 tarball 读出来的契约变成**可回归**的断言，让上游改版时红在 CI 里，
 * 而不是红在 #71 的默认路径集成里。断言依据全部来自发布产物本身：
 *
 * - `dist/index.mjs`（ESM 实现）与 `types/index.d.ts`（声明）；
 * - 版本精确锁定在根 `package.json`（`1.0.0`，无 `^`）；
 * - 真实触发方式：Loader 自己往 `window` 上挂回调名，测试**直接调用那个回调**模拟 JSONP 回包
 *   （官方实现里回调名形如 `__bmapJSApiOnLoad_<n>`，从注入的 script src 上读出再调用）。
 *
 * 需要注意的两条**已观察行为**（不是我们希望的语义，而是 1.0.0 的事实）：
 * 1. 失败 / 超时 / 取消都**不会移除**已注入的 `<script>`，重试会再插一个；
 * 2. 重复 `reset()` 会 `delete window.BMap`，但同样不清理 script 节点。
 * #71 的「卸载不得删除上游 script / 不得 reset」正是建立在这两条之上的。
 *
 * 环境：happy-dom（默认），但两处必须显式处理，否则测出来的是测试基建而不是官方契约：
 *
 * - `tests/setup.ts` 会把 `document.createElement` 换成「凡 `api.map.baidu.com` 的脚本一律
 *   自动回调 + 自动删回调」的桩，还预置了一个 fake `window.BMapGL`。本文件在 `beforeEach`
 *   里 `vi.restoreAllMocks()` 并清掉这两个全局，把「什么时候回包」的控制权拿回来；
 * - happy-dom 默认会真的去 fetch 外部脚本、失败时派发 `error`，于是 Loader 在手动回包之前
 *   就结算成 failed。用 `disableJavaScriptFileLoading` + `handleDisabledFileLoadingAsSuccess`
 *   把外部加载关掉且按成功处理，让 Loader 保持 pending。
 *
 * SSR 侧的事实见 `official-packages-ssr.test.ts`。
 */
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BMapLoader, { getStatus, load, reset } from "@baidumap/jsapi-loader";

interface FakeNamespace {
  Map: unknown;
  Point: unknown;
  Marker: unknown;
}

const SDK_SCRIPT_SELECTOR = 'script[src*="api.map.baidu.com/api"]';

function scriptCount(): number {
  return document.querySelectorAll(SDK_SCRIPT_SELECTOR).length;
}

/** 读最后一次注入的 script，并把 Loader 自己挂的回调名解析出来。 */
function readInjectedScript(): { src: string; callbackName: string } {
  const nodes = Array.from(document.querySelectorAll(SDK_SCRIPT_SELECTOR));
  const last = nodes[nodes.length - 1] as HTMLScriptElement | undefined;
  if (!last) throw new Error("Loader 没有注入 script");
  const src = last.getAttribute("src") ?? "";
  const callbackName = /[?&]callback=([^&]+)/.exec(src)?.[1] ?? "";
  return { src, callbackName };
}

/** 模拟官方 JSONP 回包：先让全局命名空间就位，再调用 Loader 注册的回调。 */
function deliverNamespace(callbackName: string, namespace: FakeNamespace): void {
  (window as unknown as Record<string, unknown>).BMap = namespace;
  const callback = (window as unknown as Record<string, unknown>)[callbackName];
  if (typeof callback !== "function") throw new Error(`window.${callbackName} 不是函数`);
  (callback as () => void)();
}

function fakeNamespace(): FakeNamespace {
  return { Map: () => {}, Point: () => {}, Marker: () => {} };
}

/** 最常用的一条路径：把一份可用的命名空间投递给它。返回该命名空间供断言比对。 */
function deliverFakeNamespace(): FakeNamespace {
  const namespace = fakeNamespace();
  deliverNamespace(readInjectedScript().callbackName, namespace);
  return namespace;
}

function cleanupWindow(): void {
  delete (window as unknown as Record<string, unknown>).BMap;
  delete (window as unknown as Record<string, unknown>).BMapGL;
  delete (window as unknown as Record<string, unknown>)._BMapSecurityConfig;
  for (const node of Array.from(document.querySelectorAll(SDK_SCRIPT_SELECTOR))) node.remove();
}

beforeEach(() => {
  // 抹掉 `tests/setup.ts` 的 SDK 桩（自动回调 + fake BMapGL），拿回回包时机的控制权。
  vi.restoreAllMocks();
  cleanupWindow();
  reset();
});

afterEach(() => {
  cleanupWindow();
  reset();
});

describe("导出形状（ESM 入口）", () => {
  it("具名 load / reset / getStatus 与 default 对象都在", () => {
    expect(typeof load).toBe("function");
    expect(typeof reset).toBe("function");
    expect(typeof getStatus).toBe("function");
    expect(typeof BMapLoader.load).toBe("function");
    expect(typeof BMapLoader.reset).toBe("function");
    expect(typeof BMapLoader.getStatus).toBe("function");
  });

  it("初始状态 notload；reset() 把「正在加载」清回 notload，但不打断在飞任务", async () => {
    expect(getStatus()).toBe("notload");
    const pending = load({ ak: "test-ak", version: "4.0", timeout: 50 });
    expect(getStatus()).toBe("loading");

    reset();
    expect(getStatus()).toBe("notload");

    // reset 只清本模块状态：底层在飞任务仍按自己的计时器结算（与决策 5 一致）。
    await expect(pending).rejects.toThrow(/JSAPI 加载超时\(50ms\)/);
    expect(getStatus()).toBe("failed");
  });
});

describe("前置校验（不发网络）", () => {
  it("缺 ak 且无 serviceHost：拒绝并说明两种合法入口", async () => {
    await expect(load({ version: "4.0" })).rejects.toThrow(/必须提供 ak，或配置 serviceHost/);
  });

  it("不支持的 version：拒绝并列出可选值", async () => {
    await expect(load({ ak: "test-ak", version: "1.0" as never })).rejects.toThrow(
      /不支持的 version: 1\.0，可选值：3\.0 \/ gl \/ 4\.0/,
    );
  });
});

describe("成功路径与单例缓存", () => {
  it("注入的 URL 带 v=4.0 / ak / callback，回包后 resolve 出对应命名空间", async () => {
    const pending = load({ ak: "test-ak", version: "4.0" });
    const { src, callbackName } = readInjectedScript();
    expect(src).toContain("v=4.0");
    expect(src).toContain("ak=test-ak");
    expect(callbackName).toMatch(/^__bmapJSApiOnLoad_\d+$/);

    const namespace: FakeNamespace = { Map: () => {}, Point: () => {}, Marker: () => {} };
    deliverNamespace(callbackName, namespace);

    await expect(pending).resolves.toBe(namespace);
    expect(getStatus()).toBe("loaded");
    expect(scriptCount()).toBe(1);
  });

  it("加载中与加载后都复用同一 Promise，且不重复注入 script", async () => {
    const first = load({ ak: "test-ak", version: "4.0" });
    const second = load({ ak: "test-ak", version: "4.0" });
    expect(second).toBe(first);

    deliverFakeNamespace();
    await first;

    const third = load({ ak: "test-ak", version: "4.0" });
    expect(third).toBe(first);
    expect(scriptCount()).toBe(1);
  });

  it("页面已存在全局命名空间时直接复用，不注入任何 script", async () => {
    const namespace = fakeNamespace();
    (window as unknown as Record<string, unknown>).BMap = namespace;
    await expect(load({ ak: "test-ak", version: "4.0" })).resolves.toBe(namespace);
    expect(scriptCount()).toBe(0);
    expect(getStatus()).toBe("loaded");
  });

  it("globalConfig 在 promise 结算**之前**就已写到命名空间上", async () => {
    const pending = load({
      ak: "test-ak",
      version: "4.0",
      globalConfig: { apiVersion: "gl", coordType: "bd09ll" },
    });
    const namespace = fakeNamespace();
    expect(namespace).not.toHaveProperty("apiVersion");

    // 回包回调里 `v()` 是同步写 globalConfig 再 resolve 的：投递之后、await 之前就能读到，
    // 才能证明顺序。await 之后再断言只能证明「最终写进去了」。
    deliverNamespace(readInjectedScript().callbackName, namespace);
    expect(namespace).toMatchObject({ apiVersion: "gl", coordType: "bd09ll" });

    await expect(pending).resolves.toBe(namespace);
  });
});

describe("同页冲突判定", () => {
  it("已加载后请求另一个 version：拒绝并点名两个版本", async () => {
    const first = load({ ak: "test-ak", version: "4.0" });
    deliverFakeNamespace();
    await first;

    await expect(load({ ak: "test-ak", version: "gl" })).rejects.toThrow(
      /不允许在同一页面混用多个版本 JSAPI（已加载 4\.0，本次请求 gl）/,
    );
  });

  it("已加载后请求另一个 ak：拒绝", async () => {
    const first = load({ ak: "test-ak", version: "4.0" });
    deliverFakeNamespace();
    await first;

    await expect(load({ ak: "another-ak", version: "4.0" })).rejects.toThrow(
      /不允许使用多个不一致的 ak/,
    );
  });
});

describe("失败、超时与重试（含两条已观察行为）", () => {
  it("超时：按 `JSAPI 加载超时(<n>ms)` 拒绝，状态转 failed", async () => {
    await expect(load({ ak: "test-ak", version: "4.0", timeout: 5 })).rejects.toThrow(
      /JSAPI 加载超时\(5ms\)/,
    );
    expect(getStatus()).toBe("failed");
  });

  it("失败后的重试会重新注入 script（官方实现不清理上一次的 script 节点）", async () => {
    await expect(load({ ak: "test-ak", version: "4.0", timeout: 5 })).rejects.toThrow(/超时/);
    expect(scriptCount()).toBe(1);

    const retry = load({ ak: "test-ak", version: "4.0" });
    expect(scriptCount()).toBe(2); // 已观察行为：超时的那个 script 仍在 DOM 里
    deliverFakeNamespace();
    await retry;
    expect(getStatus()).toBe("loaded");
  });

  it("reset() 清理状态与全局对象，但不移除 script 节点", async () => {
    const first = load({ ak: "test-ak", version: "4.0" });
    deliverFakeNamespace();
    await first;

    reset();
    expect(getStatus()).toBe("notload");
    expect((window as unknown as Record<string, unknown>).BMap).toBeUndefined();
    expect((window as unknown as Record<string, unknown>).BMapGL).toBeUndefined();
    expect(scriptCount()).toBe(1); // 已观察行为：reset 不负责 script
  });
});

describe("代理模式", () => {
  it("serviceHost 末尾补斜杠并声明 window._BMapSecurityConfig，且 URL 不携带 ak", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    let settled: string;
    try {
      // 真实网络上这里会以「脚本加载失败」结算；单测里外部加载已被关掉，
      // 因此用 timeout 强制结算，顺带证明代理模式同样走 Loader 自己的超时路径。
      const pending = load({
        serviceHost: "https://example.invalid/_BMapService",
        version: "4.0",
        timeout: 5,
      });
      const src = document.querySelector('script[src*="_BMapService"]')?.getAttribute("src") ?? "";
      expect(src.startsWith("https://example.invalid/_BMapService/")).toBe(true);
      expect(src).not.toContain("ak=");
      expect(src).toContain("callback=__bmapJSApiOnLoad_");
      expect((window as unknown as Record<string, unknown>)._BMapSecurityConfig).toEqual({
        serviceHost: "https://example.invalid/_BMapService/",
      });
      settled = await pending.then(
        () => "resolved",
        (error: Error) => `rejected: ${error.message}`,
      );
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings.some((args) => String(args[0]).includes("末尾应带"))).toBe(true);
    expect(settled).toMatch(/^rejected: .*加载超时\(5ms\)/);
  });
});
