/**
 * 发布 tarball 文件清单的**判定内核**（issue #45）
 *
 * 单独成文件而不是留在 `check-pack-contents.mts` 里，是为了能**被用例直接 import**：
 * 驱动脚本顶层就跑 `main()`，用例一旦 import 它就会连带触发真实 `npm pack`。
 * `docs-brand-boundary.mts` / `raw-sdk-boundary.mts` / `api-forgotten-boundary.mts` 是同一理由的先例。
 *
 * ## 这道门禁补的是哪个洞
 *
 * `publint` / `@arethetypeswrong/cli` 都在 `quality.yml` 的 `package` job 里跑着，tarball 的
 * `exports` 与类型解析**看起来**是被检查的。但它们都只看**目录**（`publint .` / `attw --pack .`
 * 自己重新打包一次），**没有任何一道门禁断言「实际发布的那一个 tarball 里到底有什么」**：
 *
 * - `packages/bmap-vue/package.json#files` 声明的每一项是否真的发出去了 —— 无人断言；
 * - `exports` 的每个目标文件是否真的在包里 —— 无人断言；
 * - 有没有多发不该发的（凭据、本地产物、`node_modules/`）—— 无人断言。
 *
 * 最要命的是第一条。它在真实发布路径上已经**发生过一次**：`files` 声明了 `volar.d.ts`，
 * 但 `volar.d.ts` 是 `.gitignore` 的生成产物，只由 `scripts/generate-manifest-artifacts.mts`
 * 写（第 81 行，连 `--check` 模式也写）。于是：
 *
 * | 顺序 | tarball 里有没有 `volar.d.ts` |
 * | --- | --- |
 * | `pnpm --filter bmap-vue pack`（干净检出） | **没有**（47 个文件） |
 * | 先跑 `generate-manifest-artifacts.mts --check` 再 pack | 有（48 个文件） |
 *
 * CI 恰好因为 `quality.yml` 第 45 行跑着 `--check` 才侥幸带上；一次真正的 `npm publish`、
 * 或任何人直接跑 `pnpm pack:package`，都会静默发出版本**缺 Volar 类型**的包 —— 而 README 与
 * 安装页都承诺了自动补全。这正是「声明了但没人验证」能一路活到发布面的典型形态。
 *
 * ## 设计原则
 *
 * 1. **判的是 tarball，不是目录。** 输入是 `tar -tzf` 的真实条目；`publint` / `attw` 看的是
 *    目录，那条路已经证明不够。
 * 2. **fail-closed。** 读不到 tarball、条目为空、`files` 缺失或为空，都判失败。宁可今天红，
 *    不可「没扫到所以通过」。
 * 3. **每条判据都要有反证。** `tests/behavior/pack-contents-gate.test.ts` 用合成条目逐条给出
 *    会红的输入 —— 否则规则可能退化成常量。
 * 4. **CSS 必须按文件名显式声明。** `files` 只写 `dist` 这个目录时，任何 `.css` 都是构建的
 *    意外副产物（今天 `dist/bmap-vue.css` 就是：文档让用户 `<link>` 它，但 `files` / `exports` /
 *    `unpkg` 都没声明）。按文件名显式列出才是「承诺它是公共面」，否则门禁判它未声明。
 */

/** 允许出现在 tarball 根的文件（npm 强制注入 `package.json` / `LICENSE`）。 */
export const ALLOWED_ROOT_FILES: readonly string[] = [
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "package.json",
];

/**
 * `dist/` 下允许出现的产物形态。
 *
 * `.map` 是**有意保留**的（ 裁决）：产物里**带 `//# sourceMappingURL=` 注释**的文件必须有
 * 同名 `.map`，删掉 map 却留着注释会让消费方浏览器逐文件 404，也让人在 stack trace 里查不到
 * 任何东西。
 *
 * ⚠️ 依据是「**带注释的那批**」，不是「全部 `.mjs`」：`components.mjs` / `composables.mjs` /
 * `resolver.mjs` 是 vite 的**纯 re-export facade**，只含 `import`/`export`，既没有注释也没有
 * map（实测 `grep -c sourceMappingURL` 为 0）。因此本表只表达「`.map` 是允许的形态」，
 * **反向**的「有注释却缺 map」由驱动脚本 `check-pack-contents.mts` 的
 * `findDanglingSourceMapReferences()` 读文件内容判定——清单层无从知道哪个文件带注释。
 */
