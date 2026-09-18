/**
 * `probe-layer-detached.mts` 的**判定层**（读数 → 结论），单独成模块是为了可测。
 *
 * ## 为什么把它拆出来
 *
 * 这一层是纯函数（只吃 JSON 形状的报告、只吐结论行），却连着两次被评审抓到同一类缺陷：
 * **读数缺失时落成确定结论**。具体形状是 `?.` + `??` 兜底——
 *
 * ```ts
 *   byId.get("kernel.shown")?.connected ?? 0   // 读数缺失 ⇒ 0 ⇒「内容没回来」
 *   byId.get("kernel.repair.setData")?.threw ? 抛错 : "未抛错"  // 缺失 ⇒「未抛错」
 * ```
 *
 * 两者都会把「**没测到**」印成「**测到了，是不好的那一侧**」，正是 #98 验收标准里
 * 「每个读数安全 / 不安全 / **无法判定**互斥」要禁止的形态。留在探针脚本里时它**只在
 * 某一天真的跑真实浏览器**才会暴露，所以把判定层拆成模块、由 `v3-probe-verdicts.test.ts`
 * 用合成报告直接驱动：三态是**可回归验证**的，不再依赖「下次跑探针时记得看一眼」。
 *
 * 拆开之后 `probe-layer-detached.mts` 只负责「跑浏览器拿读数 + 打印」，
 * 这个文件只负责「拿读数下结论」，两边都不需要知道对方的机制。
 */

/** 一条读数。字段可选正是「可能没测到」的来源，所以判定层必须逐字段查 presence。 */
export interface Reading {
  id: string
  threw?: boolean
  message?: string | null
  overlayCount?: number | string
  created?: number
  connected?: number
}

/** 页面写回的报告（脱敏前的原始形状）。 */
export interface ProbeReport {
  phase: string
  sdk: Record<string, string> | null
  readings: Reading[]
  console: Array<{ level: string; text: string }>
  error: string | null
  loadError?: string
}

/** 正证控件不成立的原因清单（空数组 = 控件成立）。 */
export function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = []
  const byId = new Map(report.readings.map((r) => [r.id, r]))
  const geo = byId.get("geojson.attached")
  if (!geo || typeof geo.overlayCount !== "number" || geo.overlayCount <= 0) {
    failures.push(`geojson.attached 的 overlayCount 不是正数（得到 ${String(geo?.overlayCount)}）`)
  }
  const dom = byId.get("dom.attached")
  // 两个字段都**显式查类型**（不用 `?? 0` 兜底）：读数对象存在但字段缺失时，兜底会把
  // 「没测到」写成「没创建出元素」——那是另一回事，诊断信息会把人带偏。
  if (!dom || typeof dom.created !== "number" || dom.created <= 0) {
    failures.push(`dom.attached 没有创建出任何元素（created=${String(dom?.created)}）`)
  }
  // 「节点真的进了文档」是「残留」这个读数的前提：不成立就无法区分「没残留」与「本来就没进去」
  else if (typeof dom.connected !== "number" || dom.connected <= 0) {
    failures.push(`dom.attached 的节点一个都没连到文档上（connected=${String(dom.connected)}）`)
  }
  return failures
}

/** 三态里的第三态。缺失读数的**唯一**合法归宿，不得落进正 / 负任一分支。 */
const UNKNOWN = "**无法判定**（读数缺失）"

/**
 * 把读数映射成结论——这是本探针真正的产物。
 *
 * 口径（四条，改这个函数前先读）：
 * 1. **每个结论都先查 presence / 类型，再进正负分支**；缺失一律 `UNKNOWN`。
 *    这条对**读数对象里的字段**同样成立——`Reading` 的字段（含 `threw`）都是可选的，
 *    「读数对象在、`threw` 不在」也是「没测到」，不得当成「未抛错」（第四轮行内发现 2）。
 * 2. 「对照不成立」也是 `UNKNOWN`，不是负结论——控件不成立时后面的读数无意义。
 * 3. 结论行里可以带读数原文（`domSnap`），但**结论本身**不得由读数原文推导（同一处读两次
 *    容易只在一处加 presence 检查）。
 */
