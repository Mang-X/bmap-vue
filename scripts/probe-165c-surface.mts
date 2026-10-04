#!/usr/bin/env node
/**
 * #165 的运行时面探针：**控件 / 覆盖物的成员面是「逐步补齐」的**（live AK，headless Chrome）
 *
 * ## 为什么需要这个探针
 *
 * #165 的审计结论是「`CityListControl` 的命令面在运行时整个不存在（`prototype` 只有 3 个成员）、
 * `CopyrightControl#removeCopyright` 不存在」。本探针复核后的结论**不一样**，而且是本脚本
 * 存在的唯一理由：
 *
 * > 那条读数是**真的**，但取自**补齐之前**。成员面会**晚 ~150ms 挂上**，挂上之后
 * > `toggle()` / `getCityName()` / `removeCopyright()` 全部在位且**真调得动**。
 *
 * 因此审计文档的「三个运行时损坏」中的两条（`CityListControl` 命令面、`removeCopyright`）
 * 应当改写成「**取样错位**」，而**真正的**缺陷是本脚本测的那个窗口：
 * **官方 loader 的就绪信号早于成员补齐 ~150ms**。
 *
 * ## 三段读数，各回答一个不同的问题
 *
 * | 段 | 回答 | 关键观察点 |
 * | --- | --- | --- |
 * | ① 加载时间轴 | 补齐**何时**发生、是否被建图触发 | 每个观察点都记 `CityListControl.prototype` 的成员数 |
 * | ② 窗口内 / 窗口后 | 窗口里**真的**会失败吗、补齐会追溯到旧实例吗 | 同一实例上前后各跑一遍 `add` / `remove` / `toggle` |
 * | ③ 稳定的成员面 | 补齐之后每个类**究竟有哪些成员** | `prototype` 全名单 + 实例 `typeof` |
 *
 * ## 判据（本脚本的核心约定）
 *
 * - **不能只看「BMap 出现了」**：观察点用官方 loader 自己的 `__p165c_cb` callback，
 *   那正是 `@baidumap/jsapi-loader@1.0.0` 判定「已加载」的那一下（`dist/index.mjs` 的
 *   `window[t] = function () { … a = LOADED, o(...) }`）。本库（以及任何用官方 loader 的代码）
 *   正是从这里开始建图、建控件——所以「loader 判就绪」与「成员补齐」之间的差就是**可达窗口**。
 * - **`proto: false` 单独不足以判「不存在」**（`Panorama` 探针踩过：成员挂实例不挂原型）。
 *   本脚本三处都读 `proto` / `inst` / `own`。
 * - **`typeof === "function"` 不等于「调得动」**：`call` 一栏是真调一次的结果
 *   （`Marker#setAnchor` 在位却抛 `ControlAnchor is not a constructor`）。
 *
 * ## 判定与退出码
 *
 * | 结论 | 含义 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 页面脚本跑完且报告写出来了（**不代表每条都符合仓库预期**——本探针是取证器） | 0 |
 * | `blocked` | SDK 没起来（`loadError`）——不是通过也不是失败 | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错 / 页面没写报告 | 2 |
 *
 * 与 `probe-runtime-members.mts` 同一口径：**本探针不给 pass/fail 结论**，它只产出读数；
 * 读数的解释由人工裁决并写回注释。AK 从 `BAIDU_MAP_AK` 读、**不落库**，输出一律脱敏。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165c-surface.mts
 *   BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165c-surface.mts --out=/tmp/165c.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";
import {
  MEMBER_SURFACE_PAGE_SOURCE,
  normalizeReport,
  verdictsOf,
  type MemberSurfaceSpec,
} from "./official-probe/member-surface.mts";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const OUT = outIndex >= 0 ? (argv[outIndex + 1] ?? "") : "";
const AK = (process.env.BAIDU_MAP_AK ?? "").trim();

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 页面里**不出现反引号**（外层是 TS 模板串），AK 走 `__AK_LITERAL__` 占位符——
 * 直接内插 JSON 字面量会让 `encodeURIComponent("…")` 变成 `encodeURIComponent("""…""")`。
 *
 * 报告**只在最后发布**（`window.__PROBE_165C__`）：`readProbeReport` 一读到非 null 就返回，
 * 而这个页面在真实网络下要跑十几秒——开头就发布半成品会让探针立刻打印一份只有 `sdk:null`
 * 的读数并退出（本轮真的踩过一次）。半成品不发布 ⇒ 读到的一定是终态。
 */
