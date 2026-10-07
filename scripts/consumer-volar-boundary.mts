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
 * **反证必须产生精确诊断**：
 *
 * - `:zoom="'12'"` ⇒ `TS2322`（已知 prop、类型 `number`）—— 刻意不用「未知 HTML attribute」
 *   当反例，那种写法可能合法落进 `attrs` 而不报错；
 * - `#default="{ totallyNotARealMember }"` ⇒ `TS2339`（slot 载荷无字符串索引签名）。
 *
 * 实测：把 `types` 里的 `…/volar` 去掉，`negative.vue` 零诊断 —— 也就是说这两条诊断的
 * 存在本身就证明了 `GlobalComponents` 生效。
 */
export interface VolarDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
}

export interface VolarReport {
  readonly positive: readonly VolarDiagnostic[];
  readonly negative: readonly VolarDiagnostic[];
}

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

export function assertVolarReport(report: VolarReport): void {
  if (report.positive.length > 0) {
    const lines = report.positive.map((d) => `${d.file}:${d.line} TS${d.code}: ${d.message}`);
    throw new Error(
      `[consumer-volar] 正证（positive.vue）本应零诊断，实际有 ${report.positive.length} 条：\n  - ${lines.join("\n  - ")}\n` +
        `  合法 props / slots 必须可推导；这里报错说明安装文档承诺的 Volar 用法在真实 tarball 上不成立。`,
    );
  }

  const wrongPropValue = report.negative.find(
    (diagnostic) => diagnostic.code === 2322 && isProbe(diagnostic, "negative.vue"),
  );
  if (wrongPropValue === undefined) {
    throw new Error(
      `[consumer-volar] 反证没有拿到「已有 prop 值类型写错」的诊断（TS2322）—— ` +
        `说明 <Map> 没有被 GlobalComponents 解析成真实组件类型（或它的 props 退化成 any）。\n` +
        `  实际诊断：${JSON.stringify(report.negative)}`,
    );
  }

  const unknownSlotMember = report.negative.find(
    (diagnostic) => diagnostic.code === 2339 && isProbe(diagnostic, "negative.vue"),
  );
  if (unknownSlotMember === undefined) {
    throw new Error(
      `[consumer-volar] 反证没有拿到「不存在的 slot 成员」的诊断（TS2339）—— ` +
        `说明插槽载荷没有具名成员 / 退化成 any（写成 any 时任何成员访问都「合法」）。\n` +
        `  实际诊断：${JSON.stringify(report.negative)}`,
    );
  }
  if (!unknownSlotMember.message.includes("totallyNotARealMember")) {
    throw new Error(
      `[consumer-volar] TS2339 不是关于那个不存在的插槽成员：${unknownSlotMember.message}\n` +
        `  这条断言要钉的正是「插槽载荷的具名成员集合是真实类型」。`,
    );
  }
}
