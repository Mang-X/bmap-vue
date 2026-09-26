/**
 * 三处 API 示例一致性门禁（issue #141）
 *
 * 「README / npm 包 / 文档站三处 API 示例一致」是 issue 明确列出的自动门禁。
 * 这道脚本管的是**示例里出现的公开 API 名字**：三处展示的是同一个库的同一套用法，
 * 一处写 `<Map>` 另一处写一个并不存在的名字，读者会照着写错。
 *
 * ## 判据为什么是「名字必须真的存在」而不是「三处文本相等」
 *
 * 「三处文本相等」是个**没有区分力**的判据：三处都写错时它照样绿，而且为了同步
 * 措辞差异就得锁死文案——文档一改措辞就红，与「示例一致」这件事本身无关。
 *
 * 这里取的是更有意义的那条：**示例里用到的每个标识符，都必须能在真实的发布声明面
 * （`packages/bmap-vue/dist/*.d.ts`）里找到**。这样：
 * - 示例写错名字 → 红（这是「示例一致」真正要防的事）；
 * - 三处措辞不同但都对 → 绿（不该因为文案风格差异红）。
 *
 * 另外判**同一组示例在三处的 API 形状一致**：抽出的标识符集合必须完全相同，
 * 否则「A 文档用 `useLocalSearch`、README 还在用旧写法」这种回潮会漏过去。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** 三处示例面。文件名相对仓库根。 */
export const SNIPPET_SURFACES = [
  { id: "readme", file: "README.md" },
  { id: "package-readme", file: "packages/bmap-vue/README.md" },
  { id: "docs", file: "docs/zh-CN/guide/quick-start.md" },
] as const;

/** 抽示例时跳过的代码块语言（bash/json 不是 API 示例）。 */
const CODE_LANGS_OF_INTEREST = /^(vue|ts|tsx|javascript|jsx)?$/;

interface ExtractedSnippet {
  /** 从 `from 'bmap-vue'`（含子路径）导入的标识符。 */
  imports: Set<string>;
  /** 模板里以 `<Name` 形式用到的组件标签。 */
  tags: Set<string>;
}

/**
 * 抽出一个文件里的 `bmap-vue` 用法。
 *
 * 只认**从 `bmap-vue` 导入**的名字——那是示例宣称的公开 API 面。像 `Point` 这种
 * `import type { Point } from 'bmap-vue'` 也在内（它是导出的类型）。
 */
export function extractSnippet(markdown: string): ExtractedSnippet {
  const imports = new Set<string>();
  const tags = new Set<string>();

  for (const block of markdown.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)) {
    if (!CODE_LANGS_OF_INTEREST.test(block[1]!)) continue;
    // 先掐掉行注释与块注释：示例注释里常提到「可由 <BMapProvider> 提供」这类
    // 旁白，那是**散文**不是用法，拿它当 API 面会把判据变成噪音。
    const code = block[2]!.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    // import { a, b as c } from 'bmap-vue' / 'bmap-vue/advanced' / 'bmap-vue/ui-kit'
    for (const match of code.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]bmap-vue(?:\/[\w-]+)?['"]/g,
    )) {
      for (const raw of match[1]!.split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name) imports.add(name);
      }
    }
    // 模板里的组件标签
    for (const match of code.matchAll(/<([A-Z][\w]*)\b/g)) {
      tags.add(match[1]!);
    }
  }
  return { imports, tags };
}

function read(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

/** 发布声明面里出现过的全部标识符（组件 / 函数 / 类型 / 常量）。 */
function publicSurfaceIdentifiers(): Set<string> {
  const out = new Set<string>();
  const dts = join(ROOT, "packages/bmap-vue/dist");
  for (const file of ["index.d.ts", "advanced.d.ts", "ui-kit.d.ts", "plugins.d.ts", "resolver.d.ts"]) {
    let text: string;
    try {
      text = readFileSync(join(dts, file), "utf8");
    } catch {
      // dist 不存在（例如还没跑 build:package）——跳过，不在这里报错，
      // 让调用方决定要不要把它当失败。真正的门禁命令跑在 build 之后。
      continue;
    }
    for (const match of text.matchAll(
      /declare\s+(?:abstract\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      out.add(match[1]!);
    }
    // 直接 re-export 的名字（`export { X }` / `export declare const X`）
    for (const match of text.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
      for (const raw of match[1]!.split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "");
        if (name) out.add(name);
      }
    }
  }
  return out;
}

function main(): number {
  const surface = publicSurfaceIdentifiers();
  if (surface.size === 0) {
    console.error(
      "snippet consistency gate FAILED: 读不到 packages/bmap-vue/dist/*.d.ts——" +
        "示例的判据是「标识符必须真的在发布声明面里」，没有声明面就没有判据。请先 pnpm build:package。",
    );
    return 1;
  }

  const perSurface: { id: string; file: string; snippet: ExtractedSnippet }[] = SNIPPET_SURFACES.map(
    ({ id, file }) => ({ id, file, snippet: extractSnippet(read(file)) }),
  );

  const unknown: string[] = [];
  for (const { id, file, snippet } of perSurface) {
    for (const name of [...snippet.imports, ...snippet.tags]) {
      if (!surface.has(name)) unknown.push(`  ${file} [${id}]: ${name}（不在发布声明面里）`);
    }
  }

  // 三处必须展示**同一组**标识符，且**一个都不能少**。判据是「包含关系」而不是
  // 「完全相等」：README 与包 README 展示同一份最小示例，文档站讲的是同一份示例
  // 外加按需导入的变体（多两个名字是合理的扩展，不是漂移）。真正要抓的是
  // 「某一份少写了另一个已经有了的名字」——那说明有一处落后了。
  const shapes = perSurface.map(({ id, snippet }) => ({
    id,
    names: new Set([...snippet.imports, ...snippet.tags]),
  }));
  // 以**各处的并集**为基准：任何一处缺少并集里的某个名字，就是该处没跟上。
  const union = new Set(shapes.flatMap((s) => [...s.names]));
  const shapeDrift = shapes.flatMap((s) =>
    [...union]
      .filter((name) => !s.names.has(name))
      .map((name) => `  ${s.id}: 缺少 ${name}`),
  );

  if (unknown.length > 0) {
    console.error(`snippet consistency gate FAILED: ${unknown.length} 个标识符不在发布声明面里。`);
    for (const line of unknown) console.error(line);
    console.error("示例必须只用真实的公开 API——写错名字的示例比没有示例更糟。");
    return 1;
  }
  if (shapeDrift.length > 0) {
    console.error("snippet consistency gate FAILED: 三处示例的 API 形状不一致（某些标识符只在部分面出现）。");
    for (const line of shapeDrift) console.error(line);
    return 1;
  }

  const n = union.size;
  console.log(
    `snippet consistency gate OK: ${perSurface.length} 处示例的 ${n} 个标识符都在发布声明面里且形状一致` +
      `（${[...union].sort().join(", ")}）。`,
  );
  return 0;
}

process.exitCode = main();
