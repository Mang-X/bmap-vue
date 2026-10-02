/**
 * 「成员是否存在」**只能等成员面补齐之后再回答** —— 可复用的判定层（ 审计教训）
 *
 * ## 这条纪律是被一次真实错误换来的
 *
 * `` 里一整轮 🔴 结论
 * （`CityListControl` 命令面整个不存在 / `expand` 静默空操作 / `removeCopyright` 不存在）
 * **全部是假的**。根因只有一个：**取样时机**。官方 4.0.5 的控件命令面是**分阶段挂载**的——
 * `BMap.Map` 与各控件构造器先到位，完整成员面要**晚约 2.4 秒**才补到原型上。
 * 原审计在补齐之前取样，于是把「**还没到**」读成了「**永远没有**」。
 *
 * 更糟的是**它静默通过**：缺陷通过了全绿的测试，结论也写进了审计文档。
 * 原因不是判断写错了，而是「读到 `false`」与「确实不存在」在取样代码里**长得一模一样**——
 * 没有一行代码要求「你等到补齐了吗」。
 *
 * 本模块就是那行缺失的要求。它把纪律写成**类型**，让「在补齐之前判 absent」变成写不出来的代码。
 *
 * ## 三条不变式
 *
 * 1. **`absent` 只在 settled 之后可能出现。** 补齐之前一律是 `unsettled`（未判定）。
 * 2. **等待是可观测的。** 报告里带 `settledAfterMs` / 每类原型成员数 / 采样次数，
 *    读者能分辨「这是一次稳定态读数」与「这是一次提前读数」——原审计缺的正是这个。
 * 3. **判定层独立于等待层。** 即使页面侧的等待**超时**（`settled: false`），
 *    Node 侧的 `verdict()` 仍然拒绝输出 `absent`。这不是防御性冗余：
 *    超时是**正常**结果（网络慢、窗口比预期宽），而超时后的 `absent` 正是本模块要根除的那个假阴性。
 *
 * ## 为什么浏览器侧与 Node 侧各有一份逻辑
 *
 * 等待**必须**发生在浏览器里（异步、要轮询、要读页面上的 SDK），而**下结论**发生在 Node 里
 * （打印报告、写 JSON、供人工裁决）。两边都实现一次同一条不变式，代价是「同一条规则写两遍」——
 * 换来的是**任一侧被绕过都还有一道**。页面侧的源码以字符串导出，正是为了让测试能在 Node 里
 * 用假 SDK **真跑一遍**它（`tests/behavior/probe-member-surface.test.ts`），
 * 而不是只测 Node 侧那半。
 */

/* ------------------------------------------------------------------ 规格 */

/**
 * 一个类在「成员面已补齐」时的判据。
 *
 * `settleWhenPresent` 是**具名**成员而不是「成员数 > N」：数量门槛在成员增删时会误判
 * （「26 > 10」成立不代表 `toggle` 已到位），而**具名**判据直接说「我要的那几个到了吗」。
 * `minProtoMembers` 只作为**附加**的健壮性下限（防止某次抽样整体异常偏低）。
 */
export interface MemberSurfaceSpec {
  /** 构造器名（报告用；同时是页面侧 `BMap[ctorName]` 的取值）。 */
  readonly ctor: string;
  /** 全部在位才算 settled 的成员名。 */
  readonly settleWhenPresent: readonly string[];
  /**
   * 本次要**逐个读三态**的成员名（页面侧会逐个采 `typeof`）。
   *
   * ⚠️ 与 `settleWhenPresent` 是**两个集合**，不能混用：`settleWhenPresent` 只决定
   * 「等到没有」，而三态读数问的是**全部**被问的成员——`toggle` 用来判就绪，
   * `open` / `close` / `getTriggerDom` 才是要下结论的那几个。
   * 页面侧只采 `settleWhenPresent` 的话，未列入其中的成员永远读成「不在」，
   * 稳定态也会被判成 `absent`（本轮 live 实跑真的撞到过：
   * §④ 明写 `open proto=true`，而三态段把 `open` 印成了 `absent`）。
   * 省略时退回 `settleWhenPresent`（够用，但读不到别的成员）。
   */
  readonly observe?: readonly string[];
  /** 原型成员数下界（可选；与具名判据并列生效）。 */
  readonly minProtoMembers?: number;
}

