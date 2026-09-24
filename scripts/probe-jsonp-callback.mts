#!/usr/bin/env node
/**
 * JSONP 回调全局名占用与 foreign 捕获探针（issue #128 / F-2）
 *
 * 审计表登记的问题：`SharedLoadTask` 的进程级 `callbackRegistry` + 全局名占用 / foreign 回调
 * 捕获，是**唯一保留**的「恢复上游未公开身份」处。它服务的是 `customScriptV4Provider` 的
 * jsonp 显式高级路径，依据一直是 `ASSUMED`（「官方 JSONP 回调命名是我们的读法」未取证）。
 * #128 的验收要求：保留前必须 live 取证，并给出 guarantee 措辞与可回归 gate。
 *
 * 本探针只测**官方**那一侧（我们的 install/release 逻辑由 `ScriptLoader.test.ts` 单测钉住）：
 *
 * 1. **`callback=<名>` 契约**：装好 handler 再加载官方入口，官方是否调用 `window[<名>]`、
 *    调了几次、args 长度多少、调用时全局值是否仍是我们的 handler（官方会不会先覆盖）；
 * 2. **foreign 场景**：安装前先在同名上放一个外部原值（模拟「别人也注册了同名回调」），
 *    我们再覆盖上去，加载完成并释放后，原引用是否被恢复；
 * 3. **官方新增全局**：加载前后 `window` 键差集，核对是否与 `__bmap_v4_custom_` 前缀冲突。
 *
 * ## 正证控件
 *
 * - `control.callbackFired.count >= 1`：官方**必须**调用过我们的 handler；
 * - `control.readyAtCall.ready === true`：**首次 callback 当下**（handler 内同步采样，
 *   后续调用不覆盖）与生产 `requireJsapiV4Global` 同口径——`JSAPI_V4_REQUIRED_MEMBERS`
 *   （Map / Point / Marker）齐全；生产路径 `SharedLoadTask.succeed()` 会在这里同步跑
 *   `assertReady`；
 * - `control.handlerIdentityAtCall.same === true`：**首次**调用时身份未被覆盖
 *   （生产只消费第一次回调；身份 / args / 成员快照均只取 first-call）。
 *
 * `control.bmapReady`（入口回调后轮询到的最终就绪，同三成员口径）保留为**诊断读数**，
 * 不能代替 `readyAtCall`。
 *
 * 控件读数齐备但任一不成立 ⇒ 退出码 1、**本轮不出结论**（不是「SDK 行为不好」）；
 * 若是 SDK 没起来 / phase 未完成，走 blocked（退出码 3）。
 *
 * ## 判定与退出码
 *
 * | 结论 | 触发 | 退出码 |
 * | --- | --- | --- |
 * | `pass` | 正证控件成立，读数取到 | 0 |
 * | `fail` | 控件读数齐备但正证不成立（本轮无法判定） | 1 |
 * | `blocked` | SDK 没起来（`loadError`）或 `phase ≠ done`（**先于**控件判定） | 3 |
 * | 脚手架失败 | 缺 AK / 找不到浏览器 / 语法错 / 没写报告 | 2 |
 *
 * 判定顺序有意为 **blocked → 控件 → 结论**（与 destroy 探针同口径）。
 *
 * ## 它是证据生成器，不是门禁
 *
 * 与 `probe-layer-detached.mts` 同一口径：不进 CI 必需链路。F-2 的**可回归 gate** 是
 * `tests/behavior/v3-probe-jsonp-callback-verdicts.test.ts` 的 COMPLETE ↔ live fixture 一致性
 * + `ScriptLoader.test.ts` 的 foreign 单测（那是本库 OWNED 侧的回归门）。
 *
 * 用法：
 *   BAIDU_MAP_AK=<ak> pnpm probe:jsonp-callback
 *   BAIDU_MAP_AK=<ak> pnpm probe:jsonp-callback -- --out=/tmp/jsonp-callback.json
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpSession, readProbeReport, sleep } from "./official-probe/cdp.mts";
import {
  controlFailures,
  verdicts,
  type ProbeReport,
} from "./probe-jsonp-callback-verdicts.mts";

const ak = argValue("ak") ?? process.env.BAIDU_MAP_AK ?? "";
const outPath = argValue("out") ?? "";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/* ------------------------------------------------------------------ 页面脚本 */

