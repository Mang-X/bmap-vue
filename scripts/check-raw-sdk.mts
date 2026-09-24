/**
 * 源码静态扫描门禁：raw SDK 边界（issue #15）+ 旧引擎残留（issue #26 / #136）
 *
 * 两套规则集（分组的理由见 `scripts/raw-sdk-boundary.mts` 的文件头）：
 *
 * | 规则集 | 规则 | 适用范围 |
 * | --- | --- | --- |
 * | **边界** | `BMap.*` 成员 / 构造 / 类型位置、全局对象成员访问、`namespace BMap` / `declare global`、官方类型包导入与三斜线引用 | 禁区目录（`FORBIDDEN_SRC_DIRS`）**与** `--src` 树模式下的非白名单路径 |
 * | **旧引擎残留** | `BMapGL` 标识符 / 精确字符串键 / `namespace BMapGL`、已删除的 engine 取值 `"webgl-v1"` / `"jsapi-v3"` | **整棵 `--src` 树**（含白名单目录）**与** `--declarations` 公共声明相位 |
 *
 * 旧引擎残留是**跨整棵树**的不变量，与「raw SDK 白名单」无关：`BMapGL` 与已删除的 engine
 * 取值在任何位置都违规。因此 `--src` 树模式下非白名单文件**两个规则集都跑**。
 *
 * 三种模式：
 * - （无参数）扫 `FORBIDDEN_SRC_DIRS` 下的禁区目录——本地的快速档，只跑边界规则，不依赖 `dist`。
 * - `--src <dir>`：扫整棵源码树。白名单目录（`driver/**`、`client/**`、`core/loader/**`、
 *   `plugins/**`）**只**跑旧引擎残留规则——那里出现 `BMap.*` 是合法的，出现 `BMapGL` 不是；
 *   非白名单文件两个规则集都跑。这是「运行时源码树无旧引擎痕迹」的唯一落点。
 * - `--declarations <dir>`：扫公共声明（`dist` 下的 `.d.ts`），只跑旧引擎残留规则
 *   （`check-public-dts.mts` 已经在那里禁掉了 `BMap.*`，但**不**禁已删除的 engine 取值
 *   字面量——那是发布产物上的真实覆盖）。必须排在 `build:package` 之后。
 *
 * `.vue` 文件用 `vue/compiler-sfc` 的官方解析器提取 `<script>`/`<script setup>` 区块，
 * 再把区块内容交给同一 AST 检查，并按 `block.loc.start.offset` 映射回源文件。SFC 解析失败时
 * 明确报错退出，绝不静默放行。
 *
 * **fail-closed**：每个相位扫到 0 个文件即判失败——目录配错 / 被整体跳过时放行等于门禁空转，
 * 且「扫到 0 个」与「真的干净」在日志上必须长得不一样。
 */
import { join, relative, resolve } from "node:path";
import {
  FORBIDDEN_SRC_DIRS,
  LEGACY_RULES_LABEL,
  boundarySummary,
  isRawSdkAllowedPath,
} from "./raw-sdk-boundary.mts";
import {
  RULE_LABELS,
  collectLegacyViolations,
  collectViolations,
  sortViolations,
  type LegacyViolation,
  type Violation,
} from "./raw-sdk-detector.mts";
import { scanSourceDirs, type ScannableViolation, type SourceVisitor } from "./source-scan.mts";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "packages/bmap-vue/src");

/** 两条规则集都产出的记录（`rule` 取两者的并集）。 */
type AnyViolation = (Violation | LegacyViolation) & ScannableViolation;

interface Phase {
  /** 报告与断言用的相位名。 */
  readonly label: string;
  readonly dir: string;
  /**
   * `boundary` = 跑全套边界规则；`legacy` = 只跑旧引擎残留规则；
   * `partitioned` = 按白名单分派（`--src` 树模式）。
   */
  readonly rules: "boundary" | "legacy" | "partitioned";
  /** 返回 true 表示跳过该文件（参数是**绝对路径**）。 */
  readonly skip?: (file: string) => boolean;
}

/**
 * 相位的报告口径：`label=相对仓库根的路径`。
 *
 * label **不含空白**——`scanLabel` 与用例侧的 `phaseScans` 都以 `<label>=<dir>:<N> 个文件`
 * 作字段分隔，label 里出现空格会让它无法被解析成字段名。
 */
function describe(phase: Phase): string {
  return `${phase.label}=${relative(ROOT, phase.dir) || phase.dir}`;
}

/**
 * `--src` 树模式的分派 visitor。
 *
 * **路径口径陷阱**：`scanSourceDirs` 收到 `root: ROOT`（仓库根），所以 visitor 里的 `file`
 * 是**仓库相对**路径（如 `packages/bmap-vue/src/driver/jsapi-v4/map.ts`）；而
 * `isRawSdkAllowedPath` 期望 **src 相对**路径。必须重算一次——不重算的话整棵树会被当成
 * 禁区，`--src` 立刻报出几百条 `BMap.*`。
 *
 * **为什么禁区内要跑两遍 visitor**：旧引擎残留是**跨整棵树**的不变量（`BMapGL` 与已删除的
 * engine 取值在任何位置都违规），与「raw SDK 白名单」无关。所以非白名单文件既要判边界
 * 规则（`BMap.*` 越界），也要判旧引擎残留；白名单文件只判后者。这里是两个独立 visitor 各跑
 * 一遍，而不是把它们合成一个——合成会让 `--print-boundary` 的 `rules` 输出多出规则。
 */
