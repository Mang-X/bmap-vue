import { describe, it, expect } from "vitest";
import {
  DEFAULT_API_URL,
  appendCallback,
  fingerprintApiUrl,
  fingerprintConfig,
  hash,
  maskUserinfo,
  normalizeApiUrl,
  resolveBrowserUrl,
} from "./url";

describe("resolveBrowserUrl / normalizeApiUrl", () => {
  it("相对 URL 基于 base 解析", () => {
    expect(resolveBrowserUrl("/a/b", "https://x.com/c/").toString()).toBe("https://x.com/a/b");
  });

  it("normalizeApiUrl 剔除回调参数", () => {
    expect(normalizeApiUrl("https://x.com/api?ak=a&callback=random")).toBe(
      "https://x.com/api?ak=a",
    );
  });

  it("[F7] 自定义 callbackParam 时只剔除该参数，保留 callback", () => {
    expect(normalizeApiUrl("https://x.com/api?callback=profileA&done=ready", "done")).toBe(
      "https://x.com/api?callback=profileA",
    );
  });
});

describe("appendCallback", () => {
  it("按 URL API 追加 callback，保留既有 query", () => {
    expect(appendCallback("https://x.com/api?ak=abc", "cb")).toBe(
      "https://x.com/api?ak=abc&callback=cb",
    );
  });

  it("支持自定义 callback 参数名", () => {
    expect(appendCallback("https://x.com/api?ak=abc", "cb", "cb2")).toBe(
      "https://x.com/api?ak=abc&cb2=cb",
    );
  });
});