/**
 * 结构（两臂对照，每一步都写进 report；页面异常落 `report.error`）：
 *
 * - **control 臂**：snapshot A（基线全局键）→ 安装 handler 到 `__bmap_v4_custom_probe` →
 *   加载 `api?v=4.0&callback=__bmap_v4_custom_probe` → 等 handler 被调 + BMap 就绪 →
 *   释放（delete 我们的名）→ snapshot B（新增全局）；
 * - **foreign 臂**：同名上先放外部原值 → 再装我们的 handler（覆盖）→ 再次加载（此时官方可能
 *   已缓存；若不回调则记 `foreign.callbackFired=0` 并由 verdict 判第三态侧）→ 释放后比对原引用。
 *
 * ⚠️ 页面里**不出现反引号**（外层是 TS 模板串），由 `v3-probe-page-scripts.test.ts` 静态守卫。
 */
const PAGE_JS = `
(async () => {
  const AK = __AK__;
  const NAME = "__bmap_v4_custom_probe";
  const report = { phase: "boot", sdk: null, readings: [], console: [], error: null, loadError: null };
  // 只在结束时写 window：readProbeReport 一看到非 null 就返回（phase 可能还是 boot）。
  // 与 probe-layer-detached 同口径——中途挂了由 catch 写 phase=error 再挂上。

  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = function (...a) { report.console.push({ level: "warn", text: a.map(String).join(" ") }); return originalWarn.apply(console, a); };
  console.error = function (...a) { report.console.push({ level: "error", text: a.map(String).join(" ") }); return originalError.apply(console, a); };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const push = (id, extra) => { report.readings.push(Object.assign({ id: id }, extra)); };
  const attempt = (fn) => {
    try { fn(); return { threw: false, message: null }; }
    catch (error) { return { threw: true, message: String(error && error.message ? error.message : error) }; }
  };
  const typeOfName = () => {
    try { return Object.prototype.hasOwnProperty.call(window, NAME) ? typeof window[NAME] : "absent"; }
    catch (error) { return "throw:" + String(error && error.message ? error.message : error); }
  };
  const windowKeys = () => {
    try { return Object.getOwnPropertyNames(window).sort(); } catch (error) { return []; }
  };
  // 与生产 findMissingJsapiV4Members 同口径：JSAPI_V4_REQUIRED_MEMBERS 缺一不可
  //（undefined / null 即缺；命名空间本身不是对象/函数时三成员全缺）。
  const REQUIRED_MEMBERS = ["Map", "Point", "Marker"];
  const missingMembers = () => {
    const ns = window.BMap;
    if (ns === null || ns === undefined) return REQUIRED_MEMBERS.slice();
    if (typeof ns !== "object" && typeof ns !== "function") return REQUIRED_MEMBERS.slice();
    return REQUIRED_MEMBERS.filter(function (member) {
      return ns[member] === undefined || ns[member] === null;
    });
  };

  try {
    /* ---- 基线：加载前 window 键集合（后面算差集） ---- */
    const baselineKeys = windowKeys();

    /* ---- control 臂：安装我们的 handler，再加载官方入口 ---- */
    let fired = 0;
    // **只取首次回调**的快照：生产 assertReady / 回调消费的是第一次调用；
    // 后续调用不得覆盖 first-call 身份 / args / 成员就绪。null = 尚未被调用过。
    let firstArgsLength = -1;
    let firstIdentityAtCall = null;
    let firstMissingMembers = null;
    let readyAtCall = null;
    let readyResolve;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
    const settleReady = function () { if (readyResolve) readyResolve(); };
    // ourHandler 同时是就绪信号：首次被调即 settleReady。
    const ourHandler = function () {
      const firstCall = fired === 0;
      fired += 1;
      if (firstCall) {
        firstArgsLength = arguments.length;
        firstIdentityAtCall = window[NAME] === ourHandler;
        firstMissingMembers = missingMembers();
        readyAtCall = firstMissingMembers.length === 0;
      }
      settleReady();
    };
    try {
      window[NAME] = ourHandler;
    } catch (error) {
      push("control.install", { threw: true, message: String(error && error.message ? error.message : error) });
      throw error;
    }
    push("control.install", { threw: false, message: null, type: typeOfName() });

    // 入口 callback 指向**我们的** NAME（不是临时 ready 名）：要测的就是官方会不会调它。
    const script = document.createElement("script");
    script.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=" + encodeURIComponent(NAME);
    script.onerror = () => { report.loadError = "SDK 入口脚本加载失败（script error）"; };
    document.head.appendChild(script);
    await Promise.race([readyPromise, wait(60000)]);
    // 再等成员齐全（入口回调可能先于 getscript 成员）——与 assertReady 同三成员口径
    for (let i = 0; i < 150; i++) {
      if (missingMembers().length === 0) break;
      if (fired > 0 && i > 10) break;
      await wait(200);
    }
    // 若 ourHandler 还没被调但 BMap 已就绪，再等一会（官方可能在成员就绪后才调 callback）
    for (let i = 0; i < 30 && fired === 0; i++) await wait(200);

    const finalMissing = missingMembers();
    const bmapReady = finalMissing.length === 0;
    push("control.callbackFired", { threw: false, count: fired });
    // args / identity：**首次**回调的快照（生产只消费第一次；后续调用不覆盖）。
    push("control.argsLength", {
      threw: false,
      count: firstArgsLength < 0 ? 0 : firstArgsLength,
      rawLength: firstArgsLength,
    });
    push("control.handlerIdentityAtCall", { threw: false, same: firstIdentityAtCall === true });
    // readyAtCall：**首次** callback 当下（handler 内同步采样，Map/Point/Marker 齐全）。
    // 从未被调用则不带 ready / missing 字段 ⇒ 判定层第三态。
    if (readyAtCall === null || firstMissingMembers === null) {
      push("control.readyAtCall", { threw: false });
    } else {
      push("control.readyAtCall", { threw: false, ready: readyAtCall, missing: firstMissingMembers });
    }
    // 最终 ready：诊断读数（入口回调后轮询到的成员齐全时刻），**不能**代替 readyAtCall。
    push("control.bmapReady", { threw: false, ready: bmapReady, missing: finalMissing });
    push("control.loadAttempt", { threw: !!(report.loadError), message: report.loadError || null });
    report.sdk = bmapReady
      ? { version: String(window.BMap.version), map: typeof window.BMap.Map }
      : { version: null, map: typeof (window.BMap && window.BMap.Map) };

    /* ---- 释放 control 臂：delete 我们装的名（模拟 SharedLoadTask cleanup） ---- */
    if (window[NAME] === ourHandler) delete window[NAME];
    push("release.afterControl", { threw: false, type: typeOfName() });

    /* ---- snapshot B：官方加载后新增的全局键 ---- */
    const afterKeys = windowKeys();
    const baselineSet = new Set(baselineKeys);
    // NAME 已在上面 delete，不会出现在 afterKeys；差集就是官方新增。
    const officialCreated = afterKeys.filter(function (k) { return !baselineSet.has(k); });
    push("globals.officialCreated", { threw: false, keys: officialCreated });

    /* ---- foreign 臂：安装前有外部原值 → 我们覆盖 → 释放后是否恢复 ---- */
    const foreignValue = function foreignSentinel() { return "foreign"; };
    try {
      window[NAME] = foreignValue;
      push("foreign.preInstall", { threw: false, type: typeOfName(), same: window[NAME] === foreignValue });
      // 覆盖装我们的（与 installGlobalCallback 同形：赋值）
      const foreignHandler = function () {
        fired += 1;
      };
      window[NAME] = foreignHandler;
      // 第二次加载：官方若支持 callback 会再调一次；已缓存则可能不再调——两种都记读数。
      const script2 = document.createElement("script");
      script2.src = "https://api.map.baidu.com/api?v=4.0&ak=" + encodeURIComponent(AK) + "&callback=" + encodeURIComponent(NAME) + "&_probe=foreign";
      document.head.appendChild(script2);
      const foreignBase = fired;
      await wait(4000);
      const foreignFired = fired - foreignBase;
      push("foreign.callbackFired", { threw: false, count: foreignFired });
      // 释放：若当前仍是我们的 foreignHandler，则恢复 foreignValue（模拟 releaseGlobalCallback）
      if (window[NAME] === foreignHandler) {
        window[NAME] = foreignValue;
      }
      push("foreign.afterRelease", {
        threw: false,
        type: typeOfName(),
        same: window[NAME] === foreignValue,
      });
      // 清理
      if (window[NAME] === foreignValue) delete window[NAME];
    } catch (error) {
      push("foreign.preInstall", { threw: true, message: String(error && error.message ? error.message : error) });
      throw error;
    }

    report.phase = "done";
  } catch (error) {
    report.error = String(error && error.stack ? error.stack : error);
    report.phase = "error";
  }
  window.__JSONP_CALLBACK_PROBE__ = report;
})();
`;

