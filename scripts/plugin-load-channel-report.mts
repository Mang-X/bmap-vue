/**
 * `probe-plugin-load-channel` 的**判定层**（纯函数，可单测）
 *
 * ## 为什么要单独一个模块
 *
 * 判定一旦写在探针里，就只有「某一天真的跑真实浏览器」时才被执行到，于是只能靠人肉复查
 * （#97 / #104 / #122 的教训：把 `verdicts()` 抽成纯模块，用**合成报告**回归）。
 * 本文件只吃 JSON 形状的入参、只吐结论，不读 `process.argv` / 环境变量 / 文件，
 * 因此 `tests/behavior/v3-plugin-load-channel-decision.test.ts` 可以直接构造各种读数形状来钉它。
 *
 * ## 这个探针要证明的契约（issue #121）
 *
 * | 场景 | 契约 |
 * | --- | --- |
 * | `control` | 同一页面、同一路径、**真实**内置 URL 必须真的就绪 —— 否则「挂起场景的失败」证明不了任何事 |
 * | `hang` | ① 插件挂起期间**地图照常 ready**，且注册表如实停在 `loading` / 至少一个消费者在等；② 挂起必须在超时窗口内以**失败**结算（不是永久 `loading`）；③ 错误必须可归类为超时；④ 结算后注册表状态是 `error`、那个挂着的 `<script>` 必须被摘掉；⑤ 同一个列表里**后面的插件不得被永久阻塞** |
 * | `cancel` | ① `map` 作用域 abort 真的摘掉 `<script>`；② 共享宿主里一个消费者取消**只解绑自己**（共享任务保留、脚本仍在、其它消费者不受影响）；③ 宿主 `dispose()` 纪元重置 ⇒ 在飞加载 abort、`<script>` 移除、等待者结算 |
 *
 * ## 五种失效方式（都写成机器判据，而不是注释）
 *
 * 1. **判定式写歪 / 字段名写错** ⇒ 读数取到 `undefined`，所有不等式都恒真 ⇒ 假绿。
 *    做法：读数一律过「只接受期望 `typeof`」的取值器，取不到就落**第三态**（blocked），
 *    而不是拿 `?? 0` 兜底后继续判正负（#122 §12 的形态）。
 * 2. **缺字段被当成「没问题」** ⇒ 缺报告 / 缺 block 一律 blocked，不得过滤掉。
 * 3. **前置未证明** ⇒ 「script 从未插入过」时，「script 被摘掉了」恒真。因此每个「零残留」断言
 *    都要有对应的正证读数（`scriptsWhileHanging` / `scriptsDuringLoad`）作为**前置**。
 * 4. **外部波动与库回归混为一谈** ⇒ 真实 CDN / 网络不成立时是 blocked(3)，不是 fail(1)。
 * 5. **空转** ⇒ 每个期望的场景都必须有报告，且判定入口对「一个场景都没跑」退 2（脚手架失败）。
 *
 * ## 退出码
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 全部契约成立 |
 * | `1` | 契约不成立（库回归 / 本票要修的缺陷仍在） |
 * | `2` | 脚手架失败：缺报告、页面脚本自身抛错、场景名不认识 |
 * | `3` | `blocked`（本轮无法判定，**不是通过**）：缺 AK、SDK 没起来、前置读数不成立、外部波动 |
 *
 * 优先级：脚手架(2) > blocked(3) > fail(1) > 通过(0)。
 */

export type PluginLoadChannelScenario = "control" | "hang" | "cancel";

/** 探针要跑的全部场景（**单一事实源**：页面侧、orchestrator 与判定都从这里取）。 */
export const PLUGIN_LOAD_CHANNEL_SCENARIOS: readonly PluginLoadChannelScenario[] = [
  "control",
  "hang",
  "cancel",
];

export interface PluginLoadChannelEvent {
  name?: string | null;
  type?: string;
  atMs?: number;
  errorText?: string | null;
}

export interface PluginLoadChannelInspection {
  scope?: string;
  required?: boolean;
  status?: string;
  attempts?: number;
  consumers?: number;
  errorText?: string | null;
}

