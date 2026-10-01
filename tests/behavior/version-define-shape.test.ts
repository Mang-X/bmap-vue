/**
 * `versionDefine` 的运行时形状与 companion declaration 必须一致（#45 评审 P2）
 *
 * `scripts/vite-version-define.mjs`（运行时）与 `scripts/vite-version-define.d.mts`
 * （类型声明）是**同一份事实的两个镜像**，手工维护。加了 `__PKG_NAME__` 而忘了同步
 * 声明时：各处 vite config 只是整体 spread，不会报错；CI 也看不出来（`scripts/**`
 * 不在任何 tsconfig 的检查范围内）——于是漂移静静留着，直到某段代码直接读
 * `versionDefine.__PKG_NAME__` 才在类型层报错，而那时它已经错了很久。
 *
 * 本用例把「两个镜像的键集合必须相等」钉住：任一侧新增键而另一侧漏了，立刻红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(root, "scripts/vite-version-define.mjs");
const declPath = resolve(root, "scripts/vite-version-define.d.mts");

/** 运行时对象实际有哪些键——直接 import，不解析源码。 */
async function runtimeKeys(): Promise<string[]> {
  const mod = (await import(runtimePath)) as { versionDefine: Record<string, unknown> };
  return Object.keys(mod.versionDefine).sort();
}

/** 声明里写了哪些键——从 `readonly <name>: string;` 形态里取。 */
function declaredKeys(): string[] {
  const source = readFileSync(declPath, "utf8");
  return [...source.matchAll(/readonly\s+(\w+)\s*:/g)].map((m) => m[1]!).sort();
}

describe("#45 versionDefine：运行时与类型声明不得漂移", () => {
  it("两侧键集合完全一致", async () => {
    const runtime = await runtimeKeys();
    const declared = declaredKeys();
    // fail-closed：任一侧解析不出键都判失败，否则「都为空」会 vacuous 通过
    expect(runtime.length, "运行时 versionDefine 应有键").toBeGreaterThan(0);
    expect(declared.length, "声明里应有 readonly 键").toBeGreaterThan(0);
    expect(declared, "声明与运行时的键不一致：新增 define 时忘了同步 .d.mts").toEqual(runtime);
  });

  it("当前确实定义了版本与包名两个注入", async () => {
    expect(await runtimeKeys()).toEqual(["__PKG_NAME__", "__VERSION__"]);
  });

  it("六个 vite config 用的都是同一份", async () => {
    // 逐个确认 import 指向同一个模块：镜像漂移的另一面是「有人复制了第二份定义」
    const configs = [
      "vite.config.ts",
      "vitest.config.ts",
      "tests/browser/jsapi-v4/vite.config.ts",
      "tests/browser/official-packages/vite.config.ts",
      "tests/browser/plugin-load-channel/vite.config.ts",
      "packages/bmap-vue/vite.config.build.ts",
      "packages/bmap-vue/vite.config.global.ts",
    ];
    for (const config of configs) {
      const source = readFileSync(resolve(root, config), "utf8");
      expect(source, `${config} 应从 vite-version-define 取注入`).toContain("vite-version-define");
      // 不允许内联自己的一份 define（那会绕过这道门禁）
      expect(source, `${config} 不该内联 __VERSION__ 字面量`).not.toMatch(/__VERSION__\s*:/);
    }
  });
});