function partitionedVisitor(srcRoot: string): SourceVisitor<AnyViolation> {
  return (file, astText, locationText, offset, violations, kind) => {
    const relToSrc = relative(srcRoot, resolve(ROOT, file));
    collectLegacyViolations(file, astText, locationText, offset, violations, kind);
    if (!isRawSdkAllowedPath(relToSrc)) {
      collectViolations(file, astText, locationText, offset, violations, kind);
    }
  };
}

function visitorFor(phase: Phase): SourceVisitor<AnyViolation> {
  if (phase.rules === "legacy") {
    return (file, astText, locationText, offset, violations, kind) =>
      collectLegacyViolations(file, astText, locationText, offset, violations, kind);
  }
  if (phase.rules === "partitioned") {
    return partitionedVisitor(phase.dir);
  }
  return (file, astText, locationText, offset, violations, kind) =>
    collectViolations(file, astText, locationText, offset, violations, kind);
}

function runPhases(phases: readonly Phase[]): number {
  const violations: AnyViolation[] = [];
  const failures: string[] = [];

  // 逐相位扫描：`scanned` 是**每个相位自己的**读数，不能合并成一个总数——合并之后
  // 「某一相位扫不到文件」会被另一相位的读数掩盖。
  const scans = phases.map((phase) => ({
    phase,
    scanned: scanSourceDirs([{ dir: phase.dir, skip: phase.skip }], violations, failures, {
      root: ROOT,
      visitor: visitorFor(phase),
    }).scanned,
  }));
  const scanLabel = scans
    .map(({ phase, scanned }) => `${describe(phase)}:${scanned} 个文件`)
    .join(", ");

  if (violations.length > 0) {
    console.error(
      `raw SDK static scan FAILED [${phases.map(describe).join(", ")}]: ${violations.length} 处越界（${scanLabel}）。`,
    );
    for (const v of sortViolations(violations)) {
      console.error(`  ${v.file}:${v.line}:${v.column} -> ${v.text}  [${v.rule}]`);
    }
    console.error(
      "Access the SDK only via Driver/Loader boundaries; probe the global only from core/loader (readJsapiV4Global() is the single legal entry for JSAPI 4.0)." +
        `\n${LEGACY_RULES_LABEL}：旧引擎（webgl-v1 / BMapGL 引擎）已删除，任何位置都不得出现（官方插件命名空间 BMapGLLib 与官方 4.0 runtime 自己挂的别名不受影响）。` +
        "\nBoundary spec: scripts/raw-sdk-boundary.mts.",
    );
    return 1;
  }

  if (failures.length > 0) {
    console.error("raw SDK static scan FAILED (unparsable input; refusing to pass silently):");
    for (const f of failures) {
      console.error(`  ${f}`);
    }
    return 1;
  }

  // 空转守卫（fail-closed）：某个相位一个文件都没扫到时，它**什么都没检查**。
  // 目录配错、被整体跳过（例如某个相位只剩 `*.test.ts`）都属于这一类。
  const empty = scans.filter((scan) => scan.scanned === 0);
  if (empty.length > 0) {
    console.error(
      `raw SDK static scan FAILED: 扫描范围为空（${empty.map(({ phase }) => describe(phase)).join(", ")}）` +
        `——${scanLabel}。一个文件都没扫到说明目录配错或被整体跳过，此时放行等于门禁空转。`,
    );
    return 1;
  }

  console.log(
    `raw SDK static scan OK: ${phases.map(describe).join(", ")} are clean. (${scanLabel})`,
  );
  return 0;
}

function main(): number {
  const argv = process.argv.slice(2);

  if (argv.includes("--print-boundary")) {
    console.log(JSON.stringify({ ...boundarySummary(), rules: RULE_LABELS }, null, 2));
    return 0;
  }

  const dirFlag = argv.indexOf("--dir");
  const srcFlag = argv.indexOf("--src");
  const declarationsFlag = argv.indexOf("--declarations");

  if (dirFlag !== -1) {
    // 显式 --dir：调用方指定的那棵树全部视为禁区（历史行为，门禁自测依赖它）。
    return runPhases([
      { label: "explicit-dir", dir: resolve(argv[dirFlag + 1] ?? ""), rules: "boundary" },
    ]);
  }
  if (srcFlag !== -1) {
    return runPhases([
      { label: "src-tree", dir: resolve(argv[srcFlag + 1] ?? ""), rules: "partitioned" },
    ]);
  }
  if (declarationsFlag !== -1) {
    return runPhases([
      {
        label: "public-declarations",
        dir: resolve(argv[declarationsFlag + 1] ?? ""),
        rules: "legacy",
        skip: (file) => !file.endsWith(".d.ts"),
      },
    ]);
  }

  return runPhases(
    FORBIDDEN_SRC_DIRS.map((dir) => ({ label: dir, dir: join(PKG, dir), rules: "boundary" as const })),
  );
}

process.exitCode = main();