describe("fingerprintConfig", () => {
  it("默认配置稳定且含 4.0 基线", () => {
    const fp = fingerprintConfig({});
    expect(fp).toBe(fingerprintConfig({}));
    expect(fp).toContain("v:4.0");
    expect(fp).toContain(DEFAULT_API_URL);
  });

  it("不同 ak / 版本 / apiUrl 产生不同指纹", () => {
    expect(fingerprintConfig({ ak: "keyA" })).not.toBe(fingerprintConfig({ ak: "keyB" }));
    expect(fingerprintConfig({ version: "4.0" })).not.toBe(fingerprintConfig({ version: "3.0" }));
    expect(fingerprintConfig({ apiUrl: "https://a.com/api" })).not.toBe(
      fingerprintConfig({ apiUrl: "https://b.com/api" }),
    );
  });

  it("代理模式（serviceHost）参与身份判定，但只以哈希入指纹（不进日志 / 错误消息）", () => {
    // 官方 Loader 的 `serviceHost` 决定 SDK 从哪个代理入口加载，属「影响全局语义」的配置；
    // 不进指纹会让两个不同代理的请求被当成同一份配置，冲突判不出来。
    const a = fingerprintConfig({ serviceHost: "https://proxy-a.example/_BMapService/" });
    const b = fingerprintConfig({ serviceHost: "https://proxy-b.example/_BMapService/" });
    expect(a).not.toBe(b);

    // 指纹会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息，代理地址里可能有内部域名、
    // 路径甚至 userinfo / token query：只以哈希入指纹（官方封装的 `stableHash` 同一口径）。
    expect(a).not.toContain("proxy-a.example");
    expect(a).not.toContain("_BMapService");
    expect(a).toContain(`host:${hash("https://proxy-a.example/_BMapService/")}`);

    // 末尾斜杠由官方 Loader 自动补（并 warn），因此 `/svc` 与 `/svc/` 是同一个入口、同一份配置。
    expect(fingerprintConfig({ serviceHost: "https://proxy-a.example/svc" })).toBe(
      fingerprintConfig({ serviceHost: "https://proxy-a.example/svc/" }),
    );

    // 未设置时不引入额外字段（既有指纹形状不变）。
    expect(fingerprintConfig({ ak: "keyA" })).toBe(
      fingerprintConfig({ ak: "keyA", serviceHost: undefined }),
    );
  });

  it("userinfo 也是凭据：指纹里只留哈希，不同凭据仍是不同身份", () => {
    // CustomScript 的 scriptSrc 会经这里进 fingerprint，而 fingerprint 会进
    // `BMAP_SDK_CONFIG_CONFLICT` 的文本 ⇒ userinfo 不能带原文。但也**不能**统一抹成同一个值：
    // 不同凭据是不同入口。
    const a = fingerprintApiUrl("https://alice:s3cret@corp.example.com/api");
    const b = fingerprintApiUrl("https://bob:s3cret@corp.example.com/api");
    const same = fingerprintApiUrl("https://alice:s3cret@corp.example.com/api");

    expect(a).not.toContain("alice");
    expect(a).not.toContain("s3cret");
    expect(a).not.toBe(b);
    expect(a).toBe(same);
    // host / path 等非凭据信息保留（诊断价值），只有 userinfo 被换掉。
    expect(a).toContain("corp.example.com/api");
  });

  it("maskUserinfo：按 URL 形状抹掉 userinfo，并按已知值兜底", () => {
    expect(maskUserinfo("Failed: https://alice:s3cret@corp.example.com/api?v=4.0")).toBe(
      "Failed: https://***@corp.example.com/api?v=4.0",
    );
    // 没有 userinfo 的文本原样返回（`@` 出现在别的上下文里不算）。
    expect(maskUserinfo("contact a@b.com; see https://corp.example.com/api")).toBe(
      "contact a@b.com; see https://corp.example.com/api",
    );
    // 形状之外的形态（百分比编码等）按已知值兜底。
    expect(maskUserinfo("alice%3As3cret appears here", "alice%3As3cret")).toBe("*** appears here");
  });

  it("非法 URL 也不得泄漏凭据：整串哈希成不透明标识", () => {
    // 解析不了的入口没法逐项脱敏（`new URL` 抛错），而 fingerprint 会直接进
    // `BMAP_SDK_CONFIG_CONFLICT` 的文本 ——
    // 也就是说「域里已有另一份配置」时，凭据会在真正尝试加载之前就被打进日志。
    const unparseable = "https://alice:s3cret@[invalid?ak=secret-ak-123456";
    const fp = fingerprintApiUrl(unparseable);

    expect(fp).not.toContain("s3cret");
    expect(fp).not.toContain("alice");
    expect(fp).not.toContain("secret-ak-123456");
    expect(fp).toContain("invalid-url");
    // 身份区分能力保留：同一个非法入口稳定、换一份凭据仍算另一份配置。
    expect(fp).toBe(fingerprintApiUrl(unparseable));
    expect(fp).not.toBe(fingerprintApiUrl(unparseable.replace("alice", "bob")));
  });

  it("AK 脱敏：指纹不包含原始 AK", () => {
    const fp = fingerprintConfig({ ak: "super-secret-ak" });
    expect(fp).not.toContain("super-secret-ak");
    expect(fp).toContain(`ak:${hash("super-secret-ak")}`);
  });

  it("AK 脱敏：apiUrl 内嵌的 ak 也不进指纹，但仍能区分不同 AK", () => {
    const fp = fingerprintConfig({ apiUrl: "https://corp.example.com/api?v=4.0&ak=secret-ak-aaa" });
    expect(fp).not.toContain("secret-ak-aaa");
    // 用哈希而不是掩码：不同 AK 必须产生不同指纹，否则冲突会被漏判。
    const other = fingerprintConfig({
      apiUrl: "https://corp.example.com/api?v=4.0&ak=secret-ak-bbb",
    });
    expect(other).not.toBe(fp);

    const masked = fingerprintApiUrl("https://corp.example.com/api?ak=secret-ak-aaa");
    expect(masked).not.toContain("secret-ak-aaa");
    // 与「只归一化、不脱敏」的原行为必须不同，否则说明脱敏没生效。
    expect(masked).not.toBe(normalizeApiUrl("https://corp.example.com/api?ak=secret-ak-aaa"));
    expect(masked).toContain("https://corp.example.com/api?ak=");
  });

  it("[F7] 自定义 callbackParam 时，指纹仍区分不同的 callback 查询值", () => {
    const a = fingerprintConfig({
      ak: "k",
      apiUrl: "https://x.com/api?callback=profileA&done=ready",
      callbackParam: "done",
    });
    const b = fingerprintConfig({
      ak: "k",
      apiUrl: "https://x.com/api?callback=profileB&done=ready",
      callbackParam: "done",
    });
    expect(a).not.toBe(b);
  });
});

describe("hash", () => {
  it("不返回原始输入", () => {
    const h = hash("secret");
    expect(h).not.toBe("secret");
    expect(h).toMatch(/^[0-9a-z]+$/);
  });
});
