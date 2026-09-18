import { describe, it, expect, vi } from "vitest";
import { createProblemReporter } from "./problems";

describe("createProblemReporter", () => {
  it("同一原因只报一条，并把累计条数写进文案", () => {
    const warn = vi.fn();
    const reporter = createProblemReporter("BPointCollection", warn);
    for (let i = 0; i < 5; i += 1) {
      reporter.report({ kind: "missing-key", index: i, detail: "没有 key" });
    }
    expect(warn).toHaveBeenCalledTimes(1);
    reporter.flush();
    // 计数从 1 涨到 5 ⇒ 补报一条最新的总数，而不是再报五条。
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toContain("共 5 项");
    reporter.flush();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("不同原因各报一条，文案带 label / 下标 / key", () => {
    const warn = vi.fn();
    const reporter = createProblemReporter("BPointCollection", warn);
    reporter.report({ kind: "duplicate-key", index: 3, key: "a", detail: "重复" });
    reporter.report({ kind: "invalid-position", index: 7, key: "b", detail: "越界" });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain("[BPointCollection]");
    expect(warn.mock.calls[0]![0]).toContain("下标 3");
    expect(warn.mock.calls[0]![0]).toContain("key=a");
    expect(warn.mock.calls[1]![0]).toContain("getPosition");
  });

  it("没有问题时一次都不报（flush 也不报）", () => {
    const warn = vi.fn();
    const reporter = createProblemReporter("BPointCollection", warn);
    reporter.flush();
    expect(warn).not.toHaveBeenCalled();
  });
});