const PAGE_JS = `
__MEMBER_SURFACE_SOURCE__
var MEMBER_SURFACE_SPECS = __MEMBER_SURFACE_SPECS__;
(async () => {
  var report = { timeline: [], windowBefore: null, windowAfter: null, stable: {}, phase: "running" };
  function names(Ctor) { return Ctor && Ctor.prototype ? Object.getOwnPropertyNames(Ctor.prototype).slice().sort() : null; }
  function hasFn(o, n) { return !!(o && typeof o[n] === "function"); }
  function snap(label) {
    var B = window.BMap || {};
    report.timeline.push({
      label: label,
      ms: Math.round(performance.now()),
      cityListMembers: (names(B.CityListControl) || []).length,
      hasToggle: hasFn(B.CityListControl && B.CityListControl.prototype, "toggle"),
      hasGetCityName: hasFn(B.CityListControl && B.CityListControl.prototype, "getCityName"),
      copyrightMembers: (names(B.CopyrightControl) || []).length,
      hasRemoveCopyright: hasFn(B.CopyrightControl && B.CopyrightControl.prototype, "removeCopyright"),
    });
  }
  function t(fn) {
    try { var r = fn(); return { threw: false, value: r === undefined ? "undefined" : (r && r.length !== undefined && !r.point ? "array(" + r.length + ")" : String(r)) }; }
    catch (e) { return { threw: true, message: String(e && e.message ? e.message : e) }; }
  }
  /** 成员三值读法 + 真调一次。inst 才是判据（proto 单独不足以判「不存在」）。 */
  function read(Ctor, instance, ns) {
    var proto = Ctor && Ctor.prototype;
    var out = { protoNames: names(Ctor), members: {} };
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      var e = { proto: hasFn(proto, n), inst: hasFn(instance, n), own: !!(instance && Object.prototype.hasOwnProperty.call(instance, n)) };
      if (e.inst) e.call = t(function () { return instance[n](); });
      out.members[n] = e;
    }
    return out;
  }

  // —— 观察点用官方 loader 自己的 callback：那正是 jsapi-loader 判「已加载」的那一下 ——
  await new Promise(function (resolve) {
    var name = "__p165c_cb";
    window[name] = function () { report.callbackAt = Math.round(performance.now()); resolve(); };
    var s = document.createElement("script");
    s.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(__AK_LITERAL__) + "&callback=" + name;
    s.onerror = function () { report.loadError = "script error"; resolve(); };
    document.head.appendChild(s);
  });
  var B = window.BMap;
  if (!B || !B.Map) { report.loadError = "BMap.Map undefined"; report.phase = "done"; window.__PROBE_165C__ = report; return; }
  report.sdk = { version: B.sdkVersion || B.version || null, ready: true };
  snap("A:官方 callback 触发（loader 判就绪）");

  var div = document.createElement("div");
  div.style.width = "320px"; div.style.height = "240px";
  document.body.appendChild(div);
  var map = new B.Map(div, { center: new B.Point(116.404, 39.915), zoom: 11 });
  snap("B:new B.Map 之后");
  await new Promise(function (r) { setTimeout(r, 0); });
  snap("C:让出一个宏任务之后");

  // —— ② 窗口「前」：真走一遍 <CopyrightControl> 的 mount→unmount ——
  var cc = new B.CopyrightControl();
  map.addControl(cc);
  report.windowBefore = {
    atMs: Math.round(performance.now()),
    msAfterCallback: Math.round(performance.now() - report.callbackAt),
    addCopyright: typeof cc.addCopyright,
    removeCopyright: typeof cc.removeCopyright,
    // mount 做的事
    addCopyrightCall: t(function () { return cc.addCopyright({ id: 1, content: "early" }); }),
    collectionAfterAdd: t(function () { return cc.getCopyrightCollection(); }),
    // unmount 做的事
    removeCopyrightCall: t(function () { return cc.removeCopyright(1); }),
  };
  var cl = new B.CityListControl({ expand: false });
  map.addControl(cl);
  report.windowBefore.cityList = {
    toggle: typeof cl.toggle,
    getCityName: typeof cl.getCityName,
    open: typeof cl.open,
    toggleCall: t(function () { return cl.toggle(); }),
    getCityNameCall: t(function () { return cl.getCityName(); }),
  };
  report.windowBefore.cityListProto = names(B.CityListControl);
  report.windowBefore.copyrightProto = names(B.CopyrightControl);

  // —— 等补齐 —— 共享判定层（scripts/official-probe/member-surface.mts），不再手写循环。
  //
  // 原审计的错误就发生在这一步：原实现是一句「成员数 > 10」的内联循环，它**不产出**任何
  // 「等到了没有」的信息，因此 §④ 的稳定态读数与「窗口内的读数」在报告里**长得一样**。
  // 现在：等待结果落进 report.memberSurface（settled / timedOut / settledAfterMs /
  // 逐次 timeline / 终态每类成员数），Node 侧再用 verdictsOf() 出三态读数——
  // **没等到就不给 absent，只给 unsettled**。
  report.memberSurface = await window.__BMAP_MEMBER_SURFACE__.awaitSettled(MEMBER_SURFACE_SPECS, {
    intervalMs: 25,
    timeoutMs: 20000,
  });
  // 相对于官方 callback 的偏移（awaitSettled 只知道自己等了多久）
  report.settleMsAfterCallback = Math.round(performance.now() - report.callbackAt);
  snap(report.memberSurface.settled ? "D:命令面补齐" : "D:补齐**未等到**（超时）");

  // —— 窗口「后」：**同一个实例**（原型被补 ⇒ 实例追溯获得成员）——
  report.windowAfter = {
    atMs: Math.round(performance.now()),
    // 同一个 cc：窗口里 add 的那条还在吗？remove 现在调得动吗？
    removeCopyrightNowFunction: typeof cc.removeCopyright,
    collectionNow: t(function () { return cc.getCopyrightCollection(); }),
    removeCopyrightCall: t(function () { return cc.removeCopyright(1); }),
    collectionAfterRemove: t(function () { return cc.getCopyrightCollection(); }),
    clToggleNowFunction: typeof cl.toggle,
    clToggleCall: t(function () { return cl.toggle(); }),
    clGetCityNameCall: t(function () { return cl.getCityName(); }),
  };

  // —— ③ 稳定后的成员面 ——
  report.stable.cityList = read(B.CityListControl, cl, ["open", "close", "toggle", "getTriggerDom", "getCityName"]);
  var ov = new B.OverviewMapControl();
  map.addControl(ov);
  report.stable.overviewCompare = { protoMemberCount: (names(B.OverviewMapControl) || []).length };
  var cc2 = new B.CopyrightControl();
  map.addControl(cc2);
  report.stable.copyright = read(B.CopyrightControl, cc2, ["addCopyright", "removeCopyright", "getCopyright", "getCopyrightCollection"]);
  var marker = new B.Marker(new B.Point(116.404, 39.915), { title: "probe" });
  map.addOverlay(marker);
  report.stable.marker = read(B.Marker, marker, ["setAnchor", "getAnchor", "setZIndex", "setPosition", "getPosition", "setIcon"]);
  try {
    // 官方签名是 (domCreate: Function, options) —— domCreate 是**函数**，传元素会报「参数类型错误」
    var co = new B.CustomOverlay(function () {
      var d = document.createElement("div");
      d.style.cssText = "width:40px;height:40px;background:#eee;";
      return d;
    }, { point: new B.Point(116.404, 39.915), zIndex: 10, minZoom: 3, maxZoom: 19 });
    map.addOverlay(co);
    report.stable.customOverlay = read(B.CustomOverlay, co, ["setZIndex", "setMinZoom", "setMaxZoom", "setOptions", "setPoint", "setRotation", "setProperties", "show", "hide"]);
  } catch (e) {
    report.stable.customOverlay = { constructionError: String(e && e.message ? e.message : e) };
  }

  report.phase = "done";
  window.__PROBE_165C__ = report;
})();
`;

