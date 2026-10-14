/**
 * #165 收口：公共导出清单与覆盖记录的**纯判据**
 *
 * ## 为什么需要它
 *
 * #165 的关闭条件里有一条硬要求：**「零未核对项」**——所有可发布入口、所有公开组件、
 * Composable 与公共类型都必须有成员级核对结果。逐条销掉审计缺口之后，「还剩多少没核对」
 * 此前**无法判定**：它散在若干篇审计文档的叙述里，没有一份机器可读的清单，于是
 * 「已经全部对齐」和「还有很多没看」在文字上长得一样。
 *
 * 四条判据，**每一条都配了可翻红的反例**（见 `tests/behavior/165-coverage-inventory.test.ts`）：
 *
 * 1. **清单从发布 manifest 派生**（`package.json#exports` 里带 `types` 的入口）——固定写死
 *    入口列表会让「新增一个子路径」整条静默漏检。
 * 2. **导出名走 TypeScript AST**，不用正则——正则会漏掉 `export { type T }` /
 *    `export default` / `export namespace` 等合法形态（实测漏过）。
 * 3. **覆盖维度是 `入口#名字`**，不是全局名字集合——「同一个名字后来也出现在另一个入口」
 *    必须被要求单独判定。
 * 4. **记录 fail-closed**：基线必须是非负整数、`entries` 必须是普通对象、已判定项必须有非空
 *    `note`（「判定要有依据」的可执行版本）。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import ts from "typescript";

/**
 * 处置状态。`unaudited` 是**唯一**允许存量存在的一档，其余五档都表示已经人工判过。
 *
 * `consistent` 与 #165 §4 的「已一致」对应：**已核对且与官方一致、无需改动**。它此前缺失，
 * 导致 B/C/D/F 审计表里「判定为对齐（不修）」那类结论**没有可落的状态**（#223 维护者裁决新增）。
 * 它和 `retained` 的区别是**有没有差异**：`consistent` = 无差异；`retained` = 有意保留的差异。
 */
export type CoverageStatus =
  | "consistent"
  | "fixed"
  | "retained"
  | "not-applicable"
  | "deferred"
  | "unaudited";

export const COVERAGE_STATUSES: readonly CoverageStatus[] = [
  "consistent",
  "fixed",
  "retained",
  "not-applicable",
  "deferred",
  "unaudited",
];

/** 需要写依据的状态：除 `unaudited` 外都必须有非空 `note`。 */
export const STATUSES_REQUIRING_NOTE: readonly CoverageStatus[] = COVERAGE_STATUSES.filter(
  (status) => status !== "unaudited",
);

export interface CoverageEntry {
  readonly status: CoverageStatus;
  /** 依据 / 证据（PR、ADR、官方声明位置、实测记录等）。已判定项**必须非空**。 */
  readonly note?: string;
}

export interface CoverageRecord {
  /**
   * `unaudited` 的允许上限：只能下降，不能上升。
   *
   * `migration` 是**唯一**允许上涨的出口：覆盖维度变更（例如从「全局名字」改成
   * 「入口#名字」）会让计数天然变大，此时必须在新出现的迁移声明里写清原因，
   * 否则「只降不升」会把一次合法迁移误判成违规。同一条声明的重复使用无效（见 check 脚本）。
   */
  readonly baseline: {
    readonly unaudited: number;
    /**
     * 覆盖**维度迁移**的声明。判「新」的依据是**内容**（与 base 里的对象不同才算新），
     * 因此可以连续声明多次不同的迁移，但同一条不能反复用来豁免。
     *
     * `exemptNewKeys` 是这次迁移**精确列出**的新键（必填、非空）。刻意**没有**「省略即全豁免」
     * 之类的默认值：那会成为一个改一个字符就能无限复用的后门（第四轮评审 P1 实测形态）——
     * 豁免只能是一份**有限、可见**的清单。
     */
    readonly migration?: {
      readonly reason: string;
      readonly exemptNewKeys: readonly string[];
    };
  };
  /** `<entry>#<name>` → 处置。用入口限定，才能发现「同名后来新增到另一个入口」。 */
  readonly entries: Record<string, CoverageEntry>;
}

/** 覆盖记录的键：`<entry>#<name>`。 */
export function coverageKey(entry: string, name: string): string {
  return `${entry}#${name}`;
}

