/**
 * 发布包**形状**契约的判定内核（issue #45）：publint / attw / API Extractor 的版本锁与判据
 *
 * 单独成文件是为了能**被用例直接 import**（驱动脚本顶层跑 `main()`）。
 * 与 `docs-brand-boundary.mts` / `raw-sdk-boundary.mts` / `api-forgotten-boundary.mts` 同理。
 *
 * ## 这道门禁补的是哪个洞
 *
 * `quality.yml` 的 `package` job 里那两行原本是：
 *
 * ```bash
 * npx -y publint .                                    # 版本不锁：每次跑到的可能不是同一个
 * npx -y @arethetypeswrong/cli --pack . --format table > /tmp/attw.txt 2>&1 || true
 * grep -q 'node16 (from ESM).*🟢' /tmp/attw.txt || (cat /tmp/attw.txt; exit 1)
 * ```
 *
 * 三个问题，每一个都单独成立：
 *
 * 1. **版本不锁**。`npx -y` 每次从 registry 取当时的最新版，lockfile 管不到它。上游新增一条
 *    检查就会让一个昨天还绿的 PR 今天变红，而没人知道是哪条。
 * 2. **判定被压成一句 grep**。attw 的结论有四档解析模式（`node10` / `node16-cjs` /
 *    `node16-esm` / `bundler`），grep 只看 `node16 (from ESM)` 那一格。
 * 3. **`|| true` 吞掉 attw 自己的退出码**。attw 崩了（脚手架失败）和 attw 判了契约不满足，
 *    在这一步长得一模一样。
 *
 * 实测当前 tarball 上 attw 报的 `problems`（第一版 grep 把这两类**全部**藏住了）：
 *
 * | 问题 | 子路径 | 档 | 成因 |
 * | --- | --- | --- | --- |
 * | `CJSResolvesToESM` | 全部 7 个 | `node16-cjs` | `exports` 只有 `import` 条件、没有 `require`，而包本身是 ESM-only（`type: module`） |
 * | `NoResolution` | 6 个子路径 | `node10` | 没有 `typesVersions` |
 *
 * **这两条都是有意设计的后果，不是缺陷**（见 ADR 2026-09-25 的 ESM-only 冻结面）。本模块的
 * 职责不是把它们「修掉」，而是把它们**枚举成有测试覆盖的显式例外**——原来的 grep 让它们
 * 隐形，现在它们会被打印出来、并在漂移时变红。
 *
 * ## 为什么不顺手修
 *
 * 加 `require` 条件或 `typesVersions` 会改动  冻结的公共出口面，连动 `check:api` 的五份
 * API report 与 `export-surface-freeze.test.ts`，且属于  的范围。见「非目标」。
 */

/** 已被逐条审阅、**刻意接受**的 attw 结论。每条都必须带理由与追踪票号。 */
export interface AttwException {
  readonly kind: string;
  readonly why: string;
  readonly tracking: string;
  /**
   * 预期出现的**次数**，以及每条都必须匹配的位置。
   *
   * 缺了它，例外表只按 `kind` 匹配，于是 `CJSResolvesToESM` 从 7 个子路径涨到 8 个
   * 仍然全绿——而那意味着**多了一个子路径解析不对**，正是需要人看一眼的变化。
   * 「刻意接受某一类问题」不等于「刻意接受它出现在任意多个地方」。
   *
   * `entrypoints` 刻意**逐个列出**而不是只记个数：只记数量的话，「7 变 8」看不出是哪个
   * 子路径新增了问题，而那正是要处置的信息。
   */
  readonly expectedCount?: number;
  readonly entrypoints?: readonly string[];
  /**
   * 预期出现的**解析档位**（attw 的 `resolutionKind`，如 `node10` / `node16-cjs`）。
   *
   * 同样必须钉：这两条例外的理由本身就是特定档位下的解析行为，档位变了意味着
   * 「例外成立的前提」变了。评审  时实测——只钉 entrypoint 时，同一组子路径从
   * `node10` 漂到 `node16-cjs` 仍被 `accepted`。
   */
  readonly expectedResolutionKind?: string;
}

/**
 * 例外表刻意**非空**：空表会让「attw 报告了一个新问题」与「attw 什么都没报」无法区分，
 * 而这两者必须区分（前者要处置，后者才可放行）。
 *
 * 判据的区分力由用例逐条证明：`tests/behavior/package-shape-gate.test.ts` 断言表非空、
 * 每条都有 `why` + `tracking`、**每条都钉住了预期次数与子路径清单**，并用「不在表里的
 * problem id」与「次数对不上」两种输入分别证明会红。
 */
