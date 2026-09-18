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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 * 所有**必须成功返回**的前置 attempt。
 *
 * 第六轮行内发现 1 的要求：生命周期结论是从「后续 snapshot」推出来的，而 snapshot 只说明那一刻的
 * 状态——产生它的那一步如果**自己抛错**，那个状态就不再代表「正常完成该步骤之后的 SDK 行为」。
 * 所以每个实验都声明自己的前置，任一缺失 / 抛错 ⇒ 该结论落第三态。这里给的是**全部成功**的版本，
 * 下面另有用例把其中一条改成抛错。
 */
const OK_ATTEMPTS: Reading[] = [
  // 前提 P：第二次摘除测的必须是「已摘下」的实例 ⇒ 第一次摘除必须成功
  { id: "geojson.removeLayer#1", threw: false },
  { id: "dom.removeLayer#1", threw: false },
  { id: "tile.removeLayer#1", threw: false },
  // 内核顺序组（DOM + GeoJSON）
  { id: "kernel.mount.addLayer", threw: false },
  { id: "kernel.mount.setData", threw: false },
  { id: "kernel.hide.removeLayer", threw: false },
  { id: "kernel.show.addLayer", threw: false },
  { id: "geojson.kernel.mount.addLayer", threw: false },
  { id: "geojson.kernel.mount.setData", threw: false },
  { id: "geojson.kernel.hide.removeLayer", threw: false },
  { id: "geojson.kernel.show.addLayer", threw: false },
  // 两个「换新实例」对照
  { id: "kernel.rebuild.addLayer", threw: false },
  { id: "kernel.rebuild.setData", threw: false },
  { id: "geojson.kernel.rebuild.setData", threw: false },
  { id: "geojson.kernel.rebuild.addLayer", threw: false },
];

/**
 * 一份**读数齐备**的报告：每次新加一条结论都要同步补这里的读数，否则下面的正证用例会红
 * ——这正是我们想要的「新结论必须被正证覆盖」。
 */
const COMPLETE: Reading[] = [
  ...OK_ATTEMPTS,
  { id: "geojson.removeLayer#2.已摘下", threw: false },
  { id: "dom.removeLayer#2.已摘下", threw: false },
  { id: "tile.removeLayer#2.已摘下", threw: false },
  { id: "kernel.mounted", connected: 2, overlayCount: 2 },
  { id: "kernel.hidden", connected: 0, overlayCount: 0 },
  { id: "kernel.shown", connected: 0, overlayCount: 0 },
  // 与 live 实测一致：补 `setData` 抛错、节点仍是 0（这就是「必须换新实例」那条结论的来源）。
  { id: "kernel.repaired", connected: 0, overlayCount: 0 },
  { id: "kernel.repair.setData", threw: true, message: "reading 'coordinate'" },
  // ⚠️ 下面这一组**必须与最近一次 live 报告逐字一致**（第八轮评审发现 2：我此前写成
  // `2 → 0 → 0 → 0`，于是「正证」一直在保护一条 live 从不发生的分支）。
  // 抄录自 2026-09-18 的 live 报告（`probe-layer-detached.mts` 的原始读数行）：
  //   geojson.kernel.mounted  {"overlayCount":2}
  //   geojson.kernel.hidden   {"overlayCount":2}   ← removeLayer **不影响**集合条数
  //   geojson.kernel.shown    {"overlayCount":2}
  //   geojson.kernel.repaired {"overlayCount":2}
  // 改这里之前先重跑一次探针、把上面四行抄成最新的（ADR 决策 12b 的读数表是同一份事实）。
  { id: "geojson.kernel.mounted", overlayCount: 2 },
  { id: "geojson.kernel.hidden", overlayCount: 2 },
  { id: "geojson.kernel.shown", overlayCount: 2 },
  { id: "geojson.kernel.repaired", overlayCount: 2 },
  { id: "geojson.kernel.rebuilt", overlayCount: 2 },
  { id: "kernel.rebuilt", connected: 2, overlayCount: 2 },
  // #98 的核心读数 2：detached 之后仍有几个节点 / 清空调用有没有抛 / 清完之后剩几个
  // （这里取实测那一组：`removeLayer` 自己就摘干净了 ⇒ 清空是安全 no-op）。
  { id: "dom.detached", connected: 0, overlayCount: 0 },
  { id: "dom.removeAllOverlays.已detached", threw: false, message: null },
  { id: "dom.afterRemoveAllOverlays", connected: 0, overlayCount: 0 },
  { id: "geojson.detached", overlayCount: 2 },
  { id: "geojson.clearData.已detached", threw: false, message: null },
  // 与 live 实测一致：detached 之后调 `clearData()` 把集合清成 0（那条读数正是 #98 的结论来源）。
  { id: "geojson.afterClearData", overlayCount: 0 },
];

