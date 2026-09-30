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
    // 先掐掉注释：示例注释里常提到「可由 <BMapProvider> 提供」这类旁白，
    // 那是**散文**不是用法，拿它当 API 面会把判据变成噪音。
    //
    // 三种都要剥，缺一不可（第一版只剥了前两种，HTML 注释里的 `<Marker>`
    // 被当成了真实用法——负向用例直接把它抓了出来）：
    //   ① JS 块注释 `/* … */`
    //   ② 整行 JS 行注释 `// …`
    //   ③ **Vue / HTML 模板注释** `<!-- … -->`（`<script setup>` 之外的模板区常用）
    const code = block[2]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/<!--[\s\S]*?-->/g, "");
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

/**
 * 读一个示例面文件。`base` 缺省是仓库根——`--dir` 模式换成夹具目录。
 *
 * 用 `resolve` 而非 `join`：后者遇到绝对路径会**丢弃**前缀，拼出
 * `<ROOT>/<夹具绝对路径>` 这种把工作目录和临时目录接在一起的诡异路径，
 * 症状是 ENOENT，排查很费时间。
 */
let readBase = ROOT;
function read(name: string): string {
  return readFileSync(resolve(readBase, name), "utf8");
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

/**
 * `--dir <path>`：把三处示例面换成一个目录下的同名文件。
 *
 * **为什么要有**：这道门禁的失效方式是**恒绿**——抽取逻辑写坏（抓不到任何名字）
 * 时真实树照样通过（真实三处的形状恰好完全相等，弱化判据不会被发现）。
 * 没有入口就注入不了合成输入，也就永远做不了变异测试。
 *
 * 注意它换的**不只是路径**：读取基准 `readBase` 也要跟着换，否则 `read()` 仍会
 * 拿 `ROOT` 去拼夹具里的相对路径（踩过，报错是一串拼接出来的怪异 ENOENT 路径）。
 */
function main(): number {
  const dirFlag = process.argv.indexOf("--dir");
  const root = dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined;
  if (dirFlag >= 0 && !root) {
    console.error("--dir 需要一个路径参数");
    return 2;
  }

  const surface = publicSurfaceIdentifiers();
  if (surface.size === 0) {
    console.error(
      "snippet consistency gate FAILED: 读不到 packages/bmap-vue/dist/*.d.ts——" +
        "示例的判据是「标识符必须真的在发布声明面里」，没有声明面就没有判据。请先 pnpm build:package。",
    );
    return 1;
  }

  if (root) readBase = resolve(root);
  const perSurface: { id: string; file: string; snippet: ExtractedSnippet }[] =
    SNIPPET_SURFACES.map(({ id, file }) => ({
      id,
      file: resolve(readBase, file),
      snippet: extractSnippet(read(file)),
    }));

  const unknown: string[] = [];
  for (const { id, file, snippet } of perSurface) {
    for (const name of [...snippet.imports, ...snippet.tags]) {
      if (!surface.has(name)) unknown.push(`  ${file} [${id}]: ${name}（不在发布声明面里）`);
    }
  }

  // 三处必须展示**同一组**标识符：判据是「每一处都要包含三处的并集」，
  // 因此任何一处多出或缺少名字都会红。
  //
  // 早先这里写的是「判据是包含关系而不是完全相等，文档站多两个名字是合理的扩展，
  // 不是漂移」——**与实现相反**，而当时真实树恰好三处完全相等，所以那句自我辩解
  // 从来没被任何测试验证过。去掉重复入口后，真树真的相等了
  // （`BMapProvider` 曾只出现在 quick-start 的注释里，被 HTML 注释剥离修复暴露出来，
  // 已补上真实示例）；负向用例现在也钉住「某处少一个即红」与「只有一处多一个也红」。
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
