/**
 * 组件总览门禁的正反成对用例。
 *
 * 判据②（每个 manifest 组件都要在总览页的表里）第一版**过宽**：把正文散文里的
 * 反引号名也算「已列出」，于是页面末尾那个 tip 块提到 `GroundPoint` 就能顶替
 * 组件表里那一行——删掉表行门禁照样绿。变异测试把它抓出来后才收窄成行首锚定。
 * 这里的用例就是防它再被放宽。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "scripts/check-component-catalog.mts");
const OVERVIEW = join(ROOT, "docs/zh-CN/components/index.md");

function runGate(): { status: number; out: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out: stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("组件总览门禁", () => {
  let backup = "";

  afterEach(() => {
    if (backup) writeFileSync(OVERVIEW, backup);
    backup = "";
  });

  function edit(transform: (s: string) => string): void {
    if (!backup) backup = readFileSync(OVERVIEW, "utf8");
    writeFileSync(OVERVIEW, transform(readFileSync(OVERVIEW, "utf8")));
  }

  it("总览页与 manifest 一致", () => {
    const r = runGate();
    expect(r.status, r.out).toBe(0);
  });

  it("声明的组件数与 manifest 不符 —— 必须红（判据①）", () => {
    edit((s) => s.replace(/(\d+)\s*个组件/, "999 个组件"));
    const r = runGate();
    expect(r.status, "把数字改成 999 必须失败").toBe(1);
    expect(r.out).toMatch(/个组件/);
  });

  it("组件表里删掉一行 —— 必须红（判据②）", () => {
    edit((s) => s.split("\n").filter((l) => !/^\|\s*\[GroundPoint\]/.test(l)).join("\n"));
    const r = runGate();
    expect(r.status, "删掉 GroundPoint 的表行必须失败").toBe(1);
    expect(r.out).toContain("GroundPoint");
  });

  it("只在正文提一句不算「已列出」（判据②不能被散文顶替）", () => {
    // 页面末尾的 tip 块本来就会提到 GroundPoint。如果判据放宽到认散文，
    // 删掉表行也能过——所以这里反过来验：表行 + 散文都在时必须绿，
    // 只留散文时必须红。
    edit((s) => {
      const withoutRow = s.split("\n").filter((l) => !/^\|\s*\[GroundPoint\]/.test(l)).join("\n");
      expect(withoutRow, "前提：正文里仍然提到 GroundPoint").toContain("GroundPoint");
      return withoutRow;
    });
    const r = runGate();
    expect(r.status, "只有散文提到、表里没有，必须判为未列出").toBe(1);
  });

  it("数字与表行都在时判绿（防「总是红」式的假失败）", () => {
    const r = runGate();
    expect(r.status, r.out).toBe(0);
  });

  it("用途列里点名的附属组件，删掉文案就必须红（不能有硬编码逃生口）", () => {
    // `ContextMenu` 那一行把 `MenuItem` / `MenuSeparator` 写在用途列的散文里，
    // 没有各自的表格行。判据解析该行里**实际出现**的反引号名——所以把文案删掉，
    // 这两个组件就真的「没在总览页出现了」，必须判红。
    //
    // 早先这里是「行里有 [ContextMenu] 就无条件塞两个名字」，删掉文案照样绿：
    // 判据与文档实际写了什么脱钩了。
    edit((s) =>
      s.replace(
        /^\|\s*\[ContextMenu\].*$/m,
        "| [ContextMenu](/zh-CN/components/control/context-menu) | 上下文菜单 |",
      ),
    );
    const r = runGate();
    expect(r.status, "删掉用途列里的 MenuItem / MenuSeparator 文案必须判红").toBe(1);
    expect(r.out).toContain("MenuItem");
    expect(r.out).toContain("MenuSeparator");
  });

  it("原文中 ContextMenu 那行确实带这两个名字（前提）", () => {
    const r = runGate();
    expect(r.status, r.out).toBe(0);
    const line = readFileSync(OVERVIEW, "utf8")
      .split("\n")
      .find((l) => l.includes("[ContextMenu]"));
    expect(line, "前提：ContextMenu 行仍在").toBeDefined();
    expect(line).toContain("MenuItem");
    expect(line).toContain("MenuSeparator");
  });
});