export const ATTW_EXCEPTIONS: readonly AttwException[] = [
  {
    kind: "CJSResolvesToESM",
    why: "exports 只有 import 条件、无 require，产物是纯 ESM（type: module）。CJS require 本库不是承诺的使用方式；加 require 条件会改动 #44 冻结的出口面。",
    tracking: "#158",
    // 8 = 根入口 + 六个子入口 + `./volar`（`./package.json` 不参与类型解析，因此不在列）。
    // `./volar` 是纯 `types` 出口：它没有 `import` 条件，因此在 node16-cjs 下同样落入
    // 「CJS require 一个只声明了类型的产物」这一类——与其它七处同源，故一并登记。
    // 若将来给它补上 `import`（让它可被真正 import），这条要从例外里去掉。
    expectedCount: 8,
    // 成立前提：CJS 解析（node16-cjs）下 ESM 产物被 require。档位漂移则例外不再成立。
    expectedResolutionKind: "node16-cjs",
    entrypoints: [
      ".",
      "./advanced",
      "./components",
      "./composables",
      "./plugins",
      "./resolver",
      "./ui-kit",
      "./volar",
    ],
  },
  {
    kind: "NoResolution",
    why: "未提供 typesVersions，因此 node10（旧式）解析器拿不到子路径。1.0 只承诺 exports 时代（bundler / node16+）的解析；补 typesVersions 同样属于 #44 冻结面变更。",
    tracking: "#158",
    // 6 = 六个子入口。根入口不走子路径解析（它由顶层 `types` 字段满足），因此不在列。
    expectedCount: 6,
    // 成立前提：旧式 node10 解析拿不到子路径。node16+ 出现 NoResolution 则是新缺陷。
    expectedResolutionKind: "node10",
    entrypoints: ["./advanced", "./components", "./composables", "./plugins", "./resolver", "./ui-kit"],
  },
];

/** attw JSON 报告的最小形状（只取本模块用到的字段，避免把整个报告类型搬进来）。 */
export interface AttwReportLike {
  readonly problems?: Record<string, readonly { readonly entrypoint?: string; readonly resolutionKind?: string }[]>;
  readonly entrypoints?: Record<string, unknown>;
  readonly types?: unknown;
}

export interface AttwProblem {
  readonly kind: string;
  readonly detail: string;
}

/**
 * 判据：比对 attw 报告与例外表。
 *
 * 三种失败形状刻意分开：
 * - 表里**没有**的 problem ⇒ 契约回归或上游新增检查，必须处置；
 * - 空 / 坏 JSON ⇒ 脚手架失败（**不是**通过）——「没跑起来」与「跑过了没问题」必须可区分；
 * - 命中例外表 ⇒ 放行，但由调用方打印出来，让它可见而非隐形。
 */
export function evaluateAttwReport(
  report: AttwReportLike | null | undefined,
  exceptions: readonly AttwException[] = ATTW_EXCEPTIONS,
): {
  readonly problems: readonly AttwProblem[];
  readonly accepted: readonly AttwProblem[];
} {
  if (report === null || report === undefined || typeof report !== "object") {
    return {
      problems: [{ kind: "attw-unreadable", detail: "attw 没有产出可解析的 JSON：脚手架失败，不等于通过" }],
      accepted: [],
    };
  }
  const problemMap = report.problems;
  if (problemMap === null || problemMap === undefined || typeof problemMap !== "object") {
    return {
      problems: [
        {
          kind: "attw-unreadable",
          detail: "attw JSON 缺少 problems 字段：无法判定契约是否成立（fail-closed）",
        },
      ],
      accepted: [],
    };
  }

  const byKind = new Map(exceptions.map((e) => [e.kind, e]));
  const problems: AttwProblem[] = [];
  const accepted: AttwProblem[] = [];
  const seenKinds = new Set<string>();

  for (const [kind, occurrences] of Object.entries(problemMap)) {
    const list = Array.isArray(occurrences) ? occurrences : [];
    const exception = byKind.get(kind);
    if (!exception) {
      // 表里没有的 kind：无论它出现几次都是新问题（空数组除外，见下面的反向遍历）。
      if (list.length > 0) {
        problems.push({ kind: `unexpected:${kind}`, detail: describeOccurrences(kind, list) });
      }
      continue;
    }
    if (list.length === 0) {
      // **不要**记进 seenKinds：空数组等于「这一轮没出现」，必须落到下面的反向遍历里
      // 报 vanished。第一版在这里就 `seenKinds.add(kind)` 提前 continue，导致空数组
      // 既不算 unexpected、也不算 vanished —— 彻底静默。
      continue;
    }
    seenKinds.add(kind);
    const detail = describeOccurrences(kind, list);

    /* 例外必须**逐条对齐**：只按 kind 匹配的话，同一类问题从 7 处涨到 8 处仍然放行，
     * 而那正是「某个子路径开始解析不对」的信号。 */
    const mismatches = compareWithException(list, exception);
    if (mismatches.length > 0) {
      problems.push({
        kind: `exception-drift:${kind}`,
        detail: `${detail} —— 与登记的例外不一致：${mismatches.join("；")}。例外要逐条复核，不要让它静默增长`,
      });
      continue;
    }

    accepted.push({ kind, detail });
  }

  /* 反向遍历：登记过、但这一轮**没出现**的例外也要报。
   *
   * 第一版只遍历报告里现有的 key，于是 `NoResolution` 从 6 处降到 0 处、甚至整类消失
   * （`problems: {}`）时，`expectedCount` 根本不进比较，`problems` 仍是 `[]` —— 假绿。
   * 那与本文件的登记口径直接矛盾：例外是「逐条审阅后刻意接受」的一组**具体**事实，
   * 问题被修好意味着该**删掉登记**并重新审阅，而不是让门禁静默变绿。
   *
   * 「问题消失了」在两种情况下都需要人看一眼：
   * - 真的修好了 → 删登记，并在 ADR 里记一笔；
   * - attw 改了它的检查方式 → 重新评估这条例外还成不成立。
   */
  for (const exception of exceptions) {
    if (seenKinds.has(exception.kind)) continue;
    problems.push({
      kind: `exception-vanished:${exception.kind}`,
      detail:
        `登记的例外 "${exception.kind}" 这一轮完全没有出现（预期 ${exception.expectedCount ?? "?"} 处）。` +
        `若问题已修好，请删掉这条登记并在 ADR 记一笔；若 attw 改了检查方式，请重新评估它是否仍该被接受。`,
    });
  }

  return { problems, accepted };
}

