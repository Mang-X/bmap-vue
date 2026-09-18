/**
 * `scripts/probe-layer-detached-verdicts.mts` 的三态回归守卫（issue #98 的验收标准）
 *
 * 背景：#98 要求每个读数**安全 / 不安全 / 无法判定三态互斥**，而这条口径在一个探针脚本里
 * **只在某一天真的跑真实浏览器时才暴露**——同一类缺陷已经被评审连抓两次（第一次是前提 P 那组，
 * 第二次是第三组）。所以判定层被拆成纯模块，这里用**合成报告**直接驱动它：
 *
 * - **空报告**（一条读数都没有）⇒ 六条结论**全部**必须是第三态。这条是主守卫：它不枚举具体
 *   分支，只要有人新加一条结论、或把某处的 presence 检查退回 `?.` + `??` 兜底，就会变红。
 * - **逐条点名**缺失 ⇒ 对应那条结论落成第三态（防止「整段早退」把某条结论漏掉）。
 * - **读数齐备**（正证控件）⇒ 六条结论都必须是**确定**结论。没有这条，「永远输出无法判定」
 *   也能让上面两条通过。
 */
import { describe, expect, it } from "vitest";
import { controlFailures, verdicts, type Reading } from "../../scripts/probe-layer-detached-verdicts.mts";

/** 只关心 readings，其余字段给最小合法值。 */
function report(readings: Reading[]) {
  return { phase: "done", sdk: null, readings, console: [], error: null };
}

/** 把「结论行」按开头的 `[标题]` 取出来，便于逐条断言。 */
function lineOf(lines: string[], prefix: string): string {
  const found = lines.filter((line) => line.startsWith(prefix));
  expect(found.length, `结论里没有以 ${prefix} 开头的那一行`).toBe(1);
  return found[0]!;
}

/**
 * 取一行里 `⇒` **之后**的结论（即真正的判定，不含前面的读数原文）。
 *
 * ⚠️ 别用「整行是否包含『无法判定』」代替它：读数原文那一段（`domSnap`）在缺读数时**本来就**
 * 会印「**无法判定**（读数缺失）」，于是 `... **无法判定**（读数缺失） ⇒ **重建也没渲染**`
 * 这种「原文是第三态、结论是确定值」的行会被整行检查漏掉——反证时正是这么漏的。
 */
function conclusionOf(line: string): string {
  return line.slice(line.lastIndexOf("⇒") + 1).trim();
}

/**
 * 一份**读数齐备**的报告：每次新加一条结论都要同步补这里的读数，否则下面的正证用例会红
 * ——这正是我们想要的「新结论必须被正证覆盖」。
 */
const COMPLETE: Reading[] = [
  { id: "geojson.removeLayer#2.已摘下", threw: false },
  { id: "dom.removeLayer#2.已摘下", threw: false },
  { id: "tile.removeLayer#2.已摘下", threw: false },
  { id: "kernel.mounted", connected: 2, overlayCount: 2 },
  { id: "kernel.hidden", connected: 0, overlayCount: 0 },
  { id: "kernel.shown", connected: 0, overlayCount: 0 },
  { id: "kernel.repaired", connected: 2, overlayCount: 2 },
  { id: "kernel.repair.setData", threw: true, message: "reading 'coordinate'" },
  { id: "geojson.kernel.mounted", overlayCount: 2 },
  { id: "geojson.kernel.hidden", overlayCount: 0 },
  { id: "geojson.kernel.shown", overlayCount: 0 },
  { id: "geojson.kernel.repaired", overlayCount: 0 },
  { id: "kernel.rebuilt", connected: 2, overlayCount: 2 },
  { id: "geojson.detached", overlayCount: 2 },
  { id: "geojson.afterClearData", overlayCount: 2 },
];

