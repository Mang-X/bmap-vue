import { describe, it, expect, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
import { devWarn, isDev, redactAk } from "./logger";

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

describe("isDev：裸浏览器没有 process 时不能崩（#137 复审十轮 P0）", () => {
  /**
   * 这条回归测试的存在理由：单测跑在 Node 里，`process` **永远存在**，所以「裸 `process` 会
   * 抛 `ReferenceError`」这件事在普通用例里**测不出来**。必须在一个真的没有 `process` 的
   * 上下文里求值。
   *
   * 真实故障形态（`smoke-v4-fixture` 抓到）：产物里 `process.env?.NODE_ENV` 被折叠成
   * `process.env.NODE_ENV`，裸 browser ESM 执行 `<Map>` setup ⇒ `ReferenceError: process is
   * not defined` ⇒ 每个依赖 Map ready 的 required check 都被 block。
   */
  it("在没有 process 的上下文中求值不抛", () => {
    // 取源码里的判定表达式本身（而不是调 isDev()）——后者在本进程里必然有 process，
    // 走不到那条分支。`node:vm` 造一个**空**全局，等价于浏览器的裸 ESM 环境。
    // vitest 跑在浏览器语义的环境里，`import.meta.url` 不是 file: 协议，所以用相对 cwd 的路径。
    const source = readFileSync("packages/bmap-vue/src/core/logger.ts", "utf8");
    const expr = /return (typeof process[^\n]*);/.exec(source)?.[1];
    expect(expr, "能从 logger.ts 里取出 isDev 的判定表达式").toBeTypeOf("string");

    const sandbox: Record<string, unknown> = {};
    createContext(sandbox);
    // 不抛就是通过；显式断言返回值让「返回 dev」这件事也被钉住。
    expect(runInContext(`(${expr})`, sandbox), "裸浏览器应视为 dev（不崩优先）").toBe(true);
  });

  it("Node 环境下仍读真实环境变量（不因为加保护就一律当 dev）", () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(isDev(), "production 应为 false").toBe(false);
      process.env.NODE_ENV = "development";
      expect(isDev(), "development 应为 true").toBe(true);
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});