/**
 * 要判「补齐了没有」的类（喂给共享判定层的 `awaitSettled`）。
 *
 * `settleWhenPresent` 是**具名**成员而不是「成员数 > N」：数量门槛在成员增删时会误判
 * （live 读到 26 个成员时数量早就过线，但 `toggle` 未必已到）。
 * `minProtoMembers` 只作**附加**下限（防某次抽样整体异常偏低）。
 */
export const MEMBER_SURFACE_SPECS: readonly MemberSurfaceSpec[] = [
  {
    ctor: "CityListControl",
    settleWhenPresent: ["toggle", "getCityName"],
    // ⚠️ `observe` 必须**独立列出**要下结论的成员：页面侧只采 `settleWhenPresent` 的话，
    // `open` / `close` / `getTriggerDom` 根本没被读过，却会被判成 `absent`
    // （本轮 live 实跑真的这么错判过一次，§④ 明写 `open proto=true` 而三态段印 `absent`）。
    observe: ["open", "close", "toggle", "getTriggerDom", "getCityName"],
    minProtoMembers: 10,
  },
  {
    ctor: "CopyrightControl",
    settleWhenPresent: ["removeCopyright"],
    observe: ["addCopyright", "removeCopyright", "getCopyright", "getCopyrightCollection"],
    minProtoMembers: 10,
  },
];

