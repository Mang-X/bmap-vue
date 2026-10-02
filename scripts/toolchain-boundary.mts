/**
 * 声明工具链的**判定内核**（issue #187）
 *
 * 单独成文件是为了能**被用例直接 import**（驱动脚本顶层跑 `main()`，import 它就会连带触发
 * 真实的 lockfile / `node_modules` 读取）。`package-shape-boundary.mts` / `raw-sdk-boundary.mts` /
 * `pack-contents-boundary.mts` 是同一理由的先例。
 *
 * ## 这道门禁补的是哪个洞
 *
 * 本票的起因：根 `package.json` 曾把 `pnpm.overrides` 写在 **`package.json#pnpm`** 字段里，
 * 而 pnpm 12 **不再读取该字段**。于是那份 override 从写下那天起就没生效过，但仓库里没有任何
 * 东西会发现这件事 —— 它看起来是一道「版本锁」，实际是一句**失效的声称**。三条独立证据：
 *
 * 1. `pnpm-lock.yaml` 里**没有** `overrides:` 块（pnpm 会记录生效的 override，缺失即未应用）；
 * 2. 实际解析与它相反：包构建与 typecheck 走 `vue-tsc@2.2.12`，只有 `docs` 走 `3.3.11`；
 * 3. 它写的 `@vue/language-core: "2.2.0"` 这个版本**根本不存在**（`^2.2.0` 实际解析到 `2.2.12`）。
 *
 * 溯源：那份 override 与把 `vue-tsc` **降到** `^2.2.0` 的 devDep 是同一次提交（`a455565`）加的，
 * 因此自相矛盾。`git log -S'"vue-tsc": "3.3.11"'` 可复现。
 *
 * **删掉那句失效的声称之后，必须补上真实的钉子**，否则「工具链版本是什么」仍然只存在于
 * 某个人的记忆里。这就是本模块存在的唯一理由。
 *
 * ## 为什么判据要落到「实际解析结果」而不是「声明」
 *
 * 声明面（`package.json` 的 `^` / `~`）**不是**事实：`^2.2.0` 今天解析到 `2.2.12`，
 * 下次 `pnpm install` 就可能解析到 `2.2.13`。而 `pnpm-lock.yaml` 里的 `version:` 字段
 * 才是这一次安装**真正**用的东西。
 *
 * 所以判据是三方对照，任何一方漂移都红：
 *
 * | 来源 | 判什么 |
 * | --- | --- |
 * | `package.json` | 声明的 **specifier**（并要求它不是会漂的裸 `latest`） |
 * | `pnpm-lock.yaml` | 该 importer 实际解析到的 **version** |
 * | `node_modules` | 磁盘上真实安装的版本 |
 *
 * 仓库里此前**没有任何门禁读 lockfile 或已安装版本**（`upstream-types-reference-case.test.ts`
 * 里的 `pnpm-lock` 只是报错文案，不是被解析的对象）—— 这个缺口就是本票要补的。
 *
 * ## 工作区故意跑**两个** vue-tsc major（不是缺陷）
 *
 * | importer | 用途 | vue-tsc |
 * | --- | --- | --- |
 * | `packages/bmap-vue` + 根 | 发布包构建、三个 `typecheck:*` 门禁 | 2.x |
 * | `docs` | 文档站 `vp exec vue-tsc`（对着 `dist/*.d.ts` 做消费方校验） | 3.x |
 *
 * 因此判据**按 importer 分别登记**而不是要求全仓库统一 —— 把这两者强行合成一个版本，
 * 就是本票明确禁止的「强行组合不匹配的 vue-tsc / language-core」。
 *
 * 另有一处**已知且刻意接受**的不匹配登记在 `KNOWN_PEER_MISMATCHES`：`unplugin-dts@1.1.0`
 * 声明 peer `@vue/language-core: ^3.1.5`，而发布包构建装的是 `2.2.12`。它能工作是因为
 * unplugin-dts 实际只 import 三个符号（`createParsedCommandLine` /
 * `getDefaultCompilerOptions` / `createVueLanguagePlugin`），2.2.12 **全部导出**（实测）。
 * 处置见 ADR 2026-10-02；「声明产物本身的问题」属 #188，不在本门禁范围。
 */