/** 把一组 occurrence 渲染成 `kind × n（ep@kind, …）`。 */
function describeOccurrences(kind: string, list: readonly { entrypoint?: string; resolutionKind?: string }[]): string {
  const sites = list.map((o) => `${o?.entrypoint ?? "?"}@${o?.resolutionKind ?? "?"}`).sort();
  return `${kind} × ${list.length}（${sites.join(", ")}）`;
}

/**
 * 比对一组 occurrence 与登记的例外，返回**人类可读的差异**（空数组 = 完全一致）。
 *
 * 刻意同时比 `entrypoint` **与** `resolutionKind`：这两条例外的理由本身就是特定解析模式
 * 造成的（`CJSResolvesToESM` 只在 `node16-cjs` 出现、`NoResolution` 只在 `node10` 出现）。
 * 只钉 entrypoint 的话，同一组子路径从 `node10` 漂到 `node16-cjs` 仍会被接受，而那意味着
 * 「CJS 解析方式变了」——是必须人看一眼的信号。
 */
function compareWithException(
  list: readonly { entrypoint?: string; resolutionKind?: string }[],
  exception: AttwException,
): string[] {
  const mismatches: string[] = [];

  if (exception.expectedCount !== undefined && list.length !== exception.expectedCount) {
    mismatches.push(`预期 ${exception.expectedCount} 处，实际 ${list.length} 处`);
  }

  if (exception.expectedResolutionKind !== undefined) {
    const wrongKind = [...new Set(list.map((o) => String(o?.resolutionKind ?? "?")))].filter(
      (k) => k !== exception.expectedResolutionKind,
    );
    if (wrongKind.length > 0) {
      mismatches.push(
        `解析档位漂移：预期全部是 ${exception.expectedResolutionKind}，实际出现 ${wrongKind.join(", ")}` +
          `（例外成立的前提是该档位下的解析行为）`,
      );
    }
  }

  if (exception.entrypoints !== undefined) {
    const actual = list.map((o) => String(o?.entrypoint ?? "?")).sort();
    const expected = [...exception.entrypoints].sort();
    const added = actual.filter((e) => !expected.includes(e));
    const removed = expected.filter((e) => !actual.includes(e));
    if (added.length > 0) mismatches.push(`新增子路径 ${added.join(", ")}`);
    if (removed.length > 0) mismatches.push(`消失的子路径 ${removed.join(", ")}（该修好问题了？）`);
  }

  return mismatches;
}

/**
 * 依赖版本锁的判据：这些工具是**门禁**不是库。
 *
 * 带 `^` / `~` / `latest` 时，上游一次 minor 就能在没人 review 的情况下改变判定。所以要求
 * 精确锁（`x.y.z`）；升级走一次显式 diff，和 `@baidumap/jsapi-loader@1.0.0` 的处置一致。
 */
export function unpinnedVersionIssues(
  declared: Record<string, unknown>,
  expected: readonly string[],
): string[] {
  const issues: string[] = [];
  for (const name of expected) {
    const version = declared[name];
    if (typeof version !== "string") {
      issues.push(`${name} 未声明：门禁工具必须是被锁定的依赖，不能靠 npx -y 在 CI 里现取`);
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      issues.push(`${name} 版本必须精确锁定到 x.y.z，实际为 "${version}"：门禁的判定不该被一次上游 minor 静默改变`);
    }
  }
  return issues;
}