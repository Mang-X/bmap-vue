/**
 * `probe-track-line.mts` 的**判定层**（读数 → 结论），单独成模块是为了可测。
 *
 * 与 #98 的 `probe-layer-detached-verdicts.mts` 同一口径：
 *
 * 1. **每个结论先查 presence / 类型，再进正负分支**；缺失一律 `UNKNOWN`（第三态）。
 *    `?.` + `??` 兜底会把「没测到」印成「测到了，是不好的那一侧」——正是要禁止的形态。
 * 2. 「前置 attempt 抛错 / 读数缺失」也是 `UNKNOWN`，并点名是哪一步不成立。
 * 3. 结论行可以带读数原文，但**结论本身**不得由读数原文二次推导。
 *
 * issue #110 的四组问题 → 四条结论（外加方法面与事件载荷，共六条）：
 * 方法面 / 事件载荷 / 播放命令效果 / setProcess·setSpeed / 页面可见性 / removeLayer。
 */

/** 一条读数。字段可选正是「可能没测到」的来源，所以判定层必须逐字段查 presence。 */
export interface Reading {
  id: string;
  threw?: boolean;
  message?: string | null;
  /** `typeof` 某个方法的结果（方法面）。 */
  type?: string;
  /** 事件计数 / 窗口内 progress 条数等。 */
  count?: number;
  /** observed 读数里的 statuschange 条数。 */
  statusCount?: number;
  /** progress 载荷里的 `process` 采样。 */
  process?: number;
  firstProcess?: number;
  lastProcess?: number;
  /** 事件 `value` 的键列表。 */
  keys?: string[];
  /** `statuschange` 载荷。 */
  status?: number | string;
  statusName?: string;
  /** 可见性模拟方式：`cdp` / `synthetic`。 */
  method?: string;
}

/** 页面写回的报告（脱敏前的原始形状）。 */
export interface ProbeReport {
  phase: string;
  sdk: Record<string, string> | null;
  readings: Reading[];
  console: Array<{ level: string; text: string }>;
  error: string | null;
  loadError?: string;
}

/** 三态里的第三态。缺失读数的**唯一**合法归宿，不得落进正 / 负任一分支。 */
const UNKNOWN = "**无法判定**（读数缺失）";

const METHOD_IDS = [
  ["setData", "method.setData.type"],
  ["start", "method.start.type"],
  ["pause", "method.pause.type"],
  ["resume", "method.resume.type"],
  ["stop", "method.stop.type"],
  ["setSpeed", "method.setSpeed.type"],
  ["setProcess", "method.setProcess.type"],
] as const;

/**
 * 正证控件：本轮实验能不能下结论。
 *
 * 两条硬门槛（#110）：
 * 1. `TrackLine` 的 `start` 必须是 function（异步注入没完成 / 方法面不存在 ⇒ 后面全部无意义）；
 * 2. `start` 之后 progress 必须**前进**（`count >= 2`）——没有这条，「pause 无效」可能只是
 *    「本来就没在播」。
 */
export function controlFailures(report: ProbeReport): string[] {
  const failures: string[] = [];
  const byId = new Map(report.readings.map((r) => [r.id, r]));

  const startType = byId.get("method.start.type")?.type;
  if (startType !== "function") {
    failures.push(
      `method.start 不是 function（得到 ${String(startType)}）—— TrackLine 未注入或方法面不存在`,
    );
  }

  const baseline = byId.get("control.progress.baseline");
  if (!baseline || typeof baseline.count !== "number" || baseline.count < 2) {
    failures.push(
      `control.progress.baseline 的 count 不足（得到 ${String(baseline?.count)}）—— start 之后 progress 没有前进`,
    );
  } else {
    // 字段在、类型对时才比较 process；只报 count 也算成立（有的构建只给 count）。
    const { firstProcess, lastProcess } = baseline;
    if (
      typeof firstProcess === "number" &&
      typeof lastProcess === "number" &&
      !(lastProcess > firstProcess)
    ) {
      failures.push(
        `control.progress.baseline 的 process 没有前进（first=${firstProcess} last=${lastProcess}）`,
      );
    }
  }
  return failures;
}

/**
 * 把读数映射成结论——本探针真正的产物。共 **6** 条，与
 * `probe-track-line-verdicts.test.ts` 的空报告用例条数锁在一起。
 */
