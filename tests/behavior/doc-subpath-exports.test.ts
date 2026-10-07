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
import { PKG_DIR, releaseIdentityOf } from "../../scripts/release-identity.mts";

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

  it("./volar 出口指向真实存在的 d.ts 声明（只断言 manifest，不读 gitignored 文件）", () => {
    // 刻意**不读 `packages/bmap-vue/volar.d.ts`**。它是 gitignore 的生成物，而
    // `manifest-check.test.ts` 会 `rmSync` 它；多个 test file 并行时，任何「读它 / 判断它
    // 存在」的判据都有 TOCTOU 窗口——上两轮修的正是这个，但两次都只是**缩小**了窗口：
    // `ensureVolarDts()` 返回之后，另一个 worker 仍可能把它删掉。
    //
    // 因此 unit 层只断言 **manifest 形状**：出口在、指向 `volar.d.ts`、`files` 声明了它。
    // 「文件真的在 tarball 里」由 `check:pack-contents` 与 CI 的 package job 负责——
    // 那才是真实消费路径，也不受测试调度影响。
    const pkg = JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, { types?: string }>;
      files?: string[];
    };
    const volar = pkg.exports["./volar"];
    expect(volar, "exports 必须开 ./volar，否则安装页承诺的 Volar 用法无效").toBeTruthy();
    expect(volar!.types, "./volar 必须指向 volar.d.ts").toBe("./volar.d.ts");
    expect(pkg.files ?? [], "files 必须包含 volar.d.ts，否则它不会跟着包发出去").toContain(
      "volar.d.ts",
    );
  });

  /**
   * `./styles.css` 的**形状**契约（#189）。
   *
   * 只断言「出口在」是不够的——这条出口有三个成员，缺任何一个都会让
   * 「`<Autocomplete>` 有样式」在某个消费路径上不成立：
   *
   * 1. **`exports["./styles.css"]` 指向那个 CSS**：缺了它 Node 报
   *    `ERR_PACKAGE_PATH_NOT_EXPORTED`（实测），包管理器消费方根本引用不到；
   * 2. **`files` 按文件名声明了它**：否则它只是 `dist` 目录项的副产物，
   *    `check:pack-contents` 会判 `undeclared-css`；
   * 3. **`sideEffects` 把 CSS 与 JS 分开**：JS 必须保持可摇（`advanced-only` 的闭包
   *    承诺依赖它），而 CSS 必须被声明成有副作用。
   *
   * ⚠️ 关于第 3 条的事实边界（实测，不要写成比证据更强的话）：Vite 7 与 8 上
   * `sideEffects: false` / `["<css>"]` / `[]` 三种写法**都**保留了
   * `import '<pkg>/styles.css'` 产出的 CSS 资产——本库**没有任何 JS import 那份 CSS**，
   * 它只有消费方那一条纯副作用 import，而 Vite 不按包的 `sideEffects` 摇掉入口自身的
   * 副作用 import。所以这里断言的是「声明正确」这件**契约**，不是「Vite 会因此改判」。
   * 声明成 `true` 则是有实证代价的：它会让 JS 失去 tree-shaking。
   */
  it("./styles.css 出口、files 声明与 sideEffects 三者一致（缺一个就静默失效）", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, string>;
      files?: string[];
      sideEffects?: boolean | string[];
    };
    const target = pkg.exports["./styles.css"];
    expect(target, "exports 必须开 ./styles.css，否则包管理器消费方引用不到样式").toBe(
      "./dist/bmap-vue.css",
    );

    const filesEntry = target.replace(/^\.\//, "");
    expect(pkg.files ?? [], `files 必须按文件名声明 ${filesEntry}，否则是构建副产物`).toContain(
      filesEntry,
    );

    // `sideEffects` 必须**按展开后的路径**命中它。写 `"*.css"` 之类的 glob 在这里是
    // 假的：判据读的是 manifest 字面量，而打包器读的是同一份字面量——但那条 glob 是否
    // 被某个打包器支持是实现细节，本仓的判据是「显式列出这一个文件」。
    expect(
      pkg.sideEffects,
      "sideEffects 不是数组：`false` 让样式声明缺位，" +
        "`true` 会让全库失去 tree-shaking（advanced-only 的闭包承诺随之失效）",
    ).toBeInstanceOf(Array);
    expect(
      pkg.sideEffects as string[],
      `sideEffects 必须命中 ${filesEntry}，否则样式副作用声明缺位`,
    ).toContain(target);

    // 反向：`sideEffects` 只放样式。写成宽泛的目录 / 通配会把 JS 也标成有副作用，
    // 于是 `advanced-contract` 那条「只用 ./advanced 不拉进组件」的承诺静默失效。
    for (const entry of pkg.sideEffects as string[]) {
      expect(entry, `sideEffects 里的 ${entry} 不是 CSS：JS 必须保持可 tree-shake`).toMatch(/\.css$/);
    }
  });

  /**
   * 出口面**只**开放了这一个样式子路径（#189 的边界：「只开放一个必要子路径」）。
   *
   * 用 `"./*.css"` 这类**后缀模式**出口代替精确子路径会让包内任意 CSS 都可解析
   * （Node 实测：模式出口对 `dist/` 下的任意 `.css` 都生效），出口面就此从
   * 「一个承诺」变成「一个通配」。判据是 exports 的键必须**没有 `*`**。
   */
  it("样式出口是精确子路径，不是后缀模式（否则任意 CSS 都变成公共面）", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    const wildcards = Object.keys(pkg.exports).filter((key) => key.includes("*"));
    expect(
      wildcards,
      `exports 里出现通配出口：${wildcards.join(", ")} —— 出口面白名单会因此静默放宽`,
    ).toEqual([]);
  });
});