/** 一条工具链登记：某个 importer 上某个包「应当」解析到什么版本。 */
export interface ToolchainPin {
  /** pnpm-lock.yaml 里的 importer 键（`.` = 仓库根）。 */
  readonly importer: string;
  /** 包名。 */
  readonly name: string;
  /** 期望的解析版本（`x.y.z`，不带 peer 后缀）。 */
  readonly version: string;
  /** 为什么是这个版本 / 谁在用它。用于失败时让人一眼看懂，不作判据。 */
  readonly why: string;
  /**
   * 读 lockfile 的哪一段 `importers:`。
   *
   * 只有 `pnpm` 自己需要显式写 `"packageManager"`：它住在 lockfile 顶部那个只服务
   * `packageManagerDependencies` 的段里（工具链链出 `pnpm@12.0.0` 时下载的平台二进制就挂在
   * 那下面）。工作区依赖一律用默认的 `"workspace"`——读第二个（最后一个）`importers:`。
   *
   * 刻意留成可选而不是给每个条目都填：绝大多数登记是工作区依赖，**例外才是要写出来的**。
   */
  readonly which?: "workspace" | "packageManager";
}

/**
 * 已逐条审阅、**刻意接受**的 peer 范围不匹配。
 *
 * 与 `package-shape-boundary.mts#ATTW_EXCEPTIONS` 同一处置：刻意非空（空表会让「不匹配消失了」
 * 与「没检查」无法区分），每条必须带 `why` 与 `tracking`，且**由用例断言表非空**。
 */
export interface PeerMismatch {
  readonly name: string;
  readonly why: string;
  readonly tracking: string;
  /**
   * 这条例外是**基于哪个实装版本**成立的。
   *
   * 刻意做成**结构化字段**而不是从 `why` 的散文里 `includes(version)`：
   * 实测那个做法会漏——`why` 里除了「实际装 2.2.12」还有半句「2.2.12 全部导出」，
   * 于是把它改成过期版本后 `includes` 仍为真，判据静默不红。**靠字符串包含判断版本
   * 本身就是这条判据想避免的那类脆弱。**
   *
   * 有了它，「例外是否已过期」就是一次**比较**，而不是一次猜测。
   */
  readonly observedVersion: string;
}

/**
 * 声明工具链的事实基线。
 *
 * 数字全部来自**本票的干净安装实测**（`pnpm install --frozen-lockfile` 后从 lockfile 与
 * `node_modules` 读出），不是从任何声明抄的。改这里的数字等于声明「工具链换版本了」，
 * 必须同时走一次显式 diff —— 与 `unpinnedVersionIssues` 对门禁工具的处置一致。
 */
export const TOOLCHAIN_PINS: readonly ToolchainPin[] = [
  {
    importer: ".",
    name: "pnpm",
    version: "12.0.0",
    why: "包管理器本身：pnpm 12 才是「package.json#pnpm 不再被读取」这条结论的来源，换 major 会改判据；住在 lockfile 的 packageManagerDependencies 段",
    which: "packageManager",
  },
  {
    importer: ".",
    name: "vue",
    version: "3.5.42",
    why: "peerDependency（发布包对外承诺 ^3.5.0）；声明产物由 Volar 产出，与 Vue 版本强耦合",
  },
  {
    importer: ".",
    name: "typescript",
    version: "5.9.3",
    why: "包与文档站的类型检查共用；升级走显式 diff（dependabot 已锁 major 人工评估）",
  },
  {
    importer: ".",
    name: "vue-tsc",
    version: "2.2.12",
    why: "根 `typecheck:package` / `typecheck:tests` / `typecheck:type-contracts` 实际执行的版本",
  },
  {
    importer: "packages/bmap-vue",
    name: "vue-tsc",
    version: "2.2.12",
    why: "发布包类型门禁实际执行的版本（与根一致，docs 才是另一个 major）",
  },
  {
    importer: "packages/bmap-vue",
    name: "@vue/language-core",
    version: "2.2.12",
    why: "声明产出的实际产出者：unplugin-dts 在 dist/chunks/vue.mjs 直接 import 它",
  },
  {
    importer: "packages/bmap-vue",
    name: "typescript",
    version: "5.9.3",
    why: "与根一致，避免同一个 Program 里出现两个 TS 版本",
  },
  {
    importer: "packages/bmap-vue",
    name: "vite-plugin-dts",
    version: "5.1.0",
    why: "dist/*.d.ts 的产出者（bundleTypes 聚合声明），API Extractor 由它拉起",
  },
  {
    importer: "packages/bmap-vue",
    name: "@microsoft/api-extractor",
    version: "7.59.0",
    why: "bundleTypes 的聚合实现；精确锁定的门禁工具（#45 决策 6）",
  },
  {
    importer: "docs",
    name: "vue-tsc",
    version: "3.3.11",
    why: "文档站对着 dist/*.d.ts 做消费方校验：产物由 Volar 2 产出、由 Volar 3 校验",
  },
  {
    importer: "docs",
    name: "typescript",
    version: "5.9.3",
    why: "与包共用同一个 TS 版本，避免两套声明解析行为",
  },
];