describe("[#98] 探针判定层的三态（安全 / 不安全 / 无法判定）", () => {
  it("空报告 ⇒ 八条结论**全部**是「无法判定」（主守卫：新增结论也必须带第三态）", () => {
    const lines = verdicts(report([]));
    // ⚠️ 条数要跟着 `verdicts()` 的结论数走：**新增一条结论却忘了给它第三态**时，这条会先红。
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(8);
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

  it("读数齐备 ⇒ 八条结论都是**确定**结论（正证：否则「永远输出无法判定」也能过上面那条）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    expect(lineOf(lines, "[前提 P]")).toContain("安全（前提 P 成立）");
    expect(lineOf(lines, "[DOM 生命周期")).toContain("内容没回来");
    expect(lineOf(lines, "[再显示后补 setData]")).toContain("抛错");
    expect(lineOf(lines, "[再显示后补 setData]"), "live 那一组：抛错且没恢复").toContain("找不回来");
    expect(lineOf(lines, "[GeoJSON 生命周期"), "live 那一组：集合一直在").toContain("集合还在");
    expect(lineOf(lines, "[对照：换新实例重建]")).toContain("重建路径正常");
    expect(lineOf(lines, "[DOM detached 清空]"), "实测那一组 ⇒ 无需清空").toContain("无需清空");
    expect(
      lineOf(lines, "[对照：GeoJSON 换新实例重建"),
      "同一份 data 在新实例上有数据 ⇒ 差异来自实例本身（只到「集合层面」）",
    ).toContain("可写入");
    expect(lineOf(lines, "[GeoJSON detached clearData]")).toContain("完整清空");
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
            // 前置：`dom.removeLayer#1` 必须成功，否则 `dom.detached` 根本不是 detached 状态。
            { id: "dom.removeLayer#1", threw: false },
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

  it("[再显示后补 setData] 的 2×2：调用抛错要**堵死「修法可行」**，但不得吞掉「找不回来」", () => {
    // 第七轮评审发现 1：这一条原先只读 `repairThrew` 做展示，结论仍只看节点数——于是
    // 「抛错但节点数变多了」会被写成「能把内容找回来（修法可行）」，与刚给 GeoJSON clearData
    // 建立的口径（抛错是一等事实）自相矛盾。反过来也不能一刀切成「不可依赖」：
    // 「抛错 + 节点仍为 0」比「没抛错 + 节点仍为 0」更强地支持「必须换新实例」。
    const lineFor = (threw: boolean | null, repaired: number | null) =>
      lineOf(
        verdicts(
          report([
            ...COMPLETE.filter((r) => !r.id.startsWith("kernel.repair")),
            ...(threw === null
              ? []
              : [{ id: "kernel.repair.setData", threw, message: "reading 'coordinate'" }]),
            ...(repaired === null
              ? []
              : [{ id: "kernel.repaired", connected: repaired, overlayCount: repaired }]),
          ]),
        ),
        "[再显示后补 setData]",
      );

    expect(lineFor(false, 2), "没抛错 + 内容回来了").toContain("**能把内容找回来**");
    expect(lineFor(false, 0), "没抛错 + 内容没回来").toContain("**找不回来**");

    const unreliable = lineFor(true, 2);
    expect(unreliable, "抛错 + 节点数变多 ⇒ 只能报不可依赖").toContain("**不可依赖**");
    expect(
      unreliable,
      "绝不能因为副作用看起来成功就说「修法可行」",
    ).not.toContain("**能把内容找回来**");

    const bothBad = lineFor(true, 0);
    expect(bothBad, "抛错 + 没恢复 ⇒ 两条事实都要说出来").toContain("**找不回来，且这次调用本身抛错**");
    expect(lineFor(null, 2), "调用读数缺失").toContain("无法判定");
  });

  it("DOM 生命周期的**中间正证**：`removeLayer` 没抛错但节点没摘掉 ⇒ 第三态", () => {
    // 第八轮评审发现 1：前置只证明 `hide.removeLayer` **没抛错**，不证明它的**副作用发生了**。
    // `hidden > 0` 时内容从未消失，`shown > 0` 与「重挂能不能把内容带回来」无关。
    const readings = COMPLETE.map((r) => (r.id === "kernel.hidden" ? { ...r, connected: 2 } : r));
    const line = lineOf(verdicts(report(readings)), "[DOM 生命周期");
    expect(line).toContain("对照不成立");
    expect(line, "隐藏没有真的发生 ⇒ 不能说是重挂把内容带回来的").not.toContain("内容自己回来了");
  });

  it("GeoJSON 生命周期：`shown === 0` 那一支单独覆盖（live 基线是「集合还在」）", () => {
    // live 基线 2 → 2 → 2 → 2 ⇒ 判「集合还在」；「集合被清空了」是另一条**互斥**分支，
    // 用合成场景单独钉住即可——不要再把 COMPLETE 改成这条分支（那正是第八轮被点的漂移）。
    const readings = COMPLETE.map((r) =>
      r.id === "geojson.kernel.shown" || r.id === "geojson.kernel.repaired"
        ? { ...r, overlayCount: 0 }
        : r,
    );
    const line = lineOf(verdicts(report(readings)), "[GeoJSON 生命周期");
    expect(line).toContain("**集合被清空了**");
  });

  it("GeoJSON 生命周期的正证控件：`mounted === 0` ⇒ 对照不成立，不得判「集合被清空了」", () => {
    // 第七轮评审发现 2：与 DOM 那条的 `mounted <= 0` 保持同一口径——data 从一开始就没进集合时，
    // 「再显示后为 0」什么都证明不了。
    const readings = COMPLETE.map((r) =>
      r.id === "geojson.kernel.mounted" ? { ...r, overlayCount: 0 } : r,
    );
    const line = lineOf(verdicts(report(readings)), "[GeoJSON 生命周期");
    expect(line).toContain("对照不成立");
    expect(line, "从一开始就没有数据 ⇒ 证明不了任何清理").not.toContain("集合被清空了");
  });

  it("前置 attempt 抛错 ⇒ 该结论第三态，**不得**把实验步骤失败读成 SDK 语义", () => {
    // 第六轮行内发现 1 的核心形状：`kernel.show.addLayer` 自己抛错时 `kernel.shown.connected === 0`，
    // 若不管前置就会落成「重挂之后内容不会回来」——那是**实验步骤失败**，不是 SDK 语义。
    const withPrereqBroken = (id: string, threw = true) =>
      report(COMPLETE.map((r) => (r.id === id ? { ...r, threw } : r)));

    const domLine = lineOf(
      verdicts(withPrereqBroken("kernel.show.addLayer")),
      "[DOM 生命周期",
    );
    expect(domLine).toContain("无法判定");
    expect(domLine, "文案必须点名是哪一步不成立").toContain("kernel.show.addLayer");
    expect(domLine, "不得读成「内容没回来」").not.toContain("内容没回来");

    const clearLine = lineOf(
      verdicts(withPrereqBroken("dom.removeLayer#1")),
      "[DOM detached 清空]",
    );
    expect(clearLine).toContain("无法判定");
    expect(clearLine).toContain("dom.removeLayer#1");
    expect(clearLine, "不得读成安全侧的「无需清空」").not.toContain("**无需清空**");

    const geoLine = lineOf(
      verdicts(withPrereqBroken("geojson.removeLayer#1")),
      "[GeoJSON detached clearData]",
    );
    expect(geoLine).toContain("无法判定");
    expect(geoLine).toContain("geojson.removeLayer#1");

    // 前置**读数缺失**同样算不成立（不是「没测到就跳过」）。
    const missingPrereq = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "kernel.hide.removeLayer"))),
      "[DOM 生命周期",
    );
    expect(missingPrereq).toContain("无法判定");
    expect(missingPrereq).toContain("kernel.hide.removeLayer");
  });

  it("GeoJSON detached clear 的状态机：完整清空 / 部分 / 未清空 / 无需清空 / 不安全 / 第三态", () => {
    // 第六轮行内发现 2：①必须消费 `geojson.clearData.已detached` 这个 attempt；
    // ②`after !== before` 太弱——2 → 1 这种**部分清理**也会被说成「被清空了」。
    const lineFor = (before: number | null, after: number | null, threw: boolean | null, detachThrew = false) =>
      lineOf(
        verdicts(
          report([
            { id: "geojson.removeLayer#1", threw: detachThrew, message: null },
            ...(before === null ? [] : [{ id: "geojson.detached", overlayCount: before }]),
            ...(threw === null ? [] : [{ id: "geojson.clearData.已detached", threw, message: null }]),
            ...(after === null ? [] : [{ id: "geojson.afterClearData", overlayCount: after }]),
          ]),
        ),
        "[GeoJSON detached clearData]",
      );

    expect(lineFor(2, 0, false), "2 → 0").toContain("**完整清空**");
    expect(lineFor(2, 1, false), "2 → 1 只是部分清理，不能叫清空").toContain("**只清掉了部分**");
    expect(lineFor(2, 1, false), "更不得说成完整清空").not.toContain("**完整清空**");
    expect(lineFor(2, 2, false), "没变少").toContain("**未清空**");
    expect(lineFor(0, 0, false), "摘除自己就清干净了").toContain("**无需清空**");
    expect(
      lineFor(2, 0, true),
      "调用抛错是决定性的：即使条数看起来清空了，也必须先报不安全（可能只是抛错前的副作用）",
    ).toContain("**不安全**");
    expect(lineFor(2, 0, true), "不得落成正结论").not.toContain("**完整清空**");
    expect(lineFor(null, 0, false), "读数缺失").toContain("无法判定");
    expect(lineFor(2, null, null), "attempt 与读数都缺失").toContain("无法判定");
    expect(lineFor(2, 0, false, true), "前置摘除失败 ⇒ 第三态").toContain("无法判定");
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

/* -------------------------------------------------------------------------- */
/* 正证基线 ↔ live 报告：漂移必须在 CI 里被发现，而不是等到评审            */
/* -------------------------------------------------------------------------- */

/**
 * `COMPLETE` 是「读数齐备」的**合成**报告，用来做正证（结论都必须落定）。
 *
 * 它的字段值必须**逐条等于**最近一次成功的 live 报告——否则「正证」保护的是一条 live 从不发生的
 * 分支。这件事已经发生过两次（第七轮：GeoJSON 的 `afterClearData`；第八轮：GeoJSON 内核顺序整组），
 * 靠注释与 checklist 都拦不住，所以这里把它变成机器检查。
 *
 * fixture 的刷新方式（只在**探针退出码为 0** 时才抄）：
 *
 * ```bash
 * BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-layer-detached.mts --out=/tmp/live.json
 * # 然后把 phase / sdk / readings 抄进 tests/behavior/fixtures/probe-layer-detached.live.json
 * ```
 */
describe("[#98] 正证基线（COMPLETE）与 live 报告一致", () => {
  const fixturePath = join(
    process.cwd(),
    "tests/behavior/fixtures/probe-layer-detached.live.json",
  );
  const live = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    capturedAt: string;
    phase: string;
    readings: Reading[];
  };

  it("fixture 不是空壳（正证守卫：文件被清空 / 搬走时不得静默空转）", () => {
    expect(live.phase, `${fixturePath} 的 phase 不是 done`).toBe("done");
    expect(live.readings.length, `${fixturePath} 里的读数太少`).toBeGreaterThan(20);
  });

  it("`COMPLETE` 的每条读数都与 live 报告逐字段一致", () => {
    const byId = new Map(live.readings.map((reading) => [reading.id, reading]));
    const fields = ["threw", "connected", "overlayCount", "created"] as const;
    const drifted = COMPLETE.flatMap((expected) => {
      const actual = byId.get(expected.id);
      if (actual === undefined) return [`${expected.id}：live 报告里没有这条读数`];
      // ⚠️ **只比 COMPLETE 声明过的字段**：判定层对每条读数只读它需要的字段（快照读 `connected`、
      // 集合读 `overlayCount`、attempt 读 `threw`），所以 COMPLETE 不必把 live 的每个字段都写全。
      // 一开始按「全字段比对」写，立刻报出 `kernel.mounted.threw：COMPLETE=undefined live=false`
      // 这类噪音——那不是漂移，是「没声明」。多报一次就会让人开始忽略这条用例。
      return fields
        .filter((field) => expected[field] !== undefined && expected[field] !== actual[field])
        .map(
          (field) =>
            `${expected.id}.${field}：COMPLETE=${String(expected[field])} live=${String(actual[field])}`,
        );
    });
    expect(
      drifted,
      `COMPLETE 与 live 报告（${live.capturedAt}）漂移了：要么改回 live 的值，要么在重跑探针` +
        `（退出码 0）之后刷新 fixture——正证保护的必须是真实基线`,
    ).toEqual([]);
  });
});
