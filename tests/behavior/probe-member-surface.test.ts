/**
 * 「等成员面补齐再判成员存在」这条纪律的**回归守卫**（issue #165 审计教训）
 *
 * ## 这组用例在防什么
 *
 * `docs/zh-CN/contributing/165-runtime-audit-2026-09-27.md` 里一整轮 🔴 结论
 * （`CityListControl` 命令面整个不存在 / `expand` 静默空操作 / `removeCopyright` 不存在）
 * **全部是假的**，而它**静默通过**了全绿的测试。原因不是判断写错了，而是：
 *
 * > 「读到 `false`」与「确实不存在」在取样代码里**长得一模一样**——
 * > 没有一行代码要求「你等到补齐了吗」。
 *
 * 官方 4.0.5 的控件命令面是**分阶段挂载**的：`BMap.Map` 与各控件构造器先到位，
 * 完整成员面**晚约 2.4 秒**才补到原型上。取样早一步，「还没到」就被读成了「永远没有」。
 *
 * 所以本组用例**不测**「SDK 有没有这些成员」（那是 live 取证，一次跑几百秒），
 * 而是拿**假 SDK 编排出那个窗口**，让纪律本身在 CI 里逐条变成断言。
 *
 * ## 为什么连页面侧那份（字符串）也要真跑
 *
 * `awaitSettled` 的等待循环在**浏览器里**（异步、要轮询、要读页面上的 SDK），
 * 而判定在 Node 侧。只测 Node 侧那半，等于把「轮询到没轮询到」这段——也就是真正会
 * 出错的那段——放���测之外。因此这里用假 `window` 把 `MEMBER_SURFACE_PAGE_SOURCE`
 * `new Function` 起来**真跑一遍**：窗口里 `setTimeout` 之后才补齐的成员面，
 * 必须在 Node 侧读成 `present`；**始终不补齐**的必须读成 `unsettled`。
 *
 * 页面侧与 Node 侧各实现一次同一条不变式（见模块头的说明）：任一侧被绕过都还有一道。
 */
import { describe, expect, it } from "vitest";
import {
  isSettled,
  installMemberSurface,
  MEMBER_SURFACE_PAGE_SOURCE,
  normalizeReport,
  presenceOf,
  verdictsOf,
  type MemberSurfaceSpec,
  type SurfaceSample,
} from "../../scripts/official-probe/member-surface.mts";

const CL: MemberSurfaceSpec = {
  ctor: "CityListControl",
  settleWhenPresent: ["toggle", "getCityName"],
};
const CC: MemberSurfaceSpec = {
  ctor: "CopyrightControl",
  settleWhenPresent: ["removeCopyright"],
};

function sample(protoMemberCount: number | null, present: string[]): SurfaceSample {
  return { protoMemberCount, present };
}

/**
 * 假 SDK：按调用计时刻意地在某个 tick 之后补齐成员面。
 *
 * 窗口的形状照抄 live 读数：**构造器立刻在、成员面空**，之后某个 tick 才补上。
 */
function createFakeWindow(options: { settleAfterTicks: number | null }): {
  window: Parameters<typeof installMemberSurface>[0];
  ticks: () => number;
} {
  let ticks = 0;
  const namespace: Record<string, unknown> = {
    CityListControl: function CityListControl() {} as unknown,
    CopyrightControl: function CopyrightControl() {} as unknown,
  };
  // 窗口开始时：两个构造器都在，成员面**空**（`CityListControl` 3 个 / `CopyrightControl` 8 个，
  // 与 live 读到的 loader 判就绪那一刻的原型成员数同量级）。
  (namespace.CityListControl as { prototype: Record<string, unknown> }).prototype = {
    _className: "CityListControl",
    constructor: null,
    initialize: () => {},
  };
  (namespace.CopyrightControl as { prototype: Record<string, unknown> }).prototype = {
    _className: "CopyrightControl",
    constructor: null,
    initialize: () => {},
    getCopyright: () => {},
    getCopyrightCollection: () => {},
  };

  const target = {
    BMap: namespace,
    performance: { now: () => ticks * 25 },
    setTimeout(handler: () => void) {
      ticks += 1;
      if (options.settleAfterTicks !== null && ticks === options.settleAfterTicks) {
        const cl = namespace.CityListControl as { prototype: Record<string, unknown> };
        cl.prototype.toggle = () => {};
        cl.prototype.getCityName = () => {};
        cl.prototype.open = () => {};
        cl.prototype.close = () => {};
        const cc = namespace.CopyrightControl as { prototype: Record<string, unknown> };
        cc.prototype.removeCopyright = () => {};
      }
      handler();
      return 0;
    },
  };
  return { window: target, ticks: () => ticks };
}

