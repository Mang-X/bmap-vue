/**
 * 文档内链与导航覆盖门禁（issue #141）
 *
 * ## 这道门禁补的是哪个洞
 *
 * `vitepress build` **已经**在 build 期校验页面级死链（`ignoreDeadLinks` 默认开），所以
 * 「`.md` 指向不存在的页面」这件事本来就会红。再写一遍它是重复门禁，两道门禁管同一个事实
 * 迟早漂移——本仓对 `docs/.vitepress/*.json` 就是这么处理的（归 `generate:*:check`，不重扫）。
 *
 * VitePress **不**校验的是这两件，本门禁只管这两件：
 *
 * 1. **锚点**：`[x](./guide/config#不存在的标题)` 在 build 期静默通过。实测
 *    `docs/zh-CN/hooks/useDrivingRoute.md` 指向本页一个不存在的 `#统一状态口径`，
 *    `docs:build` 全绿。锚点会随标题改一个字而腐烂，而且没有别的门禁看得见。
 * 2. **导航覆盖**：**反向**断言——`docs/zh-CN/**` 下每个内容页都被 sidebar 或 nav 收录。
 *    正向（sidebar 里每条都指向真实文件）由 build 间接兜住了；反向孤儿没有门禁，
 *    这正是 `docs/zh-CN/guide/errors.md` 曾经不在侧栏里长期没人发现的原因。
 *
 * 外链不校验（不联网）；`/adr/**` 这类指向仓库其它区域的链接只校验**文件存在**，
 * 不校验锚点（ADR 标题含 issue 号，改标题就断的锚点不值得当门禁）。
 *
 * ## slug 口径
 *
 * 必须与 VitePress 渲染出来的锚点一致，否则门禁会把好链接判成坏的。取自
 * `markdown-it-anchor` 的默认 slugify：小写、保留字母数字与 CJK、其余转连字符、空格转连字符、
 * 重复连字符压成一个。带引号包裹的 ATX 标题要剥掉引号。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isExcludedDocPath } from "./docs-brand-boundary.mts";

const ROOT = resolve(import.meta.dirname, "..");
const DOCS = resolve(ROOT, "docs");

export interface LinkProblem {
  file: string;
  line: number;
  kind: "dead-anchor" | "orphan-page" | "nav-target-missing";
  detail: string;
}

/** 收集 docs 下的内容页（.md），排除 ADR、生成物与依赖目录。 */
function collectDocPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      // `docs/node_modules` 是 pnpm 建的**符号链接**指向依赖包。`statSync` 会跟随它，
      // 于是递归会走出 docs/ 把整个 node_modules 的 README 收进来——必须先判链接再判目录。
      if (entry === "node_modules" || entry === ".vitepress") continue;
      const full = join(dir, entry);
      const rel = relative(ROOT, full).replace(/\\/g, "/");
      if (isExcludedDocPath(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.push(full);
    }
  };
  walk(DOCS);
  return out.sort();
}

/**
 * GitHub 风格 slug：与 `markdown-it-anchor` 的默认 slugify 对齐。
 *
 * 保留 Unicode 字母与数字（中文标题因此原样进锚点），其余压成 `-`。
 */
export function slugify(heading: string): string {
  return heading
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-");
}

/**
 * 锚点比对按**小写**做。
 *
 * 渲染出来的锚点一律是小写（`### GroundOverlayUrl` → `#groundoverlayurl`），
 * 但链接侧历史上写成 `#GroundOverlayUrl` 也能工作——因为浏览器与 VitePress 的
 * 取锚点比较是大小写不敏感的。因此这里两侧都小写后再比，否则会把一批**能跳转**
 * 的链接判成坏的（实测 `ground-overlay.md` / `useGeocodeDetail.md` 各一处）。
 */
function normalizeAnchor(anchor: string): string {
  return anchor.toLowerCase();
}

/** 一个页面里所有标题产生的锚点集合（重复标题会加 `-1` `-2` 后缀，这里也照样去重即可）。 */
export function anchorsOf(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const match of markdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    out.add(slugify(match[2]!));
  }
  return out;
}