export function verdicts(report: ProbeReport): string[] {
  const byId = new Map(report.readings.map((r) => [r.id, r]));
  const lines: string[] = [];

  const threwOf = (id: string): boolean | null => {
    const value = byId.get(id)?.threw;
    return typeof value === "boolean" ? value : null;
  };
  const typeOf = (id: string): string | null => {
    const value = byId.get(id)?.type;
    return typeof value === "string" ? value : null;
  };
  const countOf = (id: string): number | null => {
    const value = byId.get(id)?.count;
    return typeof value === "number" ? value : null;
  };
  /** observed 读数里的 `statusCount`（statuschange 条数）。 */
  const statusCountOf = (id: string): number | null => {
    const value = byId.get(id)?.statusCount;
    return typeof value === "number" ? value : null;
  };
  const processOf = (id: string): number | null => {
    const value = byId.get(id)?.process;
    return typeof value === "number" ? value : null;
  };
  const keysOf = (id: string): string[] | null => {
    const value = byId.get(id)?.keys;
    return Array.isArray(value) ? value : null;
  };
  const statusNameOf = (id: string): string | null => {
    const value = byId.get(id)?.statusName;
    return typeof value === "string" ? value : null;
  };
  const firstProcessOf = (id: string): number | null => {
    const value = byId.get(id)?.firstProcess;
    return typeof value === "number" ? value : null;
  };
  const lastProcessOf = (id: string): number | null => {
    const value = byId.get(id)?.lastProcess;
    return typeof value === "number" ? value : null;
  };
  const methodOf = (id: string): string | null => {
    const value = byId.get(id)?.method;
    return typeof value === "string" ? value : null;
  };

  /** 前置 attempt 全部 `threwOf === false`；否则返回失败说明（空数组 = 全部成功）。 */
  const unmetPrerequisites = (ids: readonly string[]): string[] =>
    ids
      .map((id) => ({ id, threw: threwOf(id) }))
      .filter((item) => item.threw !== false)
      .map((item) => `${item.id} ${item.threw === null ? "读数缺失" : "抛错"}`);
  const prereqText = (unmet: readonly string[]): string =>
    `**无法判定**（前置步骤不成立：${unmet.join("、")}）`;

  const describeAttempt = (id: string): string => {
    const threw = threwOf(id);
    if (threw === null) return "无法判定（读数缺失）";
    return threw ? `抛错（${byId.get(id)?.message}）` : "未抛错";
  };

  // ── 1. 方法面（七个方法的存在性） ────────────────────────────────────────
  {
    const missing: string[] = [];
    const present: string[] = [];
    let sawNull = false;
    for (const [name, id] of METHOD_IDS) {
      const type = typeOf(id);
      if (type === null) sawNull = true;
      else if (type === "function") present.push(name);
      else missing.push(`${name}=${type}`);
    }
    lines.push(
      `[方法面] ` +
        METHOD_IDS.map(([name, id]) => `${name}:${typeOf(id) ?? "—"}`).join(" / ") +
        ` ⇒ ` +
        (sawNull
          ? UNKNOWN
          : missing.length > 0
            ? `**缺失**（非 function：${missing.join(", ")}）`
            : "**七个方法齐全**（typeof 均为 function；可调用性由后面各条的 attempt 读数回答）"),
    );
    void present;
  }

  // ── 2. 事件载荷形状 ──────────────────────────────────────────────────────
  {
    const statusKeys = keysOf("event.statuschange.keys");
    const progressKeys = keysOf("event.progress.keys");
    lines.push(
      `[事件载荷] statuschange keys=${statusKeys === null ? "—" : JSON.stringify(statusKeys)}；` +
        `progress keys=${progressKeys === null ? "—" : JSON.stringify(progressKeys)} ⇒ ` +
        (statusKeys === null || progressKeys === null
          ? UNKNOWN
          : statusKeys.length === 0 && progressKeys.length === 0
            ? "**两者都空**（监听没绑上或事件未派发）"
            : `**已取到**（statuschange ${statusKeys.length} 字段 / progress ${progressKeys.length} 字段）`),
    );
  }

  // ── 3. 播放命令：pause / resume / stop 的可观测效果 ──────────────────────
  //
  // 「可观测」有两种形态，缺一不可地按命令语义解释：
  // - **pause / stop**：效果是「进度停下来」⇒ 窗口内 `progress count === 0`（或几乎没有）
  //   就是正证据，不是「没测到」；statuschange 同样算证据。
  // - **resume**：效果是「继续推进」⇒ 窗口内必须有 progress（或 statuschange）。
  //
  // 三个 observed 读数必须**同时**在场；缺任一条落第三态。
  {
    const pausePrereq = unmetPrerequisites(["cmd.pause.attempt"]);
    const resumePrereq = unmetPrerequisites(["cmd.resume.attempt"]);
    const stopPrereq = unmetPrerequisites(["cmd.stop.attempt"]);
    const pauseCount = countOf("cmd.pause.observed");
    const resumeCount = countOf("cmd.resume.observed");
    const stopCount = countOf("cmd.stop.observed");
    const pauseStatusCount = statusCountOf("cmd.pause.observed");
    const resumeStatusCount = statusCountOf("cmd.resume.observed");
    const stopStatusCount = statusCountOf("cmd.stop.observed");
    const allPrereq = [...pausePrereq, ...resumePrereq, ...stopPrereq];

    const observables: boolean[] | null =
      pauseCount === null || resumeCount === null || stopCount === null
        ? null
        : [
            // pause：进度停住或有 statuschange
            pauseCount === 0 || (pauseStatusCount !== null && pauseStatusCount > 0),
            // resume：必须还有（或新的）progress / status
            resumeCount > 0 || (resumeStatusCount !== null && resumeStatusCount > 0),
            // stop：停住（0 或最多 1 条收尾事件）
            stopCount <= 1 || (stopStatusCount !== null && stopStatusCount > 0),
          ];
    const effective = observables === null ? null : observables.filter(Boolean).length;

    lines.push(
      `[播放命令] pause(${describeAttempt("cmd.pause.attempt")}/obs=${num(pauseCount)}) → ` +
        `resume(${describeAttempt("cmd.resume.attempt")}/obs=${num(resumeCount)}) → ` +
        `stop(${describeAttempt("cmd.stop.attempt")}/obs=${num(stopCount)}) ⇒ ` +
        (allPrereq.length > 0
          ? prereqText(allPrereq)
          : effective === null
            ? UNKNOWN
            : effective === 3
              ? "**pause / resume / stop 可观测**（pause·stop 停进度 / resume 推进 — 效果走公开 progress，statuschange 可缺席）"
              : effective === 0
                ? "**无效果可观测**（命令不抛错但进度不停也不再推进 ⇒ 不建镜像状态机的依据）"
                : `**部分可观测**（只有 ${effective}/3 次有效果信号；明细：pause=${String(observables![0])} resume=${String(observables![1])} stop=${String(observables![2])}）`),
    );
  }

  // ── 4. setProcess / setSpeed ─────────────────────────────────────────────
  {
    const processPrereq = unmetPrerequisites(["cmd.setProcess.attempt"]);
    const speedPrereq = unmetPrerequisites(["cmd.setSpeed.attempt"]);
    const process = processOf("cmd.setProcess.observed");
    const processCount = countOf("cmd.setProcess.observed");
    const speedCount = countOf("cmd.setSpeed.observed");
    const allPrereq = [...processPrereq, ...speedPrereq];
    lines.push(
      `[setProcess / setSpeed] setProcess(${describeAttempt("cmd.setProcess.attempt")}` +
        `${process === null ? "" : `→${process}`}/obs=${num(processCount)})；` +
        `setSpeed(${describeAttempt("cmd.setSpeed.attempt")}/obs=${num(speedCount)}) ⇒ ` +
        (allPrereq.length > 0
          ? prereqText(allPrereq)
          : process === null && speedCount === null
            ? UNKNOWN
            : process !== null || (speedCount !== null && speedCount >= 0)
              ? (process !== null && process > 0
                  ? "**可调用**（setProcess 后读到 process 采样）"
                  : "**可调用**（attempt 未抛错；process 采样缺失时只依据 attempt）") +
                `；setSpeed attempt ${
                  threwOf("cmd.setSpeed.attempt") === false ? "未抛错" : "见上"
                }`
              : UNKNOWN),
    );
  }

  // ── 5. 页面可见性（hidden 窗口） ─────────────────────────────────────────
  {
    const method = methodOf("vis.method");
    const hiddenCount = countOf("vis.hidden.observed");
    const hiddenStatus = statusNameOf("vis.hidden.observed");
    const hiddenFirst = firstProcessOf("vis.hidden.observed");
    const hiddenLast = lastProcessOf("vis.hidden.observed");
    const processStopped =
      hiddenFirst !== null && hiddenLast !== null ? hiddenLast <= hiddenFirst : null;
    lines.push(
      `[页面可见性] 模拟方式=${method ?? "—"}；hidden 窗口 progress 条数=${num(hiddenCount)}` +
        ` statusName=${hiddenStatus ?? "—"} process ${num(hiddenFirst)}→${num(hiddenLast)} ⇒ ` +
        (method === null || hiddenCount === null
          ? UNKNOWN
          : hiddenStatus === "paused" || hiddenStatus === "pause"
            ? "**SDK 自行暂停**（hidden 窗口出现 paused statuschange）"
            : hiddenFirst === null || hiddenLast === null
              ? UNKNOWN
              : hiddenLast > hiddenFirst
                ? "**progress 继续**（hidden 期间 process 在前进 ⇒ SDK 未因 hidden 暂停）"
                : processStopped === true
                  ? "**progress 停止**（process 不动且无 paused statuschange ⇒ 暂停信号不完整）"
                  : UNKNOWN),
    );
  }

  // ── 6. removeLayer 之后的停止语义 ────────────────────────────────────────
  {
    const removePrereq = unmetPrerequisites(["rm.remove.attempt"]);
    const afterCount = countOf("rm.after.observed");
    const afterProcess = processOf("rm.after.observed");
    lines.push(
      `[removeLayer] 摘除(${describeAttempt("rm.remove.attempt")})；之后窗口 progress 条数=` +
        `${num(afterCount)}${afterProcess === null ? "" : ` process=${afterProcess}`} ⇒ ` +
        (removePrereq.length > 0
          ? prereqText(removePrereq)
          : afterCount === null
            ? UNKNOWN
            : afterCount === 0
              ? "**已隐式停止**（removeLayer 之后不再派发 progress/statuschange ⇒ 组件卸载不需再显式 stop 才能停事件）"
              : "**仍在推进**（removeLayer 之后事件仍在来 ⇒ 组件必须在释放路径里先 stop 再解绑）"),
    );
  }

  return lines;
}

function num(value: number | null): string {
  return value === null ? "—" : String(value);
}
