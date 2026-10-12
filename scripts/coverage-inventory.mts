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

/** 处置状态。`unaudited` 是**唯一**允许存量存在的一档，其余四档都表示已经人工判过。 */
export type CoverageStatus = "fixed" | "retained" | "not-applicable" | "deferred" | "unaudited";

export const COVERAGE_STATUSES: readonly CoverageStatus[] = [
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
  const counts: Record<CoverageStatus, number> = {
    fixed: 0,
    retained: 0,
    "not-applicable": 0,
    deferred: 0,
    unaudited: 0,
  };
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
