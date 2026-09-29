/**
 * 组件总览页与 manifest 无漂移。
 *
 * **为什么要有**：总览页的「56 个组件」和下面那张分组表是**手写**的，而真值
 * （`docs/.vitepress/component-index.json`，由 `packages/bmap-vue/src/manifest.ts`
 * 生成）每次加组件都会变。实测已经漂过两轮：写 52 时真实是 56，且
 * `GroundPoint` / `TextLayer` / `PolygonLayer` / `PolylineLayer` 四个组件
 * 在总览页里**一个都没列**——读者按目录找不到它们，只能知道「官方有」。
 *
 * 判据两条，都要：
 *   ① 总览页声明的组件数 == manifest 真值；
 *   ② manifest 里**每个**组件名都在总览页出现（漏一个就红）。
 * 只查 ① 抓不到「数量对了但漏列」，只查 ② 抓不到「正文里的数字没改」——
 * 这两类漂移都真实发生过，所以两条都要。
 *
 * 数字判据刻意写成「`N 个组件`」这个形态，而不是全文搜 `56`：
 * 全文搜数字会撞上 SDK 版本号、issue 编号和 props 表格。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_JSON = join(ROOT, "docs/.vitepress/component-index.json");
const OVERVIEW = join(ROOT, "docs/zh-CN/components/index.md");

interface ComponentIndex {
  components: string[];
}

function fail(...lines: (string | string[])[]): never {
  process.stderr.write(`${lines.flat().join("\n")}\n`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_JSON, "utf8")) as ComponentIndex;
const truth = new Set(index.components);
const overview = readFileSync(OVERVIEW, "utf8");

if (truth.size === 0) fail(["组件总览门禁空转：component-index.json 里没有组件，先跑 pnpm generate:manifest"]);

const problems: string[] = [];

/**
 * 总览页的**组件表行**里出现的组件名。
 *
 * 刻意只认 `| [Name](/zh-CN/...) |` 这种行首锚定的形态，且**不**把正文散文里的
 * 反引号名算进来。这不是偷懒，是必需的：页面末尾那个「官方目录里我们没有」的
 * tip 块会提到 `GroundPoint`，一旦散文也算「已列出」，删掉组件表里那一行门禁照样绿
 * ——变异测试真的这么试过。判据必须锚定在**读者实际找组件的那张表**上。
 *
 * `ContextMenu` 那一行把 `MenuItem` / `MenuSeparator` 写在用途列的散文里，
 * 所以这一行额外把两个名字挂上——它们确实是这个总览页向读者承诺的组件。
 */
const listed = new Set<string>();
for (const line of overview.split("\n")) {
  if (!/^\|\s*\[/.test(line)) continue;
  for (const m of line.matchAll(/\[([A-Z][A-Za-z0-9]*)\]\(\/zh-CN\//g)) listed.add(m[1]);
  // ContextMenu 行：`| [ContextMenu](...) | 上下文菜单（含 `MenuItem` / `MenuSeparator`） |`
  if (line.includes("[ContextMenu]")) {
    listed.add("MenuItem");
    listed.add("MenuSeparator");
  }
}

const missing = [...truth].filter((n) => !listed.has(n)).sort();
if (missing.length > 0) {
  problems.push(
    `以下组件在 manifest 里，但组件总览页没提到（读者按目录找不到它们）：\n` +
      missing.map((n) => `  - ${n}`).join("\n") +
      `\n  加到 docs/zh-CN/components/index.md 对应的分组表里。`,
  );
}

const declared = /(\d+)\s*个组件/.exec(overview);
if (!declared) {
  problems.push(`组件总览页没有「N 个组件」这句，无法核对——要么补上，要么这行被改写了。`);
} else if (Number(declared[1]) !== truth.size) {
  problems.push(
    `组件总览页写「${declared[1]} 个组件」，manifest 实际是 ${truth.size} 个。`,
  );
}

if (problems.length > 0) {
  fail(
    [
      ...problems,
      "",
      "真值来源：packages/bmap-vue/src/manifest.ts",
      "          → pnpm generate:manifest → docs/.vitepress/component-index.json",
    ].join("\n"),
  );
}

process.stdout.write(
  `组件总览无漂移：${truth.size} 个组件全部列出，声明数字与 manifest 一致\n`,
);
