/**
 * 样式消费报告的判据（issue #158 工作包 D）
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发真实
 * `vite build`；这里只有纯函数，可以喂**合成产物**做行为级反例。与
 * `consumer-isolation.mts` / `consumer-ssr-boundary.mts` 的分层理由相同。
 *
 * ## 判据
 *
 * 1. **显式 import `styles.css` 的产物必须有 Autocomplete 规则**。只断言「CSS 文件存在」
 *    不够 —— 它可能是空的、或者根本没带上那份规则。
 * 2. **不 import 的产物必须没有**。`sideEffects` 只声明了那一份 CSS，
 *    本库**不自动注入**样式；只有显式 import 才该出现。少了这条，「自动注入」回归无声通过。
 * 3. **正向对照**：根入口产物里确实有本库代码，否则上面两条可能只是「什么都没打包」。
 *
 * basic 与 UI 消费方之间的边界（根入口不静态拉进可选 UI Kit）由
 * `tests/behavior/ui-kit-entry.test.ts` 判（从 `dist/index.mjs` 的 ESM 闭包 + 真实 Vite
 * basic / UI 两次生产构建）—— 静态 re-export 会被 tree-shaking 藏起来，在产物里看不出来。
 */
export interface StylesBuild {
  readonly code: string;
  readonly css: string;
}

export interface StylesReport {
  readonly withStyles: StylesBuild;
  readonly rootOnly: StylesBuild;
}

/** Autocomplete 输入框样式里的可辨识规则（`dist/bmap-vue.css` 的真实内容）。 */
const AUTOCOMPLETE_RULES = [
  "b-auto-complete-input",
  "position:absolute",
  "z-index:10",
  "top:10px",
  "left:10px",
] as const;

/** 本库运行时的可辨识标记（正证：产物里确实有本库代码）。 */
const LIBRARY_CODE_MARKER = "BMAP_";

/** 去掉空白再比：CSS 里的换行/缩进不该影响判据。 */
function squash(input: string): string {
  return input.replace(/\s+/g, "");
}

export function assertStylesReport(report: StylesReport): void {
  const withStylesCss = squash(report.withStyles.css);
  if (withStylesCss.length === 0) {
    throw new Error(
      "[consumer-styles] 显式 import '<pkg>/styles.css' 的产物里**没有任何 CSS** —— " +
        `样式子路径没有真的被消费方打包进来。`,
    );
  }
  const missingRules = AUTOCOMPLETE_RULES.filter((rule) => !withStylesCss.includes(rule));
  if (missingRules.length > 0) {
    throw new Error(
      `[consumer-styles] 显式 import 的产物 CSS 缺少 Autocomplete 规则：${missingRules.join(", ")}\n` +
        `  实际 CSS：${report.withStyles.css.slice(0, 400)}`,
    );
  }

  // 不 import 就不该有：本库不自动注入样式（#189 的边界）。
  if (squash(report.rootOnly.css).includes("b-auto-complete-input")) {
    throw new Error(
      "[consumer-styles] 没有 import '<pkg>/styles.css' 的产物里出现了 Autocomplete 规则 —— " +
        `本库不自动注入样式，出现即说明有别的路径把它带进来了。`,
    );
  }

  // 正向对照：产物里确实有本库代码，否则「没有 Autocomplete 规则」可能只是打空了
  // （入口被摇成 0 字节时，CSS 断言会因为「没有 CSS」红，但这条把根因说清楚）。
  //
  // basic 与 UI 消费方之间的边界（根入口不静态拉进可选 UI Kit）**不在**这里判：
  // 静态 re-export 会被 tree-shaking 藏起来，产物里看不出来。那条由
  // `tests/behavior/ui-kit-entry.test.ts` 从 `dist/index.mjs` 的 ESM 闭包判（真实 Vite
  // basic / UI 两次生产构建作正反对照），这里不重复一套更弱的。
  if (!report.rootOnly.code.includes(LIBRARY_CODE_MARKER)) {
    throw new Error(
      `[consumer-styles] 根入口产物里找不到本库标记 \`${LIBRARY_CODE_MARKER}\` —— ` +
        `产物根本没打进来，样式那条断言就没有着力点。`,
    );
  }
}
