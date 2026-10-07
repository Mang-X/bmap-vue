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
  /** **发布组件**的计算样式读数（在装出来的 tarball 上渲染后读出来）。 */
  readonly computedStyle: ComputedStyleReport;
}

export interface ComputedStyleReport {
  /** 发布 `styles.css` 的解析路径（必须来自装出来的包）。 */
  readonly stylesPath: string;
  /** 发布组件自己渲染出来的 `data-v-*` 属性（**不是**测试补上去的）。 */
  readonly scopeAttributes: readonly string[];
  /** 这些 scope 属性里，有没有哪一个真的出现在发布 CSS 的选择器里。 */
  readonly cssHasMatchingScope: boolean;
  readonly computed: {
    readonly position: string;
    readonly zIndex: string;
    readonly top: string;
    readonly left: string;
    readonly maxWidth: string;
    readonly boxSizing: string;
  };
  /** 反证：没有 scope 属性的同类元素算出来的 `position`。 */
  readonly barePosition: string;
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

  assertComputedStyle(report.computedStyle);
}

/**
 * 发布 JS 与发布 CSS 之间的**真实耦合**（#208 评审 P1）。
 *
 * 这条判据的要点是 scope 属性**来自发布组件自己渲染出来的 DOM**，而不是测试从 CSS 里抽一个
 * hash 手工补上去：手工补的话，发布组件丢了 scope 绑定、或者 JS / CSS 来自不一致的构建，
 * 用例照样绿 —— 它证明的只是「这段 CSS 在人为补齐选择器后能算出这些属性」。
 */
function assertComputedStyle(computedStyle: ComputedStyleReport): void {
  if (!computedStyle.stylesPath.includes("node_modules")) {
    throw new Error(
      `[consumer-styles] 计算样式读的样式表不在 node_modules 里：${computedStyle.stylesPath} —— ` +
        `这条判据要验的是**装出来的包**，不是仓库里的 dist。`,
    );
  }
  if (computedStyle.scopeAttributes.length === 0) {
    throw new Error(
      "[consumer-styles] 发布组件渲染出来的输入框上**没有** `data-v-*` 属性 —— " +
        `发布 JS 丢了 scoped 绑定，发布 CSS 就永远命不中它（此时读到的计算样式是假的）。`,
    );
  }
  if (!computedStyle.cssHasMatchingScope) {
    throw new Error(
      `[consumer-styles] 发布组件的 scope 属性 ${computedStyle.scopeAttributes.join(", ")} ` +
        `没有一个出现在发布 CSS 的选择器里 —— JS 与 CSS 来自不一致的构建。`,
    );
  }

  const expected: Array<[keyof ComputedStyleReport["computed"], string]> = [
    ["position", "absolute"],
    ["zIndex", "10"],
    ["top", "10px"],
    ["left", "10px"],
    ["maxWidth", "calc(100% - 20px)"],
    ["boxSizing", "border-box"],
  ];
  const wrong = expected
    .filter(([property, value]) => computedStyle.computed[property] !== value)
    .map(([property, value]) => `${property}=${computedStyle.computed[property]}（期望 ${value}）`);
  if (wrong.length > 0) {
    throw new Error(
      `[consumer-styles] 发布组件的计算样式不对：${wrong.join("; ")} —— ` +
        `发布 CSS 没有真的作用到发布组件上。`,
    );
  }

  // 反证：同 class 但没有 scope 属性的元素不该命中那条规则，否则「命中了」这件事没有区分力。
  if (computedStyle.barePosition === "absolute") {
    throw new Error(
      "[consumer-styles] 没有 scope 属性的同类元素也算出了 `position: absolute` —— " +
        `那条规则实际上是按 class 无条件生效的，上面「命中了」不能作为 scope 耦合的证据。`,
    );
  }
}