export function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]))
  const lines: string[] = []

  /**
   * 读一个「有没有抛错」的字段：读数缺失、或 `threw` 字段**缺失 / 类型不对** ⇒ `null`（第三态）。
   *
   * ⚠️ 不能只判「读数对象在不在」：`Reading.threw` 是可选的，页面回传的形状不完全由我们决定。
   * 只判对象存在，`{ id: "x" }` 这种读数会被读成「未抛错」= **安全**——正是这条口径要禁止的方向。
   */
  const threwOf = (id: string): boolean | null => {
    const value = byId.get(id)?.threw
    return typeof value === "boolean" ? value : null
  }
  /** 读数原文（含抛错信息）；缺失或字段类型不对时给第三态文案。 */
  const describeReading = (id: string): string => {
    const reading = byId.get(id)
    const threw = threwOf(id)
    if (reading === undefined || threw === null) return "无法判定（读数缺失）"
    return threw ? `抛错（${reading.message}）` : "未抛错"
  }
  // ── 前置条件 ──────────────────────────────────────────────────────────────
  /**
   * **前置调用**里哪些没有成功：返回失败说明（空数组 = 全部成功）。
   *
   * 为什么需要这一步：生命周期的结论都是从**后续 snapshot** 推出来的，而 snapshot 只说明「那一刻
   * 的状态」。如果产生它的那一步 SDK 调用**自己抛错**了，这个状态就不再代表「正常完成该步骤之后的
   * SDK 行为」——例如 `kernel.show.addLayer` 抛错时 `kernel.shown.connected === 0`，读成
   * 「重挂之后内容不会回来」就是把**实验步骤失败**误写成了 **SDK 语义**。
   *
   * 所以每个实验都把自己依赖的 attempt 列成前置条件，**要求 `threwOf(id) === false`**；
   * 任一缺失 / 抛错 ⇒ 该结论落第三态，并说明是哪一步不成立（ADR 决策 12b 的读数只在
   * 「前置全部成功」时才作为依据）。
   */
  const unmetPrerequisites = (ids: readonly string[]): string[] =>
    ids
      .map((id) => ({ id, threw: threwOf(id) }))
      .filter((item) => item.threw !== false)
      .map((item) => `${item.id} ${item.threw === null ? "读数缺失" : "抛错"}`)
  /** 前置不成立时的第三态文案（带上是哪一步）。 */
  const prereqText = (unmet: readonly string[]): string =>
    `**无法判定**（前置步骤不成立：${unmet.join("、")}）`

  // 每条读数**三态**：安全 / 不安全 / **无法判定**。缺失的读数**不得**当成 safe——
  // `!undefined === true` 会把「没测到」读成「安全」，正是本轮之前那几轮要求避免的形态。
  const pIds: Array<[string, string]> = [
    ["GeoJSON", "geojson.removeLayer#2.已摘下"],
    ["DOM", "dom.removeLayer#2.已摘下"],
    ["Tile", "tile.removeLayer#2.已摘下"],
  ]
  // 前提 P 说的是「对**已经摘掉**的图层重复摘除」⇒ 第一次摘除必须真的成功了，
  // 否则 `#2` 测的是「对一个还挂着的图层再摘一次」，与前提无关。
  const pPrereq = unmetPrerequisites([
    "geojson.removeLayer#1",
    "dom.removeLayer#1",
    "tile.removeLayer#1",
  ])
  const pThrows = pIds.map(([, id]) => threwOf(id))
  const pVerdict =
    pPrereq.length > 0
      ? prereqText(pPrereq)
      : pThrows.some((threw) => threw === null)
        ? "**无法判定**（有读数缺失）"
        : pThrows.some((threw) => threw === true)
          ? "**不安全**（三态收敛的该分支需要换机制）"
          : "安全（前提 P 成立）"
  lines.push(
    `[前提 P] 对已摘下的图层重复 removeLayer —— ` +
      pIds.map(([name, id]) => `${name} ${describeReading(id)}`).join(" / ") +
      ` ⇒ ${pVerdict}`,
  )

  // 重挂载是否按保留数据重渲染：**内核的 hide -> show 依赖它**（只重新挂载、不再 setData）。
  /** 读一个「节点数」字段：读数缺失或字段类型不对 ⇒ `null`（调用方按**第三态**处理）。 */
  const nodesOf = (id: string): number | null => {
    const value = byId.get(id)?.connected
    return typeof value === "number" ? value : null
  }
  /** 读一个「集合条数」字段（`getData()` 的长度）：缺失 / 类型不对 ⇒ `null`。 */
  const overlaysOf = (id: string): number | null => {
    const value = byId.get(id)?.overlayCount
    return typeof value === "number" ? value : null
  }
  /** 读数原文用：缺失时印 `—`，不要印 `null` / `undefined` 让人误读成 0。 */
  const numText = (value: number | null): string => (value === null ? "—" : String(value))
  const domSnap = (id: string) => {
    const reading = byId.get(id)
    const connected = nodesOf(id)
    if (reading === undefined || connected === null) return UNKNOWN
    return `${String(connected)} 个节点连在文档（overlays ${String(reading.overlayCount)}）`
  }

  /** 内核顺序那一组（DOM + GeoJSON）依赖的四步；每一个实验都用得到。 */
  const kernelPrereq = unmetPrerequisites([
    "kernel.mount.addLayer",
    "kernel.mount.setData",
    "kernel.hide.removeLayer",
    "kernel.show.addLayer",
  ])
  const geoKernelPrereq = unmetPrerequisites([
    "geojson.kernel.mount.addLayer",
    "geojson.kernel.mount.setData",
    "geojson.kernel.hide.removeLayer",
    "geojson.kernel.show.addLayer",
  ])

  // ⚠️ 结论必须**先确认读数存在、字段类型对**，再进正 / 负分支：`?.connected ?? 0` 会把
  // 「没测到」悄悄读成「内容没回来 / 重建也没渲染」这类**确定结论**（第三组逐处标过）。
  const mounted = nodesOf("kernel.mounted")
  const shown = nodesOf("kernel.shown")
  lines.push(
    "[DOM 生命周期（严格按内核顺序：addLayer → setData）] " +
      `挂载后 ${domSnap("kernel.mounted")} → 隐藏后 ${domSnap("kernel.hidden")} → ` +
      `**再显示后 ${domSnap("kernel.shown")}** ⇒ ` +
      (kernelPrereq.length > 0
        ? prereqText(kernelPrereq)
        : mounted === null || shown === null
          ? UNKNOWN
          : mounted <= 0
            ? "**无法判定**（对照不成立：挂载后就没有节点）"
            : shown > 0
              ? "**内容自己回来了**（内核 hide -> show 只重新挂载是对的）"
              : "**内容没回来** ⇒ 内核必须在重新挂载后补一次 data 写入，否则真实环境里隐藏再显示会内容消失"),
  )
  const repaired = nodesOf("kernel.repaired")
  const repairThrew = threwOf("kernel.repair.setData")
  lines.push(
    `[再显示后补 setData] ${domSnap("kernel.repaired")}；` +
      `调用本身 ${
        repairThrew === null
          ? UNKNOWN
          : repairThrew
            ? `抛错（${byId.get("kernel.repair.setData")?.message}）`
            : "未抛错"
      } ⇒ ` +
      (kernelPrereq.length > 0
        ? prereqText(kernelPrereq)
        : // 结论归因给「这一次调用」，所以这次调用本身必须先**取到**（抛错是观测，缺失不是）。
          repairThrew === null || repaired === null
          ? UNKNOWN
          : repaired > 0
            ? "**能把内容找回来**（修法可行：重新挂载成功后让 data 槽位重写一次）"
            : "**找不回来**（补 setData 不足以恢复 ⇒ 数据图层不能靠 hide/show 复用实例，必须换新实例）"),
  )
  const geoOrderIds = [
    "geojson.kernel.mounted",
    "geojson.kernel.hidden",
    "geojson.kernel.shown",
    "geojson.kernel.repaired",
  ]
  const geoNums = geoOrderIds.map((id) => overlaysOf(id))
  const geoShown = geoNums[2] ?? null
  lines.push(
    "[GeoJSON 生命周期（同一套内核顺序）] 挂载后 " +
      `${numText(geoNums[0] ?? null)} 条 → 隐藏后 ${numText(geoNums[1] ?? null)} 条 → ` +
      `再显示后 ${numText(geoShown)} 条 → 补 setData 后 ${numText(geoNums[3] ?? null)} 条 ⇒ ` +
      (geoKernelPrereq.length > 0
        ? prereqText(geoKernelPrereq)
        : geoNums.some((value) => value === null) || geoShown === null
          ? UNKNOWN
          : geoShown > 0
            ? "**集合还在**（但注意：集合在 ≠ 覆盖物在图上，这条读数只说明实例没被清空）"
            : "**集合被清空了** ⇒ GeoJSON 与 DOM 一样：`removeLayer` 之后实例不能靠重挂载恢复"),
  )
  // GeoJSON 的**对照**：换一个新实例（内核的重建路径）之后集合条数。与上面那条配对使用——
  // 两边用的是同一份 `data`，所以差异只能来自**实例**，不是数据。
  const geoRebuilt = overlaysOf("geojson.kernel.rebuilt")
  const geoRebuildPrereq = unmetPrerequisites([
    "geojson.kernel.rebuild.setData",
    "geojson.kernel.rebuild.addLayer",
  ])
  lines.push(
    `[对照：GeoJSON 换新实例重建] 集合 ${numText(geoRebuilt)} 条 ⇒ ` +
      (geoRebuildPrereq.length > 0
        ? prereqText(geoRebuildPrereq)
        : geoRebuilt === null
          ? UNKNOWN
          : geoRebuilt > 0
            ? "重建路径正常（同一份 data 在新实例上有数据 ⇒ 上面那条的差异来自**实例**本身）"
            : "**重建之后集合仍为空**（说明本轮实验本身不成立，先查前面的读数）"),
  )
  const rebuilt = nodesOf("kernel.rebuilt")
  const rebuildPrereq = unmetPrerequisites(["kernel.rebuild.setData", "kernel.rebuild.addLayer"])
  lines.push(
    `[对照：换新实例重建] ${domSnap("kernel.rebuilt")} ⇒ ` +
      (rebuildPrereq.length > 0
        ? prereqText(rebuildPrereq)
        : rebuilt === null
          ? UNKNOWN
          : rebuilt > 0
            ? "重建路径正常（可选修法：data 图层在重新可见时重建实例）"
            : "**重建也没渲染**（说明本轮实验本身不成立，先查前面的读数）"),
  )

  // ── 核心读数 2（#98）之一：`DOMLayer.removeAllOverlays()` 在 **detached 实例**上是否生效 ──
  // 这是内核「永久销毁时对已摘下的 DOM 图层**照常**调清空」这条策略的直接依据（ADR 决策 12 / 13），
  // 不能只有原始读数、没有三态结论。各分支**互斥且各自诚实**：`before === 0` 不是「清空无效」，
  // 而是「`removeLayer` 自己就把节点摘干净了」——本探针第一版把它归进「未清掉」，得出了与实际读数
  // 相反的结论（「判定文案必须跟着读数走」这个坑就是从这里来的）。
  // 前置：`dom.removeLayer#1` 必须成功，否则 `dom.detached` 根本不是 detached 状态。
  const domDetachPrereq = unmetPrerequisites(["dom.removeLayer#1"])
  const domBefore = nodesOf("dom.detached")
  const domAfter = nodesOf("dom.afterRemoveAllOverlays")
  const clearThrew = threwOf("dom.removeAllOverlays.已detached")
  const domClearVerdict =
    domDetachPrereq.length > 0
      ? prereqText(domDetachPrereq)
      : domBefore === null || domAfter === null || clearThrew === null
        ? UNKNOWN
        : clearThrew
          ? "**不安全**（detached 上调用抛错 ⇒ 内核不能照常调它，得先把图层挂回去再清）"
          : domBefore === 0
            ? "**无需清空**（`removeLayer` 已把节点从文档摘掉）；detached 调它是安全的 no-op"
            : domAfter === 0
              ? "**有效**（detached 清空确实移除了节点 ⇒ 可固化为「不要求 attached」）"
              : "**无效**（detached 之后节点仍在文档上 ⇒ 永久销毁必须先补挂再清）"
  lines.push(
    `[DOM detached 清空] removeLayer 之后仍连在文档上的节点 ${domSnap("dom.detached")}；` +
      `再调 removeAllOverlays() ${
        clearThrew === null
          ? UNKNOWN
          : clearThrew
            ? `抛错（${byId.get("dom.removeAllOverlays.已detached")?.message}）`
            : "未抛错"
      }；之后 ${domSnap("dom.afterRemoveAllOverlays")} ⇒ ${domClearVerdict}`,
  )

  // ── 核心读数 2 的另一半：`GeoJSONLayer.clearData()` 在 **detached 实例**上是否生效 ──
  // 与上面那条同级的状态机，三件事都不能少：
  //   ① 前置 `geojson.removeLayer#1` 成功（否则 `geojson.detached` 不是 detached 状态）；
  //   ② **消费 `geojson.clearData.已detached` 这个 attempt**——「调用自己抛错但先产生了副作用」
  //      对内核策略是决定性的（不能照常调），只看 before/after 会把它漏掉；
  //   ③ **`after === 0` 才算「完整清空」**：`after !== before` 太弱，2 → 1 这种部分清理也会被
  //      说成「被清空了」，而那并不满足 `clearData()` 的语义。
  const geoDetachPrereq = unmetPrerequisites(["geojson.removeLayer#1"])
  const geoBefore = overlaysOf("geojson.detached")
  const geoAfterClear = overlaysOf("geojson.afterClearData")
  const geoClearThrew = threwOf("geojson.clearData.已detached")
  const geoClearVerdict =
    geoDetachPrereq.length > 0
      ? prereqText(geoDetachPrereq)
      : geoBefore === null || geoAfterClear === null || geoClearThrew === null
        ? UNKNOWN
        : geoClearThrew
          ? "**不安全**（detached 上调用抛错 ⇒ 内核不能照常调它；上面的条数只说明抛错前有没有副作用）"
          : geoBefore === 0
            ? "**无需清空**（`removeLayer` 已把集合清空）；detached 调它是安全的 no-op"
            : geoAfterClear === 0
              ? "**完整清空**（detached 调用有效 ⇒ 可固化为「不要求 attached」；reference 那句" +
                "「要真正清空得在 `removeLayer` **之前**调」与运行时不一致）"
              : geoAfterClear < geoBefore
                ? "**只清掉了部分**（集合变少了但没清空 ⇒ 不满足 `clearData()` 的完整语义）"
                : "**未清空**（集合没有变少）"
  lines.push(
    `[GeoJSON detached clearData] 摘掉后 getData() ${numText(geoBefore)} 条；` +
      `再调 clearData() ${
        geoClearThrew === null
          ? UNKNOWN
          : geoClearThrew
            ? `抛错（${byId.get("geojson.clearData.已detached")?.message}）`
            : "未抛错"
      }；之后 ${numText(geoAfterClear)} 条 ⇒ ${geoClearVerdict}`,
  )
  return lines
}