export interface PluginLoadChannelEnv {
  akPresent?: boolean;
  /** SDK 是否真的起来了（区分「外部不成立」与「本库把 ready 拖住了」）。 */
  sdkLoaded?: boolean;
  /** 页面里 `<canvas>` 的数量：地图夹具真的建起来了的前置读数（0 = 只有 DOM 壳）。 */
  canvasCount?: number;
  hangUrl?: string;
  waitMs?: number;
  /**
   * **内置**插件工厂的超时常量（`BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS`）；`null` = 还不存在。
   *
   * 只对内置工厂有意义：`hang` 场景打补丁的是内置 `TrackAnimation` 的 URL，
   * 公共 `urlPluginDefinition` 不设超时（评审 2026-09-22 P1）。
   */
  builtinPluginTimeoutMs?: number | null;
  urlPatched?: boolean;
  realTrackAnimationUrl?: string;
  userAgent?: string;
}

export interface PluginLoadChannelRun {
  scenario?: string | null;
  env?: PluginLoadChannelEnv;
  readings?: Record<string, unknown>;
  done?: boolean;
  fatal?: string | null;
}

export type PluginLoadChannelExitCode = 0 | 1 | 2 | 3;

export interface PluginLoadChannelDecision {
  exitCode: PluginLoadChannelExitCode;
  reasons: string[];
  counts: {
    runs: number;
    expected: number;
    missingReports: number;
    fatals: number;
    sdkBlocked: number;
    preconditions: number;
    contractFailures: number;
    settledWithinWindow: number;
    /** 挂起放开之后，列表里后面的插件**真的被请求过**（`attempts >= 1`）。 */
    secondPluginRequested: number;
    /** 后面那个插件最终是否就绪（**读数**：含 CDN 耗时，不参与判定）。 */
    secondPluginReady: number;
  };
}

/* ----------------------------------------------------------- 读数取值器（严格） */

/** 只接受期望的 `typeof`：取不到（缺失 / 类型不对）一律 `null` —— 调用方据此落第三态。 */
function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readInspected(
  value: unknown,
  name: string,
): { status: string | null; consumers: number | null; attempts: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const bag = value as Record<string, unknown>;
  const entry = bag[name];
  if (!entry || typeof entry !== "object") return null;
  const inspection = entry as PluginLoadChannelInspection;
  return {
    status: readText(inspection.status),
    consumers: readNumber(inspection.consumers),
    attempts: readNumber(inspection.attempts),
  };
}

function readStep(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const bag = value as Record<string, unknown>;
  const step = bag[key];
  return step && typeof step === "object" ? (step as Record<string, unknown>) : null;
}

function readEvents(value: unknown): PluginLoadChannelEvent[] | null {
  if (!Array.isArray(value)) return null;
  return value as PluginLoadChannelEvent[];
}

/**
 * 取某个场景自己的读数块（页面把每个场景的读数放在 `readings[<scenario>]` 下，便于人读报告）。
 *
 * 取不到就返回 `null` —— 调用方必须落 blocked，不能把「没有这一块」当成「没有异常」。
 */
function readScenarioReadings(run: PluginLoadChannelRun): Record<string, unknown> | null {
  const bag = run.readings;
  if (!bag || typeof bag !== "object") return null;
  const inner = (bag as Record<string, unknown>)[run.scenario ?? ""];
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : null;
}

/** 判定「消费者这一侧结算成了失败」：`__resolved__` 是页面侧的哨兵（成功）。 */
function readRejection(text: string | null): "rejected" | "resolved" | null {
  if (text === null) return null;
  return text === "__resolved__" ? "resolved" : "rejected";
}

/** 错误文本是否可归类为「超时」——用户排查时唯一的抓手。 */
const TIMEOUT_TEXT_PATTERN = /(timed?\s*out|timeout)/i;

/* ------------------------------------------------------------------- 判定 */

