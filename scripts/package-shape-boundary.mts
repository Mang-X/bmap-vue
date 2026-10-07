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
 * 加 `require` 条件或 `typesVersions` 会改动 #44 冻结的公共出口面，连动 `check:api` 的五份
 * API report 与 `export-surface-freeze.test.ts`，且属于 #158 的范围。见「非目标」。
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
   * 「例外成立的前提」变了。评审 #45 时实测——只钉 entrypoint 时，同一组子路径从
   * `node10` 漂到 `node16-cjs` 仍被 `accepted`。
   *
   * 可以是**一个**档位（如 `CJSResolvesToESM` 只发生在 `node16-cjs`），也可以是**一组**
   * 档位（#189 的 `./styles.css` 在四个档位下都无解析——它是一条纯资源出口，
   * 而 attw 判的是「类型声明能不能解析」，资源出口天然不参与这件事）。
   * 写成数组不是放宽：档位集合仍然**逐个全等**比对，多一个少一个都判红。
   */
  readonly expectedResolutionKind?: string | readonly string[];
  /**
   * 出现位置（entrypoint）的预期形态。
   *
   * 默认 `"entries"`：`entrypoints` 是一个**精确清单**，多一个少一个都判红 ——
   * 这是 `CJSResolvesToESM` / `NoResolution` 原有的口径，必须原样保留。
   *
   * `"per-resolution-kind"`：`entrypoints` 是**每个档位各自出现一次**的清单。
   * #189 的 `./styles.css` 需要这一档：它在 node10 / node16-cjs / node16-esm / bundler
   * 四档下**各报一条**，因此 4 条 problem 只有**一个** entrypoint。用精确清单口径会
   * 得到「新增子路径 ./styles.css ×4」这种读不出信息的结论，而按档位钉住之后，
   * 「某一档不再报」仍然会红（那意味着 attw 改了检查方式，该重新审阅这条登记）。
   */
  readonly entrypointShape?: "entries" | "per-resolution-kind";
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
  {
    kind: "NoResolution",
    why:
      "`./styles.css` 是一条**纯资源出口**（#189）：`\"./styles.css\": \"./dist/bmap-vue.css\"`。" +
      "attw 判的是「类型声明能不能解析」，而 CSS 不是声明，所以它在**四个档位下都无解析**——" +
      "这与上面那条（node10 拿不到子路径）成因不同，是「资源出口本来就不参与类型解析」。" +
      "刻意**不**给它配一份假 `.d.ts`：那会把 `import '<pkg>/styles.css'` 变成一条类型声明引用，" +
      "消费方拿到的是「声明存在但内容无关」的假承诺。",
    tracking: "#189",
    // 4 = node10 / node16-cjs / node16-esm / bundler 四档**各一条**。
    expectedCount: 4,
    // 成立前提：与档位无关——资源出口在**所有**解析档位下都不产生类型解析。
    expectedResolutionKind: ["node10", "node16-cjs", "node16-esm", "bundler"],
    // ⚠️ 只有一个 entrypoint，但四档各报一条 ⇒ 用 per-resolution-kind 口径，
    // 否则会算成「新增子路径 ./styles.css ×4」，读不出「哪一档变了」。
    entrypoints: ["./styles.css"],
    entrypointShape: "per-resolution-kind",
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

  /* 一个 `kind` 可以有多条登记：`NoResolution` 现在有两条，成因不同
   * （node10 拿不到子路径 / `./styles.css` 是资源出口、四档都不参与类型解析）。
   * 合并成一条会丢掉「哪条成立」这个信息，也会让 `expectedCount` 变成一个没有依据的合数。 */
  const byKind = new Map<string, AttwException[]>();
  for (const exception of exceptions) {
    const list = byKind.get(exception.kind) ?? [];
    list.push(exception);
    byKind.set(exception.kind, list);
  }
  const problems: AttwProblem[] = [];
  const accepted: AttwProblem[] = [];
  /* 「这一轮出现过」的状态必须追踪到**单条登记**，不能只追踪 `kind`。
   *
   * ⚠️ 按 kind 追踪有一条实测确认的假绿路径（PR #200 评审 P1）：`NoResolution` 有两条例外
   * （#158 的 6 个 node10 子路径、#189 的 `./styles.css` 四档）。若报告里 #158 的 6 条正常、
   * 而 #189 的 4 条**整条消失**，则本轮会 `seenKinds.add("NoResolution")`；反向遍历再按
   * `seenKinds.has(kind)` 逐条跳过时，**两条**登记都会被跳过 —— 最终 `problems === []`，
   * 而「一整条同 kind 登记消失」恰恰是本门禁承诺要 fail-closed 的形状。
   *
   * 用**对象身份**而不是自造的字符串 key：这里比较的就是 `exceptions` 数组里的同一批对象，
   * 身份相等即「同一条登记」，不必再发明 `kind + tracking + …` 拼接键（那种键一旦有两条例外
   * 恰好同形就会互相顶替，而「同形」本身是合法登记）。 */
  const seenExceptions = new Set<AttwException>();

  for (const [kind, occurrences] of Object.entries(problemMap)) {
    const list = Array.isArray(occurrences) ? occurrences : [];
    const registered = byKind.get(kind);
    if (!registered) {
      // 表里没有的 kind：无论它出现几次都是新问题（空数组除外，见下面的反向遍历）。
      if (list.length > 0) {
        problems.push({ kind: `unexpected:${kind}`, detail: describeOccurrences(kind, list) });
      }
      continue;
    }
    if (list.length === 0) {
      // **不要**标记任何登记为已出现：空数组等于「这一轮没出现」，必须落到下面的反向遍历里
      // 报 vanished。第一版在这里就 `seenKinds.add(kind)` 提前 continue，导致空数组
      // 既不算 unexpected、也不算 vanished —— 彻底静默。
      continue;
    }
    const detail = describeOccurrences(kind, list);

    /* 例外必须**逐条对齐**：只按 kind 匹配的话，同一类问题从 7 处涨到 8 处仍然放行，
     * 而那正是「某个子路径开始解析不对」的信号。
     *
     * 一个 kind 有多条登记时（`NoResolution` 有两条：node10 拿不到子路径 / `./styles.css`
     * 是资源出口），必须先把这一轮的 occurrences **分摊**给各条登记，再逐条比对。
     *
     * ⚠️ 不能写成「某一条能解释全部就放行」：`./styles.css` 那条只认自己的 4 条，
     * 拿它去对全部 10 条必然不一致；反过来，先按 entrypoint 把属于它的 4 条摘出去，
     * 剩下的 6 条才该由另一条解释。第一版就是「任一条解释全部即通过」，
     * 实测输出的结论是两条各自都对不上 —— 判据退化成了永远判红。
     *
     * 分摊口径：按 entrypoint 取交集。某条登记声称的 entrypoint 命中的那部分归它，
     * 剩下的继续参与后面的匹配。认领后仍要逐条比 count / 档位 / 清单，
     * 所以「认领了但档位不对」照旧会红。 */
    const unclaimed = [...list];
    const driftDetails: string[] = [];
    let explained = true;
    for (const exception of registered) {
      const wants = exception.entrypoints;
      const mine =
        wants === undefined
          ? unclaimed
          : unclaimed.filter((o) => wants.includes(String(o?.entrypoint ?? "?")));
      // 这一条登记在本轮 occurrences 里没有任何位置 —— 不在这里判红，也**不**标记它出现过。
      // 那属于「登记过、但这一轮没出现」的形状，由下面的反向遍历统一报 `exception-vanished`。
      // 在这里也报一次会让同一次缺失出两条结论，而其中一条（「登记已过时？」）是臆测。
      if (mine.length === 0) continue;
      // 认领到了 occurrences ⇒ 这一条**确实出现了**（即便随后判出 drift，也只该报 drift
      // 一条，不该再报 vanished —— 那两项说的是互斥的两件事）。
      seenExceptions.add(exception);
      for (const item of mine) unclaimed.splice(unclaimed.indexOf(item), 1);
      const mismatches = compareWithException(mine, exception);
      if (mismatches.length > 0) {
        driftDetails.push(`[${exception.tracking}] ${mismatches.join("；")}`);
        explained = false;
      }
    }
    if (unclaimed.length > 0) {
      driftDetails.push(
        `有 ${unclaimed.length} 条没有被任何登记认领：` + describeOccurrences(kind, unclaimed),
      );
      explained = false;
    }
    if (!explained) {
      problems.push({
        kind: `exception-drift:${kind}`,
        detail: `${detail} —— ${driftDetails.join("；且 ")}。例外要逐条复核，不要让它静默增长`,
      });
      continue;
    }

    accepted.push({ kind, detail });
  }

  /* 反向遍历：登记过、但这一轮**没出现**的例外也要报 —— **逐条**判，不是逐 kind。
   *
   * 第一版只遍历报告里现有的 key，于是 `NoResolution` 从 6 处降到 0 处、甚至整类消失
   * （`problems: {}`）时，`expectedCount` 根本不进比较，`problems` 仍是 `[]` —— 假绿。
   * 那与本文件的登记口径直接矛盾：例外是「逐条审阅后刻意接受」的一组**具体**事实，
   * 问题被修好意味着该**删掉登记**并重新审阅，而不是让门禁静默变绿。
   *
   * 第二版（本处修复前）按 `kind` 追踪，于是同 kind 的**一条**登记消失会被另一条的出现
   * 掩盖（PR #200 评审 P1 实测：`./styles.css` 4 条全消失、#158 的 6 条仍在 ⇒ `problems` 为空）。
   * 现在按单条登记判，两条 `NoResolution` 各自独立。
   *
   * 「问题消失了」在两种情况下都需要人看一眼：
   * - 真的修好了 → 删登记，并在 ADR 里记一笔；
   * - attw 改了它的检查方式 → 重新评估这条例外还成不成立。
   */
  for (const exception of exceptions) {
    if (seenExceptions.has(exception)) continue;
    // 同 kind 可能有多条登记，因此描述里必须带上**是哪一条**（追踪票号 + 子路径清单），
    // 否则两条同 kind 的 vanished 在日志里长得一模一样。
    const shape = exception.entrypointShape === "per-resolution-kind" ? "，按解析档位各一条" : "";
    const entries = (exception.entrypoints ?? []).join(", ");
    problems.push({
      kind: `exception-vanished:${exception.kind}`,
      detail:
        `登记的例外 "${exception.kind}"（追踪 ${exception.tracking}；子路径 ${entries || "—"}${shape}）` +
        `这一轮完全没有出现（预期 ${exception.expectedCount ?? "?"} 处）。` +
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
    // 可以是单档，也可以是一组档位；**逐个全等**比对，多一个少一个都判红。
    const expectedKinds = Array.isArray(exception.expectedResolutionKind)
      ? [...exception.expectedResolutionKind]
      : [exception.expectedResolutionKind as string];
    const actualKinds = [...new Set(list.map((o) => String(o?.resolutionKind ?? "?")))];
    const unexpected = actualKinds.filter((k) => !expectedKinds.includes(k));
    const vanished = expectedKinds.filter((k) => !actualKinds.includes(k));
    if (unexpected.length > 0) {
      mismatches.push(
        `解析档位漂移：预期 ${expectedKinds.join(" / ")}，实际还出现了 ${unexpected.join(", ")}` +
          `（例外成立的前提是那些档位下的解析行为）`,
      );
    }
    if (vanished.length > 0) {
      mismatches.push(
        `预期档位 ${vanished.join(", ")} 这一轮没有报出来（问题被修好、或 attw 改了检查方式，都该重新审阅这条登记）`,
      );
    }
  }

  if (exception.entrypoints !== undefined) {
    // `per-resolution-kind`：清单是**每个档位各一次**，因此按档位逐条比对而不是按条目去重。
    // 例：`./styles.css` 在四个档位下各报一条 problem，但只有**一个** entrypoint ——
    // 用精确清单口径会算出「新增子路径 ./styles.css ×4」，读不出任何信息。
    const actual =
      exception.entrypointShape === "per-resolution-kind"
        ? list.map((o) => `${String(o?.entrypoint ?? "?")}@${String(o?.resolutionKind ?? "?")}`).sort()
        : list.map((o) => String(o?.entrypoint ?? "?")).sort();
    const expected = (
      exception.entrypointShape === "per-resolution-kind"
        ? exception.entrypoints.flatMap((entry) =>
            (Array.isArray(exception.expectedResolutionKind)
              ? exception.expectedResolutionKind
              : [exception.expectedResolutionKind as string]
            ).map((kind) => `${entry}@${kind}`),
          )
        : [...exception.entrypoints]
    ).sort();
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