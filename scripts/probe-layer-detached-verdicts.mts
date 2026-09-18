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
  if (!dom || (dom.created ?? 0) <= 0) failures.push("dom.attached 没有创建出任何元素")
  // 「节点真的进了文档」是「残留」这个读数的前提：不成立就无法区分「没残留」与「本来就没进去」
  else if ((dom.connected ?? 0) <= 0) failures.push("dom.attached 的节点一个都没连到文档上")
  return failures
}

/** 三态里的第三态。缺失读数的**唯一**合法归宿，不得落进正 / 负任一分支。 */
const UNKNOWN = "**无法判定**（读数缺失）"

/**
 * 把读数映射成结论——这是本探针真正的产物。
 *
 * 口径（三条，改这个函数前先读）：
 * 1. **每个结论都先查 presence / 类型，再进正负分支**；缺失一律 `UNKNOWN`。
 * 2. 「对照不成立」也是 `UNKNOWN`，不是负结论——控件不成立时后面的读数无意义。
 * 3. 结论行里可以带读数原文（`domSnap`），但**结论本身**不得由读数原文推导（同一处读两次
 *    容易只在一处加 presence 检查）。
 */
export function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]))
  const lines: string[] = []

  // 每条读数**三态**：安全 / 不安全 / **无法判定**。缺失的读数**不得**当成 safe——
  // `!undefined === true` 会把「没测到」读成「安全」，正是第六轮评审要求避免的形态。
  const describeReading = (reading: Reading | undefined) =>
    reading === undefined
      ? "无法判定（读数缺失）"
      : reading.threw
        ? `抛错（${reading.message}）`
        : "未抛错"
  const pReadings: Array<[string, Reading | undefined]> = [
    ["GeoJSON", byId.get("geojson.removeLayer#2.已摘下")],
    ["DOM", byId.get("dom.removeLayer#2.已摘下")],
    ["Tile", byId.get("tile.removeLayer#2.已摘下")],
  ]
  const known = pReadings.filter(([, reading]) => reading !== undefined)
  const anyThrew = known.some(([, reading]) => reading!.threw)
  const pVerdict =
    known.length < pReadings.length
      ? "**无法判定**（有读数缺失）"
      : anyThrew
        ? "**不安全**（三态收敛的该分支需要换机制）"
        : "安全（前提 P 成立）"
  lines.push(
    `[前提 P] 对已摘下的图层重复 removeLayer —— ` +
      pReadings.map(([name, reading]) => `${name} ${describeReading(reading)}`).join(" / ") +
      ` ⇒ ${pVerdict}`,
  )

  // 重挂载是否按保留数据重渲染：**内核的 hide -> show 依赖它**（只重新挂载、不再 setData）。
  /** 读一个「节点数」字段：读数缺失或字段类型不对 ⇒ `null`（调用方按**第三态**处理）。 */
  const nodesOf = (id: string): number | null => {
    const value = byId.get(id)?.connected
    return typeof value === "number" ? value : null
  }
  const domSnap = (id: string) => {
    const reading = byId.get(id)
    const connected = nodesOf(id)
    if (reading === undefined || connected === null) return UNKNOWN
    return `${String(connected)} 个节点连在文档（overlays ${String(reading.overlayCount)}）`
  }
  // ⚠️ 结论必须**先确认读数存在、字段类型对**，再进正 / 负分支：`?.connected ?? 0` 会把
  // 「没测到」悄悄读成「内容没回来 / 重建也没渲染」这类**确定结论**（第三组逐处标过）。
  const mounted = nodesOf("kernel.mounted")
  const shown = nodesOf("kernel.shown")
  lines.push(
    "[DOM 生命周期（严格按内核顺序：addLayer → setData）] " +
      `挂载后 ${domSnap("kernel.mounted")} → 隐藏后 ${domSnap("kernel.hidden")} → ` +
      `**再显示后 ${domSnap("kernel.shown")}** ⇒ ` +
      (mounted === null || shown === null
        ? UNKNOWN
        : mounted <= 0
          ? "**无法判定**（对照不成立：挂载后就没有节点）"
          : shown > 0
            ? "**内容自己回来了**（内核 hide -> show 只重新挂载是对的）"
            : "**内容没回来** ⇒ 内核必须在重新挂载后补一次 data 写入，否则真实环境里隐藏再显示会内容消失"),
  )
  const repaired = nodesOf("kernel.repaired")
  const repairCall = byId.get("kernel.repair.setData")
  lines.push(
    `[再显示后补 setData] ${domSnap("kernel.repaired")}；` +
      `调用本身 ${
        repairCall === undefined
          ? UNKNOWN
          : repairCall.threw
            ? `抛错（${repairCall.message}）`
            : "未抛错"
      } ⇒ ` +
      (repaired === null
        ? UNKNOWN
        : repaired > 0
          ? "**能把内容找回来**（修法可行：重新挂载成功后让 data 槽位重写一次）"
          : "**找不回来**（补 setData 不足以恢复 ⇒ 数据图层不能靠 hide/show 复用实例，必须换新实例）"),
  )
  const geoNums = ["geojson.kernel.mounted", "geojson.kernel.hidden", "geojson.kernel.shown", "geojson.kernel.repaired"]
    .map((id) => byId.get(id)?.overlayCount)
  lines.push(
    "[GeoJSON 生命周期（同一套内核顺序）] 挂载后 " +
      `${String(geoNums[0])} 条 → 隐藏后 ${String(geoNums[1])} 条 → 再显示后 ${String(geoNums[2])} 条 → ` +
      `补 setData 后 ${String(geoNums[3])} 条 ⇒ ` +
      (geoNums.some((value) => typeof value !== "number")
        ? UNKNOWN
        : Number(geoNums[2]) > 0
          ? "**集合还在**（但注意：集合在 ≠ 覆盖物在图上，这条读数只说明实例没被清空）"
          : "**集合被清空了** ⇒ GeoJSON 与 DOM 一样：`removeLayer` 之后实例不能靠重挂载恢复"),
  )
  const rebuilt = nodesOf("kernel.rebuilt")
  lines.push(
    `[对照：换新实例重建] ${domSnap("kernel.rebuilt")} ⇒ ` +
      (rebuilt === null
        ? UNKNOWN
        : rebuilt > 0
          ? "重建路径正常（可选修法：data 图层在重新可见时重建实例）"
          : "**重建也没渲染**（说明本轮实验本身不成立，先查前面的读数）"),
  )

  // ── 核心读数 2（#98）：`DOMLayer.removeAllOverlays()` 在 **detached 实例**上是否生效 ──
  // 这是内核「永久销毁时对已摘下的 DOM 图层**照常**调清空」这条策略的直接依据（ADR 决策 12 / 13），
  // 不能只有原始读数、没有三态结论。各分支**互斥且各自诚实**：`before === 0` 不是「清空无效」，
  // 而是「`removeLayer` 自己就把节点摘干净了」——本探针第一版把它归进「未清掉」，得出了与实际读数
  // 相反的结论（「判定文案必须跟着读数走」这个坑就是从这里来的）。
  const domBefore = nodesOf("dom.detached")
  const domAfter = nodesOf("dom.afterRemoveAllOverlays")
  const clearCall = byId.get("dom.removeAllOverlays.已detached")
  const domClearVerdict =
    domBefore === null || domAfter === null || clearCall === undefined
      ? UNKNOWN
      : clearCall.threw
        ? "**不安全**（detached 上调用抛错 ⇒ 内核不能照常调它，得先把图层挂回去再清）"
        : domBefore === 0
          ? "**无需清空**（`removeLayer` 已把节点从文档摘掉）；detached 调它是安全的 no-op"
          : domAfter === 0
            ? "**有效**（detached 清空确实移除了节点 ⇒ 可固化为「不要求 attached」）"
            : "**无效**（detached 之后节点仍在文档上 ⇒ 永久销毁必须先补挂再清）"
  lines.push(
    `[DOM detached 清空] removeLayer 之后仍连在文档上的节点 ${domSnap("dom.detached")}；` +
      `再调 removeAllOverlays() ${
        clearCall === undefined
          ? UNKNOWN
          : clearCall.threw
            ? `抛错（${clearCall.message}）`
            : "未抛错"
      }；之后 ${domSnap("dom.afterRemoveAllOverlays")} ⇒ ${domClearVerdict}`,
  )

  const geoDetached = byId.get("geojson.detached")
  const geoAfter = byId.get("geojson.afterClearData")
  const geoNumbersKnown =
    typeof geoDetached?.overlayCount === "number" && typeof geoAfter?.overlayCount === "number"
  lines.push(
    `[GeoJSON detached clearData] 摘掉后 getData() ${String(geoDetached?.overlayCount)} 条；` +
      `再调 clearData() 之后 ${String(geoAfter?.overlayCount)} 条 ⇒ ` +
      (!geoNumbersKnown
        ? UNKNOWN
        : geoAfter!.overlayCount === geoDetached!.overlayCount
          ? "**未清空**（印证 reference「要真正清空得在 removeLayer 之前调」⇒ 内核跳过它是正确的）"
          : "**被清空了**（reference 那句话与运行时不一致，需要据实修正）"),
  )
  return lines
}