/** 每个要问的成员（喂给 Node 侧的 `verdictsOf()` 出三态）。 */
export const SURFACE_MEMBERS: Record<string, readonly string[]> = {
  CityListControl: ["open", "close", "toggle", "getTriggerDom", "getCityName"],
  CopyrightControl: ["addCopyright", "removeCopyright", "getCopyright", "getCopyrightCollection"],
};

/**
 * 组装最终页面脚本。三个占位符**各自**替换一次。
 *
 * ⚠️ 刻意**不用**全局正则替换：上一步刚注入的内容会被再套一层
 * （`window.__window.__MEMBER_SURFACE_SPECS____`，本轮真的撞到过一次），
 * 而那种损坏在 `new Function` 的语法检查下**看不出来**——它仍是合法 JS，只是名字错了。
 */
function buildPageScript(ak: string): string {
  return PAGE_JS.replace("__AK_LITERAL__", JSON.stringify(ak))
    .replace("__MEMBER_SURFACE_SPECS__", JSON.stringify(MEMBER_SURFACE_SPECS))
    .replace("__MEMBER_SURFACE_SOURCE__", MEMBER_SURFACE_PAGE_SOURCE);
}

/* -------------------------------------------------------------------- 打印 */

interface MemberEntry {
  proto: boolean;
  inst: boolean;
  own: boolean;
  call?: { threw: boolean; value?: string; message?: string };
}
interface Reading {
  protoNames?: string[] | null;
  protoMemberCount?: number;
  members?: Record<string, MemberEntry>;
}

function printCall(call: MemberEntry["call"] | undefined): string {
  if (!call) return "";
  return call.threw ? ` call=THREW(${call.message})` : ` call=${call.value}`;
}

function printMembers(reading: Reading | undefined, indent: string): void {
  if (!reading) return;
  if (reading.protoNames) {
    console.log(`${indent}prototype 共 ${reading.protoNames.length} 个成员：${JSON.stringify(reading.protoNames)}`);
  }
  for (const [name, entry] of Object.entries(reading.members ?? {})) {
    console.log(
      `${indent}  ${name.padEnd(24)} proto=${String(entry.proto).padEnd(5)} inst=${String(entry.inst).padEnd(5)} own=${String(entry.own).padEnd(5)}${printCall(entry.call)}`,
    );
  }
}

