/**
 * #165 收口：公共导出清单与覆盖记录的**纯判据**
 *
 * ## 为什么需要它
 *
 * #165 的关闭条件里有一条硬要求：**「零未核对项」**——所有可发布入口、所有公开组件、
 * Composable 与公共类型都必须有成员级核对结果。#174 / #210–#214 逐条销掉了审计发现的缺口，
 * 但「还剩多少没核对」此前**无法判定**：它散在若干篇审计文档的叙述里，没有一份机器可读的清单，
 * 于是「已经全部对齐」和「还有很多没看」在文字上长得一样。
 *
 * 本模块把这件事变成可判定：
 *
 * - **清单**从**构建产物**（`dist/<entry>.d.ts`）枚举，而不是从源码正则猜——公开面就是发布面；
 * - **记录**（`docs/zh-CN/contributing/165-coverage.json`）逐个公共名给出处置状态；
 * - **判据**两条：①清单与记录必须**一一对应**（有新增未记录的名字 ⇒ 红；记录里有已消失的名字
 *   ⇒ 红）；②`unaudited` 的数量不得超过基线，**只能下降**。
 *
 * ## 为什么不做成「一次干净」
 *
 * 现状是存量欠账（数百个名字未逐个核对）。要求门禁立刻全绿等于要求一次完成 #165 剩余的全部工作量，
 * 那不会有任何中间态可提交。因此与仓库既有的欠账基线同一形态：**冻结存量、拒绝新增、只许下降**。
 * 这让进度可度量，也让「零未核对」成为一个可检查的目标而不是一句声明。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 处置状态。`unaudited` 是**唯一**允许存量存在的一档，其余四档都表示已经人工判过。 */
export type CoverageStatus =
  | "fixed"
  | "retained"
  | "not-applicable"
  | "deferred"
  | "unaudited";

export const COVERAGE_STATUSES: readonly CoverageStatus[] = [
  "fixed",
  "retained",
  "not-applicable",
  "deferred",
  "unaudited",
];

export interface CoverageEntry {
  readonly status: CoverageStatus;
  /** 依据 / 证据（PR、ADR、官方声明位置、实测记录等）。`unaudited` 允许为空。 */
  readonly note?: string;
}

export interface CoverageRecord {
  /** `unaudited` 的允许上限：只能下降，不能上升。 */
  readonly baseline: { readonly unaudited: number };
  /** 公共名 → 处置。键是**名字**（同一导出出现在多个入口共用一份语义记录）。 */
  readonly entries: Record<string, CoverageEntry>;
}

/**
 * 从一段 `.d.ts` 文本里取出**导出名**。
 *
 * 只认声明面上的导出形态（`export { … }` / `export declare …` / `export type …` …），不解析
 * 表达式、不猜内部符号。`export * from` 由调用方先展平（见 `resolveEntryExports`）。
 */
export function exportedNamesOf(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^export\s*(?:declare\s*)?(?:type\s+|interface\s+|const\s+|function\s+|class\s+|enum\s+)?\{([^}]*)\}/gm,
  )) {
    for (const piece of match[1]!.split(",")) {
      const text = piece.trim();
      if (!text) continue;
      const alias = /\sas\s+([A-Za-z_$][\w$]*)\s*$/.exec(text);
      const name = alias ? alias[1]! : text;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:type|interface|const|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

/** 一个发布入口：`entry` 是 `package.json#exports` 的键，`dts` 是它的声明文件绝对路径。 */
export interface CoverageEntryPoint {
  readonly entry: string;
  readonly dts: string;
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

/** 清单与记录的差异：`missing` = 清单里有、记录里没有；`stale` = 记录里有、任何入口都没有。 */
export function coverageDrift(
  inventory: Record<string, readonly string[]>,
  record: CoverageRecord,
): { missing: string[]; stale: string[] } {
  const inInventory = new Set<string>();
  for (const names of Object.values(inventory)) {
    for (const name of names) inInventory.add(name);
  }
  const recorded = new Set(Object.keys(record.entries));
  const missing = [...inInventory].filter((name) => !recorded.has(name)).sort();
  const stale = [...recorded].filter((name) => !inInventory.has(name)).sort();
  return { missing, stale };
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

/** 读取记录文件；不存在或形状不对时抛错（fail-closed，不按空集静默通过）。 */
export function readCoverageRecord(file: string): CoverageRecord {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as CoverageRecord;
  if (!parsed || typeof parsed !== "object" || !parsed.entries || !parsed.baseline) {
    throw new Error(`${file}: 覆盖记录形状不对（需要 { baseline, entries }）`);
  }
  for (const [name, entry] of Object.entries(parsed.entries)) {
    if (!COVERAGE_STATUSES.includes(entry.status)) {
      throw new Error(`${file}: ${name} 的状态 "${entry.status}" 不在允许集合里`);
    }
  }
  return parsed;
}
