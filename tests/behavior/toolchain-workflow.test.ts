/**
 * #187 工具链门禁的 CI 接线（issue #187）
 *
 * 与 `package-shape-workflow.test.ts` 同一理由：「脚本写对了」不等于「CI 真的跑它」。
 * 断言落在**真正的 `run:` 所在 step 区块**上（`workflow-helpers.ts#stepBlockContaining`），
 * 而不是「文件里出现过这个字符串」——被 `continue-on-error` / `if:` 架空的 step 与
 * 真正生效的 step 长得一样。
 *
 * needle 用 `pnpm check:toolchain`（**run 行**）而不是 `check:toolchain`：后者会先命中
 * 上方注释里的命令名，于是切出上一步 `Install dependencies`，「未被架空」的断言就成了假绿
 * —— 真的给门禁加 `continue-on-error: true` 仍然全绿。这个坑在 #45 评审里被实测抓到过。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const quality = readWorkflow("quality.yml");

/** 一个 step 区块内是否被 `continue-on-error` / step 级 `if:` 架空。 */
function isNeutralized(block: readonly string[]): string | null {
  const text = block.join("\n");
  if (/continue-on-error:\s*true/.test(text)) return "continue-on-error: true";
  if (/^\s+if:/m.test(text)) return "step 级 if:";
  return null;
}

describe("#187 CI 接线：工具链门禁", () => {
  it("跑 check:toolchain，且未被架空", () => {
    const block = stepBlockContaining(quality, "pnpm check:toolchain");
    expect(block.length).toBeGreaterThan(0);
    expect(block.join("\n"), "切到的必须是门禁自己那一步").toContain("Check toolchain");
    expect(isNeutralized(block)).toBeNull();
  });

  it("排在 Install dependencies 之后：它判的正是安装结果", () => {
    // 顺序反了的话，门禁读到的是上一轮遗留的 node_modules，报的是过期事实。
    const installAt = quality.indexOf("pnpm install --frozen-lockfile");
    const gateAt = quality.indexOf("pnpm check:toolchain");
    expect(installAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt, "工具链门禁必须在安装之后").toBeGreaterThan(installAt);
  });

  it("失效配置没有回来：根 package.json 的 pnpm 字段整体删除", () => {
    // 本票的起因。这三项原写在 `package.json#pnpm` 里，而 pnpm 12 **不再读取该字段**——
    // 加回来等于加一句**不会生效**的声称，且干净安装会重新打出那行
    // `[WARN] The "pnpm" field in package.json is no longer read by pnpm`。
    //
    // 判据读**真实的 package.json**，不是 workflow：上一版写成断言 workflow 里没有出现
    // "pnpm.overrides" 字样，结果命中的是别处一段无关注释（fail 的却是正确的东西）。
    // 「哪个文件被断言」必须与「要保护的事实」同一个文件，否则判据可以在缺陷存在时仍然绿。
    const rootManifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(rootManifest.pnpm, "package.json#pnpm 不再被 pnpm 读取，必须整体删除").toBeUndefined();
  });

  it("pnpm-workspace.yaml 仍在位（它是 pnpm 12 唯一读取设置的位置）", () => {
    // 第一版这条断言「文件里含 packages:」，与标题声称的事实（设置放在哪里）无关——
    // 标题说 A、断言查 B，判据就测不到它想测的东西。这里至少断言**文件存在且是合法
    // 的 pnpm workspace 清单**；「设置归属」由上面那条 package.json#pnpm 判失败守住。
    const workspacePath = resolve(import.meta.dirname, "../../pnpm-workspace.yaml");
    expect(existsSync(workspacePath), "pnpm-workspace.yaml 必须存在：这是 pnpm 12 读取设置的位置").toBe(true);
    const workspace = readFileSync(workspacePath, "utf8");
    expect(workspace).toContain("packages:");
    // 它是本仓唯一该放 pnpm 设置的文件，因此**不应**再出现已失效的安装设置。
    expect(workspace).not.toMatch(/onlyBuiltDependencies|auto-install-peers|shamefully-hoist/);
  });
});