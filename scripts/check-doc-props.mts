#!/usr/bin/env node
/**
 * 文档 prop 名与真实声明面的差异扫描（issue #141）
 *
 * ## 为什么要有这道脚本
 *
 * 文档里的 prop 名是**手写**的，声明面是**生成**的。#165 把一批 prop 改名
 * （enableScrollWheelZoom → enableWheelZoom 等）并删掉三个「接收后静默丢弃」的 prop。
 * 文档不可能自动跟着改——而 **docs:typecheck 抓不到**：一个写错的 kebab prop
 * 落进模板后 Vue 只当作 `$attrs` 里的未知项，**不报错、也不生效**。
 * 第一版跑下来就抓到 9 处这样的死 prop。
 *
 * 这道脚本把「文档与示例里写出的 prop 名」逐个拿去和**真实声明面**对，报告对不上的。
 * 它**不修改任何东西**，只报告。
 *
 * ## 判据
 *
 * 一个 prop 名算「对得上」，当且仅当它在目标组件的 `*Props` 接口里存在
 * （接受 kebab-case：Vue 模板把 kebab 归一化成 camel 之后才匹配声明）。
 *
 * 它**只扫模板**——markdown 表格与正文里出现的 `<Map onReady>` 是**散文**
 * （描述等价物、列举写法），不是模板用法，拿去比会误报。
 *
 * 它**不**检查「官方有没有」——那是另一件事，由 `generate-api-diff` 的对照表负责。
 * 这里只管「文档写的与本库声明面是否一致」。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "packages/bmap-vue/dist");

export interface Mismatch {
  file: string;
  line: number;
  component: string;
  prop: string;
}

const read = (p: string): string => readFileSync(p, "utf8");

/**
 * 真正**发到 npm** 的那一份 README（`packages/bmap-vue/package.json#files` 里的
 * `README.md`），相对仓库根。
 *
 * 单独抽成常量而不是内联路径：它是 #190 的核心事实——「入包 README」与「根 README」
 * 是**两份不同的文件**，前者才是读者第一眼看到的。写成两处字面量，将来改名 / 改 `files`
 * 时就会悄悄漏掉一份（那正是本票的原始缺陷形状）。
 */
export const PACKAGE_README = "packages/bmap-vue/README.md";

/** 从 dist 声明面收集每个组件的 prop 名（组件名 → prop 集合）。 */
export function loadPropSurface(): Map<string, Set<string>> {
  const indexDts = join(DIST, "index.d.ts");
  if (!existsSync(indexDts)) {
    throw new Error(
      "check-doc-props: 读不到 packages/bmap-vue/dist/index.d.ts。" +
        "没有声明面就没有判据——先跑 pnpm build:package。",
    );
  }
  const dts = read(indexDts);
  const byComponent = new Map<string, Set<string>>();
  for (const m of dts.matchAll(/export declare interface (\w*Props)\s*\{([\s\S]*?)\n\}/g)) {
    const props = new Set<string>();
    for (const f of m[2]!.matchAll(/^\s{4}([a-zA-Z_]\w*)\??:/gm)) props.add(f[1]!);
    byComponent.set(m[1]!.replace(/Props$/, ""), props);
  }
  return byComponent;
}

/** Vue 模板把 kebab-case 归一化成 camelCase 之后才匹配声明。 */
export function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

const IGNORED = new Set([
  "ref", "key", "class", "style", "id", "slot", "is",
  "v-bind", "v-on", "v-if", "v-else", "v-else-if", "v-for", "v-show",
  "v-html", "v-text", "v-pre", "v-once", "v-memo",
]);