/**
 * 从一段声明文本里取出**导出名**（TypeScript AST）。
 *
 * 覆盖的形态：`export { A, B as C, type D }`、`export default X`、`export declare …`、
 * `export interface/type/const/function/class/enum/namespace`、`export = X`。
 * `export * from "./x"` **不**在本文件产生名字（调用方若需要展平应自己递归）。
 */
export function exportedNamesOf(source: string): string[] {
  const file = ts.createSourceFile("d.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names = new Set<string>();
  const add = (name: string | undefined): void => {
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  };

  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const hasDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        // `export * from "./x"`：不解析模块就**无法**枚举它转出的名字。静默跳过等于给门禁开洞
        // （实测确认这条分支一旦出现，新增公开符号不会形成 missing），因此 fail-closed。
        const specifier = ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : "(未知模块)";
        throw new Error(
          `不能枚举 \`export * from "${specifier}"\`：` +
            "需要解析目标模块才能列出转出的名字。请先展平该入口的声明（vite-plugin-dts 已这样做），" +
            "或为本判据补上模块解析；静默跳过会让门禁漏检。",
        );
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) add(element.name.text);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        // `export * as NS from "./x"`：公开名字就是 `NS`
        add(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      // `export default X` 的**公开名字是 `default`**（消费者 import 的就是它），
      // 不是本地声明名 `X`；`export = X` 按 TS export-assignment 语义登记 `X`。
      if (statement.isExportEquals) {
        if (ts.isIdentifier(statement.expression)) add(statement.expression.text);
      } else {
        add("default");
      }
      continue;
    }
    if (hasDefault) {
      // `export default class/function [Name] {}` 的公开名字同样是 `default`
      add("default");
      continue;
    }
    if (!hasExport) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text);
      }
      continue;
    }
    add((statement as { name?: ts.Identifier }).name?.text);
  }
  return [...names].sort();
}

/**
 * 模块增强（`declare module 'vue' { export interface GlobalComponents { … } }`）里的公共名。
 *
 * 为什么需要它（#215 第二轮评审 P1）：`./volar` 入口的 `volar.d.ts` **顶层只有增强**，
 * `exportedNamesOf` 对它得到空集 —— 于是「8 个入口」里有一个实际上**零记录**，
 * 改这个真正面向消费者的全局类型增强不会让门禁知情。
 *
 * 粒度取**成员级**：键形如 `vue.GlobalComponents.Map`，名字变化/成员增删都会形成 missing/stale。
 */