/**
 * 刻意接受的不匹配（peer 范围 vs 实装版本）。
 *
 * 登记它们而不是让它们隐形：`unplugin-dts@1.1.0` 要 `@vue/language-core ^3.1.5`，
 * 拿到的是 `2.2.12`。**不是**「没看见」，是**看过、验证过符号齐备、决定先这么用**。
 * 万一上游改了导入的符号，这条会红 —— 那正是它该红的时候。
 */
export const KNOWN_PEER_MISMATCHES: readonly PeerMismatch[] = [
  {
    name: "@vue/language-core",
    why: "unplugin-dts@1.1.0 声明 peer ^3.1.5，实装 2.2.12 是 major 不匹配；它只 import 三个符号（createParsedCommandLine / getDefaultCompilerOptions / createVueLanguagePlugin），2.2.12 全部导出（实测）。随本票已验证的构建组合保留，不强行升级",
    tracking: "#188",
    observedVersion: "2.2.12",
  },
];

/**
 * 一条判据失败。
 *
 * `kind` **必须与它指向的缺陷同义**——它决定维护者看到 `[X]` 时第一眼去查什么。
 * 刻意让每种缺陷有自己的 kind（而不是复用少数几个）：第一版把「基线表为空」「缺 why」
 * 「登记了两次」都塞进 `importer-missing` / `version-unreadable` / `resolution-drift`，
 * 于是输出会读成 `[importer-missing] 工具链基线表为空`，而那里根本没有 importer——
 * kind 一旦不指向真实缺陷，看到红灯的人就会去查错的地方。
 *
 * 前四个是「三方对照」的漂移，第五个是「读不到现场」（fail-closed），
 * 最后三个是「基线表自身有问题」与「未登记的不匹配」。
 */
export type ToolchainIssueKind =
  /** 声明面 / lockfile / 磁盘某两方对不上：需要人判断是否升级。 */
  | "resolution-drift"
  /** lockfile 里读不到该 importer 或该依赖。 */
  | "importer-missing"
  /** lockfile 里该条目没有可读的 version。 */
  | "version-unreadable"
  /** specifier 缺失、为 latest/*，或 package.json 与 lockfile 记录的 specifier 不一致。 */
  | "specifier-unpinned"
  /** lockfile 说 A、磁盘上是 B（或磁盘上根本没有）。 */
  | "disk-mismatch"
  /** 出现了未登记的 peer 不匹配。 */
  | "unexpected-peer-mismatch"
  /** **基线表自身**：为空（fail-closed，与「一切正常」区分）。 */
  | "baseline-empty"
  /** **基线表自身**：版本不是 x.y.z，或缺 why（失败时没人看懂为什么是这个版本）。 */
  | "baseline-malformed"
  /** **基线表自身**：同一条登记出现了两次（判据没有唯一解）。 */
  | "baseline-duplicate";

/** 一条判据失败。`kind` 区分「哪种漂移」，便于区分是升级漂移还是锁定失效。 */
export interface ToolchainIssue {
  readonly kind: ToolchainIssueKind;
  readonly detail: string;
}

/** 从 `package.json` 取到的声明面。 */
export interface DeclaredManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * 把 lockfile 里的 `version:` 归一成裸 `x.y.z`。
 *
 * pnpm 会把 peer 解析结果编进版本键（`2.2.12(typescript@5.9.3)`、
 * `5.1.0(@microsoft/api-extractor@7.59.0(...))(...)`），而登记的是裸版本。取第一段即可：
 * peer 后缀不是版本的一部分。
 */
