/**
 * Volar 消费者报告的判据（issue #158 工作包 C）
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发真实
 * `vue-tsc` 子进程；这里只有纯函数，可以喂**合成诊断**做行为级反例。与
 * `consumer-isolation.mts` / `consumer-ssr-boundary.mts` 的分层理由相同。
 *
 * ## 判据为什么落在「反证必须报错」上
 *
 * 只断言「正证零诊断」是没有判别力的：`GlobalComponents` 没生效时，`<Map>` 会被当成未知
 * 元素，正证照样零诊断。真正证明「组件类型真的生效、且 props / slots 没退化成 `any`」的是
 * **反证必须产生精确诊断**，而且两条诊断都要**锚定到具体反证**：
 *
 * - `:keep-alive-behavior="'definitely-not-a-real-mode'"` ⇒ `TS2322`，消息里带那个字面量联合
 *   的 sentinel —— 只按「文件里有某个 TS2322」判，别的表达式就能冒充；
 * - `#default="{ totallyNotARealMember }"` ⇒ `TS2339`，成员名同样作为 sentinel 断言。
 *
 * ## 退出码也要看
 *
 * `parseVolarDiagnostics` 只认 `file(line,col): error TSxxxx` 形态。有些编译失败**没有文件
 * 位置**（例如 `include` 漂移导致 `TS18003: No inputs were found…`），解析结果是 `[]` ——
 * 只看诊断数组的话，正证会**假绿**成「零诊断」。所以正证还必须显式要求退出码 0，反证要求
 * 非零：这样才能证明正证**真的完成了编译**，而不是「失败信息没被正则认出来」。
 */
export interface VolarDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
}

export interface VolarRun {
  readonly exitCode: number;
  readonly output: string;
  readonly diagnostics: readonly VolarDiagnostic[];
}

export interface VolarReport {
  readonly positive: VolarRun;
  readonly negative: VolarRun;
}

/** TS2322 反证用的 prop 值 sentinel（见 `negative.vue`）。 */
export const WRONG_PROP_VALUE_SENTINEL = "definitely-not-a-real-mode";
/** TS2339 反证用的 slot 成员 sentinel（见 `negative.vue`）。 */
export const UNKNOWN_SLOT_MEMBER_SENTINEL = "totallyNotARealMember";

/** `path(line,col): error TSxxxx: message` —— `tsc` / `vue-tsc` 的诊断行格式。 */
const DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;

export function parseVolarDiagnostics(raw: string): VolarDiagnostic[] {
  const diagnostics: VolarDiagnostic[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = DIAGNOSTIC_LINE.exec(line.trim());
    if (match === null) continue;
    diagnostics.push({
      file: match[1]!,
      line: Number(match[2]),
      column: Number(match[3]),
      code: Number(match[4]),
      message: match[5]!,
    });
  }
  return diagnostics;
}

/** 诊断的 `file` 是否指向预期的那份探针（防止把别处的错误当成结论）。 */
function isProbe(diagnostic: VolarDiagnostic, probe: string): boolean {
  return diagnostic.file.replace(/\\/g, "/").endsWith(probe);
}

function excerpt(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

export function assertVolarReport(report: VolarReport): void {
  // ① 正证必须**编译成功**。只看 `diagnostics` 会被无文件位置的失败（如 TS18003）骗过：
  //    那种输出解析成 `[]`，看起来跟「零诊断」一模一样。
  if (report.positive.exitCode !== 0) {
    throw new Error(
      `[consumer-volar] 正证没有编译成功（退出码 ${report.positive.exitCode}）—— ` +
        `不能用「解析不出带位置的诊断」冒充「零诊断」。输出：\n${excerpt(report.positive.output)}`,
    );
  }
  if (report.positive.diagnostics.length > 0) {
    const lines = report.positive.diagnostics.map(
      (d) => `${d.file}:${d.line} TS${d.code}: ${d.message}`,
    );
    throw new Error(
      `[consumer-volar] 正证（positive.vue）本应零诊断，实际有 ${report.positive.diagnostics.length} 条：\n  - ${lines.join("\n  - ")}\n` +
        `  合法 props / slots 必须可推导；这里报错说明安装文档承诺的 Volar 用法在真实 tarball 上不成立。`,
    );
  }

  // ② 反证必须因为预期诊断而编译失败。退出码 0 说明一个预期错误都没产生。
  if (report.negative.exitCode === 0) {
    throw new Error(
      `[consumer-volar] 反证编译竟然成功（退出码 0）—— 预期诊断一条都没出现，` +
        `说明 <Map> 没有被 GlobalComponents 解析成真实组件类型。`,
    );
  }

  // ③ 已有 prop 值类型写错：不仅要有 TS2322，消息里还必须带那个 prop 值的 sentinel。
  //    只按 code + 文件判，文件里别的表达式产生的 TS2322 就能冒充这条反证。
  const wrongPropValue = report.negative.diagnostics.find(
    (diagnostic) =>
      diagnostic.code === 2322 &&
      isProbe(diagnostic, "negative.vue") &&
      diagnostic.message.includes(WRONG_PROP_VALUE_SENTINEL),
  );
  if (wrongPropValue === undefined) {
    throw new Error(
      `[consumer-volar] 没有拿到锚定到 \`${WRONG_PROP_VALUE_SENTINEL}\` 的 TS2322 —— ` +
        `说明已有 prop 的值类型没有被真实校验（或它的类型退化成 any）。\n` +
        `  实际诊断：${JSON.stringify(report.negative.diagnostics)}`,
    );
  }

  // ④ 不存在的 slot 成员：TS2339 的消息必须点名那个成员。
  const unknownSlotMember = report.negative.diagnostics.find(
    (diagnostic) =>
      diagnostic.code === 2339 &&
      isProbe(diagnostic, "negative.vue") &&
      diagnostic.message.includes(UNKNOWN_SLOT_MEMBER_SENTINEL),
  );
  if (unknownSlotMember === undefined) {
    throw new Error(
      `[consumer-volar] 没有拿到锚定到 \`${UNKNOWN_SLOT_MEMBER_SENTINEL}\` 的 TS2339 —— ` +
        `说明插槽载荷没有具名成员 / 退化成 any（写成 any 时任何成员访问都「合法」）。\n` +
        `  实际诊断：${JSON.stringify(report.negative.diagnostics)}`,
    );
  }
}
