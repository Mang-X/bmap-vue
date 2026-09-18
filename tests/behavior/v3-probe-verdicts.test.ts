/**
 * `scripts/probe-layer-detached-verdicts.mts` 的三态回归守卫（issue #98 的验收标准）
 *
 * 背景：#98 要求每个读数**安全 / 不安全 / 无法判定三态互斥**，而这条口径在一个探针脚本里
 * **只在某一天真的跑真实浏览器时才暴露**——同一类缺陷已经被评审连抓两次（第一次是前提 P 那组，
 * 第二次是第三组）。所以判定层被拆成纯模块，这里用**合成报告**直接驱动它：
 *
 * - **空报告**（一条读数都没有）⇒ 七条结论**全部**必须是第三态。这条是主守卫：它不枚举具体
 *   分支，只要有人新加一条结论、或把某处的 presence 检查退回 `?.` + `??` 兜底，就会变红。
 * - **逐条点名**缺失 ⇒ 对应那条结论落成第三态（防止「整段早退」把某条结论漏掉）。
 * - **读数齐备**（正证控件）⇒ 七条结论都必须是**确定**结论。没有这条，「永远输出无法判定」
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
  // #98 的核心读数 2：detached 之后仍有几个节点 / 清空调用有没有抛 / 清完之后剩几个
  // （这里取实测那一组：`removeLayer` 自己就摘干净了 ⇒ 清空是安全 no-op）。
  { id: "dom.detached", connected: 0, overlayCount: 0 },
  { id: "dom.removeAllOverlays.已detached", threw: false, message: null },
  { id: "dom.afterRemoveAllOverlays", connected: 0, overlayCount: 0 },
  { id: "geojson.detached", overlayCount: 2 },
  { id: "geojson.afterClearData", overlayCount: 2 },
];

describe("[#98] 探针判定层的三态（安全 / 不安全 / 无法判定）", () => {
  it("空报告 ⇒ 七条结论**全部**是「无法判定」（主守卫：新增结论也必须带第三态）", () => {
    const lines = verdicts(report([]));
    // ⚠️ 条数要跟着 `verdicts()` 的结论数走：**新增一条结论却忘了给它第三态**时，这条会先红。
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(7);
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

  it("读数齐备 ⇒ 七条结论都是**确定**结论（正证：否则「永远输出无法判定」也能过上面那条）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    expect(lineOf(lines, "[前提 P]")).toContain("安全（前提 P 成立）");
    expect(lineOf(lines, "[DOM 生命周期")).toContain("内容没回来");
    expect(lineOf(lines, "[再显示后补 setData]")).toContain("抛错");
    expect(lineOf(lines, "[再显示后补 setData]")).toContain("能把内容找回来");
    expect(lineOf(lines, "[GeoJSON 生命周期")).toContain("集合被清空了");
    expect(lineOf(lines, "[对照：换新实例重建]")).toContain("重建路径正常");
    expect(lineOf(lines, "[DOM detached 清空]"), "实测那一组 ⇒ 无需清空").toContain("无需清空");
    expect(lineOf(lines, "[GeoJSON detached clearData]")).toContain("未清空");
  });

  it("缺 `dom.afterRemoveAllOverlays` ⇒ DOM detached 清空那条是第三态（不是「无效」）", () => {
    const readings = COMPLETE.filter((r) => r.id !== "dom.afterRemoveAllOverlays");
    const line = lineOf(verdicts(report(readings)), "[DOM detached 清空]");
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成「无效」").not.toContain("**无效**");
    expect(line, "也不得落成「有效」").not.toContain("**有效**");
  });

  it("DOM detached 清空的四个分支互斥：无需清空 / 有效 / 无效 / 不安全", () => {
    // 这条是 #98 的核心读数 2（内核「对已摘下的 DOM 图层照常调清空」这条策略的依据）。
    // `before === 0` 必须是「**无需清空**」而不是「无效」——本探针第一版正是在这里得出了与读数
    // 相反的结论（`removeLayer` 自己就摘干净了）。四个分支各自用带 `**` 的完整标记断言，
    // 避免「无效」被「有效」这类子串关系误判。
    const lineFor = (before: number, after: number, failed = false) =>
      lineOf(
        verdicts(
          report([
            { id: "dom.detached", connected: before, overlayCount: before },
            { id: "dom.afterRemoveAllOverlays", connected: after, overlayCount: after },
            {
              id: "dom.removeAllOverlays.已detached",
              threw: failed,
              message: failed ? "boom" : null,
            },
          ]),
        ),
        "[DOM detached 清空]",
      );

    expect(lineFor(0, 0), "`removeLayer` 自己摘干净了").toContain("**无需清空**");
    expect(lineFor(2, 0), "还有节点、清完为 0").toContain("**有效**");
    expect(lineFor(2, 2), "还有节点、清完还在").toContain("**无效**");
    expect(lineFor(2, 2, true), "调用本身抛错 ⇒ 策略不安全").toContain("**不安全**");
  });

  it("对照不成立（挂载后就没有节点）⇒ 第三态，而不是「内容没回来」", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "kernel.mounted" ? { ...r, connected: 0 } : r,
    );
    const line = lineOf(verdicts(report(readings)), "[DOM 生命周期");
    expect(line).toContain("对照不成立");
    expect(line).not.toContain("内容没回来");
  });

  it("读数对象**在**、`threw` 字段**不在** ⇒ 第三态（不得读成「未抛错 / 安全」）", () => {
    // 第四轮行内发现 2：`Reading.threw` 是可选的，而页面回传的形状不完全由我们决定。
    // 只判「读数对象在不在」的话，`{ id: "x" }` 这种读数会被读成「未抛错」= **安全**——
    // 正是这条口径要禁止的方向（「没测到」不等于「测到了，是好的那一侧」）。
    const blank = (id: string) => ({ id });

    const pLine = lineOf(
      verdicts(
        report([
          blank("geojson.removeLayer#2.已摘下"),
          blank("dom.removeLayer#2.已摘下"),
          blank("tile.removeLayer#2.已摘下"),
        ]),
      ),
      "[前提 P]",
    );
    expect(pLine).toContain("无法判定");
    expect(pLine, "不得读成「安全（前提 P 成立）」").not.toContain("安全（前提 P 成立）");

    const repairLine = lineOf(
      verdicts(report([blank("kernel.repair.setData")])),
      "[再显示后补 setData]",
    );
    expect(repairLine).toContain("**无法判定**");
    expect(repairLine, "不得读成「未抛错」").not.toContain("调用本身 未抛错");

    const clearLine = lineOf(
      verdicts(
        report([
          { id: "dom.detached", connected: 0, overlayCount: 0 },
          { id: "dom.afterRemoveAllOverlays", connected: 0, overlayCount: 0 },
          blank("dom.removeAllOverlays.已detached"),
        ]),
      ),
      "[DOM detached 清空]",
    );
    expect(clearLine).toContain("无法判定");
    expect(clearLine, "不得读成安全侧的「无需清空」").not.toContain("**无需清空**");
  });

  it("`threw` 字段类型不对（页面回传字符串）同样算没测到 ⇒ 第三态", () => {
    const pLine = lineOf(
      verdicts(
        report([
          { id: "geojson.removeLayer#2.已摘下", threw: "false" as unknown as boolean },
          { id: "dom.removeLayer#2.已摘下", threw: false },
          { id: "tile.removeLayer#2.已摘下", threw: false },
        ]),
      ),
      "[前提 P]",
    );
    expect(pLine).toContain("无法判定");
    expect(pLine, "另两条没抛错也不能把它抬成「安全」").not.toContain("安全（前提 P 成立）");
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
    expect(
      controlFailures(report([{ id: "geojson.attached", overlayCount: 2 }, { id: "dom.attached" }])),
      "`created` 字段缺失同样算不成立（控件方向保守：缺失一律不成立）",
    ).toHaveLength(1);
    expect(
      controlFailures(
        report([
          { id: "geojson.attached", overlayCount: 2 },
          // 页面回传字符串：`(value ?? 0) <= 0` 会被 JS 数值强转后**通过**，所以必须显式查类型
          // （`created` / `connected` 都查）。
          { id: "dom.attached", created: "2" as unknown as number, connected: "2" as unknown as number },
        ]),
      ),
      "字符串 `\"2\"` 不得靠强转通过控件",
    ).toHaveLength(1);
  });
});
