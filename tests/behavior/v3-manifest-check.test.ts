/**
 * `generate-manifest-artifacts --check` 的行为契约
 *
 * 回归背景：修改前 `--check` 会先把生成内容写盘，再读取刚写出的文件做比对，
 * 因此永远「无漂移」——是一道失效门禁，同时还会刷新
 * `docs/.vitepress/component-index.json` 的 `generatedAt`，污染工作树。
 *
 * 契约：
 * - 受版本控制的生成文件（`src/components/index.ts`、`component-index.json`）
 *   在 `--check` 下**逐字节不变**（只读比对），旧行为会因重写 `generatedAt` 而失败；
 * - `packages/bmap-vue/volar.d.ts` 被 `.gitignore` 忽略，是纯发布产物，
 *   两种模式下都生成（全新检出时它不存在，**不得**因此被判为漂移）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/generate-manifest-artifacts.mts");

const TRACKED_GENERATED = [
  "packages/bmap-vue/src/components/index.ts",
  "docs/.vitepress/component-index.json",
] as const;

const UNTRACKED_ARTIFACT = "packages/bmap-vue/volar.d.ts";

function runCheck(): void {
  execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, "--check"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("generate-manifest-artifacts --check", () => {
  it("受版本控制的生成文件在 --check 下逐字节不变（只读比对）", () => {
    const before = TRACKED_GENERATED.map((rel) => readFileSync(resolve(ROOT, rel), "utf8"));
    expect(() => runCheck()).not.toThrow();
    const after = TRACKED_GENERATED.map((rel) => readFileSync(resolve(ROOT, rel), "utf8"));
    for (const [i, rel] of TRACKED_GENERATED.entries()) {
      expect(after[i], `${rel} 不应被 --check 改写`).toBe(before[i]);
    }
  });

  it("volar.d.ts 缺失时 --check 仍然通过（该产物不受版本控制，不是漂移目标）", () => {
    const volarPath = resolve(ROOT, UNTRACKED_ARTIFACT);
    // CI 的全新检出正是这个状态:文件不存在
    const existed = existsSync(volarPath);
    if (existed) {
      // 用临时备份模拟「缺失」，结束后恢复
      const backup = readFileSync(volarPath, "utf8");
      try {
        rmSync(volarPath, { force: true });
        expect(() => runCheck()).not.toThrow();
        expect(existsSync(volarPath), "volar.d.ts 应被重新生成").toBe(true);
      } finally {
        expect(readFileSync(volarPath, "utf8")).toBe(backup);
      }
    } else {
      expect(() => runCheck()).not.toThrow();
      expect(existsSync(volarPath), "volar.d.ts 应被生成").toBe(true);
    }
  });
});
