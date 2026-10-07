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
import { PKG_DIR, releaseIdentityOf } from "./release-identity.mts";

const ROOT = resolve(import.meta.dirname, "..");

/** 发布包名，从 manifest 派生（发布身份迁移时无需改本脚本）。 */
const PKG = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(ROOT, PKG_DIR, "package.json"), "utf8")),
).name;

/** 匹配「从发布包导入」的 import 语句；包名里的 `/` 与 `-` 都按字面处理。 */
function importFromPkgRegex(): RegExp {
  const escaped = PKG.replace(/[.*+?^${}()|[\]\\-]/g, String.raw`\$&`);
  return new RegExp(
    String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]${escaped}(?:\/[\w-]+)?['"]`,
    "g",
  );
}

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
 * 剥掉示例里的注释，只留真实用法。
 *
 * 三种都要剥，缺一不可（第一版只剥了前两种，HTML 注释里的 `<Marker>`
 * 被当成了真实用法——负向用例直接把它抓了出来）：
 *   ① JS 块注释（slash-star … star-slash）
 *   ② 整行 JS 行注释（双斜杠开头）
 *   ③ **Vue / HTML 模板注释**（`<!-- … -->`，`<script setup>` 之外的模板区常用）
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * 从一段代码里抽「发布 API 面」的标识符：**导出名**，`import type` 也算。
 *
 * 口径是「示例宣称用了哪些公开 API」，不是「本地有哪些可用绑定」——别拿它判断
 * 模板能不能解析组件（那是 `runtimeImportsIn` 的事）。
 */