/** 去掉行内代码与样式包裹，避免把 `**粗体**` 里的星号算进锚点。 */
function stripInline(target: string): string {
  return target.replace(/`([^`]*)`/g, "$1");
}

/**
 * 解析一条 markdown 链接的相对路径：把 cleanUrls 风格的「无后缀」还原成 `.md`。
 *
 * VitePress 开了 `cleanUrls`，所以站内链接常写成 `./config` 或 `/zh-CN/components/map`；
 * 两种都得能落到磁盘上的真实文件。
 */
export function resolveTarget(fromFile: string, pathPart: string): string | null {
  if (pathPart === "") return resolve(fromFile);
  const base = pathPart.startsWith("/")
    ? join(DOCS, pathPart)
    : resolve(dirname(fromFile), pathPart);
  if (statSync(base, { throwIfNoEntry: false })?.isFile()) return base;
  const withMd = `${base}.md`;
  if (statSync(withMd, { throwIfNoEntry: false })?.isFile()) return withMd;
  return null;
}

export function scanLinks(pages: readonly string[]): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsFor = (file: string): Set<string> => {
    let cached = anchorCache.get(file);
    if (!cached) {
      cached = anchorsOf(readFileSync(file, "utf8"));
      anchorCache.set(file, cached);
    }
    return cached;
  };

  for (const file of pages) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const link = stripInline(match[1]!);
        if (/^(?:https?:|mailto:|tel:|data:)/.test(link)) continue;
        const [rawPath, rawAnchor] = splitAnchor(link);
        if (rawAnchor === undefined) continue; // 纯页面链接由 vitepress build 负责
        const target = resolveTarget(file, rawPath);
        if (!target) continue; // 目标文件不存在 —— vitepress build 会红，这里不重复报
        const anchor = decodeURIComponent(rawAnchor);
        if (anchor.length === 0) continue;
        // ADR 锚点随标题漂移，不当门禁。
        if (relative(ROOT, target).replace(/\\/g, "/").startsWith("docs/adr/")) continue;
        if (!anchorsFor(target).has(normalizeAnchor(anchor)) && !anchorsFor(target).has(anchor)) {
          problems.push({
            file: rel,
            line: index + 1,
            kind: "dead-anchor",
            detail: `${link}（目标文件在，但标题锚点不存在）`,
          });
        }
      }
    });
  }
  return problems;
}

function splitAnchor(link: string): [string, string | undefined] {
  const at = link.indexOf("#");
  if (at === -1) return [link, undefined];
  return [link.slice(0, at), link.slice(at + 1)];
}

/**
 * 从 sidebar / nav 配置里抽出「读者能到达的页面路径」。
 *
 * 侧栏的写法是**分段**的：分组对象带 `base: "/zh-CN/components/control/"`，
 * 里面的 `link: "navigation"` 是**相对 base** 的。直接把 `link` 当绝对路径会判成孤儿——
 * 所以这里把每个分组的 `base` 与它内部的 `link` 合成。
 *
 * 这份解析刻意是**结构无关**的（按缩进块找 `base:`，块内找 `link:`）而不是 eval 配置：
 * 门禁不该执行被检查的代码。
 */
function navTargets(): string[] {
  const files = [
    resolve(DOCS, ".vitepress/configs/sidebar.config.zh.ts"),
    resolve(DOCS, ".vitepress/configs/nav.ts"),
  ];
  const out: string[] = [];
  for (const file of files) {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    // 键名在配置里既可能带引号也可能不带（`link:` 与 `"link":` 都出现过），两种都认。
    const key = (name: string): RegExp => new RegExp(String.raw`"?${name}"?:\s*"([^"]+)"`);
    let base = "";
    let baseIndent = -1;
    for (const line of lines) {
      const indent = /^(\s*)/.exec(line)?.[1].length ?? 0;
      // `base` 与 `items:` 同缩进，所以重置条件必须用**严格小于**：用 `<=` 会在
      // `items: [` 那一行就清掉 base，后面的 link 全成了裸名（判成孤儿）。
      // 只有缩进真的回退到 base 之上（下一个分组开始了）才收掉。
      if (baseIndent !== -1 && line.trim() !== "" && indent < baseIndent) {
        base = "";
        baseIndent = -1;
      }
      const baseMatch = key("base").exec(line);
      if (baseMatch) {
        base = baseMatch[1]!;
        baseIndent = indent;
        continue;
      }
      const linkMatch = key("link").exec(line);
      if (linkMatch) {
        const link = linkMatch[1]!;
        out.push(base && !link.startsWith("/") ? `${base}${link}` : link);
      }
    }
  }
  return out;
}

/**
 * 反向覆盖：每个内容页都要能从导航到达。
 *
 * 排除首页（`docs/index.md` / `docs/zh-CN/index.md`）与 `README.md`——它们是入口本身，
 * 不需要出现在侧栏里。
 */
export function scanOrphans(pages: readonly string[]): LinkProblem[] {
  const targets = navTargets();
  const problems: LinkProblem[] = [];
  for (const file of pages) {
    const rel = relative(DOCS, file).replace(/\\/g, "/");
    if (rel === "index.md" || rel === "README.md" || rel === "zh-CN/index.md") continue;
    const covered = targets.some((target) => {
      const clean = target.replace(/^\//, "").replace(/\.md$/, "").replace(/\/$/, "");
      const page = rel.replace(/\.md$/, "");
      return clean === page;
    });
    if (!covered) {
      problems.push({
        file: rel,
        line: 0,
        kind: "orphan-page",
        detail: "内容页没有被 sidebar / nav 收录，读者无法从导航到达",
      });
    }
  }
  return problems;
}

function main(): number {
  const argv = process.argv.slice(2);
  const dirFlag = argv.indexOf("--dir");
  const root = dirFlag === -1 ? DOCS : resolve(argv[dirFlag + 1] ?? "");
  const pages =
    dirFlag === -1
      ? collectDocPages()
      : (() => {
          const out: string[] = [];
          const walk = (d: string): void => {
            for (const e of readdirSync(d)) {
              const full = join(d, e);
              if (statSync(full).isDirectory()) walk(full);
              else if (e.endsWith(".md")) out.push(full);
            }
          };
          if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root);
          return out.sort();
        })();

  if (pages.length === 0) {
    console.error("docs link scan FAILED: 扫描范围为空——一个文档页都没扫到，放行等于门禁空转。");
    return 1;
  }

  const problems = dirFlag === -1 ? [...scanLinks(pages), ...scanOrphans(pages)] : scanLinks(pages);
  if (problems.length > 0) {
    console.error(`docs link scan FAILED: ${problems.length} 处问题（${pages.length} 个文档页）。`);
    for (const p of problems) {
      console.error(`  ${p.file}${p.line > 0 ? `:${p.line}` : ""} -> ${p.detail}  [${p.kind}]`);
    }
    console.error(
      "页面级死链由 `vitepress build` 负责；这里管的是**锚点**与**导航覆盖**。",
    );
    return 1;
  }

  console.log(
    dirFlag === -1
      ? `docs link scan OK: 锚点与导航覆盖无问题 (${pages.length} 个文档页)`
      : `docs link scan OK: 锚点无问题 (${pages.length} 个文档页)`,
  );
  return 0;
}

process.exitCode = main();