/* ------------------------------------------------------------------ 判定（Node 侧，零依赖） */

/** 一个成员在一次采样上的三态读数。 */
export type Presence = "present" | "absent" | "unsettled";

/** 一次采样的结果（浏览器侧产出，Node 侧消费）。 */
export interface SurfaceSample {
  /** 原型自有成员数——`null` 表示构造器此刻压根不在。 */
  readonly protoMemberCount: number | null;
  /** 采样时**在**的成员（取自 `proto[name]` 或实例上的 `typeof === "function"`）。 */
  readonly present: readonly string[];
}

/** `settleWhenPresent` + `minProtoMembers` 两条是否都满足。 */
export function isSettled(spec: MemberSurfaceSpec, sample: SurfaceSample): boolean {
  if (sample.protoMemberCount === null) return false;
  if (spec.minProtoMembers !== undefined && sample.protoMemberCount < spec.minProtoMembers) {
    return false;
  }
  const present = new Set(sample.present);
  return spec.settleWhenPresent.every((member) => present.has(member));
}

/**
 * 单个成员的读数 → 三态。
 *
 * ⚠️ **补齐之前不许输出 `absent`**：这条是这个模块存在的全部理由。
 * `present` 只看采样结果（真在就在）；`absent` 要求 `sampleSettled` **由调用方显式给出**，
 * 不是一个可以顺手默认成 `true` 的参数——所以这里收的是整个报告的 `settled` 标志，
 * 而不是让每个调用点自己判断「我等到没有」。
 */
export function presenceOf(
  spec: MemberSurfaceSpec,
  sample: SurfaceSample,
  members: readonly string[],
  member: string,
  settled: boolean,
): Presence {
  if (sample.present.includes(member)) return "present";
  return settled ? "absent" : "unsettled";
}

/* ------------------------------------------------------------------ 报告 */

/** 等待阶段的观测数据（**缺了它就没法分辨稳定态与提前读数**）。 */
export interface MemberSurfaceReport {
  /** 是否真的等到补齐。`false` ⇒ 报告里**所有** `absent` 都不成立。 */
  readonly settled: boolean;
  /** 从等待开始到 settled 的毫秒数（**未** settled 时是超时值）。 */
  readonly settledAfterMs: number;
  /** 实际采样次数。 */
  readonly attempts: number;
  /** 是否是**超时**退出（与「判定为补齐」区分开）。 */
  readonly timedOut: boolean;
  /** 等待期间的逐次采样（给时间轴用；最后一次即 `final`）。 */
  readonly timeline: readonly { atMs: number; perCtor: Record<string, number | null> }[];
  /** 终态采样。 */
  readonly final: Record<string, SurfaceSample>;
}

/** 浏览器侧 `awaitSettled` 的返回（JSON 往返后的形状，字段全可选——页面可能崩在半路）。 */
export interface RawMemberSurfaceReport {
  settled?: boolean;
  settledAfterMs?: number;
  attempts?: number;
  timedOut?: boolean;
  timeline?: MemberSurfaceReport["timeline"];
  final?: Record<string, SurfaceSample>;
}

/**
 * 页面侧返回的 JSON → 规整报告。
 *
 * 缺字段一律落成**最保守**的取值（`settled: false` / `final: {}`）⇒ 下游所有读数变成
 * `unsettled`。宁可说「没判定」，也不要把一份残缺报告读成「成员都不存在」——
 * 这正是原审计犯的错，只是发生在另一层。
 */
