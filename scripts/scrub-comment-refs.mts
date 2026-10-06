#!/usr/bin/env node
/**
 * 一次性清理：删掉注释里的跨文档引用**编号**，保留解释（issue #192）
 *
 * ## 为什么第一版脚本被废弃
 *
 * 第一版用一组「就地替换」的正则（`issue #N Class 3 / TASK 5` → 直接删），结果**弄坏了句子**：
 *
 * ```text
 * （M4-HANDLE-UX / issue #29）      → （M4-HANDLE-UX /        # 括号残缺
 * 签名里 ⇒ …可命名（ADR … 处置类别 ①） → 签名里 ⇒ …可命名处置类别 ①）  # 括号残缺且句子不通
 * （issue #165 Class 3 / TASK 5）    → / TASK 5）              # 留下碎片
 * ```
 *
 * 根因：正则分不清「引用」与「句子成分」——`（issue #N 后跟解释）` 与 `（解释，含 issue #N）`
 * 在字符层面几乎一样。因此**不再追求全自动**。
 *
 * ## 这一版的策略：只删「删得干净」的
 *
 * 唯一判据是**删除后括号仍然配平**（`（）` 与 `()` 计数不变）。实测该判据把 964 处分成：
 *
 * | 类别 | 数量 | 处理 |
 * | --- | --- | --- |
 * | 删后括号配平（安全） | 853 | 本脚本自动处理 |
 * | 删后括号失衡（危险） | 111 | **脚本跳过**，留人工逐个判断 |
 *
 * 宁可少删：漏删的行门禁会红并指出来，而改坏句子不会被任何东西发现。
 *
 * ## 幂等
 *
 * 可反复跑。清理后 `pnpm check:comment-hygiene` 应对剩余项转绿。
 *
 * 用法：`node --experimental-strip-types scripts/scrub-comment-refs.mts [--dry]`
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

/** `--only <substring>`：限定处理的路径子串（人工核对单文件时用）。 */
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  return i === -1 ? undefined : process.argv[i + 1];
})();

const SCAN_ROOTS = ["packages/bmap-vue/src", "scripts"];

/**
 * **必须排除**的文件：它们自己就在解释这些引用，删掉等于毁掉判据的文档。
 *
 * 踩过的坑：第一版没排除，脚本跑完把 `check-comment-hygiene.mts` 的文件头改成
 * 「注释卫生门禁（）」——它把自己的 `issue #192` 吃了。一个清理工具毁掉自己的
 * 使用说明，是最讽刺也最难发现的一类 bug（脚本仍然「成功」）。
 */
const EXCLUDE = new Set([
  "scripts/scrub-comment-refs.mts",
  "scripts/check-comment-hygiene.mts",
  "scripts/comment-hygiene-boundary.mts",
  "scripts/toolchain-boundary.mts",
  "scripts/check-toolchain.mts",
  "tests/behavior/comment-hygiene-gate.test.ts",
  "tests/behavior/toolchain-gate.test.ts",
]);
const EXTENSIONS = new Set([".ts", ".mts", ".vue"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".artifacts", ".pnpm", "types"]);

/**
 * 待删除的引用片段。**顺序不可随意调**：先长后短，
 * 否则「issue #165 Class 3」会先被「#165」那条吃掉、留下孤儿 `Class 3`。
 */
const PATTERNS: readonly RegExp[] = [
  // ① 文档路径（含可选前导「见 / 依据」与外层括号）
  /[（(]?\s*(?:见|详见|依据|参见)?\s*docs\/[\w./-]+\.md\s*[，,、]?\s*[）)]?/g,
  // ② ADR 引用（连同「决策 N」「§N」等后缀）
  /[（(]?\s*(?:见|详见|依据|参见)?\s*ADR\s*\d{4}-\d{2}-\d{2}\s*(?:的\s*)?(?:决策\s*\d+)?\s*(?:§\s*\d+)?\s*[）)]?\s*[，,、]?\s*/gi,
  // ③ `issue #N` 带子分类后缀
  /\bissue\s*#\d+(?:\s*(?:Class|item|TASK|§)\s*[\d.、\w]+)*/gi,
  // ⑤ 行首编号与其后紧跟的标点：`#166：` / `#171 补齐` / `M5-CUSTOM-MENU / #33：`
  //    必须连标点一起删，否则留下 `：` 或 `第二刀` 这种孤儿开头（实测残留的全部样例）。
  //    放最后：它最宽松，前面几条该处理的已经处理完了。
  /(^|\s)(?:[A-Z]\d[\w.-]*\s*[/、]\s*)*#\d+(?:\s*(?:Class|item|TASK|§)\s*[\d.、\w]+)*\s*(?:补齐|收口|新增|删除)?\s*[：:]\s*/gm,
  // ④ 裸编号 `#N`（带可选子分类）——放在 ③ 之后，它会吃掉 ③ 漏掉的
  /#\d+(?:\s*(?:Class|item|TASK|§)\s*[\d.、\w]+)*/g,
];

function collectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectFiles(full, out);
    else if (EXTENSIONS.has(name.slice(name.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

/** 括号是否配平（中文全角 + 半角，各算各的）。 */
function balanced(text: string): boolean {
  const count = (re: RegExp): number => (text.match(re) ?? []).length;
  return count(/（/g) === count(/）/g) && count(/\(/g) === count(/\)/g);
}

/** 该行是否含任何目标引用。 */
function hasReference(body: string): boolean {
  return PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(body);
  });
}

let changedFiles = 0;
let cleaned = 0;
let skipped = 0;
const skippedSamples: string[] = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of collectFiles(resolve(root, scanRoot))) {
    const rel = file.slice(root.length + 1).split("\\").join("/");
    if (EXCLUDE.has(rel)) continue;
    // `--only <substring>`：只处理路径含该子串的文件。人工核对单文件时用得��。
    if (ONLY !== undefined && !rel.includes(ONLY)) continue;

    const original = readFileSync(file, "utf8");
    const lines = original.split("\n");
    let fileChanged = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = /^(\s*)(\/\/|\*|<!--)/.exec(line);
      if (m === null) continue; // 只动整行注释，与门禁口径一致

      const body = line.slice(m[0].length);
      if (!hasReference(body)) continue;

      let next = body;
      for (const re of PATTERNS) next = next.replace(re, "");

      // 安全闸 1：**删除后括号仍配平**才动手，否则跳过留人工。
      if (!balanced(next)) {
        skipped += 1;
        if (skippedSamples.length < 8) skippedSamples.push(`${line.trim().slice(0, 84)}`);
        continue;
      }

      // 安全闸 2：**删除后不留碎片**。
      //
      // 第一版只判括号配平，删完留下了一堆悬空符号（实测）：
      //   （M8-PLUGIN-CORE / #42）    → （M8-PLUGIN-CORE / ）
      //   （#38 起 service…）          → （起 service…）      「起」成孤儿
      //   （issue #165 Class 3 / TASK 5） → （ / TASK 5）       引用被吃掉、分类碎片留下
      //
      // 三者的共同点：删除点**紧邻**的连接符（/ 起 TASK 等）失去了依托。
      // 因此追加两条形态检查：结尾不能是连接符、不能以连接符开头。
      const trimmedForCheck = next.trim();
      // 三种碎片形态（实测残留的全部样例）：
      //   ① 结尾悬空连接符：`（M8-PLUGIN-CORE / ）`     —— `/` 后面空了
      //   ② 空括号：`（issue #171 item I）` → `（）`
      //   ③ 删完只剩连接符开头：`（#109：…）` → `（：…`
      // ① 悬空连接符：`（M8-PLUGIN-CORE / ）` —— `/` 紧跟右括号，中間没有内容了。
      //    不能用 `$` 锚点判断（`/` 在整行里通常不在结尾），只能直接匹配「连接符 + 右括号」。
      const leavesFragment =
        /[/、]\s*[）)]/.test(trimmedForCheck) || // ①
        /[（(]\s*[：:]\s*/.test(trimmedForCheck) || // ③
        /[（(]\s*[）)]/.test(trimmedForCheck); // ②
      if (leavesFragment) {
        skipped += 1;
        if (skippedSamples.length < 8) skippedSamples.push(`${line.trim().slice(0, 84)}`);
        continue;
      }

      const trimmed = next.trim().replace(/[，,、:：]\s*$/, "");
      if (trimmed.length === 0) {
        // 整行只是引用 → 删掉整行
        lines[i] = undefined as unknown as string;
      } else {
        lines[i] = `${m[1]}${m[2]} ${trimmed}`;
      }
      fileChanged = true;
      cleaned += 1;
    }

    const out = lines.filter((l): l is string => l !== undefined).join("\n");
    if (fileChanged && out !== original) {
      changedFiles += 1;
      if (!DRY) writeFileSync(file, out, "utf8");
    }
  }
}

console.log(`[scrub-comment-refs]${DRY ? "（dry-run，未写盘）" : "已写盘"}`);
console.log(`  改动 ${changedFiles} 个文件；自动清理 ${cleaned} 行，跳过 ${skipped} 行（删后会破坏括号配平，需人工判断）`);
if (skippedSamples.length > 0) {
  console.log("\n  跳过样例（脚本不动它们）：");
  for (const s of skippedSamples) console.log(`    ${s}`);
  console.log(`    … 共 ${skipped} 行，需人工逐个判断：脚本无法在不破坏句子的前提下删除它们。`);
}
console.log("\n  清理后跑 `pnpm check:comment-hygiene` 看剩余项，再逐个判断。");