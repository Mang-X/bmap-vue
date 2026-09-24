import { describe, it, expect, vi } from "vitest";
import { devWarn, redactAk } from "./logger";

describe("redactAk", () => {
  it("redacts a known ak in a message", () => {
    const ak = "secret-ak-123456";
    const msg = "config conflict for ak=secret-ak-123456";
    expect(redactAk(msg, ak)).toBe("config conflict for ak=***3456");
  });

  it("redacts ak= pattern when ak not provided", () => {
    const msg = "conflict ak=ABC123XYZ";
    expect(redactAk(msg)).toBe("conflict ak=***3XYZ");
  });

  it("leaves message unchanged when no ak present", () => {
    expect(redactAk("normal message")).toBe("normal message");
  });
});

/**
 * `devWarn` 的环境判定（#27 评审第二轮 P2）
 *
 * 判定读的是 `process.env.NODE_ENV`：在 Node / SSR 下它是真实环境变量，在浏览器里由**消费方**
 * 的打包器折叠。下面两条分别钉住两个终态（消费方 dev server ⇒ 折叠成 `"development"`；
 * production build ⇒ 折叠成 `"production"`）。
 */
describe("devWarn", () => {
  it("非 production 环境输出（消费方 dev server 折叠后的形态）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      devWarn("hello");
      expect(warn).toHaveBeenCalledWith("[bmap-vue] hello", "");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("production 环境静默（消费方 production build 折叠后的形态）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      devWarn("hello");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