export function normalizeReport(raw: RawMemberSurfaceReport | null | undefined): MemberSurfaceReport {
  const final = raw?.final ?? {};
  const timeline = raw?.timeline ?? [];
  return {
    settled: raw?.settled === true,
    settledAfterMs: typeof raw?.settledAfterMs === "number" ? raw.settledAfterMs : Number.NaN,
    attempts: typeof raw?.attempts === "number" ? raw.attempts : timeline.length,
    timedOut: raw?.timedOut === true,
    timeline,
    final,
  };
}

/**
 * 报告 → 每个成员的最终三态读数。
 *
 * `settled` 来自**报告**而不是从 `final` 反推：等待超时后某次采样恰好「看起来够了」
 * 是可能的（成员数达标但具名成员还没到），而**只有等待循环自己知道**它有没有等到。
 */
export function verdictsOf(
  specs: readonly MemberSurfaceSpec[],
  membersByCtor: Readonly<Record<string, readonly string[]>>,
  report: MemberSurfaceReport,
): Record<string, Record<string, Presence>> {
  const out: Record<string, Record<string, Presence>> = {};
  for (const spec of specs) {
    const sample = report.final[spec.ctor] ?? { protoMemberCount: null, present: [] };
    // settled 是**全局**的：只要有一个类没补齐，就不认定任何一个类可以判 absent
    // （等待循环按「全部 spec 都满足」退出，单类满足不构成退出条件）。
    const settled = report.settled && isSettled(spec, sample);
    const bucket: Record<string, Presence> = {};
    for (const member of membersByCtor[spec.ctor] ?? []) {
      bucket[member] = presenceOf(spec, sample, membersByCtor[spec.ctor]!, member, settled);
    }
    out[spec.ctor] = bucket;
  }
  return out;
}

/* ------------------------------------------------------------------ 浏览器侧源码 */

/**
 * 浏览器侧实现（**以源码字符串导出**）。
 *
 * 之所以是字符串而不是模块：探针的页面脚本本身就是一段拼出来的 JS 字符串
 * （`probe-165c-surface.mts` 的 `PAGE_JS`），页面里**不能** `import`。
 * 导出字符串的另一个好处是测试能在 Node 里 `new Function` 真跑它——
 * 于是「等待循环」这条逻辑也是**被测到的**，而不只是「写了注释」。
 *
 * 注入后页面侧得到 `window.__BMAP_MEMBER_SURFACE__`：
 *
 * - `sample(specs)` —— 采一次，返回 `{ ctor: { protoMemberCount, present } }`；
 * - `awaitSettled(specs, opts)` —— 轮询到**全部** spec 满足或超时，返回 `MemberSurfaceReport`。
 *
 * ⚠️ 成员读法是 **`proto[name]` 或实例上的 `typeof === "function"` 都要算在位**：
 * `probe-runtime-members.mts` case 11 踩过「只读原型 ⇒ 挂在实例上的成员全报 false」。
 * 这里两者都读，宁可把「在」判宽一点——把在位的成员读成不在，正是要根除的错误。
 */
