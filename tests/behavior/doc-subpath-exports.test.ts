/**
 * 文档承诺的 `<pkg>/<subpath>` 必须真的能从发布包解析（#45 评审 P1）
 *
 * 这道门禁存在的原因是一次**已经实证**的发布缺陷：
 *
 * 安装页教用户写 `"types": ["@mangax/bmap-vue/volar"]`，而 `exports` 里没有 `./volar`
 * ——于是 TypeScript 报 `TS2688: Cannot find type definition file`。用仓库当前的包
 * 形状 + TypeScript 5.8.3 + `moduleResolution: bundler` 可稳定复现。
 *
 * 这正是 issue #158 当初标注的「Volar 可能是假承诺」的物理成因：README 承诺了自动
 * 补全，而那个承诺在真实消费侧不成立。**文档里的 specifier 不是散文，是契约。**
 *
 * 判据刻意覆盖全部 `<pkg>/...` 形态而不是只盯 `./volar`：将来文档再写一个
 * `bmap-vue/whatever`，没有出口时应当同样变红。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PKG_DIR, ensureVolarDts, releaseIdentityOf } from "../../scripts/release-identity.mts";

const root = resolve(import.meta.dirname, "../..");
const PKG = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")),
).name;

/** 文档面：README + 包 README + 文档站（ADR 与 changelog 是历史，不算发布面）。 */
const DOC_FILES = [
  "README.md",
  "packages/bmap-vue/README.md",
  ...collectDocs(resolve(root, "docs/zh-CN")),
];

function collectDocs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectDocs(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 从文档里抽出所有 `<pkg>/<subpath>` 形态的 specifier。 */
function specifiersIn(source: string): string[] {
  const escaped = PKG.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return [
    ...new Set(
      [...source.matchAll(new RegExp(String.raw`${escaped}(/[A-Za-z0-9._-]+)`, "g"))].map(
        (m) => m[1]!,
      ),
    ),
  ].sort();
}

describe("#45 文档承诺的子路径必须能从发布包解析", () => {
  it("文档里出现的每个 <pkg>/<subpath> 都在 exports 里", () => {
    const exportsMap = (
      JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
        exports: Record<string, unknown>;
      }
    ).exports;

    const problems: string[] = [];
    let checked = 0;

    for (const file of DOC_FILES) {
      const source = readFileSync(file, "utf8");
      for (const subpath of specifiersIn(source)) {
        checked += 1;
        const exportKey = `.${subpath}`;
        if (!(exportKey in exportsMap)) {
          problems.push(`${file}: 文档写了 \`${PKG}${subpath}\`，但 exports 里没有这个子路径`);
        }
      }
    }

    // fail-closed：一个 specifier 都没扫到时，「全部合规」是 vacuous 的
    expect(checked, '文档里应至少出现一个 <pkg>/<subpath> 形态').toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("安装页承诺的 Volar 用法可解析（这条缺陷曾真实存在）", () => {
    // 单独点名：安装页那段 `compilerOptions.types` 是用户直接复制的配置，
    // 解析不了就是「按文档配了却没用」。
    const exportsMap = (
      JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
        exports: Record<string, unknown>;
      }
    ).exports;
    expect(Object.keys(exportsMap), "exports 必须开 ./volar，否则安装页的 Volar 配置无效").toContain(
      "./volar",
    );
  });

  it("exports 的每个子路径都在包里真实存在（出口不能指向不存在的文件）", () => {
    // 出口指向缺失文件时，用户会拿到「解析成功但内容为空」的声明——比解析失败更难查。
    const manifest = JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    // 自行保证前置：`volar.d.ts` 是 gitignore 的生成物，干净检出时不存在。
    // 此前依赖 CI workflow 恰好先跑了 manifest 步骤——门禁依赖 workflow 顺序，
    // 意味着顺序是巧合而非契约（#45 评审 P2）。
    ensureVolarDts(root);
    const volarPath = resolve(root, PKG_DIR, "volar.d.ts");
    const generated = existsSync(volarPath);
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (subpath === "./package.json") continue;
      const types = (target as { types?: string } | string)?.types;
      const file = typeof types === "string" ? types.replace(/^\.\//, "") : null;
      if (!file) continue;
      if (file === "volar.d.ts") {
        // 该文件是 gitignore 的生成产物；`check:pack-contents` 保证真正发布时它在包里。
        expect(generated, "volar.d.ts 未生成（跑 pnpm generate:manifest）").toBe(true);
      } else {
        expect(existsSync(resolve(root, PKG_DIR, file)), `${subpath} 指向不存在的 ${file}`).toBe(true);
      }
    }
  });
});