export function normalizeResolvedVersion(raw: string): string {
  const cut = raw.indexOf("(");
  return cut === -1 ? raw : raw.slice(0, cut);
}

/**
 * 定向解析 `pnpm-lock.yaml` 的 `importers` 段，取出某个 importer 下某个包的
 * `{ specifier, version }`。
 *
 * **刻意不引 YAML 库**：仓库没有直接依赖它（`yaml` 仅为传递依赖），而这里只需要读
 * `importers` 段里形状固定的四个字段。缩进约定（importer 2 空格、依赖组 4、依赖名 6、
 * `specifier`/`version` 8）由 pnpm 自己保证。
 *
 * ## 这个解析器踩过的坑（都在本仓库真实 lockfile 里，不是假想）
 *
 * 1. 直接 `findIndex('  .:')` 会命中**第 6 行**那个键——它属于顶部的
 *    `packageManagerDependencies` 块（下面挂着 pnpm 自己的 `@pnpm/exe.*` 平台二进制），
 *    那个「根 importer」只含 `configDependencies` 与 pnpm 自依赖，**没有**
 *    `dependencies` / `devDependencies`。结果：根的每个依赖都读不到。
 * 2. 改锚定**第一个**顶层 `importers:` 也不行——本仓库 lockfile 里有**两个**（第 4 行与
 *    第 108 行），第一个是 pnpm 自身的。
 * 3. 段边界只认「下一个 2 空格键」也不够：根 importer 之后紧跟的是**顶层**（0 空格）的
 *    `packages:`，不认它会把 importer 段一路扫进 packages 段。
 *
 * 三次都是**判据没错、解析器错了**：门禁按 fail-closed 每次都正确地判红。留在这里的
 * 注释与 `toolchain-gate.test.ts` 的合成样本 + 真实 lockfile 双份断言就是为了不让它退化。
 *
 * 解析不出目标条目时返回 `undefined`，由 `checkPin` 判失败——解析器「没读到」绝不等于「没问题」。
 */