function redact(text: string): string {
  const trimmed = ak.trim();
  return trimmed ? text.split(trimmed).join("***") : text;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<number> {
  if (!ak.trim()) {
    console.error("缺 BAIDU_MAP_AK：`BAIDU_MAP_AK=<ak> pnpm probe:jsonp-callback`");
    return 2;
  }
  const browser =
    process.env.SMOKE_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(browser)) {
    console.error(`浏览器不存在：${browser}（可用 SMOKE_BROWSER 覆盖）`);
    return 2;
  }

  const pageScript = PAGE_JS.replace("__AK__", JSON.stringify(ak));
  try {
    // eslint-disable-next-line no-new-func
    new Function(pageScript);
  } catch (error) {
    console.error(`页面脚本语法错误（脚手架失败）：${(error as Error).message}`);
    return 2;
  }

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>jsonp callback probe</title></head>
<body><script>${pageScript}</script></body></html>`;

  const userDataDir = mkdtempSync(join(tmpdir(), "jsonp-callback-chrome-"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml);
  });
  await new Promise<void>((done) => server.listen(0, "localhost", () => done()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    console.error("[jsonp-callback] 服务未就绪（脚手架失败）");
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
      deadline: Date.now() + 180_000,
      commandTimeoutMs: 30_000,
    });
    const report = await readProbeReport<ProbeReport>(session, {
      expression:
        "window.__JSONP_CALLBACK_PROBE__ ? JSON.stringify(window.__JSONP_CALLBACK_PROBE__) : null",
      deadline: Date.now() + 150_000,
      pollIntervalMs: 500,
    });
    if (!report) {
      console.error("PROBE_REPORT_MISSING：页面没有写 window.__JSONP_CALLBACK_PROBE__");
      return 2;
    }

    console.log("== JSONP 回调全局名占用 / foreign 捕获探针 ==")
    console.log(`SDK：${redact(JSON.stringify(report.sdk))}  页面阶段：${report.phase}`)
    if (report.error) console.log(`页面异常：${redact(report.error).split("\n")[0]}`)
    for (const reading of report.readings) {
      console.log(`  ${reading.id.padEnd(34)} ${redact(JSON.stringify(reading))}`)
    }
    if (report.console.length > 0) {
      console.log(`-- 页面 console（${report.console.length} 条）--`)
      for (const entry of report.console.slice(0, 12)) {
        console.log(`  [${entry.level}] ${redact(entry.text)}`)
      }
    }
    // 退出码顺序与 issue 分档对齐：blocked（SDK 没起来 / phase 未完成）先于 fail。
    if (report.loadError || report.phase !== "done") {
      if (report.loadError) {
        console.error(`-- blocked：SDK 入口未就绪（${report.loadError}）⇒ 退出码 3 --`)
      } else {
        console.error(`-- blocked：页面阶段 ${report.phase} ≠ done ⇒ 退出码 3 --`)
      }
      if (outPath) writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      return 3;
    }
    const failures = controlFailures(report);
    if (failures.length > 0) {
      console.error("-- 正证控件不成立 ⇒ 本轮不出结论 --")
      for (const failure of failures) console.error(`  ${failure}`)
      console.error("（上面这些读数按「无法判定」对待：控件不成立时它们无意义）")
      if (outPath) writeFileSync(outPath, redact(JSON.stringify(report, null, 2)));
      return 1;
    }

    console.log("-- 结论 --")
    const lines = verdicts(report)
    for (const line of lines) console.log(`  ${line}`)

    if (outPath) {
      writeFileSync(outPath, redact(JSON.stringify(report, null, 2)))
      console.log(`原始报告（已脱敏）写入 ${outPath}`)
    }
    console.log(`summary: ${redact(lines.join(" | "))}`)
    return 0
  } finally {
    session?.close()
    chrome?.kill()
    server.close()
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`[jsonp-callback] 脚手架失败：${redact(String(error))}`)
  return 2
})
