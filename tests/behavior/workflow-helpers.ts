/**
 * workflow 相关断言的共享工具（`tests/behavior/*.test.ts` 用）
 *
 * 「CI 里真的跑了这条门禁吗」这类断言必须落在**真正的 `run:` 所在 step 区块**上，
 * 而不是「文件里出现过这个字符串」——否则被 `continue-on-error` / `if:` 架空的 step
 * 与真的生效的 step 长得一样。切块逻辑只写一份，避免两个门禁用例各自漂移。
 *
 * 放在 `tests/behavior/` 下但**不是** `*.test.ts`：它只是工具，不该被当作用例收集。
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const WORKFLOW_DIR = resolve(import.meta.dirname, "../../.github/workflows");

/** 仓库里全部 workflow 文件名（含扩展名）。名字带动词，避免与「数组常量」的旧写法撞名。 */
export function listWorkflowNames(): string[] {
  return readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name));
}

export function readWorkflow(name: string): string {
  return readFileSync(resolve(WORKFLOW_DIR, name), "utf8");
}

/**
 * 取出包含某个字符串的 step 区块（从该 step 的 `- ` 行起到下一个**同级** step 前）。
 *
 * 找不到时返回 `[]`——调用方必须先断言长度 > 0，否则「切空」会让后续断言恒真。
 */
export function stepBlockContaining(text: string, needle: string): string[] {
  const lines = text.split(/\r?\n/);
  const hit = lines.findIndex((line) => line.includes(needle));
  if (hit === -1) return [];
  // 命中行常常是 step 内的续行（`run: |` 之后的内容），因此要**向上**找最近的列表项行。
  let start = -1;
  for (let i = hit; i >= 0; i -= 1) {
    if (/^\s*-\s/.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return [];
  const itemIndent = /^(\s*)-\s/.exec(lines[start]!)![1]!.length;
  const block: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start) {
      const match = /^(\s*)-\s/.exec(lines[i]!);
      if (match && match[1]!.length === itemIndent) break;
    }
    block.push(lines[i]!);
  }
  return block;
}