export function augmentationNamesOf(source: string): string[] {
  const file = ts.createSourceFile("d.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names = new Set<string>();
  const moduleNameOf = (node: ts.ModuleDeclaration): string | undefined => {
    const name = node.name;
    if (ts.isStringLiteral(name)) return name.text;
    if (ts.isIdentifier(name)) return name.text;
    return undefined;
  };
  for (const statement of file.statements) {
    if (!ts.isModuleDeclaration(statement)) continue;
    const moduleName = moduleNameOf(statement);
    if (!moduleName) continue;
    const body = statement.body;
    if (!body || !ts.isModuleBlock(body)) continue;
    for (const inner of body.statements) {
      if (!ts.isInterfaceDeclaration(inner) && !ts.isTypeAliasDeclaration(inner)) continue;
      const interfaceName = inner.name.text;
      names.add(`${moduleName}.${interfaceName}`);
      if (ts.isInterfaceDeclaration(inner)) {
        for (const member of inner.members) {
          const memberName = (member as { name?: ts.Node }).name;
          if (!memberName) continue;
          // 不能对任意节点用 `getText()`：这里建的 AST 没挂 parent/sourceFile，会抛
          // 「Cannot read properties of undefined」。字符串/标识符的 `.text` 就够用。
          const text =
            ts.isIdentifier(memberName) || ts.isStringLiteral(memberName)
              ? memberName.text
              : undefined;
          if (text) names.add(`${moduleName}.${interfaceName}.${text}`);
        }
      }
    }
  }
  return [...names].sort();
}

/** 一个发布入口：`entry` 是 `package.json#exports` 的键，`dts` 是它的声明文件绝对路径。 */
export interface CoverageEntryPoint {
  readonly entry: string;
  readonly dts: string;
}

/**
 * 从**发布 manifest** 派生入口清单：`exports` 里凡是带 `types` 的子路径都是发布入口。
 *
 * `includeDeclarationOnly` 控制「只有声明增强、没有运行时」的入口（如 `./volar`，它负责
 * `GlobalComponents` 增强）：**默认包含** —— 它同样是公开面，漏掉就是漏掉一整条入口。
 */
export function entryPointsFromManifest(
  pkg: { exports?: Record<string, unknown> },
  distRoot: string,
  options: {
    includeDeclarationOnly?: boolean;
    /** 注入 path 实现：测试用 `path.win32` 验证跨平台解析（默认平台 path）。 */
    pathApi?: { dirname: (p: string) => string; resolve: (...p: string[]) => string };
  } = {},
): CoverageEntryPoint[] {
  const includeDeclarationOnly = options.includeDeclarationOnly ?? true;
  const pathApi = options.pathApi ?? { dirname, resolve: resolvePath };
  const points: CoverageEntryPoint[] = [];
  for (const [entry, value] of Object.entries(pkg.exports ?? {})) {
    if (entry === "./styles.css" || entry === "./package.json") continue;
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
    const types = record?.types;
    if (typeof types !== "string") continue;
    if (!includeDeclarationOnly && !("import" in (record ?? {}))) continue;
    // `types` 可以是 `./dist/x.d.ts`（构建产物），也可以是 `./volar.d.ts`（包根的生成声明）——
    // 都以**包根**为基准。用 `dirname` 而不是替换末尾 `/dist`：Windows 上是 `\dist`，
    // 正则匹配不到（评审 P2，已有 win32 用例）。
    points.push({ entry, dts: pathApi.resolve(pathApi.dirname(distRoot), types) });
  }
  return points.sort((a, b) => a.entry.localeCompare(b.entry));
}

/** 逐个入口枚举导出名。返回 `{ entry -> names }`，名字已排序。 */
export function inventoryOf(
  entryPoints: readonly CoverageEntryPoint[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const point of entryPoints) {
    let source: string;
    try {
      source = readFileSync(point.dts, "utf8");
    } catch {
      throw new Error(
        `读不到入口 ${point.entry} 的声明文件：${point.dts}\n` +
          "  干净 checkout 下 `packages/bmap-vue/volar.d.ts` 是**生成物**（gitignore）：" +
          "先跑 `pnpm generate:manifest:check`（或 `pnpm pack:package`）再跑本命令。",
      );
    }
    const names = new Set<string>(exportedNamesOf(source));
    for (const name of augmentationNamesOf(source)) names.add(name);
    out[point.entry] = [...names].sort();
  }
  return out;
}

/** 清单与记录的差异。`missing` / `stale` 都是 `entry#name` 键。 */
export function coverageDrift(
  inventory: Record<string, readonly string[]>,
  record: CoverageRecord,
): { missing: string[]; stale: string[] } {
  const expected = new Set<string>();
  for (const [entry, names] of Object.entries(inventory)) {
    for (const name of names) expected.add(coverageKey(entry, name));
  }
  const recorded = new Set(Object.keys(record.entries));
  return {
    missing: [...expected].filter((key) => !recorded.has(key)).sort(),
    stale: [...recorded].filter((key) => !expected.has(key)).sort(),
  };
}

/** 按状态计数（用于报告与基线比较）。 */
export function statusCounts(record: CoverageRecord): Record<CoverageStatus, number> {
  // 从 `COVERAGE_STATUSES` 派生，而不是手抄一份键表：否则新增一个状态时这里会**静默**漏掉它
  // （计成 `undefined`，统计行印出 `consistent undefined`）——#223 加 `consistent` 时实测过。
  const counts = Object.fromEntries(COVERAGE_STATUSES.map((status) => [status, 0])) as Record<
    CoverageStatus,
    number
  >;
  for (const entry of Object.values(record.entries)) counts[entry.status] += 1;
  return counts;
}

/**
 * **本次新增**且**尚未判定**的键。
 *
 * 只比较 `unaudited` 总数是不够的（#215 第三轮评审 P1）：生成器把每个新增键默认写成
 * `unaudited`，于是「新增 1 个未核对 + 把 1 个旧的判成 retained/删除旧导出」可以**净额抵消**，
 * 总数不变、`missing`/`stale` 为空、CI 照绿，而新符号从未被判定 —— 与「拒绝新增未核对项」
 * 直接冲突。
 *
 * 因此：有 base 记录时，逐个检查「本次新出现、且仍是 `unaudited`」的键并全部报出。
 * 唯一的例外是**新出现的 `baseline.migration`** —— 覆盖维度变更会让所有键一次性变成新键，
 * 那是已声明的一次性迁移（且该声明不能重复使用）。
 *
 * 没有 base 记录（首次引入）时返回空：此时没有「上一版」可比。
 */
export function unjudgedNewKeys(
  entries: CoverageRecord["entries"],
  baseEntries: CoverageRecord["entries"] | undefined,
  options: { exemptNewKeys?: readonly string[] } = {},
): string[] {
  if (!baseEntries) return [];
  const base = new Set(Object.keys(baseEntries));
  // **精确匹配**，不做前缀匹配、也不接受空串（空串会匹配一切，正是上一版的后门）。
  const exempt = new Set(options.exemptNewKeys ?? []);
  return Object.keys(entries)
    .filter((key) => !base.has(key) && entries[key]?.status === "unaudited")
    .filter((key) => !exempt.has(key))
    .sort();
}

/**
 * **已判定的键被退回 `unaudited`**（审计结论回退）。
 *
 * 为什么单列一条判据（第五轮评审 P1）：`unjudgedNewKeys` 只看「本次**新出现**的键」，
 * 不会比较同一个键的 `status` 变化。于是
 * 「`A: fixed → unaudited` + `B: unaudited → retained`」总数相等、没有新键、
 * `missing`/`stale` 为空、基线不涨 ⇒ 全绿，而 **A 那条带证据的审计结论已经被悄悄撤销**。
 * 已判定的结论是**资产**，不能靠别处的进展冲抵。
 *
 * 确需重新审计时，做法是显式改回 `unaudited` 并在提交说明/评审里写明原因（这道门禁会红，
 * 由人来放行）——而不是让它无痕通过。
 */
export function regressedJudgedKeys(
  entries: CoverageRecord["entries"],
  baseEntries: CoverageRecord["entries"] | undefined,
): string[] {
  if (!baseEntries) return [];
  return Object.keys(entries)
    .filter((key) => {
      const before = baseEntries[key];
      const after = entries[key];
      if (!before || before.status === "unaudited") return false;
      return after?.status === "unaudited";
    })
    .sort();
}

/**
 * 校验豁免清单本身是否**成立**：每一条都必须真的是「本次新增、且当前未判定」的键。
 *
 * 不这么做的话，一份过期的/抄来的/写错的清单会静默地不起作用（或反过来豁免掉不该豁免的键），
 * 而调用方只会看到「没报问题」。
 */
export function invalidExemptKeys(
  exemptNewKeys: readonly string[],
  entries: CoverageRecord["entries"],
  baseEntries: CoverageRecord["entries"],
): string[] {
  const base = new Set(Object.keys(baseEntries));
  return exemptNewKeys
    .filter((key) => base.has(key) || entries[key]?.status !== "unaudited")
    .sort();
}

/** 迁移声明是否**相对 base 是新的**（按内容比较，而不是「有没有 migration」）。 */
export function migrationIsFresh(
  current: CoverageRecord["baseline"]["migration"],
  baseMigration: CoverageRecord["baseline"]["migration"] | undefined,
): boolean {
  if (!current) return false;
  return JSON.stringify(current) !== JSON.stringify(baseMigration ?? null);
}

/** 纯判定所需的一张记录来源（当前版 / base 版）。 */
export interface CoverageEvaluationInput {
  /** 从发布产物枚举出的清单：入口 → 该入口的公开名。 */
  readonly inventory: Record<string, readonly string[]>;
  /** 当前记录。 */
  readonly record: CoverageRecord;
  /** base 版本的判定结果：`found` 有上一版可比、`absent` 首次引入、`unavailable` 取不到。 */
  readonly base:
    | { readonly kind: "found"; readonly record: CoverageRecord; readonly source: string }
    | { readonly kind: "absent"; readonly source: string }
    | { readonly kind: "unavailable" };
}

/** 纯判定的结论：`problems` 非空即门禁失败；`notes` 是给日志的比较口径说明。 */
export interface CoverageEvaluation {
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

/**
 * #165 覆盖门禁的**纯判定**（无 I/O）。
 *
 * 把「取输入」（读清单 / 读记录 / 用 `git show` 取 base 记录 —— 全是 I/O）与「判定」分开，
 * 是为了让 `base.kind === "found"` 这条**跨提交**路径能被测试**直接**驱动（#215 第六轮评审
 * 指出的缺口：本 PR 首次引入记录，真实 CI 走的是 `base=absent`，②④⑤ 三条跨提交判据在 CI
 * 里从未真正被执行过 —— 只比较单个判据的单测抓不到「判据在另一形态下恒真」那类失效）。
 *
 * `check-165-coverage.mts` 只负责组装输入并调它，判据本身**只有这一处**实现。
 */
export function evaluateCoverage(input: CoverageEvaluationInput): CoverageEvaluation {
  const { inventory, record, base } = input;
  const problems: string[] = [];
  const notes: string[] = [];

  /**
   * fail-closed 守卫：清单为空时下面所有判据都会恒真（「没有名字要查」≠「全部查过了」）。
   *
   * **从 `inventory` 自己求和**，不接受调用方另传一个计数：两个参数表示同一事实时，
   * 不一致的输入（`inventory: {}` + 计数 1）会让这道守卫被绕过（#219 评审 P2 实测）。
   */
  const listedNameCount = Object.values(inventory).reduce((n, names) => n + names.length, 0);
  if (listedNameCount <= 0) {
    problems.push(
      "清单里的公开名为 0：无法把「没有名字要查」与「全部查过了」区分开，判据会恒真。" +
        "先确认 build:package 产出了声明（清单来自 dist）。",
    );
  }

  const { missing, stale } = coverageDrift(inventory, record);
  if (missing.length > 0) {
    problems.push(
      `${missing.length} 个「入口#名字」没有任何处置记录（新增必须判定，不允许静默未核对）：` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}`,
    );
  }
  if (stale.length > 0) {
    problems.push(
      `${stale.length} 条记录指向已不存在的导出（陈旧记录不能冒充覆盖）：` +
        `${stale.slice(0, 10).join(", ")}${stale.length > 10 ? " …" : ""}`,
    );
  }
  const counts = statusCounts(record);
  if (counts.unaudited > record.baseline.unaudited) {
    problems.push(
      `未核对数 ${counts.unaudited} 超过基线 ${record.baseline.unaudited}：基线只允许下降。`,
    );
  }

  if (base.kind === "unavailable") {
    // 取不到 base：不退化成一比就过，只接受「基线 = 当前未核对数」这种已收口形态。
    if (record.baseline.unaudited !== counts.unaudited) {
      problems.push(
        `取不到 base 版本的记录（已尝试 GITHUB_BASE_SHA / origin/<base_ref> / GITHUB_BEFORE_SHA / HEAD^），` +
          `且基线 ${record.baseline.unaudited} 与当前未核对数 ${counts.unaudited} 不一致：` +
          `无法验证跨提交单调性时，只接受「基线 = 当前未核对数」这种已收口形态。`,
      );
    }
    notes.push("[165-coverage] 取不到 base 版本的记录：退化为「基线必须等于当前未核对数」的弱判据");
  } else if (base.kind === "absent") {
    notes.push(`[165-coverage] base（${base.source}）里还没有这份记录：按首次引入处理，只比较文件内基线`);
  } else {
    // 基线允许在显式迁移时上涨一次；迁移必须**相对 base 是新的**，否则同一条声明可反复用。
    const migration = record.baseline.migration;
    const migrationFresh = migrationIsFresh(migration, base.record.baseline.migration);
    const raised = record.baseline.unaudited > base.record.baseline.unaudited;
    if (raised && !migrationFresh) {
      problems.push(
        `基线从 ${base.record.baseline.unaudited}（${base.source}）涨到 ${record.baseline.unaudited}：` +
          `「只降不升」必须跨提交成立。确因**覆盖维度变更**需要重设时，须在 baseline.migration 里` +
          `写明本次迁移（内容必须相对 base 是新的——同一条不能反复用）。`,
      );
    } else if (raised) {
      notes.push(`[165-coverage] 基线迁移：${migration?.reason}`);
    }

    // 只有**内容相对 base 是新的**迁移才给豁免；豁免是精确列出的键，没有「缺省 = 全豁免」。
    const exemptNewKeys = migrationFresh ? (migration?.exemptNewKeys ?? []) : [];
    if (exemptNewKeys.length > 0) {
      const invalid = invalidExemptKeys(exemptNewKeys, record.entries, base.record.entries);
      if (invalid.length > 0) {
        problems.push(
          `${invalid.length} 条豁免声明指向的不是「本次新增且仍未判定」的键（清单过期或抄错）：` +
            `${invalid.slice(0, 10).join(", ")}${invalid.length > 10 ? " …" : ""}`,
        );
      }
    }
    // 已判定的结论不能无痕回退（第五轮评审 P1）。
    const regressed = regressedJudgedKeys(record.entries, base.record.entries);
    if (regressed.length > 0) {
      problems.push(
        `${regressed.length} 个**已判定**的键被退回 unaudited（审计结论不能靠别处的进展冲抵；` +
          `确需重新审计请显式说明并由评审放行）：` +
          `${regressed.slice(0, 10).join(", ")}${regressed.length > 10 ? " …" : ""}`,
      );
    }
    // 净额抵消（第三轮评审 P1）：本次新出现的键必须已经判定。
    const undecided = unjudgedNewKeys(record.entries, base.record.entries, { exemptNewKeys });
    if (undecided.length > 0) {
      problems.push(
        `${undecided.length} 个**本次新增**的键仍是 unaudited（不允许用「判掉/删除旧项」抵消总数）：` +
          `${undecided.slice(0, 10).join(", ")}${undecided.length > 10 ? " …" : ""}`,
      );
    }
  }

  return { problems, notes };
}

/**
 * 读取并**完整校验**记录。任何形状问题都抛错（fail-closed）：
 * `baseline.unaudited` 必须是非负整数、`entries` 必须是普通对象、状态必须在枚举内、
 * 已判定项必须有非空 `note`。
 *
 * 最后一条是「判定必须有依据」的可执行版本：否则把 587 项全标成 `retained`（不写任何依据）
 * 就能让 `unaudited` 归零，门禁照绿。
 */
export function readCoverageRecord(file: string): CoverageRecord {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CoverageRecord>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${file}: 覆盖记录必须是对象`);
  }
  const baseline = parsed.baseline as { unaudited?: unknown; migration?: unknown } | undefined;
  if (
    !baseline ||
    typeof baseline !== "object" ||
    typeof baseline.unaudited !== "number" ||
    !Number.isInteger(baseline.unaudited) ||
    baseline.unaudited < 0
  ) {
    throw new Error(`${file}: baseline.unaudited 必须是非负整数`);
  }
  if (baseline.migration !== undefined) {
    const migration = baseline.migration as { reason?: unknown; exemptNewKeyPrefixes?: unknown };
    if (!migration || typeof migration !== "object" || typeof migration.reason !== "string" || migration.reason.trim().length === 0) {
      throw new Error(`${file}: baseline.migration 必须是 { reason: string }（写清迁移原因）`);
    }
    // 必填且非空：没有「默认全豁免」这条路（那会变成改一个字符就能复用的后门）。
    if (
      !Array.isArray(migration.exemptNewKeys) ||
      migration.exemptNewKeys.length === 0 ||
      migration.exemptNewKeys.some((key) => typeof key !== "string" || key.length === 0)
    ) {
      throw new Error(
        `${file}: baseline.migration.exemptNewKeys 必须是**非空**的字符串数组` +
          `（精确列出本次迁移新增的键；不接受缺省或空串）`,
      );
    }
  }
  const entries = parsed.entries as Record<string, unknown> | undefined;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error(`${file}: entries 必须是对象`);
  }
  for (const [key, raw] of Object.entries(entries)) {
    const entry = raw as { status?: unknown; note?: unknown } | null;
    if (!entry || typeof entry !== "object") throw new Error(`${file}: ${key} 的处置必须是对象`);
    if (!COVERAGE_STATUSES.includes(entry.status as CoverageStatus)) {
      throw new Error(`${file}: ${key} 的状态 "${String(entry.status)}" 不在允许集合里`);
    }
    if (STATUSES_REQUIRING_NOTE.includes(entry.status as CoverageStatus)) {
      if (typeof entry.note !== "string" || entry.note.trim().length === 0) {
        throw new Error(
          `${file}: ${key} 的状态是 "${String(entry.status)}"，必须给出非空 note（判定要有依据）`,
        );
      }
    }
  }
  return {
    baseline: {
      unaudited: baseline.unaudited,
      ...(baseline.migration !== undefined
        ? { migration: baseline.migration as NonNullable<CoverageRecord["baseline"]["migration"]> }
        : {}),
    },
    entries: entries as CoverageRecord["entries"],
  };
}