function printPlain(prefix: string, value: unknown): void {
  if (value === undefined) return;
  if (value && typeof value === "object" && "threw" in (value as Record<string, unknown>)) {
    const v = value as { threw: boolean; value?: string; message?: string };
    console.log(`${prefix}${v.threw ? `THREW(${v.message})` : v.value}`);
    return;
  }
  console.log(`${prefix}${JSON.stringify(value)}`);
}

function redact(text: string): string {
  const trimmed = AK.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!AK) {
    console.error(
      "缺 AK：BAIDU_MAP_AK=<ak> node --experimental-strip-types scripts/probe-165c-surface.mts",
    );
    return 2;
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`);
    return 2;
  }

  // 共享判定层以源码字符串注入（页面里不能 import）。
  const pageScript = buildPageScript(AK);
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>165c surface probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "probe-165c-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[165c] 服务未就绪（脚手架失败）");
    return 2;
  }
  const baseUrl = `http://localhost:${address.port}/`;

  let chrome: ChildProcess | null = null;
  let session: Awaited<ReturnType<typeof connectCdpSession>> | null = null;
  try {
    chrome = spawn(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        baseUrl,
      ],
      { stdio: "ignore" },
    );

    const portFile = join(userDataDir, "DevToolsActivePort");
    const startedAt = Date.now();
    let devtoolsPort = 0;
    for (;;) {
      if (existsSync(portFile)) {
        devtoolsPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
        if (devtoolsPort) break;
      }
      if (Date.now() - startedAt > 30_000) throw new Error("等待 DevToolsActivePort 超时");
      await sleep(200);
    }

    let target: { webSocketDebuggerUrl?: string } | undefined;
    const t1 = Date.now();
    for (;;) {
      try {
        const list = (await (
          await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
        ).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
        target = list.find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
        if (target?.webSocketDebuggerUrl) break;
      } catch {
        /* CDP 还没起来 */
      }
      if (Date.now() - t1 > 30_000) throw new Error("等待 page target 超时");
      await sleep(300);
    }

    session = await connectCdpSession(target!.webSocketDebuggerUrl!, {
      deadline: Date.now() + 240_000,
      commandTimeoutMs: 30_000,
    });
    const report = await readProbeReport<Record<string, any>>(session, {
      expression: "window.__PROBE_165C__ ? JSON.stringify(window.__PROBE_165C__) : null",
      deadline: Date.now() + 180_000,
      pollIntervalMs: 500,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__PROBE_165C__");
      return 2;
    }

    console.log("== #165c 运行时成员面探针 ==");
    console.log(`SDK：${JSON.stringify(report.sdk)}  阶段：${report.phase}`);
    if (report.loadError) console.log(`SDK 未起来：${redact(String(report.loadError))}`);

    console.log("-- ① 加载时间轴（成员面何时补齐）--");
    for (const s of report.timeline ?? []) {
      console.log(
        `  ${String(s.label).padEnd(30)} +${String(s.ms).padStart(6)}ms  ` +
          `CityList=${String(s.cityListMembers).padStart(2)}（toggle=${s.hasToggle} getCityName=${s.hasGetCityName}）  ` +
          `Copyright=${String(s.copyrightMembers).padStart(2)}（removeCopyright=${s.hasRemoveCopyright}）`,
      );
    }
    console.log(`  补齐发生在官方 callback 之后 ${String(report.settleMsAfterCallback)}ms`);

    // —— 等待是否可观测 —— 原审计缺的正是这一段。
    //
    // 没有它，§④ 的读数与「窗口内提前取的读数」在报告里**长得一样**，
    // 于是「读到 false」被当成了「不存在」。现在等待结果单独成段，且 `settled:false`
    // 会让下面 §④ 附表里的每个 `absent` 变成 `unsettled`（未判定）。
    const surface = normalizeReport(report.memberSurface);
    console.log("-- ①b 等待是否真的等到补齐（判 absent 的前置条件）--");
    console.log(
      `  settled=${surface.settled}  timedOut=${surface.timedOut}  ` +
        `settledAfterMs=${String(surface.settledAfterMs)}  采样 ${surface.attempts} 次`,
    );
    if (!surface.settled) {
      console.log("  ⚠️ **没等到补齐** ⇒ 下面所有「不存在」都是**未判定**，不得当证据引用。");
    }
    for (const spec of MEMBER_SURFACE_SPECS) {
      const final = surface.final[spec.ctor];
      console.log(
        `  ${spec.ctor}：终态原型成员数=${String(final?.protoMemberCount)}  ` +
          `settleWhenPresent=[${spec.settleWhenPresent.join(", ")}] 在位=[${(final?.present ?? []).join(", ")}]`,
      );
    }
    const surfaceVerdicts = verdictsOf(MEMBER_SURFACE_SPECS, SURFACE_MEMBERS, surface);

    console.log("-- ② 窗口「前」：真走一遍 mount→unmount --");
    const before = report.windowBefore ?? {};
    printPlain("  官方 callback 之后 ", String(before.msAfterCallback) + "ms 处\n");
    console.log(`  addCopyright=${before.addCopyright}  removeCopyright=${before.removeCopyright}`);
    printPlain("  mount 的 addCopyright 调用: ", before.addCopyrightCall);
    printPlain("  add 之后 getCopyrightCollection: ", before.collectionAfterAdd);
    printPlain("  unmount 的 removeCopyright 调用: ", before.removeCopyrightCall);
    console.log(`  CityListControl: toggle=${before.cityList?.toggle} getCityName=${before.cityList?.getCityName} open=${before.cityList?.open}`);
    printPlain("  cl.toggle(): ", before.cityList?.toggleCall);
    printPlain("  cl.getCityName(): ", before.cityList?.getCityNameCall);

    console.log("-- ③ 窗口「后」：同一个实例（补齐是追溯的）--");
    const after = report.windowAfter ?? {};
    console.log(`  同一个 CopyrightControl 的 removeCopyright 现在是 ${after.removeCopyrightNowFunction}`);
    printPlain("  窗口里 add 的那条现在还在吗: ", after.collectionNow);
    printPlain("  现在调 removeCopyright(1): ", after.removeCopyrightCall);
    printPlain("  remove 之后 getCopyrightCollection: ", after.collectionAfterRemove);
    console.log(`  同一个 CityListControl 的 toggle 现在是 ${after.clToggleNowFunction}`);
    printPlain("  现在调 cl.toggle(): ", after.clToggleCall);
    printPlain("  现在调 cl.getCityName(): ", after.clGetCityNameCall);

    console.log("-- ④ 稳定后的成员面 --");
    for (const [name, reading] of Object.entries(report.stable as Record<string, Reading>)) {
      if (!reading || typeof reading !== "object") continue;
      console.log(`  [${name}]`);
      printMembers(reading, "  ");
    }

    // —— 三态读数（共享判定层）——
    // `absent` **只在 settled 之后**可能出现；没等到补齐时一律 `unsettled`（未判定）。
    // 这一段是本探针与原审计的**唯一**实质差别：原脚本在同样早的时机取样，
    // 却在报告里呈现为「成员不存在」。
    console.log("-- ⑤ 三态读数：present / absent / unsettled（未判定）--");
    for (const [ctor, members] of Object.entries(surfaceVerdicts)) {
      console.log(`  [${ctor}]`);
      for (const [member, presence] of Object.entries(members)) {
        const suffix = presence === "unsettled" ? "  ← 不可当「不存在」的证据" : "";
        console.log(`    ${member.padEnd(24)} ${presence}${suffix}`);
      }
    }

    if (OUT) {
      writeFileSync(OUT, redact(JSON.stringify(report, null, 2)));
      console.log(`原始报告（已脱敏）写入 ${OUT}`);
    }
    return report.phase === "done" ? 0 : 3;
  } finally {
    session?.close();
    chrome?.kill();
    server.close();
  }
}

process.exit(await main());