/* ------------------------------------------------------------------ */
/* 三态：补齐之前不许说 absent                                         */
/* ------------------------------------------------------------------ */

describe("成员读数三态：补齐之前不许判 absent", () => {
  it("settled 之后才允许 absent，settled 之前是 unsettled", () => {
    const s = sample(3, []); // 窗口内：成员面还没补
    expect(presenceOf(CL, s, ["toggle"], "toggle", true)).toBe("absent");
    expect(presenceOf(CL, s, ["toggle"], "toggle", false)).toBe("unsettled");
  });

  it("在位的成员不因为未 settled 而被降级（三态只影响 absent）", () => {
    // 已在原型上就始终是 present：把「在」读成「未判定」同样是一种丢信息
    const s = sample(26, ["toggle", "getCityName"]);
    expect(presenceOf(CL, s, ["toggle"], "toggle", false)).toBe("present");
  });

  it("isSettled 要求**具名**成员全在，且下限也满足", () => {
    const spec: MemberSurfaceSpec = {
      ctor: "X",
      settleWhenPresent: ["toggle", "getCityName"],
      minProtoMembers: 10,
    };
    // 数量达标但具名成员没到 ⇒ **不算** settled（「26 > 10」不代表 toggle 到位）
    expect(isSettled(spec, sample(26, ["open", "close"]))).toBe(false);
    expect(isSettled(spec, sample(26, ["toggle", "getCityName"]))).toBe(true);
    // 具名齐了但数量不达标 ⇒ 也不算（防某次抽样整体异常偏低）
    expect(isSettled(spec, sample(4, ["toggle", "getCityName"]))).toBe(false);
  });

  it("构造器压根不在（protoMemberCount=null）不算 settled", () => {
    expect(isSettled(CL, sample(null, []))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 报告层：残缺 / 超时的报告不得被读成「成员都不存在」                    */
/* ------------------------------------------------------------------ */

describe("报告层：把「没判定」与「不存在」分开", () => {
  it("normalizeReport 对缺字段一律取最保守值 ⇒ 下游全是 unsettled", () => {
    for (const raw of [null, undefined, {}, { final: {} }]) {
      const report = normalizeReport(raw);
      expect(report.settled).toBe(false);
      const v = verdictsOf([CL], { CityListControl: ["toggle"] }, report);
      expect(v.CityListControl!.toggle).toBe("unsettled");
    }
  });

  it("等待超时（settled=false）时，即便终态采样读起来「够像稳态」也判 unsettled", () => {
    // 这是本模块最关键的一条：**超时是正常结果**（网络慢、窗口比预期宽），
    // 而超时后的 absent 正是 #165 审计那三条假结论的形状。
    const report = normalizeReport({
      settled: false,
      timedOut: true,
      settledAfterMs: 15000,
      attempts: 600,
      final: { CityListControl: sample(26, ["open", "close"]) },
    });
    const v = verdictsOf([CL], { CityListControl: ["toggle"] }, report);
    expect(v.CityListControl!.toggle).toBe("unsettled");
  });

  it("settled=true 且该 spec 自己也满足时才给 absent（读的是被问的那个成员）", () => {
    const report = normalizeReport({
      settled: true,
      settledAfterMs: 2400,
      attempts: 97,
      final: {
        // settled 判据用的是 `settleWhenPresent`，`absent` 问的是另一个成员
        CityListControl: sample(26, ["toggle", "getCityName"]),
        CopyrightControl: sample(16, ["removeCopyright"]),
      },
    });
    const v = verdictsOf(
      [CL, CC],
      {
        CityListControl: ["toggle", "getTriggerDom", "getSelectedCityName"],
        CopyrightControl: ["removeCopyright", "getCopyrightOwner"],
      },
      report,
    );
    // settleWhenPresent 里的成员在位 ⇒ present
    expect(v.CityListControl!.toggle).toBe("present");
    // settleWhenPresent 已满足、但**没在位**的成员 ⇒ 此时才判 absent
    expect(v.CityListControl!.getSelectedCityName).toBe("absent");
    expect(v.CopyrightControl!.getCopyrightOwner).toBe("absent");
  });

  it("全局 settled 但某个类仍不满足 ⇒ 那个类不判 absent", () => {
    const report = normalizeReport({
      settled: true,
      final: {
        CityListControl: sample(26, ["toggle", "getCityName"]),
        // 列表里第二个 spec 的成员没到：等待循环按「全部满足」退出时不该发生，
        // 但若发生（上游改了成员名），这个类**不能**被顺带判成 absent。
        CopyrightControl: sample(8, []),
      },
    });
    const v = verdictsOf([CL, CC], { CopyrightControl: ["removeCopyright"] }, report);
    expect(v.CopyrightControl!.removeCopyright).toBe("unsettled");
  });
});

/* ------------------------------------------------------------------ */
/* 页面侧（真跑字符串源码）：等待循环本身也要被测                        */
/* ------------------------------------------------------------------ */

describe("页面侧 awaitSettled：在假 SDK 上真跑一遍", () => {
  it("第 2 个 tick 才补齐 ⇒ settled，且报告带可观测的 settledAfterMs 与成员数", async () => {
    const { window } = createFakeWindow({ settleAfterTicks: 2 });
    const api = installMemberSurface(window);
    const report = await api.awaitSettled([CL, CC], { intervalMs: 25, timeoutMs: 5000 });

    expect(report.settled, "等到补齐就必须是 settled").toBe(true);
    expect(report.timedOut).toBe(false);
    // 可观测：读者能分辨「这是一次稳定态读数」与「一次提前读数」——原审计缺的正是这个
    expect(report.settledAfterMs).toBe(50);
    expect(report.attempts).toBe(3);
    expect(report.final.CityListControl).toEqual({ protoMemberCount: 7, present: expect.arrayContaining(["toggle"]) });
    // 时间轴可复核：第一次采样时成员面还是空的
    expect(report.timeline[0]!.perCtor.CityListControl).toBe(3);
    expect(report.timeline.at(-1)!.perCtor.CityListControl).toBe(7);
  });

  it("**始终不补齐** ⇒ timedOut 且 settled=false，成员读数必须是 unsettled 而非 absent", async () => {
    // 这一条就是原审计踩的那一步：它在这里读成了「成员不存在」
    const { window } = createFakeWindow({ settleAfterTicks: null });
    const api = installMemberSurface(window);
    const report = await api.awaitSettled([CL], { intervalMs: 25, timeoutMs: 150 });

    expect(report.settled).toBe(false);
    expect(report.timedOut).toBe(true);
    const v = verdictsOf([CL], { CityListControl: ["toggle"] }, report);
    expect(v.CityListControl!.toggle, "超时 ⇒ 未判定，绝不是 absent").toBe("unsettled");
  });

  it("**首次采样就已满足** ⇒ attempts=1、settledAfterMs=0（这是正常结果，不是「没等」）", async () => {
    const namespace = {
      CityListControl: function CityListControl() {} as unknown,
    };
    (namespace.CityListControl as { prototype: Record<string, unknown> }).prototype = {
      constructor: null,
      toggle: () => {},
      getCityName: () => {},
    };
    const window = {
      BMap: namespace,
      performance: { now: () => 0 },
      setTimeout(handler: () => void) {
        handler();
        return 0;
      },
    };
    const api = installMemberSurface(window);
    const report = await api.awaitSettled([CL], { intervalMs: 25, timeoutMs: 5000 });
    expect(report.settled).toBe(true);
    expect(report.attempts).toBe(1);
    expect(report.settledAfterMs).toBe(0);
  });

  it("成员挂在**实例**上（不在原型）也算在位 —— #165 probe case 11 踩过原型读法的坑", () => {
    const namespace = {
      C: function C() {} as unknown,
    };
    // 只在构造器**函数对象**上挂成员（模拟 `resetHeading` 那种实例/静态成员）
    (namespace.C as unknown as Record<string, unknown>).resetHeading = () => {};
    const window = {
      BMap: namespace,
      performance: { now: () => 0 },
      setTimeout(handler: () => void) {
        handler();
        return 0;
      },
    };
    const api = installMemberSurface(window);
    const sampled = api.sample([{ ctor: "C", settleWhenPresent: ["resetHeading"] }]);
    expect(sampled.C!.present).toContain("resetHeading");
  });

  it("minProtoMembers 下限真的生效：具名成员齐了但原型成员太少 ⇒ 不算 settled", () => {
    // 上面那条「实例上也算在位」用例的原型只有 1 个成员：加上下限就该判 not-settled。
    // 这条守住「下限不是装饰」——把它删掉，上面那条用例会静默变成「已就绪」的正例。
    const namespace = { C: function C() {} as unknown };
    (namespace.C as unknown as Record<string, unknown>).resetHeading = () => {};
    const window = {
      BMap: namespace,
      performance: { now: () => 0 },
      setTimeout(handler: () => void) {
        handler();
        return 0;
      },
    };
    const api = installMemberSurface(window);
    const spec: MemberSurfaceSpec = {
      ctor: "C",
      settleWhenPresent: ["resetHeading"],
      minProtoMembers: 10,
    };
    const sampled = api.sample([spec]);
    expect(isSettled(spec, sampled.C!)).toBe(false);
  });

  it("**observe 里的成员也会被逐个采样**（live 实跑踩过：稳定态 `open` 被印成 absent）", () => {
    // 这条是**反过来的**同一类错误：不在窗口里，而是**读数集**与**判定集**用了同一个名字。
    // live 复跑（2026-09-27）时 §④ 明写 `open proto=true`，而三态段把 `open` 印成了 `absent`
    // —— 因为页面侧只采 `settleWhenPresent`（["toggle","getCityName"]），
    // `open` 根本没被采过，却照样被下了「不存在」的结论。
    //
    // ⚠️ 这条假阴性**比窗口那条更难发现**：它出现在 settled 之后，报告看起来完全正常。
    const namespace = { CityListControl: function CityListControl() {} as unknown };
    (namespace.CityListControl as { prototype: Record<string, unknown> }).prototype = {
      constructor: null,
      toggle: () => {},
      getCityName: () => {},
      open: () => {},
      close: () => {},
    };
    const window = {
      BMap: namespace,
      performance: { now: () => 0 },
      setTimeout(handler: () => void) {
        handler();
        return 0;
      },
    };
    const api = installMemberSurface(window);
    const spec: MemberSurfaceSpec = {
      ctor: "CityListControl",
      settleWhenPresent: ["toggle", "getCityName"],
      observe: ["open", "close", "toggle", "getTriggerDom", "getCityName"],
    };
    const report = { settled: true, settledAfterMs: 145, attempts: 5, timedOut: false, timeline: [], final: api.sample([spec]) };
    const sampled = api.sample([spec]);
    const verdicts = verdictsOf([spec], { CityListControl: spec.observe! }, {
      settled: true,
      settledAfterMs: 145,
      attempts: 5,
      timedOut: false,
      timeline: [],
      final: sampled,
    });
    expect(verdicts.CityListControl!.open, "open 在原型上却读成 absent 就是错判").toBe("present");
    expect(verdicts.CityListControl!.close).toBe("present");
    // 真的不在的那个仍然判 absent
    expect(verdicts.CityListControl!.getTriggerDom).toBe("absent");
  });
});

/* ------------------------------------------------------------------ */
/* 探针脚本的装配：注入的源码必须是**能跑**的，而不只是「语法合法」        */
/* ------------------------------------------------------------------ */

describe("探针页面脚本的装配", () => {
  const PAGE_JS = `
__MEMBER_SURFACE_SOURCE__
var MEMBER_SURFACE_SPECS = __MEMBER_SURFACE_SPECS__;
var ak = __AK_LITERAL__;
(async () => { window.__assembled = 1; })();
`;

  /** 与 `probe-165c-surface.mts` 的 `buildPageScript` **同一条**替换顺序。 */
  function build(ak: string, specs: readonly MemberSurfaceSpec[]): string {
    return PAGE_JS.replace("__AK_LITERAL__", JSON.stringify(ak))
      .replace("__MEMBER_SURFACE_SPECS__", JSON.stringify(specs))
      .replace("__MEMBER_SURFACE_SOURCE__", MEMBER_SURFACE_PAGE_SOURCE);
  }

  it("组装结果语法合法，且共享判定层真的装上了", () => {
    const built = build("fake-ak", [CL]);
    expect(() => new Function(built)).not.toThrow();
    expect(built, "共享判定层装上了").toContain("__BMAP_MEMBER_SURFACE__");
    expect(built, "specs 被内联").toContain('"CityListControl"');
  });

  it("占位符替换**不叠前缀**（全局正则的坑：本轮真的产出过 window.__window.__X____）", () => {
    // ⚠️ 这条极其廉价却极重要：那种损坏**仍是合法 JS**，`new Function` 的语法检查抓不到，
    // 探针会一路跑到浏览器里才以「__BMAP_MEMBER_SURFACE__ is undefined」的形式炸掉。
    const built = build("fake-ak", [CL]);
    expect(built).not.toContain("window.__window.__");
    expect(built).not.toContain("____");
    // 每个占位符只该出现一次替换结果：内联的 specs 只出现一遍
    expect((built.match(/"settleWhenPresent"/g) ?? []).length).toBe(1);
  });

  it("AK 不落进共享源码（它只经 __AK_LITERAL__ 占位符走）", () => {
    const built = build("AK-SENTINEL-VALUE", [CL]);
    expect(built).toContain("AK-SENTINEL-VALUE");
    expect(MEMBER_SURFACE_PAGE_SOURCE, "共享源码自身不含 AK").not.toContain("AK-SENTINEL-VALUE");
  });
});
