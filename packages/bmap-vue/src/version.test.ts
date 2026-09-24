/**
 * `LIBRARY_VERSION` 必须与包版本一致。
 *
 * `BMapClient.libraryVersion` 会把它报告出去，而构建期 define 由所有源码消费者统一注入；
 * 这里以 `package.json` 为唯一事实源做漂移门禁。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { LIBRARY_VERSION } from "./version";

describe("LIBRARY_VERSION", () => {
  it("与 packages/bmap-vue/package.json 的 version 一致", () => {
    const pkgPath = resolve(import.meta.dirname, "../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(LIBRARY_VERSION).toBe(pkg.version);
  });
});