export function decidePluginLoadChannelExitCode(
  runs: readonly PluginLoadChannelRun[],
  expected: readonly PluginLoadChannelScenario[] = PLUGIN_LOAD_CHANNEL_SCENARIOS,
  options: { /** 超时判定的容差（毫秒）：读数比常量早太多 ⇒ 那不是超时在起作用。 */ toleranceMs?: number } = {},
): PluginLoadChannelDecision {
  const toleranceMs = options.toleranceMs ?? 2000;
  const byScenario = new Map<string, PluginLoadChannelRun>();
  for (const run of runs) {
    if (typeof run.scenario === "string") byScenario.set(run.scenario, run);
  }
  const reasons: string[] = [];
  const counts = {
    runs: runs.length,
    expected: expected.length,
    missingReports: 0,
    fatals: 0,
    sdkBlocked: 0,
    preconditions: 0,
    contractFailures: 0,
    settledWithinWindow: 0,
    secondPluginRequested: 0,
    secondPluginReady: 0,
  };

  const blocked = (reason: string): PluginLoadChannelDecision => {
    counts.preconditions += 1;
    return { exitCode: 3, reasons: [...reasons, reason], counts };
  };
  const failed = (reason: string): PluginLoadChannelDecision => {
    counts.contractFailures += 1;
    return { exitCode: 1, reasons: [...reasons, reason], counts };
  };

  /* ① 脚手架：期望的场景缺报告 */
  const missing = expected.filter((scenario) => !byScenario.has(scenario));
  counts.missingReports = missing.length;
  if (expected.length === 0 || missing.length > 0) {
    return {
      exitCode: 2,
      reasons: [
        missing.length > 0
          ? `缺少报告（脚手架失败）：${missing.join(", ")}`
          : "没有期望的场景（判定会恒真），调用方必须给出场景清单",
      ],
      counts,
    };
  }

  /* ② 脚手架：页面脚本自身抛错 / 场景名不认识 */
  const fatals = runs.filter((run) => Boolean(run.fatal));
  counts.fatals = fatals.length;
  if (fatals.length > 0) {
    return {
      exitCode: 2,
      reasons: [`页面脚本抛错（脚手架失败）：${fatals.map((run) => `${run.scenario ?? "?"}: ${run.fatal}`).join("；")}`],
      counts,
    };
  }

  /* ③ blocked：AK / SDK 不成立 —— 需要 SDK 的场景结论都不可用 */
  const akMissing = runs.filter((run) => run.env?.akPresent !== true);
  if (akMissing.length > 0) {
    return blocked(`缺 AK（blocked）：${akMissing.map((run) => run.scenario ?? "?").join(", ")}`);
  }
  // SDK 就绪只对有地图的场景是前置：`cancel` 场景刻意不建图（它验的是插件通道本身的取消语义），
  // 拿 SDK 当它的前置会把「通道能不能取消」与「SDK 能不能起来」混成一件事。
  // 显式标 `readonly PluginLoadChannelScenario[]`：`filter` 会把联合收窄成 `"control" | "hang"`
  // 的数组，随后 `includes(run.scenario as PluginLoadChannelScenario)` 会报 TS2345。
  const sdkDependent: readonly PluginLoadChannelScenario[] = expected.filter(
    (scenario) => scenario !== "cancel",
  );
  const sdkBlocked = runs.filter(
    (run) => sdkDependent.includes(run.scenario as PluginLoadChannelScenario) && run.env?.sdkLoaded !== true,
  );
  counts.sdkBlocked = sdkBlocked.length;
  if (sdkBlocked.length > 0) {
    return blocked(
      `SDK 未就绪（blocked，不是通过）：${sdkBlocked.map((run) => run.scenario ?? "?").join(", ")}`,
    );
  }
  // 地图夹具真的建起来了（#43 P1 的形态：夹具没就绪时，插件层面的读数一律不可用）。
  // 缺这个读数也算不成立 —— 不能把「没测到」读成「没问题」。
  const mapFixtureMissing = runs.filter((run) => {
    if (!sdkDependent.includes(run.scenario as PluginLoadChannelScenario)) return false;
    const canvasCount = readNumber(run.env?.canvasCount);
    return canvasCount === null || canvasCount < 1;
  });
  if (mapFixtureMissing.length > 0) {
    return blocked(
      `地图夹具没建成（blocked，不是通过）：${mapFixtureMissing
        .map((run) => `${run.scenario ?? "?"}(canvas=${String(run.env?.canvasCount)})`)
        .join(", ")}`,
    );
  }

  /* ④ control：正证 —— 真实 URL 必须真的就绪 */
  const control = byScenario.get("control") as PluginLoadChannelRun;
  const controlReadings = readScenarioReadings(control);
  if (controlReadings === null) return blocked("control：缺读数块（readings.control）");
  const controlReady = (readEvents(controlReadings.events) ?? []).some(
    (event) => event.type === "plugin-ready" && event.name === "TrackAnimation",
  );
  if (!controlReady) {
    const controlError =
      (readEvents(controlReadings.events) ?? []).find(
        (event) => event.type === "plugin-error",
      )?.errorText ?? null;
    const text = readText(controlError) ?? "";
    // 「脚本加载成功但没暴露全局」是本库通道自己的契约问题 ⇒ fail；
    // 其余（CDN / 网络 / 配额）归外部波动 ⇒ blocked。区分这两类是仓库既有口径。
    if (/expose/i.test(text)) {
      return failed(`control：真实内置 URL 加载后没有暴露全局（通道契约）—— ${text}`);
    }
    return blocked(`control：真实内置 URL 未就绪（外部波动，无法证明通道可用）—— ${text || "（无错误文本）"}`);
  }
  const controlMapReady = readBoolean(controlReadings.mapReady);
  if (controlMapReady === null) return blocked("control：缺 mapReady 读数");
  if (!controlMapReady) {
    return failed("control：真实插件就绪了，但地图没有 ready（隔离口径的反面）");
  }

  /* ⑤ hang：本票的核心契约 */
  const hang = byScenario.get("hang") as PluginLoadChannelRun;
  const hangReadings = readScenarioReadings(hang);
  if (hangReadings === null) return blocked("hang：缺读数块（readings.hang）");
  const hangEnv = hang.env ?? {};

  if (readBoolean(hangEnv.urlPatched) !== true) {
    return blocked("hang：插件 URL 没有被指向永不响应的地址，读数不可用（前置不成立）");
  }
  const scriptsWhileHanging = readNumber(hangReadings.scriptsWhileHanging);
  if (scriptsWhileHanging === null || scriptsWhileHanging < 1) {
    // 前置：没证明「脚本元素真的插进去了」时，「零残留」恒真 ⇒ 不可判定
    return blocked(
      `hang：挂起的脚本元素从未被观察到（scriptsWhileHanging=${String(hangReadings.scriptsWhileHanging)}）—— 「被摘掉」这条断言会恒真`,
    );
  }
  // 挂起**期间**的快照（结算之前）：状态必须是 `loading`、且至少有一个消费者在等。
  // 它与末尾的 `inspected`（`error` / 0）成对说明这条转移；缺读数落第三态。
  const inspectedWhileHanging = readInspected(hangReadings.inspectedWhileHanging, "TrackAnimation");
  if (inspectedWhileHanging === null || inspectedWhileHanging.status === null) {
    return blocked("hang：缺挂起期间的 inspect 读数（inspectedWhileHanging）—— 无法描述「挂起」这个状态");
  }
  if (inspectedWhileHanging.status !== "loading") {
    return failed(
      `hang：脚本元素已插入，但注册表状态是「${inspectedWhileHanging.status}」而不是 loading`,
    );
  }
  if (inspectedWhileHanging.consumers === null || inspectedWhileHanging.consumers < 1) {
    return failed(
      `hang：挂起期间消费者数是 ${String(inspectedWhileHanging.consumers)}，不是「至少一个在等」`,
    );
  }

  const hangMapReady = readBoolean(hangReadings.mapReady);
  if (hangMapReady === null) return blocked("hang：缺 mapReady 读数");
  if (!hangMapReady) return failed("hang：插件挂起期间地图没有 ready（插件不得阻断地图 ready）");

  const settledWithinWindow = readBoolean(hangReadings.settledWithinWindow);
  if (settledWithinWindow === null) return blocked("hang：缺 settledWithinWindow 读数");
  counts.settledWithinWindow = settledWithinWindow ? 1 : 0;
  if (!settledWithinWindow) {
    return failed(
      `hang：插件在超时窗口内没有结算（永久挂起）—— settleType=${String(hangReadings.hangSettleType)}`,
    );
  }

  const settleType = readText(hangReadings.hangSettleType);
  if (settleType === null) return blocked("hang：缺 hangSettleType 读数");
  if (settleType !== "plugin-error") {
    return failed(`hang：挂起以「${settleType}」结算，而不是如实的失败事件`);
  }

  const hangErrorText = readText(hangReadings.hangErrorText);
  if (hangErrorText === null) return blocked("hang：缺 hangErrorText 读数 —— 失败原因不可判定");
  if (!TIMEOUT_TEXT_PATTERN.test(hangErrorText)) {
    return failed(`hang：失败原因不可归类为超时（排查时没有抓手）—— ${hangErrorText}`);
  }

  const configuredTimeout = readNumber(hangEnv.builtinPluginTimeoutMs);
  if (configuredTimeout !== null) {
    const hangSettledAtMs = readNumber(hangReadings.hangSettledAtMs);
    if (hangSettledAtMs === null) {
      return blocked("hang：缺 hangSettledAtMs 读数 —— 无法核对超时是否真的生效");
    }
    if (hangSettledAtMs < configuredTimeout - toleranceMs) {
      return failed(
        `hang：结算时刻 ${hangSettledAtMs}ms 早于配置的超时 ${configuredTimeout}ms（容差 ${toleranceMs}ms）—— 不是超时在起作用`,
      );
    }
  }

  const hangScriptsAtEnd = readNumber(hangReadings.hangScriptsAtEnd);
  if (hangScriptsAtEnd === null) return blocked("hang：缺 hangScriptsAtEnd 读数 —— 无法判断有没有残留");
  if (hangScriptsAtEnd !== 0) {
    return failed(`hang：超时结算后仍残留 ${hangScriptsAtEnd} 个永不响应的脚本元素`);
  }

  const inspectedAfter = readInspected(hangReadings.inspected, "TrackAnimation");
  if (inspectedAfter === null || inspectedAfter.status === null) {
    return blocked("hang：缺 TrackAnimation 的 inspect 读数 —— 状态不可判定");
  }
  if (inspectedAfter.status !== "error") {
    return failed(`hang：结算后注册表状态是「${inspectedAfter.status}」，而不是 error`);
  }

  // 判据用 `attempts`（「后面的插件被真的请求过」）而不是 ready：`loadPluginsInBackground` 是顺序
  // `await`，挂起被放开之后后一个插件**必然**会被请求，但它下载完没有取决于 CDN；
  // 用 ready 当门禁会得到一条随网络抖动的红。ready 仍然进读数（`secondPluginReady`）。
  const secondPluginAttempts = readNumber(hangReadings.secondPluginAttempts);
  counts.secondPluginReady = readBoolean(hangReadings.secondPluginReady) === true ? 1 : 0;
  if (secondPluginAttempts === null) {
    return blocked("hang：缺 secondPluginAttempts 读数 —— 无法判断后续插件有没有被请求");
  }
  counts.secondPluginRequested = secondPluginAttempts >= 1 ? 1 : 0;
  if (secondPluginAttempts < 1) {
    return failed("hang：同一个 plugins 列表里后面的插件从未被请求（被前一个插件的挂起永久阻塞）");
  }

  /* ⑥ cancel：取消语义（既有口径的回归守卫） */
  const cancel = byScenario.get("cancel") as PluginLoadChannelRun;
  const cancelReadings = readScenarioReadings(cancel);
  if (cancelReadings === null) return blocked("cancel：缺读数块（readings.cancel）");

  const mapScoped = readStep(cancelReadings, "mapScopedAbort");
  if (mapScoped === null) return blocked("cancel：缺 mapScopedAbort 读数");
  const duringLoad = readNumber(mapScoped.scriptsDuringLoad);
  if (duringLoad === null || duringLoad < 1) {
    return blocked(
      `cancel：map 作用域加载期间没有观察到脚本元素（duringLoad=${String(mapScoped.scriptsDuringLoad)}）—— 「被摘掉」恒真`,
    );
  }
  const mapScopedRejected = readText(mapScoped.rejectedText);
  if (mapScopedRejected === null) return blocked("cancel：缺 mapScopedAbort.rejectedText 读数");
  if (readRejection(mapScopedRejected) !== "rejected") {
    return failed(`cancel：map 作用域 abort 之后消费者没有以失败结算（${mapScopedRejected}）`);
  }
  const afterAbort = readNumber(mapScoped.scriptsAfterAbort);
  if (afterAbort === null) return blocked("cancel：缺 mapScopedAbort.scriptsAfterAbort 读数");
  if (afterAbort !== 0) {
    return failed(`cancel：map 作用域 abort 之后仍残留 ${afterAbort} 个脚本元素（AbortSignal 分支没摘脚本）`);
  }

  const shared = readStep(cancelReadings, "sharedHost");
  if (shared === null) return blocked("cancel：缺 sharedHost 读数");
  const entryBefore = shared.entryBeforeCancel;
  const consumersBefore = readInspected({ TrackAnimation: entryBefore }, "TrackAnimation")?.consumers ?? null;
  if (consumersBefore !== 2) {
    return blocked(
      `cancel：共享宿主在取消前记录的消费者数是 ${String(consumersBefore)}，不是 2 —— 读数不可用`,
    );
  }
  const aRejected = readText(shared.aRejectedText);
  if (aRejected === null) return blocked("cancel：缺 sharedHost.aRejectedText 读数");
  if (readRejection(aRejected) !== "rejected") {
    return failed(`cancel：被取消的那个消费者没有以失败结算（${aRejected}）`);
  }
  const sharedAfterA = readInspected({ TrackAnimation: shared.entryAfterACancel }, "TrackAnimation");
  if (sharedAfterA === null || sharedAfterA.consumers === null) {
    return blocked("cancel：缺 entryAfterACancel 读数");
  }
  if (sharedAfterA.consumers !== 1) {
    return failed(
      `cancel：取消一个消费者之后共享条目的消费者数是 ${sharedAfterA.consumers}，不是 1（取消波及了别人）`,
    );
  }
  const scriptsAfterACancel = readNumber(shared.scriptsAfterACancel);
  if (scriptsAfterACancel === null) return blocked("cancel：缺 scriptsAfterACancel 读数");
  if (scriptsAfterACancel !== 1) {
    return failed(
      `cancel：取消一个消费者之后共享脚本元素数是 ${scriptsAfterACancel}，不是 1（消费者取消不得终止共享加载）`,
    );
  }
  const bSettledBeforeDispose = readBoolean(shared.bSettledBeforeDispose);
  if (bSettledBeforeDispose === null) return blocked("cancel：缺 bSettledBeforeDispose 读数");
  if (bSettledBeforeDispose) {
    return failed("cancel：宿主 dispose 之前，未取消的那个消费者已经被结算（被别人的取消带走了）");
  }
  const bRejectedAfterDispose = readText(shared.bRejectedTextAfterDispose);
  if (bRejectedAfterDispose === null) return blocked("cancel：缺 bRejectedTextAfterDispose 读数");
  if (readRejection(bRejectedAfterDispose) !== "rejected") {
    return failed(`cancel：宿主 dispose 之后在飞加载的等待者没有结算（${bRejectedAfterDispose}）`);
  }
  const scriptsAfterDispose = readNumber(shared.scriptsAfterDispose);
  if (scriptsAfterDispose === null) return blocked("cancel：缺 scriptsAfterDispose 读数");
  if (scriptsAfterDispose !== 0) {
    return failed(`cancel：宿主 dispose 之后仍残留 ${scriptsAfterDispose} 个脚本元素`);
  }

  return { exitCode: 0, reasons: [], counts };
}

/** 探针打印用的汇总行。 */
export function formatPluginLoadChannelSummary(decision: PluginLoadChannelDecision): string {
  const c = decision.counts;
  return (
    `[plugin-load-channel] exit=${decision.exitCode} runs=${c.runs} expected=${c.expected} ` +
    `missingReports=${c.missingReports} fatals=${c.fatals} sdkBlocked=${c.sdkBlocked} ` +
    `preconditions=${c.preconditions} contractFailures=${c.contractFailures} ` +
    `settledWithinWindow=${c.settledWithinWindow} secondPluginRequested=${c.secondPluginRequested} ` +
    `secondPluginReady=${c.secondPluginReady}`
  );
}