export const ALLOWED_DIST_FORMS: readonly string[] = [".css", ".d.ts", ".js", ".map", ".mjs"];

/**
 * 逐条禁止进包的文件形态，以及**为什么**。
 *
 * 这些不是「风格偏好」：凭据泄漏是不可逆的发布事故，而 `node_modules/` 与源码目录会让
 * 消费者装到一个与发布产物不同的包（tarball 里的源码优先被解析，让「我本地能跑」冒充
 * 「我发的包能跑」）。
 */
export const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /(^|\/)\.env(\.|$)/, why: "环境变量文件可能含凭据" },
  { pattern: /(^|\/)\.npmrc$/, why: "可能含 registry 凭据" },
  { pattern: /\.(pem|key|p12|pfx)$/, why: "私钥 / 证书" },
  { pattern: /(^|\/)node_modules\//, why: "依赖副本会让包与产物漂移" },
  { pattern: /(^|\/)\.DS_Store$/, why: "macOS 本地产物" },
  { pattern: /(^|\/)\.tsbuildinfo$/, why: "构建缓存" },
  { pattern: /^src\//, why: "源码不属于发布面" },
  { pattern: /^tests?\//, why: "测试不属于发布面" },
  { pattern: /^scripts\//, why: "仓库脚本不属于发布面" },
  { pattern: /^\.changeset\//, why: "版本控制内部件不属于发布面" },
  { pattern: /^\.github\//, why: "CI 配置不属于发布面" },
];

/** 目录类 `files` 条目：这些目录下的所有文件**都**算被声明。 */
const DIRECTORY_FILE_ENTRIES: readonly string[] = ["dist"];

/**
 * 归一化一个 `files` 条目：去 `./` 前缀与尾随 `/`。
 *
 * 这个形状在判据里出现七八次（`:128` 起的多处），抽出来是为了让「一个条目怎么被解释」
 * 只有**一个**定义——两处各写一遍 `trim().replace(/^\.\//,"").replace(/\/+$/,"")` 时，
 * 迟早会有一处漏改，而漏改的表现是**某个 files 条目静默不被校验**。
 */
function normalizeFilesEntry(entry: string): string {
  return entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

export interface PackageManifestLike {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly files?: unknown;
  readonly exports?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly types?: unknown;
  readonly unpkg?: unknown;
  readonly jsdelivr?: unknown;
}

export interface PackProblem {
  /** 稳定的机器可读分类，便于用例与日志按类型聚合。 */
  readonly kind:
    | "empty-entries"
    | "files-entry-missing"
    | "files-missing"
    | "export-target-missing"
    | "unexpected-root-file"
    | "dist-form"
    | "forbidden-path"
    | "undeclared-css"
    | "source-map-dangling-reference";
  readonly detail: string;
}

/** tarball 条目（已去掉 `package/` 前缀）是否落在某个目录类 `files` 条目下。 */
function underDirectoryEntry(relativePath: string, entry: string): boolean {
  const base = entry.replace(/\/+$/, "");
  return relativePath === base || relativePath.startsWith(`${base}/`);
}

/**
 * 一个 `files` 条目匹配到哪些 tarball 条目。
 *
 * **目录项**（`DIRECTORY_FILE_ENTRIES` 里的、或以 `/` 结尾的）匹配其下全部；
 * **文件项**只允许精确相等。
 *
 * ⚠️ 这个区分是必需的，不是洁癖：第二版把两者合并成
 * `relativePath === base || relativePath.startsWith(base + "/")`，于是
 * `files: ["volar.d.ts"]` 会被 `volar.d.ts/leftover.txt` 匹配上——
 * **文件明明不在包里，`files-entry-missing` 却不触发**（PR 评审 P2 实测：
 * 那份 entries 的判定结果为 `[]`，纯假绿）。用例标题「目录项匹配其下全部，
 * 文件项只匹配自己」说的正是这条判据，实现一度与它矛盾。
 *
 * npm 的 `files` 还允许 `!` 取反与 glob；取反项由调用方先过滤，glob 不在支持范围内
 * （本包 `files` 里没有 glob，用例对此有断言）。
 */
export function matchesFilesEntry(relativePath: string, entry: string): boolean {
  if (entry.trim() === "" || entry.trim().startsWith("!")) return false;
  const base = normalizeFilesEntry(entry);
  if (base === "") return false;
  if (relativePath === base) return true;
  // 目录项才允许前缀匹配。`entry` 以 `/` 结尾是 npm 写目录项的显式形态；
  // `DIRECTORY_FILE_ENTRIES` 则是本仓已知的目录项名单（CSS 声明那条判据也读它）。
  const isDirectoryEntry = entry.trim().endsWith("/") || DIRECTORY_FILE_ENTRIES.includes(base);
  return isDirectoryEntry && relativePath.startsWith(`${base}/`);
}

/** 把 `exports` 递归压平成「必须存在的文件」列表。 */
export function collectExportTargets(exportsField: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      // 只关心文件目标；条件对象（`{ types, import }`）逐个下钻。
      if (node.startsWith("./")) out.push(node.slice(2));
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) walk(value);
    }
  };
  walk(exportsField);
  return [...new Set(out)];
}

/**
 * `main` / `module` / `types` / `unpkg` / `jsdelivr` 这些顶层字段。
 *
 * 单一事实源：判据要遍历它、报错时又要**点名是哪个字段**。第一版把名单写在
 * `collectTopLevelFields` 里、报错时再反查字段名，反查出来的是字符串
 * `"package.json#main/module/types/unpkg/jsdelivr"`——读起来像**一个**叫这名字的字段。
 * 这里改成返回「字段名 → 路径」的映射，字段名直接跟着结论走。
 */
const TOP_LEVEL_PATH_FIELDS = ["main", "module", "types", "unpkg", "jsdelivr"] as const;

/**
 * 把一个顶层字段的值归一化成「包内相对路径」，或返回 `undefined` 表示**不该检查**。
 *
 * ⚠️ `./` 前缀**不是**必需的：`main` / `module` / `types` / `unpkg` / `jsdelivr` 都合法地
 * 写成 `dist/index.js`（npm 两种都接受）。第二版只在 `value.startsWith("./")` 时收集，
 * 于是 `unpkg: "dist/index.global.js"` 被**静默跳过**——而那正是本函数上方注释里
 * 自己举的例子，形同自我否证（PR 评审 P2 实测：`unpkg` 指向一个缺失文件，判定仍是 `[]`）。
 *
 * 只排除**确定不是包内相对路径**的形态：URL（`https:` / `//`）与绝对路径（`/` 或盘符）。
 * 它们的缺失不该由「tarball 里有没有这个文件」来判，那是另一类问题。
 */
function normalizeTopLevelPath(value: string): string | undefined {
  if (value === "") return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined; // URL（https:、data: …）
  if (value.startsWith("//") || value.startsWith("/")) return undefined; // 协议相对 / 绝对路径
  if (/^[a-z]:/i.test(value)) return undefined; // Windows 盘符
  return value.startsWith("./") ? value.slice(2) : value;
}

/** 顶层字段引用的文件，形如 `{ unpkg: "dist/index.global.js" }`（已归一化掉 `./`）。 */
export function collectTopLevelFields(manifest: PackageManifestLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TOP_LEVEL_PATH_FIELDS) {
    const value = manifest[key];
    if (typeof value !== "string") continue;
    const normalized = normalizeTopLevelPath(value);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

/**
 * npm 打包产物的文件名。
 *
 * ⚠️ scoped 包**不带前导 `@`**：实测 `npm pack` 对 `@mangmax/bmap-vue@1.0.0-rc.0` 产出的是
 * `mangmax-bmap-vue-1.0.0-rc.0.tgz`。第一版写成 `name.replace("/", "-")`，会算出
 * `@mangmax-bmap-vue-1.0.0-rc.0.tgz` —— 迁移 scope 之后这道门禁**找不到刚打出来的包**，
 * 而它偏偏就是为了让 scope 迁移不出问题才写成读 manifest 的。
 *
 * 规则：先去掉前导 `@`，再把 `/` 换成 `-`。
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它就会连带触发
 * 真实 `npm pack`（这正是本文件与 `check-pack-contents.mts` 分开的原因）。
 */
export function tarballBasename(name: string, version: string): string {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}

/** 归一化 tarball 条目：去掉 `package/` 前缀、丢掉目录条目（`dist/`）与空串。 */
export function normalizeEntries(rawEntries: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of rawEntries) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const withoutPrefix = trimmed.startsWith("package/") ? trimmed.slice("package/".length) : trimmed;
    if (withoutPrefix === "") continue;
    // 目录条目以 `/` 结尾，文件不会；两者都留着会让「目录算一个文件」而误判 files 条目。
    if (withoutPrefix.endsWith("/")) continue;
    out.add(withoutPrefix);
  }
  return [...out].sort();
}

/**
 * 产物形态。
 *
 * `.d.ts` 必须**整体**当作一个形态：只取最后一个点会得到 `.ts`，于是所有类型声明都会被
 * `ALLOWED_DIST_FORMS` 判成「未登记形态」——这是第一版真实踩到的坑（`dist/index.d.ts`
 * 是最普通的一条产物，却判红）。`index.d.ts.map` 仍归 `.map`，符合 sourcemap 的约定路径。
 */
function distFormOf(relativePath: string): string {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (name.endsWith(".d.ts")) return ".d.ts";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

/**
 * 核心判据。
 *
 * 逐条独立成立，任何一条不成立都产出一个 `PackProblem`；调用方决定是聚合打印还是首个即抛。
 */
export function checkPackContents(args: {
  readonly entries: readonly string[];
  readonly manifest: PackageManifestLike;
}): PackProblem[] {
  const { manifest } = args;
  const entries = normalizeEntries(args.entries);
  const problems: PackProblem[] = [];

  /* 0) 空转守卫：扫不到东西时，下面所有「没有命中」都不能作为证据。 */
  if (entries.length === 0) {
    return [{ kind: "empty-entries", detail: "tarball 条目为空：没有读到任何文件，「没有违规」不能作为证据" }];
  }
  const entrySet = new Set(entries);

  /* 1) `files` 必须存在且非空 —— 否则第 2 条会静默 vacuous 通过。 */
  const filesField = manifest.files;
  if (!Array.isArray(filesField) || filesField.length === 0) {
    problems.push({
      kind: "files-missing",
      detail: "package.json#files 缺失或为空：发布面无法被断言（fail-closed）",
    });
  }
  const filesEntries = Array.isArray(filesField)
    ? filesField.filter((v): v is string => typeof v === "string")
    : [];

  /* 2) `files` 声明的每一项都必须真的发出去。
   *
   *    这条直接抓住 `volar.d.ts` 缺陷：`files` 写了、文件却不在包里（因为它是 gitignore 的
   *    生成产物，且没有任何东西强制「先生成再打包」的顺序）。 */
  for (const entry of filesEntries) {
    // `!` 取反项不要求「有匹配」——它声明的是**排除**。第一版为它加了一条
    // 「取反是否生效」的判据，但唯一调用方从不传这个参数，整条判据不可达；
    // 且它的逻辑本身不成立（glob 字符留在 base 里再拿它做后缀比较）。按 AGENTS.md
    // 「没有消费者…一律删除，不留以后可能有用的扩展面」整条移除。
    if (entry.trim().startsWith("!")) continue;
    const matched = entries.some((file) => matchesFilesEntry(file, entry));
    if (!matched) {
      problems.push({
        kind: "files-entry-missing",
        detail: `files 声明了 "${entry}"，但 tarball 里没有任何匹配条目 —— 它是被声明却没发出的文件`,
      });
    }
  }

  /* 3) `exports` 与顶层字段引用的文件必须都在包里。 */
  for (const target of collectExportTargets(manifest.exports)) {
    if (!entrySet.has(target)) {
      problems.push({
        kind: "export-target-missing",
        detail: `exports 指向 "${target}"，但它不在 tarball 里 —— 声明的面与发出的包不一致`,
      });
    }
  }
  for (const [field, target] of Object.entries(collectTopLevelFields(manifest))) {
    if (!entrySet.has(target)) {
      problems.push({
        kind: "export-target-missing",
        detail: `package.json#${field} 指向 "${target}"，但它不在 tarball 里`,
      });
    }
  }

  /* 4) 根目录只允许 npm 强制注入 + `files` 声明的那几个。 */
  const declaredRootFiles = new Set(
    filesEntries
      .filter((entry) => {
        const base = entry.trim().replace(/^\.\//, "");
        return !base.includes("/") && !base.endsWith("/");
      })
      .map((entry) => entry.trim().replace(/^\.\//, "")),
  );
  for (const file of entries) {
    if (file.includes("/")) continue;
    const allowed = ALLOWED_ROOT_FILES.includes(file) || declaredRootFiles.has(file);
    if (!allowed) {
      problems.push({
        kind: "unexpected-root-file",
        detail: `tarball 根出现未声明文件 "${file}"（允许：${[...ALLOWED_ROOT_FILES].join(" / ")} 或 files 里按文件名声明的项）`,
      });
    }
  }

  /* 5) `dist/` 下只允许已登记的产物形态。 */
  for (const file of entries) {
    if (!file.startsWith("dist/")) continue;
    const form = distFormOf(file);
    if (form === "" || !ALLOWED_DIST_FORMS.includes(form)) {
      problems.push({
        kind: "dist-form",
        detail: `dist 下出现未登记形态 "${file}"（允许：${ALLOWED_DIST_FORMS.join(" / ")}）`,
      });
    }
  }

  /* 6) 禁止形态。 */
  for (const file of entries) {
    for (const { pattern, why } of FORBIDDEN_PATTERNS) {
      if (pattern.test(file)) {
        problems.push({ kind: "forbidden-path", detail: `tarball 含禁止路径 "${file}"：${why}` });
        break;
      }
    }
  }

  /* 7) CSS 必须按文件名显式声明，不能靠 `files` 里的目录项顺带发出。
   *
   *    今天 `dist/bmap-vue.css` 由 `<Autocomplete>` 的 scoped `<style>` 产出，文档让用户
   * `<link>` 它，但它不在 `files` 的文件名项里 ⇒ 它是构建的意外副产物。 的裁决是
   *    **显式声明**（维护者选择把它当公共面），所以这条的判据是「CSS 要么按文件名出现在
   *    `files` 里，要么不在包里」——两者都不成立时报出来。 */
  for (const file of entries) {
    if (!file.endsWith(".css")) continue;
    const declared = filesEntries.some(
      (entry) => !entry.trim().startsWith("!") && entry.trim().replace(/^\.\//, "") === file,
    );
    if (!declared) {
      problems.push({
        kind: "undeclared-css",
        detail: `"${file}" 是未按文件名声明的 CSS：它靠 files 的目录项顺带发出，属于构建副产物而非承诺的公共面（要么显式加进 files，要么不发布）`,
      });
    }
  }

  /* 8) sourcemap：清单层只能判「有 map 的形态不许丢」，反向留给驱动脚本。
   *
   *    **不要**在这里要求「每个 .mjs 都有同名 .map」——第一版这么写，结果把
   *    `dist/components.mjs` / `composables.mjs` / `resolver.mjs` 全部判红，而那三个文件
   *    是 vite 的**纯 re-export facade**：它们只含 `import` / `export`，**根本没有**
   *    `//# sourceMappingURL=` 注释，也就不存在 404。实测 `grep -c sourceMappingURL`
   *    对它们全是 0。
   *
   *    真正会 404 的是反方向：「带注释却缺 map」。那需要读文件内容，由驱动脚本
   *    `findDanglingSourceMapReferences()` 判定——它读得到内容，所以判据放在那里。
   *
   * 清单层在这里唯一能表达的是：`.map` 是**允许**的产物形态（ 裁决：保留 sourcemap）
   *    由 `ALLOWED_DIST_FORMS` 收 `.map` 表达，不在此处重复。 */
  return problems;
}