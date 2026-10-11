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
    readonly migration?: string;
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
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        // `export { type Foo }`：`isTypeOnly` 在 element 上，公共名仍然是 `name`
        for (const element of statement.exportClause.elements) add(element.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) add(statement.expression.text);
      continue;
    }
    if (!hasExport && !hasDefault) continue;
    // `export declare const K` 在 AST 里是 **FirstStatement**（`VariableStatement`），
    // 名字在 `declarationList` 的每个 `VariableDeclaration` 上，不在语句本身（实测）。
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text);
      }
      continue;
    }
    // export [default] class/function/interface/type/enum/namespace
    add((statement as { name?: ts.Identifier }).name?.text);
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
  options: { includeDeclarationOnly?: boolean } = {},
): CoverageEntryPoint[] {
  const includeDeclarationOnly = options.includeDeclarationOnly ?? true;
  const points: CoverageEntryPoint[] = [];
  for (const [entry, value] of Object.entries(pkg.exports ?? {})) {
    if (entry === "./styles.css" || entry === "./package.json") continue;
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
    const types = record?.types;
    if (typeof types !== "string") continue;
    if (!includeDeclarationOnly && !("import" in (record ?? {}))) continue;
    points.push({ entry, dts: resolveUnder(distRoot, types) });
  }
  return points.sort((a, b) => a.entry.localeCompare(b.entry));
}

/**
 * 解析 `exports` 里 `types` 指向的文件。
 *
 * `types` 可以是 `./dist/x.d.ts`（构建产物），也可以是 `./volar.d.ts`（包根下的手写声明，
 * `./volar` 入口就是后者）—— 两者都以**包根**为基准，不能无条件拼到 `dist/` 下。
 */
function resolveUnder(distRoot: string, types: string): string {
  const pkgRoot = distRoot.replace(/\/dist\/?$/, "");
  const relative = types.replace(/^\.\//, "");
  return `${relative.startsWith("dist/") ? distRoot.replace(/\/$/, "") : pkgRoot}/${relative.replace(/^dist\//, "")}`;
}

/** 逐个入口枚举导出名。返回 `{ entry -> names }`，名字已排序。 */
export function inventoryOf(
  entryPoints: readonly CoverageEntryPoint[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const point of entryPoints) {
    out[point.entry] = exportedNamesOf(readFileSync(point.dts, "utf8"));
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
  if (baseline.migration !== undefined && typeof baseline.migration !== "string") {
    throw new Error(`${file}: baseline.migration 必须是字符串（写清迁移原因）`);
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
      ...(typeof baseline.migration === "string" ? { migration: baseline.migration } : {}),
    },
    entries: entries as CoverageRecord["entries"],
  };
}
