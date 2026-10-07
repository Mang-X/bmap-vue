/**
 * 隔离验收项目的边界判定（issue #158 工作包 A）
 *
 * 「包缺件必须红」这件事的前提是：临时项目**够不到任何上游依赖树**。TypeScript 与
 * Node 解析 `node_modules` 时逐级向磁盘根查找，pnpm 也按 workspace 根解析依赖 ——
 * 临时项目只要落在二者任一覆盖范围内，本库漏发的东西就会被从别处补回来，门禁看起来
 * 还是绿的。
 *
 * 两种覆盖范围都要**从 `dir` 向祖先看**，不能只看 `dir` 自己：
 *
 * - `node_modules` 确实可以就在 `dir` 下，但更常见的是在某个祖先；
 * - `pnpm-workspace.yaml` 基本**只**在 workspace 根，也就是祖先。只查 `dir` 自己的话，
 *   「`TMPDIR=<repo>/.tmp` 时新目录仍在 workspace 里」这一形态会被放过，而那种情况下
 *   断言仍然报「通过」——判据与它的名字说的不是一件事。
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层就跑 `main()`，用例 import 它就会连带
 * 触发真实的 `npm install`；这里只有纯函数，可以喂合成目录树做行为级反例。
 * 与 `release-identity.mts` 的分层理由相同。
 */
import { existsSync } from "node:fs";
import { parse, resolve } from "node:path";

/** 存在性判定。注入是为了让用例能在**合成目录树**上跑反例，而不是只查源码文本。 */
export interface IsolationFs {
  readonly exists: (path: string) => boolean;
}

export const realIsolationFs: IsolationFs = { exists: existsSync };

/** pnpm workspace 根的标志文件。两者任一存在都说明当前目录是 workspace 根。 */
export const WORKSPACE_MARKERS = ["pnpm-workspace.yaml", "pnpm-workspace.yml"] as const;

/**
 * 从磁盘根到 `dir`（**含磁盘根与 `dir` 自己**）之间存在的全部 `marker` 路径。
 *
 * 从根向下拼而不是从 `dir` 向上回溯：两种写法结果相同，但向下拼天然把 `dir` 自己
 * 纳入、且顺序稳定（祖先 → 后代），用例可以逐项断言。
 *
 * ⚠️ **磁盘根自己要单独先查一次**。循环在拼入第一个 segment **之后**才检查，所以
 * 它覆盖的是 `root/a/marker`、`root/a/b/marker`、……、`dir/marker` —— `root/marker`
 * 不在其中。缺了这一步，`/node_modules`（Windows 的 `C:\node_modules`）或盘符根的
 * workspace marker 会被当成「路径干净」，而向上模块解析恰恰会查到它。
 */
export function ancestorEntries(
  dir: string,
  marker: string,
  fs: IsolationFs = realIsolationFs,
): string[] {
  const root = parse(dir).root;
  const found: string[] = [];
  const atRoot = resolve(root, marker);
  if (fs.exists(atRoot)) found.push(atRoot);
  let current = root;
  for (const segment of dir.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    const candidate = resolve(current, marker);
    if (fs.exists(candidate)) found.push(candidate);
  }
  return found;
}

/**
 * 从 `dir` 到磁盘根之间不得存在 `node_modules`。
 *
 * `dir` **自己**的 `node_modules` 不算异常 —— 那正是我们要装出来的树。祖先里任何一个
 * 都不行：向上查找会命中它，依赖缺件就被补上了。
 */
export function assertNoAncestorNodeModules(dir: string, fs: IsolationFs = realIsolationFs): void {
  const offending = ancestorEntries(dir, "node_modules", fs).filter(
    (path) => path !== resolve(dir, "node_modules"),
  );
  if (offending.length > 0) {
    throw new Error(
      `[consumer-isolated] 验收项目到磁盘根之间有 node_modules，依赖提升会补足包缺失：\n  - ${offending.join("\n  - ")}\n` +
        `  这条判据的存在意义就是「包缺件必须红」——选一个不在依赖树内部的临时目录。`,
    );
  }
}

/**
 * `dir` 不得位于任何 pnpm workspace 之内（workspace 根可能在任意一级祖先）。
 *
 * 判据看的是 `pnpm-workspace.yaml` / `.yml`。`pnpm-lock.yaml` **不单独**作为判据：
 * 它只说明该目录是某个仓库的根，不等于它是 workspace 根（本仓就是 workspace 根，
 * 但一个普通 pnpm 项目同样有 lockfile、并不构成 workspace）。把它并进判据会在
 * 「普通 pnpm 项目下跑验证」时假红，而假红与假绿一样让门禁失去意义。
 */
export function assertOutsidePnpmWorkspace(dir: string, fs: IsolationFs = realIsolationFs): void {
  const markers = WORKSPACE_MARKERS.flatMap((marker) => ancestorEntries(dir, marker, fs));
  if (markers.length > 0) {
    throw new Error(
      `[consumer-isolated] 验收项目位于 pnpm workspace 内（workspace 根在祖先目录）：\n  - ${markers.join("\n  - ")}\n` +
        `  这是工作包 A 的核心隔离判据：workspace 解析会把本库漏发的依赖补回来。`,
    );
  }
}