const COMPONENT_RE = /<([A-Z]\w*)((?:[^>"'\n]|"[^"]*"|'[^']*')*?)>/g;

/**
 * 掐掉 `="..."` / `='...'` 的**值**，只留属性名。
 *
 * 保护反引号：属性值里可能再出现引号（类型字面量 `image|'canvas'`），
 * 不保护会把字符串截断、把后半截当成新属性。
 */
export function attrNames(attr: string): string[] {
  const names: string[] = [];
  let cur = "";
  let tick = false;
  let i = 0;
  const flush = (): void => {
    const m = /(^|\s)(:?)([a-zA-Z][\w.-]*)\s*$/.exec(cur);
    if (m) names.push(m[3]!);
    cur = "";
  };
  while (i < attr.length) {
    const ch = attr[i]!;
    if (ch === "`") tick = !tick;
    const nextIsQuote = attr[i + 1] === '"' || attr[i + 1] === "'";
    if (!tick && ch === "=" && nextIsQuote && /(^|\s):?[a-zA-Z][\w.-]*\s*$/.test(cur)) {
      flush();
      const q = attr[i + 1]!;
      i += 2;
      while (i < attr.length && attr[i] !== q) i += 1;
      i += 1;
      cur += " ";
      continue;
    }
    cur += ch;
    i += 1;
  }
  flush();
  return names;
}

/** 只扫**模板**部分：`.vue` 扫全文，`.md` 只扫 ```vue 代码块。 */
export function templateRegions(file: string, text: string): string[] {
  if (file.endsWith(".vue")) return [text];
  return [...text.matchAll(/```(?:vue|html|ts|tsx|javascript|jsx)\n([\s\S]*?)```/g)].map(
    (m) => m[1]!,
  );
}

/** 扫一个文件里所有组件标签的 prop 名。 */
export function scanFile(file: string, text: string): Mismatch[] {
  const out: Mismatch[] = [];
  for (const region of templateRegions(file, text)) {
    for (const m of region.matchAll(COMPONENT_RE)) {
      const component = m[1]!;
      for (const raw of attrNames(m[2]!)) {
        if (raw.startsWith("v-") || raw.startsWith("@") || raw.startsWith("#") || IGNORED.has(raw)) {
          continue;
        }
        out.push({ file, line: text.slice(0, text.indexOf(region)).split("\n").length, component, prop: raw });
      }
    }
  }
  return out;
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collectFiles(p, acc);
    else if (e.endsWith(".md") || e.endsWith(".vue")) acc.push(p);
  }
  return acc;
}

/**
 * 被扫描的文件 / 目录（绝对路径）。
 *
 * 抽成函数而不是 `main()` 里的局部数组：用例要能**直接断言扫描面**，而不是靠
 * 「把路径删了测试仍然绿」这种假证据（#190 评审 P1——原先那条用例只是读了
 * 入包 README 的文本，即使 `PACKAGE_README` 从扫描面里被删掉它照样通过）。
 *
 * `PACKAGE_README` 必须在列（#190）：它是**真正发到 npm 的那一份**，而此前只扫根
 * README。于是同一个错误示例（`<BMapProvider :ak>`——Provider 没有这个 prop）在根
 * README 里被改正、在入包 README 里静静留着，门禁全程绿。判据是「文档写的与本库声明
 * 面是否一致」，与那段文档长在哪一份文件里无关。
 */
export function scanTargets(): string[] {
  return [
    join(ROOT, "docs/zh-CN"),
    join(ROOT, "docs/examples"),
    join(ROOT, "README.md"),
    join(ROOT, PACKAGE_README),
  ];
}

function main(): number {
  // `--dir <path>`：把扫描基准换成夹具目录（同名相对路径）。
  //
  // **为什么要有**（#190 二轮评审 P1）：正/负例若靠「改仓库里真实的
  // `packages/bmap-vue/README.md`、跑门禁、再改回来」，在 vitest 并行下就会和
  // 别的读同一份文件的用例竞争（实测：注入窗口内 `check:snippet-consistency`
  // 会因「代码块不自足」假红，算 `hasDist` 的那次 `runGate()` 也可能读到半写状态）。
  // 有了 `--dir`，负例在**临时目录**里复现，不再碰任何被跟踪的文件。
  //
  // 注意它换的**不只是扫描面**：`ROOT` 也要跟着换（`scanTargets()` 与错误信息里的
  // 相对路径都基于它），否则临时夹具里的文件会被拼成 `<真实ROOT>/<临时路径>`。
  const dirFlag = process.argv.indexOf("--dir");
  const dirRoot = dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined;
  if (dirFlag >= 0 && !dirRoot) {
    console.error("--dir 需要一个路径参数");
    return 2;
  }

  const surface = loadPropSurface();
  const roots = dirRoot
    ? scanTargets().map((p) => join(resolve(dirRoot), p.slice(ROOT.length + 1)))
    : scanTargets();
  const files = roots.flatMap((r) => (existsSync(r) && statSync(r).isDirectory() ? collectFiles(r) : [r]));

  const problems: Mismatch[] = [];
  let checked = 0;
  for (const file of files) {
    if (!existsSync(file)) continue; // 夹具目录只需要放它要验的那几个文件
    for (const m of scanFile(file, read(file))) {
      const props = surface.get(m.component);
      if (!props) continue; // 组件没有对应 *Props：不是「prop 名对不上」，不在本题范围
      checked += 1;
      if (!props.has(m.prop) && !props.has(camel(m.prop))) {
        problems.push({ ...m, file: file.replace((dirRoot ?? ROOT) + "/", "") });
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `check-doc-props FAILED: ${problems.length} 处 prop 名与真实声明面不符（已比对 ${checked} 处）。`,
    );
    for (const p of problems) console.error(`  ${p.file}:${p.line}  <${p.component} :${p.prop}>`);
    console.error(
      "文档与示例里写出的 prop 必须在该组件的 `*Props` 里真实存在" +
        "（Vue 会把 kebab 归一化成 camel）。写错**不会**报错、只会静默不生效，" +
        "所以要靠这道扫描兜住。",
    );
    return 1;
  }
  console.log(`check-doc-props OK: ${checked} 处 prop 名与声明面一致。`);
  return 0;
}

process.exitCode = main();
