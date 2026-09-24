/**
 * `LIBRARY_VERSION` 必须与包版本一致。
 *
 * `BMapClient.libraryVersion` 会把它报告出去，而构建产物仍以 `package.json` 为版本事实源，
 * 因此这里直接锁定运行时常量和包元数据的一致性。
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