function packageImportsIn(code: string): Set<string> {
  const out = new Set<string>();
  for (const match of code.matchAll(importFromPkgRegex())) {
    for (const raw of match[1]!.split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * 从一段代码里抽**运行时导入**：本地名 → 导出名（未别名时两者相同）。
 *
 * 供 `selfContainedBlocks()` 判「模板里的组件能不能解析」：本地名判可用性、导出名认
 * 它是不是本库组件（`<BMap />` 配 `Map as BMap` 时两者不同名）。
 *
 * 排除规则（#190 二轮评审 P2 各配一个反例）：
 *
 * 1. **语句级 type-only**：`import type { Map } from '<pkg>'` 整条不产生绑定，
 *    `<Map />` 依然解析不了。`importFromPkgRegex` 已**吃掉** `type` 关键字
 *    （`(?:type\s+)?`），所以判据看 `match[0]` 自己的开头，而不是它前面
 *    （看前面永远是空的，实测踩过）；
 * 2. **内联 type 修饰符**：`import { type Point, Map }` 里只有 `type` 那个不产生绑定；
 * 3. 别名取**本地名**：`import { Map as BMap }` ⇒ `BMap → Map`。
 */
export function runtimeImportsIn(code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of code.matchAll(importFromPkgRegex())) {
    if (/^import\s+type\s/.test(match[0])) continue;
    for (const raw of match[1]!.split(",")) {
      const spec = raw.trim();
      if (!spec || /^type\s+/.test(spec)) continue;
      const parts = spec.split(/\s+as\s+/);
      const exported = parts[0]!.trim();
      const local = (parts[1] ?? parts[0])!.trim();
      if (local) out.set(local, exported);
    }
  }
  return out;
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
    const code = stripComments(block[2]!);
    // import { a, b as c } from '<pkg>' / '<pkg>/advanced' / '<pkg>/ui-kit'
    //
    // 包名**从 manifest 派生**（`scripts/release-identity.mts`）：写死 `'bmap-vue'`
    // 的话，发布身份迁到 `@mangax/bmap-vue` 之后这个正则一条都匹配不上，门禁会
    // 静默退化成「0 个标识符要校验」——那正是它本该防的那类假绿（PR 评审实测：
    // 迁移后 `createBMapPlugin` 从校验集合里消失，报告仍显示 OK）。
    for (const name of packageImportsIn(code)) imports.add(name);
    // 模板里的组件标签
    for (const match of code.matchAll(/<([A-Z][\w]*)\b/g)) {
      tags.add(match[1]!);
    }
  }
  return { imports, tags };
}

/** 一处「示例不自足」：某个代码块在模板里用了 `<tag>`，却没在**同一个块内**导入它。 */
export interface NotSelfContained {
  /** 该文件里第几个被扫描的 `vue` / `html` 代码块（从 1 开始）。 */
  block: number;
  /** 模板里用到、但本块没导入的组件名。 */
  tag: string;
}

/**
 * 每个 `vue` / `html` 代码块必须**自足**：模板里用到的本库公开组件，必须在**同一个块内**
 * 被导入。
 *
 * ## 为什么必须静态查，而不是靠消费 fixture 编译（#190 评审 P1 实测）
 *
 * 入包 README 的「子树显式定义」示例曾用 `<Map>` 却只导入了
 * `BMapProvider, ZoomControl`。把它放进消费 fixture 跑 `vue-tsc --noEmit`：
 *
 * - 未声明的 **prop**（`<BMapProvider :ak>`）→ 退出码 0（落进 `$attrs`）；
 * - 模板里未解析的**组件标签**（`<DefinitelyNotARealComponent />`）→ 退出码 **0**；
 * - 未定义的**脚本标识符**（`const x = notDefinedAnywhere()`）→ 退出码 2 ✅。
 *
 * 也就是说 `vue-tsc` 只检查脚本标识符，**不检查组件标签是否解析**。所以「拆成独立
 * fixture/SFC」能挡住脚本符号的跨块泄漏，却挡不住本票这类「模板用了 `<Map>` 但没导入」。
 * 唯一有判别力的落点是**文本层**——就是这里。
 *
 * 判据只认「发布声明面里存在的名字」（`surface`）：`<div>` 这类原生标签与
 * `<Badge>` 这类 VitePress 组件不在集合里，不参与判定，避免噪音。
 *
 * 「在本块内导入」必须按**运行时绑定**判，不能按导出名（二轮评审 P2 的两个反例）：
 * `import type { Map }` 不产生绑定、`import { Map as BMap }` 的本地名是 `BMap`。
 * 组件名与导出名不同名时（`<BMap />` 配 `Map as BMap`），用**导出名**去认它是不是
 * 本库组件，用**本地名**判它是否可用。
 *
 * 只扫 `vue` / `html` 块：`ts` 块没有模板，不适用。
 */
export function selfContainedBlocks(markdown: string, surface: Set<string>): NotSelfContained[] {
  const out: NotSelfContained[] = [];
  let block = 0;
  for (const b of markdown.matchAll(/```([\w-]*)\n([\s\S]*?)```/g)) {
    if (!/^(vue|html)$/.test(b[1]!)) continue;
    block += 1;
    const code = stripComments(b[2]!);
    // 模板区：`<template>…</template>`；没有 `<template>` 的 html 片段退化为整块。
    const template = /<template>([\s\S]*?)<\/template>/.exec(code)?.[1] ?? code;
    // 本地名 → 导出名（未别名时两者相同）。组件既可能以导出名出现，也可能以别名出现。
    const exportedByLocal = runtimeImportsIn(code);
    for (const m of template.matchAll(/<([A-Z][\w]*)\b/g)) {
      const tag = m[1]!;
      // 这个标签是不是本库组件？先看它本身，再看它是不是某个导入的本地别名。
      const isLibraryComponent = surface.has(tag) || surface.has(exportedByLocal.get(tag) ?? "");
      if (!isLibraryComponent) continue; // 原生 / 第三方组件不参与
      if (!exportedByLocal.has(tag)) out.push({ block, tag });
    }
  }
  return out;
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
  const perSurface: { id: string; file: string; text: string; snippet: ExtractedSnippet }[] =
    SNIPPET_SURFACES.map(({ id, file }) => {
      const text = read(file);
      return { id, file: resolve(readBase, file), text, snippet: extractSnippet(text) };
    });

  const unknown: string[] = [];
  for (const { id, file, snippet } of perSurface) {
    for (const name of [...snippet.imports, ...snippet.tags]) {
      if (!surface.has(name)) unknown.push(`  ${file} [${id}]: ${name}（不在发布声明面里）`);
    }
  }

  // 第二层：每个 `vue` / `html` 代码块必须**自足**（见 `selfContainedBlocks` 的文件头，
  // 那里记着「为什么 `vue-tsc` 挡不住这一类」的实测）。
  const notSelfContained = perSurface.flatMap(({ id, file, text }) =>
    selfContainedBlocks(text, surface).map(
      (p) => `  ${file} [${id}] 第 ${p.block} 个代码块: <${p.tag}> 在本块内没有 import`,
    ),
  );

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
  if (notSelfContained.length > 0) {
    console.error(
      `snippet consistency gate FAILED: ${notSelfContained.length} 处示例代码块不自足` +
        "（模板用了本库组件却没在本块内 import）。",
    );
    for (const line of notSelfContained) console.error(line);
    console.error(
      "读者可能没有全局注册组件（没装 createBMapPlugin），照抄会得到未解析的组件。" +
        "每个代码块都要能**独立复制运行**——在本块内补上 import。",
    );
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
      `（${[...union].sort().join(", ")}），且每个 vue/html 代码块都自足。`,
  );
  return 0;
}

process.exitCode = main();