export const MEMBER_SURFACE_PAGE_SOURCE = `
window.__BMAP_MEMBER_SURFACE__ = (function () {
  function protoNames(Ctor) {
    try { return Ctor && Ctor.prototype ? Object.getOwnPropertyNames(Ctor.prototype) : null; }
    catch (e) { return null; }
  }
  function hasFn(o, n) {
    try { return !!(o && typeof o[n] === "function"); } catch (e) { return false; }
  }
  // ⚠️ 必须走 **window.setTimeout** 而不是裸 setTimeout：测试注入的是**假 window 对象**，
  // 裸 setTimeout 会绕过它解析到宿主全局（Node 的真定时器），于是「窗口在第几个 tick 补齐」
  // 根本编排不出来——等待循环会真跑满 timeout。浏览器里两者是同一个对象，但显式写
  // window. 让「这段逻辑可被测试驱动」这件事在语法层就成立。
  function sleep(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }

  /** 采一次。ctor 不在 ⇒ protoMemberCount = null（与「成员为 0」区分开）。 */
  function sample(specs) {
    var B = window.BMap || {};
    var out = {};
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var Ctor = B[spec.ctor];
      var names = protoNames(Ctor);
      // observe ∪ settleWhenPresent：**两者都要采**。只用 settleWhenPresent 的话，
      // 那些「用来判就绪但不是结论对象」的成员以外的就永远读不到，稳定态也会被误判 absent。
      var wanted = (spec.observe || spec.settleWhenPresent).concat(spec.settleWhenPresent);
      var seen = {};
      var uniq = [];
      for (var w = 0; w < wanted.length; w++) {
        if (!seen[wanted[w]]) { seen[wanted[w]] = true; uniq.push(wanted[w]); }
      }
      var present = [];
      if (Ctor) {
        for (var j = 0; j < uniq.length; j++) {
          if (hasFn(Ctor.prototype, uniq[j]) || hasFn(Ctor, uniq[j])) present.push(uniq[j]);
        }
      }
      out[spec.ctor] = { protoMemberCount: names === null ? null : names.length, present: present };
    }
    return out;
  }

  function settledAll(specs, samples) {
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var s = samples[spec.ctor];
      if (!s || s.protoMemberCount === null) return false;
      if (spec.minProtoMembers !== undefined && s.protoMemberCount < spec.minProtoMembers) return false;
      var set = {};
      for (var j = 0; j < s.present.length; j++) set[s.present[j]] = true;
      for (var k = 0; k < spec.settleWhenPresent.length; k++) {
        if (!set[spec.settleWhenPresent[k]]) return false;
      }
    }
    return true;
  }

  /**
   * 轮询到补齐。**首次采样就满足**时 attempts = 1、settledAfterMs = 0——
   * 「本来就同步就位」（如本体自带的类）是正常结果，不是「没等」。
   */
  async function awaitSettled(specs, opts) {
    opts = opts || {};
    var interval = opts.intervalMs === undefined ? 25 : opts.intervalMs;
    var timeout = opts.timeoutMs === undefined ? 15000 : opts.timeoutMs;
    // 同 sleep：走 window.performance / window.Date，测试注入的假时钟才驱动得动。
    var now = function () {
      if (window.performance && window.performance.now) return window.performance.now();
      return new Date().getTime();
    };
    var started = now();
    var timeline = [];
    var attempts = 0;
    var settled = false;
    var timedOut = false;
    var last = null;
    for (;;) {
      attempts++;
      last = sample(specs);
      var perCtor = {};
      for (var key in last) perCtor[key] = last[key].protoMemberCount;
      timeline.push({ atMs: Math.round(now() - started), perCtor: perCtor });
      if (settledAll(specs, last)) { settled = true; break; }
      if (now() - started >= timeout) { timedOut = true; break; }
      await sleep(interval);
    }
    return {
      settled: settled,
      timedOut: timedOut,
      attempts: attempts,
      settledAfterMs: Math.round(now() - started),
      timeline: timeline,
      final: last
    };
  }

  return { sample: sample, awaitSettled: awaitSettled };
})();
`;

/** 把页面侧源码装进一个 `window`（测试用假 `window`，探针用真 `window`）。 */
export function installMemberSurface(target: {
  BMap?: unknown;
  performance?: { now(): number };
  setTimeout(handler: () => void, ms: number): unknown;
}): {
  sample(specs: readonly MemberSurfaceSpec[]): Record<string, SurfaceSample>;
  awaitSettled(
    specs: readonly MemberSurfaceSpec[],
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<MemberSurfaceReport>;
} {
  const win = target as unknown as { __BMAP_MEMBER_SURFACE__?: unknown };
  // eslint-disable-next-line no-new-func
  new Function("window", MEMBER_SURFACE_PAGE_SOURCE)(win);
  return win.__BMAP_MEMBER_SURFACE__ as ReturnType<typeof installMemberSurface>;
}
