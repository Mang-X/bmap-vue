/**
 * 脚本动态导入的跨平台 URL 构造（评审 F3）
 *
 * `await import(path + '?t=' + Date.now())` 在 Windows 上会得到
 * `C:\...\catalog.ts?t=...`，Node ESM 加载器以
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME (Received protocol 'c:')` 拒绝。
 * 这里把「必须产出合法 file: URL」这一约束钉住，并防止有人改回裸路径拼接。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { freshModuleUrl } from "../../scripts/fresh-module-url.mts";

const SCRIPTS_DIR = resolve(import.meta.dirname, "../../scripts");

describe("freshModuleUrl", () => {
  it("产出可解析的 file: URL 并带上 cache-bust 参数", () => {
    const url = freshModuleUrl(resolve(SCRIPTS_DIR, "fresh-module-url.mts"), 1234);
    expect(url.startsWith("file://")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("file:");
    expect(parsed.searchParams.get("t")).toBe("1234");
  });

  it("路径按 URL 规则编码后仍能无损还原", () => {
    // `#`、`%`、空格直接拼进 URL 会被当成片段/转义序列而丢字符
    const tricky = resolve(SCRIPTS_DIR, "dir with space/we#ird%name.ts");
    const url = freshModuleUrl(tricky, "s");
    expect(fileURLToPath(new URL(url))).toBe(tricky);
  });

  it("对比：裸路径拼接在 Windows 形态下会解析出非法协议", () => {
    // 这正是修复前 `path + '?t=' + Date.now()` 的产物
    const naive = "C:\\repo\\scripts\\generate-capability-matrix.mts?t=1";
    expect(new URL(naive).protocol).toBe("c:");
    expect(() => new URL(freshModuleUrl("C:\\repo\\a.ts", 1)).protocol).not.toBe("c:");
    expect(new URL(freshModuleUrl("C:\\repo\\a.ts", 1)).protocol).toBe("file:");
  });

  it("生成脚本一律通过 freshModuleUrl 构造 import 说明符", () => {
    for (const name of ["generate-capability-matrix.mts", "generate-manifest-artifacts.mts"]) {
      const source = readFileSync(resolve(SCRIPTS_DIR, name), "utf8");
      expect(source, `${name} 应使用 freshModuleUrl`).toContain("freshModuleUrl(");
      expect(source, `${name} 不得再拼接 '?t='`).not.toMatch(/import\([^)]*\?\s*t=/);
    }
  });

  it("pathToFileURL 与 freshModuleUrl 指向同一文件", () => {
    const file = resolve(SCRIPTS_DIR, "raw-sdk-boundary.mts");
    const base = pathToFileURL(file).href;
    const withStamp = freshModuleUrl(file, "x");
    expect(withStamp.startsWith(base)).toBe(true);
  });
});