export function parseImporterBlock(
  lockText: string,
  importer: string,
  packageName: string,
  /** 读哪一段 `importers:`：工作区那一个（默认），或 pnpm 自身那一个。 */
  which: "workspace" | "packageManager" = "workspace",
): { specifier?: string; version?: string } | undefined {
  // 本仓库 lockfile 里有**两个**顶层 `importers:`：第一个（第 4 行）服务 pnpm 自身
  // （`packageManagerDependencies`），第二个（第 108 行）才是工作区。默认读**最后一个**
  // ——工作区那一个——因为本门禁绝大多数条目都是工作区依赖。
  //
  // `packageManager` 段保留是因为 `pnpm` 自身的版本是 #187 实施步骤 1 要求记录的对象之一，
  // 它就住在那一个「看起来没用」的段里。**踩坑记录见上方注释。**
  const lines = lockText.split("\n");
  const anchors: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "importers:") anchors.push(i);
  }
  if (anchors.length === 0) return undefined;
  const importersAt = which === "packageManager" ? anchors[0]! : anchors[anchors.length - 1]!;
  // `packageManager` 读第一个、工作区读最后一个；只有一个段时两者都指向它。
  if (anchors.length === 1 && which === "packageManager") return undefined;

  const importerKey = `  ${importer}:`;
  const start = lines.findIndex((l, i) => i > importersAt && l === importerKey);
  if (start === -1) return undefined;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // 段边界有**两类**：下一个同缩进（2 空格）的 importer 键，以及任意**顶层**（0 空格）键。
    const line = lines[i]!;
    if (/^ {2}\S/.test(line) || (/^\S/.test(line) && line.trim().length > 0)) {
      end = i;
      break;
    }
  }

  // 依赖名在 6 空格缩进，形如 `      '@scope/name':` 或 `      name:`。
  const nameAt = lines.findIndex(
    (l, i) =>
      i > start &&
      i < end &&
      (l === `      ${packageName}:` ||
        l === `      '${packageName}':` ||
        l === `      "${packageName}":`),
  );
  if (nameAt === -1) return undefined;

  const entry: { specifier?: string; version?: string } = {};
  for (let i = nameAt + 1; i < Math.min(end, nameAt + 4); i++) {
    const m = /^ {8}(specifier|version):\s*(.+)$/.exec(lines[i]!);
    if (m) {
      entry[m[1] as "specifier" | "version"] = m[2]!.trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return entry;
}

/**
 * 比对一条登记：lockfile 里该 importer 下的解析版本是否等于登记版本。
 *
 * 读不到 importer / 读不到版本都判失败（fail-closed）——「没读到」不等于「没问题」，
 * 那与 `evaluateAttwReport` 对 `attw` 的处置是同一条原则。
 */
export function checkPin(
  pin: ToolchainPin,
  lockEntry: { specifier?: string; version?: string } | undefined,
): ToolchainIssue[] {
  const issues: ToolchainIssue[] = [];

  if (lockEntry === undefined) {
    issues.push({
      kind: "importer-missing",
      detail: `${pin.importer} 的 importer 在 pnpm-lock.yaml 里不存在或未声明 ${pin.name}：判定没有真的发生（fail-closed）`,
    });
    return issues;
  }

  const specifier = lockEntry.specifier;
  if (typeof specifier !== "string" || specifier.length === 0) {
    issues.push({
      kind: "specifier-unpinned",
      detail: `${pin.importer} 的 ${pin.name} 没有可读的 specifier：无法核对声明面`,
    });
  } else if (specifier === "latest" || specifier === "*") {
    issues.push({
      kind: "specifier-unpinned",
      detail: `${pin.importer} 的 ${pin.name} 声明为 "${specifier}"：每天装到的都可能不是同一个`,
    });
  }

  const raw = lockEntry.version;
  if (typeof raw !== "string" || raw.length === 0) {
    issues.push({
      kind: "version-unreadable",
      detail: `${pin.importer} 的 ${pin.name} 在 lockfile 里没有可读的 version：判定没有真的发生（fail-closed）`,
    });
    return issues;
  }

  const resolved = normalizeResolvedVersion(raw);
  if (resolved !== pin.version) {
    issues.push({
      kind: "resolution-drift",
      detail: `${pin.importer} 的 ${pin.name} 解析到 ${resolved}，基线登记的是 ${pin.version}（${pin.why}）`,
    });
  }

  return issues;
}

/**
 * 核对**磁盘上真实安装**的版本与登记一致。
 *
 * 这一层不能省：lockfile 说 2.2.12 而 `node_modules` 里躺着别的东西时（例如上次安装的残留），
 * 实际跑 `typecheck:package` 的就不是登记的那个。读不到包同样判失败。
 */
export function checkInstalled(
  pin: ToolchainPin,
  installed: string | undefined,
): ToolchainIssue[] {
  // `pnpm` 自身不住在 `node_modules`（它是包管理器，由 corepack / CI 的 pnpm/action-setup
  // 提供），因此它只有「声明 → lockfile」这一层可核对。跳过磁盘核对而不是假装它缺失。
  if (pin.which === "packageManager") return [];

  if (installed === undefined) {
    return [
      {
        kind: "disk-mismatch",
        detail: `${pin.importer} 的 ${pin.name} 在磁盘上找不到：先跑 \`pnpm install\`（fail-closed）`,
      },
    ];
  }
  if (installed !== pin.version) {
    return [
      {
        kind: "disk-mismatch",
        detail: `${pin.importer} 的 ${pin.name} 磁盘上是 ${installed}，基线登记的是 ${pin.version}（lockfile 与实际安装不一致）`,
      },
    ];
  }
  return [];
}

/**
 * 核对实际依赖树里**没有未登记的** peer 不匹配。
 *
 * 判据刻意只查**名字**、不查范围：`^` / `~` 的实际解析结果随 lockfile 漂移，硬判范围会把
 * 「上游放了一次 patch」变成红灯，而那与「我们用错了版本」不是一回事。名字是稳定的。
 *
 * 表里登记过的名字放行（逐条由 `KNOWN_PEER_MISMATCHES` 说明），没登记的一律红。
 */
export function checkPeerMismatches(
  mismatchedNames: readonly string[],
  known: readonly PeerMismatch[] = KNOWN_PEER_MISMATCHES,
): ToolchainIssue[] {
  const allowed = new Set(known.map((m) => m.name));
  return mismatchedNames
    .filter((name) => !allowed.has(name))
    .map((name) => ({
      kind: "unexpected-peer-mismatch" as const,
      detail: `${name} 的 peer 范围与实装版本不匹配，且未登记：要么补进 KNOWN_PEER_MISMATCHES 并说明依据，要么处置它`,
    }));
}

/**
 * 逐条核对登记本身是否自洽 —— 这层不依赖任何外部输入，用例可以直接 import 断言。
 *
 * fail-closed：表为空、版本不是 `x.y.z`、或同一条登记重复，都判失败。
 * 「表空了」必须与「一切正常」区分得开，否则删光基线就是全绿。
 */
export function auditPins(pins: readonly ToolchainPin[] = TOOLCHAIN_PINS): ToolchainIssue[] {
  const issues: ToolchainIssue[] = [];

  if (pins.length === 0) {
    return [
      {
        kind: "baseline-empty",
        detail: "工具链基线表为空：删光登记与「一切正常」无法区分（fail-closed）",
      },
    ];
  }

  const seen = new Set<string>();
  for (const pin of pins) {
    if (!/^\d+\.\d+\.\d+$/.test(pin.version)) {
      issues.push({
        kind: "baseline-malformed",
        detail: `${pin.importer} 的 ${pin.name} 基线版本 "${pin.version}" 不是 x.y.z`,
      });
    }
    if (pin.why.length === 0) {
      issues.push({
        kind: "baseline-malformed",
        detail: `${pin.importer} 的 ${pin.name} 缺 why：失败时没人看懂为什么是这个版本`,
      });
    }
    const key = `${pin.importer} ${pin.name}`;
    if (seen.has(key)) {
      issues.push({
        kind: "baseline-duplicate",
        detail: `${pin.importer} 的 ${pin.name} 登记了两次：基线本身有歧义`,
      });
    }
    seen.add(key);
  }

  return issues;
}

/**
 * 比对**声明面**（`package.json` 的 specifier）与 lockfile 记录的 specifier 是否一致。
 *
 * 这一层不能省：lockfile 里的 `specifier:` 是 pnpm **解析所依据**的那个，而 `package.json`
 * 里的是人手写的那份。两者一致才说明 lockfile 与 manifest 没有脱节；
 * 只看 lockfile 的话，「改了 package.json 但没重新 install」这类漂移不会变红——
 * 而那恰好是「实际生效版本」这个问题的源头（#187 的起因就是一句声称与实际脱节）。
 *
 * `declared` 为 `"—"`（该 importer 的 package.json 里没有这个包）时判失败：
 * lockfile 里有、manifest 里没有，说明 manifest 与 lockfile 已经不一致了。
 * 唯一例外是 `pnpm` 自己——它由 `packageManager` 字段钉住，不在 `devDependencies` 里。
 */
export function checkDeclaredSpecifier(
  pin: ToolchainPin,
  declared: string,
  lockSpecifier: string | undefined,
): ToolchainIssue[] {
  const issues: ToolchainIssue[] = [];

  // `pnpm` 由 package.json#packageManager 钉住，不出现在 dependencies/devDependencies。
  if (pin.which === "packageManager") return issues;

  if (declared === "—") {
    issues.push({
      kind: "specifier-unpinned",
      detail: `${pin.importer} 的 ${pin.name} 在 package.json 里没有声明，但 lockfile 里有：manifest 与 lockfile 已脱节`,
    });
    return issues;
  }

  if (declared === "latest" || declared === "*") {
    issues.push({
      kind: "specifier-unpinned",
      detail: `${pin.importer} 的 ${pin.name} 声明为 "${declared}"：每天装到的都可能不是同一个`,
    });
    return issues;
  }

  if (lockSpecifier !== undefined && lockSpecifier !== declared) {
    issues.push({
      kind: "specifier-unpinned",
      detail: `${pin.importer} 的 ${pin.name} 在 package.json 声明为 "${declared}"，lockfile 记录的是 "${lockSpecifier}"：lockfile 与 manifest 已脱节（改完 package.json 没重新 install？）`,
    });
  }

  return issues;
}

/** 只取声明面里与某包相关的字段，供 driver 组装。 */
export function declaredVersion(
  manifest: DeclaredManifest,
  name: string,
): string | undefined {
  return manifest.devDependencies?.[name] ?? manifest.dependencies?.[name];
}