describe("[#98] 探针判定层的三态（安全 / 不安全 / 无法判定）", () => {
  it("空报告 ⇒ 六条结论**全部**是「无法判定」（主守卫：新增结论也必须带第三态）", () => {
    const lines = verdicts(report([]));
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(6);
    const determinate = lines
      .map((line) => ({ line, conclusion: conclusionOf(line) }))
      .filter((item) => !item.conclusion.includes("无法判定"))
      .map((item) => item.line);
    expect(
      determinate,
      "读数一条都没有，却被判成了确定结论 —— 缺读数必须落第三态，不得进正/负任一分支",
    ).toEqual([]);
  });

  it("缺 `kernel.shown` ⇒ DOM 生命周期那条是第三态（不是「内容没回来」）", () => {
    const readings = COMPLETE.filter((r) => r.id !== "kernel.shown");
    const line = lineOf(verdicts(report(readings)), "[DOM 生命周期");
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成负结论").not.toContain("内容没回来");
  });

  it("缺 `kernel.repair.setData` ⇒「调用本身」是第三态（不是「未抛错」）", () => {
    const readings = COMPLETE.filter((r) => r.id !== "kernel.repair.setData");
    const line = lineOf(verdicts(report(readings)), "[再显示后补 setData]");
    expect(line).toContain("调用本身 **无法判定**");
    expect(line, "缺读数不得落成「未抛错」").not.toContain("调用本身 未抛错");
  });

  it("缺 `kernel.rebuilt` ⇒ 对照那条是第三态（不是「重建也没渲染」）", () => {
    const readings = COMPLETE.filter((r) => r.id !== "kernel.rebuilt");
    const line = lineOf(verdicts(report(readings)), "[对照：换新实例重建]");
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成「重建也没渲染」").not.toContain("重建也没渲染");
  });

  it("缺 GeoJSON 那一组 ⇒ 该条是第三态（不是「集合被清空了」）", () => {
    const readings = COMPLETE.filter((r) => !r.id.startsWith("geojson.kernel."));
    const line = lineOf(verdicts(report(readings)), "[GeoJSON 生命周期");
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成「集合被清空了」").not.toContain("集合被清空了");
  });

  it("读数齐备 ⇒ 六条结论都是**确定**结论（正证：否则「永远输出无法判定」也能过上面那条）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    expect(lineOf(lines, "[前提 P]")).toContain("安全（前提 P 成立）");
    expect(lineOf(lines, "[DOM 生命周期")).toContain("内容没回来");
    expect(lineOf(lines, "[再显示后补 setData]")).toContain("抛错");
    expect(lineOf(lines, "[再显示后补 setData]")).toContain("能把内容找回来");
    expect(lineOf(lines, "[GeoJSON 生命周期")).toContain("集合被清空了");
    expect(lineOf(lines, "[对照：换新实例重建]")).toContain("重建路径正常");
    expect(lineOf(lines, "[GeoJSON detached clearData]")).toContain("未清空");
  });

  it("对照不成立（挂载后就没有节点）⇒ 第三态，而不是「内容没回来」", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "kernel.mounted" ? { ...r, connected: 0 } : r,
    );
    const line = lineOf(verdicts(report(readings)), "[DOM 生命周期");
    expect(line).toContain("对照不成立");
    expect(line).not.toContain("内容没回来");
  });

  it("正证控件：读数缺失 / 字段类型不对都算不成立，齐备时为空", () => {
    expect(controlFailures(report([])).length, "没有读数时控件必须不成立").toBeGreaterThan(0);
    expect(
      controlFailures(
        report([
          { id: "geojson.attached", overlayCount: "2" }, // 类型不对（页面回传字符串）
          { id: "dom.attached", created: 2, connected: 2 },
        ]),
      ),
      "overlayCount 不是 number ⇒ 控件不成立",
    ).toHaveLength(1);
    expect(
      controlFailures(
        report([
          { id: "geojson.attached", overlayCount: 2 },
          { id: "dom.attached", created: 2, connected: 2 },
        ]),
      ),
      "齐备时控件成立",
    ).toEqual([]);
  });
});
