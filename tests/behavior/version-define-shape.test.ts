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
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

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

function* allFilesUnder(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* allFilesUnder(full);
    else yield full;
  }
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

  it("全仓每个消费 define 的 config 都从这一份取，且不内联自己的副本", async () => {
    // **扫全仓而不是维护名单**：上一版列了 7 个，漏了 docs / playground /
    // performance / live-performance 四处——名单本身就是它自己会漂移的那类事实。
    // 改成「凡是 import 了 vite-version-define 的文件都逐一核对」之后，新增 config
    // 自动纳入检查，不需要有人记得改这里。
    const configs = [...allFilesUnder(root)]
      .filter((f) => /\.(ts|mts|mjs)$/.test(f) && !f.startsWith("scripts/"))
      .filter((f) => readFileSync(f, "utf8").includes("vite-version-define"))
      .map((f) => relative(root, f))
      .sort();

    // fail-closed：扫不到任何 config 时「全部合规」是 vacuous 的
    expect(configs.length, "应至少找到若干消费 versionDefine 的 config").toBeGreaterThan(0);

    for (const config of configs) {
      const source = readFileSync(resolve(root, config), "utf8");
      // 不允许内联自己的一份 define：那是「复制第二份定义」，会让这道门禁失效
      expect(source, `${config} 不该内联 __VERSION__ 的字面量定义`).not.toMatch(/__VERSION__\s*:/);
      expect(source, `${config} 不该内联 __PKG_NAME__ 的字面量定义`).not.toMatch(
        /__PKG_NAME__\s*:/,
      );
    }
  });
});